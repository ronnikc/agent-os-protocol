// SPDX-License-Identifier: Apache-2.0
import { createHash, createPublicKey, randomBytes, sign, verify, type KeyObject } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { agent, HEADER, verifier, type CredentialResult, type DigitalCredentialRequest } from '@proof.com/x401-node';

export const AGENT_ID_CREDENTIAL_TYPE = 'https://agent-os.gothard.dk/credentials/concordium-agent-id/v1';
const protocol = 'openid4vp-v1-unsigned';
const lifetime = 300;
const credentialId = 'agent_id';
const clock = () => Math.floor(Date.now() / 1000);

export interface AgentRegistryBinding {
  did: string;
  owner: string;
  /** Stable registry record identifier, including network and contract. */
  registration: string;
}

type ResolveBinding = (did: string) => Promise<AgentRegistryBinding | undefined>;

export interface AgentDelegation {
  binding: AgentRegistryBinding;
  holder: { kty: 'OKP'; crv: 'Ed25519'; x: string };
  resource: string;
  expiresAt: number;
}

function resourceUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.href !== value) {
    throw new Error('Expected a canonical HTTPS resource URL');
  }
  return url;
}

function publicHolder(key: AgentDelegation['holder']): KeyObject {
  if (key?.kty !== 'OKP' || key.crv !== 'Ed25519' || !/^[\w-]{43}$/.test(key.x) ||
      Object.keys(key).length !== 3) throw new Error('Invalid agent holder key');
  return createPublicKey({ key, format: 'jwk' });
}

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signJwt(type: string, claims: object, key: KeyObject): string {
  if (key.asymmetricKeyType !== 'ed25519' || key.type !== 'private') throw new Error('Expected an Ed25519 signing key');
  const input = encode({ alg: 'EdDSA', typ: type }) + '.' + encode(claims);
  return input + '.' + sign(null, Buffer.from(input), key).toString('base64url');
}

function readJwt(token: string, type: string, key: KeyObject): Record<string, unknown> {
  const parts = token.split('.');
  if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519' || parts.length !== 3 ||
      parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part)) ||
      !isDeepStrictEqual(JSON.parse(Buffer.from(parts[0], 'base64url').toString()), { alg: 'EdDSA', typ: type }) ||
      !verify(null, Buffer.from(parts[0] + '.' + parts[1]), key, Buffer.from(parts[2], 'base64url'))) {
    throw new Error('Invalid credential signature');
  }
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString());
}

function requestData(nonce: string, id = credentialId) {
  return {
    response_type: 'vp_token',
    response_mode: 'dc_api',
    nonce,
    dcql_query: { credentials: [{
      id, format: 'dc+sd-jwt', meta: { vct_values: [AGENT_ID_CREDENTIAL_TYPE] },
    }] },
  };
}

/** The owner signs this exact message with their Concordium account wallet. */
export function agentDelegationMessage(delegation: AgentDelegation): string {
  const { binding, holder, resource, expiresAt } = delegation;
  return 'Agent OS Agent ID delegation v1\n' + JSON.stringify([
    binding.did, binding.owner, binding.registration, holder.x, resource, expiresAt,
  ]);
}

/** Issue only after checking the live registry and verifying the registered owner's approval. */
export async function issueAgentIdCredential(options: {
  issuer: string;
  issuerKey: KeyObject;
  delegation: AgentDelegation;
  resolveBinding: ResolveBinding;
  verifyOwnerApproval: (owner: string, message: string) => Promise<boolean>;
}): Promise<string> {
  const { issuer, issuerKey, delegation, resolveBinding, verifyOwnerApproval } = options;
  const { binding, holder, resource, expiresAt } = delegation;
  resourceUrl(issuer);
  resourceUrl(resource);
  publicHolder(holder);
  const now = clock();
  if (!Number.isInteger(expiresAt) || expiresAt <= now || expiresAt > now + lifetime ||
      !isDeepStrictEqual(await resolveBinding(binding.did), binding) ||
      !await verifyOwnerApproval(binding.owner, agentDelegationMessage(delegation))) {
    throw new Error('Agent ID delegation was not authorized');
  }
  return signJwt('dc+sd-jwt', {
    iss: issuer, sub: binding.did, vct: AGENT_ID_CREDENTIAL_TYPE, iat: now, exp: expiresAt,
    owner: binding.owner, registration: binding.registration, resource, cnf: { jwk: holder },
  }, issuerKey) + '~';
}

