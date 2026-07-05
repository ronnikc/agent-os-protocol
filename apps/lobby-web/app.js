// Agent OS Swarm Lobby — Dashboard Controller

// ── Concordium Network Configuration ──
const CCD_NETWORK = 'mainnet'; // 'mainnet' or 'testnet'
const CCD_EXPLORER_BASE = `https://ccdexplorer.io/${CCD_NETWORK}`;
// Concordium Agent Registry contract instance <index,subindex> — used for explorer links only.
// Set this to the live registry instance for your network before relying on the links
// (see https://docs.concordium.com/en/mainnet/technical-reference/agent-registry/index.html).
const CCD_AGENT_REGISTRY_CONTRACT = '9458,0';
// Concordium-hosted public REST/GraphQL endpoints for balance lookup (per network).
const CCD_WALLET_PROXY_BASE = {
  mainnet: 'https://wallet-proxy.mainnet.concordium.software',
  testnet: 'https://wallet-proxy.testnet.concordium.com'
}[CCD_NETWORK];
const CCD_SCAN_API_BASE = {
  mainnet: 'https://api-ccdscan.mainnet.concordium.software',
  testnet: 'https://api-ccdscan.testnet.concordium.com'
}[CCD_NETWORK];

const state = {
  lobbies: [],
  activeLobbyId: null,
  agents: [],
  messages: [],
  events: [],
  tasks: [],
  wallet: {
    connected: false,
    address: null,
    balance: null // CCD amount, or null while unknown/unavailable
  },
  identity: {
    ownerRegistered: false,
    ownerName: null,
    ownerDid: null,
    registeredAgentDid: null
  },
  // Hosted-Mode wallet session: a Bearer token proving this wallet, scoped to one lobby.
  session: { token: null, identityRef: null, lobbyId: null },
  stats: {
    connected_users: 0,
    connected_agents: 0,
    verified_agents: 0,
    total_lobbies: 0,
    public_lobbies: 0,
    private_lobbies: 0
  }
};

const AGENT_ROLES = [
  { value: 'accessibility', label: 'Accessibility Specialist' },
  { value: 'ad-campaign-manager', label: 'Ad Campaign Manager' },
  { value: 'api', label: 'API Engineer' },
  { value: 'backend', label: 'Backend Engineer' },
  { value: 'boss-agent', label: 'Boss Agent' },
  { value: 'build-integrity', label: 'Build Integrity Engineer' },
  { value: 'chaos-steward', label: 'Chaos Steward' },
  { value: 'client-onboarder', label: 'Client Onboarder' },
  { value: 'code-review', label: 'Code Reviewer' },
  { value: 'comms-specialist', label: 'Comms Specialist' },
  { value: 'community-liaison', label: 'Community Liaison' },
  { value: 'content', label: 'Content Specialist' },
  { value: 'crm-integration-engineer', label: 'CRM Integration Engineer' },
  { value: 'database-administrator', label: 'Database Administrator' },
  { value: 'demo-architect', label: 'Demo Architect' },
  { value: 'design-system-custodian', label: 'Design System Custodian' },
  { value: 'design', label: 'Design Specialist' },
  { value: 'devrel-advocate', label: 'DevRel Advocate' },
  { value: 'documentation', label: 'Documentation Writer' },
  { value: 'domain-specialist', label: 'Domain Specialist' },
  { value: 'drupal-specialist', label: 'Drupal Specialist' },
  { value: 'e2e-architect', label: 'E2E Architect' },
  { value: 'finops-steward', label: 'FinOps Steward' },
  { value: 'frontend', label: 'Frontend Engineer' },
  { value: 'graph-navigator', label: 'Graph Navigator' },
  { value: 'i18n-specialist', label: 'i18n Specialist' },
  { value: 'identity', label: 'Identity Specialist' },
  { value: 'infrastructure', label: 'Infrastructure Engineer' },
  { value: 'joomla-specialist', label: 'Joomla Specialist' },
  { value: 'lobby-architect', label: 'Lobby Architect' },
  { value: 'lobby-dispatcher', label: 'Lobby Dispatcher' },
  { value: 'mobile-specialist', label: 'Mobile Specialist' },
  { value: 'newsletter-strategist', label: 'Newsletter Strategist' },
  { value: 'performance-analyst', label: 'Performance Analyst' },
  { value: 'pipeline-specialist', label: 'Pipeline Specialist' },
  { value: 'planning', label: 'Planning Specialist' },
  { value: 'product-qa', label: 'Product QA' },
  { value: 'product', label: 'Product Manager' },
  { value: 'proposal-architect', label: 'Proposal Architect' },
  { value: 'reality-checker', label: 'Reality Checker' },
  { value: 'release', label: 'Release Manager' },
  { value: 'research', label: 'Research Specialist' },
  { value: 'rfp-writer', label: 'RFP Writer' },
  { value: 'runtime-adapter', label: 'Runtime Adapter' },
  { value: 'scrum-coordinator', label: 'Scrum Coordinator' },
  { value: 'security', label: 'Security Specialist' },
  { value: 'seo-link-architect', label: 'SEO Link Architect' },
  { value: 'seo', label: 'SEO Specialist' },
  { value: 'sprint-gate-enforcer', label: 'Sprint Gate Enforcer' },
  { value: 'support-triage', label: 'Support Triage' },
  { value: 'tech-debt-steward', label: 'Tech Debt Steward' },
  { value: 'test', label: 'Test Specialist' },
  { value: 'training', label: 'Training Specialist' },
  { value: 'ui-assist-integration', label: 'UI Assist Integration' },
  { value: 'ui-assist', label: 'UI Assist Specialist' },
  { value: 'umbraco-specialist', label: 'Umbraco Specialist' },
  { value: 'user-validation', label: 'User Validation Specialist' },
  { value: 'ux-researcher', label: 'UX Researcher' },
  { value: 'ux', label: 'UX Specialist' },
  { value: 'wordpress-specialist', label: 'WordPress Specialist' }
];

function getExplorerLink(did) {
  if (!did || !did.startsWith('did:ccd:')) return null;
  const parts = did.split(':');
  if (parts.length < 4) return null;
  const network = parts[2]; // 'mainnet' or 'testnet'
  const id = parts.slice(3).join(':'); // token ID, address, or agent sub-ID
  const [registryIndex, registrySubindex] = CCD_AGENT_REGISTRY_CONTRACT.split(',');
  const registryInstanceUrl = `https://ccdexplorer.io/${encodeURIComponent(network)}/instance/${registryIndex}/${registrySubindex}`;
  // If the ID is a wallet address (long base58), link to the account page.
  // Every interpolated segment is user-controlled (agents register arbitrary DIDs), so
  // encode them — unencoded values enabled stored XSS via crafted DIDs in href attributes.
  if (id.length >= 40 && !id.startsWith('agent-')) {
    return `https://ccdexplorer.io/${encodeURIComponent(network)}/account/${encodeURIComponent(id)}`;
  }
  // If it is a numeric token index, link to the Agent Registry contract instance holding it
  if (/^\d+$/.test(id)) {
    return registryInstanceUrl;
  }
  // For agent sub-IDs (agent-XXXX), link to the owner's wallet account page
  // where they can see all their registered agent tokens
  if (id.startsWith('agent-') && state.wallet.address) {
    return `https://ccdexplorer.io/${encodeURIComponent(network)}/account/${encodeURIComponent(state.wallet.address)}`;
  }
  // Fallback: link to the agent registry contract instance on the right network
  return registryInstanceUrl;
}

const MODAL_TYPES = {
  success: { icon: '✓', color: 'var(--color-green)',  label: 'Success' },
  error:   { icon: '✗', color: '#ff5c5c',             label: 'Error' },
  warning: { icon: '⚠', color: 'var(--color-yellow)', label: 'Warning' },
  info:    { icon: 'ℹ', color: 'var(--color-cyan)',    label: 'Info' }
};

function showStyledAlert(title, message, type) {
  const overlay = document.getElementById('styled-modal-overlay');
  const titleEl = document.getElementById('styled-modal-title');
  const msgEl = document.getElementById('styled-modal-message');
  const buttonsEl = document.getElementById('styled-modal-buttons');
  if (!overlay) return;

  const mt = MODAL_TYPES[type] || MODAL_TYPES.info;
  titleEl.innerHTML = `<span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:${mt.color}22;color:${mt.color};font-size:16px;margin-right:8px;">${mt.icon}</span>${escapeHtml(title)}`;
  titleEl.style.color = mt.color;
  msgEl.textContent = message;
  buttonsEl.innerHTML = `<button class="btn btn-primary btn-sm" style="min-width: 100px;" onclick="closeStyledModal()">OK</button>`;
  overlay.style.display = 'flex';
  overlay.querySelector('.styled-modal-card').style.animation = 'modalSlideIn 0.2s ease-out';
  // auto-focus the OK button for keyboard
  setTimeout(() => buttonsEl.querySelector('button')?.focus(), 50);
}

function showStyledConfirm(title, message, onConfirm) {
  const overlay = document.getElementById('styled-modal-overlay');
  const titleEl = document.getElementById('styled-modal-title');
  const msgEl = document.getElementById('styled-modal-message');
  const buttonsEl = document.getElementById('styled-modal-buttons');
  if (!overlay) return;

  const mt = MODAL_TYPES.warning;
  titleEl.innerHTML = `<span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:${mt.color}22;color:${mt.color};font-size:16px;margin-right:8px;">${mt.icon}</span>${escapeHtml(title)}`;
  titleEl.style.color = mt.color;
  msgEl.textContent = message;
  buttonsEl.innerHTML = `
    <button class="btn btn-secondary btn-sm" style="min-width: 100px;" onclick="closeStyledModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" style="min-width: 100px;" id="btn-styled-modal-confirm">Confirm</button>
  `;
  
  document.getElementById('btn-styled-modal-confirm').onclick = () => {
    closeStyledModal();
    if (onConfirm) onConfirm();
  };

  overlay.style.display = 'flex';
  overlay.querySelector('.styled-modal-card').style.animation = 'modalSlideIn 0.2s ease-out';
  setTimeout(() => document.getElementById('btn-styled-modal-confirm')?.focus(), 50);
}

window.closeStyledModal = function() {
  const overlay = document.getElementById('styled-modal-overlay');
  if (overlay) overlay.style.display = 'none';
};

// Close modal on ESC key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeStyledModal();
});

// Override native window.alert with contextual styled alert
window.alert = function(message) {
  // Auto-detect type from message content
  const msgLower = (message || '').toLowerCase();
  let type = 'info';
  let title = 'Notice';
  if (msgLower.includes('success') || msgLower.includes('registered') || msgLower.includes('released') || msgLower.includes('verified') || msgLower.includes('issued')) {
    type = 'success'; title = 'Success';
  } else if (msgLower.includes('fail') || msgLower.includes('error') || msgLower.includes('insufficient')) {
    type = 'error'; title = 'Error';
  } else if (msgLower.includes('please') || msgLower.includes('warning') || msgLower.includes('enter')) {
    type = 'warning'; title = 'Attention';
  } else if (msgLower.includes('simulated') || msgLower.includes('note:')) {
    type = 'info'; title = 'Info';
  }
  showStyledAlert(title, message, type);
};

