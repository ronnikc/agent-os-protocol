/**
 * Agent OS Panel — Main SPA Application
 * Tab router, shared state, WebSocket connection, utilities.
 */

// ── Shared State ──
export const state = {
  agents: [],
  presets: {},
  selected: new Set(),
  wsConnected: false,
  relayConnected: false,
  activeTab: 'agents',
};

// ── Utilities ──
export async function fetchJson(url, opts) {
  try {
    const r = await fetch(url, opts);
    return await r.json();
  } catch { return null; }
}

export async function postJson(url, body) {
  return fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function patchJson(url, body) {
  return fetchJson(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function putJson(url, body) {
  return fetchJson(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function formatTime(ts) {
  if (!ts) return '';
  return (ts || '').replace('T', ' ').replace('Z', '').slice(11, 16);
}

export function formatDate(ts) {
  if (!ts) return '';
  return (ts || '').slice(0, 16).replace('T', ' ');
}

export function escapeHtml(s) {
  if (s == null) return ''; // undefined/null → '' (else textContent renders the literal "undefined")
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

/**
 * Resolve the relay WebSocket URL from the panel server's actual relay config, instead of a
 * hardcoded port. The relay port is configurable (--relay-port / AGENT_OS_RELAY_PORT); the old
 * hardcoded ws://localhost:4722 silently broke chat + sprint execution on any non-default port.
 * Uses location.hostname so it also works when the panel is reached by name/IP rather than literal
 * "localhost" (which, from a remote browser, would point at the viewer's own machine).
 */
export async function getRelayWsUrl() {
  const data = await fetchJson('/api/relay');
  const port = Number(data?.port) || 4722;
  const host = location.hostname || 'localhost';
  return `ws://${host}:${port}`;
}

export function truncate(s, n = 120) {
  return s && s.length > n ? s.slice(0, n) + '...' : (s || '');
}

// ── WebSocket ──
let ws = null;
const wsListeners = new Map();

export function onWsMessage(type, fn) {
  if (!wsListeners.has(type)) wsListeners.set(type, []);
  wsListeners.get(type).push(fn);
}

function connectWs() {
  try {
    ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onopen = () => {
      state.wsConnected = true;
      updateStatusBar();
    };
    ws.onclose = () => {
      state.wsConnected = false;
      updateStatusBar();
      setTimeout(connectWs, 3000);
    };
    ws.onerror = () => { ws?.close(); };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        const listeners = wsListeners.get(msg.type) || [];
        for (const fn of listeners) fn(msg.data, msg);
      } catch { /* ignore */ }
    };
  } catch {
    setTimeout(connectWs, 3000);
  }
}

// ── Tab System ──
const tabModules = {};

export function registerTab(id, mod) {
  tabModules[id] = mod;
}

function switchTab(id) {
  state.activeTab = id;
  document.querySelectorAll('.tab-bar button').forEach(btn => {
    const isActive = btn.dataset.tab === id;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    btn.setAttribute('tabindex', isActive ? '0' : '-1');
  });
  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.classList.toggle('active', pane.id === `tab-${id}`);
  });
  if (tabModules[id]?.onActivate) tabModules[id].onActivate();
}

// ── Status Bar ──
async function updateStatusBar() {
  const el = document.getElementById('status-bar');
  if (!el) return;
  const running = state.agents.filter(a => a.status === 'running').length;
  const modeData = await fetchJson('/api/mode');
  const mode = modeData?.mode || 'local';
  
  const modeHtml = mode === 'swarm'
    ? `<span class="status-pill swarm" title="${escapeHtml(modeData?.lobbyUrl || '')}">Swarm: ${escapeHtml((modeData?.lobbyUrl || '').replace(/^https?:\/\//, '').slice(0, 30))}</span>`
    : `<span class="status-pill local">Local Mode</span>`;
    
  const wsHtml = `<span class="status-pill ${state.wsConnected ? 'connected' : ''}">
    <span class="status-dot ${state.wsConnected ? 'status-running' : 'status-stopped'}"></span>WS
  </span>`;
  
  const agentsHtml = `<span class="status-pill">${running} / ${state.agents.length} agents</span>`;

  el.innerHTML = `
    <div class="status-pill-group">
      ${modeHtml}
      ${wsHtml}
      ${agentsHtml}
    </div>
  `;
}

// ── Modal System ──
export function showModal(html, { wide = false } = {}) {
  let overlay = document.getElementById('modal-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'modal-overlay';
    overlay.className = 'modal-overlay';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `<div class="modal${wide ? ' modal-wide' : ''}">${html}</div>`;
  overlay.style.display = 'flex';
  overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };
}

export function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.style.display = 'none';
}

// ── Init ──
export async function init() {
  connectWs();

  // ── Hosted mode ── When the panel is served by the lobby (/panel), it runs against the hosted
  // backend. The FULL menu is present; each view is wired to its hosted data source view-by-view
  // (Files → the connected GitHub repo, Memory → the wallet-scoped Knowledge Base, Agents/Lobby/
  // Tasks → the lobby). Views not yet wired show their normal empty state. A banner marks the context.
  if (typeof window !== 'undefined' && window.AGENT_OS_HOSTED) {
    document.body.classList.add('hosted-mode');
    const banner = document.createElement('div');
    banner.textContent = 'Hosted Agent OS Panel — agents run server-side against your connected GitHub repo; identity, provider keys and the Knowledge Base are wallet-scoped.';
    banner.style.cssText = 'padding:6px 12px;font-size:11px;text-align:center;background:rgba(49,140,255,0.10);border-bottom:1px solid var(--border);color:var(--color-cyan);';
    document.body.prepend(banner);
  }

  // Wire up tab buttons
  const tablist = document.querySelector('.tab-bar');
  const buttons = tablist ? tablist.querySelectorAll('button[data-tab]') : [];
  if (tablist && buttons.length > 0) {
    tablist.setAttribute('role', 'tablist');
    buttons.forEach((btn, idx) => {
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', idx === 0 ? 'true' : 'false');
      btn.setAttribute('tabindex', idx === 0 ? '0' : '-1');
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    tablist.addEventListener('keydown', (e) => {
      const activeTab = document.activeElement;
      if (!activeTab || activeTab.parentElement !== tablist) return;

      const tabs = Array.from(buttons);
      if (tabs.length === 0) return;
      const index = tabs.indexOf(activeTab);
      let nextIndex = index;

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        nextIndex = (index + 1) % tabs.length;
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        nextIndex = (index - 1 + tabs.length) % tabs.length;
      } else if (e.key === 'Home') {
        nextIndex = 0;
      } else if (e.key === 'End') {
        nextIndex = tabs.length - 1;
      } else {
        return;
      }

      e.preventDefault();
      tabs[nextIndex].focus();
      tabs[nextIndex].click();
    });
  } else {
    document.querySelectorAll('.tab-bar button[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
  }

  // Load shared data
  const agentData = await fetchJson('/api/agents');
  if (agentData) {
    state.agents = agentData.agents || [];
    if (agentData.defaultLobbyUrl) {
      const lobbyInput = document.getElementById('lobbyUrl');
      if (lobbyInput && !lobbyInput.value) lobbyInput.value = agentData.defaultLobbyUrl;
    }
  }

  const presetData = await fetchJson('/api/presets');
  if (presetData) state.presets = presetData;

  updateStatusBar();

  // Init all registered tabs
  for (const mod of Object.values(tabModules)) {
    if (mod.init) await mod.init();
  }

  // Activate default tab
  switchTab('agents');

  // Periodic refresh
  setInterval(async () => {
    const data = await fetchJson('/api/agents/status');
    if (data) {
      state.agents = data.agents || state.agents;
      updateStatusBar();
    }
  }, 5000);
}
