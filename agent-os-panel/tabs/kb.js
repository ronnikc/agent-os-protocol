/**
 * Knowledge Base (KB) Tab — manages Git-backed document sync in Swarm/Hosted Mode
 * and falls back to read-only views over Agent OS Memory substrate in Local Mode.
 */
import { fetchJson, postJson, registerTab, escapeHtml } from '../app.js';

const SUBTABS = ['index', 'facts', 'diaries', 'lessons', 'activity'];
let activeSubtab = 'index';
let indexEntries = [];
let factsAll = [];
let diariesAgentList = [];
let selectedAgent = null;
let lessonsFeed = [];

let isSwarm = false;
let kbConfig = null;
let syncJobs = [];
let pollingInterval = null;

// ── GitHub-style header slug (mirrors agent-os/scripts/build-memory-index.mjs) ──
function slugify(s) {
  return s.toLowerCase()
    .replace(/[`'"!@#$%^&*()+=[\]{};:,.<>?/\\|~]/g, '')
    .replace(/&/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ── Minimal markdown renderer ──
function renderMarkdown(md) {
  if (!md) return '';
  md = md.replace(/\r\n/g, '\n');
  const codeBlocks = [];
  let text = md.replace(/```(\w*)\n([\s\S]*?)```/g, (_, _l, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre style="background:var(--bg-surface);padding:10px;border-radius:4px;overflow-x:auto;font-size:12px;white-space:pre;"><code>${escapeHtml(code)}</code></pre>`);
    return `%%CB_${idx}%%`;
  });
  let html = escapeHtml(text);
  html = html.replace(/^#### (.+)$/gm, (_, t) => `<h4 id="${slugify(t)}" style="margin:14px 0 6px;font-size:14px;">${t}</h4>`);
  html = html.replace(/^### (.+)$/gm,  (_, t) => `<h3 id="${slugify(t)}" style="margin:16px 0 8px;font-size:15px;">${t}</h3>`);
  html = html.replace(/^## (.+)$/gm,   (_, t) => `<h2 id="${slugify(t)}" style="margin:20px 0 10px;font-size:17px;border-bottom:1px solid var(--border);padding-bottom:6px;">${t}</h2>`);
  html = html.replace(/^# (.+)$/gm,    (_, t) => `<h1 id="${slugify(t)}" style="margin:20px 0 10px;font-size:20px;">${t}</h1>`);
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g, '<code style="background:var(--bg-surface);padding:1px 4px;border-radius:3px;font-size:12px;">$1</code>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:var(--accent);" target="_blank">$1</a>');
  html = html.replace(/^[-*] (.+)$/gm, '<li style="margin-left:20px;">$1</li>');
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote style="border-left:3px solid var(--accent);padding-left:12px;color:var(--text-secondary);margin:8px 0;">$1</blockquote>');
  html = html.replace(/^---$/gm, '<hr style="border:none;border-top:1px solid var(--border);margin:16px 0;">');
  html = html.replace(/\n\n/g, '</p><p>');
  html = '<p>' + html + '</p>';
  html = html.replace(/%%CB_(\d+)%%/g, (_, i) => codeBlocks[+i]);
  return html;
}

// ── Layout (rendered once on activation) ──
async function renderShell() {
  const root = document.getElementById('kb-content');
  if (!root) return;

  const modeData = await fetchJson('/api/mode');
  isSwarm = modeData?.mode === 'swarm';

  if (isSwarm) {
    root.innerHTML = `
      <div style="display:flex;flex-direction:column;flex:1;overflow:hidden;padding:16px;gap:16px;">
        <div id="kb-settings-container" class="card" style="padding:16px;"></div>
        <div id="kb-upload-container" class="card" style="padding:16px;display:none;"></div>
        <div id="kb-jobs-container" class="card" style="flex:1;overflow:hidden;display:flex;flex-direction:column;padding:16px;display:none;"></div>
      </div>
      <div id="kb-drawer" aria-live="polite"
           style="position:fixed;right:0;top:0;bottom:0;width:50%;max-width:680px;background:var(--bg-elevated);border-left:1px solid var(--border);box-shadow:-4px 0 12px rgba(0,0,0,0.25);overflow:auto;padding:16px;display:none;z-index:50;"></div>
    `;
    await refreshSwarmKb();
  } else {
    // Local memory view
    root.innerHTML = `
      <div role="tablist" aria-label="KB sub-tabs"
           style="display:flex;gap:4px;padding:8px 12px;border-bottom:1px solid var(--border);">
        ${SUBTABS.map(s => `
          <button role="tab" data-subtab="${s}"
                  aria-selected="${activeSubtab === s}"
                  tabindex="${activeSubtab === s ? 0 : -1}"
                  class="btn btn-sm ${activeSubtab === s ? 'btn-primary' : 'btn-secondary'}"
                  style="text-transform:capitalize;">${s}</button>
        `).join('')}
      </div>
      <div id="kb-subtab-pane" style="flex:1;overflow:hidden;display:flex;flex-direction:column;"></div>
      <div id="kb-drawer" aria-live="polite"
           style="position:fixed;right:0;top:0;bottom:0;width:50%;max-width:680px;background:var(--bg-elevated);border-left:1px solid var(--border);box-shadow:-4px 0 12px rgba(0,0,0,0.25);overflow:auto;padding:16px;display:none;z-index:50;"></div>
    `;
    root.querySelectorAll('button[data-subtab]').forEach(b => {
      b.addEventListener('click', () => switchSubtab(b.dataset.subtab));
      b.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          const dir = e.key === 'ArrowRight' ? 1 : -1;
          const cur = SUBTABS.indexOf(activeSubtab);
          const next = SUBTABS[(cur + dir + SUBTABS.length) % SUBTABS.length];
          switchSubtab(next);
          root.querySelector(`button[data-subtab="${next}"]`)?.focus();
        }
      });
    });
    switchSubtab(activeSubtab);
  }
}

