/**
 * Agents Tab — Agent management (start/stop, presets, bulk operations)
 * Refactored from original index.html inline JS.
 */
import { state, fetchJson, postJson, registerTab, escapeHtml, showModal, closeModal, showAlert, showConfirm, signInToLobby, showIdentitySuccessModal } from '../app.js';

let selected = new Set();
let lobbyMode = 'local';

function getIdentityBadge(status) {
  const map = {
    human_linked: ['badge-identity-human', 'Human-linked'],
    org_linked: ['badge-identity-org', 'Org-verified'],
    registry_verified: ['badge-identity-verified', 'Registered'],
    pending: ['badge-identity-pending', 'Pending'],
    // An Agent ID is persisted but the agent is offline, so it hasn't been live-verified against the
    // Concordium registry yet (that happens when it connects). Neutral — not a failure like Unverified.
    configured: ['badge-identity-verified', 'Verified'],
    failed: ['badge-identity-failed', 'Failed'],
    unverified: ['badge-identity-unverified', 'Unverified']
  };
  const entry = map[status] || ['badge-identity-unverified', 'Unverified'];
  const [cls, label] = entry;
  return `<span class="badge ${cls}">${label}</span>`;
}

/**
 * Choose the identity badge: a live verified state (from the connected lobby) wins; otherwise, if the
 * agent has a persisted DID it reads "ID set" (verifies when it connects), not the misleading
 * "Unverified" which is reserved for agents with no identity at all.
 */
function identityBadgeFor(agent) {
  const s = agent.identity_status;
  if (s && s !== 'unverified') return getIdentityBadge(s);
  if (agent.identity) return `<span title="Agent ID configured; it is verified against the Concordium registry when the agent connects to the lobby.">${getIdentityBadge('configured')}</span>`;
  return getIdentityBadge('unverified');
}

function getActivityIndicator(status) {
  if (status === 'running') {
    return `<div style="display:flex;align-items:center;gap:3px;height:12px;" title="Active">
      <div style="width:2px;height:6px;background:var(--color-cyan);animation:act-pulse 0.6s infinite alternate;"></div>
      <div style="width:2px;height:12px;background:var(--color-cyan);animation:act-pulse 0.6s infinite alternate 0.2s;"></div>
      <div style="width:2px;height:8px;background:var(--color-cyan);animation:act-pulse 0.6s infinite alternate 0.4s;"></div>
    </div>`;
  }
  return `<span style="color:var(--color-text-soft)">—</span>`;
}

function shortDid(did) {
  if (!did) return '';
  // did:ccd:testnet:abcd…wxyz — keep the network + head/tail of the id.
  return did.length > 28 ? `${did.slice(0, 20)}…${did.slice(-6)}` : did;
}

function renderAgents() {
  const el = document.getElementById('agentList');
  if (!el) return;
  el.innerHTML = state.agents.map(a => {
    const checked = selected.has(a.slug) ? 'checked' : '';
    const statusClass = `status-${a.status}`;
    const isRunning = a.status === 'running';
    const hasDid = !!a.identity;
    const didCell = hasDid
      ? `<div style="font-family:var(--mono);font-size:10px;color:var(--color-text-soft);margin-top:3px;" title="${escapeHtml(a.identity)}">${escapeHtml(shortDid(a.identity))}</div>`
      : '';
    const idBtn = hasDid
      ? `<button class="btn btn-sm" data-action="create-id" data-slug="${a.slug}" title="Mint a NEW on-chain Agent ID (sponsored) and bind it to this agent">Re-mint ID</button>
         <button class="btn btn-sm" data-action="set-id" data-slug="${a.slug}" title="Change the Agent ID (DID) this agent connects with (enter an existing DID)">Change ID</button>
         <button class="btn btn-sm" data-action="revoke-id" data-slug="${a.slug}" title="Remove the persisted Agent ID">Revoke</button>`
      : `<button class="btn btn-primary btn-sm" data-action="create-id" data-slug="${a.slug}" title="Mint a new on-chain Agent ID (sponsored, gasless) and bind it to this agent">Create ID</button>
         <button class="btn btn-sm" data-action="set-id" data-slug="${a.slug}" title="Enter an existing Agent ID (DID) manually">Set ID</button>`;
    return `<tr>
      <td><input type="checkbox" ${checked} data-slug="${a.slug}" /></td>
      <td><strong>${escapeHtml(a.name)}</strong></td>
      <td class="scope" title="${escapeHtml(a.scope)}">${escapeHtml(a.scope)}</td>
      <td>${identityBadgeFor(a)}${didCell}</td>
      <td><span class="status-dot ${statusClass}"></span>${a.status}</td>
      <td>${getActivityIndicator(a.status)}</td>
      <td><span style="font-family:var(--mono);font-size:11px;">${escapeHtml(a.runtime || '—')}</span></td>
      <td><span style="font-family:var(--mono);font-size:11px;">${escapeHtml(a.model || '—')}</span></td>
      <td><div style="display:flex;gap:4px;flex-wrap:wrap;">${isRunning
        ? `<button class="btn btn-danger btn-sm" data-action="stop" data-slug="${a.slug}">Stop</button>`
        : `<button class="btn btn-primary btn-sm" data-action="start" data-slug="${a.slug}">Start</button>`
      }${idBtn}</div></td>
    </tr>`;
  }).join('');
}

