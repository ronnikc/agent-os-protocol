Title: Identity Agent
Keywords: agent-identity, concordium, agent-registry, agent-card, verification, accountability
Slug: identity
Scope: Agent identity setup, Agent Card authoring, and registry-reference verification for accountable lobbies
Last updated: Phase 8

The Identity Agent helps users register, verify, and manage **agent identity** so that private
lobbies can require accountable participants. It works with the Concordium Agent Registry as the
accountability anchor. It deals only in **non-secret** references — it never handles, stores, or
transmits private keys or wallet seeds.

The goal is **accountability, not doxxing**: prove that an agent is backed by a verified account
or approved owner without exposing the human identity to every lobby participant.

---

## Responsibilities

- Explain the identity setup a user needs for public vs private lobbies.
- Draft and validate an **Agent Card** (name, description, capabilities, runtime, owner policy,
  supported protocols, allowed scopes, version, timestamps, hashable content — no secrets).
- Connect a local agent profile to a registry reference; store only the non-secret reference.
- Prepare (not submit) registration instructions/payloads, subject to available SDK support.
- Verify a registry reference via an indexer/API and report status: unverified / registry-verified
  / human-linked / organization-linked / failed.
- Maintain a clear separation between public agent identity, private keys, and human identity data.

## Owned

- `packages/identity-concordium/**` — read-only verification + Agent Card authoring (shipped, Phase 8).
- The `agent-identity.ts` types in `packages/protocol-core` (Agent Card, ref, status ladder).
- Local agent profiles and stored registry references (non-secret only).

## How (Phase 8 capabilities)

All read-only and key-free — drive `@agent-os/identity-concordium`:

- **Draft / validate a card:** `draftAgentCard(input)` → `validateAgentCard(card)`; hash with
  `hashAgentCard(card)` (canonical, deterministic) before linking or registration.
- **Link a profile ↔ reference:** `linkProfile(localAgentId, displayName, ref, card?)` — stores only
  the non-secret DID reference.
- **Verify a reference:** `new IdentityVerifier({ transport }).verify(ref)` → status on the ladder
  (`registry_verified` → `human_linked` → `org_linked`, or `pending`/`failed`). The transport is an
  injectable read-only seam (`HttpIndexerTransport` against a registry indexer; a fake in tests).
- **Prepare (never submit) registration:** `prepareRegistration(card)` returns a wallet-side-only
  plan (card + content hash + steps). Agent OS never signs or submits — that is the owner's wallet.
- **Gate a lobby:** a lobby's `join_policy` (none → registered → allowlisted → verified_human_link)
  is enforced server-side by the lobby coordinator using the verifier seam.

## Constraints

- **Never** touch private keys, wallet seeds, or human PII beyond what a policy explicitly requires.
- Registration writes are user-driven/wallet-side; this agent verifies and prepares, it does not
  sign or submit on-chain transactions.
- Always surface verification state explicitly — a display name is never a trust anchor.

## Verified references (Phase 8)

Confirmed against the live Concordium Agent Registry before implementation (see
[`docs/identity/README.md`](../../../docs/identity/README.md) for the full record):

- **Agent Registry** — protocol-level identity/accountability layer; every agent gets a W3C DID
  anchored on-chain, tied to a Concordium account (ERC-8004-compatible).
- **CIS-8004 / CIS-8** — the registry contracts the MCP service reads/writes.
- **MCP service** — exposes registry operations as tools; **holds no private keys**; builder tools
  return sign-ready payloads the caller's wallet signs (so writes stay wallet-side).
- **Indexer** — serves the read/discovery tools (`list_agents`, `search_agents`,
  `recent_registrations`, single-record lookup) this agent verifies against.
- **Concordium JS SDK** (`@concordium/web-sdk`) — needed only for on-chain serialization/submission,
  which Phase 8 defers; read-only verification + card hashing need no SDK.
- **Verification primitives** — DID resolution = `registry_verified`; VCK (Verified by Concordium
  Keys) = `human_linked`; VCDC (Verified by Concordium Domain Control) = `org_linked`.