async function fetchJson(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error(`Failed to fetch ${url}:`, err);
    return null;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(isoString) {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

// ── Render Helpers ──

function renderLobbies() {
  const container = document.getElementById('lobby-list');
  if (!container) return;

  if (state.lobbies.length === 0) {
    container.innerHTML = '<div class="empty-state">No lobbies active. Run a lobby client to register one.</div>';
    return;
  }

  container.innerHTML = state.lobbies.map(lobby => {
    const isActive = lobby.lobby_id === state.activeLobbyId;
    return `
      <div class="lobby-item ${isActive ? 'active' : ''}" onclick="selectLobby('${lobby.lobby_id}')">
        <div class="lobby-item-header">
          <span class="lobby-name">${escapeHtml(lobby.name || 'Swarm Lobby')}</span>
          <span class="lobby-visibility ${lobby.visibility === 'private' ? 'private' : 'public'}">${escapeHtml(lobby.visibility || 'public')}</span>
        </div>
        <div class="lobby-id">ID: ${escapeHtml(lobby.lobby_id)}</div>
      </div>
    `;
  }).join('');
}

// Resolve an agent_id (or 'all'/'*') to a human display name, using the live roster.
function resolveAgentName(id) {
  if (!id) return '?';
  if (id === 'all' || id === '*' || id === 'broadcast') return 'everyone';
  const a = state.agents.find(x => x.agent_id === id);
  if (a && a.display_name) return a.display_name;
  // Not in roster (disconnected, or a web user name) — show a short id, not a full UUID.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id) ? id.slice(0, 8) + '…' : id;
}

// The boss agent id for the active lobby (roster is_boss flag, else the lobby's boss_agent_id).
function activeBossId() {
  const lobby = state.lobbies.find(l => l.lobby_id === state.activeLobbyId);
  const flagged = state.agents.find(a => a.is_boss);
  return (flagged && flagged.agent_id) || lobby?.boss_agent_id || null;
}

function renderRoster() {
  const container = document.getElementById('agent-roster-list');
  const countEl = document.getElementById('roster-count');
  if (!container) return;
  const bossId = activeBossId();

  if (state.agents.length === 0) {
    container.innerHTML = '<div class="empty-state">No agents currently connected to this lobby. Connect an agent panel or relay in Swarm Mode to register.</div>';
    if (countEl) countEl.textContent = '0 agents';
    return;
  }

  if (countEl) countEl.textContent = `${state.agents.length} agent${state.agents.length === 1 ? '' : 's'}`;
  container.innerHTML = state.agents.map(agent => {
    const isWorking = agent.status === 'working' || agent.status === 'busy';
    // Verified statuses from the identity ladder (registry_verified / human_linked / org_linked)
    const isVerified = ['verified', 'registry_verified', 'human_linked', 'org_linked'].includes(agent.identity_status);
    const explorerLink = getExplorerLink(agent.agent_id);
    const idHtml = explorerLink
      ? `<a href="${escapeHtml(explorerLink)}" target="_blank" style="color:var(--color-cyan); text-decoration:underline;">${escapeHtml(agent.agent_id.slice(0, 8))}...</a>`
      : `${escapeHtml(agent.agent_id.slice(0, 8))}...`;

    const isBoss = agent.is_boss || agent.agent_id === bossId;
    return `
      <div class="agent-card-item${isBoss ? ' is-boss' : ''}">
        <div class="agent-card-header">
          <span class="agent-name">${escapeHtml(agent.display_name)}${isBoss ? ' <span class="boss-badge">★ BOSS</span>' : ''}</span>
          <span class="agent-status-indicator ${isWorking ? 'working' : 'idle'}">${escapeHtml(agent.status)}</span>
        </div>
        <div class="agent-role-badge">${escapeHtml(agent.agent_role || 'Generalist')}</div>
        
        <div class="agent-meta-row">
          <div><span class="agent-meta-label">Agent ID:</span></div>
          <div class="agent-meta-val" title="${escapeHtml(agent.agent_id)}">${idHtml}</div>
        </div>
        <div class="agent-meta-row">
          <div><span class="agent-meta-label">Identity:</span></div>
          <div class="agent-meta-val" style="color: ${isVerified ? 'var(--color-green)' : 'var(--color-text-soft)'}">${escapeHtml(agent.identity_status || 'unverified')}</div>
        </div>
        <div class="agent-meta-row">
          <div><span class="agent-meta-label">Runtime:</span></div>
          <div class="agent-meta-val">${escapeHtml(agent.runtime || '—')}</div>
        </div>
        <div class="agent-meta-row">
          <div><span class="agent-meta-label">Model:</span></div>
          <div class="agent-meta-val">${escapeHtml(agent.model || '—')}</div>
        </div>
        <div class="agent-meta-row">
          <div><span class="agent-meta-label">Branch:</span></div>
          <div class="agent-meta-val">${escapeHtml(agent.branch || '—')}</div>
        </div>
        <div class="agent-meta-row" style="grid-column: span 2;">
          <div><span class="agent-meta-label">CWD:</span></div>
          <div class="agent-meta-val" title="${escapeHtml(agent.cwd)}">${escapeHtml(agent.cwd || '—')}</div>
        </div>
      </div>
    `;
  }).join('');
}

function renderMessages() {
  const container = document.getElementById('message-list');
  if (!container) return;

  if (state.messages.length === 0) {
    container.innerHTML = '<div class="empty-state">No coordination messages exchanged in this lobby yet.</div>';
    return;
  }

  container.innerHTML = state.messages.map(msg => {
    // Show human display names, not raw agent UUIDs. from_display_name (if the server sent it)
    // wins; otherwise resolve against the live roster.
    const from = msg.from_display_name || resolveAgentName(msg.from_agent_id);
    const to = msg.to_display_name || resolveAgentName(msg.to_agent_id);
    return `
      <div class="message-item">
        <div class="message-item-header">
          <span>
            <span class="message-sender" title="${escapeHtml(msg.from_agent_id)}">${escapeHtml(from)}</span>
            &rarr;
            <span class="message-receiver" title="${escapeHtml(msg.to_agent_id)}">${escapeHtml(to)}</span>
          </span>
          <span class="message-type">${escapeHtml(msg.message_type)}</span>
        </div>
        <div class="message-content">${escapeHtml(msg.content)}</div>
      </div>
    `;
  }).join('');
  
  container.scrollTop = container.scrollHeight;
}

function renderEvents() {
  const container = document.getElementById('event-log-list');
  if (!container) return;

  if (state.events.length === 0) {
    container.innerHTML = '<div class="empty-state">No events recorded.</div>';
    return;
  }

  container.innerHTML = state.events.map(ev => {
    // Canonical LobbyEvent uses at/actor_id/detail (object); tolerate legacy timestamp/details.
    const timestamp = formatDate(ev.at || ev.timestamp);
    let classType = 'event-type-register';
    if (ev.type.includes('disconnect') || ev.type.includes('left')) classType = 'event-type-disconnect';
    if (ev.type.includes('message')) classType = 'event-type-message';
    if (ev.type.includes('task')) classType = 'event-type-task';
    if (ev.type.includes('hand')) classType = 'event-type-hand';
    if (ev.type.includes('boss')) classType = 'event-type-boss';

    let detailText = ev.details || '';
    if (!detailText && ev.detail && typeof ev.detail === 'object') {
      detailText = Object.entries(ev.detail)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${k}: ${v}`)
        .join(' · ');
    }
    const actor = ev.actor_id && ev.actor_id !== 'system' ? `${ev.actor_id} — ` : '';

    return `
      <div class="event-item">
        <span class="event-timestamp">[${timestamp}]</span>
        <span class="${classType}">${escapeHtml(ev.type)}</span>
        <span>${escapeHtml(actor + detailText)}</span>
      </div>
    `;
  }).join('');
  
  container.scrollTop = container.scrollHeight;
}

function renderTelemetry() {
  const totalLobbiesEl = document.getElementById('stats-total-lobbies');
  const connectedUsersEl = document.getElementById('stats-connected-users');
  const connectedAgentsEl = document.getElementById('stats-connected-agents');
  const verifiedAgentsEl = document.getElementById('stats-verified-agents');
  const publicLobbiesEl = document.getElementById('stats-public-lobbies');
  const privateLobbiesEl = document.getElementById('stats-private-lobbies');
  const lobbyCountEl = document.getElementById('lobby-count');

  if (totalLobbiesEl) totalLobbiesEl.textContent = state.stats.total_lobbies;
  if (connectedUsersEl) connectedUsersEl.textContent = state.stats.connected_users;
  if (connectedAgentsEl) connectedAgentsEl.textContent = state.stats.connected_agents;
  if (verifiedAgentsEl) verifiedAgentsEl.textContent = state.stats.verified_agents;
  if (publicLobbiesEl) publicLobbiesEl.textContent = state.stats.public_lobbies;
  if (privateLobbiesEl) privateLobbiesEl.textContent = state.stats.private_lobbies;
  if (lobbyCountEl) lobbyCountEl.textContent = state.stats.total_lobbies;
}

// ── Select Lobby Action ──

window.selectLobby = function(lobbyId) {
  state.activeLobbyId = lobbyId;
  state.agents = [];
  state.messages = [];
  state.events = [];
  renderLobbies();
  renderRoster();
  renderMessages();
  renderEvents();
  renderTelemetry();
  pollLobbyDetails();
};

// ── Polling Loops ──

async function pollLobbies() {
  const data = await fetchJson('/api/v1/agent-lobby/lobbies');
  if (data && data.lobbies) {
    state.lobbies = data.lobbies;
    
    if (!state.activeLobbyId && state.lobbies.length > 0) {
      const active = state.lobbies.find(l => l.status === 'active') || state.lobbies[0];
      selectLobby(active.lobby_id);
    } else {
      renderLobbies();
      renderTelemetry();
    }
  }
}

async function pollLobbyDetails() {
  if (!state.activeLobbyId) return;
  const id = state.activeLobbyId;
  
  const rosterData = await fetchJson(`/api/v1/agent-lobby/lobbies/${id}/roster`);
  if (rosterData && id === state.activeLobbyId) {
    state.agents = rosterData.agents || [];
    renderRoster();
    // Keep the Manage view's agent list live while it's the active view.
    const manageView = document.getElementById('view-manage');
    if (manageView && manageView.style.display !== 'none') renderManageAgents();
  }

  const msgData = await fetchJson(`/api/v1/agent-lobby/lobbies/${id}/messages`);
  if (msgData && id === state.activeLobbyId) {
    state.messages = msgData.messages || [];
    renderMessages();
  }

  const eventData = await fetchJson(`/api/v1/agent-lobby/lobbies/${id}/events`);
  if (eventData && id === state.activeLobbyId) {
    state.events = eventData.events || [];
    renderEvents();
  }

  const taskData = await fetchJson(`/api/v1/agent-lobby/lobbies/${id}/tasks`);
  if (taskData && id === state.activeLobbyId) {
    state.tasks = taskData.tasks || [];
    renderTasks();
  }

  renderTelemetry();
}

async function pollStats() {
  const data = await fetchJson('/api/v1/agent-lobby/stats');
  if (data) {
    state.stats = data;
    renderTelemetry();
  }
}

async function postJson(url, data) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error(`Failed to POST ${url}:`, err);
    return null;
  }
}

// ── Hosted-Mode wallet session ──

/** True when we hold a live session token for the active lobby. */
function isSignedIn() {
  return !!(state.session.token && state.session.lobbyId && state.session.lobbyId === state.activeLobbyId);
}

/** Authenticated fetch — adds the Bearer session token. Returns { ok, status, data }. */
async function authRequest(method, url, data) {
  if (!state.session.token) return { ok: false, status: 401, data: { error: 'not signed in' } };
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.session.token}` },
      body: data ? JSON.stringify(data) : undefined,
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) { state.session = { token: null, identityRef: null, lobbyId: null }; renderHostedCard(); }
    return { ok: res.ok, status: res.status, data: body };
  } catch (err) {
    console.error(`auth ${method} ${url} failed:`, err);
    return { ok: false, status: 0, data: { error: String(err) } };
  }
}

/** Sign in to the active lobby: nonce → wallet signMessage → verify → store the session token. */
async function signInToLobby() {
  const statusEl = document.getElementById('hosted-signin-status');
  const setStatus = (t) => { if (statusEl) statusEl.textContent = t; };
  if (!state.activeLobbyId) { setStatus('select a lobby first'); return; }
  if (!state.wallet.connected || !state.wallet.address) { setStatus('connect your wallet first'); return; }
  const provider = window.concordium;
  if (!provider) { setStatus('wallet extension not found'); return; }

  const identityRef = `did:ccd:${CCD_NETWORK}:${state.wallet.address}`;
  const lobbyId = state.activeLobbyId;
  try {
    setStatus('requesting challenge…');
    const challenge = await postJson('/api/v1/agent-lobby/auth/nonce', { identity_ref: identityRef, lobby_id: lobbyId });
    if (!challenge?.nonce) { setStatus('could not get a challenge'); return; }

    setStatus('sign in your wallet…');
    const signature = normalizeSignature(await provider.signMessage(state.wallet.address, challenge.nonce));

    setStatus('verifying…');
    const verified = await postJson('/api/v1/agent-lobby/auth/verify', {
      identity_ref: identityRef, lobby_id: lobbyId, signature, public_key: state.wallet.address,
    });
    if (!verified?.token) { setStatus('sign-in rejected (a wallet-verifier may not be configured yet)'); return; }

    state.session = { token: verified.token, identityRef, lobbyId };
    setStatus('');
    renderHostedCard();
  } catch (err) {
    console.error('[Hosted] sign-in failed:', err);
    setStatus(`sign-in failed: ${err.message || err}`);
  }
}

/** Render the Hosted-Mode card: session badge, and (when signed in) provider keys + hosted agents. */
async function renderHostedCard() {
  const card = document.getElementById('manage-hosted-card');
  if (!card) return;
  card.style.display = state.activeLobbyId ? '' : 'none';
  const badge = document.getElementById('hosted-session-badge');
  const keysSection = document.getElementById('hosted-keys-section');
  const agentsSection = document.getElementById('hosted-agents-section');
  const signedIn = isSignedIn();
  if (badge) { badge.textContent = signedIn ? 'signed in' : 'signed out'; badge.style.color = signedIn ? 'var(--color-green)' : 'var(--text-muted)'; }
  if (keysSection) keysSection.style.display = signedIn ? '' : 'none';
  if (agentsSection) agentsSection.style.display = signedIn ? '' : 'none';
  const signinBtn = document.getElementById('btn-hosted-signin');
  if (signinBtn) signinBtn.style.display = signedIn ? 'none' : '';
  if (signedIn) { await renderHostedKeys(); await renderHostedAgents(); }
}

async function renderHostedKeys() {
  const list = document.getElementById('hosted-keys-list');
  if (!list) return;
  const r = await authRequest('GET', `/api/v1/agent-lobby/lobbies/${state.activeLobbyId}/provider-keys`);
  const keys = r.data?.provider_keys || [];
  list.innerHTML = keys.length === 0
    ? '<div class="empty-state">No provider keys configured.</div>'
    : keys.map(k => `<div class="list-row" style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 8px;">
        <span style="font-size:11px;">${escapeHtml(k.provider)} <span style="font-family:var(--font-mono); color:var(--text-muted);">${escapeHtml(k.key_hint)}</span> · ${escapeHtml(k.scope)}${k.agent_ref ? ' · ' + escapeHtml(k.agent_ref) : ''}</span>
        <button class="btn btn-danger btn-sm" data-revoke-key="${escapeHtml(k.id)}">Revoke</button>
      </div>`).join('');
  list.querySelectorAll('[data-revoke-key]').forEach(btn => btn.addEventListener('click', async () => {
    await authRequest('DELETE', `/api/v1/agent-lobby/lobbies/${state.activeLobbyId}/provider-keys/${encodeURIComponent(btn.dataset.revokeKey)}`);
    renderHostedKeys();
  }));
}

async function renderHostedAgents() {
  const list = document.getElementById('hosted-agents-list');
  if (!list) return;
  const r = await authRequest('GET', `/api/v1/agent-lobby/lobbies/${state.activeLobbyId}/hosted-agents`);
  const agents = r.data?.hosted_agents || [];
  list.innerHTML = agents.length === 0
    ? '<div class="empty-state">No hosted agents running.</div>'
    : agents.map(a => `<div class="list-row" style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 8px;">
        <span style="font-size:11px; font-family:var(--font-mono);">${escapeHtml(a.agent_id)}</span>
        <button class="btn btn-danger btn-sm" data-stop-agent="${escapeHtml(a.agent_id)}">Stop</button>
      </div>`).join('');
  list.querySelectorAll('[data-stop-agent]').forEach(btn => btn.addEventListener('click', async () => {
    await authRequest('DELETE', `/api/v1/agent-lobby/lobbies/${state.activeLobbyId}/hosted-agents/${encodeURIComponent(btn.dataset.stopAgent)}`);
    renderHostedAgents();
  }));
}

// ── Wallet Helpers ──

/**
 * Coerce the many shapes Concordium APIs use for an amount into microCCD (BigInt), or null.
 * Covers: BigInt (gRPC v2), number/numeric string, SDK CcdAmount ({ microCcd } / { microCcdAmount }),
 * generic { value }, and wallet-proxy balance objects ({ accountAmount }).
 */
function toMicroCcd(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' || typeof value === 'string') {
    try { return BigInt(value); } catch { return null; }
  }
  if (typeof value === 'object') {
    if (value.microCcd !== undefined) return toMicroCcd(value.microCcd);
    if (value.microCcdAmount !== undefined) return toMicroCcd(value.microCcdAmount);
    if (value.accountAmount !== undefined) return toMicroCcd(value.accountAmount);
    if (value.value !== undefined) return toMicroCcd(value.value);
  }
  return null;
}

/**
 * Resolve the CCD balance for an account, trying the wallet's own RPC client first, then the
 * Concordium wallet-proxy REST API, then the CCDScan GraphQL API. Returns a number (CCD) or
 * null when no source could resolve it — never NaN.
 */
// Balance is polled on a timer, so a failing strategy must not spam the console every tick.
// Per-strategy failures are debug-level; a single warning per address is emitted only when
// ALL strategies fail (and not repeated for that address until it next succeeds).
const _balanceWarned = new Set();

async function fetchWalletBalance(provider, addrStr) {
  // Strategy 1: wallet extension's built-in RPC client (gRPC or legacy JSON-RPC).
  // Only attempt when the provider actually exposes a client — most browser wallets don't,
  // and calling a missing method (or one that throws every tick) is pure console noise.
  try {
    let accountInfo = null;
    if (typeof provider?.getGrpcClient === 'function') {
      accountInfo = await (await provider.getGrpcClient()).getAccountInfo(addrStr);
    } else if (typeof provider?.getJsonRpcClient === 'function') {
      accountInfo = await (await provider.getJsonRpcClient()).getAccountInfo(addrStr);
    }
    const micro = toMicroCcd(accountInfo?.accountAmount);
    if (micro !== null) { _balanceWarned.delete(addrStr); return Number(micro) / 1_000_000; }
  } catch (rpcErr) {
    console.debug('[Wallet] RPC balance strategy unavailable:', rpcErr?.message || rpcErr);
  }

  // Strategy 2: Concordium public wallet-proxy REST API.
  // NOTE: finalizedBalance/currentBalance are OBJECTS whose accountAmount holds microCCD.
  try {
    const proxyRes = await fetch(`${CCD_WALLET_PROXY_BASE}/v0/accBalance/${addrStr}`);
    if (proxyRes.ok) {
      const balInfo = await proxyRes.json();
      const micro = toMicroCcd(balInfo?.finalizedBalance ?? balInfo?.currentBalance);
      if (micro !== null) { _balanceWarned.delete(addrStr); return Number(micro) / 1_000_000; }
    } else {
      console.debug('[Wallet] wallet-proxy returned:', proxyRes.status);
    }
  } catch (proxyErr) {
    console.debug('[Wallet] wallet-proxy request failed:', proxyErr?.message || proxyErr);
  }

  // Strategy 3: CCDScan public GraphQL API
  try {
    const scanRes = await fetch(`${CCD_SCAN_API_BASE}/graphql/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `{ accountByAddress(accountAddress: "${addrStr}") { amount } }`
      })
    });
    if (scanRes.ok) {
      const scanData = await scanRes.json();
      const micro = toMicroCcd(scanData?.data?.accountByAddress?.amount);
      if (micro !== null) { _balanceWarned.delete(addrStr); return Number(micro) / 1_000_000; }
    }
  } catch (scanErr) {
    console.debug('[Wallet] CCDScan query failed:', scanErr?.message || scanErr);
  }

  // All strategies failed — warn once per address, not on every poll tick.
  if (!_balanceWarned.has(addrStr)) {
    _balanceWarned.add(addrStr);
    console.warn('[Wallet] Could not fetch balance from any source for', addrStr, '(will retry silently).');
  }
  return null;
}

// ── Concordium Agent Registry (on-chain anchoring) ──

/**
 * Map our card fields onto a builder tool's advertised input schema by property name, so the
 * dashboard adapts to the MCP service's exact parameter names instead of hardcoding them.
 * Precedence matters: the agent's own identifier (did / external reference / token / agent key)
 * must be distinguished from the OWNER's account, or a param like `agent_address` would wrongly
 * receive the owner's account and the contract would reject the malformed parameter. Throws with
 * the schema attached when a required property cannot be mapped — surfacing the mismatch beats
 * submitting a payload the registry will reject.
 */
function mapBuilderArgs(inputSchema, fields) {
  const props = inputSchema?.properties || {};
  const required = Array.isArray(inputSchema?.required) ? inputSchema.required : [];
  const args = {};
  for (const key of Object.keys(props)) {
    // Order is deliberate — most specific first.
    if (/hash/i.test(key)) args[key] = fields.cardHash;
    else if (/uri|url|metadata/i.test(key)) args[key] = fields.metadataUrl;
    // The agent's identity: DID, external reference, token id, or the agent's own key/address.
    else if (/agent.*(id|key|ref|reference|token|address|did)|external.*ref|^reference$|^token(_?id)?$|^did$/i.test(key)) args[key] = fields.agentDid;
    else if (/network/i.test(key)) args[key] = fields.network;
    // The minting account — "sender" is what the live service calls it; plain owner/account too.
    else if (/sender|owner|account/i.test(key) || /^address$/i.test(key)) args[key] = fields.owner;
    else if (/name$/i.test(key)) args[key] = fields.agentName;
  }
  const unmapped = required.filter((k) => args[k] === undefined);
  if (unmapped.length > 0) {
    throw new Error(`the registry builder requires parameters this dashboard cannot map yet: ${unmapped.join(', ')} — schema: ${JSON.stringify(props)}`);
  }
  return args;
}

// Concordium web-sdk, loaded on demand from a CDN as an ES module (the dashboard is a
// no-bundler static app). The wallet's sendTransaction expects the payload fields to be real
// SDK instances — CcdAmount / ContractAddress / Energy / ReceiveName — because it calls methods
// like `.mod()` on them during serialization. Primitives (BigInt/string/number) have no such
// methods, which is the "A.mod is not a function" failure. Pinned to the major version whose API
// (CcdAmount.fromMicroCcd / ContractAddress.create / Energy.create) this code targets.
const CCD_SDK_URL = 'https://esm.sh/@concordium/web-sdk@12';
let _ccdSdkPromise = null;
function loadConcordiumSdk() {
  if (!_ccdSdkPromise) {
    _ccdSdkPromise = import(/* @vite-ignore */ CCD_SDK_URL).catch((err) => {
      _ccdSdkPromise = null; // allow a retry on the next attempt
      throw new Error(`could not load the Concordium SDK from ${CCD_SDK_URL}: ${err.message || err}`);
    });
  }
  return _ccdSdkPromise;
}

/**
 * Decide which registry builder to use, guided by whether this agent DID is already registered
 * on-chain and whether the service offers a sponsored (gasless) builder:
 *  - already registered  → `build_set_agent_uri` (the `setAgentURI` entrypoint every successful
 *    on-chain event uses to (re)point metadata) instead of `build_register`, which rejects when
 *    its create-preconditions aren't met.
 *  - a sponsored/permit builder is exposed → prefer it so Concordium pays the energy, not the owner.
 * Falls back to `build_register` for a genuinely new mint. Any lookup failure defaults to register.
 */
async function chooseRegistryBuilder(tools, fields) {
  const names = new Set((tools || []).map((t) => t.name));
  // Sponsored path takes precedence when the service advertises one (none in the current
  // allowlist, but this wires it automatically the moment the registry MCP exposes it).
  const sponsored = (tools || []).find((t) => /sponsor|permit|gasless/i.test(t.name) && /register|set.*uri|metadata/i.test(t.name));
  if (sponsored) return { tool: sponsored, sponsored: true, mode: 'sponsored' };

  // Is this agent DID already on-chain? If so, update its URI rather than re-registering.
  let exists = false;
  try {
    const lookup = await postJson('/api/v1/agent-lobby/registry/call', {
      tool: 'agent_by_external_reference',
      arguments: { network: fields.network, external_reference: fields.agentDid, reference: fields.agentDid },
    });
    const r = lookup?.result;
    exists = !!(lookup?.ok && r && (r.token_id || r.agent || r.owner || r.exists === true));
  } catch { /* lookup unsupported/unreachable — treat as new */ }

  if (exists && names.has('build_set_agent_uri')) {
    return { tool: (tools || []).find((t) => t.name === 'build_set_agent_uri'), sponsored: false, mode: 'update' };
  }
  const register = (tools || []).find((t) => t.name === 'build_register');
  if (!register) throw new Error('the registry MCP service does not expose build_register');
  return { tool: register, sponsored: false, mode: 'register' };
}

/**
 * Anchor a freshly issued Agent Card on-chain through the Concordium Agent Registry:
 * the lobby relays a builder tool (sign-ready payload — the service holds no keys), and the
 * owner's wallet signs and submits the update. Returns { txHash, contract, receiveName, mode,
 * sponsored }, or null when no registry MCP service is configured.
 */
async function anchorAgentOnChain(provider, fields) {
  const status = await fetchJson(`/api/v1/agent-lobby/registry/status?network=${CCD_NETWORK}`);
  if (!status || !status.configured) return null; // off-chain mode — card stays lobby-hosted
  if (status.error) throw new Error(`registry MCP service unreachable: ${status.error}`);

  const toolsRes = await fetchJson('/api/v1/agent-lobby/registry/tools');
  const tools = toolsRes?.tools || [];
  const { tool: builder, sponsored, mode } = await chooseRegistryBuilder(tools, fields);
  console.log(`[Registry] using builder "${builder.name}" (mode: ${mode}, sponsored: ${sponsored})`);

  const args = mapBuilderArgs(builder.inputSchema, fields);
  const call = await postJson('/api/v1/agent-lobby/registry/call', { tool: builder.name, arguments: args });
  if (!call || !call.ok) throw new Error(call?.error || `${builder.name} call failed`);
  const payload = call.result || {};
  console.log(`[Registry] ${builder.name} payload:`, payload);

  // The docs describe { hex, schema_json }; the live service returns
  // { network, contract_address: {index, subindex}, receive_name, parameter_json, ... }.
  // Accept both shapes.
  const hex = [payload.hex, payload.parameter_hex, payload.payload_hex, payload.message_hex]
    .find((v) => typeof v === 'string' && v.length > 0) || null;
  const parameterJson = payload.parameter_json ?? payload.parameters_json ?? null;
  const schema = [payload.schema_b64, payload.schema_base64, payload.schema, payload.schema_json]
    .find((v) => typeof v === 'string' && v.length > 0) || null;

  // Resolve the target contract + entrypoint from the payload metadata, else contract_info.
  let index = payload.contract_index ?? payload.contract?.index ?? payload.contract_address?.index;
  let subindex = payload.contract_subindex ?? payload.contract?.subindex ?? payload.contract_address?.subindex;
  let receiveName = payload.receive_name ?? payload.receiveName;
  if (index === undefined || !receiveName) {
    const infoCall = await postJson('/api/v1/agent-lobby/registry/call', { tool: 'contract_info', arguments: { network: CCD_NETWORK } });
    const info = infoCall?.result || {};
    const cis = info.cis8004 || info['cis-8004'] || info;
    index = index ?? cis.index ?? cis.contract_index ?? cis.contract_address?.index;
    subindex = subindex ?? cis.subindex ?? cis.contract_subindex ?? cis.contract_address?.subindex;
    // Derive the entrypoint from the chosen builder (register → register, set-agent-uri →
    // setAgentURI) rather than hardcoding `.register` — the old fallback forced every mint down
    // the register entrypoint even for updates, which is exactly what the contract rejected.
    const entrypoint = builder.name === 'build_set_agent_uri' ? 'setAgentURI' : 'register';
    receiveName = receiveName || cis.receive_name || (cis.contract_name ? `${cis.contract_name}.${entrypoint}` : undefined);
  }
  if (index === undefined || !receiveName) {
    throw new Error('could not resolve the registry contract address/entrypoint from the builder payload or contract_info');
  }

  // Build the Update payload from REAL Concordium SDK instances. The wallet serializes the
  // payload by calling methods (e.g. `.mod()` for byte encoding) directly on each field, so
  // primitives fail with "A.mod is not a function" — confirmed from the live wallet stack. Only
  // CcdAmount / ContractAddress / Energy / ReceiveName / Parameter instances work.
  const sdk = await loadConcordiumSdk();
  const { CcdAmount, ContractAddress, Energy, ReceiveName, Parameter, AccountTransactionType } = sdk;
  const energyVal = Number(payload.max_energy ?? payload.energy ?? 30000);
  const amount = CcdAmount.fromMicroCcd(0); // registration is a 0-CCD contract update
  const address = ContractAddress.create(Number(index), Number(subindex ?? 0));
  const receiveNameObj = ReceiveName.fromString(receiveName);
  const energyObj = Energy.create(energyVal);
  console.log('[Registry] submitting Update tx:', { index, subindex, receiveName, energy: energyVal, hasHex: !!hex, hasSchema: !!schema });

  let txHash;
  if (hex) {
    // Pre-encoded parameter bytes (parameter_hex) — pass as the update message.
    const message = Parameter.fromHexString(hex);
    txHash = await provider.sendTransaction(state.wallet.address, AccountTransactionType.Update, {
      amount, address, receiveName: receiveNameObj, message, maxContractExecutionEnergy: energyObj,
    });
  } else if (parameterJson && schema) {
    // No pre-encoded hex: hand the wallet the JSON params + base64 schema to serialize & display.
    txHash = await provider.sendTransaction(state.wallet.address, AccountTransactionType.Update, {
      amount, address, receiveName: receiveNameObj, maxContractExecutionEnergy: energyObj,
    }, parameterJson, schema);
  } else if (parameterJson) {
    throw new Error(`${builder.name} returned parameter_json but no schema to serialize it (payload keys: ${Object.keys(payload).join(', ')}) — full payload logged to the browser console`);
  } else {
    throw new Error(`${builder.name} did not return a signable payload (keys: ${Object.keys(payload).join(', ')}) — full payload logged to the browser console`);
  }
  return { txHash, contract: { index, subindex: subindex ?? 0 }, receiveName, mode, sponsored };
}

/** Extract a hex signature string from the Concordium wallet's { 0: { 0: hex } } response shape. */
function normalizeSignature(signature) {
  if (typeof signature === 'string') return signature;
  if (signature && typeof signature === 'object') {
    const firstKey = Object.keys(signature)[0];
    if (firstKey !== undefined) {
      const inner = signature[firstKey];
      if (typeof inner === 'string') return inner;
      const innerKey = inner && Object.keys(inner)[0];
      if (innerKey !== undefined) return inner[innerKey];
    }
    return JSON.stringify(signature);
  }
  return null;
}

// ── Wallet UI Sync ──

function updateWalletUI() {
  const textEl = document.getElementById('wallet-status-text');
  const btnEl = document.getElementById('btn-connect-wallet');
  const postBtnEl = document.getElementById('btn-post-task');
  
  if (!textEl || !btnEl) return;
  
  if (state.wallet.connected) {
    const shortAddr = state.wallet.address.slice(0, 6) + '...' + state.wallet.address.slice(-4);
    const balanceText = Number.isFinite(state.wallet.balance)
      ? `${state.wallet.balance.toLocaleString(undefined, { maximumFractionDigits: 6 })} CCD`
      : 'balance unavailable';
    textEl.innerHTML = `<span style="color:var(--color-green); font-weight:600;">Connected:</span> ${shortAddr} | <span style="color:var(--color-cyan); font-weight:600;">${balanceText}</span>`;
    btnEl.textContent = 'Disconnect';
    if (postBtnEl) postBtnEl.textContent = 'Post & Lock Escrow';

    // Show/hide owner identity elements
    const ownerDisconnectedView = document.getElementById('owner-disconnected-view');
    const ownerRegisterView = document.getElementById('owner-register-view');
    const ownerWalletAddressDisplay = document.getElementById('owner-wallet-address-display');
    const ownerDidInput = document.getElementById('owner-did-input');
    const ownerRegisteredSuccessView = document.getElementById('owner-registered-success-view');

    if (ownerDisconnectedView) ownerDisconnectedView.style.display = 'none';
    if (!state.identity.ownerRegistered) {
      if (ownerRegisterView) ownerRegisterView.style.display = 'flex';
      if (ownerWalletAddressDisplay) ownerWalletAddressDisplay.textContent = state.wallet.address;
      if (ownerDidInput && !ownerDidInput.value) {
        ownerDidInput.value = `did:ccd:${CCD_NETWORK}:${state.wallet.address}`;
      }
    } else {
      if (ownerRegisterView) ownerRegisterView.style.display = 'none';
      if (ownerRegisteredSuccessView) ownerRegisteredSuccessView.style.display = 'block';
    }
  } else {
    textEl.textContent = 'Disconnected';
    btnEl.textContent = 'Connect Wallet';
    if (postBtnEl) postBtnEl.textContent = 'Post Task';

    // Reset owner identity views
    const ownerDisconnectedView = document.getElementById('owner-disconnected-view');
    const ownerRegisterView = document.getElementById('owner-register-view');
    const ownerRegisteredSuccessView = document.getElementById('owner-registered-success-view');
    if (ownerDisconnectedView) ownerDisconnectedView.style.display = 'block';
    if (ownerRegisterView) ownerRegisterView.style.display = 'none';
    if (ownerRegisteredSuccessView) ownerRegisteredSuccessView.style.display = 'none';

    // Reset state values
    state.identity.ownerRegistered = false;
    state.identity.ownerName = null;
    state.identity.ownerDid = null;
    state.identity.registeredAgentDid = null;

    const agentOwnerUnregisteredView = document.getElementById('agent-owner-unregistered-view');
    const agentIssueView = document.getElementById('agent-issue-view');
    const agentIssuedSuccessView = document.getElementById('agent-issued-success-view');
    if (agentOwnerUnregisteredView) agentOwnerUnregisteredView.style.display = 'block';
    if (agentIssueView) agentIssueView.style.display = 'none';
    if (agentIssuedSuccessView) agentIssuedSuccessView.style.display = 'none';
  }
}

// ── Init ──

function init() {
  const issueAgentRole = document.getElementById('issue-agent-role');
  if (issueAgentRole) {
    issueAgentRole.innerHTML = AGENT_ROLES.map(r => `<option value="${r.value}">${r.label}</option>`).join('');
  }

  pollLobbies();
  pollStats();
  
  setInterval(pollLobbies, 5000);
  setInterval(pollStats, 2000);
  setInterval(() => {
    if (state.activeLobbyId) pollLobbyDetails();
  }, 2000);
  
  // Wire up Create Lobby form and Visibility Logic
  const visibilityEl = document.getElementById('create-lobby-visibility');
  const policyEl = document.getElementById('create-lobby-policy');
  const allowlistContainer = document.getElementById('lobby-allowlist-container');
  const allowlistInput = document.getElementById('create-lobby-allowlist');
  const btnCreateLobby = document.getElementById('btn-create-lobby');

  function checkAllowlistVisibility() {
    if (!allowlistContainer) return;
    const vis = visibilityEl?.value;
    const pol = policyEl?.value;
    if (vis === 'private' || pol === 'allowlisted') {
      allowlistContainer.style.display = 'block';
    } else {
      allowlistContainer.style.display = 'none';
    }
  }

  if (visibilityEl) visibilityEl.addEventListener('change', checkAllowlistVisibility);
  if (policyEl) policyEl.addEventListener('change', checkAllowlistVisibility);

  if (btnCreateLobby) {
    btnCreateLobby.addEventListener('click', async () => {
      const nameEl = document.getElementById('create-lobby-name');
      const name = nameEl?.value?.trim();
      if (!name) {
        alert('Please enter a lobby name.');
        return;
      }
      const visibility = visibilityEl?.value || 'public';
      const policy = policyEl?.value || 'none';
      
      // Parse allowlist safely only if visibility/policy requires it
      let allowlist = [];
      if (visibility === 'private' || policy === 'allowlisted') {
        const rawAllowlist = allowlistInput?.value || '';
        allowlist = rawAllowlist.split(',')
          .map(item => item.trim())
          .filter(item => item.length > 0);
      }

      const res = await postJson('/api/v1/agent-lobby/lobbies', {
        name,
        visibility,
        join_policy: policy,
        allowlist,
        // Bind the lobby to the connected wallet so it (and only it) can manage Hosted-Mode config.
        owner_identity_ref: state.wallet.connected && state.wallet.address ? `did:ccd:${CCD_NETWORK}:${state.wallet.address}` : undefined,
        created_by: 'web-user'
      });

      if (res && res.lobby) {
        if (nameEl) nameEl.value = '';
        if (allowlistInput) allowlistInput.value = '';
        if (allowlistContainer) allowlistContainer.style.display = 'none';
        await pollLobbies();
        selectLobby(res.lobby.lobby_id);
      } else {
        alert(`Failed to create lobby "${name}" — the lobby server did not respond. Check that it is running and reachable, then try again.`);
      }
    });
  }

  // Wire up Send Message button
  const btnSendMessage = document.getElementById('btn-send-message');
  const chatInputText = document.getElementById('chat-input-text');
  const chatUsername = document.getElementById('chat-username');

  async function handleSendMessage() {
    if (!state.activeLobbyId) {
      alert('Please select a lobby first.');
      return;
    }
    const content = chatInputText?.value?.trim();
    if (!content) return;
    const username = chatUsername?.value?.trim() || 'WebUser';

    const res = await postJson(`/api/v1/agent-lobby/lobbies/${state.activeLobbyId}/messages`, {
      from_agent_id: username,
      content,
      message_type: 'chat'
    });

    if (res && res.message) {
      if (chatInputText) chatInputText.value = '';
      pollLobbyDetails();
    }
  }

  if (btnSendMessage) {
    btnSendMessage.addEventListener('click', handleSendMessage);
  }
  if (chatInputText) {
    chatInputText.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        handleSendMessage();
      }
    });
  }

  // ── Onboarding & Setup Identity Actions ──
  const btnOnboardConnectWallet = document.getElementById('btn-onboard-connect-wallet');
  if (btnOnboardConnectWallet) {
    btnOnboardConnectWallet.addEventListener('click', () => {
      const btnConnectWallet = document.getElementById('btn-connect-wallet');
      if (btnConnectWallet) btnConnectWallet.click();
    });
  }

  const btnRegisterOwnerAction = document.getElementById('btn-register-owner-action');
  if (btnRegisterOwnerAction) {
    btnRegisterOwnerAction.addEventListener('click', async () => {
      if (!state.wallet.connected) {
        alert("Please connect your Concordium Wallet first.");
        return;
      }
      const ownerNameEl = document.getElementById('owner-name-input');
      const ownerDidEl = document.getElementById('owner-did-input');
      const name = ownerNameEl?.value?.trim();
      if (!name) {
        alert("Please enter an owner name.");
        return;
      }
      const did = ownerDidEl?.value?.trim() || `did:ccd:${CCD_NETWORK}:${state.wallet.address}`;

      const provider = window.concordium;
      if (!provider) {
        alert("Concordium Browser Wallet extension not found. Please install it and reconnect.");
        return;
      }

      btnRegisterOwnerAction.disabled = true;
      btnRegisterOwnerAction.textContent = "Signing in Wallet...";

      try {
        const message = `Register Owner ID in Agent OS Swarm Lobby: ${name} (${did})`;
        const signature = normalizeSignature(await provider.signMessage(state.wallet.address, message));
        console.log('[Owner Register] Wallet signature:', signature?.slice(0, 40) + '...');

        btnRegisterOwnerAction.textContent = "Registering Owner ID...";

        // Register as a credential issuer on the lobby server (also records the lobby event)
        const res = await postJson('/api/v1/agent-lobby/issuers', {
          issuer_did: did,
          identity_ref: `did:ccd:${CCD_NETWORK}:${state.wallet.address}`,
          signature,
          owner_name: name,
          lobby_id: state.activeLobbyId
        });
        if (!res || !res.record) {
          throw new Error('The lobby server rejected the issuer registration.');
        }

        state.identity.ownerRegistered = true;
        state.identity.ownerName = name;
        state.identity.ownerDid = did;

        // Sync UI
        const ownerRegisterView = document.getElementById('owner-register-view');
        const ownerRegisteredSuccessView = document.getElementById('owner-registered-success-view');
        const successOwnerName = document.getElementById('success-owner-name');
        const successOwnerDid = document.getElementById('success-owner-did');

        if (ownerRegisterView) ownerRegisterView.style.display = 'none';
        if (ownerRegisteredSuccessView) ownerRegisteredSuccessView.style.display = 'block';
        if (successOwnerName) successOwnerName.textContent = name;
        if (successOwnerDid) {
          successOwnerDid.innerHTML = `<span style="color:var(--color-cyan);">${escapeHtml(did)}</span><br><span style="font-size:9px; color:var(--color-green); font-weight:600;">✓ Cryptographically verified via wallet signature.</span>`;
        }

        // Unlock agent issue view
        const agentOwnerUnregisteredView = document.getElementById('agent-owner-unregistered-view');
        const agentIssueView = document.getElementById('agent-issue-view');
        const issueAgentDid = document.getElementById('issue-agent-did');
        if (agentOwnerUnregisteredView) agentOwnerUnregisteredView.style.display = 'none';
        if (agentIssueView) agentIssueView.style.display = 'flex';
        if (issueAgentDid) {
          issueAgentDid.value = `did:ccd:${CCD_NETWORK}:agent-${Math.random().toString(36).substring(2, 8)}`;
        }

        pollLobbyDetails();
        alert("Owner ID registered and cryptographically verified!");
      } catch (err) {
        console.error('Owner registration failed:', err);
        alert(`Owner registration failed: ${err.message || err}`);
      } finally {
        btnRegisterOwnerAction.disabled = false;
        btnRegisterOwnerAction.textContent = "Register Owner ID";
      }
    });
  }

  // SHA-256 helper
  async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  const btnIssueAgentAction = document.getElementById('btn-issue-agent-action');
  if (btnIssueAgentAction) {
    btnIssueAgentAction.addEventListener('click', async () => {
      if (!state.identity.ownerRegistered) {
        alert("Please register your Owner ID first.");
        return;
      }
      const agentNameEl = document.getElementById('issue-agent-name');
      const agentRoleEl = document.getElementById('issue-agent-role');
      const agentDidEl = document.getElementById('issue-agent-did');
      
      const agentName = agentNameEl?.value?.trim();
      if (!agentName) {
        alert("Please enter an agent name.");
        return;
      }
      const agentRole = agentRoleEl?.value || 'coder';
      const agentDid = agentDidEl?.value?.trim() || `did:ccd:${CCD_NETWORK}:agent-${Math.random().toString(36).substring(2, 8)}`;

      btnIssueAgentAction.disabled = true;
      btnIssueAgentAction.textContent = "Preparing Agent Card...";

      // Build agent card metadata
      const card = {
        mediaType: "application/a2a-agent-card+json",
        name: agentName,
        description: `Specialized sub-agent running ${agentRole} role.`,
        did: agentDid,
        owner: state.identity.ownerDid,
        ownerAddress: state.wallet.address,
        runtime: "agent-os", // runtime-agnostic — the adapter reports the concrete runtime when the agent connects
        capabilities: [agentRole],
        ownerPolicy: "self",
        supportedProtocols: ["agent-os-lobby"],
        allowedScopes: [],
        network: CCD_NETWORK,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      // Sort keys canonically for deterministic hashing
      const sortedKeys = Object.keys(card).sort();
      const sortedCard = {};
      for (const k of sortedKeys) sortedCard[k] = card[k];

      // Sign with the connected wallet — issuing a credential requires a real signature
      const provider = window.concordium;
      if (!provider) {
        alert("Concordium Browser Wallet extension not found. Please install it and reconnect.");
        btnIssueAgentAction.disabled = false;
        btnIssueAgentAction.textContent = "Issue Agent ID";
        return;
      }

      let signatureHex = null;
      try {
        btnIssueAgentAction.textContent = "Sign in Wallet...";
        // Sign over the STABLE identity fields, not the metadata hash: the on-chain hash must
        // cover the final hosted card (which includes this signature), so it can't be known at
        // signing time. The signature attests to who/what; the on-chain hash attests to the bytes.
        const signPayload = `Agent OS Agent Card\nDID: ${agentDid}\nName: ${agentName}\nRole: ${agentRole}\nOwner: ${state.identity.ownerDid}`;
        signatureHex = normalizeSignature(await provider.signMessage(state.wallet.address, signPayload));
        console.log('[Agent Issue] Wallet signature:', signatureHex?.slice(0, 40) + '...');
      } catch (err) {
        console.error('[Agent Issue] Wallet signing failed:', err);
        alert(`Agent signing failed: ${err.message || err}`);
        btnIssueAgentAction.disabled = false;
        btnIssueAgentAction.textContent = "Issue Agent ID";
        return;
      }

      btnIssueAgentAction.textContent = "Publishing Agent Card...";

      // Add signature to card metadata
      sortedCard.signature = signatureHex;
      sortedCard.signedBy = state.wallet.address;

      // Hash the EXACT bytes we host (signature included), so the metadata hash anchored on-chain
      // matches what a resolver recomputes from the hosted card. The lobby server serves the stored
      // card via compact JSON.stringify preserving this key order, so these are the served bytes.
      // (Previously the hash was taken BEFORE the signature was added, then the signed card was
      // hosted — a permanent mismatch that reads as a tampered card.)
      const cardHash = await sha256(JSON.stringify(sortedCard));

      // Post the metadata to the Lobby server for hosting (also records the lobby event)
      const registerRes = await postJson('/api/v1/agent-lobby/agent-cards', {
        did: agentDid,
        card: sortedCard,
        lobby_id: state.activeLobbyId
      });

      const metadataUrl = registerRes?.url || `${window.location.origin}/agent-cards/${encodeURIComponent(agentDid)}`;
      const metadataStored = !!registerRes?.ok;

      // On-chain anchoring through the Concordium Agent Registry (when the lobby has a
      // registry MCP endpoint configured; otherwise the card stays wallet-signed + hosted).
      let anchor = null;
      let anchorError = null;
      try {
        btnIssueAgentAction.textContent = "Anchoring On-Chain...";
        anchor = await anchorAgentOnChain(provider, {
          metadataUrl,
          cardHash,
          owner: state.wallet.address,
          network: CCD_NETWORK,
          agentName,
          agentDid
        });
      } catch (err) {
        console.error('[Agent Issue] On-chain anchoring failed:', err);
        anchorError = err.message || String(err);
      }

      // Update state
      state.identity.registeredAgentDid = agentDid;

      // Build explorer link to owner's account (where their agent tokens are visible)
      const explorerUrl = getExplorerLink(agentDid) || `${CCD_EXPLORER_BASE}/account/${encodeURIComponent(state.wallet.address)}`;

      // Sync UI
      const agentIssueView = document.getElementById('agent-issue-view');
      const agentIssuedSuccessView = document.getElementById('agent-issued-success-view');
      const successAgentName = document.getElementById('success-agent-name');
      const successAgentDid = document.getElementById('success-agent-did');

      if (agentIssueView) agentIssueView.style.display = 'none';
      if (agentIssuedSuccessView) agentIssuedSuccessView.style.display = 'block';
      if (successAgentName) successAgentName.textContent = agentName;
      if (successAgentDid) {
        const storedBadge = metadataStored
          ? `<span style="color:var(--color-green);">✓ Hosted</span>`
          : `<span style="color:var(--color-yellow);">⚠ Server unreachable — card not hosted</span>`;
        let onChainLine;
        if (anchor) {
          const verb = anchor.mode === 'update' ? 'setAgentURI submitted' : 'Mint submitted';
          const gas = anchor.sponsored
            ? ` <span style="color:var(--color-green); font-size:10px;">· sponsored (no CCD spent)</span>`
            : ` <span style="color:var(--text-muted); font-size:10px;">· energy paid by your wallet</span>`;
          onChainLine = `<span style="color:var(--color-green); font-weight:600;">✓ ${verb}</span> — Tx <a href="https://ccdexplorer.io/${CCD_NETWORK}/transaction/${escapeHtml(String(anchor.txHash))}" target="_blank" style="color:var(--color-cyan); text-decoration:underline;">${escapeHtml(String(anchor.txHash).slice(0, 16))}… ↗</a> (registry ${anchor.contract.index},${anchor.contract.subindex})${gas}`;
        } else if (anchorError) {
          onChainLine = `<span style="color:#ff5c5c;">✗ anchoring failed</span> — <span style="font-size:10px;">${escapeHtml(anchorError)}</span>`;
        } else {
          onChainLine = `<span style="color:var(--color-yellow);">not anchored</span> — no Agent Registry MCP endpoint configured on this lobby (<a href="https://docs.concordium.com/en/mainnet/technical-reference/agent-registry/index.html" target="_blank" style="color:var(--color-cyan); text-decoration:underline;">docs ↗</a>)`;
        }
        // When issued for a specific connected agent, show how to bind the DID permanently so
        // that agent reuses it on every boot (the panel passes it as the lobby join token).
        let bindNote = '';
        const boundAgent = state.identity.bindingAgentId
          ? state.agents.find(a => a.agent_id === state.identity.bindingAgentId)
          : null;
        if (boundAgent) {
          const slug = boundAgent.agent_role || 'your-agent';
          bindNote = `
            <div style="margin-top:8px; padding:8px; background:rgba(49,140,255,0.06); border-left:3px solid var(--color-blue); border-radius:4px;">
              <strong style="color:var(--color-blue);">Bind to ${escapeHtml(boundAgent.display_name || 'this agent')}:</strong>
              add this line to <code style="font-size:10px;">agent-os/sub-agents/agents/${escapeHtml(slug)}.md</code> and reboot the agent —
              it will then present this DID as its lobby identity on every connect:<br>
              <code style="display:block; margin-top:4px; font-size:11px; color:var(--color-green); word-break:break-all;">Identity: ${escapeHtml(agentDid)}</code>
            </div>`;
        }
        successAgentDid.innerHTML = `
          <div style="text-align:left; font-size:12px; line-height:1.8;">
            <strong>DID:</strong> <span style="color:var(--color-cyan);">${escapeHtml(agentDid)}</span><br>
            <strong>Metadata:</strong> <a href="${escapeHtml(metadataUrl)}" target="_blank" style="color:var(--color-cyan); text-decoration:underline;">${escapeHtml(metadataUrl)}</a> ${storedBadge}<br>
            <strong>On-Chain:</strong> ${onChainLine}<br>
            <strong>Owner Account:</strong> <a href="${escapeHtml(explorerUrl)}" target="_blank" style="color:var(--color-cyan); text-decoration:underline;">View on CCDexplorer ↗</a><br>
            <strong>Card Hash:</strong> <span style="font-size:9px; color:var(--text-muted);">${cardHash}</span><br>
            <strong>Signature:</strong> <span style="font-size:9px; color:var(--text-muted);">${signatureHex?.slice(0, 32)}...</span><br>
            <strong>Status:</strong> <span style="color:var(--color-green); font-weight:600;">✓ Wallet-signed</span>${anchor ? ' · on-chain mint submitted' : ' · card hosted off-chain by this lobby'}
          </div>${bindNote}`;
        state.identity.bindingAgentId = null;
      }

      // The roster shows genuinely connected agents (registered over the lobby WS protocol);
      // an issued credential appears there once the agent connects and presents its DID.
      pollLobbyDetails();

      btnIssueAgentAction.disabled = false;
      btnIssueAgentAction.textContent = "Issue Agent ID";

      if (anchor) {
        alert(`Agent DID issued, signed, and mint submitted on-chain!\nDID: ${agentDid}\nTransaction: ${anchor.txHash}\nMetadata: ${metadataUrl}`);
      } else if (anchorError) {
        alert(`Agent DID issued and signed, but on-chain anchoring failed: ${anchorError}\nThe card remains hosted by this lobby at ${metadataUrl}.`);
      } else {
        alert(`Agent DID issued & cryptographically signed!\nDID: ${agentDid}\nMetadata: ${metadataUrl}\nNote: the card is hosted by this lobby and is not yet anchored on-chain — configure AGENT_OS_AGENT_REGISTRY_MCP_URL on the lobby server to enable Concordium Agent Registry minting.`);
      }
    });
  }

  // Concordium Wallet Connection click handler
  const btnConnectWallet = document.getElementById('btn-connect-wallet');
  if (btnConnectWallet) {
    btnConnectWallet.addEventListener('click', async () => {
      if (state.wallet.connected) {
        state.wallet.connected = false;
        state.wallet.address = null;
        state.wallet.balance = null;
        updateWalletUI();
        return;
      }

      const textEl = document.getElementById('wallet-status-text');
      const provider = window.concordium;

      if (!provider) {
        if (textEl) textEl.textContent = 'Disconnected — wallet extension not found';
        alert('Concordium Browser Wallet extension not found.\nPlease install it from https://www.concordium.com/wallet and reload this page.');
        return;
      }

      if (textEl) textEl.textContent = 'Connecting to Concordium Wallet extension...';
      try {
        const accountAddress = await provider.connect();
        if (!accountAddress) {
          throw new Error('Connection rejected by user.');
        }

        // Normalize address to a plain string (some wallet versions return an object)
        const addrStr = (typeof accountAddress === 'string')
          ? accountAddress
          : (accountAddress?.address || accountAddress?.toString?.() || String(accountAddress));

        console.log('[Wallet] Connected address:', addrStr, '| Raw type:', typeof accountAddress);

        const balanceCcd = await fetchWalletBalance(provider, addrStr);

        state.wallet.connected = true;
        state.wallet.address = addrStr;
        state.wallet.balance = balanceCcd;
        updateWalletUI();
        alert(`Connected successfully to Concordium Wallet!\nAddress: ${addrStr}`);
      } catch (err) {
        console.error('Concordium Wallet connection failed:', err);
        alert(`Concordium Wallet Connection Failed: ${err.message || err}`);
        if (textEl) textEl.textContent = 'Disconnected';
      }
    });
  }

  // Wire up Post Task button
  const btnPostTask = document.getElementById('btn-post-task');
  if (btnPostTask) {
    btnPostTask.addEventListener('click', async () => {
      if (!state.wallet.connected) {
        if (btnConnectWallet) btnConnectWallet.click();
        return;
      }
      if (!state.activeLobbyId) {
        alert('Please select a lobby first.');
        return;
      }
      const titleEl = document.getElementById('market-task-title');
      const budgetEl = document.getElementById('market-task-budget');
      const descEl = document.getElementById('market-task-desc');
      const title = titleEl?.value?.trim();
      const budget = parseFloat(budgetEl?.value);
      const description = descEl?.value?.trim();
      if (!title || isNaN(budget) || budget <= 0 || !description) {
        alert('Please enter title, budget ($CCD), and description.');
        return;
      }

      if (Number.isFinite(state.wallet.balance) && budget > state.wallet.balance) {
        alert(`Insufficient funds! Your wallet balance is ${state.wallet.balance.toLocaleString()} CCD, but the task requires ${budget} CCD.`);
        return;
      }

      const provider = window.concordium;
      if (!provider) {
        alert('Concordium Browser Wallet extension not found. Please install it and reconnect.');
        return;
      }

      btnPostTask.disabled = true;
      btnPostTask.textContent = 'Sign in Wallet...';

      try {
        // Wallet-signed escrow authorization. On-chain escrow settlement arrives with the
        // escrow contract increment; until then the signed authorization is the accountable record.
        const escrowPayload = `Agent OS Task Escrow Authorization\nLobby: ${state.activeLobbyId}\nTask: ${title}\nBudget: ${budget} CCD\nSigned: ${new Date().toISOString()}`;
        const escrowSignature = normalizeSignature(await provider.signMessage(state.wallet.address, escrowPayload));

        btnPostTask.textContent = 'Posting Task...';
        const res = await postJson(`/api/v1/agent-lobby/lobbies/${state.activeLobbyId}/tasks`, {
          title,
          description,
          proposed_budget_ccd: budget,
          posted_by_identity_ref: state.identity.ownerDid || `did:ccd:${CCD_NETWORK}:${state.wallet.address}`,
          escrow_signature: escrowSignature
        });

        if (res && res.task) {
          if (titleEl) titleEl.value = '';
          if (budgetEl) budgetEl.value = '';
          if (descEl) descEl.value = '';
          pollLobbyDetails();
          alert(`Success! Task posted with a wallet-signed escrow authorization for ${budget} CCD.`);
        } else {
          alert('Failed to post task.');
        }
      } catch (err) {
        console.error('Escrow signing failed:', err);
        alert(`Escrow signing failed: ${err.message || err}`);
      } finally {
        btnPostTask.disabled = false;
        btnPostTask.textContent = 'Post & Lock Escrow';
      }
    });
  }

  // ── Hosted Mode wiring ──
  document.getElementById('btn-hosted-signin')?.addEventListener('click', signInToLobby);
  document.getElementById('btn-hosted-add-key')?.addEventListener('click', async () => {
    const provider = document.getElementById('hosted-key-provider')?.value;
    const keyEl = document.getElementById('hosted-key-value');
    const agentEl = document.getElementById('hosted-key-agent');
    const apiKey = keyEl?.value?.trim();
    if (!apiKey) { alert('Enter an API key.'); return; }
    const res = await authRequest('POST', `/api/v1/agent-lobby/lobbies/${state.activeLobbyId}/provider-keys`, {
      provider, api_key: apiKey, agent_ref: agentEl?.value?.trim() || undefined,
    });
    if (res.ok) { if (keyEl) keyEl.value = ''; if (agentEl) agentEl.value = ''; renderHostedKeys(); }
    else alert('Failed to save key: ' + (res.data?.error || res.status));
  });
  document.getElementById('btn-hosted-launch')?.addEventListener('click', async () => {
    const name = document.getElementById('hosted-agent-name')?.value?.trim();
    if (!name) { alert('Enter an agent name.'); return; }
    const res = await authRequest('POST', `/api/v1/agent-lobby/lobbies/${state.activeLobbyId}/hosted-agents`, {
      name,
      agent_role: document.getElementById('hosted-agent-role')?.value?.trim() || undefined,
      provider: document.getElementById('hosted-agent-provider')?.value,
    });
    if (res.ok) { document.getElementById('hosted-agent-name').value = ''; renderHostedAgents(); }
    else alert('Failed to launch agent: ' + (res.data?.error || res.status));
  });

  // ── Manage view wiring ──
  const btnManageInvite = document.getElementById('btn-manage-invite');
  if (btnManageInvite) {
    btnManageInvite.addEventListener('click', async () => {
      if (!state.activeLobbyId) { alert('Select a lobby to manage first.'); return; }
      const refEl = document.getElementById('manage-invite-ref');
      const roleEl = document.getElementById('manage-invite-role');
      const identity_ref = refEl?.value?.trim();
      if (!identity_ref) { alert('Enter a DID or user ID to invite.'); return; }
      const res = await postJson(`/api/v1/agent-lobby/lobbies/${state.activeLobbyId}/members`, {
        identity_ref, role: roleEl?.value || 'contributor', invited_by_identity_ref: state.identity.ownerDid || 'web-user'
      });
      if (res && res.member) { if (refEl) refEl.value = ''; renderManageView(); }
      else alert('Failed to invite member: ' + (res?.error || 'unknown error'));
    });
  }

  const btnManageSave = document.getElementById('btn-manage-save-settings');
  if (btnManageSave) {
    btnManageSave.addEventListener('click', async () => {
      if (!state.activeLobbyId) return;
      const visibility = document.getElementById('manage-visibility')?.value;
      const join_policy = document.getElementById('manage-policy')?.value;
      const res = await fetch(`/api/v1/agent-lobby/lobbies/${state.activeLobbyId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility, join_policy, actor: 'web-user' })
      }).then(r => r.ok ? r.json() : null).catch(() => null);
      if (res && res.lobby) {
        // Reflect the change locally so the manage header + lobby list update immediately.
        const idx = state.lobbies.findIndex(l => l.lobby_id === state.activeLobbyId);
        if (idx >= 0) state.lobbies[idx] = res.lobby;
        const saved = document.getElementById('manage-settings-saved');
        if (saved) { saved.style.display = 'block'; setTimeout(() => { saved.style.display = 'none'; }, 2000); }
        renderLobbies();
        renderManageView();
      } else {
        alert('Failed to save settings.');
      }
    });
  }

}

