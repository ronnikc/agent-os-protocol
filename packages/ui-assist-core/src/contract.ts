// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

/**
 * The UI Assist event contract — the stable wire protocol spoken between an embedded overlay
 * (the browser) and the agent runtime bridge (the relay locally, or a lobby remotely).
 *
 * These types are the **canonical, neutral** form of the message shapes the relay already speaks
 * (`relay-server.ts` defines the same strings inline). Naming and field names match the relay wire
 * byte-for-byte so a future relay refactor can import these directly without a protocol break — see
 * the "protocol stability principle" in IMPLEMENTATION-PLAN.md §4: the relay and lobby speak one
 * stable contract, and surfaces are swappable behind it.
 *
 * The contract carries **no** permission/authorization message: the explicit-permission gate that
 * keeps UI Assist from editing a project without consent is a *client-side* concern, modelled in
 * `session.ts` (a suggest → act mode the user must grant). Keeping permission off the wire means the
 * overlay stays wire-compatible with the existing relay, whose system prompt independently enforces
 * "never act without confirmation".
 */

/** Protocol identifier (advisory; the wire is structurally versioned by these type strings). */
export const UI_ASSIST_PROTOCOL = 'agent-os-ui-assist/1' as const;

/** Default local relay endpoint (matches `npm run relay`). */
export const DEFAULT_RELAY_URL = 'ws://localhost:4722' as const;

/** Captured page/selection context handed to a turn. */
export interface UiAssistContext {
  /** Captured snippets (selected element HTML, component path, console, etc.). */
  content: string[];
  /** The developer's natural-language request. */
  prompt: string;
  /** Resumes a prior runtime session when present. */
  sessionId?: string;
}

/** Client → bridge messages (browser/overlay → relay or lobby). */
export type UiAssistClientMessage =
  | { type: 'agent-request'; agentId: string; sessionId?: string; context: UiAssistContext }
  | { type: 'agent-abort'; agentId: string; sessionId?: string }
  | { type: 'agent-undo'; agentId: string; sessionId?: string }
  | { type: 'agent-redo'; agentId: string; sessionId?: string }
  | { type: 'health'; agentId: string; sessionId?: string };

/** Bridge → client messages (relay or lobby → browser/overlay). */
export type UiAssistServerMessage =
  | { type: 'agent-status'; agentId?: string; sessionId?: string; content?: string; messageIndex?: number }
  | { type: 'agent-done'; agentId?: string; sessionId?: string; content?: string; messageIndex?: number }
  | { type: 'agent-error'; agentId?: string; sessionId?: string; content?: string }
  | { type: 'health'; agentId?: string }
  | { type: 'handlers'; handlers?: string[] };

export type UiAssistClientMessageType = UiAssistClientMessage['type'];
export type UiAssistServerMessageType = UiAssistServerMessage['type'];

/** Narrowing guard for trusted-shape server frames arriving off the wire. */
export function isUiAssistServerMessage(value: unknown): value is UiAssistServerMessage {
  if (!value || typeof value !== 'object') return false;
  const t = (value as { type?: unknown }).type;
  return (
    t === 'agent-status' ||
    t === 'agent-done' ||
    t === 'agent-error' ||
    t === 'health' ||
    t === 'handlers'
  );
}

/** Parse a raw wire string into a server message, or `null` if it is not one. */
export function parseServerMessage(raw: string): UiAssistServerMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  return isUiAssistServerMessage(value) ? value : null;
}
