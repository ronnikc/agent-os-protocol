// SPDX-License-Identifier: Apache-2.0
import { generateKeyPairSync } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  accessAgentIdResource, createAgentIdProofGate, issueAgentIdCredential, type AgentDelegation,
} from '@agent-os/concordium-commerce';

export const X401_TEST_PATH = '/api/v1/agent-lobby/x401/test-resource';

export function createX401TestFacility(origin: string) {
  const resource = new URL(X401_TEST_PATH, origin).href;
  const issuer = new URL('/panel/x401-test.html', origin).href;
  const issuerKey = generateKeyPairSync('ed25519');
  const binding = { did: 'did:example:agent-os-x401-fixture', owner: 'fixture-owner', registration: 'fixture-registration' };
  const resolveBinding = async (did: string) => did === binding.did ? binding : undefined;
  // This ephemeral issuer is trusted only by this test resource.
  const gate = createAgentIdProofGate({ resource, issuer, issuerKey: issuerKey.publicKey, resolveBinding });
  const fixtureGate = createAgentIdProofGate({ resource, issuer, issuerKey: issuerKey.publicKey, resolveBinding });
  let running = 0;

  return async (req: IncomingMessage, res: ServerResponse, path: string) => {
    function json(status: number, body: object) {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    }
    if (path === X401_TEST_PATH && req.method === 'GET') {
      const proof = req.headers['proof-response'];
      const result = await gate(new Request(resource, {
        headers: typeof proof === 'string' ? { 'PROOF-RESPONSE': proof } : undefined,
      }));
      result.headers.set('cache-control', 'no-store');
      res.writeHead(result.status, Object.fromEntries(result.headers));
      res.end(await result.text());
      return;
    }
    if (path !== X401_TEST_PATH + '/check' || req.method !== 'POST' ||
        req.headers['x-agent-os-proof'] !== '1') return json(404, { error: 'Unknown x401 test action' });
    if (running >= 4) return json(429, { error: 'The test facility is busy. Try again shortly.' });
    running++;
    try {
      const holder = generateKeyPairSync('ed25519');
      const credential = await issueAgentIdCredential({
        issuer, issuerKey: issuerKey.privateKey, resolveBinding,
        delegation: { binding, resource, holder: holder.publicKey.export({ format: 'jwk' }) as AgentDelegation['holder'],
          expiresAt: Math.floor(Date.now() / 1000) + 60 },
        verifyOwnerApproval: async () => true, // The fixture owns this synthetic registration.
      });
      let signedRequest: Request | undefined;
      const result = await accessAgentIdResource({
        did: binding.did, resource, credential, holderKey: holder.privateKey,
      }, async (url, init) => {
        const request = new Request(url, init);
        if (request.headers.has('proof-response')) signedRequest = request;
        return fixtureGate(request);
      });
      const replay = signedRequest && await fixtureGate(signedRequest);
      if (result !== 200 || !replay || replay.status !== 401 || !replay.headers.has('proof-result')) {
        throw new Error('Unexpected proof result');
      }
      json(200, { proofStatus: result, replayStatus: replay.status });
    } catch {
      json(503, { error: 'The x401 test did not complete. Try again shortly.' });
    } finally {
      running--;
    }
  };
}
