/**
 * Tasks Tab — Kanban board (Queued → Active → Done → Failed)
 */
import { state, fetchJson, postJson, patchJson, registerTab, onWsMessage, escapeHtml, truncate, showModal, closeModal, showAlert, renderMarkdownSafe, agentName, refreshAgentNameMap } from '../app.js';

let tasks = [];

const COLUMNS = [
  { id: 'pending', label: 'Queued', color: 'var(--text-muted)' },
  { id: 'in_progress', label: 'Active', color: 'var(--accent)' },
  { id: 'done', label: 'Done', color: 'var(--success)' },
  { id: 'failed', label: 'Failed', color: 'var(--danger)' },
];

const PRIORITY_ORDER = { critical: 0, high: 1, normal: 2, low: 3 };
const NEXT_STATUS = { pending: 'in_progress', in_progress: 'done', done: 'pending', failed: 'pending', blocked: 'pending' };

function renderKanban() {
  const el = document.getElementById('tasks-kanban');
  if (!el) return;

  el.innerHTML = COLUMNS.map(col => {
    const colTasks = tasks
      .filter(t => {
        if (col.id === 'failed') return t.status === 'failed' || t.status === 'blocked';
        return t.status === col.id;
      })
      .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2));

    return `<div class="kanban-column">
      <div class="kanban-column-header">
        <span style="color:${col.color}">${col.label}</span>
        <span class="badge badge-muted">${colTasks.length}</span>
      </div>
      <div class="kanban-column-body">
        ${colTasks.length ? colTasks.map(t => `
          <div class="kanban-card priority-${t.priority || 'normal'}" data-task-id="${t.task_id}">
            <div class="title">${escapeHtml(t.title || 'Untitled')}</div>
            <div style="font-size:10px;color:var(--text-muted);font-family:var(--mono);margin:2px 0;">${escapeHtml(t.task_id || '')}</div>
            <div class="meta">
              ${t.assigned_to ? `<span class="badge badge-info">${escapeHtml(agentName(t.assigned_to))}</span>` : ''}
              ${t.result_pr_url ? `<a href="${escapeHtml(t.result_pr_url)}" target="_blank" class="badge badge-success" title="Pull Request opened for review" onclick="event.stopPropagation()">🔀 PR</a>` : ''}
              ${t.priority && t.priority !== 'normal' ? `<span class="badge ${t.priority === 'critical' ? 'badge-danger' : t.priority === 'high' ? 'badge-warning' : 'badge-muted'}">${t.priority}</span>` : ''}
              ${t.category ? `<span style="color:var(--text-muted);font-size:10px">${escapeHtml(t.category)}</span>` : ''}
            </div>
            <div style="margin-top:6px;display:flex;gap:4px;">
              <button class="btn btn-sm btn-secondary" data-action="advance" data-task-id="${t.task_id}" data-status="${NEXT_STATUS[t.status] || 'pending'}">
                ${t.status === 'done' ? 'Reopen' : t.status === 'pending' ? 'Start' : t.status === 'in_progress' ? 'Complete' : 'Reopen'}
              </button>
              <button class="btn btn-sm btn-secondary" data-action="detail" data-task-id="${t.task_id}">Detail</button>
            </div>
          </div>
        `).join('') : '<div class="empty-state" style="padding:20px;font-size:11px">Empty</div>'}
      </div>
    </div>`;
  }).join('');
}

