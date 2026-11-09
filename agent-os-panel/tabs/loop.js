/**
 * Loop Tab — Loop Mode (Phase 11): list presets, start a run (attended / unattended),
 * watch live per-criterion progress, budget burn, checkmark criteria, and pause/resume/stop.
 *
 * Runs here are SIMULATED by the panel server (deterministic seams; no live gate skills or lobby),
 * the same as `npm run loop`.
 */
import { fetchJson, postJson, registerTab, escapeHtml, onWsMessage, showAlert } from '../app.js';

let presets = [];
let runs = [];
let isHosted = false;

async function load() {
  isHosted = typeof window !== 'undefined' && !!window.AGENT_OS_HOSTED;
  const data = await fetchJson('/api/loops');
  presets = data?.presets || [];
  runs = data?.runs || [];
  render();
}

function statusColor(s) {
  if (s === 'converged') return 'var(--color-green)';
  if (s === 'running') return 'var(--color-cyan)';
  if (s === 'paused') return 'var(--color-blue)';
  if (s === 'awaiting_checkpoint') return 'var(--color-purple)';
  if (['exhausted', 'stalled', 'killed', 'error'].includes(s)) return 'var(--color-red)';
  return 'var(--color-text-soft)';
}

function criterionLabel(criterion) {
  switch (criterion.type) {
    case 'gate':
      return criterion.threshold == null ? criterion.skill : `${criterion.skill} (threshold: ${criterion.threshold})`;
    case 'tests':
      return 'Tests must pass';
    case 'review':
      return `Review by ${criterion.approver}`;
    case 'assertion':
      return criterion.expr;
    default:
      return criterion.type;
  }
}

