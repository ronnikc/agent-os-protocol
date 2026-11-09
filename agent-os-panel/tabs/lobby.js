/**
 * Lobby Tab — Agent roster + floor control + join/leave.
 * No sub-tabs — Messages, Tasks, and Requests are now top-level tabs.
 */
import { fetchJson, postJson, registerTab, onWsMessage, escapeHtml, formatTime, showModal, closeModal, showAlert, showHtmlAlert, showConfirm, signInToLobby } from '../app.js';

let lobbyState = { bossAgentSlug: null, phase: 'idle', handRaises: [], floorHolder: null, humanUsers: [] };
let remoteAgents = [];
let localAgents = [];
let lobbyConnected = false;
let currentUser = null;
let events = [];
let lobbyMode = 'local'; // 'local' or 'swarm'
let lobbyInfo = { id: null, name: null, url: null, connected: false }; // which lobby the panel is in
let createLobbyFormOpen = false;
let lobbySettings = null;
let lobbyMembers = [];
let lobbyGithub = null;

/**
 * Roster identity badge (Phase 8). Renders the verification status an agent presented at join time
 * — accountability at a glance, without exposing any human identity. Anonymous/unverified agents
 * get no badge (absence is itself information). Title shows the non-secret registry reference.
 */
function identityBadge(a) {
  const status = a.identity_status;
  if (!status || status === 'unverified') {
    // A linked-but-unverified DID is still worth showing — the agent presented an identity ref at
    // join time but no registry verifier is configured (or verification failed soft). Absence of
    // ANY badge previously made a freshly bound Agent ID look like the save didn't work.
    if (a.identity_ref) {
      return `<span class="badge badge-muted" style="margin-left:6px;font-size:10px;" title="ID linked (${escapeHtml(a.identity_ref)}) — not registry-verified: configure AGENT_OS_CONCORDIUM_INDEXER_URL on the lobby to verify">🔗 ID linked</span>`;
    }
    return '';
  }
  const map = {
    human_linked: ['badge-success', '✓ Human-linked', 'Backed by a verified human owner (Concordium VCK)'],
    org_linked: ['badge-success', '✓ Org-verified', 'Backed by a verified organization/domain (Concordium VCDC)'],
    registry_verified: ['badge-info', '✓ Registered', 'Resolves to a live registry record (DID verified)'],
    pending: ['badge-muted', '… Identity pending', 'Verification in flight or registry unreachable'],
    failed: ['badge-warning', '⚠ Identity failed', 'Reference did not resolve, is revoked, or is malformed'],
  };
  const entry = map[status];
  if (!entry) return '';
  const [cls, label, desc] = entry;
  const ref = a.identity_ref ? ` — ${a.identity_ref}` : '';
  return `<span class="badge ${cls}" style="margin-left:6px;font-size:10px;" title="${escapeHtml(desc + ref)}">${label}</span>`;
}

