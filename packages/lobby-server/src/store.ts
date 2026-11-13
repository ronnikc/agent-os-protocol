// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

/**
 * LobbyStore — the durable-state seam for the lobby. The in-memory implementation backs Local
 * Mode and the portable Node WS server; a Redis/Postgres implementation backs the remote swarm
 * (apps/lobby-web) without changing the coordinator. All methods are async so a network-backed
 * store drops in unchanged.
 */

import type { LobbySession, LobbyAgent, LobbyMessage, LobbyTask, LobbyEvent, LobbyRequest } from '@agent-os/protocol-core';
import type { Lobby, LobbyMember, LobbyIntegration, IntegrationSecret, ExternalIdentityLink, KnowledgeBase, KnowledgeSyncJob, MarketplaceTask, ConcordiumIssuerRecord, TaskBid, ProviderKeyConfig, WalletChallenge } from './models.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { emptyHostedState, type HostedState } from './hosted/hosted-state.js';

// Where the durable lobby state lives. On a hosted deployment this MUST point at a path that
// survives container recycling/redeploys (a mounted volume) — set AGENT_OS_LOBBY_STORE_FILE to an
// absolute path on that volume. The default (cwd) is for local dev only; it is per-container and is
// lost when the container is replaced. The file is runtime state and must never be committed to git
// (a committed copy would be restored over live data on every deploy) — it is gitignored.
const STORE_FILE = process.env.AGENT_OS_LOBBY_STORE_FILE?.trim() || join(process.cwd(), 'lobby-store-db.json');

/**
 * A hosted agent the owner started and wants running — persisted so the swarm is re-launched after
 * a lobby restart/deploy (hosted agents live in-process and otherwise die on restart). Keyed per
 * lobby by role (or name). Includes the model so it comes back on the same model it was running.
 */
export interface HostedAgentSpec {
  lobby_id: string;
  agent_role?: string;
  name: string;
  provider: string;
  model: string;
  base_url?: string;
  agent_ref?: string | null;
}

export function hostedAgentSpecKey(lobbyId: string, roleOrName: string): string {
  return `${lobbyId}::${roleOrName}`;
}

/**
 * The current shared "work session" branch + PR for a lobby. All task writes in a session stack onto
 * this one branch so the swarm produces ONE reviewable Pull Request, not a conflicting PR per task.
 * A new session starts once this PR merges/closes.
 */
export interface LobbyWorkSession {
  branch: string;
  pr_url: string;
  pr_number: number | null;
}

export interface LobbyStore {
  readHostedState(lobbyId: string): HostedState;
  hostedLobbyIds(): string[];
  mutateHostedState<T>(lobbyId: string, update: (state: HostedState) => T): T;
  createLobby(lobby: LobbySession, overwrite?: boolean): Promise<LobbySession>;
  getLobby(lobbyId: string): Promise<LobbySession | undefined>;
  listLobbies(): Promise<LobbySession[]>;
  updateLobby(lobbyId: string, patch: Partial<LobbySession>): Promise<LobbySession | undefined>;
  claimLobbyOwner(lobbyId: string, owner: LobbyMember): Promise<boolean>;

  addAgent(lobbyId: string, agent: LobbyAgent): Promise<void>;
  getAgent(lobbyId: string, agentId: string): Promise<LobbyAgent | undefined>;
  updateAgent(lobbyId: string, agentId: string, patch: Partial<LobbyAgent>): Promise<LobbyAgent | undefined>;
  removeAgent(lobbyId: string, agentId: string): Promise<void>;
  roster(lobbyId: string): Promise<LobbyAgent[]>;

  /** Atomically allocate the next monotonic sequence number within a lobby. */
  nextSeq(lobbyId: string): Promise<number>;

  appendMessage(lobbyId: string, message: LobbyMessage): Promise<void>;
  listMessages(lobbyId: string): Promise<LobbyMessage[]>;
  clearMessages(lobbyId: string): Promise<void>;

  upsertTask(task: LobbyTask): Promise<void>;
  getTask(lobbyId: string, taskId: string): Promise<LobbyTask | undefined>;
  listTasks(lobbyId: string): Promise<LobbyTask[]>;
  deleteTask(lobbyId: string, taskId: string): Promise<boolean>;

  appendEvent(event: LobbyEvent): Promise<void>;
  listEvents(lobbyId: string): Promise<LobbyEvent[]>;

