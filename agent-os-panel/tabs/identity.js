import { fetchJson, postJson, registerTab, escapeHtml } from '../app.js';

let draftCard = null;
let validationResult = null;
let registrationPlan = null;
let linkedDid = '';
let lobbyMode = 'local';

async function load() {
  const modeData = await fetchJson('/api/mode');
  lobbyMode = modeData?.mode || 'local';

  // Load card draft from server
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

  // Load linked DID from localStorage
  try {
    linkedDid = localStorage.getItem('agent-os-linked-did') || '';
  } catch {}

  render();
}

async function handleSave() {
  readFormValues();
  const res = await postJson('/api/identity/card', { card: draftCard });
  if (res && res.ok) {
    draftCard = res.card;
    alert('Card draft saved locally!');
    render();
  } else {
    alert('Failed to save draft card: ' + (res?.error || 'Unknown error'));
  }
}

async function handleValidate() {
  readFormValues();
  const res = await postJson('/api/identity/validate-card', { card: draftCard });
  if (res) {
    validationResult = res;
    render();
  }
}

async function handlePrepareReg() {
  readFormValues();
  const network = document.getElementById('identity-network')?.value || 'testnet';
  const res = await postJson('/api/identity/prepare-registration', { card: draftCard, network });
  if (res && res.ok) {
    registrationPlan = res.plan;
    render();
  } else {
    alert('Validation failed, cannot prepare registration: ' + (res?.error || 'Make sure the card is valid first.'));
  }
}

async function handleMintIdentity() {
  readFormValues();
  const network = document.getElementById('identity-network')?.value || 'testnet';
  
  if (!window.concordium) {
    alert('Concordium Browser Wallet not found — install it and connect.');
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
      alert('Please connect your Concordium wallet account.');
      return;
    }

    if (statusEl) statusEl.textContent = 'Initializing mint...';
    const { mintAgentId } = await import('../mint-agent-id.js');

    const modeData = await fetchJson('/api/mode');
    const lobbyUrl = modeData?.lobby_url || '';

    const res = await mintAgentId({
      provider: window.concordium,
      owner,
      network,
      lobbyUrl,
      base: '',
      agentName: draftCard.name,
      agentRole: draftCard.role || 'boss-agent',
      onStatus: (status) => {
        if (statusEl) statusEl.textContent = status;
      }
    });

    if (res && res.did) {
      linkedDid = res.did;
      localStorage.setItem('agent-os-linked-did', res.did);
      if (statusEl) {
        statusEl.style.color = 'var(--success)';
        statusEl.textContent = `Identity successfully minted! DID: ${res.did}`;
      }
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
    alert('DID linked and saved locally!');
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
                <option value="testnet">Concordium Testnet</option>
                <option value="mainnet">Concordium Mainnet</option>
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
            <input type="text" id="linked-did-input" value="${escapeHtml(linkedDid)}" placeholder="did:ccd:testnet:..." style="flex:1;padding:6px 10px;background:var(--bg-elevated);border:1px solid var(--border);color:var(--text-primary);border-radius:4px;font-size:12px;" />
            <button class="btn btn-secondary btn-sm" id="btn-link-did">Link Reference</button>
          </div>
        </div>

      </div>

    </div>
  `;

  // Wire up event listeners
  document.getElementById('btn-save-draft')?.addEventListener('click', handleSave);
  document.getElementById('btn-validate-card')?.addEventListener('click', handleValidate);
  document.getElementById('btn-prepare-reg')?.addEventListener('click', handlePrepareReg);
  document.getElementById('btn-mint-identity')?.addEventListener('click', handleMintIdentity);
  document.getElementById('btn-link-did')?.addEventListener('click', handleLinkDid);
}

registerTab('identity', { onActivate: load });
