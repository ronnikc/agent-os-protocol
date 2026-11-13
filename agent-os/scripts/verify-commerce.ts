// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { AgentWallets } from '../../packages/lobby-server/src/hosted/agent-wallets.js';
import { InMemoryLobbyStore } from '../../packages/lobby-server/src/store.js';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { verifyEscrowSimulator } from './verify-escrow-simulator.js';
import { verifyAgentIdProof } from './verify-agent-id-proof.js';
import { verifyTestMerchant } from './verify-test-merchant.js';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountAddress, ReturnValue, buildAccountSigner, SequenceNumber, type ConcordiumGRPCClient } from '@concordium/web-sdk';
import { ConcordiumGRPCNodeClient } from '@concordium/web-sdk/nodejs';
import { HEADER, verifier } from '@proof.com/x401-node';
import { CONCORDIUM_TESTNET_CAIP2 } from '@x402/concordium';
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from '@x402/core/http';
import type { PaymentRequirements } from '@x402/core/types';
import { preflightMainnetWalletBinding, requestCommerceResource, requestWithSpendingLimit, spendingScope, SpendingLedger, type CommerceAuthorization, type CommercePolicy } from '@agent-os/concordium-commerce';

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

async function verifyWalletOperations() {
  const directory = mkdtempSync(join(tmpdir(), 'agent-wallet-'));
  try {
    const file = join(directory, 'wallet.json');
    const did = 'did:ccd:mainnet:fixture';
    const ownerAddress = account(1).address;
    const owner = 'did:ccd:mainnet:' + ownerAddress;
    let revoked = false;
    let binding = { address: account(2).address, nonce: '1', balance: '100' };
    const service = () => new AgentWallets(new InMemoryLobbyStore(file), async () => ({
      status: revoked ? 'failed' : 'registry_verified',
      ref: { did, network: 'mainnet', account: ownerAddress }, registryTokenId: '42',
      source: 'api', checkedAt: new Date().toISOString(),
    }), async tokenId => { assert.equal(tokenId, 42n); return binding; });
    const action = (name: string) => ({ action: name, network: 'mainnet', address: binding.address, nonce: binding.nonce });
    await assert.rejects(service().update('lobby', 'outsider', did, action('link')), /ownership/);
    await assert.rejects(service().update('lobby', owner, did, { ...action('link'), network: 'testnet' }), /network/);
    assert.equal((await service().update('lobby', owner, did, action('link'))).status, 'linked');
    assert.equal((await service().view('lobby', owner, did)).eligible, true);
    assert.equal((await service().view('other-lobby', owner, did)).saved, undefined);
    await service().update('lobby', owner, did, action('pause'));
    const stale = action('rotate');
    binding = { address: account(3).address, nonce: '2', balance: '200' };
    await assert.rejects(service().update('lobby', owner, did, stale), /changed/);
    assert.equal((await service().update('lobby', owner, did, action('rotate'))).address, binding.address);
    revoked = true;
    await assert.rejects(service().view('lobby', owner, did), /ownership/);
    revoked = false;
    assert.equal((await service().update('lobby', owner, did, action('unlink'))).status, 'unlinked');
    assert.equal((await service().view('lobby', owner, did)).paymentState, 'disabled');
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

async function main() {
  verifyEscrowSimulator();
  await verifyWalletOperations();
  const payerSeed = '04'.repeat(32);
  const payerKey = createPrivateKey({
    key: Buffer.from('302e020100300506032b657004220420' + payerSeed, 'hex'),
    format: 'der', type: 'pkcs8',
  });
  const verifyKey = createPublicKey(payerKey).export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
  let simulations = 0;
  let bindingSignatures = 0;
  const registry = {
    async getConsensusStatus() {
      return { genesisBlock: '9dd9ca4d19e9393877d2c44b70f89acbfc0883c2243e5eeaecc0d1cd0503f478' };
    },
    async getAccountInfo() {
      return { accountThreshold: 1, accountCredentials: { 0: { value: { contents: {
        credentialPublicKeys: { threshold: 1, keys: { 0: { verifyKey } } },
      } } } } };
    },
    async invokeContract(context: { method: { toString(): string } }) {
      switch (context.method.toString()) {
        case 'CIS-8004.getAgentWallet':
          return { tag: 'success', returnValue: ReturnValue.fromHexString('01' + '02'.repeat(32)) };
        case 'CIS-8004.getAgentWalletNonce':
          return { tag: 'success', returnValue: ReturnValue.fromHexString('010700000000000000') };
        case 'CIS-8004.setAgentWallet':
          simulations++;
          return { tag: 'success' };
        default: throw new Error('Unexpected registry invocation');
      }
    },
  } as unknown as ConcordiumGRPCClient;
  const signBinding = (message: ArrayBuffer) => {
    bindingSignatures++;
    assert.equal(message.byteLength, 162);
    return buildAccountSigner(payerSeed).sign(message);
  };
  await assert.rejects(preflightMainnetWalletBinding(registry, 5123n, account(1), account(3), signBinding, account(4)),
    /Current agent wallet changed/);
  await assert.rejects(preflightMainnetWalletBinding(registry, 5123n, account(1), account(2), signBinding, account(2)),
    /already bound/);
  assert.equal(bindingSignatures, 0);
  const rotation = await preflightMainnetWalletBinding(registry, 5123n, account(1), account(3), signBinding, account(2));
  assert.equal(rotation.nonce, 7n);
  assert.equal(rotation.previousWallet?.address, account(2).address);
  assert.equal(rotation.payload.amount.microCcdAmount, 0n);
  assert.equal(simulations, 1);

  await verifyAgentIdProof();
  await verifyTestMerchant();
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

    const directory = mkdtempSync(join(tmpdir(), 'agent-os-spending-'));
    const path = join(directory, 'reservations.json');
    try {
      let payments = 0;
      const merchant: typeof fetch = async (_url, init) => {
        if (!new Headers(init?.headers).has('PAYMENT-SIGNATURE')) return paymentRequired();
        payments++;
        throw new Error('connection lost after authorization');
      };
      const first = await requestWithSpendingLimit(policy, authorization, new SpendingLedger(path), 'order-1', 15_000n, merchant);
      assert.equal(first.result.state, 'unconfirmed');
      assert.ok(first.reservationId);
      const reopened = new SpendingLedger(path);
      assert.throws(() => reopened.releaseUnsigned(first.reservationId!), /Only an unsigned reservation/);
      await assert.rejects(requestWithSpendingLimit(policy, authorization, reopened, 'order-1', 15_000n, merchant), /already has a reservation/);
      const alias = AccountAddress.getAlias(account(3), 1).address;
      await assert.rejects(requestWithSpendingLimit({ ...policy, payer: alias }, authorization, reopened, 'order-2', 15_000n, merchant), /daily limit/);
      assert.equal(payments, 1, 'unknown settlement and aliases must not authorize another charge');

      const rejected = { ...authorization, async authorize() { throw new Error('owner declined'); } };
      await assert.rejects(requestWithSpendingLimit(policy, rejected, reopened, 'order-3', 20_000n, merchant), /owner declined/);
      const second = await requestWithSpendingLimit(policy, authorization, reopened, 'order-4', 20_000n, async (_url, init) => {
        if (!new Headers(init?.headers).has('PAYMENT-SIGNATURE')) return paymentRequired();
        return new Response('resource', { headers: { 'PAYMENT-RESPONSE': encodePaymentResponseHeader(receipt) } });
      });
      assert.equal(second.result.state, 'settled');
      const page = reopened.receipts(spendingScope(policy.network, policy.payer, policy.asset), 0, 2);
      assert.equal(page.total, 3);
      assert.equal(page.data[0].state, 'settled');
      assert.ok(page.data.every(row => !('submission' in row) && !('scope' in row)));
      await assert.rejects(requestWithSpendingLimit(policy, authorization, reopened, 'order-5', 20_000n, merchant), /daily limit/);
    } finally {
      rmSync(path, { force: true });
      rmdirSync(directory);
    }
  } finally {
    ConcordiumGRPCNodeClient.prototype.getNextAccountNonce = originalNonce;
  }
  console.log('Commerce verification passed: proof gating, policy, official sponsored signing, settlement, uncertain retry, and durable spending limits.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
