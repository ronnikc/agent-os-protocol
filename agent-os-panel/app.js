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

  if (typeof window !== 'undefined' && window.AGENT_OS_HOSTED) {
    // 1. Intercept /api/mode
    if (url === '/api/mode') {
      const s = hostedSession();
      return { mode: 'swarm', lobbyUrl: window.location.origin, lobbyId: s?.lobbyId || null };
    }

    // 2. Intercept /api/overview-stats
    if (url === '/api/overview-stats') {
      return {
        agents: { online: 0, total: 0 },
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
        } else if (cleanPath === 'integrations/github') {
          lobbyPath = `/api/v1/agent-lobby/lobbies/${s.lobbyId}/integrations/github`;
        } else if (cleanPath === 'integrations/github/connect') {
          lobbyPath = `/api/v1/agent-lobby/lobbies/${s.lobbyId}/integrations/github/connect`;
        } else {
          lobbyPath = `/api/v1/agent-lobby/${path}`;
        }

        finalUrl = lobbyPath;
        finalOpts.headers = {
          ...(finalOpts.headers || {}),
          'Authorization': `Bearer ${s.token}`
        };
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
  if (typeof window === 'undefined' || !window.AGENT_OS_HOSTED) return null;
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
  if (typeof window !== 'undefined' && window.AGENT_OS_HOSTED) {
    return;
  }
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

export function showAlert(title, message) {
  showModal(`
    <h2>${escapeHtml(title)}</h2>
    <p style="font-size:13px; color:var(--color-text-soft); line-height:1.5; margin:12px 0 20px;">${escapeHtml(message).replace(/\n/g, '<br>')}</p>
    <div class="form-actions" style="margin:0;">
      <button class="btn btn-primary" onclick="closeModal()">OK</button>
    </div>
  `);
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

  if (typeof window !== 'undefined' && window.AGENT_OS_HOSTED) {
    const session = hostedSession();
    if (!session) {
      renderAuthOverlay();
      return;
    }
    state.session = session;
    updateHeaderUI();
    loadLobbies();

    if (window.concordium) {
      window.concordium.connect().then(async (addr) => {
        if (addr) {
          const addrStr = (typeof addr === 'string') ? addr : (addr.address || addr.toString?.());
          state.wallet.connected = true;
          state.wallet.address = addrStr;
          state.wallet.balance = await fetchWalletBalance(window.concordium, addrStr);
          updateHeaderUI();
        }
      }).catch(() => {});
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

export async function connectWallet() {
  if (state.wallet.connected) {
    state.wallet.connected = false;
    state.wallet.address = null;
    state.wallet.balance = null;
    updateHeaderUI();
    return;
  }

  const provider = window.concordium;
  if (!provider) {
    alert('Concordium Browser Wallet extension not found.\nPlease install it from https://www.concordium.com/wallet and reload this page.');
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
    
    updateHeaderUI();
  } catch (err) {
    console.error('Wallet connection failed:', err);
    alert(`Wallet Connection Failed: ${err.message || err}`);
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
      alert('Please create or select a lobby first.');
      return;
    }
  } else {
    state.session.lobbyId = lobbyId;
  }

  const activeLobbyId = state.session.lobbyId;
  const provider = window.concordium;
  if (!provider || !state.wallet.connected || !state.wallet.address) {
    alert('Please connect your wallet first.');
    return;
  }

  try {
    const challengeRes = await fetchJson('/api/v1/agent-lobby/auth/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: state.wallet.address, lobby_id: activeLobbyId, network: 'testnet' })
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
    
    localStorage.setItem('agentos.hosted.session', JSON.stringify({
      token: verifyRes.token,
      identityRef: verifyRes.identity_ref,
      lobbyId: activeLobbyId
    }));

    window.location.reload();
  } catch (err) {
    console.error('Sign-in failed:', err);
    alert(`Authentication Failed: ${err.message || err}`);
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
  if (typeof window === 'undefined' || !window.AGENT_OS_HOSTED) return;

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
      walletBtn.onclick = connectWallet;
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
        alert('Sign in failed: ' + err.message);
        updateAuthStatus();
      });
    };
  }
}
