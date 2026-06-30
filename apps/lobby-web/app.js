// Agent OS Swarm Lobby — Dashboard Controller

const state = {
  lobbies: [],
  activeLobbyId: null,
  agents: [],
  messages: [],
  events: [],
  stats: {
    connected_users: 0,
    connected_agents: 0,
    verified_agents: 0,
    total_lobbies: 0,
    public_lobbies: 0,
    private_lobbies: 0
  }
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
    return `
      <div class="agent-card-item">
        <div class="agent-card-header">
          <span class="agent-name">${escapeHtml(agent.display_name)}</span>
          <span class="agent-status-indicator ${isWorking ? 'working' : 'idle'}">${escapeHtml(agent.status)}</span>
        </div>
        <div class="agent-role-badge">${escapeHtml(agent.agent_role || 'Generalist')}</div>
        
        <div class="agent-meta-row">
          <div><span class="agent-meta-label">Agent ID:</span></div>
          <div class="agent-meta-val" title="${escapeHtml(agent.agent_id)}">${escapeHtml(agent.agent_id.slice(0, 8))}...</div>
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

  // Show latest messages first or scroll to bottom
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
  
  // Auto-scroll to bottom of messages container
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
    
    // Auto-select active default lobby if none is selected
    if (!state.activeLobbyId && state.lobbies.length > 0) {
      // Prefer active/public one if available
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
  
  // Roster
  const rosterData = await fetchJson(`/api/v1/agent-lobby/lobbies/${id}/roster`);
  if (rosterData && id === state.activeLobbyId) {
    state.agents = rosterData.agents || [];
    renderRoster();
  }

  // Messages
  const msgData = await fetchJson(`/api/v1/agent-lobby/lobbies/${id}/messages`);
  if (msgData && id === state.activeLobbyId) {
    state.messages = msgData.messages || [];
    renderMessages();
  }

  // Events
  const eventData = await fetchJson(`/api/v1/agent-lobby/lobbies/${id}/events`);
  if (eventData && id === state.activeLobbyId) {
    state.events = eventData.events || [];
    renderEvents();
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

// ── Init ──

function init() {
  pollLobbies();
  pollStats();
  
  // Poll lobbies list every 5 seconds
  setInterval(pollLobbies, 5000);

  // Poll stats every 2 seconds
  setInterval(pollStats, 2000);
  
  // Poll selected lobby details every 2 seconds
  setInterval(() => {
    if (state.activeLobbyId) pollLobbyDetails();
  }, 2000);

  // Wire up Create Lobby button
  const btnCreateLobby = document.getElementById('btn-create-lobby');
  if (btnCreateLobby) {
    btnCreateLobby.addEventListener('click', async () => {
      const nameEl = document.getElementById('create-lobby-name');
      const visibilityEl = document.getElementById('create-lobby-visibility');
      const policyEl = document.getElementById('create-lobby-policy');
      const name = nameEl?.value?.trim();
      if (!name) {
        alert('Please enter a lobby name.');
        return;
      }
      const visibility = visibilityEl?.value || 'public';
      const policy = policyEl?.value || 'none';

      const res = await postJson('/api/v1/agent-lobby/lobbies', {
        name,
        visibility,
        join_policy: policy,
        created_by: 'web-user'
      });

      if (res && res.lobby) {
        if (nameEl) nameEl.value = '';
        await pollLobbies();
        selectLobby(res.lobby.lobby_id);
      } else {
        alert('Failed to create lobby.');
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
}

document.addEventListener('DOMContentLoaded', init);