  // --- New DB Model operations ---
  addMember(member: LobbyMember): Promise<LobbyMember>;
  getMember(lobbyId: string, identityRef: string): Promise<LobbyMember | undefined>;
  listMembers(lobbyId: string): Promise<LobbyMember[]>;
  updateMember(lobbyId: string, memberId: string, patch: Partial<LobbyMember>): Promise<LobbyMember | undefined>;

  addIntegration(integration: LobbyIntegration): Promise<LobbyIntegration>;
  getIntegration(lobbyId: string, provider: 'slack' | 'github' | 'google_drive' | 'discord' | 'telegram' | 'supabase' | 'dreambase'): Promise<LobbyIntegration | undefined>;
  listIntegrations(lobbyId: string): Promise<LobbyIntegration[]>;
  updateIntegration(lobbyId: string, integrationId: string, patch: Partial<LobbyIntegration>): Promise<LobbyIntegration | undefined>;

  addSecret(secret: IntegrationSecret): Promise<IntegrationSecret>;
  getSecret(integrationId: string, secretType: string): Promise<IntegrationSecret | undefined>;
  updateSecret(secretId: string, patch: Partial<IntegrationSecret>): Promise<IntegrationSecret | undefined>;

  // Hosted-Mode provider-key custody — encrypted at rest; plaintext is never returned by the store.
  // One active config per (lobby, agent_ref, provider) scope; agent_ref null = the lobby default.
  putProviderKey(config: ProviderKeyConfig): Promise<ProviderKeyConfig>;
  /** Resolve the effective config: a per-agent override wins over the lobby default. */
  getProviderKey(lobbyId: string, provider: string, agentRef?: string | null): Promise<ProviderKeyConfig | undefined>;
  listProviderKeys(lobbyId: string): Promise<ProviderKeyConfig[]>;
  revokeProviderKey(lobbyId: string, id: string): Promise<ProviderKeyConfig | undefined>;

  linkExternalIdentity(link: ExternalIdentityLink): Promise<ExternalIdentityLink>;
  getExternalIdentityLink(provider: string, externalUserId: string): Promise<ExternalIdentityLink | undefined>;

  upsertKnowledgeBase(kb: KnowledgeBase): Promise<KnowledgeBase>;
  getKnowledgeBase(lobbyId: string): Promise<KnowledgeBase | undefined>;

  // Per-lobby, per-role agent nicknames (user-chosen display names). Keyed by agent_role slug.
  getAgentNicknames(lobbyId: string): Promise<Record<string, string>>;
  setAgentNickname(lobbyId: string, role: string, nickname: string): Promise<Record<string, string>>;
  putHostedAgentSpec(spec: HostedAgentSpec): Promise<void>;
  listHostedAgentSpecs(lobbyId: string): Promise<HostedAgentSpec[]>;
  listAllHostedAgentSpecs(): Promise<HostedAgentSpec[]>;
  removeHostedAgentSpec(lobbyId: string, roleOrName: string): Promise<void>;
  getLobbySession(lobbyId: string): Promise<LobbyWorkSession | undefined>;
  setLobbySession(lobbyId: string, session: LobbyWorkSession): Promise<void>;

  upsertKnowledgeSyncJob(job: KnowledgeSyncJob): Promise<KnowledgeSyncJob>;
  getKnowledgeSyncJob(jobId: string): Promise<KnowledgeSyncJob | undefined>;
  listKnowledgeSyncJobs(lobbyId: string): Promise<KnowledgeSyncJob[]>;

  // Wallet sign-in challenges (production Concordium proof) — single-use, short-lived.
  saveWalletChallenge(challenge: WalletChallenge): Promise<void>;
  /** Atomically fetch AND remove a challenge (single-use: consumed regardless of verify outcome). */
  consumeWalletChallenge(id: string): Promise<WalletChallenge | undefined>;

  // Nonces storage for proof-of-possession verification
  saveNonce(identityRef: string, lobbyId: string, nonce: string, expiresAt: number): Promise<void>;
  getNonce(identityRef: string): Promise<{ nonce: string; lobbyId: string; expiresAt: number } | undefined>;
  deleteNonce(identityRef: string): Promise<void>;