function updateStartBtn() {
  const btn = document.getElementById('startSelected');
  if (btn) {
    btn.textContent = `Start Selected (${selected.size})`;
    btn.disabled = selected.size === 0;
  }
}



function handleLaunchError(error, slug) {
  const errMsg = String(error);
  if (errMsg.includes('not authorized') || errMsg.includes('authentication required')) {
    showConfirm(
      'Lobby Sign-In Required',
      'You are not signed in or authorized to manage this remote swarm lobby.\n\nWould you like to sign in to the lobby now using your connected Concordium wallet?',
      async () => {
        try {
          await signInToLobby();
          showAlert('Signed In', 'Successfully signed in. Retrying agent launch...');
          await startOne(slug);
        } catch (err) {
          showAlert('Sign-In Failed', err.message || String(err));
        }
      }
    );
  } else if (errMsg.includes('no provider key configured')) {
    showModal(`
      <h2>Anthropic API Key Required</h2>
      <p style="font-size:13px; color:var(--color-text-soft); line-height:1.5; margin:12px 0 16px;">
        To start hosted agents in this remote swarm, you need to configure an Anthropic API Key for this lobby.
      </p>
      <div class="form-group" style="margin-bottom:16px;">
        <label style="display:block; font-size:11px; color:var(--text-muted); margin-bottom:4px;">Anthropic API Key (sk-ant-...)</label>
        <input type="password" id="modal-provider-api-key" placeholder="sk-ant-..." style="width:100%; padding:8px 12px; background:var(--bg-elevated); border:1px solid var(--border); color:var(--text-primary); border-radius:4px; font-size:13px;" />
      </div>
      <div class="form-actions" style="margin:0; display:flex; gap:8px; justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" id="btn-save-modal-key">Save & Launch</button>
      </div>
    `);
    document.getElementById('btn-save-modal-key')?.addEventListener('click', async () => {
      const apiKey = document.getElementById('modal-provider-api-key')?.value?.trim();
      if (!apiKey) {
        showAlert('Error', 'Please enter your Anthropic API Key.');
        return;
      }
      const res = await fetchJson('/api/lobby/remote/provider-keys', {
        method: 'POST',
        body: JSON.stringify({ provider: 'anthropic', api_key: apiKey })
      });
      if (res && !res.error) {
        closeModal();
        showAlert('API Key Saved', 'Key saved successfully. Launching agent...');
        await startOne(slug);
      } else {
        showAlert('Failed to Save Key', res?.error || 'Unknown error');
      }
    });
  } else {
    showAlert('Failed to Launch Agent', errMsg);
  }
}

