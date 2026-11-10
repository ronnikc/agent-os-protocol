// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

/**
 * IdentityVerifier — resolves a non-secret reference to a verification status, **read-only**.
 *
 * It never signs, submits, or holds a key; it asks the injected transport for the public registry
 * record and maps it onto the status ladder:
 *
 *   malformed ref         → failed   (cannot be a reference)
 *   transport throws      → pending  (source unreachable — indeterminate, NOT a false failure)
 *   record not found      → failed   (no such agent)
 *   record revoked        → failed   (explicitly revoked on-chain)
 *   record + domain (VCDC) → org_linked
 *   record + human (VCK)   → human_linked
 *   record (DID resolves)  → registry_verified
 *
 * `pending`/`unverified`/`failed` never satisfy a resolution-requiring policy — callers fail closed.
 */

import type {
  ConcordiumAgentRef,
  IdentityVerificationResult,
  VerificationSource,
} from '@agent-os/protocol-core';
import type { IdentityTransport } from './transport.js';
import { coerceRef } from './ref.js';

export interface IdentityVerifierOptions {
  transport: IdentityTransport;
  /** Labels the result's `source` (defaults to 'indexer'). */
  source?: VerificationSource;
}

export class IdentityVerifier {
  private readonly transport: IdentityTransport;
  private readonly source: VerificationSource;

  constructor(options: IdentityVerifierOptions) {
    this.transport = options.transport;
    this.source = options.source ?? 'indexer';
  }

  /** Resolve a reference (DID string or struct) to a verification result. Never throws. */
  async verify(input: ConcordiumAgentRef | string): Promise<IdentityVerificationResult> {
    const checkedAt = new Date().toISOString();
    const ref = coerceRef(input);
    if (!ref) {
      return { status: 'failed', reason: 'malformed reference (expected a did:ccd: DID)', source: this.source, checkedAt };
    }
    try {
      const record = await this.transport.lookupAgent(ref);
      if (!record) {
        return { status: 'failed', ref, reason: 'reference not found in registry', source: this.source, checkedAt };
      }
      if (record.revoked) {
        return { status: 'failed', ref, reason: 'registry record is revoked', source: this.source, checkedAt };
      }
      const orgLinked = Boolean(record.domain);
      const humanLinked = Boolean(record.humanLinked) || orgLinked; // a verified org implies a verified entity
      const status = orgLinked ? 'org_linked' : humanLinked ? 'human_linked' : 'registry_verified';
      return {
        status,
        ref: record.account ? { ...ref, account: record.account } : ref,
        humanLinked,
        orgLinked,
        domain: record.domain,
        source: this.source,
        checkedAt,
        issuerDid: record.issuerDid,
      };
    } catch (err) {
      // Source unreachable: indeterminate, not a false negative.
      return {
        status: 'pending',
        ref,
        reason: `registry unavailable: ${(err as Error).message}`,
        source: this.source,
        checkedAt,
      };
    }
  }
}

/** A bound `(ref) => result` function — the exact shape the lobby coordinator's seam expects. */
export type VerifyIdentityFn = (ref: string) => Promise<IdentityVerificationResult>;

/** Adapt an IdentityVerifier to the coordinator's `verifyIdentity` seam. */
export function makeVerifyIdentityFn(verifier: IdentityVerifier): VerifyIdentityFn {
  return (ref: string) => verifier.verify(ref);
}
