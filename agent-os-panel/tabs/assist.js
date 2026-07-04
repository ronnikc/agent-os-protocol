/**
 * Assist Tab — Chat + Tasks + Sprint + Sessions sub-tabs
 * Chat connects to relay at ws://localhost:4722 (auto-started by panel).
 * Sessions persisted to staging MongoDB via proxy endpoints.
 * Tasks support selection, Plan Sprint, and Execute Tasks workflows.
 * Sprint Planner: name input, backlog from selected tasks, Create All Tasks.
 */
import { fetchJson, postJson, patchJson, registerTab, escapeHtml, formatTime, formatDate, onWsMessage, showModal, closeModal, getRelayWsUrl } from '../app.js';

let activeSubTab = 'chat';
let chatMessages = [];

// ── Simple Markdown Renderer for chat messages ──
function renderChatMarkdown(content) {
  if (!content) return '';
  let html = escapeHtml(content);
  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre style="background:var(--bg-base);padding:8px;border-radius:4px;font-size:11px;margin:4px 0;overflow-x:auto;"><code>$2</code></pre>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code style="background:var(--bg-base);padding:1px 4px;border-radius:3px;font-size:11px;">$1</code>');
  // Bold + italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Headings
  html = html.replace(/^#### (.+)$/gm, '<div style="font-size:13px;font-weight:700;margin:8px 0 3px;">$1</div>');
  html = html.replace(/^### (.+)$/gm, '<div style="font-size:14px;font-weight:700;margin:10px 0 4px;">$1</div>');
  html = html.replace(/^## (.+)$/gm, '<div style="font-size:15px;font-weight:700;margin:12px 0 4px;">$1</div>');
  html = html.replace(/^# (.+)$/gm, '<div style="font-size:16px;font-weight:700;margin:12px 0 4px;">$1</div>');
  // Unordered lists
  html = html.replace(/^[-*] (.+)$/gm, '<div style="margin-left:16px;">• $1</div>');
  // Ordered lists
  html = html.replace(/^(\d+)\. (.+)$/gm, '<div style="margin-left:16px;">$1. $2</div>');
  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr style="border:none;border-top:1px solid var(--border);margin:8px 0;">');
  // Markdown tables → HTML tables
  const lines = html.split('\n');
  let inTable = false;
  const processed = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('|') && line.endsWith('|')) {
      if (!inTable) { inTable = true; processed.push('<table style="width:100%;border-collapse:collapse;font-size:12px;margin:6px 0;">'); }
      if (/^\|[\s\-:|]+\|$/.test(line)) continue;
      const cells = line.split('|').filter(c => c.trim() !== '');
      const isHeader = !inTable || (lines[i + 1] && /^\|[\s\-:|]+\|$/.test(lines[i + 1].trim()));
      const tag = isHeader ? 'th' : 'td';
      processed.push('<tr>' + cells.map(c => `<${tag} style="padding:4px 8px;border:1px solid var(--border);text-align:left;">${c.trim()}</${tag}>`).join('') + '</tr>');
    } else {
      if (inTable) { inTable = false; processed.push('</table>'); }
      processed.push(line);
    }
  }
  if (inTable) processed.push('</table>');
  html = processed.join('\n');
  // Collapse excessive blank lines
  html = html.replace(/\n{3,}/g, '\n\n');
  html = html.replace(/\n/g, '<br>');
  html = html.replace(/(<br>){3,}/g, '<br><br>');
  return html;
}
let relayWs = null;
let relayConnected = false;
let currentSessionId = null;

// ── Shared task state across Tasks + Sprint sub-tabs ──
let suggestedTasks = []; // { id, title, description, priority, selected }
let selectedTaskIds = new Set();

// ── Chat ──
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
        if (msg.type === 'agent-status') {
          const last = chatMessages[chatMessages.length - 1];
          if (last && last.role === 'assistant' && !last.done) {
            last.content = msg.content || last.content;
          } else {
            chatMessages.push({ role: 'assistant', content: msg.content || '', ts: new Date().toISOString() });
          }
          renderChat();
        } else if (msg.type === 'agent-done') {
          const last = chatMessages[chatMessages.length - 1];
          if (last && last.role === 'assistant') {
            last.content = msg.content || last.content;
            last.done = true;
          }
          // Mirror Claude response to panel message bus so Messages tab shows it
          const doneContent = last?.content || msg.content || '';
          if (doneContent) {
            postJson('/api/messages', { from: 'claude-relay', to: 'panel', type: 'chat', content: doneContent }).catch(() => {});
          }
          // Persist session messages
          if (currentSessionId) {
            const sessionMsgs = chatMessages.map(m => ({ role: m.role, content: m.content, timestamp: m.ts }));
            const preview = chatMessages.find(m => m.role === 'user')?.content?.slice(0, 80) || '';
            patchJson(`/api/sessions/${currentSessionId}`, { messages: sessionMsgs, preview }).catch(() => {});
          }
          renderChat();
        } else if (msg.type === 'agent-error') {
          chatMessages.push({ role: 'error', content: msg.content || 'Unknown error', ts: new Date().toISOString() });
          renderChat();
        }
      } catch { /* ignore */ }
    };
  } catch { setTimeout(connectRelay, 5000); }
}

