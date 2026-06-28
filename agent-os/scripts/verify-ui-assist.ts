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
  // integration
  detectProjectType,
  emitIntegrationPlan,
  planIntegration,
  FRAMEWORK_TARGETS,
  type FrameworkTarget,
  type UiAssistClientMessage,
  type UiAssistServerMessage,
} from '@agent-os/ui-assist-core';
// The repo-local embeddable overlay itself — imported by relative path (it ships no bare specifier),
// exercised here through a DOM + WebSocket stub so the actual <script> a developer drops in is tested.
import { mountUiAssist, extractActions as embedExtractActions } from '../../packages/ui-assist-embed/embed.js';

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

// ── A minimal DOM + WebSocket stub for exercising embed.js in Node ──

interface StubEl {
  tagName: string;
  children: StubEl[];
  parentNode: StubEl | null;
  attributes: Record<string, string>;
  className: string;
  value: string;
  textContent: string;
  classList: { add(c: string): void; remove(c: string): void; contains(c: string): boolean; toggle(c: string): void };
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  appendChild(c: StubEl): StubEl;
  removeChild(c: StubEl): void;
  remove(): void;
  addEventListener(type: string, fn: (e: unknown) => void): void;
  _fire(type: string, ev?: unknown): void;
}

function makeDomStub() {
  function makeEl(tag: string): StubEl {
    const listeners: Record<string, Array<(e: unknown) => void>> = {};
    const classes = new Set<string>();
    let text = '';
    const el = {
      tagName: tag,
      children: [] as StubEl[],
      parentNode: null as StubEl | null,
      attributes: {} as Record<string, string>,
      className: '',
      value: '',
      classList: {
        add: (c: string) => void classes.add(c),
        remove: (c: string) => void classes.delete(c),
        contains: (c: string) => classes.has(c),
        toggle: (c: string) => (classes.has(c) ? classes.delete(c) : classes.add(c)),
      },
      setAttribute(k: string, v: string) {
        this.attributes[k] = v;
      },
      getAttribute(k: string) {
        return this.attributes[k] ?? null;
      },
      appendChild(c: StubEl) {
        c.parentNode = this;
        this.children.push(c);
        return c;
      },
      removeChild(c: StubEl) {
        this.children = this.children.filter((x) => x !== c);
        c.parentNode = null;
      },
      remove() {
        this.parentNode?.removeChild(this);
      },
      addEventListener(type: string, fn: (e: unknown) => void) {
        (listeners[type] ??= []).push(fn);
      },
      _fire(type: string, ev: unknown = {}) {
        for (const fn of listeners[type] ?? []) fn(ev);
      },
    } as StubEl;
    Object.defineProperty(el, 'textContent', {
      get: () => text,
      set: (v: string) => {
        text = String(v);
        el.children = []; // mimic the browser: setting textContent clears children
      },
    });
    return el;
  }
  const body = makeEl('body');
  return { document: { createElement: (t: string) => makeEl(t), body }, body };
}

