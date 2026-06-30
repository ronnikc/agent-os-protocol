// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * `UiAssistSession` — the framework-agnostic brain of the overlay. It owns the conversation state
 * machine, drives a `UiAssistTransport`, enforces the `PermissionGate` before sending an `act`
 * turn, and emits typed events any UI (the repo-local embed, a React/Vue wrapper, or a test) can
 * subscribe to. It contains no DOM and no socket of its own — both are injected.
 */

import type { UiAssistContext, UiAssistServerMessage } from './contract.js';
import type { UiAssistTransport } from './transport.js';
import { PermissionGate, PermissionDeniedError, type UiAssistIntent, type UiAssistMode } from './permission.js';

export type UiAssistSessionState = 'idle' | 'connecting' | 'ready' | 'thinking' | 'streaming' | 'error';

export interface UiAssistSessionEvents {
  /** Connection opened; `handlers` are the runtime ids the bridge advertises. */
  open: { handlers: string[] };
  /** State machine transition. */
  state: { state: UiAssistSessionState };
  /** A streamed assistant chunk (one per distinct message index in a turn). */
  status: { content: string; messageIndex?: number };
  /** Turn finished; `content` is the final text (may be empty). */
  done: { content: string };
  /** Turn failed. */
  error: { content: string };
  /** An `act` turn was attempted in suggest-only mode and blocked before sending. */
  'permission-required': { intent: UiAssistIntent };
  /** Permission mode changed. */
  'permission-changed': { mode: UiAssistMode };
  /** Transport closed. */
  close: Record<string, never>;
}

type EventName = keyof UiAssistSessionEvents;
type Listener<E extends EventName> = (payload: UiAssistSessionEvents[E]) => void;

export interface UiAssistSessionOptions {
  /** Runtime handler id to target. Default `claude-code` (the relay's id); updated from `handlers`. */
  agentId?: string;
  /** Starting permission mode. Default `suggest`. */
  mode?: UiAssistMode;
  /** Stable session id for runtime resume. Auto-generated when omitted. */
  sessionId?: string;
}

export class UiAssistSession {
  private readonly listeners: { [E in EventName]?: Set<Listener<E>> } = {};
  private readonly gate: PermissionGate;
  private _state: UiAssistSessionState = 'idle';
  private unsubscribe: Array<() => void> = [];
  private handlers: string[] = [];

  /** Stable across resumes; sent with every turn. */
  readonly sessionId: string;
  agentId: string;

  constructor(
    private readonly transport: UiAssistTransport,
    options: UiAssistSessionOptions = {},
  ) {
    this.agentId = options.agentId ?? 'claude-code';
    this.sessionId = options.sessionId ?? `uia-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.gate = new PermissionGate({
      mode: options.mode,
      onChange: (mode) => this.emit('permission-changed', { mode }),
    });
  }

  get state(): UiAssistSessionState {
    return this._state;
  }

  get mode(): UiAssistMode {
    return this.gate.mode;
  }

  on<E extends EventName>(event: E, listener: Listener<E>): () => void {
    const set = (this.listeners[event] ??= new Set<any>()) as Set<Listener<E>>;
    set.add(listener);
    return () => set.delete(listener);
  }

  private emit<E extends EventName>(event: E, payload: UiAssistSessionEvents[E]): void {
    const set = this.listeners[event];
    if (set) for (const l of set) l(payload);
  }

  private setState(state: UiAssistSessionState): void {
    if (this._state === state) return;
    this._state = state;
    this.emit('state', { state });
  }

  /** Connect the transport and start dispatching server messages. */
  async connect(): Promise<void> {
    this.setState('connecting');
    this.unsubscribe.push(this.transport.onMessage((m) => this.dispatch(m)));
    this.unsubscribe.push(
      this.transport.onClose(() => {
        this.emit('close', {});
        if (this._state !== 'error') this.setState('idle');
      }),
    );
    try {
      await this.transport.connect();
    } catch (err) {
      this.setState('error');
      throw err;
    }
    this.setState('ready');
    this.emit('open', { handlers: this.handlers });
  }

  private dispatch(message: UiAssistServerMessage): void {
    switch (message.type) {
      case 'handlers':
        this.handlers = message.handlers ?? [];
        if (this.handlers.length && !this.handlers.includes(this.agentId)) this.agentId = this.handlers[0];
        break;
      case 'agent-status':
        this.setState('streaming');
        this.emit('status', { content: message.content ?? '', messageIndex: message.messageIndex });
        break;
      case 'agent-done':
        this.setState('ready');
        this.emit('done', { content: message.content ?? '' });
        break;
      case 'agent-error':
        this.setState('error');
        this.emit('error', { content: message.content ?? 'Unknown error' });
        break;
      case 'health':
        break;
    }
  }

  /** Grant edit/commit authority (switch to `act`). Drive this from an explicit user gesture only. */
  grantPermission(): void {
    this.gate.grant();
  }

  /** Revoke edit authority (back to suggest-only). */
  revokePermission(): void {
    this.gate.revoke();
  }

  /**
   * Send a turn. `intent: 'act'` requires granted permission — otherwise the turn is **not sent**,
   * a `permission-required` event fires, and a {@link PermissionDeniedError} is thrown so the caller
   * can prompt for consent. On an authorised `act` turn an authorisation marker is appended to the
   * captured context.
   */
  ask(prompt: string, options: { content?: string[]; intent?: UiAssistIntent } = {}): void {
    const intent: UiAssistIntent = options.intent ?? 'suggest';
    let marker: string | undefined;
    try {
      marker = this.gate.assertAndMark(intent);
    } catch (err) {
      if (err instanceof PermissionDeniedError) this.emit('permission-required', { intent });
      throw err;
    }

    const content = [...(options.content ?? [])];
    if (marker) content.push(marker);

    const context: UiAssistContext = { content, prompt, sessionId: this.sessionId };
    this.setState('thinking');
    this.transport.send({ type: 'agent-request', agentId: this.agentId, sessionId: this.sessionId, context });
  }

  /** Abort the in-flight turn. */
  abort(): void {
    this.transport.send({ type: 'agent-abort', agentId: this.agentId, sessionId: this.sessionId });
    this.setState('ready');
  }

  /** Close the session and detach all transport listeners. */
  close(): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
    this.transport.close();
    this.setState('idle');
  }
}