function renderJoinScreen() {
  const el = document.getElementById('lobby-content');
  if (!el) return;
  const savedDid = localStorage.getItem('agent-os-linked-did') || '';
  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;height:100%;min-height:400px;">
      <div style="width:420px;max-width:90vw;background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;padding:32px;">
        <h2 style="font-size:18px;font-weight:600;margin-bottom:24px;">Join Lobby</h2>
        <div style="margin-bottom:16px;">
          <label style="display:block;font-size:13px;color:var(--purple);margin-bottom:6px;">Display Name</label>
          <input type="text" id="lobby-join-name" placeholder="Ronni" style="width:100%;padding:12px 14px;background:var(--bg-elevated);border:1px solid var(--border-light);color:var(--text-primary);border-radius:8px;font-size:14px;" />
        </div>
        <div style="margin-bottom:16px;">
          <label style="display:block;font-size:13px;color:var(--purple);margin-bottom:6px;">Identity DID (Optional)</label>
          <input type="text" id="lobby-join-did" placeholder="did:ccd:mainnet:..." value="${escapeHtml(savedDid)}" style="width:100%;padding:12px 14px;background:var(--bg-elevated);border:1px solid var(--border-light);color:var(--text-primary);border-radius:8px;font-size:14px;" />
        </div>
        <div style="margin-bottom:24px;">
          <label style="display:block;font-size:13px;color:var(--purple);margin-bottom:6px;">Role</label>
          <select id="lobby-join-role" style="width:100%;padding:12px 14px;background:var(--bg-elevated);border:1px solid var(--border-light);color:var(--text-primary);border-radius:8px;font-size:14px;appearance:auto;">
            <option value="product-owner">Product Owner</option>
            <option value="reviewer">Reviewer</option>
            <option value="developer">Developer</option>
            <option value="architect">Architect</option>
            <option value="qa-lead">QA Lead</option>
            <option value="observer">Observer</option>
          </select>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button class="btn btn-secondary" style="padding:10px 20px;border-radius:8px;" onclick="window.history.back()">Cancel</button>
          <button class="btn btn-primary" id="lobby-join-btn" style="padding:10px 24px;border-radius:8px;font-size:14px;">Join</button>
        </div>
      </div>
    </div>`;
  document.getElementById('lobby-join-btn')?.addEventListener('click', async () => {
    const name = document.getElementById('lobby-join-name')?.value?.trim();
    const role = document.getElementById('lobby-join-role')?.value;
    const did = document.getElementById('lobby-join-did')?.value?.trim() || '';
    if (!name) return;
    currentUser = { name, role, type: 'human', joinedAt: new Date().toISOString() };
    if (did) {
      currentUser.identity_status = 'registry_verified';
      currentUser.agent_id = did;
      currentUser.join_token = did;
      try { localStorage.setItem('agent-os-linked-did', did); } catch {}
    }
    if (!lobbyState.humanUsers) lobbyState.humanUsers = [];
    lobbyState.humanUsers = lobbyState.humanUsers.filter(u => u.name !== name);
    lobbyState.humanUsers.push(currentUser);
    await postJson('/api/lobby/state', lobbyState);
    try { localStorage.setItem('agent-os-lobby-user', JSON.stringify(currentUser)); } catch {}
    renderLobby();
  });
}

// The roster polls + WS events re-render the whole tab via innerHTML, which used to wipe the
// Create Custom Lobby form while the user was typing. Capture its state (values, checked
// invitees, focus + caret) before a re-render and restore it after.
function captureCreateLobbyForm() {
  if (!createLobbyFormOpen) return null;
  const nameEl = document.getElementById('new-lobby-name');
  if (!nameEl) return null;
  const active = document.activeElement;
  return {
    name: nameEl.value,
    visibility: document.getElementById('new-lobby-visibility')?.value,
    policy: document.getElementById('new-lobby-policy')?.value,
    checked: [...document.querySelectorAll('input[name="invite-agent"]:checked')].map(cb => cb.value),
    focusId: active && active.id ? active.id : null,
    selStart: active && typeof active.selectionStart === 'number' ? active.selectionStart : null,
    selEnd: active && typeof active.selectionEnd === 'number' ? active.selectionEnd : null,
  };
}

function restoreCreateLobbyForm(saved) {
  if (!saved) return;
  const nameEl = document.getElementById('new-lobby-name');
  if (nameEl) nameEl.value = saved.name;
  const visEl = document.getElementById('new-lobby-visibility');
  if (visEl && saved.visibility) visEl.value = saved.visibility;
  const polEl = document.getElementById('new-lobby-policy');
  if (polEl && saved.policy) polEl.value = saved.policy;
  document.querySelectorAll('input[name="invite-agent"]').forEach(cb => {
    cb.checked = saved.checked.includes(cb.value);
  });
  if (saved.focusId) {
    const el = document.getElementById(saved.focusId);
    if (el) {
      el.focus();
      if (saved.selStart !== null && typeof el.setSelectionRange === 'function') {
        try { el.setSelectionRange(saved.selStart, saved.selEnd ?? saved.selStart); } catch {}
      }
    }
  }
}

function renderLobby() {
  const el = document.getElementById('lobby-content');
  if (!el) return;
  if (!currentUser) { renderJoinScreen(); return; }
  const savedForm = captureCreateLobbyForm();

  const isHuman = a => a.agent_role === 'observer' || a.agent_role === 'human' || a.is_human;
  const onlineAgents = remoteAgents.filter(a => a.status !== 'disconnected' && !isHuman(a));
  const onlineHumans = remoteAgents.filter(a => a.status !== 'disconnected' && isHuman(a));
  const offline = remoteAgents.filter(a => a.status === 'disconnected');
  const online = onlineAgents; // alias for count
  const humanUsers = onlineHumans.length ? onlineHumans : (lobbyState.humanUsers || []);

  // Membership Control picker — the set of connected participants (agents + humans) that are not
  // already members of this lobby. Lets the owner invite anyone in the roster directly instead of
  // hand-typing a DID.
  const memberRefs = new Set((lobbyMembers || []).map(m => m.identity_ref));
  const invitableParticipants = [
    ...onlineHumans.map(h => ({ id: h.identity_ref, label: `${h.display_name || h.name || h.agent_id} (human)` })),
    ...onlineAgents.map(a => ({ id: a.identity_ref, label: `${a.display_name || a.name || a.agent_id}${a.agent_role ? ` · ${a.agent_role}` : ''}` })),
  ].filter(p => p.id && !memberRefs.has(p.id));
  const invitePickerOptions = invitableParticipants
    .map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.label)}</option>`)
    .join('');

  const inviteCheckboxes = onlineAgents.map(a => `
    <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-secondary);cursor:pointer;background:var(--bg-base);padding:4px 8px;border-radius:4px;border:1px solid var(--border);">
      <input type="checkbox" name="invite-agent" value="${escapeHtml(a.agent_id)}" />
      ${escapeHtml(a.display_name || a.name || a.agent_id)}
    </label>
  `).join('') || '<span style="font-size:11px;color:var(--text-muted)">No other agents online to invite</span>';

  el.innerHTML = `
    <div style="padding:12px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border);">
      <div>
        <span style="font-size:15px;font-weight:600;">Agent Lobby</span>
        <span style="margin-left:8px;font-size:12px;color:var(--text-secondary);">
          <span class="status-dot ${lobbyConnected ? 'status-running' : 'status-stopped'}"></span>
          ${onlineAgents.length} agents${onlineHumans.length ? ` + ${onlineHumans.length} human${onlineHumans.length > 1 ? 's' : ''}` : ''} connected
        </span>
        ${lobbyInfo.id ? `
        <span style="margin-left:10px;font-size:11px;color:var(--text-muted);" title="${escapeHtml(lobbyInfo.url || '')}">
          ${lobbyMode === 'swarm' ? '🌐' : '🏠'} ${escapeHtml(lobbyInfo.name || 'Lobby')}
          <code style="font-size:10px;opacity:0.8;">${escapeHtml(String(lobbyInfo.id).slice(0, 8))}</code>
          ${lobbyMode === 'swarm' && !lobbyInfo.connected ? '<span class="badge badge-warning" style="margin-left:4px;font-size:9px;">reconnecting…</span>' : ''}
        </span>` : ''}
      </div>
      <div style="display:flex;gap:6px;">
        ${lobbyMode !== 'swarm' ? `
          <button class="btn btn-primary btn-sm" data-action="toggle-create-lobby" style="padding:4px 10px;">Create Lobby</button>
          <button class="btn btn-secondary btn-sm" data-action="leave-lobby">Leave Lobby</button>
        ` : ''}
        <button class="btn btn-warning btn-sm" data-action="pause-lobby">Pause</button>
        <button class="btn btn-danger btn-sm" data-action="close-lobby">Close Lobby</button>
      </div>
    </div>
    <div id="create-lobby-form-container" style="display: ${createLobbyFormOpen ? 'block' : 'none'}; background: var(--bg-surface); border-bottom: 1px solid var(--border); padding: 16px;">
      <h4 style="margin: 0 0 12px 0; font-size: 14px; font-weight: 600;">Create Custom Lobby</h4>
      <div style="display: flex; gap: 12px; margin-bottom: 12px; flex-wrap: wrap;">
        <div style="flex: 1; min-width: 180px;">
          <label style="display: block; font-size: 11px; color: var(--text-muted); margin-bottom: 4px;">Lobby Name</label>
          <input type="text" id="new-lobby-name" placeholder="Custom Swarm" style="width: 100%; padding: 6px 10px; background: var(--bg-elevated); border: 1px solid var(--border); color: var(--text-primary); border-radius: 4px; font-size: 12px;" />
        </div>
        <div style="width: 100px;">
          <label style="display: block; font-size: 11px; color: var(--text-muted); margin-bottom: 4px;">Visibility</label>
          <select id="new-lobby-visibility" style="width: 100%; padding: 6px 10px; background: var(--bg-elevated); border: 1px solid var(--border); color: var(--text-primary); border-radius: 4px; font-size: 12px; appearance: auto;">
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
        </div>
        <div style="flex: 1; min-width: 180px;">
          <label style="display: block; font-size: 11px; color: var(--text-muted); margin-bottom: 4px;">Join Policy</label>
          <select id="new-lobby-policy" style="width: 100%; padding: 6px 10px; background: var(--bg-elevated); border: 1px solid var(--border); color: var(--text-primary); border-radius: 4px; font-size: 12px; appearance: auto;">
            <option value="none">None (Anyone can join)</option>
            <option value="registered" selected>Registered ID (Verified ID required)</option>
            <option value="verified_human_link">Verified Human Link (Identity + Human Link)</option>
          </select>
        </div>
      </div>
      <div style="margin-bottom: 12px;">
        <label style="display: block; font-size: 11px; color: var(--text-muted); margin-bottom: 4px;">Invite Agents (select from current online agents)</label>
        <div style="display: flex; flex-wrap: wrap; gap: 8px; padding: 8px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 4px; max-height: 100px; overflow-y: auto;">
          ${inviteCheckboxes}
        </div>
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <button class="btn btn-secondary btn-sm" data-action="cancel-create-lobby">Cancel</button>
        <button class="btn btn-primary btn-sm" data-action="submit-create-lobby">Create & Invite</button>
      </div>
    </div>
    <div style="padding:12px;">
      ${online.map(a => {
        const isBoss = a.agent_id === lobbyState.bossAgentSlug;
        const isPanel = a.agent_role === 'panel' || (a.display_name || '').toLowerCase().startsWith('panel-');
        // Build role options from agent definitions (dynamic) instead of a hardcoded subset
        const allSlugs = (window.__agentDefinitions || []).map(d => d.slug).filter(Boolean);
        // Fallback: if definitions not loaded yet, use the agent's own role as the only option
        const roleSet = new Set(allSlugs.length > 0 ? allSlugs : ['general', 'backend', 'frontend', 'code-review', 'planning', 'research', 'boss-agent']);
        // Also include the agent's current role in case it's not in definitions
        if (a.agent_role) roleSet.add(a.agent_role);
        const roleOptions = [...roleSet].sort().map(r =>
          `<option value="${r}" ${(a.agent_role || '') === r ? 'selected' : ''}>${r}</option>`
        ).join('');
        return `
        <div class="card" style="margin-bottom:6px;${isBoss ? 'border-left:3px solid var(--warning);' : ''}${isPanel ? 'opacity:0.7;' : ''}">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div>
              <span class="status-dot status-running"></span>
              <strong>${escapeHtml(a.display_name || a.name || a.agent_id)}</strong>
              ${identityBadge(a)}
              ${a.identity_registry_links && a.identity_ref ? `
                <button type="button" class="btn btn-sm btn-secondary" data-action="agent-id-card" data-agent-id="${escapeHtml(a.agent_id)}">Agent ID Card</button>
              ` : ''}
              ${isPanel
                ? `<span class="badge badge-muted" style="margin-left:6px;font-size:10px;" title="Panel is a UI connection only, not a Claude session">panel (UI only)</span>`
                : `<select data-action="change-role" data-agent-id="${a.agent_id}" style="margin-left:6px;font-size:10px;padding:2px 4px;background:var(--bg-base);color:var(--text-secondary);border:1px solid var(--border);border-radius:3px;">
                <option value="" ${!a.agent_role ? 'selected' : ''}>no role</option>
                ${roleOptions}
              </select>`
              }
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="font-size:11px;color:var(--text-muted)">${a.status || 'idle'}</span>
              ${isBoss
                ? '<span class="badge badge-warning">Boss Agent</span>'
                : (isPanel
                  ? ''
                  : `<button class="btn btn-sm btn-secondary" data-action="appoint-boss" data-agent-id="${a.agent_id}">Appoint as Boss</button>`)
              }
            </div>
          </div>
          ${a.current_work ? `<div style="font-size:11px;color:var(--text-secondary);margin-top:4px;">${escapeHtml(a.current_work.slice(0, 80))}</div>` : ''}
          ${a.cwd ? `<div style="font-size:10px;color:var(--text-muted);margin-top:2px;">branch: ${a.branch || '?'} &nbsp; cwd: ${escapeHtml((a.cwd || '').slice(-40))} &nbsp; port: ${a.relay_port || '?'}</div>` : ''}
        </div>`;
      }).join('') || '<div class="empty-state" style="padding:20px;">No agents online</div>'}
      ${humanUsers.length ? `
        <div style="font-size:11px;color:var(--text-muted);margin:16px 0 6px;text-transform:uppercase;font-weight:600;">Human Participants</div>
        ${humanUsers.map(u => {
          const name = u.display_name || u.name || u.agent_id || '?';
          const role = u.agent_role || u.role || 'observer';
          return `
          <div class="card" style="margin-bottom:6px;border-left:3px solid var(--purple);">
            <span class="status-dot status-running"></span>
            <strong>${escapeHtml(name)}</strong>
            <span class="badge badge-muted" style="margin-left:4px">${escapeHtml(role)}</span>
            <span class="badge badge-success" style="margin-left:4px">Human</span>
            ${name === currentUser?.name ? '<span class="badge badge-info" style="margin-left:4px">You</span>' : ''}
          </div>`;
        }).join('')}
      ` : ''}
      ${offline.length ? `<div style="font-size:11px;color:var(--text-muted);margin:16px 0 6px;">+${offline.length} disconnected agent(s)</div>` : ''}
      ${events.length ? `
        <div style="font-size:11px;color:var(--text-muted);margin:16px 0 6px;text-transform:uppercase;font-weight:600;">Recent Events</div>
        <div class="feed">
          ${events.slice(-10).reverse().map(e => `
            <div class="feed-item">
              <span class="feed-time">${formatTime(e.ts)}</span>
              <span class="feed-type feed-type-${e.type === 'agent-start' ? 'completion' : 'blocker'}">[${e.type}]</span>
              ${escapeHtml(e.slug || '')}
            </div>
          `).join('')}
        </div>
      ` : ''}
      ${lobbyMode === 'swarm' && lobbySettings ? `
        <div style="margin-top:20px; display:grid; grid-template-columns:repeat(auto-fit, minmax(320px, 1fr)); gap:16px; border-top:1px solid var(--border); padding-top:20px;">
          
          <!-- Settings Column -->
          <div style="background:var(--bg-surface); border:1px solid var(--border); border-radius:8px; padding:16px; display:flex; flex-direction:column; gap:12px;">
            <h4 style="margin:0 0 4px 0; font-size:14px; font-weight:600; color:var(--text-primary);">Lobby Settings</h4>
            <span style="font-size:11px; color:var(--text-muted); display:block; margin-bottom:4px;">Configure visibility and policy access rules for this remote swarm.</span>
            
            <div>
              <label style="display:block; font-size:11px; color:var(--text-muted); margin-bottom:4px;">Lobby Name</label>
              <input type="text" id="settings-lobby-name" value="${escapeHtml(lobbySettings.name || '')}" style="width:100%; padding:6px 10px; background:var(--bg-elevated); border:1px solid var(--border); color:var(--text-primary); border-radius:4px; font-size:12px;" />
            </div>
            
            <div style="display:flex; gap:10px;">
              <div style="flex:1;">
                <label style="display:block; font-size:11px; color:var(--text-muted); margin-bottom:4px;">Visibility</label>
                <select id="settings-lobby-visibility" style="width:100%; padding:6px 10px; background:var(--bg-elevated); border:1px solid var(--border); color:var(--text-primary); border-radius:4px; font-size:12px; appearance:auto;">
                  <option value="public" ${lobbySettings.visibility === 'public' ? 'selected' : ''}>Public</option>
                  <option value="private" ${lobbySettings.visibility === 'private' ? 'selected' : ''}>Private</option>
                </select>
              </div>
              <div style="flex:1.2;">
                <label style="display:block; font-size:11px; color:var(--text-muted); margin-bottom:4px;">Join Policy</label>
                <select id="settings-lobby-policy" style="width:100%; padding:6px 10px; background:var(--bg-elevated); border:1px solid var(--border); color:var(--text-primary); border-radius:4px; font-size:12px; appearance:auto;">
                  <option value="none" ${lobbySettings.join_policy === 'none' ? 'selected' : ''}>None (Open)</option>
                  <option value="registered" ${lobbySettings.join_policy === 'registered' ? 'selected' : ''}>Registered ID</option>
                  <option value="verified_human_link" ${lobbySettings.join_policy === 'verified_human_link' ? 'selected' : ''}>Verified Human Link</option>
                </select>
              </div>
            </div>
            
            <button class="btn btn-primary btn-sm" id="btn-save-lobby-settings" style="margin-top:8px;">Save Settings</button>
          </div>

          <!-- Members Column -->
          <div style="background:var(--bg-surface); border:1px solid var(--border); border-radius:8px; padding:16px; display:flex; flex-direction:column; gap:12px;">
            <h4 style="margin:0 0 4px 0; font-size:14px; font-weight:600; color:var(--text-primary);">Membership Control</h4>
            <span style="font-size:11px; color:var(--text-muted); display:block; margin-bottom:4px;">Invite Concordium DIDs or local agents, and manage floor permissions.</span>
            
            <div style="display:flex; gap:6px; margin-bottom:6px;">
              <select id="invite-member-picker" style="flex:1; padding:6px 10px; background:var(--bg-elevated); border:1px solid var(--border); color:var(--text-primary); border-radius:4px; font-size:12px; appearance:auto;">
                <option value="">${invitableParticipants.length ? 'Select a connected agent or human…' : 'No connected participants to invite'}</option>
                ${invitePickerOptions}
              </select>
            </div>
            <div style="display:flex; gap:6px;">
              <input type="text" id="invite-member-did" placeholder="…or paste a did:ccd:mainnet: / agent id" style="flex:1; padding:6px 10px; background:var(--bg-elevated); border:1px solid var(--border); color:var(--text-primary); border-radius:4px; font-size:12px;" />
              <select id="invite-member-role" style="padding:6px 10px; background:var(--bg-elevated); border:1px solid var(--border); color:var(--text-primary); border-radius:4px; font-size:12px; appearance:auto;">
                <option value="contributor">Contributor</option>
                <option value="admin">Admin</option>
                <option value="observer">Observer</option>
              </select>
              <button class="btn btn-secondary btn-sm" id="btn-invite-member">Invite</button>
            </div>

            <div style="max-height:140px; overflow-y:auto; border:1px solid var(--border); border-radius:4px; background:var(--bg-elevated); padding:4px;">
              ${lobbyMembers.map(m => `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 8px; border-bottom:1px solid var(--border-light); font-size:11px;">
                  <div style="display:flex; flex-direction:column;">
                    <span style="font-family:monospace; color:var(--text-primary);" title="${escapeHtml(m.identity_ref)}">${escapeHtml(m.identity_ref.slice(0, 15))}...</span>
                    <span style="color:var(--text-muted); font-size:9px;">Role: ${m.role} (${m.status})</span>
                  </div>
                  ${m.role === 'owner' ? '' : m.status === 'revoked' ? `
                    <span style="color:var(--color-red); font-weight:600; font-size:9px; text-transform:uppercase;">Kicked</span>
                  ` : `
                    <div>
                      ${m.status === 'invited' ? `<button class="btn btn-secondary btn-sm" data-member-status="active" data-member-id="${escapeHtml(m.id)}">Activate</button>` : ''}
                      <button class="btn btn-danger btn-sm" data-member-status="revoked" data-member-id="${escapeHtml(m.id)}">Kick</button>
                    </div>
                  `}
                </div>
              `).join('') || '<div style="padding:12px; text-align:center; color:var(--text-muted); font-size:11px;">No members invited.</div>'}
            </div>
          </div>

          <!-- GitHub Connection Column -->
          <div style="background:var(--bg-surface); border:1px solid var(--border); border-radius:8px; padding:16px; display:flex; flex-direction:column; gap:12px;">
            <h4 style="margin:0 0 4px 0; font-size:14px; font-weight:600; color:var(--text-primary);">GitHub Swarm Connection</h4>
            <span style="font-size:11px; color:var(--text-muted); display:block; margin-bottom:4px; line-height:1.45;">
              Connect your GitHub repository via the Agent OS GitHub App. This grants the swarm secure, scoped access to read your codebase, run background checks, and propose code fixes as pull requests.
            </span>
            
            <div id="panel-github-status-container">
              ${!lobbyGithub || !lobbyGithub.connected ? `
                ${lobbyGithub?.configured === false ? `
                  <div style="display:flex; flex-direction:column; gap:8px;">
                    <span style="color:var(--color-yellow); font-size:12px; line-height:1.4;">GitHub App is not configured on this lobby server.</span>
                    <button class="btn btn-primary btn-sm" id="btn-panel-github-setup" style="width:100%; padding:8px 12px; font-size:12px; height:auto;">Register GitHub App automatically</button>
                  </div>
                ` : `
                  <button class="btn btn-primary btn-sm" id="btn-panel-github-connect" style="width:100%; padding:8px 12px; font-size:12px; height:auto;">Connect via GitHub App</button>
                  <span style="font-size:10px; color:var(--text-muted); display:block; margin-top:8px; line-height:1.4;">
                    Clicking will redirect to GitHub to authorize the app and select your working repositories.
                  </span>
                `}
              ` : `
                <div style="display:flex; flex-direction:column; gap:10px;">
                  <div style="font-size:12px; background:rgba(0,200,100,0.05); padding:8px; border-radius:4px; border:1px solid rgba(0,200,100,0.15);">
                    <span style="color:var(--color-green); font-weight:600;">✓ Connected Account:</span>
                    <span style="color:var(--text-secondary); font-family:monospace; display:block; margin-top:2px;">${escapeHtml(lobbyGithub.account || '')}</span>
                  </div>
                  
                  <div>
                    <label style="display:block; font-size:11px; color:var(--text-muted); margin-bottom:4px;">Target Repository</label>
                    <select id="panel-github-repo" style="width:100%; padding:6px 10px; background:var(--bg-elevated); border:1px solid var(--border); color:var(--text-primary); border-radius:4px; font-size:12px; appearance:auto;" ${lobbyGithub.isManager === false ? 'disabled' : ''}>
                      ${(lobbyGithub.repos || []).map(r => `
                        <option value="${escapeHtml(r.full_name)}" ${r.full_name === lobbyGithub.repo ? 'selected' : ''}>${escapeHtml(r.full_name)}${r.private ? ' 🔒' : ''}</option>
                      `).join('') || (lobbyGithub.repo ? `<option value="${escapeHtml(lobbyGithub.repo)}" selected>${escapeHtml(lobbyGithub.repo)}</option>` : '<option value="">(no repositories configured)</option>')}
                    </select>
                  </div>
                  
                  <div>
                    <label style="display:block; font-size:11px; color:var(--text-muted); margin-bottom:4px;">Working Branch (optional)</label>
                    <input type="text" id="panel-github-branch" placeholder="main" value="${escapeHtml(lobbyGithub.branch || '')}" style="width:100%; padding:6px 10px; background:var(--bg-elevated); border:1px solid var(--border); color:var(--text-primary); border-radius:4px; font-size:12px;" ${lobbyGithub.isManager === false ? 'disabled' : ''} />
                  </div>
                  ${lobbyGithub.repo ? (lobbyGithub.initialized ? `
                    <div style="font-size:11px; padding:8px; border-radius:4px; background:rgba(0,200,100,0.05); border:1px solid rgba(0,200,100,0.15); color:var(--text-secondary); line-height:1.45;">
                      <span style="color:var(--color-green); font-weight:600;">✓ Agent OS structure initialized</span> —
                      <code style="font-size:10px;">agent-os/</code> in <strong>${escapeHtml(lobbyGithub.repo)}</strong> holds the agent definitions (+ bound Agent IDs), skills, scheduled prompts, shared memories, and trained packs this lobby manages.
                    </div>
                    ${lobbyGithub.isManager !== false ? `<button class="btn btn-secondary btn-sm" id="btn-panel-github-init" style="width:100%;" title="Safe re-run: commits only files added in newer Agent OS versions (README, planning, …) — anything already in the repo is never touched">Re-run initialization (add new/missing files)</button>` : ''}
                  ` : `
                    <div style="font-size:11px; padding:8px; border-radius:4px; background:rgba(234,179,8,0.06); border:1px solid rgba(234,179,8,0.18); color:var(--text-secondary); line-height:1.45;">
                      <span style="color:var(--color-yellow); font-weight:600;">Repository not initialized.</span>
                      Seed <strong>${escapeHtml(lobbyGithub.repo)}</strong> with the Agent OS structure — agent definitions, skills, scheduled self-learning prompts, and the shared-memory/training scaffolding — in one commit so the lobby can manage agents, IDs, and memories there.
                    </div>
                    ${lobbyGithub.isManager !== false ? `<button class="btn btn-primary btn-sm" id="btn-panel-github-init" style="width:100%;">Initialize Agent OS structure in ${escapeHtml(lobbyGithub.repo)}</button>` : ''}
                  `) : ''}

                  ${lobbyGithub.repo ? `
                    <div style="font-size:11px; padding:8px; border-radius:4px; background:rgba(120,140,180,0.06); border:1px solid var(--color-border); color:var(--text-secondary); line-height:1.45; margin-top:4px;">
                      Deploy (Vercel), CI (build &amp; test), and chat apps (Slack, Discord, Telegram) moved to the <strong>Apps</strong> tab.
                    </div>
                  ` : ''}

                  ${lobbyGithub.isManager === false ? `
                    <div style="display:flex; align-items:center; justify-content:space-between; font-size:11px; color:var(--text-muted); background:var(--bg-elevated); padding:6px 10px; border-radius:4px; border:1px solid var(--border); margin-top:4px;">
                      <span>🔒 View-only (Sign in to edit)</span>
                      <button class="btn btn-secondary btn-sm" id="btn-panel-github-signin" style="font-size:11px; padding:2px 8px;">Sign In</button>
                    </div>
                  ` : `
                    <div style="display:flex; gap:6px; margin-top:4px;">
                      <button class="btn btn-secondary btn-sm" id="btn-panel-github-save-repo" style="flex:1;">Save Settings</button>
                      <button class="btn btn-danger btn-sm" id="btn-panel-github-disconnect">Disconnect</button>
                    </div>
                  `}
                </div>
              `}
            </div>
          </div>

        </div>
      ` : ''}
    </div>
  `;
  restoreCreateLobbyForm(savedForm);

  if (lobbyMode === 'swarm' && lobbySettings) {
    document.getElementById('btn-save-lobby-settings')?.addEventListener('click', async () => {
      const name = document.getElementById('settings-lobby-name')?.value?.trim();
      const visibility = document.getElementById('settings-lobby-visibility')?.value;
      const join_policy = document.getElementById('settings-lobby-policy')?.value;
      if (!name) return;
      const s = JSON.parse(localStorage.getItem('agentos.hosted.session') || 'null');
      const res = await fetchJson('/api/lobby/remote/settings', {
        method: 'PATCH',
        body: JSON.stringify({ name, visibility, join_policy, actor: s?.identityRef })
      });
      if (res && !res.error) {
        showAlert('Settings Saved', 'Lobby settings successfully updated on the remote swarm.');
        refresh();
      } else {
        showAlert('Failed to Save Settings', res?.error || 'Unknown error');
      }
    });

    // Selecting a connected participant fills the identity field so Invite works with one click.
    document.getElementById('invite-member-picker')?.addEventListener('change', (e) => {
      const val = e.target.value;
      const didInput = document.getElementById('invite-member-did');
      if (val && didInput) didInput.value = val;
    });

    document.getElementById('btn-invite-member')?.addEventListener('click', async () => {
      const identity_ref = document.getElementById('invite-member-did')?.value?.trim()
        || document.getElementById('invite-member-picker')?.value?.trim();
      const role = document.getElementById('invite-member-role')?.value;
      if (!identity_ref) return;
      const res = await fetchJson('/api/lobby/remote/members', {
        method: 'POST',
        body: JSON.stringify({ identity_ref, role })
      });
      if (res && !res.error) {
        showAlert('Member Invited', 'Successfully invited member DID to join this remote swarm.');
        refresh();
      } else {
        showAlert('Failed to Invite Member', res?.error || 'Unknown error');
      }
    });

    el.querySelectorAll('[data-member-status]').forEach(b => {
      b.addEventListener('click', async () => {
        const { memberId, memberStatus } = b.dataset;
        const res = await fetchJson(`/api/lobby/remote/members/${memberId}/status`, {
          method: 'POST',
          body: JSON.stringify({ status: memberStatus })
        });
        if (res && !res.error) {
          refresh();
        } else {
          showAlert('Could Not Update Member', res?.error || 'Unknown error');
        }
      });
    });

    // GitHub Connection event listeners
    document.getElementById('btn-panel-github-setup')?.addEventListener('click', async () => {
      const modeData = await fetchJson('/api/mode');
      const lobbyUrl = modeData?.lobbyUrl || window.location.origin;
      // NOTE: Do NOT include `hook_attributes` unless it carries a `url`. GitHub's manifest parser
      // requires `hook_attributes.url` whenever the object is present, and reports its absence as the
      // confusingly generic "Error 'url' wasn't supplied." (the top-level `url` below IS supplied).
      // Since we register no webhook (`default_events: []`), we omit `hook_attributes` entirely.
      const manifest = {
        name: `Agent OS Swarm ${lobbyInfo.id ? lobbyInfo.id.slice(0, 8) : 'Local'}`,
        url: lobbyUrl,
        // `redirect_url` fires ONCE, right after the app is created from this manifest (carries the
        // temporary `code` we exchange in setup-callback). `setup_url` is what GitHub redirects to
        // AFTER the user installs the app on their repos — it carries `installation_id` + our `state`,
        // which the callback handler needs to record the installation. Without setup_url the app
        // installs on GitHub but the lobby never learns about it, so the panel stays on "Connect".
        redirect_url: `${lobbyUrl}/api/v1/agent-lobby/integrations/github/setup-callback`,
        setup_url: `${lobbyUrl}/api/v1/agent-lobby/integrations/github/callback`,
        setup_on_update: false,
        public: false,
        default_permissions: {
          contents: "write",
          pull_requests: "write",
          metadata: "read",
          // Read CI results on task PRs: check runs need `checks`, Actions runs/logs need `actions`.
          checks: "read",
          actions: "read"
        },
        default_events: []
      };
      if (!lobbyUrl || !/^https?:\/\//i.test(lobbyUrl)) {
        showAlert('Cannot Register App', `The lobby URL ("${lobbyUrl || 'empty'}") is not a valid http(s) URL, so GitHub would reject the manifest. Open the panel over its public https URL and try again.`);
        return;
      }

      // Open a new window and build+submit the manifest form inside it.
      // Previous approaches (setAttribute, .value on current-doc form with target=_blank) all
      // failed with GitHub returning "url wasn't supplied" — the cross-origin form POST from the
      // parent document mangles the JSON encoding. Building the form in the target window's own
      // DOM avoids this.
      const manifestJson = JSON.stringify(manifest);
      const w = window.open('about:blank', '_blank');
      if (!w) {
        showAlert('Popup Blocked', 'Please allow popups for this site and try again.');
        return;
      }
      w.document.open();
      w.document.write(`<!DOCTYPE html><html><head><title>Redirecting to GitHub...</title></head><body>
        <p>Redirecting to GitHub to create App...</p>
        <form id="manifest-form" method="POST" action="https://github.com/settings/apps/new">
          <input type="hidden" name="manifest" id="manifest-input">
        </form>
        <script>
          document.getElementById('manifest-input').value = ${JSON.stringify(manifestJson)};
          document.getElementById('manifest-form').submit();
        </script>
      </body></html>`);
      w.document.close();
    });

    async function executeGithubConnect() {
      // Check if the app is already connected (e.g. auto-adopted) before opening the install page.
      const status = await fetchJson('/api/lobby/remote/integrations/github');
      if (status && status.connected) {
        lobbyGithub = status;
        refresh();
        return;
      }
      const res = await fetchJson('/api/lobby/remote/integrations/github/connect', { method: 'POST' });
      if (res && res.install_url) {
        window.open(res.install_url, '_blank', 'noopener');
        refresh();
      } else if (!handleGithubAuthError(res, executeGithubConnect)) {
        showAlert('Error', 'Could not start GitHub connect: ' + (res?.error || 'Unknown error'));
      }
    }

    function handleGithubAuthError(res, retryFn) {
      const errStr = String(res?.error || res || '');
      if (errStr.includes('authentication required') || errStr.includes('not authorized')) {
        showConfirm(
          'Lobby Sign-In Required',
          'You are not signed in or authorized to manage GitHub integrations for this remote swarm lobby.\n\nWould you like to sign in now using your connected Concordium wallet?',
          async () => {
            try {
              await signInToLobby({ reload: false });
              // After sign-in, check if the connection is already active (auto-adopted).
              // If so, just refresh the panel instead of blindly retrying the original action.
              const status = await fetchJson('/api/lobby/remote/integrations/github');
              if (status && status.connected) {
                lobbyGithub = status;
                refresh();
                return;
              }
              if (typeof retryFn === 'function') {
                await retryFn();
              } else {
                refresh();
              }
            } catch (e) {
              showAlert('Sign-In Failed', e.message || String(e));
            }
          }
        );
        return true;
      }
      return false;
    }

    document.getElementById('btn-panel-github-signin')?.addEventListener('click', async () => {
      try {
        await signInToLobby({ reload: false });
        showAlert('Signed In', 'Successfully signed in to lobby.');
        refresh();
      } catch (e) {
        showAlert('Sign-In Failed', e.message || String(e));
      }
    });

    document.getElementById('btn-panel-github-connect')?.addEventListener('click', executeGithubConnect);

    document.getElementById('btn-panel-github-init')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-panel-github-init');
      if (btn) { btn.disabled = true; btn.textContent = 'Initializing… (one batch commit)'; }
      const res = await fetchJson('/api/lobby/remote/repo/initialize', { method: 'POST' });
      if (res && res.ok) {
        showAlert('Repository Initialized', `Committed ${res.files_committed} file(s) to ${res.repo}@${res.branch} (${res.skipped_existing} already present were left untouched). The lobby now manages agents, IDs, skills, memories, and trained packs in this repository.`);
        refresh();
      } else {
        if (btn) { btn.disabled = false; btn.textContent = 'Initialize Agent OS structure'; }
        showAlert('Initialization Failed', res?.error || 'Unknown error');
      }
    });

    async function executeSaveRepo() {
      const repo = document.getElementById('panel-github-repo')?.value;
      const branch = document.getElementById('panel-github-branch')?.value?.trim() || undefined;
      if (!repo) {
        showAlert('Error', 'Please select a repository.');
        return;
      }
      const res = await fetchJson('/api/lobby/remote/integrations/github', {
        method: 'POST',
        body: JSON.stringify({ repo, branch })
      });
      if (res && !res.error) {
        showAlert('Success', 'GitHub repository linked successfully!');
        refresh();
      } else if (!handleGithubAuthError(res, executeSaveRepo)) {
        showAlert('Error', 'Could not set repo: ' + (res?.error || 'Unknown error'));
      }
    }

    document.getElementById('btn-panel-github-save-repo')?.addEventListener('click', executeSaveRepo);

    async function executeDisconnectRepo() {
      showConfirm(
        'Disconnect GitHub',
        'Disconnect the GitHub repository from this lobby? Your agents will lose access to repo files.',
        async () => {
          const res = await fetchJson('/api/lobby/remote/integrations/github', { method: 'DELETE' });
          if (res && !res.error) {
            showAlert('Disconnected', 'GitHub repository disconnected.');
            refresh();
          } else if (!handleGithubAuthError(res, executeDisconnectRepo)) {
            showAlert('Error', 'Could not disconnect: ' + (res?.error || 'Unknown error'));
          }
        }
      );
    }

    document.getElementById('btn-panel-github-disconnect')?.addEventListener('click', executeDisconnectRepo);
  }
}

