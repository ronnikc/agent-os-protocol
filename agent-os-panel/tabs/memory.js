/**
 * Memory Tab — read-only views over the Agent OS Memory v2 substrate.
 *
 * Sub-tabs: Index | Facts | Diaries | Lessons
 *   - Index    INDEX.aaak.jsonl entries, substring search, click → file drawer
 *   - Facts    facts.jsonl rows, predicate / search / as-of filters, timeline
 *   - Diaries  per-agent sidebar → diary markdown + lessons drawer
 *   - Lessons  most-recent N lesson files across all agents
 *
 * Sprint 46.6.5 — Agent OS Panel: Memory Tab.
 * Read-only — no write paths land in this sprint.
 */
import { fetchJson, registerTab, escapeHtml } from '../app.js';

const SUBTABS = ['index', 'facts', 'diaries', 'lessons', 'activity'];
let activeSubtab = 'index';
let indexEntries = [];
let factsAll = [];
let diariesAgentList = [];
let selectedAgent = null;
let lessonsFeed = [];

// ── GitHub-style header slug (mirrors agent-os/scripts/build-memory-index.mjs) ──
function slugify(s) {
  return s.toLowerCase()
    .replace(/[`'"!@#$%^&*()+=[\]{};:,.<>?/\\|~]/g, '')
    .replace(/&/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ── Minimal markdown renderer (kept tiny — we only need headings, code, lists) ──
// Sprint 46.6.8: emit `id` attributes on H1/H2/H3 so the Index drawer can
// scroll to the GitHub-style anchor referenced by INDEX.aaak entries.
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
function renderShell() {
  const root = document.getElementById('memory-content');
  if (!root) return;
  root.innerHTML = `
    <div role="tablist" aria-label="Memory sub-tabs"
         style="display:flex;gap:4px;padding:8px 12px;border-bottom:1px solid var(--border);">
      ${SUBTABS.map(s => `
        <button role="tab" data-subtab="${s}"
                aria-selected="${activeSubtab === s}"
                tabindex="${activeSubtab === s ? 0 : -1}"
                class="btn btn-sm ${activeSubtab === s ? 'btn-primary' : 'btn-secondary'}"
                style="text-transform:capitalize;">${s}</button>
      `).join('')}
    </div>
    <div id="memory-subtab-pane" style="flex:1;overflow:hidden;display:flex;flex-direction:column;"></div>
    <div id="memory-drawer" aria-live="polite"
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
}

function switchSubtab(id) {
  activeSubtab = id;
  document.querySelectorAll('#memory-content button[data-subtab]').forEach(b => {
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
  const drawer = document.getElementById('memory-drawer');
  if (!drawer) return;
  drawer.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <strong>Detail</strong>
      <button class="btn btn-sm btn-secondary" id="memory-drawer-close">Close</button>
    </div>
    ${html}
  `;
  drawer.style.display = 'block';
  document.getElementById('memory-drawer-close')?.addEventListener('click', () => {
    drawer.style.display = 'none';
    drawer.innerHTML = '';
  });
}

// ── Index sub-tab ──────────────────────────────────────────────────
async function loadIndex() {
  if (indexEntries.length) return;
  const data = await fetchJson('/api/memory/index');
  indexEntries = data?.entries ?? [];
}

async function renderIndexSubtab() {
  await loadIndex();
  const pane = document.getElementById('memory-subtab-pane');
  if (!pane) return;

  // Sprint 46.6.8 — semantic-search input gated by MEMORY_SEMANTIC_RECALL.
  const recallStatus = await fetchJson('/api/memory/recall/status');
  const recallEnabled = recallStatus?.enabled === true;

  pane.innerHTML = `
    <div style="padding:12px;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      <label for="memory-index-q" style="font-size:12px;color:var(--text-muted);">Substring</label>
      <input type="text" id="memory-index-q" placeholder="topic or entity (substring match)"
             style="flex:1;min-width:200px;padding:6px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);" />
      ${recallEnabled ? `
        <label for="memory-index-sem" style="font-size:12px;color:var(--text-muted);">Semantic</label>
        <input type="text" id="memory-index-sem" placeholder="natural-language query (Sprint 46.6.8)"
               style="flex:1;min-width:200px;padding:6px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);" />
        <button id="memory-index-sem-go" class="btn btn-sm btn-primary" type="button">Recall</button>
        <button id="memory-index-sem-clear" class="btn btn-sm btn-secondary" type="button">Clear</button>
      ` : ''}
      <span id="memory-index-count" style="font-size:12px;color:var(--text-muted);"></span>
    </div>
    <div id="memory-index-list" class="scroll-panel" style="flex:1;overflow:auto;padding:8px 12px;"></div>
  `;
  const input = document.getElementById('memory-index-q');
  const list  = document.getElementById('memory-index-list');
  const count = document.getElementById('memory-index-count');

  function renderList(filter) {
    const f = (filter ?? '').toLowerCase();
    const matches = !f ? indexEntries : indexEntries.filter(e => {
      const hay = `${e.topic} ${(e.entities || []).join(' ')} ${e.ref}`.toLowerCase();
      return hay.includes(f);
    });
    count.textContent = `${matches.length} of ${indexEntries.length}`;
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
          input.value = e.target.dataset.entity;
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
          // Sprint 46.6.8 — anchor scroll. The renderer now emits id="<slug>"
          // attributes; if the INDEX entry referenced a slug, scroll the
          // matching heading into view.
          if (anchor) {
            const drawer = document.getElementById('memory-drawer');
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
        input.value = chip.dataset.entity;
        renderList(input.value);
      });
    });
  }

  input.addEventListener('input', () => renderList(input.value));
  renderList('');

  // Sprint 46.6.8 — wire semantic search if the env-var was on at server start.
  const semInput = document.getElementById('memory-index-sem');
  const semGo    = document.getElementById('memory-index-sem-go');
  const semClear = document.getElementById('memory-index-sem-clear');
  async function runSemantic() {
    const q = (semInput?.value || '').trim();
    if (!q) { renderList(input.value); return; }
    const data = await fetchJson(`/api/memory/recall?q=${encodeURIComponent(q)}&top=20`);
    const matches = data?.results ?? [];
    count.textContent = matches.length
      ? `${matches.length} semantic match(es) — model=${data.model || '?'}`
      : `0 semantic matches`;
    list.innerHTML = matches.map(m => `
      <div class="memory-row" style="padding:6px 8px;border-bottom:1px solid var(--border);cursor:pointer;" data-ref="${escapeHtml(m.doc_id)}">
        <div style="font-weight:500;">${(m.score ?? 0).toFixed(3)} — ${escapeHtml(m.doc_id)}</div>
        <div style="font-size:11px;color:var(--text-muted);">[${escapeHtml(m.corpus || '')}]</div>
      </div>
    `).join('') || '<em>No matches.</em>';
    list.querySelectorAll('.memory-row').forEach(row => {
      row.addEventListener('click', async () => {
        const ref = row.dataset.ref;
        // doc_id is either an INDEX ref (path#anchor) or a diary agent slug
        if (ref.includes('#') || ref.endsWith('.md')) {
          const [path, anchor] = ref.split('#');
          const fileData = await fetchJson(`/api/memory/file?path=${encodeURIComponent(path)}`);
          if (fileData?.content) {
            showDrawer(`
              <div style="margin-bottom:8px;font-size:11px;color:var(--text-muted);">${escapeHtml(path)}${anchor ? ` <strong>#${escapeHtml(anchor)}</strong>` : ''}</div>
              ${renderMarkdown(fileData.content)}
            `);
            if (anchor) {
              const drawer = document.getElementById('memory-drawer');
              drawer?.querySelector(`#${CSS.escape(anchor)}`)?.scrollIntoView({ block: 'start' });
            }
          }
        } else {
          // diary corpus — open the agent's diary
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
  semGo?.addEventListener('click', runSemantic);
  semInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') runSemantic(); });
  semClear?.addEventListener('click', () => {
    if (semInput) semInput.value = '';
    input.value = '';
    renderList('');
  });
}

// ── Facts sub-tab ─────────────────────────────────────────────────
async function loadFacts() {
  if (factsAll.length) return factsAll;
  const data = await fetchJson('/api/memory/facts');
  factsAll = data?.facts ?? [];
  return factsAll;
}

async function renderFactsSubtab() {
  await loadFacts();
  const pane = document.getElementById('memory-subtab-pane');
  if (!pane) return;
  const predicates = Array.from(new Set(factsAll.map(f => f.predicate).filter(Boolean))).sort();
  pane.innerHTML = `
    <div style="padding:12px;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      <label for="memory-facts-pred" style="font-size:12px;">Predicate</label>
      <select id="memory-facts-pred" style="padding:6px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);">
        <option value="">all</option>
        ${predicates.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('')}
      </select>
      <label for="memory-facts-q" style="font-size:12px;">Search</label>
      <input type="text" id="memory-facts-q" placeholder="subject or object"
             style="padding:6px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);" />
      <label for="memory-facts-asof" style="font-size:12px;">As of</label>
      <input type="date" id="memory-facts-asof"
             style="padding:6px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);" />
      <span id="memory-facts-count" style="font-size:12px;color:var(--text-muted);margin-left:auto;"></span>
    </div>
    <div class="scroll-panel" style="flex:1;overflow:auto;">
      <table class="data-table" style="width:100%;font-size:12px;">
        <thead><tr>
          <th>subject</th><th>predicate</th><th>object</th>
          <th>valid_from</th><th>valid_to</th><th>source</th><th>sprint</th><th></th>
        </tr></thead>
        <tbody id="memory-facts-tbody"></tbody>
      </table>
    </div>
  `;
  const predEl = document.getElementById('memory-facts-pred');
  const qEl    = document.getElementById('memory-facts-q');
  const asofEl = document.getElementById('memory-facts-asof');
  const tbody  = document.getElementById('memory-facts-tbody');
  const count  = document.getElementById('memory-facts-count');

  async function reload() {
    const params = new URLSearchParams();
    if (predEl.value) params.set('predicate', predEl.value);
    if (asofEl.value) params.set('as_of', asofEl.value);
    const data = await fetchJson('/api/memory/facts?' + params.toString());
    let rows = data?.facts ?? [];
    if (qEl.value.trim()) {
      const q = qEl.value.toLowerCase();
      rows = rows.filter(f => (f.subject || '').toLowerCase().includes(q) || (f.object || '').toLowerCase().includes(q));
    }
    count.textContent = `${rows.length} fact(s)`;
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

  predEl.addEventListener('change', reload);
  qEl.addEventListener('input', reload);
  asofEl.addEventListener('change', reload);
  reload();
}

// ── Diaries sub-tab ───────────────────────────────────────────────
async function loadDiariesAgentList() {
  if (diariesAgentList.length) return;
  // Use INDEX entries to derive agent names from sub-agent:<name> scope.
  // build-memory-index.mjs emits two scopes per agent: `sub-agent:<name>` for
  // lessons and `sub-agent:<name>:diary` for diary entries — strip the
  // `:diary` suffix so both fold into a single sidebar entry.
  await loadIndex();
  const seen = new Set();
  for (const e of indexEntries) {
    const m = (e.scope || '').match(/^sub-agent:(.+)$/);
    if (!m) continue;
    const name = m[1].replace(/:diary$/, '');
    if (name && name !== 'shared') seen.add(name);
  }
  // Also list every directory under agent-os/sub-agents/ with a diary,
  // by asking the diary endpoint. We can't list the FS from the panel,
  // so we lean on a hard-coded SUB-AGENTS roster list.
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
  const pane = document.getElementById('memory-subtab-pane');
  if (!pane) return;
  pane.innerHTML = `
    <div style="display:flex;flex:1;overflow:hidden;">
      <div id="memory-diaries-sidebar" style="width:220px;border-right:1px solid var(--border);overflow:auto;padding:8px;">
        ${diariesAgentList.map(a => `
          <button class="memory-agent-pill" data-agent="${a}"
                  style="display:block;width:100%;text-align:left;padding:6px 8px;margin:2px 0;background:none;border:1px solid transparent;color:var(--text);border-radius:3px;cursor:pointer;font-size:13px;">
            ${escapeHtml(a)}
          </button>
        `).join('')}
      </div>
      <div id="memory-diaries-main" style="flex:1;overflow:auto;padding:16px;">
        <em style="color:var(--text-muted);">Select an agent to view its diary.</em>
      </div>
    </div>
  `;
  pane.querySelectorAll('.memory-agent-pill').forEach(b => {
    b.addEventListener('click', () => selectAgent(b.dataset.agent));
  });
  if (selectedAgent) selectAgent(selectedAgent);
}

async function selectAgent(agent) {
  selectedAgent = agent;
  document.querySelectorAll('.memory-agent-pill').forEach(p => {
    p.style.background = p.dataset.agent === agent ? 'var(--bg-surface)' : 'none';
    p.style.borderColor = p.dataset.agent === agent ? 'var(--accent)' : 'transparent';
  });
  const main = document.getElementById('memory-diaries-main');
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
    ${isPlaceholder ? '<div style="padding:8px;border:1px dashed var(--border);font-size:12px;color:var(--text-muted);margin-bottom:12px;">Diary is the placeholder — no entries yet. The orchestrator will append on the next sprint close-out.</div>' : ''}
    <div style="border:1px solid var(--border);padding:12px;border-radius:3px;margin-bottom:16px;background:var(--bg-surface);">
      ${renderMarkdown(data.content)}
    </div>
    <details>
      <summary style="cursor:pointer;font-size:13px;color:var(--text);">Lessons (${(data.lessons || []).length})</summary>
      <div id="memory-diaries-lessons" style="padding-top:8px;"></div>
    </details>
  `;
  const lessonsEl = document.getElementById('memory-diaries-lessons');
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

// ── Lessons sub-tab ───────────────────────────────────────────────
async function renderLessonsSubtab() {
  const pane = document.getElementById('memory-subtab-pane');
  if (!pane) return;
  pane.innerHTML = `
    <div style="padding:12px;border-bottom:1px solid var(--border);font-size:12px;color:var(--text-muted);">
      20 most recent per-agent lesson files (mtime-sorted).
    </div>
    <div id="memory-lessons-feed" class="scroll-panel" style="flex:1;overflow:auto;padding:8px 12px;"><em>Loading...</em></div>
  `;
  const data = await fetchJson('/api/memory/lessons?limit=20');
  lessonsFeed = data?.lessons ?? [];
  const feed = document.getElementById('memory-lessons-feed');
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

// ── Activity sub-tab (Sprint 46.6.9) ───────────────────────────────
async function renderActivitySubtab() {
  const pane = document.getElementById('memory-subtab-pane');
  if (!pane) return;
  pane.innerHTML = `
    <div style="padding:12px;border-bottom:1px solid var(--border);font-size:12px;color:var(--text-muted);">
      Recent processed sprint close-outs. Reads <code>.claude/spawn-requests/consumed/</code> + monthly archive.
    </div>
    <div id="memory-activity-feed" class="scroll-panel" style="flex:1;overflow:auto;padding:8px 12px;"><em>Loading...</em></div>
  `;
  const data = await fetchJson('/api/memory/activity?limit=50');
  const rows = data?.activity ?? [];
  const feed = document.getElementById('memory-activity-feed');
  feed.innerHTML = rows.length ? rows.map(r => `
    <div class="memory-activity-card" style="padding:10px;border:1px solid var(--border);border-radius:3px;margin:6px 0;cursor:pointer;background:var(--bg-surface);"
         data-sprint="${escapeHtml(r.sprint)}" data-source="${escapeHtml(r.source)}">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;">
        <strong>Sprint ${escapeHtml(r.sprint)}</strong>
        <span style="font-size:11px;color:var(--text-muted);">${escapeHtml(r.processed_at || '?')} · ${escapeHtml(r.source)}</span>
      </div>
      <div style="font-size:12px;color:var(--text-muted);">
        diary writes: <strong>${r.diary_writes}</strong> ·
        rollovers: <strong>${r.rollovers}</strong> ·
        fact emitted: <strong>${r.fact_emitted ? 'yes' : 'no'}</strong>
        ${r.branch ? ` · branch <code>${escapeHtml(r.branch)}</code>` : ''}
      </div>
    </div>
  `).join('') : '<em>No activity yet — run a sprint close-out.</em>';
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

// ── Lifecycle ─────────────────────────────────────────────────────
function onActivate() {
  renderShell();
  switchSubtab(activeSubtab);
}

registerTab('memory', { onActivate });