// ── Task Marketplace Callbacks ──

async function renderTasks() {
  const container = document.getElementById('market-tasks-list');
  if (!container) return;

  if (state.tasks.length === 0) {
    container.innerHTML = '<div class="empty-state">No tasks posted in this lobby.</div>';
    return;
  }

  let html = '';
  for (const task of state.tasks) {
    const bidsData = await fetchJson(`/api/v1/agent-lobby/lobbies/${task.lobby_id}/tasks/${task.id}/bids`);
    const bidsCount = bidsData && bidsData.bids ? bidsData.bids.length : 0;
    
    let actionButtons = '';
    if (task.status === 'posted' || task.status === 'bidded') {
      actionButtons += `<button class="btn btn-primary btn-sm" onclick="bidOnTask('${task.id}')" style="margin-right: 4px;">Bid</button>`;
      actionButtons += `<button class="btn btn-secondary btn-sm" onclick="assignTask('${task.id}')">Assign</button>`;
    } else if (task.status === 'assigned') {
      actionButtons += `<button class="btn btn-primary btn-sm" onclick="completeTask('${task.id}')">Release Escrow & Pay</button>`;
    }

    const assignedText = task.assigned_agent_id ? `<div style="font-size:11px; color:var(--color-text-muted); margin-top:4px;">Assigned: <code>${escapeHtml(task.assigned_agent_id)}</code></div>` : '';
    let paymentText = '';
    if (task.status === 'completed') {
      if (task.tx_hash) {
        paymentText = `<div style="font-size:11px; color:var(--color-green); margin-top:4px;">✓ Escrow Settled Tx: <code>${escapeHtml(task.tx_hash)}</code></div>`;
      } else if (task.release_signature) {
        paymentText = `<div style="font-size:11px; color:var(--color-green); margin-top:4px;">✓ Release authorized — wallet signature <code>${escapeHtml(String(task.release_signature).slice(0, 24))}…</code></div>`;
      } else {
        paymentText = `<div style="font-size:11px; color:var(--color-green); margin-top:4px;">✓ Completed</div>`;
      }
    }
    const escrowText = task.status !== 'completed'
      ? `<div style="font-size:11px; color:var(--color-yellow); margin-top:4px;">🔒 Escrow authorization: ${task.proposed_budget_ccd} CCD${task.escrow_signature ? ' (wallet-signed)' : ''}</div>`
      : '';

    html += `
      <div style="padding: 10px; border-bottom: 1px solid var(--color-border); text-align: left;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <strong style="font-size:13px; color:var(--color-text);">${escapeHtml(task.title)}</strong>
          <span style="font-size: 10px; padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.05); color: var(--color-text-soft); border: 1px solid var(--color-border);">${escapeHtml(task.status)}</span>
        </div>
        <p style="font-size:12px; color:var(--color-text-muted); margin:0 0 6px 0;">${escapeHtml(task.description)}</p>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size:11px; color:var(--color-cyan); font-weight: 500;">Budget: ${task.proposed_budget_ccd} $CCD (${bidsCount} bids)</span>
          <div>${actionButtons}</div>
        </div>
        ${assignedText}
        ${escrowText}
        ${paymentText}
      </div>
    `;
  }
  container.innerHTML = html;
}

