import { state, fetchJson, postJson, registerTab, escapeHtml, showIdentitySuccessModal, showAlert } from '../app.js';

let draftCard = null;
let validationResult = null;
let registrationPlan = null;
let linkedDid = '';
let lobbyMode = 'local';

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
  lobbyMode = modeData?.mode || 'local';

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
    const steps = [
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
      notice: 'Agent OS prepares this registration but never signs or submits it. Signing happens in your wallet; no private key is ever stored or transmitted by Agent OS.',
    };
    render();
  } catch (err) {
    showAlert('Error', 'Failed to prepare registration: ' + err.message);
  }
}

async function handleMintIdentity() {
  readFormValues();
  const network = document.getElementById('identity-network')?.value || 'mainnet';
  const selectedSlug = document.getElementById('identity-agent-select')?.value || 'boss';
  
  if (!window.concordium) {
    showAlert('Wallet Not Found', 'Concordium Browser Wallet not found — install it and connect.');
    return;
  }
  
  const statusEl = document.getElementById('identity-mint-status');
  if (statusEl) {
    statusEl.style.color = 'var(--text)';
    statusEl.textContent = 'Connecting wallet...';
  }

  try {
    const accounts = await window.concordium.requestAccounts();
    const owner = accounts[0];
    if (!owner) {
      showAlert('Error', 'Please connect your Concordium wallet account.');
      return;
    }

    if (statusEl) statusEl.textContent = 'Initializing mint...';
    const { mintAgentId } = await import('../mint-agent-id.js');

    const modeData = await fetchJson('/api/mode');
    const lobbyUrl = modeData?.lobbyUrl || '';

    const res = await mintAgentId({
      provider: window.concordium,
      owner,
      network,
      lobbyUrl,
      base: '',
      agentName: draftCard.name,
      agentRole: selectedSlug,
      onStatus: (status) => {
        if (statusEl) statusEl.textContent = status;
      }
    });

    if (res && res.did) {
      linkedDid = res.did;
      localStorage.setItem('agent-os-linked-did', res.did);

      // Auto-save the DID to the agent identity mapping on the server
      const saved = await postJson('/api/agents/identity', { slug: selectedSlug, identity: res.did });
      if (saved && saved.ok === false) {
        console.warn('Failed to auto-bind DID to agent on server:', saved.error);
      } else {
        const localAgent = (state.agents || []).find(a => a.slug === selectedSlug);
        if (localAgent) {
          localAgent.identity = res.did;
        }
      }

      if (statusEl) {
        statusEl.style.color = 'var(--success)';
        statusEl.textContent = `Identity successfully minted! DID: ${res.did}`;
      }
      showIdentitySuccessModal(res, draftCard.name, owner);
      render();
    }
  } catch (err) {
    if (statusEl) {
      statusEl.style.color = 'var(--error)';
      statusEl.textContent = 'Minting failed: ' + (err.message || err);
    }
  }
}

function handleLinkDid() {
  const input = document.getElementById('linked-did-input');
  const value = input?.value?.trim() || '';
  linkedDid = value;
  try {
    localStorage.setItem('agent-os-linked-did', value);
    showAlert('Success', 'DID linked and saved locally!');
  } catch {}
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
    <div style="display:flex;gap:20px;height:100%;flex-wrap:wrap;">
      
      <!-- Left Column: Draft Form -->
      <div style="flex:1.5;min-width:320px;display:flex;flex-direction:column;gap:12px;background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:16px;">
        <h3 style="margin:0 0 4px 0;font-size:14px;font-weight:600;color:var(--text-primary);">1. Draft Agent Card</h3>
        <span style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">Describe your agent profile. No private keys or secrets are collected here.</span>
        
        <div>
          <label class="form-label" style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;">Pre-populate from Connected Swarm Agents</label>
          <select id="identity-agent-select" style="width:100%;padding:6px 10px;background:var(--bg-elevated);border:1px solid var(--border);color:var(--text-primary);border-radius:4px;font-size:12px;appearance:auto;">
            <option value="">-- Select an Agent --</option>
            ${(state.agents || []).map(a => `
              <option value="${escapeHtml(a.slug)}">${escapeHtml(a.name)} (${escapeHtml(a.slug)})</option>
            `).join('')}
          </select>
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

        <!-- Linked DID Profile configuration -->
        <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:16px;">
          <h3 style="margin:0 0 4px 0;font-size:14px;font-weight:600;color:var(--text-primary);">4. Link Registry Reference (DID)</h3>
          <span style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:8px;">Once registered, bind your non-secret DID reference to this workspace.</span>
          <div style="display:flex;gap:6px;">
            <input type="text" id="linked-did-input" value="${escapeHtml(linkedDid)}" placeholder="did:ccd:mainnet:..." style="flex:1;padding:6px 10px;background:var(--bg-elevated);border:1px solid var(--border);color:var(--text-primary);border-radius:4px;font-size:12px;" />
            <button class="btn btn-secondary btn-sm" id="btn-link-did">Link Reference</button>
          </div>
        </div>

      </div>

    </div>
  `;

  // Wire up event listeners
  document.getElementById('identity-agent-select')?.addEventListener('change', (e) => {
    const slug = e.target.value;
    if (slug) {
      const agent = (state.agents || []).find(a => a.slug === slug);
      if (agent) {
        draftCard.name = agent.name;
        draftCard.description = agent.scope || `${agent.name} specialist`;
        draftCard.runtime = agent.runtime || 'api';
        if (agent.model) {
          draftCard.description += ` (model: ${agent.model})`;
        }
        linkedDid = agent.identity || '';
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
