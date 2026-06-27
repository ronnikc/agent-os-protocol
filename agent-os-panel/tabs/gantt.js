/**
 * Gantt Tab — Phase → Sprint → Task hierarchy visualization
 * With action menu for creating tasks, requesting reviews.
 */
import { fetchJson, postJson, registerTab, escapeHtml, showModal, closeModal } from '../app.js';

let ganttData = { phases: [] };
let expandedPhases = new Set();
let expandedSprints = new Set();
let actionMenuTarget = null;

function renderGantt() {
  const el = document.getElementById('gantt-content');
  if (!el) return;

  if (!ganttData.phases.length) {
    el.innerHTML = '<div class="empty-state">No phase data found in docs/product/phases/</div>';
    return;
  }

  // Summary stats
  const totalSprints = ganttData.phases.reduce((s, p) => s + (p.sprintCount || 0), 0);
  const completedPhases = ganttData.phases.filter(p => p.status === 'complete').length;
  const completedSprints = ganttData.phases.reduce((s, p) => s + (p.completedSprints || 0), 0);

  let html = `
    <div style="padding:8px 12px;font-size:12px;color:var(--text-secondary);border-bottom:1px solid var(--border);display:flex;gap:16px;">
      <span>${ganttData.phases.length} phases</span>
      <span>${totalSprints} sprints</span>
      <span style="color:var(--success)">${completedPhases} phases complete</span>
      <span style="color:var(--success)">${completedSprints} sprints complete</span>
    </div>
    <div class="gantt-container">
  `;

  for (const phase of ganttData.phases) {
    const phaseExpanded = expandedPhases.has(phase.id);
    const sprints = phase.sprints || [];
    const phaseStatus = phase.status || 'unknown';
    const phaseTotal = phase.sprintCount || sprints.length;
    const phaseDone = phaseStatus === 'complete' ? phaseTotal : (phase.completedSprints ?? sprints.filter(s => s.status === 'complete').length);
    const phasePct = phaseStatus === 'complete' ? 100 : (phaseTotal ? Math.round(phaseDone / phaseTotal * 100) : 0);

    html += `
      <div class="gantt-row" data-phase="${phase.id}">
        <div class="gantt-label phase expandable ${phaseExpanded ? 'expanded' : ''}" data-toggle="phase" data-id="${phase.id}">
          ${escapeHtml(phase.name)} <span style="color:var(--text-muted);font-size:11px">(${phaseDone}/${phaseTotal} sprints)</span>
        </div>
        <div class="gantt-bar-area" style="display:flex;align-items:center;gap:6px;">
          <div class="gantt-bar ${phaseStatus}" style="width:${Math.max(phasePct, 5)}%;position:relative;">
            ${phasePct}%
          </div>
          <button class="btn btn-sm btn-secondary" data-action="menu" data-target="${phase.id}" data-type="phase" style="font-size:10px;padding:1px 6px;">...</button>
        </div>
      </div>
    `;

    if (phaseExpanded) {
      for (const sprint of sprints) {
        const sprintExpanded = expandedSprints.has(sprint.id);
        const sprintPct = sprint.taskCount ? Math.round(sprint.tasksDone / sprint.taskCount * 100) : 0;

        html += `
          <div class="gantt-row" data-sprint="${sprint.id}">
            <div class="gantt-label sprint ${sprint.tasks?.length ? 'expandable' : ''} ${sprintExpanded ? 'expanded' : ''}" data-toggle="sprint" data-id="${sprint.id}">
              ${escapeHtml(sprint.title || sprint.id)}
            </div>
            <div class="gantt-bar-area" style="display:flex;align-items:center;gap:6px;">
              <div class="gantt-bar ${sprint.status || 'unknown'}" style="width:${Math.max(sprintPct || (sprint.status === 'complete' ? 100 : 10), 5)}%">
                ${sprint.taskCount ? `${sprint.tasksDone}/${sprint.taskCount}` : sprint.status || '?'}
              </div>
              <button class="btn btn-sm btn-secondary" data-action="menu" data-target="${sprint.id}" data-type="sprint" data-file="${sprint.file || ''}" style="font-size:10px;padding:1px 6px;">...</button>
            </div>
          </div>
        `;

        if (sprintExpanded && sprint.tasks?.length) {
          for (const task of sprint.tasks) {
            html += `
              <div class="gantt-row">
                <div class="gantt-label task">
                  <span style="color:${task.done ? 'var(--success)' : 'var(--text-muted)'}">${task.done ? '\u2713' : '\u25CB'}</span>
                  ${escapeHtml(task.title)}
                </div>
                <div class="gantt-bar-area">
                  <div class="gantt-bar ${task.done ? 'complete' : 'planned'}" style="width:${task.done ? 100 : 20}%">
                    ${task.done ? 'Done' : 'Todo'}
                  </div>
                </div>
              </div>
            `;
          }
        }
      }
    }
  }

  html += '</div>';
  el.innerHTML = html;
}