window.bidOnTask = async function(taskId) {
  if (!state.activeLobbyId) return;
  const agentDid = prompt("Enter your verified Agent DID (e.g., did:ccd:12345):");
  if (!agentDid) return;
  
  const res = await postJson(`/api/v1/agent-lobby/lobbies/${state.activeLobbyId}/tasks/${taskId}/bid`, {
    agent_did: agentDid,
    bidder_identity_ref: 'agent-owner'
  });
  
  if (res && res.bid) {
    alert("Bid submitted successfully!");
    pollLobbyDetails();
  } else {
    alert("Verification failed: agent DID must be verified, and the human issuer must be registered and active on Concordium.");
  }
};

window.assignTask = async function(taskId) {
  if (!state.activeLobbyId) return;
  const agentDid = prompt("Assign to Agent DID:");
  if (!agentDid) return;

  const res = await postJson(`/api/v1/agent-lobby/lobbies/${state.activeLobbyId}/tasks/${taskId}/assign`, {
    assigned_agent_id: agentDid,
    assigned_agent_ref: 'human-owner'
  });

  if (res && res.task) {
    alert("Task assigned!");
    pollLobbyDetails();
  } else {
    alert("Failed to assign task.");
  }
};

window.completeTask = async function(taskId) {
  if (!state.activeLobbyId) return;
  if (!state.wallet.connected) {
    alert("Please connect your Concordium Wallet to release escrow payments.");
    return;
  }

  showStyledConfirm(
    "Release Escrow Payment",
    "Are you sure you want to release the escrowed CCD to the agent?",
    async () => {
      const btnEl = document.querySelector(`button[onclick="completeTask('${taskId}')"]`);
      if (btnEl) {
        btnEl.disabled = true;
        btnEl.textContent = "Signing Release...";
      }

      const provider = window.concordium;
      if (!provider) {
        alert("Concordium Browser Wallet extension not found. Please install it and reconnect.");
        if (btnEl) {
          btnEl.disabled = false;
          btnEl.textContent = "Release Escrow & Pay";
        }
        return;
      }

      try {
        if (btnEl) btnEl.textContent = "Approve in Wallet...";

        // Wallet-signed release authorization. On-chain settlement arrives with the escrow
        // contract increment; until then the signed authorization is the accountable record.
        const releasePayload = `Agent OS Escrow Release Authorization\nLobby: ${state.activeLobbyId}\nTask: ${taskId}\nSigned: ${new Date().toISOString()}`;
        const releaseSignature = normalizeSignature(await provider.signMessage(state.wallet.address, releasePayload));

        if (btnEl) btnEl.textContent = "Releasing Escrow...";
        const res = await postJson(`/api/v1/agent-lobby/lobbies/${state.activeLobbyId}/tasks/${taskId}/complete`, {
          release_signature: releaseSignature
        });

        if (res && res.task) {
          alert(`Escrow release authorization signed and recorded!\nSignature: ${releaseSignature?.slice(0, 32)}...`);
          pollLobbyDetails();
        } else {
          alert("Failed to record completion on the server.");
        }
      } catch (err) {
        console.error('Release signing failed:', err);
        alert(`Release failed: ${err.message || err}`);
      } finally {
        if (btnEl) {
          btnEl.disabled = false;
          btnEl.textContent = "Release Escrow & Pay";
        }
      }
    }
  );
};

