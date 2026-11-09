// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { AccountAddress, buildAccountSigner, SequenceNumber } from '@concordium/web-sdk';
import { ConcordiumGRPCNodeClient } from '@concordium/web-sdk/nodejs';
import { HEADER, verifier } from '@proof.com/x401-node';
import { CONCORDIUM_TESTNET_CAIP2 } from '@x402/concordium';
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from '@x402/core/http';
import type { PaymentRequirements } from '@x402/core/types';
import { requestCommerceResource, type CommerceAuthorization, type CommercePolicy } from '@agent-os/concordium-commerce';

const account = (fill: number) => AccountAddress.fromBuffer(Buffer.alloc(32, fill));
const policy: CommercePolicy = {
  resource: 'https://merchant.example/agent-resource',
  network: CONCORDIUM_TESTNET_CAIP2,
  payer: account(3).address,
  recipient: account(1).address,
  sponsor: account(2).address,
  asset: 'CCD',
  maxAmount: 50_000n,
};
const quote: PaymentRequirements = {
  scheme: 'exact', network: policy.network, payTo: policy.recipient,
  asset: policy.asset, amount: '10000', maxTimeoutSeconds: 30, extra: { feePayer: policy.sponsor },
};
const paymentRequired = (accepted = quote) => new Response(null, {
  status: 402,
  headers: {
    'PAYMENT-REQUIRED': encodePaymentRequiredHeader({ x402Version: 2, resource: { url: policy.resource }, accepts: [accepted] }),
  },
});
const proofRequired = () => {
  const challenge = verifier.buildPayload({
    credentialRequirements: { digital: { requests: [{
      protocol: 'openid4vp-v1-unsigned',
      data: { response_type: 'vp_token', response_mode: 'dc_api', nonce: 'fixture-nonce', dcql_query: { credentials: [{ id: 'agent', format: 'dc+sd-jwt' }] } },
    }] } },
  });
  return new Response(null, { status: 401, headers: { [HEADER.PROOF_REQUEST]: verifier.encodePayload(challenge) } });
};

let authorizations = 0;
const authorization: CommerceAuthorization = {
  async authorize() {
    authorizations++;
    return { accountAddress: account(3), signer: buildAccountSigner('04'.repeat(32)) };
  },
  async presentProof(request) {
    assert.equal(request.requests[0].protocol, 'openid4vp-v1-unsigned');
    return { protocol: 'openid4vp-v1-unsigned', data: { vp_token: { agent: ['fixture-presentation'] } } };
  },
  async verifySettlement(receipt, accepted) {
    return receipt.transaction === 'a'.repeat(64) && accepted.amount === '10000';
  },
};

async function main() {
  for (const rejected of [
    { ...quote, amount: '50001' },
    { ...quote, payTo: account(4).address },
    { ...quote, extra: { feePayer: account(4).address } },
    { ...quote, asset: 'EURR' },
  ]) {
    await assert.rejects(requestCommerceResource(policy, authorization, async () => paymentRequired(rejected)),
      /matches the approved payment policy/);
  }
  assert.equal(authorizations, 0, 'rejected quotes must not reach the signer');

  await assert.rejects(requestCommerceResource(policy, authorization, async () => proofRequired()), /did not accept/);
  assert.equal(authorizations, 0, 'a rejected proof must not authorize payment');

  await assert.rejects(requestCommerceResource({ ...policy, payer: account(4).address }, authorization, async () => paymentRequired()),
    /Signer does not match/);
  assert.equal(authorizations, 1);
  authorizations = 0;

  const originalNonce = ConcordiumGRPCNodeClient.prototype.getNextAccountNonce;
  ConcordiumGRPCNodeClient.prototype.getNextAccountNonce = async () => ({ nonce: SequenceNumber.create(7n), allFinal: true });
  try {
    const receipt = { success: true, transaction: 'a'.repeat(64), network: policy.network };
    let requests = 0;
    const result = await requestCommerceResource(policy, authorization, async (url, init) => {
      assert.equal(String(url), policy.resource);
      assert.equal(init?.redirect, 'error');
      const headers = new Headers(init?.headers);
      requests++;
      if (requests === 1) return proofRequired();
      const proof = verifier.decodeResultArtifact(headers.get(HEADER.PROOF_RESPONSE)!);
      assert.deepEqual(proof.credential_result?.data.vp_token, { agent: ['fixture-presentation'] });
      if (requests === 2) return paymentRequired();
      const payment = decodePaymentSignatureHeader(headers.get('PAYMENT-SIGNATURE')!);
      assert.equal(payment.accepted.payTo, policy.recipient);
      assert.equal(payment.accepted.amount, quote.amount);
      assert.ok(payment.payload.signedTransaction, 'expected the official SDK signed transaction');
      return new Response('resource', { headers: { 'PAYMENT-RESPONSE': encodePaymentResponseHeader(receipt) } });
    });
    assert.equal(result.state, 'settled');
    assert.equal(requests, 3);
    assert.equal(authorizations, 1);

    let timeoutRequests = 0;
    const uncertain = await requestCommerceResource(policy, authorization, async () => {
      timeoutRequests++;
      if (timeoutRequests === 1) return paymentRequired();
      throw new Error('timeout after signing');
    });
    assert.equal(uncertain.state, 'unconfirmed');
    assert.equal(timeoutRequests, 2, 'a failed payment response must not trigger another payment attempt');
  } finally {
    ConcordiumGRPCNodeClient.prototype.getNextAccountNonce = originalNonce;
  }
  console.log('Commerce verification passed: proof gating, policy, official sponsored signing, settlement, and uncertain retry.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
