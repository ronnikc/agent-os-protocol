/**
 * Scheduled Tab — Management of 3 scheduled tasks (graph update, PR review, fix sprint)
 * Now includes: Edit Prompt modal, auto-scheduler status indicator.
 */
import { fetchJson, postJson, putJson, registerTab, formatDate, escapeHtml, showModal, closeModal, onWsMessage } from '../app.js';

let tasks = [];

function utcToLocal(timeUtc) {
  if (!timeUtc) return '';
  const [h, m] = timeUtc.split(':').map(Number);
  const d = new Date();
  d.setUTCHours(h, m, 0, 0);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function nextRunTime(timeUtc) {
  if (!timeUtc) return 'unknown';
  const now = new Date();
  const [h, m] = timeUtc.split(':').map(Number);
  const next = new Date(now);
  next.setUTCHours(h, m, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function timeUntilNext(timeUtc) {
  if (!timeUtc) return '';
  const now = new Date();
  const [h, m] = timeUtc.split(':').map(Number);
  const next = new Date(now);
  next.setUTCHours(h, m, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  const diffMs = next - now;
  const hours = Math.floor(diffMs / 3600000);
  const mins = Math.floor((diffMs % 3600000) / 60000);
  return `${hours}h ${mins}m`;
}

function renderTasks() {
  const el = document.getElementById('scheduled-content');
  if (!el) return;

  if (!tasks.length) {
    el.innerHTML = '<div class="empty-state">No scheduled tasks configured</div>';
    return;
  }

  el.innerHTML = `<div style="padding:12px;display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:12px;">
    ${tasks.map(t => {
      const cfg = t.config || {};
      const st = t.state || {};
      const enabled = cfg.enabled !== false;
      const statusBadge = t.running
        ? '<span class="badge badge-warning">Running</span>'
        : enabled
          ? '<span class="badge badge-success">Enabled</span>'
          : '<span class="badge badge-muted">Disabled</span>';

      return `<div class="card">
        <div class="card-header">
          <span class="card-title">${escapeHtml(t.name)}</span>
          ${statusBadge}
        </div>
        <div class="card-meta">${escapeHtml(cfg.description || '')}</div>
        <div style="margin-top:10px;font-size:12px;color:var(--text-secondary);">
          <div>Schedule: <strong>${utcToLocal(cfg.time_utc) || '??:??'}</strong> daily <span style="color:var(--text-muted)">(${cfg.time_utc || '??:??'} UTC)</span></div>
          <div>Next run: ${nextRunTime(cfg.time_utc)} <span style="color:var(--text-muted)">(in ${timeUntilNext(cfg.time_utc)})</span></div>
          ${st.last_run ? `<div>Last run: ${formatDate(st.last_run)} — <span class="badge ${st.status === 'success' ? 'badge-success' : st.status === 'failed' ? 'badge-danger' : 'badge-warning'}">${st.status || 'unknown'}</span>${st.exit_code != null && st.exit_code !== 0 ? ` <span style="color:var(--text-muted);font-size:11px">(exit ${st.exit_code})</span>` : ''}${st.triggered_by ? ` <span style="color:var(--text-muted);font-size:11px">(${st.triggered_by})</span>` : ''}</div>` : '<div>Last run: never</div>'}
          ${st.error_snippet ? `<div style="margin-top:4px;color:var(--danger);font-size:11px;font-family:var(--mono);white-space:pre-wrap;background:rgba(239,68,68,0.05);padding:6px;border-radius:4px;">${escapeHtml(st.error_snippet.slice(0, 300))}</div>` : ''}
          ${st.resolution_note ? `<div style="margin-top:4px;color:var(--text-muted)">${escapeHtml(st.resolution_note.slice(0, 150))}</div>` : ''}
        </div>
        <div class="card-actions">
          <button class="btn btn-primary btn-sm" data-action="trigger" data-name="${t.name}" ${t.running ? 'disabled' : ''}>
            ${t.running ? 'Running...' : 'Run Now'}
          </button>
          <button class="btn btn-secondary btn-sm" data-action="edit-prompt" data-name="${t.name}">
            Edit Prompt
          </button>
          <button class="btn btn-secondary btn-sm" data-action="toggle" data-name="${t.name}">
            ${enabled ? 'Disable' : 'Enable'}
          </button>
          <button class="btn btn-secondary btn-sm" data-action="edit-schedule" data-name="${t.name}" data-time="${cfg.time_utc || ''}">
            Edit Time
          </button>
          <button class="btn btn-secondary btn-sm" data-action="view-logs" data-name="${t.name}">
            Logs
          </button>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

// Simple markdown renderer for prompt preview
function renderPromptMarkdown(md) {
  let html = escapeHtml(md);
  html = html.replace(/^### (.+)$/gm, '<h3 style="margin:12px 0 6px;font-size:14px;">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 style="margin:16px 0 8px;font-size:16px;border-bottom:1px solid var(--border);padding-bottom:4px;">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 style="margin:16px 0 8px;font-size:18px;">$1</h1>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g, '<code style="background:var(--bg-surface);padding:1px 4px;border-radius:3px;font-size:11px;">$1</code>');
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote style="border-left:3px solid var(--accent);padding-left:10px;color:var(--text-secondary);margin:6px 0;">$1</blockquote>');
  html = html.replace(/^\d+\.\s+(.+)$/gm, '<div style="margin-left:16px;">• $1</div>');
  html = html.replace(/^[-*]\s+(.+)$/gm, '<div style="margin-left:16px;">• $1</div>');
  html = html.replace(/^---$/gm, '<hr style="border:none;border-top:1px solid var(--border);margin:8px 0;">');
  html = html.replace(/\n\n/g, '</p><p style="margin:6px 0;">');
  html = '<p style="margin:6px 0;">' + html + '</p>';
  return html;
}

let promptPreviewMode = false;
let promptContent = '';

async function openPromptEditor(name) {
  const data = await fetchJson(`/api/scheduled/${name}/prompt`);
  if (!data || data.error) {
    showModal(`<h2>Error</h2><p>${escapeHtml(data?.error || 'Failed to load prompt')}</p>
      <div class="form-actions"><button class="btn btn-secondary" onclick="document.getElementById('modal-overlay').style.display='none'">Close</button></div>`);
    return;
  }
  promptPreviewMode = false;
  promptContent = data.content || '';

  function renderPromptModal() {
    showModal(`
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div>
          <h2 style="margin:0;font-size:16px;">Edit Prompt: ${escapeHtml(name)}</h2>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">${escapeHtml(data.path || '')}</div>
        </div>
        <button class="btn btn-secondary btn-sm" id="prompt-toggle">${promptPreviewMode ? '✏️ Edit' : '👁 Preview'}</button>
      </div>
      <div class="form-group">
        ${promptPreviewMode
          ? `<div id="prompt-preview" style="min-height:400px;max-height:60vh;overflow-y:auto;padding:12px;background:var(--bg-base);border:1px solid var(--border);border-radius:4px;font-size:13px;line-height:1.6;">${renderPromptMarkdown(promptContent)}</div>`
          : `<textarea id="prompt-editor" style="width:100%;min-height:400px;max-height:60vh;font-family:var(--mono);font-size:12px;background:var(--bg-base);color:var(--text-primary);border:1px solid var(--border);border-radius:4px;padding:10px;resize:vertical;line-height:1.5;">${escapeHtml(promptContent)}</textarea>`
        }
      </div>
      <div class="form-actions">
        <button class="btn btn-secondary" onclick="document.getElementById('modal-overlay').style.display='none'">Cancel</button>
        ${!promptPreviewMode ? `<button class="btn btn-primary" id="prompt-save">Save</button>` : ''}
      </div>
    `, { wide: true });

    document.getElementById('prompt-toggle')?.addEventListener('click', () => {
      const textarea = document.getElementById('prompt-editor');
      if (textarea) promptContent = textarea.value;
      promptPreviewMode = !promptPreviewMode;
      renderPromptModal();
    });

    document.getElementById('prompt-save')?.addEventListener('click', async () => {
      const content = document.getElementById('prompt-editor')?.value;
      if (content == null) return;
      promptContent = content;
      const result = await putJson(`/api/scheduled/${name}/prompt`, { content });
      if (result?.ok) {
        closeModal();
      } else {
        alert('Save failed: ' + (result?.error || 'unknown'));
      }
    });
  }

  renderPromptModal();
}

async function refresh() {
  const data = await fetchJson('/api/scheduled');
  if (data) {
    tasks = data.tasks || [];
    renderTasks();
  }
}

function init() {
  refresh();

  // Live updates from scheduler
  onWsMessage('scheduled-trigger', refresh);
  onWsMessage('scheduled-start', refresh);
  onWsMessage('scheduled-done', refresh);

  document.getElementById('scheduled-content')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const name = btn.dataset.name;

    if (btn.dataset.action === 'trigger') {
      btn.disabled = true;
      btn.textContent = 'Starting...';
      await postJson(`/api/scheduled/${name}/trigger`, {});
      setTimeout(refresh, 1000);
    }

    if (btn.dataset.action === 'toggle') {
      await postJson(`/api/scheduled/${name}/toggle`, {});
      await refresh();
    }

    if (btn.dataset.action === 'edit-prompt') {
      openPromptEditor(name);
    }

    if (btn.dataset.action === 'edit-schedule') {
      const currentTime = btn.dataset.time || '04:00';
      showModal(`
        <h2>Edit Schedule: ${escapeHtml(name)}</h2>
        <div class="form-group">
          <label>Time (UTC, e.g. 04:00)</label>
          <input type="time" id="modal-time" value="${currentTime}" />
        </div>
        <div class="form-actions">
          <button class="btn btn-secondary" onclick="document.getElementById('modal-overlay').style.display='none'">Cancel</button>
          <button class="btn btn-primary" id="modal-save">Save</button>
        </div>
      `);
      document.getElementById('modal-save')?.addEventListener('click', async () => {
        const time = document.getElementById('modal-time')?.value;
        if (time) {
          await postJson(`/api/scheduled/${name}/schedule`, { time_utc: time });
          closeModal();
          await refresh();
        }
      });
    }

    if (btn.dataset.action === 'view-logs') {
      const data = await fetchJson(`/api/scheduled/${name}/logs`);
      const lines = data?.lines?.join('\n') || '(no logs)';
      const stateJson = data?.state ? JSON.stringify(data.state, null, 2) : '(no state)';
      showModal(`
        <h2>Logs: ${escapeHtml(name)}</h2>
        <div class="form-group">
          <label>Last Run State</label>
          <div class="log-viewer">${escapeHtml(stateJson)}</div>
        </div>
        <div class="form-group">
          <label>Output (last 100 lines)</label>
          <div class="log-viewer">${escapeHtml(lines)}</div>
        </div>
        <div class="form-actions">
          <button class="btn btn-secondary" onclick="document.getElementById('modal-overlay').style.display='none'">Close</button>
        </div>
      `);
    }
  });
}

registerTab('scheduled', { init, onActivate: refresh });
