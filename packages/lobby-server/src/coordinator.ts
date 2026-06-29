// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * LobbyCoordinator — the server-side brain of the independent lobby. It owns the rules that the
 * old client-side honour system could not enforce (LOBBY-PROTOCOL.md):
 *
 *   • lobby-scoping  — a connection only ever affects its own lobby; nothing crosses lobbies;
 *   • floor control  — only the Boss (or a human) may broadcast; a non-boss broadcast is rejected
 *                      server-side (this is the fix for the 2026-03-29 N² echo-cascade crash);
 *   • directed tasks — tasks must target a named agent, never `*`/`all`;
 *   • private access — a private lobby denies agents not on its allowlist;
 *   • abuse control  — per-agent rate limiting on public lobbies;
 *   • event log      — every action (and every denial) is appended for accountability.
 *
 * It is transport-agnostic: `handle()` takes a parsed AgentToLobbyMessage + connection context and
 * returns the outbound directives the server layer fans out to sockets. That keeps the rules unit-
 * verifiable without opening any socket.
 */

import { randomUUID } from 'node:crypto';
import type {
  AgentToLobbyMessage,
  LobbyToAgentMessage,
  LobbyAgent,
  LobbyMessage,
  LobbyTask,
  LobbyEvent,
  LobbyEventType,
  LobbySession,
  LobbyJoinPolicy,
  IdentityVerificationResult,
} from '@agent-os/protocol-core';
import { isRegistryResolved } from '@agent-os/protocol-core';
import type { LobbyStore } from './store.js';

/**
 * The read-only identity-verification seam (Phase 8). The coordinator stays decoupled from any
 * registry implementation — `server.ts` injects a real verifier (backed by `@agent-os/identity-
 * concordium`) when an indexer URL is configured; otherwise the fail-closed default applies.
 */
export type VerifyIdentityFn = (ref: string) => Promise<IdentityVerificationResult>;

/** Per-socket state the server hands to the coordinator on every message. */
export interface Connection {
  connId: string;
  lobbyId: string;
  orgId: string;
  /** Assigned on lobby-register. */
  agentId?: string;
  /** Browser human participant — exempt from floor control (LOBBY-PROTOCOL.md). */
  isHuman?: boolean;
}

export type OutboundTarget = { kind: 'self' } | { kind: 'lobby' } | { kind: 'agent'; agentId: string };

export interface Outbound {
  target: OutboundTarget;
  message: LobbyToAgentMessage;
}

export interface HandleResult {
  out: Outbound[];
  /** When true, the server should close this connection (e.g. private-lobby denial). */
  close?: boolean;
}

export interface CoordinatorOptions {
  /** Max messages per agent per window on a public lobby (abuse control). */
  rateLimit?: number;
  /** Rate-limit window in ms. */
  rateWindowMs?: number;
  /**
   * Read-only identity verifier (Phase 8). When omitted, identity is treated as `unverified`, so a
   * lobby whose policy *requires* a verified reference (`registered` / `verified_human_link`) fails
   * closed — the safe default. Inject a real verifier to actually admit verified agents.
   */
  verifyIdentity?: VerifyIdentityFn;
}

const BROADCAST = new Set(['all', '*', 'broadcast']);

/** Resolve the effective join policy: explicit `join_policy`, else derived from visibility. */
function effectiveJoinPolicy(lobby: LobbySession): LobbyJoinPolicy {
  if (lobby.join_policy) return lobby.join_policy;
  return lobby.visibility === 'private' ? 'allowlisted' : 'none';
}

export class LobbyCoordinator {
  private rateLimit: number;
  private rateWindowMs: number;
  private verifyIdentity: VerifyIdentityFn;
  /** agentId → recent send timestamps (ms), trimmed to the window. */
  private sendTimes = new Map<string, number[]>();

  constructor(private readonly store: LobbyStore, options: CoordinatorOptions = {}) {
    this.rateLimit = options.rateLimit ?? 30;
    this.rateWindowMs = options.rateWindowMs ?? 10_000;
    this.verifyIdentity =
      options.verifyIdentity ??
      (async () => ({ status: 'unverified', source: 'none', checkedAt: new Date().toISOString() }));
  }

  // ── Entry point ──
  async handle(conn: Connection, msg: AgentToLobbyMessage): Promise<HandleResult> {
    switch (msg.type) {
      case 'lobby-register':
        return this.onRegister(conn, msg);
      case 'lobby-heartbeat':
        return this.onHeartbeat(conn, msg);
      case 'lobby-message':
        return this.onMessage(conn, msg);
      case 'lobby-boss-appoint':
        return this.onBossAppoint(conn, msg);
      case 'lobby-hand-raise':
        return this.onHandRaise(conn, msg);
      case 'lobby-task-create':
        return this.onTaskCreate(conn, msg);
      case 'lobby-task-update':
        return this.onTaskUpdate(conn, msg);
      case 'lobby-unregister':
        return this.onDisconnect(conn);
      default:
        return { out: [] };
    }
  }

