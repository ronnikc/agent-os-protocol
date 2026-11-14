/**
 * Sprint Tab — Sprint Planner with phase selection, task management, and execution.
 * Replaces the UI Assist tab. Connects to relay for sprint execution.
 */
import { fetchJson, postJson, patchJson, registerTab, escapeHtml, formatTime, onWsMessage, showModal, closeModal, getRelayWsUrl } from '../app.js';

let sprintName = '';
let sprintPhase = '';
let newPhaseName = '';
let newPhaseNum = 0;
let sprintTasks = []; // { id, title, description, priority, assigned_to, status }
let phases = []; // from Gantt API
let existingTasks = []; // from /api/tasks
let relayWs = null;
let relayConnected = false;
let executionLog = [];

// ── Relay Connection ──
async function connectRelay() {
  try {
    relayWs = new WebSocket(await getRelayWsUrl());
    relayWs.onopen = () => { relayConnected = true; renderRelayStatus(); };
    relayWs.onclose = () => {
      relayConnected = false;
      renderRelayStatus();
      setTimeout(connectRelay, 5000);
    };
    relayWs.onerror = () => { relayWs?.close(); };
    relayWs.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'agent-status' || msg.type === 'agent-done') {
          if (msg.content) {
            executionLog.push({ ts: new Date().toISOString(), content: msg.content, done: msg.type === 'agent-done' });
            renderExecutionLog();
          }
        } else if (msg.type === 'agent-error') {
          executionLog.push({ ts: new Date().toISOString(), content: `Error: ${msg.content || 'Unknown'}`, error: true });
          renderExecutionLog();
        }
      } catch { /* ignore */ }
    };
  } catch { setTimeout(connectRelay, 5000); }
}

function renderRelayStatus() {
  const el = document.getElementById('sprint-relay-status');
  if (!el) return;
  el.innerHTML = relayConnected
    ? '<span class="status-dot status-running"></span>Relay connected'
    : '<span class="status-dot status-stopped"></span>Relay disconnected';
}

function renderExecutionLog() {
  const el = document.getElementById('sprint-exec-log');
  if (!el) return;
  if (!executionLog.length) { el.innerHTML = ''; return; }
  const last = executionLog[executionLog.length - 1];
  el.innerHTML = `
    <div style="margin-top:16px;border-top:1px solid var(--border);padding-top:12px;">
      <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:6px;">Execution Output</div>
      <pre style="background:var(--bg-base);padding:10px;border-radius:4px;font-size:11px;max-height:300px;overflow-y:auto;white-space:pre-wrap;">${escapeHtml(last.content)}</pre>
      ${last.done ? '<div style="margin-top:6px;"><span class="badge badge-success">Complete</span></div>' : ''}
      ${last.error ? '<div style="margin-top:6px;"><span class="badge badge-danger">Error</span></div>' : ''}
    </div>
  `;
}

