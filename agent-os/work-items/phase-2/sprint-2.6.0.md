---
id: 2.6.0
title: Wallet Operations and Independent Commerce Interoperability
phase: phase-2
status: planned
owner: backend
---

# Sprint 2.6.0 - Wallet Operations and Independent Commerce Interoperability

## Tasks
- [ ] T-260-1 Finish wallet lifecycle and scoped signer recovery (priority:high, assignee:backend)
- [ ] T-260-2 Expose wallet actions balance receipts and settlement states (priority:high, assignee:frontend)
- [ ] T-260-3 Verify independent hosted x401 and x402 interoperability (priority:high, assignee:test)
- [ ] T-260-4 Publish reproducible setup and scrubbed pilot evidence (priority:high, assignee:documentation)

**Phase:** [Phase 2](README.md)
**Status:** planned
**Created:** 2026-11-13
**Priority:** High

## Goal

Close outstanding agent wallet operations and produce independent hosted x401 and x402 evidence before proposing paid marketplace work.

## Dependencies

Existing [commerce plan](../../../docs/agent-wallets-and-payments-plan.md), registry verification and an independently operated verifier and merchant plus a supported facilitator. Marketplace post-acceptance pilot depends on [2.5.0](sprint-2.5.0.md).

## Acceptance Criteria

1. Provide owner-only link, balance, receipt, pause, rotate and unlink flows for dedicated agent wallets. Recheck finalized registry ownership and wallet binding before authorization. Rotation, revocation and wrong-network operations fail closed.
2. Use the existing scoped signer with explicit network, asset, recipient, facilitator, amount and period limits. Preserve atomic reservations through restart, timeout and uncertain finality. Independently verify receipts and suppress duplicate debits.
3. An independently operated x401 verifier accepts the supported hosted-agent credential presentation. Verify nonce, audience, expiry, issuer, resource binding, owner consent and revocation. A denied proof stops a proof-gated paid request.
4. An external hosted x402 merchant and compatible facilitator settle an approved exact quote in a supported test environment. Record payer, recipient, asset, amount, sponsor and finality. Validate a supported PLT separately before claiming PLT interoperability.
5. Any mainnet payment requires separate explicit authorization for the concrete pilot, capped amount and participants. A zero-price agreement remains usable without an attached wallet or signer. Expose payment state independently of the work decision.
6. Apply R-23 to paginated receipts, use error parsing for authorization and settlement states, and show a disabled saving button state during wallet mutations.

## User Validation

An owner provisions a test agent, rotates the binding and verifies a receipt. An external operator can reproduce the hosted proof and payment exchange from the documented profile.

## Affected Modules

`packages/concordium-commerce/src/`, `packages/identity-concordium/src/`, `packages/lobby-server/src/hosted/` and wallet routes, panel Agents and Wallets views, `agent-os/scripts/verify-commerce.ts`, `docs/http-proofs-and-payments.md` and `docs/fund-concordium-agent-wallet.md`.

## Reuse Check

Reuse the commerce transport, existing `SpendingLedger`, wallet binding and hosted agent ID proof tools. Extend setup and operator recovery from the current commerce plan. Retain the existing local pilot evidence.

## Work Breakdown

| Task | Depends on | Acceptance criteria |
| --- | --- | --- |
| T-260-1 | Existing commerce services | 1–2, 5 |
| T-260-2 | T-260-1 | 1, 5–6 |
| T-260-3 | T-260-1 | 2–5 |
| T-260-4 | T-260-2, T-260-3 | 1–6 |

## Agent Assignment

| Role | Responsibility |
| --- | --- |
| Backend | Lead wallet, signer and commerce integration. |
| Frontend | Own owner wallet operations and receipt UX. |
| Security and User Validation | Review consent, signing limits and negative tests. |
| Accessibility Specialist | Lead accessibility verification. |

## C.1 API Contract Trace

Trace existing wallet binding and proof tools and the x402 transport. Pin the supported upstream specifications, confirm wallet method and network support, document owner routes and receipt envelopes, and test independent wire interoperability.

## C.2 Form Completeness Gate

Select verified agent, network and wallet binding from available records. Show concrete asset, amount, counterparty and limits before approval. Redact signed payloads and sensitive data.

## B5 Accessibility

WCAG checks for wallet connection and cancel actions, amount and asset labels, status announcements and readable transaction links.

## Verification and Closeout

Run `npm run verify-commerce`, `npm run verify-identity` and `npm run verify-hosted`. Record scrubbed independent evidence, including denied proofs, finality reconciliation and replay behavior. Keep pilot flags off by default.

## Risk Assessment

Local harness success does not establish independent hosted interoperability. Track external operator dependencies and preserve their gate until the exchange succeeds.

## Out of Scope

| Item | Classification | Action |
| --- | --- | --- |
| Delivery-based escrow | Scope boundary | Covered by 2.7.0 and 2.10.0. |
| Open or uncapped mainnet payments | Scope boundary | Outside the invite-only Phase 2 pilot. |