/** A browser-style WebSocket stub for embed.js (open immediately; scriptable inbound frames). */
class EmbedWebSocket {
  static last: EmbedWebSocket | undefined;
  readyState = 1; // OPEN
  sent: string[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e?: unknown) => void) | null = null;
  constructor(public readonly url: string) {
    EmbedWebSocket.last = this;
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
  }
  deliver(frame: UiAssistServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  lastSent(): UiAssistClientMessage {
    return JSON.parse(this.sent[this.sent.length - 1]) as UiAssistClientMessage;
  }
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

  // ════════ H — Embeddable overlay (embed.js through a DOM/WS stub) ════════
  console.log('\nH — embeddable overlay');

  /** Mount embed.js against fresh stubs; returns the handle + stubs. */
  function mountStubbed(confirmReturns = true) {
    const dom = makeDomStub();
    const confirmCalls: string[] = [];
    const handle = mountUiAssist({
      document: dom.document,
      container: dom.body,
      WebSocketImpl: EmbedWebSocket as unknown as new (url: string) => unknown,
      confirmImpl: (msg: string) => {
        confirmCalls.push(msg);
        return confirmReturns;
      },
    });
    return { dom, handle, confirmCalls, ws: () => EmbedWebSocket.last! };
  }

  await check("embed.js mounts an overlay and connects to the relay (default 'suggest')", () => {
    EmbedWebSocket.last = undefined;
    const { handle, ws } = mountStubbed();
    assert.equal(handle.getMode(), 'suggest');
    assert.equal(ws().url, 'ws://localhost:4722');
    handle.destroy();
  });

  await check('a suggest turn renders a user bubble and sends agent-request with no marker', () => {
    const { handle, ws } = mountStubbed();
    handle.sendPrompt('Why is this misaligned?');
    const msg = ws().lastSent();
    assert.equal(msg.type, 'agent-request');
    assert.ok(msg.type === 'agent-request' && msg.context.prompt === 'Why is this misaligned?');
    assert.ok(msg.type === 'agent-request' && !msg.context.content.includes(ACT_AUTHORIZATION_MARKER));
    handle.destroy();
  });

  await check('a streamed done with a trailing list renders clickable action buttons that re-ask', () => {
    const { handle, ws } = mountStubbed();
    handle.sendPrompt('options?');
    ws().deliver({ type: 'agent-status', content: 'Looking…' });
    ws().deliver({ type: 'agent-done', content: 'Choose:\n1. Fix & commit now\n2. Add to sprint plan' });
    // The action buttons send the chosen label as the next prompt.
    const before = ws().sent.length;
    // Find the rendered action buttons in the transcript and click the first.
    const buttons: StubEl[] = [];
    const walk = (el: StubEl) => {
      if (el.className === 'uia-action') buttons.push(el);
      el.children.forEach(walk);
    };
    walk(handle.root as unknown as StubEl);
    assert.equal(buttons.length, 2, 'two action buttons rendered');
    buttons[0]._fire('click');
    assert.equal(ws().sent.length, before + 1);
    assert.ok(ws().lastSent().type === 'agent-request');
    handle.destroy();
  });

  await check('the send button and Enter key both dispatch a turn', () => {
    const { dom, handle, ws } = mountStubbed();
    // locate input + send button by class
    const find = (cls: string): StubEl => {
      let found: StubEl | undefined;
      const walk = (el: StubEl) => {
        if (el.className === cls) found = el;
        el.children.forEach(walk);
      };
      walk(handle.root as unknown as StubEl);
      if (!found) throw new Error(`no ${cls}`);
      return found;
    };
    const input = find('uia-input');
    input.value = 'typed and clicked';
    find('uia-send')._fire('click');
    assert.equal(ws().lastSent().type, 'agent-request');
    input.value = 'typed and entered';
    input._fire('keydown', { key: 'Enter', shiftKey: false, preventDefault() {} });
    const msg = ws().lastSent();
    assert.ok(msg.type === 'agent-request' && msg.context.prompt === 'typed and entered');
    void dom;
    handle.destroy();
  });

  await check('granting act (confirm=yes) makes the next turn carry the authorisation marker', () => {
    const { handle, confirmCalls, ws } = mountStubbed(true);
    handle.toggleMode(); // user clicks the Suggest pill
    assert.equal(confirmCalls.length, 1, 'consent was requested');
    assert.equal(handle.getMode(), 'act');
    handle.sendPrompt('apply the fix and commit');
    assert.ok(ws().lastSent().type === 'agent-request');
    const msg = ws().lastSent();
    assert.ok(msg.type === 'agent-request' && msg.context.content.includes(ACT_AUTHORIZATION_MARKER));
    handle.destroy();
  });

  await check('declining the consent prompt (confirm=no) keeps suggest-only', () => {
    const { handle, confirmCalls } = mountStubbed(false);
    handle.toggleMode();
    assert.equal(confirmCalls.length, 1);
    assert.equal(handle.getMode(), 'suggest', 'no consent → no act');
    handle.destroy();
  });

  await check('embed.js adopts the advertised handler id from a handlers frame', () => {
    const { handle, ws } = mountStubbed();
    ws().deliver({ type: 'handlers', handlers: ['codex-cli'] });
    handle.sendPrompt('hi');
    assert.equal(ws().lastSent().agentId, 'codex-cli');
    handle.destroy();
  });

  await check("embed.js's action parser agrees with the core renderer (no drift)", () => {
    const fixtures = [
      'Pick:\n1. A\n2. B',
      'All done.\n\n1. Only one',
      'Steps:\n1. a\n2. b\n\nWhat next?',
      'Choose:\n1) Yes\n2) No\n3) Do both\n\n',
      'No list here at all.',
    ];
    for (const f of fixtures) {
      const a = embedExtractActions(f);
      const b = extractTrailingActions(f);
      assert.deepEqual(a.actions, b.actions, `actions mismatch for: ${JSON.stringify(f)}`);
      assert.equal(a.body, b.body, `body mismatch for: ${JSON.stringify(f)}`);
    }
  });

  // ════════ I — Integration engine (Integration Agent) ════════
  console.log('\nI — integration engine');

  const detectionFixtures: Array<{ name: string; inv: Parameters<typeof detectProjectType>[0]; expect: FrameworkTarget }> = [
    { name: 'Next.js', inv: { files: ['next.config.js', 'pages/index.tsx'], dependencies: ['next', 'react'] }, expect: 'next' },
    { name: 'React (no Next)', inv: { files: ['src/App.jsx'], dependencies: ['react', 'react-dom'] }, expect: 'react' },
    { name: 'Vue', inv: { files: ['src/App.vue'], dependencies: ['vue'] }, expect: 'vue' },
    { name: 'Svelte', inv: { files: ['src/routes/+page.svelte'], dependencies: ['svelte'] }, expect: 'svelte' },
    { name: 'Laravel', inv: { files: ['artisan', 'resources/views/welcome.blade.php'], composer: ['laravel/framework'] }, expect: 'laravel' },
    { name: 'WordPress', inv: { files: ['wp-config.php', 'wp-content/'] }, expect: 'wordpress' },
    { name: 'Joomla', inv: { files: ['configuration.php', 'administrator/'] }, expect: 'joomla' },
    { name: 'plain HTML', inv: { files: ['index.html', 'app.js'] }, expect: 'plain' },
  ];

  await check('detectProjectType classifies all eight targets (Next beats React)', () => {
    for (const f of detectionFixtures) {
      const d = detectProjectType(f.inv);
      assert.equal(d.framework, f.expect, `${f.name} → ${d.framework}`);
      assert.ok(d.signals.length > 0, `${f.name} has signals`);
    }
  });

  await check('every framework plan mounts the overlay, targets the relay, and is dev-gated', () => {
    for (const fw of FRAMEWORK_TARGETS) {
      const plan = emitIntegrationPlan(fw, { relayUrl: 'ws://localhost:4722' });
      assert.ok(plan.steps.length > 0, `${fw}: steps`);
      assert.ok(plan.snippets.length > 0, `${fw}: snippets`);
      const allCode = plan.snippets.map((s) => s.code).join('\n');
      assert.ok(allCode.includes('mountUiAssist') || allCode.includes('data-ui-assist-auto'), `${fw}: mounts the overlay`);
      assert.ok(allCode.includes('ws://localhost:4722'), `${fw}: uses the relay url`);
      // Dev-gating present (framework-appropriate guard, or the dev-only check in the checklist).
      const devGated =
        /import\.meta\.env|NODE_ENV|@env\('local'\)|WP_DEBUG|JDEBUG|dev only|local\/dev/i.test(allCode) ||
        plan.checks.some((c) => /dev-only/i.test(c));
      assert.ok(devGated, `${fw}: dev-gated`);
      // Connect notes carry the suggest-only safety boundary.
      assert.ok(plan.connect.notes.some((n) => /suggest-only/i.test(n)), `${fw}: suggest-only note`);
    }
  });

  await check('plans carry no origin brand string', () => {
    const blob = JSON.stringify(FRAMEWORK_TARGETS.map((fw) => emitIntegrationPlan(fw))).toLowerCase();
    for (const brand of ['aesir' + 'x', 'compliance' + 'one', 'forse' + 'ti']) {
      assert.equal(blob.includes(brand), false, brand);
    }
  });

  await check('planIntegration composes detection + plan; a remote lobby adds a swarm note', () => {
    const { detection, plan } = planIntegration(
      { files: ['next.config.ts'], dependencies: ['next'] },
      { lobbyUrl: 'wss://lobby.example.com' },
    );
    assert.equal(detection.framework, 'next');
    assert.equal(plan.connect.lobbyUrl, 'wss://lobby.example.com');
    assert.ok(plan.connect.notes.some((n) => /swarm mode/i.test(n)));
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
