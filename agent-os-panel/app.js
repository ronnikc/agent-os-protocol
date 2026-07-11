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
  mode: 'local',
  // Hosted GitHub integration snapshot for the top-bar working-repo pill (refreshed periodically).
  githubStatus: null,
  wallet: {
    connected: false,
    address: null,
    balance: null
  },
  session: {
    token: null,
    identityRef: null,
    lobbyId: null
  },
  lobbies: []
};

// ── Utilities ──
export async function fetchJson(url, opts) {
  let finalUrl = url;
  let finalOpts = opts || {};

  let token = null;
  let lobbyId = null;
  const s = hostedSession();
  if (s && s.token) {
    token = s.token;
    lobbyId = s.lobbyId;
  } else {
    token = localStorage.getItem('agent-os-lobby-token');
    lobbyId = state.session?.lobbyId;
  }

  if (typeof window !== 'undefined' && window.AGENT_OS_HOSTED && s && s.lobbyId) {
    if (url.startsWith('/api/v1/agent-lobby/lobbies/local/')) {
      url = url.replace('/api/v1/agent-lobby/lobbies/local/', `/api/v1/agent-lobby/lobbies/${s.lobbyId}/`);
    }
    if (url.startsWith('/api/messages')) {
      url = `/api/lobby/remote/messages${url.slice('/api/messages'.length)}`;
    } else if (url.startsWith('/api/tasks')) {
      url = `/api/lobby/remote/tasks${url.slice('/api/tasks'.length)}`;
    } else if (url.startsWith('/api/gantt/phases')) {
      url = `/api/lobby/remote/gantt/phases${url.slice('/api/gantt/phases'.length)}`;
    } else if (url.startsWith('/api/lobby/state')) {
      url = `/api/lobby/remote/settings`;
    }
  }

  if (url.startsWith('/api/lobby/remote/') || url.startsWith('/api/v1/agent-lobby/')) {
    if (token) {
      finalOpts.headers = {
        ...(finalOpts.headers || {}),
        'Authorization': `Bearer ${token}`
      };
    }
    if (lobbyId) {
      finalOpts.headers = {
        ...(finalOpts.headers || {}),
        'X-Lobby-Id': lobbyId
      };
    }
  }

  if (typeof window !== 'undefined' && window.AGENT_OS_HOSTED) {
    // 1. Intercept /api/mode
    if (url === '/api/mode') {
      const s = hostedSession();
      return { mode: 'swarm', lobbyUrl: window.location.origin, lobbyId: s?.lobbyId || null };
    }

    // 2. Intercept /api/overview-stats
    if (url === '/api/overview-stats') {
      const onlineCount = (state.agents || []).filter(a => a.status === 'running' || a.status === 'online' || a.status === 'idle' || a.status === 'active').length;
      return {
        agents: { online: onlineCount, total: (state.agents || []).length || 60 },
        tasks: { in_progress: 0 },
        sprint: { active: false, progress_percent: 0 },
        throughput: { tasks_per_day: 0 },
        success_rate: { percent: 100 }
      };
    }

    // Intercept /api/agents and /api/agents/status
    if (url === '/api/agents' || url === '/api/agents/status') {
      let data = await fetchJson('/api/lobby/remote/agent-definitions');
      if (!data || data.error || !data.agents || data.agents.length === 0) {
        try {
          const origin = window.AGENT_OS_LOBBY_ORIGIN || window.location.origin;
          const fallbackRes = await fetch(`${origin}/panel/agents-list.json`);
          if (fallbackRes.ok) {
            data = await fallbackRes.json();
          }
        } catch (e) {
          console.warn('[Panel] Failed to fetch static agents-list.json fallback:', e);
        }
      }
      // Cache agent definitions for use by lobby tab role dropdown
      if (data?.agents) window.__agentDefinitions = data.agents;
      return data || { agents: [] };
    }

    // Intercept /api/presets
    if (url === '/api/presets') {
      let data = await fetchJson('/api/lobby/remote/agent-definitions');
      if (!data || data.error || !data.agents || data.agents.length === 0) {
        try {
          const origin = window.AGENT_OS_LOBBY_ORIGIN || window.location.origin;
          const fallbackRes = await fetch(`${origin}/panel/agents-list.json`);
          if (fallbackRes.ok) {
            data = await fallbackRes.json();
          }
        } catch (e) {
          console.warn('[Panel] Failed to fetch static agents-list.json fallback:', e);
        }
      }
      const presets = {};
      if (data && data.agents) {
        data.agents.forEach(a => {
          presets[a.slug] = {
            name: a.name,
            description: a.scope
          };
        });
      }
      return presets;
    }

    // Intercept /api/agents/identity
    if (url === '/api/agents/identity') {
      const s = hostedSession();
      if (s && s.lobbyId) {
        try {
          const body = JSON.parse(finalOpts.body || '{}');
          const slug = body.slug;
          const identity = body.identity;
          if (slug && identity) {
            const res = await fetchJson(`/api/lobby/remote/agents/${slug}/identity`, {
              method: 'POST',
              body: JSON.stringify({ identity })
            });
            return res;
          }
        } catch (e) {
          console.error('[Panel] Failed to intercept agents/identity:', e);
        }
      }
      return { ok: false, error: 'Swarm session inactive' };
    }

    // Intercept /api/loops
    if (url === '/api/loops') {
      let presets = {};
      try {
        const origin = window.AGENT_OS_LOBBY_ORIGIN || window.location.origin;
        const res = await fetch(`${origin}/panel/presets.json`);
        if (res.ok) {
          presets = await res.json();
        }
      } catch (e) {
        console.warn('[Panel] Failed to fetch static presets.json fallback:', e);
      }
      const presetsArr = Object.entries(presets).map(([key, val]) => ({
        name: key,
        description: val.description,
        agents: val.agents,
        unattendedAllowlist: val.agents
      }));
      return { presets: presetsArr, runs: [] };
    }

    // 3. Map proxy endpoints to direct lobby REST endpoints
    if (url.startsWith('/api/lobby/remote/')) {
      const s = hostedSession();
      if (s && s.lobbyId) {
        const path = url.slice('/api/lobby/remote/'.length);
        const cleanPath = path.split('?')[0];
        const query = path.includes('?') ? '?' + path.split('?')[1] : '';

        let lobbyPath = '';
        if (cleanPath === 'agents') {
          lobbyPath = `/api/v1/agent-lobby/lobbies/${s.lobbyId}/roster${query}`;
        } else if (cleanPath === 'agents/start') {
          lobbyPath = `/api/v1/agent-lobby/lobbies/${s.lobbyId}/hosted-agents${query}`;
        } else if (cleanPath === 'agents/stop') {
          try {
            const body = JSON.parse(finalOpts.body || '{}');
            const agentId = body.agent_id;
            if (agentId) {
              lobbyPath = `/api/v1/agent-lobby/lobbies/${s.lobbyId}/hosted-agents/${agentId}`;
              finalOpts.method = 'DELETE';
              delete finalOpts.body;
            } else {
              lobbyPath = `/api/v1/agent-lobby/lobbies/${s.lobbyId}/hosted-agents`;
            }
          } catch {
            lobbyPath = `/api/v1/agent-lobby/lobbies/${s.lobbyId}/hosted-agents`;
          }
        } else if (cleanPath === 'messages') {
          lobbyPath = `/api/v1/agent-lobby/lobbies/${s.lobbyId}/messages${query}`;
        } else if (cleanPath === 'tasks') {
          lobbyPath = `/api/v1/agent-lobby/lobbies/${s.lobbyId}/tasks${query}`;
        } else if (cleanPath === 'kb') {
          lobbyPath = `/api/v1/agent-lobby/lobbies/${s.lobbyId}/kb${query}`;
        } else if (cleanPath === 'kb/upload') {
          lobbyPath = `/api/v1/agent-lobby/lobbies/${s.lobbyId}/kb/upload${query}`;
        } else if (cleanPath === 'kb/jobs') {
          lobbyPath = `/api/v1/agent-lobby/lobbies/${s.lobbyId}/kb/jobs${query}`;
        } else if (cleanPath === 'kb/sync') {
          lobbyPath = `/api/v1/agent-lobby/lobbies/${s.lobbyId}/kb/sync${query}`;
        } else if (cleanPath === 'provider-keys') {
          lobbyPath = `/api/v1/agent-lobby/lobbies/${s.lobbyId}/provider-keys${query}`;
        } else if (cleanPath.startsWith('provider-keys/')) {
          const keyId = cleanPath.slice('provider-keys/'.length);
          lobbyPath = `/api/v1/agent-lobby/lobbies/${s.lobbyId}/provider-keys/${keyId}`;
          finalOpts.method = 'DELETE';
        } else if (cleanPath === 'scheduled') {
          lobbyPath = `/api/v1/agent-lobby/lobbies/${s.lobbyId}/scheduled${query}`;
        } else if (cleanPath === 'scheduled/setup') {
          lobbyPath = `/api/v1/agent-lobby/lobbies/${s.lobbyId}/scheduled/setup${query}`;
        } else if (cleanPath === 'settings') {
          lobbyPath = `/api/v1/agent-lobby/lobbies/${s.lobbyId}`;
        } else if (cleanPath === 'members') {
          lobbyPath = `/api/v1/agent-lobby/lobbies/${s.lobbyId}/members${query}`;
        } else if (cleanPath.startsWith('members/') && cleanPath.endsWith('/status')) {
          const parts = cleanPath.split('/');
          const memberId = parts[1];
          lobbyPath = `/api/v1/agent-lobby/lobbies/${s.lobbyId}/members/${memberId}/status`;
        } else if (cleanPath.startsWith('agents/') && cleanPath.endsWith('/identity')) {
          const parts = cleanPath.split('/');
          const slug = parts[1];
          lobbyPath = `/api/v1/agent-lobby/lobbies/${s.lobbyId}/agents/${slug}/identity`;
        } else if (cleanPath === 'integrations/github') {
          lobbyPath = `/api/v1/agent-lobby/lobbies/${s.lobbyId}/integrations/github`;
        } else if (cleanPath === 'integrations/github/connect') {
          lobbyPath = `/api/v1/agent-lobby/lobbies/${s.lobbyId}/integrations/github/connect`;
        } else if (cleanPath === 'repo/initialize') {
          lobbyPath = `/api/v1/agent-lobby/lobbies/${s.lobbyId}/repo/initialize`;
        } else if (cleanPath === 'repo/ui-assist') {
          lobbyPath = `/api/v1/agent-lobby/lobbies/${s.lobbyId}/repo/ui-assist`;
        } else if (cleanPath === 'create') {
          lobbyPath = `/api/v1/agent-lobby/lobbies`;
        } else if (cleanPath === 'status') {
          lobbyPath = `/api/v1/agent-lobby/lobbies/${s.lobbyId}`;
          finalOpts.method = 'PATCH';
        } else if (cleanPath === 'boss-agent') {
          lobbyPath = `/api/v1/agent-lobby/lobbies/${s.lobbyId}/boss-agent`;
        } else if (cleanPath === 'messages/clear') {
          lobbyPath = `/api/v1/agent-lobby/lobbies/${s.lobbyId}/messages/clear`;
        } else if (cleanPath === 'messages') {
          lobbyPath = `/api/v1/agent-lobby/lobbies/${s.lobbyId}/messages${query}`;
        } else if (cleanPath === 'tasks') {
          lobbyPath = `/api/v1/agent-lobby/lobbies/${s.lobbyId}/tasks${query}`;
        } else if (cleanPath === 'requests') {
          lobbyPath = `/api/v1/agent-lobby/lobbies/${s.lobbyId}/requests/pending`;
        } else if (cleanPath.startsWith('requests/') && cleanPath.endsWith('/decide')) {
          const requestId = cleanPath.split('/')[1];
          lobbyPath = `/api/v1/agent-lobby/lobbies/${s.lobbyId}/requests/${requestId}/decide`;
        } else if (cleanPath.startsWith('providers/') && cleanPath.endsWith('/models')) {
          const provider = cleanPath.split('/')[1];
          lobbyPath = `/api/v1/agent-lobby/lobbies/${s.lobbyId}/providers/${provider}/models`;
        } else if (cleanPath === 'agent-nicknames') {
          lobbyPath = `/api/v1/agent-lobby/lobbies/${s.lobbyId}/agent-nicknames`;
        } else if (cleanPath === 'agent-definitions') {
          lobbyPath = `/api/v1/agent-lobby/lobbies/${s.lobbyId}/agent-definitions`;
        } else if (cleanPath === 'gantt/phases') {
          lobbyPath = `/api/v1/agent-lobby/lobbies/${s.lobbyId}/gantt/phases`;
        } else if (cleanPath.startsWith('tasks/') && cleanPath.endsWith('/delete')) {
          const taskId = cleanPath.split('/')[1];
          lobbyPath = `/api/v1/agent-lobby/lobbies/${s.lobbyId}/tasks/${taskId}/delete`;
        } else if (cleanPath.startsWith('tasks/')) {
          const taskId = cleanPath.split('/')[1];
          lobbyPath = `/api/v1/agent-lobby/lobbies/${s.lobbyId}/tasks/${taskId}`;
        } else {
          lobbyPath = `/api/v1/agent-lobby/${path}`;
        }

        finalUrl = lobbyPath;
        finalOpts.headers = {
          ...(finalOpts.headers || {}),
          'Authorization': `Bearer ${s.token}`,
          'X-Lobby-Id': s.lobbyId
        };
      } else {
        let token = localStorage.getItem('agent-os-lobby-token');
        if (!token) {
          try {
            token = JSON.parse(localStorage.getItem('agentos.hosted.session') || 'null')?.token;
          } catch {}
        }
        if (token) {
          finalOpts.headers = {
            ...(finalOpts.headers || {}),
            'Authorization': `Bearer ${token}`
          };
        }
      }
    }
  }

  try {
    const r = await fetch(finalUrl, finalOpts);
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

/**
 * The wallet session shared by lobby-web (same origin) when the panel runs hosted at /panel.
 * Returns { token, identityRef, lobbyId } or null (local mode, or not signed in).
 */
export function hostedSession() {
  if (typeof window === 'undefined') return null;
  try {
    const s = JSON.parse(localStorage.getItem('agentos.hosted.session') || 'null');
    return s && s.token && s.lobbyId ? s : null;
  } catch { return null; }
}

/** Call a lobby API (`/api/v1/agent-lobby<path>`) with the hosted wallet session token. */
export async function lobbyApi(path, opts = {}) {
  const s = hostedSession();
  if (!s) return null;
  try {
    const r = await fetch(`/api/v1/agent-lobby${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${s.token}`, ...(opts.headers || {}) },
    });
    return await r.json();
  } catch { return null; }
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
  if (typeof window !== 'undefined' && window.AGENT_OS_HOSTED) {
    const s = hostedSession();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const lobbyQuery = s && s.lobbyId ? `?lobby_id=${encodeURIComponent(s.lobbyId)}` : '';
    return `${proto}://${location.host}/api/v1/agent-lobby/ws/agent${lobbyQuery}`;
  }
  const data = await fetchJson('/api/relay');
  const port = Number(data?.port) || 4722;
  const host = location.hostname || 'localhost';
  return `ws://${host}:${port}`;
}