/** Present this one credential profile to the explicitly configured HTTPS resource. */
export function presentAgentIdCredential(
  request: DigitalCredentialRequest, resource: string, credential: string, holderKey: KeyObject,
): CredentialResult {
  const url = resourceUrl(resource);
  const entry = request.requests.find(entry => {
    const nonce = entry.data?.nonce;
    const id = (entry.data?.dcql_query as { credentials?: { id?: unknown }[] } | undefined)?.credentials?.[0]?.id;
    return entry.protocol === protocol && typeof nonce === 'string' && /^[\w-]{16,128}$/.test(nonce) &&
      typeof id === 'string' && /^[\w-]{1,64}$/.test(id) && isDeepStrictEqual(entry.data, requestData(nonce, id));
  });
  if (!entry || !/^[\w.-]+~$/.test(credential)) {
    throw new Error('Unsupported Agent ID credential request');
  }
  const claims = JSON.parse(Buffer.from(credential.split('.')[1], 'base64url').toString());
  const holder = createPublicKey(holderKey).export({ format: 'jwk' });
  if (claims.resource !== url.href || claims.vct !== AGENT_ID_CREDENTIAL_TYPE ||
      !isDeepStrictEqual(claims.cnf?.jwk, holder) || !(claims.exp > clock())) {
    throw new Error('Agent ID credential does not authorize this holder and resource');
  }
  const keyBinding = signJwt('kb+jwt', {
    nonce: entry.data.nonce, aud: 'origin:' + url.origin, iat: clock(),
    sd_hash: createHash('sha256').update(credential).digest('base64url'),
  }, holderKey);
  const query = entry.data.dcql_query as { credentials: [{ id: string }] };
  return { protocol, data: { vp_token: { [query.credentials[0].id]: [credential + keyBinding] } } };
}

/** Prove a registered agent's identity to one operator-approved resource, without initiating payment. */
export async function accessAgentIdResource(options: {
  did: string;
  resource: string;
  credential: string;
  holderKey: KeyObject;
}, fetchResource: typeof fetch = fetch): Promise<number> {
  const { did, resource, credential, holderKey } = options;
  const url = resourceUrl(resource);
  if (credential.length > 8192 || !/^[\w.-]+~$/.test(credential)) throw new Error('Invalid Agent ID credential');
  const claims = JSON.parse(Buffer.from(credential.split('.')[1], 'base64url').toString());
  if (claims.sub !== did) throw new Error('Agent ID credential does not match the runtime DID');
  const request = (headers?: Headers) => fetchResource(url, {
    method: 'GET', headers, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000),
  });
  const challenge = await request();
  const challengeHeader = challenge.headers.get(HEADER.PROOF_REQUEST);
  await challenge.body?.cancel();
  if (challenge.status !== 401 || !challengeHeader || challengeHeader.length > 16_384) {
    throw new Error('Resource did not offer an Agent ID proof challenge');
  }
  const requirement = agent.detectProofRequirement({ headers: challenge.headers });
  if (requirement?.payload.version !== '0.2.0') throw new Error('Unsupported x401 challenge');
  const credentialResult = presentAgentIdCredential(
    agent.getDigitalCredentialRequest(requirement.payload), resource, credential, holderKey,
  );
  const proof = agent.encodeResultArtifact(agent.buildResultArtifact({
    credentialResult, requestId: requirement.payload.request_id,
  }));
  if (proof.length > 16_384) throw new Error('Agent ID proof exceeds the header size limit');
  const response = await request(new Headers({ [HEADER.PROOF_RESPONSE]: proof }));
  await response.body?.cancel();
  if (response.headers.has(HEADER.PROOF_REQUEST) || response.headers.has(HEADER.PROOF_RESULT) && response.ok) {
    throw new Error('Resource returned an ambiguous Agent ID proof result');
  }
  return response.status;
}

