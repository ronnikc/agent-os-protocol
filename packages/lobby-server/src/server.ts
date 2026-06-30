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
import { resolve, extname } from 'node:path';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { WebSocketServer, WebSocket } from 'ws';
import { loadEnv, type AgentToLobbyMessage, type LobbyToAgentMessage, type LobbySession } from '@agent-os/protocol-core';
import { InMemoryLobbyStore, type LobbyStore } from './store.js';
import { LobbyCoordinator, type Connection, type Outbound } from './coordinator.js';
import { HttpIndexerTransport, IdentityVerifier, makeVerifyIdentityFn } from '@agent-os/identity-concordium';

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
  const coordinator = options.coordinator ?? new LobbyCoordinator(store, { verifyIdentity });
  const autoDefault = options.autoDefaultLobby ?? true;

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
  const httpServer = createServer((req, res) => void handleHttp(req, res));

  async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname;
    const json = (body: unknown, status = 200): void => {
      res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify(body));
    };

    if (path === '/health') return json({ ok: true, lobbies: (await store.listLobbies()).length });

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
      const now = new Date().toISOString();
      const lobby: LobbySession = {
        lobby_id: randomUUID(),
        org_id: body.org_id ?? 'default',
        name: body.name ?? 'Lobby',
        status: 'active',
        visibility: body.visibility ?? 'public',
        join_policy: body.join_policy,
        allowlist: body.allowlist,
        connected_agent_ids: [],
        message_seq: 0,
        created_at: now,
        updated_at: now,
        created_by: body.created_by ?? 'system',
      };
      await store.createLobby(lobby);
      return json({ lobby }, 201);
    }

    const lobbyMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)(\/(roster|events|messages))?$/);
    if (lobbyMatch && req.method === 'GET') {
      const lobbyId = lobbyMatch[1];
      const sub = lobbyMatch[3];
      if (sub === 'roster') return json({ agents: await store.roster(lobbyId) });
      if (sub === 'events') return json({ events: await store.listEvents(lobbyId) });
      if (sub === 'messages') return json({ messages: await store.listMessages(lobbyId) });
      const lobby = await store.getLobby(lobbyId);
      return lobby ? json({ lobby }) : json({ error: 'not found' }, 404);
    }

    if (lobbyMatch && req.method === 'POST') {
      const lobbyId = lobbyMatch[1];
      const sub = lobbyMatch[3];
      if (sub === 'messages') {
        const body = await readBody(req);
        const lobby = await store.getLobby(lobbyId);
        if (!lobby) return json({ error: 'Lobby not found' }, 404);

        const seq = ++lobby.message_seq;
        await store.upsertLobby(lobby);

        const message = {
          id: randomUUID(),
          lobby_id: lobbyId,
          from_agent_id: body.from_agent_id || 'WebUser',
          to_agent_id: body.to_agent_id || 'all',
          message_type: body.message_type || 'chat',
          content: body.content || '',
          created_at: new Date().toISOString(),
          seq
        };
        await store.addMessage(message);

        // Record event
        await store.addEvent({
          id: randomUUID(),
          lobby_id: lobbyId,
          type: 'lobby-message',
          agent_id: message.from_agent_id,
          details: `${message.from_agent_id}: ${message.content}`,
          timestamp: message.created_at
        });

        // Broadcast to WebSocket connections
        const outMsg = {
          type: 'lobby-message-received',
          message
        } as unknown as LobbyToAgentMessage;

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
          updated_at: new Date().toISOString()
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
        tx_hash: body.tx_hash
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

    if (fullPath.startsWith(rootDir) && existsSync(fullPath) && statSync(fullPath).isFile()) {
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

  const port = options.port ?? DEFAULT_PORT;
  await new Promise<void>((resolve) => httpServer.listen(port, resolve));

  return {
    port,
    store,
    httpServer,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets.values()) s.terminate();
        wss.close(() => httpServer.close(() => resolve()));
      }),
  };
}

async function readBody(req: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
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
