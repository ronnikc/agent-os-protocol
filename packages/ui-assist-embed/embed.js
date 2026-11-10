// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

/**
 * Agent OS Protocol — UI Assist embeddable overlay (repo-local <script>).
 *
 * A dependency-free, framework-agnostic browser ESM you can drop into any page today:
 *
 *   <script type="module">
 *     import { mountUiAssist } from '/path/to/ui-assist-embed/embed.js';
 *     mountUiAssist({ relayUrl: 'ws://localhost:4722' });
 *   </script>
 *
 * It renders a floating launcher + chat panel and speaks the UI Assist event contract directly to
 * the local relay (or a remote lobby). The canonical implementation of that contract — the session
 * state machine, the permission gate, and the response-rendering rule — lives in
 * `@agent-os/ui-assist-core` and is unit-verified there; this file inlines the *stable wire strings*
 * and a compact equivalent of the trailing-action rule so it needs no build step or import map. The
 * `verify-ui-assist` harness imports this very file (with a DOM/WebSocket stub) and cross-checks its
 * action parser against the core, so the two cannot drift.
 *
 * Safety (plan §12): the overlay is **suggest-only by default**. Edit/commit authority ("act" mode)
 * is off until the developer explicitly turns it on (guarded by a confirm), and only then does a
 * turn carry the authorisation marker the runtime looks for.
 */

// ── Stable wire protocol (mirrors @agent-os/ui-assist-core/contract.ts) ──
const DEFAULT_RELAY_URL = 'ws://localhost:4722';
const DEFAULT_AGENT_ID = 'claude-code';
const ACT_AUTHORIZATION_MARKER =
  '[ui-assist: the developer has explicitly granted edit/commit authority for this turn]';

/**
 * UI-ASSIST.md Rule 1 — a trailing numbered list of 2+ items becomes action buttons. Kept in lockstep
 * with core's `extractTrailingActions` (the harness asserts they agree on fixtures).
 */
export function extractActions(markdown) {
  const lines = String(markdown).replace(/\s+$/, '').split('\n');
  const numbered = /^\s*(\d+)[.)]\s+(.*\S)\s*$/;
  let i = lines.length - 1;
  const collected = [];
  while (i >= 0) {
    const m = lines[i].match(numbered);
    if (!m) break;
    collected.push(m[2].trim());
    i--;
  }
  if (collected.length < 2) return { body: String(markdown), actions: [] };
  return { body: lines.slice(0, i + 1).join('\n').replace(/\s+$/, ''), actions: collected.reverse() };
}

const STYLE = `
.uia-root { position: fixed; bottom: 20px; right: 20px; z-index: 2147483000;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  --uia-accent: #4f8cff; --uia-bg: #14161c; --uia-fg: #e7e9ee; --uia-muted: #9aa3b2; --uia-line: #262b36; }
.uia-launcher { width: 52px; height: 52px; border-radius: 50%; border: none; cursor: pointer;
  background: var(--uia-accent); color: #fff; font-size: 22px; box-shadow: 0 6px 20px rgba(0,0,0,.35); }
.uia-panel { display: none; flex-direction: column; width: 360px; height: 520px; overflow: hidden;
  background: var(--uia-bg); color: var(--uia-fg); border: 1px solid var(--uia-line); border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0,0,0,.45); }
.uia-open .uia-panel { display: flex; }
.uia-open .uia-launcher { display: none; }
.uia-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--uia-line); }
.uia-title { font-weight: 600; font-size: 14px; flex: 1; }
.uia-mode { font-size: 11px; padding: 3px 8px; border-radius: 999px; border: 1px solid var(--uia-line);
  background: transparent; color: var(--uia-muted); cursor: pointer; }
.uia-mode.uia-act { color: #fff; background: #b4541f; border-color: #b4541f; }
.uia-x { background: transparent; border: none; color: var(--uia-muted); font-size: 18px; cursor: pointer; }
.uia-log { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.uia-msg { font-size: 13px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
.uia-msg.uia-user { color: var(--uia-fg); align-self: flex-end; background: #1d2230; padding: 8px 10px; border-radius: 10px; max-width: 85%; }
.uia-msg.uia-agent { color: var(--uia-fg); }
.uia-msg.uia-err { color: #ff8f8f; }
.uia-actions { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.uia-action { text-align: left; font-size: 12px; padding: 7px 9px; border-radius: 8px; cursor: pointer;
  background: #1d2230; color: var(--uia-fg); border: 1px solid var(--uia-line); }
.uia-foot { display: flex; gap: 8px; padding: 10px; border-top: 1px solid var(--uia-line); }
.uia-input { flex: 1; resize: none; height: 38px; font: inherit; font-size: 13px; padding: 8px;
  background: #0f1116; color: var(--uia-fg); border: 1px solid var(--uia-line); border-radius: 8px; }
.uia-send { border: none; border-radius: 8px; padding: 0 14px; background: var(--uia-accent); color: #fff; cursor: pointer; }
.uia-hint { font-size: 11px; color: var(--uia-muted); padding: 0 12px 8px; }
`;

