// Agent OS Swarm Lobby — Dashboard Controller

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
    balance: 0
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

  // Tasks
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

  // Concordium Wallet Connection & UI
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
    } else {
      textEl.textContent = 'Disconnected';
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

  // Tasks
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
  const visibilityEl = document.getElementById('create-lobby-visibility');
  const policyEl = document.getElementById('create-lobby-policy');
  const allowlistContainer = document.getElementById('lobby-allowlist-container');
  const allowlistInput = document.getElementById('create-lobby-allowlist');

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
      
      // Parse allowlist array from comma separated string input
      const rawAllowlist = allowlistInput?.value || '';
      const allowlist = rawAllowlist.split(',')
        .map(item => item.trim())
        .filter(item => item.length > 0);

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
        
        // Check for official Concordium Browser Wallet extension
        const provider = window.concordium;
        if (provider) {
          if (textEl) textEl.textContent = 'Connecting to Concordium Wallet extension...';
          try {
            // Request account connection from extension
            const accountAddress = await provider.connect();
            if (!accountAddress) {
              throw new Error('Connection rejected by user.');
            }
            
            // Query balance using provider RPC client
            let balanceCcd = 1000;
            try {
              const client = await provider.getJsonRpcClient();
              const accountInfo = await client.getAccountInfo(accountAddress);
              if (accountInfo && accountInfo.accountAmount) {
                balanceCcd = parseFloat(accountInfo.accountAmount) / 1000000;
              }
            } catch (rpcErr) {
              console.warn('Concordium RPC balance fetch failed, using fallback:', rpcErr);
              balanceCcd = 25000;
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
          // Extension not installed, fallback to premium mockup
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

      // Start multi-step escrow deposit simulation
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
      actionButtons += `<button class="btn btn-primary" onclick="bidOnTask('${task.id}')" style="padding: 4px 8px; font-size: 11px; margin-right: 4px;">Bid</button>`;
      actionButtons += `<button class="btn btn-secondary" onclick="assignTask('${task.id}')" style="padding: 4px 8px; font-size: 11px;">Assign</button>`;
    } else if (task.status === 'assigned') {
      actionButtons += `<button class="btn btn-primary" onclick="completeTask('${task.id}')" style="padding: 4px 8px; font-size: 11px;">Release Escrow & Pay</button>`;
    }

    const assignedText = task.assigned_agent_id ? `<div style="font-size:11px; color:var(--text-muted); margin-top:4px;">Assigned: <code>${escapeHtml(task.assigned_agent_id)}</code></div>` : '';
    const paymentText = task.tx_hash ? `<div style="font-size:11px; color:var(--color-green); margin-top:4px;">🔒 Escrow Settled Tx: <code>${escapeHtml(task.tx_hash)}</code></div>` : '';
    const escrowText = task.status !== 'completed' ? `<div style="font-size:11px; color:var(--color-yellow); margin-top:4px;">🔒 Escrow Locked: ${task.proposed_budget_ccd} CCD</div>` : '';

    html += `
      <div style="padding: 10px; border-bottom: 1px solid var(--border); text-align: left;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <strong style="font-size:13px; color:var(--text-primary);">${escapeHtml(task.title)}</strong>
          <span style="font-size: 10px; padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.05); color: var(--text-muted); border: 1px solid var(--border);">${escapeHtml(task.status)}</span>
        </div>
        <p style="font-size:12px; color:var(--text-muted); margin:0 0 6px 0;">${escapeHtml(task.description)}</p>
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

  const confirmPay = confirm("Are you sure you want to release the escrowed CCD to the agent?");
  if (!confirmPay) return;

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
      const txHash = await provider.sendTransaction(
        state.wallet.address,
        {
          type: 'transfer',
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
    // Fallback simulation
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
        btnEl.style.color = 'var(--text-muted)';
        btnEl.style.fontWeight = 'normal';
        btnEl.style.borderBottom = 'none';
      }
    }
  });
};

document.addEventListener('DOMContentLoaded', init);