// ── Main Render ──
function render() {
  const el = document.getElementById('sprint-planner-content');
  if (!el) return;

  const isNewPhase = sprintPhase === '__new__';
  const phaseOptions = phases.map(p =>
    `<option value="${escapeHtml(p.id)}" ${p.id === sprintPhase ? 'selected' : ''}>${escapeHtml(p.name)} (${p.completedSprints}/${p.sprintCount})</option>`
  ).join('');

  const totalTasks = sprintTasks.length;
  const assignedTasks = sprintTasks.filter(t => t.assigned_to).length;

  // Next phase number = max existing + 1
  const maxPhaseNum = phases.reduce((max, p) => {
    const n = parseInt(p.id.replace('phase-', ''));
    return n > max ? n : max;
  }, 0);

  el.innerHTML = `<div style="padding:16px;max-width:900px;margin:0 auto;">
    <!-- Sprint Header -->
    <div style="display:flex;gap:12px;margin-bottom:${isNewPhase ? '8' : '16'}px;">
      <div style="flex:2;">
        <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">Sprint Name</label>
        <input type="text" id="sprint-name" value="${escapeHtml(sprintName)}" placeholder="e.g. Sprint 39.0.0 — Feature Name" style="width:100%;background:var(--bg-base);border:1px solid var(--border);color:var(--text-primary);padding:8px 10px;border-radius:4px;font-size:13px;" />
      </div>
      <div style="flex:1;">
        <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">Phase</label>
        <select id="sprint-phase" style="width:100%;background:var(--bg-base);border:1px solid var(--border);color:var(--text-primary);padding:8px 10px;border-radius:4px;font-size:13px;">
          <option value="">Select phase...</option>
          ${phaseOptions}
          <option value="__new__" ${isNewPhase ? 'selected' : ''}>+ New Phase</option>
        </select>
      </div>
    </div>
    ${isNewPhase ? `
    <div style="display:flex;gap:12px;margin-bottom:16px;padding:10px;background:var(--bg-surface);border-radius:4px;border:1px solid var(--border);">
      <div style="flex:0 0 100px;">
        <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">Phase Number</label>
        <input type="number" id="new-phase-num" value="${maxPhaseNum + 1}" min="1" style="width:100%;background:var(--bg-base);border:1px solid var(--border);color:var(--text-primary);padding:8px 10px;border-radius:4px;font-size:13px;" />
      </div>
      <div style="flex:1;">
        <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">Phase Name</label>
        <input type="text" id="new-phase-name" value="${escapeHtml(newPhaseName)}" placeholder="e.g. EU Market Expansion" style="width:100%;background:var(--bg-base);border:1px solid var(--border);color:var(--text-primary);padding:8px 10px;border-radius:4px;font-size:13px;" />
      </div>
    </div>
    ` : ''}

    <!-- Tasks Section -->
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <div>
        <span style="font-size:13px;font-weight:600;">Sprint Tasks</span>
        <span style="font-size:11px;color:var(--text-muted);margin-left:8px;">${totalTasks} tasks${assignedTasks ? `, ${assignedTasks} assigned` : ''}</span>
      </div>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-secondary btn-sm" id="sprint-add-task">+ Add Task</button>
        <button class="btn btn-secondary btn-sm" id="sprint-import-tasks">Import from Tasks</button>
      </div>
    </div>

    ${sprintTasks.length ? sprintTasks.map((t, i) => `
      <div class="card" style="margin-bottom:6px;border-left:3px solid ${t.priority === 'critical' ? 'var(--danger)' : t.priority === 'high' ? 'var(--orange)' : 'var(--accent)'};">
        <div style="display:flex;align-items:start;gap:8px;">
          <span style="font-size:11px;color:var(--text-muted);min-width:20px;">${i + 1}.</span>
          <div style="flex:1;">
            <div style="font-size:13px;font-weight:600;">${escapeHtml(t.title)}</div>
            ${t.description ? `<div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">${escapeHtml(t.description.slice(0, 150))}</div>` : ''}
            <div style="margin-top:4px;display:flex;gap:4px;align-items:center;">
              <span class="badge ${t.priority === 'critical' ? 'badge-danger' : t.priority === 'high' ? 'badge-warning' : 'badge-muted'}">${t.priority || 'normal'}</span>
              ${t.assigned_to ? `<span class="badge badge-info">${escapeHtml(t.assigned_to)}</span>` : ''}
            </div>
          </div>
          <button class="btn btn-sm" style="color:var(--danger);background:none;border:none;font-size:14px;cursor:pointer;" data-action="remove-task" data-idx="${i}" title="Remove">&times;</button>
        </div>
      </div>
    `).join('') : '<div class="empty-state" style="padding:30px;">No tasks yet. Add tasks to build your sprint backlog.</div>'}

    <!-- Action Buttons -->
    ${sprintTasks.length ? `
      <div style="display:flex;gap:8px;margin-top:16px;">
        <button class="btn btn-primary" id="sprint-execute" style="flex:1;padding:12px;font-size:14px;">
          Send to Boss Agent (${sprintTasks.length} tasks)
        </button>
        <button class="btn btn-secondary" id="sprint-clear" style="padding:12px;">Clear All</button>
      </div>
    ` : ''}

    <div id="sprint-exec-log"></div>
  </div>`;

  // Wire up events
  document.getElementById('sprint-name')?.addEventListener('input', (e) => { sprintName = e.target.value; });
  document.getElementById('sprint-phase')?.addEventListener('change', (e) => {
    sprintPhase = e.target.value;
    render(); // Re-render to show/hide new phase inputs
  });
  document.getElementById('new-phase-name')?.addEventListener('input', (e) => { newPhaseName = e.target.value; });
  document.getElementById('new-phase-num')?.addEventListener('input', (e) => { newPhaseNum = parseInt(e.target.value) || 0; });

  document.getElementById('sprint-add-task')?.addEventListener('click', () => {
    showModal(`
      <h2>Add Sprint Task</h2>
      <div class="form-group"><label>Title</label><input type="text" id="st-title" placeholder="Task title" /></div>
      <div class="form-group"><label>Description</label><textarea id="st-desc" placeholder="Task details..." rows="3"></textarea></div>
      <div class="form-group"><label>Priority</label>
        <select id="st-priority"><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option><option value="low">Low</option></select>
      </div>
      <div class="form-group"><label>Assign To (agent slug)</label><input type="text" id="st-assign" placeholder="e.g. backend, frontend (optional)" /></div>
      <div class="form-actions">
        <button class="btn btn-secondary" onclick="document.getElementById('modal-overlay').style.display='none'">Cancel</button>
        <button class="btn btn-primary" id="st-save">Add</button>
      </div>
    `);
    document.getElementById('st-save')?.addEventListener('click', () => {
      const title = document.getElementById('st-title')?.value?.trim();
      if (!title) return;
      sprintTasks.push({
        id: `st-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        title,
        description: document.getElementById('st-desc')?.value || '',
        priority: document.getElementById('st-priority')?.value || 'normal',
        assigned_to: document.getElementById('st-assign')?.value?.trim() || '',
      });
      closeModal();
      render();
    });
  });

  document.getElementById('sprint-import-tasks')?.addEventListener('click', async () => {
    const data = await fetchJson('/api/tasks?limit=100');
    const tasks = (data?.tasks || []).filter(t => t && t.task_id && t.status !== 'done');
    if (!tasks.length) {
      showModal(`<h2>Import Tasks</h2><p>No pending tasks to import.</p>
        <div class="form-actions"><button class="btn btn-secondary" onclick="document.getElementById('modal-overlay').style.display='none'">Close</button></div>`);
      return;
    }
    const existingIds = new Set(sprintTasks.map(t => t.id));
    showModal(`
      <h2>Import Tasks</h2>
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">Select tasks to add to this sprint:</p>
      ${tasks.map(t => `
        <label style="display:flex;align-items:start;gap:8px;padding:6px 0;border-bottom:1px solid var(--bg-surface);cursor:pointer;">
          <input type="checkbox" data-import-id="${t.task_id}" ${existingIds.has(t.task_id) ? 'checked disabled' : ''} style="margin-top:3px;" />
          <div>
            <div style="font-size:13px;">${escapeHtml(t.title)}</div>
            <span class="badge badge-muted">${t.priority || 'normal'}</span>
            ${t.assigned_to ? `<span class="badge badge-info" style="margin-left:4px">${escapeHtml(t.assigned_to)}</span>` : ''}
          </div>
        </label>
      `).join('')}
      <div class="form-actions">
        <button class="btn btn-secondary" onclick="document.getElementById('modal-overlay').style.display='none'">Cancel</button>
        <button class="btn btn-primary" id="import-confirm">Import Selected</button>
      </div>
    `, { wide: true });

    document.getElementById('import-confirm')?.addEventListener('click', () => {
      document.querySelectorAll('[data-import-id]').forEach(cb => {
        if (cb.checked && !cb.disabled) {
          const task = tasks.find(t => t.task_id === cb.dataset.importId);
          if (task) {
            sprintTasks.push({
              id: task.task_id,
              title: task.title,
              description: task.description || '',
              priority: task.priority || 'normal',
              assigned_to: task.assigned_to || '',
            });
          }
        }
      });
      closeModal();
      render();
    });
  });

  // Remove task
  el.querySelectorAll('[data-action="remove-task"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      sprintTasks.splice(idx, 1);
      render();
    });
  });

  // Clear all
  document.getElementById('sprint-clear')?.addEventListener('click', () => {
    if (confirm('Clear all sprint tasks?')) {
      sprintTasks = [];
      sprintName = '';
      sprintPhase = '';
      render();
    }
  });

  // Execute sprint — send to boss agent via lobby for orchestrated execution
  document.getElementById('sprint-execute')?.addEventListener('click', async () => {
    if (!sprintTasks.length) return;
    const name = sprintName || 'Unnamed Sprint';
    const isNew = sprintPhase === '__new__';
    const phaseLabel = isNew
      ? `Phase ${newPhaseNum || maxPhaseNum + 1} — ${newPhaseName || 'New Phase'}`
      : (sprintPhase ? phases.find(p => p.id === sprintPhase)?.name || sprintPhase : '');

    const sprintDescription = [
      `# Sprint Plan: ${name}`,
      phaseLabel ? `**Phase:** ${phaseLabel}` : '',
      isNew ? `**Action:** Create new phase directory \`docs/product/phases/phase-${newPhaseNum || maxPhaseNum + 1}/\` with README.md before creating sprint spec.` : '',
      '',
      `Plan and execute the following ${sprintTasks.length} tasks as a sprint:`,
      '',
      ...sprintTasks.map((t, i) => {
        let line = `${i + 1}. **${t.title}**`;
        if (t.description) line += ` — ${t.description}`;
        if (t.priority && t.priority !== 'normal') line += ` [${t.priority}]`;
        if (t.assigned_to) line += ` (assign to: ${t.assigned_to})`;
        return line;
      }),
      '',
      'Instructions for Boss Agent:',
      '1. Assign the Planning Specialist to create the sprint spec following SPRINTS.md process',
      '2. Decompose tasks and assign to appropriate specialist agents',
      '3. Coordinate execution across agents, monitor progress',
      '4. Report back when all tasks are complete or if blocked',
    ].filter(Boolean).join('\n');

    executionLog = [];
    executionLog.push({ ts: new Date().toISOString(), content: `Sending sprint plan to Boss Agent: ${name} (${sprintTasks.length} tasks)...` });
    renderExecutionLog();

    // Create tasks in the Panel Tasks system
    for (const t of sprintTasks) {
      postJson('/api/tasks', {
        title: t.title,
        description: t.description,
        priority: t.priority,
        assigned_to: t.assigned_to,
        category: 'sprint',
      }).catch(() => {});
    }

    // Send to boss agent via lobby message system (not direct relay)
    const result = await postJson('/api/messages', {
      from: 'panel',
      to: '*',
      type: 'request',
      content: sprintDescription,
    });

    if (result?.ok && result.sentToStaging !== false) {
      executionLog.push({ ts: new Date().toISOString(), content: `Sprint plan sent to lobby. Boss Agent will orchestrate planning and execution across the agent swarm.` });
    } else if (result?.sentToStaging === false) {
      executionLog.push({ ts: new Date().toISOString(), content: 'Sprint plan was saved locally but did not reach the lobby. Check the lobby connection and Boss Agent before retrying.', error: true });
    } else {
      executionLog.push({ ts: new Date().toISOString(), content: `Failed to send sprint plan: ${result?.error || 'unknown'}`, error: true });
    }
    renderExecutionLog();
  });

  renderExecutionLog();
}

async function loadPhases() {
  const data = await fetchJson('/api/gantt/phases');
  if (data?.phases) phases = data.phases;
}

function init() {
  connectRelay();
  loadPhases().then(() => render());
}

function onActivate() {
  renderRelayStatus();
  loadPhases().then(() => render());
}

registerTab('sprint', { init, onActivate });
