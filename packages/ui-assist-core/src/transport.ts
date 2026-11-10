// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

/**
 * The transport seam — how the UI Assist session reaches the agent runtime.
 *
 * The session depends only on `UiAssistTransport`, never on a concrete socket, so the same session
 * logic drives a local relay, a remote lobby, or an injected fake (which is how `verify-ui-assist`
 * exercises the whole path with no network and no browser — the same injected-seam pattern used by
 * the adapters/providers/identity layers).
 *
 * `WebSocketTransport` targets the **browser** WebSocket API (the embed passes the global
 * `WebSocket`; tests pass a fake constructor of the same shape).
 */

import { parseServerMessage, type UiAssistClientMessage, type UiAssistServerMessage } from './contract.js';

export interface UiAssistTransport {
  /** Open the connection; resolves once ready to send. */
  connect(): Promise<void>;
  /** Send a client message (no-op if not open). */
  send(message: UiAssistClientMessage): void;
  /** Subscribe to decoded server messages; returns an unsubscribe. */
  onMessage(listener: (message: UiAssistServerMessage) => void): () => void;
  /** Subscribe to transport close; returns an unsubscribe. */
  onClose(listener: () => void): () => void;
  /** Close the connection (no reconnect). */
  close(): void;
  /** True while the socket is open. */
  readonly connected: boolean;
}

/** Minimal browser-WebSocket shape the transport relies on (global `WebSocket` satisfies it). */
export interface BrowserWebSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
}

export interface BrowserWebSocketCtor {
  new (url: string): BrowserWebSocketLike;
}

/** WebSocket.OPEN — declared locally so core needs no DOM lib. */
const WS_OPEN = 1;

export interface WebSocketTransportOptions {
  /** Bridge URL (`ws://localhost:4722` for the local relay; `wss://…` for a remote lobby). */
  url: string;
  /** The WebSocket constructor — the browser global, or a fake in tests. */
  WebSocketCtor: BrowserWebSocketCtor;
  /** Connect timeout (ms). Default 8000. */
  connectTimeoutMs?: number;
}

export class WebSocketTransport implements UiAssistTransport {
  private ws?: BrowserWebSocketLike;
  private readonly messageListeners = new Set<(m: UiAssistServerMessage) => void>();
  private readonly closeListeners = new Set<() => void>();

  constructor(private readonly options: WebSocketTransportOptions) {}

  get connected(): boolean {
    return this.ws?.readyState === WS_OPEN;
  }

  connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const ws = new this.options.WebSocketCtor(this.options.url);
      this.ws = ws;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        reject(new Error(`UI Assist transport: timed out connecting to ${this.options.url}`));
      }, this.options.connectTimeoutMs ?? 8000);

      ws.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve();
      };
      ws.onmessage = (ev) => {
        const msg = parseServerMessage(typeof ev.data === 'string' ? ev.data : String(ev.data));
        if (msg) for (const l of this.messageListeners) l(msg);
      };
      ws.onclose = () => {
        clearTimeout(timeout);
        for (const l of this.closeListeners) l();
        if (!settled) {
          settled = true;
          reject(new Error(`UI Assist transport: connection to ${this.options.url} closed before open`));
        }
      };
      ws.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`UI Assist transport: error connecting to ${this.options.url}`));
      };
    });
  }

  send(message: UiAssistClientMessage): void {
    if (this.ws && this.ws.readyState === WS_OPEN) this.ws.send(JSON.stringify(message));
  }

  onMessage(listener: (message: UiAssistServerMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  close(): void {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}