async function startOne(slug) {
  const agent = state.agents.find(a => a.slug === slug);
  const agentRef = agent?.identity || undefined;

  if (lobbyMode === 'swarm') {
    showModal(`
      <h2>Start Swarm Agent</h2>
      <p style="font-size:13px; color:var(--color-text-soft); margin-bottom:16px;">
        Choose the LLM provider and model to run this agent:
      </p>
      <div class="form-group" style="margin-bottom:12px;">
        <label style="display:block; font-size:11px; color:var(--text-muted); margin-bottom:4px;">Provider</label>
        <select id="start-provider" style="width:100%; padding:8px 12px; background:var(--bg-elevated); border:1px solid var(--border); color:var(--text-primary); border-radius:4px; font-size:13px; appearance:auto;">
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
          <option value="openai-compatible">OpenAI Compatible</option>
        </select>
      </div>
      <div class="form-group" style="margin-bottom:16px;">
        <label style="display:block; font-size:11px; color:var(--text-muted); margin-bottom:4px;">Model</label>
        <input type="text" id="start-model" value="claude-3-5-sonnet-20240620" style="width:100%; padding:8px 12px; background:var(--bg-elevated); border:1px solid var(--border); color:var(--text-primary); border-radius:4px; font-size:13px;" />
      </div>
      <div class="form-actions" style="margin:0; display:flex; gap:8px; justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" id="btn-confirm-start">Launch</button>
      </div>
    `);

    document.getElementById('start-provider')?.addEventListener('change', (e) => {
      const p = e.target.value;
      const modelInput = document.getElementById('start-model');
      if (modelInput) {
        if (p === 'anthropic') modelInput.value = 'claude-3-5-sonnet-20240620';
        else if (p === 'openai') modelInput.value = 'gpt-4o';
        else modelInput.value = '';
      }
    });

    document.getElementById('btn-confirm-start')?.addEventListener('click', async () => {
      const provider = document.getElementById('start-provider').value;
      const model = document.getElementById('start-model').value.trim();
      closeModal();

      const res = await fetchJson('/api/lobby/remote/agents/start', {
        method: 'POST',
        body: JSON.stringify({
          name: slug.charAt(0).toUpperCase() + slug.slice(1) + ' Agent',
          agent_role: slug,
          provider,
          model,
          agent_ref: agentRef
        })
      });
      if (res && res.error) {
        handleLaunchError(res.error, slug);
      } else {
        setTimeout(refresh, 500);
      }
    });
    return;
  }

  const lobbyUrl = document.getElementById('lobbyUrl')?.value || '';
  await postJson('/api/agents/start', { slug, lobbyUrl });
  setTimeout(refresh, 500);
}

async function stopOne(slug) {
  if (lobbyMode === 'swarm') {
    const roster = await fetchJson('/api/lobby/remote/agents');
    const remoteAgent = (roster?.agents || []).find(a => a.agent_role === slug && a.status !== 'disconnected');
    const agentId = remoteAgent?.agent_id || slug;

    const res = await fetchJson('/api/lobby/remote/agents/stop', {
      method: 'POST',
      body: JSON.stringify({ agent_id: agentId })
    });
    if (res && res.error) {
      showAlert('Failed to Stop Agent', res.error);
    }
  } else {
    await postJson('/api/agents/stop', { slug });
  }
  setTimeout(refresh, 500);
}

async function setId(slug) {
  const current = state.agents.find(a => a.slug === slug)?.identity || '';
  showModal(`
    <h2>Set Agent ID (DID)</h2>
    <p style="font-size:13px; color:var(--color-text-soft); line-height:1.5; margin:12px 0 16px;">
      Persist an Agent ID (DID) for <strong>${escapeHtml(slug)}</strong>. This is passed as the lobby join token on boot so the agent always connects with this identity.
    </p>
    <div class="form-group" style="margin-bottom:16px;">
      <label style="display:block; font-size:11px; color:var(--text-muted); margin-bottom:4px;">DID (did:ccd:&lt;network&gt;:&lt;id&gt;)</label>
      <input type="text" id="modal-set-agent-did" value="${escapeHtml(current)}" placeholder="did:ccd:testnet:..." style="width:100%; padding:8px 12px; background:var(--bg-elevated); border:1px solid var(--border); color:var(--text-primary); border-radius:4px; font-size:13px;" />
    </div>
    <div class="form-actions" style="margin:0; display:flex; gap:8px; justify-content:flex-end;">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="btn-save-agent-did">Save DID</button>
    </div>
  `);
  document.getElementById('btn-save-agent-did')?.addEventListener('click', async () => {
    const did = document.getElementById('modal-set-agent-did')?.value?.trim();
    if (!did) {
      showAlert('Error', 'Please enter a valid DID.');
      return;
    }
    closeModal();
    const result = await postJson('/api/agents/identity', { slug, identity: did });
    if (result && result.ok === false) {
      showAlert('Error', `Could not set Agent ID: ${result.error || 'unknown error'}`);
    } else if (result && result.restartRequired) {
      showAlert('ID Saved', 'Agent ID saved. Restart the agent (Stop then Start) for it to reconnect with the new identity.');
    }
    setTimeout(refresh, 300);
  });
}