function switchSubtab(id) {
  activeSubtab = id;
  document.querySelectorAll('#kb-content button[data-subtab]').forEach(b => {
    const sel = b.dataset.subtab === id;
    b.setAttribute('aria-selected', sel ? 'true' : 'false');
    b.setAttribute('tabindex', sel ? '0' : '-1');
    b.className = `btn btn-sm ${sel ? 'btn-primary' : 'btn-secondary'}`;
    b.style.textTransform = 'capitalize';
  });
  if (id === 'index') renderIndexSubtab();
  if (id === 'facts') renderFactsSubtab();
  if (id === 'diaries') renderDiariesSubtab();
  if (id === 'lessons') renderLessonsSubtab();
  if (id === 'activity') renderActivitySubtab();
}

function showDrawer(html) {
  const drawer = document.getElementById('kb-drawer');
  if (!drawer) return;
  drawer.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <strong>Detail</strong>
      <button class="btn btn-sm btn-secondary" id="kb-drawer-close">Close</button>
    </div>
    ${html}
  `;
  drawer.style.display = 'block';
  document.getElementById('kb-drawer-close')?.addEventListener('click', () => {
    drawer.style.display = 'none';
    drawer.innerHTML = '';
  });
}

// ── Swarm Mode View & Logic ──────────────────────────────────────
async function refreshSwarmKb() {
  const data = await fetchJson('/api/lobby/remote/kb');
  kbConfig = data?.kb;

  const settingsEl = document.getElementById('kb-settings-container');
  const uploadEl = document.getElementById('kb-upload-container');
  const jobsEl = document.getElementById('kb-jobs-container');

  if (!settingsEl) return;

  if (!kbConfig) {
    let githubHtml = '';
    let githubIntegration = null;
    try {
      githubIntegration = await fetchJson('/api/lobby/remote/integrations/github');
    } catch (e) {
      console.warn('[KB] Failed to fetch lobby GitHub integration:', e);
    }

    if (githubIntegration && githubIntegration.connected && githubIntegration.repo) {
      githubHtml = `
        <div style="margin-top:16px; padding:12px; background:rgba(49, 140, 255, 0.08); border:1px solid rgba(49, 140, 255, 0.15); border-radius:6px; font-size:12px; display:flex; flex-direction:column; gap:8px;">
          <span style="color:var(--text-secondary);">Lobby has a connected GitHub repository: <strong style="color:var(--text-primary);">${escapeHtml(githubIntegration.repo)}</strong></span>
          <button id="kb-btn-use-lobby-repo" class="btn btn-sm btn-primary" style="align-self:flex-start;">Use Connected Repo</button>
        </div>
      `;
    }

    settingsEl.innerHTML = `
      <h3 style="margin-top:0;">Configure Knowledge Base (KB)</h3>
      <p style="font-size:12px;color:var(--text-muted);">Please connect a Git repository to store the converted markdown documents and indices.</p>
      <div style="display:flex;flex-direction:column;gap:12px;max-width:400px;">
        <div>
          <label style="display:block;font-size:12px;margin-bottom:4px;">GitHub Repository URL</label>
          <input type="text" id="kb-config-repo" placeholder="https://github.com/owner/repo" style="width:100%;padding:6px;background:var(--bg-elevated);border:1px solid var(--border);color:var(--text);border-radius:4px;" />
        </div>
        <div>
          <label style="display:block;font-size:12px;margin-bottom:4px;">Branch</label>
          <input type="text" id="kb-config-branch" value="main" style="width:100%;padding:6px;background:var(--bg-elevated);border:1px solid var(--border);color:var(--text);border-radius:4px;" />
        </div>
        <div>
          <label style="display:block;font-size:12px;margin-bottom:4px;">Root Path (within repo)</label>
          <input type="text" id="kb-config-path" value="kb" style="width:100%;padding:6px;background:var(--bg-elevated);border:1px solid var(--border);color:var(--text);border-radius:4px;" />
        </div>
        <button id="kb-config-save-btn" class="btn btn-primary" style="align-self:flex-start;">Save Configuration</button>
        ${githubHtml}
      </div>
    `;

    settingsEl.querySelector('#kb-config-save-btn')?.addEventListener('click', saveKbConfig);
    if (githubIntegration && githubIntegration.connected && githubIntegration.repo) {
      settingsEl.querySelector('#kb-btn-use-lobby-repo')?.addEventListener('click', () => {
        const repoInput = settingsEl.querySelector('#kb-config-repo');
        const branchInput = settingsEl.querySelector('#kb-config-branch');
        const pathInput = settingsEl.querySelector('#kb-config-path');
        if (repoInput) repoInput.value = `https://github.com/${githubIntegration.repo}`;
        if (branchInput) branchInput.value = githubIntegration.branch || 'main';
        if (pathInput) pathInput.value = 'kb';
        saveKbConfig();
      });
    }

    if (uploadEl) uploadEl.style.display = 'none';
    if (jobsEl) jobsEl.style.display = 'none';
  } else {
    settingsEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <h3 style="margin:0 0 4px 0;">Knowledge Base Configured</h3>
          <div style="font-size:12px;color:var(--text-muted);">
            Repository: <strong style="color:var(--text);">${escapeHtml(kbConfig.repository_url)}</strong> &middot; 
            Branch: <strong style="color:var(--text);">${escapeHtml(kbConfig.branch)}</strong> &middot; 
            Path: <strong style="color:var(--text);">${escapeHtml(kbConfig.kb_root_path)}</strong>
          </div>
          ${kbConfig.latest_commit_sha ? `
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">
              Latest Commit: <code>${escapeHtml(kbConfig.latest_commit_sha.slice(0, 8))}</code> &middot; 
              Synced: ${new Date(kbConfig.last_synced_at).toLocaleString()}
            </div>
          ` : ''}
        </div>
        <div style="display:flex;gap:6px;">
          <button id="kb-sync-btn" class="btn btn-primary btn-sm">Train / Sync KB</button>
          <button id="kb-config-edit-btn" class="btn btn-secondary btn-sm">Edit Settings</button>
        </div>
      </div>
    `;
    settingsEl.querySelector('#kb-config-edit-btn')?.addEventListener('click', () => {
      kbConfig = null;
      refreshSwarmKb();
    });
    settingsEl.querySelector('#kb-sync-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('kb-sync-btn');
      if (btn) btn.disabled = true;
      try {
        const token = localStorage.getItem('agent-os-lobby-token');
        const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
        const res = await fetchJson('/api/lobby/remote/kb/sync', { method: 'POST', headers });
        if (res && res.error) {
          alert('Failed to sync: ' + res.error);
        } else {
          await refreshKbJobs();
        }
      } catch (err) {
        alert('Sync error: ' + err.message);
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    if (uploadEl) {
      uploadEl.style.display = 'block';
      uploadEl.innerHTML = `
        <h3 style="margin-top:0;margin-bottom:12px;">Upload Document to KB</h3>
        <p style="font-size:12px;color:var(--text-muted);">Upload PDF, DOCX, XLSX, PPTX, Markdown, or TXT files. They will be converted to markdown and committed to GitHub automatically.</p>
        <div style="display:flex;gap:12px;align-items:center;">
          <input type="file" id="kb-file-input" accept=".pdf,.docx,.xlsx,.pptx,.md,.txt" />
          <button id="kb-upload-btn" class="btn btn-primary">Upload & Convert</button>
        </div>
        <div id="kb-upload-status" style="margin-top:8px;font-size:12px;font-weight:500;"></div>
      `;
      uploadEl.querySelector('#kb-upload-btn')?.addEventListener('click', uploadFile);
    }

    if (jobsEl) {
      jobsEl.style.display = 'flex';
      await refreshKbJobs();
    }
    
    // Start polling jobs
    if (!pollingInterval) {
      pollingInterval = setInterval(refreshKbJobs, 3000);
    }
  }
}

async function saveKbConfig() {
  const repo = document.getElementById('kb-config-repo')?.value?.trim();
  const branch = document.getElementById('kb-config-branch')?.value?.trim() || 'main';
  const path = document.getElementById('kb-config-path')?.value?.trim() || 'kb';

  if (!repo) { alert('Repository URL is required'); return; }

  const token = localStorage.getItem('agent-os-lobby-token');
  const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

  const res = await fetchJson('/api/lobby/remote/kb', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ repository_url: repo, branch, kb_root_path: path })
  });

  if (res && !res.error) {
    await refreshSwarmKb();
  } else {
    alert('Failed to save configuration: ' + (res?.error || 'Unknown error'));
  }
}

async function uploadFile() {
  const fileInput = document.getElementById('kb-file-input');
  const statusEl = document.getElementById('kb-upload-status');
  if (!fileInput || !fileInput.files.length) { alert('Please select a file to upload'); return; }
  const file = fileInput.files[0];

  statusEl.style.color = 'var(--text)';
  statusEl.textContent = 'Reading file...';

  const reader = new FileReader();
  reader.onload = async () => {
    const base64 = reader.result.split(',')[1];
    statusEl.textContent = 'Uploading and queueing conversion...';

    const token = localStorage.getItem('agent-os-lobby-token');
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

    const res = await fetchJson('/api/lobby/remote/kb/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        file_name: file.name,
        mime_type: file.type || 'application/octet-stream',
        file_content: base64
      })
    });

    if (res && !res.error) {
      statusEl.style.color = 'var(--success)';
      statusEl.textContent = `File successfully queued for conversion. Job ID: ${res.job?.id}`;
      fileInput.value = '';
      await refreshKbJobs();
    } else {
      statusEl.style.color = 'var(--error)';
      statusEl.textContent = 'Upload failed: ' + (res?.error || 'unknown error');
    }
  };
  reader.onerror = () => {
    statusEl.style.color = 'var(--error)';
    statusEl.textContent = 'Error reading file';
  };
  reader.readAsDataURL(file);
}

async function refreshKbJobs() {
  const jobsEl = document.getElementById('kb-jobs-container');
  if (!jobsEl) return;

  const token = localStorage.getItem('agent-os-lobby-token');
  const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

  const data = await fetchJson('/api/lobby/remote/kb/jobs', { headers });
  syncJobs = data?.jobs || [];

  jobsEl.innerHTML = `
    <h3 style="margin-top:0;">Knowledge Base Sync Jobs</h3>
    <div style="flex:1;overflow:auto;">
      <table class="data-table" style="width:100%;font-size:12px;">
        <thead>
          <tr>
            <th>Job ID</th>
            <th>Status</th>
            <th>Source</th>
            <th>Commit SHA</th>
            <th>Updated</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          ${syncJobs.map(job => {
            let statusColor = 'var(--text-muted)';
            if (job.status === 'committed') statusColor = 'var(--success)';
            else if (job.status === 'failed') statusColor = 'var(--error)';
            else if (job.status === 'running') statusColor = 'var(--accent)';

            const commitText = job.source_ref 
              ? `<code>${escapeHtml(job.source_ref.slice(0, 8))}</code>`
              : '—';

            return `
              <tr>
                <td><code>${escapeHtml(job.id.slice(0, 12))}</code></td>
                <td><span class="badge" style="background:${statusColor};color:white;padding:2px 6px;border-radius:4px;font-weight:600;">${escapeHtml(job.status)}</span></td>
                <td>${escapeHtml(job.source_provider)}</td>
                <td>${commitText}</td>
                <td>${new Date(job.updated_at).toLocaleString()}</td>
                <td style="color:var(--error);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(job.error || '')}">${escapeHtml(job.error || '—')}</td>
              </tr>
            `;
          }).join('') || '<tr><td colspan="6" style="text-align:center;padding:12px;">No sync jobs found.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

// ── Local Mode Index Sub-Tab ──────────────────────────────────────
async function loadIndex() {
  if (indexEntries.length) return;
  const data = await fetchJson('/api/memory/index');
  indexEntries = data?.entries ?? [];
}

async function renderIndexSubtab() {
  await loadIndex();
  const pane = document.getElementById('kb-subtab-pane');
  if (!pane) return;

  const recallStatus = await fetchJson('/api/memory/recall/status');
  const recallEnabled = recallStatus?.enabled === true;

  pane.innerHTML = `
    <div style="padding:12px;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      <label for="kb-index-q" style="font-size:12px;color:var(--text-muted);">Substring</label>
      <input type="text" id="kb-index-q" placeholder="topic or entity (substring match)"
             style="flex:1;min-width:200px;padding:6px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);" />
      ${recallEnabled ? `
        <label for="kb-index-sem" style="font-size:12px;color:var(--text-muted);">Semantic</label>
        <input type="text" id="kb-index-sem" placeholder="natural-language query"
               style="flex:1;min-width:200px;padding:6px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);" />
        <button id="kb-index-sem-go" class="btn btn-sm btn-primary" type="button">Recall</button>
        <button id="kb-index-sem-clear" class="btn btn-sm btn-secondary" type="button">Clear</button>
      ` : ''}
      <span id="kb-index-count" style="font-size:12px;color:var(--text-muted);"></span>
    </div>
    <div id="kb-index-list" class="scroll-panel" style="flex:1;overflow:auto;padding:8px 12px;"></div>
  `;
  const input = document.getElementById('kb-index-q');
  const list  = document.getElementById('kb-index-list');
  const count = document.getElementById('kb-index-count');

  function renderList(filter) {
    const f = (filter ?? '').toLowerCase();
    const matches = !f ? indexEntries : indexEntries.filter(e => {
      const hay = `${e.topic} ${(e.entities || []).join(' ')} ${e.ref}`.toLowerCase();
      return hay.includes(f);
    });
    if (count) count.textContent = `${matches.length} of ${indexEntries.length}`;
    if (list) {
      list.innerHTML = matches.slice(0, 500).map(e => `
        <div class="memory-row" style="padding:6px 8px;border-bottom:1px solid var(--border);cursor:pointer;" data-ref="${escapeHtml(e.ref)}">
          <div style="font-weight:500;">${escapeHtml(e.topic)}</div>
          <div style="font-size:11px;color:var(--text-muted);">
            ${(e.entities || []).slice(0, 6).map(t => `<span class="entity-chip" data-entity="${escapeHtml(t)}" style="display:inline-block;background:var(--bg-surface);padding:1px 6px;margin-right:4px;border-radius:3px;cursor:pointer;">${escapeHtml(t)}</span>`).join('')}
            <span style="margin-left:8px;">→ ${escapeHtml(e.ref)}</span>
            <span style="margin-left:8px;">[${e.scope || ''}]</span>
            <span style="margin-left:8px;">${e.updated || ''}</span>
          </div>
        </div>
      `).join('');
      list.querySelectorAll('.memory-row').forEach(row => {
        row.addEventListener('click', async (e) => {
          if (e.target.classList.contains('entity-chip')) {
            if (input) input.value = e.target.dataset.entity;
            renderList(input.value);
            return;
          }
          const ref = row.dataset.ref;
          const [path, anchor] = ref.split('#');
          const data = await fetchJson(`/api/memory/file?path=${encodeURIComponent(path)}`);
          if (data?.content) {
            showDrawer(`
              <div style="margin-bottom:8px;font-size:11px;color:var(--text-muted);">${escapeHtml(path)}${anchor ? ` <strong>#${escapeHtml(anchor)}</strong>` : ''}</div>
              <div>${renderMarkdown(data.content)}</div>
            `);
            if (anchor) {
              const drawer = document.getElementById('kb-drawer');
              const target = drawer?.querySelector(`#${CSS.escape(anchor)}`)
                          ?? drawer?.querySelector('h1, h2, h3, h4');
              target?.scrollIntoView({ block: 'start' });
            }
          } else {
            showDrawer(`<em>Could not load ${escapeHtml(path)}</em>`);
          }
        });
      });
      list.querySelectorAll('.entity-chip').forEach(chip => {
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          if (input) input.value = chip.dataset.entity;
          renderList(input.value);
        });
      });
    }
  }

  input?.addEventListener('input', () => renderList(input.value));
  renderList('');

  const semInput = document.getElementById('kb-index-sem');
  const semGo    = document.getElementById('kb-index-sem-go');
  const semClear = document.getElementById('kb-index-sem-clear');
  async function runSemantic() {
    const q = (semInput?.value || '').trim();
    if (!q) { renderList(input.value); return; }
    const data = await fetchJson(`/api/memory/recall?q=${encodeURIComponent(q)}&top=20`);
    const matches = data?.results ?? [];
    if (count) {
      count.textContent = matches.length
        ? `${matches.length} semantic match(es) — model=${data.model || '?'}`
        : `0 semantic matches`;
    }
    if (list) {
      list.innerHTML = matches.map(m => `
        <div class="memory-row" style="padding:6px 8px;border-bottom:1px solid var(--border);cursor:pointer;" data-ref="${escapeHtml(m.doc_id)}">
          <div style="font-weight:500;">${(m.score ?? 0).toFixed(3)} — ${escapeHtml(m.doc_id)}</div>
          <div style="font-size:11px;color:var(--text-muted);">[${escapeHtml(m.corpus || '')}]</div>
        </div>
      `).join('') || '<em>No matches.</em>';
      list.querySelectorAll('.memory-row').forEach(row => {
        row.addEventListener('click', async () => {
          const ref = row.dataset.ref;
          if (ref.includes('#') || ref.endsWith('.md')) {
            const [path, anchor] = ref.split('#');
            const fileData = await fetchJson(`/api/memory/file?path=${encodeURIComponent(path)}`);
            if (fileData?.content) {
              showDrawer(`
                <div style="margin-bottom:8px;font-size:11px;color:var(--text-muted);">${escapeHtml(path)}${anchor ? ` <strong>#${escapeHtml(anchor)}</strong>` : ''}</div>
                ${renderMarkdown(fileData.content)}
              `);
              if (anchor) {
                const drawer = document.getElementById('kb-drawer');
                drawer?.querySelector(`#${CSS.escape(anchor)}`)?.scrollIntoView({ block: 'start' });
              }
            }
          } else {
            const diary = await fetchJson(`/api/memory/diary?agent=${encodeURIComponent(ref)}`);
            if (diary?.content) {
              showDrawer(`
                <div style="margin-bottom:8px;font-size:11px;color:var(--text-muted);">${escapeHtml(ref)}/diary.md</div>
                ${renderMarkdown(diary.content)}
              `);
            }
          }
        });
      });
    }
  }
  semGo?.addEventListener('click', runSemantic);
  semInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') runSemantic(); });
  semClear?.addEventListener('click', () => {
    if (semInput) semInput.value = '';
    if (input) input.value = '';
    renderList('');
  });
}

