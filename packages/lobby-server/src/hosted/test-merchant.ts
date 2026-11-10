// SPDX-License-Identifier: Apache-2.0
import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isAbsolute, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { AccountAddress, TransactionHash } from '@concordium/web-sdk';
import { ConcordiumGRPCNodeClient } from '@concordium/web-sdk/nodejs';
import { credentials } from '@grpc/grpc-js';
import { CONCORDIUM_MAINNET_CAIP2 } from '@x402/concordium';
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from '@x402/core/http';
import { HTTPFacilitatorClient, type FacilitatorClient } from '@x402/core/server';
import type { PaymentRequirements, SettleResponse } from '@x402/core/types';

export const TEST_MERCHANT_PATH = '/api/v1/agent-lobby/x402/test-resource';
const network = CONCORDIUM_MAINNET_CAIP2;
const digest = (value: string) => createHash('sha256').update(value).digest();

interface MerchantConfig {
  resource: string;
  recipient: string;
  sponsor: string;
  amountMicroCcd: string;
  inviteToken?: string;
  publicAccess?: boolean;
}

function json(res: ServerResponse, status: number, body: object, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function httpsUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.href !== value) {
    throw new Error('Expected a canonical HTTPS URL');
  }
  return url;
}

export function createTestMerchant(config: MerchantConfig, services: {
  facilitator: Pick<FacilitatorClient, 'getSupported' | 'verify' | 'settle'>;
  verifyFinalized: (receipt: SettleResponse, payer: string, quote: PaymentRequirements) => Promise<boolean>;
  recordReceipt: (receipt: SettleResponse) => boolean;
}) {
  const url = httpsUrl(config.resource);
  if (url.pathname !== TEST_MERCHANT_PATH ||
      !['1000000', '10000000'].includes(config.amountMicroCcd) ||
      config.publicAccess !== true && (!config.inviteToken || config.inviteToken.length < 32)) {
    throw new Error('Invalid x402 test merchant configuration');
  }
  const recipient = AccountAddress.fromBase58(config.recipient);
  const sponsor = AccountAddress.fromBase58(config.sponsor);
  if (AccountAddress.isAlias(recipient, sponsor)) throw new Error('Use distinct merchant and sponsor accounts');
  const invite = config.publicAccess === true ? undefined : digest('Bearer ' + config.inviteToken);
  const resource = { url: url.href, description: 'Agent OS x402 Mainnet demo receipt', mimeType: 'application/json' };
  const quote: PaymentRequirements = {
    scheme: 'exact', network, asset: 'CCD', payTo: recipient.address,
    amount: config.amountMicroCcd, maxTimeoutSeconds: 120, extra: { feePayer: sponsor.address },
  };
  let supportedUntil = 0;
  let checkingSupport: Promise<void> | undefined;
  const inFlight = new Set<string>();
  const required = encodePaymentRequiredHeader({ x402Version: 2, resource, accepts: [quote] });

  async function ensureSupported() {
    if (supportedUntil > Date.now()) return;
    checkingSupport ??= services.facilitator.getSupported().then(supported => {
      if (!supported.kinds.some(kind => kind.x402Version === 2 && kind.scheme === 'exact' &&
          kind.network === network && kind.extra?.feePayer === sponsor.address)) {
        throw new Error('Facilitator does not advertise the pinned sponsor');
      }
      supportedUntil = Date.now() + 30_000;
    }).finally(() => { checkingSupport = undefined; });
    await checkingSupport;
  }

  return async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'GET' || req.url !== TEST_MERCHANT_PATH) return json(res, 404, { error: 'Resource not found' });
    if (invite && !timingSafeEqual(invite, digest(req.headers.authorization ?? ''))) {
      return json(res, 401, { error: 'An invitation is required for this Mainnet pilot' });
    }
    const header = req.headers['payment-signature'];
    let payment;
    if (header !== undefined) {
      try {
        if (typeof header !== 'string' || header.length > 12_288) throw new Error('Invalid header');
        payment = decodePaymentSignatureHeader(header);
        if (payment.x402Version !== 2 || payment.resource?.url !== resource.url ||
            !isDeepStrictEqual(payment.accepted, quote)) throw new Error('Quote mismatch');
      } catch {
        return json(res, 400, { error: 'Payment does not match the current Mainnet quote' });
      }
    }
    try {
      await ensureSupported();
    } catch {
      return json(res, 503, { error: 'Mainnet settlement is currently unavailable' });
    }
    if (!payment) return json(res, 402, {
      message: 'This demo transfers real Mainnet CCD to the merchant.',
      amountMicroCcd: quote.amount, recipient: quote.payTo, sponsor: sponsor.address,
    }, { 'PAYMENT-REQUIRED': required });

    // Concordium's account nonce prevents duplicate debits on-chain. Bound work in this process
    // and reject simultaneous retries before sending them to the facilitator.
    const fingerprint = digest(JSON.stringify(payment.payload)).toString('hex');
    if (inFlight.has(fingerprint)) return json(res, 409, { error: 'This payment is already being processed' });
    if (inFlight.size >= 4) return json(res, 429, { error: 'The demo is busy' });
    inFlight.add(fingerprint);
    let submitted = false;
    try {
      const verification = await services.facilitator.verify(payment, quote);
      if (!verification.isValid || !verification.payer) {
        return json(res, 402, { error: 'The facilitator rejected the payment' }, { 'PAYMENT-REQUIRED': required });
      }
      const payer = AccountAddress.fromBase58(verification.payer);
      if (AccountAddress.isAlias(payer, recipient) || AccountAddress.isAlias(payer, sponsor)) {
        return json(res, 402, { error: 'The demo requires a separate payer account' });
      }
      submitted = true;
      const receipt = await services.facilitator.settle(payment, quote);
      if (!receipt.success || receipt.network !== network || !/^[a-f0-9]{64}$/i.test(receipt.transaction) ||
          !await services.verifyFinalized(receipt, payer.address, quote)) {
        throw new Error('Settlement could not be verified');
      }
      if (!services.recordReceipt(receipt)) return json(res, 409, { error: 'This finalized payment was already redeemed' });
      const publicReceipt = { success: true, transaction: receipt.transaction, network, payer: payer.address };
      return json(res, 200, {
        message: 'Agent OS Mainnet test payment finalized',
        amountMicroCcd: quote.amount, transaction: receipt.transaction,
        explorer: 'https://ccdexplorer.io/mainnet/transaction/' + receipt.transaction,
      }, { 'PAYMENT-RESPONSE': encodePaymentResponseHeader(publicReceipt) });
    } catch {
      return json(res, 502, {
        error: submitted ? 'Settlement unconfirmed. Check the chain before creating another payment.' : 'Payment verification is unavailable.',
      });
    } finally {
      inFlight.delete(fingerprint);
    }
  };
}

