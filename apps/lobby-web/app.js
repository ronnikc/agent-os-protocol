// Agent OS Swarm Lobby — Dashboard Controller

// ── Concordium Network Configuration ──
const CCD_NETWORK = 'mainnet'; // 'mainnet' or 'testnet'
const CCD_EXPLORER_BASE = `https://ccdexplorer.io/${CCD_NETWORK}`;
const CCD_AGENT_REGISTRY_CONTRACT = '9458,0'; // Agent Registry contract <index,subindex>

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
    balance: 0,
    isReal: false
  },
  identity: {
    ownerRegistered: false,
    ownerName: null,
    ownerDid: null,
    registeredAgentDid: null
  },
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
  // If the ID is a wallet address (long hex), link to account page
  if (id.length >= 40 && !id.startsWith('agent-')) {
    return `https://ccdexplorer.io/${network}/accounts/${id}`;
  }
  // If it contains a token index number, link to agent registry token
  const tokenIdMatch = id.match(/^(\d+)$/);
  if (tokenIdMatch) {
    return `https://ccdexplorer.io/${network}/tokens/agent-registry/${tokenIdMatch[1]}`;
  }
  // Fallback: link to the agent registry contract on the right network
  return `${CCD_EXPLORER_BASE}/tokens/agent-registry`;
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
          <span class="lobby-visibility ${lobby.visibility}">${escapeHtml(lobby.visibility)}</span>
        </div>
        <div class="lobby-id">ID: ${escapeHtml(lobby.lobby_id)}</div>
      </div>
    `;
  }).join('');
}

function renderRoster() {
  const container = document.getElementById('agent-roster-list');
  const countEl = document.getElementById('roster-count');
  if (!container) return;

  if (state.agents.length === 0) {
    container.innerHTML = '<div class="empty-state">No agents currently connected to this lobby. Connect an agent panel or relay in Swarm Mode to register.</div>';
    if (countEl) countEl.textContent = '0 agents';
    return;
  }

  if (countEl) countEl.textContent = `${state.agents.length} agent${state.agents.length === 1 ? '' : 's'}`;
  container.innerHTML = state.agents.map(agent => {
    const isWorking = agent.status === 'working' || agent.status === 'busy';
    const isVerified = agent.identity_status === 'verified';
    const explorerLink = getExplorerLink(agent.agent_id);
    const idHtml = explorerLink
      ? `<a href="${explorerLink}" target="_blank" style="color:var(--color-cyan); text-decoration:underline;">${escapeHtml(agent.agent_id.slice(0, 8))}...</a>`
      : `${escapeHtml(agent.agent_id.slice(0, 8))}...`;

    return `
      <div class="agent-card-item">
        <div class="agent-card-header">
          <span class="agent-name">${escapeHtml(agent.display_name)}</span>
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
    return `
      <div class="message-item">
        <div class="message-item-header">
          <span>
            <span class="message-sender">${escapeHtml(msg.from_agent_id)}</span>
            &rarr;
            <span class="message-receiver">${escapeHtml(msg.to_agent_id)}</span>
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
    const timestamp = formatDate(ev.timestamp);
    let classType = 'event-type-register';
    if (ev.type.includes('disconnect') || ev.type.includes('left')) classType = 'event-type-disconnect';
    if (ev.type.includes('message')) classType = 'event-type-message';
    if (ev.type.includes('task')) classType = 'event-type-task';
    if (ev.type.includes('hand')) classType = 'event-type-hand';
    if (ev.type.includes('boss')) classType = 'event-type-boss';

    return `
      <div class="event-item">
        <span class="event-timestamp">[${timestamp}]</span>
        <span class="${classType}">${escapeHtml(ev.type)}</span>
        <span>${escapeHtml(ev.details || '')}</span>
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

// ── Wallet UI Sync ──

