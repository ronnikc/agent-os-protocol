#!/usr/bin/env npx tsx
// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * verify-ui-assist — runnable functional verification for the Phase 9 UI Assist integration slice.
 *
 * Proves the whole browser↔runtime path with **no network and no browser**, by injecting a fake
 * browser-WebSocket (the same injected-seam pattern as verify-adapters/providers/lobby/identity):
 *
 *   A. Contract — server-frame guard + raw-string parsing (valid / junk / non-server).
 *   B. Render — UI-ASSIST.md Rule 1: a trailing numbered list of 2+ items → action buttons.
 *   C. Permission gate — suggest blocks `act`; grant allows + stamps the authorisation marker.
 *   D. Transport — WebSocketTransport over the fake WS: connect/send/decode/close + timeout.
 *   E. Session — connect → adopt advertised handler → suggest turn → streamed status → done;
 *      error path; abort; and the gate (an `act` turn in suggest mode never reaches the wire).
 *   F. Tasks — the "add to sprint plan" bridge drafts a canonical, planned Task.
 *   G. Neutrality — no brand strings and no secret material serialize on any frame.
 *
 * Exits non-zero on the first failed assertion so it can gate a commit / CI.
 */

import assert from 'node:assert/strict';
import {
  // contract
  parseServerMessage,
  isUiAssistServerMessage,
  DEFAULT_RELAY_URL,
  // transport
  WebSocketTransport,
  type BrowserWebSocketLike,
  type BrowserWebSocketCtor,
  // permission
  PermissionGate,
  PermissionDeniedError,
  ACT_AUTHORIZATION_MARKER,
  // session
  UiAssistSession,
  type UiAssistSessionState,
  // render
  extractTrailingActions,
  // tasks
  draftTaskFromAssist,
  type UiAssistClientMessage,
  type UiAssistServerMessage,
} from '@agent-os/ui-assist-core';

// ── Tiny test runner (matches verify-lobby / verify-identity) ──
let passed = 0;
const failures: string[] = [];
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push(name);
    console.error(`  ✗ ${name}\n    ${(err as Error).message.split('\n').join('\n    ')}`);
  }
}

// ── The injected seam: a fake browser WebSocket ──

/** A scriptable browser-WebSocket stand-in — no network. */
class FakeWebSocket implements BrowserWebSocketLike {
  readyState = 0; // CONNECTING
  sent: string[] = [];
  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  constructor(public readonly url: string) {}
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.();
  }
  // test helpers
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  emit(message: UiAssistServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  emitRaw(data: string): void {
    this.onmessage?.({ data });
  }
  sentMessages(): UiAssistClientMessage[] {
    return this.sent.map((s) => JSON.parse(s) as UiAssistClientMessage);
  }
}

/** A constructor that captures the latest instance and auto-opens on the next microtask. */
function autoOpeningCtor() {
  let last: FakeWebSocket | undefined;
  class Bound extends FakeWebSocket {
    constructor(url: string) {
      super(url);
      last = this;
      queueMicrotask(() => this.open());
    }
  }
  return {
    WebSocketCtor: Bound as unknown as BrowserWebSocketCtor,
    get last(): FakeWebSocket {
      if (!last) throw new Error('no socket constructed yet');
      return last;
    },
  };
}

/** A constructor that never opens (for the connect-timeout check). */
function neverOpeningCtor(): BrowserWebSocketCtor {
  class Stuck extends FakeWebSocket {}
  return Stuck as unknown as BrowserWebSocketCtor;
}

