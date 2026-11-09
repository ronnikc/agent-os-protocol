import { state, fetchJson, postJson, registerTab, escapeHtml, showIdentitySuccessModal, showAlert, showHtmlAlert, hostedSession, signInToLobby, savedPanelIdentity, linkPanelIdentity } from '../app.js';

let draftCard = null;
let validationResult = null;
let registrationPlan = null;
let linkedDid = '';
let lobbyMode = 'local';
let selectedSlug = '';
let githubConnected = false;
let rosterAgents = []; // connected (live) lobby agents — the hosted pre-populate source

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      out[k] = sortKeys(value[k]);
    }
    return out;
  }
  return value;
}

function cardHasInlineSecret(card) {
  const SECRET_PATTERNS = [
    /sk-[A-Za-z0-9_-]{16,}/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /ghp_[A-Za-z0-9]{20,}/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\bseed\s*phrase\b/i,
    /\b(?:[a-z]+\s+){11,23}[a-z]+\b.*\bmnemonic\b/i,
  ];
  const haystack = JSON.stringify(card);
  return SECRET_PATTERNS.some(re => re.test(haystack));
}

function validateAgentCard(card) {
  const errors = [];
  const mediaType = 'application/vnd.agent-os.card.v1+json';
  if (card.mediaType !== mediaType) errors.push(`mediaType must be "${mediaType}"`);
  if (!card.name?.trim()) errors.push('name is required');
  if (!card.description?.trim()) errors.push('description is required');
  if (!card.runtime?.trim()) errors.push('runtime is required');
  if (!card.version?.trim()) errors.push('version is required');
  if (!Array.isArray(card.capabilities)) errors.push('capabilities must be an array');
  if (!Array.isArray(card.supportedProtocols)) errors.push('supportedProtocols must be an array');
  if (!Array.isArray(card.allowedScopes)) errors.push('allowedScopes must be an array');
  if (card.contactUrl && !/^https?:\/\//.test(card.contactUrl)) errors.push('contactUrl must be an http(s) URL');
  if (!card.createdAt) errors.push('createdAt is required');
  if (!card.updatedAt) errors.push('updatedAt is required');
  if (cardHasInlineSecret(card)) errors.push('card must not contain a secret (key/seed/token)');
  return { ok: errors.length === 0, errors };
}

async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function load() {
  const modeData = await fetchJson('/api/mode');
  lobbyMode = (window.AGENT_OS_HOSTED || modeData?.mode === 'swarm') ? 'swarm' : 'local';

  if (lobbyMode === 'swarm') {
    try {
      // /api/agents is served locally AND intercepted in hosted mode; /api/agents/list never
      // existed on either backend, so this dropdown was always empty.
      const laRes = await fetchJson('/api/agents');
      state.agents = laRes?.agents || [];
    } catch (e) {
      console.warn('[Identity] Failed to fetch agents list:', e);
    }
    try {
      // The live roster — the pre-populate dropdown should offer the agents actually CONNECTED to
      // this lobby (what the user is minting an ID for), not the whole 60-definition catalog.
      const rosterRes = await fetchJson('/api/lobby/remote/agents');
      rosterAgents = (rosterRes?.agents || [])
        .filter(a => a.status !== 'disconnected' && a.participant_type !== 'human' && a.agent_role !== 'panel' && a.agent_role)
        .map(a => ({ slug: a.agent_role, name: a.display_name || a.agent_role, agent_id: a.agent_id }));
    } catch (e) {
      rosterAgents = [];
      console.warn('[Identity] Failed to fetch lobby roster:', e);
    }
    try {
      const gitRes = await fetchJson('/api/lobby/remote/integrations/github');
      githubConnected = !!(gitRes && gitRes.connected && gitRes.repo);
    } catch (e) {
      console.warn('[Identity] Failed to fetch github integration:', e);
      githubConnected = false;
    }
  } else {
    githubConnected = true;
  }

  let cachedCard = null;
  try {
    const cached = localStorage.getItem('agent-os-identity-card');
    if (cached) cachedCard = JSON.parse(cached);
  } catch {}

  if (cachedCard) {
    draftCard = cachedCard;
  } else {
    const data = await fetchJson('/api/identity/card');
    draftCard = data?.card || {
      name: 'Boss Agent',
      description: 'Central orchestrator agent',
      capabilities: ['code-generation', 'sprint-planning'],
      runtime: 'claude-cli',
      ownerPolicy: 'none',
      supportedProtocols: ['lobby-message'],
      allowedScopes: ['*'],
      version: '1.0.0',
    };
  }

  try {
    linkedDid = localStorage.getItem('agent-os-linked-did') || '';
  } catch {}

  render();
}

async function handleSave() {
  readFormValues();
  draftCard.updatedAt = new Date().toISOString();
  try {
    localStorage.setItem('agent-os-identity-card', JSON.stringify(draftCard));
  } catch {}

  if (!window.AGENT_OS_HOSTED && lobbyMode !== 'swarm') {
    const res = await postJson('/api/identity/card', { card: draftCard });
    if (res && res.ok) {
      draftCard = res.card;
      showAlert('Success', 'Card draft saved locally!');
    } else {
      showAlert('Error', 'Failed to save draft card to server: ' + (res?.error || 'Unknown error'));
    }
  } else {
    showAlert('Success', 'Card draft saved locally in browser!');
  }
  render();
}

async function handleValidate() {
  readFormValues();
  draftCard.mediaType = 'application/vnd.agent-os.card.v1+json';
  if (!draftCard.createdAt) draftCard.createdAt = new Date().toISOString();
  draftCard.updatedAt = new Date().toISOString();

  const validation = validateAgentCard(draftCard);
  if (!validation.ok) {
    validationResult = { ok: false, errors: validation.errors };
    render();
    return;
  }

  try {
    const canonical = JSON.stringify(sortKeys(draftCard));
    const hash = await sha256(canonical);
    validationResult = { ok: true, hash };
  } catch (err) {
    validationResult = { ok: false, errors: [err.message] };
  }
  render();
}

async function handlePrepareReg() {
  readFormValues();
  draftCard.mediaType = 'application/vnd.agent-os.card.v1+json';
  if (!draftCard.createdAt) draftCard.createdAt = new Date().toISOString();
  draftCard.updatedAt = new Date().toISOString();

  const validation = validateAgentCard(draftCard);
  if (!validation.ok) {
    showAlert('Validation Failed', 'Validation failed, cannot prepare registration: ' + validation.errors.join('; '));
    return;
  }

  const network = document.getElementById('identity-network')?.value || 'mainnet';
  try {
    const canonical = JSON.stringify(sortKeys(draftCard));
    const cardHash = await sha256(canonical);
    const isSwarm = lobbyMode === 'swarm';
    const steps = isSwarm ? [
      `Review the Agent Card "${draftCard.name}" (v${draftCard.version}) — content hash sha256:${cardHash}.`,
      `Click "Mint Agent ID" and sign in your Concordium wallet (${network}) — the transaction is sponsored (gasless).`,
      `Everything after the signature is automatic: card hosting, on-chain anchor, and the DID bind committed to your repository.`,
    ] : [
      `Review the Agent Card "${draftCard.name}" (v${draftCard.version}) — content hash sha256:${cardHash}.`,
      `Open your Concordium wallet (or the registry MCP service) on ${network}.`,
      'Ask the registry to build the registration transaction for this card hash — it returns a sign-ready payload ({ hex, schema_json }); Agent OS does not build or hold it.',
      'Sign the payload in your wallet and submit it yourself. Agent OS never signs or submits.',
      'Once confirmed, copy the resulting DID back into Agent OS to link this profile to its reference.',
    ];
    registrationPlan = {
      card: draftCard,
      mediaType: draftCard.mediaType,
      cardHash,
      registry: 'concordium',
      network,
      steps,
      walletSideOnly: true,
      notice: isSwarm
        ? 'Agent OS automates this registration through a sponsored, gasless transaction co-signed by the lobby and automatically binds the DID back to your repository.'
        : 'Agent OS prepares this registration but never signs or submits it. Signing happens in your wallet; no private key is ever stored or transmitted by Agent OS.',
    };
    render();
  } catch (err) {
    showAlert('Error', 'Failed to prepare registration: ' + err.message);
  }
}

function drawProgressModal(stepStates) {
  const steps = [
    { key: 'github', label: 'GitHub Connection Check' },
    { key: 'signCard', label: 'Sign Agent Card (Wallet)' },
    { key: 'publish', label: 'Publish Metadata to Lobby' },
    { key: 'anchor', label: 'Anchor Registry on Concordium' },
    { key: 'bind', label: 'Auto-Bind DID to Repository' }
  ];

  const html = `
    <div style="padding:24px; text-align:left; min-width:340px; box-sizing:border-box;">
      <h3 style="margin:0 0 20px 0; color:var(--text-primary); font-size:16px; font-weight:600; display:flex; align-items:center; gap:8px;">
        <span style="display:inline-block; width:16px; height:16px; border:2px solid var(--primary); border-top-color:transparent; border-radius:50%; animation:mint-spin 1s linear infinite; box-sizing:border-box;"></span>
        Minting Agent ID...
      </h3>
      <div style="display:flex; flex-direction:column; gap:16px; margin-bottom:24px;">
        ${steps.map((s, idx) => {
          const state = stepStates[s.key]; // 'pending', 'active', 'success', 'warning', 'error'
          let icon = '';
          let color = 'var(--text-muted)';
          let desc = '';

          if (state === 'pending') {
            icon = `<span style="display:inline-block; width:16px; height:16px; border-radius:50%; border:2px solid var(--border); box-sizing:border-box; vertical-align:middle; margin-right:10px;"></span>`;
          } else if (state === 'active') {
            icon = `<span style="display:inline-block; width:16px; height:16px; border:2px solid var(--primary); border-top-color:transparent; border-radius:50%; animation:mint-spin 1s linear infinite; box-sizing:border-box; vertical-align:middle; margin-right:10px;"></span>`;
            color = 'var(--primary)';
            desc = `<div style="font-size:11px; color:var(--text-secondary); margin-left:26px; margin-top:4px;">${escapeHtml(stepStates[s.key + '_desc'] || 'Processing...')}</div>`;
          } else if (state === 'success') {
            icon = `<span style="color:#22c55e; font-size:16px; font-weight:600; margin-right:10px; vertical-align:middle;">✓</span>`;
            color = 'var(--text-primary)';
          } else if (state === 'warning') {
            icon = `<span style="color:#eab308; font-size:16px; font-weight:600; margin-right:10px; vertical-align:middle;">⚠</span>`;
            color = 'var(--text-secondary)';
            desc = `<div style="font-size:11px; color:#eab308; margin-left:26px; margin-top:4px;">${escapeHtml(stepStates[s.key + '_desc'] || 'Skipped')}</div>`;
          } else if (state === 'error') {
            icon = `<span style="color:#ef4444; font-size:16px; font-weight:600; margin-right:10px; vertical-align:middle;">✗</span>`;
            color = '#ef4444';
            desc = `<div style="font-size:11px; color:#ef4444; margin-left:26px; margin-top:4px;">${escapeHtml(stepStates[s.key + '_desc'] || 'Failed')}</div>`;
          }

          return `
            <div>
              <div style="display:flex; align-items:center; font-size:13px; color:${color}; font-weight:${state === 'active' ? '600' : 'normal'};">
                ${icon}
                <span>${s.label}</span>
              </div>
              ${desc}
            </div>
          `;
        }).join('')}
      </div>
      <style>
        @keyframes mint-spin { to { transform: rotate(360deg); } }
      </style>
      <div class="form-actions" style="margin:0; justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeModal()" id="btn-mint-modal-close" ${Object.values(stepStates).includes('error') ? '' : 'disabled'}>Close</button>
      </div>
    </div>
  `;
  showModal(html);
}

async function handleMintIdentity() {
  try {
    await handleMintIdentityInner();
  } catch (err) {
    // A thrown error here used to die silently — the button looked dead. Always surface it.
    console.error('[Identity] Mint failed:', err);
    showAlert('Mint Failed', String(err?.message || err));
  }
}

async function handleMintIdentityInner() {
  readFormValues();
  const network = document.getElementById('identity-network')?.value || 'mainnet';
  const selectedSlug = document.getElementById('identity-agent-select')?.value
    || rosterAgents[0]?.slug || 'boss-agent';

  // NOTE: no stale load()-time GitHub gate here — the FRESH check below decides. The old gate used
  // `githubConnected` captured when the tab loaded, so connecting the repo after opening the tab
  // left Mint refusing with a misleading alert.

  if (!window.concordium) {
    showHtmlAlert('Concordium Wallet Required', `
      <div style="text-align:left;font-size:12px;line-height:1.5;">
        <p><strong>To register an Agent ID (DID) on the Concordium blockchain, you need the Concordium Browser Wallet.</strong></p>
        <p>1. Download the wallet extension from the <a href="https://chrome.google.com/webstore/detail/concordium-wallet/odfbpeocbbpdnneocdnlphceeapeglne" target="_blank" style="color:var(--color-purple);text-decoration:underline;">Chrome Web Store</a>.</p>
        <p>2. Create a Concordium ID. This ID links your real-world identity/accountability to your wallet address securely and privately.</p>
        <p>3. Your wallet address is then used to co-sign Agent IDs. This establishes a cryptographic trust chain: <strong>Human Owner (via Concordium ID) ➔ Wallet Address ➔ Agent ID (DID)</strong>.</p>
        <p>This accountability link is required to secure private lobbies, trace agent actions back to their owner, and prevent malicious agent spoofing.</p>
      </div>
    `);
    return;
  }

  // 1. Check if GitHub is connected in Swarm Mode
  const modeData = await fetchJson('/api/mode');
  const lobbyUrl = modeData?.lobbyUrl || '';
  const isHosted = typeof window !== 'undefined' && window.AGENT_OS_HOSTED;
  
  let hasGithub = true;
  let appConnectedNoRepo = false;
  if (isHosted) {
    const gitRes = await fetchJson('/api/lobby/remote/integrations/github').catch(() => null);
    // The bind step needs a SELECTED repository, not just an installed app — hold both to the
    // same bar so "connected" here can't still fail at bind time.
    hasGithub = !!(gitRes && gitRes.connected && gitRes.repo);
    appConnectedNoRepo = !!(gitRes && gitRes.connected && !gitRes.repo);
  }

  if (isHosted && !hasGithub) {
    showModal(`
      <div style="padding:20px; text-align:left; box-sizing:border-box;">
        <h3 style="margin:0 0 12px 0; color:#eab308; font-size:16px; font-weight:600;">${appConnectedNoRepo ? 'GitHub Repository Not Selected' : 'GitHub Repository Not Connected'}</h3>
        <p style="font-size:13px; color:var(--text-secondary); line-height:1.5; margin:0 0 16px;">
          Creating an Agent ID requires committing the resulting DID back to your repository's agent definition file.
          ${appConnectedNoRepo
            ? 'The GitHub App is connected, but no target repository is selected yet, so the lobby cannot automate this step.'
            : 'Without a connected GitHub repository, the lobby cannot automate this step.'}
        </p>
        <div style="background:var(--bg-elevated); border:1px solid var(--border); border-radius:6px; padding:12px; font-size:12px; color:var(--text-muted); margin-bottom:20px; line-height:1.5;">
          <strong>Recommended:</strong> Switch to the <strong>Lobby</strong> tab, ${appConnectedNoRepo ? 'pick your repository in the GitHub Swarm Connection card and save' : 'configure the GitHub App, select your repository'}, and then return here to mint.
        </div>
        <div class="form-actions" style="margin:0; display:flex; gap:8px; justify-content:flex-end;">
          <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" id="btn-mint-go-lobby">Go to Lobby Tab</button>
          <button class="btn btn-danger" id="btn-mint-skip-github" style="background:#dc2626; border-color:#dc2626;">Skip & Mint Anyway</button>
        </div>
      </div>
    `);

    document.getElementById('btn-mint-go-lobby')?.addEventListener('click', () => {
      closeModal();
      document.querySelector('[data-tab="lobby"]')?.click();
    });

    document.getElementById('btn-mint-skip-github')?.addEventListener('click', () => {
      runMintFlow(network, selectedSlug, lobbyUrl, false);
    });
  } else {
    runMintFlow(network, selectedSlug, lobbyUrl, isHosted && hasGithub);
  }
}

async function runMintFlow(network, selectedSlug, lobbyUrl, isGithubConnected) {
  const stepStates = {
    github: 'pending',
    signCard: 'pending',
    publish: 'pending',
    anchor: 'pending',
    bind: 'pending'
  };

  // Step 1: GitHub Check
  stepStates.github = 'active';
  stepStates.github_desc = 'Verifying repository connection...';
  drawProgressModal(stepStates);

  await new Promise(r => setTimeout(r, 400));

  if (isGithubConnected) {
    stepStates.github = 'success';
  } else {
    stepStates.github = 'warning';
    stepStates.github_desc = 'Skipped (no GitHub repository connected)';
  }

  // Step 2: Sign Card
  stepStates.signCard = 'active';
  stepStates.signCard_desc = 'Please sign the card message in your wallet...';
  drawProgressModal(stepStates);

  try {
    // The Concordium browser wallet exposes connect(); requestAccounts is not guaranteed on all
    // versions — when it's absent the old call threw inside the progress modal and Mint looked
    // dead. Use the same connection path as the (working) Agents-tab Create ID, with a fallback.
    let owner;
    if (typeof window.concordium.connect === 'function') {
      owner = await window.concordium.connect();
    } else if (typeof window.concordium.requestAccounts === 'function') {
      owner = (await window.concordium.requestAccounts())[0];
    }
    if (!owner) {
      throw new Error('Please connect your Concordium wallet account.');
    }

    const { mintAgentId } = await import('../mint-agent-id.js');

    const res = await mintAgentId({
      provider: window.concordium,
      owner,
      network,
      lobbyUrl,
      base: '',
      agentName: draftCard.name,
      agentRole: selectedSlug,
      onStatus: (status) => {
        if (status.includes('Publishing')) {
          stepStates.signCard = 'success';
          stepStates.publish = 'active';
          stepStates.publish_desc = 'Uploading metadata to lobby...';
          drawProgressModal(stepStates);
        } else if (status.includes('Anchoring')) {
          stepStates.publish = 'success';
          stepStates.anchor = 'active';
          stepStates.anchor_desc = 'Please approve the anchor transaction in your wallet...';
          drawProgressModal(stepStates);
        }
      }
    });

    if (res && res.did) {
      if (stepStates.anchor === 'active') {
        stepStates.anchor = 'success';
      }
      
      stepStates.bind = 'active';
      stepStates.bind_desc = 'Binding DID on server...';
      drawProgressModal(stepStates);

      linkedDid = res.did;
      localStorage.setItem('agent-os-linked-did', res.did);

      const saved = await postJson('/api/agents/identity', { slug: selectedSlug, identity: res.did });
      let githubBound = false;
      let bindError = '';
      if (saved && saved.ok !== false && !saved.error) {
        githubBound = true;
        const localAgent = (state.agents || []).find(a => a.slug === selectedSlug);
        if (localAgent) {
          localAgent.identity = res.did;
        }
        stepStates.bind = 'success';
      } else {
        stepStates.bind = 'warning';
        bindError = saved?.error || 'the bind endpoint did not respond';
        stepStates.bind_desc = bindError;
      }
      drawProgressModal(stepStates);

      await new Promise(r => setTimeout(r, 600));
      closeModal();
      showIdentitySuccessModal(res, draftCard.name, owner, githubBound, bindError);
      render();
    }
  } catch (err) {
    // Find current active step and mark it error
    let activeKey = null;
    for (const k of ['github', 'signCard', 'publish', 'anchor', 'bind']) {
      if (stepStates[k] === 'active') {
        activeKey = k;
        break;
      }
    }
    if (activeKey) {
      stepStates[activeKey] = 'error';
      stepStates[activeKey + '_desc'] = err.message || String(err);
    } else {
      stepStates.signCard = 'error';
      stepStates.signCard_desc = err.message || String(err);
    }
    drawProgressModal(stepStates);
  }
}

async function handleLinkDid() {
  const input = document.getElementById('linked-did-input');
  const value = input?.value?.trim() || '';
  linkedDid = value;
  
  if (!selectedSlug) {
    showAlert('Select Agent', 'Please select an agent in Step 1 to link this DID reference to.');
    return;
  }
  
  try {
    localStorage.setItem('agent-os-linked-did', value);
    const saved = await postJson('/api/agents/identity', { slug: selectedSlug, identity: value });
    if (saved && saved.ok === false) {
      throw new Error(saved.error || 'Failed to save mapping on server.');
    }
    showAlert('Success', `Agent ID reference successfully linked and saved to "${selectedSlug}"!`);
  } catch (err) {
    showAlert('Linking Failed', 'Failed to link DID: ' + err.message);
  }
  render();
}

function readFormValues() {
  if (!draftCard) return;
  draftCard.name = document.getElementById('card-name')?.value || '';
  draftCard.description = document.getElementById('card-description')?.value || '';
  draftCard.version = document.getElementById('card-version')?.value || '1.0.0';
  draftCard.runtime = document.getElementById('card-runtime')?.value || 'claude-cli';
  draftCard.ownerPolicy = document.getElementById('card-ownerPolicy')?.value || 'none';
  draftCard.contactUrl = document.getElementById('card-contactUrl')?.value || '';

  const capStr = document.getElementById('card-capabilities')?.value || '';
  draftCard.capabilities = capStr.split(',').map(s => s.trim()).filter(Boolean);

  const protStr = document.getElementById('card-protocols')?.value || '';
  draftCard.supportedProtocols = protStr.split(',').map(s => s.trim()).filter(Boolean);

  const scopeStr = document.getElementById('card-scopes')?.value || '';
  draftCard.allowedScopes = scopeStr.split(',').map(s => s.trim()).filter(Boolean);
}

async function configurePanelIdentity(action) {
  const input = document.getElementById('panel-identity-did');
  const status = document.getElementById('panel-identity-status');
  const controls = document.querySelectorAll('[data-panel-identity]');
  controls.forEach(button => { button.disabled = true; });
  try {
    if (action === 'unlink') {
      if (!(await linkPanelIdentity(null))?.ok) throw new Error('Could not unlink the Panel Agent ID.');
      input.value = '';
      status.textContent = 'Panel Agent ID unlinked.';
      return;
    }

    const selectedLobby = document.getElementById('header-lobby-select')?.value;
    let session = hostedSession();
    if (!session?.token || session.lobbyId !== selectedLobby) {
      await signInToLobby({ reload: false });
      session = hostedSession();
    }
    if (!session?.token || !session.identityRef?.startsWith('did:ccd:') || session.lobbyId !== selectedLobby) {
      throw new Error('Sign in with the registered Concordium wallet for this lobby.');
    }

    if (action === 'mint') {
      const [, , network, owner] = session.identityRef.split(':');
      const { mintAgentId } = await import('../mint-agent-id.js');
      const config = await fetchJson('/api/mode');
      const result = await mintAgentId({
        provider: window.concordium,
        owner,
        network,
        lobbyUrl: config?.lobbyUrl,
        agentName: 'Agent OS Local Panel',
        agentRole: 'panel',
        onStatus: message => { status.textContent = message; },
      });
      if (!result?.outcome?.success) throw new Error(result?.anchorError || 'Registry registration did not finalize.');
      input.value = result.did;
    }

    status.textContent = 'Checking the Agent ID with the lobby…';
    const result = await linkPanelIdentity(input.value.trim());
    if (!result?.ok) throw new Error(result?.error || 'The lobby could not verify the Panel Agent ID. Check the registered wallet and try Link again.');
    status.textContent = 'Verified. The lobby roster now shows this Panel Agent ID.';
  } catch (error) {
    status.textContent = error.message;
  } finally {
    controls.forEach(button => { button.disabled = false; });
  }
}

function render() {
  const el = document.getElementById('identity-content');
  if (!el) return;

  if (!draftCard) {
    el.innerHTML = `<div style="padding:20px;color:var(--text-secondary);">Loading identity data...</div>`;
    return;
  }

  const capsVal = draftCard.capabilities ? draftCard.capabilities.join(', ') : '';
  const protVal = draftCard.supportedProtocols ? draftCard.supportedProtocols.join(', ') : '';
  const scopeVal = draftCard.allowedScopes ? draftCard.allowedScopes.join(', ') : '';

  el.innerHTML = `
    ${lobbyMode === 'swarm' && !window.AGENT_OS_HOSTED ? `
      <div class="toolbar" style="flex-wrap:wrap;height:auto;padding:12px;gap:8px;">
        <label for="panel-identity-did">Local Panel Agent ID</label>
        <input id="panel-identity-did" value="${escapeHtml(savedPanelIdentity())}" placeholder="did:ccd:mainnet:agent-…" style="flex:1;min-width:220px;">
        <button class="btn btn-secondary btn-sm" data-panel-identity="link">Link Existing ID</button>
        <button class="btn btn-primary btn-sm" data-panel-identity="mint">Create Panel ID</button>
        <button class="btn btn-secondary btn-sm" data-panel-identity="unlink">Unlink</button>
        <p id="panel-identity-status" role="status" style="flex-basis:100%;margin:0;">The panel uses this identity for its own connection. It does not take agent assignments.</p>
      </div>` : ''}
    <div style="display:flex;gap:20px;height:100%;flex-wrap:wrap;">
      
      <!-- Left Column: Draft Form -->
      <div style="flex:1.5;min-width:320px;display:flex;flex-direction:column;gap:12px;background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:16px;">
        <h3 style="margin:0 0 4px 0;font-size:14px;font-weight:600;color:var(--text-primary);">1. Draft Agent Card</h3>
        <span style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">Describe your agent profile. No private keys or secrets are collected here.</span>
        
        <div>
          <label class="form-label" style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;">Pre-populate from Connected Swarm Agents</label>
          <select id="identity-agent-select" style="width:100%;padding:6px 10px;background:var(--bg-elevated);border:1px solid var(--border);color:var(--text-primary);border-radius:4px;font-size:12px;appearance:auto;">
            <option value="">-- Select an Agent --</option>
            ${(lobbyMode === 'swarm' && rosterAgents.length
              ? rosterAgents.map(a => `
                <option value="${escapeHtml(a.slug)}" ${a.slug === selectedSlug ? 'selected' : ''}>${escapeHtml(a.name)} (${escapeHtml(a.slug)}) · connected</option>`)
              : (state.agents || []).map(a => `
                <option value="${escapeHtml(a.slug)}" ${a.slug === selectedSlug ? 'selected' : ''}>${escapeHtml(a.name)} (${escapeHtml(a.slug)})</option>`)
            ).join('')}
          </select>
          ${lobbyMode === 'swarm' && !rosterAgents.length ? '<span style="font-size:10px;color:var(--color-yellow,#eab308);display:block;margin-top:3px;">No agents connected to the lobby — start agents in the Agents tab to mint IDs for them (catalog shown as fallback).</span>' : ''}
        </div>
        
        <div style="display:flex;gap:10px;">
          <div style="flex:1;">
            <label class="form-label" style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;">Agent Name</label>
            <input type="text" id="card-name" value="${escapeHtml(draftCard.name || '')}" style="width:100%;padding:6px 10px;background:var(--bg-elevated);border:1px solid var(--border);color:var(--text-primary);border-radius:4px;font-size:12px;" />
          </div>
          <div style="width:80px;">
            <label class="form-label" style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;">Version</label>
            <input type="text" id="card-version" value="${escapeHtml(draftCard.version || '1.0.0')}" style="width:100%;padding:6px 10px;background:var(--bg-elevated);border:1px solid var(--border);color:var(--text-primary);border-radius:4px;font-size:12px;" />
          </div>
        </div>

        <div>
          <label class="form-label" style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;">Description</label>
          <textarea id="card-description" rows="3" style="width:100%;padding:6px 10px;background:var(--bg-elevated);border:1px solid var(--border);color:var(--text-primary);border-radius:4px;font-size:12px;resize:none;">${escapeHtml(draftCard.description || '')}</textarea>
        </div>

        <div style="display:flex;gap:10px;">
          <div style="flex:1;">
            <label class="form-label" style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;">Runtime Adapter</label>
            <select id="card-runtime" style="width:100%;padding:6px 10px;background:var(--bg-elevated);border:1px solid var(--border);color:var(--text-primary);border-radius:4px;font-size:12px;appearance:auto;">
              <option value="claude-cli" ${draftCard.runtime === 'claude-cli' ? 'selected' : ''}>Claude CLI</option>
              <option value="codex-cli" ${draftCard.runtime === 'codex-cli' ? 'selected' : ''}>Codex CLI</option>
              <option value="api" ${draftCard.runtime === 'api' ? 'selected' : ''}>General API</option>
            </select>
          </div>
          <div style="flex:1;">
            <label class="form-label" style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;">Owner Policy</label>
            <select id="card-ownerPolicy" style="width:100%;padding:6px 10px;background:var(--bg-elevated);border:1px solid var(--border);color:var(--text-primary);border-radius:4px;font-size:12px;appearance:auto;">
              <option value="none" ${draftCard.ownerPolicy === 'none' ? 'selected' : ''}>None (Open)</option>
              <option value="concordium-registry" ${draftCard.ownerPolicy === 'concordium-registry' ? 'selected' : ''}>Concordium Registry</option>
            </select>
          </div>
        </div>

        <div>
          <label class="form-label" style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;">Capabilities (comma separated)</label>
          <input type="text" id="card-capabilities" value="${escapeHtml(capsVal)}" placeholder="code-generation, security-review" style="width:100%;padding:6px 10px;background:var(--bg-elevated);border:1px solid var(--border);color:var(--text-primary);border-radius:4px;font-size:12px;" />
        </div>

        <div>
          <label class="form-label" style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;">Supported Protocols (comma separated)</label>
          <input type="text" id="card-protocols" value="${escapeHtml(protVal)}" placeholder="lobby-message, ui-assist" style="width:100%;padding:6px 10px;background:var(--bg-elevated);border:1px solid var(--border);color:var(--text-primary);border-radius:4px;font-size:12px;" />
        </div>

        <div>
          <label class="form-label" style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;">Allowed Scopes (comma separated)</label>
          <input type="text" id="card-scopes" value="${escapeHtml(scopeVal)}" placeholder="*" style="width:100%;padding:6px 10px;background:var(--bg-elevated);border:1px solid var(--border);color:var(--text-primary);border-radius:4px;font-size:12px;" />
        </div>

        <div>
          <label class="form-label" style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;">Contact URL (optional)</label>
          <input type="text" id="card-contactUrl" value="${escapeHtml(draftCard.contactUrl || '')}" placeholder="https://..." style="width:100%;padding:6px 10px;background:var(--bg-elevated);border:1px solid var(--border);color:var(--text-primary);border-radius:4px;font-size:12px;" />
        </div>

        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px;">
          <button class="btn btn-secondary btn-sm" id="btn-save-draft">Save Draft</button>
          <button class="btn btn-primary btn-sm" id="btn-validate-card">Validate & Hash</button>
        </div>
      </div>

      <!-- Right Column: Verification Plan & Linked DID -->
      <div style="flex:1.2;min-width:300px;display:flex;flex-direction:column;gap:12px;">
        
        <!-- Validation / Hashing Status -->
        <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:16px;">
          <h3 style="margin:0 0 12px 0;font-size:14px;font-weight:600;color:var(--text-primary);">2. Card Validation & Hash</h3>
          
          ${lobbyMode === 'swarm' && !githubConnected ? `
            <div style="padding:10px;border-radius:4px;margin-bottom:12px;font-size:12px;background:rgba(235,90,90,0.1);border:1px solid var(--color-red);color:var(--color-red);">
              <strong>⚠️ GitHub Repository Not Connected:</strong> Please connect your repository under the Lobby tab first. You cannot auto-bind or persist Agent IDs without a repository connection.
            </div>
          ` : ''}

          ${validationResult ? `
            <div style="padding:10px;border-radius:4px;margin-bottom:12px;font-size:12px;background:${validationResult.ok ? 'rgba(0,200,100,0.1)' : 'rgba(235,90,90,0.1)'};border:1px solid ${validationResult.ok ? 'var(--color-green)' : 'var(--color-red)'};">
              <strong>Status:</strong> ${validationResult.ok ? 'Valid Agent Card ✓' : 'Validation Failed ✗'}
              ${validationResult.ok ? `
                <div style="margin-top:8px;">
                  <span style="font-size:11px;color:var(--text-muted);">Deterministic SHA-256 Hash:</span>
                  <div style="font-family:monospace;font-size:11px;color:var(--text-primary);background:var(--bg-base);padding:4px 8px;border-radius:4px;word-break:break-all;margin-top:4px;">${validationResult.hash}</div>
                </div>
              ` : `
                <ul style="margin:8px 0 0 0;padding-left:16px;color:var(--color-red);font-size:11px;">
                  ${validationResult.errors.map(e => `<li>${escapeHtml(e)}</li>`).join('')}
                </ul>
              `}
            </div>
          ` : `
            <div style="padding:12px;text-align:center;color:var(--text-muted);font-size:12px;background:var(--bg-elevated);border-radius:4px;margin-bottom:12px;border:1px dashed var(--border);">
              Click "Validate & Hash" to compute the card's integrity anchor.
            </div>
          `}

          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-size:11px;color:var(--text-muted);">Target Registry:</span>
              <select id="identity-network" style="padding:4px 8px;background:var(--bg-elevated);border:1px solid var(--border);color:var(--text-primary);border-radius:4px;font-size:11px;appearance:auto;">
                <option value="mainnet">Concordium Mainnet</option>
                <option value="testnet">Concordium Testnet</option>
              </select>
            </div>
            <div style="display:flex;gap:6px;">
              <button class="btn btn-primary btn-sm" id="btn-prepare-reg" ${validationResult?.ok ? '' : 'disabled'} style="opacity:${validationResult?.ok ? 1 : 0.5};">Prepare Registry Plan</button>
              ${lobbyMode === 'swarm' ? `
                <button class="btn btn-primary btn-sm" id="btn-mint-identity" ${validationResult?.ok ? '' : 'disabled'} style="opacity:${validationResult?.ok ? 1 : 0.5};">Mint Agent ID</button>
              ` : ''}
            </div>
          </div>
          <div id="identity-mint-status" style="margin-top:8px;font-size:11px;font-weight:500;word-break:break-all;"></div>
        </div>

        <!-- Registration Steps Checklist -->
        ${registrationPlan ? `
          <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:16px;flex:1;display:flex;flex-direction:column;gap:10px;">
            <h3 style="margin:0;font-size:14px;font-weight:600;color:var(--text-primary);">3. Registration Plan</h3>
            <span style="font-size:11px;color:var(--text-muted);">${registrationPlan.notice}</span>
            <div style="flex:1;overflow:auto;display:flex;flex-direction:column;gap:8px;background:var(--bg-elevated);padding:10px;border-radius:4px;border:1px solid var(--border);max-height:220px;">
              ${registrationPlan.steps.map((step, idx) => `
                <div style="display:flex;gap:8px;font-size:11px;line-height:1.4;">
                  <span style="color:var(--color-purple);font-weight:600;">Step ${idx + 1}:</span>
                  <span style="color:var(--text-secondary);">${escapeHtml(step)}</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        ${lobbyMode !== 'swarm' ? `
        <!-- Linked DID Profile configuration (Local Mode only — hosted minting binds automatically) -->
        <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:16px;">
          <h3 style="margin:0 0 4px 0;font-size:14px;font-weight:600;color:var(--text-primary);">4. Link Registry Reference (DID)</h3>
          <span style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:8px;">
            Once registered, bind your non-secret DID reference to this workspace.
          </span>
          <div style="display:flex;gap:6px;">
            <input type="text" id="linked-did-input" value="${escapeHtml(linkedDid)}" placeholder="did:ccd:mainnet:..." style="flex:1;padding:6px 10px;background:var(--bg-elevated);border:1px solid var(--border);color:var(--text-primary);border-radius:4px;font-size:12px;" />
            <button class="btn btn-secondary btn-sm" id="btn-link-did">Link Reference</button>
          </div>
        </div>` : ''}

      </div>

    </div>
  `;

  // Wire up event listeners
  el.querySelectorAll('[data-panel-identity]').forEach(button => {
    button.addEventListener('click', () => void configurePanelIdentity(button.dataset.panelIdentity));
  });
  document.getElementById('identity-agent-select')?.addEventListener('change', (e) => {
    const slug = e.target.value;
    selectedSlug = slug;
    if (slug) {
      // Prefer the catalog definition (scope, runtime, bound identity); a connected roster agent
      // whose role has no definition yet still prefills with its live name.
      const agent = (state.agents || []).find(a => a.slug === slug);
      const rosterAgent = rosterAgents.find(a => a.slug === slug);
      if (agent || rosterAgent) {
        draftCard.name = agent?.name || rosterAgent?.name || slug;
        draftCard.description = agent?.scope || `${draftCard.name} specialist`;
        draftCard.runtime = agent?.runtime || 'api';
        if (agent?.model) {
          draftCard.description += ` (model: ${agent.model})`;
        }
        linkedDid = agent?.identity || '';
        render();
      }
    }
  });
  document.getElementById('btn-save-draft')?.addEventListener('click', handleSave);
  document.getElementById('btn-validate-card')?.addEventListener('click', handleValidate);
  document.getElementById('btn-prepare-reg')?.addEventListener('click', handlePrepareReg);
  document.getElementById('btn-mint-identity')?.addEventListener('click', handleMintIdentity);
  document.getElementById('btn-link-did')?.addEventListener('click', handleLinkDid);
}

registerTab('identity', { onActivate: load });