  /** Called by the server when a socket closes. */
  async onDisconnect(conn: Connection): Promise<HandleResult> {
    if (!conn.agentId) return { out: [] };
    const lobby = await this.store.getLobby(conn.lobbyId);
    const wasBoss = lobby?.boss_agent_id === conn.agentId;
    await this.store.updateAgent(conn.lobbyId, conn.agentId, { status: 'disconnected', disconnected_at: new Date().toISOString() });
    await this.store.removeAgent(conn.lobbyId, conn.agentId);
    await this.event(conn.lobbyId, 'agent_left', conn.agentId);
    const out: Outbound[] = [{ target: { kind: 'lobby' }, message: { type: 'lobby-agent-left', agent_id: conn.agentId } }];
    if (wasBoss) {
      await this.store.updateLobby(conn.lobbyId, { boss_agent_id: undefined });
      const connected = await this.store.roster(conn.lobbyId);
      out.push({ target: { kind: 'lobby' }, message: { type: 'lobby-boss-lost', lost_agent_id: conn.agentId, connected_agents: connected } });
    }
    return { out };
  }

  // ── Register ──
  private async onRegister(conn: Connection, msg: Extract<AgentToLobbyMessage, { type: 'lobby-register' }>): Promise<HandleResult> {
    const lobby = await this.store.getLobby(conn.lobbyId);
    if (!lobby) {
      return { out: [{ target: { kind: 'self' }, message: { type: 'lobby-error', error: `unknown lobby: ${conn.lobbyId}` } }], close: true };
    }

    // ── Private-lobby access ladder (Phase 8): none → registered → allowlisted → verified_human_link.
    // A display name is never an identity — only `join_token` (a non-secret registry ref/DID) is.
    const policy = effectiveJoinPolicy(lobby);
    const presentedRef = msg.join_token;
    let verification: IdentityVerificationResult | undefined;
    const deny = async (error: string): Promise<HandleResult> => {
      await this.event(conn.lobbyId, 'join_denied', 'system', { display_name: msg.display_name, policy, reason: error, status: verification?.status });
      return { out: [{ target: { kind: 'self' }, message: { type: 'lobby-error', error } }], close: true };
    };

    if (policy === 'allowlisted') {
      const allow = lobby.allowlist ?? [];
      const key = msg.join_token ?? msg.display_name;
      if (!allow.includes(key)) return deny('private lobby: not on the allowlist');
    } else if (policy === 'registered') {
      if (!presentedRef) return deny('private lobby: a registered identity reference is required to join');
      verification = await this.verifyIdentity(presentedRef);
      if (!isRegistryResolved(verification.status)) {
        return deny(`private lobby: identity is not registry-verified (status: ${verification.status})`);
      }
    } else if (policy === 'verified_human_link') {
      if (!presentedRef) return deny('private lobby: a verified human-linked identity reference is required to join');
      verification = await this.verifyIdentity(presentedRef);
      if (!(verification.humanLinked || verification.orgLinked)) {
        return deny(`private lobby: identity is not human-linked (status: ${verification.status})`);
      }
    }
    // For 'none'/'allowlisted', best-effort verify a presented ref so the roster badge reflects reality.
    if (!verification && presentedRef) {
      verification = await this.verifyIdentity(presentedRef).catch(() => undefined);
    }

    const now = new Date().toISOString();
    const agentId = randomUUID();
    const isHuman = msg.participant_type === 'human';
    conn.agentId = agentId;
    conn.isHuman = isHuman;
    const agent: LobbyAgent = {
      agent_id: agentId,
      display_name: msg.display_name,
      role: isHuman ? 'human' : 'agent',
      participant_type: isHuman ? 'human' : 'cli_agent',
      status: 'idle',
      current_work: '',
      branch: msg.branch,
      cwd: msg.cwd,
      pid: msg.pid,
      relay_port: msg.relay_port,
      agent_role: msg.agent_role,
      is_boss: false,
      registered_at: now,
      last_seen: now,
      model: msg.model,
      runtime: msg.runtime,
      ...(verification ? { identity_status: verification.status } : {}),
      ...(presentedRef ? { identity_ref: verification?.ref?.did ?? presentedRef } : {}),
    };
    await this.store.addAgent(conn.lobbyId, agent);
    await this.event(conn.lobbyId, 'agent_registered', agentId, { display_name: msg.display_name, policy, identity_status: verification?.status });
    const roster = await this.store.roster(conn.lobbyId);
    return {
      out: [
        { target: { kind: 'self' }, message: { type: 'lobby-registered', agent_id: agentId, lobby_id: conn.lobbyId } },
        { target: { kind: 'self' }, message: { type: 'lobby-roster', agents: roster } },
        { target: { kind: 'lobby' }, message: { type: 'lobby-agent-joined', agent } },
      ],
    };
  }

