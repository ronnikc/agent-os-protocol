/**
 * Apps Tab — deploy, CI, and chat/data integrations for the connected repo.
 *
 * Everything here is OWNER-CONNECTED (bring-your-own credentials): Agent OS scaffolds the setup and
 * orchestrates, but deploys/DBs/bots run on YOUR accounts. The GitHub repo connection itself stays
 * in the Lobby tab; this tab is where you turn that repo into something that ships and talks.
 *
 *   Deploy & CI:  Vercel deploy scaffold · GitHub Actions CI scaffold
 *   Chat apps:    Slack · Discord · Telegram (owner-connected bot token, sealed per-lobby)
 *   Data & stats: Supabase (hosted DB + migrations scaffold) · dreambase.io (stats, on Supabase)
 *
 * Every integration is owner-connected: the owner brings their own credential, the lobby seals it
 * per-lobby and never shares it; status endpoints return only a masked hint.
 */
import { fetchJson, registerTab, escapeHtml, showAlert, showHtmlAlert } from '../app.js';

let github = null;

// Owner-connected chat/data integrations: the owner brings their own credential, the lobby seals it
// per-lobby and never shares it. Status/connect/disconnect all go through /integrations/<provider>.
async function integStatus(provider) {
  return fetchJson(`/api/lobby/remote/integrations/${provider}`).catch(() => ({ connected: false }));
}

function connectRow(provider, fields) {
  const inputs = fields.map(f => `
    <input id="int-${provider}-${f.key}" type="${f.type || 'text'}" placeholder="${escapeHtml(f.placeholder)}"
      style="flex:1 1 180px; min-width:0; padding:6px 8px; font-size:12px; border:1px solid var(--color-border); border-radius:6px; background:var(--bg-input,rgba(0,0,0,0.2)); color:var(--text-primary);" />`).join('');
  return `
    <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; width:100%;">
      ${inputs}
      <button class="btn btn-secondary btn-sm" id="int-${provider}-connect">Connect</button>
    </div>`;
}

function connectedRow(provider, status) {
  const hint = status.secret_hint ? ` <code>${escapeHtml(status.secret_hint)}</code>` : '';
  const where = status.account || status.external_id || '';
  return `
    <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; width:100%;">
      <span class="badge badge-success" style="font-size:10px;">Connected</span>
      <span style="font-size:12px; color:var(--text-secondary);">${where ? escapeHtml(where) : 'credential set'}${hint}</span>
      <button class="btn btn-ghost btn-sm" id="int-${provider}-disconnect" style="margin-left:auto;">Disconnect</button>
    </div>`;
}

// Wire a connect/disconnect card: POST the owner's credential (never leaves their control unsealed),
// or DELETE to revoke. Re-render on success so the card reflects the new connected state.
function wireOwnerIntegration(provider, fields) {
  document.getElementById(`int-${provider}-connect`)?.addEventListener('click', async () => {
    const payload = {};
    for (const f of fields) {
      const v = document.getElementById(`int-${provider}-${f.key}`)?.value?.trim();
      if (v) payload[f.key] = v;
    }
    if (!payload[fields[0].key]) { showAlert('Missing credential', `Enter the ${fields[0].placeholder}.`); return; }
    const btn = document.getElementById(`int-${provider}-connect`);
    if (btn) { btn.disabled = true; btn.textContent = 'Connecting…'; }
    const res = await fetchJson(`/api/lobby/remote/integrations/${provider}`, { method: 'POST', body: JSON.stringify(payload) });
    if (res && res.ok) { render(); }
    else { if (btn) { btn.disabled = false; btn.textContent = 'Connect'; } showAlert('Connect failed', res?.error || 'Unknown error'); }
  });
  document.getElementById(`int-${provider}-disconnect`)?.addEventListener('click', async () => {
    const res = await fetchJson(`/api/lobby/remote/integrations/${provider}`, { method: 'DELETE' });
    if (res && res.ok) render(); else showAlert('Disconnect failed', res?.error || 'Unknown error');
  });
}

