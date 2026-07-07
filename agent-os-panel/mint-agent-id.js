// Agent OS Panel — Agent ID minting (shared logic with the hosted lobby dashboard)
//
// Runs the SAME sponsored, on-chain Agent-ID creation the hosted lobby uses, but from the local
// panel: build a wallet-signed Agent Card → host it on the connected lobby → build the CIS-8004
// `register` payload → get it co-signed by Concordium's sponsor service → the browser wallet adds
// the sender signature and submits (gasless). Registry/sponsor calls are proxied through the panel
// server (`/api/registry/*`) to the connected lobby, so there is no browser CORS and no keys ever
// leave the wallet. Import dynamically: `const m = await import('/mint-agent-id.js')`.

const GENESIS_HASH = {
  mainnet: '9dd9ca4d19e9393877d2c44b70f89acbfc0883c2243e5eeaecc0d1cd0503f478',
  testnet: '4221332d34e1694168c2a0c0b3fd0f273809612cb13d000d5c2e00e85f50f796',
};
const WALLET_PROXY = {
  mainnet: 'https://wallet-proxy.mainnet.concordium.software',
  testnet: 'https://wallet-proxy.testnet.concordium.com',
};
const SCAN_API = {
  mainnet: 'https://api-ccdscan.mainnet.concordium.software/api/graphql',
  testnet: 'https://api-ccdscan.testnet.concordium.com/api/graphql',
};

// Pin the SDK + wallet-connectors to the SAME web-sdk instance (?deps) so the sponsored
// Transaction.Signable's branded types are recognized across the module boundary.
const SDK_VERSION = '12.0.2';
const SDK_URL = `https://esm.sh/@concordium/web-sdk@${SDK_VERSION}`;
const CONNECTORS_URL = `https://esm.sh/@concordium/wallet-connectors@0.9.0-alpha.0?deps=@concordium/web-sdk@${SDK_VERSION}`;

let _sdk = null;
function loadSdk() {
  if (!_sdk) _sdk = import(/* @vite-ignore */ SDK_URL).catch((e) => { _sdk = null; throw new Error(`could not load the Concordium SDK: ${e.message || e}`); });
  return _sdk;
}
let _connectors = null;
function loadConnectors() {
  if (!_connectors) _connectors = import(/* @vite-ignore */ CONNECTORS_URL).catch((e) => { _connectors = null; throw new Error(`could not load wallet-connectors: ${e.message || e}`); });
  return _connectors;
}

