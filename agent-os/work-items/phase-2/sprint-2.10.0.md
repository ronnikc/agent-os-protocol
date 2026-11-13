---
id: 2.10.0
title: Conditional Concordium PLL Activation
phase: phase-2
status: blocked
owner: backend
---

# Sprint 2.10.0 - Conditional Concordium PLL Activation

## Tasks
- [ ] T-2100-1 Confirm protocol capabilities and map supported settlement operations (priority:high, assignee:backend)
- [ ] T-2100-2 Implement the PLL adapter and durable reconciliation (priority:high, assignee:backend)
- [ ] T-2100-3 Expose approved escrow actions and finalized status (priority:high, assignee:frontend)
- [ ] T-2100-4 Verify testnet lifecycle and prepare capped mainnet pilot (priority:high, assignee:test)

**Phase:** [Phase 2](README.md)
**Status:** blocked
**Created:** 2026-11-13
**Priority:** High

## Goal

Enable a capped delivery-based escrow pilot when released Concordium capabilities support the agreed settlement rules.

## Dependencies

[2.7.0](sprint-2.7.0.md), production protocol activation for the required capabilities, compatible SDK and wallet support, a supported asset and explicit pilot authorization. Testnet validation precedes mainnet enablement.

## Acceptance Criteria

1. Record released node, protocol, SDK and wallet versions and supported assets per network. Map every simulated operation to tested Simple or Enhanced PLL behavior. Keep any rule without required protocol support disabled.
2. Bind a finalized lock to the agreed version, asset, atomic amount, payer, beneficiary, release authority and deadline. Obtain explicit wallet approval and verify finalized chain state before marking funds locked.
3. On testnet, exercise happy-path delivery and release, expiry, cancellation, return of funds and authorized dispute resolution where supported. Reject mismatched terms, wrong actors, replay and unsupported operations.
4. Persist idempotent operation references and reconcile uncertain lock, release or return actions. Verify concurrent release versus expiry, restart, revoked roles and a safe stop while outstanding locks remain recoverable.
5. Propose a capped, invite-only mainnet pilot with approved participants, amounts and network. Enable mainnet only after separate approval and record independently checked finality and operator recovery evidence.
6. Apply R-23 to paginated settlement history, use error parsing for pending and rejected operations, and show a disabled loading button state during each wallet interaction.

## User Validation

A buyer and specialist can trace real lock and release or return-of-funds receipts for an approved engagement. An operator can pause new locks and recover an outstanding settlement.

## Affected Modules

`packages/concordium-commerce/src/`, hosted and marketplace settlement routes and storage, lobby marketplace and wallet UI, `agent-os/scripts/verify-commerce.ts` and escrow operator documentation.

## Reuse Check

Reuse the 2.7.0 lifecycle model, wallet binding and signing constraints, reservations and chain receipt verification. Add a versioned PLL adapter for released capabilities.

## Work Breakdown

| Task | Depends on | Acceptance criteria |
| --- | --- | --- |
| T-2100-1 | Released PLL and 2.7.0 | 1 |
| T-2100-2 | T-2100-1 | 2–4 |
| T-2100-3 | T-2100-2 | 2, 5–6 |
| T-2100-4 | T-2100-2, T-2100-3 | 1–6 |

## Agent Assignment

| Role | Responsibility |
| --- | --- |
| Backend | Lead protocol integration, finality and recovery. |
| Security and User Validation | Review wallet consent, authorized release and dispute scope. |
| Test | Verify supported live-chain operations before pilot approval. |
| Accessibility Specialist | Lead accessibility verification. |

## C.1 API Contract Trace

Trace the approved settlement endpoints and wallet methods against released SDK and protocol references. Confirm authorization, network, lifecycle statuses, transaction identifiers and finalized receipt fields before client wiring.

## C.2 Form Completeness Gate

Show immutable asset, amount, destination, authority and expiry before wallet signing. Only display eligible actions for the viewer and current chain state.

## B5 Accessibility

WCAG checks for clear wallet handoff, keyboard confirmation and cancellation, amount and status labels and announced changes.

## Verification and Closeout

Run `npm run verify-commerce`, integration fixtures and testnet lifecycle checks. Require documented rollback and operator recovery for pending locks. Record mainnet sign-off and verification evidence separately.

## Risk Assessment

Roadmap timing and supported semantics can change. A protocol milestone date alone cannot activate escrow. Require verified capabilities for every enabled action.

## Out of Scope

| Item | Classification | Action |
| --- | --- | --- |
| Broad marketplace escrow rollout | Scope boundary | Pilot evidence and separate rollout review are required. |
| Automatic release rules that require unavailable protocol features | Scope boundary | Enable only when the relevant released capability passes validation. |

## Activation status checked on 2026-11-13

Concordium's October update targets January 27, 2027 for the first PLL release. The roadmap targets January 2027 for Simple PLL and March 2027 for Enhanced PLL. The town hall recap places public testnet availability in mid-December 2026. Released capability and testnet lifecycle evidence are pending. [October update](https://www.concordium.com/article/agent-registry-update-october-2026) · [Roadmap](https://www.concordium.com/roadmap) · [Town hall recap](https://www.concordium.com/article/concordium-town-hall-6-recap)

| Criterion | Evidence required to reopen |
| --- | --- |
| 1 | Pin released node, protocol, SDK and wallet versions and one supported testnet PLT. Map lock and release to confirmed Simple PLL capabilities. Validate cancellation, expiry and return separately. |
| 2–3 | Record independently finalized testnet lock and release or return receipts with agreement digest, authorities, asset, amount and deadline. Require Enhanced PLL evidence before implementing an on-chain dispute constraint. |
| 4 | Reconcile an uncertain operation from finalized chain state after restart, race release against expiry, and verify a safe stop with recoverable outstanding locks. |
| 5 | Obtain explicit approval for named participants, network, asset and caps after testnet evidence is reviewed. |
| 6 | Exercise wallet controls and paginated settlement history against the released adapter after the capability gate opens. |

Live activation remains disabled. The Sprint 2.7.0 simulator remains the reference for state transitions.