function card({ accent, badge, title, body, actions = '', foot = '' }) {
  return `
    <div style="border:1px solid var(--color-border); border-left:3px solid ${accent}; border-radius:8px; padding:14px; margin-bottom:12px; background:var(--bg-surface,rgba(16,27,49,0.35));">
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
        <strong style="font-size:14px;">${title}</strong>
        ${badge}
      </div>
      <div style="font-size:12px; color:var(--text-secondary); line-height:1.55;">${body}</div>
      ${actions ? `<div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">${actions}</div>` : ''}
      ${foot ? `<div style="margin-top:8px; font-size:11px; color:var(--text-muted); line-height:1.5;">${foot}</div>` : ''}
    </div>`;
}

const liveBadge = '<span class="badge badge-success" style="font-size:10px;">Live</span>';
const foundationBadge = '<span class="badge badge-warning" style="font-size:10px;">Foundation</span>';
const plannedBadge = '<span class="badge badge-muted" style="font-size:10px;">Planned</span>';

function sectionTitle(t, sub) {
  return `<div style="margin:6px 0 10px;"><span style="font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:var(--text-muted);">${t}</span>${sub ? ` <span style="font-size:11px; color:var(--text-muted);">· ${sub}</span>` : ''}</div>`;
}

async function render() {
  const el = document.getElementById('apps-content');
  if (!el) return;
  const isHosted = typeof window !== 'undefined' && !!window.AGENT_OS_HOSTED;
  if (!isHosted) {
    el.innerHTML = `<div class="empty-state" style="padding:32px;">Apps (Vercel deploy, CI, chat &amp; data integrations) are available in the hosted lobby.</div>`;
    return;
  }
  const [gh, slackStatus, discordStatus, telegramStatus, supabaseStatus, dreambaseStatus] = await Promise.all([
    fetchJson('/api/lobby/remote/integrations/github').catch(() => null),
    integStatus('slack'),
    integStatus('discord'),
    integStatus('telegram'),
    integStatus('supabase'),
    integStatus('dreambase'),
  ]);
  github = gh;
  const repo = github?.connected && github.repo ? github.repo : '';
  const repoLabel = repo ? `${escapeHtml(repo)}@${escapeHtml(github.branch || 'main')}` : '';

  const needsRepo = `<div style="font-size:11px; color:var(--color-yellow);">Connect a GitHub repository in the <strong>Lobby</strong> tab first.</div>`;

  // ── Deploy & CI (live, repo-scaffold) ──
  const vercel = card({
    accent: 'var(--color-cyan)', badge: liveBadge, title: '▲ Vercel — deploy',
    body: `Scaffold <code>vercel.json</code> + a GitHub Actions deploy workflow into ${repo ? `<strong>${repoLabel}</strong>` : 'your repo'}. Deploys run on <strong>your own</strong> Vercel, from your repo — Agent OS never holds your Vercel token (it lives in your repo's Actions secrets).`,
    actions: repo ? `<button class="btn btn-secondary btn-sm" id="btn-app-vercel">Set up Vercel deploy</button>` : needsRepo,
    foot: 'Push to your working branch → production deploy; open a PR → preview deploy.',
  });
  const ci = card({
    accent: 'var(--color-green)', badge: liveBadge, title: '✓ GitHub CI — build &amp; test',
    body: `Scaffold a GitHub Actions workflow so every push and PR — including the agents' <code>agent-os/session/*</code> work-session branch — runs install → lint → build → test on GitHub's runners. The lobby reads the results back to guide the agents (no shell on this host).`,
    actions: repo ? `<button class="btn btn-secondary btn-sm" id="btn-app-ci">Set up CI (build &amp; test)</button>` : needsRepo,
    foot: 'Steps use <code>--if-present</code>, so a repo without those scripts still passes until you add them.',
  });

  // ── Chat apps ──
  const slackFields = [
    { key: 'bot_token', placeholder: 'Slack bot token (xoxb-…)', type: 'password' },
    { key: 'external_id', placeholder: 'Channel ID (optional)' },
  ];
  const slack = card({
    accent: '#611f69', badge: slackStatus?.connected ? liveBadge : foundationBadge, title: 'Slack',
    body: `Relay the lobby chat to/from a Slack workspace so the swarm is reachable where your team already works. Paste a <strong>bot token</strong> from your own Slack app (and optionally a channel ID). Sealed per-lobby, never shared.`,
    actions: slackStatus?.connected ? connectedRow('slack', slackStatus) : connectRow('slack', slackFields),
    foot: 'Owner-connected: your Slack app + bot token, scoped to this lobby. <a href="https://api.slack.com/apps" target="_blank" rel="noopener">Create an app →</a>',
  });
  const discordFields = [
    { key: 'bot_token', placeholder: 'Discord bot token', type: 'password' },
    { key: 'external_id', placeholder: 'Channel ID (optional)' },
  ];
  const discord = card({
    accent: '#5865F2', badge: discordStatus?.connected ? liveBadge : foundationBadge, title: 'Discord',
    body: `Bridge the lobby to a Discord server so the swarm is reachable from your channels. Paste a <strong>bot token</strong> from your own Discord app (and optionally a channel ID). Agent OS seals it per-lobby and never shares it.`,
    actions: discordStatus?.connected ? connectedRow('discord', discordStatus) : connectRow('discord', discordFields),
    foot: 'Owner-connected: your Discord app + bot token, scoped to this lobby. <a href="https://discord.com/developers/applications" target="_blank" rel="noopener">Create a bot →</a>',
  });
  const telegramFields = [
    { key: 'bot_token', placeholder: 'Telegram bot token', type: 'password' },
    { key: 'external_id', placeholder: 'Chat/channel ID (optional)' },
  ];
  const telegram = card({
    accent: '#229ED9', badge: telegramStatus?.connected ? liveBadge : foundationBadge, title: 'Telegram',
    body: `Bridge the lobby to a Telegram chat/channel for mobile-first notifications and control. Paste a <strong>bot token</strong> from <code>@BotFather</code> (and optionally a chat ID). Sealed per-lobby, never shared.`,
    actions: telegramStatus?.connected ? connectedRow('telegram', telegramStatus) : connectRow('telegram', telegramFields),
    foot: 'Owner-connected: your Telegram bot token, scoped to this lobby. <a href="https://core.telegram.org/bots#botfather" target="_blank" rel="noopener">Create a bot →</a>',
  });

  // ── Data & stats ──
  const supabaseConnected = !!supabaseStatus?.connected;
  const supabaseUrl = (supabaseStatus?.scopes || []).find(s => String(s).startsWith('url:'))?.slice(4) || '';
  const supabaseFields = [
    { key: 'service_key', placeholder: 'Supabase service key', type: 'password' },
    { key: 'project_url', placeholder: 'https://<ref>.supabase.co' },
  ];
  const supabaseActions = supabaseConnected
    ? `${connectedRow('supabase', { ...supabaseStatus, account: supabaseStatus.account || supabaseUrl })}
       ${repo ? `<button class="btn btn-secondary btn-sm" id="btn-app-supabase-scaffold" style="margin-top:8px;">Scaffold schema &amp; migrations</button>` : needsRepo}`
    : connectRow('supabase', supabaseFields);
  const supabase = card({
    accent: '#3ECF8E', badge: supabaseConnected ? liveBadge : foundationBadge, title: 'Supabase — hosted DB',
    body: `Connect <strong>your own</strong> Supabase project as the hosted database for what the swarm builds. Paste your project's <strong>service key</strong> + <strong>URL</strong>; Agent OS seals them per-lobby (never shared) and can scaffold a <code>supabase/</code> migrations folder into your repo.`,
    actions: supabaseActions,
    foot: 'Owner-connected: your Supabase project + service key, scoped to this lobby. <a href="https://supabase.com/dashboard" target="_blank" rel="noopener">Open dashboard →</a>',
  });
  const dreambaseConnected = !!dreambaseStatus?.connected;
  const dreambaseFields = [
    { key: 'api_key', placeholder: 'dreambase API key', type: 'password' },
    { key: 'project_id', placeholder: 'Project ID (optional)' },
  ];
  const dreambaseActions = !supabaseConnected
    ? `<div style="font-size:11px; color:var(--color-yellow);">Connect <strong>Supabase</strong> above first — dreambase surfaces stats on top of it.</div>`
    : dreambaseConnected ? connectedRow('dreambase', dreambaseStatus) : connectRow('dreambase', dreambaseFields);
  const dreambase = card({
    accent: '#7c5cff', badge: dreambaseConnected ? liveBadge : supabaseConnected ? foundationBadge : plannedBadge, title: 'dreambase.io — stats',
    body: `Surface project stats and analytics on top of your connected Supabase — usage, growth and health at a glance. Paste your <strong>dreambase API key</strong> (and optionally a project ID); sealed per-lobby, never shared.`,
    actions: dreambaseActions,
    foot: 'Owner-connected: your dreambase account, scoped to this lobby. <a href="https://dreambase.io" target="_blank" rel="noopener">dreambase.io →</a>',
  });

  el.innerHTML = `
    ${sectionTitle('Deploy &amp; CI', repo ? repoLabel : 'no repo connected')}
    ${vercel}${ci}
    ${sectionTitle('Chat apps', 'reach the swarm where your team is')}
    ${slack}${discord}${telegram}
    ${sectionTitle('Data &amp; stats')}
    ${supabase}${dreambase}
  `;

  document.getElementById('btn-app-vercel')?.addEventListener('click', () => scaffold('scaffold-vercel', 'Vercel deploy', el));
  document.getElementById('btn-app-ci')?.addEventListener('click', () => scaffold('scaffold-ci', 'CI', el));
  wireOwnerIntegration('slack', slackFields);
  wireOwnerIntegration('discord', discordFields);
  wireOwnerIntegration('telegram', telegramFields);
  wireOwnerIntegration('supabase', supabaseFields);
  wireOwnerIntegration('dreambase', dreambaseFields);
  document.getElementById('btn-app-supabase-scaffold')?.addEventListener('click', () => scaffold('scaffold-supabase', 'Supabase migrations', el));
}

