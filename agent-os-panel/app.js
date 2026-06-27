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
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
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
    btn.classList.toggle('active', btn.dataset.tab === id);
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
  // Fetch mode info
  const modeData = await fetchJson('/api/mode');
  const mode = modeData?.mode || 'local';
  const modeBadge = mode === 'swarm'
    ? `<span style="background:var(--purple);color:white;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;">Swarm: ${(modeData?.lobbyUrl || '').replace(/^https?:\/\//, '').slice(0, 30)}</span>`
    : `<span style="background:var(--success);color:white;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;">Local Mode</span>`;
  el.innerHTML = `
    ${modeBadge}
    <span><span class="status-dot ${state.wsConnected ? 'status-running' : 'status-stopped'}"></span>WS</span>
    <span>${running} / ${state.agents.length} agents</span>
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

  // Wire up tab buttons
  document.querySelectorAll('.tab-bar button[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

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
