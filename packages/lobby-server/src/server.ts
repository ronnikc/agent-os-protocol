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
import { resolve, extname, sep } from 'node:path';
import { existsSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { WebSocketServer, WebSocket } from 'ws';
import { loadEnv, type AgentToLobbyMessage, type LobbyToAgentMessage, type LobbySession, type LobbyMessage, type LobbyEventType } from '@agent-os/protocol-core';
import { InMemoryLobbyStore, type LobbyStore } from './store.js';
import { LobbyCoordinator, type Connection, type Outbound } from './coordinator.js';
import { HttpIndexerTransport, IdentityVerifier, makeVerifyIdentityFn } from '@agent-os/identity-concordium';
import { RegistryMcpClient, REGISTRY_TOOL_ALLOWLIST } from './registry-mcp.js';
import { generateNonceChallenge, verifyProofAndIssueToken, validateSessionToken } from './auth/identityProof.js';
import { isLobbyManager } from './auth/lobbyAuthz.js';
import { setProviderKey, listProviderKeys, revokeProviderKey } from './providers/key-custody.js';

const DEFAULT_PORT = 4730;
const WS_PATH = '/api/v1/agent-lobby/ws/agent';

export interface LobbyServerOptions {
  port?: number;
  store?: LobbyStore;
  coordinator?: LobbyCoordinator;
  /** Auto-create a default public lobby so `discover` always returns one (Local/Swarm convenience). */
  autoDefaultLobby?: boolean;
}

export interface RunningLobbyServer {
  port: number;
  store: LobbyStore;
  httpServer: Server;
  close(): Promise<void>;
}

export async function startLobbyServer(options: LobbyServerOptions = {}): Promise<RunningLobbyServer> {
  const store = options.store ?? new InMemoryLobbyStore();
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
    const path = url.pathname;
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
      if (!(await isLobbyManager(store, lobbyId, identityRef))) return json({ error: 'not authorized to manage this lobby' }, 403);

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

    // ── Concordium Agent Registry proxy (on-chain anchoring via the official MCP service) ──
    // The lobby only relays reads and sign-ready payload builders; signing and submission
    // happen in the owner's wallet, client-side. No keys pass through here.

    // GET /api/v1/agent-lobby/registry/status
    if (path === '/api/v1/agent-lobby/registry/status' && req.method === 'GET') {
      if (!registryMcp) return json({ configured: false });
      const network = url.searchParams.get('network') ?? 'mainnet';
      try {
        const capabilities = await registryMcp.callTool('agent_registry_capabilities', { network });
        return json({ configured: true, network, capabilities });
      } catch (e) {
        return json({ configured: true, network, error: String((e as Error).message ?? e) }, 502);
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
        return json({ ok: false, tool, error: String((e as Error).message ?? e) }, 502);
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
      const updated = await store.updateLobby(lobbyId, patch);
      await recordEvent(lobbyId, 'lobby_settings_updated', String(body.actor ?? 'web-user'), { changed: Object.keys(patch) });
      return json({ lobby: updated });
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

        const fromId = body.from_agent_id || 'WebUser';
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
    const taskListMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)\/tasks$/);
    if (taskListMatch) {
      const lobbyId = taskListMatch[1];
      if (req.method === 'POST') {
        const body = await readBody(req);
        if (!body.title || !body.description || typeof body.proposed_budget_ccd !== 'number') {
          return json({ error: 'missing title, description, or proposed_budget_ccd' }, 400);
        }
        const task = await store.createMarketplaceTask({
          id: randomUUID(),
          lobby_id: lobbyId,
          title: body.title,
          description: body.description,
          proposed_budget_ccd: body.proposed_budget_ccd,
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
        return json({ tasks });
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

const MAX_BODY_BYTES = 1_048_576; // 1 MiB — no lobby control-plane payload is legitimately larger

async function readBody(req: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const c of req) {
    total += (c as Buffer).length;
    if (total > MAX_BODY_BYTES) {
      req.destroy();
      return {};
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