  // ── Heartbeat ──
  private async onHeartbeat(conn: Connection, msg: Extract<AgentToLobbyMessage, { type: 'lobby-heartbeat' }>): Promise<HandleResult> {
    if (!conn.agentId) return { out: [] };
    const agent = await this.store.updateAgent(conn.lobbyId, conn.agentId, { status: msg.status, current_work: msg.current_work, last_seen: new Date().toISOString() });
    if (!agent) return { out: [] };
    return { out: [{ target: { kind: 'lobby' }, message: { type: 'lobby-agent-updated', agent } }] };
  }

  // ── Message (floor control + lobby-scoping) ──
  private async onMessage(conn: Connection, msg: Extract<AgentToLobbyMessage, { type: 'lobby-message' }>): Promise<HandleResult> {
    if (!conn.agentId) return { out: [] };
    const lobby = await this.store.getLobby(conn.lobbyId);
    const isBroadcast = BROADCAST.has(msg.to_agent_id.toLowerCase());
    const isBoss = lobby?.boss_agent_id === conn.agentId;

    // FLOOR CONTROL: only the Boss or a human may broadcast. This is server-enforced — it is the
    // fix for the echo-cascade crash, and a client honour-system could never guarantee it.
    if (isBroadcast && !isBoss && !conn.isHuman) {
      await this.event(conn.lobbyId, 'message_rejected', conn.agentId, { reason: 'non-boss broadcast' });
      return { out: [{ target: { kind: 'self' }, message: { type: 'lobby-error', error: 'floor control: only the Boss may broadcast — address a specific agent or raise a hand' } }] };
    }

    const rate = this.checkRate(conn, lobby?.visibility);
    if (!rate.ok) {
      await this.event(conn.lobbyId, 'message_rejected', conn.agentId, { reason: 'rate limited' });
      return { out: [{ target: { kind: 'self' }, message: { type: 'lobby-error', error: 'rate limited — slow down' } }] };
    }

    const seq = await this.store.nextSeq(conn.lobbyId);
    const message: LobbyMessage = {
      message_id: randomUUID(),
      seq,
      from_agent_id: conn.agentId,
      to_agent_id: msg.to_agent_id,
      message_type: msg.message_type,
      content: msg.content,
      created_at: new Date().toISOString(),
      delivered: false,
    };
    await this.store.appendMessage(conn.lobbyId, message);
    await this.event(conn.lobbyId, 'message_sent', conn.agentId, { to: msg.to_agent_id, broadcast: isBroadcast });

    const received: LobbyToAgentMessage = { type: 'lobby-message-received', message };
    if (isBroadcast) {
      // Lobby-scoped fan-out — never leaves this lobby.
      return { out: [{ target: { kind: 'lobby' }, message: received }] };
    }
    // Directed: deliver to the named recipient and echo to the sender.
    return {
      out: [
        { target: { kind: 'agent', agentId: msg.to_agent_id }, message: received },
        { target: { kind: 'self' }, message: received },
      ],
    };
  }

  // ── Boss appointment (server-side authority) ──
  private async onBossAppoint(conn: Connection, msg: Extract<AgentToLobbyMessage, { type: 'lobby-boss-appoint' }>): Promise<HandleResult> {
    if (!conn.agentId) return { out: [] };
    const lobby = await this.store.getLobby(conn.lobbyId);
    if (!lobby) return { out: [] };
    // Only the current Boss, a human, or the first appointer (when no boss yet) may appoint.
    const allowed = !lobby.boss_agent_id || lobby.boss_agent_id === conn.agentId || conn.isHuman;
    if (!allowed) {
      return { out: [{ target: { kind: 'self' }, message: { type: 'lobby-error', error: 'only the current Boss or a human may appoint the Boss' } }] };
    }
    const target = await this.store.getAgent(conn.lobbyId, msg.agent_id);
    if (!target) {
      return { out: [{ target: { kind: 'self' }, message: { type: 'lobby-error', error: `unknown agent: ${msg.agent_id}` } }] };
    }
    if (lobby.boss_agent_id) await this.store.updateAgent(conn.lobbyId, lobby.boss_agent_id, { is_boss: false });
    await this.store.updateAgent(conn.lobbyId, msg.agent_id, { is_boss: true });
    await this.store.updateLobby(conn.lobbyId, { boss_agent_id: msg.agent_id });
    await this.event(conn.lobbyId, 'boss_appointed', conn.agentId, { boss: msg.agent_id });
    return { out: [{ target: { kind: 'lobby' }, message: { type: 'lobby-boss-appointed', agent_id: msg.agent_id } }] };
  }

