// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { AccountAddress } from '@concordium/web-sdk';
import { requestCommerceResource, type CommerceAuthorization, type CommercePolicy, type CommerceResult, type PaymentSubmission } from './request.js';

interface Reservation {
  id: string;
  scope: string;
  requestId: string;
  amount: string;
  createdAt: number;
  state: 'reserved' | 'settled' | 'released';
  transaction?: string;
  settledAt?: number;
  submission?: PaymentSubmission;
}

export type SpendingReceipt = Pick<Reservation, 'id' | 'requestId' | 'amount' | 'state' | 'createdAt' | 'settledAt' | 'transaction'>;

export function spendingScope(network: string, payer: string, asset: string): string {
  const account = AccountAddress.fromBase58(payer);
  // Concordium account aliases share the same first 29 bytes and budget.
  const wallet = Buffer.from(AccountAddress.toBuffer(account)).subarray(0, 29).toString('hex');
  return [network, wallet, asset].join('/');
}

/**
 * The directory must be accessible only to the signing service. Use one ledger
 * per deployment and keep it on a local filesystem with atomic create and rename.
 * If a crash leaves the lock, halt signing until an operator reconciles the ledger.
 */
export class SpendingLedger {
  constructor(private readonly path: string) {}

  receipts(scope: string, offset: number, limit: number): { data: SpendingReceipt[]; total: number; offset: number; limit: number } {
    if (!scope || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('Invalid receipt page');
    }
    const records: Reservation[] = existsSync(this.path) ? JSON.parse(readFileSync(this.path, 'utf8')) : [];
    const scoped = records.filter(row => row.scope === scope).reverse();
    return { data: scoped.slice(offset, offset + limit).map(({ id, requestId, amount, state, createdAt, settledAt, transaction }) =>
      ({ id, requestId, amount, state, createdAt, settledAt, transaction })), total: scoped.length, offset, limit };
  }

  reserve(scope: string, requestId: string, amount: bigint, dailyLimit: bigint): string {
    if (!scope || !/^[a-zA-Z0-9_-]{1,128}$/.test(requestId)) throw new Error('Invalid payment request identifier');
    if (amount <= 0n || dailyLimit < amount) throw new Error('Payment exceeds the approved daily limit');
    return this.update(records => {
      if (records.some(row => row.scope === scope && row.requestId === requestId)) {
        throw new Error('Payment request already has a reservation');
      }
      const now = Date.now();
      const today = Math.floor(now / 86_400_000) * 86_400_000;
      const used = records.filter(row => row.scope === scope &&
        (row.state === 'reserved' || row.state === 'settled' && (row.settledAt ?? 0) >= today))
        .reduce((total, row) => total + BigInt(row.amount), 0n);
      if (used + amount > dailyLimit) throw new Error('Payment exceeds the approved daily limit');
      const id = randomUUID();
      records.push({ id, scope, requestId, amount: amount.toString(), createdAt: now, state: 'reserved' });
      return id;
    });
  }

  recordSubmission(id: string, submission: PaymentSubmission): void {
    this.update(records => {
      const row = records.find(record => record.id === id);
      if (!row || row.state !== 'reserved' || row.submission) throw new Error('Reservation is not awaiting submission');
      row.submission = submission;
    });
  }

  confirm(id: string, transaction: string): void {
    if (!/^[a-f0-9]{64}$/i.test(transaction)) throw new Error('Invalid finalized transaction hash');
    const hash = transaction.toLowerCase();
    this.update(records => {
      const row = records.find(record => record.id === id);
      if (row?.state === 'settled' && row.transaction === hash) return;
      if (!row || row.state !== 'reserved' || !row.submission) throw new Error('Reservation is not awaiting settlement');
      if (records.some(record => record.transaction === hash)) throw new Error('Transaction was already assigned to a payment');
      row.state = 'settled';
      row.transaction = hash;
      row.settledAt = Date.now();
    });
  }

  releaseUnsigned(id: string): void {
    this.update(records => {
      const row = records.find(record => record.id === id);
      if (row?.state === 'released') return;
      if (!row || row.state !== 'reserved' || row.submission) throw new Error('Only an unsigned reservation can be released');
      row.state = 'released';
    });
  }

  private update<T>(mutate: (rows: Reservation[]) => T): T {
    const lock = this.path + '.lock';
    let fd: number;
    try {
      fd = openSync(lock, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error('Payment ledger is busy or needs reconciliation');
      }
      throw error;
    }
    const temp = this.path + '.' + randomUUID() + '.tmp';
    try {
      const records: Reservation[] = existsSync(this.path) ? JSON.parse(readFileSync(this.path, 'utf8')) : [];
      const result = mutate(records);
      const output = openSync(temp, 'wx', 0o600);
      try {
        writeFileSync(output, JSON.stringify(records));
        fsyncSync(output);
      } finally {
        closeSync(output);
      }
      renameSync(temp, this.path);
      return result;
    } finally {
      if (existsSync(temp)) unlinkSync(temp);
      closeSync(fd);
      unlinkSync(lock);
    }
  }
}

export interface BudgetedResult {
  result: CommerceResult;
  /** Persist this identifier with an uncertain payment for later reconciliation. */
  reservationId?: string;
}

export async function requestWithSpendingLimit(
  policy: CommercePolicy,
  authorization: CommerceAuthorization,
  ledger: SpendingLedger,
  requestId: string,
  dailyLimit: bigint,
  fetchResource: typeof fetch = fetch,
): Promise<BudgetedResult> {
  const scope = spendingScope(policy.network, policy.payer, policy.asset);
  let reservationId: string | undefined;
  let result: CommerceResult;
  try {
    result = await requestCommerceResource(policy, {
      presentProof: authorization.presentProof?.bind(authorization),
      verifySettlement: authorization.verifySettlement.bind(authorization),
      async recordSubmission(submission) {
        if (!reservationId) throw new Error('Missing payment reservation');
        await authorization.recordSubmission?.(submission);
        ledger.recordSubmission(reservationId, submission);
      },
      async authorize(quote) {
        reservationId = ledger.reserve(scope, requestId, BigInt(quote.amount), dailyLimit);
        return authorization.authorize(quote);
      },
    }, fetchResource);
  } catch (error) {
    // The transport returns an unconfirmed result for failures after sending a signature.
    // A thrown error therefore has not submitted a signed payment.
    if (reservationId) ledger.releaseUnsigned(reservationId);
    throw error;
  }
  if (reservationId && result.state === 'settled') ledger.confirm(reservationId, result.receipt.transaction);
  return { result, reservationId };
}
