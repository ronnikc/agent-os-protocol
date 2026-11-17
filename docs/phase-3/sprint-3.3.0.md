<!-- SPDX-License-Identifier: Apache-2.0 -->

# Sprint 3.3.0 — Finalized Agent ID and cross-chain links

**Status** — Proposed. [Phase 3 plan](README.md).

## Goal

Register a publicly verifiable Agent ID with its current Concordium owner and support optional external key links with accurate lifecycle status.

## Dependencies and affected modules

Requires [3.0.0](sprint-3.0.0.md), a writable local or test registry, and an existing test account for early tests. Use [3.1.0](sprint-3.1.0.md) for the complete derived-account demonstration. Candidate changes are `packages/protocol-core/src/agent-identity.ts`, `packages/identity-concordium`, lobby registry transport and API, Panel and hosted mint/card views, and identity and commerce docs. Preserve existing DID parsing and registry use for current agents.

## Work breakdown

1. Define registry coordinates with validated genesis, canonical network reference, contract and token ID/address, mapped from existing DID/card identifiers without altering old records. Use compatible upstream network helpers, registry responses and finalized events as authority. Preserve a resolvable record when a broadcast response is lost.
2. Reuse registry MCP builders and [Concordium's official Registry sponsor](pilot-contract.md#official-registry-sponsorship) on supported public targets. Check the exact sponsored operations and signer compatibility. Validate network, sender, contract, entrypoint and intent before the owner signature. Publish immutable card bytes and wait for finality and owner readback. Use the fixture sponsor for Local Stack.
3. Add the canonical badge in a versioned card after mint. Verify exact public card bytes before confirming the update. Use unambiguous idempotency for both mint and update and reconcile uncertain results against finalized chain state. Limit HTTP card lookups to approved endpoint policies, redirects and size limits.
4. Use CIS-8 for supported Ethereum and Solana owner keys and wait for finalization before the dependent mint or supported update. Check an optional ERC-8004 registration independently. Follow the XDC Safe-style model with live external owner/authority checks, with stale or unavailable state reflected as unverified.
5. Handle transfer, CIS-8 unlink/revoke, registry revocation and key change. Invalidate or reevaluate delegations against the current active token and ownership. Expose stable authority evidence to the CMP verifier and lobby policies. Link through an authenticated CMP tenant, fresh current-owner proof and proof of control of the agent's separate key. Reconcile retries against the existing binding.
6. After retained-factor restore in [3.1.1](sprint-3.1.1.md) or origin-ID device/recovery actions in [3.1.2](sprint-3.1.2.md), re-resolve the existing token/owner, card and active agent/external keys. Verify original Agent ID continuity independently. Expose finalized account-authority state for the [grant fingerprint](origin-id-lifecycle.md#dependent-grant-invalidation). Test changed account keys with unchanged registry ownership. Require fresh proof and explicit relink/reauthorization for changed or unavailable independent agent keys.

## Acceptance criteria

- [ ] A finalized local or testnet mint resolves from canonical token coordinates and matches the current owner and exact public card hash. A separately operated verification client validates the badge.
- [ ] The official Registry sponsor path is exercised with a fresh zero-balance owner for mint and the necessary card update on a supported target. Decline or uncertain response preserves account state and resumes without duplicate mint. Pending or mismatched results never show a verified mint.
- [ ] Existing agents resolve through their current identifiers. A new account from 3.1.0 completes the same mint workflow as an existing account.
- [ ] Fixture and supported test environment runs demonstrate Ethereum and Solana key control with correct chain and contract binding. A wrong key, network or owner fails. A claimed ERC-8004 reference or Safe authority requires its corresponding external-chain check.
- [ ] Finalized transfer clears the token's external reference and agent wallet as required by CIS-8004. Confirm both emitted changes, invalidate prior CMP authority and new spending, and require fresh binding by the new owner. Existing receipts and the registry's preserved fields still resolve. Revocation, key rotation, wrong genesis or stale readback cannot authorize a new operation.
- [ ] An independent CMP fixture verifies current-owner and agent-key evidence for an existing Agent ID, with no duplicate token or cross-tenant link. It exposes the pinned account-authority fingerprint and detects changed keys even when the owner and card remain unchanged.
- [ ] The workflow provides explicit signing and finality status and keeps account and payment keys and personal evidence outside card data.
- [ ] R-23 is N/A for single operation results. Error parsing distinguishes user decline, rejected finalization and unavailable verification. Mint/link buttons have a loading/disabled state and a resumable pending state.

## User validation and assignments

An existing or newly enrolled owner can mint, reopen a pending operation, prove the badge publicly and spot a stale cross-chain association.

| Role | Assignment |
| --- | --- |
| Registry Engineering Lead and User Validation Specialist | Co-lead ownership, legacy compatibility and user workflow. |
| Security Specialist and QA | Review key proofs, finality, transfer/revocation and cross-chain failures. |
| Accessibility Specialist | Lead wallet approval, finality status and explorer-link review. |
| I18N Specialist and Product QA Specialist | Review status language, recovery and both mint surfaces. |

## Reuse check

The reuse catalog is absent in this checkout. Reuse `mint-agent-id.js`, hosted minting in `apps/lobby-web/app.js`, existing registry MCP relay and registry verifier, official badge tooling and CIS-8 canonical builders. Add operation reconciliation because the current Panel success state can precede finality. Share the lifecycle where both clients need it.

## C.1 API Contract Trace

Trace the existing `/api/v1/agent-lobby/registry/status`, `/registry/tools`, `/registry/call`, `/registry/sponsor` and `/agent-cards` server handlers and the Panel proxy before extending them. Represent mint and badge update as owner-scoped operation IDs with intent, tx hash, status and canonical token result. Add a single-operation status surface only if current routes cannot reconcile it. Confirm the registry capability and contract address server-side, and map stable response errors to both frontends.

## C.2 Form Completeness Gate

Populate network, owner and external key type from approved signer and profile capabilities. Derive contract and token coordinates. Preview what is signed and whether a link is public. Disable repeat approval while the operation is active.

## B5 Accessibility, B6 help, B7 documentation

Check keyboard-only mint and link, focus restoration after the external wallet, live announcements for pending/finalized states, and descriptive registry and explorer links. Document canonical addresses, sponsored funding, ownership transfer and key refresh.

## Out of scope

| Item | Classification | Action |
| --- | --- | --- |
| External issuer onboarding and CMP delegation | Scope boundary | Use 3.1.0 for issuance and expose verified registry state to 3.5.0. |
| Escrow and pay-wallet rotation | Scope boundary | Reuse Phase 2 ownership and wallet binding. |
| Universal smart-contract wallet authority | Scope boundary | Ship only independently tested bindings with explicit authority semantics. |