function renderRelayStatus() {
  const el = document.getElementById('relay-status');
  if (!el) return;
  el.innerHTML = relayConnected
    ? '<span class="status-dot status-running"></span>Relay connected'
    : '<span class="status-dot status-stopped"></span>Relay disconnected';
}

function renderChat() {
  const el = document.getElementById('chat-messages');
  if (!el) return;
  if (!chatMessages.length) {
    el.innerHTML = '<div class="empty-state">Send a prompt to start chatting with Claude via the relay server.</div>';
    return;
  }
  el.innerHTML = chatMessages.map(m => {
    if (m.role === 'error') {
      return `<div class="chat-bubble" style="background:rgba(239,68,68,0.1);border-color:var(--danger);max-width:100%">${escapeHtml(m.content)}</div>`;
    }
    const label = m.role === 'user' ? 'YOU' : 'CLAUDE';
    const labelColor = m.role === 'user' ? 'var(--purple)' : 'var(--success)';
    return `<div style="margin-bottom:12px;">
      <div style="font-size:11px;font-weight:600;color:${labelColor};margin-bottom:4px;">${label} <span style="color:var(--text-muted);font-weight:400">${formatTime(m.ts)}</span></div>
      <div class="chat-bubble ${m.role}"><div>${renderChatMarkdown(m.content)}</div></div>
    </div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}

function sendPrompt() {
  const input = document.getElementById('chat-input');
  const content = input?.value?.trim();
  if (!content || !relayConnected) return;
  chatMessages.push({ role: 'user', content, ts: new Date().toISOString() });
  renderChat();
  input.value = '';
  // Mirror user message to panel message bus so Messages tab shows it
  postJson('/api/messages', { from: 'panel', to: '*', type: 'chat', content }).catch(() => {});
  try {
    relayWs?.send(JSON.stringify({
      type: 'agent-request',
      agentId: 'panel',
      sessionId: currentSessionId,
      context: { prompt: content, content: [] },
    }));
  } catch { /* ignore */ }
}

// ── Tasks Sub-Tab ──
async function loadTasks() {
  const data = await fetchJson('/api/tasks?limit=100');
  const tasks = (data?.tasks || []).filter(t => t && t.task_id);
  suggestedTasks = tasks.map(t => ({
    id: t.task_id,
    title: t.title || 'Untitled',
    description: t.description || '',
    priority: t.priority || 'normal',
    status: t.status || 'pending',
    assigned_to: t.assigned_to || '',
    selected: selectedTaskIds.has(t.task_id),
  }));
  renderAssistTasks();
}

function renderAssistTasks() {
  const el = document.getElementById('assist-tasks-content');
  if (!el) return;

  const selectedCount = suggestedTasks.filter(t => t.selected).length;

  el.innerHTML = `<div style="padding:12px;">
    <div style="text-align:center;margin-bottom:12px;">
      <button class="btn btn-secondary btn-sm" id="assist-add-task">+ Add Task</button>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <span style="font-size:13px;">${selectedCount}/${suggestedTasks.length} selected</span>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-secondary btn-sm" id="assist-plan-sprint" ${selectedCount === 0 ? 'disabled' : ''}>Plan Sprint</button>
        <button class="btn btn-primary btn-sm" id="assist-execute-tasks" ${selectedCount === 0 ? 'disabled' : ''}>Execute Tasks</button>
      </div>
    </div>
    ${suggestedTasks.length ? suggestedTasks.map(t => `
      <div class="card" style="margin-bottom:8px;cursor:pointer;border-left:3px solid ${t.priority === 'critical' ? 'var(--danger)' : t.priority === 'high' ? 'var(--orange)' : 'var(--accent)'};" data-task-id="${t.id}">
        <div style="display:flex;align-items:start;gap:10px;">
          <input type="checkbox" ${t.selected ? 'checked' : ''} data-task-check="${t.id}" style="margin-top:3px;" />
          <div style="flex:1;">
            <div style="font-size:13px;font-weight:600;">${escapeHtml(t.title)}</div>
            ${t.description ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">${escapeHtml(t.description.slice(0, 120))}</div>` : ''}
            <div style="margin-top:6px;">
              <span class="badge ${t.priority === 'critical' ? 'badge-danger' : t.priority === 'high' ? 'badge-warning' : 'badge-info'}">${t.priority}</span>
              ${t.assigned_to ? `<span class="badge badge-muted" style="margin-left:4px">${escapeHtml(t.assigned_to)}</span>` : ''}
            </div>
          </div>
        </div>
      </div>
    `).join('') : '<div class="empty-state">No tasks. Add one to get started.</div>'}
  </div>`;

  // Wire up checkboxes
  el.querySelectorAll('[data-task-check]').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const id = e.target.dataset.taskCheck;
      const task = suggestedTasks.find(t => t.id === id);
      if (task) {
        task.selected = e.target.checked;
        if (task.selected) selectedTaskIds.add(id); else selectedTaskIds.delete(id);
        renderAssistTasks();
      }
    });
  });

  // Wire up buttons
  document.getElementById('assist-add-task')?.addEventListener('click', () => {
    showModal(`
      <h2>Add Task</h2>
      <div class="form-group"><label>Title</label><input type="text" id="at-title" placeholder="Task title" /></div>
      <div class="form-group"><label>Description</label><textarea id="at-desc" placeholder="Details..."></textarea></div>
      <div class="form-group"><label>Priority</label>
        <select id="at-priority"><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option><option value="low">Low</option></select>
      </div>
      <div class="form-actions">
        <button class="btn btn-secondary" onclick="document.getElementById('modal-overlay').style.display='none'">Cancel</button>
        <button class="btn btn-primary" id="at-save">Add</button>
      </div>
    `);
    document.getElementById('at-save')?.addEventListener('click', async () => {
      const title = document.getElementById('at-title')?.value?.trim();
      if (!title) return;
      await postJson('/api/tasks', { title, description: document.getElementById('at-desc')?.value || '', priority: document.getElementById('at-priority')?.value || 'normal' });
      closeModal();
      await loadTasks();
    });
  });

  document.getElementById('assist-plan-sprint')?.addEventListener('click', () => {
    switchSubTab('sprint');
  });

  document.getElementById('assist-execute-tasks')?.addEventListener('click', async () => {
    const selected = suggestedTasks.filter(t => t.selected);
    if (!selected.length) return;
    const prompt = `Execute the following ${selected.length} tasks:\n\n${selected.map((t, i) => `${i + 1}. **${t.title}**${t.description ? `: ${t.description}` : ''}`).join('\n')}`;
    // Switch to chat and send
    switchSubTab('chat');
    chatMessages.push({ role: 'user', content: prompt, ts: new Date().toISOString() });
    renderChat();
    try {
      relayWs?.send(JSON.stringify({
        type: 'agent-request', agentId: 'panel', sessionId: currentSessionId,
        context: { prompt, content: [] },
      }));
    } catch { /* ignore */ }
  });
}

