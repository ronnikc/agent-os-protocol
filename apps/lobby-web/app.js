// Agent OS Swarm Lobby — Dashboard Controller

// ── Concordium Network Configuration ──
const CCD_NETWORK = 'mainnet'; // 'mainnet' or 'testnet'
const CCD_EXPLORER_BASE = `https://ccdexplorer.io/${CCD_NETWORK}`;
// Concordium Agent Registry contract instance <index,subindex> — used for explorer links only.
// Set this to the live registry instance for your network before relying on the links
// (see https://docs.concordium.com/en/mainnet/technical-reference/agent-registry/index.html).
// Concordium-hosted public REST/GraphQL endpoints for balance lookup (per network).
const CCD_WALLET_PROXY_BASE = {
  mainnet: 'https://wallet-proxy.mainnet.concordium.software',
  testnet: 'https://wallet-proxy.testnet.concordium.com'
}[CCD_NETWORK];
const CCD_SCAN_API_BASE = {
  mainnet: 'https://api-ccdscan.mainnet.concordium.software',
  testnet: 'https://api-ccdscan.testnet.concordium.com'
}[CCD_NETWORK];
// Genesis block hash per network — required by the sponsor service to identify the target chain.
const CCD_GENESIS_HASH = {
  mainnet: '9dd9ca4d19e9393877d2c44b70f89acbfc0883c2243e5eeaecc0d1cd0503f478',
  testnet: '4221332d34e1694168c2a0c0b3fd0f273809612cb13d000d5c2e00e85f50f796'
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
window.state = state;

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
  // If the ID is a wallet address (long base58), link to the account page.
  // Every interpolated segment is user-controlled (agents register arbitrary DIDs), so
  // encode them — unencoded values enabled stored XSS via crafted DIDs in href attributes.
  if (/^(mainnet|testnet)$/.test(network) && /^[1-9A-HJ-NP-Za-km-z]{40,55}$/.test(id)) {
    return `https://ccdexplorer.io/${encodeURIComponent(network)}/account/${encodeURIComponent(id)}`;
  }
  return null;
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

// Agent card modal — opened from an agent's Identity badge. Shows the roster info plus the bound
// Agent ID (DID) with a Concordium explorer link, so the verified/ID-set status is inspectable.
window.showAgentCard = function(agentId) {
  const agent = (state.agents || []).find(a => a.agent_id === agentId);
  const overlay = document.getElementById('styled-modal-overlay');
  const titleEl = document.getElementById('styled-modal-title');
  const msgEl = document.getElementById('styled-modal-message');
  const buttonsEl = document.getElementById('styled-modal-buttons');
  if (!agent?.identity_registry_links || !overlay) return;

  const isVerified = ['verified', 'registry_verified', 'human_linked', 'org_linked'].includes(agent.identity_status);
  const hasDid = !!agent.identity_ref;
  const statusLabel = isVerified ? `Verified · ${agent.identity_status}` : hasDid ? 'ID set — verifies on-chain when resolvable' : 'Unverified — no Agent ID bound';
  const statusColor = isVerified ? 'var(--color-green)' : hasDid ? 'var(--color-cyan)' : 'var(--color-text-soft)';
  const did = agent.identity_ref || '';
  let didHtml = '<span style="color:var(--color-text-soft);">none</span>';
  let explorerHtml = '';
  if (did) {
    const { registration: link, explorer } = agent.identity_registry_links;
    didHtml = link
      ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener" style="color:var(--color-cyan);text-decoration:underline;word-break:break-all;">${escapeHtml(did)} ↗</a>`
      : `<span style="word-break:break-all;">${escapeHtml(did)}</span>`;
    if (explorer) explorerHtml = `<a href="${escapeHtml(explorer)}" target="_blank" rel="noopener" style="color:var(--color-cyan);text-decoration:underline;">View on CCDExplorer ↗</a>`;
  }
  const row = (k, v) => `<div style="display:flex;gap:8px;margin-bottom:6px;"><span style="min-width:96px;color:var(--color-text-soft);">${k}</span><span style="flex:1;">${v}</span></div>`;

  titleEl.innerHTML = `<span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:${statusColor}22;color:${statusColor};font-size:16px;margin-right:8px;">${isVerified ? '✓' : hasDid ? '◆' : '○'}</span>Agent ID Card`;
  titleEl.style.color = statusColor;
  msgEl.innerHTML = `
    <div style="text-align:left;font-size:13px;line-height:1.5;">
      ${row('Name', `<strong>${escapeHtml(agent.display_name)}</strong>${agent.is_boss ? ' <span class="boss-badge">★ BOSS</span>' : ''}`)}
      ${row('Role', escapeHtml(agent.agent_role || 'Generalist'))}
      ${row('Status', escapeHtml(agent.status || 'idle'))}
      ${row('Identity', `<span style="color:${statusColor};font-weight:600;">${escapeHtml(statusLabel)}</span>`)}
      ${row('Agent ID', didHtml)}
      ${explorerHtml ? row('Explorer', explorerHtml) : ''}
      ${row('Runtime', escapeHtml(agent.runtime || '—'))}
      ${row('Model', escapeHtml(agent.model || '—'))}
      <div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);font-size:11px;color:var(--color-text-soft);line-height:1.5;">
        A Concordium Agent ID cryptographically links this agent to an accountable human or org. Only Verified ID agents may join private lobbies.
      </div>
    </div>`;
  buttonsEl.innerHTML = `<button class="btn btn-primary btn-sm" style="min-width:100px;" onclick="closeStyledModal()">Close</button>`;
  overlay.style.display = 'flex';
  const card = overlay.querySelector('.styled-modal-card');
  if (card) card.style.animation = 'modalSlideIn 0.2s ease-out';
};

// Delegated activation for the roster's "Agent ID Card" trigger — survives re-renders and needs no
// inline handler. Handles both click and keyboard (Enter/Space) so the role="button" link is
// accessible, and opens the in-page modal (never an external link / new tab).
function openAgentCardFrom(target) {
  const el = target && target.closest && target.closest('[data-agent-card]');
  if (el) { window.showAgentCard(el.getAttribute('data-agent-card')); return true; }
  return false;
}
document.addEventListener('click', (e) => {
  if (openAgentCardFrom(e.target)) e.preventDefault();
});
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.matches && e.target.matches('[data-agent-card]')) {
    if (openAgentCardFrom(e.target)) e.preventDefault();
  }
});

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
    const res = await fetch(url, { headers: lobbySessionHeaders() });
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
    // Verified statuses from the identity ladder (registry_verified / human_linked / org_linked).
    const isVerified = ['verified', 'registry_verified', 'human_linked', 'org_linked'].includes(agent.identity_status);
    // A bound Agent ID (DID) that isn't live-verified still means the agent HAS an issued identity —
    // show "ID set" (not the misleading "unverified") when on-chain verification isn't available
    // (e.g. no indexer configured). This is why some verified agents read "unverified" here.
    const hasDid = !!agent.identity_ref;
    const idLabel = isVerified ? `✓ ${agent.identity_status}` : hasDid ? 'ID set' : 'unverified';
    const idColor = isVerified ? 'var(--color-green)' : hasDid ? 'var(--color-cyan)' : 'var(--color-text-soft)';
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
          <div class="agent-meta-val">${idHtml}</div>
        </div>
        <div class="agent-meta-row">
          <div><span class="agent-meta-label">Identity:</span></div>
          <div class="agent-meta-val" style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <span style="color: ${idColor}; font-weight:600;">${escapeHtml(idLabel)}</span>
            ${agent.identity_registry_links ? `<button type="button" class="agent-card-link" data-agent-card="${escapeHtml(agent.agent_id)}">Agent ID Card</button>` : ''}
          </div>
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