  // Task Marketplace operations
  createMarketplaceTask(task: MarketplaceTask): Promise<MarketplaceTask>;
  getMarketplaceTask(lobbyId: string, taskId: string): Promise<MarketplaceTask | undefined>;
  listMarketplaceTasks(lobbyId: string): Promise<MarketplaceTask[]>;
  updateMarketplaceTask(lobbyId: string, taskId: string, patch: Partial<MarketplaceTask>): Promise<MarketplaceTask | undefined>;
  deleteMarketplaceTask(lobbyId: string, taskId: string): Promise<void>;

  addTaskBid(bid: TaskBid): Promise<TaskBid>;
  listTaskBids(taskId: string): Promise<TaskBid[]>;

  registerIssuer(issuer: ConcordiumIssuerRecord): Promise<ConcordiumIssuerRecord>;
  getIssuer(issuerDid: string): Promise<ConcordiumIssuerRecord | undefined>;

  // Human approval request operations
  createLobbyRequest(request: LobbyRequest): Promise<LobbyRequest>;
  getLobbyRequest(lobbyId: string, requestId: string): Promise<LobbyRequest | undefined>;
  listLobbyRequests(lobbyId: string): Promise<LobbyRequest[]>;
  updateLobbyRequest(lobbyId: string, requestId: string, patch: Partial<LobbyRequest>): Promise<LobbyRequest | undefined>;
}

interface LobbyBucket {
  lobby: LobbySession;
  agents: Map<string, LobbyAgent>;
  messages: LobbyMessage[];
  tasks: Map<string, LobbyTask>;
  events: LobbyEvent[];
  seq: number;
}

/** Process-local store — the default for Local Mode and the standalone Node WS server. */
export class InMemoryLobbyStore implements LobbyStore {
  flushPendingWrites(): void {
    if (!this.saveTimer) return;
    this.saveSync(true);
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
  }
  private lobbies = new Map<string, LobbyBucket>();

  // New relation storage maps
  private members = new Map<string, LobbyMember>(); // memberId -> LobbyMember
  private integrations = new Map<string, LobbyIntegration>(); // integrationId -> LobbyIntegration
  private secrets = new Map<string, IntegrationSecret>(); // secretId -> IntegrationSecret
  private providerKeys = new Map<string, ProviderKeyConfig>(); // id -> ProviderKeyConfig
  private externalLinks = new Map<string, ExternalIdentityLink>(); // linkId -> ExternalIdentityLink
  private knowledgeBases = new Map<string, KnowledgeBase>(); // lobbyId -> KnowledgeBase
  private agentNicknames = new Map<string, Record<string, string>>(); // lobbyId -> { role: nickname }
  private hostedAgentSpecs = new Map<string, HostedAgentSpec>(); // `${lobbyId}::${role|name}` -> desired hosted agent
  private lobbySessions = new Map<string, LobbyWorkSession>(); // lobbyId -> current shared session branch/PR
  private syncJobs = new Map<string, KnowledgeSyncJob>(); // jobId -> KnowledgeSyncJob
  private nonces = new Map<string, { nonce: string; lobbyId: string; expiresAt: number }>(); // identityRef -> nonce details
  
  // Task Marketplace map storage
  private marketplaceTasks = new Map<string, MarketplaceTask>(); // taskId -> MarketplaceTask
  private bids = new Map<string, TaskBid[]>(); // taskId -> TaskBid[]
  private issuers = new Map<string, ConcordiumIssuerRecord>(); // issuerDid -> ConcordiumIssuerRecord
  private requests = new Map<string, LobbyRequest>(); // requestId -> LobbyRequest

  private saveTimer: NodeJS.Timeout | null = null;

  private hosted = new Map<string, HostedState>();

  constructor(private readonly storeFile = STORE_FILE) {
    this.loadSync();
  }

  readHostedState(lobbyId: string): HostedState {
    return structuredClone(this.hosted.get(lobbyId) ?? emptyHostedState());
  }

  hostedLobbyIds(): string[] {
    return [...this.hosted.keys()];
  }

  // Synchronous transaction for the single-writer lobby process. Persist before
  // returning so no external operation can race ahead of its reservation.
  mutateHostedState<T>(lobbyId: string, update: (state: HostedState) => T): T {
    const previous = this.hosted.get(lobbyId);
    const next = this.readHostedState(lobbyId);
    const result = update(next);
    this.hosted.set(lobbyId, next);
    try {
      this.saveSync(true);
    } catch (error) {
      if (previous) this.hosted.set(lobbyId, previous);
      else this.hosted.delete(lobbyId);
      throw error;
    }
    return structuredClone(result);
  }