export function truncate(s, n = 120) {
  return s && s.length > n ? s.slice(0, n) + '...' : (s || '');
}

// ── Agent name resolution (shared) ──
// Maps an agent_id (or 'system'/'LobbyOwner'/'WebUser') to a human name for Messages/Tasks, so the
// UI never shows a raw uuid. Backed by the live lobby roster, refreshed on demand and cached.
let _agentNameMap = {};
let _agentNameMapAt = 0;
export async function refreshAgentNameMap(force = false) {
  if (!force && Date.now() - _agentNameMapAt < 8000) return _agentNameMap;
  const map = {};
  try {
    const data = await fetchJson('/api/lobby/remote/agents');
    for (const a of (data?.agents || [])) if (a.agent_id) map[a.agent_id] = a.display_name || a.agent_role || a.agent_id;
  } catch {}
  _agentNameMap = map;
  _agentNameMapAt = Date.now();
  return map;
}
export function agentName(id) {
  if (!id) return '?';
  if (id === 'system') return 'System';
  if (id === 'all' || id === '*' || id === 'broadcast') return 'everyone';
  if (id === 'LobbyOwner') return 'LobbyOwner';
  if (id === 'WebUser') return 'WebUser';
  const n = _agentNameMap[id];
  if (n) return n;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id) ? id.slice(0, 8) + '…' : id;
}