async function refresh() {
  let modeData = null;
  try { modeData = await fetchJson('/api/mode'); } catch {}
  lobbyMode = (window.AGENT_OS_HOSTED || modeData?.mode === 'swarm') ? 'swarm' : 'local';
  if (lobbyMode === 'swarm') {
    const s = JSON.parse(localStorage.getItem('agentos.hosted.session') || 'null');
    lobbyInfo = {
      id: s?.lobbyId || modeData?.lobby_id || null,
      name: 'Remote Swarm',
      url: modeData?.lobbyUrl || window.AGENT_OS_LOBBY_ORIGIN || window.location.origin || null,
      connected: lobbyConnected,
    };
  } else {
    lobbyInfo = {
      id: modeData?.lobby_id || null,
      name: modeData?.lobby_name || null,
      url: modeData?.lobbyUrl || null,
      connected: modeData?.lobby_connected !== false,
    };
  }

  const stateData = await fetchJson('/api/lobby/state');
  if (stateData?.lobby) {
    // Merge — don't overwrite WS-set bossAgentSlug if it's more recent
    const saved = stateData.lobby;
    if (saved.bossAgentSlug) lobbyState.bossAgentSlug = saved.bossAgentSlug;
    if (saved.phase) lobbyState.phase = saved.phase;
    if (saved.humanUsers) lobbyState.humanUsers = saved.humanUsers;
  }

  const localData = await fetchJson('/api/agents');
  if (localData) localAgents = (localData.agents || []).filter(a => a.status === 'running');

  const agentData = await fetchJson('/api/lobby/remote/agents');
  if (agentData && !agentData.error) {
    remoteAgents = agentData.agents || [];
    lobbyConnected = true;
    lobbyInfo.connected = true;

    if (lobbyMode === 'swarm') {
      const settingsRes = await fetchJson('/api/lobby/remote/settings');
      if (settingsRes && !settingsRes.error) {
        lobbySettings = settingsRes.lobby;
      }
      const membersRes = await fetchJson('/api/lobby/remote/members');
      if (membersRes && !membersRes.error) {
        lobbyMembers = membersRes.members || [];
      }
      const ghRes = await fetchJson('/api/lobby/remote/integrations/github');
      if (ghRes && !ghRes.error) {
        lobbyGithub = ghRes;
      } else {
        lobbyGithub = null;
      }
    }
  } else {
    remoteAgents = localAgents.map(a => ({
      agent_id: a.slug, display_name: a.name, agent_role: a.slug,
      status: 'idle', current_work: '', pid: a.pid, source: 'local',
    }));
    lobbyConnected = localAgents.length > 0;
    lobbyInfo.connected = lobbyConnected;
    lobbySettings = null;
    lobbyMembers = [];
    lobbyGithub = null;
  }
  lobbyInfo.connected = lobbyConnected;
  renderLobby();
}

