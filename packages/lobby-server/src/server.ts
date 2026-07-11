#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * Independent Agent OS lobby server — a portable Node HTTP + WebSocket server that speaks the
 * exact protocol the Panel and relay already use (`/api/v1/agent-lobby/discover` +
 * `/ws/agent`), so they connect to it unmodified via Swarm Mode (`--lobby <url>`). It is a clean,
 * brand-neutral, clean-room reimplementation whose rules are enforced server-side by the
 * LobbyCoordinator. Pair it with a Redis-backed LobbyStore for the
 * remote swarm (apps/lobby-web); the default in-memory store fits local + the WS fallback.
 *
 *   npm run lobby                 # ws://localhost:4730
 *   npm run lobby -- --port 5000
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, join, extname, sep } from 'node:path';
import { existsSync, statSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { WebSocketServer, WebSocket } from 'ws';
import { loadEnv, type AgentToLobbyMessage, type LobbyToAgentMessage, type LobbySession, type LobbyMessage, type LobbyEventType } from '@agent-os/protocol-core';
import { InMemoryLobbyStore, type LobbyStore } from './store.js';
import { LobbyCoordinator, type Connection, type Outbound } from './coordinator.js';
import { HttpIndexerTransport, IdentityVerifier, makeVerifyIdentityFn } from '@agent-os/identity-concordium';
import { RegistryMcpClient, REGISTRY_TOOL_ALLOWLIST } from './registry-mcp.js';
import { RegistrySponsorClient, DEFAULT_SPONSOR_URL } from './registry-sponsor.js';
import { githubAppConfig, getInstallationToken, installUrl, listAppInstallations } from './integrations/github/appAuth.js';
import { listInstallationRepos, listTree, getFile, parseRepoRef } from './integrations/github/repoClient.js';
import { saveIntegrationSecret, getDecryptedSecret } from './integrations/githubApp.js';
import { generateNonceChallenge, verifyProofAndIssueToken, validateSessionToken, issueSessionToken, assertDevBridgeNotInProduction } from './auth/identityProof.js';
import { createWalletChallenge, verifyWalletChallenge } from './auth/wallet-signin.js';
import { GrpcAccountInfoSource, type AccountInfoSource } from './auth/concordium-verifier.js';
import { authorizeLobbyManager, isLobbyManager } from './auth/lobbyAuthz.js';
import { setProviderKey, listProviderKeys, revokeProviderKey, resolveProviderKey } from './providers/key-custody.js';
import { createApiRuntimeAdapter } from '@agent-os/adapters';
import { HostedAgentRunner } from './hosted/hosted-agent-runner.js';
import { BOSS_DELEGATION_GUIDE, BOSS_TRIAGE_GUIDE, BOSS_RECOMMEND_GUIDE, BOSS_DECIDABLE_CATEGORIES, parseBossDelegations, parseBossTriage, parseBossRecommendation, resolveRosterAgent } from './hosted/boss-delegation.js';
import { OBSERVATION_GUIDE, parseHandRaise } from './hosted/agent-observation.js';
import { collectAgentOsSeed, buildManifest, AGENT_OS_MANIFEST_PATH } from './hosted/repo-initializer.js';
import type { ProviderId } from '@agent-os/protocol-core';

const DEFAULT_PORT = 4730;
const WS_PATH = '/api/v1/agent-lobby/ws/agent';

function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  const match = url.match(/(?:github\.com[:\/])([^\/]+)\/([^\/\.]+)(?:\.git)?/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

/**
 * Owner/repo from an integration's repo_full_name, accepting BOTH stored forms: a github.com URL
 * (KB configs) and the bare "owner/repo" the GitHub App integration stores. Individual endpoints
 * previously called parseGithubUrl directly and failed with "invalid GitHub repository URL" on the
 * bare form — the DID bind, agent-definition loading, and scheduled setup all broke that way.
 */
/** Turn a raw GitHub error into an operator-friendly message; rate limits get a wait hint. */
function githubErrorMessage(err: unknown): string {
  const raw = String((err as Error)?.message ?? err);
  if (/rate limit exceeded/i.test(raw) || /\b403\b/.test(raw) && /rate limit/i.test(raw)) {
    return 'GitHub API rate limit reached for this installation. Wait a few minutes and retry — the panel now caches reads to avoid this.';
  }
  return raw;
}

function repoRef(fullName: string | undefined | null): { owner: string; repo: string } | null {
  if (!fullName) return null;
  const parsed = parseGithubUrl(fullName);
  if (parsed) return parsed;
  return /^[^/\s]+\/[^/\s]+$/.test(fullName)
    ? { owner: fullName.split('/')[0], repo: fullName.split('/')[1] }
    : null;
}

function parseAgentDef(fileName: string, content: string) {
  const titleMatch = content.match(/^Title:\s*(.+)$/m);
  const scopeMatch = content.match(/^Scope:\s*(.+)$/m);
  const slugMatch = content.match(/^Slug:\s*(.+)$/m);
  const runtimeMatch = content.match(/^Runtime:\s*(.+)$/m);
  const modelMatch = content.match(/^Model:\s*(.+)$/m);
  const identityMatch = content.match(/^Identity:\s*(.+)$/m);

  const promptLines = content.split('\n').filter(line => {
    const trimmed = line.trim();
    return !/^(Title|Scope|Slug|Runtime|Model|Identity):/i.test(trimmed);
  });
  const systemPrompt = promptLines.join('\n').trim();

  const slug = slugMatch?.[1]?.trim() ?? fileName.replace('.md', '');
  return {
    slug,
    name: titleMatch?.[1]?.trim() ?? fileName.replace('.md', ''),
    scope: scopeMatch?.[1]?.trim() ?? '',
    file: fileName,
    runtime: runtimeMatch?.[1]?.trim() || 'api',
    model: modelMatch?.[1]?.trim(),
    identity: identityMatch?.[1]?.trim(),
    system_prompt: systemPrompt
  };
}

/**
 * A FRESH GitHub installation token for a lobby's connected integration. Always mint via the App
 * JWT (getInstallationToken caches and auto-renews) — do NOT read the `installation_token` secret
 * stored at connect time: GitHub installation tokens expire after ~1h, so every consumer of the
 * stored copy silently broke an hour after connecting (identity bind, KB sync, agent definitions,
 * hosted-agent repo tools) while the Lobby tab — which already minted fresh — kept showing
 * "connected". One token path, no drift.
 */
async function githubTokenForLobby(lobbyId: string, store: LobbyStore): Promise<string | null> {
  const integration = await store.getIntegration(lobbyId, 'github');
  if (!integration || integration.status !== 'active' || !integration.installation_id) return null;
  try { return await getInstallationToken(integration.installation_id); } catch { return null; }
}

// The built-in catalog is read from local disk ONCE per process — it never changes at runtime.
let builtinCatalogCache: any[] | null = null;
function builtinAgentCatalog(): any[] {
  if (builtinCatalogCache) return builtinCatalogCache;
  const defs: any[] = [];
  try {
    const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../../../');
    const localAgentsDir = join(REPO_ROOT, 'agent-os/sub-agents/agents');
    if (existsSync(localAgentsDir)) {
      for (const file of readdirSync(localAgentsDir).filter(f => f.endsWith('.md'))) {
        try { defs.push(parseAgentDef(file, readFileSync(join(localAgentsDir, file), 'utf-8'))); } catch {}
      }
    }
  } catch (err) {
    console.warn('[Lobby Server] Failed to read built-in agent catalog:', err);
  }
  builtinCatalogCache = defs;
  return defs;
}

// Per-lobby merged-definition cache. getAgentDefinitions previously read ~60 repo files on EVERY
// call, and it is hit on every panel poll (/api/agents, /api/presets, gantt, spawn) — which
// exhausted the GitHub App installation's API rate limit and left the panel blank for minutes.
// Cache the merged result and serve it stale on error, so a repo read happens at most once per TTL.
const agentDefsCache = new Map<string, { defs: any[]; at: number }>();
const AGENT_DEFS_TTL_MS = 5 * 60_000;
function invalidateAgentDefs(lobbyId: string) { agentDefsCache.delete(lobbyId); }

/**
 * Agent definitions for a lobby: the built-in catalog MERGED with any definitions in the connected
 * GitHub repo (repo wins per slug). Cached per lobby; on a GitHub error (rate limit, transient) the
 * last good result — or the built-in catalog — is returned rather than failing.
 */
async function getAgentDefinitions(lobbyId: string, store: LobbyStore, force = false): Promise<any[]> {
  const cached = agentDefsCache.get(lobbyId);
  if (!force && cached && Date.now() - cached.at < AGENT_DEFS_TTL_MS) return cached.defs;

  const bySlug = new Map<string, any>();
  for (const def of builtinAgentCatalog()) bySlug.set(def.slug, def);

  const integration = await store.getIntegration(lobbyId, 'github');
  if (integration && integration.repo_full_name) {
    const token = await githubTokenForLobby(lobbyId, store);
    const parsed = token ? repoRef(integration.repo_full_name) : null;
    if (parsed) {
      try {
        const { GitHubRepoClient } = await import('./hosted/github-repo-client.js');
        const client = new GitHubRepoClient(parsed.owner, parsed.repo, token!);
        const branchName = integration.branch || 'main';
        const files = await client.readDir('agent-os/sub-agents/agents', branchName);
        const mdFiles = files.filter((f: any) => f.name.endsWith('.md') && f.type === 'file');
        for (const file of mdFiles) {
          try {
            const def = parseAgentDef(file.name, await client.readFile(file.path, branchName));
            bySlug.set(def.slug, def);
          } catch {}
        }
      } catch (err) {
        // Rate-limited or transient — keep whatever we have. If we had a prior good cache, prefer it.
        console.warn('[Lobby Server] Failed to read agents from GitHub (serving cached/catalog):', (err as Error)?.message ?? err);
        if (cached) return cached.defs;
      }
    }
  }

  const defs = [...bySlug.values()];
  agentDefsCache.set(lobbyId, { defs, at: Date.now() });
  return defs;
}

export interface LobbyServerOptions {
  port?: number;
  store?: LobbyStore;
  coordinator?: LobbyCoordinator;
  /** Auto-create a default public lobby so `discover` always returns one (Local/Swarm convenience). */
  autoDefaultLobby?: boolean;
  /** Injected fetch for hosted API-runtime agents (tests mock the provider HTTP). Defaults to global fetch. */
  apiRuntimeFetch?: typeof fetch;
  /** On-chain account-info source for wallet sign-in (tests inject a mock; prod uses gRPC). */
  accountInfoSource?: AccountInfoSource;
}

export interface RunningLobbyServer {
  port: number;
  store: LobbyStore;
  httpServer: Server;
  close(): Promise<void>;
}

export async function startLobbyServer(options: LobbyServerOptions = {}): Promise<RunningLobbyServer> {
  // Fail-closed: refuse to boot if the dev wallet-signature bridge is enabled in production.
  assertDevBridgeNotInProduction();
  const store = options.store ?? new InMemoryLobbyStore();
  // On-chain account-info source for production wallet sign-in (gRPC unless a mock is injected).
  const accountInfoSource: AccountInfoSource = options.accountInfoSource ?? new GrpcAccountInfoSource();
  // Phase 8: wire a read-only identity verifier only when an indexer URL is configured. Without it
  // the coordinator's fail-closed default applies (a verified-identity policy denies everyone),
  // and the server still boots with no network dependency.
  const indexerUrl = process.env.AGENT_OS_CONCORDIUM_INDEXER_URL;
  const verifyIdentity = indexerUrl
    ? makeVerifyIdentityFn(new IdentityVerifier({ transport: new HttpIndexerTransport({ baseUrl: indexerUrl }) }))
    : undefined;
  // Auto-failover: opt-in appointment of a successor Boss on Boss loss (unattended swarms).
  const autoFailover = (process.env.AGENT_OS_LOBBY_AUTO_FAILOVER ?? '').toLowerCase() === 'true';
  const coordinator = options.coordinator ?? new LobbyCoordinator(store, { verifyIdentity, autoFailover });
  const autoDefault = options.autoDefaultLobby ?? true;

  // Stale-heartbeat reaping: agents that stop heartbeating (freeze, SIGKILL, network partition)
  // are removed after AGENT_OS_LOBBY_STALE_MS, freeing floor control if the Boss was the one lost.
  const STALE_MS = Number(process.env.AGENT_OS_LOBBY_STALE_MS) || 90_000;
  const SWEEP_MS = Number(process.env.AGENT_OS_LOBBY_SWEEP_MS) || 30_000;

  // Concordium Agent Registry MCP service (on-chain anchoring). When unset, agents stay
  // off-chain (wallet-signed + lobby-hosted cards) and the dashboard says so honestly.
  // Point at a hosted instance or a local `concordium/agent-registry-mcp` container's /mcp URL.
  const registryMcpUrl = process.env.AGENT_OS_AGENT_REGISTRY_MCP_URL;
  const registryMcp = registryMcpUrl ? new RegistryMcpClient(registryMcpUrl) : undefined;

  // Concordium sponsor service — makes Agent-ID minting gasless (Concordium pays the energy).
  // Defaults to the Concordium-hosted endpoint; only enabled alongside the registry MCP service
  // (there is nothing to sponsor without on-chain anchoring). Relays unsigned payloads only — no
  // keys pass through here. Set AGENT_OS_REGISTRY_SPONSOR_URL='' to force the self-paid path.
  const sponsorUrlRaw = process.env.AGENT_OS_REGISTRY_SPONSOR_URL;
  const sponsorUrl = sponsorUrlRaw === undefined ? DEFAULT_SPONSOR_URL : sponsorUrlRaw.trim();
  const registrySponsor = registryMcp && sponsorUrl ? new RegistrySponsorClient(sponsorUrl) : undefined;

  // Persistent agent card storage — cards survive server restarts
  const CARDS_FILE = resolve(fileURLToPath(import.meta.url), '..', '..', 'agent-cards.json');
  const agentCards = new Map<string, unknown>();
  try {
    if (existsSync(CARDS_FILE)) {
      const raw = readFileSync(CARDS_FILE, 'utf-8');
      const entries = JSON.parse(raw);
      for (const [k, v] of Object.entries(entries)) agentCards.set(k, v);
      console.log(`[lobby-server] Loaded ${agentCards.size} agent cards from disk`);
    }
  } catch (e) { console.warn('[lobby-server] Could not load agent cards file:', e); }

  function persistCards() {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of agentCards) obj[k] = v;
    try {
      writeFileSync(CARDS_FILE, JSON.stringify(obj, null, 2), 'utf-8');
      console.log(`[lobby-server] Persisted ${agentCards.size} agent cards to disk`);
    } catch (e) { console.warn('[lobby-server] Could not persist agent cards:', e); }
  }

  // Socket bookkeeping for fan-out.
  const sockets = new Map<string, WebSocket>(); // connId → socket
  const lobbyConns = new Map<string, Set<string>>(); // lobbyId → connIds
  const agentConn = new Map<string, string>(); // agentId → connId

  let defaultLobbyId: string | undefined;

  async function ensureDefaultLobby(): Promise<LobbySession> {
    const existing = (await store.listLobbies()).find((l) => l.status === 'active');
    if (existing) return existing;
    const now = new Date().toISOString();
    const lobby: LobbySession = {
      lobby_id: randomUUID(),
      org_id: 'default',
      name: 'Agent OS Lobby',
      status: 'active',
      visibility: 'public',
      connected_agent_ids: [],
      message_seq: 0,
      created_at: now,
      updated_at: now,
      created_by: 'system',
    };
    await store.createLobby(lobby);
    defaultLobbyId = lobby.lobby_id;
    return lobby;
  }

  function send(connId: string | undefined, message: LobbyToAgentMessage): void {
    if (!connId) return;
    const sock = sockets.get(connId);
    if (sock && sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify(message));
  }

  function dispatch(conn: Connection, out: Outbound[]): void {
    for (const o of out) {
      if (o.target.kind === 'self') send(conn.connId, o.message);
      else if (o.target.kind === 'agent') send(agentConn.get(o.target.agentId), o.message);
      else for (const cid of lobbyConns.get(conn.lobbyId) ?? []) send(cid, o.message); // lobby-scoped
    }
  }

  // ── Hosted (server-side) agents — run on the lobby host via the API runtime, no relay/CLI ──
  const hostedAgents = new Map<string, { runner: HostedAgentRunner; connId: string; conn: Connection; heartbeatInterval?: NodeJS.Timeout; repoClient?: any; workingBranch?: string }>();
  // Per-agent throttle for broadcast observation (see observeBroadcast) — bounds LLM cost so a
  // stream of broadcasts can't trigger an evaluation turn on every message for every hosted agent.
  const lastObservation = new Map<string, number>();
  const OBSERVE_COOLDOWN_MS = Number(process.env.AGENT_OS_OBSERVE_COOLDOWN_MS) || 20_000;
  // Per-lobby throttle for GitHub-installation auto-detect (see autoAdoptGithubInstallation) so a
  // disconnected status poll can't hammer the GitHub App rate limit.
  const lastGithubAutoDetect = new Map<string, number>();
  const GITHUB_AUTODETECT_THROTTLE_MS = 15_000;
  // Boss task dispatches allowed on AGENT-originated turns between human messages. Human turns
  // reset the budget; without a cap, a Boss reacting to task-completion handoffs could re-assign
  // tasks in a self-sustaining loop with no human in it.
  const bossAutoTaskBudget = new Map<string, number>();
  const BOSS_AUTO_TASK_BUDGET = 3;
  // Cached "is the Agent OS structure initialized in the connected repo?" per lobby — the GitHub
  // status endpoint is polled every ~10s and the answer costs an API read of the manifest file.
  const repoInitializedCache = new Map<string, { value: boolean; at: number }>();
  const REPO_INIT_CACHE_MS = 60_000;

  /** Whether the connected repo carries the Agent OS manifest (cached; see repoInitializedCache). */
  async function isRepoInitialized(lobbyId: string, repoFullName: string | undefined, branch: string | undefined): Promise<boolean> {
    if (!repoFullName) return false;
    const cached = repoInitializedCache.get(lobbyId);
    if (cached && Date.now() - cached.at < REPO_INIT_CACHE_MS) return cached.value;
    let value = false;
    try {
      const token = await githubTokenForLobby(lobbyId, store);
      const parsed = token ? repoRef(repoFullName) : null;
      if (token && parsed) {
        const { GitHubRepoClient } = await import('./hosted/github-repo-client.js');
        const client = new GitHubRepoClient(parsed.owner, parsed.repo, token);
        await client.readFile(AGENT_OS_MANIFEST_PATH, branch || 'main');
        value = true;
      }
    } catch { value = false; }
    repoInitializedCache.set(lobbyId, { value, at: Date.now() });
    return value;
  }

  const providerIdFor = (name: string): ProviderId => {
    const n = (name || '').toLowerCase();
    return n.includes('openai') || n === 'gpt' ? 'openai-compatible' : 'anthropic-compatible';
  };

  // The coordinator delivers a lobby message to a hosted agent through its virtual socket; here we
  // run one API-runtime turn and post the reply back through the coordinator (broadcast if Boss,
  // else a direct reply to the sender). Self-echoes and unrelated messages are ignored to prevent
  // cascades. Also handles boss-appointed notifications so the agent becomes aware of its role.
  async function onHostedInbound(conn: Connection, data: string): Promise<void> {
    let msg: { type?: string; message?: Record<string, unknown>; agent_id?: string };
    try { msg = JSON.parse(data); } catch { return; }
    const myId = conn.agentId;
    if (!myId) return;

    // Handle boss appointment notification — inject awareness into the runner's context
    if (msg?.type === 'lobby-boss-appointed' && msg.agent_id === myId) {
      const entry = hostedAgents.get(myId);
      if (entry) {
        try {
          await entry.runner.respondTo(`[SYSTEM] You have been appointed as the Boss Agent. You now have floor control and can broadcast messages to all agents. Coordinate work, manage handoffs, facilitate the lobby, and triage the Requests queue.\n${BOSS_DELEGATION_GUIDE}`);
        } catch { /* ignore errors from system injection */ }
        // Backlog sweep: triage pending requests left over from before this Boss existed (bounded —
        // a large stale queue must not turn the appointment into a long LLM loop).
        try {
          const pending = (await store.listLobbyRequests(conn.lobbyId)).filter(r => r.status === 'pending').slice(0, 5);
          for (const r of pending) await bossTriageRequest(conn, myId, r);
        } catch { /* sweep is best-effort */ }
      }
      return;
    }

    // A new request in the lobby — the Boss triages it (decides hand-raises, recommends on
    // authority categories). Fire-and-forget so the creating flow isn't blocked.
    if (msg?.type === 'lobby-request-created') {
      const request = (msg as unknown as { request?: Record<string, any> }).request;
      if (!request) return;
      const lobbyForReq = await store.getLobby(conn.lobbyId);
      if (lobbyForReq?.boss_agent_id === myId) {
        void bossTriageRequest(conn, myId, request as any).catch(() => {});
      }
      return;
    }

    // A task assigned to this hosted agent — this is where assigned work actually gets DONE.
    // Without this handler, lobby-task-assigned was silently ignored and a Boss- or panel-created
    // task sat in "assigned" forever. Flow: mark in_progress → run one adapter turn on the task
    // (the runner has repo tools when a GitHub repo is connected) → mark completed/failed with the
    // result → report to the assigner (falling back to the Boss, then the lobby log).
    if (msg?.type === 'lobby-task-assigned') {
      const task = (msg as unknown as { task?: { task_id?: string; title?: string; description?: string; assigned_to?: string; assigned_by?: string } }).task;
      if (!task?.task_id || task.assigned_to !== myId) return;
      const entry = hostedAgents.get(myId);
      if (!entry) return;
      const upd = async (status: string, result?: string) => {
        const r = await coordinator.handle(conn, {
          type: 'lobby-task-update', task_id: task.task_id, status, ...(result ? { result } : {}),
        } as AgentToLobbyMessage);
        dispatch(conn, r.out);
      };
      await upd('in_progress').catch(() => {});
      // Wait (bounded) for any in-flight chat turn to finish — respondTo drops overlapping calls,
      // and a dropped task turn would spuriously fail the task.
      for (let i = 0; i < 60 && entry.runner.busy; i++) await new Promise(r => setTimeout(r, 1000));

      // ── Branch/PR workflow ── In PR mode (default), the agent's writes for THIS task go to a
      // dedicated branch off the working branch, and on completion we open a PR for the LobbyOwner
      // to review — so agent changes are reviewable diffs, never silent commits to main. Direct
      // mode (AGENT_OS_AGENT_WRITES=direct) keeps writing straight to the working branch.
      const workingBranch = entry.workingBranch || 'main';
      const prMode = AGENT_WRITES_MODE === 'pr' && !!entry.repoClient;
      const taskBranch = prMode
        ? `agent-os/task/${String(task.task_id).slice(0, 8)}-${(task.title ?? 'work').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32)}`
        : workingBranch;
      let writeGuidance = 'writes commit directly to the working branch';
      if (prMode) {
        try {
          await entry.repoClient.createBranch(taskBranch, workingBranch);
          entry.repoClient.activeBranch = taskBranch; // redirect this task's writes
          writeGuidance = `write_file commits go to the task branch "${taskBranch}" and are opened as a Pull Request for human review when you finish — you cannot merge`;
        } catch (e) {
          console.warn('[Lobby Server] Failed to create task branch, falling back to direct writes:', (e as Error)?.message ?? e);
        }
      }

      let result = '';
      try {
        result = await entry.runner.respondTo(
          `[TASK ASSIGNED] ${task.title ?? ''}\n${task.description ?? ''}\n\nDo this work NOW using your repository tools (read_file/write_file/list_files) — ${writeGuidance}. Do NOT call create_pr yourself; the lobby opens the PR for you. Reply with a concise, HONEST report naming exactly the files you read/wrote. If the task needs capabilities you don't have (running commands, builds, tests), say so plainly as the blocker — do NOT fabricate work you did not do.`,
        );
      } catch { /* fall through to failed */ }
      const failed = !result || result.startsWith('⚠');

      // Open a PR if the agent actually committed to the task branch; clean up empty branches.
      let prUrl = '';
      if (prMode && entry.repoClient && taskBranch !== workingBranch) {
        try {
          const ahead = await entry.repoClient.aheadBy(workingBranch, taskBranch);
          if (ahead > 0) {
            prUrl = await entry.repoClient.createPullRequest(
              `[agent] ${task.title ?? task.task_id}`.slice(0, 120),
              taskBranch, workingBranch,
              `Automated changes for lobby task **${task.title ?? task.task_id}** by ${(await store.getAgent(conn.lobbyId, myId))?.display_name || myId}.\n\n${(result || '').slice(0, 3000)}\n\n_Review and merge — the agent cannot merge._`,
            );
          } else {
            await entry.repoClient.deleteBranch(taskBranch); // agent wrote nothing
          }
        } catch (e) {
          console.warn('[Lobby Server] PR creation failed:', (e as Error)?.message ?? e);
        } finally {
          entry.repoClient.activeBranch = workingBranch; // always restore
        }
      }

      const resultWithPr = prUrl ? `${result}\n\n🔀 Pull Request opened for review: ${prUrl}` : result;
      // Persist the PR URL on the task so the panel can link it.
      const storedTask = await store.getTask(conn.lobbyId, task.task_id).catch(() => null);
      if (storedTask && prUrl) await store.upsertTask({ ...storedTask, result_pr_url: prUrl } as any).catch(() => {});
      await upd(failed ? 'failed' : 'completed', resultWithPr || 'no result produced').catch(() => {});

      // Report back to whoever assigned it; an unconnected assigner (e.g. WebUser) still sees the
      // reply in message history, and the Boss is CC'd so coordination continues.
      const lobbyNow = await store.getLobby(conn.lobbyId);
      const recipients = new Set<string>();
      if (task.assigned_by) recipients.add(task.assigned_by);
      if (lobbyNow?.boss_agent_id && lobbyNow.boss_agent_id !== myId) recipients.add(lobbyNow.boss_agent_id);
      for (const to of recipients) {
        const r = await coordinator.handle(conn, {
          type: 'lobby-message', to_agent_id: to, message_type: 'handoff',
          content: `[TASK ${failed ? 'FAILED' : 'COMPLETED'}: ${task.title ?? task.task_id}]${prUrl ? ` (PR: ${prUrl})` : ''} ${(result || '').slice(0, 2000)}`,
        } as AgentToLobbyMessage);
        dispatch(conn, r.out);
      }
      return;
    }

    if (msg?.type !== 'lobby-message-received' || !msg.message) return;
    const m = msg.message as { from_agent_id?: string; to_agent_id?: string; content?: string };
    if (m.from_agent_id === myId) return;
    const entry = hostedAgents.get(myId);
    if (!entry) return;
    const lobby = await store.getLobby(conn.lobbyId);
    const isBoss = lobby?.boss_agent_id === myId;
    const isBroadcast = ['all', '*', 'broadcast'].includes(String(m.to_agent_id ?? '').toLowerCase());
    const addressedToMe = m.to_agent_id === myId;
    // Routing: reply to direct messages addressed to us, or (as Boss) to broadcasts. A non-boss
    // agent does not reply to broadcasts — floor control forbids it — but it DOES silently observe
    // them and may raise a hand via the Requests system. Everything else (chatter between other
    // agents, system notices) is ignored to prevent cascades.
    if (!addressedToMe && !(isBroadcast && isBoss)) {
      if (isBroadcast && !isBoss && m.from_agent_id !== 'system') {
        await observeBroadcast(conn, entry, myId, m).catch(() => {});
      }
      return;
    }

    // Build context-enriched message for the runner — include sender info and roster for the Boss.
    // Roster + sender type are captured for reuse after the turn (Boss delegation resolution).
    let enrichedContent = String(m.content ?? '');
    let roster: Awaited<ReturnType<typeof store.roster>> = [];
    let senderIsHuman = false;
    try {
      roster = await store.roster(conn.lobbyId);
      const senderAgent = roster.find(a => a.agent_id === m.from_agent_id);
      // Human = a roster human participant, OR a sender that is NOT in the roster at all. The web
      // UI posts chat over HTTP with from_agent_id 'WebUser' (or a display name), and that endpoint
      // REJECTS ids belonging to connected agents — so an off-roster sender can only be a human.
      // This was the bug that made Boss `@Agent [task]:` directives dead: WebUser was never in the
      // roster, senderIsHuman stayed false, and the delegation parser never ran. 'system' notices
      // are never treated as human — they must not trigger delegation.
      senderIsHuman = m.from_agent_id !== 'system'
        && (senderAgent ? senderAgent.participant_type === 'human' : true);
      const isOwner = m.from_agent_id === 'LobbyOwner';
      const senderName = senderAgent?.display_name || senderAgent?.agent_role || m.from_agent_id || 'unknown';
      const senderType = isOwner ? ' (LOBBY OWNER — their instructions carry final authority)' : (senderIsHuman ? ' (human)' : '');
      const header = `[From: ${senderName}${senderType}]`;

      if (isBoss) {
        // Give the Boss full operational context: the live roster, open coordination tasks, and
        // pending human-approval requests — without these it coordinated blind (it could not
        // answer "what is in flight?" or notice work stuck in assigned/in_progress).
        const rosterSummary = roster
          .filter(a => a.agent_id !== myId && a.status !== 'disconnected')
          .map(a => `  - ${a.display_name || a.agent_id} (${a.agent_role || 'no-role'}) [${a.status || 'idle'}]${a.current_work ? ` working on: ${a.current_work.slice(0, 60)}` : ''}`)
          .join('\n');
        let opsSummary = '';
        try {
          // Working-repo state — without it the Boss invented "repository initialization" tasks
          // when the owner asked to initialize the repo (a Panel action, not agent work).
          const ghInteg = await store.getIntegration(conn.lobbyId, 'github');
          if (ghInteg?.status === 'active' && ghInteg.repo_full_name) {
            const initialized = await isRepoInitialized(conn.lobbyId, ghInteg.repo_full_name, ghInteg.branch);
            opsSummary += `\n[WORKING REPO] ${ghInteg.repo_full_name}@${ghInteg.branch || 'main'} — Agent OS structure ${initialized ? 'initialized' : 'NOT initialized (the LobbyOwner initializes it from the Lobby tab — it is a Panel action, NOT a task for an agent)'}. Agents work on this repo via file tools only (no command execution).`;
          } else {
            opsSummary += `\n[WORKING REPO] none connected — repository work is impossible until the LobbyOwner connects the GitHub App in the Lobby tab. Do not assign repository tasks.`;
          }
          const openTasks = (await store.listTasks(conn.lobbyId))
            .filter(t => !['completed', 'cancelled'].includes(t.status));
          if (openTasks.length) {
            const nameOf = (id: string) => roster.find(a => a.agent_id === id)?.display_name || id;
            opsSummary += `\n[OPEN TASKS — ${openTasks.length}]\n` + openTasks.slice(-10)
              .map(t => `  - "${t.title}" → ${nameOf(t.assigned_to)} [${t.status}]${t.progress ? ` — ${String(t.progress).slice(0, 50)}` : ''}`)
              .join('\n');
          }
          const pendingReqs = (await store.listLobbyRequests(conn.lobbyId)).filter(r => r.status === 'pending');
          if (pendingReqs.length) {
            opsSummary += `\n[PENDING HUMAN-APPROVAL REQUESTS — ${pendingReqs.length}]\n` + pendingReqs.slice(-5)
              .map(r => `  - ${r.agent_display_name}: ${r.title}`)
              .join('\n');
          }
        } catch { /* ops summary is best-effort */ }
        enrichedContent = `${header}\n[ROSTER — ${roster.filter(a => a.status !== 'disconnected').length} agents online]\n${rosterSummary}${opsSummary}\n\n${BOSS_DELEGATION_GUIDE}\n\n${enrichedContent}`;
      } else {
        enrichedContent = `${header} ${enrichedContent}`;
      }
    } catch { /* roster fetch failed, pass raw content */ }

    let reply = '';
    try { reply = await entry.runner.respondTo(enrichedContent); } catch { return; }
    if (!reply) return;

    // Boss delegation: the Boss emits directive lines. A plain `@Name: msg` is a direct request/
    // coordination message (no task); an explicit `@Name [task]: title` creates a tracked Task.
    // Both reach the agent directly — a broadcast would be ignored by sub-agents (they only act on
    // messages addressed to them). Cascade guard: plain coordination messages dispatch only on
    // human-originated turns (agent↔boss message ping-pong must not fan out), but `[task]`
    // directives ALSO dispatch on agent-originated turns — the Boss legitimately assigns a task
    // after an agent ACKs or reports a result, and tasks are bounded, tracked, and visible rather
    // than loop-prone chatter. Each target is acted on at most once per turn.
    if (isBoss && roster.length) {
      if (senderIsHuman) bossAutoTaskBudget.set(myId, BOSS_AUTO_TASK_BUDGET); // human turn resets the loop budget
      const directives = parseBossDelegations(reply);
      const dispatched = new Set<string>();
      for (const d of directives) {
        // Plain coordination directives dispatch on human-originated turns AND on 'system' turns
        // (request decisions, appointments — bounded, human-triggered events): observed live, the
        // Boss reacting to an approved hand-raise addressed the requester and the directive was
        // silently dropped. Agent-originated turns still only dispatch [task] (budgeted below).
        if (!senderIsHuman && m.from_agent_id !== 'system' && d.kind !== 'task') continue;
        const target = resolveRosterAgent(roster, d.target, myId);
        if (!target || dispatched.has(target.agent_id)) continue;
        if (!senderIsHuman) {
          const budget = bossAutoTaskBudget.get(myId) ?? BOSS_AUTO_TASK_BUDGET;
          if (budget <= 0) continue; // out of unattended budget — wait for the next human turn
          bossAutoTaskBudget.set(myId, budget - 1);
        }
        dispatched.add(target.agent_id);
        if (d.kind === 'task') {
          // A tracked unit of work — creates a Task card (task_created event) and notifies the agent.
          const title = d.instruction.length > 90 ? d.instruction.slice(0, 87) + '…' : d.instruction;
          const taskRes = await coordinator.handle(conn, {
            type: 'lobby-task-create',
            assigned_to: target.agent_id,
            title,
            description: d.instruction,
          } as AgentToLobbyMessage);
          dispatch(conn, taskRes.out);
        } else {
          // Just the Boss talking to a sub-agent (asking for input / coordinating) — no task.
          const msgRes = await coordinator.handle(conn, {
            type: 'lobby-message',
            to_agent_id: target.agent_id,
            message_type: 'coordination',
            content: d.instruction,
          } as AgentToLobbyMessage);
          dispatch(conn, msgRes.out);
        }
      }
    }

    // Boss broadcasts its prose reply; non-boss agents MUST reply directly to the sender (floor
    // control rejects non-boss broadcasts, causing "message_rejected: non-boss broadcast").
    // A reply to a 'system' notice (e.g. "your hand-raise was approved — go ahead") is routed to
    // the Boss: 'system' is not a connected agent, so replying to it would silently go nowhere,
    // and the Boss is who coordinates the follow-up.
    let replyTo = isBoss ? 'all' : (m.from_agent_id ?? 'all');
    if (!isBoss && m.from_agent_id === 'system') {
      if (!lobby?.boss_agent_id) return; // no boss to receive it — drop rather than dead-letter
      replyTo = lobby.boss_agent_id;
    }
    const res = await coordinator.handle(conn, {
      type: 'lobby-message',
      to_agent_id: replyTo,
      message_type: 'chat',
      content: reply.length > 4000 ? reply.slice(0, 4000) + '\n\n_(truncated)_' : reply,
    } as AgentToLobbyMessage);
    dispatch(conn, res.out);
  }

  // A non-boss hosted agent observing a broadcast. It runs one evaluation turn and, only if it
  // decides it has a genuinely valuable contribution, raises a hand via the Requests system (a
  // `lobby-request` of category `hand_raise` that surfaces in the Requests tab). A per-agent cooldown
  // bounds cost and prevents an agent from flooding the queue; the runner's in-flight guard prevents
  // overlapping turns. Never posts a chat reply — floor control forbids a non-boss broadcast.
  async function observeBroadcast(
    conn: Connection,
    entry: { runner: HostedAgentRunner },
    myId: string,
    m: { from_agent_id?: string; content?: string },
  ): Promise<void> {
    const now = Date.now();
    const last = lastObservation.get(myId) ?? 0;
    if (now - last < OBSERVE_COOLDOWN_MS) return;
    lastObservation.set(myId, now);

    const content = String(m.content ?? '').trim();
    if (!content) return;
    // One pending hand per agent — 11 near-duplicate "ensure X" requests piled up in one live
    // session because every boss broadcast triggered another observation turn. An unaddressed hand
    // already says "this agent wants attention"; more are queue noise (LOBBY-PROTOCOL Rule 3:
    // max one hand-raise per agent per topic).
    try {
      const pendingMine = (await store.listLobbyRequests(conn.lobbyId))
        .some(r => r.status === 'pending' && r.agent_id === myId);
      if (pendingMine) return;
    } catch { /* best-effort — proceed */ }
    const prompt = `${OBSERVATION_GUIDE}\n\n[LOBBY BROADCAST] ${content}`;
    let verdict = '';
    try { verdict = await entry.runner.respondTo(prompt); } catch { return; }
    const intent = parseHandRaise(verdict);
    if (!intent) return; // agent passed — nothing valuable to add

    const reqRes = await coordinator.handle(conn, {
      type: 'lobby-request',
      category: 'hand_raise',
      title: `HAND: ${intent.reason.length > 80 ? intent.reason.slice(0, 77) + '…' : intent.reason}`,
      description: intent.reason,
      context: { hand_category: intent.category, observed_from: m.from_agent_id ?? 'lobby' },
    } as AgentToLobbyMessage);
    dispatch(conn, reqRes.out);
  }

  /**
   * Apply a decision to a lobby request and propagate it everywhere it matters: the store, the
   * Requests-tab WS event, a system broadcast into the chat (the Boss runs a turn on it), and the
   * "go ahead" direct message to the requester (whose reply routes to the Boss). Shared by the
   * HTTP decide endpoint (human) and Boss triage. Returns 'not-found' | undefined | the request.
   */
  async function applyRequestDecision(lobbyId: string, requestId: string, decision: string, decidedBy: string, decisionNotes: string) {
    const request = await store.getLobbyRequest(lobbyId, requestId);
    if (!request) return 'not-found' as const;
    const updated = await store.updateLobbyRequest(lobbyId, requestId, {
      status: decision as any,
      decided_by: decidedBy,
      decision_notes: decisionNotes,
      decided_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (!updated) return undefined;

    const out: LobbyToAgentMessage = { type: 'lobby-request-decided', request: updated };
    for (const cid of lobbyConns.get(lobbyId) ?? []) send(cid, out);

    const notes = updated.decision_notes ? ` — ${updated.decision_notes}` : '';
    const by = decidedBy && decidedBy !== 'panel' ? ` by ${decidedBy}` : '';
    const announce = async (to: string, content: string) => {
      const seq = await store.nextSeq(lobbyId);
      const message: LobbyMessage = {
        message_id: randomUUID(), seq, from_agent_id: 'system', to_agent_id: to,
        message_type: 'system', content, created_at: new Date().toISOString(), delivered: false,
      };
      await store.appendMessage(lobbyId, message);
      const wsOut: LobbyToAgentMessage = { type: 'lobby-message-received', message };
      for (const cid of lobbyConns.get(lobbyId) ?? []) send(cid, wsOut);
    };
    await announce('all', `📋 Request "${updated.title}" from ${updated.agent_display_name} was ${updated.status}${by}${notes}`);
    if (updated.agent_id && updated.agent_id !== 'anonymous') {
      await announce(updated.agent_id, updated.status === 'approved'
        ? `Your request "${updated.title}" was APPROVED${by}${notes}. Go ahead — share your contribution or proceed with what you proposed. Your reply will be routed to the Boss.`
        : `Your request "${updated.title}" was ${String(updated.status).toUpperCase()}${by}${notes}.`);
    }
    return updated;
  }

  // Boss request triage (opt-out: AGENT_OS_BOSS_TRIAGE=off). The Boss DECIDES hand-raises itself
  // (floor-control coordination) and only RECOMMENDS on authority categories — those stay pending
  // for the LobbyOwner with the recommendation attached (boss-agent.md: "no autonomous approvals").
  const BOSS_TRIAGE_ENABLED = (process.env.AGENT_OS_BOSS_TRIAGE ?? 'on') !== 'off';
  // How hosted agents land task changes: 'pr' (default) = per-task branch + Pull Request for human
  // review; 'direct' = commit straight to the working branch (the pre-PR-workflow behavior).
  const AGENT_WRITES_MODE = (process.env.AGENT_OS_AGENT_WRITES ?? 'pr').toLowerCase() === 'direct' ? 'direct' : 'pr';

  async function bossTriageRequest(conn: Connection, bossId: string, request: { request_id?: string; category?: string; title?: string; description?: string; agent_display_name?: string; agent_id?: string; status?: string }): Promise<void> {
    if (!BOSS_TRIAGE_ENABLED || !request?.request_id || request.status !== 'pending') return;
    if (request.agent_id === bossId) return; // never triage your own request
    const entry = hostedAgents.get(bossId);
    if (!entry) return;
    // Wait briefly for any in-flight turn; if still busy, leave it pending for the human.
    for (let i = 0; i < 15 && entry.runner.busy; i++) await new Promise(r => setTimeout(r, 1000));
    if (entry.runner.busy) return;

    const bossName = (await store.getAgent(conn.lobbyId, bossId))?.display_name || 'Boss';
    const summary = `Request from ${request.agent_display_name ?? request.agent_id ?? 'unknown'} [${request.category ?? 'general'}]: ${request.title ?? ''}\n${request.description ?? ''}`;

    if (BOSS_DECIDABLE_CATEGORIES.has(String(request.category))) {
      let verdict = '';
      try { verdict = await entry.runner.respondTo(`${BOSS_TRIAGE_GUIDE}\n\n${summary}`); } catch { return; }
      const triage = parseBossTriage(verdict);
      if (!triage) return; // ESCALATE / off-format → stays pending for the LobbyOwner
      await applyRequestDecision(conn.lobbyId, request.request_id, triage.decision, bossName, triage.note).catch(() => {});
    } else {
      // Authority category — attach a recommendation, keep it pending for the human.
      let verdict = '';
      try { verdict = await entry.runner.respondTo(`${BOSS_RECOMMEND_GUIDE}\n\n${summary}`); } catch { return; }
      const rec = parseBossRecommendation(verdict);
      if (!rec) return;
      await store.updateLobbyRequest(conn.lobbyId, request.request_id, {
        decision_notes: `Boss recommendation: ${rec}`,
        updated_at: new Date().toISOString(),
      }).catch(() => {});
      const reqOut: LobbyToAgentMessage = { type: 'lobby-request-updated' as any, request: await store.getLobbyRequest(conn.lobbyId, request.request_id) } as any;
      for (const cid of lobbyConns.get(conn.lobbyId) ?? []) send(cid, reqOut);
    }
  }

  // Launch a hosted agent: open an API-runtime session with the resolved key and register it into
  // the lobby via a virtual socket so it shows in the roster and receives messages like any agent.
  async function spawnHostedAgent(params: {
    lobbyId: string; name: string; role?: string; apiKey: string; providerId: ProviderId;
    model: string; baseUrl?: string; systemPrompt?: string; joinToken?: string;
  }): Promise<string> {
    // Give the agent repo tools whenever the lobby has ANY repo connection: the KB's repository
    // when configured, else the GitHub App integration's selected repo. Previously only the KB
    // path was wired, so agents in a lobby with a connected GitHub repo (but no KB) had no way to
    // actually do repository work. Token is minted fresh — never the stored (expiring) copy.
    let repoClient: any = undefined;
    const kb = await store.getKnowledgeBase(params.lobbyId);
    const integration = await store.getIntegration(params.lobbyId, 'github');
    const repoRefUrl = (kb && kb.repository_url) || (integration?.status === 'active' && integration.repo_full_name) || '';
    if (repoRefUrl) {
      const githubToken = await githubTokenForLobby(params.lobbyId, store);
      if (githubToken) {
        const parsed = repoRef(repoRefUrl);
        if (parsed) {
          const { GitHubRepoClient } = await import('./hosted/github-repo-client.js');
          repoClient = new GitHubRepoClient(parsed.owner, parsed.repo, githubToken, undefined, integration?.branch || 'main');
        }
      }
    }

    const adapter = createApiRuntimeAdapter({
      provider: { id: params.providerId, model: params.model, baseUrl: params.baseUrl },
      apiKey: params.apiKey,
      fetchFn: options.apiRuntimeFetch,
      repoClient,
    });
    // Ground the agent in its REAL runtime capabilities. Without this, hosted agents hallucinated
    // local-workspace work ("created package.json, TypeScript compiled without errors") or denied
    // having any tools at all — both observed live. The preamble states exactly what exists here:
    // repository file tools when a repo is connected, and NOTHING that executes code.
    const workingBranch = integration?.branch || 'main';
    const writeDest = AGENT_WRITES_MODE === 'pr'
      ? `write_file commits go to a per-task branch the lobby manages and are opened as a Pull Request for the LobbyOwner to review (you never merge, and never call create_pr yourself)`
      : `write_file commits go DIRECTLY to the working branch "${workingBranch}"`;
    const capabilities = repoClient
      ? `[RUNTIME CAPABILITIES] You run server-side in the hosted lobby with tools that operate on the connected GitHub repository${integration?.repo_full_name ? ` (${integration.repo_full_name})` : ''}: read_file, write_file, list_files. ${writeDest}. You have NO shell, cannot run commands (npm/tsc/tests), have no local workspace, and CANNOT create or switch branches yourself. Report exactly which files you read or wrote and the commit SHAs the tools returned. NEVER claim to have run, built, compiled, or tested anything, and NEVER invent branch names, commit SHAs, or timestamps — if a task demands command execution, state that limitation as the blocker.`
      : `[RUNTIME CAPABILITIES] You run server-side in the hosted lobby with NO tools — no repository access, no shell, no local workspace. This lobby has no GitHub repository connected yet (the LobbyOwner can connect one in the Lobby tab). You can only reason and reply in chat. NEVER claim to have created, edited, run, built, or tested anything.`;
    const groundedSystemPrompt = params.systemPrompt ? `${params.systemPrompt}\n\n${capabilities}` : capabilities;
    const runner = new HostedAgentRunner(adapter, { systemPrompt: groundedSystemPrompt });
    await runner.start();

    const connId = `hosted-${randomUUID()}`;
    const conn: Connection = { connId, lobbyId: params.lobbyId, orgId: 'default' };
    const virtualSocket = {
      readyState: WebSocket.OPEN,
      send: (data: string) => { void onHostedInbound(conn, data); },
      close: () => {},
      terminate: () => {},
    } as unknown as WebSocket;
    sockets.set(connId, virtualSocket);
    if (!lobbyConns.has(params.lobbyId)) lobbyConns.set(params.lobbyId, new Set());
    lobbyConns.get(params.lobbyId)!.add(connId);

    const reg = await coordinator.handle(conn, {
      type: 'lobby-register',
      display_name: params.name,
      agent_role: params.role,
      runtime: 'api',
      model: params.model,
      join_token: params.joinToken,
    } as AgentToLobbyMessage);
    if (conn.agentId) agentConn.set(conn.agentId, connId);
    dispatch(conn, reg.out);
    const agentId = conn.agentId ?? connId;

    // Auto-appoint a boss-role agent as the Boss when the lobby has none. Relaunching agents mints
    // new agent ids, so the previous appointment always dies with the old id — and with no Boss,
    // floor control leaves every human broadcast unanswered ("who is ready to work?" → silence,
    // observed live). The coordinator allows the first appointment when the seat is empty.
    if (conn.agentId && /boss/i.test(`${params.role ?? ''} ${params.name}`)) {
      const lobbyNow = await store.getLobby(params.lobbyId);
      if (lobbyNow && !lobbyNow.boss_agent_id) {
        const appointRes = await coordinator.handle(conn, {
          type: 'lobby-boss-appoint', agent_id: conn.agentId,
        } as AgentToLobbyMessage).catch(() => ({ out: [] as Outbound[] }));
        dispatch(conn, appointRes.out);
      }
    }

    // Start a periodic heartbeat so the stale-heartbeat sweeper does not reap this hosted agent.
    // Without this, the agent registers (setting last_seen once) and then gets reaped after
    // STALE_MS (default 90s) because nothing ever updates last_seen again.
    const heartbeatInterval = setInterval(async () => {
      try {
        if (!hostedAgents.has(agentId)) { clearInterval(heartbeatInterval); return; }
        // Report real activity — an unconditional 'idle' used to overwrite the roster status even
        // while the agent was mid-task, so the UI showed everything as idle.
        await coordinator.handle(conn, {
          type: 'lobby-heartbeat',
          status: runner.busy ? 'working' : 'idle',
          current_work: '',
        } as AgentToLobbyMessage);
      } catch { /* swallow heartbeat errors */ }
    }, Math.max(Math.floor(STALE_MS / 3), 15_000)); // heartbeat at 1/3 of stale threshold, min 15s
    if (typeof heartbeatInterval.unref === 'function') heartbeatInterval.unref();

    hostedAgents.set(agentId, { runner, connId, conn, heartbeatInterval, repoClient, workingBranch: integration?.branch || 'main' });
    return agentId;
  }

  async function stopHostedAgent(agentId: string): Promise<boolean> {
    const entry = hostedAgents.get(agentId);
    if (!entry) return false;
    if (entry.heartbeatInterval) clearInterval(entry.heartbeatInterval);
    await entry.runner.stop();
    const res = await coordinator.onDisconnect(entry.conn).catch(() => ({ out: [] as Outbound[] }));
    dispatch(entry.conn, res.out);
    sockets.delete(entry.connId);
    lobbyConns.get(entry.conn.lobbyId)?.delete(entry.connId);
    agentConn.delete(agentId);
    hostedAgents.delete(agentId);
    lastObservation.delete(agentId);
    return true;
  }

  // ── HTTP control plane ──
  const httpServer = createServer((req, res) => {
    handleHttp(req, res).catch((err) => {
      console.error('[lobby-server] HTTP handler error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
        res.end(JSON.stringify({ error: 'internal server error' }));
      } else {
        res.end();
      }
    });
  });

  /** Append a canonical event to a lobby's durable log (no-op when the lobby does not exist). */
  async function recordEvent(lobbyId: string, type: LobbyEventType, actorId: string, detail?: Record<string, unknown>): Promise<void> {
    if (!(await store.getLobby(lobbyId))) return;
    const seq = await store.nextSeq(lobbyId);
    await store.appendEvent({
      event_id: randomUUID(),
      lobby_id: lobbyId,
      seq,
      type,
      actor_id: actorId,
      at: new Date().toISOString(),
      detail,
    });
  }

  async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    let path = url.pathname;

    // Rewrite panel-specific remote proxy requests to direct lobby sub-routes
    if (path.startsWith('/api/lobby/remote/')) {
      const subPath = path.slice('/api/lobby/remote'.length);
      const lobbyIdHeader = req.headers['x-lobby-id'];
      const activeLobbyId = typeof lobbyIdHeader === 'string' && lobbyIdHeader.trim() ? lobbyIdHeader.trim() : null;
      if (activeLobbyId) {
        if (subPath === '/settings') {
          path = `/api/v1/agent-lobby/lobbies/${activeLobbyId}`;
        } else if (subPath === '/status') {
          path = `/api/v1/agent-lobby/lobbies/${activeLobbyId}/status`;
        } else {
          path = `/api/v1/agent-lobby/lobbies/${activeLobbyId}${subPath}`;
        }
      } else {
        path = `/api/v1/agent-lobby${subPath}`;
      }
    }

    const json = (body: unknown, status = 200): void => {
      res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify(body));
    };

    // Extract + validate a Bearer session token (HMAC-signed by /auth/verify) for a given lobby.
    // Returns the wallet identity_ref the token is bound to, or null. This is the wallet-lock: a
    // request may only act as the wallet it proved control of. (Exposed to gated endpoints below.)
    const sessionIdentity = (lobbyId: string): string | null => {
      const h = req.headers['authorization'];
      const token = typeof h === 'string' && h.startsWith('Bearer ') ? h.slice(7).trim() : '';
      if (!token) return null;
      const payload = validateSessionToken(token, lobbyId);
      return payload ? payload.identityRef : null;
    };

    const ghToken = (lobbyId: string): Promise<string | null> => githubTokenForLobby(lobbyId, store);

    // Adopt an existing GitHub App installation for a lobby that has none recorded yet — the recovery
    // path when GitHub didn't redirect back with an installation_id. Discovers installations via the
    // App JWT and adopts the most recent, minting + storing its token. Throttled per lobby so a poll
    // loop while disconnected can't exhaust the GitHub App rate limit. Returns the connected payload
    // on success, or null (leaving the caller to report not-connected).
    const autoAdoptGithubInstallation = async (
      lobbyId: string, identityRef: string, existing: Awaited<ReturnType<typeof store.getIntegration>>,
    ): Promise<{ connected: true; account?: string; repo?: string; branch?: string; repos: unknown[] } | null> => {
      const last = lastGithubAutoDetect.get(lobbyId) ?? 0;
      if (Date.now() - last < GITHUB_AUTODETECT_THROTTLE_MS) return null;
      lastGithubAutoDetect.set(lobbyId, Date.now());

      const installs = await listAppInstallations();
      if (installs.length === 0) return null;
      const chosen = installs[0]; // most recently updated — the one the user most likely just added
      const instToken = await getInstallationToken(chosen.id);
      const repos = await listInstallationRepos(instToken);
      const account = chosen.account || repos[0]?.full_name?.split('/')[0];
      const now = new Date().toISOString();
      // When the installation covers exactly one repository, select it automatically — every
      // downstream feature (identity bind, KB, agent repo tools) needs repo_full_name, and a
      // recovered/adopted connection would otherwise sit "connected" but unusable until the user
      // notices the repo picker.
      const soleRepo = repos.length === 1 ? repos[0] : undefined;
      let integration = existing;
      if (existing) {
        integration = await store.updateIntegration(lobbyId, existing.id, {
          status: 'active', installation_id: chosen.id, external_account_name: account, updated_at: now,
          ...(soleRepo && !existing.repo_full_name ? { repo_full_name: soleRepo.full_name, branch: soleRepo.default_branch } : {}),
        }) ?? existing;
      } else {
        integration = await store.addIntegration({
          id: randomUUID(), lobby_id: lobbyId, provider: 'github', status: 'active',
          external_account_name: account, installation_id: chosen.id,
          ...(soleRepo ? { repo_full_name: soleRepo.full_name, branch: soleRepo.default_branch } : {}),
          scopes: ['contents', 'pull_requests'], installed_by_identity_ref: identityRef,
          created_at: now, updated_at: now,
        });
      }
      await saveIntegrationSecret(integration!.id, 'installation_token', instToken, store, 3300);
      await recordEvent(lobbyId, 'github_connected', identityRef, { account, repos: repos.length, via: 'auto-detect' });
      return { connected: true, account, repo: integration!.repo_full_name, branch: integration!.branch, repos };
    };

    if (path === '/health') return json({ ok: true, lobbies: (await store.listLobbies()).length });

    // ── Wallet session auth (Hosted Mode) — nonce challenge → wallet signature → session token ──
    // POST /api/v1/agent-lobby/auth/nonce  { identity_ref, lobby_id } → { nonce, expires_at }
    if (path === '/api/v1/agent-lobby/auth/nonce' && req.method === 'POST') {
      const body = await readBody(req);
      const identityRef = typeof body.identity_ref === 'string' ? body.identity_ref.trim() : '';
      const lobbyId = typeof body.lobby_id === 'string' ? body.lobby_id.trim() : '';
      if (!identityRef || !lobbyId) return json({ error: 'identity_ref and lobby_id are required' }, 400);
      const challenge = await generateNonceChallenge(identityRef, lobbyId, store);
      return json({ nonce: challenge.nonce, expires_at: challenge.expiresAt });
    }

    // POST /api/v1/agent-lobby/auth/verify  { identity_ref, lobby_id, signature, public_key }
    //   → { token, expires_at }  (401 on bad proof). The wallet signs the nonce from /auth/nonce.
    if (path === '/api/v1/agent-lobby/auth/verify' && req.method === 'POST') {
      const body = await readBody(req);
      const identityRef = typeof body.identity_ref === 'string' ? body.identity_ref.trim() : '';
      const lobbyId = typeof body.lobby_id === 'string' ? body.lobby_id.trim() : '';
      const signature = typeof body.signature === 'string' ? body.signature : '';
      const publicKey = typeof body.public_key === 'string' ? body.public_key : '';
      if (!identityRef || !lobbyId || !signature || !publicKey) {
        return json({ error: 'identity_ref, lobby_id, signature, public_key are required' }, 400);
      }
      const token = await verifyProofAndIssueToken(identityRef, signature, publicKey, lobbyId, store);
      if (!token) return json({ error: 'invalid or expired proof' }, 401);
      return json({ token, expires_at: Date.now() + 15 * 60 * 1000 });
    }

    // ── Production wallet sign-in — bound single-use challenge → Concordium ed25519 verify ──
    // Derive origin from the request so the challenge is bound to where it was issued.
    const requestOrigin = (): string => {
      const o = req.headers['origin'];
      if (typeof o === 'string' && o) return o;
      const host = req.headers['host'];
      return host ? `http://${host}` : 'unknown';
    };

    // POST /api/v1/agent-lobby/auth/challenge { account, lobby_id, network?, session_id? }
    //   → { challenge_id, challenge, session_id, expires_at }  (client signs `challenge`)
    if (path === '/api/v1/agent-lobby/auth/challenge' && req.method === 'POST') {
      const body = await readBody(req);
      const account = typeof body.account === 'string' ? body.account.trim() : '';
      const lobbyId = typeof body.lobby_id === 'string' ? body.lobby_id.trim() : '';
      if (!account || !lobbyId) return json({ error: 'account and lobby_id are required' }, 400);
      try {
        const ch = await createWalletChallenge(store, {
          account, lobbyId, origin: requestOrigin(),
          network: body.network, sessionId: typeof body.session_id === 'string' ? body.session_id : undefined,
        });
        return json({ challenge_id: ch.challengeId, challenge: ch.challenge, session_id: ch.sessionId, expires_at: ch.expiresAt });
      } catch {
        return json({ error: 'invalid account address' }, 400);
      }
    }

    // POST /api/v1/agent-lobby/auth/verify-wallet { challenge_id, account, signature, session_id }
    //   → { token, identity_ref } (401 on any failure — generic, never reveals which check failed)
    if (path === '/api/v1/agent-lobby/auth/verify-wallet' && req.method === 'POST') {
      const body = await readBody(req);
      const challengeId = typeof body.challenge_id === 'string' ? body.challenge_id : '';
      const account = typeof body.account === 'string' ? body.account.trim() : '';
      const sessionId = typeof body.session_id === 'string' ? body.session_id : '';
      if (!challengeId || !account || !body.signature || !sessionId) return json({ error: 'invalid or expired challenge' }, 401);
      const result = await verifyWalletChallenge(store, accountInfoSource, {
        challengeId, account, signature: body.signature, origin: requestOrigin(), sessionId,
      });
      if (!result) return json({ error: 'invalid or expired challenge' }, 401);
      return json({ token: result.token, identity_ref: result.identityRef, expires_at: Date.now() + 15 * 60 * 1000 });
    }

    // GET /api/v1/agent-lobby/lobbies/:id/session — whoami: the wallet the Bearer token proves.
    // Used by the panel/CLI to confirm a live session and by gated endpoints (PR3) as the authz base.
    const sessionMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/session$/);
    if (sessionMatch && req.method === 'GET') {
      const identityRef = sessionIdentity(sessionMatch[1]);
      if (!identityRef) return json({ authenticated: false }, 401);
      return json({ authenticated: true, identity_ref: identityRef, lobby_id: sessionMatch[1] });
    }

    // ── Hosted-Mode provider keys (wallet-gated) — configure model API keys for a lobby or agent ──
    // All require a Bearer session token whose wallet manages the lobby (owner/admin). The key is
    // sealed at rest and never returned; responses carry only masked hints.
    const pkMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/provider-keys(?:\/([^/]+))?$/);
    if (pkMatch) {
      const lobbyId = pkMatch[1];
      const keyId = pkMatch[2];
      const identityRef = sessionIdentity(lobbyId);
      if (!identityRef) return json({ error: 'authentication required' }, 401);
      if (!(await authorizeLobbyManager(store, lobbyId, identityRef))) return json({ error: 'not authorized to manage this lobby' }, 403);

      // GET .../provider-keys — list configured keys (masked)
      if (req.method === 'GET' && !keyId) {
        return json({ provider_keys: await listProviderKeys(store, lobbyId) });
      }
      // POST .../provider-keys — set/replace a key { provider, api_key, agent_ref?, base_url?, model? }
      if (req.method === 'POST' && !keyId) {
        const body = await readBody(req);
        try {
          const view = await setProviderKey(store, {
            lobbyId,
            provider: String(body.provider ?? ''),
            apiKey: String(body.api_key ?? ''),
            agentRef: typeof body.agent_ref === 'string' && body.agent_ref.trim() ? body.agent_ref.trim() : null,
            baseUrl: typeof body.base_url === 'string' ? body.base_url : undefined,
            model: typeof body.model === 'string' ? body.model : undefined,
            identityRef,
          });
          await recordEvent(lobbyId, 'provider_key_configured', identityRef, { provider: view.provider, scope: view.scope, agent_ref: view.agent_ref });
          return json({ provider_key: view }, 201);
        } catch (e) {
          return json({ error: String((e as Error).message ?? e) }, 400);
        }
      }
      // DELETE .../provider-keys/:id — revoke a key
      if (req.method === 'DELETE' && keyId) {
        const view = await revokeProviderKey(store, keyId);
        if (!view || view.lobby_id !== lobbyId) return json({ error: 'provider key not found' }, 404);
        await recordEvent(lobbyId, 'provider_key_revoked', identityRef, { provider: view.provider, scope: view.scope });
        return json({ revoked: view });
      }
    }

    // ── Hosted agents (wallet-gated) — launch/stop server-side agents that run via the API runtime ──
    const hostedMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/hosted-agents(?:\/([^/]+))?$/);
    if (hostedMatch) {
      const lobbyId = hostedMatch[1];
      const agentId = hostedMatch[2];
      const identityRef = sessionIdentity(lobbyId);
      if (!identityRef) return json({ error: 'authentication required' }, 401);
      if (!(await authorizeLobbyManager(store, lobbyId, identityRef))) return json({ error: 'not authorized to manage this lobby' }, 403);

      // GET .../hosted-agents — list the running hosted agents in this lobby.
      if (req.method === 'GET' && !agentId) {
        const list = [...hostedAgents.entries()].filter(([, v]) => v.conn.lobbyId === lobbyId).map(([id]) => ({ agent_id: id }));
        return json({ hosted_agents: list });
      }
      // POST .../hosted-agents — launch { name, agent_role?, provider?, model?, base_url?, system_prompt?, agent_ref? }
      if (req.method === 'POST' && !agentId) {
        const body = await readBody(req);
        const providerName = typeof body.provider === 'string' && body.provider.trim() ? body.provider.trim() : 'anthropic';
        const agentRef = typeof body.agent_ref === 'string' && body.agent_ref.trim() ? body.agent_ref.trim() : null;
        const resolved = await resolveProviderKey(store, lobbyId, providerName, agentRef);
        if (!resolved) return json({ error: `no provider key configured for "${providerName}" — set one first (POST .../provider-keys)` }, 400);
        const model = (typeof body.model === 'string' && body.model.trim()) || resolved.model || 'claude-opus-4-8';
        let systemPrompt = typeof body.system_prompt === 'string' ? body.system_prompt : undefined;
        // The agent's persisted DID (its definition's `Identity:` line) is presented as the join
        // token so the roster reflects the bound identity. Without this, a DID saved via "Set ID"
        // never reached the register step and the agent stayed "unverified" forever.
        let definitionIdentity: string | undefined;
        if (typeof body.agent_role === 'string') {
          try {
            const defs = await getAgentDefinitions(lobbyId, store);
            const def = defs.find(d => d.slug === body.agent_role);
            if (def && def.system_prompt && !systemPrompt) {
              systemPrompt = def.system_prompt;
            }
            if (def?.identity && /^did:/i.test(def.identity)) definitionIdentity = def.identity;
          } catch (e) {
            console.warn('[Lobby Server] Failed to resolve definition for hosted agent:', e);
          }
        }

        // A user-chosen nickname for this role (persisted) wins over the default display name.
        const nicknames = await store.getAgentNicknames(lobbyId);
        const roleSlug = typeof body.agent_role === 'string' ? body.agent_role : '';
        const defaultName = typeof body.name === 'string' && body.name.trim() ? body.name.slice(0, 120) : 'Hosted Agent';
        const displayName = (roleSlug && nicknames[roleSlug]) || defaultName;

        try {
          const newId = await spawnHostedAgent({
            lobbyId,
            name: displayName,
            role: typeof body.agent_role === 'string' ? body.agent_role : undefined,
            apiKey: resolved.apiKey,
            providerId: providerIdFor(providerName),
            model,
            baseUrl: resolved.baseUrl,
            systemPrompt,
            joinToken: agentRef ?? definitionIdentity ?? undefined,
          });
          await recordEvent(lobbyId, 'hosted_agent_launched', identityRef, { agent_id: newId, provider: providerName, model, scope: resolved.scope });
          return json({ agent_id: newId, name: displayName, model, provider: providerName }, 201);
        } catch (e) {
          return json({ error: `failed to launch hosted agent: ${String((e as Error).message ?? e)}` }, 500);
        }
      }
      // DELETE .../hosted-agents/:agentId — stop a hosted agent.
      if (req.method === 'DELETE' && agentId) {
        const stopped = await stopHostedAgent(agentId);
        if (!stopped) return json({ error: 'hosted agent not found' }, 404);
        await recordEvent(lobbyId, 'hosted_agent_stopped', identityRef, { agent_id: agentId });
        return json({ stopped: agentId });
      }
    }

    // GET / POST /api/v1/agent-lobby/lobbies/:id/agent-nicknames — per-role user-chosen names.
    const nicknamesMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/agent-nicknames$/);
    if (nicknamesMatch) {
      const lobbyId = nicknamesMatch[1];
      const identityRef = sessionIdentity(lobbyId);
      if (!identityRef) return json({ error: 'authentication required' }, 401);
      if (!(await authorizeLobbyManager(store, lobbyId, identityRef))) return json({ error: 'not authorized to manage this lobby' }, 403);
      if (req.method === 'GET') return json({ nicknames: await store.getAgentNicknames(lobbyId) });
      if (req.method === 'POST') {
        const body = await readBody(req);
        const role = typeof body.role === 'string' ? body.role.trim() : '';
        const nickname = typeof body.nickname === 'string' ? body.nickname : '';
        if (!role) return json({ error: 'role is required' }, 400);
        const map = await store.setAgentNickname(lobbyId, role, nickname);
        // Live rename: update any CONNECTED agents of this role so the roster reflects it now,
        // without waiting for a relaunch. Broadcast the roster update.
        const effective = map[role] || '';
        for (const a of await store.roster(lobbyId)) {
          if (a.agent_role === role && a.status !== 'disconnected') {
            const newName = effective || a.display_name;
            const updated = await store.updateAgent(lobbyId, a.agent_id, { display_name: newName }).catch(() => null);
            if (updated) for (const cid of lobbyConns.get(lobbyId) ?? []) send(cid, { type: 'lobby-agent-updated', agent: updated } as LobbyToAgentMessage);
          }
        }
        return json({ nicknames: map });
      }
    }

    // GET /api/v1/agent-lobby/lobbies/:id/agent-definitions
    const agentDefsMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/agent-definitions$/);
    if (agentDefsMatch && req.method === 'GET') {
      const lobbyId = agentDefsMatch[1];
      const identityRef = sessionIdentity(lobbyId);
      if (!identityRef) return json({ error: 'authentication required' }, 401);
      if (!(await authorizeLobbyManager(store, lobbyId, identityRef))) return json({ error: 'not authorized to manage this lobby' }, 403);

      try {
        const agents = await getAgentDefinitions(lobbyId, store);
        return json({ agents });
      } catch (err: any) {
        return json({ error: err.message ?? String(err) }, 500);
      }
    }

    // GET /api/v1/agent-lobby/lobbies/:id/scheduled
    const scheduledGetMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/scheduled$/);
    if (scheduledGetMatch && req.method === 'GET') {
      const lobbyId = scheduledGetMatch[1];
      const identityRef = sessionIdentity(lobbyId);
      if (!identityRef) return json({ error: 'authentication required' }, 401);
      if (!(await authorizeLobbyManager(store, lobbyId, identityRef))) return json({ error: 'not authorized to manage this lobby' }, 403);

      const defaultTasks = [
        {
          name: "graph-update",
          config: { enabled: false, description: "Update dependency graph via graph-update.sh to keep codebase intelligence current", time_utc: "03:00" },
          running: false,
          state: {}
        },
        {
          name: "pr-quality-review",
          config: { enabled: false, description: "Review merged PRs using Agent OS specialist agents, generate fix-sprint specs for issues found.", time_utc: "04:00" },
          running: false,
          state: {}
        },
        {
          name: "fix-sprint-executor",
          config: { enabled: false, description: "Execute pending fix-sprints, commit to branch, open PR for human review", time_utc: "05:00" },
          running: false,
          state: {}
        }
      ];

      const integration = await store.getIntegration(lobbyId, 'github');
      if (!integration || !integration.repo_full_name) {
        return json({ repoConfigured: false, tasks: defaultTasks });
      }

      const token = await ghToken(lobbyId);
      if (!token) {
        return json({ repoConfigured: false, tasks: defaultTasks });
      }

      const parsed = repoRef(integration.repo_full_name);
      if (!parsed) {
        return json({ repoConfigured: false, tasks: defaultTasks });
      }

      try {
        const { GitHubRepoClient } = await import('./hosted/github-repo-client.js');
        const client = new GitHubRepoClient(parsed.owner, parsed.repo, token);
        const branchName = integration.branch || 'main';
        const fileContent = await client.readFile('agent-os/config.json', branchName).catch(() => null);

        if (!fileContent) {
          return json({ repoConfigured: false, tasks: defaultTasks });
        }

        const config = JSON.parse(fileContent);
        if (config && Array.isArray(config.scheduled)) {
          const tasks = defaultTasks.map(t => {
            const remoteTask = config.scheduled.find((rt: any) => rt.name === t.name);
            if (remoteTask) {
              return {
                ...t,
                config: {
                  ...t.config,
                  enabled: remoteTask.enabled !== false,
                  time_utc: remoteTask.time_utc || t.config.time_utc
                }
              };
            }
            return t;
          });
          return json({ repoConfigured: true, tasks });
        }
      } catch (e) {
        console.warn('[Lobby Server] Failed to fetch scheduled config from GitHub:', e);
      }

      return json({ repoConfigured: false, tasks: defaultTasks });
    }

    // POST /api/v1/agent-lobby/lobbies/:id/scheduled/setup
    const scheduledSetupMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/scheduled\/setup$/);
    if (scheduledSetupMatch && req.method === 'POST') {
      const lobbyId = scheduledSetupMatch[1];
      const identityRef = sessionIdentity(lobbyId);
      if (!identityRef) return json({ error: 'authentication required' }, 401);
      if (!(await authorizeLobbyManager(store, lobbyId, identityRef))) return json({ error: 'not authorized to manage this lobby' }, 403);

      const integration = await store.getIntegration(lobbyId, 'github');
      if (!integration || !integration.repo_full_name) {
        return json({ error: 'GitHub integration not connected' }, 400);
      }

      const token = await ghToken(lobbyId);
      if (!token) return json({ error: 'GitHub installation token unavailable' }, 502);

      const parsed = repoRef(integration.repo_full_name);
      if (!parsed) return json({ error: 'Invalid GitHub repository URL' }, 400);

      const { GitHubRepoClient } = await import('./hosted/github-repo-client.js');
      const client = new GitHubRepoClient(parsed.owner, parsed.repo, token);
      const branchName = integration.branch || 'main';

      try {
        // Scheduled setup IS repo initialization plus enabling the tasks: seed the full Agent OS
        // structure in one atomic commit (files already present in the repo are left untouched),
        // then enable the scheduled tasks in agent-os/config.json. Replaces the old per-file
        // commit loop (~65 commits of history spam, and it overwrote user-customized files).
        const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../../../');
        const seed = collectAgentOsSeed(REPO_ROOT);
        const existing = await client.listTreePaths(branchName);
        const toWrite = seed.filter(f => !existing.has(f.path) && f.path !== 'agent-os/config.json');
        // Config is authoritative from this action: tasks the user just set up are enabled.
        const enabledConfig = JSON.stringify({
          scheduled: [
            { name: 'graph-update', enabled: true, time_utc: '03:00' },
            { name: 'pr-quality-review', enabled: true, time_utc: '04:00' },
            { name: 'fix-sprint-executor', enabled: true, time_utc: '05:00' },
          ],
        }, null, 2) + '\n';
        toWrite.push({ path: 'agent-os/config.json', content: enabledConfig });
        if (!existing.has(AGENT_OS_MANIFEST_PATH)) {
          toWrite.push({ path: AGENT_OS_MANIFEST_PATH, content: buildManifest(identityRef) });
        }
        await client.commitFiles(toWrite, 'chore: set up Agent OS scheduled self-learning (config, prompts, agents)', branchName);
        repoInitializedCache.set(lobbyId, { value: true, at: Date.now() });
        invalidateAgentDefs(lobbyId);

        await recordEvent(lobbyId, 'scheduled_tasks_configured', identityRef, { repo: integration.repo_full_name, branch: branchName });
        return json({ ok: true });
      } catch (err: any) {
        console.error('[Lobby Server] Failed to bootstrap agent-os to GitHub repo:', err);
        return json({ error: `failed to configure repository: ${err.message || String(err)}` }, 500);
      }
    }

    // ── GitHub App integration (wallet-gated) — connect the user's OWN repo so hosted agents can
    // read it and land changes as commits/PRs. We host no repo; the lobby holds only a revocable,
    // short-lived installation token. Flow: connect → install URL → GitHub redirects to the callback
    // (state carries the wallet-authed lobby binding) → store installation → pick repo + branch.


    // POST /lobbies/:id/integrations/github/connect → { install_url }
    const ghConnect = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/integrations\/github\/connect$/);
    if (ghConnect && req.method === 'POST') {
      const lobbyId = ghConnect[1];
      const identityRef = sessionIdentity(lobbyId);
      if (!identityRef) return json({ error: 'authentication required' }, 401);
      if (!(await authorizeLobbyManager(store, lobbyId, identityRef))) return json({ error: 'not authorized to manage this lobby' }, 403);
      const cfg = githubAppConfig();
      if (!cfg || !cfg.slug) return json({ error: 'GitHub App not configured on this lobby (set GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY / GITHUB_APP_SLUG)' }, 503);
      const state = `${lobbyId}.${issueSessionToken(identityRef, lobbyId)}`;
      return json({ install_url: installUrl(cfg, state) });
    }

    // GET /api/v1/agent-lobby/integrations/github/setup-callback?code=&state= → convert manifest + redirect to panel
    if (path === '/api/v1/agent-lobby/integrations/github/setup-callback' && req.method === 'GET') {
      const code = url.searchParams.get('code') ?? '';
      const returnUrl = url.searchParams.get('state') ?? '';
      try {
        const response = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
          method: 'POST',
          headers: {
            'accept': 'application/vnd.github+json',
            'user-agent': 'agent-os-lobby'
          }
        });
        if (!response.ok) {
          throw new Error(`Failed to convert app manifest (HTTP ${response.status}): ${await response.text()}`);
        }
        const data = await response.json() as {
          id: number;
          slug: string;
          client_id: string;
          client_secret: string;
          pem: string;
        };

        const cfg = {
          appId: String(data.id),
          privateKey: data.pem,
          slug: data.slug
        };

        const { setDynamicGithubAppConfig } = await import('./integrations/github/appAuth.js');
        setDynamicGithubAppConfig(cfg);

        // Redirect back to the caller panel URL
        const redirectBase = returnUrl || '/panel';
        res.writeHead(302, { location: `${redirectBase}/?github_app=configured` });
        res.end();
        return;
      } catch (e) {
        res.writeHead(502, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<p>Failed to complete GitHub App setup: ${String((e as Error).message ?? e)}</p>`);
        return;
      }
    }

    // GET /integrations/github/callback?installation_id=&state= → store + redirect back to /panel
    if (path === '/api/v1/agent-lobby/integrations/github/callback' && req.method === 'GET') {
      const state = url.searchParams.get('state') ?? '';
      const installationId = url.searchParams.get('installation_id') ?? '';
      const dot = state.indexOf('.');
      const lobbyId = dot > 0 ? state.slice(0, dot) : '';
      const token = dot > 0 ? state.slice(dot + 1) : '';
      const payload = lobbyId && token ? validateSessionToken(token, lobbyId) : null;
      if (!payload || !installationId) {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<p>GitHub connection failed: invalid or expired state. Close this window and try again from the panel.</p>');
        return;
      }
      try {
        // Validate the installation by minting a token + reading its repos (also captures the account).
        const instToken = await getInstallationToken(installationId);
        const repos = await listInstallationRepos(instToken);
        const account = repos[0]?.full_name?.split('/')[0];
        const existing = await store.getIntegration(lobbyId, 'github');
        const now = new Date().toISOString();
        // Single-repo installs select that repo immediately — see autoAdoptGithubInstallation.
        const soleRepo = repos.length === 1 ? repos[0] : undefined;
        let integration = existing;
        if (existing) {
          integration = await store.updateIntegration(lobbyId, existing.id, {
            status: 'active', installation_id: installationId, external_account_name: account, updated_at: now,
            ...(soleRepo && !existing.repo_full_name ? { repo_full_name: soleRepo.full_name, branch: soleRepo.default_branch } : {}),
          }) ?? existing;
        } else {
          integration = await store.addIntegration({
            id: randomUUID(), lobby_id: lobbyId, provider: 'github', status: 'active',
            external_account_name: account, installation_id: installationId,
            ...(soleRepo ? { repo_full_name: soleRepo.full_name, branch: soleRepo.default_branch } : {}),
            scopes: ['contents', 'pull_requests'], installed_by_identity_ref: payload.identityRef,
            created_at: now, updated_at: now,
          });
        }
        await saveIntegrationSecret(integration!.id, 'installation_token', instToken, store, 3300);
        await recordEvent(lobbyId, 'github_connected', payload.identityRef, { account, repos: repos.length });
      } catch (e) {
        res.writeHead(502, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<p>GitHub connection failed: ${String((e as Error).message ?? e)}</p>`);
        return;
      }
      res.writeHead(302, { location: '/panel/?github=connected' });
      res.end();
      return;
    }

    // /lobbies/:id/integrations/github (GET status · POST repo select · DELETE revoke)
    const ghMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/integrations\/github$/);
    if (ghMatch) {
      const lobbyId = ghMatch[1];
      const identityRef = sessionIdentity(lobbyId);
      if (!identityRef) return json({ error: 'authentication required' }, 401);
      if (!(await authorizeLobbyManager(store, lobbyId, identityRef))) return json({ error: 'not authorized to manage this lobby' }, 403);
      const integ = await store.getIntegration(lobbyId, 'github');

      if (req.method === 'GET') {
        if (!integ || integ.status !== 'active') {
          // Recovery: the app may already be installed but GitHub never redirected back with an
          // installation_id (app created without a setup_url, blocked popup, etc.). Discover the
          // installation via the App JWT and adopt it so the panel connects on its own. Throttled
          // per lobby so a poll while disconnected doesn't hammer the GitHub App rate limit.
          const cfg = githubAppConfig();
          if (cfg) {
            const adopted = await autoAdoptGithubInstallation(lobbyId, identityRef, integ).catch(() => null);
            if (adopted) return json(adopted);
          }
          return json({ connected: false, configured: Boolean(cfg) });
        }
        let repos: unknown[] = [];
        const token = await ghToken(lobbyId);
        if (token) { try { repos = await listInstallationRepos(token); } catch { /* token stale */ } }
        const initialized = await isRepoInitialized(lobbyId, integ.repo_full_name, integ.branch);
        return json({ connected: true, account: integ.external_account_name, repo: integ.repo_full_name, branch: integ.branch, repos, initialized });
      }
      if (req.method === 'POST') {
        if (!integ) return json({ error: 'GitHub is not connected' }, 400);
        repoInitializedCache.delete(lobbyId); // repo/branch may change — re-check the manifest
        const body = await readBody(req);
        const repo = typeof body.repo === 'string' ? body.repo.trim() : '';
        if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) return json({ error: 'repo must be "owner/repo"' }, 400);
        const branch = typeof body.branch === 'string' && body.branch.trim() ? body.branch.trim() : undefined;
        const updated = await store.updateIntegration(lobbyId, integ.id, { repo_full_name: repo, branch, updated_at: new Date().toISOString() });
        await recordEvent(lobbyId, 'github_repo_selected', identityRef, { repo, branch });
        return json({ connected: true, repo: updated?.repo_full_name, branch: updated?.branch });
      }
      if (req.method === 'DELETE') {
        if (integ) await store.updateIntegration(lobbyId, integ.id, { status: 'revoked', updated_at: new Date().toISOString() });
        repoInitializedCache.delete(lobbyId);
        await recordEvent(lobbyId, 'github_disconnected', identityRef, {});
        return json({ connected: false });
      }
    }

    // POST /lobbies/:id/repo/initialize — seed the Agent OS structure into the connected repo.
    // One atomic commit "clones down" what the lobby needs to manage agents there: agent
    // definitions (where Agent IDs bind), skills, scheduled self-learning prompts, the scheduler
    // config, and scaffolding for shared memories + locally trained packs. Idempotent: files that
    // already exist in the repo are left untouched (user customizations win); only the manifest is
    // always (re)written.
    const repoInitMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/repo\/initialize$/);
    if (repoInitMatch && req.method === 'POST') {
      const lobbyId = repoInitMatch[1];
      const identityRef = sessionIdentity(lobbyId);
      if (!identityRef) return json({ error: 'authentication required' }, 401);
      if (!(await authorizeLobbyManager(store, lobbyId, identityRef))) return json({ error: 'not authorized to manage this lobby' }, 403);
      const integ = await store.getIntegration(lobbyId, 'github');
      if (!integ || integ.status !== 'active' || !integ.repo_full_name) {
        return json({ error: 'no connected GitHub repository — connect the GitHub App and select a repository in the Lobby tab first' }, 400);
      }
      const token = await githubTokenForLobby(lobbyId, store);
      if (!token) return json({ error: 'could not mint a GitHub installation token — reconnect the GitHub App in the Lobby tab' }, 400);
      const parsed = repoRef(integ.repo_full_name);
      if (!parsed) return json({ error: 'invalid GitHub repository reference' }, 400);

      try {
        const { GitHubRepoClient } = await import('./hosted/github-repo-client.js');
        const client = new GitHubRepoClient(parsed.owner, parsed.repo, token);
        const branchName = integ.branch || 'main';
        const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../../../');
        const seed = collectAgentOsSeed(REPO_ROOT);
        const existing = await client.listTreePaths(branchName);
        const toWrite = seed.filter(f => !existing.has(f.path));
        toWrite.push({ path: AGENT_OS_MANIFEST_PATH, content: buildManifest(identityRef) });
        const commitSha = await client.commitFiles(
          toWrite,
          'chore: initialize Agent OS structure (agents, skills, prompts, memory + training scaffold)',
          branchName,
        );
        repoInitializedCache.set(lobbyId, { value: true, at: Date.now() });
        invalidateAgentDefs(lobbyId);
        await recordEvent(lobbyId, 'repo_initialized', identityRef, {
          repo: integ.repo_full_name, branch: branchName, files_committed: toWrite.length, skipped_existing: seed.length - (toWrite.length - 1), commit_sha: commitSha,
        });
        return json({ ok: true, repo: integ.repo_full_name, branch: branchName, files_committed: toWrite.length, skipped_existing: seed.length - (toWrite.length - 1), commit_sha: commitSha });
      } catch (e) {
        return json({ error: `repository initialization failed: ${githubErrorMessage(e)}` }, 502);
      }
    }

    // POST /lobbies/:id/repo/ui-assist — clone the UI Assist embed into the connected repo:
    // the dependency-free overlay (embed.js) plus a README tailored to THIS lobby (its WS URL) with
    // both integration paths (hosted lobby chat / local panel + relay). Skip-if-exists, one commit.
    const uiAssistCloneMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/repo\/ui-assist$/);
    if (uiAssistCloneMatch && req.method === 'POST') {
      const lobbyId = uiAssistCloneMatch[1];
      const identityRef = sessionIdentity(lobbyId);
      if (!identityRef) return json({ error: 'authentication required' }, 401);
      if (!(await authorizeLobbyManager(store, lobbyId, identityRef))) return json({ error: 'not authorized to manage this lobby' }, 403);
      const integ = await store.getIntegration(lobbyId, 'github');
      if (!integ || integ.status !== 'active' || !integ.repo_full_name) {
        return json({ error: 'no connected GitHub repository — connect the GitHub App and select a repository in the Lobby tab first' }, 400);
      }
      const token = await githubTokenForLobby(lobbyId, store);
      if (!token) return json({ error: 'could not mint a GitHub installation token — reconnect the GitHub App in the Lobby tab' }, 400);
      const parsed = repoRef(integ.repo_full_name);
      if (!parsed) return json({ error: 'invalid GitHub repository reference' }, 400);

      try {
        const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../../../');
        const embedSrc = readFileSync(join(REPO_ROOT, 'packages/ui-assist-embed/embed.js'), 'utf-8');
        const proto = (req.headers['x-forwarded-proto'] as string) === 'https' ? 'wss' : 'ws';
        const host = req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost:4730';
        const lobbyWsUrl = `${proto}://${host}${WS_PATH}?lobby_id=${encodeURIComponent(lobbyId)}`;
        const readme = [
          '# UI Assist — embeddable assistant overlay', '',
          'A floating launcher + chat panel for YOUR web app: one script tag, dependency-free,',
          'framework-agnostic, **suggest-only by default** (edit authority stays off until you enable it).', '',
          '## Option A — connect to your hosted lobby chat', '',
          '```html', '<script type="module">', "  import { mountUiAssist } from '/agent-os/ui-assist/embed.js';",
          `  mountUiAssist({ relayUrl: '${lobbyWsUrl}' });`, '</script>', '```', '',
          'Messages from your app land in the lobby chat where the Boss coordinates the swarm.', '',
          '## Option B — run against a local Agent OS Panel + relay', '',
          '```bash', 'npm run agent-os-panel        # panel :4800 · relay ws://localhost:4722',
          'npm run ui-assist-integrate -- /path/to/your/app   # framework detection + embed plan', '```', '',
          '```html', '<script type="module">', "  import { mountUiAssist } from './ui-assist/embed.js';",
          "  mountUiAssist({ relayUrl: 'ws://localhost:4722' });", '</script>', '```', '',
          'Docs: `agent-os/UI-ASSIST.md`, `agent-os/UI-ASSIST-GUIDE.md`, and `docs/ui-assist/` in the',
          '[Agent OS Protocol](https://github.com/ronnikc/agent-os-protocol) repository.', '',
        ].join('\n');

        const { GitHubRepoClient } = await import('./hosted/github-repo-client.js');
        const client = new GitHubRepoClient(parsed.owner, parsed.repo, token);
        const branchName = integ.branch || 'main';
        const existing = await client.listTreePaths(branchName);
        const toWrite = [
          { path: 'agent-os/ui-assist/embed.js', content: embedSrc },
          { path: 'agent-os/ui-assist/README.md', content: readme },
        ].filter(f => !existing.has(f.path));
        if (toWrite.length === 0) {
          return json({ ok: true, repo: integ.repo_full_name, branch: branchName, files_committed: 0, note: 'UI Assist already present in the repository' });
        }
        const commitSha = await client.commitFiles(toWrite, 'chore: add UI Assist embed + integration instructions', branchName);
        return json({ ok: true, repo: integ.repo_full_name, branch: branchName, files_committed: toWrite.length, commit_sha: commitSha });
      } catch (e) {
        return json({ error: `UI Assist clone failed: ${String((e as Error).message ?? e)}` }, 502);
      }
    }

    // GET /lobbies/:id/repo/(tree|file)?path=&ref= — browse the connected repo (Files tab).
    const repoMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/repo\/(tree|file)$/);
    if (repoMatch && req.method === 'GET') {
      const lobbyId = repoMatch[1];
      const kind = repoMatch[2];
      const identityRef = sessionIdentity(lobbyId);
      if (!identityRef) return json({ error: 'authentication required' }, 401);
      if (!(await authorizeLobbyManager(store, lobbyId, identityRef))) return json({ error: 'not authorized to manage this lobby' }, 403);
      const integ = await store.getIntegration(lobbyId, 'github');
      if (!integ || integ.status !== 'active' || !integ.repo_full_name) return json({ error: 'no connected repo — connect GitHub and select a repo first' }, 400);
      const token = await ghToken(lobbyId);
      if (!token) return json({ error: 'could not obtain a GitHub installation token (reconnect GitHub)' }, 502);
      const ref = url.searchParams.get('ref') || integ.branch || 'HEAD';
      const p = url.searchParams.get('path') || '';
      try {
        const repoRef = parseRepoRef(integ.repo_full_name);
        if (kind === 'tree') return json({ path: p, ref, entries: await listTree(token, repoRef, p, ref) });
        return json({ path: p, ref, ...(await getFile(token, repoRef, p, ref)) });
      } catch (e) {
        return json({ error: String((e as Error).message ?? e) }, 502);
      }
    }

    // ── KB (Knowledge Base) endpoints (wallet-gated) ──
    const kbMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/kb(?:\/(upload|jobs|sync))?$/);
    if (kbMatch) {
      const lobbyId = kbMatch[1];
      const action = kbMatch[2]; // undefined, 'upload', 'jobs', or 'sync'
      const identityRef = sessionIdentity(lobbyId);
      if (!identityRef) return json({ error: 'authentication required' }, 401);
      if (!(await authorizeLobbyManager(store, lobbyId, identityRef))) return json({ error: 'not authorized to manage this lobby' }, 403);

      // GET .../kb — get KB settings
      if (req.method === 'GET' && !action) {
        const kb = await store.getKnowledgeBase(lobbyId);
        return json({ kb: kb || null });
      }

      // POST .../kb — update/create KB settings
      if (req.method === 'POST' && !action) {
        const body = await readBody(req);
        const repositoryUrl = typeof body.repository_url === 'string' ? body.repository_url.trim() : '';
        const branch = typeof body.branch === 'string' ? body.branch.trim() : 'main';
        const kbRootPath = typeof body.kb_root_path === 'string' ? body.kb_root_path.trim() : 'kb';
        if (!repositoryUrl) return json({ error: 'repository_url is required' }, 400);

        const existing = await store.getKnowledgeBase(lobbyId);
        const kb = await store.upsertKnowledgeBase({
          id: existing?.id || randomUUID(),
          lobby_id: lobbyId,
          repository_url: repositoryUrl,
          branch,
          kb_root_path: kbRootPath,
          latest_commit_sha: existing?.latest_commit_sha,
          last_synced_at: existing?.last_synced_at,
          last_indexed_at: existing?.last_indexed_at,
        });

        await recordEvent(lobbyId, 'kb_configured', identityRef, { repository_url: repositoryUrl, branch, kb_root_path: kbRootPath });
        return json({ kb });
      }

      // GET .../kb/jobs — list sync jobs
      if (req.method === 'GET' && action === 'jobs') {
        const jobs = await store.listKnowledgeSyncJobs(lobbyId);
        return json({ jobs });
      }

      // POST .../kb/sync — trigger manual Git repo sync / training
      if (req.method === 'POST' && action === 'sync') {
        const jobId = `job_${randomUUID()}`;
        const job = await store.upsertKnowledgeSyncJob({
          id: jobId,
          lobby_id: lobbyId,
          kb_id: (await store.getKnowledgeBase(lobbyId))?.id || 'none',
          source_provider: 'github',
          status: 'queued',
          created_by_identity_ref: identityRef,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

        // Trigger background sync task
        setTimeout(async () => {
          try {
            const { syncKnowledgeBaseCache } = await import('./kb/sync.js');
            await syncKnowledgeBaseCache(lobbyId, store);
            await store.upsertKnowledgeSyncJob({
              ...job,
              status: 'committed',
              updated_at: new Date().toISOString(),
            });
          } catch (err) {
            console.error(`[KB Sync] Manual sync job ${jobId} failed:`, err);
            await store.upsertKnowledgeSyncJob({
              ...job,
              status: 'failed',
              error: (err as Error).message,
              updated_at: new Date().toISOString(),
            });
          }
        }, 1000);

        return json({ job }, 202);
      }

      // POST .../kb/upload — upload file for KB conversion. Uploads carry base64 file content, so
      // they get their own (much larger) body limit — the 1 MiB control-plane default rejected any
      // real document and surfaced as "unknown error" in the panel.
      if (req.method === 'POST' && action === 'upload') {
        const body = await readBody(req, MAX_UPLOAD_BODY_BYTES);
        if (body.__body_too_large) {
          return json({ error: `file too large — uploads are limited to ~${Math.floor(MAX_UPLOAD_BODY_BYTES / 1_048_576 * 0.75)} MB per document` }, 413);
        }
        const fileName = typeof body.file_name === 'string' ? body.file_name.trim() : '';
        const mimeType = typeof body.mime_type === 'string' ? body.mime_type.trim() : '';
        const fileContentBase64 = typeof body.file_content === 'string' ? body.file_content : '';

        if (!fileName || !mimeType || !fileContentBase64) {
          return json({ error: 'file_name, mime_type, and file_content (base64) are required' }, 400);
        }

        const buffer = Buffer.from(fileContentBase64, 'base64');
        const jobId = `job_${randomUUID()}`;
        const job = await store.upsertKnowledgeSyncJob({
          id: jobId,
          lobby_id: lobbyId,
          kb_id: (await store.getKnowledgeBase(lobbyId))?.id || 'none',
          source_provider: 'upload',
          status: 'queued',
          created_by_identity_ref: identityRef,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

        // Trigger processing in the background asynchronously
        const { processKnowledgeSyncJob } = await import('./kb/jobs.js');
        processKnowledgeSyncJob(jobId, buffer, fileName, mimeType, store).catch((err) => {
          console.error(`[KB Upload] Async processing failed for job ${jobId}:`, err);
        });

        return json({ job }, 202);
      }
    }

    // The lobby only relays reads and sign-ready payload builders; signing and submission
    // happen in the owner's wallet, client-side. No keys pass through here.

    // GET /api/v1/agent-lobby/registry/status
    if (path === '/api/v1/agent-lobby/registry/status' && req.method === 'GET') {
      if (!registryMcp) return json({ configured: false });
      const network = url.searchParams.get('network') ?? 'mainnet';
      try {
        const capabilities = await registryMcp.callTool('agent_registry_capabilities', { network });
        return json({ configured: true, network, capabilities, sponsored: Boolean(registrySponsor) });
      } catch (e) {
        return json({ configured: true, network, sponsored: Boolean(registrySponsor), error: String((e as Error).message ?? e) }, 502);
      }
    }

    // GET /api/v1/agent-lobby/registry/tools
    if (path === '/api/v1/agent-lobby/registry/tools' && req.method === 'GET') {
      if (!registryMcp) return json({ error: 'agent registry MCP service not configured (set AGENT_OS_AGENT_REGISTRY_MCP_URL)' }, 503);
      try {
        const tools = (await registryMcp.listTools()).filter((t) => REGISTRY_TOOL_ALLOWLIST.has(t.name));
        return json({ tools });
      } catch (e) {
        return json({ error: String((e as Error).message ?? e) }, 502);
      }
    }

    // POST /api/v1/agent-lobby/registry/call — allowlisted tools/call relay
    if (path === '/api/v1/agent-lobby/registry/call' && req.method === 'POST') {
      if (!registryMcp) return json({ error: 'agent registry MCP service not configured (set AGENT_OS_AGENT_REGISTRY_MCP_URL)' }, 503);
      const body = await readBody(req);
      const tool = typeof body.tool === 'string' ? body.tool : '';
      if (!REGISTRY_TOOL_ALLOWLIST.has(tool)) {
        return json({ error: `tool not allowed: ${tool || '(missing)'}` }, 400);
      }
      const args = body.arguments && typeof body.arguments === 'object' ? body.arguments : {};
      try {
        const result = await registryMcp.callTool(tool, args);
        return json({ ok: true, tool, result });
      } catch (e) {
        // Return 200 with ok:false for a handled upstream MCP error. Clients inspect `ok` (e.g. the
        // optional agent_by_external_reference existence probe, which many MCP deployments 502 on
        // because they run without an Indexer). A 200 keeps the browser from logging a red network
        // error for an expected, already-handled failure.
        return json({ ok: false, tool, error: String((e as Error).message ?? e) });
      }
    }

    // POST /api/v1/agent-lobby/registry/sponsor — gasless mint relay to the Concordium sponsor
    // service. Forwards the wallet-built unsigned Transaction.JSON and returns the partially-signed
    // transaction (sponsor co-signature attached) for the owner's wallet to complete and submit.
    // No keys pass through the lobby; the request/response are opaque transaction JSON.
    if (path === '/api/v1/agent-lobby/registry/sponsor' && req.method === 'POST') {
      if (!registrySponsor) {
        return json({ ok: false, error: 'sponsored minting not available (no registry MCP service, or AGENT_OS_REGISTRY_SPONSOR_URL is empty)' }, 503);
      }
      const body = await readBody(req);
      const genesisHash = typeof body.genesisHash === 'string' ? body.genesisHash : '';
      const sender = typeof body.sender === 'string' ? body.sender : '';
      const nonce = typeof body.nonce === 'number' ? body.nonce : Number(body.nonce);
      const payload = body.payload && typeof body.payload === 'object' ? (body.payload as Record<string, unknown>) : null;
      if (!genesisHash || !sender || !payload || !Number.isInteger(nonce) || nonce <= 0) {
        return json({ ok: false, error: 'sponsor request requires genesisHash, sender, positive integer nonce, and an unsigned payload object' }, 400);
      }
      try {
        const transaction = await registrySponsor.sponsor({ genesisHash, payload, sender, nonce });
        return json({ ok: true, transaction });
      } catch (e) {
        return json({ ok: false, error: String((e as Error).message ?? e) }, 502);
      }
    }

    // POST /api/v1/agent-lobby/agent-cards
    if (path === '/api/v1/agent-lobby/agent-cards' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.did || !body.card) {
        return json({ error: 'missing did or card' }, 400);
      }
      const MAX_CARDS = 5000;
      const MAX_CARD_BYTES = 65_536;
      if (JSON.stringify(body.card).length > MAX_CARD_BYTES) {
        return json({ error: 'card too large' }, 413);
      }
      if (!agentCards.has(body.did) && agentCards.size >= MAX_CARDS) {
        return json({ error: 'card store full' }, 507);
      }
      agentCards.set(body.did, body.card);
      persistCards();
      console.log(`[lobby-server] Stored agent card: ${body.did}`);
      if (typeof body.lobby_id === 'string') {
        const card = body.card as Record<string, unknown>;
        await recordEvent(body.lobby_id, 'agent_card_published', String(card?.owner ?? 'unknown'), {
          did: body.did,
          name: card?.name,
          signed: Boolean(card?.signature),
        });
      }
      return json({ ok: true, url: `${url.origin}/agent-cards/${encodeURIComponent(body.did)}` }, 201);
    }

    // GET /api/v1/agent-lobby/agent-cards/:did or /agent-cards/:did
    // DID contains colons so we match everything after /agent-cards/
    const agentCardMatch = path.match(/^(?:\/api\/v1\/agent-lobby)?\/agent-cards\/(.+)$/);
    if (agentCardMatch && req.method === 'GET') {
      const did = decodeURIComponent(agentCardMatch[1]);
      const card = agentCards.get(did);
      if (!card) return json({ error: 'agent card not found', did, stored: Array.from(agentCards.keys()) }, 404);
      return json(card);
    }

    // Public discovery — shape matches what the Panel/relay parse.
    if (path === '/api/v1/agent-lobby/discover' && req.method === 'GET') {
      const lobby = autoDefault ? await ensureDefaultLobby() : (await store.listLobbies()).find((l) => l.status === 'active');
      return json({ lobby: lobby ? { lobby_id: lobby.lobby_id, org_id: lobby.org_id, name: lobby.name, visibility: lobby.visibility, join_policy: lobby.join_policy } : null });
    }

    if (path === '/api/v1/agent-lobby/lobbies' && req.method === 'GET') {
      return json({ lobbies: await store.listLobbies() });
    }

    if (path === '/api/v1/agent-lobby/stats' && req.method === 'GET') {
      const lobbies = await store.listLobbies();
      let connected_users = 0;
      let connected_agents = 0;
      let verified_agents = 0;
      const seenAgents = new Set<string>();

      for (const lobby of lobbies) {
        const roster = await store.roster(lobby.lobby_id);
        for (const agent of roster) {
          if (seenAgents.has(agent.agent_id)) continue;
          seenAgents.add(agent.agent_id);

          if (agent.participant_type === 'human' || agent.role === 'human') {
            connected_users++;
          } else {
            connected_agents++;
            if (agent.identity_status === 'registry_verified' || agent.identity_status === 'human_linked' || agent.identity_status === 'org_linked') {
              verified_agents++;
            }
          }
        }
      }

      return json({
        connected_users,
        connected_agents,
        verified_agents,
        total_lobbies: lobbies.length,
        public_lobbies: lobbies.filter(l => l.visibility === 'public').length,
        private_lobbies: lobbies.filter(l => l.visibility === 'private').length
      });
    }

    if (path === '/api/v1/agent-lobby/lobbies' && req.method === 'POST') {
      const body = await readBody(req);
      // Validate enums — these values flow into stored lobby records and dashboard markup.
      const visibility = body.visibility === 'private' ? 'private' : 'public';
      const JOIN_POLICIES = new Set(['none', 'registered', 'allowlisted', 'verified_human_link']);
      const joinPolicy = JOIN_POLICIES.has(body.join_policy) ? body.join_policy : undefined;
      const allowlist = Array.isArray(body.allowlist)
        ? body.allowlist.filter((x: unknown) => typeof x === 'string').slice(0, 200)
        : undefined;
      const now = new Date().toISOString();
      // Hosted Mode: bind the lobby to the creating wallet so it (and only it) can manage config
      // later. `owner_identity_ref` is trusted at creation as first-writer — claiming a wallet you
      // don't control only locks YOU out, since managing the lobby later requires proving that
      // wallet (auth/verify). Legacy/local callers omit it and get the unowned 'system' default.
      const ownerRef = typeof body.owner_identity_ref === 'string' && body.owner_identity_ref.trim()
        ? body.owner_identity_ref.trim()
        : (typeof body.created_by === 'string' ? body.created_by : 'system');
      const lobbyId = randomUUID();
      const lobby: LobbySession = {
        lobby_id: lobbyId,
        org_id: typeof body.org_id === 'string' ? body.org_id : 'default',
        name: typeof body.name === 'string' ? body.name.slice(0, 120) : 'Lobby',
        status: 'active',
        visibility,
        join_policy: joinPolicy,
        allowlist,
        connected_agent_ids: [],
        message_seq: 0,
        created_at: now,
        updated_at: now,
        created_by: ownerRef,
      };
      await store.createLobby(lobby);
      // Record the owner as a member so isLobbyManager resolves via membership too.
      if (ownerRef !== 'system') {
        await store.addMember({
          id: `mem_${randomUUID()}`,
          lobby_id: lobbyId,
          identity_ref: ownerRef,
          role: 'owner',
          status: 'active',
        });
      }
      return json({ lobby }, 201);
    }

    const lobbyMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)(\/(roster|events|messages|members))?$/);
    if (lobbyMatch && req.method === 'GET') {
      const lobbyId = lobbyMatch[1];
      const sub = lobbyMatch[3];
      if (sub === 'roster') return json({ agents: await store.roster(lobbyId) });
      if (sub === 'events') return json({ events: await store.listEvents(lobbyId) });
      if (sub === 'messages') return json({ messages: await store.listMessages(lobbyId) });
      if (sub === 'members') return json({ members: await store.listMembers(lobbyId) });
      const lobby = await store.getLobby(lobbyId);
      return lobby ? json({ lobby }) : json({ error: 'not found' }, 404);
    }

    // ── Lobby management (Manage view): settings + membership ──

    // PATCH /api/v1/agent-lobby/lobbies/:id — update name / visibility / join policy / allowlist
    const lobbySettingsMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)$/);
    if (lobbySettingsMatch && req.method === 'PATCH') {
      const lobbyId = lobbySettingsMatch[1];
      const lobby = await store.getLobby(lobbyId);
      if (!lobby) return json({ error: 'lobby not found' }, 404);
      const body = await readBody(req);
      const patch: Record<string, unknown> = {};
      if (typeof body.name === 'string') patch.name = body.name.slice(0, 120);
      if (body.visibility === 'public' || body.visibility === 'private') patch.visibility = body.visibility;
      const JOIN_POLICIES = new Set(['none', 'registered', 'allowlisted', 'verified_human_link']);
      if (JOIN_POLICIES.has(body.join_policy)) patch.join_policy = body.join_policy;
      if (Array.isArray(body.allowlist)) {
        patch.allowlist = body.allowlist.filter((x: unknown) => typeof x === 'string').slice(0, 200);
      }
      if (body.status === 'active' || body.status === 'paused' || body.status === 'closed') {
        patch.status = body.status;
      }
      const updated = await store.updateLobby(lobbyId, patch);
      await recordEvent(lobbyId, 'lobby_settings_updated', String(body.actor ?? 'web-user'), { changed: Object.keys(patch) });
      return json({ lobby: updated });
    }

    // POST /api/v1/agent-lobby/lobbies/:id/agents/:slug/identity — update DID identity reference in GitHub repo
    const agentIdentityMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/agents\/([^/]+)\/identity$/);
    if (agentIdentityMatch && req.method === 'POST') {
      const lobbyId = agentIdentityMatch[1];
      const slug = agentIdentityMatch[2];
      const identityRef = sessionIdentity(lobbyId);
      if (!identityRef) return json({ error: 'authentication required' }, 401);
      if (!(await authorizeLobbyManager(store, lobbyId, identityRef))) return json({ error: 'not authorized to manage this lobby' }, 403);

      const body = await readBody(req);
      if (typeof body.identity !== 'string' || !body.identity.trim()) {
        return json({ error: 'identity is required' }, 400);
      }

      const integration = await store.getIntegration(lobbyId, 'github');
      if (!integration || !integration.repo_full_name) {
        return json({ error: 'no connected GitHub repository — connect the GitHub App and select a repository in the Lobby tab' }, 400);
      }

      const token = await githubTokenForLobby(lobbyId, store);
      if (!token) return json({ error: 'could not mint a GitHub installation token — reconnect the GitHub App in the Lobby tab' }, 400);

      const parsed = repoRef(integration.repo_full_name);
      if (!parsed) return json({ error: 'invalid GitHub repository URL' }, 400);

      const { GitHubRepoClient } = await import('./hosted/github-repo-client.js');
      const client = new GitHubRepoClient(parsed.owner, parsed.repo, token);
      const branchName = integration.branch || 'main';

      const filePath = `agent-os/sub-agents/agents/${slug}.md`;
      const identityLine = `Identity: ${body.identity.trim()}`;
      let newContent = '';
      let content = '';
      try {
        content = await client.readFile(filePath, branchName);
      } catch {
        // The connected repo has no definition file for this agent — normal for a user's own
        // project repo, which starts without the agent-os structure. BOOTSTRAP the file from the
        // built-in catalog definition (or a minimal stub) instead of failing the bind: this is
        // exactly the DID-persistence step the mint flow promises.
        const defs = await getAgentDefinitions(lobbyId, store).catch(() => [] as any[]);
        const def = defs.find((d: any) => d.slug === slug);
        newContent = [
          `Title: ${def?.name ?? slug}`,
          identityLine,
          `Slug: ${slug}`,
          ...(def?.scope ? [`Scope: ${def.scope}`] : []),
          ...(def?.runtime ? [`Runtime: ${def.runtime}`] : []),
          ...(def?.model ? [`Model: ${def.model}`] : []),
          '',
          def?.system_prompt ?? '',
        ].join('\n').trimEnd() + '\n';
      }

      if (!newContent) {
        if (content.match(/^Identity:\s*(.+)$/m)) {
          newContent = content.replace(/^Identity:\s*(.+)$/m, identityLine);
        } else if (content.match(/^Title:\s*(.+)$/m)) {
          newContent = content.replace(/^(Title:\s*.+)$/m, `$1\n${identityLine}`);
        } else {
          newContent = `${identityLine}\n${content}`;
        }
      }

      try {
        await client.writeFile(filePath, newContent, `chore: bind Agent ID identity ref to ${slug}`, branchName);
        // restartRequired: identity is presented at REGISTER time (join_token) — a running agent
        // keeps its old roster identity until it is relaunched with the new DID.
        invalidateAgentDefs(lobbyId);
        return json({ ok: true, identity: body.identity.trim(), restartRequired: true });
      } catch (err: any) {
        return json({ error: `failed to write to GitHub repository: ${githubErrorMessage(err)}` }, 500);
      }
    }

    // POST /api/v1/agent-lobby/lobbies/:id/members — invite a member
    const membersMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/members$/);
    if (membersMatch && req.method === 'POST') {
      const lobbyId = membersMatch[1];
      const lobby = await store.getLobby(lobbyId);
      if (!lobby) return json({ error: 'lobby not found' }, 404);
      const body = await readBody(req);
      const identityRef = typeof body.identity_ref === 'string' ? body.identity_ref.trim() : '';
      if (!identityRef) return json({ error: 'identity_ref is required' }, 400);
      const ROLES = new Set(['owner', 'admin', 'boss', 'contributor', 'observer', 'agent']);
      const role = ROLES.has(body.role) ? body.role : 'contributor';
      const existing = await store.getMember(lobbyId, identityRef);
      if (existing) {
        // Re-inviting a revoked member re-activates the invite.
        const reinvited = await store.updateMember(lobbyId, existing.id, { status: 'invited', role });
        return json({ member: reinvited });
      }
      const member = await store.addMember({
        id: randomUUID(),
        lobby_id: lobbyId,
        identity_ref: identityRef,
        role,
        status: 'invited',
        invited_by_identity_ref: typeof body.invited_by_identity_ref === 'string' ? body.invited_by_identity_ref : undefined,
      });
      // Keep the lobby allowlist in sync so the join policy actually admits the invitee.
      const allowlist = new Set(lobby.allowlist ?? []);
      allowlist.add(identityRef);
      await store.updateLobby(lobbyId, { allowlist: [...allowlist] });
      await recordEvent(lobbyId, 'member_invited', String(body.invited_by_identity_ref ?? 'web-user'), { identity_ref: identityRef, role });
      return json({ member }, 201);
    }

    // POST /api/v1/agent-lobby/lobbies/:id/members/:memberId/status — activate / revoke (kick)
    const memberStatusMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/members\/([^/]+)\/status$/);
    if (memberStatusMatch && req.method === 'POST') {
      const lobbyId = memberStatusMatch[1];
      const memberId = memberStatusMatch[2];
      const body = await readBody(req);
      const status = body.status;
      if (status !== 'active' && status !== 'revoked' && status !== 'invited') {
        return json({ error: 'status must be active, invited, or revoked' }, 400);
      }
      const updated = await store.updateMember(lobbyId, memberId, { status });
      if (!updated) return json({ error: 'member not found' }, 404);
      if (status === 'revoked') {
        // Kicking: drop the member from the allowlist so they can no longer (re)join.
        const lobby = await store.getLobby(lobbyId);
        if (lobby?.allowlist?.length) {
          await store.updateLobby(lobbyId, { allowlist: lobby.allowlist.filter((r) => r !== updated.identity_ref) });
        }
        await recordEvent(lobbyId, 'member_revoked', String(body.actor ?? 'web-user'), { identity_ref: updated.identity_ref });
      }
      return json({ member: updated });
    }

    if (lobbyMatch && req.method === 'POST') {
      const lobbyId = lobbyMatch[1];
      const sub = lobbyMatch[3];
      if (sub === 'messages') {
        const body = await readBody(req);
        const lobby = await store.getLobby(lobbyId);
        if (!lobby) return json({ error: 'Lobby not found' }, 404);

        // Sender attribution: a wallet-authenticated lobby manager speaks as LobbyOwner — the
        // accountable human running this lobby — not as an anonymous "WebUser". The generic
        // default only applies to unauthenticated visitors, and a client-supplied name can never
        // claim the LobbyOwner label without holding a manager session (anti-spoofing).
        let fromId = typeof body.from_agent_id === 'string' && body.from_agent_id.trim() ? body.from_agent_id.trim() : '';
        const senderIdentity = sessionIdentity(lobbyId);
        const senderIsManager = senderIdentity ? await isLobbyManager(store, lobbyId, senderIdentity) : false;
        if (senderIsManager && (!fromId || fromId === 'WebUser' || fromId === 'LobbyOwner')) {
          fromId = 'LobbyOwner';
        } else if (!senderIsManager && fromId === 'LobbyOwner') {
          fromId = 'WebUser';
        } else if (!fromId) {
          fromId = 'WebUser';
        }
        const roster = await store.roster(lobbyId);
        if (roster.some((a) => a.agent_id === fromId && a.status !== 'disconnected')) {
          return json({ error: 'from_agent_id belongs to a connected agent — send via the agent WebSocket instead' }, 403);
        }

        const seq = await store.nextSeq(lobbyId);
        const message: LobbyMessage = {
          message_id: randomUUID(),
          seq,
          from_agent_id: fromId,
          to_agent_id: body.to_agent_id || 'all',
          message_type: body.message_type || 'chat',
          content: body.content || '',
          created_at: new Date().toISOString(),
          delivered: false,
        };
        await store.appendMessage(lobbyId, message);
        await recordEvent(lobbyId, 'message_sent', message.from_agent_id, {
          to: message.to_agent_id,
          content: message.content,
        });

        // Broadcast to WebSocket connections in this lobby
        const outMsg: LobbyToAgentMessage = { type: 'lobby-message-received', message };
        for (const cid of lobbyConns.get(lobbyId) ?? []) {
          send(cid, outMsg);
        }

        return json({ message }, 201);
      }
    }

    // --- Task Marketplace Routes ---
    
    // POST /api/v1/agent-lobby/issuers
    if (path === '/api/v1/agent-lobby/issuers' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.issuer_did || !body.identity_ref) {
        return json({ error: 'missing issuer_did or identity_ref' }, 400);
      }
      const record = await store.registerIssuer({
        issuer_did: body.issuer_did,
        identity_ref: body.identity_ref,
        registered_at: new Date().toISOString(),
        revoked: false
      });
      if (typeof body.lobby_id === 'string') {
        await recordEvent(body.lobby_id, 'owner_registered', body.identity_ref, {
          issuer_did: body.issuer_did,
          owner_name: body.owner_name,
          signed: Boolean(body.signature),
        });
      }
      return json({ record }, 201);
    }

    // POST / GET /api/v1/agent-lobby/lobbies/:id/tasks
    // Two task systems share this path: COORDINATION tasks (the coordinator's LobbyTask — what the
    // Boss's `[task]` directives create and what the panel's Tasks kanban shows) and MARKETPLACE
    // tasks (budget/escrow — the web app's marketplace). POST discriminates by shape: `assigned_to`
    // means a coordination task; a budget/escrow body means a marketplace posting. GET returns both,
    // under separate keys, so each UI reads its own list.
    const taskListMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/tasks$/);
    if (taskListMatch) {
      const lobbyId = taskListMatch[1];
      if (req.method === 'POST') {
        const body = await readBody(req);
        if (!body.title) {
          return json({ error: 'missing title' }, 400);
        }
        const description = typeof body.description === 'string' ? body.description : '';

        // Coordination task — assigned to a named roster agent, delivered like a Boss-created task.
        if (typeof body.assigned_to === 'string' && body.assigned_to.trim()) {
          const assignedTo = body.assigned_to.trim();
          const target = await store.getAgent(lobbyId, assignedTo);
          if (!target) return json({ error: `unknown assignee: ${assignedTo}` }, 400);
          const lobby = await store.getLobby(lobbyId);
          if (!lobby) return json({ error: 'Lobby not found' }, 404);
          // Attribute the assigner: an authenticated lobby manager is the LobbyOwner.
          const creatorIdentity = sessionIdentity(lobbyId);
          const creatorIsManager = creatorIdentity ? await isLobbyManager(store, lobbyId, creatorIdentity) : false;
          const seq = await store.nextSeq(lobbyId);
          const task = {
            task_id: randomUUID(),
            lobby_id: lobbyId,
            org_id: lobby.org_id,
            assigned_by: (typeof body.assigned_by === 'string' && body.assigned_by.trim()) || (creatorIsManager ? 'LobbyOwner' : 'WebUser'),
            assigned_to: assignedTo,
            assigned_at: new Date().toISOString(),
            title: String(body.title).slice(0, 200),
            description,
            priority: (['critical', 'high', 'normal', 'low'].includes(body.priority) ? body.priority : 'normal') as 'critical' | 'high' | 'normal' | 'low',
            category: typeof body.category === 'string' ? body.category : 'general',
            status: 'assigned' as const,
            seq,
          };
          await store.upsertTask(task as Parameters<typeof store.upsertTask>[0]);
          await recordEvent(lobbyId, 'task_created', task.assigned_by, { task_id: task.task_id, assigned_to: assignedTo });
          // Deliver to the assignee (hosted agents act on lobby-task-assigned) + tell the lobby.
          send(agentConn.get(assignedTo), { type: 'lobby-task-assigned', task } as LobbyToAgentMessage);
          for (const cid of lobbyConns.get(lobbyId) ?? []) {
            send(cid, { type: 'lobby-task-updated', task } as LobbyToAgentMessage);
          }
          return json({ task }, 201);
        }

        const proposed_budget_ccd = typeof body.proposed_budget_ccd === 'number' ? body.proposed_budget_ccd : 0;
        const task = await store.createMarketplaceTask({
          id: randomUUID(),
          lobby_id: lobbyId,
          title: body.title,
          description,
          proposed_budget_ccd,
          status: 'posted',
          posted_by_identity_ref: body.posted_by_identity_ref ?? 'anonymous',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          escrow_signature: typeof body.escrow_signature === 'string' ? body.escrow_signature : undefined,
        });
        await recordEvent(lobbyId, 'task_created', task.posted_by_identity_ref, {
          task_id: task.id,
          title: task.title,
          budget_ccd: task.proposed_budget_ccd,
          escrow_signed: Boolean(task.escrow_signature),
        });
        return json({ task }, 201);
      }
      if (req.method === 'GET') {
        const tasks = await store.listMarketplaceTasks(lobbyId);
        const coordination_tasks = await store.listTasks(lobbyId);
        return json({ tasks, coordination_tasks });
      }
    }

    // PATCH /api/v1/agent-lobby/lobbies/:id/tasks/:taskId — coordination task first, else marketplace.
    const taskUpdateMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/tasks\/([^/]+)$/);
    if (taskUpdateMatch && req.method === 'PATCH') {
      const lobbyId = taskUpdateMatch[1];
      const taskId = taskUpdateMatch[2];
      const body = await readBody(req);
      const coordTask = await store.getTask(lobbyId, taskId);
      if (coordTask) {
        const STATUSES = new Set(['pending', 'assigned', 'accepted', 'in_progress', 'completed', 'failed', 'cancelled']);
        const updatedTask = {
          ...coordTask,
          ...(STATUSES.has(body.status) ? { status: body.status } : {}),
          ...(typeof body.progress === 'string' ? { progress: body.progress } : {}),
          ...(typeof body.result === 'string' ? { result: body.result } : {}),
        };
        await store.upsertTask(updatedTask);
        const patchIdentity = sessionIdentity(lobbyId);
        const patchIsManager = patchIdentity ? await isLobbyManager(store, lobbyId, patchIdentity) : false;
        await recordEvent(lobbyId, 'task_updated', patchIsManager ? 'LobbyOwner' : 'WebUser', { task_id: taskId, status: updatedTask.status });
        for (const cid of lobbyConns.get(lobbyId) ?? []) {
          send(cid, { type: 'lobby-task-updated', task: updatedTask } as LobbyToAgentMessage);
        }
        // Reopen semantics: setting a task back to 'assigned' RE-DELIVERS it to the assignee —
        // hosted agents execute on lobby-task-assigned, so without this a reopened task sat
        // "assigned" forever with nobody told.
        if (body.status === 'assigned' && updatedTask.assigned_to) {
          send(agentConn.get(updatedTask.assigned_to), { type: 'lobby-task-assigned', task: updatedTask } as LobbyToAgentMessage);
        }
        return json({ task: updatedTask });
      }
      const updated = await store.updateMarketplaceTask(lobbyId, taskId, body);
      return json({ task: updated });
    }

    // POST /api/v1/agent-lobby/lobbies/:id/tasks/:taskId/delete — coordination task first, else marketplace.
    const taskDeleteMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/tasks\/([^/]+)\/delete$/);
    if (taskDeleteMatch && req.method === 'POST') {
      const lobbyId = taskDeleteMatch[1];
      const taskId = taskDeleteMatch[2];
      const deletedCoord = await store.deleteTask(lobbyId, taskId);
      if (!deletedCoord) await store.deleteMarketplaceTask(lobbyId, taskId);
      return json({ ok: true });
    }

    // POST /api/v1/agent-lobby/lobbies/:id/messages/clear
    const clearMessagesMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/messages\/clear$/);
    if (clearMessagesMatch && req.method === 'POST') {
      const lobbyId = clearMessagesMatch[1];
      const identityRef = sessionIdentity(lobbyId);
      if (!identityRef) return json({ error: 'authentication required' }, 401);
      if (!(await authorizeLobbyManager(store, lobbyId, identityRef))) return json({ error: 'not authorized' }, 403);
      await store.clearMessages(lobbyId);
      return json({ ok: true });
    }

    // POST /api/v1/agent-lobby/lobbies/:id/boss-agent
    const bossAgentMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/boss-agent$/);
    if (bossAgentMatch && req.method === 'POST') {
      const lobbyId = bossAgentMatch[1];
      const identityRef = sessionIdentity(lobbyId);
      if (!identityRef) return json({ error: 'authentication required' }, 401);
      if (!(await authorizeLobbyManager(store, lobbyId, identityRef))) return json({ error: 'not authorized to manage this lobby' }, 403);

      const body = await readBody(req);
      const agentId = body.agent_id;
      if (!agentId) return json({ error: 'agent_id is required' }, 400);

      const lobby = await store.getLobby(lobbyId);
      if (!lobby) return json({ error: 'lobby not found' }, 404);

      const target = await store.getAgent(lobbyId, agentId);
      if (!target) return json({ error: `unknown agent: ${agentId}` }, 404);

      if (lobby.boss_agent_id) {
        await store.updateAgent(lobbyId, lobby.boss_agent_id, { is_boss: false }).catch(() => null);
      }
      await store.updateAgent(lobbyId, agentId, { is_boss: true });
      await store.updateLobby(lobbyId, { boss_agent_id: agentId });

      await recordEvent(lobbyId, 'boss_appointed', identityRef, { boss: agentId });

      // Broadcast to WebSocket clients
      const out: LobbyToAgentMessage = { type: 'lobby-boss-appointed', agent_id: agentId };
      for (const cid of lobbyConns.get(lobbyId) ?? []) {
        send(cid, out);
      }

      return json({ ok: true, boss_agent_id: agentId });
    }

    // GET /api/v1/agent-lobby/lobbies/:id/gantt/phases — the lobby's OWN plan, not demo data.
    // Phases/sprints come from `agent-os/planning.json` in the connected repo (seeded empty by
    // initialization; the LobbyOwner or agents edit it); live coordination tasks are appended as a
    // synthetic phase so real in-flight work is always visible. The old handler returned this
    // deployment's hardcoded roadmap for every lobby.
    const ganttMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/gantt\/phases$/);
    if (ganttMatch && req.method === 'GET') {
      const lobbyId = ganttMatch[1];
      const identityRef = sessionIdentity(lobbyId);
      if (!identityRef) return json({ error: 'authentication required' }, 401);

      const phases: any[] = [];
      let repoLabel: string | null = null;
      let planningFound = false;
      const integ = await store.getIntegration(lobbyId, 'github');
      if (integ?.status === 'active' && integ.repo_full_name) {
        repoLabel = `${integ.repo_full_name}@${integ.branch || 'main'}`;
        try {
          const token = await githubTokenForLobby(lobbyId, store);
          const parsed = token ? (repoRef(integ.repo_full_name)) : null;
          if (token && parsed) {
            const { GitHubRepoClient } = await import('./hosted/github-repo-client.js');
            const client = new GitHubRepoClient(parsed.owner, parsed.repo, token);
            const raw = await client.readFile('agent-os/planning.json', integ.branch || 'main');
            const plan = JSON.parse(raw);
            planningFound = true;
            for (const p of (Array.isArray(plan?.phases) ? plan.phases : [])) {
              const sprints = Array.isArray(p.sprints) ? p.sprints : [];
              phases.push({
                id: String(p.id ?? `phase-${phases.length + 1}`),
                name: String(p.name ?? `Phase ${phases.length + 1}`),
                sprintCount: sprints.length,
                completedSprints: sprints.filter((s: any) => s?.status === 'complete').length,
                status: p.status ?? 'planned',
                tasks: sprints.map((s: any) => ({ id: String(s?.id ?? ''), name: String(s?.name ?? ''), status: s?.status ?? 'planned' })),
              });
            }
          }
        } catch { /* no planning.json yet — fall through with planningFound=false */ }
      }

      // Live coordination tasks — real work in flight, independent of the written plan.
      const liveTasks = await store.listTasks(lobbyId);
      if (liveTasks.length) {
        const roster = await store.roster(lobbyId);
        const nameOf = (id: string) => roster.find(a => a.agent_id === id)?.display_name || id;
        const done = liveTasks.filter(t => t.status === 'completed').length;
        phases.push({
          id: 'live-tasks',
          name: 'Lobby Tasks (live)',
          sprintCount: liveTasks.length,
          completedSprints: done,
          status: done === liveTasks.length ? 'complete' : 'active',
          tasks: liveTasks.map(t => ({ id: t.task_id, name: `${t.title} → ${nameOf(t.assigned_to)}`, status: t.status })),
        });
      }

      return json({ phases, repo: repoLabel, planning_found: planningFound });
    }

    // GET /api/v1/agent-lobby/lobbies/:id/requests/pending
    const pendingRequestsMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/requests\/pending$/);
    if (pendingRequestsMatch && req.method === 'GET') {
      const lobbyId = pendingRequestsMatch[1];
      const requests = await store.listLobbyRequests(lobbyId);
      const pending = requests.filter((r) => r.status === 'pending');
      return json({ requests: pending });
    }

    // POST /api/v1/agent-lobby/lobbies/:id/requests/:requestId/decide
    const decideRequestMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/requests\/([^/]+)\/decide$/);
    if (decideRequestMatch && req.method === 'POST') {
      const lobbyId = decideRequestMatch[1];
      const requestId = decideRequestMatch[2];
      const body = await readBody(req);
      const updated = await applyRequestDecision(lobbyId, requestId, body.decision || 'approved', body.decided_by || 'panel', body.decision_notes || '');
      if (updated === 'not-found') return json({ error: 'request not found' }, 404);
      if (!updated) return json({ error: 'failed to update request' }, 500);
      return json({ ok: true, request: updated });
    }

    // GET /api/v1/agent-lobby/lobbies/:id/providers/:provider/models
    const providerModelsMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/providers\/([^/]+)\/models$/);
    if (providerModelsMatch && req.method === 'GET') {
      const lobbyId = providerModelsMatch[1];
      const provider = providerModelsMatch[2];
      const identityRef = sessionIdentity(lobbyId);
      if (!identityRef) return json({ error: 'authentication required' }, 401);
      if (!(await authorizeLobbyManager(store, lobbyId, identityRef))) return json({ error: 'not authorized to manage this lobby' }, 403);

      const resolved = await resolveProviderKey(store, lobbyId, provider).catch(() => null);
      if (!resolved || !resolved.apiKey) {
        return json({ error: 'provider key not configured' }, 400);
      }

      try {
        if (provider === 'openai') {
          const resModels = await fetch('https://api.openai.com/v1/models', {
            headers: {
              'Authorization': `Bearer ${resolved.apiKey}`
            }
          });
          if (!resModels.ok) throw new Error(`OpenAI API returned status ${resModels.status}: ${resModels.statusText}`);
          const data = await resModels.json() as any;
          const models = (data.data || []).map((m: any) => m.id).sort();
          return json({ models });
        } else if (provider === 'anthropic') {
          const resModels = await fetch('https://api.anthropic.com/v1/models', {
            headers: {
              'x-api-key': resolved.apiKey,
              'anthropic-version': '2023-06-01'
            }
          });
          if (!resModels.ok) throw new Error(`Anthropic API returned status ${resModels.status}: ${resModels.statusText}`);
          const data = await resModels.json() as any;
          const models = (data.data || []).map((m: any) => m.id);
          return json({ models });
        } else {
          // openai-compatible
          const url = resolved.baseUrl ? `${resolved.baseUrl.replace(/\/$/, '')}/models` : 'https://api.openai.com/v1/models';
          const resModels = await fetch(url, {
            headers: {
              'Authorization': `Bearer ${resolved.apiKey}`
            }
          });
          if (!resModels.ok) throw new Error(`Provider API returned status ${resModels.status}: ${resModels.statusText}`);
          const data = await resModels.json() as any;
          const models = (data.data || []).map((m: any) => m.id).sort();
          return json({ models });
        }
      } catch (err: any) {
        return json({ error: err.message ?? String(err) }, 500);
      }
    }

    // POST /api/v1/agent-lobby/lobbies/:id/tasks/:taskId/bid
    const bidMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/tasks\/([^/]+)\/bid$/);
    if (bidMatch && req.method === 'POST') {
      const lobbyId = bidMatch[1];
      const taskId = bidMatch[2];
      const body = await readBody(req);
      if (!body.agent_did || !body.bidder_identity_ref) {
        return json({ error: 'missing agent_did or bidder_identity_ref' }, 400);
      }
      
      const task = await store.getMarketplaceTask(lobbyId, taskId);
      if (!task) return json({ error: 'task not found' }, 404);
      
      // Verification check for agent DID and trust chain mapping to Concordium ID registry
      const verification = await coordinator.verifyIdentity(body.agent_did);
      if (verification.status === 'failed' || verification.status === 'pending' || verification.status === 'unverified') {
        return json({ error: `agent identity verification failed: ${verification.reason || 'identity unverified'}` }, 401);
      }
      const issuer = verification.issuerDid ? await store.getIssuer(verification.issuerDid) : undefined;
      if (!issuer || issuer.revoked) {
        return json({ error: 'agent credential issuer is not registered or is revoked on Concordium' }, 401);
      }
      
      const bid = await store.addTaskBid({
        id: randomUUID(),
        task_id: taskId,
        agent_did: body.agent_did,
        bidder_identity_ref: body.bidder_identity_ref,
        created_at: new Date().toISOString()
      });
      
      if (task.status === 'posted') {
        await store.updateMarketplaceTask(lobbyId, taskId, { status: 'bidded' });
      }
      
      return json({ bid }, 201);
    }

    // GET /api/v1/agent-lobby/lobbies/:id/tasks/:taskId/bids
    const getBidsMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/tasks\/([^/]+)\/bids$/);
    if (getBidsMatch && req.method === 'GET') {
      const taskId = getBidsMatch[2];
      const bids = await store.listTaskBids(taskId);
      return json({ bids });
    }

    // POST /api/v1/agent-lobby/lobbies/:id/tasks/:taskId/assign
    const assignMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/tasks\/([^/]+)\/assign$/);
    if (assignMatch && req.method === 'POST') {
      const lobbyId = assignMatch[1];
      const taskId = assignMatch[2];
      const body = await readBody(req);
      if (!body.assigned_agent_id) {
        return json({ error: 'missing assigned_agent_id' }, 400);
      }
      const task = await store.getMarketplaceTask(lobbyId, taskId);
      if (!task) return json({ error: 'task not found' }, 404);
      
      const updated = await store.updateMarketplaceTask(lobbyId, taskId, {
        status: 'assigned',
        assigned_agent_id: body.assigned_agent_id,
        assigned_agent_ref: body.assigned_agent_ref
      });
      await recordEvent(lobbyId, 'task_updated', task.posted_by_identity_ref, {
        task_id: taskId,
        status: 'assigned',
        assigned_agent_id: body.assigned_agent_id,
      });
      return json({ task: updated });
    }

    // POST /api/v1/agent-lobby/lobbies/:id/tasks/:taskId/complete
    const completeMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/tasks\/([^/]+)\/complete$/);
    if (completeMatch && req.method === 'POST') {
      const lobbyId = completeMatch[1];
      const taskId = completeMatch[2];
      const body = await readBody(req);
      const task = await store.getMarketplaceTask(lobbyId, taskId);
      if (!task) return json({ error: 'task not found' }, 404);
      
      const updated = await store.updateMarketplaceTask(lobbyId, taskId, {
        status: 'completed',
        tx_hash: typeof body.tx_hash === 'string' ? body.tx_hash : undefined,
        release_signature: typeof body.release_signature === 'string' ? body.release_signature : undefined,
      });
      await recordEvent(lobbyId, 'task_updated', task.posted_by_identity_ref, {
        task_id: taskId,
        status: 'completed',
        release_signed: Boolean(body.release_signature),
      });
      return json({ task: updated });
    }

    // Static file serving fallback for local preview/dashboard
    const MIME_TYPES: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.svg': 'image/svg+xml; charset=utf-8',
      '.png': 'image/png',
      '.ico': 'image/x-icon',
    };

    // ── Hosted full Agent OS Panel (Phase 1) ──
    // Serve the Agent OS Panel SPA under /panel so the hosted lobby offers the full panel experience
    // (all sub-menus), not just the Hosted-Mode widget. A hosted-mode flag is injected into the
    // panel's index.html so the SPA adapts (routes its data at the lobby, hides local-only views).
    // The panel's hosted backend (roster/agents/tasks/identity → lobby + hosted-agents) is wired
    // view-by-view in subsequent phases; see docs/hosted-panel.md.
    if (path === '/panel' || path === '/panel/' || path.startsWith('/panel/')) {
      const panelDir = resolve(fileURLToPath(import.meta.url), '../../../../agent-os-panel');
      const rel = path === '/panel' || path === '/panel/' ? 'index.html' : path.slice('/panel/'.length);
      const panelPath = resolve(panelDir, rel);
      if ((panelPath === panelDir || panelPath.startsWith(panelDir + sep)) && existsSync(panelPath) && statSync(panelPath).isFile()) {
        const ext = extname(panelPath);
        const mime = MIME_TYPES[ext] ?? 'application/octet-stream';
        if (ext === '.html') {
          // Inject the hosted-mode flag (+ lobby origin) so the panel SPA runs in hosted mode.
          const html = readFileSync(panelPath, 'utf-8').replace(
            /<head>/i,
            `<head>\n<script>window.AGENT_OS_HOSTED=true;window.AGENT_OS_LOBBY_ORIGIN=location.origin;</script>`,
          );
          res.writeHead(200, {
            'content-type': mime,
            'access-control-allow-origin': '*',
            'cache-control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
            'pragma': 'no-cache',
            'expires': '0'
          });
          res.end(html);
        } else {
          res.writeHead(200, {
            'content-type': mime,
            'access-control-allow-origin': '*',
            'cache-control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
            'pragma': 'no-cache',
            'expires': '0'
          });
          res.end(readFileSync(panelPath));
        }
        return;
      }
      // SPA fallback for /panel/<tab> routes → serve the panel index.
      const indexPath = resolve(panelDir, 'index.html');
      if (existsSync(indexPath)) {
        const html = readFileSync(indexPath, 'utf-8').replace(
          /<head>/i,
          `<head>\n<script>window.AGENT_OS_HOSTED=true;window.AGENT_OS_LOBBY_ORIGIN=location.origin;</script>`,
        );
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'access-control-allow-origin': '*',
          'cache-control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
          'pragma': 'no-cache',
          'expires': '0'
        });
        res.end(html);
        return;
      }
    }

    const rootDir = resolve(fileURLToPath(import.meta.url), '../../../../apps/lobby-web');
    let filePath = path === '/' ? '/index.html' : path;
    const fullPath = resolve(rootDir, filePath.startsWith('/') ? filePath.slice(1) : filePath);

    if ((fullPath === rootDir || fullPath.startsWith(rootDir + sep)) && existsSync(fullPath) && statSync(fullPath).isFile()) {
      const ext = extname(fullPath);
      const mime = MIME_TYPES[ext] ?? 'application/octet-stream';
      res.writeHead(200, { 'content-type': mime, 'access-control-allow-origin': '*' });
      res.end(readFileSync(fullPath));
      return;
    }

    json({ error: 'not found' }, 404);
  }

  // ── WebSocket agent protocol ──
  const wss = new WebSocketServer({ server: httpServer, path: WS_PATH });
  wss.on('connection', (socket: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const lobbyId = url.searchParams.get('lobby_id') ?? defaultLobbyId ?? '';
    const orgId = url.searchParams.get('org_id') ?? 'default';
    const conn: Connection = { connId: randomUUID(), lobbyId, orgId };
    sockets.set(conn.connId, socket);
    if (!lobbyConns.has(lobbyId)) lobbyConns.set(lobbyId, new Set());
    lobbyConns.get(lobbyId)!.add(conn.connId);

    socket.on('message', async (data: Buffer) => {
      let msg: AgentToLobbyMessage;
      try {
        msg = JSON.parse(data.toString()) as AgentToLobbyMessage;
      } catch {
        send(conn.connId, { type: 'lobby-error', error: 'invalid JSON' });
        return;
      }
      const before = conn.agentId;
      const result = await coordinator.handle(conn, msg);
      if (conn.agentId && conn.agentId !== before) agentConn.set(conn.agentId, conn.connId); // learn id on register
      dispatch(conn, result.out);
      if (result.close) socket.close();
    });

    socket.on('close', async () => {
      const result = await coordinator.onDisconnect(conn);
      dispatch(conn, result.out);
      sockets.delete(conn.connId);
      lobbyConns.get(lobbyId)?.delete(conn.connId);
      if (conn.agentId) agentConn.delete(conn.agentId);
    });
  });

  if (autoDefault) await ensureDefaultLobby();

  // ── Stale-heartbeat sweeper ──
  const sweeper = setInterval(() => {
    void (async () => {
      try {
        // Touch last_seen for all active hosted agents to prevent stale heartbeat reaping
        for (const [agentId, entry] of hostedAgents.entries()) {
          const lobbyId = entry.conn.lobbyId;
          await store.updateAgent(lobbyId, agentId, { last_seen: new Date().toISOString() }).catch(() => null);
        }

        for (const { lobbyId: reapLobbyId, reapedAgentIds, out } of await coordinator.reapStale(STALE_MS)) {
          dispatch({ connId: '', lobbyId: reapLobbyId, orgId: 'default' }, out);
          for (const agentId of reapedAgentIds) {
            const cid = agentConn.get(agentId);
            if (cid) {
              sockets.get(cid)?.terminate();
              sockets.delete(cid);
              lobbyConns.get(reapLobbyId)?.delete(cid);
              agentConn.delete(agentId);
            }
            console.log(`[lobby-server] reaped stale agent ${agentId} from lobby ${reapLobbyId}`);
          }
        }
      } catch (e) {
        console.error('[lobby-server] stale sweep failed:', e);
      }
    })();
  }, SWEEP_MS);
  if (typeof sweeper.unref === 'function') sweeper.unref();

  const port = options.port ?? DEFAULT_PORT;
  await new Promise<void>((resolve) => httpServer.listen(port, resolve));

  return {
    port,
    store,
    httpServer,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(sweeper);
        for (const s of sockets.values()) s.terminate();
        wss.close(() => httpServer.close(() => resolve()));
      }),
  };
}

