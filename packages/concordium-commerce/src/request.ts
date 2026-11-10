// SPDX-License-Identifier: Apache-2.0
import { AccountAddress } from '@concordium/web-sdk';
import { agent, HEADER, type CredentialResult, type DigitalCredentialRequest } from '@proof.com/x401-node';
import { CONCORDIUM_MAINNET_CAIP2, CONCORDIUM_TESTNET_CAIP2, type ClientConcordiumSigner, type ExactConcordiumPayloadV2 } from '@x402/concordium';
import { ExactConcordiumScheme } from '@x402/concordium/exact/client';
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import type { PaymentRequirements, SettleResponse } from '@x402/core/types';

type ConcordiumNetwork = typeof CONCORDIUM_MAINNET_CAIP2 | typeof CONCORDIUM_TESTNET_CAIP2;

export interface CommercePolicy {
  resource: string;
  network: ConcordiumNetwork;
  payer: string;
  recipient: string;
  sponsor: string;
  asset: string;
  maxAmount: bigint;
}

export interface PaymentSubmission {
  payer: string;
  recipient: string;
  sponsor: string;
  nonce: string;
  expiresAtSeconds: string;
}

export interface CommerceAuthorization {
  /** Reserve the amount durably and obtain owner approval before returning a signer. */
  authorize(quote: Readonly<PaymentRequirements>): Promise<ClientConcordiumSigner>;
  /** Confirm the on-chain receipt matches the authorized payment before marking it settled. */
  verifySettlement(receipt: SettleResponse, quote: Readonly<PaymentRequirements>, submission: Readonly<PaymentSubmission>): Promise<boolean>;
  /** Persist the nonce and expiry before sending the authorized payment to the resource. */
  recordSubmission?(submission: Readonly<PaymentSubmission>): void | Promise<void>;
  /** Present a credential only if the requested attributes and verifier are authorized. */
  presentProof?(request: DigitalCredentialRequest): Promise<CredentialResult>;
}

export type CommerceResult =
  | { state: 'unpaid'; response: Response }
  | { state: 'settled'; response: Response; receipt: SettleResponse }
  | { state: 'unconfirmed'; response?: Response; receipt?: SettleResponse };

function validatePolicy(policy: CommercePolicy): URL {
  const resource = new URL(policy.resource);
  if (resource.protocol !== 'https:' || resource.username || resource.password || resource.hash) {
    throw new Error('A specific HTTPS resource is required');
  }
  if (![CONCORDIUM_MAINNET_CAIP2, CONCORDIUM_TESTNET_CAIP2].includes(policy.network) ||
      !/^[A-Z][A-Z0-9]{0,31}$/.test(policy.asset) || policy.maxAmount <= 0n) {
    throw new Error('Invalid Concordium payment policy');
  }
  AccountAddress.fromBase58(policy.payer);
  AccountAddress.fromBase58(policy.recipient);
  AccountAddress.fromBase58(policy.sponsor);
  return resource;
}

function readHeader(response: Response, name: string): string | null {
  const value = response.headers.get(name);
  if (value && value.length > 16_384) throw new Error('Commerce header exceeds the size limit');
  return value;
}

function selectQuote(response: Response, resource: URL, policy: CommercePolicy) {
  const header = readHeader(response, 'PAYMENT-REQUIRED');
  if (!header) throw new Error('Missing x402 v2 payment requirements');
  const challenge = decodePaymentRequiredHeader(header);
  if (challenge.x402Version !== 2 || challenge.resource?.url !== resource.href || !Array.isArray(challenge.accepts)) {
    throw new Error('Payment challenge does not match this request');
  }
  const matches = challenge.accepts.filter(quote => quote?.scheme === 'exact' &&
    quote.network === policy.network && quote.payTo === policy.recipient && quote.asset === policy.asset &&
    quote.extra?.feePayer === policy.sponsor &&
    typeof quote.amount === 'string' && /^[1-9][0-9]{0,19}$/.test(quote.amount) &&
    BigInt(quote.amount) <= policy.maxAmount &&
    Number.isInteger(quote.maxTimeoutSeconds) && quote.maxTimeoutSeconds >= 10 && quote.maxTimeoutSeconds <= 120);
  if (matches.length !== 1) throw new Error('No unique quote matches the approved payment policy');
  const quote = matches[0];
  // Carry only the fields validated by this client. The current Concordium scheme only needs feePayer.
  const accepted: PaymentRequirements = {
    scheme: 'exact', network: quote.network, payTo: quote.payTo, asset: quote.asset,
    amount: quote.amount, maxTimeoutSeconds: quote.maxTimeoutSeconds,
    extra: { feePayer: policy.sponsor },
  };
  return { resource: challenge.resource, accepted };
}