/**
 * Mint a NEW on-chain Agent ID for this agent — the SAME sponsored, gasless flow the hosted lobby
 * uses (build a wallet-signed card → host it on the connected lobby → sponsor co-signs the CIS-8004
 * register → the wallet submits) — then persist the resulting DID to the agent def so it reconnects
 * with that identity on every boot. Registry/sponsor calls go through the panel server's proxy.
 */
async function createId(slug) {
  const agent = state.agents.find(a => a.slug === slug);
  if (!agent) return;
  const provider = window.concordium;
  if (!provider) {
    showAlert('Wallet Not Found', 'Concordium Browser Wallet not found. Install the extension and reload to mint an Agent ID.');
    return;
  }
  
  let lobbyUrl = document.getElementById('lobbyUrl')?.value?.trim();
  if (lobbyMode === 'swarm') {
    const modeData = await fetchJson('/api/mode');
    lobbyUrl = modeData?.lobbyUrl || window.AGENT_OS_LOBBY_ORIGIN || window.location.origin;
  }
  if (!lobbyUrl) {
    showAlert('Error', 'Lobby URL is not configured.');
    return;
  }

  const proceed = async () => {
    const btn = document.querySelector(`[data-action="create-id"][data-slug="${slug}"]`);
    const setBtnText = (t) => { if (btn) btn.textContent = t; };
    const orig = btn?.textContent;
    if (btn) btn.disabled = true;
    try {
      const owner = await provider.connect();
      if (!owner) throw new Error('wallet connection was rejected');
      const network = /testnet/i.test(lobbyUrl) ? 'testnet' : 'mainnet';
      const { mintAgentId } = await import('../mint-agent-id.js');
      const res = await mintAgentId({
        base: '', lobbyUrl, network, provider, owner,
        agentName: agent.name, agentRole: slug,
        onStatus: (s) => setBtnText(s.length > 22 ? s.slice(0, 20) + '…' : s),
      });
      setBtnText('Saving…');
      const saved = await postJson('/api/agents/identity', { slug, identity: res.did });
      if (saved && saved.ok === false) throw new Error(saved.error || 'could not persist the Agent ID');
      showIdentitySuccessModal(res, agent.name, owner);
    } catch (err) {
      console.error('[Agents] Create ID failed:', err);
      showAlert('Minting Failed', `Could not mint the Agent ID: ${err.message || err}`);
    } finally {
      if (btn) { btn.disabled = false; setBtnText(orig || 'Create ID'); }
      setTimeout(refresh, 300);
    }
  };

  if (agent.identity) {
    showConfirm(
      'Mint New Agent ID',
      `"${slug}" already has an Agent ID.\n\nMint a NEW one and replace it? The old DID will no longer be used.`,
      proceed
    );
  } else {
    proceed();
  }
}

async function revokeId(slug) {
  showConfirm(
    'Revoke Agent ID',
    `Remove the persisted Agent ID from "${slug}"? It will connect unverified on the next boot.`,
    async () => {
      const result = await postJson('/api/agents/identity/revoke', { slug });
      if (result && result.ok === false) {
        showAlert('Error', `Could not revoke Agent ID: ${result.error || 'unknown error'}`);
      } else if (result && result.restartRequired) {
        showAlert('ID Revoked', 'Agent ID revoked. Restart the agent (Stop then Start) to drop the identity.');
      }
      setTimeout(refresh, 300);
    }
  );
}

async function updateOverviewStats() {
  const stats = await fetchJson('/api/overview-stats');
  if (!stats) return;
  
  const onlineEl = document.getElementById('stat-online-val');
  if (onlineEl) onlineEl.textContent = `${stats.agents.online} / ${stats.agents.total}`;
  
  const tasksEl = document.getElementById('stat-tasks-val');
  if (tasksEl) tasksEl.textContent = stats.tasks.in_progress;
  
  const sprintEl = document.getElementById('stat-sprint-val');
  if (sprintEl) sprintEl.textContent = stats.sprint.active ? `${stats.sprint.progress_percent}%` : 'Inactive';
  
  const throughputEl = document.getElementById('stat-throughput-val');
  if (throughputEl) throughputEl.textContent = `${stats.throughput.tasks_per_day}`;
  
  const successEl = document.getElementById('stat-success-val');
  if (successEl) successEl.textContent = `${stats.success_rate.percent}%`;
}

