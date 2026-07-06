/**
 * Agents Tab — Agent management (start/stop, presets, bulk operations)
 * Refactored from original index.html inline JS.
 */
import { state, fetchJson, postJson, registerTab, escapeHtml } from '../app.js';

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
    configured: ['badge-identity-pending', 'ID set'],
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

function renderPresets() {
  const el = document.getElementById('presets');
  if (!el) return;
  el.innerHTML = Object.entries(state.presets).map(([key, p]) =>
    `<button class="preset-btn" data-preset="${key}" title="${p.description}">${p.name}</button>`
  ).join('');
}

async function startOne(slug) {
  if (lobbyMode === 'swarm') {
    const token = localStorage.getItem('agent-os-lobby-token');
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    const res = await fetchJson('/api/lobby/remote/agents/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        name: slug.charAt(0).toUpperCase() + slug.slice(1) + ' Agent',
        agent_role: slug,
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20240620'
      })
    });
    if (res && res.error) {
      alert('Failed to launch hosted agent: ' + res.error);
    }
  } else {
    const lobbyUrl = document.getElementById('lobbyUrl')?.value || '';
    await postJson('/api/agents/start', { slug, lobbyUrl });
  }
  setTimeout(refresh, 500);
}

async function stopOne(slug) {
  if (lobbyMode === 'swarm') {
    const token = localStorage.getItem('agent-os-lobby-token');
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    const roster = await fetchJson('/api/lobby/remote/agents', { headers });
    const remoteAgent = (roster?.agents || []).find(a => a.agent_role === slug && a.status !== 'disconnected');
    const agentId = remoteAgent?.agent_id || slug;

    const res = await fetchJson('/api/lobby/remote/agents/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ agent_id: agentId })
    });
    if (res && res.error) {
      alert('Failed to stop hosted agent: ' + res.error);
    }
  } else {
    await postJson('/api/agents/stop', { slug });
  }
  setTimeout(refresh, 500);
}

async function setId(slug) {
  const current = state.agents.find(a => a.slug === slug)?.identity || '';
  const did = window.prompt(
    `Agent ID (DID) for "${slug}".\n\nThis is persisted to the agent definition and passed as the lobby join token on every boot, so the agent always connects with this identity.\n\nFormat: did:ccd:<network>:<id>`,
    current,
  );
  if (did === null) return; // cancelled
  const trimmed = did.trim();
  if (!trimmed) return;
  const result = await postJson('/api/agents/identity', { slug, identity: trimmed });
  if (result && result.ok === false) {
    window.alert(`Could not set Agent ID: ${result.error || 'unknown error'}`);
  } else if (result && result.restartRequired) {
    window.alert('Agent ID saved. Restart the agent (Stop then Start) for it to reconnect with the new identity.');
  }
  setTimeout(refresh, 300);
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
  if (!provider) { window.alert('Concordium Browser Wallet not found. Install the extension and reload to mint an Agent ID.'); return; }
  const lobbyUrl = document.getElementById('lobbyUrl')?.value?.trim();
  if (!lobbyUrl) { window.alert('Set the Lobby URL first — the Agent ID is minted via the connected lobby.'); return; }
  if (agent.identity && !window.confirm(`"${slug}" already has an Agent ID.\n\nMint a NEW one and replace it? The old DID will no longer be used.`)) return;

  const btn = document.querySelector(`[data-action="create-id"][data-slug="${slug}"]`);
  const setBtnText = (t) => { if (btn) btn.textContent = t; };
  const orig = btn?.textContent;
  if (btn) btn.disabled = true;
  try {
    const owner = await provider.connect();
    if (!owner) throw new Error('wallet connection was rejected');
    const network = /testnet/i.test(lobbyUrl) ? 'testnet' : 'mainnet';
    const { mintAgentId } = await import('../mint-agent-id.js'); // relative → works at root and under /panel/
    const { did, txHash, outcome } = await mintAgentId({
      base: '', lobbyUrl, network, provider, owner,
      agentName: agent.name, agentRole: slug,
      onStatus: (s) => setBtnText(s.length > 22 ? s.slice(0, 20) + '…' : s),
    });
    setBtnText('Saving…');
    const saved = await postJson('/api/agents/identity', { slug, identity: did });
    if (saved && saved.ok === false) throw new Error(saved.error || 'could not persist the Agent ID');
    const confirmedMsg = outcome?.success ? 'Confirmed on-chain.' : 'Submitted (confirm on the explorer).';
    window.alert(`Agent ID minted and bound to "${slug}".\n\nDID: ${did}\nTransaction: ${txHash}\n${confirmedMsg}\n\nRestart the agent (Stop then Start) for it to connect with this identity.`);
  } catch (err) {
    console.error('[Agents] Create ID failed:', err);
    window.alert(`Could not mint the Agent ID: ${err.message || err}`);
  } finally {
    if (btn) { btn.disabled = false; setBtnText(orig || 'Create ID'); }
    setTimeout(refresh, 300);
  }
}

async function revokeId(slug) {
  if (!window.confirm(`Remove the persisted Agent ID from "${slug}"? It will connect unverified on the next boot.`)) return;
  const result = await postJson('/api/agents/identity/revoke', { slug });
  if (result && result.ok === false) {
    window.alert(`Could not revoke Agent ID: ${result.error || 'unknown error'}`);
  } else if (result && result.restartRequired) {
    window.alert('Agent ID revoked. Restart the agent (Stop then Start) to drop the identity.');
  }
  setTimeout(refresh, 300);
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
}

function init() {
  renderAgents();
  renderPresets();
  updateStartBtn();

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

  document.getElementById('presets')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-preset]');
    if (!btn) return;
    const p = state.presets[btn.dataset.preset];
    if (!p) return;
    selected.clear();
    p.agents.forEach(s => selected.add(s));
    renderAgents();
    updateStartBtn();
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

registerTab('agents', { init, onActivate: refresh });