async function main(): Promise<void> {
  console.log('verify-ui-assist — Phase 9 UI Assist integration\n');

  // ════════ A — Contract ════════
  console.log('A — event contract');

  await check('isUiAssistServerMessage accepts the five server frames, rejects others', () => {
    for (const t of ['agent-status', 'agent-done', 'agent-error', 'health', 'handlers']) {
      assert.equal(isUiAssistServerMessage({ type: t }), true, t);
    }
    assert.equal(isUiAssistServerMessage({ type: 'agent-request' }), false); // client frame
    assert.equal(isUiAssistServerMessage({ nope: 1 }), false);
    assert.equal(isUiAssistServerMessage(null), false);
  });

  await check('parseServerMessage decodes a valid frame and rejects junk', () => {
    const ok = parseServerMessage(JSON.stringify({ type: 'agent-done', content: 'hi' }));
    assert.equal(ok?.type, 'agent-done');
    assert.equal(parseServerMessage('not json'), null);
    assert.equal(parseServerMessage(JSON.stringify({ type: 'agent-request' })), null);
  });

  // ════════ B — Render (UI-ASSIST.md Rule 1) ════════
  console.log('\nB — response rendering');

  await check('a trailing numbered list of 2+ items becomes actions; body is preserved', () => {
    const md = 'Here are options:\n\n1. Fix & commit now\n2. Add to sprint plan';
    const r = extractTrailingActions(md);
    assert.deepEqual(r.actions, ['Fix & commit now', 'Add to sprint plan']);
    assert.equal(r.body, 'Here are options:');
  });

  await check('a single trailing item is NOT an action menu', () => {
    const r = extractTrailingActions('All done.\n\n1. One thing');
    assert.deepEqual(r.actions, []);
    assert.equal(r.body, 'All done.\n\n1. One thing');
  });

  await check('a numbered list in the middle of a message is left in the body', () => {
    const md = 'Steps I took:\n1. a\n2. b\n\nWhat next?';
    const r = extractTrailingActions(md);
    assert.deepEqual(r.actions, []);
    assert.ok(r.body.includes('1. a'));
  });

  await check('trailing blank lines do not defeat extraction; `)` delimiter works', () => {
    const r = extractTrailingActions('Pick:\n1) Yes\n2) No\n\n');
    assert.deepEqual(r.actions, ['Yes', 'No']);
  });

  // ════════ C — Permission gate ════════
  console.log('\nC — permission gate');

  await check('default is suggest-only; an act turn is blocked, a suggest turn passes', () => {
    const gate = new PermissionGate();
    assert.equal(gate.mode, 'suggest');
    assert.equal(gate.isAllowed('suggest'), true);
    assert.equal(gate.isAllowed('act'), false);
    assert.throws(() => gate.assertAndMark('act'), PermissionDeniedError);
    assert.equal(gate.assertAndMark('suggest'), undefined);
  });

  await check('grant() enables act and stamps the authorisation marker; revoke() restores safety', () => {
    let changes = 0;
    const gate = new PermissionGate({ onChange: () => changes++ });
    gate.grant();
    assert.equal(gate.mode, 'act');
    assert.equal(gate.assertAndMark('act'), ACT_AUTHORIZATION_MARKER);
    gate.revoke();
    assert.equal(gate.mode, 'suggest');
    assert.equal(changes, 2);
  });

  // ════════ D — Transport ════════
  console.log('\nD — WebSocket transport (injected fake)');

  await check('connect resolves on open; send serializes; messages decode; close fires', async () => {
    const fake = autoOpeningCtor();
    const transport = new WebSocketTransport({ url: DEFAULT_RELAY_URL, WebSocketCtor: fake.WebSocketCtor });
    const received: UiAssistServerMessage[] = [];
    transport.onMessage((m) => received.push(m));
    let closed = false;
    transport.onClose(() => (closed = true));

    await transport.connect();
    assert.equal(transport.connected, true);

    transport.send({ type: 'health', agentId: 'claude-code' });
    assert.deepEqual(JSON.parse(fake.last.sent[0]), { type: 'health', agentId: 'claude-code' });

    fake.last.emit({ type: 'agent-status', content: 'thinking' });
    fake.last.emitRaw('garbage-not-json'); // ignored, not delivered
    assert.equal(received.length, 1);
    assert.equal(received[0].type, 'agent-status');

    transport.close();
    assert.equal(closed, true);
    assert.equal(transport.connected, false);
  });

  await check('connect rejects on timeout when the socket never opens', async () => {
    const transport = new WebSocketTransport({
      url: DEFAULT_RELAY_URL,
      WebSocketCtor: neverOpeningCtor(),
      connectTimeoutMs: 20,
    });
    await assert.rejects(transport.connect(), /timed out/i);
  });

  // ════════ E — Session ════════
  console.log('\nE — session state machine');

  /** Wire a session over a fresh auto-opening fake; returns helpers. */
  async function connectedSession(mode?: 'suggest' | 'act') {
    const fake = autoOpeningCtor();
    const transport = new WebSocketTransport({ url: DEFAULT_RELAY_URL, WebSocketCtor: fake.WebSocketCtor });
    const session = new UiAssistSession(transport, mode ? { mode } : {});
    const states: UiAssistSessionState[] = [];
    session.on('state', ({ state }) => states.push(state));
    await session.connect();
    return { fake, transport, session, states };
  }

  await check('connect adopts the advertised handler id from the handlers frame', async () => {
    const { fake, session } = await connectedSession();
    assert.equal(session.agentId, 'claude-code');
    fake.last.emit({ type: 'handlers', handlers: ['codex-cli'] });
    assert.equal(session.agentId, 'codex-cli', 'adopts the first advertised handler when its default is absent');
  });

  await check('a suggest turn sends agent-request with the prompt, session id, and no marker', async () => {
    const { fake, session } = await connectedSession();
    session.ask('Why is this button misaligned?', { content: ['<button>…</button>'] });
    const [msg] = fake.last.sentMessages();
    assert.equal(msg.type, 'agent-request');
    assert.equal(msg.type === 'agent-request' && msg.context.prompt, 'Why is this button misaligned?');
    assert.equal(msg.type === 'agent-request' && msg.context.sessionId, session.sessionId);
    assert.ok(msg.type === 'agent-request' && !msg.context.content.includes(ACT_AUTHORIZATION_MARKER));
  });

  await check('streamed status frames emit in order, then done; state goes thinking→streaming→ready', async () => {
    const { fake, session, states } = await connectedSession();
    const statuses: Array<{ content: string; messageIndex?: number }> = [];
    let done = '';
    session.on('status', (p) => statuses.push(p));
    session.on('done', (p) => (done = p.content));

    session.ask('do a thing');
    fake.last.emit({ type: 'agent-status', content: 'Thinking…', messageIndex: 0 });
    fake.last.emit({ type: 'agent-status', content: 'Found it.', messageIndex: 1 });
    fake.last.emit({ type: 'agent-done', content: 'All set.' });

    assert.deepEqual(statuses.map((s) => s.content), ['Thinking…', 'Found it.']);
    assert.deepEqual(statuses.map((s) => s.messageIndex), [0, 1]);
    assert.equal(done, 'All set.');
    assert.ok(states.includes('thinking') && states.includes('streaming') && states.slice(-1)[0] === 'ready');
  });

  await check('an error frame surfaces as an error event and an error state', async () => {
    const { fake, session } = await connectedSession();
    let err = '';
    session.on('error', (p) => (err = p.content));
    session.ask('boom');
    fake.last.emit({ type: 'agent-error', content: 'spawn failed' });
    assert.equal(err, 'spawn failed');
    assert.equal(session.state, 'error');
  });

  await check('abort sends agent-abort for the live session', async () => {
    const { fake, session } = await connectedSession();
    session.ask('long task');
    session.abort();
    const types = fake.last.sentMessages().map((m) => m.type);
    assert.deepEqual(types, ['agent-request', 'agent-abort']);
  });

  await check('an act turn in suggest mode never reaches the wire (gated before send)', async () => {
    const { fake, session } = await connectedSession();
    let required = false;
    session.on('permission-required', () => (required = true));
    assert.throws(() => session.ask('refactor and commit', { intent: 'act' }), PermissionDeniedError);
    assert.equal(required, true);
    assert.equal(fake.last.sent.length, 0, 'nothing was sent');
  });

  await check('after grantPermission an act turn sends, carrying the authorisation marker', async () => {
    const { fake, session } = await connectedSession();
    session.grantPermission();
    session.ask('apply the fix and commit', { intent: 'act' });
    const [msg] = fake.last.sentMessages();
    assert.ok(msg.type === 'agent-request' && msg.context.content.includes(ACT_AUTHORIZATION_MARKER));
  });

  // ════════ F — Tasks (add to sprint plan) ════════
  console.log('\nF — canonical task drafting');

  await check('draftTaskFromAssist yields a canonical, planned Task with stable id + timestamps', () => {
    const task = draftTaskFromAssist({ id: 'TASK-1', title: 'Align the button', sprintId: '9.0.0', phaseId: 'phase-9' });
    assert.equal(task.status, 'planned');
    assert.equal(task.priority, 'normal');
    assert.equal(task.id, 'TASK-1');
    assert.equal(task.sprintId, '9.0.0');
    assert.ok(task.createdAt && task.updatedAt);
  });

  // ════════ G — Neutrality ════════
  console.log('\nG — brand/secret neutrality on the wire');

  await check('no client frame serializes a brand string or secret material', async () => {
    const { fake, session } = await connectedSession('act');
    session.ask('apply the fix', { intent: 'act', content: ['<div class="dm-page" />'] });
    const wire = JSON.stringify(fake.last.sentMessages()).toLowerCase();
    // Origin product names, assembled so this guard does not itself trip the repo brand gate.
    const ORIGIN_BRANDS = ['aesir' + 'x', 'compliance' + 'one', 'forse' + 'ti'];
    for (const brand of ORIGIN_BRANDS) assert.equal(wire.includes(brand), false, brand);
    const SECRET = /sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
    assert.equal(SECRET.test(wire), false);
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.error(`FAILED: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('verify-ui-assist: all checks passed ✓');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