window.selectLobby = async function(lobbyId) {
  state.activeLobbyId = lobbyId;
  document.getElementById('marketplace-beta').hidden = true;
  state.agents = [];
  state.messages = [];
  state.events = [];
  renderLobbies();
  renderRoster();
  renderMessages();
  renderEvents();
  renderTelemetry();
  if (state.lobbies.find(lobby => lobby.lobby_id === lobbyId)?.visibility === 'private' && !isSignedIn()) {
    await signInToLobby();
    if (!isSignedIn() || state.activeLobbyId !== lobbyId) return;
  }
  await pollLobbyDetails();
  if (state.activeLobbyId === lobbyId && document.getElementById('view-marketplace').style.display !== 'none') {
    void loadMarketplaceBeta();
  }
};

// ── Polling Loops ──

async function pollLobbies() {
  const token = state.session.token;
  const data = await fetchJson('/api/v1/agent-lobby/lobbies');
  if (token !== state.session.token) return;
  if (data && data.lobbies) {
    const wasPrivate = state.lobbies.some(lobby => lobby.lobby_id === state.activeLobbyId && lobby.visibility === 'private');
    state.lobbies = data.lobbies;
    if (wasPrivate && !state.lobbies.some(lobby => lobby.lobby_id === state.activeLobbyId)) {
      const publicLobby = state.lobbies.find(lobby => lobby.visibility === 'public');
      selectLobby(publicLobby?.lobby_id ?? null);
      return;
    }
    
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
      headers: { 'Content-Type': 'application/json', ...lobbySessionHeaders() },
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

function lobbySessionHeaders() {
  return state.session.token ? { Authorization: `Bearer ${state.session.token}` } : {};
}

/**
 * Mirror the wallet session to localStorage so the hosted Agent OS Panel (served same-origin at
 * /panel) can reuse it to call the lobby's wallet-gated APIs (e.g. browse the connected repo).
 * Cleared on sign-out / 401.
 */
function persistSession() {
  try {
    if (state.session.token && state.session.lobbyId) {
      localStorage.setItem('agentos.hosted.session', JSON.stringify(state.session));
    } else {
      localStorage.removeItem('agentos.hosted.session');
    }
  } catch { /* storage unavailable — panel just won't share the session */ }
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
    if (res.status === 401) { state.session = { token: null, identityRef: null, lobbyId: null }; persistSession(); renderHostedCard(); }
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
  if (!state.activeLobbyId) await pollLobbies();
  if (!state.activeLobbyId) { setStatus('Select a lobby first.'); return; }
  if (!state.wallet.connected || !state.wallet.address) { setStatus('connect your wallet first'); return; }
  const provider = window.concordium;
  if (!provider) { setStatus('wallet extension not found'); return; }

  const lobbyId = state.activeLobbyId;
  const address = state.wallet.address;
  try {
    // Production Concordium flow: bound challenge → wallet signMessage → server verifies against
    // the account's fresh on-chain credentials. The wallet returns a signature MAP, which the
    // server passes straight to verifyMessageSignature — do NOT flatten it.
    setStatus('requesting challenge…');
    const ch = await postJson('/api/v1/agent-lobby/auth/challenge', {
      account: address, lobby_id: lobbyId, network: CCD_NETWORK,
    });
    if (!ch?.challenge_id) { setStatus('could not get a challenge'); return; }

    setStatus('sign in your wallet…');
    const signature = await provider.signMessage(address, ch.challenge);

    setStatus('verifying…');
    const verified = await postJson('/api/v1/agent-lobby/auth/verify-wallet', {
      challenge_id: ch.challenge_id, account: address, signature, session_id: ch.session_id,
    });
    if (!verified?.token) { setStatus('sign-in rejected — wallet signature could not be verified on-chain'); return; }

    if (state.wallet.address !== address || state.activeLobbyId !== lobbyId) return;
    state.session = { token: verified.token, identityRef: verified.identity_ref, lobbyId };
    persistSession();
    setStatus('Signed in. Private lobbies you can access appear below.');
    await pollLobbies();
    renderHostedCard();
  } catch (err) {
    console.error('[Hosted] sign-in failed:', err);
    setStatus(`sign-in failed: ${err.message || err}`);
  }
}
window.signInToLobby = signInToLobby;

/** Render the Hosted-Mode card: session badge, and (when signed in) provider keys + hosted agents. */
async function renderHostedCard() {
  const card = document.getElementById('manage-hosted-card');
  if (!card) return;
  card.style.display = state.activeLobbyId ? '' : 'none';
  const badge = document.getElementById('hosted-session-badge');
  const keysSection = document.getElementById('hosted-keys-section');
  const agentsSection = document.getElementById('hosted-agents-section');
  const githubSection = document.getElementById('hosted-github-section');
  const signedIn = isSignedIn();
  if (badge) { badge.textContent = signedIn ? 'signed in' : 'signed out'; badge.style.color = signedIn ? 'var(--color-green)' : 'var(--text-muted)'; }
  if (keysSection) keysSection.style.display = signedIn ? '' : 'none';
  if (agentsSection) agentsSection.style.display = signedIn ? '' : 'none';
  if (githubSection) githubSection.style.display = signedIn ? '' : 'none';
  const signinBtn = document.getElementById('btn-hosted-signin');
  if (signinBtn) signinBtn.style.display = signedIn ? 'none' : '';
  if (signedIn) { await renderHostedKeys(); await renderHostedGitHub(); await renderHostedAgents(); }
}

/** Render the GitHub connection state: connect button, or connected account + repo/branch picker. */
async function renderHostedGitHub() {
  const el = document.getElementById('hosted-github-status');
  if (!el) return;
  const r = await authRequest('GET', `/api/v1/agent-lobby/lobbies/${state.activeLobbyId}/integrations/github`);
  const d = r.data || {};
  if (!d.connected) {
    el.innerHTML = d.configured === false
      ? `<span style="color:var(--color-yellow);">GitHub App not configured on this lobby.</span>`
      : `<button class="btn btn-primary btn-sm" id="btn-github-connect">Connect GitHub</button>`;
    document.getElementById('btn-github-connect')?.addEventListener('click', async () => {
      const res = await authRequest('POST', `/api/v1/agent-lobby/lobbies/${state.activeLobbyId}/integrations/github/connect`);
      if (res.ok && res.data?.install_url) window.open(res.data.install_url, '_blank', 'noopener');
      else if (res.data?.error === 'authentication required' || res.status === 401) {
        alert('Could not start GitHub connect: wallet sign-in required. Please sign in with your Concordium wallet.');
      } else {
        alert('Could not start GitHub connect: ' + (res.data?.error || res.status));
      }
    });
    return;
  }
  const repos = Array.isArray(d.repos) ? d.repos : [];
  const opts = repos.map(rp => `<option value="${escapeHtml(rp.full_name)}" ${rp.full_name === d.repo ? 'selected' : ''}>${escapeHtml(rp.full_name)}${rp.private ? ' 🔒' : ''}</option>`).join('');
  el.innerHTML = `
    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
      <span style="color:var(--color-green);">✓ Connected</span> <span style="color:var(--text-muted);">${escapeHtml(d.account || '')}</span>
      <select id="github-repo" style="font-size:11px; min-width:180px;">${opts || '<option value="">(no repos — adjust the App install)</option>'}</select>
      <input type="text" id="github-branch" placeholder="branch (default)" value="${escapeHtml(d.branch || '')}" style="width:120px; font-size:11px;" />
      <button class="btn btn-primary btn-sm" id="btn-github-save-repo">Use repo</button>
      <button class="btn btn-danger btn-sm" id="btn-github-disconnect">Disconnect</button>
    </div>
    <div style="font-size:10px; color:var(--text-muted); margin-top:4px;">Hosted agents read this repo and land changes as commits/PRs via the GitHub API.</div>`;
  document.getElementById('btn-github-save-repo')?.addEventListener('click', async () => {
    const repo = document.getElementById('github-repo')?.value;
    const branch = document.getElementById('github-branch')?.value?.trim() || undefined;
    if (!repo) { alert('Select a repo.'); return; }
    const res = await authRequest('POST', `/api/v1/agent-lobby/lobbies/${state.activeLobbyId}/integrations/github`, { repo, branch });
    if (!res.ok) alert('Could not set repo: ' + (res.data?.error || res.status));
    renderHostedGitHub();
  });
  document.getElementById('btn-github-disconnect')?.addEventListener('click', async () => {
    if (!confirm('Disconnect the GitHub repo from this lobby?')) return;
    await authRequest('DELETE', `/api/v1/agent-lobby/lobbies/${state.activeLobbyId}/integrations/github`);
    renderHostedGitHub();
  });
}

/** Populate the key-scope dropdown with "All agents" + one entry per agent currently in the roster. */
function populateHostedAgentScope() {
  const sel = document.getElementById('hosted-key-agent');
  if (!sel) return;
  const prev = sel.value;
  const agents = (state.agents || []).filter(a => a.agent_id);
  sel.innerHTML = `<option value="">All agents (lobby default)</option>` +
    agents.map(a => {
      const label = a.display_name || a.agent_role || a.agent_id;
      return `<option value="${escapeHtml(a.agent_id)}">${escapeHtml(label)}</option>`;
    }).join('');
  if (prev) sel.value = prev; // preserve selection across re-renders
}

async function renderHostedKeys() {
  const list = document.getElementById('hosted-keys-list');
  if (!list) return;
  populateHostedAgentScope();
  const r = await authRequest('GET', `/api/v1/agent-lobby/lobbies/${state.activeLobbyId}/provider-keys`);
  const keys = r.data?.provider_keys || [];
  list.innerHTML = keys.length === 0
    ? '<div class="empty-state">No provider keys configured.</div>'
    : keys.map(k => {
        const endpoint = [k.base_url && `<span style="color:var(--text-muted);">${escapeHtml(k.base_url)}</span>`, k.model && `<span style="color:var(--color-cyan);">${escapeHtml(k.model)}</span>`].filter(Boolean).join(' · ');
        const scope = k.agent_ref ? `agent ${escapeHtml(k.agent_ref)}` : 'all agents';
        return `<div class="list-row" style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 8px;">
        <span style="font-size:11px;">${escapeHtml(k.provider)} <span style="font-family:var(--font-mono); color:var(--text-muted);">${escapeHtml(k.key_hint)}</span> · ${scope}${endpoint ? ' · ' + endpoint : ''}</span>
        <button class="btn btn-danger btn-sm" data-revoke-key="${escapeHtml(k.id)}">Revoke</button>
      </div>`;
      }).join('');
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

  // The CIS-8004 `register` schema is type-strict: `agent_uri`/`metadata_hash_hex`/`network` are
  // strings, but `external_reference` is an OBJECT (or null) and `initial_metadata` is an ARRAY of
  // {key, value_hex}. The previous name-only heuristic stuffed a URL into `initial_metadata` (name
  // matched /metadata/) and a DID into `external_reference` (matched /external.*ref/), producing a
  // malformed parameter the contract rejected with "build_register call failed". So we now honour
  // the declared JSON type and only ever put a string value into a string-typed parameter; the
  // optional structured params are left unset for the service to default (None / empty), exactly as
  // every successful on-chain register event does.
  const typeOf = (p) => {
    const t = p?.type;
    if (Array.isArray(t)) return t.filter((x) => x !== 'null');
    return t ? [t] : [];
  };
  const isStringy = (p) => { const t = typeOf(p); return t.length === 0 || t.includes('string'); };

  for (const key of Object.keys(props)) {
    const prop = props[key];
    // Order is deliberate — most specific first.
    if (/hash/i.test(key)) args[key] = fields.cardHash;                              // metadata_hash_hex (64 hex)
    else if (/network/i.test(key)) args[key] = fields.network;                       // devnet|testnet|mainnet
    else if (isStringy(prop) && /(uri|url)/i.test(key)) args[key] = fields.metadataUrl; // agent_uri
    // The minting account — "sender" is what the live service calls it; plain owner/account too.
    else if (/sender|owner|account/i.test(key) || /^address$/i.test(key)) args[key] = fields.owner;
    // The agent's identity (DID / external reference / token id / key) — only when the parameter is
    // a plain string. `external_reference` on `register` is a structured object|null and is left to
    // the service default rather than being stuffed with a DID string.
    else if (isStringy(prop) && /agent.*(id|key|ref|reference|token|address|did)|external.*ref|^reference$|^token(_?id)?$|^did$/i.test(key)) args[key] = fields.agentDid;
    else if (isStringy(prop) && /name$/i.test(key)) args[key] = fields.agentName;
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
// Pinned to an exact patch so the wallet-connectors dep (loaded with ?deps=@concordium/web-sdk@…
// below) resolves to the SAME module instance — otherwise branded types (AccountAddress, Parameter,
// the sponsored Transaction.Signable) built here would fail `instanceOf` checks inside the connector.
const CCD_SDK_VERSION = '12.0.2';
const CCD_SDK_URL = `https://esm.sh/@concordium/web-sdk@${CCD_SDK_VERSION}`;
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

// Concordium wallet-connectors — the browser-wallet connector exposes signAndSendSponsoredTransaction
// (the injected `window.concordium` API alone cannot complete a sponsor-co-signed transaction). Pinned
// to share the web-sdk instance above via ?deps so the SignableV1 we build is recognized.
const CCD_CONNECTORS_URL = `https://esm.sh/@concordium/wallet-connectors@0.9.0-alpha.0?deps=@concordium/web-sdk@${CCD_SDK_VERSION}`;
let _ccdConnectorsPromise = null;
function loadConcordiumConnectors() {
  if (!_ccdConnectorsPromise) {
    _ccdConnectorsPromise = import(/* @vite-ignore */ CCD_CONNECTORS_URL).catch((err) => {
      _ccdConnectorsPromise = null;
      throw new Error(`could not load Concordium wallet-connectors from ${CCD_CONNECTORS_URL}: ${err.message || err}`);
    });
  }
  return _ccdConnectorsPromise;
}

/** Fetch the sender account's next sequence number (nonce) from the public wallet proxy. */
async function fetchAccountNonce(address) {
  const res = await fetch(`${CCD_WALLET_PROXY_BASE}/v0/accNonce/${encodeURIComponent(address)}`);
  if (!res.ok) throw new Error(`could not fetch account nonce (HTTP ${res.status})`);
  const data = await res.json();
  const nonce = Number(data?.nonce);
  if (!Number.isInteger(nonce) || nonce <= 0) throw new Error(`wallet proxy returned an invalid nonce: ${data?.nonce}`);
  return nonce;
}

/**
 * Submit an Agent-ID mint through Concordium's SPONSOR service so the registry accepts it (register
 * on this contract is sponsor-gated — a self-paid call is rejected by policy). Flow, all verified
 * against the live services:
 *   1. Build the UNSIGNED transaction in the sponsor's Transaction.JSON shape — an *initial* builder
 *      header (`executionEnergyAmount` only; integer numeric fields) + the update payload with the
 *      pre-encoded parameter hex. The sponsor adds sender/nonce/expiry + its own signature.
 *   2. POST it to the lobby's sponsor relay → a partially-signed SignableV1 (sponsor signature set,
 *      sender signature empty).
 *   3. Parse it with the SDK and hand it to the browser wallet's connector, which adds the SENDER
 *      signature and submits — no keys leave the wallet, Concordium pays the energy.
 * Returns the submitted transaction hash.
 */
async function submitSponsoredMint({ sender, index, subindex, receiveName, parameterHex, maxEnergy }) {
  const sdk = await loadConcordiumSdk();
  const { Transaction, AccountAddress } = sdk;
  const connectors = await loadConcordiumConnectors();
  const BrowserWalletConnector = connectors.BrowserWalletConnector;
  if (!BrowserWalletConnector) throw new Error('wallet-connectors did not export BrowserWalletConnector');

  const nonce = await fetchAccountNonce(sender);
  // The sponsor parses this with the Concordium SDK: numeric fields MUST be integers (not the SDK
  // toJSON string form), the header carries ONLY executionEnergyAmount (the service adds the rest).
  const unsignedTx = {
    header: { executionEnergyAmount: Number(maxEnergy) },
    payload: {
      type: 'update',
      amount: 0,
      address: { index: Number(index), subindex: Number(subindex ?? 0) },
      receiveName,
      message: parameterHex,
    },
  };
  console.log('[Registry] requesting sponsor co-signature for', receiveName, 'nonce', nonce);
  const partiallySigned = await requestSponsoredTransaction(unsignedTx, sender, CCD_GENESIS_HASH, nonce);
  if (!partiallySigned) throw new Error('the sponsor service did not return a co-signed transaction (see console for the relay error)');

  const signable = Transaction.signableFromJSON(partiallySigned);
  console.log('[Registry] sponsor co-signed; requesting the wallet to add the sender signature + submit…');

  const noop = () => {};
  const connector = await BrowserWalletConnector.create({
    onChainChanged: noop, onAccountChanged: noop, onConnected: noop, onDisconnected: noop,
  });
  const txHash = await connector.signAndSendSponsoredTransaction(AccountAddress.fromBase58(sender), signable);
  return txHash;
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
 * Recursively search an object for the first string value whose (key, value) satisfies `pred`.
 * Lets us find a pre-encoded parameter `hex` even when a service version nests it under a wrapper
 * (e.g. `{ result: { hex } }` / `{ payload: { parameter_hex } }`) instead of the flat top level.
 */
function deepFindString(obj, pred, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 5) return null;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') { if (pred(k, v)) return v; }
    else if (v && typeof v === 'object') { const found = deepFindString(v, pred, depth + 1); if (found) return found; }
  }
  return null;
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

  // The lobby advertises whether Concordium's sponsor service is wired (gasless mint). The builder
  // choice below picks register vs set-agent-uri; sponsorship is an orthogonal submit-time concern.
  const sponsorAvailable = Boolean(status.sponsored);

  const toolsRes = await fetchJson('/api/v1/agent-lobby/registry/tools');
  const tools = toolsRes?.tools || [];
  const { tool: builder, sponsored, mode } = await chooseRegistryBuilder(tools, fields);
  console.log(`[Registry] using builder "${builder.name}" (mode: ${mode}, sponsored-tool: ${sponsored}, sponsor-service: ${sponsorAvailable})`);

  const args = mapBuilderArgs(builder.inputSchema, fields);
  const call = await postJson('/api/v1/agent-lobby/registry/call', { tool: builder.name, arguments: args });
  if (!call || !call.ok) throw new Error(call?.error || `${builder.name} call failed`);
  const payload = call.result || {};
  console.log(`[Registry] ${builder.name} payload:`, payload);

  // The docs describe `{ hex, schema_json }` where **hex is the wire-encoded parameter, ready for
  // signing** — the authoritative, schema-free path. Some service versions instead return
  // `parameter_json` + a schema. We must distinguish a real **base64 module schema** (which the
  // wallet can serialize against) from `schema_json` (a JSON schema type, NOT base64). Feeding
  // `schema_json` to the wallet as if it were a base64 schema makes the wallet serialize an EMPTY
  // parameter — the exact cause of the on-chain `CIS-8004.register` parse-error reject (empty
  // message, ~4 CCD burned). So `schema_json` is captured separately and never used as base64.
  const looksHex = (v) => typeof v === 'string' && v.length > 0 && v.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(v);
  const looksBase64Schema = (v) =>
    typeof v === 'string' && v.length > 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(v) && !/^[\s[{]/.test(v);
  const hex = [payload.hex, payload.parameter_hex, payload.payload_hex, payload.message_hex]
    .find((v) => looksHex(v)) || deepFindString(payload, (k, v) => /hex|param/i.test(k) && looksHex(v)) || null;
  const parameterJson = payload.parameter_json ?? payload.parameters_json ?? null;
  // Only genuine base64 schemas — explicitly NOT `schema_json`.
  const schemaB64 = [payload.schema_b64, payload.schema_base64, payload.schemaBase64, payload.module_schema]
    .find((v) => looksBase64Schema(v))
    || (looksBase64Schema(payload.schema) ? payload.schema : null);
  // The JSON schema type (object or JSON string), used only for client-side serialization below.
  const schemaJsonType = payload.schema_json ?? (typeof payload.schema === 'object' ? payload.schema : null);

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
  console.log('[Registry] submitting Update tx:', {
    index, subindex, receiveName, energy: energyVal,
    hasHex: !!hex, hasBase64Schema: !!schemaB64, hasSchemaJson: !!schemaJsonType, hasParamJson: !!parameterJson,
    payloadKeys: Object.keys(payload),
  });

  // Resolve the parameter to a concrete, NON-EMPTY message before touching the wallet. Submitting
  // an empty parameter is a guaranteed on-chain parse-error reject that still costs energy — we
  // refuse to burn CCD on it and instead throw a precise diagnostic.
  let message = null;
  let submitMode = null;
  if (hex) {
    message = Parameter.fromHexString(hex);           // authoritative sign-ready bytes
    submitMode = 'hex';
  } else if (parameterJson && schemaJsonType) {
    // Serialize client-side with our own SDK against the JSON schema type — avoids handing the
    // wallet a non-base64 "schema" (the empty-parameter bug). Tolerate a JSON-string schema.
    const schemaType = typeof schemaJsonType === 'string' ? JSON.parse(schemaJsonType) : schemaJsonType;
    message = Parameter.fromSchemaType(schemaType, parameterJson);
    submitMode = 'schema_json';
  }

  // SPONSORED PATH — this registry's write entrypoints (register / setAgentURI / …) are
  // **sponsor-gated**: on-chain evidence shows every successful register goes through the authorized
  // sponsor account, while every SELF-PAID call is rejected by contract policy (reject -2147483648,
  // ~4 CCD burned). So when the lobby advertises a sponsor service, route the mint through it: the
  // sponsor co-signs and pays the energy, and the browser wallet only adds the sender signature.
  if (sponsorAvailable) {
    if (!hex) {
      throw new Error(`the sponsored mint needs the builder's pre-encoded parameter hex, but ${builder.name} returned none (keys: ${Object.keys(payload).join(', ')}). No transaction was submitted.`);
    }
    const paramBytes = Parameter.toBuffer(Parameter.fromHexString(hex));
    if (!paramBytes || paramBytes.length === 0) {
      throw new Error(`refusing to submit: the resolved ${builder.name} parameter is empty — this would parse-error on-chain. No transaction was submitted.`);
    }
    const txHash = await submitSponsoredMint({
      sender: state.wallet.address, index, subindex, receiveName, parameterHex: hex, maxEnergy: energyVal,
    });
    return { txHash, contract: { index, subindex: subindex ?? 0 }, receiveName, mode, sponsored: true, submitMode: 'sponsored' };
  }

  let txHash;
  if (message) {
    const paramBytes = Parameter.toBuffer(message);
    if (!paramBytes || paramBytes.length === 0) {
      throw new Error(`refusing to submit: the resolved ${builder.name} parameter is empty (mode: ${submitMode}) — this would parse-error on-chain and waste energy. Payload keys: ${Object.keys(payload).join(', ')}. Full payload logged to the console.`);
    }
    console.log(`[Registry] parameter resolved via "${submitMode}" (${paramBytes.length} bytes): ${Parameter.toHexString(message)}`);
    txHash = await provider.sendTransaction(state.wallet.address, AccountTransactionType.Update, {
      amount, address, receiveName: receiveNameObj, message, maxContractExecutionEnergy: energyObj,
    });
  } else if (parameterJson && schemaB64) {
    // Fallback: hand the wallet the JSON params + a genuine base64 schema to serialize.
    submitMode = 'wallet_base64';
    txHash = await provider.sendTransaction(state.wallet.address, AccountTransactionType.Update, {
      amount, address, receiveName: receiveNameObj, maxContractExecutionEnergy: energyObj,
    }, parameterJson, schemaB64);
  } else if (parameterJson) {
    throw new Error(`${builder.name} returned parameter_json but no usable schema (no hex, no base64 schema, no JSON schema type) to serialize it. Payload keys: ${Object.keys(payload).join(', ')} — full payload logged to the browser console`);
  } else {
    throw new Error(`${builder.name} did not return a signable parameter (no hex / parameter_json). Payload keys: ${Object.keys(payload).join(', ')} — full payload logged to the browser console`);
  }
  return { txHash, contract: { index, subindex: subindex ?? 0 }, receiveName, mode, sponsored, submitMode };
}

/**
 * Ask the lobby (which relays to Concordium's sponsor service) to co-sign an unsigned account
 * transaction so the Agent-ID mint is gasless — Concordium pays the energy instead of the owner.
 * Returns the partially-signed Transaction.JSON for the wallet to complete and submit, or null when
 * sponsorship is unavailable/declined so the caller falls back to a self-paid submission. No keys
 * leave the wallet: only the unsigned payload is relayed.
 */
async function requestSponsoredTransaction(unsignedTx, sender, genesisHash, nonce) {
  try {
    const res = await postJson('/api/v1/agent-lobby/registry/sponsor', {
      genesisHash, sender, nonce, payload: unsignedTx,
    });
    if (res && res.ok && res.transaction) return res.transaction;
    console.warn('[Registry] sponsor relay declined:', res?.error || 'unknown reason');
  } catch (err) {
    console.warn('[Registry] sponsor relay unavailable:', err?.message || err);
  }
  return null;
}

/**
 * After a mint is submitted, confirm it actually finalized as a success — a submitted tx can still
 * be rejected on-chain (e.g. a parameter parse error), which previously showed as a false "success".
 * Polls CCDScan's public GraphQL for the finalized outcome and alerts the user on rejection. Purely
 * informational and best-effort: if the query is unreachable/CORS-blocked it stays quiet.
 */
async function verifyMintOutcome(txHash, agentDid) {
  const endpoint = CCD_NETWORK === 'mainnet'
    ? 'https://api-ccdscan.mainnet.concordium.software/api/graphql'
    : 'https://api-ccdscan.testnet.concordium.com/api/graphql';
  const query = `{ transactionByTransactionHash(transactionHash:"${txHash}"){ result{ __typename ... on Rejected{ reason{ __typename ... on RejectedReceive{ rejectReason receiveName } } } } } }`;
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((r) => setTimeout(r, 6000)); // ~finalization cadence; poll up to ~60s
    try {
      const res = await fetch(endpoint, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const result = data?.data?.transactionByTransactionHash?.result;
      if (!result) continue; // not yet finalized/indexed — keep polling
      const statusEl = document.getElementById('onchain-status-line');
      const explorer = `https://ccdexplorer.io/${CCD_NETWORK}/transaction/${txHash}`;
      if (result.__typename === 'Rejected') {
        const reason = result.reason?.rejectReason ?? result.reason?.__typename ?? 'unknown';
        const where = result.reason?.receiveName ? ` at ${result.reason.receiveName}` : '';
        console.error('[Registry] mint REJECTED on-chain:', result);
        if (statusEl) statusEl.innerHTML = `<span style="color:#ff5c5c; font-weight:600;">✗ Mint rejected on-chain</span> — <span style="font-size:10px;">reason ${escapeHtml(String(reason))}${escapeHtml(where)}</span> — <a href="${escapeHtml(explorer)}" target="_blank" style="color:var(--color-cyan); text-decoration:underline;">Tx ↗</a>`;
        alert(`⚠ On-chain mint for ${agentDid} was REJECTED${where} (reason ${reason}).\nThe agent card remains hosted off-chain by this lobby. Tx: ${txHash}\n\nThe DID is NOT anchored on-chain. Check the browser console for the built parameter and retry once the payload is corrected.`);
      } else {
        console.log('[Registry] mint finalized successfully:', result.__typename);
        if (statusEl) statusEl.innerHTML = `<span style="color:var(--color-green); font-weight:600;">✓ Anchored on-chain (finalized)</span> — <a href="${escapeHtml(explorer)}" target="_blank" style="color:var(--color-cyan); text-decoration:underline;">Tx ${escapeHtml(String(txHash).slice(0,16))}… ↗</a>`;
      }
      return;
    } catch (err) {
      console.debug('[Registry] outcome poll failed (will retry):', err?.message || err);
    }
  }
  console.warn('[Registry] could not confirm mint outcome within the polling window — verify on the explorer.');
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
  const requestedLobby = new URLSearchParams(location.search).get('lobby');
  try {
    const saved = JSON.parse(localStorage.getItem('agentos.hosted.session') || 'null');
    if (saved?.token && saved.lobbyId) state.session = saved;
  } catch { /* continue without the previous session */ }
  if (requestedLobby && /^[\da-f-]{36}$/i.test(requestedLobby)) {
    selectLobby(requestedLobby);
  }
  document.getElementById('btn-discover-private-lobbies')?.addEventListener('click', () => {
    if (!state.wallet.connected) void window.connectConcordiumWallet();
    else void signInToLobby();
  });
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
      if (!isSignedIn()) {
        if (!state.wallet.connected) {
          alert('Connect your Concordium wallet to create a lobby.');
          return;
        }
        await signInToLobby();
        if (!isSignedIn()) return;
      }
      
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
        auth_lobby_id: state.session.lobbyId,
      });

      if (res && res.lobby) {
        if (res.token) {
          state.session = { token: res.token, identityRef: res.lobby.created_by, lobbyId: res.lobby.lobby_id };
          persistSession();
        }
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

  async function handleSendMessage() {
    if (!state.activeLobbyId) {
      alert('Please select a lobby first.');
      return;
    }
    const content = chatInputText?.value?.trim();
    if (!content) return;
    if (!isSignedIn()) {
      if (!state.wallet.connected) {
        alert('Connect your Concordium wallet to send messages.');
        return;
      }
      await signInToLobby();
      if (!isSignedIn()) return;
    }
    const sent = await authRequest('POST', `/api/v1/agent-lobby/lobbies/${state.activeLobbyId}/messages`, {
      content, message_type: 'chat',
    });
    const res = sent?.data;

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
        if (!isSignedIn()) await signInToLobby();
        if (!isSignedIn()) throw new Error('Sign in to this lobby first.');
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
          const verb = anchor.mode === 'update' ? 'setAgentURI submitted (pending)' : 'Mint submitted (pending)';
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
            <strong>On-Chain:</strong> <span id="onchain-status-line">${onChainLine}</span><br>
            <strong>Owner Account:</strong> <a href="${escapeHtml(explorerUrl)}" target="_blank" style="color:var(--color-cyan); text-decoration:underline;">View on CCDExplorer ↗</a><br>
            <strong>Card Hash:</strong> <span style="font-size:9px; color:var(--text-muted);">${cardHash}</span><br>
            <strong>Signature:</strong> <span style="font-size:9px; color:var(--text-muted);">${signatureHex?.slice(0, 32)}...</span><br>
            <strong>Status:</strong> <span style="color:var(--color-green); font-weight:600;">✓ Wallet-signed</span>${anchor ? (anchor.sponsored ? ' · sponsored mint (gasless)' : ' · on-chain mint submitted') : ' · card hosted off-chain by this lobby'}
          </div>${bindNote}`;
        state.identity.bindingAgentId = null;
      }

      // The roster shows genuinely connected agents (registered over the lobby WS protocol);
      // an issued credential appears there once the agent connects and presents its DID.
      pollLobbyDetails();

      btnIssueAgentAction.disabled = false;
      btnIssueAgentAction.textContent = "Issue Agent ID";

      if (anchor) {
        alert(`Agent DID issued & signed. On-chain mint SUBMITTED (pending finalization) — this is not yet confirmed.\nDID: ${agentDid}\nTransaction: ${anchor.txHash}\nMetadata: ${metadataUrl}\n\nVerifying the outcome on-chain… you'll get a second alert if the transaction is rejected.`);
        // Non-blocking: confirm the tx actually finalized as a success and warn if it rejected,
        // instead of leaving a misleading "submitted" as if it were a confirmed mint.
        verifyMintOutcome(anchor.txHash, agentDid);
      } else if (anchorError) {
        alert(`Agent DID issued and signed, but on-chain anchoring failed: ${anchorError}\nThe card remains hosted by this lobby at ${metadataUrl}.`);
      } else {
        alert(`Agent DID issued & cryptographically signed!\nDID: ${agentDid}\nMetadata: ${metadataUrl}\nNote: the card is hosted by this lobby and is not yet anchored on-chain — configure AGENT_OS_AGENT_REGISTRY_MCP_URL on the lobby server to enable Concordium Agent Registry minting.`);
      }
    });
  }

  // Concordium Wallet Connection function
  async function connectConcordiumWallet() {
    if (state.wallet.connected) {
      state.wallet.connected = false;
      state.wallet.address = null;
      state.wallet.balance = null;
      state.session = { token: null, identityRef: null, lobbyId: null };
      persistSession();
      document.getElementById('hosted-signin-status').textContent = '';
      const active = state.lobbies.find(lobby => lobby.lobby_id === state.activeLobbyId);
      state.lobbies = state.lobbies.filter(lobby => lobby.visibility !== 'private');
      if (active?.visibility === 'private') selectLobby(state.lobbies[0]?.lobby_id ?? null);
      else renderLobbies();
      updateWalletUI();
      void pollLobbies();
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

      if (state.session.identityRef !== `did:ccd:${CCD_NETWORK}:${addrStr}`) {
        state.session = { token: null, identityRef: null, lobbyId: null };
        persistSession();
      }
      state.wallet.connected = true;
      state.wallet.address = addrStr;
      updateWalletUI();
      await signInToLobby();
      const balanceCcd = await fetchWalletBalance(provider, addrStr);
      if (state.wallet.address === addrStr) {
        state.wallet.balance = balanceCcd;
        updateWalletUI();
      }
    } catch (err) {
      console.error('Concordium Wallet connection failed:', err);
      alert(`Concordium Wallet Connection Failed: ${err.message || err}`);
      if (textEl) textEl.textContent = 'Disconnected';
    }
  }
  window.connectConcordiumWallet = connectConcordiumWallet;

  const btnConnectWallet = document.getElementById('btn-connect-wallet');
  if (btnConnectWallet) {
    btnConnectWallet.addEventListener('click', connectConcordiumWallet);
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

// ── Top-nav view switcher (Lobby / Manage / Marketplace / Panel) ──
const VIEWS = ['lobby', 'marketplace'];
let marketplaceGeneration = 0;
async function loadMarketplaceBeta(catalogOffset = 0, listingOffset = 0) {
  const root = document.getElementById('marketplace-beta');
  const generation = ++marketplaceGeneration;
  const lobbyId = state.activeLobbyId;
  if (!lobbyId || !isSignedIn()) { root.hidden = true; return; }
  if (root.dataset.lobby !== lobbyId || root.dataset.actor !== state.session.identityRef) {
    root.hidden = true;
    root.querySelector('[data-market-search]').reset();
    root.querySelector('[data-market-listing]').reset();
    delete root.querySelector('[data-market-listing]').dataset.editing;
    root.dataset.lobby = lobbyId;
    root.dataset.actor = state.session.identityRef;
  }
  const status = root.querySelector('[data-market-status]');
  const search = root.querySelector('[data-market-search]');
  const profileForm = root.querySelector('[data-market-profile]');
  const listingForm = root.querySelector('[data-market-listing]');
  const actor = state.session.identityRef;
  const pageSize = 20;
  const active = () => generation === marketplaceGeneration && state.activeLobbyId === lobbyId && isSignedIn() && state.session.identityRef === actor;
  async function request(path, body) {
    const response = await fetch(`/api/v1/agent-lobby/lobbies/${encodeURIComponent(lobbyId)}/marketplace/${path}`, {
      headers: { ...lobbySessionHeaders(), 'Content-Type': 'application/json' },
      ...(body && { method: 'POST', body: JSON.stringify(body) }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || result.error || 'Marketplace request failed.');
    return result;
  }
  function wire(form, action) {
    form.onsubmit = async event => {
      event.preventDefault();
      const button = event.submitter || form.querySelector('button[type="submit"]');
      if (!active() || button.disabled) return;
      const label = button.textContent;
      button.disabled = true;
      button.textContent = 'Saving…';
      try { await action(new FormData(form), button); }
      catch (error) { if (active()) status.textContent = error.message; }
      finally {
        button.textContent = label;
        button.disabled = false;
      }
    };
  }
  const lines = value => String(value).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const filters = new URLSearchParams(new FormData(search));
  filters.set('offset', catalogOffset);
  const paging = (name, page, reload) => {
    const prev = root.querySelector(`[data-market-${name}-prev]`);
    const next = root.querySelector(`[data-market-${name}-next]`);
    prev.disabled = page.offset === 0;
    next.disabled = page.offset + page.data.length >= page.total;
    prev.onclick = () => { prev.disabled = next.disabled = true; void reload(Math.max(0, page.offset - pageSize)); };
    next.onclick = () => { prev.disabled = next.disabled = true; void reload(page.offset + pageSize); };
  };
  let catalog, listings;
  try {
    [catalog, listings] = await Promise.all([request(`catalog?${filters}`), request(`listings?offset=${listingOffset}`)]);
  } catch (error) {
    if (active()) { root.hidden = true; status.textContent = error.message; }
    return;
  }
  if (!active()) return;
  root.hidden = false;
  root.querySelector('[data-market-buyer]').hidden = !listings.canPublish;
  status.textContent = `${catalog.total} specialists and ${listings.total} listings.`;
  search.onsubmit = event => { event.preventDefault(); void loadMarketplaceBeta(0, listingOffset); };
  paging('catalog', catalog, offset => loadMarketplaceBeta(offset, listingOffset));
  paging('listings', listings, offset => loadMarketplaceBeta(catalogOffset, offset));
  const catalogList = root.querySelector('[data-market-catalog]');
  catalogList.innerHTML = catalog.data.map(profile => `<article>
    <h3>${escapeHtml(profile.displayName)}</h3><p>Verified Agent ID ${escapeHtml(profile.agentDid)}</p>
    <p>Skills ${escapeHtml(profile.skills.join(', '))} · Runtimes ${escapeHtml(profile.runtimes.join(', '))}</p>
    <p>${escapeHtml(profile.availability)}</p><p>Work samples ${escapeHtml(profile.workSamples.join(', '))}</p>
  </article>`).join('');
  if (listings.canPublish) [...catalogList.children].forEach((article, index) => {
    const form = document.createElement('form');
    form.innerHTML = '<button type="submit">Suspend profile</button>';
    wire(form, async () => {
      await request('catalog', { action: 'suspend', id: catalog.data[index].id });
      await loadMarketplaceBeta(catalogOffset, listingOffset);
    });
    article.append(form);
  });
  const roster = state.agents.filter(agent => agent.identity_ref);
  profileForm.elements.agentDid.replaceChildren(...roster.map(agent => new Option(agent.display_name, agent.identity_ref)));
  const unpublish = profileForm.querySelector('[data-market-unpublish]');
  function selectProfile() {
    const profile = catalog.ownProfiles.find(item => item.agentDid === profileForm.elements.agentDid.value);
    unpublish.hidden = profile?.status !== 'published';
    for (const name of ['displayName', 'skills', 'runtimes', 'availability', 'workSamples']) {
      const value = profile?.[name];
      profileForm.elements[name].value = Array.isArray(value) ? value.join('\n') : value || '';
    }
  }
  profileForm.elements.agentDid.onchange = selectProfile;
  selectProfile();
  wire(profileForm, async (values, button) => {
    const body = Object.fromEntries(values);
    const selected = catalog.ownProfiles.find(item => item.agentDid === body.agentDid);
    if (button === unpublish) {
      await request('catalog', { action: 'unpublish', id: selected.id });
      await loadMarketplaceBeta(0, listingOffset);
      return;
    }
    for (const name of ['skills', 'runtimes', 'workSamples']) body[name] = lines(body[name]);
    await request('catalog', { ...body, action: 'publish' });
    await loadMarketplaceBeta(0, listingOffset);
  });
  wire(listingForm, async (values, button) => {
    const body = Object.fromEntries(values);
    const editing = listings.data.find(item => item.id === listingForm.dataset.editing);
    await request('listings', { ...body, id: editing?.id, version: editing?.version, action: button.value || 'publish', amount: '0', deadline: Date.parse(body.deadline),
      acceptanceChecks: lines(body.acceptanceChecks) });
    delete listingForm.dataset.editing;
    listingForm.reset();
    await loadMarketplaceBeta(catalogOffset, 0);
  });
  const list = root.querySelector('[data-market-listings]');
  const legacy = root.querySelector('[data-market-legacy]');
  legacy.hidden = listings.legacy.length === 0;
  legacy.querySelector('ul').replaceChildren(...listings.legacy.map(entry => {
    const row = document.createElement('li');
    row.textContent = `${entry.title} · ${entry.status}${entry.legacyAuthorization ? ' · Historical wallet authorization' : ''}`;
    return row;
  }));
  list.innerHTML = listings.data.map(entry => `<article>
    <h4>${escapeHtml(entry.title)}</h4><p>${escapeHtml(entry.status)} · Zero price · Version ${entry.version}</p>
    <p>${escapeHtml(entry.deliverable)}</p><p>Scope ${escapeHtml(entry.scope)}</p>
    <p>Deadline ${escapeHtml(new Date(entry.deadline).toLocaleString())}</p>
    <ul>${entry.acceptanceChecks.map(check => `<li>${escapeHtml(check)}</li>`).join('')}</ul>
    <button type="button" data-review>Review bids and agreement</button><div data-market-offers></div>
  </article>`).join('');
  [...list.children].forEach((article, index) => {
    const entry = listings.data[index];
    const review = article.querySelector('[data-review]');
    const offers = article.querySelector('[data-market-offers]');
    if (listings.canPublish && entry.buyer === actor && ['open', 'draft'].includes(entry.status)) {
      const form = document.createElement('form');
      form.innerHTML = '<button type="button">Edit listing</button><button type="submit">Cancel listing</button>';
      form.querySelector('button').onclick = () => {
        listingForm.dataset.editing = entry.id;
        for (const name of ['title', 'deliverable', 'scope']) listingForm.elements[name].value = entry[name];
        listingForm.elements.acceptanceChecks.value = entry.acceptanceChecks.join('\n');
        const localDeadline = new Date(entry.deadline);
        localDeadline.setMinutes(localDeadline.getMinutes() - localDeadline.getTimezoneOffset());
        listingForm.elements.deadline.value = localDeadline.toISOString().slice(0, 16);
        listingForm.closest('details').open = true;
        listingForm.elements.title.focus();
      };
      wire(form, async () => {
        await request('listings', { id: entry.id, version: entry.version, action: 'cancel' });
        await loadMarketplaceBeta(catalogOffset, listingOffset);
      });
      article.insertBefore(form, review);
    }
    review.onclick = async () => {
      review.disabled = true;
      try {
        const result = await request(`listings/${encodeURIComponent(entry.id)}/bids?offset=${Number(offers.dataset.offset || 0)}`);
        if (!active()) return;
        offers.replaceChildren();
        if (result.agreement) {
          offers.textContent = `Agreement ${result.agreement.id}. Assignment ${result.agreement.assignmentId}. Handoff ${result.agreement.handoff.status}.`;
          if (result.agreement.handoff.status === 'pending' && entry.buyer === actor) {
            const retry = document.createElement('form');
            retry.innerHTML = '<button type="submit">Retry assignment handoff</button>';
            wire(retry, async () => {
              const agreement = result.agreement;
              await request(`listings/${encodeURIComponent(entry.id)}/hire`, { bidId: agreement.bid.id,
                bidVersion: agreement.bid.version, listingVersion: agreement.listing.version, digest: agreement.buyerConsent.digest });
              await review.onclick();
            });
            offers.append(retry);
          }
          const engagement = `engagements/${encodeURIComponent(result.agreement.id)}`;
          const panel = document.createElement('section');
          offers.append(panel);
          const renderDelivery = async (offset = 0) => {
            const delivery = await request(`${engagement}/delivery?offset=${offset}`);
            if (!active()) return;
            panel.innerHTML = `<h5>Delivery</h5><p>${escapeHtml(delivery.status)} · Agent ${escapeHtml(delivery.assignee)} · Task ${escapeHtml(delivery.taskStatus || 'pending')}</p>`;
            const mutation = (action, label, fields, values = {}) => {
              const form = document.createElement('form');
              form.innerHTML = `${fields}<button type="submit">${label}</button>`;
              wire(form, async data => {
                await request(`${engagement}/delivery`, { ...Object.fromEntries(data), ...values,
                  action, version: delivery.version, termsDigest: delivery.termsDigest });
                await renderDelivery();
                panel.querySelector('h5').focus();
              });
              panel.append(form);
              return form;
            };
            panel.querySelector('h5').tabIndex = -1;
            for (const submission of delivery.data) {
              const article = document.createElement('article');
              article.innerHTML = `<h6>Submission ${submission.version} · ${escapeHtml(submission.execution)}</h6>
                <p>Source <code>${escapeHtml(submission.sourceRevision)}</code></p>
                <p>Patch or PR commit <code>${escapeHtml(submission.patchDigest || submission.pullRequestCommit)}</code></p>
                <pre>${escapeHtml(submission.testResults)}</pre>`;
              if (submission.workspaceRunId) {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = 'Load workspace evidence';
                button.onclick = async () => {
                  button.disabled = true;
                  try {
                    const evidence = await request(`${engagement}/artifacts/${encodeURIComponent(submission.workspaceRunId)}`);
                    const output = document.createElement('pre');
                    output.textContent = evidence.artifacts?.patch || 'Patch unavailable.';
                    if (active()) { article.append(output); button.remove(); }
                  } catch (error) { if (active()) status.textContent = error.message; }
                  finally { button.disabled = false; }
                };
                article.append(button);
              }
              panel.append(article);
            }
            const reason = '<label>Reason <textarea name="reason" required></textarea></label>';
            const latest = offset === 0 ? delivery.data[0] : undefined;
            if (delivery.isBuyer && delivery.status === 'submitted' && latest) {
              mutation('accept', 'Accept submission', '', { submissionId: latest.id });
              mutation('revise', 'Request revision', reason, { submissionId: latest.id });
            }
            if (delivery.isSpecialist && ['assigned', 'in_progress', 'revision_requested'].includes(delivery.status)) {
              if (delivery.status !== 'in_progress') mutation('start', 'Start assignment', '');
              mutation('submit', 'Submit delivery', `<label>Execution <select name="execution"><option value="local">Local</option><option value="hosted">Hosted</option></select></label>
                <label>Attempt ID <input name="attemptId" required></label><label>Source commit <input name="sourceRevision" required pattern="[0-9a-fA-F]{40}"></label>
                <label>Patch SHA-256 <input name="patchDigest" pattern="[0-9a-fA-F]{64}"></label><label>PR commit <input name="pullRequestCommit" pattern="[0-9a-fA-F]{40}"></label>
                <label>Test results <textarea name="testResults" required></textarea></label>`);
              for (const run of delivery.workspaceRuns.filter(run => run.state === 'succeeded')) {
                mutation('submit', `Submit workspace ${run.id}`, '', { execution: 'cloud', workspaceRunId: run.id,
                  attemptId: run.attemptId, sourceRevision: run.sourceRevision });
              }
            }
            if (delivery.status === 'disputed' && delivery.reviewer && !delivery.isBuyer && !delivery.isSpecialist) {
              mutation('resolve', 'Resolve dispute', `${reason}<label>Decision <select name="decision"><option value="revision_requested">Request revision</option>
                <option value="cancelled">Cancel engagement</option></select></label><label>Evidence reference <input name="reference" required></label>`);
            } else if (!['accepted', 'cancelled', 'expired', 'disputed'].includes(delivery.status)) {
              if (delivery.isBuyer || delivery.isSpecialist) mutation('dispute', 'Open dispute', reason);
              mutation('cancel', 'Cancel engagement', reason);
            }
            if (delivery.status === 'accepted' && (delivery.isBuyer || delivery.isSpecialist) && !delivery.feedback.some(row => row.actor === actor)) {
              mutation('feedback', 'Submit feedback', '<label>Feedback <textarea name="text" required></textarea></label>');
            }
            for (const feedback of delivery.feedback) {
              const text = document.createElement('p');
              text.textContent = `${feedback.hidden ? 'Hidden feedback' : 'Feedback'} · ${feedback.text}`;
              panel.append(text);
              if (delivery.reviewer && !feedback.hidden) mutation('hide_feedback', 'Hide feedback', reason, { reference: feedback.id });
            }
            const history = document.createElement('ul');
            for (const row of delivery.history.data) {
              const item = document.createElement('li');
              item.textContent = `${row.action} · ${new Date(row.at).toLocaleString()}${row.reason ? ' · ' + row.reason : ''}`;
              history.append(item);
            }
            panel.append(history);
            for (const [label, target, show] of [['Previous evidence page', Math.max(0, offset - delivery.limit), offset > 0],
              ['Next evidence page', offset + delivery.limit, offset + delivery.limit < Math.max(delivery.total, delivery.history.total)]]) {
              if (!show) continue;
              const button = document.createElement('button');
              button.type = 'button';
              button.textContent = label;
              button.onclick = async () => {
                button.disabled = true;
                try { await renderDelivery(target); panel.querySelector('h5').focus(); }
                catch (error) { if (active()) status.textContent = error.message; }
                finally { button.disabled = false; }
              };
              panel.append(button);
            }
          };
          await renderDelivery();
          return;
        }
        for (const bid of result.data) {
          const form = document.createElement('form');
          form.innerHTML = `<p>Bid version ${bid.version} · Zero price · ${bid.turnaroundHours} hours · ${escapeHtml(bid.status)}</p>
            <p>Prerequisites ${escapeHtml(bid.prerequisites)}</p><p>Assumptions ${escapeHtml(bid.assumptions)}</p>`;
          if (bid.status === 'submitted') {
            const hire = entry.buyer === actor;
            form.insertAdjacentHTML('beforeend', `<button type="submit">${hire ? 'Accept these terms and hire' : 'Withdraw bid'}</button>`);
            wire(form, async () => {
              const listingPath = `listings/${encodeURIComponent(entry.id)}`;
              if (hire) await request(`${listingPath}/hire`, { bidId: bid.id, bidVersion: bid.version,
                listingVersion: entry.version, digest: bid.consent.digest });
              else await request(`${listingPath}/bids`, { action: 'withdraw', version: bid.version });
              await loadMarketplaceBeta(catalogOffset, listingOffset);
            });
          }
          offers.append(form);
        }
        if (entry.status === 'open' && entry.buyer !== actor && catalog.ownProfiles.some(profile => profile.eligible)) {
          const form = document.createElement('form');
          form.innerHTML = `<h5>Submit your zero-price bid</h5>
            <label>Specialist agent <select name="agent" required></select></label>
            <label>Turnaround in hours <input name="turnaroundHours" type="number" min="1" required></label>
            <label>Offer expiry <input name="expiresAt" type="datetime-local" required></label>
            <label>Prerequisites <textarea name="prerequisites" required></textarea></label>
            <label>Assumptions <textarea name="assumptions" required></textarea></label>
            <button type="submit">Submit and accept listing terms</button>`;
          const available = roster.flatMap(agent => catalog.ownProfiles.filter(profile => profile.eligible && profile.agentDid === agent.identity_ref)
            .map(profile => ({ agent, profile })));
          form.elements.agent.replaceChildren(...available.map(({ agent }, index) => new Option(agent.display_name, index)));
          form.querySelector('button').disabled = !available.length;
          wire(form, async values => {
            const choice = available[Number(values.get('agent'))];
            const body = Object.fromEntries(values);
            await request(`listings/${encodeURIComponent(entry.id)}/bids`, { ...body, action: 'submit', amount: '0',
              version: result.data[0]?.version, listingVersion: entry.version, profileId: choice.profile.id,
              agentId: choice.agent.agent_id, turnaroundHours: Number(body.turnaroundHours), expiresAt: Date.parse(body.expiresAt) });
            await loadMarketplaceBeta(catalogOffset, listingOffset);
          });
          offers.append(form);
        }
        for (const [label, target, disabled] of [
          ['Previous bids', Math.max(0, result.offset - result.limit), result.offset === 0],
          ['Next bids', result.offset + result.limit, result.offset + result.data.length >= result.total],
        ]) {
          if (disabled) continue;
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = label;
          button.onclick = async () => {
            button.disabled = true;
            offers.dataset.offset = String(target);
            await review.onclick();
            review.focus();
          };
          offers.append(button);
        }
      } catch (error) { if (active()) status.textContent = error.message; }
      finally { review.disabled = false; }
    };
  });
}
window.switchView = function(view) {
  if (!VIEWS.includes(view)) return;
  VIEWS.forEach(v => {
    const el = document.getElementById('view-' + v);
    if (el) {
      el.style.display = v === view ? '' : 'none';
    }
  });
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  if (view === 'marketplace') void pollLobbyDetails().then(() => loadMarketplaceBeta());
};



document.addEventListener('DOMContentLoaded', init);
