// SPDX-License-Identifier: Apache-2.0

export type EscrowState = 'funding_requested' | 'lock_pending' | 'funded' | 'release_pending' | 'released' | 'return_pending' | 'returned' | 'uncertain';
export type EscrowOperation = 'lock' | 'release' | 'return';

export interface EscrowTerms {
  agreementId: string;
  version: number;
  digest: string;
  network: 'testnet';
  asset: string;
  amount: string;
  payer: string;
  beneficiary: string;
  releaseAuthority: string;
  returnAuthority: string;
  expiresAt: number;
  signerGeneration: number;
}

export interface EscrowSnapshot {
  terms: EscrowTerms;
  state: EscrowState;
  lockRef?: string;
  approvedSubmission?: string;
  disputed: boolean;
  active?: { id: string; operation: EscrowOperation; submission?: string };
  events: Record<string, string>;
}

export type EscrowEvent =
  | { id: string; type: 'request'; operation: EscrowOperation; actor: string; signerGeneration: number; at: number; submission?: string; lockRef?: string; reason?: 'cancelled' | 'rejected' | 'expired' }
  | { id: string; type: 'observe'; requestId: string; outcome: 'confirmed' | 'uncertain' | 'absent'; lockRef?: string }
  | { id: string; type: 'accept_delivery'; actor: string; submission: string; at: number }
  | { id: string; type: 'dispute'; actor: string }
  | { id: string; type: 'resolve'; actor: string }
  | { id: string; type: 'rotate'; actor: string; signerGeneration: number };

export function createEscrowSimulation(terms: EscrowTerms): EscrowSnapshot {
  if (terms.network !== 'testnet' || !terms.agreementId || !terms.asset || !terms.payer || !terms.beneficiary ||
      !terms.releaseAuthority || !terms.returnAuthority || terms.payer === terms.beneficiary ||
      !/^[1-9][0-9]{0,38}$/.test(terms.amount) || !/^[0-9a-f]{64}$/.test(terms.digest) ||
      !Number.isSafeInteger(terms.expiresAt) || terms.expiresAt <= 0 ||
      !Number.isSafeInteger(terms.signerGeneration) || terms.signerGeneration < 0 ||
      !Number.isSafeInteger(terms.version) || terms.version < 1) throw new Error('Invalid simulated escrow terms');
  return { terms: structuredClone(terms), state: 'funding_requested', disputed: false, events: {} };
}

/** Pure simulator. The caller persists the snapshot with an atomic version check. */
export function applyEscrowEvent(previous: EscrowSnapshot, event: EscrowEvent, reviewer: string): EscrowSnapshot {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(event.id)) throw new Error('Invalid event ID');
  const encoded = JSON.stringify(event);
  if (Object.hasOwn(previous.events, event.id)) {
    if (previous.events[event.id] !== encoded) throw new Error('Event ID already describes different terms');
    return previous;
  }
  const next = structuredClone(previous);
  const { terms } = next;
  if (event.type === 'request') {
    if (next.active || next.disputed || !Number.isSafeInteger(event.at) || event.at < 0 || event.signerGeneration !== terms.signerGeneration) {
      throw new Error('Settlement is held or has an unresolved operation');
    }
    if (event.operation === 'lock') {
      if (next.state !== 'funding_requested' || event.actor !== terms.payer || event.at >= terms.expiresAt) throw new Error('Lock approval invalid');
      next.state = 'lock_pending';
    } else {
      if (next.state !== 'funded' || !next.lockRef || event.lockRef !== next.lockRef) throw new Error('Finalized lock required');
      if (event.operation === 'release') {
        if (!event.submission || event.submission !== next.approvedSubmission || event.actor !== terms.releaseAuthority ||
            event.at >= terms.expiresAt) throw new Error('Release approval invalid');
        next.state = 'release_pending';
      } else {
        if (event.actor !== terms.returnAuthority || !event.reason ||
            (event.reason === 'expired' ? event.at < terms.expiresAt : Boolean(next.approvedSubmission))) throw new Error('Return approval invalid');
        next.state = 'return_pending';
      }
    }
    next.active = { id: event.id, operation: event.operation, submission: event.submission };
  } else if (event.type === 'observe') {
    const active = next.active;
    if (!active || active.id !== event.requestId) throw new Error('Observation does not identify a pending operation');
    if (event.outcome === 'uncertain') next.state = 'uncertain';
    else {
      if (event.outcome === 'absent') next.state = active.operation === 'lock' ? 'funding_requested' : 'funded';
      else if (active.operation === 'lock') {
        if (!event.lockRef?.trim()) throw new Error('Confirmed lock reference required');
        next.lockRef = event.lockRef;
        next.state = 'funded';
      } else {
        if (event.lockRef !== next.lockRef) throw new Error('Observation must identify the finalized lock');
        next.state = active.operation === 'release' ? 'released' : 'returned';
      }
      delete next.active;
    }
  } else if (event.type === 'accept_delivery') {
    if (event.actor !== terms.payer || !event.submission.trim() || next.state !== 'funded' || next.disputed ||
        next.approvedSubmission || !Number.isSafeInteger(event.at) || event.at >= terms.expiresAt) throw new Error('Delivery approval invalid');
    next.approvedSubmission = event.submission;
  } else if (event.type === 'dispute') {
    if (![terms.payer, terms.beneficiary].includes(event.actor) || next.active || next.state !== 'funded' || next.disputed) {
      throw new Error('Dispute cannot change settlement at this stage');
    }
    next.disputed = true;
  } else if (event.type === 'resolve') {
    if (!next.disputed || event.actor !== reviewer || [terms.payer, terms.beneficiary].includes(reviewer)) {
      throw new Error('Independent review required');
    }
    next.disputed = false;
  } else {
    if (event.actor !== terms.payer || !Number.isSafeInteger(event.signerGeneration) || event.signerGeneration <= terms.signerGeneration) {
      throw new Error('Invalid signer generation');
    }
    terms.signerGeneration = event.signerGeneration;
  }
  Object.defineProperty(next.events, event.id, { value: encoded, enumerable: true, writable: true, configurable: true });
  return next;
}