  private queueSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveSync();
    }, 500);
  }

  private saveSync(required = false) {
    try {
      const lobbiesSerialized = Array.from(this.lobbies.entries()).map(([id, bucket]) => ({
        id,
        lobby: bucket.lobby,
        agents: Array.from(bucket.agents.entries()),
        messages: bucket.messages,
        tasks: Array.from(bucket.tasks.entries()),
        events: bucket.events,
        seq: bucket.seq
      }));

      const data = {
        lobbies: lobbiesSerialized,
        hosted: [...this.hosted.entries()],
        members: Array.from(this.members.entries()),
        integrations: Array.from(this.integrations.entries()),
        secrets: Array.from(this.secrets.entries()),
        providerKeys: Array.from(this.providerKeys.entries()),
        externalLinks: Array.from(this.externalLinks.entries()),
        knowledgeBases: Array.from(this.knowledgeBases.entries()),
        agentNicknames: Array.from(this.agentNicknames.entries()),
        hostedAgentSpecs: Array.from(this.hostedAgentSpecs.entries()),
        lobbySessions: Array.from(this.lobbySessions.entries()),
        syncJobs: Array.from(this.syncJobs.entries()),
        marketplaceTasks: Array.from(this.marketplaceTasks.entries()),
        bids: Array.from(this.bids.entries()),
        issuers: Array.from(this.issuers.entries()),
        requests: Array.from(this.requests.entries())
      };

      // Ensure the store directory exists — AGENT_OS_LOBBY_STORE_FILE points at a persistent path
      // outside the git checkout (e.g. the user's home), which may not exist on first write.
      mkdirSync(dirname(this.storeFile), { recursive: true });
      const temp = this.storeFile + '.tmp';
      const fd = openSync(temp, 'w', 0o600);
      try {
        writeFileSync(fd, JSON.stringify(data, null, 2), 'utf-8');
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(temp, this.storeFile);
    } catch (err) {
      if (required) throw err;
      console.error('[Lobby Store] Failed to save store state to disk:', err);
    }
  }

  private loadSync() {
    // Seamless migration: when the durable path (e.g. $HOME/.agent-os-lobby) has no store yet but a
    // legacy in-checkout ./lobby-store-db.json exists, load from it once. The next save writes to the
    // durable path, so state carries over the move without a manual copy or another wipe.
    let source = this.storeFile;
    if (!existsSync(source)) {
      const legacy = join(process.cwd(), 'lobby-store-db.json');
      if (this.storeFile === STORE_FILE && legacy !== STORE_FILE && existsSync(legacy)) {
        source = legacy;
        console.log(`[Lobby Store] Migrating state from legacy ${legacy} → ${STORE_FILE}`);
      } else {
        return;
      }
    }
    try {
      const content = readFileSync(source, 'utf-8');
      const data = JSON.parse(content);
      if (Array.isArray(data.hosted)) this.hosted = new Map(data.hosted);
      if (Array.isArray(data.lobbies)) {
        for (const item of data.lobbies) {
          this.lobbies.set(item.id, {
            lobby: item.lobby,
            agents: new Map(item.agents || []),
            messages: item.messages || [],
            tasks: new Map(item.tasks || []),
            events: item.events || [],
            seq: item.seq || 0
          });
        }
      }
      if (Array.isArray(data.members)) this.members = new Map(data.members);
      if (Array.isArray(data.integrations)) this.integrations = new Map(data.integrations);
      if (Array.isArray(data.secrets)) this.secrets = new Map(data.secrets);
      if (Array.isArray(data.providerKeys)) this.providerKeys = new Map(data.providerKeys);
      if (Array.isArray(data.externalLinks)) this.externalLinks = new Map(data.externalLinks);
      if (Array.isArray(data.knowledgeBases)) this.knowledgeBases = new Map(data.knowledgeBases);
      if (Array.isArray(data.agentNicknames)) this.agentNicknames = new Map(data.agentNicknames);
      if (Array.isArray(data.hostedAgentSpecs)) this.hostedAgentSpecs = new Map(data.hostedAgentSpecs);
      if (Array.isArray(data.lobbySessions)) this.lobbySessions = new Map(data.lobbySessions);
      if (Array.isArray(data.syncJobs)) this.syncJobs = new Map(data.syncJobs);
      if (Array.isArray(data.marketplaceTasks)) this.marketplaceTasks = new Map(data.marketplaceTasks);
      if (Array.isArray(data.bids)) this.bids = new Map(data.bids);
      if (Array.isArray(data.issuers)) this.issuers = new Map(data.issuers);
      if (Array.isArray(data.requests)) this.requests = new Map(data.requests);
      console.log(`[Lobby Store] Successfully loaded ${this.lobbies.size} lobbies from ${source}`);
    } catch (err) {
      throw new Error('Failed to load lobby store', { cause: err });
    }
  }

  private bucket(lobbyId: string): LobbyBucket | undefined {
    return this.lobbies.get(lobbyId);
  }

  async createLobby(lobby: LobbySession, overwrite = true): Promise<LobbySession> {
    const existing = this.bucket(lobby.lobby_id);
    if (existing && !overwrite) return existing.lobby;
    this.lobbies.set(lobby.lobby_id, {
      lobby,
      agents: new Map(),
      messages: [],
      tasks: new Map(),
      events: [],
      seq: lobby.message_seq ?? 0,
    });
    this.queueSave();
    return lobby;
  }

  async getLobby(lobbyId: string): Promise<LobbySession | undefined> {
    return this.bucket(lobbyId)?.lobby;
  }

  async listLobbies(): Promise<LobbySession[]> {
    return [...this.lobbies.values()].map((b) => b.lobby);
  }

  async updateLobby(lobbyId: string, patch: Partial<LobbySession>): Promise<LobbySession | undefined> {
    const b = this.bucket(lobbyId);
    if (!b) return undefined;
    b.lobby = { ...b.lobby, ...patch, updated_at: new Date().toISOString() };
    this.queueSave();
    return b.lobby;
  }

  async claimLobbyOwner(lobbyId: string, owner: LobbyMember): Promise<boolean> {
    const bucket = this.bucket(lobbyId);
    if (!bucket) return false;
    const current = bucket.lobby.created_by;
    if (current && current !== 'system' && current !== 'web-user') return false;
    bucket.lobby = { ...bucket.lobby, created_by: owner.identity_ref, updated_at: new Date().toISOString() };
    this.members.set(owner.id, owner);
    this.queueSave();
    return true;
  }

  async addAgent(lobbyId: string, agent: LobbyAgent): Promise<void> {
    this.bucket(lobbyId)?.agents.set(agent.agent_id, agent);
    this.queueSave();
  }

  async getAgent(lobbyId: string, agentId: string): Promise<LobbyAgent | undefined> {
    return this.bucket(lobbyId)?.agents.get(agentId);
  }

  async updateAgent(lobbyId: string, agentId: string, patch: Partial<LobbyAgent>): Promise<LobbyAgent | undefined> {
    const a = this.bucket(lobbyId)?.agents.get(agentId);
    if (!a) return undefined;
    const updated = { ...a, ...patch, last_seen: patch.last_seen ?? new Date().toISOString() };
    this.bucket(lobbyId)!.agents.set(agentId, updated);
    this.queueSave();
    return updated;
  }

  async removeAgent(lobbyId: string, agentId: string): Promise<void> {
    this.bucket(lobbyId)?.agents.delete(agentId);
    this.queueSave();
  }

  async roster(lobbyId: string): Promise<LobbyAgent[]> {
    return [...(this.bucket(lobbyId)?.agents.values() ?? [])].sort((a, b) =>
      a.registered_at.localeCompare(b.registered_at),
    );
  }

  async nextSeq(lobbyId: string): Promise<number> {
    const b = this.bucket(lobbyId);
    if (!b) return 0;
    b.seq += 1;
    b.lobby.message_seq = b.seq;
    this.queueSave();
    return b.seq;
  }

  async appendMessage(lobbyId: string, message: LobbyMessage): Promise<void> {
    this.bucket(lobbyId)?.messages.push(message);
    this.queueSave();
  }

  async listMessages(lobbyId: string): Promise<LobbyMessage[]> {
    return this.bucket(lobbyId)?.messages ?? [];
  }

  async clearMessages(lobbyId: string): Promise<void> {
    const b = this.bucket(lobbyId);
    if (b) {
      b.messages = [];
      this.queueSave();
    }
  }

  async upsertTask(task: LobbyTask): Promise<void> {
    this.bucket(task.lobby_id)?.tasks.set(task.task_id, task);
    this.queueSave();
  }

  async getTask(lobbyId: string, taskId: string): Promise<LobbyTask | undefined> {
    return this.bucket(lobbyId)?.tasks.get(taskId);
  }

  async listTasks(lobbyId: string): Promise<LobbyTask[]> {
    return [...(this.bucket(lobbyId)?.tasks.values() ?? [])].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  }

  async deleteTask(lobbyId: string, taskId: string): Promise<boolean> {
    const deleted = this.bucket(lobbyId)?.tasks.delete(taskId) ?? false;
    if (deleted) this.queueSave();
    return deleted;
  }

  async appendEvent(event: LobbyEvent): Promise<void> {
    this.bucket(event.lobby_id)?.events.push(event);
    this.queueSave();
  }

  async listEvents(lobbyId: string): Promise<LobbyEvent[]> {
    return this.bucket(lobbyId)?.events ?? [];
  }

  // --- New DB Model implementations ---
  async addMember(member: LobbyMember): Promise<LobbyMember> {
    this.members.set(member.id, member);
    this.queueSave();
    return member;
  }

  async getMember(lobbyId: string, identityRef: string): Promise<LobbyMember | undefined> {
    return [...this.members.values()].find((m) => m.lobby_id === lobbyId && m.identity_ref === identityRef);
  }

  async listMembers(lobbyId: string): Promise<LobbyMember[]> {
    return [...this.members.values()].filter((m) => m.lobby_id === lobbyId);
  }

  async updateMember(lobbyId: string, memberId: string, patch: Partial<LobbyMember>): Promise<LobbyMember | undefined> {
    const m = this.members.get(memberId);
    if (!m || m.lobby_id !== lobbyId) return undefined;
    const updated = { ...m, ...patch };
    this.members.set(memberId, updated);
    this.queueSave();
    return updated;
  }

  async addIntegration(integration: LobbyIntegration): Promise<LobbyIntegration> {
    this.integrations.set(integration.id, integration);
    this.queueSave();
    return integration;
  }

  async getIntegration(lobbyId: string, provider: 'slack' | 'github' | 'google_drive' | 'discord' | 'telegram' | 'supabase' | 'dreambase'): Promise<LobbyIntegration | undefined> {
    return [...this.integrations.values()].find((i) => i.lobby_id === lobbyId && i.provider === provider && i.status === 'active');
  }

  async listIntegrations(lobbyId: string): Promise<LobbyIntegration[]> {
    return [...this.integrations.values()].filter((i) => i.lobby_id === lobbyId);
  }

  async updateIntegration(lobbyId: string, integrationId: string, patch: Partial<LobbyIntegration>): Promise<LobbyIntegration | undefined> {
    const i = this.integrations.get(integrationId);
    if (!i || i.lobby_id !== lobbyId) return undefined;
    const updated = { ...i, ...patch, updated_at: new Date().toISOString() };
    this.integrations.set(integrationId, updated);
    this.queueSave();
    return updated;
  }

  async addSecret(secret: IntegrationSecret): Promise<IntegrationSecret> {
    this.secrets.set(secret.id, secret);
    this.queueSave();
    return secret;
  }

  async getSecret(integrationId: string, secretType: string): Promise<IntegrationSecret | undefined> {
    return [...this.secrets.values()].find((s) => s.integration_id === integrationId && s.secret_type === secretType && !s.revoked_at);
  }

  async updateSecret(secretId: string, patch: Partial<IntegrationSecret>): Promise<IntegrationSecret | undefined> {
    const s = this.secrets.get(secretId);
    if (!s) return undefined;
    const updated = { ...s, ...patch };
    this.secrets.set(secretId, updated);
    this.queueSave();
    return updated;
  }

  async putProviderKey(config: ProviderKeyConfig): Promise<ProviderKeyConfig> {
    // Upsert: one active config per (lobby, agent_ref, provider). Revoke any existing match first.
    const scope = config.agent_ref ?? null;
    for (const [id, k] of this.providerKeys) {
      if (k.lobby_id === config.lobby_id && (k.agent_ref ?? null) === scope && k.provider === config.provider && !k.revoked_at) {
        this.providerKeys.delete(id);
      }
    }
    this.providerKeys.set(config.id, config);
    this.queueSave();
    return config;
  }

  async getProviderKey(lobbyId: string, provider: string, agentRef?: string | null): Promise<ProviderKeyConfig | undefined> {
    const active = (k: ProviderKeyConfig) => k.lobby_id === lobbyId && k.provider === provider && !k.revoked_at;
    if (agentRef) {
      const override = [...this.providerKeys.values()].find((k) => active(k) && k.agent_ref === agentRef);
      if (override) return override;
    }
    return [...this.providerKeys.values()].find((k) => active(k) && (k.agent_ref === null || k.agent_ref === undefined));
  }

  async listProviderKeys(lobbyId: string): Promise<ProviderKeyConfig[]> {
    return [...this.providerKeys.values()].filter((k) => k.lobby_id === lobbyId && !k.revoked_at);
  }

  async revokeProviderKey(lobbyId: string, id: string): Promise<ProviderKeyConfig | undefined> {
    const k = this.providerKeys.get(id);
    if (!k || k.lobby_id !== lobbyId) return undefined;
    const updated = { ...k, revoked_at: new Date().toISOString() };
    this.providerKeys.set(id, updated);
    this.queueSave();
    return updated;
  }

  async linkExternalIdentity(link: ExternalIdentityLink): Promise<ExternalIdentityLink> {
    this.externalLinks.set(link.id, link);
    this.queueSave();
    return link;
  }

  async getExternalIdentityLink(provider: string, externalUserId: string): Promise<ExternalIdentityLink | undefined> {
    return [...this.externalLinks.values()].find((l) => l.provider === provider && l.external_user_id === externalUserId && !l.revoked_at);
  }

  async upsertKnowledgeBase(kb: KnowledgeBase): Promise<KnowledgeBase> {
    this.knowledgeBases.set(kb.lobby_id, kb);
    this.queueSave();
    return kb;
  }

  async getAgentNicknames(lobbyId: string): Promise<Record<string, string>> {
    return this.agentNicknames.get(lobbyId) ?? {};
  }

  async setAgentNickname(lobbyId: string, role: string, nickname: string): Promise<Record<string, string>> {
    const map = { ...(this.agentNicknames.get(lobbyId) ?? {}) };
    const clean = nickname.trim();
    if (clean) map[role] = clean.slice(0, 60); else delete map[role];
    this.agentNicknames.set(lobbyId, map);
    this.queueSave();
    return map;
  }

  async putHostedAgentSpec(spec: HostedAgentSpec): Promise<void> {
    this.hostedAgentSpecs.set(hostedAgentSpecKey(spec.lobby_id, spec.agent_role || spec.name), spec);
    this.queueSave();
  }

  async listHostedAgentSpecs(lobbyId: string): Promise<HostedAgentSpec[]> {
    return [...this.hostedAgentSpecs.values()].filter((s) => s.lobby_id === lobbyId);
  }

  async listAllHostedAgentSpecs(): Promise<HostedAgentSpec[]> {
    return [...this.hostedAgentSpecs.values()];
  }

  async removeHostedAgentSpec(lobbyId: string, roleOrName: string): Promise<void> {
    if (this.hostedAgentSpecs.delete(hostedAgentSpecKey(lobbyId, roleOrName))) this.queueSave();
  }

  async getLobbySession(lobbyId: string): Promise<LobbyWorkSession | undefined> {
    return this.lobbySessions.get(lobbyId);
  }

  async setLobbySession(lobbyId: string, session: LobbyWorkSession): Promise<void> {
    this.lobbySessions.set(lobbyId, session);
    this.queueSave();
  }

  async getKnowledgeBase(lobbyId: string): Promise<KnowledgeBase | undefined> {
    return this.knowledgeBases.get(lobbyId);
  }

  async upsertKnowledgeSyncJob(job: KnowledgeSyncJob): Promise<KnowledgeSyncJob> {
    this.syncJobs.set(job.id, job);
    this.queueSave();
    return job;
  }

  async getKnowledgeSyncJob(jobId: string): Promise<KnowledgeSyncJob | undefined> {
    return this.syncJobs.get(jobId);
  }

  async listKnowledgeSyncJobs(lobbyId: string): Promise<KnowledgeSyncJob[]> {
    return [...this.syncJobs.values()].filter((j) => j.lobby_id === lobbyId);
  }

  private walletChallenges = new Map<string, WalletChallenge>(); // challengeId -> challenge

  async saveWalletChallenge(challenge: WalletChallenge): Promise<void> {
    this.walletChallenges.set(challenge.id, challenge);
  }

  async consumeWalletChallenge(id: string): Promise<WalletChallenge | undefined> {
    const c = this.walletChallenges.get(id);
    this.walletChallenges.delete(id); // single-use: gone whether or not it verifies
    return c;
  }

  async saveNonce(identityRef: string, lobbyId: string, nonce: string, expiresAt: number): Promise<void> {
    this.nonces.set(identityRef, { nonce, lobbyId, expiresAt });
  }

  async getNonce(identityRef: string): Promise<{ nonce: string; lobbyId: string; expiresAt: number } | undefined> {
    return this.nonces.get(identityRef);
  }

  async deleteNonce(identityRef: string): Promise<void> {
    this.nonces.delete(identityRef);
  }

  // Task Marketplace implementation
  async createMarketplaceTask(task: MarketplaceTask): Promise<MarketplaceTask> {
    this.marketplaceTasks.set(task.id, task);
    this.queueSave();
    return task;
  }

  async getMarketplaceTask(lobbyId: string, taskId: string): Promise<MarketplaceTask | undefined> {
    const t = this.marketplaceTasks.get(taskId);
    if (!t || t.lobby_id !== lobbyId) return undefined;
    return t;
  }

  async listMarketplaceTasks(lobbyId: string): Promise<MarketplaceTask[]> {
    return [...this.marketplaceTasks.values()].filter((t) => t.lobby_id === lobbyId);
  }

  async updateMarketplaceTask(lobbyId: string, taskId: string, patch: Partial<MarketplaceTask>): Promise<MarketplaceTask | undefined> {
    const t = this.marketplaceTasks.get(taskId);
    if (!t || t.lobby_id !== lobbyId) return undefined;
    const updated = { ...t, ...patch, updated_at: new Date().toISOString() };
    this.marketplaceTasks.set(taskId, updated);
    this.queueSave();
    return updated;
  }

  async deleteMarketplaceTask(lobbyId: string, taskId: string): Promise<void> {
    this.marketplaceTasks.delete(taskId);
    this.queueSave();
  }

  async addTaskBid(bid: TaskBid): Promise<TaskBid> {
    const list = this.bids.get(bid.task_id) ?? [];
    list.push(bid);
    this.bids.set(bid.task_id, list);
    this.queueSave();
    return bid;
  }

  async listTaskBids(taskId: string): Promise<TaskBid[]> {
    return this.bids.get(taskId) ?? [];
  }

  async registerIssuer(issuer: ConcordiumIssuerRecord): Promise<ConcordiumIssuerRecord> {
    this.issuers.set(issuer.issuer_did, issuer);
    this.queueSave();
    return issuer;
  }

  async getIssuer(issuerDid: string): Promise<ConcordiumIssuerRecord | undefined> {
    return this.issuers.get(issuerDid);
  }

  async createLobbyRequest(request: LobbyRequest): Promise<LobbyRequest> {
    // Map requests to include lobby_id context when it is set by connection
    this.requests.set(request.request_id, request);
    this.queueSave();
    return request;
  }

  async getLobbyRequest(lobbyId: string, requestId: string): Promise<LobbyRequest | undefined> {
    const r = this.requests.get(requestId);
    // Since request might not explicitly set lobbyId in some messages, we fetch it by requestId
    return r;
  }

  async listLobbyRequests(lobbyId: string): Promise<LobbyRequest[]> {
    // In in-process memory, return requests corresponding to this lobby. If request has no lobby context, default it.
    return [...this.requests.values()].filter(r => !r.context?.lobby_id || r.context.lobby_id === lobbyId);
  }

  async updateLobbyRequest(lobbyId: string, requestId: string, patch: Partial<LobbyRequest>): Promise<LobbyRequest | undefined> {
    const r = this.requests.get(requestId);
    if (!r) return undefined;
    const updated = { ...r, ...patch, updated_at: new Date().toISOString() };
    this.requests.set(requestId, updated);
    this.queueSave();
    return updated;
  }
}
