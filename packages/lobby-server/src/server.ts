#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * Independent Agent OS lobby server — a portable Node HTTP + WebSocket server that speaks the
 * exact protocol the Panel and relay already use (`/api/v1/agent-lobby/discover` +
 * `/ws/agent`), so they connect to it unmodified via Swarm Mode (`--lobby <url>`). It replaces the
 * old ComplianceOne backend coordinator with a clean, brand-neutral implementation whose rules are
 * enforced server-side by the LobbyCoordinator. Pair it with a Redis-backed LobbyStore for the
 * remote swarm (apps/lobby-web); the default in-memory store fits local + the WS fallback.
 *
 *   npm run lobby                 # ws://localhost:4730
 *   npm run lobby -- --port 5000
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import type { AgentToLobbyMessage, LobbyToAgentMessage, LobbySession } from '@agent-os/protocol-core';
import { InMemoryLobbyStore, type LobbyStore } from './store.js';
import { LobbyCoordinator, type Connection, type Outbound } from './coordinator.js';

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
  const coordinator = options.coordinator ?? new LobbyCoordinator(store);
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
      return json({ lobby: lobby ? { lobby_id: lobby.lobby_id, org_id: lobby.org_id, name: lobby.name, visibility: lobby.visibility } : null });
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

    const lobbyMatch = path.match(/^\/api\/v1\/agent-lobby\/lobbies\/([^/]+)(\/(roster|events))?$/);
    if (lobbyMatch && req.method === 'GET') {
      const lobbyId = lobbyMatch[1];
      const sub = lobbyMatch[3];
      if (sub === 'roster') return json({ agents: await store.roster(lobbyId) });
      if (sub === 'events') return json({ events: await store.listEvents(lobbyId) });
      const lobby = await store.getLobby(lobbyId);
      return lobby ? json({ lobby }) : json({ error: 'not found' }, 404);
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
  const portIdx = process.argv.indexOf('--port');
  const port = portIdx >= 0 ? Number(process.argv[portIdx + 1]) : Number(process.env.AGENT_OS_LOBBY_PORT ?? DEFAULT_PORT);
  startLobbyServer({ port })
    .then((s) => {
      console.log(`Agent OS Lobby server`);
      console.log(`  HTTP:      http://localhost:${s.port}`);
      console.log(`  WebSocket: ws://localhost:${s.port}${WS_PATH}`);
      console.log(`  Discover:  http://localhost:${s.port}/api/v1/agent-lobby/discover`);
      console.log(`  Mode:      in-memory store (portable Node WS — set a Redis store for swarm durability)`);
    })
    .catch((err) => {
      console.error('lobby server failed to start:', err);
      process.exit(1);
    });
}