// ── Shared markdown renderer (chat-grade) ──
// A compact, safe markdown → HTML renderer used by Messages and the Tasks report so both match the
// UI Assist quality. Escapes first, then applies a limited, well-tested set of transforms.
export function renderMarkdownSafe(content) {
  if (!content) return '';
  let html = escapeHtml(String(content));
  const codeBlocks = [];
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, _l, code) => {
    codeBlocks.push(`<pre style="background:var(--bg-base);padding:8px;border-radius:4px;font-size:11px;margin:6px 0;overflow-x:auto;white-space:pre;"><code>${code}</code></pre>`);
    return `%%CB${codeBlocks.length - 1}%%`;
  });
  html = html
    .replace(/^#### (.+)$/gm, '<div style="font-size:13px;font-weight:700;margin:8px 0 3px;">$1</div>')
    .replace(/^### (.+)$/gm, '<div style="font-size:14px;font-weight:700;margin:10px 0 4px;">$1</div>')
    .replace(/^## (.+)$/gm, '<div style="font-size:15px;font-weight:700;margin:12px 0 4px;">$1</div>')
    .replace(/^# (.+)$/gm, '<div style="font-size:16px;font-weight:700;margin:12px 0 4px;">$1</div>')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code style="background:var(--bg-base);padding:1px 4px;border-radius:3px;font-size:11px;">$1</code>')
    .replace(/^\s*[-*] (.+)$/gm, '<div style="margin-left:16px;">• $1</div>')
    .replace(/^\s*(\d+)\. (.+)$/gm, '<div style="margin-left:16px;">$1. $2</div>')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" style="color:var(--accent,#38bdf8);">$1</a>')
    .replace(/^---$/gm, '<hr style="border:none;border-top:1px solid var(--border);margin:8px 0;">')
    .replace(/\n/g, '<br>');
  html = html.replace(/%%CB(\d+)%%/g, (_, i) => `</p>${codeBlocks[+i]}<p>`).replace(/<br>(<(?:pre|div|hr))/g, '$1');
  return html;
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
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let wsUrl = `${proto}://${location.host}/ws`;
    if (window.AGENT_OS_HOSTED) {
      const s = hostedSession();
      const lobbyQuery = s && s.lobbyId ? `?lobby_id=${encodeURIComponent(s.lobbyId)}` : '';
      wsUrl = `${proto}://${location.host}/api/v1/agent-lobby/ws/agent${lobbyQuery}`;
    }
    ws = new WebSocket(wsUrl);
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
  
  const isHosted = !!window.AGENT_OS_HOSTED;
  let mode = 'local';
  let lobbyUrl = '';
  
  if (isHosted) {
    mode = 'swarm';
    lobbyUrl = window.AGENT_OS_LOBBY_ORIGIN || window.location.origin;
  } else {
    try {
      const modeData = await fetchJson('/api/mode');
      mode = modeData?.mode || 'local';
      lobbyUrl = modeData?.lobbyUrl || '';
    } catch {}
  }
  
  const modeHtml = mode === 'swarm'
    ? `<span class="status-pill swarm" title="${escapeHtml(lobbyUrl)}">Swarm: ${escapeHtml(lobbyUrl.replace(/^https?:\/\//, '').slice(0, 30))}</span>`
    : `<span class="status-pill local">Local Mode</span>`;

  const wsHtml = `<span class="status-pill ${state.wsConnected ? 'connected' : ''}">
    <span class="status-dot ${state.wsConnected ? 'status-running' : 'status-stopped'}"></span>WS
  </span>`;

  const agentsHtml = `<span class="status-pill">${running} / ${state.agents.length} agents</span>`;

  // Working-repo pill (hosted): the repository this lobby's agents operate on — definitions,
  // Agent IDs, KB/memories, scheduled prompts, and agent commits all target it, so it must be
  // obvious from every tab (like a git branch indicator). Click routes to the Lobby tab.
  let repoHtml = '';
  if (mode === 'swarm') {
    const g = state.githubStatus;
    if (!g || g.configured === false && !g.connected) {
      repoHtml = `<span class="status-pill" id="status-repo-pill" style="cursor:pointer;color:var(--warning,#eab308);" title="No GitHub App configured — connect it in the Lobby tab so agents can work on a repository">⚠ Connect GitHub</span>`;
    } else if (!g.connected || !g.repo) {
      repoHtml = `<span class="status-pill" id="status-repo-pill" style="cursor:pointer;color:var(--warning,#eab308);" title="GitHub App ${g.connected ? 'connected — select the working repository' : 'not installed'} in the Lobby tab">⚠ Select repo</span>`;
    } else {
      const init = g.initialized ? '' : ' · not initialized';
      repoHtml = `<span class="status-pill ${g.initialized ? 'connected' : ''}" id="status-repo-pill" style="cursor:pointer;" title="Working repository for this lobby${g.initialized ? ' (Agent OS structure initialized)' : ' — initialize the Agent OS structure in the Lobby tab'}">📁 ${escapeHtml(g.repo)}@${escapeHtml(g.branch || 'main')}${init}</span>`;
    }
  }

  el.innerHTML = `
    <div class="status-pill-group">
      ${modeHtml}
      ${repoHtml}
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
if (typeof window !== 'undefined') {
  window.closeModal = closeModal;
}

export function showAlert(title, message) {
  showModal(`
    <h2>${escapeHtml(title)}</h2>
    <p style="font-size:13px; color:var(--color-text-soft); line-height:1.5; margin:12px 0 20px;">${escapeHtml(message).replace(/\n/g, '<br>')}</p>
    <div class="form-actions" style="margin:0;">
      <button class="btn btn-primary" onclick="closeModal()">OK</button>
    </div>
  `);
}

export function showHtmlAlert(title, html) {
  showModal(`
    <h2>${escapeHtml(title)}</h2>
    <div style="font-size:13px; color:var(--color-text-soft); line-height:1.5; margin:12px 0 20px;">${html}</div>
    <div class="form-actions" style="margin:0;">
      <button class="btn btn-primary" onclick="closeModal()">OK</button>
    </div>
  `);
}
if (typeof window !== 'undefined') {
  window.showHtmlAlert = showHtmlAlert;
}

export function showConfirm(title, message, onConfirm) {
  showModal(`
    <h2>${escapeHtml(title)}</h2>
    <p style="font-size:13px; color:var(--color-text-soft); line-height:1.5; margin:12px 0 20px;">${escapeHtml(message).replace(/\n/g, '<br>')}</p>
    <div class="form-actions" style="margin:0; display:flex; gap:8px; justify-content:flex-end;">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="modal-confirm-btn">Confirm</button>
    </div>
  `);
  document.getElementById('modal-confirm-btn')?.addEventListener('click', () => {
    closeModal();
    onConfirm();
  });
}

// ── Init ──
export async function init() {
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key === 'agentos.hosted.session' || e.key === 'agent-os-lobby-user') {
        window.location.reload();
      }
    });
  }

  const session = hostedSession();
  if (session) {
    state.session = session;
    if (session.identityRef) {
      const parts = session.identityRef.split(':');
      const address = parts[parts.length - 1];
      state.wallet.connected = true;
      state.wallet.address = address;
      localStorage.setItem('agentos.wallet.connected', 'true');
    }
  }

  const modeData = await fetchJson('/api/mode');
  const isSwarmMode = modeData?.mode === 'swarm';
  state.mode = modeData?.mode || 'local';

  if (typeof window !== 'undefined' && (window.AGENT_OS_HOSTED || isSwarmMode)) {
    if (window.AGENT_OS_HOSTED && !session) {
      renderAuthOverlay();
      return;
    }
    updateHeaderUI();
    loadLobbies();

    if (state.wallet.connected && state.wallet.address) {
      setTimeout(() => {
        if (window.concordium) {
          fetchWalletBalance(window.concordium, state.wallet.address).then(bal => {
            if (bal !== null) {
              state.wallet.balance = bal;
              updateHeaderUI();
            }
          }).catch(console.error);
        }
      }, 500);
    } else if (localStorage.getItem('agentos.wallet.connected') === 'true') {
      setTimeout(() => {
        if (window.concordium) {
          connectWallet({ silent: true }).catch(() => {});
        }
      }, 500);
    }
  }

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
  if (presetData && !presetData.error) state.presets = presetData;

  // Hosted: keep the top-bar working-repo pill current. 30s cadence — the server caches the
  // initialized check, and repo changes come through the Lobby tab which triggers its own refresh.
  if (window.AGENT_OS_HOSTED) {
    const refreshGithubStatus = async () => {
      try {
        const g = await fetchJson('/api/lobby/remote/integrations/github');
        state.githubStatus = (g && !g.error) ? g : null;
      } catch { state.githubStatus = null; }
      updateStatusBar();
    };
    refreshGithubStatus();
    setInterval(refreshGithubStatus, 60000); // 60s — the status call touches the GitHub API; keep it light
    // The pill is re-rendered on every status-bar update; delegate the click once.
    document.getElementById('status-bar')?.addEventListener('click', (e) => {
      if (e.target.closest('#status-repo-pill')) switchTab('lobby');
    });
  }

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
      let agents = data.agents || state.agents;
      // In hosted/swarm mode, merge live roster status so the top-bar counter shows running agents
      if (window.AGENT_OS_HOSTED) {
        try {
          const token = localStorage.getItem('agent-os-lobby-token');
          const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
          const remoteData = await fetchJson('/api/lobby/remote/agents', { headers });
          const remoteRoster = remoteData?.agents || [];
          agents = agents.map(a => {
            const activeRemote = remoteRoster.find(ra => ra.agent_role === a.slug && ra.status !== 'disconnected');
            return { ...a, status: activeRemote ? 'running' : (a.status || 'stopped') };
          });
        } catch {}
      }
      state.agents = agents;
      updateStatusBar();
    }
  }, 5000);
}

function fetchWalletBalance(provider, addrStr) {
  return new Promise(async (resolve) => {
    try {
      let accountInfo = null;
      if (typeof provider?.getGrpcClient === 'function') {
        accountInfo = await (await provider.getGrpcClient()).getAccountInfo(addrStr);
      } else if (typeof provider?.getJsonRpcClient === 'function') {
        accountInfo = await (await provider.getJsonRpcClient()).getAccountInfo(addrStr);
      }
      const amount = accountInfo?.accountAmount || accountInfo?.amount;
      const micro = amount?.microCCD !== undefined ? amount.microCCD : (amount?.micro === undefined ? amount : amount.micro);
      if (micro !== undefined && micro !== null) { resolve(Number(micro) / 1_000_000); return; }
    } catch (rpcErr) {
      console.debug('[Wallet] RPC balance check skipped:', rpcErr);
    }
    resolve(null);
  });
}

export async function disconnectWallet() {
  state.wallet.connected = false;
  state.wallet.address = null;
  state.wallet.balance = null;
  localStorage.removeItem('agentos.wallet.connected');
  localStorage.removeItem('agentos.hosted.session');
  state.session = { token: null, identityRef: null, lobbyId: null };
  updateHeaderUI();
  if (window.AGENT_OS_HOSTED) {
    window.location.reload();
  }
}

export async function connectWallet({ silent = false } = {}) {
  const provider = window.concordium;
  if (!provider) {
    if (!silent) {
      showHtmlAlert('Concordium Wallet Required', `
        <div style="text-align:left;font-size:12px;line-height:1.5;">
          <p><strong>To manage this lobby, you need the Concordium Browser Wallet.</strong></p>
          <p>1. Download the wallet extension from the <a href="https://chrome.google.com/webstore/detail/concordium-wallet/odfbpeocbbpdnneocdnlphceeapeglne" target="_blank" style="color:var(--color-purple);text-decoration:underline;">Chrome Web Store</a>.</p>
          <p>2. Create a Concordium ID. This ID links your real-world identity/accountability to your wallet address securely and privately.</p>
          <p>3. Your wallet address is then used to authenticate against the lobby and co-sign Agent IDs. This establishes a cryptographic trust chain: <strong>Human Owner (via Concordium ID) ➔ Wallet Address ➔ Agent ID (DID)</strong>.</p>
          <p>This accountability link is required to secure private lobbies, trace agent actions back to their owner, and prevent malicious agent spoofing.</p>
        </div>
      `);
    }
    return;
  }

  try {
    const accountAddress = await provider.connect();
    if (!accountAddress) {
      throw new Error('Connection rejected by user.');
    }

    const addrStr = (typeof accountAddress === 'string')
      ? accountAddress
      : (accountAddress?.address || accountAddress?.toString?.() || String(accountAddress));

    const balanceCcd = await fetchWalletBalance(provider, addrStr);

    state.wallet.connected = true;
    state.wallet.address = addrStr;
    state.wallet.balance = balanceCcd;
    localStorage.setItem('agentos.wallet.connected', 'true');
    
    updateHeaderUI();
  } catch (err) {
    console.error('Wallet connection failed:', err);
    if (!silent) {
      localStorage.removeItem('agentos.wallet.connected');
      showAlert('Connection Failed', `Wallet Connection Failed: ${err.message || err}`);
    }
  }
}

export async function signInToLobby() {
  const lobbySelect = document.getElementById('header-lobby-select');
  let lobbyId = lobbySelect ? lobbySelect.value : null;
  if (!lobbyId) {
    // Attempt auto-creation of a default lobby session
    const created = await fetchJson('/api/v1/agent-lobby/lobbies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Default Swarm Lobby' })
    });
    if (created && created.lobby_id) {
      lobbyId = created.lobby_id;
      state.session.lobbyId = lobbyId;
      await loadLobbies();
    } else {
      showAlert('Error', 'Please create or select a lobby first.');
      return;
    }
  } else {
    state.session.lobbyId = lobbyId;
  }

  const activeLobbyId = state.session.lobbyId;
  const provider = window.concordium;
  if (!provider) {
    showAlert('Wallet Not Found', 'Concordium Browser Wallet extension not found.\nPlease install it from https://www.concordium.com/wallet and reload this page.');
    return;
  }

  if (!state.wallet.connected || !state.wallet.address) {
    try {
      await connectWallet();
    } catch (err) {
      showAlert('Error', 'Wallet connection failed.');
      return;
    }
  }

  if (!state.wallet.connected || !state.wallet.address) {
    showAlert('Error', 'Please connect your wallet first.');
    return;
  }

  try {
    const lobbyUrl = window.AGENT_OS_LOBBY_ORIGIN || window.location.origin;
    const network = /testnet/i.test(lobbyUrl) ? 'testnet' : 'mainnet';

    const challengeRes = await fetchJson('/api/v1/agent-lobby/auth/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: state.wallet.address, lobby_id: activeLobbyId, network })
    });

    if (!challengeRes || !challengeRes.challenge_id) {
      throw new Error('Failed to obtain authentication challenge from server.');
    }

    const signature = await provider.signMessage(state.wallet.address, challengeRes.challenge);
    
    const verifyRes = await fetchJson('/api/v1/agent-lobby/auth/verify-wallet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challenge_id: challengeRes.challenge_id,
        account: state.wallet.address,
        signature,
        session_id: challengeRes.session_id
      })
    });

    if (!verifyRes || !verifyRes.token) {
      throw new Error('Verification rejected. Signature could not be verified.');
    }

    state.session.token = verifyRes.token;
    state.session.identityRef = verifyRes.identity_ref;
    
    const didParts = verifyRes.identity_ref.split(':');
    const address = didParts[didParts.length - 1];
    state.wallet.connected = true;
    state.wallet.address = address;
    localStorage.setItem('agentos.wallet.connected', 'true');
    
    localStorage.setItem('agentos.hosted.session', JSON.stringify({
      token: verifyRes.token,
      identityRef: verifyRes.identity_ref,
      lobbyId: activeLobbyId
    }));

    window.location.reload();
  } catch (err) {
    console.error('Sign-in failed:', err);
    showAlert('Authentication Failed', err.message || err);
  }
}

export async function loadLobbies() {
  const select = document.getElementById('header-lobby-select');
  if (!select) return;

  try {
    const data = await fetchJson('/api/v1/agent-lobby/lobbies');
    if (data && data.lobbies) {
      state.lobbies = data.lobbies;
      
      select.innerHTML = '';
      if (state.lobbies.length === 0) {
        select.innerHTML = '<option value="">No Active Lobbies</option>';
      } else {
        state.lobbies.forEach(l => {
          const opt = document.createElement('option');
          opt.value = l.lobby_id;
          opt.textContent = l.name;
          if (state.session.lobbyId === l.lobby_id) {
            opt.selected = true;
          }
          select.appendChild(opt);
        });
      }
    }
  } catch (err) {
    console.error('Failed to load lobbies:', err);
  }
}

export function updateHeaderUI() {
  if (typeof window === 'undefined') return;
  const isSwarm = window.AGENT_OS_HOSTED || state.mode === 'swarm';
  if (!isSwarm) return;

  const controls = document.getElementById('header-swarm-controls');
  if (controls) controls.style.display = 'flex';

  const walletStatus = document.getElementById('header-wallet-status');
  const walletBtn = document.getElementById('btn-header-connect-wallet');

  if (walletStatus && walletBtn) {
    if (state.wallet.connected) {
      const shortAddr = state.wallet.address.slice(0, 6) + '...' + state.wallet.address.slice(-4);
      const balanceText = Number.isFinite(state.wallet.balance)
        ? ` (${state.wallet.balance.toLocaleString(undefined, { maximumFractionDigits: 4 })} CCD)`
        : '';
      walletStatus.textContent = shortAddr + balanceText;
      walletStatus.style.color = 'var(--color-green)';
      walletBtn.textContent = 'Disconnect';
      walletBtn.onclick = disconnectWallet;
    } else {
      walletStatus.textContent = 'Not Connected';
      walletStatus.style.color = 'var(--color-text-soft)';
      walletBtn.textContent = 'Connect';
      walletBtn.onclick = connectWallet;
    }
  }

  const select = document.getElementById('header-lobby-select');
  if (select) {
    select.onchange = async () => {
      const newLobbyId = select.value;
      if (newLobbyId && state.session.lobbyId !== newLobbyId) {
        state.session.lobbyId = newLobbyId;
        const stored = localStorage.getItem('agentos.hosted.session');
        if (stored) {
          try {
            const s = JSON.parse(stored);
            if (s && s.lobbyId === newLobbyId) {
              state.session = s;
              localStorage.setItem('agentos.hosted.session', JSON.stringify(s));
              window.location.reload();
              return;
            }
          } catch {}
        }
        state.session = { token: null, identityRef: null, lobbyId: newLobbyId };
        localStorage.removeItem('agentos.hosted.session');
        window.location.reload();
      }
    };
  }

  const lobbyUrlInput = document.getElementById('lobbyUrl');
  if (lobbyUrlInput) {
    const toolbar = lobbyUrlInput.closest('.toolbar');
    if (toolbar) {
      toolbar.style.display = 'none';
    }
  }
}

function renderAuthOverlay() {
  document.body.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:center; height:100vh; background:radial-gradient(circle at 50% 30%, #0d162a 0%, #050b18 70%); font-family:'Outfit', 'Inter', sans-serif; color:#f5f8ff; padding:20px; box-sizing:border-box;">
      <div style="background:rgba(11, 19, 38, 0.7); border:1px solid rgba(49, 140, 255, 0.2); backdrop-filter:blur(12px); border-radius:16px; padding:40px; width:480px; max-width:100%; box-shadow:0 12px 40px rgba(0,0,0,0.5), 0 0 80px rgba(0,229,212,0.03); text-align:center; box-sizing:border-box;">
        <!-- Logo/Icon -->
        <div style="margin-bottom:24px;">
          <svg viewBox="0 0 24 24" width="64" height="64" style="margin:0 auto; display:block;">
            <defs>
              <linearGradient id="overlay-grad" x1="0%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#00E5D4" />
                <stop offset="100%" stop-color="#318CFF" />
              </linearGradient>
            </defs>
            <path d="M 12,2 L 22,7 L 22,17 L 12,22 L 2,17 L 2,7 Z" fill="none" stroke="url(#overlay-grad)" stroke-width="1.5" />
            <path d="M 12,6 L 19,9.5 L 19,14.5 L 12,18 L 5,14.5 L 5,9.5 Z" fill="rgba(0, 229, 212, 0.08)" stroke="url(#overlay-grad)" stroke-width="1" />
            <circle cx="12" cy="12" r="3" fill="#00E5D4" />
          </svg>
        </div>
        
        <h2 style="font-size:22px; font-weight:600; margin:0 0 12px 0; background:linear-gradient(90deg, #00E5D4, #318CFF); -webkit-background-clip:text; -webkit-text-fill-color:transparent; font-family:'Outfit', sans-serif;">Swarm Mode Connection Required</h2>
        <p style="font-size:13px; color:#8da0bf; line-height:1.6; margin:0 0 28px 0;">To access the hosted Agent OS Panel, you must connect your Concordium Wallet and authenticate with a lobby.</p>
        
        <!-- Lobby selector container in Auth overlay -->
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 16px; background: rgba(16, 27, 49, 0.4); border: 1px solid var(--color-border); padding: 8px 12px; border-radius: 8px; justify-content: space-between;">
          <span style="font-size: 12px; color: var(--color-text-soft); font-weight: 500;">Select Lobby:</span>
          <select id="header-lobby-select" style="background:#0B1326; border:1px solid var(--color-border); color:var(--color-text); padding:4px 10px; border-radius:6px; font-size:12px; min-width: 180px;"></select>
        </div>

        <div id="auth-status-container" style="margin-bottom:24px; text-align:left;">
          <!-- Dynamic statuses will go here -->
        </div>
        
        <div style="display:flex; flex-direction:column; gap:12px;">
          <button class="btn btn-primary" id="btn-auth-action" style="padding:12px; border-radius:8px; font-size:14px; font-weight:600; width:100%; cursor:pointer; height:auto; line-height:1.2; text-transform:none; border:none; display:block;">Connect Wallet</button>
        </div>
      </div>
    </div>
  `;

  loadLobbies();
  updateAuthStatus();
  setInterval(updateAuthStatus, 1000);
}

function updateAuthStatus() {
  const container = document.getElementById('auth-status-container');
  const btn = document.getElementById('btn-auth-action');
  if (!container || !btn) return;

  const walletConnected = state.wallet.connected;
  const walletAddress = state.wallet.address;

  if (!walletConnected) {
    container.innerHTML = `
      <div style="background:rgba(255, 77, 109, 0.08); border:1px solid rgba(255, 77, 109, 0.25); border-radius:8px; padding:12px; display:flex; align-items:center; gap:10px; box-sizing:border-box;">
        <span style="color:#ff4d6d; font-size:16px; font-weight:bold;">⚠</span>
        <span style="font-size:12px; color:#8da0bf;">Wallet Status: <strong style="color:#ff4d6d;">Disconnected</strong></span>
      </div>
    `;
    btn.textContent = 'Connect Concordium Wallet';
    btn.onclick = connectWallet;
  } else {
    const shortAddr = walletAddress ? walletAddress.slice(0, 8) + '...' + walletAddress.slice(-6) : '';
    container.innerHTML = `
      <div style="background:rgba(53, 242, 138, 0.08); border:1px solid rgba(53, 242, 138, 0.25); border-radius:8px; padding:12px; display:flex; align-items:center; gap:10px; margin-bottom:10px; box-sizing:border-box;">
        <span style="color:#35f28a; font-size:16px; font-weight:bold;">✓</span>
        <span style="font-size:12px; color:#8da0bf;">Wallet Connected: <strong style="color:#f5f8ff; font-family:monospace;">${shortAddr}</strong></span>
      </div>
      <div style="background:rgba(255, 179, 0, 0.08); border:1px solid rgba(255, 179, 0, 0.25); border-radius:8px; padding:12px; display:flex; align-items:center; gap:10px; box-sizing:border-box;">
        <span style="color:#ffb300; font-size:16px; font-weight:bold;">⚠</span>
        <span style="font-size:12px; color:#8da0bf;">Lobby Status: <strong style="color:#ffb300;">Not Authenticated</strong></span>
      </div>
    `;
    btn.textContent = 'Sign In to Swarm Lobby';
    btn.disabled = false;
    btn.onclick = () => {
      btn.disabled = true;
      btn.textContent = 'Signing in via wallet...';
      signInToLobby().catch((err) => {
        showAlert('Sign In Failed', err.message || err);
        updateAuthStatus();
      });
    };
  }
}

export function showIdentitySuccessModal(res, agentName, ownerAddress, githubBound = false, bindError = '') {
  const { did, txHash, metadataUrl, anchor, anchorError, cardHash, signatureHex, network = 'mainnet' } = res;
  
  const storedBadge = metadataUrl
    ? `<span style="color:#22c55e;">✓ Hosted</span>`
    : `<span style="color:#eab308;">⚠ Server unreachable — card not hosted</span>`;
    
  let onChainLine = '';
  if (anchor) {
    const verb = anchor.mode === 'update' ? 'setAgentURI submitted (pending)' : 'Mint submitted (pending)';
    const gas = anchor.sponsored
      ? ` <span style="color:#22c55e; font-size:10px;">· sponsored (no CCD spent)</span>`
      : ` <span style="color:#8da0bf; font-size:10px;">· energy paid by your wallet</span>`;
    onChainLine = `<span style="color:#22c55e; font-weight:600;">✓ ${verb}</span> — Tx <a href="https://ccdexplorer.io/${network}/transaction/${escapeHtml(String(anchor.txHash))}" target="_blank" style="color:#38bdf8; text-decoration:underline;">${escapeHtml(String(anchor.txHash).slice(0, 16))}… ↗</a> (registry ${anchor.contract.index},${anchor.contract.subindex})${gas}`;
  } else if (anchorError) {
    onChainLine = `<span style="color:#ef4444;">✗ anchoring failed</span> — <span style="font-size:10px;">${escapeHtml(anchorError)}</span>`;
  } else {
    onChainLine = `<span style="color:#eab308;">not anchored</span> — no Agent Registry MCP endpoint configured on this lobby`;
  }

  const explorerUrl = `https://ccdexplorer.io/${network}/account/${encodeURIComponent(ownerAddress)}`;

  const html = `
    <div style="padding:24px; box-sizing:border-box;">
      <h3 style="margin:0 0 16px 0; color:#35f28a; font-size:18px; font-weight:600; display:flex; align-items:center; gap:8px;">
        <span style="font-size:22px;">✓</span> Agent ID Issued Successfully!
      </h3>
      <div style="background:var(--bg-elevated); border:1px solid var(--border); border-radius:8px; padding:16px; font-size:13px; line-height:1.8; color:#cbd5e1; box-sizing:border-box;">
        <div style="margin-bottom:8px;"><strong style="color:var(--text-primary); min-width:120px; display:inline-block;">Agent Name:</strong> <span>${escapeHtml(agentName)}</span></div>
        <div style="margin-bottom:8px;"><strong style="color:var(--text-primary); min-width:120px; display:inline-block;">DID:</strong> <span style="color:#38bdf8; font-family:monospace;">${escapeHtml(did)}</span></div>
        <div style="margin-bottom:8px;"><strong style="color:var(--text-primary); min-width:120px; display:inline-block;">Metadata:</strong> <a href="${escapeHtml(metadataUrl)}" target="_blank" style="color:#38bdf8; text-decoration:underline;">${escapeHtml(metadataUrl)}</a> ${storedBadge}</div>
        <div style="margin-bottom:8px;"><strong style="color:var(--text-primary); min-width:120px; display:inline-block;">On-Chain:</strong> <span>${onChainLine}</span></div>
        <div style="margin-bottom:8px;"><strong style="color:var(--text-primary); min-width:120px; display:inline-block;">Owner Account:</strong> <a href="${escapeHtml(explorerUrl)}" target="_blank" style="color:#38bdf8; text-decoration:underline;">View on CCDExplorer ↗</a></div>
        <div style="margin-bottom:8px;"><strong style="color:var(--text-primary); min-width:120px; display:inline-block;">Card Hash:</strong> <span style="font-size:11px; font-family:monospace; color:#8da0bf; word-break:break-all;">${cardHash || ''}</span></div>
        <div style="margin-bottom:8px;"><strong style="color:var(--text-primary); min-width:120px; display:inline-block;">Signature:</strong> <span style="font-size:11px; font-family:monospace; color:#8da0bf; word-break:break-all;">${signatureHex ? signatureHex.slice(0, 48) + '...' : ''}</span></div>
        <div><strong style="color:var(--text-primary); min-width:120px; display:inline-block;">Status:</strong> <span style="color:#22c55e; font-weight:600;">✓ Wallet-signed</span>${anchor ? (anchor.sponsored ? ' · sponsored mint (gasless)' : ' · on-chain mint submitted') : ' · card hosted off-chain by this lobby'}</div>
      </div>
      ${typeof window !== 'undefined' && window.AGENT_OS_HOSTED ? `
        ${githubBound ? `
          <div style="margin-top:16px; padding:12px; background:rgba(34, 197, 94, 0.1); border:1px solid rgba(34, 197, 94, 0.2); border-radius:6px; color:#cbd5e1; font-size:12px; line-height:1.5; text-align:left;">
            <strong style="color:#22c55e; display:block; margin-bottom:4px;">✓ Auto-Bound to GitHub Definition:</strong>
            The Agent ID has been automatically committed and pushed to your agent's definition file in your GitHub repository.
          </div>
        ` : `
          <div style="margin-top:16px; padding:12px; background:rgba(234, 179, 8, 0.1); border:1px solid rgba(234, 179, 8, 0.2); border-radius:6px; color:#cbd5e1; font-size:12px; line-height:1.5; text-align:left;">
            <strong style="color:#eab308; display:block; margin-bottom:4px;">⚠ GitHub Bind Failed:</strong>
            The Agent ID was minted successfully, but binding it to the agent definition in your repository failed:
            <div style="margin:6px 0; padding:6px 8px; background:rgba(0,0,0,0.25); border-radius:4px; font-family:monospace; font-size:11px; word-break:break-word;">${escapeHtml(bindError || 'no GitHub repository is connected')}</div>
            Fix the cause (Lobby tab → GitHub Swarm Connection) and use <strong>Set ID</strong> on the agent to retry the bind with this DID.
          </div>
        `}
      ` : `
        <div style="margin-top:16px; padding:12px; background:rgba(34, 197, 94, 0.1); border:1px solid rgba(34, 197, 94, 0.2); border-radius:6px; color:#cbd5e1; font-size:12px; line-height:1.5; text-align:left;">
          <strong style="color:#22c55e; display:block; margin-bottom:4px;">Notice:</strong>
          The Agent ID was automatically saved to your local agent definition file. Please <strong>restart</strong> the agent to connect with the new ID and update its status to verified.
        </div>
      `}
      <div style="margin-top:20px; display:flex; justify-content:flex-end;">
        <button class="btn btn-primary" id="btn-close-id-success">Done</button>
      </div>
    </div>
  `;

  showModal(html, { wide: true });
  document.getElementById('btn-close-id-success')?.addEventListener('click', () => {
    closeModal();
  });
}