async function refresh() {
  const modeData = await fetchJson('/api/mode');
  lobbyMode = modeData?.mode || 'local';

  const data = await fetchJson('/api/agents');
  if (data) {
    const localAgents = data.agents || [];
    if (lobbyMode === 'swarm') {
      const token = localStorage.getItem('agent-os-lobby-token');
      const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
      const remoteData = await fetchJson('/api/lobby/remote/agents', { headers });
      const remoteRoster = remoteData?.agents || [];

      state.agents = localAgents.map(la => {
        const activeRemote = remoteRoster.find(ra => ra.agent_role === la.slug && ra.status !== 'disconnected');
        return {
          ...la,
          status: activeRemote ? 'running' : 'stopped',
          identity_status: activeRemote?.identity_status || la.identity_status,
          runtime: activeRemote?.runtime || la.runtime,
          model: activeRemote?.model || la.model,
          identity: activeRemote?.agent_id || la.identity,
        };
      });
    } else {
      state.agents = localAgents;
    }
    renderAgents();
  }
  await updateOverviewStats();

  const pkDiv = document.getElementById('agents-provider-keys');
  if (pkDiv) {
    pkDiv.style.display = lobbyMode === 'swarm' ? 'block' : 'none';
    if (lobbyMode === 'swarm') {
      await refreshProviderKeys();
    }
  }
}

function init() {
  renderAgents();
  updateStartBtn();
  initProviderKeysLayout();

  // Delegated event handlers
  document.getElementById('agentList')?.addEventListener('change', (e) => {
    if (e.target.type === 'checkbox') {
      const slug = e.target.dataset.slug;
      if (e.target.checked) selected.add(slug); else selected.delete(slug);
      updateStartBtn();
    }
  });

  document.getElementById('agentList')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const slug = btn.dataset.slug;
    if (btn.dataset.action === 'start') startOne(slug);
    if (btn.dataset.action === 'stop') stopOne(slug);
    if (btn.dataset.action === 'set-id') setId(slug);
    if (btn.dataset.action === 'create-id') createId(slug);
    if (btn.dataset.action === 'revoke-id') revokeId(slug);
  });

  document.getElementById('startSelected')?.addEventListener('click', async () => {
    const lobbyUrl = document.getElementById('lobbyUrl')?.value || '';
    await postJson('/api/agents/start-all', { slugs: [...selected], lobbyUrl });
    setTimeout(refresh, 1000);
  });

  document.getElementById('stopAll')?.addEventListener('click', async () => {
    await postJson('/api/agents/stop-all', {});
    setTimeout(refresh, 500);
  });

  document.getElementById('selectAll')?.addEventListener('click', () => {
    state.agents.forEach(a => selected.add(a.slug));
    renderAgents();
    updateStartBtn();
  });

  document.getElementById('deselectAll')?.addEventListener('click', () => {
    selected.clear();
    renderAgents();
    updateStartBtn();
  });

  // Auto-refresh
  setInterval(refresh, 5000);
}

function initProviderKeysLayout() {
  const pkDiv = document.getElementById('agents-provider-keys');
  if (!pkDiv) return;

  pkDiv.innerHTML = `
    <h3 style="margin:0 0 10px 0;font-size:14px;font-weight:600;color:var(--text-primary);">Provider Keys (Server-side Encrypted Custody)</h3>
    <span style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:12px;">
      Configure API keys for model providers. Default keys apply to all agents in this lobby unless overridden per-agent.
    </span>

    <!-- Key Add Form -->
    <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;padding:12px;display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:16px;">
      <div>
        <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;">Provider</label>
        <select id="pk-provider" style="padding:6px;background:var(--bg-base);border:1px solid var(--border);color:var(--text-primary);border-radius:4px;font-size:12px;appearance:auto;">
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
          <option value="openai-compatible">OpenAI Compatible</option>
        </select>
      </div>
      <div>
        <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;">Agent DID (Optional override)</label>
        <input type="text" id="pk-agent-ref" placeholder="did:ccd:..." style="padding:6px;background:var(--bg-base);border:1px solid var(--border);color:var(--text-primary);border-radius:4px;font-size:12px;width:160px;" />
      </div>
      <div>
        <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;">API Key</label>
        <input type="password" id="pk-key" placeholder="sk-..." style="padding:6px;background:var(--bg-base);border:1px solid var(--border);color:var(--text-primary);border-radius:4px;font-size:12px;width:150px;" />
      </div>
      <div>
        <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;">Base URL (Optional)</label>
        <input type="text" id="pk-base-url" placeholder="https://..." style="padding:6px;background:var(--bg-base);border:1px solid var(--border);color:var(--text-primary);border-radius:4px;font-size:12px;width:120px;" />
      </div>
      <div>
        <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;">Model (Optional)</label>
        <input type="text" id="pk-model" placeholder="claude-..." style="padding:6px;background:var(--bg-base);border:1px solid var(--border);color:var(--text-primary);border-radius:4px;font-size:12px;width:110px;" />
      </div>
      <button class="btn btn-primary btn-sm" id="pk-store-btn">Store Key</button>
    </div>

    <!-- Active Keys Table -->
    <table class="data-table" style="font-size:12px;">
      <thead>
        <tr>
          <th>Provider</th>
          <th>Scope / Agent Ref</th>
          <th>Masked Key Hint</th>
          <th>Base URL</th>
          <th>Model</th>
          <th style="width:80px;">Action</th>
        </tr>
      </thead>
      <tbody id="hosted-keys-table-body">
        <tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:12px;">Loading keys...</td></tr>
      </tbody>
    </table>
  `;

  document.getElementById('pk-store-btn')?.addEventListener('click', handleStoreKey);
}