/**
 * Fetch an owner-configured resource. Use one proof retry, then at most one payment attempt.
 * A missing or unverified receipt is uncertain. Keep its reservation until reconciled.
 */
export async function requestCommerceResource(
  policy: CommercePolicy,
  authorization: CommerceAuthorization,
  fetchResource: typeof fetch = fetch,
): Promise<CommerceResult> {
  const resource = validatePolicy(policy);
  const request = (headers: Headers, timeout = 15_000) => fetchResource(resource, {
    method: 'GET', headers, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(timeout),
  });
  const headers = new Headers();
  let response = await request(headers);
  if (readHeader(response, HEADER.PROOF_REQUEST)) {
    const requirement = agent.detectProofRequirement({ headers: response.headers });
    if (!requirement || requirement.payload.version !== '0.2.0' || !authorization.presentProof) {
      throw new Error('This resource requires a supported x401 credential presentation');
    }
    await response.body?.cancel();
    const credentialResult = await authorization.presentProof(agent.getDigitalCredentialRequest(requirement.payload));
    const proof = agent.encodeResultArtifact(agent.buildResultArtifact({ credentialResult }));
    if (proof.length > 16_384) throw new Error('Credential presentation exceeds the header size limit');
    headers.set(HEADER.PROOF_RESPONSE, proof);
    response = await request(headers);
    if (response.status === 401 || readHeader(response, HEADER.PROOF_REQUEST)) {
      await response.body?.cancel();
      throw new Error('The resource did not accept the x401 credential presentation');
    }
  }
  if (response.status !== 402) return { state: 'unpaid', response };

  let quote;
  try {
    quote = selectQuote(response, resource, policy);
  } finally {
    await response.body?.cancel();
  }
  const accepted = Object.freeze({ ...quote.accepted, extra: Object.freeze(quote.accepted.extra) });
  const signer = await authorization.authorize(accepted);
  if (signer.accountAddress.address !== policy.payer) throw new Error('Signer does not match the approved agent wallet');
  const signed = await new ExactConcordiumScheme(signer).createPaymentPayload(2, accepted);
  headers.set('PAYMENT-SIGNATURE', encodePaymentSignatureHeader({ ...signed, resource: quote.resource, accepted }));
  const transaction = (signed.payload as unknown as ExactConcordiumPayloadV2).signedTransaction;
  const submission = Object.freeze({
    payer: policy.payer, recipient: policy.recipient, sponsor: policy.sponsor,
    nonce: String(transaction.header.nonce), expiresAtSeconds: String(transaction.header.expiry),
  });
  if (!/^\d+$/.test(submission.nonce) || !/^\d+$/.test(submission.expiresAtSeconds)) {
    throw new Error('The signed payment is missing its nonce or expiry');
  }
  await authorization.recordSubmission?.(submission);

  try {
    response = await request(headers, 240_000);
  } catch {
    return { state: 'unconfirmed' };
  }
  try {
    const header = readHeader(response, 'PAYMENT-RESPONSE');
    const receipt = header ? decodePaymentResponseHeader(header) : undefined;
    if (receipt?.success && receipt.network === policy.network && /^[a-f0-9]{64}$/i.test(receipt.transaction) &&
        await authorization.verifySettlement(receipt, accepted, submission)) {
      return { state: 'settled', response, receipt };
    }
    return { state: 'unconfirmed', response, receipt };
  } catch {
    return { state: 'unconfirmed', response };
  }
}
