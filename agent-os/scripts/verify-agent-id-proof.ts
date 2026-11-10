// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, verify } from 'node:crypto';
import { mkdtempSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agent, HEADER } from '@proof.com/x401-node';
import { createApiRuntimeAdapter } from '@agent-os/adapters';
import { loadHostedAgentIdAccess } from '../../packages/lobby-server/src/hosted/agent-id-access.js';
import { agentDelegationMessage, createAgentIdProofGate, issueAgentIdCredential, presentAgentIdCredential, type AgentDelegation } from '@agent-os/concordium-commerce';

export async function verifyAgentIdProof() {
  const issuer = generateKeyPairSync('ed25519');
  const owner = generateKeyPairSync('ed25519');
  const holder = generateKeyPairSync('ed25519');
  const impostor = generateKeyPairSync('ed25519');
  const resource = 'https://merchant.example/protected';
  const issuerUrl = 'https://issuer.example/';
  const binding = { did: 'did:ccd:mainnet:agent-fixture', owner: 'owner-fixture', registration: 'mainnet:10082:0:5123' };
  let active = true;
  const resolveBinding = async (did: string) => active && did === binding.did ? binding : undefined;
  const delegation: AgentDelegation = {
    binding, holder: holder.publicKey.export({ format: 'jwk' }) as AgentDelegation['holder'],
    resource, expiresAt: Math.floor(Date.now() / 1000) + 120,
  };
  const approval = sign(null, Buffer.from(agentDelegationMessage(delegation)), owner.privateKey);
  const options = {
    issuer: issuerUrl, issuerKey: issuer.privateKey, delegation, resolveBinding,
    verifyOwnerApproval: async (account: string, message: string) =>
      account === binding.owner && verify(null, Buffer.from(message), owner.publicKey, approval),
  };
  await assert.rejects(issueAgentIdCredential({
    ...options, delegation: { ...delegation, holder: impostor.publicKey.export({ format: 'jwk' }) as AgentDelegation['holder'] },
  }), /not authorized/);
  const credential = await issueAgentIdCredential(options);
  const gate = createAgentIdProofGate({ resource, issuer: issuerUrl, issuerKey: issuer.publicKey, resolveBinding });
  async function challenge() {
    const response = await gate(new Request(resource));
    assert.equal(response.status, 401);
    const requirement = agent.detectProofRequirement({ headers: response.headers });
    assert.ok(requirement);
    return agent.getDigitalCredentialRequest(requirement.payload);
  }
  function redeem(result: ReturnType<typeof presentAgentIdCredential>) {
    return gate(new Request(resource, { headers: {
      [HEADER.PROOF_RESPONSE]: agent.encodeResultArtifact(agent.buildResultArtifact({ credentialResult: result })),
    } }));
  }
  const request = await challenge();
  assert.throws(() => presentAgentIdCredential(request, resource, credential, impostor.privateKey), /does not authorize/);
  assert.throws(() => presentAgentIdCredential(request, 'https://other.example/protected', credential, holder.privateKey), /does not authorize/);
  const presentation = presentAgentIdCredential(request, resource, credential, holder.privateKey);
  const vp = (presentation.data as { vp_token: { agent_id: string[] } }).vp_token;
  const copiedDid = await redeem({ ...presentation, data: { vp_token: { agent_id: [binding.did] } } });
  assert.equal(copiedDid.status, 401);
  const [signedCredential, kb] = vp.agent_id[0].split('~');
  const [head, claims] = kb.split('.');
  const input = head + '.' + claims;
  const badKey = signedCredential + '~' + input + '.' + sign(null, Buffer.from(input), impostor.privateKey).toString('base64url');
  assert.equal((await redeem({ ...presentation, data: { vp_token: { agent_id: [badKey] } } })).status, 401);
  const attempts = await Promise.all([redeem(presentation), redeem(presentation)]);
  assert.deepEqual(attempts.map(result => result.status).sort(), [200, 401]);
  assert.deepEqual(await attempts.find(result => result.ok)?.json(), { did: binding.did });
  const folder = mkdtempSync(join(tmpdir(), 'agent-id-proof-'));
  try {
    const file = join(folder, 'proof.json');
    const lobbyId = 'lobby-fixture';
    writeFileSync(file, JSON.stringify({
      lobbyId, did: binding.did, resource, credential,
      holderPrivateKeyPem: holder.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    }), { mode: 0o600 });
    const setup = { file, lobbyId, did: binding.did, isRegistered: async () => active };
    assert.equal(loadHostedAgentIdAccess({ ...setup, lobbyId: 'other-lobby' }), undefined);
    assert.equal(loadHostedAgentIdAccess({ ...setup, did: 'did:ccd:mainnet:agent-other' }), undefined);
    let requests = 0;
    const accessAgentIdResource = loadHostedAgentIdAccess({
      ...setup, fetchResource: async (url, init) => {
        assert.equal(String(url), resource);
        assert.equal(init?.redirect, 'error');
        requests++;
        return gate(new Request(url, init));
      },
    });
    assert.ok(accessAgentIdResource);
    let providerTurns = 0;
    const adapter = createApiRuntimeAdapter({
      provider: { id: 'openai-compatible', model: 'fixture' },
      apiKey: 'fixture-key', accessAgentIdResource,
      fetchFn: async (_url, init) => {
        providerTurns++;
        const body = JSON.parse(String(init?.body));
        assert.ok(body.tools.some((tool: { function: { name: string } }) => tool.function.name === 'access_agent_id_resource'));
        assert.ok(!String(init?.body).includes(credential));
        if (providerTurns === 1) return Response.json({ choices: [{ message: {
          content: '', tool_calls: [{ id: 'call-proof', type: 'function', function: { name: 'access_agent_id_resource', arguments: '{}' } }],
        } }] });
        assert.equal(body.messages.at(-1).content, 'Agent ID proof accepted by the configured resource.');
        return Response.json({ choices: [{ message: { content: 'Access verified.' } }] });
      },
    });
    const session = await adapter.startAgent({ cwd: '/hosted' });
    await adapter.sendInput(session, { type: 'user', content: 'Check access.' });
    let reply;
    for await (const event of adapter.readOutput(session)) if (event.type === 'done') reply = event.content;
    await adapter.stopAgent(session);
    assert.equal(reply, 'Access verified.');
    assert.equal(requests, 2);
    active = false;
    assert.match(await accessAgentIdResource(), /requires an active/);
    assert.equal(requests, 2);
    active = true;
  } finally {
    rmSync(join(folder, 'proof.json'), { force: true });
    rmdirSync(folder);
  }
  const next = presentAgentIdCredential(await challenge(), resource, credential, holder.privateKey);
  active = false;
  assert.equal((await redeem(next)).status, 401);
}
