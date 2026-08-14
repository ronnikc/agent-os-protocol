/**
 * UI Assist Tab — embed the in-app assistant overlay into the user's own product.
 *
 * Hosted Mode: explains the overlay, offers one-click "clone to your repository" (commits the
 * embed + tailored instructions into the connected GitHub repo via the App), and shows both
 * integration paths — pointing the overlay at THIS hosted lobby's chat, or running it against a
 * local Agent OS Panel + relay. Local Mode: shows the local relay path + the integrate CLI.
 */
import { fetchJson, registerTab, escapeHtml, showAlert } from '../app.js';

let isHosted = false;
let github = null;

function snippet(text) {
  return `<pre style="background:var(--bg-base);border:1px solid var(--border);border-radius:6px;padding:12px;font-size:11px;overflow-x:auto;white-space:pre;">${escapeHtml(text)}</pre>`;
}

async function render() {
  const el = document.getElementById('uiassist-content');
  if (!el) return;
  isHosted = typeof window !== 'undefined' && !!window.AGENT_OS_HOSTED;

  let lobbyWs = 'ws://localhost:4730/api/v1/agent-lobby/ws/agent';
  let lobbyId = '';
  if (isHosted) {
    try {
      const s = JSON.parse(localStorage.getItem('agentos.hosted.session') || 'null');
      lobbyId = s?.lobbyId || '';
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      lobbyWs = `${proto}://${location.host}/api/v1/agent-lobby/ws/agent${lobbyId ? `?lobby_id=${lobbyId}` : ''}`;
      github = await fetchJson('/api/lobby/remote/integrations/github').catch(() => null);
    } catch { github = null; }
  }

  const hostedSnippet = snippet(
    `<script type="module">\n` +
    `  import { mountUiAssist } from '/agent-os/ui-assist/embed.js';\n` +
    `  mountUiAssist({ relayUrl: '${lobbyWs}' });\n` +
    `</script>`);
  const localSnippet = snippet(
    `# 1. Run the local panel + relay next to your working copy\n` +
    `npm run agent-os-panel            # panel http://localhost:4800 · relay ws://localhost:4722\n\n` +
    `# 2. Let the Integration Agent detect your framework and print the embed plan\n` +
    `npm run ui-assist-integrate -- /path/to/your/app\n\n` +
    `# 3. Or mount manually\n` +
    `<script type="module">\n` +
    `  import { mountUiAssist } from './ui-assist/embed.js';\n` +
    `  mountUiAssist({ relayUrl: 'ws://localhost:4722' });\n` +
    `</script>`);

  const repoConnected = !!(github?.connected && github.repo);
  const cloneSection = !isHosted ? '' : `
    <div class="card" style="padding:16px;display:flex;flex-direction:column;gap:10px;">
      <h4 style="margin:0;font-size:14px;">Clone the embed into your repository</h4>
      <span style="font-size:12px;color:var(--text-secondary);line-height:1.5;">
        Commits <code>agent-os/ui-assist/embed.js</code> (the dependency-free overlay) plus a README
        with these instructions — tailored to this lobby — into
        ${repoConnected ? `<strong>📁 ${escapeHtml(github.repo)}@${escapeHtml(github.branch || 'main')}</strong>` : 'your connected repository'}.
        Files already present are left untouched.
      </span>
      ${repoConnected
        ? `<button class="btn btn-primary btn-sm" id="btn-uiassist-clone" style="align-self:flex-start;">Clone UI Assist to ${escapeHtml(github.repo)}</button>`
        : `<span style="font-size:12px;color:var(--color-yellow,#eab308);">⚠ No GitHub repository connected — connect the GitHub App in the <strong>Lobby</strong> tab first.</span>`}
    </div>`;

  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px;max-width:900px;">
      <div class="card" style="padding:16px;">
        <h4 style="margin:0 0 8px;font-size:14px;">What is UI Assist?</h4>
        <span style="font-size:12px;color:var(--text-secondary);line-height:1.55;">
          A floating assistant overlay (launcher + chat panel) you embed in <em>your own</em> web app
          with one script tag — dependency-free, framework-agnostic, no build step. It speaks the
          UI Assist event contract to an agent runtime and is <strong>suggest-only by default</strong>:
          edit/commit authority stays off until explicitly enabled.
        </span>
      </div>

      ${cloneSection}

      <div class="card" style="padding:16px;">
        <h4 style="margin:0 0 8px;font-size:14px;">Option A — connect to this hosted lobby's chat</h4>
        <span style="font-size:12px;color:var(--text-secondary);line-height:1.5;">
          Point the overlay at this lobby's WebSocket: messages from your app land in the lobby chat,
          where the Boss coordinates the swarm${lobbyId ? ` (lobby <code>${escapeHtml(lobbyId.slice(0, 8))}…</code>)` : ''}.
        </span>
        ${hostedSnippet}
      </div>

      <div class="card" style="padding:16px;">
        <h4 style="margin:0 0 8px;font-size:14px;">Option B — run against a local Agent OS Panel + relay</h4>
        <span style="font-size:12px;color:var(--text-secondary);line-height:1.5;">
          For development next to your working copy: the local relay bridges the overlay to your own
          agent runtime (Claude CLI by default), with local-only BYOK keys.
        </span>
        ${localSnippet}
      </div>

      <div class="card" style="padding:16px;">
        <h4 style="margin:0 0 8px;font-size:14px;">Docs</h4>
        <span style="font-size:12px;color:var(--text-secondary);line-height:1.5;">
          Full guides live in your repo once cloned (<code>agent-os/ui-assist/README.md</code>) and in the
          Agent OS Protocol repository: <code>agent-os/UI-ASSIST.md</code> (interaction rules),
          <code>agent-os/UI-ASSIST-GUIDE.md</code>, and <code>docs/ui-assist/</code>.
        </span>
      </div>
    </div>`;

  document.getElementById('btn-uiassist-clone')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-uiassist-clone');
    if (btn) { btn.disabled = true; btn.textContent = 'Cloning…'; }
    const res = await fetchJson('/api/lobby/remote/repo/ui-assist', { method: 'POST' });
    if (res && res.ok) {
      showAlert('UI Assist Cloned', `Committed ${res.files_committed} file(s) to ${res.repo}@${res.branch} under agent-os/ui-assist/. Open the README there for the tailored embed instructions.`);
    } else {
      showAlert('Clone Failed', res?.error || 'Unknown error');
    }
    render();
  });
}

registerTab('uiassist', { onActivate: render });