window.switchOnboardTab = function(tabName) {
  const panes = ['connect', 'register', 'agent'];
  panes.forEach(p => {
    const paneEl = document.getElementById('onboard-tab-' + p);
    const btnEl = document.getElementById('onboard-tab-btn-' + p);
    if (paneEl) {
      paneEl.style.display = p === tabName ? 'block' : 'none';
    }
    if (btnEl) {
      if (p === tabName) {
        btnEl.style.color = 'var(--color-cyan)';
        btnEl.style.fontWeight = '600';
        btnEl.style.borderBottom = '2px solid var(--color-cyan)';
      } else {
        btnEl.style.color = 'var(--color-text-muted)';
        btnEl.style.fontWeight = 'normal';
        btnEl.style.borderBottom = 'none';
      }
    }
  });
};

// ── Top-nav view switcher (Lobby / Manage / Marketplace) ──
const VIEWS = ['lobby', 'manage', 'marketplace'];
window.switchView = function(view) {
  if (!VIEWS.includes(view)) return;
  VIEWS.forEach(v => {
    const el = document.getElementById('view-' + v);
    if (el) el.style.display = v === view ? '' : 'none';
  });
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  if (view === 'marketplace') pollLobbyDetails();
  if (view === 'manage') renderManageView();
};

// ── Manage view (settings + members + agents, contextual to the active lobby) ──
async function renderManageView() {
  const hint = document.getElementById('manage-no-lobby-hint');
  const settings = document.getElementById('manage-settings');
  const membersCard = document.getElementById('manage-members-card');
  const agentsCard = document.getElementById('manage-agents-card');
  const onboardingCard = document.getElementById('manage-onboarding-card');
  const nameEl = document.getElementById('manage-lobby-name');
  if (!hint) return;

  const lobby = state.lobbies.find(l => l.lobby_id === state.activeLobbyId);
  const hasLobby = !!lobby;
  if (hint) hint.style.display = hasLobby ? 'none' : 'block';
  if (settings) settings.style.display = hasLobby ? 'block' : 'none';
  if (membersCard) membersCard.style.display = hasLobby ? 'flex' : 'none';
  if (agentsCard) agentsCard.style.display = hasLobby ? 'flex' : 'none';
  // Hosted Mode: sign in, provider keys, launch server-side agents.
  renderHostedCard();
  // The Onboarding / Trust Chain setup is always available in Manage (wallet + owner + issue).
  if (onboardingCard) onboardingCard.style.display = 'flex';
  if (!hasLobby) { if (nameEl) nameEl.textContent = '—'; return; }

  if (nameEl) nameEl.textContent = lobby.name || 'Swarm Lobby';
  const visEl = document.getElementById('manage-lobby-visibility');
  if (visEl) { visEl.textContent = lobby.visibility || 'public'; visEl.className = `lobby-visibility ${lobby.visibility || 'public'}`; visEl.style.display = 'inline'; }
  const visSel = document.getElementById('manage-visibility');
  const polSel = document.getElementById('manage-policy');
  if (visSel) visSel.value = lobby.visibility || 'public';
  if (polSel) polSel.value = lobby.join_policy || 'none';

  // Agents render immediately from cached roster state; members are fetched on demand.
  renderManageAgents();
  const data = await fetchJson(`/api/v1/agent-lobby/lobbies/${state.activeLobbyId}/members`);
  renderManageMembers(data?.members || []);
}