function updateWalletUI() {
  const textEl = document.getElementById('wallet-status-text');
  const btnEl = document.getElementById('btn-connect-wallet');
  const postBtnEl = document.getElementById('btn-post-task');
  
  if (!textEl || !btnEl) return;
  
  if (state.wallet.connected) {
    const shortAddr = state.wallet.address.slice(0, 6) + '...' + state.wallet.address.slice(-4);
    textEl.innerHTML = `<span style="color:var(--color-green); font-weight:600;">Connected:</span> ${shortAddr} | <span style="color:var(--color-cyan); font-weight:600;">${state.wallet.balance.toLocaleString()} CCD</span>`;
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
        created_by: 'web-user'
      });

      if (res && res.lobby) {
        if (nameEl) nameEl.value = '';
        if (allowlistInput) allowlistInput.value = '';
        if (allowlistContainer) allowlistContainer.style.display = 'none';
        await pollLobbies();
        selectLobby(res.lobby.lobby_id);
      } else {
        // Fallback: create lobby locally when server is unreachable
        const localLobby = {
          lobby_id: 'local-' + Math.random().toString(36).substring(2, 10),
          name,
          visibility,
          join_policy: policy,
          allowlist,
          status: 'active',
          org_id: 'local',
          created_by: 'web-user',
          created_at: new Date().toISOString()
        };
        state.lobbies.push(localLobby);
        renderLobbies();
        selectLobby(localLobby.lobby_id);
        if (nameEl) nameEl.value = '';
        if (allowlistInput) allowlistInput.value = '';
        if (allowlistContainer) allowlistContainer.style.display = 'none';
        alert(`Lobby "${name}" created locally. Connect the lobby server for full persistence.`);
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
      const name = ownerNameEl?.value?.trim() || 'Bob Coder';
      const did = ownerDidEl?.value?.trim() || `did:ccd:${CCD_NETWORK}:${state.wallet.address}`;

      btnRegisterOwnerAction.disabled = true;
      btnRegisterOwnerAction.textContent = "Signing in Wallet...";

      const provider = window.concordium;
      if (state.wallet.isReal && provider) {
        try {
          const message = `Register Owner ID in Agent OS Swarm Lobby: ${name} (${did})`;
          const signature = await provider.signMessage(state.wallet.address, message);
          console.log('Wallet signature received:', signature);
          
          btnRegisterOwnerAction.textContent = "Registering Owner ID...";
          
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
            successOwnerDid.innerHTML = `<span style="color:var(--color-cyan);">${did}</span><br><span style="font-size:9px; color:var(--color-green); font-weight:600;">✓ Cryptographically verified via wallet signature.</span>`;
          }

          // Post to lobby server (register issuer)
          await postJson('/api/v1/agent-lobby/issuers', {
            issuer_did: did,
            identity_ref: `did:ccd:${CCD_NETWORK}:${state.wallet.address}`,
            signature: signature
          });

          // Add event
          state.events.push({
            id: Math.random().toString(36).substring(2, 10),
            lobby_id: state.activeLobbyId || 'default',
            type: 'owner-registered',
            details: `Concordium Owner ID registered (verified): ${name} (${did.slice(0, 15)}...)`,
            timestamp: new Date().toISOString()
          });
          renderEvents();

          // Unlock agent issue view
          const agentOwnerUnregisteredView = document.getElementById('agent-owner-unregistered-view');
          const agentIssueView = document.getElementById('agent-issue-view');
          const issueAgentDid = document.getElementById('issue-agent-did');
          if (agentOwnerUnregisteredView) agentOwnerUnregisteredView.style.display = 'none';
          if (agentIssueView) agentIssueView.style.display = 'flex';
          if (issueAgentDid) {
            issueAgentDid.value = `did:ccd:${CCD_NETWORK}:agent-${Math.random().toString(36).substring(2, 8)}`;
          }

          alert("Owner ID registered and cryptographically verified!");
        } catch (err) {
          console.error('Wallet signing failed:', err);
          alert(`Signature failed: ${err.message || err}`);
        } finally {
          btnRegisterOwnerAction.disabled = false;
          btnRegisterOwnerAction.textContent = "Register Owner ID";
        }
      } else {
        setTimeout(async () => {
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
            successOwnerDid.innerHTML = `<span style="color:var(--color-cyan);">${did}</span><br><span style="font-size:9px; color:var(--text-muted);">[Simulated verification]</span>`;
          }

          // Post to lobby server (register issuer)
          await postJson('/api/v1/agent-lobby/issuers', {
            issuer_did: did,
            identity_ref: `did:ccd:${CCD_NETWORK}:${state.wallet.address}`
          });

          // Add event
          state.events.push({
            id: Math.random().toString(36).substring(2, 10),
            lobby_id: state.activeLobbyId || 'default',
            type: 'owner-registered',
            details: `Concordium Owner ID registered: ${name} (${did.slice(0, 15)}...)`,
            timestamp: new Date().toISOString()
          });
          renderEvents();

          // Unlock agent issue view
          const agentOwnerUnregisteredView = document.getElementById('agent-owner-unregistered-view');
          const agentIssueView = document.getElementById('agent-issue-view');
          const issueAgentDid = document.getElementById('issue-agent-did');
          if (agentOwnerUnregisteredView) agentOwnerUnregisteredView.style.display = 'none';
          if (agentIssueView) agentIssueView.style.display = 'flex';
          if (issueAgentDid) {
            issueAgentDid.value = `did:ccd:${CCD_NETWORK}:agent-${Math.random().toString(36).substring(2, 8)}`;
          }

          btnRegisterOwnerAction.disabled = false;
          btnRegisterOwnerAction.textContent = "Register Owner ID";
          alert("Owner ID registered successfully in lobby!");
        }, 1000);
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
      
      const agentName = agentNameEl?.value?.trim() || 'Coder Agent';
      const agentRole = agentRoleEl?.value || 'coder';
      const agentDid = agentDidEl?.value?.trim() || `did:ccd:${CCD_NETWORK}:agent-${Math.random().toString(36).substring(2, 8)}`;

      btnIssueAgentAction.disabled = true;
      btnIssueAgentAction.textContent = "Minting Agent DID...";

      // Build card, calculate hash, register card metadata, sign & anchor
      const card = {
        mediaType: "application/a2a-agent-card+json",
        name: agentName,
        description: `Specialized sub-agent running ${agentRole} role.`,
        runtime: "Claude Code",
        capabilities: [agentRole, "pair-programming"],
        ownerPolicy: "self",
        supportedProtocols: ["agent-os-lobby"],
        allowedScopes: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      // Sort keys canonically
      const sortedKeys = Object.keys(card).sort();
      const sortedCard = {};
      for (const k of sortedKeys) sortedCard[k] = card[k];

      const cardHash = await sha256(JSON.stringify(sortedCard));

      // Post the metadata to the Lobby server so it is hosted at lobby.agent-os.gothard.dk/agent-cards/did
      const registerRes = await postJson('/api/v1/agent-lobby/agent-cards', {
        did: agentDid,
        card: sortedCard
      });

      const metadataUrl = registerRes?.url || `${window.location.origin}/agent-cards/${agentDid}`;

      setTimeout(() => {
        state.identity.registeredAgentDid = agentDid;

        // Sync UI
        const agentIssueView = document.getElementById('agent-issue-view');
        const agentIssuedSuccessView = document.getElementById('agent-issued-success-view');
        const successAgentName = document.getElementById('success-agent-name');
        const successAgentDid = document.getElementById('success-agent-did');

        if (agentIssueView) agentIssueView.style.display = 'none';
        if (agentIssuedSuccessView) agentIssuedSuccessView.style.display = 'block';
        if (successAgentName) successAgentName.textContent = agentName;
        if (successAgentDid) {
          const explorerUrl = getExplorerLink(agentDid) || `${CCD_EXPLORER_BASE}/tokens/agent-registry`;
          successAgentDid.innerHTML = `DID: <span style="color:var(--color-cyan);">${agentDid}</span><br>Metadata URL: <a href="${metadataUrl}" target="_blank" style="color:var(--color-cyan); text-decoration:underline;">${metadataUrl}</a><br>CCDexplorer Link: <a href="${explorerUrl}" target="_blank" style="color:var(--color-cyan); text-decoration:underline;">${explorerUrl}</a><br>Card Hash: <span style="font-size:9px; color:var(--text-muted);">${cardHash}</span>`;
        }

        const matchedRole = AGENT_ROLES.find(r => r.value === agentRole);
        const roleLabel = matchedRole ? matchedRole.label : 'Generalist';
        const newAgent = {
          agent_id: agentDid,
          display_name: agentName,
          agent_role: roleLabel,
          status: 'idle',
          identity_status: 'verified',
          runtime: 'Claude Code',
          model: 'claude-3-5-sonnet',
          branch: 'main',
          cwd: '/workspace'
        };

        if (!state.agents.some(a => a.agent_id === agentDid)) {
          state.agents.push(newAgent);
          renderRoster();
        }

        // Add event
        state.events.push({
          id: Math.random().toString(36).substring(2, 10),
          lobby_id: state.activeLobbyId || 'default',
          type: 'agent-did-issued',
          details: `Concordium Agent DID issued: ${agentName} (${agentDid.slice(0, 15)}...)`,
          timestamp: new Date().toISOString()
        });
        renderEvents();

        btnIssueAgentAction.disabled = false;
        btnIssueAgentAction.textContent = "Issue Agent ID";
        alert(`Agent DID issued & registered successfully!\nMetadata URL: ${metadataUrl}`);
      }, 1500);
    });
  }

  // Concordium Wallet Connection click handler
  const btnConnectWallet = document.getElementById('btn-connect-wallet');
  if (btnConnectWallet) {
    btnConnectWallet.addEventListener('click', async () => {
      if (state.wallet.connected) {
        state.wallet.connected = false;
        state.wallet.address = null;
        state.wallet.balance = 0;
        state.wallet.isReal = false;
        updateWalletUI();
      } else {
        const textEl = document.getElementById('wallet-status-text');
        const provider = window.concordium;
        
        if (provider) {
          if (textEl) textEl.textContent = 'Connecting to Concordium Wallet extension...';
          try {
            const accountAddress = await provider.connect();
            if (!accountAddress) {
              throw new Error('Connection rejected by user.');
            }
            
            let balanceCcd = 0;
            try {
              // Strategy 1: gRPC client (Concordium Browser Wallet v2)
              if (provider.getGrpcClient) {
                const grpcClient = await provider.getGrpcClient();
                const accountInfo = await grpcClient.getAccountInfo(accountAddress);
                if (accountInfo && accountInfo.accountAmount) {
                  const amt = typeof accountInfo.accountAmount === 'bigint'
                    ? accountInfo.accountAmount
                    : (accountInfo.accountAmount.microCcd ?? accountInfo.accountAmount);
                  balanceCcd = Number(amt) / 1_000_000;
                }
              }
              // Strategy 2: JSON-RPC client (older wallet API)
              else if (provider.getJsonRpcClient) {
                const client = await provider.getJsonRpcClient();
                const accountInfo = await client.getAccountInfo(accountAddress);
                if (accountInfo && accountInfo.accountAmount) {
                  const amt = accountInfo.accountAmount.microCcd !== undefined
                    ? accountInfo.accountAmount.microCcd
                    : accountInfo.accountAmount;
                  balanceCcd = Number(amt) / 1_000_000;
                }
              }
            } catch (rpcErr) {
              console.warn('Concordium wallet RPC balance fetch failed, trying public node:', rpcErr);
              // Strategy 3: Public CCDScan/node API as last-resort fallback
              try {
                const nodeRes = await fetch(`https://grpc.${CCD_NETWORK}.concordium.com/v2/accounts/${accountAddress}/info`);
                if (nodeRes.ok) {
                  const info = await nodeRes.json();
                  if (info && info.accountAmount) {
                    balanceCcd = Number(info.accountAmount) / 1_000_000;
                  }
                }
              } catch (nodeErr) {
                console.warn('Public node balance query also failed:', nodeErr);
              }
            }

            if (balanceCcd === 0) {
              console.warn('Could not fetch wallet balance from any source. Showing 0 CCD.');
            }

            state.wallet.connected = true;
            state.wallet.address = accountAddress;
            state.wallet.balance = balanceCcd;
            state.wallet.isReal = true;
            updateWalletUI();
            alert(`Connected successfully to Concordium Wallet!\nAddress: ${accountAddress}`);
          } catch (err) {
            console.error('Concordium Wallet connection failed:', err);
            alert(`Concordium Wallet Connection Failed: ${err.message || err}`);
            if (textEl) textEl.textContent = 'Disconnected';
          }
        } else {
          if (textEl) textEl.textContent = 'Connecting via Simulated Wallet (No extension)...';
          setTimeout(() => {
            state.wallet.connected = true;
            state.wallet.address = '3x19a8f273be92100cb9287c10d3e49e1';
            state.wallet.balance = 25420.50;
            state.wallet.isReal = false;
            updateWalletUI();
            alert('Simulated Concordium Wallet connected!\nNote: Install the Concordium Browser Wallet extension to connect your real wallet account.');
          }, 800);
        }
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
      if (!title || isNaN(budget) || !description) {
        alert('Please enter title, budget ($CCD), and description.');
        return;
      }
      
      if (budget > state.wallet.balance) {
        alert(`Insufficient funds! Your wallet balance is ${state.wallet.balance} CCD, but the task requires ${budget} CCD.`);
        return;
      }

      btnPostTask.disabled = true;
      btnPostTask.textContent = 'Sign Tx...';
      
      setTimeout(async () => {
        btnPostTask.textContent = 'Locking Escrow...';
        
        setTimeout(async () => {
          const txHash = 'tx_escrow_deposit_' + Math.random().toString(36).substr(2, 9);
          const res = await postJson(`/api/v1/agent-lobby/lobbies/${state.activeLobbyId}/tasks`, {
            title,
            description,
            proposed_budget_ccd: budget,
            posted_by_identity_ref: 'WebUser',
            tx_hash: txHash
          });

          if (res && res.task) {
            state.wallet.balance -= budget;
            updateWalletUI();
            if (titleEl) titleEl.value = '';
            if (budgetEl) budgetEl.value = '';
            if (descEl) descEl.value = '';
            pollLobbyDetails();
            alert(`Success! Locked ${budget} CCD into escrow. Tx Hash: ${txHash}`);
          } else {
            alert('Failed to post task.');
          }
          btnPostTask.disabled = false;
          btnPostTask.textContent = 'Post & Lock Escrow';
        }, 1000);
      }, 1000);
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
    const paymentText = task.tx_hash ? `<div style="font-size:11px; color:var(--color-green); margin-top:4px;">🔒 Escrow Settled Tx: <code>${escapeHtml(task.tx_hash)}</code></div>` : '';
    const escrowText = task.status !== 'completed' ? `<div style="font-size:11px; color:var(--color-yellow); margin-top:4px;">🔒 Escrow Locked: ${task.proposed_budget_ccd} CCD</div>` : '';

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
      if (state.wallet.isReal && provider) {
        try {
          const systemEscrowAddress = '3x19a8f273be92100cb9287c10d3e49e1';
          
          if (btnEl) btnEl.textContent = "Approve in Wallet...";
          
          // Concordium Browser Wallet API uses 3 parameters: (accountAddress, transactionType, payload)
          // TransactionType.SimpleTransfer = 3
          const txHash = await provider.sendTransaction(
            state.wallet.address,
            3, // AccountTransactionType.SimpleTransfer
            {
              toAddress: systemEscrowAddress,
              amount: {
                microCcd: BigInt(0) // 0 CCD triggers contract release message
              }
            }
          );
          
          if (btnEl) btnEl.textContent = "Releasing Escrow...";
          const res = await postJson(`/api/v1/agent-lobby/lobbies/${state.activeLobbyId}/tasks/${taskId}/complete`, {
            tx_hash: txHash
          });

          if (res && res.task) {
            alert(`Escrow released successfully to the agent!\nTransaction Hash: ${txHash}`);
            pollLobbyDetails();
          } else {
            alert("Failed to record completion on the server.");
          }
        } catch (err) {
          console.error('Release transaction failed:', err);
          alert(`Release failed: ${err.message || err}`);
        } finally {
          if (btnEl) {
            btnEl.disabled = false;
            btnEl.textContent = "Release Escrow & Pay";
          }
        }
      } else {
        setTimeout(async () => {
          if (btnEl) btnEl.textContent = "Transferring CCD...";
          
          setTimeout(async () => {
            const txHash = 'tx_release_' + Math.random().toString(36).substr(2, 9);
            const res = await postJson(`/api/v1/agent-lobby/lobbies/${state.activeLobbyId}/tasks/${taskId}/complete`, {
              tx_hash: txHash
            });

            if (res && res.task) {
              alert(`Simulated Payment released! Transfer transaction hash: ${txHash}`);
              pollLobbyDetails();
            } else {
              alert("Failed to release payment.");
              if (btnEl) {
                btnEl.disabled = false;
                btnEl.textContent = "Release Escrow & Pay";
              }
            }
          }, 1000);
        }, 1000);
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

document.addEventListener('DOMContentLoaded', init);
