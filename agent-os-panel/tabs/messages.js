/**
 * Messages Tab — Enhanced message bus viewer with filtering, threading, send
 */
import { state, fetchJson, postJson, registerTab, onWsMessage, formatTime, escapeHtml, truncate } from '../app.js';

let messages = [];
let wsMessages = []; // lobby messages received via WebSocket (persist across refresh)
let lastSource = '';
let filters = { agent: '', type: '', limit: 50 };

// Render markdown content using marked (same library as UI Assist lobby)
function renderMessageContent(content) {
  if (!content) return '';
  if (typeof marked !== 'undefined' && marked.parse) {
    return marked.parse(content, { breaks: true });
  }
  // Fallback: escape HTML and convert newlines to <br>
  return escapeHtml(content).replace(/\n/g, '<br>');
}

function renderMessages() {
  const feed = document.getElementById('message-feed');
  if (!feed) return;

  if (!messages.length) {
    feed.innerHTML = '<div class="empty-state">No messages in the bus</div>';
    return;
  }

  let html = messages.map(m => {
    if (typeof m === 'string') return `<div class="feed-item">${escapeHtml(m)}</div>`;
    const time = formatTime(m.created_at || m.timestamp);
    const from = m.from_display_name || m.from || m.from_agent_id || '?';
    const to = m.to_display_name || (m.to_agent_id === 'all' ? '*' : m.to_agent_id) || m.to || '*';
    const type = m.message_type || m.type || 'finding';
    const typeClass = `feed-type-${type}`;
    const isLobby = m.source === 'staging' || m.source === 'lobby' || m.from_agent_id;
    const stagingBadge = isLobby ? '<span style="color:var(--success);font-size:10px;margin-left:4px;">[lobby]</span>' : '';
    const content = renderMessageContent(m.content || '');
    return `<div class="feed-item" style="white-space:normal;">
      <span class="feed-time">${time}</span>
      <span class="feed-type ${typeClass}">[${type}]</span>
      <strong>${escapeHtml(from)}</strong>&rarr;${escapeHtml(to)}:
      <span class="feed-content">${content}</span>${stagingBadge}
    </div>`;
  }).join('');
  feed.innerHTML = html;
  feed.scrollTop = feed.scrollHeight;
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

async function refresh() {
  const params = new URLSearchParams();
  if (filters.agent) params.set('agent', filters.agent);
  if (filters.type) params.set('type', filters.type);
  params.set('limit', String(filters.limit));

  const data = await fetchJson(`/api/messages?${params}`);
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
  const agentData = await fetchJson('/api/agents');
  const agents = agentData?.agents || state.agents || [];
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

  // WebSocket live updates (local bus.jsonl changes)
  onWsMessage('messages', () => { refresh(); });

  // WebSocket live updates from staging lobby
  onWsMessage('lobby-message', (data) => {
    // Add lobby message to the display immediately
    const msg = data?.message || data;
    if (msg) {
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
  });

  // Auto-refresh
  setInterval(refresh, 5000);
}

registerTab('messages', { init, onActivate: refresh });