function showTaskDetail(taskId) {
  const t = tasks.find(t => t.task_id === taskId);
  if (!t) return;
  const rawStatus = t._raw_status || t.status;
  showModal(`
    <h2>${escapeHtml(t.title)}</h2>
    <div class="form-group">
      <label>Status</label>
      <div><span class="badge badge-info">${escapeHtml(rawStatus)}</span></div>
    </div>
    <div class="form-group">
      <label>Description</label>
      <div style="font-size:13px;white-space:pre-wrap">${escapeHtml(t.description || '(none)')}</div>
    </div>
    ${t.result_pr_url ? `
    <div class="form-group">
      <label>Pull Request</label>
      <a href="${escapeHtml(t.result_pr_url)}" target="_blank" class="btn btn-primary btn-sm" style="text-decoration:none;">🔀 Review this task's changes on GitHub ↗</a>
    </div>` : ''}
    ${t.result ? `
    <div class="form-group">
      <label>Result (agent report)</label>
      <div style="font-size:12px;max-height:320px;overflow:auto;background:var(--bg-surface);border:1px solid var(--border);border-radius:6px;padding:12px;line-height:1.5;">${renderMarkdownSafe(t.result)}</div>
    </div>` : ''}
    ${t.progress ? `
    <div class="form-group">
      <label>Progress</label>
      <div style="font-size:12px;white-space:pre-wrap;">${escapeHtml(String(t.progress))}</div>
    </div>` : ''}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 16px;">
      <div class="form-group"><label>Assigned To</label><div style="font-size:12px;">${escapeHtml(agentName(t.assigned_to) || 'unassigned')}</div></div>
      <div class="form-group"><label>Assigned By</label><div style="font-size:12px;">${escapeHtml(agentName(t.assigned_by))}</div></div>
      <div class="form-group"><label>Priority</label><div style="font-size:12px;">${t.priority || 'normal'}</div></div>
      <div class="form-group"><label>Category</label><div style="font-size:12px;">${escapeHtml(t.category || 'general')}</div></div>
      <div class="form-group"><label>Created</label><div style="font-size:12px;">${escapeHtml(t.created_at || t.assigned_at || '?')}</div></div>
      <div class="form-group"><label>Task ID</label><div style="font-size:10px;font-family:var(--mono);">${escapeHtml(t.task_id)}</div></div>
    </div>
    ${t.dependencies?.length ? `<div class="form-group"><label>Dependencies</label><div>${t.dependencies.join(', ')}</div></div>` : ''}
    <div class="form-actions">
      <button class="btn btn-danger btn-sm" data-action="delete-modal" data-task-id="${t.task_id}">Delete</button>
      ${['done', 'failed', 'completed', 'cancelled'].includes(rawStatus) || t.status === 'done' || t.status === 'failed' ? `
        <button class="btn btn-secondary btn-sm" data-action="reopen-modal" data-task-id="${t.task_id}" title="Re-assigns the task — the assignee executes it again">Reopen & Re-run</button>` : ''}
      <span style="flex:1"></span>
      <button class="btn btn-secondary" onclick="document.getElementById('modal-overlay').style.display='none'">Close</button>
    </div>
  `);

  document.querySelector('[data-action="delete-modal"]')?.addEventListener('click', async () => {
    if (confirm('Delete this task?')) {
      const base = lobbyMode === 'swarm' ? '/api/lobby/remote/tasks' : '/api/tasks';
      await postJson(`${base}/${t.task_id}/delete`, {});
      closeModal();
      await refresh();
    }
  });

  document.querySelector('[data-action="reopen-modal"]')?.addEventListener('click', async () => {
    const base = lobbyMode === 'swarm' ? '/api/lobby/remote/tasks' : '/api/tasks';
    // In swarm mode 'assigned' re-delivers the task to the assignee (the server re-sends
    // lobby-task-assigned); locally 'pending' re-queues the work item.
    await patchJson(`${base}/${t.task_id}`, { status: lobbyMode === 'swarm' ? 'assigned' : 'pending' });
    closeModal();
    await refresh();
  });
}

async function showCreateModal() {
  // Assignees are the LIVE roster (who can actually receive the task), not the agent-definition
  // catalog — a task assigned to a definition slug goes nowhere. Default to the Boss. Fall back to
  // local agent definitions only in Local Mode where the roster proxy may be empty.
  let agentOptions = '';
  try {
    const rosterData = await fetchJson('/api/lobby/remote/agents');
    const roster = (rosterData?.agents || []).filter(a =>
      a.status !== 'disconnected' && a.participant_type !== 'human' && a.agent_role !== 'panel');
    if (roster.length) {
      agentOptions = roster.map(a =>
        `<option value="${escapeHtml(a.agent_id)}" ${a.is_boss ? 'selected' : ''}>${escapeHtml(a.display_name || a.agent_id)}${a.is_boss ? ' ★ Boss' : ''}</option>`
      ).join('');
    }
  } catch { /* fall through to local definitions */ }
  if (!agentOptions) {
    agentOptions = state.agents.map(a => `<option value="${a.slug}">${a.name}</option>`).join('');
  }
  showModal(`
    <h2>Create Task</h2>
    <div class="form-group">
      <label>Title</label>
      <input type="text" id="new-task-title" placeholder="Task title" />
    </div>
    <div class="form-group">
      <label>Description</label>
      <textarea id="new-task-desc" placeholder="Details..."></textarea>
    </div>
    <div class="form-group">
      <label>Assign To</label>
      <select id="new-task-agent"><option value="">Unassigned</option>${agentOptions}</select>
    </div>
    <div class="form-group">
      <label>Priority</label>
      <select id="new-task-priority">
        <option value="normal">Normal</option>
        <option value="critical">Critical</option>
        <option value="high">High</option>
        <option value="low">Low</option>
      </select>
    </div>
    <div class="form-group">
      <label>Category</label>
      <select id="new-task-category">
        <option value="implementation">Implementation</option>
        <option value="bug-fix">Bug Fix</option>
        <option value="review">Review</option>
        <option value="documentation">Documentation</option>
        <option value="general">General</option>
      </select>
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary" onclick="document.getElementById('modal-overlay').style.display='none'">Cancel</button>
      <button class="btn btn-primary" id="create-task-btn">Create</button>
    </div>
  `);

  document.getElementById('create-task-btn')?.addEventListener('click', async () => {
    const title = document.getElementById('new-task-title')?.value?.trim();
    if (!title) return;
    const payload = {
      title,
      description: document.getElementById('new-task-desc')?.value || '',
      assigned_to: document.getElementById('new-task-agent')?.value || '',
      priority: document.getElementById('new-task-priority')?.value || 'normal',
      category: document.getElementById('new-task-category')?.value || 'general',
    };
    // Swarm Mode creates a coordination task on the lobby (delivered to the assignee over WS);
    // Local Mode keeps the panel-server work-item endpoint. Surface failures instead of silently
    // closing — the old behavior swallowed a 404 and looked like a no-op.
    const res = lobbyMode === 'swarm'
      ? await postJson('/api/lobby/remote/tasks', payload)
      : await postJson('/api/tasks', payload);
    if (!res || res.error) {
      showAlert('Failed to Create Task', res?.error || 'The task endpoint did not respond. Check the lobby connection and try again.');
      return;
    }
    closeModal();
    await refresh();
  });
}

