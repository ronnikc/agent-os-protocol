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
import { verifyLobbyJoinPolicy } from './auth/joinPolicy.js';
import { isProduction, validateSessionToken, liveTestAdminConfig, testAdminKeyDigest, TEST_ADMIN_IDENTITY, type SessionTokenPayload } from './auth/identityProof.js';
import { isLobbyManager, lobbyOwnerRef } from './auth/lobbyAuthz.js';
import { relayLobbyMessageToChatApps } from './integrations/chatRelay.js';

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
  session?: SessionTokenPayload;
  /**
   * Server-internal connection (a hosted agent on a virtual socket, spawned by the authenticated
   * LobbyOwner). The server itself asserts this agent's identity, so the impersonation-protection
   * session-token requirement — meant for untrusted external WS clients presenting a DID — does
   * not apply. Never set for a real inbound WebSocket.
   */
  trusted?: boolean;
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
  /** Registry checks for badges on server-hosted agents, without granting join privileges. */
  verifyHostedRosterIdentity?: VerifyIdentityFn;
  /**
   * Auto-appoint a successor Boss when the Boss is lost (disconnect or stale reap). OFF by default
   * — Phase 1 keeps a human in the loop. Enable for unattended swarms that must not stall on Boss
   * loss; the successor is the longest-connected non-human agent (deterministic).
   */
  autoFailover?: boolean;
  /** Minimum ms between accepted hand-raises per agent (dedup/anti-cascade). Default 60s. */
  handRaiseCooldownMs?: number;
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
  private autoFailover: boolean;
  private handRaiseCooldownMs: number;
  public readonly verifyIdentity: VerifyIdentityFn;
  private readonly verifyHostedRosterIdentity?: VerifyIdentityFn;
  /** agentId → recent send timestamps (ms), trimmed to the window. */
  private sendTimes = new Map<string, number[]>();
  /** agentId → last hand-raise timestamp (ms), for server-side hand-raise cooldown. */
  private lastHandRaise = new Map<string, number>();
  /** agentId → last identity verification check timestamp (ms) */
  private lastIdentityCheck = new Map<string, number>();

  constructor(private readonly store: LobbyStore, options: CoordinatorOptions = {}) {
    this.rateLimit = options.rateLimit ?? 30;
    this.rateWindowMs = options.rateWindowMs ?? 10_000;
    this.autoFailover = options.autoFailover ?? false;
    this.handRaiseCooldownMs = options.handRaiseCooldownMs ?? 60_000;
    this.verifyHostedRosterIdentity = options.verifyHostedRosterIdentity;
    this.verifyIdentity =
      options.verifyIdentity ??
      (async () => ({ status: 'unverified', source: 'none', checkedAt: new Date().toISOString() }));
  }

  // ── Entry point ──
  async handle(conn: Connection, msg: AgentToLobbyMessage): Promise<HandleResult> {
    if (msg.type === 'lobby-register' && conn.agentId) return { out: [] };
    if (msg.type !== 'lobby-register' && msg.type !== 'lobby-unregister') {
      const lobby = await this.store.getLobby(conn.lobbyId);
      if (!conn.agentId || lobby?.status !== 'active') return { out: [], close: true };
      if (conn.session?.identityRef === TEST_ADMIN_IDENTITY &&
          ((!testAdminKeyDigest() && liveTestAdminConfig()?.lobbyId !== conn.lobbyId) ||
            conn.session.expiresAt <= Date.now())) return { out: [], close: true };
      if (isProduction() && !conn.trusted && msg.type !== 'lobby-heartbeat' &&
          (!conn.session || conn.session.expiresAt <= Date.now())) {
        return { out: [{ target: { kind: 'self' }, message: { type: 'lobby-error', error: 'wallet session required to participate' } }] };
      }
    }
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
      case 'lobby-request':
        return this.onRequest(conn, msg);
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
    this.sendTimes.delete(conn.agentId);
    this.lastHandRaise.delete(conn.agentId);
    this.lastIdentityCheck.delete(conn.agentId);
    await this.event(conn.lobbyId, 'agent_left', conn.agentId);
    const out: Outbound[] = [{ target: { kind: 'lobby' }, message: { type: 'lobby-agent-left', agent_id: conn.agentId } }];
    if (wasBoss) {
      out.push(...(await this.onBossVacated(conn.lobbyId, conn.agentId)));
    }
    return { out };
  }

  /**
   * Reap agents whose last heartbeat is older than `thresholdMs`. The lobby server has no other
   * way to notice a Boss (or any agent) that froze, was SIGKILLed, or dropped off the network
   * without a clean socket close — without this, a dead Boss holds floor control forever. Returns
   * per-lobby outbound directives plus the reaped agent ids so the server can close their sockets.
   */
  async reapStale(thresholdMs: number, nowMs: number = Date.now()): Promise<Array<{ lobbyId: string; reapedAgentIds: string[]; out: Outbound[] }>> {
    const results: Array<{ lobbyId: string; reapedAgentIds: string[]; out: Outbound[] }> = [];
    for (const lobby of await this.store.listLobbies()) {
      const roster = await this.store.roster(lobby.lobby_id);
      const out: Outbound[] = [];
      const reapedAgentIds: string[] = [];
      for (const agent of roster) {
        if (agent.status === 'disconnected') continue;
        const lastSeen = Date.parse(agent.last_seen);
        if (Number.isFinite(lastSeen) && nowMs - lastSeen <= thresholdMs) continue;
        reapedAgentIds.push(agent.agent_id);
        await this.store.updateAgent(lobby.lobby_id, agent.agent_id, { status: 'disconnected', disconnected_at: new Date().toISOString() });
        await this.store.removeAgent(lobby.lobby_id, agent.agent_id);
        this.sendTimes.delete(agent.agent_id);
        this.lastHandRaise.delete(agent.agent_id);
        await this.event(lobby.lobby_id, 'agent_left', agent.agent_id, { reason: 'stale heartbeat' });
        out.push({ target: { kind: 'lobby' }, message: { type: 'lobby-agent-left', agent_id: agent.agent_id } });
        if (lobby.boss_agent_id === agent.agent_id) {
          out.push(...(await this.onBossVacated(lobby.lobby_id, agent.agent_id)));
        }
      }
      if (reapedAgentIds.length) results.push({ lobbyId: lobby.lobby_id, reapedAgentIds, out });
    }
    return results;
  }

  /**
   * Shared Boss-loss handling: clear the Boss slot and announce it. When auto-failover is enabled
   * (opt-in), deterministically appoint the longest-connected eligible agent so an unattended
   * swarm keeps a floor-holder instead of stalling until a human re-appoints.
   */
  private async onBossVacated(lobbyId: string, lostAgentId: string): Promise<Outbound[]> {
    await this.store.updateLobby(lobbyId, { boss_agent_id: undefined });
    const connected = await this.store.roster(lobbyId);
    const out: Outbound[] = [
      { target: { kind: 'lobby' }, message: { type: 'lobby-boss-lost', lost_agent_id: lostAgentId, connected_agents: connected } },
    ];
    if (this.autoFailover) {
      // Prefer a non-human CLI agent (humans drive, agents work); fall back to any participant.
      // Deterministic: earliest registered_at wins (roster is already sorted by registered_at).
      const successor = connected.find((a) => a.participant_type !== 'human' && a.role !== 'human') ?? connected[0];
      if (successor) {
        await this.store.updateAgent(lobbyId, successor.agent_id, { is_boss: true });
        await this.store.updateLobby(lobbyId, { boss_agent_id: successor.agent_id });
        await this.event(lobbyId, 'boss_appointed', 'system', { boss: successor.agent_id, reason: 'auto-failover' });
        out.push({ target: { kind: 'lobby' }, message: { type: 'lobby-boss-appointed', agent_id: successor.agent_id } });
      }
    }
    return out;
  }

  // ── Register ──
  private async onRegister(conn: Connection, msg: Extract<AgentToLobbyMessage, { type: 'lobby-register' }>): Promise<HandleResult> {
    const lobby = await this.store.getLobby(conn.lobbyId);
    if (!lobby || lobby.status !== 'active') {
      const error = lobby ? 'lobby is not active' : `unknown lobby: ${conn.lobbyId}`;
      return { out: [{ target: { kind: 'self' }, message: { type: 'lobby-error', error } }], close: true };
    }

    let verification: IdentityVerificationResult | undefined;
    const policy = effectiveJoinPolicy(lobby);

    const session = msg.join_token ? validateSessionToken(msg.join_token, conn.lobbyId) : null;
    const registryRef = msg.join_token?.startsWith('did:ccd:') ? msg.join_token : undefined;
    let presentedRef = msg.agent_identity_ref ?? session?.identityRef ?? registryRef;
    let isTokenVerified = false;

    // Enforce private lobby signature-token check
    if (lobby.visibility === 'private') {
      const trustedDid = conn.trusted && msg.join_token?.startsWith('did:ccd:');
      if (!trustedDid) {
        const joinResult = await verifyLobbyJoinPolicy(conn.lobbyId, msg.join_token, this.store, msg.agent_identity_ref);
        if (!joinResult.allowed) {
          await this.event(conn.lobbyId, 'join_denied', 'system', { display_name: msg.display_name, reason: joinResult.reason });
          return { out: [{ target: { kind: 'self' }, message: { type: 'lobby-error', error: joinResult.reason || 'unauthorized' } }], close: true };
        }
        presentedRef = joinResult.identityRef;
        if (!msg.agent_identity_ref && msg.participant_type !== 'human' && policy !== 'none' && policy !== 'allowlisted') {
          return { out: [{ target: { kind: 'self' }, message: { type: 'lobby-error', error: 'agent identity proof is required' } }], close: true };
        }
        isTokenVerified = !msg.agent_identity_ref;
      }
    }

    if (!isTokenVerified) {
      // ── Private-lobby access ladder (Phase 8): none → registered → allowlisted → verified_human_link.
      // A display name is never an identity — only `join_token` (a non-secret registry ref/DID) is.
      const deny = async (error: string): Promise<HandleResult> => {
        await this.event(conn.lobbyId, 'join_denied', 'system', { display_name: msg.display_name, policy, reason: error, status: verification?.status });
        return { out: [{ target: { kind: 'self' }, message: { type: 'lobby-error', error: error } }], close: true };
      };

      if (policy === 'allowlisted') {
        const allow = lobby.allowlist ?? [];
        if (!presentedRef || !allow.includes(presentedRef)) return deny('private lobby: not on the allowlist');
        if (!conn.trusted && !session) return deny('private lobby: authenticated identity is required');
      } else if (policy === 'registered') {
        if (!presentedRef) return deny('private lobby: a registered identity reference is required to join');
        verification = await this.verifyIdentity(presentedRef);
        if (!isRegistryResolved(verification.status)) {
          return deny(`private lobby: identity is not registry-verified (status: ${verification.status})`);
        }
        const issuer = verification.issuerDid ? await this.store.getIssuer(verification.issuerDid) : undefined;
        if (!issuer || issuer.revoked) {
          return deny('private lobby: credential issuer is not registered or is revoked on Concordium');
        }
      } else if (policy === 'verified_human_link') {
        if (!presentedRef) return deny('private lobby: a verified human-linked identity reference is required to join');
        verification = await this.verifyIdentity(presentedRef);
        if (!(verification.humanLinked || verification.orgLinked)) {
          return deny(`private lobby: identity is not human-linked (status: ${verification.status})`);
        }
        const issuer = verification.issuerDid ? await this.store.getIssuer(verification.issuerDid) : undefined;
        if (!issuer || issuer.revoked) {
          return deny('private lobby: credential issuer is not registered or is revoked on Concordium');
        }
      }
      // For 'none'/'allowlisted', best-effort verify a presented ref so the roster badge reflects reality.
      if (!verification && presentedRef) {
        verification = await this.verifyIdentity(presentedRef).catch(() => undefined);
      }

      // To prevent identity/DID impersonation abuse, verify that the connecting client is authorized
      // by the DID owner. Server-internal (trusted) connections are exempt: a hosted agent runs on a
      // virtual socket spawned by the already-authenticated LobbyOwner, so the server itself asserts
      // the identity — there is no external client to impersonate. Without this exemption a hosted
      // agent whose DID *does* resolve on-chain would be DENIED (it presents a bare DID, not a
      // session token), so hosted agents could never show as verified.
      if (!conn.trusted && (msg.agent_identity_ref || verification && isRegistryResolved(verification.status))) {
        const account = verification?.ref?.account;
        const network = verification?.ref?.network;
        if (!verification || !isRegistryResolved(verification.status) || !account || !network ||
            session?.identityRef !== `did:ccd:${network}:${account}`) {
          return deny('impersonation protection: Agent ID requires a session for its registered wallet');
        }
      }
    }

    const member = presentedRef ? await this.store.getMember(conn.lobbyId, presentedRef) : undefined;
    if (member?.status === 'revoked') {
      return { out: [{ target: { kind: 'self' }, message: { type: 'lobby-error', error: 'lobby membership is revoked' } }], close: true };
    }
    if (conn.trusted && presentedRef && this.verifyHostedRosterIdentity &&
        (!verification || verification.status === 'unverified' || verification.status === 'pending')) {
      verification = await this.verifyHostedRosterIdentity(presentedRef);
    }
    const now = new Date().toISOString();
    const agentId = randomUUID();
    const isHuman = msg.participant_type === 'human' && !msg.agent_identity_ref &&
      (!isProduction() || !!session || !!conn.trusted);
    conn.agentId = agentId;
    conn.isHuman = isHuman;
    conn.session = session ?? undefined;
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
    const agent = await this.store.getAgent(conn.lobbyId, conn.agentId);
    if (!agent) return { out: [] };

    const updatedFields: Partial<LobbyAgent> = {
      status: msg.status,
      current_work: msg.current_work,
      last_seen: new Date().toISOString()
    };

    // Non-blocking background verification check, limited to once per 60s per agent to prevent lag/heartbeat timeouts.
    const now = Date.now();
    const lastCheck = this.lastIdentityCheck.get(conn.agentId) ?? 0;
    const hostedVerifier = conn.trusted ? this.verifyHostedRosterIdentity : undefined;
    if (agent.identity_ref && (hostedVerifier || !agent.identity_status || agent.identity_status === 'unverified') && (now - lastCheck > 60_000)) {
      this.lastIdentityCheck.set(conn.agentId, now);
      (hostedVerifier ?? this.verifyIdentity)(agent.identity_ref)
        .then(async (verification) => {
          if (verification.status !== agent.identity_status && (hostedVerifier || verification.status !== 'unverified')) {
            await this.store.updateAgent(conn.lobbyId, conn.agentId!, { identity_status: verification.status });
          }
        })
        .catch(() => {});
    }

    const updated = await this.store.updateAgent(conn.lobbyId, conn.agentId, updatedFields);
    if (!updated) return { out: [] };
    return { out: [{ target: { kind: 'lobby' }, message: { type: 'lobby-agent-updated', agent: updated } }] };
  }

  // ── Message (floor control + lobby-scoping) ──
  private async onMessage(conn: Connection, msg: Extract<AgentToLobbyMessage, { type: 'lobby-message' }>): Promise<HandleResult> {
    if (!conn.agentId) return { out: [] };
    const lobby = await this.store.getLobby(conn.lobbyId);
    const isBroadcast = BROADCAST.has(msg.to_agent_id.toLowerCase());
    const isBoss = lobby?.boss_agent_id === conn.agentId;

    // Enforce message-level revocation checks on private lobbies
    if (lobby?.visibility === 'private') {
      const senderAgent = await this.store.getAgent(conn.lobbyId, conn.agentId);
      if (senderAgent?.identity_ref) {
        const member = await this.store.getMember(conn.lobbyId, senderAgent.identity_ref);
        const active = member
          ? member.status === 'active' && (!member.expires_at || Date.parse(member.expires_at) > Date.now())
          : senderAgent.identity_ref === lobbyOwnerRef(lobby);
        if (!active) {
          await this.event(conn.lobbyId, 'message_rejected', conn.agentId, { reason: 'membership revoked or expired' });
          return { out: [{ target: { kind: 'self' }, message: { type: 'lobby-error', error: 'your membership to this private lobby has been revoked or expired' } }], close: true };
        }
      }
    }

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
    // Mirror the swarm's chatter out to any connected Slack/Telegram/Discord channel (fire-and-forget).
    void relayLobbyMessageToChatApps(this.store, conn.lobbyId, message);

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
    const manager = conn.session && await isLobbyManager(this.store, conn.lobbyId, conn.session.identityRef);
    const allowed = isProduction()
      ? conn.trusted || manager || lobby.boss_agent_id === conn.agentId
      : !lobby.boss_agent_id || lobby.boss_agent_id === conn.agentId || conn.isHuman;
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
    // Server-side cooldown: a raised hand stays "up" until addressed, so re-raising within the
    // window is a no-op broadcast that only adds noise. This is the server-side guard the removed
    // client-side awareness-check (which caused a hand→hand cascade) always needed.
    const now = Date.now();
    const last = this.lastHandRaise.get(conn.agentId) ?? 0;
    if (now - last < this.handRaiseCooldownMs) {
      return { out: [{ target: { kind: 'self' }, message: { type: 'lobby-error', error: 'hand already raised recently — wait for it to be addressed before raising again' } }] };
    }
    this.lastHandRaise.set(conn.agentId, now);
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
    // AUTHORITY: only the assignee (reporting its own progress/result), the current Boss, or a
    // human may update a task. Without this any connected agent could forge another agent's task
    // completion/failure by id — an accountability hole in a swarm of untrusted participants.
    const lobbyForAuth = await this.store.getLobby(conn.lobbyId);
    const isAssignee = existing.assigned_to === conn.agentId;
    const isBoss = lobbyForAuth?.boss_agent_id === conn.agentId;
    if (!isAssignee && !isBoss && !conn.isHuman) {
      await this.event(conn.lobbyId, 'message_rejected', conn.agentId, { reason: 'unauthorized task update', task_id: msg.task_id });
      return { out: [{ target: { kind: 'self' }, message: { type: 'lobby-error', error: 'only the assignee, the Boss, or a human may update this task' } }] };
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

  // ── Requests ──
  private async onRequest(conn: Connection, msg: Extract<AgentToLobbyMessage, { type: 'lobby-request' }>): Promise<HandleResult> {
    const agent = await this.store.getAgent(conn.lobbyId, conn.agentId || '');
    const req = await this.store.createLobbyRequest({
      request_id: `req-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      agent_id: conn.agentId || 'anonymous',
      agent_display_name: agent?.display_name || 'Anonymous Agent',
      category: msg.category,
      title: msg.title,
      description: msg.description,
      status: 'pending',
      context: { ...msg.context, lobby_id: conn.lobbyId },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    return { out: [{ target: { kind: 'lobby' }, message: { type: 'lobby-request-created', request: req } }] };
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
