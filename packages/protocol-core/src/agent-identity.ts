// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * Agent identity — the shared, **non-secret** types for accountable agents.
 *
 * Agent OS treats agent identity as an *accountability anchor*, not a login: a private lobby can
 * require that participants are backed by a verified registry reference without exposing the human
 * behind them to every peer (accountability, not doxxing — IMPLEMENTATION-PLAN.md §10 / charter §11).
 *
 * Verified against the live Concordium Agent Registry (the reference accountability layer this
 * platform integrates, CIS-8004 / CIS-8; ERC-8004-compatible):
 *   • every registered agent carries a W3C DID anchored on-chain and tied to a Concordium account;
 *   • read-only discovery/resolution is served by the registry **indexer** (tools `list_agents`,
 *     `search_agents`, `recent_registrations`, plus single-record lookup);
 *   • ownership is provable via VCK (Verified by Concordium Keys — "who owns this agent"), and an
 *     operating business via VCDC (Verified by Concordium Domain Control — "what entity is behind it").
 * Those three primitives map directly onto the verification ladder + status below.
 *
 * **Hard rule:** nothing in this module ever holds a private key, wallet seed, or signed
 * transaction. References are non-secret pointers; cards are public, hashable descriptors;
 * on-chain *writes* are wallet-side and deferred. See `@agent-os/identity-concordium`.
 */

// ── Registry reference (the non-secret pointer) ──

/** Identity registry an agent reference points at. Concordium is the first integration. */
export type IdentityRegistry = 'concordium' | (string & {});

/** Concordium network an on-chain reference resolves against. */
export type ConcordiumNetwork = 'mainnet' | 'testnet' | 'devnet';

/**
 * A non-secret pointer to a registry record. This is the only identity datum that is allowed to
 * cross a process / lobby boundary. It carries no key material — just where the public record lives.
 */
export interface ConcordiumAgentRef {
  registry: IdentityRegistry;
  /** Network the record is anchored on. */
  network: ConcordiumNetwork;
  /** W3C DID for the agent (e.g. `did:ccd:mainnet:...`). The canonical public identifier. */
  did?: string;
  /** Owning Concordium account address (public). */
  account?: string;
  /** Registry contract coordinates, when the record is addressed by contract index/subindex. */
  contract?: { index: number; subindex: number };
  /** Registry-local agent id / token id within the contract (public). */
  agentId?: string;
}

// ── Agent Card (the public, hashable descriptor) ──

/** IANA media type for an A2A Agent Card (Concordium-discoverable manifest entry). */
export const AGENT_CARD_MEDIA_TYPE = 'application/a2a-agent-card+json' as const;

/** Who is accountable for the agent — the owner policy declared on its card (non-secret). */
export type AgentOwnerPolicy =
  | 'self' // the registrant operates it directly
  | 'organization' // operated under an org / domain (VCDC territory)
  | 'delegated'; // operated on behalf of another verified owner

/**
 * Agent Card — the public, signable-by-its-owner-elsewhere descriptor of an agent. Contains **no
 * secrets**; every field is safe to publish and to hash. Modeled to be registry-portable
 * (A2A Agent Card-shaped) while staying brand-neutral.
 */
export interface AgentCard {
  /** Card schema/media type — always AGENT_CARD_MEDIA_TYPE. */
  mediaType: typeof AGENT_CARD_MEDIA_TYPE;
  /** Human-readable agent name. */
  name: string;
  /** What the agent does. */
  description: string;
  /** Declared capabilities (free-form skill/tool tags, e.g. "code-review", "frontend"). */
  capabilities: string[];
  /** Runtime the agent runs on (e.g. "claude-cli", "codex-cli", "openai-compatible"). */
  runtime: string;
  /** Owner accountability policy. */
  ownerPolicy: AgentOwnerPolicy;
  /** Protocols the agent speaks (e.g. "agent-os-lobby", "mcp", "a2a"). */
  supportedProtocols: string[];
  /** Scopes the agent is permitted to operate within (least-privilege, declarative). */
  allowedScopes: string[];
  /** Optional public contact URL (docs / homepage). Never an auth endpoint with a secret. */
  contactUrl?: string;
  /** Semantic version of this card. */
  version: string;
  /** The non-secret registry reference this card binds to, once linked. */
  ref?: ConcordiumAgentRef;
  /** ISO timestamp the card was created. */
  createdAt: string;
  /** ISO timestamp the card was last updated. */
  updatedAt: string;
}

/** Minimal input needed to draft a card; the drafter fills defaults + timestamps. */
export interface AgentCardDraftInput {
  name: string;
  description: string;
  runtime: string;
  capabilities?: string[];
  ownerPolicy?: AgentOwnerPolicy;
  supportedProtocols?: string[];
  allowedScopes?: string[];
  contactUrl?: string;
  version?: string;
  ref?: ConcordiumAgentRef;
}

/** Result of validating an Agent Card. */
export interface AgentCardValidation {
  ok: boolean;
  errors: string[];
}

// ── Verification (read-only resolution of a reference) ──

