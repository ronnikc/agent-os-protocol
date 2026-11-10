// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { AccountAddress } from '@concordium/web-sdk';
import { CONCORDIUM_MAINNET_CAIP2 as network } from '@x402/concordium';
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import { createTestMerchant, TEST_MERCHANT_PATH } from '../../packages/lobby-server/src/hosted/test-merchant.js';

export async function verifyTestMerchant() {
  const recipient = AccountAddress.fromBuffer(Buffer.alloc(32, 1)).address;
  const sponsor = AccountAddress.fromBuffer(Buffer.alloc(32, 2)).address;
  const payer = AccountAddress.fromBuffer(Buffer.alloc(32, 3)).address;
  const resource = 'https://merchant.example' + TEST_MERCHANT_PATH;
  const inviteToken = 'a'.repeat(32);
  let settlements = 0;
  let confirmed = false;
  const receipts = new Set<string>();
  const merchant = createTestMerchant({ resource, recipient, sponsor, amountMicroCcd: '1000000', inviteToken }, {
    facilitator: {
      async getSupported() {
        return { kinds: [{ x402Version: 2, scheme: 'exact', network, extra: { feePayer: sponsor } }], extensions: [], signers: {} };
      },
      async verify() { return { isValid: true, payer }; },
      async settle() { settlements++; return { success: true, network, payer, transaction: 'b'.repeat(64) }; },
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
  const server = createServer((req, res) => void merchant(req, res));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const endpoint = 'http://127.0.0.1:' + address.port + TEST_MERCHANT_PATH;
  const auth = { Authorization: 'Bearer ' + inviteToken };
  try {
    const denied = await fetch(endpoint);
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.has('PAYMENT-REQUIRED'), false);
    await denied.body?.cancel();
    const quote = await fetch(endpoint, { headers: auth });
    assert.equal(quote.status, 402);
    const requirement = decodePaymentRequiredHeader(quote.headers.get('PAYMENT-REQUIRED')!);
    assert.equal(requirement.resource.url, resource);
    assert.equal(requirement.accepts[0].extra.feePayer, sponsor);
    await quote.body?.cancel();
    const pay = (amount: string) => fetch(endpoint, { headers: {
      ...auth,
      'PAYMENT-SIGNATURE': encodePaymentSignatureHeader({
        x402Version: 2, resource: requirement.resource,
        accepted: { ...requirement.accepts[0], amount }, payload: { fixture: true },
      }),
    } });
    const wrong = await pay('10000000');
    assert.equal(wrong.status, 400);
    await wrong.body?.cancel();
    assert.equal(settlements, 0);
    const unconfirmed = await pay('1000000');
    assert.equal(unconfirmed.status, 502);
    assert.equal(unconfirmed.headers.has('PAYMENT-RESPONSE'), false);
    await unconfirmed.body?.cancel();
    confirmed = true;
    const paid = await pay('1000000');
    assert.equal(paid.status, 200);
    const receipt = decodePaymentResponseHeader(paid.headers.get('PAYMENT-RESPONSE')!);
    assert.equal(receipt.transaction, 'b'.repeat(64));
    assert.equal((await paid.json()).amountMicroCcd, '1000000');
    const replay = await pay('1000000');
    assert.equal(replay.status, 409);
    await replay.body?.cancel();
  } finally {
    server.close();
    await once(server, 'close');
  }
}