// ── Local Mode Facts Sub-Tab ──────────────────────────────────────
async function loadFacts() {
  if (factsAll.length) return factsAll;
  const data = await fetchJson('/api/memory/facts');
  factsAll = data?.facts ?? [];
  return factsAll;
}

async function renderFactsSubtab() {
  await loadFacts();
  const pane = document.getElementById('kb-subtab-pane');
  if (!pane) return;
  const predicates = Array.from(new Set(factsAll.map(f => f.predicate).filter(Boolean))).sort();
  pane.innerHTML = `
    <div style="padding:12px;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      <label for="kb-facts-pred" style="font-size:12px;">Predicate</label>
      <select id="kb-facts-pred" style="padding:6px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);">
        <option value="">all</option>
        ${predicates.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('')}
      </select>
      <label for="kb-facts-q" style="font-size:12px;">Search</label>
      <input type="text" id="kb-facts-q" placeholder="subject or object"
             style="padding:6px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);" />
      <label for="kb-facts-asof" style="font-size:12px;">As of</label>
      <input type="date" id="kb-facts-asof"
             style="padding:6px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);" />
      <span id="kb-facts-count" style="font-size:12px;color:var(--text-muted);margin-left:auto;"></span>
    </div>
    <div class="scroll-panel" style="flex:1;overflow:auto;">
      <table class="data-table" style="width:100%;font-size:12px;">
        <thead><tr>
          <th>subject</th><th>predicate</th><th>object</th>
          <th>valid_from</th><th>valid_to</th><th>source</th><th>sprint</th><th></th>
        </tr></thead>
        <tbody id="kb-facts-tbody"></tbody>
      </table>
    </div>
  `;
  const predEl = document.getElementById('kb-facts-pred');
  const qEl    = document.getElementById('kb-facts-q');
  const asofEl = document.getElementById('kb-facts-asof');
  const tbody  = document.getElementById('kb-facts-tbody');
  const count  = document.getElementById('kb-facts-count');

  async function reload() {
    const params = new URLSearchParams();
    if (predEl?.value) params.set('predicate', predEl.value);
    if (asofEl?.value) params.set('as_of', asofEl.value);
    const data = await fetchJson('/api/memory/facts?' + params.toString());
    let rows = data?.facts ?? [];
    if (qEl?.value?.trim()) {
      const q = qEl.value.toLowerCase();
      rows = rows.filter(f => (f.subject || '').toLowerCase().includes(q) || (f.object || '').toLowerCase().includes(q));
    }
    if (count) count.textContent = `${rows.length} fact(s)`;
    if (tbody) {
      tbody.innerHTML = rows.slice(0, 500).map(f => `
        <tr>
          <td>${escapeHtml(f.subject || '')}</td>
          <td>${escapeHtml(f.predicate || '')}</td>
          <td>${escapeHtml(f.object || '')}</td>
          <td>${f.valid_from || ''}</td>
          <td>${f.valid_to || ''}</td>
          <td>${escapeHtml(f.source_file || '')}</td>
          <td>${escapeHtml(f.sprint || '')}</td>
          <td><button class="btn btn-sm btn-secondary" data-subj="${escapeHtml(f.subject || '')}">Timeline</button></td>
        </tr>
      `).join('');
      tbody.querySelectorAll('button[data-subj]').forEach(b => {
        b.addEventListener('click', async () => {
          const subj = b.dataset.subj;
          const tlData = await fetchJson(`/api/memory/facts?subject=${encodeURIComponent(subj)}`);
          const tl = (tlData?.facts ?? []).slice().sort((a, b) => (a.valid_from || '').localeCompare(b.valid_from || ''));
          showDrawer(`
            <h2 style="margin:0 0 12px;">Timeline: ${escapeHtml(subj)}</h2>
            ${tl.map(f => `
              <div style="padding:8px;border-left:3px solid ${f.valid_to ? 'var(--text-muted)' : 'var(--success)'};margin:6px 0;background:var(--bg-surface);">
                <strong>${escapeHtml(f.predicate)}</strong> → ${escapeHtml(f.object)}<br/>
                <span style="font-size:11px;color:var(--text-muted);">${f.valid_from || '?'} → ${f.valid_to || '∞ (current)'}</span>
              </div>
            `).join('')}
          `);
        });
      });
    }
  }

  predEl?.addEventListener('change', reload);
  qEl?.addEventListener('input', reload);
  asofEl?.addEventListener('change', reload);
  reload();
}