async function scaffold(endpoint, label, el) {
  const btnSel = endpoint === 'scaffold-vercel' ? '#btn-app-vercel'
    : endpoint === 'scaffold-ci' ? '#btn-app-ci'
    : '#btn-app-supabase-scaffold';
  const btn = el.querySelector(btnSel);
  const original = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = `Scaffolding ${label}…`; }
  const res = await fetchJson(`/api/lobby/remote/repo/${endpoint}`, { method: 'POST' });
  if (res && res.ok) {
    if (endpoint === 'scaffold-supabase') {
      const filesNote = res.files_committed
        ? `Committed ${res.files_committed} file(s) to ${res.repo}@${res.branch}: a <code>supabase/</code> migrations folder + <code>agent-os/SUPABASE-SETUP.md</code>.`
        : `The Supabase scaffold is already present in ${res.repo}@${res.branch}.`;
      showHtmlAlert('Supabase Scaffolded', `
        <div style="text-align:left; font-size:13px; line-height:1.6;">
          <p>${filesNote}</p>
          <p style="margin-top:10px;">Migrations run against <strong>your own</strong> Supabase project. Your service key stays sealed per-lobby and is never committed — the setup doc shows how to add it as a repo Actions secret if you want CI to apply migrations.</p>
        </div>`);
      render();
      return;
    }
    if (endpoint === 'scaffold-vercel') {
      const secrets = (res.required_secrets || []).map(s => `<code>${s}</code>`).join(', ');
      const filesNote = res.files_committed
        ? `Committed ${res.files_committed} file(s) to ${res.repo}@${res.branch}: <code>vercel.json</code>, <code>.github/workflows/deploy-vercel.yml</code>, <code>agent-os/VERCEL-SETUP.md</code>.`
        : `The Vercel deploy scaffold is already present in ${res.repo}@${res.branch}.`;
      showHtmlAlert('Vercel Deploy Scaffolded', `
        <div style="text-align:left; font-size:13px; line-height:1.6;">
          <p>${filesNote}</p>
          <p style="margin-top:10px;">Deploys run on <strong>your own</strong> Vercel, from your repo. Add these three <strong>GitHub Actions secrets</strong> (Settings → Secrets and variables → Actions) from your Vercel account:</p>
          <p style="margin:8px 0;">${secrets}</p>
          <p style="font-size:12px; color:var(--text-muted);">Full steps in <code>agent-os/VERCEL-SETUP.md</code>. Agent OS never stores your Vercel token.</p>
        </div>`);
    } else {
      const filesNote = res.files_committed
        ? `Committed ${res.files_committed} file(s) to ${res.repo}@${res.branch}: <code>.github/workflows/ci.yml</code>, <code>agent-os/CI.md</code>.`
        : `CI is already set up in ${res.repo}@${res.branch}.`;
      showHtmlAlert('CI Scaffolded', `
        <div style="text-align:left; font-size:13px; line-height:1.6;">
          <p>${filesNote}</p>
          <p style="margin-top:10px;">Every push and pull request — including the agents' <code>agent-os/session/*</code> work-session branch — now runs <strong>install → lint → build → test</strong> on GitHub's runners.</p>
          <p style="font-size:12px; color:var(--text-muted);">Details in <code>agent-os/CI.md</code>; the lobby reads these results back so agents can fix a red run.</p>
        </div>`);
    }
    render();
  } else {
    if (btn) { btn.disabled = false; btn.textContent = original || `Set up ${label}`; }
    showAlert(`${label} Scaffold Failed`, res?.error || 'Unknown error');
  }
}

registerTab('apps', { onActivate: render });
