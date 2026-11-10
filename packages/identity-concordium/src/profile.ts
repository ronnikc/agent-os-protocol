// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

/**
 * Local profile ↔ registry-reference binding. An `AgentIdentity` ties a local agent profile to its
 * non-secret registry reference (and optional card + last verification). It is safe to serialize and
 * store locally; it never contains a key. These helpers are pure (no I/O).
 */

import type {
  AgentCard,
  AgentIdentity,
  ConcordiumAgentRef,
  IdentityVerificationResult,
} from '@agent-os/protocol-core';
import { cardHasInlineSecret } from './agent-card.js';

/** Bind a local profile to a registry reference (and optionally a card). */
export function linkProfile(
  localAgentId: string,
  displayName: string,
  ref?: ConcordiumAgentRef,
  card?: AgentCard,
): AgentIdentity {
  const identity: AgentIdentity = { localAgentId, displayName, ref, card };
  assertIdentityNonSecret(identity);
  return identity;
}

/** Return a copy of the identity with the latest verification result attached. */
export function applyVerification(identity: AgentIdentity, result: IdentityVerificationResult): AgentIdentity {
  return { ...identity, lastVerification: result };
}

/**
 * Defensive guard: an identity binding is non-secret by construction; this catches a card that
 * smuggled in a secret before the binding is persisted or shown.
 */
export function assertIdentityNonSecret(identity: AgentIdentity): void {
  if (identity.card && cardHasInlineSecret(identity.card)) {
    throw new Error('agent identity carries a card with an inline secret — refusing to bind.');
  }
}
