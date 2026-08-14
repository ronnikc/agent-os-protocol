/**
 * Messages Tab — Enhanced message bus viewer with filtering, threading, send
 */
import { state, fetchJson, postJson, registerTab, onWsMessage, formatTime, escapeHtml, truncate, renderMarkdownSafe, agentName, refreshAgentNameMap } from '../app.js';

let messages = [];
let wsMessages = []; // lobby messages received via WebSocket (persist across refresh)
let lastSource = '';
let filters = { agent: '', type: '', limit: 50 };

// Chat-grade markdown (shared with UI Assist / Tasks) — replaces the old marked-or-escape path,
// which rendered raw markdown when `marked` wasn't loaded (the smoother UI Assist rendering).
function renderMessageContent(content) {
  return renderMarkdownSafe(content);
}

// Render a KB attachment chip beneath a message: filename + size, an image/file icon, and the linked
// task when present. The file itself lives in the Knowledge Base (ingested as a KB sync job).
function renderAttachment(att) {
  if (!att || !att.file_name) return '';
  const icon = att.is_image ? '🖼️' : '📄';
  const size = att.size_bytes ? ` <span style="color:var(--text-muted);">(${(att.size_bytes / 1024).toFixed(0)} KB)</span>` : '';
  const task = att.task_id ? ` · <span style="color:var(--text-muted);">task <code>${escapeHtml(truncate(att.task_id, 12))}</code></span>` : '';
  return `<div class="feed-attachment" style="margin-top:6px;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;display:inline-flex;gap:6px;align-items:center;">
    ${icon} <strong>${escapeHtml(att.file_name)}</strong>${size}
    <span style="color:var(--success);">→ Knowledge Base</span>${task}
  </div>`;
}

function renderMessages() {
  const feed = document.getElementById('message-feed');
  if (!feed) return;

  if (!messages.length) {
    feed.innerHTML = '<div class="empty-state">No messages in the bus</div>';
    return;
  }

  // Newest first — the freshest exchange is what the user is watching; chronological-ascending
  // kept pushing it below the fold.
  const ordered = [...messages].sort((a, b) => {
    const ta = Date.parse(a?.created_at || a?.timestamp || 0) || 0;
    const tb = Date.parse(b?.created_at || b?.timestamp || 0) || 0;
    return tb - ta;
  });
  let html = ordered.map(m => {
    if (typeof m === 'string') return `<div class="feed-item">${escapeHtml(m)}</div>`;
    const time = formatTime(m.created_at || m.timestamp);
    // Resolve raw agent ids to names (boss/agents showed long uuids in the log otherwise).
    const from = m.from_display_name || (m.from_agent_id ? agentName(m.from_agent_id) : (m.from || '?'));
    const to = m.to_display_name || (m.to_agent_id ? agentName(m.to_agent_id) : (m.to || '*'));
    const type = m.message_type || m.type || 'finding';
    const typeClass = `feed-type-${type}`;
    const isLobby = m.source === 'staging' || m.source === 'lobby' || m.from_agent_id;
    const stagingBadge = isLobby ? '<span style="color:var(--success);font-size:10px;margin-left:4px;">[lobby]</span>' : '';
    const content = renderMessageContent(m.content || '');
    const attachmentHtml = renderAttachment(m.attachment);
    // Header line, then the message content on its OWN block so multi-paragraph markdown (headings,
    // lists, code) renders with real structure instead of being crammed inline after "from→to:".
    return `<div class="feed-item" style="white-space:normal;">
      <div class="feed-head">
        <span class="feed-time">${time}</span>
        <span class="feed-type ${typeClass}">[${type}]</span>
        <strong>${escapeHtml(from)}</strong>&rarr;${escapeHtml(to)}${stagingBadge}
      </div>
      <div class="feed-content markdown-body">${content}</div>
      ${attachmentHtml}
    </div>`;
  }).join('');
  feed.innerHTML = html;
  feed.scrollTop = 0; // newest is at the top now
}

function renderFilterBar() {
  const agentOptions = ['', ...new Set(state.agents.map(a => a.slug))];
  const typeOptions = ['', 'finding', 'handoff', 'blocker', 'completion', 'request', 'decision', 'change', 'discovery', 'gate-check'];

  const el = document.getElementById('message-filters');
  if (!el) return;
  el.innerHTML = `
    <label>Agent:</label>
    <select id="msg-filter-agent">
      ${agentOptions.map(a => `<option value="${a}" ${a === filters.agent ? 'selected' : ''}>${a || 'All'}</option>`).join('')}
    </select>
    <label>Type:</label>
    <select id="msg-filter-type">
      ${typeOptions.map(t => `<option value="${t}" ${t === filters.type ? 'selected' : ''}>${t || 'All'}</option>`).join('')}
    </select>
    <button class="btn btn-sm btn-secondary" id="msg-filter-apply">Apply</button>
    <button class="btn btn-sm btn-secondary" id="msg-filter-clear">Clear</button>
    <span style="flex:1"></span>
    <button class="btn btn-sm btn-danger" id="msg-clear-history" style="margin-right:8px;">Clear History</button>
    <span style="font-size:11px;color:var(--text-muted)">${messages.length} messages ${lastSource ? `(${lastSource})` : ''}</span>
  `;
}