async function refreshProviderKeys() {
  const tbody = document.getElementById('hosted-keys-table-body');
  if (!tbody) return;

  const token = localStorage.getItem('agent-os-lobby-token');
  const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
  const data = await fetchJson('/api/lobby/remote/provider-keys', { headers });
  const keys = data?.provider_keys || [];

  tbody.innerHTML = keys.length === 0
    ? '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:12px;">No keys configured yet. Connect keys so hosted agents can run.</td></tr>'
    : keys.map(k => `
      <tr>
        <td><strong>${escapeHtml(k.provider)}</strong></td>
        <td><span style="font-family:var(--mono);font-size:11px;">${escapeHtml(k.scope === 'lobby_default' ? 'Lobby Default' : k.agent_ref || '')}</span></td>
        <td><span style="font-family:var(--mono);font-size:11px;">${escapeHtml(k.keyHint || k.key_hint || '')}</span></td>
        <td><span style="font-family:var(--mono);font-size:11px;color:var(--text-muted);">${escapeHtml(k.baseUrl || k.base_url || '—')}</span></td>
        <td><span style="font-family:var(--mono);font-size:11px;color:var(--text-muted);">${escapeHtml(k.model || '—')}</span></td>
        <td>
          <button class="btn btn-danger btn-sm" data-action="revoke-key" data-key-id="${k.id}">Revoke</button>
        </td>
      </tr>
    `).join('');

  tbody.querySelectorAll('[data-action="revoke-key"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const keyId = e.currentTarget.dataset.keyId;
      showConfirm(
        'Revoke API Key',
        'Revoke this API key? Hosted agents using this provider will stop working unless another key covers them.',
        async () => {
          const token = localStorage.getItem('agent-os-lobby-token');
          const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
          const res = await fetchJson(`/api/lobby/remote/provider-keys/${keyId}`, {
            method: 'POST',
            headers
          });
          if (res && res.error) {
            showAlert('Error', 'Failed to revoke key: ' + res.error);
          }
          await refreshProviderKeys();
        }
      );
    });
  });
}

async function handleStoreKey() {
  const provider = document.getElementById('pk-provider')?.value;
  const agentRef = document.getElementById('pk-agent-ref')?.value?.trim() || null;
  const apiKey = document.getElementById('pk-key')?.value?.trim();
  const baseUrl = document.getElementById('pk-base-url')?.value?.trim() || null;
  const model = document.getElementById('pk-model')?.value?.trim() || null;

  if (!apiKey) {
    showAlert('Error', 'API Key is required.');
    return;
  }

  const token = localStorage.getItem('agent-os-lobby-token');
  const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
  const res = await fetchJson('/api/lobby/remote/provider-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({
      provider,
      agent_ref: agentRef,
      api_key: apiKey,
      base_url: baseUrl,
      model
    })
  });

  if (res && res.error) {
    showAlert('Error', 'Failed to store key: ' + res.error);
  } else {
    // Clear fields
    const keyEl = document.getElementById('pk-key');
    if (keyEl) keyEl.value = '';
    const refEl = document.getElementById('pk-agent-ref');
    if (refEl) refEl.value = '';
    const urlEl = document.getElementById('pk-base-url');
    if (urlEl) urlEl.value = '';
    const modelEl = document.getElementById('pk-model');
    if (modelEl) modelEl.value = '';

    await refreshProviderKeys();
  }
}

registerTab('agents', { init, onActivate: refresh });