function renderManageMembers(members) {
  const list = document.getElementById('manage-members-list');
  const count = document.getElementById('manage-member-count');
  if (!list) return;
  const active = members.filter(m => m.status !== 'revoked');
  if (count) count.textContent = String(active.length);
  if (members.length === 0) {
    list.innerHTML = '<div class="empty-state">No members invited yet. Invite by DID or user ID above.</div>';
    return;
  }
  const statusColor = { invited: 'var(--color-yellow)', active: 'var(--color-green)', revoked: 'var(--color-text-muted)' };
  list.innerHTML = members.map(m => `
    <div class="member-item" style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; border-bottom:1px solid var(--border); ${m.status === 'revoked' ? 'opacity:0.5;' : ''}">
      <div style="text-align:left; min-width:0;">
        <div style="font-family:var(--font-mono); font-size:11px; color:var(--color-text); overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(m.identity_ref)}">${escapeHtml(m.identity_ref)}</div>
        <div style="font-size:10px; color:var(--color-text-muted);">${escapeHtml(m.role)} · <span style="color:${statusColor[m.status] || 'var(--color-text-muted)'};">${escapeHtml(m.status)}</span></div>
      </div>
      ${m.status === 'revoked'
        ? `<button class="btn btn-secondary btn-sm" onclick="reinviteMember('${escapeHtml(m.identity_ref)}','${escapeHtml(m.role)}')">Re-invite</button>`
        : `<button class="btn btn-danger btn-sm" onclick="revokeMember('${m.id}')">Kick</button>`}
    </div>
  `).join('');
}