function init() {
  try {
    const saved = localStorage.getItem('agent-os-lobby-user');
    if (saved) {
      currentUser = JSON.parse(saved);
    } else if (typeof window !== 'undefined' && window.AGENT_OS_HOSTED) {
      const s = JSON.parse(localStorage.getItem('agentos.hosted.session') || 'null');
      if (s && s.identityRef) {
        currentUser = {
          name: s.identityRef.split(':').pop() || 'Wallet Owner',
          role: 'product-owner',
          type: 'human',
          joinedAt: new Date().toISOString(),
          identity_status: s.identityRef === 'test-admin' ? 'unverified' : 'registry_verified',
          agent_id: s.identityRef,
          join_token: s.identityRef
        };
        localStorage.setItem('agent-os-lobby-user', JSON.stringify(currentUser));
      }
    }
  } catch {}

  refresh();

  // Wire up lobby action buttons (use capture to handle re-rendered DOM)
  document.getElementById('lobby-content')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'agent-id-card') {
      const agent = remoteAgents.find(a => a.agent_id === btn.dataset.agentId);
      if (!agent?.identity_registry_links || !agent.identity_ref) return;
      const { registration, explorer } = agent.identity_registry_links;
      showHtmlAlert('Agent ID Card', `
        <p><strong>${escapeHtml(agent.display_name)}</strong> · ${escapeHtml(agent.agent_role || 'Generalist')}</p>
        <p><a href="${escapeHtml(registration)}" target="_blank" rel="noopener">${escapeHtml(agent.identity_ref)} ↗</a></p>
        <p><a href="${escapeHtml(explorer)}" target="_blank" rel="noopener">View on CCDExplorer ↗</a></p>
      `);
      return;
    }
    if (btn.dataset.action === 'toggle-create-lobby') {
      createLobbyFormOpen = !createLobbyFormOpen;
      renderLobby();
    }
    if (btn.dataset.action === 'cancel-create-lobby') {
      createLobbyFormOpen = false;
      renderLobby();
    }
    if (btn.dataset.action === 'submit-create-lobby') {
      const name = document.getElementById('new-lobby-name')?.value?.trim() || 'Custom Swarm';
      const visibility = document.getElementById('new-lobby-visibility')?.value || 'public';
      const policy = document.getElementById('new-lobby-policy')?.value || 'none';
      const invitees = [];
      const checkboxes = document.querySelectorAll('input[name="invite-agent"]:checked');
      checkboxes.forEach(cb => invitees.push(cb.value));

      postJson('/api/lobby/remote/create', {
        name,
        visibility,
        join_policy: policy,
        allowlist: invitees,
        auth_lobby_id: JSON.parse(localStorage.getItem('agentos.hosted.session') || 'null')?.lobbyId,
      }).then(async res => {
        if (res && res.lobby) {
          const newLobbyId = res.lobby.lobby_id;
          if (res.token) {
            localStorage.setItem('agentos.hosted.session', JSON.stringify({
              token: res.token, identityRef: res.lobby.created_by, lobbyId: newLobbyId,
            }));
            localStorage.setItem('agent-os-lobby-token', res.token);
          }
          for (const agentId of invitees) {
            await postJson('/api/messages', {
              to: agentId,
              message_type: 'coordination',
              content: `INVITE|${newLobbyId}`,
            });
          }
          await postJson('/api/lobby/remote/join', { lobby_id: newLobbyId });
          createLobbyFormOpen = false;
          showAlert('Lobby Created', `Lobby "${name}" created. Inviting ${invitees.length} agent(s) and joining...`);
          refresh();
        } else {
          showAlert('Error', 'Failed to create custom lobby: ' + (res?.error || 'Unknown error'));
        }
      });
    }
    if (btn.dataset.action === 'leave-lobby') {
      lobbyState.humanUsers = (lobbyState.humanUsers || []).filter(u => u.name !== currentUser?.name);
      postJson('/api/lobby/state', lobbyState).then(async () => {
        currentUser = null;
        try { localStorage.removeItem('agent-os-lobby-user'); } catch {}
        await postJson('/api/lobby/remote/join', { lobby_id: null });
        renderLobby();
      });
    }
    if (btn.dataset.action === 'pause-lobby' || btn.dataset.action === 'close-lobby') {
      const closing = btn.dataset.action === 'close-lobby';
      if (closing && !confirm('Close the lobby and disconnect its agents?')) return;
      const res = await postJson('/api/lobby/remote/status', { status: closing ? 'closed' : 'paused' });
      if (res?.error) showAlert('Could Not Update Lobby', res.error);
      await refresh();
    }
    if (btn.dataset.action === 'appoint-boss') {
      const agentId = btn.dataset.agentId;
      await postJson('/api/lobby/remote/boss-agent', { agent_id: agentId });
      lobbyState.bossAgentSlug = agentId;
      await postJson('/api/lobby/state', lobbyState);
      refresh();
    }
  });

  // Role change dropdown handler
  document.getElementById('lobby-content')?.addEventListener('change', async (e) => {
    const select = e.target.closest('[data-action="change-role"]');
    if (!select) return;
    const agentId = select.dataset.agentId;
    const newRole = select.value;
    await postJson('/api/lobby/remote/role-change', { agent_id: agentId, agent_role: newRole });
    // Update cached roster
    const agent = remoteAgents.find(a => a.agent_id === agentId);
    if (agent) agent.agent_role = newRole;
  });

  // NOTE on payload shape: the Local-Mode panel-server wraps payloads as { type, data }, so the
  // first arg carries the payload. In Hosted Mode the panel is connected directly to the lobby WS
  // and receives raw protocol frames — fields live on the frame itself (second arg). Every handler
  // below reads `data || raw` so both modes fire.
  onWsMessage('agent-start', (data) => { events.push({ type: 'agent-start', slug: data?.slug || '', ts: new Date().toISOString() }); refresh(); });
  onWsMessage('agent-exit', (data) => { events.push({ type: 'agent-exit', slug: data?.slug || '', ts: new Date().toISOString() }); refresh(); });
  const onAgentUpdate = (data, raw) => {
    const p = data || raw || {};
    const info = p.agent?.display_name || p.agent_id || '';
    const eventType = p.type || 'agent-update';
    events.push({ type: eventType, slug: info, ts: new Date().toISOString() });
    refresh();
  };
  onWsMessage('lobby-agent-update', onAgentUpdate);   // Local Mode rebroadcast
  onWsMessage('lobby-agent-joined', onAgentUpdate);   // raw lobby frames (Hosted Mode)
  onWsMessage('lobby-agent-updated', onAgentUpdate);
  onWsMessage('lobby-agent-left', onAgentUpdate);
  onWsMessage('lobby-boss-appointed', (data, raw) => {
    const p = data || raw || {};
    if (p.agent_id) {
      lobbyState.bossAgentSlug = p.agent_id;
      events.push({ type: 'boss-appointed', slug: p.agent_id, ts: new Date().toISOString() });
      renderLobby();
    }
  });
  onWsMessage('lobby-boss-lost', () => {
    lobbyState.bossAgentSlug = null;
    events.push({ type: 'boss-lost', slug: '', ts: new Date().toISOString() });
    renderLobby();
  });
  const onLobbySystemMsg = (data, raw) => {
    const msg = data?.message || data || raw?.message;
    if (msg?.from_agent_id === 'system') {
      events.push({ type: 'system', slug: (msg.content || '').slice(0, 80), ts: msg.created_at || new Date().toISOString() });
      // System messages include boss appointments — update local state
      if ((msg.content || '').includes('Boss Agent')) refresh();
    }
  };
  onWsMessage('lobby-message', onLobbySystemMsg);
  onWsMessage('lobby-message-received', onLobbySystemMsg);

  setInterval(refresh, 10000);
}

registerTab('lobby', { init, onActivate: refresh });
