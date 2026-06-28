// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * Parse / format the non-secret registry reference. A Concordium agent's canonical public
 * identifier is a W3C DID anchored on-chain — `did:ccd:<network>:<method-specific-id>`. This module
 * only handles the *string ↔ struct* shape; it never resolves anything (that is the verifier's job)
 * and never touches a key.
 */

import type { ConcordiumAgentRef, ConcordiumNetwork } from '@agent-os/protocol-core';

const NETWORKS: ConcordiumNetwork[] = ['mainnet', 'testnet', 'devnet'];

/**
 * Parse a reference string into a `ConcordiumAgentRef`, or return `null` when it is not a
 * recognizable Concordium DID. Accepts:
 *   did:ccd:mainnet:<id>   → { registry:'concordium', network:'mainnet', did, agentId:<id> }
 *   did:ccd:<id>           → network defaults to 'mainnet'
 */
export function parseConcordiumRef(input: string): ConcordiumAgentRef | null {
  const s = input.trim();
  if (!s.toLowerCase().startsWith('did:ccd:')) return null;
  const rest = s.slice('did:ccd:'.length);
  if (!rest) return null;
  const parts = rest.split(':');
  let network: ConcordiumNetwork = 'mainnet';
  let id = rest;
  if (parts.length >= 2 && (NETWORKS as string[]).includes(parts[0].toLowerCase())) {
    network = parts[0].toLowerCase() as ConcordiumNetwork;
    id = parts.slice(1).join(':');
  }
  if (!id) return null;
  return { registry: 'concordium', network, did: s, agentId: id };
}

/** Format a reference back to its canonical DID string (or its best available public id). */
export function formatRef(ref: ConcordiumAgentRef): string {
  return ref.did ?? `did:ccd:${ref.network}:${ref.agentId ?? ref.account ?? ''}`;
}

/** Coerce a string-or-ref into a ref, parsing DIDs. Returns `null` when unparseable. */
export function coerceRef(input: ConcordiumAgentRef | string): ConcordiumAgentRef | null {
  return typeof input === 'string' ? parseConcordiumRef(input) : input;
}
