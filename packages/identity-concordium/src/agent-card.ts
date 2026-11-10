// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

/**
 * Agent Card authoring — draft, validate, canonicalize, and hash the public agent descriptor.
 *
 * The card is **public and hashable by design**: it carries no secrets, and its content hash is the
 * integrity anchor an owner would register on-chain (with their own wallet — see registration.ts).
 * Hashing uses node:crypto SHA-256 over a canonical (key-sorted) serialization, so two cards with
 * identical content hash identically regardless of field order. The Concordium JS SDK is only
 * needed for on-chain serialization/submission, which Phase 8 defers — hashing needs no SDK.
 */

import { createHash } from 'node:crypto';
import {
  AGENT_CARD_MEDIA_TYPE,
  type AgentCard,
  type AgentCardDraftInput,
  type AgentCardValidation,
  type AgentOwnerPolicy,
} from '@agent-os/protocol-core';

const OWNER_POLICIES: AgentOwnerPolicy[] = ['self', 'organization', 'delegated'];

/** Heuristics for things that must never appear in a (public) card. */
const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/, // OpenAI / Anthropic-style key
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /ghp_[A-Za-z0-9]{20,}/, // GitHub token
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, // PEM private key
  /\bseed\s*phrase\b/i, // wallet seed phrase
  /\b(?:[a-z]+\s+){11,23}[a-z]+\b.*\bmnemonic\b/i, // mnemonic-ish
];

/** Non-throwing secret check over the serialized card. */
export function cardHasInlineSecret(card: AgentCard): boolean {
  const haystack = JSON.stringify(card);
  return SECRET_PATTERNS.some((re) => re.test(haystack));
}

/** Defensive guard: throw if a card appears to embed a secret. Cards are public — they must not. */
export function assertNoSecretsInCard(card: AgentCard): void {
  if (cardHasInlineSecret(card)) {
    throw new Error('Agent Card appears to contain a secret (key/seed/token) — cards are public and must carry none.');
  }
}

/** Draft a well-formed Agent Card from minimal input, filling defaults + timestamps. */
export function draftAgentCard(input: AgentCardDraftInput): AgentCard {
  const now = new Date().toISOString();
  return {
    mediaType: AGENT_CARD_MEDIA_TYPE,
    name: input.name,
    description: input.description,
    runtime: input.runtime,
    capabilities: input.capabilities ?? [],
    ownerPolicy: input.ownerPolicy ?? 'self',
    supportedProtocols: input.supportedProtocols ?? ['agent-os-lobby'],
    allowedScopes: input.allowedScopes ?? [],
    contactUrl: input.contactUrl,
    version: input.version ?? '1.0.0',
    ref: input.ref,
    createdAt: now,
    updatedAt: now,
  };
}

/** Validate an Agent Card. Collects every problem rather than throwing on the first. */
export function validateAgentCard(card: AgentCard): AgentCardValidation {
  const errors: string[] = [];
  if (card.mediaType !== AGENT_CARD_MEDIA_TYPE) errors.push(`mediaType must be "${AGENT_CARD_MEDIA_TYPE}"`);
  if (!card.name?.trim()) errors.push('name is required');
  if (!card.description?.trim()) errors.push('description is required');
  if (!card.runtime?.trim()) errors.push('runtime is required');
  if (!card.version?.trim()) errors.push('version is required');
  if (!Array.isArray(card.capabilities)) errors.push('capabilities must be an array');
  if (!Array.isArray(card.supportedProtocols)) errors.push('supportedProtocols must be an array');
  if (!Array.isArray(card.allowedScopes)) errors.push('allowedScopes must be an array');
  if (!OWNER_POLICIES.includes(card.ownerPolicy)) errors.push(`ownerPolicy must be one of ${OWNER_POLICIES.join(' | ')}`);
  if (card.contactUrl !== undefined && !/^https?:\/\//.test(card.contactUrl)) errors.push('contactUrl must be an http(s) URL');
  if (!card.createdAt) errors.push('createdAt is required');
  if (!card.updatedAt) errors.push('updatedAt is required');
  if (cardHasInlineSecret(card)) errors.push('card must not contain a secret (key/seed/token)');
  return { ok: errors.length === 0, errors };
}

/** Recursively sort object keys so serialization is order-independent. Arrays keep their order. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/** Canonical (key-sorted) JSON of a card — the exact bytes that get hashed. */
export function canonicalizeAgentCard(card: AgentCard): string {
  return JSON.stringify(sortKeys(card));
}

/** Deterministic SHA-256 (hex) of the canonical card — the integrity anchor for registration. */
export function hashAgentCard(card: AgentCard): string {
  return createHash('sha256').update(canonicalizeAgentCard(card)).digest('hex');
}