// ── Sprint Planner Sub-Tab ──
let sprintName = '';

function renderSprint() {
  const el = document.getElementById('assist-sprint-content');
  if (!el) return;

  const backlog = suggestedTasks.filter(t => t.selected);
  const assigned = backlog.filter(t => t.assigned_to);

  el.innerHTML = `<div style="padding:12px;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <span style="font-size:14px;font-weight:600;">Sprint Planner</span>
      <span style="font-size:12px;color:var(--text-muted)">${assigned.length}/${backlog.length} assigned</span>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:16px;">
      <input type="text" id="sprint-name-input" value="${escapeHtml(sprintName)}" placeholder="Sprint name (e.g. Sprint 18.1.0)" style="flex:1;background:var(--bg-base);border:1px solid var(--border);color:var(--text-primary);padding:8px 10px;border-radius:4px;font-size:13px;" />
      <button class="btn btn-secondary btn-sm" id="sprint-add-inline">+ Add</button>
    </div>
    <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;">Backlog (${backlog.length})</div>
    ${backlog.length ? backlog.map(t => `
      <div style="padding:8px 0;border-bottom:1px solid var(--bg-surface);font-size:13px;">
        ${escapeHtml(t.title)}
      </div>
    `).join('') : '<div class="empty-state" style="padding:20px;">No tasks selected. Go to Tasks tab and select tasks first.</div>'}
    ${backlog.length ? `
      <button class="btn btn-primary" id="sprint-create-all" style="width:100%;margin-top:16px;padding:12px;font-size:14px;">
        Create All Tasks (${backlog.length})
      </button>
    ` : ''}
  </div>`;

  document.getElementById('sprint-name-input')?.addEventListener('input', (e) => {
    sprintName = e.target.value;
  });

  document.getElementById('sprint-add-inline')?.addEventListener('click', () => {
    showModal(`
      <h2>Add to Sprint</h2>
      <div class="form-group"><label>Title</label><input type="text" id="si-title" placeholder="Task title" /></div>
      <div class="form-actions">
        <button class="btn btn-secondary" onclick="document.getElementById('modal-overlay').style.display='none'">Cancel</button>
        <button class="btn btn-primary" id="si-save">Add</button>
      </div>
    `);
    document.getElementById('si-save')?.addEventListener('click', async () => {
      const title = document.getElementById('si-title')?.value?.trim();
      if (!title) return;
      const result = await postJson('/api/tasks', { title, priority: 'normal', category: 'sprint' });
      if (result?.task) {
        selectedTaskIds.add(result.task.task_id);
      }
      closeModal();
      await loadTasks();
      renderSprint();
    });
  });

  document.getElementById('sprint-create-all')?.addEventListener('click', async () => {
    const name = sprintName || 'Unnamed Sprint';
    // Send all tasks as a sprint plan to the relay
    const prompt = `Sprint Plan: ${name}\n\nExecute the following ${backlog.length} tasks as a sprint:\n\n${backlog.map((t, i) => `${i + 1}. **${t.title}**${t.description ? ` — ${t.description}` : ''}`).join('\n')}\n\nFollow SPRINTS.md process. Start with planning decomposition, then execute sequentially.`;
    switchSubTab('chat');
    chatMessages.push({ role: 'user', content: prompt, ts: new Date().toISOString() });
    renderChat();
    try {
      relayWs?.send(JSON.stringify({
        type: 'agent-request', agentId: 'panel', sessionId: currentSessionId,
        context: { prompt, content: [] },
      }));
    } catch { /* ignore */ }
  });
}

