// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * LobbyClient — a thin, typed WebSocket client for the independent lobby server. The Panel, the
 * relay, and the Vercel swarm app all use it to discover a lobby, register, and exchange the
 * AgentToLobby / LobbyToAgent protocol messages. It does discovery, registration, heartbeat, and
 * reconnect; it does not implement any lobby rules (those are server-side, by design).
 */

import { WebSocket } from 'ws';
import type {
  AgentToLobbyMessage,
  LobbyToAgentMessage,
  LobbyDiscoverResponse,
  LobbyAgentStatus,
} from '@agent-os/protocol-core';

const WS_PATH = '/api/v1/agent-lobby/ws/agent';

export interface LobbyClientOptions {
  /** Base URL of the lobby server (http/https — upgraded to ws/wss for the socket). */
  lobbyUrl: string;
  register: Extract<AgentToLobbyMessage, { type: 'lobby-register' }>;
  /** Override the lobby id (otherwise discovered). */
  lobbyId?: string;
  orgId?: string;
  /** Heartbeat interval (ms); 0 disables. Default 25s (server stale threshold is 90s). */
  heartbeatMs?: number;
  /** Auto-reconnect on unexpected close. Default true. */
  reconnect?: boolean;
}

type Listener = (message: LobbyToAgentMessage) => void;

function normalizeHttpUrl(url: string): string {
  return url.replace(/^ws(s)?:\/\//i, (_, ssl) => ssl ? 'https://' : 'http://');
}

/** Discover the active lobby on a base URL (`{ lobby: { lobby_id, org_id, name } | null }`). */
export async function discoverLobby(lobbyUrl: string): Promise<LobbyDiscoverResponse['lobby']> {
  const httpUrl = normalizeHttpUrl(lobbyUrl);
  const res = await fetch(new URL('/api/v1/agent-lobby/discover', httpUrl), { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return null;
  const data = (await res.json()) as LobbyDiscoverResponse;
  return data.lobby ?? null;
}

export class LobbyClient {
  private ws?: WebSocket;
  private listeners = new Set<Listener>();
  private heartbeat?: NodeJS.Timeout;
  private closedByUser = false;
  private status: LobbyAgentStatus = 'idle';
  private currentWork = '';

  /** Set after registration completes. */
  agentId?: string;
  lobbyId?: string;

  constructor(private readonly options: LobbyClientOptions) {
    this.lobbyId = options.lobbyId;
  }

  onMessage(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Connect, registering with the configured payload. Resolves once the socket is open. */
  async connect(): Promise<void> {
    if (!this.lobbyId) {
      const lobby = await discoverLobby(this.options.lobbyUrl);
      if (!lobby) throw new Error(`no active lobby at ${this.options.lobbyUrl}`);
      this.lobbyId = lobby.lobby_id;
    }
    const wsBase = this.options.lobbyUrl.replace(/^http/i, 'ws').replace(/\/$/, '');
    const orgId = this.options.orgId ?? 'default';
    const rawUrl = wsBase.startsWith('ws') ? wsBase : `ws://${wsBase}`;
    const url = `${rawUrl}${WS_PATH}?lobby_id=${encodeURIComponent(this.lobbyId)}&org_id=${encodeURIComponent(orgId)}`;
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.on('open', () => {
        this.send(this.options.register);
        this.startHeartbeat();
        resolve();
      });
      ws.on('message', (data: Buffer) => this.onData(data));
      ws.on('error', (err) => reject(err));
      ws.on('close', () => this.onClose());
    });
  }

  private onData(data: Buffer): void {
    let msg: LobbyToAgentMessage;
    try {
      msg = JSON.parse(data.toString()) as LobbyToAgentMessage;
    } catch {
      return;
    }
    if (msg.type === 'lobby-registered') {
      this.agentId = msg.agent_id;
      this.lobbyId = msg.lobby_id;
    }
    if (msg.type === 'lobby-error' && typeof msg.error === 'string' && msg.error.startsWith('unknown lobby')) {
      // The lobby we were pinned to no longer exists — typically the server restarted and its
      // in-memory store minted a fresh default lobby. Drop the stale id so the reconnect path
      // re-discovers instead of looping on the dead one forever.
      this.lobbyId = undefined;
    }
    for (const l of this.listeners) l(msg);
  }

  private onClose(): void {
    this.stopHeartbeat();
    if (this.closedByUser || this.options.reconnect === false) return;
    setTimeout(() => {
      this.connect().catch(() => {
        /* keep retrying on the next close */
      });
    }, 2000);
  }

  /** Send a protocol message to the lobby. */
  send(message: AgentToLobbyMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  /** Update the heartbeat status reported to the lobby. */
  setStatus(status: LobbyAgentStatus, currentWork = ''): void {
    this.status = status;
    this.currentWork = currentWork;
  }

  private startHeartbeat(): void {
    const interval = this.options.heartbeatMs ?? 25_000;
    if (interval <= 0) return;
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => this.send({ type: 'lobby-heartbeat', current_work: this.currentWork, status: this.status }), interval);
    if (typeof this.heartbeat.unref === 'function') this.heartbeat.unref();
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }

  close(): void {
    this.closedByUser = true;
    this.stopHeartbeat();
    this.ws?.close();
  }
}
