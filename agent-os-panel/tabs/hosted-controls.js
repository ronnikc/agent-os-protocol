// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

import { fetchJson, escapeHtml } from '../app.js';

const base = '/api/lobby/remote';
const fields = [
  ['periodHours', 'Rolling budget period (hours)', 1, 744, 24],
  ['modelPerRun', 'Model tokens per run', 0, 1000000000, 100000],
  ['modelPerPeriod', 'Model tokens per period', 0, 1000000000, 1000000],
  ['computePerRun', 'Compute per run (millionths of USD)', 0, 1000000000, 0],
  ['computePerPeriod', 'Compute per period (millionths of USD)', 0, 1000000000, 0],
  ['concurrency', 'Concurrent hosted runs', 1, 100, 4],
  ['deadlineMs', 'Run deadline (milliseconds)', 1, 86400000, 120000],
];

function request(path, method, body) {
  return fetchJson(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

export async function mountHostedControls(root) {
  const settings = await request('/hosted-controls', 'GET');
  if (!root.isConnected) return;
  if (!settings || settings.error) return;
  const policy = settings.policy ?? {};
  root.innerHTML = `
    <h2>Hosted limits and cloud workspaces</h2>
    <form data-policy>
      <label><input type="checkbox" name="workspaceEnabled" ${policy.workspaceEnabled ? 'checked' : ''}> Enable workspace execution</label>
      ${fields.map(([name, label, min, max, fallback]) => `
        <label class="form-label">${label}
          <input class="form-input" type="number" required name="${name}" min="${min}" max="${max}" value="${policy[name] ?? fallback}">
        </label>`).join('')}
      <button class="btn btn-secondary btn-sm" type="submit">Save limits</button>
      <p role="status" data-status></p>
    </form>
    <h3>Provider connections</h3>
    <form data-provider>
      <label>Provider <select name="provider">${settings.providers.map(({ id, capabilities }) =>
        `<option value="${escapeHtml(id)}">${escapeHtml(id)}${capabilities ? '' : ' (adapter unavailable)'}</option>`).join('')}</select></label>
      <label>Action <select name="action"></select></label>
      <label data-credential>Credential <input name="credential" type="password" autocomplete="new-password" maxlength="8192"></label>
      <button class="btn btn-secondary btn-sm" type="submit">Apply provider change</button>
      <p role="status" data-status></p>
      <p data-connection></p>
      <div data-capabilities hidden>
        <label>Approved profile <select data-profile></select></label>
        <p data-profile-details></p>
      </div>
    </form>
    <h3>Hosted run history</h3>
    <p role="status" data-history-status></p>
    <div data-runs></div>
    <button class="btn btn-secondary btn-sm" type="button" data-refresh>Refresh history</button>
    <button class="btn btn-secondary btn-sm" type="button" data-recover>Retry recovery</button>
    <button class="btn btn-secondary btn-sm" type="button" data-prev>Previous page</button>
    <button class="btn btn-secondary btn-sm" type="button" data-next>Next page</button>
  `;
  const policyForm = root.querySelector('[data-policy]');
  const providerForm = root.querySelector('[data-provider]');
  const provider = providerForm.elements.provider;
  const action = providerForm.elements.action;
  const credential = providerForm.elements.credential;
  const capabilities = providerForm.querySelector('[data-capabilities]');
  const profile = providerForm.querySelector('[data-profile]');
  let profiles = [];
  let connections = settings.connections;
  function showProfile() {
    const selected = profiles.find(entry => entry.id === profile.value);
    providerForm.querySelector('[data-profile-details]').textContent = selected
      ? [selected.cpu + ' vCPU', selected.memoryMiB + ' MiB memory', selected.diskMiB + ' MiB disk',
          selected.isolation, 'Egress ' + selected.egress, 'Maximum ' + selected.maxRuntimeMs + ' ms',
          'Regions ' + selected.regions.join(', ')].join(' · ')
      : '';
  }
  profile.addEventListener('change', showProfile);
  function showConnection() {
    profiles = settings.providers.find(entry => entry.id === provider.value)?.capabilities?.profiles ?? [];
    capabilities.hidden = profiles.length === 0;
    profile.replaceChildren(...profiles.map(entry => new Option(entry.id, entry.id)));
    showProfile();
    const connection = connections.find(entry => entry.provider === provider.value);
    action.innerHTML = connection
      ? (connection.status === 'active' && settings.providers.some(entry => entry.id === provider.value && entry.canVerify)
        ? '<option value="verify">Verify connection</option>' : '') +
        '<option value="rotate">Rotate credential and enable</option><option value="disable">Disable</option><option value="disconnect">Disconnect</option>'
      : '<option value="connect">Connect</option>';
    providerForm.querySelector('[data-connection]').textContent = connection
      ? `${connection.status === 'active' ? 'Enabled' : 'Disabled'} ${connection.hint || ''}`
      : 'Disconnected';
    showCredential();
  }
  function showCredential() {
    credential.required = action.value === 'connect' || action.value === 'rotate';
    credential.disabled = !credential.required;
    providerForm.querySelector('[data-credential]').hidden = credential.disabled;
    if (credential.disabled) credential.value = '';
  }
  async function submit(form, work) {
    const button = form.querySelector('button[type="submit"]');
    const status = form.querySelector('[data-status]');
    if (button.disabled) return;
    button.disabled = true;
    status.textContent = 'Saving…';
    try { await work(status); }
    finally { button.disabled = false; }
  }
  policyForm.addEventListener('submit', event => {
    event.preventDefault();
    void submit(policyForm, async status => {
      const values = Object.fromEntries(fields.map(([name]) => [name, policyForm.elements[name].valueAsNumber]));
      values.workspaceEnabled = policyForm.elements.workspaceEnabled.checked;
      const result = await request('/hosted-controls', 'PUT', values);
      status.textContent = result?.policy ? 'Hosted limits saved.' : result?.error || 'Unable to save hosted limits. Try again.';
      if (result?.policy) void history(offset);
    });
  });
  provider.addEventListener('change', showConnection);
  action.addEventListener('change', showCredential);
  providerForm.addEventListener('submit', event => {
    event.preventDefault();
    void submit(providerForm, async status => {
      const result = await request('/integrations/cloud-workspaces/' + encodeURIComponent(provider.value), 'POST', {
        action: action.value, ...(credential.disabled ? {} : { credential: credential.value }),
      });
      if (result?.verified) {
        status.textContent = 'Provider connection verified.';
        return;
      }
      if (!Array.isArray(result?.connections)) {
        status.textContent = result?.error || 'Unable to change the provider connection. Try again.';
        return;
      }
      status.textContent = 'Provider connection updated.';
      credential.value = '';
      connections = result.connections;
      showConnection();
    });
  });
  showConnection();

  const runs = root.querySelector('[data-runs]');
  const status = root.querySelector('[data-history-status]');
  const refresh = root.querySelector('[data-refresh]');
  const recover = root.querySelector('[data-recover]');
  const previous = root.querySelector('[data-prev]');
  const next = root.querySelector('[data-next]');
  let offset = 0;
  const pageSize = 20;
  let version = 0;
  async function history(target, message) {
    const current = ++version;
    previous.disabled = next.disabled = refresh.disabled = true;
    const page = await request(`/hosted-runs?limit=${pageSize}&offset=${target}`, 'GET');
    if (current !== version) return;
    refresh.disabled = false;
    if (!Array.isArray(page?.data)) {
      status.textContent = page?.error || 'Unable to load hosted runs. Refresh to retry.';
      return;
    }
    offset = page.offset;
    previous.disabled = offset === 0;
    next.disabled = offset + page.data.length >= page.total;
    status.textContent = message || (page.total ? `Showing ${offset + 1}–${offset + page.data.length} of ${page.total} runs.` : 'No hosted runs.');
    runs.innerHTML = page.data.map(run => {
      const unit = run.kind === 'model' ? 'tokens' : 'millionths of USD';
      const reserved = run.usage.reduce((total, item) => total + item.reserved, 0);
      const actual = run.usage.reduce((total, item) => total + (item.actual ?? 0), 0);
      const pending = run.usage.some(item => item.actual === undefined);
      return `<article>
        <h4>${escapeHtml(run.kind)} · ${escapeHtml(run.taskId || run.id)}</h4>
        <p>${escapeHtml(run.state)} · Cleanup ${escapeHtml(run.cleanup)} · Estimated ${reserved} ${unit} · Reported ${pending && !run.usage.some(item => item.actual !== undefined) ? 'pending' : actual + ' ' + unit}${pending && actual > 0 ? ' (partial)' : ''}</p>
        ${run.failure ? `<p>${escapeHtml(run.failure)}</p>` : ''}
        ${['succeeded', 'failed', 'cancelled'].includes(run.state) ? '' :
          `<button class="btn btn-secondary btn-sm" data-cancel="${escapeHtml(run.id)}" type="button">Cancel run</button>`}
      </article>`;
    }).join('');
  }
  runs.addEventListener('click', async event => {
    const button = event.target.closest('[data-cancel]');
    if (!button) return;
    if (!window.confirm('Cancel this hosted run? Any workspace will be queued for cleanup.')) {
      button.focus();
      return;
    }
    button.disabled = true;
    const result = await request('/hosted-runs/' + encodeURIComponent(button.dataset.cancel), 'DELETE');
    if (result?.accepted) {
      await history(offset, 'Cancellation requested. Refresh to check cleanup.');
      refresh.focus();
    } else {
      status.textContent = result?.error || 'Unable to cancel the run. Try again.';
      button.disabled = false;
      button.focus();
    }
  });
  recover.addEventListener('click', async () => {
    recover.disabled = true;
    const result = await request('/hosted-runs/recover', 'POST');
    recover.disabled = false;
    if (result?.accepted) await history(offset, 'Recovery requested. Refresh to check cleanup.');
    else status.textContent = result?.error || 'Unable to request recovery. Try again.';
    recover.focus();
  });
  refresh.addEventListener('click', () => void history(offset));
  previous.addEventListener('click', () => void history(Math.max(0, offset - pageSize)));
  next.addEventListener('click', () => void history(offset + pageSize));
  await history(0);
}
