// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { applyEscrowEvent, createEscrowSimulation, type EscrowEvent, type EscrowSnapshot } from '../../packages/concordium-commerce/src/escrow-simulator.js';

export function verifyEscrowSimulator() {
  const terms = { agreementId: 'fixture-agreement', version: 2, digest: 'a'.repeat(64), network: 'testnet' as const,
    asset: 'SIM-PLT', amount: '120', payer: 'buyer', beneficiary: 'seller', releaseAuthority: 'buyer',
    returnAuthority: 'buyer', expiresAt: 1000, signerGeneration: 1 };
  const apply = (state: EscrowSnapshot, event: EscrowEvent) => applyEscrowEvent(state, event, 'reviewer');
  const initial = createEscrowSimulation(terms);
  assert.throws(() => createEscrowSimulation({ ...terms, amount: '0' }), /Invalid/);
  const lock = { id: 'lock-1', type: 'request', operation: 'lock', actor: 'buyer', signerGeneration: 1, at: 10 } as const;
  const pending = apply(initial, lock);
  assert.equal(pending.state, 'lock_pending');
  assert.equal(apply(pending, lock), pending);
  assert.throws(() => apply(pending, { ...lock, at: 11 }), /different terms/);
  const uncertain = apply(pending, { id: 'observe-1', type: 'observe', requestId: lock.id, outcome: 'uncertain' });
  const restarted = JSON.parse(JSON.stringify(uncertain)) as EscrowSnapshot;
  assert.equal(restarted.state, 'uncertain');
  assert.equal(restarted.active?.id, lock.id);
  assert.throws(() => apply(restarted, { ...lock, id: 'duplicate-lock' }), /unresolved/);
  const rotated = apply(restarted, { id: 'rotate', type: 'rotate', actor: 'buyer', signerGeneration: 2 });
  const absent = apply(rotated, { id: 'absent', type: 'observe', requestId: lock.id, outcome: 'absent' });
  assert.throws(() => apply(absent, { ...lock, id: 'old-signer' }), /held/);
  const retry = apply(absent, { ...lock, id: 'lock-2', signerGeneration: 2 });
  const funded = apply(retry, { id: 'funded', type: 'observe', requestId: 'lock-2', outcome: 'confirmed', lockRef: 'sim-lock' });
  const held = apply(funded, { id: 'hold', type: 'dispute', actor: 'seller' });
  assert.throws(() => apply(held, { id: 'early-resolution', type: 'resolve', actor: 'buyer' }), /Independent/);
  const accepted = apply(apply(held, { id: 'resolved', type: 'resolve', actor: 'reviewer' }),
    { id: 'delivery', type: 'accept_delivery', actor: 'buyer', submission: 'submission-v1', at: 80 });
  const release = { id: 'release', type: 'request', operation: 'release', actor: 'buyer', lockRef: 'sim-lock',
    submission: 'submission-v1', signerGeneration: 2, at: 90 } as const;
  const expiry = { id: 'expiry', type: 'request', operation: 'return', actor: 'buyer', lockRef: 'sim-lock',
    signerGeneration: 2, at: 1000, reason: 'expired' } as const;
  const releasePending = apply(accepted, release);
  assert.throws(() => apply(releasePending, expiry), /unresolved/);
  const returnPending = apply(accepted, expiry);
  assert.throws(() => apply(returnPending, release), /unresolved/);
  assert.equal(apply(releasePending, { id: 'released', type: 'observe', requestId: release.id, outcome: 'confirmed',
    lockRef: 'sim-lock' }).state, 'released');
  assert.equal(apply(returnPending, { id: 'returned', type: 'observe', requestId: expiry.id, outcome: 'confirmed',
    lockRef: 'sim-lock' }).state, 'returned');
  assert.throws(() => apply(funded, { ...expiry, at: 500 }), /Return approval/);
  assert.equal(apply(funded, { ...expiry, id: 'cancelled', reason: 'cancelled', at: 500 }).state, 'return_pending');
}