// ── Local Mode Diaries Sub-Tab ────────────────────────────────────
async function loadDiariesAgentList() {
  if (diariesAgentList.length) return;
  await loadIndex();
  const seen = new Set();
  for (const e of indexEntries) {
    const m = (e.scope || '').match(/^sub-agent:(.+)$/);
    if (!m) continue;
    const name = m[1].replace(/:diary$/, '');
    if (name && name !== 'shared') seen.add(name);
  }
  const KNOWN_AGENTS = [
    'accessibility','api','backend','boss-agent','build-integrity','code-review',
    'compliance','content','content-marketing','design','documentation','frontend',
    'graph-navigator','help-center-content','i18n','infrastructure','legal','planning',
    'product','product-qa','release','research','security','seo','sprint-gate-enforcer',
    'test','tips-widget','ui-assist','user-validation','ux',
  ];
  for (const a of KNOWN_AGENTS) seen.add(a);
  diariesAgentList = Array.from(seen).sort();
}

async function renderDiariesSubtab() {
  await loadDiariesAgentList();
  const pane = document.getElementById('kb-subtab-pane');
  if (!pane) return;
  pane.innerHTML = `
    <div style="display:flex;flex:1;overflow:hidden;">
      <div id="kb-diaries-sidebar" style="width:220px;border-right:1px solid var(--border);overflow:auto;padding:8px;">
        ${diariesAgentList.map(a => `
          <button class="kb-agent-pill" data-agent="${a}"
                  style="display:block;width:100%;text-align:left;padding:6px 8px;margin:2px 0;background:none;border:1px solid transparent;color:var(--text);border-radius:3px;cursor:pointer;font-size:13px;">
            ${escapeHtml(a)}
          </button>
        `).join('')}
      </div>
      <div id="kb-diaries-main" style="flex:1;overflow:auto;padding:16px;">
        <em style="color:var(--text-muted);">Select an agent to view its diary.</em>
      </div>
    </div>
  `;
  pane.querySelectorAll('.kb-agent-pill').forEach(b => {
    b.addEventListener('click', () => selectAgent(b.dataset.agent));
  });
  if (selectedAgent) selectAgent(selectedAgent);
}