function renderManageAgents() {
  const list = document.getElementById('manage-agents-list');
  const count = document.getElementById('manage-agent-count');
  if (!list) return;
  if (count) count.textContent = String(state.agents.length);
  if (state.agents.length === 0) {
    list.innerHTML = '<div class="empty-state">No agents connected. Connect a panel/relay in Swarm Mode.</div>';
    return;
  }
  const verified = ['verified', 'registry_verified', 'human_linked', 'org_linked'];
  const bossId = activeBossId();
  // Compact fixed-width cards in a grid, each with per-agent Issue / Revoke ID actions.
  list.innerHTML = `<div class="agent-mgmt-grid">` + state.agents.map(a => {
    const isV = verified.includes(a.identity_status);
    const isBoss = a.is_boss || a.agent_id === bossId;
    const isPanel = a.agent_role === 'panel' || (a.display_name || '').toLowerCase().startsWith('panel-');
    const hasId = isV || (typeof a.identity_ref === 'string' && a.identity_ref.startsWith('did:'));
    return `
      <div class="agent-mgmt-card${isBoss ? ' is-boss' : ''}">
        <div class="amc-head">
          <span class="amc-name" title="${escapeHtml(a.agent_id)}">${escapeHtml(a.display_name || a.agent_id)}</span>
          ${isBoss ? '<span class="boss-badge">★ BOSS</span>' : ''}
        </div>
        <div class="amc-meta">${escapeHtml(a.agent_role || 'agent')} · ${escapeHtml(a.runtime || '—')}</div>
        <div class="amc-id" title="${escapeHtml(a.identity_ref || a.agent_id)}">
          ${hasId ? escapeHtml((a.identity_ref || '').slice(0, 22) + '…') : '<span style="color:var(--color-text-muted);">no Agent ID</span>'}
        </div>
        <div class="amc-foot">
          <span class="amc-status ${isV ? 'v' : ''}">${isV ? '✓ ' + escapeHtml(a.identity_status) : escapeHtml(a.identity_status || 'unverified')}</span>
          ${isPanel
            ? '<span class="amc-panel-tag" title="Panel is a UI connection, not an agent identity">panel</span>'
            : (hasId
                ? `<button class="btn btn-danger btn-sm" onclick="revokeIdForAgent('${a.agent_id}')">Revoke ID</button>`
                : `<button class="btn btn-primary btn-sm" onclick="issueIdForAgent('${a.agent_id}')">Issue ID</button>`)}
        </div>
      </div>`;
  }).join('') + `</div>`;
}

