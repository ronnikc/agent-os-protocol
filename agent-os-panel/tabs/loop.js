/**
 * Loop Tab — Loop Mode (Phase 11): list presets, start a run (attended / unattended),
 * watch live per-criterion progress, and stop a run.
 *
 * Runs here are SIMULATED by the panel server (deterministic seams; no live gate skills or lobby),
 * the same as `npm run loop`. The polished view + live evaluate/delegate wiring is Phase 12 /
 * the relay-driver refactor — see docs/loop-mode.md.
 */
import { fetchJson, postJson, registerTab, escapeHtml, onWsMessage } from '../app.js';

let presets = [];
let runs = [];

async function load() {
  const data = await fetchJson('/api/loops');
  presets = data?.presets || [];
  runs = data?.runs || [];
  render();
}

function statusColor(s) {
  if (s === 'converged') return 'var(--success)';
  if (s === 'running') return 'var(--purple)';
  if (s === 'awaiting_checkpoint') return 'var(--warning, #c80)';
  if (['exhausted', 'stalled', 'killed', 'error'].includes(s)) return 'var(--danger, #c33)';
  return 'var(--text-muted)';
}

function render() {
  const el = document.getElementById('loop-content');
  if (!el) return;
  const presetRows = presets.map(p => `
    <div style="border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px;">
      <div style="font-weight:600;">${escapeHtml(p.name)}</div>
      <div style="font-size:12px;color:var(--text-muted);margin:2px 0 8px;">${escapeHtml(p.description || '')}</div>
      <button class="btn" data-run="${escapeHtml(p.name)}">Run (attended)</button>
      <button class="btn" data-run-unattended="${escapeHtml(p.name)}">Run unattended</button>
      <span style="font-size:11px;color:var(--text-muted);">unattended auto-approves only: ${(p.unattendedAllowlist || []).join(', ') || '—'}</span>
    </div>`).join('');

  const runRows = runs.length ? runs.map(r => `
    <div style="border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px;" data-runrow="${escapeHtml(r.id)}">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-weight:600;color:${statusColor(r.status)};">${escapeHtml(r.status)}</span>
        <span style="font-size:12px;">${escapeHtml(r.preset)} · ${r.passing}/${r.total} criteria · iter ${r.iterations}</span>
        <span style="font-size:11px;color:var(--text-muted);">${r.attended ? 'attended' : 'unattended'}</span>
        <span style="flex:1"></span>
        ${r.status === 'running' ? `<button class="btn" data-stop="${escapeHtml(r.id)}">Stop</button>` : ''}
      </div>
      <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">${escapeHtml(r.goal || '')}</div>
    </div>`).join('') : '<div style="color:var(--text-muted);font-size:12px;">No runs yet.</div>';

  el.innerHTML = `
    <div style="font-weight:600;margin-bottom:6px;">Presets</div>
    ${presetRows || '<div style="color:var(--text-muted);">No presets.</div>'}
    <div style="font-weight:600;margin:14px 0 6px;">Runs</div>
    ${runRows}
    <p style="font-size:11px;color:var(--text-muted);margin-top:12px;">
      Runs are simulated (deterministic seams; no live gate skills or lobby). See docs/loop-mode.md.</p>`;

  el.querySelectorAll('[data-run]').forEach(b => b.onclick = () => start(b.getAttribute('data-run'), false));
  el.querySelectorAll('[data-run-unattended]').forEach(b => b.onclick = () => start(b.getAttribute('data-run-unattended'), true));
  el.querySelectorAll('[data-stop]').forEach(b => b.onclick = () => postJson('/api/loops/stop', { id: b.getAttribute('data-stop') }));
}

async function start(preset, unattended) {
  await postJson('/api/loops/run', { preset, unattended });
  load();
}

// Live updates from the panel server.
onWsMessage('loop-event', (d) => { upsertRun(d); });
onWsMessage('loop-done', (d) => { load(); });

function upsertRun(d) {
  const r = runs.find(x => x.id === d.id);
  if (r) {
    r.iterations = d.iteration ?? r.iterations;
    if (d.passing != null) { r.passing = d.passing; r.total = d.total ?? r.total; }
    render();
  } else {
    load();
  }
}

registerTab('loop', { onActivate: load });