async function selectAgent(agent) {
  selectedAgent = agent;
  document.querySelectorAll('.kb-agent-pill').forEach(p => {
    p.style.background = p.dataset.agent === agent ? 'var(--bg-surface)' : 'none';
    p.style.borderColor = p.dataset.agent === agent ? 'var(--accent)' : 'transparent';
  });
  const main = document.getElementById('kb-diaries-main');
  if (!main) return;
  main.innerHTML = `<em>Loading ${escapeHtml(agent)}...</em>`;
  const data = await fetchJson(`/api/memory/diary?agent=${encodeURIComponent(agent)}`);
  if (!data?.exists) {
    main.innerHTML = `<em style="color:var(--text-muted);">No diary for ${escapeHtml(agent)}.</em>`;
    return;
  }
  const isPlaceholder = (data.content || '').includes('<!-- diary will be appended by post-sprint-memory.sh -->');
  main.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <strong>${escapeHtml(agent)}/diary.md</strong>
      <span style="font-size:11px;color:var(--text-muted);">${(data.lessons || []).length} lesson(s)</span>
    </div>
    ${isPlaceholder ? '<div style="padding:8px;border:1px dashed var(--border);font-size:12px;color:var(--text-muted);margin-bottom:12px;">Diary is the placeholder — no entries yet.</div>' : ''}
    <div style="border:1px solid var(--border);padding:12px;border-radius:3px;margin-bottom:16px;background:var(--bg-surface);">
      ${renderMarkdown(data.content)}
    </div>
    <details>
      <summary style="cursor:pointer;font-size:13px;color:var(--text);">Lessons (${(data.lessons || []).length})</summary>
      <div id="kb-diaries-lessons" style="padding-top:8px;"></div>
    </details>
  `;
  const lessonsEl = document.getElementById('kb-diaries-lessons');
  if (lessonsEl && (data.lessons || []).length) {
    lessonsEl.innerHTML = data.lessons.map(l => `
      <button class="btn btn-sm btn-secondary" style="margin:2px 4px 2px 0;" data-sprint="${escapeHtml(l.sprint)}">${escapeHtml(l.sprint)}</button>
    `).join('');
    lessonsEl.querySelectorAll('button[data-sprint]').forEach(b => {
      b.addEventListener('click', async () => {
        const fileData = await fetchJson(`/api/memory/file?path=${encodeURIComponent(`agent-os/sub-agents/${agent}/lessons/${b.dataset.sprint}.md`)}`);
        if (fileData?.content) {
          showDrawer(`
            <div style="margin-bottom:8px;font-size:11px;color:var(--text-muted);">${escapeHtml(agent)} · sprint ${escapeHtml(b.dataset.sprint)}</div>
            ${renderMarkdown(fileData.content)}
          `);
        }
      });
    });
  }
}

// ── Local Mode Lessons Sub-Tab ────────────────────────────────────
async function renderLessonsSubtab() {
  const pane = document.getElementById('kb-subtab-pane');
  if (!pane) return;
  pane.innerHTML = `
    <div style="padding:12px;border-bottom:1px solid var(--border);font-size:12px;color:var(--text-muted);">
      20 most recent per-agent lesson files (mtime-sorted).
    </div>
    <div id="kb-lessons-feed" class="scroll-panel" style="flex:1;overflow:auto;padding:8px 12px;"><em>Loading...</em></div>
  `;
  const data = await fetchJson('/api/memory/lessons?limit=20');
  lessonsFeed = data?.lessons ?? [];
  const feed = document.getElementById('kb-lessons-feed');
  if (feed) {
    feed.innerHTML = lessonsFeed.length ? lessonsFeed.map(l => `
      <div class="memory-lesson-card" style="padding:10px;border:1px solid var(--border);border-radius:3px;margin:6px 0;cursor:pointer;background:var(--bg-surface);"
           data-path="${escapeHtml(l.path)}">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;">
          <strong>${escapeHtml(l.agent)} · ${escapeHtml(l.sprint)}</strong>
          <span style="font-size:11px;color:var(--text-muted);">${new Date(l.mtime).toISOString().slice(0, 10)}</span>
        </div>
        <div style="font-size:13px;margin-bottom:4px;">${escapeHtml(l.title)}</div>
        <div style="font-size:11px;color:var(--text-muted);">${escapeHtml(l.preview)}</div>
      </div>
    `).join('') : '<em>No lessons yet.</em>';
    feed.querySelectorAll('.memory-lesson-card').forEach(card => {
      card.addEventListener('click', async () => {
        const fileData = await fetchJson(`/api/memory/file?path=${encodeURIComponent(card.dataset.path)}`);
        if (fileData?.content) {
          showDrawer(`
            <div style="margin-bottom:8px;font-size:11px;color:var(--text-muted);">${escapeHtml(card.dataset.path)}</div>
            ${renderMarkdown(fileData.content)}
          `);
        }
      });
    });
  }
}

// ── Local Mode Activity Sub-Tab ──────────────────────────────────
async function renderActivitySubtab() {
  const pane = document.getElementById('kb-subtab-pane');
  if (!pane) return;
  pane.innerHTML = `
    <div style="padding:12px;border-bottom:1px solid var(--border);font-size:12px;color:var(--text-muted);">
      Recent processed sprint close-outs.
    </div>
    <div id="kb-activity-feed" class="scroll-panel" style="flex:1;overflow:auto;padding:8px 12px;"><em>Loading...</em></div>
  `;
  const data = await fetchJson('/api/memory/activity?limit=50');
  const rows = data?.activity ?? [];
  const feed = document.getElementById('kb-activity-feed');
  if (feed) {
    feed.innerHTML = rows.length ? rows.map(r => `
      <div class="memory-activity-card" style="padding:10px;border:1px solid var(--border);border-radius:3px;margin:6px 0;cursor:pointer;background:var(--bg-surface);"
           data-sprint="${escapeHtml(r.sprint)}" data-source="${escapeHtml(r.source)}">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;">
          <strong>Sprint ${escapeHtml(r.sprint)}</strong>
          <span style="font-size:11px;color:var(--text-muted);">${escapeHtml(r.processed_at || '?')} · ${escapeHtml(r.source)}</span>
        </div>
        <div style="font-size:12px;color:var(--text-muted);">
          diary writes: <strong>${r.diary_writes}</strong> &middot;
          rollovers: <strong>${r.rollovers}</strong> &middot;
          fact emitted: <strong>${r.fact_emitted ? 'yes' : 'no'}</strong>
          ${r.branch ? ` &middot; branch <code>${escapeHtml(r.branch)}</code>` : ''}
        </div>
      </div>
    `).join('') : '<em>No activity yet.</em>';
    feed.querySelectorAll('.memory-activity-card').forEach(card => {
      card.addEventListener('click', () => {
        const matched = rows.find(r => r.sprint === card.dataset.sprint && r.source === card.dataset.source);
        if (!matched) return;
        showDrawer(`
          <div style="margin-bottom:8px;font-size:11px;color:var(--text-muted);">Sprint ${escapeHtml(matched.sprint)} · processed ${escapeHtml(matched.processed_at || '?')}</div>
          <pre style="background:var(--bg-surface);padding:10px;border-radius:4px;overflow-x:auto;font-size:12px;">${escapeHtml(JSON.stringify(matched, null, 2))}</pre>
        `);
      });
    });
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────
function onActivate() {
  renderShell();
}

function onDeactivate() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

registerTab('kb', { onActivate, onDeactivate });