const MAX_BODY_BYTES = 1_048_576; // 1 MiB — control-plane default; uploads pass their own limit
// KB uploads carry base64 file content (~33% inflation) — a 25 MiB body ≈ an 18 MB document.
const MAX_UPLOAD_BODY_BYTES = 25 * 1_048_576;

async function readBody(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const c of req) {
    total += (c as Buffer).length;
    if (total > maxBytes) {
      req.destroy();
      // Marker instead of a silent {} — routes with large payloads (KB upload) answer 413 with a
      // real message; the old destroy-and-{} path surfaced as "unknown error" in the panel.
      return { __body_too_large: true };
    }
    chunks.push(c as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    return {};
  }
}

// ── CLI entry ──
const isMain = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  // Populate process.env from a repo-root `.env` (real env wins) so AGENT_OS_LOBBY_PORT and
  // AGENT_OS_CONCORDIUM_INDEXER_URL apply when the lobby runs standalone. Only when run as the CLI —
  // library consumers (apps/lobby-web, tests) manage their own environment.
  loadEnv(resolve(import.meta.dirname, '../../..'));
  const portIdx = process.argv.indexOf('--port');
  const port = portIdx >= 0 ? Number(process.argv[portIdx + 1]) : Number(process.env.AGENT_OS_LOBBY_PORT ?? DEFAULT_PORT);
  startLobbyServer({ port })
    .then((s) => {
      console.log(`Agent OS Lobby server`);
      console.log(`  Dashboard: http://localhost:${s.port}/`);
      console.log(`  WebSocket: ws://localhost:${s.port}${WS_PATH}`);
      console.log(`  Discover:  http://localhost:${s.port}/api/v1/agent-lobby/discover`);
      console.log(`  Mode:      in-memory store (portable Node WS — set a Redis store for swarm durability)`);
    })
    .catch((err) => {
      console.error('lobby server failed to start:', err);
      process.exit(1);
    });
}
