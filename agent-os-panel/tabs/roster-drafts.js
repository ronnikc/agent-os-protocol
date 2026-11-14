// SPDX-License-Identifier: Apache-2.0
import { closeModal, escapeHtml, fetchJson, postJson, showModal, state } from '../app.js';

const labels = { create: 'Create Agent', import: 'Import Agent', train: 'Train Agent' };

export function initRosterDrafts(refresh) {
  const toolbar = document.querySelector('#agent-draft-actions');
  if (!toolbar) return;
  const hosted = Boolean(window.AGENT_OS_HOSTED);
  const endpoint = hosted ? '/api/lobby/remote/roster-drafts' : '/api/local-training';
  const submit = (root, button, payload, success) => act(endpoint, root, button, payload, success);
  if (!hosted) {
    for (const button of toolbar.querySelectorAll('[data-draft-kind="create"], [data-draft-kind="import"]')) button.hidden = true;
  }
  toolbar.hidden = false;
  toolbar.addEventListener('click', event => {
    const kind = event.target.closest('[data-draft-kind]')?.dataset.draftKind;
    if (kind === 'list') void manage();
    else if (labels[kind]) edit(kind);
  });

  function edit(kind) {
    showModal(`<h2>${labels[kind]}</h2><form id="roster-draft-form">
      ${kind === 'import' ? '<label class="form-label">GitHub Markdown file at a full commit SHA<input class="form-input" name="source" type="url" required maxlength="500"></label><button type="button" class="btn btn-secondary" data-preview>Load file</button>' : ''}
      ${kind === 'train' ? `<label class="form-label">Agent<select class="form-input" name="slug" required>
        ${(state.agents ?? []).map(agent => `<option value="${escapeHtml(agent.slug)}">${escapeHtml(agent.name)}</option>`).join('')}</select></label>`
      : '<label class="form-label">Agent slug<input class="form-input" name="slug" required pattern="[a-z][a-z0-9\\-]{1,63}"></label>'}
      <label class="form-label">${kind === 'train' ? 'Lesson title' : 'Agent name'}<input class="form-input" name="title" required maxlength="120"></label>
      <label class="form-label">${kind === 'train' ? 'Training guidance' : 'Agent instructions'}<textarea class="form-input" name="content" required maxlength="16000" rows="10"></textarea></label>
      ${kind !== 'train' ? '<label class="form-label">Hosted tool access<select name="tools" class="form-input"><option value="read-only">Read only</option><option value="standard">Standard hosted tools</option></select></label>' : ''}
      <p role="status" data-status></p><button class="btn btn-primary" type="submit">Save draft</button></form>`, { wide: true });
    const form = document.querySelector('#roster-draft-form');
    const preview = form.querySelector('[data-preview]');
    let pinnedSource;
    form.elements.source?.addEventListener('input', () => { pinnedSource = undefined; });
    preview?.addEventListener('click', async () => {
      const source = form.elements.source.value.trim();
      await submit(form, preview, { action: 'import-preview', source }, result => {
        if (source !== form.elements.source.value.trim()) return;
        form.elements.content.value = result.content;
        pinnedSource = source;
      });
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form));
      if (kind === 'import' && pinnedSource !== values.source.trim()) {
        form.querySelector('[data-status]').textContent = 'Load this GitHub file before saving the draft.';
        return;
      }
      await submit(form, event.submitter, {
        ...values, source: pinnedSource, action: 'save', kind,
      }, result => showDraft(result.draft));
    });
  }

  async function manage() {
    showModal('<h2>Agent drafts and training</h2><p role="status" id="roster-draft-list">Loading…</p>');
    const root = document.querySelector('#roster-draft-list');
    const data = await fetchJson(endpoint);
    if (!root.isConnected) return;
    if (!Array.isArray(data?.drafts)) {
      root.textContent = data?.error || 'Could not load drafts.';
      return;
    }
    root.textContent = data.drafts.length ? '' : 'No drafts yet.';
    for (const draft of data.drafts.slice().reverse()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-secondary';
      button.textContent = `${draft.title} · ${draft.status}`;
      button.addEventListener('click', () => showDraft(draft));
      root.append(button, document.createElement('br'));
    }
  }

  function showDraft(draft) {
    const pending = draft.status === 'draft';
    showModal(`<h2>${escapeHtml(draft.title)}</h2>
      <p>${escapeHtml(draft.slug)} · ${escapeHtml(draft.status)}</p>
      ${draft.source ? `<p>Source <code>${escapeHtml(draft.source)}</code></p>` : ''}
      <label class="form-label">Draft preview<textarea class="form-input" readonly rows="10">${escapeHtml(draft.content)}</textarea></label>
      ${draft.review ? `<label class="form-label">Agent Evaluation Engineer review<textarea class="form-input" readonly rows="6">${escapeHtml(draft.review)}</textarea></label>` : ''}
      <div id="roster-draft-detail">
        ${pending && draft.kind !== 'train' ? `<label><input type="checkbox" data-confirm-tools> Approve ${draft.tools === 'standard' ? 'standard hosted' : 'read-only'} tool access for this agent. Available tools depend on the runtime and assigned task.</label>` : ''}
        <p role="status" data-status></p>
      ${pending && hosted ? '<p>Agent review uses the lobby’s model provider and hosted model budget in Apps.</p><button class="btn btn-secondary" data-action="review">Request agent review</button>' : ''}
      ${pending ? '<button class="btn btn-primary" data-action="activate">Activate</button>' : ''}
        ${draft.status === 'active' ? '<button class="btn btn-secondary" data-action="retire">Retire</button>' : ''}
      <button class="btn btn-secondary" data-action="back">Back to drafts</button>
      <button class="btn btn-secondary" data-action="close">Close</button>
      </div>`, { wide: true });
    const root = document.querySelector('#roster-draft-detail');
    root.addEventListener('click', async event => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const action = button.dataset.action;
      if (action === 'back') { await manage(); return; }
      if (action === 'close') { closeModal(); return; }
      await submit(root, button, { action, id: draft.id, confirmTools: root.querySelector('[data-confirm-tools]')?.checked }, async result => {
        if (action === 'review') showDraft({ ...draft, review: result.review });
        else { closeModal(); await refresh(); }
      });
    });
  }
}

async function act(endpoint, root, button, payload, success) {
  if (!button || button.disabled) return;
  button.disabled = true;
  const status = root.querySelector('[data-status]');
  status.textContent = 'Working…';
  try {
    const result = await postJson(endpoint, payload);
    if (!result || result.error) {
      status.textContent = result?.error || 'The roster action could not be completed.';
      return;
    }
    status.textContent = '';
    if (root.isConnected) await success(result);
  } catch {
    status.textContent = 'The roster action could not be completed. Try again.';
  } finally {
    button.disabled = false;
  }
}