/**
 * Mount the overlay. Every environment dependency is injectable so the same file runs in a browser
 * and under the Node verification harness.
 *
 * @param {object} [options]
 * @param {string} [options.relayUrl]   bridge URL (default ws://localhost:4722)
 * @param {string} [options.agentId]    runtime handler id (default claude-code; updated from `handlers`)
 * @param {string} [options.title]      panel title (default "UI Assist")
 * @param {{accent?: string}} [options.theme]
 * @param {boolean} [options.autoConnect] connect on mount (default true)
 * @param {*} [options.document]         DOM document (default global)
 * @param {*} [options.container]        mount node (default document.body)
 * @param {*} [options.WebSocketImpl]    WebSocket constructor (default global)
 * @param {(msg: string) => boolean} [options.confirmImpl] consent prompt (default global confirm)
 */
export function mountUiAssist(options = {}) {
  const doc = options.document || (typeof document !== 'undefined' ? document : undefined);
  if (!doc) throw new Error('mountUiAssist: no document available');
  const WebSocketImpl = options.WebSocketImpl || (typeof WebSocket !== 'undefined' ? WebSocket : undefined);
  const confirmImpl = options.confirmImpl || (typeof confirm !== 'undefined' ? confirm : () => false);
  const container = options.container || doc.body;
  const relayUrl = options.relayUrl || DEFAULT_RELAY_URL;
  const sessionId = `uia-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  let agentId = options.agentId || DEFAULT_AGENT_ID;
  let mode = 'suggest';
  let ws;
  let streamEl = null;

  // ── DOM ──
  const style = doc.createElement('style');
  style.textContent = STYLE;
  container.appendChild(style);

  const root = doc.createElement('div');
  root.className = 'uia-root';
  if (options.theme && options.theme.accent) root.setAttribute('style', `--uia-accent:${options.theme.accent}`);

  const launcher = doc.createElement('button');
  launcher.className = 'uia-launcher';
  launcher.textContent = '✦';
  launcher.setAttribute('aria-label', 'Open UI Assist');

  const panel = doc.createElement('div');
  panel.className = 'uia-panel';

  const head = doc.createElement('div');
  head.className = 'uia-head';
  const titleEl = doc.createElement('div');
  titleEl.className = 'uia-title';
  titleEl.textContent = options.title || 'UI Assist';
  const modeBtn = doc.createElement('button');
  modeBtn.className = 'uia-mode';
  modeBtn.textContent = 'Suggest';
  modeBtn.setAttribute('title', 'Suggest-only. Click to grant edit/commit authority.');
  const closeBtn = doc.createElement('button');
  closeBtn.className = 'uia-x';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', 'Close');
  head.appendChild(titleEl);
  head.appendChild(modeBtn);
  head.appendChild(closeBtn);

  const log = doc.createElement('div');
  log.className = 'uia-log';

  const hint = doc.createElement('div');
  hint.className = 'uia-hint';
  hint.textContent = 'Suggest mode — I propose changes; I will not edit files until you grant access.';

  const foot = doc.createElement('div');
  foot.className = 'uia-foot';
  const input = doc.createElement('textarea');
  input.className = 'uia-input';
  input.setAttribute('placeholder', 'Describe what you want…');
  const sendBtn = doc.createElement('button');
  sendBtn.className = 'uia-send';
  sendBtn.textContent = 'Send';
  foot.appendChild(input);
  foot.appendChild(sendBtn);

  panel.appendChild(head);
  panel.appendChild(log);
  panel.appendChild(hint);
  panel.appendChild(foot);
  root.appendChild(launcher);
  root.appendChild(panel);
  container.appendChild(root);

  // ── helpers ──
  function addMessage(text, kind) {
    const el = doc.createElement('div');
    el.className = `uia-msg uia-${kind}`;
    el.textContent = text;
    log.appendChild(el);
    return el;
  }

  function renderAgentFinal(el, content) {
    const { body, actions } = extractActions(content);
    el.textContent = body;
    if (actions.length) {
      const wrap = doc.createElement('div');
      wrap.className = 'uia-actions';
      for (const label of actions) {
        const b = doc.createElement('button');
        b.className = 'uia-action';
        b.textContent = label;
        b.addEventListener('click', () => sendPrompt(label));
        wrap.appendChild(b);
      }
      el.appendChild(wrap);
    }
  }

  function setMode(next) {
    mode = next;
    const act = mode === 'act';
    modeBtn.textContent = act ? 'Act' : 'Suggest';
    if (act) modeBtn.classList.add('uia-act');
    else modeBtn.classList.remove('uia-act');
    hint.textContent = act
      ? 'Act mode — I may edit files and commit to a feature branch (never merge).'
      : 'Suggest mode — I propose changes; I will not edit files until you grant access.';
  }

  function toggleMode() {
    if (mode === 'suggest') {
      const ok = confirmImpl(
        'Grant UI Assist edit/commit authority?\n\nIt will be allowed to change files and commit to a feature branch. It never merges to main.',
      );
      if (!ok) return;
      setMode('act');
    } else {
      setMode('suggest');
    }
  }

  function open() {
    root.classList.add('uia-open');
  }
  function close() {
    root.classList.remove('uia-open');
  }

  function sendPrompt(text) {
    const prompt = String(text || '').trim();
    if (!prompt) return;
    addMessage(prompt, 'user');
    const content = [];
    if (mode === 'act') content.push(ACT_AUTHORIZATION_MARKER);
    streamEl = addMessage('…', 'agent');
    send({ type: 'agent-request', agentId, sessionId, context: { content, prompt, sessionId } });
    input.value = '';
  }

  function send(message) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(message));
  }

  function onServer(raw) {
    let msg;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : String(raw));
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;
    switch (msg.type) {
      case 'handlers':
        if (Array.isArray(msg.handlers) && msg.handlers.length && !msg.handlers.includes(agentId)) {
          agentId = msg.handlers[0];
        }
        break;
      case 'agent-status':
        if (!streamEl) streamEl = addMessage('', 'agent');
        streamEl.textContent = msg.content || '';
        break;
      case 'agent-done':
        if (!streamEl) streamEl = addMessage('', 'agent');
        renderAgentFinal(streamEl, msg.content || streamEl.textContent || '');
        streamEl = null;
        break;
      case 'agent-error':
        addMessage(`Error: ${msg.content || 'unknown'}`, 'err');
        streamEl = null;
        break;
    }
  }

  function connect() {
    if (!WebSocketImpl) throw new Error('mountUiAssist: no WebSocket implementation available');
    ws = new WebSocketImpl(relayUrl);
    ws.onmessage = (ev) => onServer(ev && ev.data);
    ws.onerror = () => addMessage(`Could not reach the relay at ${relayUrl}.`, 'err');
  }

  function destroy() {
    try {
      if (ws) ws.close();
    } catch {
      /* ignore */
    }
    root.remove();
    style.remove();
  }

  // ── wire events ──
  launcher.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  modeBtn.addEventListener('click', toggleMode);
  sendBtn.addEventListener('click', () => sendPrompt(input.value));
  input.addEventListener('keydown', (ev) => {
    if (ev && ev.key === 'Enter' && !ev.shiftKey) {
      if (typeof ev.preventDefault === 'function') ev.preventDefault();
      sendPrompt(input.value);
    }
  });

  if (options.autoConnect !== false) connect();

  return {
    root,
    panel,
    open,
    close,
    sendPrompt,
    setMode,
    toggleMode,
    getMode: () => mode,
    getAgentId: () => agentId,
    sessionId,
    connect,
    destroy,
    /** test seam — feed a raw server frame as the socket would. */
    _receive: onServer,
  };
}

// Optional auto-mount: a <script data-ui-assist-auto data-relay-url="…"> mounts on load.
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  const tag = document.currentScript;
  if (tag && tag.dataset && 'uiAssistAuto' in tag.dataset) {
    mountUiAssist({ relayUrl: tag.dataset.relayUrl, agentId: tag.dataset.agentId });
  }
}