// Issue an Agent ID scoped to a specific connected agent: pre-fill the trust-chain issue form
// (now in the Manage view) with the agent's name + role, so the minted DID is bound to it.
window.issueIdForAgent = function(agentId) {
  const agent = state.agents.find(a => a.agent_id === agentId);
  if (!agent) return;
  if (!state.identity.ownerRegistered) {
    alert('Complete the Trust Chain setup first: connect your wallet and Register Owner ID (in the Onboarding & Setup panel below), then issue the agent ID.');
    switchOnboardTab('register');
    document.getElementById('onboard-tab-register')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  switchOnboardTab('agent');
  const nameEl = document.getElementById('issue-agent-name');
  const roleEl = document.getElementById('issue-agent-role');
  if (nameEl) nameEl.value = agent.display_name || '';
  if (roleEl && agent.agent_role) {
    // Select the closest matching role option if present.
    const opt = [...roleEl.options].find(o => o.value === agent.agent_role);
    if (opt) roleEl.value = agent.agent_role;
  }
  // Remember which connected agent we're binding, so the success panel can show the bind line.
  state.identity.bindingAgentId = agentId;
  document.getElementById('onboard-tab-agent')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  document.getElementById('issue-agent-name')?.focus();
};

window.revokeIdForAgent = async function(agentId) {
  const agent = state.agents.find(a => a.agent_id === agentId);
  if (!agent || !state.activeLobbyId) return;
  showStyledConfirm(
    'Revoke Agent ID',
    `Revoke the identity of "${agent.display_name || agentId}"? It will be marked unverified in this lobby. On-chain revocation (if minted) is a separate wallet-signed step.`,
    async () => {
      // Record the revocation against the lobby member (identity_ref keyed).
      if (agent.identity_ref) {
        const members = await fetchJson(`/api/v1/agent-lobby/lobbies/${state.activeLobbyId}/members`);
        const member = (members?.members || []).find(m => m.identity_ref === agent.identity_ref);
        if (member) {
          await postJson(`/api/v1/agent-lobby/lobbies/${state.activeLobbyId}/members/${member.id}/status`, { status: 'revoked', actor: 'web-user' });
        }
      }
      alert('Agent ID revoked in this lobby. To revoke on-chain, use build_revoke via your wallet.');
      renderManageView();
    }
  );
};

window.revokeMember = async function(memberId) {
  if (!state.activeLobbyId) return;
  const res = await postJson(`/api/v1/agent-lobby/lobbies/${state.activeLobbyId}/members/${memberId}/status`, { status: 'revoked', actor: 'web-user' });
  if (res && res.member) renderManageView();
  else alert('Failed to revoke member.');
};

window.reinviteMember = async function(identityRef, role) {
  if (!state.activeLobbyId) return;
  const res = await postJson(`/api/v1/agent-lobby/lobbies/${state.activeLobbyId}/members`, { identity_ref: identityRef, role });
  if (res && res.member) renderManageView();
};

document.addEventListener('DOMContentLoaded', init);
