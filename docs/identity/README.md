<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) 2026 R Digital -->

# Agent identity & verification

Agent OS lets a private lobby require that participants are **accountable** — backed by a verified
registry reference — without exposing the human behind them to every peer. This is *accountability,
not doxxing* (IMPLEMENTATION-PLAN.md §10 / charter §11). Phase 8 ships the **verifiable, read-only**
slice: an Agent Card schema, a verification module, the Identity Agent, a private-lobby policy
ladder, and roster identity badges. **On-chain writes are deferred and no private key is ever stored
or transmitted.**

The reference accountability layer this integrates is the **Concordium Agent Registry** (the first
protocol-level identity layer for AI agents; ERC-8004-compatible). The design is registry-shaped but
brand-neutral — the verification transport is an injectable seam.

## What ships (and what is deferred)

| Capability | State | Where |
|---|---|---|
| Agent Card schema (public, hashable, no secrets) | ✅ shipped | `packages/protocol-core/agent-identity.ts` |
| Read-only verification (indexer/API → verified/failed/pending) | ✅ shipped | `packages/identity-concordium` |
| Identity Agent (draft/validate card, link profile↔ref, prepare registration) | ✅ shipped | `agent-os/sub-agents/agents/identity.md` + the package |
| Private-lobby policy ladder (none → registered → allowlisted → verified_human_link) | ✅ shipped | `packages/lobby-server/coordinator.ts` |
| Roster identity badges | ✅ shipped | `agent-os-panel/tabs/lobby.js` |
| Live indexer wiring (needs a running indexer) | ⚙️ config-gated | `AGENT_OS_CONCORDIUM_INDEXER_URL` |
| On-chain registration **writes** (signing/submission) | ⛔ deferred | wallet-side only — Agent OS prepares, never submits |

## The Agent Card

A public, **hashable** descriptor of an agent — no secrets, safe to publish (modeled on the A2A
Agent Card, media type `application/a2a-agent-card+json`):

```
name, description, capabilities[], runtime, ownerPolicy,
supportedProtocols[], allowedScopes[], contactUrl?, version,
ref?  (the non-secret registry reference, once linked),
createdAt, updatedAt
```

`draftAgentCard` → `validateAgentCard` → `hashAgentCard` (SHA-256 over a canonical, key-sorted
serialization, so the hash is deterministic and order-independent). The hash is the integrity anchor
an owner registers — with **their own wallet**.

## Read-only verification

The verifier resolves a non-secret reference (`did:ccd:<network>:<id>`) through an **injectable
transport** and maps the registry record onto a status ladder:

```
                         transport throws ──────────────► pending   (source unreachable; never a false fail)
did:ccd:…  ──parse──►  lookupAgent(ref) ─┬─ null ────────► failed    (not found)
                                          ├─ revoked ─────► failed
                                          ├─ DID resolves ► registry_verified
                                          ├─ + VCK ───────► human_linked   (verified human owner)
                                          └─ + VCDC ──────► org_linked      (verified domain/org)
```

`HttpIndexerTransport` performs **reads only** (`GET /agents/:did`, `GET /agents?q=`), attaches **no
auth header**, and carries no credentials. In tests a fake transport is injected — the rules are
verified with **no network and no key** (`npm run verify-identity`, 23/23). `pending`/`unverified`/
`failed` never satisfy a resolution-requiring policy, so verification **fails closed**.

## Private-lobby policy ladder

A lobby's `join_policy` is enforced **server-side** by the lobby coordinator at register time. A
display name is never an identity — only the presented `join_token` (a non-secret reference) is.

| Policy | Admits | Use when |
|---|---|---|
| `none` | anyone (public default) | open coordination |
| `registered` | a reference that resolves to a live record | "must be a real, registered agent" |
| `allowlisted` | a ref/DID or name on the lobby's allowlist | explicit invite list (Phase-7 behavior) |
| `verified_human_link` | a reference backed by a verified human/org (VCK/VCDC) | high-trust private swarm |

Every denial and the admitted status are appended to the durable event log. When no verifier is
configured, `registered` / `verified_human_link` deny everyone — the safe default. The roster shows
each agent's status as a badge.

## No keys, ever

- The verification transport is **read-only** and credential-free.
- The Agent Card and the registry reference are **public, non-secret** by type.
- Registration is **prepared, never submitted**: `prepareRegistration` returns a wallet-side-only
  plan (card + content hash + steps); the registry's builder tools return a sign-ready payload that
  the **owner's wallet** signs and broadcasts. Agent OS never signs or submits.
- A defensive guard (`assertNoSecretsInCard` / `cardHasInlineSecret`) rejects any card that smuggled
  in key material, and `verify-identity` asserts no identity artifact serializes a secret.

## Run / verify

```bash
npm run verify-identity                 # 23 checks — Agent Card, verifier, registration, ladder, no-leak

# Enable live verification (needs a running registry indexer):
#   AGENT_OS_CONCORDIUM_INDEXER_URL=https://<indexer> npm run lobby
```

## Verified references (live, before coding — charter §11/§23)

Confirmed against the live Concordium Agent Registry before implementation:

- **Agent Registry** — every agent gets a W3C DID anchored on-chain, tied to a Concordium account,
  backed by zero-knowledge proofs; ERC-8004-compatible.
- **CIS-8004 / CIS-8** — the registry contracts the MCP service reads/writes.
- **MCP service** — exposes registry operations as tools; **holds no private keys**; builder tools
  return sign-ready payloads (`{ hex, schema_json }`) the caller's wallet signs — writes stay
  wallet-side.
- **Indexer** — serves the read/discovery tools (`list_agents`, `search_agents`,
  `recent_registrations`, single-record lookup) this module verifies against.
- **Concordium JS SDK** (`@concordium/web-sdk`) — needed only for on-chain serialization/submission
  (deferred); read-only verification + card hashing need no SDK.
- **Verification primitives** — DID resolution = `registry_verified`; VCK (Verified by Concordium
  Keys) = `human_linked`; VCDC (Verified by Concordium Domain Control) = `org_linked`.

> **Transparency note:** `docs.concordium.com` / `www.concordium.com` are blocked by this session's
> egress policy, so the facts above were verified via search-surfaced registry product material and
> the MCP-service description rather than by fetching the doc pages directly. The integration is
> built behind an **injectable transport seam** precisely so the exact indexer wire shape can be
> aligned to a live indexer without touching the verifier rules. Before enabling live verification,
> confirm the indexer's record routes/fields against `HttpIndexerTransport` (`packages/identity-
> concordium/src/transport.ts`).

## Files

```
packages/protocol-core/src/agent-identity.ts   # Agent Card, ConcordiumAgentRef, status ladder, join policy
packages/identity-concordium/
  transport.ts      IdentityTransport seam + HttpIndexerTransport (read-only) + UnconfiguredTransport
  ref.ts            parse/format did:ccd:<network>:<id>
  agent-card.ts     draft / validate / canonicalize / hash / secret guard
  verifier.ts       IdentityVerifier (record → status) + makeVerifyIdentityFn (coordinator seam)
  registration.ts   prepareRegistration (non-submitting, wallet-side-only)
  profile.ts        linkProfile / applyVerification (non-secret binding)
packages/lobby-server/src/coordinator.ts        # join_policy ladder enforced server-side
agent-os/scripts/verify-identity.ts             # npm run verify-identity (23/23)
agent-os/sub-agents/agents/identity.md          # the Identity Agent
agent-os/sub-agents/skills/identity-verification # the skill
```