function render() {
  const el = document.getElementById('loop-content');
  if (!el) return;

  const presetRows = presets.map(p => `
    <div class="loop-preset-box">
      <div style="font-family:var(--display);font-size:13px;font-weight:600;color:var(--color-text);">${escapeHtml(p.name)}</div>
      <div style="font-size:11px;color:var(--color-text-muted);margin:4px 0 12px;line-height:1.45;">${escapeHtml(p.description || '')}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-primary btn-sm" data-run="${escapeHtml(p.name)}">Run</button>
        <button class="btn btn-secondary btn-sm" data-run-unattended="${escapeHtml(p.name)}">Unattended</button>
      </div>
      <div style="font-size:10px;color:var(--color-text-soft);margin-top:8px;line-height:1.3;">
        Auto-approves: ${(p.unattendedAllowlist || []).map(a => `<code>${escapeHtml(a)}</code>`).join(', ') || 'none'}
      </div>
    </div>`).join('');

  const runRows = runs.length ? runs.map(r => {
    const isRunning = r.status === 'running';
    const isPaused = r.status === 'paused' || r.paused;
    const isAwaiting = r.status === 'awaiting_checkpoint';
    const statusClass = `status-${r.status}`;
    
    // Checkpoints Approval UI
    const approvalHtml = isAwaiting ? `
      <div class="checkpoint-approval-box">
        <div style="font-family:var(--display);font-weight:600;color:var(--color-yellow);display:flex;align-items:center;gap:6px;">
          <span>⚠ Human Approval Required</span>
        </div>
        <div style="font-size:12px;color:var(--color-text);line-height:1.4;margin:4px 0 8px;">
          Agent is requesting permission to run: <strong><code>${escapeHtml(r.pendingCheckpoint || 'commit')}</code></strong>.
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-success btn-sm" data-approve="${escapeHtml(r.id)}">Approve & Resume</button>
          <button class="btn btn-danger btn-sm" data-reject="${escapeHtml(r.id)}">Reject & Stop</button>
        </div>
      </div>
    ` : '';

    // Budget & Progress calculations
    const maxIter = r.preset === 'continuous-quality' ? 30 : 20; 
    const maxTokens = 5000;
    const maxCost = 0.50;
    const maxTime = 10; // 10 minutes

    const iterPercent = Math.min(100, (r.iterations / maxIter) * 100);
    
    const tokens = r.budgetUsed?.tokens || 0;
    const tokensPercent = Math.min(100, (tokens / maxTokens) * 100);

    const cost = r.budgetUsed?.costUSD || 0;
    const costPercent = Math.min(100, (cost / maxCost) * 100);

    const time = r.budgetUsed?.wallClockMin || 0;
    const timePercent = Math.min(100, (time / maxTime) * 100);

    // Criteria rendering
    const criteriaHtml = r.criteriaResults ? r.criteriaResults.map(cr => {
      const isPassed = cr.passed;
      const icon = isPassed ? '✓' : '✗';
      const cls = isPassed ? 'passed' : 'failed';
      return `
        <div class="loop-criterion-item">
          <span class="loop-criterion-check ${cls}">${icon}</span>
          <span style="color:${isPassed ? 'var(--color-text)' : 'var(--color-text-muted)'}">${escapeHtml(criterionLabel(cr.criterion))}</span>
        </div>
      `;
    }).join('') : '';

    // Action button controls
    let controlsHtml = '';
    if (isRunning) {
      controlsHtml = `
        <button class="btn btn-secondary btn-sm" data-pause="${escapeHtml(r.id)}">Pause</button>
        <button class="btn btn-danger btn-sm" data-stop="${escapeHtml(r.id)}">Stop</button>
      `;
    } else if (isPaused) {
      controlsHtml = `
        <button class="btn btn-primary btn-sm" data-resume="${escapeHtml(r.id)}">Resume</button>
        <button class="btn btn-danger btn-sm" data-stop="${escapeHtml(r.id)}">Stop</button>
      `;
    } else if (isAwaiting) {
      controlsHtml = `
        <button class="btn btn-danger btn-sm" data-stop="${escapeHtml(r.id)}">Stop</button>
      `;
    }

    return `
      <div class="loop-run-box" data-runrow="${escapeHtml(r.id)}">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;border-bottom:1px solid var(--color-border);padding-bottom:12px;">
          <div>
            <span class="status-dot ${statusClass}"></span>
            <span style="font-family:var(--display);font-weight:600;font-size:14px;color:var(--color-text);">${escapeHtml(r.preset)}</span>
            <span style="font-size:11px;color:var(--color-text-soft);margin-left:8px;">ID: ${escapeHtml(r.id)}</span>
          </div>
          <span class="badge ${r.attended ? 'badge-info' : 'badge-warning'}">${r.attended ? 'Attended' : 'Unattended'}</span>
          <span style="font-size:11px;font-weight:600;color:${statusColor(r.status)};text-transform:uppercase;margin-left:6px;">${escapeHtml(r.status)}</span>
          <span style="flex:1"></span>
          <div style="display:flex;gap:6px;">
            ${controlsHtml}
          </div>
        </div>

        <div style="font-size:13px;line-height:1.4;margin-bottom:14px;color:var(--color-text-muted);">
          <strong>Goal:</strong> ${escapeHtml(r.goal || '')}
        </div>

        ${approvalHtml}

        <div class="loop-progress-container">
          <div class="loop-progress-item">
            <div class="loop-progress-header">
              <span>Iterations</span>
              <span>${r.iterations} / ${maxIter}</span>
            </div>
            <div class="loop-bar-wrapper">
              <div class="loop-bar-fill" style="width: ${iterPercent}%"></div>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
            <div class="loop-progress-item">
              <div class="loop-progress-header">
                <span>Tokens</span>
                <span>${tokens} / ${maxTokens}</span>
              </div>
              <div class="loop-bar-wrapper">
                <div class="loop-bar-fill" style="width: ${tokensPercent}%;background:var(--color-cyan)"></div>
              </div>
            </div>
            <div class="loop-progress-item">
              <div class="loop-progress-header">
                <span>Cost USD</span>
                <span>$${cost.toFixed(2)} / $${maxCost.toFixed(2)}</span>
              </div>
              <div class="loop-bar-wrapper">
                <div class="loop-bar-fill" style="width: ${costPercent}%;background:var(--color-violet)"></div>
              </div>
            </div>
            <div class="loop-progress-item">
              <div class="loop-progress-header">
                <span>Wall-Clock</span>
                <span>${time.toFixed(1)}m / ${maxTime}m</span>
              </div>
              <div class="loop-bar-wrapper">
                <div class="loop-bar-fill" style="width: ${timePercent}%;background:var(--color-blue)"></div>
              </div>
            </div>
          </div>
        </div>

        ${criteriaHtml ? `
          <div style="font-family:var(--display);font-size:11px;font-weight:600;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">Exit Criteria (${r.passing}/${r.total} passed)</div>
          <div class="loop-criteria-list">
            ${criteriaHtml}
          </div>
        ` : ''}
      </div>`;
  }).join('') : '<div class="empty-state">No loop runs active. Select a preset on the left to launch.</div>';

  // Hosted Mode has no loop engine on the lobby server (the LoopOrchestrator runs on a local
  // panel/relay next to your repo) — say so instead of offering Run buttons that silently 404.
  const hostedNotice = isHosted ? `
    <div style="margin-bottom:14px;padding:12px;background:rgba(234,179,8,0.08);border:1px solid rgba(234,179,8,0.2);border-radius:6px;font-size:12px;line-height:1.5;color:var(--color-text-muted);">
      <strong style="color:var(--color-yellow);">Loop Mode runs locally.</strong>
      The loop engine executes on a local Panel/relay next to your working copy
      (<code>npm run agent-os-panel</code>), where checkpoints gate real commits/merges.
      Hosted lobby loop execution is on the roadmap — presets below are shown for reference.
    </div>` : '';

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:260px 1fr;gap:24px;height:100%;min-height:500px;">
      <!-- Left sidebar: Presets -->
      <div style="border-right:1px solid var(--color-border);padding-right:20px;overflow-y:auto;display:flex;flex-direction:column;gap:12px;">
        <div style="font-family:var(--display);font-size:12px;font-weight:600;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.08em;">Loop Presets</div>
        ${presetRows || '<div class="empty-state">No presets.</div>'}
      </div>

      <!-- Right area: Active/Past Runs -->
      <div style="overflow-y:auto;padding-right:4px;display:flex;flex-direction:column;">
        ${hostedNotice}
        <div style="font-family:var(--display);font-size:12px;font-weight:600;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px;">Execution Swarm Logs</div>
        ${runRows}
      </div>
    </div>`;

  // Bind Preset buttons
  el.querySelectorAll('[data-run]').forEach(b => b.onclick = () => start(b.getAttribute('data-run'), false));
  el.querySelectorAll('[data-run-unattended]').forEach(b => b.onclick = () => start(b.getAttribute('data-run-unattended'), true));
  
  // Bind Loop Run controls
  el.querySelectorAll('[data-stop]').forEach(b => b.onclick = () => postJson('/api/loops/stop', { id: b.getAttribute('data-stop') }));
  el.querySelectorAll('[data-pause]').forEach(b => b.onclick = () => postJson('/api/loops/pause', { id: b.getAttribute('data-pause') }));
  el.querySelectorAll('[data-resume]').forEach(b => b.onclick = () => postJson('/api/loops/resume', { id: b.getAttribute('data-resume') }));
  
  // Bind Checkpoint approvals
  el.querySelectorAll('[data-approve]').forEach(b => b.onclick = () => postJson('/api/loops/decide', { id: b.getAttribute('data-approve'), approve: true }));
  el.querySelectorAll('[data-reject]').forEach(b => b.onclick = () => postJson('/api/loops/decide', { id: b.getAttribute('data-reject'), approve: false }));
}

async function start(preset, unattended) {
  if (isHosted) {
    showAlert('Loop Mode Runs Locally', 'The loop engine executes on a local Panel/relay next to your working copy — run `npm run agent-os-panel` locally and start the loop there. Hosted loop execution is on the roadmap.');
    return;
  }
  await postJson('/api/loops/run', { preset, unattended });
  load();
}

// Live updates from the panel server.
onWsMessage('loop-event', () => { load(); });
onWsMessage('loop-done', () => { load(); });

registerTab('loop', { onActivate: load });