/** One verifier instance protects one GET resource and owns its one-time challenges. */
export function createAgentIdProofGate(options: {
  resource: string;
  issuer: string;
  issuerKey: KeyObject;
  resolveBinding: ResolveBinding;
}) {
  const url = resourceUrl(options.resource);
  resourceUrl(options.issuer);
  const pending = new Map<string, number>();

  return async (request: Request): Promise<Response> => {
    if (request.method !== 'GET' || request.url !== url.href) return new Response(null, { status: 404 });
    const now = clock();
    for (const [nonce, expiry] of pending) {
      if (expiry <= now) pending.delete(nonce);
    }
    const proofHeader = request.headers.get(HEADER.PROOF_RESPONSE);
    if (!proofHeader) {
      if (pending.size >= 256) return new Response(null, { status: 429 });
      const nonce = randomBytes(32).toString('base64url');
      pending.set(nonce, now + lifetime);
      const payload = verifier.buildPayload({
        credentialRequirements: { digital: { requests: [{ protocol, data: requestData(nonce) }] } },
      });
      return new Response(null, {
        status: 401, headers: { [HEADER.PROOF_REQUEST]: verifier.encodePayload(payload), 'Cache-Control': 'no-store' },
      });
    }
    try {
      if (proofHeader.length > 16_384) throw new Error('Oversized proof');
      const result = verifier.decodeResultArtifact(proofHeader).credential_result;
      const data = result?.data as { vp_token?: Record<string, unknown> } | undefined;
      const presentations = data?.vp_token?.[credentialId];
      if (result?.protocol !== protocol || !Array.isArray(presentations) || presentations.length !== 1 ||
          typeof presentations[0] !== 'string') throw new Error('Missing Agent ID presentation');
      const [credential, keyBinding, ...extra] = presentations[0].split('~');
      if (!credential || !keyBinding || extra.length) throw new Error('Invalid presentation format');
      const claims = readJwt(credential, 'dc+sd-jwt', options.issuerKey);
      if (claims.iss !== options.issuer || claims.vct !== AGENT_ID_CREDENTIAL_TYPE || claims.resource !== url.href ||
          typeof claims.sub !== 'string' || typeof claims.owner !== 'string' || typeof claims.registration !== 'string' ||
          typeof claims.iat !== 'number' || !Number.isInteger(claims.iat) || claims.iat > now ||
          typeof claims.exp !== 'number' || !Number.isInteger(claims.exp) || claims.exp <= now ||
          claims.exp > claims.iat + lifetime) throw new Error('Invalid Agent ID credential');
      const holder = publicHolder((claims.cnf as { jwk: AgentDelegation['holder'] }).jwk);
      const kb = readJwt(keyBinding, 'kb+jwt', holder);
      if (kb.aud !== 'origin:' + url.origin || typeof kb.nonce !== 'string' ||
          !pending.has(kb.nonce) || typeof kb.iat !== 'number' || !Number.isInteger(kb.iat) ||
          kb.iat < now - lifetime || kb.iat > now ||
          kb.sd_hash !== createHash('sha256').update(credential + '~').digest('base64url')) {
        throw new Error('Invalid Agent ID challenge binding');
      }
      const current = await options.resolveBinding(claims.sub);
      if (!isDeepStrictEqual(current, { did: claims.sub, owner: claims.owner, registration: claims.registration }) ||
          clock() >= claims.exp || (pending.get(kb.nonce) ?? 0) <= clock() || !pending.delete(kb.nonce)) {
        throw new Error('Agent ID registration or challenge is no longer active');
      }
      return Response.json({ did: claims.sub }, { headers: { 'Cache-Control': 'no-store' } });
    } catch {
      return new Response(null, {
        status: 401, headers: {
          [HEADER.PROOF_RESULT]: verifier.encodeErrorObject(verifier.buildErrorObject({ error: 'invalid_presentation' })),
          'Cache-Control': 'no-store',
        },
      });
    }
  };
}