function showActionMenu(target, type, file, x, y) {
  // Remove existing menu
  document.getElementById('gantt-action-menu')?.remove();

  const menu = document.createElement('div');
  menu.id = 'gantt-action-menu';
  menu.className = 'action-menu';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const items = [
    { label: 'Create Task', action: 'create-task' },
    { label: 'Request Code Review', action: 'request-code-review' },
    { label: 'Request UX Review', action: 'request-ux-review' },
  ];

  menu.innerHTML = items.map(i =>
    `<button data-menu-action="${i.action}" data-target="${target}" data-type="${type}" data-file="${file || ''}">${i.label}</button>`
  ).join('');

  document.body.appendChild(menu);

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', function close(e) {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', close);
      }
    });
  }, 0);
}

async function handleMenuAction(action, target, type, file) {
  document.getElementById('gantt-action-menu')?.remove();

  if (action === 'create-task') {
    showModal(`
      <h2>Create Task for ${escapeHtml(target)}</h2>
      <div class="form-group">
        <label>Title</label>
        <input type="text" id="gantt-task-title" placeholder="Task title" />
      </div>
      <div class="form-group">
        <label>Description</label>
        <textarea id="gantt-task-desc" placeholder="Details...">${type}: ${target}</textarea>
      </div>
      <div class="form-group">
        <label>Priority</label>
        <select id="gantt-task-priority">
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
      </div>
      <div class="form-actions">
        <button class="btn btn-secondary" onclick="document.getElementById('modal-overlay').style.display='none'">Cancel</button>
        <button class="btn btn-primary" id="gantt-create-btn">Create</button>
      </div>
    `);
    document.getElementById('gantt-create-btn')?.addEventListener('click', async () => {
      const title = document.getElementById('gantt-task-title')?.value?.trim();
      if (!title) return;
      await postJson('/api/tasks', {
        title,
        description: document.getElementById('gantt-task-desc')?.value || '',
        priority: document.getElementById('gantt-task-priority')?.value || 'normal',
        category: 'implementation',
      });
      closeModal();
    });
  }

  if (action === 'request-code-review') {
    await postJson('/api/tasks', {
      title: `Code Review: ${target}`,
      description: `Code review requested from Gantt chart.\nTarget: ${type} ${target}\n${file ? `File: ${file}` : ''}`,
      assigned_to: 'code-review',
      priority: 'high',
      category: 'review',
    });
    await postJson('/api/messages', {
      from: 'panel', to: 'code-review', type: 'request',
      content: `Code review requested for ${type} ${target}`,
    });
  }

  if (action === 'request-ux-review') {
    await postJson('/api/tasks', {
      title: `UX Review: ${target}`,
      description: `UX review requested from Gantt chart.\nTarget: ${type} ${target}\n${file ? `File: ${file}` : ''}`,
      assigned_to: 'ux',
      priority: 'high',
      category: 'review',
    });
    await postJson('/api/messages', {
      from: 'panel', to: 'ux', type: 'request',
      content: `UX review requested for ${type} ${target}`,
    });
  }
}

async function refresh() {
  const data = await fetchJson('/api/gantt/phases');
  if (data) {
    ganttData = data;
    renderGantt();
  }
}

function init() {
  refresh();

  document.getElementById('gantt-content')?.addEventListener('click', (e) => {
    // Toggle expand/collapse
    const toggle = e.target.closest('[data-toggle]');
    if (toggle) {
      const type = toggle.dataset.toggle;
      const id = toggle.dataset.id;
      const set = type === 'phase' ? expandedPhases : expandedSprints;
      if (set.has(id)) set.delete(id); else set.add(id);
      renderGantt();
      return;
    }

    // Action menu
    const menuBtn = e.target.closest('[data-action="menu"]');
    if (menuBtn) {
      const rect = menuBtn.getBoundingClientRect();
      showActionMenu(menuBtn.dataset.target, menuBtn.dataset.type, menuBtn.dataset.file, rect.right, rect.bottom);
      e.stopPropagation();
      return;
    }

    // Menu action
    const menuAction = e.target.closest('[data-menu-action]');
    if (menuAction) {
      handleMenuAction(menuAction.dataset.menuAction, menuAction.dataset.target, menuAction.dataset.type, menuAction.dataset.file);
      return;
    }
  });

  // Expand all / collapse all buttons
  document.getElementById('gantt-expand-all')?.addEventListener('click', () => {
    ganttData.phases.forEach(p => expandedPhases.add(p.id));
    renderGantt();
  });
  document.getElementById('gantt-collapse-all')?.addEventListener('click', () => {
    expandedPhases.clear();
    expandedSprints.clear();
    renderGantt();
  });
}

registerTab('gantt', { init, onActivate: refresh });