/**
 * Verification status of an agent reference — increasing accountability, left to right:
 *   unverified       no reference presented / not yet checked
 *   pending          a check is in flight or the indexer is unreachable (indeterminate, never an error)
 *   registry_verified the DID resolves to a live, non-revoked registry record (≈ "any registered")
 *   human_linked     ownership is provable to a verified human account (Concordium VCK)
 *   org_linked       an operating organization/domain is proven (Concordium VCDC)
 *   failed           the reference does not resolve, is revoked, or is malformed
 */
export type IdentityVerificationStatus =
  | 'unverified'
  | 'pending'
  | 'registry_verified'
  | 'human_linked'
  | 'org_linked'
  | 'failed';

/** All statuses, weakest → strongest, for ladder comparisons. */
export const IDENTITY_STATUS_ORDER: IdentityVerificationStatus[] = [
  'failed',
  'unverified',
  'pending',
  'registry_verified',
  'human_linked',
  'org_linked',
];

/** Numeric rank of a status (higher = more accountable). `failed` ranks lowest. */
export function identityStatusRank(status: IdentityVerificationStatus): number {
  const i = IDENTITY_STATUS_ORDER.indexOf(status);
  return i < 0 ? 0 : i;
}

/** True when a status means the reference resolved to a live registry record. */
export function isRegistryResolved(status: IdentityVerificationStatus): boolean {
  return status === 'registry_verified' || status === 'human_linked' || status === 'org_linked';
}

/** Where a verification result came from (for transparency in the UI / event log). */
export type VerificationSource = 'indexer' | 'api' | 'cache' | 'none';

/** The outcome of resolving a reference read-only. Carries only non-secret, public facts. */
export interface IdentityVerificationResult {
  status: IdentityVerificationStatus;
  registryLinks?: { registration: string; explorer: string };
  /** The reference that was checked (echoed back, non-secret). */
  ref?: ConcordiumAgentRef;
  /** True when a verified human owner stands behind the agent (Concordium VCK). */
  humanLinked?: boolean;
  /** True when an operating organization/domain is proven (Concordium VCDC). */
  orgLinked?: boolean;
  /** The verified domain, when org-linked. */
  domain?: string;
  /** Human-readable reason (esp. for `failed` / `pending`). */
  reason?: string;
  /** What produced this result. */
  source: VerificationSource;
  /** ISO timestamp of the check. */
  checkedAt: string;
  /** Issuer DID of the agent credential, if any. */
  issuerDid?: string;
}

/**
 * The read-only view of a registry record as returned by the indexer. Public fields only — this is
 * what `list_agents` / `search_agents` / a single-record lookup expose. No keys, ever.
 */
export interface RegistryAgentRecord {
  did: string;
  /** Owning account address (public). */
  account?: string;
  /** Display name on the record. */
  name?: string;
  capabilities?: string[];
  /** True when ownership is bound to a verified human account (VCK). */
  humanLinked?: boolean;
  /** The verified domain (VCDC). */
  domain?: string;
  revoked?: boolean;
  registeredAt?: string;
  /** Issuer DID of the agent credential. */
  issuerDid?: string;
}

// ── Local profile ↔ registry binding (non-secret) ──

/**
 * The local binding between an agent profile and its registry reference. Stored locally; safe to
 * serialize (no secrets). `lastVerification` caches the most recent read-only check.
 */
export interface AgentIdentity {
  /** Local agent/profile id this binding belongs to. */
  localAgentId: string;
  /** Display name shown in the roster. */
  displayName: string;
  /** The non-secret registry reference, once linked. */
  ref?: ConcordiumAgentRef;
  /** The drafted/published Agent Card, if any. */
  card?: AgentCard;
  /** The most recent verification outcome. */
  lastVerification?: IdentityVerificationResult;
}

/**
 * A non-submitting registration plan: everything the owner needs to register the card with their
 * own wallet, **without** Agent OS ever signing or submitting. The signing/submission step is
 * explicitly left to the wallet (deferred on-chain writes).
 */
export interface RegistrationPlan {
  /** The card to be registered (public). */
  card: AgentCard;
  /** Media type of the card payload. */
  mediaType: typeof AGENT_CARD_MEDIA_TYPE;
  /** Deterministic content hash of the canonical card (integrity anchor). */
  cardHash: string;
  /** The target registry. */
  registry: IdentityRegistry;
  network: ConcordiumNetwork;
  /** Ordered, human-readable steps the owner performs in their wallet / the registry MCP service. */
  steps: string[];
  /** Always true — Agent OS prepares but never submits. */
  walletSideOnly: true;
  /** Explicit safety note surfaced to the user. */
  notice: string;
}

// ── Lobby join policy ladder (private-lobby access control) ──

/**
 * The private-lobby access ladder, weakest → strongest (IMPLEMENTATION-PLAN.md §10):
 *   none                 open — anyone may join (public default)
 *   registered           must present a reference that resolves to a live registry record
 *   allowlisted          must be on the lobby's explicit allowlist (by ref/DID or display name)
 *   verified_human_link  must be backed by a verified human owner (Concordium VCK or stronger)
 */
export type LobbyJoinPolicy = 'none' | 'registered' | 'allowlisted' | 'verified_human_link';

/** All policies, weakest → strongest. */
export const LOBBY_JOIN_POLICIES: LobbyJoinPolicy[] = [
  'none',
  'registered',
  'allowlisted',
  'verified_human_link',
];