export function loadTestMerchant(file: string | undefined) {
  if (!file) return;
  if (!isAbsolute(file)) throw new Error('Expected an absolute merchant configuration path');
  const config = JSON.parse(readFileSync(file, 'utf8')) as MerchantConfig & {
    facilitatorUrl: string; facilitatorToken?: string; receiptDirectory: string;
  };
  if (!isAbsolute(config.receiptDirectory)) throw new Error('Expected an absolute merchant receipt directory');
  const facilitator = new HTTPFacilitatorClient({
    url: httpsUrl(config.facilitatorUrl).href.replace(/\/$/, ''),
    timeoutMs: 90_000,
    createAuthHeaders: async () => {
      const auth: Record<string, string> = config.facilitatorToken ? { Authorization: 'Bearer ' + config.facilitatorToken } : {};
      return { supported: auth, verify: auth, settle: auth };
    },
  });
  const node = new ConcordiumGRPCNodeClient('grpc.mainnet.concordium.software', 20000, credentials.createSsl(), { timeout: 12_000 });
  mkdirSync(config.receiptDirectory, { recursive: true, mode: 0o700 });
  return createTestMerchant(config, {
    facilitator,
    async verifyFinalized(receipt, payer, quote) {
      const { summary } = await node.waitForTransactionFinalization(TransactionHash.fromHexString(receipt.transaction), 45_000);
      return !!summary && 'transactionType' in summary && summary.transactionType === 'transfer' && summary.sender.address === payer &&
        summary.transfer.to.address === quote.payTo && summary.transfer.amount.microCcdAmount === BigInt(quote.amount) &&
        !!summary.sponsor && summary.sponsor.sponsor.address === quote.extra.feePayer && summary.sponsor.cost.microCcdAmount > 0n;
    },
    recordReceipt(receipt) {
      try {
        const transaction = receipt.transaction.toLowerCase();
        writeFileSync(join(config.receiptDirectory, transaction + '.json'),
          JSON.stringify({ transaction, network, recordedAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
        throw error;
      }
    },
  });
}