let lobbyMode = 'local';

// ── Attachments (hosted lobby) ── A file/image chosen in the composer is ingested into the Knowledge
// Base AND posted to the feed, optionally linked to a task. Uploads are base64-encoded in the body.
function authHeaders() {
  const token = localStorage.getItem('agent-os-lobby-token');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

let stagedFile = null;

async function renderStagingBar() {
  const bar = document.getElementById('msg-attach-staging');
  if (!bar) return;
  if (!stagedFile) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
  // Offer to link the attachment to a task (best-effort — empty if none / not hosted).
  let tasks = [];
  try {
    const data = await fetchJson('/api/lobby/remote/tasks', { headers: authHeaders() });
    tasks = data?.tasks || [];
  } catch { /* no tasks available */ }
  const kb = (stagedFile.size / 1024).toFixed(0);
  const taskSelect = tasks.length
    ? `<label style="font-size:11px;color:var(--text-muted);">Link task:
         <select id="msg-attach-task" style="max-width:200px;">
           <option value="">— none —</option>
           ${tasks.map(t => `<option value="${escapeHtml(t.task_id)}">${escapeHtml(truncate(t.title || t.task_id, 40))}</option>`).join('')}
         </select></label>`
    : '';
  bar.style.display = 'flex';
  bar.style.gap = '8px';
  bar.style.alignItems = 'center';
  bar.style.flexWrap = 'wrap';
  bar.innerHTML = `
    <span style="font-size:12px;">📎 <strong>${escapeHtml(stagedFile.name)}</strong> <span style="color:var(--text-muted);">(${kb} KB)</span></span>
    ${taskSelect}
    <span style="flex:1"></span>
    <button class="btn btn-sm btn-primary" id="msg-attach-upload">Upload to KB</button>
    <button class="btn btn-sm btn-secondary" id="msg-attach-cancel">✕</button>`;
  document.getElementById('msg-attach-upload')?.addEventListener('click', uploadStaged);
  document.getElementById('msg-attach-cancel')?.addEventListener('click', () => { stagedFile = null; renderStagingBar(); });
}

async function uploadStaged() {
  if (!stagedFile) return;
  const btn = document.getElementById('msg-attach-upload');
  const taskId = document.getElementById('msg-attach-task')?.value || '';
  const note = document.getElementById('msg-send-content')?.value?.trim() || '';
  if (btn) { btn.disabled = true; btn.textContent = 'Uploading…'; }
  try {
    const file_content = await fileToBase64(stagedFile);
    const res = await fetchJson('/api/lobby/remote/messages/upload', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_name: stagedFile.name,
        mime_type: stagedFile.type || 'application/octet-stream',
        file_content,
        ...(taskId ? { task_id: taskId } : {}),
        ...(note ? { content: note } : {}),
      }),
    });
    if (res && (res.message || res.job)) {
      stagedFile = null;
      const contentEl = document.getElementById('msg-send-content');
      if (contentEl) contentEl.value = '';
      renderStagingBar();
      await refresh();
    } else {
      if (btn) { btn.disabled = false; btn.textContent = 'Upload to KB'; }
      alert(`Upload failed: ${res?.error || 'unknown error'}`);
    }
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Upload to KB'; }
    alert(`Upload failed: ${e?.message || e}`);
  }
}

async function refresh() {
  const modeData = await fetchJson('/api/mode');
  lobbyMode = modeData?.mode || 'local';
  if (lobbyMode === 'swarm') await refreshAgentNameMap();

  const params = new URLSearchParams();
  if (filters.agent) params.set('agent', filters.agent);
  if (filters.type) params.set('type', filters.type);
  params.set('limit', String(filters.limit));

  let data;
  if (lobbyMode === 'swarm') {
    const token = localStorage.getItem('agent-os-lobby-token');
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    data = await fetchJson(`/api/lobby/remote/messages?${params}`, { headers });
  } else {
    data = await fetchJson(`/api/messages?${params}`);
  }

  if (data) {
    const apiMessages = data.messages || [];
    // Merge API messages with WS-received lobby messages (dedup by content+from)
    const apiKeys = new Set(apiMessages.map(m => `${m.content || ''}::${m.from_agent_id || m.from || ''}`));
    const uniqueWs = wsMessages.filter(m => !apiKeys.has(`${m.content || ''}::${m.from_agent_id || m.from || ''}`));
    messages = [...apiMessages, ...uniqueWs]
      .sort((a, b) => (a.created_at || a.timestamp || '').localeCompare(b.created_at || b.timestamp || ''));
    lastSource = data.source || '';
    renderMessages();
    renderFilterBar();
  }
}

