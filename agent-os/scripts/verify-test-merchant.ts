// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountAddress } from '@concordium/web-sdk';
import { CONCORDIUM_MAINNET_CAIP2, CONCORDIUM_TESTNET_CAIP2 } from '@x402/concordium';
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import { createTestMerchant, merchantAttempts, TEST_MERCHANT_PATH, TESTNET_MERCHANT_PATH } from '../../packages/lobby-server/src/hosted/test-merchant.js';

export async function verifyTestMerchant() {
  await verifyMerchant(false);
  await verifyMerchant(true);
}

async function verifyMerchant(testnet: boolean) {
  const network = testnet ? CONCORDIUM_TESTNET_CAIP2 : CONCORDIUM_MAINNET_CAIP2;
  const route = testnet ? TESTNET_MERCHANT_PATH : TEST_MERCHANT_PATH;
  const recipient = AccountAddress.fromBuffer(Buffer.alloc(32, 1)).address;
  const sponsor = AccountAddress.fromBuffer(Buffer.alloc(32, 2)).address;
  const payer = AccountAddress.fromBuffer(Buffer.alloc(32, 3)).address;
  const resource = 'https://merchant.example' + route;
  const inviteToken = 'a'.repeat(32);
  let settlements = 0;
  let confirmed = false;
  const receipts = new Set<string>();
  const directory = mkdtempSync(join(tmpdir(), 'x402-merchant-'));
  let loseResponse = false;
  const startMerchant = () => createTestMerchant({
    resource, recipient, sponsor, amountMicroCcd: '1000000', inviteToken,
    network: testnet ? 'testnet' : 'mainnet',
  }, {
    attempts: testnet ? merchantAttempts(directory) : undefined,
    facilitator: {
      async getSupported() {
        return { kinds: [{ x402Version: 2, scheme: 'exact', network, extra: { feePayer: sponsor } }], extensions: [], signers: {} };
      },
      async verify() { return { isValid: true, payer }; },
      async settle() {
        settlements++;
        if (loseResponse) throw new Error('Facilitator response lost after submission');
        return { success: true, network, payer, transaction: 'b'.repeat(64) };
      },
    },
    async verifyFinalized(_receipt, account, quote) {
      return confirmed && account === payer && quote.amount === '1000000' && quote.payTo === recipient;
    },
    recordReceipt(receipt) {
      if (receipts.has(receipt.transaction)) return false;
      receipts.add(receipt.transaction);
      return true;
    },
  });
  let merchant = startMerchant();
  const server = createServer((req, res) => void merchant(req, res));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const endpoint = 'http://127.0.0.1:' + address.port + route;
  const auth: Record<string, string> = testnet ? {} : { Authorization: 'Bearer ' + inviteToken };
  try {
    const denied = await fetch(endpoint);
    assert.equal(denied.status, testnet ? 402 : 401);
    assert.equal(denied.headers.has('PAYMENT-REQUIRED'), testnet);
    if (testnet) {
      assert.equal(denied.headers.get('Access-Control-Allow-Origin'), '*');
      const preflight = await fetch(endpoint, { method: 'OPTIONS' });
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get('Access-Control-Allow-Headers'), 'PAYMENT-SIGNATURE');
    }
    await denied.body?.cancel();
    const quote = await fetch(endpoint, { headers: auth });
    assert.equal(quote.status, 402);
    const requirement = decodePaymentRequiredHeader(quote.headers.get('PAYMENT-REQUIRED')!);
    assert.equal(requirement.resource.url, resource);
    assert.equal(requirement.accepts[0].extra.feePayer, sponsor);
    assert.equal(requirement.accepts[0].network, network);
    await quote.body?.cancel();
    const pay = (amount: string, payload: Record<string, unknown> = { fixture: true }, offeredNetwork = network) => fetch(endpoint, { headers: {
      ...auth,
      'PAYMENT-SIGNATURE': encodePaymentSignatureHeader({
        x402Version: 2, resource: requirement.resource,
        accepted: { ...requirement.accepts[0], amount, network: offeredNetwork }, payload,
      }),
    } });
    const wrong = await pay('10000000');
    assert.equal(wrong.status, 400);
    await wrong.body?.cancel();
    if (testnet) {
      const wrongNetwork = await pay('1000000', undefined, CONCORDIUM_MAINNET_CAIP2);
      assert.equal(wrongNetwork.status, 400);
      await wrongNetwork.body?.cancel();
    }
    assert.equal(settlements, 0);
    const unconfirmed = await pay('1000000');
    assert.equal(unconfirmed.status, 502);
    assert.equal(unconfirmed.headers.has('PAYMENT-RESPONSE'), false);
    await unconfirmed.body?.cancel();
    confirmed = true;
    merchant = startMerchant();
    const paid = await pay('1000000');
    assert.equal(paid.status, 200);
    const receipt = decodePaymentResponseHeader(paid.headers.get('PAYMENT-RESPONSE')!);
    assert.equal(receipt.transaction, 'b'.repeat(64));
    assert.equal(receipt.network, network);
    const body = await paid.json();
    assert.equal(body.amountMicroCcd, '1000000');
    assert.equal(body.payer, payer);
    assert.equal(body.recipient, recipient);
    assert.equal(body.sponsor, sponsor);
    assert.match(body.explorer, testnet ? /\/testnet\// : /\/mainnet\//);
    merchant = startMerchant();
    const replay = await pay('1000000');
    assert.equal(replay.status, testnet ? 200 : 409);
    await replay.body?.cancel();
    if (testnet) {
      assert.equal(settlements, 1);
      loseResponse = true;
      const lost = await pay('1000000', { fixture: true, lost: true });
      assert.equal(lost.status, 502);
      await lost.body?.cancel();
      merchant = startMerchant();
      const uncertain = await pay('1000000', { lost: true, fixture: true });
      assert.equal(uncertain.status, 502);
      await uncertain.body?.cancel();
      assert.equal(settlements, 2);
    }
  } finally {
    server.close();
    await once(server, 'close');
    rmSync(directory, { recursive: true, force: true });
  }
}