/** POST to the panel's registry proxy (which forwards to the lobby). Returns the parsed body. */
async function registryProxy(base, endpoint, body) {
  const res = await fetch(`${base}/api/registry/${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return res.json();
}

async function sha256Hex(message) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Extract a hex signature string from the Concordium wallet's { 0: { 0: hex } } response shape. */
function normalizeSignature(signature) {
  if (typeof signature === 'string') return signature;
  if (signature && typeof signature === 'object') {
    const k = Object.keys(signature)[0];
    if (k !== undefined) {
      const inner = signature[k];
      if (typeof inner === 'string') return inner;
      const ik = inner && Object.keys(inner)[0];
      if (ik !== undefined) return inner[ik];
    }
  }
  return null;
}

/** Recursively find the first string under a matching key (locates a nested parameter hex). */
function deepFindString(obj, pred, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 5) return null;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') { if (pred(k, v)) return v; }
    else if (v && typeof v === 'object') { const f = deepFindString(v, pred, depth + 1); if (f) return f; }
  }
  return null;
}

/** Map our card fields onto the builder's schema by name AND declared type (see the hosted flow). */
function mapBuilderArgs(inputSchema, fields) {
  const props = inputSchema?.properties || {};
  const required = Array.isArray(inputSchema?.required) ? inputSchema.required : [];
  const args = {};
  const typeOf = (p) => { const t = p?.type; return Array.isArray(t) ? t.filter((x) => x !== 'null') : (t ? [t] : []); };
  const isStringy = (p) => { const t = typeOf(p); return t.length === 0 || t.includes('string'); };
  for (const key of Object.keys(props)) {
    const prop = props[key];
    if (/hash/i.test(key)) args[key] = fields.cardHash;
    else if (/network/i.test(key)) args[key] = fields.network;
    else if (isStringy(prop) && /(uri|url)/i.test(key)) args[key] = fields.metadataUrl;
    else if (/sender|owner|account/i.test(key) || /^address$/i.test(key)) args[key] = fields.owner;
    else if (isStringy(prop) && /agent.*(id|key|ref|reference|token|address|did)|external.*ref|^reference$|^token(_?id)?$|^did$/i.test(key)) args[key] = fields.agentDid;
    else if (isStringy(prop) && /name$/i.test(key)) args[key] = fields.agentName;
  }
  const unmapped = required.filter((k) => args[k] === undefined);
  if (unmapped.length > 0) throw new Error(`registry builder needs unmapped params: ${unmapped.join(', ')}`);
  return args;
}

async function chooseRegistryBuilder(ctx, tools, fields) {
  const names = new Set((tools || []).map((t) => t.name));
  let exists = false;
  try {
    const lookup = await registryProxy(ctx.base, 'call', { lobbyUrl: ctx.lobbyUrl, tool: 'agent_by_external_reference', arguments: { network: fields.network, external_reference: fields.agentDid, reference: fields.agentDid } });
    const r = lookup?.result;
    exists = !!(lookup?.ok && r && (r.token_id || r.agent || r.owner || r.exists === true));
  } catch { /* lookup unsupported — treat as new */ }
  if (exists && names.has('build_set_agent_uri')) return { tool: (tools || []).find((t) => t.name === 'build_set_agent_uri'), mode: 'update' };
  const register = (tools || []).find((t) => t.name === 'build_register');
  if (!register) throw new Error('the registry MCP service does not expose build_register');
  return { tool: register, mode: 'register' };
}

/** Ask the lobby's sponsor relay to co-sign an unsigned transaction. Returns the partially-signed JSON. */
async function requestSponsoredTransaction(ctx, unsignedTx, sender, nonce) {
  const res = await registryProxy(ctx.base, 'sponsor', { lobbyUrl: ctx.lobbyUrl, genesisHash: GENESIS_HASH[ctx.network], sender, nonce, payload: unsignedTx });
  if (res && res.ok && res.transaction) return res.transaction;
  throw new Error(`sponsor relay declined: ${res?.error || 'unknown reason'}`);
}

async function fetchAccountNonce(ctx, address) {
  const res = await fetch(`${WALLET_PROXY[ctx.network]}/v0/accNonce/${encodeURIComponent(address)}`);
  if (!res.ok) throw new Error(`could not fetch account nonce (HTTP ${res.status})`);
  const data = await res.json();
  const nonce = Number(data?.nonce);
  if (!Number.isInteger(nonce) || nonce <= 0) throw new Error(`wallet proxy returned an invalid nonce: ${data?.nonce}`);
  return nonce;
}

async function submitSponsoredMint(ctx, { sender, index, subindex, receiveName, parameterHex, maxEnergy }) {
  const sdk = await loadSdk();
  const { Transaction, AccountAddress } = sdk;
  const connectors = await loadConnectors();
  const BrowserWalletConnector = connectors.BrowserWalletConnector;
  if (!BrowserWalletConnector) throw new Error('wallet-connectors did not export BrowserWalletConnector');

  const nonce = await fetchAccountNonce(ctx, sender);
  // The sponsor parses this with the Concordium SDK: INTEGER numeric fields, header carries ONLY
  // executionEnergyAmount (the service adds sender/nonce/expiry + its signature).
  const unsignedTx = {
    header: { executionEnergyAmount: Number(maxEnergy) },
    payload: { type: 'update', amount: 0, address: { index: Number(index), subindex: Number(subindex ?? 0) }, receiveName, message: parameterHex },
  };
  ctx.onStatus?.('Requesting sponsor co-signature…');
  const partiallySigned = await requestSponsoredTransaction(ctx, unsignedTx, sender, nonce);
  const signable = Transaction.signableFromJSON(partiallySigned);
  ctx.onStatus?.('Approve the transaction in your wallet…');
  const noop = () => {};
  const connector = await BrowserWalletConnector.create({ onChainChanged: noop, onAccountChanged: noop, onConnected: noop, onDisconnected: noop });
  return connector.signAndSendSponsoredTransaction(AccountAddress.fromBase58(sender), signable);
}

async function anchorAgentOnChain(ctx, fields) {
  const status = await registryProxy(ctx.base, 'status', { lobbyUrl: ctx.lobbyUrl, network: ctx.network });
  if (!status || !status.configured) return null; // off-chain mode
  if (status.error) throw new Error(`registry MCP service unreachable: ${status.error}`);
  const sponsorAvailable = Boolean(status.sponsored);
  if (!sponsorAvailable) throw new Error('this registry requires the sponsor service, which is not configured on the connected lobby');

  const toolsRes = await registryProxy(ctx.base, 'tools', { lobbyUrl: ctx.lobbyUrl });
  const tools = toolsRes?.tools || [];
  const { tool: builder, mode } = await chooseRegistryBuilder(ctx, tools, fields);

  const args = mapBuilderArgs(builder.inputSchema, fields);
  const call = await registryProxy(ctx.base, 'call', { lobbyUrl: ctx.lobbyUrl, tool: builder.name, arguments: args });
  if (!call || !call.ok) throw new Error(call?.error || `${builder.name} call failed`);
  const payload = call.result || {};

  const looksHex = (v) => typeof v === 'string' && v.length > 0 && v.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(v);
  const hex = [payload.hex, payload.parameter_hex, payload.payload_hex, payload.message_hex].find((v) => looksHex(v))
    || deepFindString(payload, (k, v) => /hex|param/i.test(k) && looksHex(v)) || null;
  if (!hex) throw new Error(`${builder.name} returned no pre-encoded parameter hex (keys: ${Object.keys(payload).join(', ')})`);

  // Resolve the contract address + entrypoint from the payload, else contract_info.
  let index = payload.contract_index ?? payload.contract?.index ?? payload.contract_address?.index;
  let subindex = payload.contract_subindex ?? payload.contract?.subindex ?? payload.contract_address?.subindex;
  let receiveName = payload.receive_name ?? payload.receiveName;
  if (index === undefined || !receiveName) {
    const infoCall = await registryProxy(ctx.base, 'call', { lobbyUrl: ctx.lobbyUrl, tool: 'contract_info', arguments: { network: ctx.network } });
    const info = infoCall?.result || {};
    const cis = info.cis8004 || info['cis-8004'] || info;
    index = index ?? cis.index ?? cis.contract_index ?? cis.contract_address?.index;
    subindex = subindex ?? cis.subindex ?? cis.contract_subindex ?? cis.contract_address?.subindex;
    const entrypoint = builder.name === 'build_set_agent_uri' ? 'setAgentURI' : 'register';
    receiveName = receiveName || cis.receive_name || (cis.contract_name ? `${cis.contract_name}.${entrypoint}` : undefined);
  }
  if (index === undefined || !receiveName) throw new Error('could not resolve the registry contract address/entrypoint');

  const energyVal = Number(payload.max_energy ?? payload.energy ?? 30000);
  const txHash = await submitSponsoredMint(ctx, { sender: ctx.owner, index, subindex, receiveName, parameterHex: hex, maxEnergy: energyVal });
  return { txHash, contract: { index, subindex: subindex ?? 0 }, receiveName, mode, sponsored: true };
}

/** Poll CCDScan for the finalized outcome. Resolves { success, reason? } or null if not confirmed. */
async function verifyMintOutcome(ctx, txHash) {
  const query = `{ transactionByTransactionHash(transactionHash:"${txHash}"){ result{ __typename ... on Rejected{ reason{ __typename ... on RejectedReceive{ rejectReason receiveName } } } } } }`;
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 6000));
    try {
      const res = await fetch(SCAN_API[ctx.network], { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
      if (!res.ok) continue;
      const data = await res.json();
      const result = data?.data?.transactionByTransactionHash?.result;
      if (!result) continue;
      if (result.__typename === 'Rejected') return { success: false, reason: result.reason?.rejectReason ?? result.reason?.__typename ?? 'unknown' };
      return { success: true };
    } catch { /* keep polling */ }
  }
  return null;
}

/**
 * Create (mint) an Agent ID for an agent and return { did, txHash, metadataUrl, outcome }.
 * @param {object} opts
 * @param {string} opts.base        Panel origin for the registry proxy (usually '').
 * @param {string} opts.lobbyUrl    The connected lobby URL (wss/https) — where registry/sponsor live.
 * @param {string} opts.network     'mainnet' | 'testnet'.
 * @param {object} opts.provider    The injected wallet (window.concordium).
 * @param {string} opts.owner       Connected wallet account (base58).
 * @param {string} [opts.ownerDid]  Owner DID for the card (defaults to did:ccd:<net>:<owner>).
 * @param {string} opts.agentName   Human name for the agent.
 * @param {string} opts.agentRole   Agent role/slug.
 * @param {function} [opts.onStatus] Progress callback (string).
 */
export async function mintAgentId(opts) {
  const { provider, owner, network = 'mainnet', lobbyUrl, base = '', agentName, agentRole, onStatus } = opts;
  if (!provider) throw new Error('Concordium Browser Wallet not found — install it and connect.');
  if (!owner) throw new Error('no connected wallet account');
  if (!lobbyUrl) throw new Error('no lobby URL configured — set the Lobby URL first');
  const ownerDid = opts.ownerDid || `did:ccd:${network}:${owner}`;
  const ctx = { base, lobbyUrl, network, owner, onStatus };

  const agentDid = `did:ccd:${network}:agent-${Math.random().toString(36).slice(2, 8)}`;

  const card = {
    did: agentDid, name: agentName, role: agentRole, owner: ownerDid,
    network, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  const sortedCard = {};
  for (const k of Object.keys(card).sort()) sortedCard[k] = card[k];

  onStatus?.('Sign the Agent Card in your wallet…');
  const signPayload = `Agent OS Agent Card\nDID: ${agentDid}\nName: ${agentName}\nRole: ${agentRole}\nOwner: ${ownerDid}`;
  const signatureHex = normalizeSignature(await provider.signMessage(owner, signPayload));
  sortedCard.signature = signatureHex;
  sortedCard.signedBy = owner;

  const cardHash = await sha256Hex(JSON.stringify(sortedCard));

  onStatus?.('Publishing the Agent Card…');
  const hostRes = await registryProxy(base, 'agent-cards', { lobbyUrl, did: agentDid, card: sortedCard });
  const metadataUrl = hostRes?.url || `${normalizeHttp(lobbyUrl)}/agent-cards/${encodeURIComponent(agentDid)}`;

  try {
    onStatus?.('Anchoring on-chain (sponsored)…');
    const anchor = await anchorAgentOnChain(ctx, { metadataUrl, cardHash, owner, network, agentName, agentDid });
    if (anchor) {
      onStatus?.('Confirming on-chain…');
      const outcome = await verifyMintOutcome(ctx, anchor.txHash);
      if (outcome && outcome.success === false) throw new Error(`mint rejected on-chain (reason ${outcome.reason})`);
      return { did: agentDid, txHash: anchor.txHash, metadataUrl, outcome };
    }
  } catch (anchorErr) {
    console.warn('[Mint] On-chain anchoring failed, falling back to off-chain hosted mode:', anchorErr);
  }

  return { did: agentDid, txHash: null, metadataUrl, outcome: null };
}

function normalizeHttp(url) {
  return String(url || '').replace(/^ws(s)?:\/\//i, (_, ssl) => (ssl ? 'https://' : 'http://'));
}