async function populateToDropdown() {
  const toEl = document.getElementById('msg-send-to');
  if (!toEl) return;
  const currentVal = toEl.value;
  let agents = [];
  if (lobbyMode === 'swarm') {
    const token = localStorage.getItem('agent-os-lobby-token');
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    const agentData = await fetchJson('/api/lobby/remote/agents', { headers });
    agents = (agentData?.agents || []).map(a => ({
      slug: a.agent_role || a.agent_id,
      name: a.display_name || a.agent_role
    }));
  } else {
    const agentData = await fetchJson('/api/agents');
    agents = agentData?.agents || state.agents || [];
  }
  toEl.innerHTML = '<option value="*">All Agents (broadcast)</option>' +
    agents.map(a => `<option value="${a.slug}">${a.name}</option>`).join('');
  if (currentVal && currentVal !== '*') toEl.value = currentVal;
}

function init() {
  refresh();
  populateToDropdown();

  // Filter controls
  document.getElementById('message-filters')?.addEventListener('click', (e) => {
    if (e.target.id === 'msg-filter-apply') {
      filters.agent = document.getElementById('msg-filter-agent')?.value || '';
      filters.type = document.getElementById('msg-filter-type')?.value || '';
      refresh();
    }
    if (e.target.id === 'msg-filter-clear') {
      filters.agent = '';
      filters.type = '';
      refresh();
    }
    if (e.target.id === 'msg-clear-history') {
      if (confirm('Clear all message history? This cannot be undone.')) {
        postJson('/api/messages/clear', {}).then(() => {
          messages = [];
          wsMessages = [];
          renderMessages();
          renderFilterBar();
        });
      }
    }
  });

  // Send message
  async function sendMessage() {
    const toEl = document.getElementById('msg-send-to');
    const contentEl = document.getElementById('msg-send-content');
    const typeEl = document.getElementById('msg-send-type');
    const content = contentEl?.value?.trim();
    if (!content) return;

    await postJson('/api/messages', {
      from: 'panel',
      to: toEl?.value || '*',
      type: typeEl?.value || 'finding',
      content,
    });

    if (contentEl) contentEl.value = '';
    await refresh();
  }

  document.getElementById('msg-send-btn')?.addEventListener('click', sendMessage);

  // Enter key sends message
  document.getElementById('msg-send-content')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendMessage(); }
  });

  // Attachments: 📎 opens the file picker; a chosen file is staged (with an optional task link) and
  // uploaded to the Knowledge Base. Hosted lobby only — the KB lives on the hosted lobby.
  const attachBtn = document.getElementById('msg-attach-btn');
  const attachInput = document.getElementById('msg-attach-input');
  attachBtn?.addEventListener('click', () => {
    if (lobbyMode !== 'swarm') { alert('File attachments are stored in the hosted lobby Knowledge Base — connect to a hosted lobby to upload.'); return; }
    attachInput?.click();
  });
  attachInput?.addEventListener('change', () => {
    const file = attachInput.files && attachInput.files[0];
    if (file) { stagedFile = file; renderStagingBar(); }
    attachInput.value = ''; // allow re-selecting the same file later
  });

  // WebSocket live updates (local bus.jsonl changes)
  onWsMessage('messages', () => { refresh(); });

  // WebSocket live updates from the lobby. Local Mode: the panel-server rebroadcasts as
  // 'lobby-message' with the payload in msg.data. Hosted Mode: the panel is connected straight to
  // the lobby WS and receives the raw 'lobby-message-received' frame, where the payload lives on
  // the frame itself (second arg) — data is undefined. Handle both shapes with one handler.
  const onLobbyChat = (data, raw) => {
    // Add lobby message to the display immediately
    const msg = data?.message || data || raw?.message;
    if (msg && (msg.content || msg.from_agent_id)) {
      const formatted = {
        timestamp: msg.created_at || msg.timestamp || new Date().toISOString(),
        from: msg.from_display_name || msg.from_agent_id || msg.from || '?',
        from_agent_id: msg.from_agent_id,
        from_display_name: msg.from_display_name,
        to: msg.to_display_name || (msg.to_agent_id === 'all' ? '*' : msg.to_agent_id) || msg.to || '*',
        to_agent_id: msg.to_agent_id,
        to_display_name: msg.to_display_name || (msg.to_agent_id === 'all' ? '*' : msg.to_agent_id),
        type: msg.message_type || msg.type || 'message',
        message_type: msg.message_type || msg.type || 'message',
        content: msg.content || '',
        attachment: msg.attachment,
        source: 'staging',
      };
      // Avoid duplicates (check last few messages)
      const isDupe = messages.slice(-5).some(m =>
        (m.content || '') === formatted.content && (m.from || m.from_agent_id || '') === formatted.from
      );
      if (!isDupe) {
        wsMessages.push(formatted); // persist across refresh cycles
        messages.push(formatted);
        lastSource = 'staging';
        renderMessages();
        renderFilterBar();
      }
    }
  };
  onWsMessage('lobby-message', onLobbyChat);
  onWsMessage('lobby-message-received', onLobbyChat);

  // Auto-refresh
  setInterval(refresh, 5000);
}

registerTab('messages', { init, onActivate: refresh });
