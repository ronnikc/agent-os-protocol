/**
 * Requests Tab — Human approval workflow (promoted from lobby sub-tab).
 * Shows pending requests with Approve/Reject/Defer + decision notes.
 */
import { fetchJson, postJson, registerTab, escapeHtml, formatTime, formatDate, onWsMessage } from '../app.js';

let requests = [];

function renderRequests() {
  const el = document.getElementById('requests-content');
  if (!el) return;

  const pending = requests.filter(r => r.status === 'pending' || !r.status);
  const decided = requests.filter(r => r.status && r.status !== 'pending');

  // Update count badge
  const countEl = document.getElementById('requests-count');
  if (countEl) countEl.textContent = pending.length ? `${pending.length} pending` : '';

  el.innerHTML = `<div style="padding:12px;">
    ${pending.length ? `
      <div style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;margin-bottom:8px;">Pending (${pending.length})</div>
      ${pending.map(r => `
        <div class="card" style="margin-bottom:10px;border-left:3px solid var(--warning);">
          <div style="display:flex;justify-content:space-between;align-items:start;">
            <div>
              <strong style="font-size:14px;">${escapeHtml(r.title || 'Request')}</strong>
              <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">
                from <strong>${escapeHtml(r.agent_display_name || r.agent_id || r.from || '?')}</strong>
                <span class="badge badge-muted" style="margin-left:4px">${escapeHtml(r.category || 'general')}</span>
                <span style="margin-left:8px">${formatDate(r.created_at)}</span>
              </div>
            </div>
            <span class="badge badge-warning">Pending</span>
          </div>
          ${r.description ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:8px;white-space:pre-wrap;">${escapeHtml(r.description.slice(0, 400))}</div>` : ''}
          ${r.context ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px;font-family:var(--mono);">${escapeHtml(String(r.context).slice(0, 200))}</div>` : ''}
          <div style="margin-top:10px;">
            <input type="text" id="request-notes-${r.request_id || r.id}" placeholder="Decision notes (optional)" style="width:100%;background:var(--bg-base);border:1px solid var(--border);color:var(--text-primary);padding:8px 10px;border-radius:4px;font-size:12px;margin-bottom:8px;" />
            <div style="display:flex;gap:8px;">
              <button class="btn btn-success btn-sm" data-action="decide" data-id="${r.request_id || r.id}" data-decision="approved">Approve</button>
              <button class="btn btn-danger btn-sm" data-action="decide" data-id="${r.request_id || r.id}" data-decision="rejected">Reject</button>
              <button class="btn btn-secondary btn-sm" data-action="decide" data-id="${r.request_id || r.id}" data-decision="deferred">Defer</button>
            </div>
          </div>
        </div>
      `).join('')}
    ` : '<div class="empty-state" style="padding:40px;">No pending approval requests</div>'}

    ${decided.length ? `
      <div style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;margin:20px 0 8px;">Decided (${decided.length})</div>
      ${decided.map(r => `
        <div class="card" style="margin-bottom:6px;opacity:0.6;">
          <div style="display:flex;justify-content:space-between;">
            <div>
              <strong style="font-size:13px;">${escapeHtml(r.title || 'Request')}</strong>
              <span style="font-size:11px;color:var(--text-muted);margin-left:8px;">from ${escapeHtml(r.agent_display_name || r.from || '?')}</span>
            </div>
            <span class="badge ${r.status === 'approved' ? 'badge-success' : r.status === 'rejected' ? 'badge-danger' : 'badge-muted'}">${r.status}</span>
          </div>
          ${r.decision_notes ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">Notes: ${escapeHtml(r.decision_notes)}</div>` : ''}
        </div>
      `).join('')}
    ` : ''}
  </div>`;
}

async function refresh() {
  let remoteRequests = [];
  let localRequests = [];

  // Try remote lobby requests (staging proxy — may fail without auth)
  const remoteData = await fetchJson('/api/lobby/remote/requests');
  if (remoteData && !remoteData.error) {
    remoteRequests = remoteData.requests || (Array.isArray(remoteData) ? remoteData : []);
  }

  // Always try local lobby requests (stores staging WS-received requests + local mode requests)
  const localData = await fetchJson('/api/v1/agent-lobby/lobbies/local/requests/pending');
  if (localData?.requests) {
    localRequests = localData.requests;
  }

  // Merge and dedup by request_id
  const seen = new Set();
  requests = [...remoteRequests, ...localRequests].filter(r => {
    if (!r.request_id || seen.has(r.request_id)) return false;
    seen.add(r.request_id);
    return true;
  });

  renderRequests();
}

function init() {
  refresh();

  // Delegated click handler for decisions
  document.getElementById('requests-content')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="decide"]');
    if (!btn) return;
    const id = btn.dataset.id;
    const decision = btn.dataset.decision;
    const notesEl = document.getElementById(`request-notes-${id}`);
    const notes = notesEl?.value || '';

    // Try remote first, fall back to local lobby
    let result = await postJson(`/api/lobby/remote/requests/${id}/decide`, {
      decision,
      decided_by: 'panel',
      decision_notes: notes,
    });
    if (!result?.ok) {
      await postJson(`/api/v1/agent-lobby/lobbies/local/requests/${id}/decide`, {
        decision,
        decided_by: 'panel',
        decision_notes: notes,
      });
    }
    await refresh();
  });

  // Real-time WS listener for new requests. In Local Mode the panel-server re-broadcasts hand-raises
  // and requests as 'lobby-request'; in Hosted Mode the panel receives the lobby's raw
  // 'lobby-request-created' directly — listen for both so a raised hand appears immediately.
  onWsMessage('lobby-request', () => { refresh(); });
  onWsMessage('lobby-request-created', () => { refresh(); });
  onWsMessage('lobby-request-decided', () => { refresh(); });

  // Auto-refresh every 10s
  setInterval(refresh, 10000);
}

registerTab('requests', { init, onActivate: refresh });
