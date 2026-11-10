// SPDX-License-Identifier: Apache-2.0
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isDeepStrictEqual } from 'node:util';
import type { VerifiablePresentation } from '@concordium/web-sdk';

const verifierUrl = 'https://web3id-verifier.mainnet.concordium.software/v0/verify';
const pending = new Map<string, { expires: number; atom: AgeStatement }>();
let activeVerifications = 0;

type AgeStatement = {
  type: 'AttributeInRange';
  attributeTag: 'dob';
  lower: string;
  upper: string;
};

function respond(res: ServerResponse, status: number, body: object) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function challenge(res: ServerResponse) {
  const now = Date.now();
  for (const [key, entry] of pending) {
    if (entry.expires <= now) pending.delete(key);
  }
  if (pending.size >= 256) return respond(res, 429, { message: 'The pilot is busy. Try again shortly.' });
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 18);
  const atom: AgeStatement = {
    type: 'AttributeInRange', attributeTag: 'dob', lower: '18000101',
    upper: cutoff.toISOString().slice(0, 10).replaceAll('-', ''),
  };
  const nonce = randomBytes(32).toString('hex');
  pending.set(nonce, { expires: now + 300_000, atom });
  respond(res, 200, {
    challenge: nonce,
    statement: [{ idQualifier: { type: 'cred', issuers: [0, 1, 2, 3, 4, 5, 6, 7] }, statement: [atom] }],
  });
}

function boundedProof(input: VerifiablePresentation, atom: AgeStatement) {
  const credential = input.verifiableCredential?.[0];
  const subject = credential?.credentialSubject;
  const range = subject?.proof?.proofValue?.[0];
  const linking = input.proof;
  if (input.type !== 'VerifiablePresentation' || input.verifiableCredential?.length !== 1 ||
      !isDeepStrictEqual(credential?.type, ['VerifiableCredential', 'ConcordiumVerifiableCredential']) ||
      !/^did:ccd:mainnet:idp:[0-7]$/.test(credential.issuer) ||
      !/^did:ccd:mainnet:cred:[0-9a-f]{64,96}$/i.test(subject?.id) ||
      !isDeepStrictEqual(subject.statement, [atom]) ||
      subject.proof?.type !== 'ConcordiumZKProofV3' || subject.proof.proofValue?.length !== 1 ||
      range?.type !== 'AttributeInRange' || typeof range.proof !== 'string' || !/^[0-9a-f]+$/i.test(range.proof) ||
      typeof subject.proof.created !== 'string' || !Number.isFinite(Date.parse(subject.proof.created)) ||
      linking?.type !== 'ConcordiumWeakLinkingProofV1' || !isDeepStrictEqual(linking.proofValue, []) ||
      typeof linking.created !== 'string' || !Number.isFinite(Date.parse(linking.created))) return null;

  // Forward only the fields needed for this single zero-knowledge predicate.
  return {
    type: input.type, presentationContext: input.presentationContext,
    proof: { type: linking.type, created: linking.created, proofValue: [] },
    verifiableCredential: [{
      type: credential.type, issuer: credential.issuer,
      credentialSubject: {
        id: subject.id, statement: [atom],
        proof: {
          type: subject.proof.type, created: subject.proof.created,
          proofValue: [{ type: range.type, proof: range.proof }],
        },
      },
    }],
  };
}

export const MAINNET_PROOF_PATH = '/api/v1/agent-lobby/mainnet-proof';

export async function handleMainnetProof(req: IncomingMessage, res: ServerResponse, path: string) {
  // A cross-origin browser cannot set this header without an allowed preflight.
  if (req.method !== 'POST' || req.headers['x-agent-os-proof'] !== '1' ||
      req.headers['content-type'] !== 'application/json') {
    return respond(res, 403, { message: 'Use the Mainnet Proof Pilot page to submit a request.' });
  }
  if (path === MAINNET_PROOF_PATH + '/challenge') return challenge(res);
  if (path !== MAINNET_PROOF_PATH + '/verify') return respond(res, 404, { message: 'Unknown proof endpoint.' });

  let proof;
  try {
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > 32_768) return respond(res, 413, { message: 'Proof exceeds the size limit.' });
      chunks.push(chunk);
    }
    const input = JSON.parse(Buffer.concat(chunks).toString());
    const entry = pending.get(input?.presentationContext);
    if (entry && entry.expires > Date.now()) proof = boundedProof(input, entry.atom);
  } catch {
    return respond(res, 400, { message: 'Malformed proof.' });
  }
  if (!proof) return respond(res, 400, { message: 'This proof does not match a fresh Mainnet challenge.' });
  if (activeVerifications >= 8) return respond(res, 429, { message: 'The pilot is busy. Try again shortly.' });
  pending.delete(proof.presentationContext);
  activeVerifications++;
  try {
    const result = await fetch(verifierUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(proof),
      signal: AbortSignal.timeout(12_000), redirect: 'error',
    });
    await result.body?.cancel();
    if (result.status === 200) return respond(res, 200, { message: 'Concordium Mainnet age proof verified.' });
    if (result.status === 400 || result.status === 404) {
      return respond(res, 422, { message: 'Concordium could not verify this proof. Request a new proof to retry.' });
    }
    return respond(res, 502, { message: 'The Concordium verifier is unavailable. Try again later.' });
  } catch {
    return respond(res, 502, { message: 'The Concordium verifier is unavailable. Try again later.' });
  } finally {
    activeVerifications--;
  }
}