let lobbyMode = 'local';

// Map a lobby coordination-task status onto the kanban's four columns. The kanban advance buttons
// speak the local work-item statuses (pending / in_progress / done), so the reverse map below
// translates them back when PATCHing a swarm task.
const SWARM_TO_KANBAN = { assigned: 'pending', accepted: 'pending', completed: 'done', cancelled: 'failed' };
const KANBAN_TO_SWARM = { done: 'completed' };

async function refresh() {
  const modeData = await fetchJson('/api/mode');
  lobbyMode = modeData?.mode || 'local';
  if (lobbyMode === 'swarm') await refreshAgentNameMap();

  let data;
  if (lobbyMode === 'swarm') {
    const token = localStorage.getItem('agent-os-lobby-token');
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    data = await fetchJson('/api/lobby/remote/tasks', { headers });
  } else {
    data = await fetchJson('/api/tasks?limit=200');
  }

  if (data) {
    if (lobbyMode === 'swarm') {
      // Coordination tasks (Boss-/panel-created, delivered to agents) — not the marketplace list.
      tasks = (data.coordination_tasks || []).filter(t => t && t.task_id)
        .map(t => ({ ...t, _raw_status: t.status, status: SWARM_TO_KANBAN[t.status] || t.status }));
    } else {
      tasks = (data.tasks || []).filter(t => t && t.task_id);
    }
    renderKanban();
    // Update stats
    const stats = document.getElementById('tasks-stats');
    if (stats) {
      const done = tasks.filter(t => t.status === 'done').length;
      stats.textContent = `${done}/${tasks.length} done`;
    }
  }
}

function init() {
  refresh();

  // Create button
  document.getElementById('create-task-trigger')?.addEventListener('click', showCreateModal);

  // Kanban event delegation. Clicking anywhere on a card (not just the small Detail button)
  // opens the detail modal — reading what happened is the most common action.
  document.getElementById('tasks-kanban')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) {
      const card = e.target.closest('.kanban-card[data-task-id]');
      if (card) showTaskDetail(card.dataset.taskId);
      return;
    }

    if (btn.dataset.action === 'advance') {
      const status = lobbyMode === 'swarm'
        ? (KANBAN_TO_SWARM[btn.dataset.status] || btn.dataset.status)
        : btn.dataset.status;
      const base = lobbyMode === 'swarm' ? '/api/lobby/remote/tasks' : '/api/tasks';
      await patchJson(`${base}/${btn.dataset.taskId}`, { status });
      await refresh();
    }

    if (btn.dataset.action === 'detail') {
      showTaskDetail(btn.dataset.taskId);
    }
  });

  // WS updates — local panel-server names and the lobby's raw swarm names
  onWsMessage('task-created', refresh);
  onWsMessage('task-updated', refresh);
  onWsMessage('tasks', refresh);
  onWsMessage('lobby-task-update', refresh);
  onWsMessage('lobby-task-updated', refresh);
  onWsMessage('lobby-task-assigned', refresh);
}

registerTab('tasks', { init, onActivate: refresh });
