/**
 * Apps Tab — deploy, CI, and chat/data integrations for the connected repo.
 *
 * Everything here is OWNER-CONNECTED (bring-your-own credentials): Agent OS scaffolds the setup and
 * orchestrates, but deploys/DBs/bots run on YOUR accounts. The GitHub repo connection itself stays
 * in the Lobby tab; this tab is where you turn that repo into something that ships and talks.
 *
 *   Live now:   Vercel deploy scaffold · GitHub Actions CI scaffold
 *   Foundation: Slack (server-side integration foundation)
 *   Planned:    Discord · Telegram · Supabase (hosted DB) · dreambase.io (stats)
 */
import { fetchJson, registerTab, escapeHtml, showAlert, showHtmlAlert } from '../app.js';

let github = null;

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
  github = await fetchJson('/api/lobby/remote/integrations/github').catch(() => null);
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
  const slack = card({
    accent: '#611f69', badge: foundationBadge, title: 'Slack',
    body: `Relay the lobby chat to/from a Slack workspace so the swarm is reachable where your team already works. The server-side foundation (install + authorization) is in place; the panel configuration UI is being wired next.`,
    foot: 'Owner-connected: your Slack app + bot token, scoped to this lobby.',
  });
  const discord = card({
    accent: '#5865F2', badge: plannedBadge, title: 'Discord',
    body: `Bridge the lobby to a Discord server (bot token + channel link, two-way message relay), alongside Slack.`,
    foot: 'Owner-connected. Planned.',
  });
  const telegram = card({
    accent: '#229ED9', badge: plannedBadge, title: 'Telegram',
    body: `Bridge the lobby to a Telegram chat/channel via a bot token, for mobile-first notifications and control.`,
    foot: 'Owner-connected. Planned.',
  });

  // ── Data & stats ──
  const supabase = card({
    accent: '#3ECF8E', badge: plannedBadge, title: 'Supabase — hosted DB',
    body: `Connect <strong>your own</strong> Supabase project as the hosted database for what the swarm builds. Agent OS scaffolds schema/migrations into your repo and stores your project URL + keys sealed per-lobby — never shared.`,
    foot: 'Owner-connected. Planned.',
  });
  const dreambase = card({
    accent: '#7c5cff', badge: plannedBadge, title: 'dreambase.io — stats',
    body: `Surface project stats and analytics on top of a connected Supabase — usage, growth and health at a glance.`,
    foot: 'Available when Supabase is connected. Planned.',
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
}

async function scaffold(endpoint, label, el) {
  const btn = el.querySelector(endpoint === 'scaffold-vercel' ? '#btn-app-vercel' : '#btn-app-ci');
  const original = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = `Scaffolding ${label}…`; }
  const res = await fetchJson(`/api/lobby/remote/repo/${endpoint}`, { method: 'POST' });
  if (res && res.ok) {
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