// ── Sessions Sub-Tab ──
let sessions = [];

async function loadSessions() {
  const data = await fetchJson('/api/sessions');
  sessions = Array.isArray(data) ? data : (data?.sessions || []);
  renderSessions();
}

function renderSessions() {
  const el = document.getElementById('assist-sessions-content');
  if (!el) return;

  el.innerHTML = `<div style="padding:12px;">
    <div style="text-align:center;margin-bottom:16px;">
      <div style="font-size:13px;font-weight:600;color:var(--accent);margin-bottom:4px;">New Session</div>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">Start a new conversation with Claude</div>
      <button class="btn btn-primary" id="start-new-session">Start New Session</button>
    </div>
    ${sessions.length ? sessions.map(s => {
      const preview = s.preview || s.element_label || s.messages?.[0]?.content?.slice(0, 80) || '(no preview)';
      const msgCount = s.message_count || s.messages?.length || 0;
      const date = formatDate(s.updated_at || s.created_at);
      const status = s.status || 'active';
      const statusBadge = status === 'complete' || status === 'ended'
        ? '<span class="badge badge-danger">Ended</span>'
        : '<span class="badge badge-success">Active</span>';
      return `
        <div class="card" style="margin-bottom:8px;cursor:pointer;" data-session-id="${s._id || s.session_id}">
          <div style="display:flex;justify-content:space-between;align-items:start;">
            <div>
              <span class="status-dot status-running"></span>
              <strong style="font-size:13px;">${escapeHtml(s.element_label || preview.slice(0, 50))}</strong>
            </div>
            ${statusBadge}
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">
            ${msgCount} messages &nbsp; ${date}
          </div>
          <div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">
            ${escapeHtml(preview.slice(0, 120))}
          </div>
        </div>
      `;
    }).join('') : '<div class="empty-state">No sessions found. Start a new one above.</div>'}
  </div>`;

  // Wire up session clicks
  el.querySelectorAll('[data-session-id]').forEach(card => {
    card.addEventListener('click', async () => {
      const id = card.dataset.sessionId;
      currentSessionId = id;
      // Load session messages
      const data = await fetchJson(`/api/sessions/${id}`);
      if (data?.messages) {
        chatMessages = data.messages.map(m => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.content || '',
          ts: m.created_at || m.timestamp || '',
          done: true,
        }));
      }
      switchSubTab('chat');
      renderChat();
    });
  });

  document.getElementById('start-new-session')?.addEventListener('click', async () => {
    currentSessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    chatMessages = [];
    // Persist new session
    await postJson('/api/sessions', { session_id: currentSessionId, preview: 'New conversation' }).catch(() => {});
    switchSubTab('chat');
    renderChat();
  });
}

// ── Sub-Tab Switching ──
function switchSubTab(id) {
  activeSubTab = id;
  document.querySelectorAll('#assist-sub-tabs button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.subtab === id);
  });
  document.querySelectorAll('.assist-sub-pane').forEach(pane => {
    pane.style.display = pane.id === `assist-${id}` ? 'flex' : 'none';
  });
  if (id === 'tasks') loadTasks();
  if (id === 'sprint') { loadTasks().then(() => renderSprint()); }
  if (id === 'sessions') loadSessions();
}

function init() {
  connectRelay();
  renderChat();
  renderRelayStatus();

  document.getElementById('assist-sub-tabs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-subtab]');
    if (btn) switchSubTab(btn.dataset.subtab);
  });

  document.getElementById('chat-send')?.addEventListener('click', sendPrompt);
  document.getElementById('chat-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendPrompt(); }
  });
}

function onActivate() {
  renderRelayStatus();
  if (activeSubTab === 'tasks') loadTasks();
  if (activeSubTab === 'sessions') loadSessions();
}

registerTab('assist', { init, onActivate });