  // ── Hand-raise ──
  private async onHandRaise(conn: Connection, msg: Extract<AgentToLobbyMessage, { type: 'lobby-hand-raise' }>): Promise<HandleResult> {
    if (!conn.agentId) return { out: [] };
    const agent = await this.store.getAgent(conn.lobbyId, conn.agentId);
    await this.event(conn.lobbyId, 'hand_raised', conn.agentId, { category: msg.category });
    return {
      out: [
        {
          target: { kind: 'lobby' },
          message: { type: 'lobby-hand-raised', hand: { agent_id: conn.agentId, agent_name: agent?.display_name ?? conn.agentId, category: msg.category, reason: msg.reason, raised_at: new Date().toISOString() } },
        },
      ],
    };
  }

  // ── Task create (must target a named agent, never `*`) ──
  private async onTaskCreate(conn: Connection, msg: Extract<AgentToLobbyMessage, { type: 'lobby-task-create' }>): Promise<HandleResult> {
    if (!conn.agentId) return { out: [] };
    if (BROADCAST.has(msg.assigned_to.toLowerCase())) {
      await this.event(conn.lobbyId, 'message_rejected', conn.agentId, { reason: 'broadcast task dispatch' });
      return { out: [{ target: { kind: 'self' }, message: { type: 'lobby-error', error: 'tasks must target a named agent, never `*` (LOBBY-PROTOCOL.md Phase 3)' } }] };
    }
    const target = await this.store.getAgent(conn.lobbyId, msg.assigned_to);
    if (!target) {
      return { out: [{ target: { kind: 'self' }, message: { type: 'lobby-error', error: `unknown assignee: ${msg.assigned_to}` } }] };
    }
    const lobby = await this.store.getLobby(conn.lobbyId);
    const seq = await this.store.nextSeq(conn.lobbyId);
    const now = new Date().toISOString();
    const task: LobbyTask = {
      task_id: randomUUID(),
      lobby_id: conn.lobbyId,
      org_id: lobby?.org_id ?? conn.orgId,
      assigned_by: conn.agentId,
      assigned_to: msg.assigned_to,
      assigned_at: now,
      title: msg.title,
      description: msg.description,
      priority: msg.priority ?? 'normal',
      category: msg.category ?? 'general',
      files: msg.files,
      status: 'assigned',
      seq,
    };
    await this.store.upsertTask(task);
    await this.event(conn.lobbyId, 'task_created', conn.agentId, { task_id: task.task_id, assigned_to: msg.assigned_to });
    return {
      out: [
        { target: { kind: 'agent', agentId: msg.assigned_to }, message: { type: 'lobby-task-assigned', task } },
        { target: { kind: 'lobby' }, message: { type: 'lobby-task-updated', task } },
      ],
    };
  }

  // ── Task update ──
  private async onTaskUpdate(conn: Connection, msg: Extract<AgentToLobbyMessage, { type: 'lobby-task-update' }>): Promise<HandleResult> {
    if (!conn.agentId) return { out: [] };
    const existing = await this.store.getTask(conn.lobbyId, msg.task_id);
    if (!existing) {
      return { out: [{ target: { kind: 'self' }, message: { type: 'lobby-error', error: `unknown task: ${msg.task_id}` } }] };
    }
    const updated: LobbyTask = {
      ...existing,
      status: msg.status ?? existing.status,
      progress: msg.progress ?? existing.progress,
      progress_pct: msg.progress_pct ?? existing.progress_pct,
      result: msg.result ?? existing.result,
      result_files: msg.result_files ?? existing.result_files,
      ...(msg.status === 'completed' ? { completed_at: new Date().toISOString() } : {}),
    };
    await this.store.upsertTask(updated);
    await this.event(conn.lobbyId, 'task_updated', conn.agentId, { task_id: msg.task_id, status: updated.status });
    return { out: [{ target: { kind: 'lobby' }, message: { type: 'lobby-task-updated', task: updated } }] };
  }

  // ── Helpers ──
  private async event(lobbyId: string, type: LobbyEventType, actorId: string, detail?: Record<string, unknown>): Promise<void> {
    const seq = await this.store.nextSeq(lobbyId);
    const evt: LobbyEvent = { event_id: randomUUID(), lobby_id: lobbyId, seq, type, actor_id: actorId, at: new Date().toISOString(), detail };
    await this.store.appendEvent(evt);
  }

  private checkRate(conn: Connection, visibility: string | undefined): { ok: boolean } {
    if (visibility !== 'public' || conn.isHuman || !conn.agentId) return { ok: true };
    const now = Date.now();
    const times = (this.sendTimes.get(conn.agentId) ?? []).filter((t) => now - t < this.rateWindowMs);
    if (times.length >= this.rateLimit) return { ok: false };
    times.push(now);
    this.sendTimes.set(conn.agentId, times);
    return { ok: true };
  }
}
