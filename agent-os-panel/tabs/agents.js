/**
 * Agents Tab — Agent management (start/stop, presets, bulk operations)
 * Refactored from original index.html inline JS.
 */
import { state, fetchJson, postJson, registerTab, escapeHtml } from '../app.js';

let selected = new Set();

function getIdentityBadge(status) {
  const map = {
    human_linked: ['badge-identity-human', 'Human-linked'],
    org_linked: ['badge-identity-org', 'Org-verified'],
    registry_verified: ['badge-identity-verified', 'Registered'],
    pending: ['badge-identity-pending', 'Pending'],
    failed: ['badge-identity-failed', 'Failed'],
    unverified: ['badge-identity-unverified', 'Unverified']
  };
  const entry = map[status] || ['badge-identity-unverified', 'Unverified'];
  const [cls, label] = entry;
  return `<span class="badge ${cls}">${label}</span>`;
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

function renderAgents() {
  const el = document.getElementById('agentList');
  if (!el) return;
  el.innerHTML = state.agents.map(a => {
    const checked = selected.has(a.slug) ? 'checked' : '';
    const statusClass = `status-${a.status}`;
    const isRunning = a.status === 'running';
    return `<tr>
      <td><input type="checkbox" ${checked} data-slug="${a.slug}" /></td>
      <td><strong>${escapeHtml(a.name)}</strong></td>
      <td class="scope" title="${escapeHtml(a.scope)}">${escapeHtml(a.scope)}</td>
      <td>${getIdentityBadge(a.identity_status)}</td>
      <td><span class="status-dot ${statusClass}"></span>${a.status}</td>
      <td>${getActivityIndicator(a.status)}</td>
      <td><span style="font-family:var(--mono);font-size:11px;">${escapeHtml(a.runtime || '—')}</span></td>
      <td><span style="font-family:var(--mono);font-size:11px;">${escapeHtml(a.model || '—')}</span></td>
      <td>${isRunning
        ? `<button class="btn btn-danger btn-sm" data-action="stop" data-slug="${a.slug}">Stop</button>`
        : `<button class="btn btn-primary btn-sm" data-action="start" data-slug="${a.slug}">Start</button>`
      }</td>
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
  const lobbyUrl = document.getElementById('lobbyUrl')?.value || '';
  await postJson('/api/agents/start', { slug, lobbyUrl });
  setTimeout(refresh, 500);
}

async function stopOne(slug) {
  await postJson('/api/agents/stop', { slug });
  setTimeout(refresh, 500);
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
  const data = await fetchJson('/api/agents');
  if (data) {
    state.agents = data.agents || [];
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
