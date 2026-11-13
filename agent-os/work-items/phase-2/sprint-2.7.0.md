---
id: 2.7.0
title: Concordium Escrow Readiness
phase: phase-2
status: planned
owner: backend
---

# Sprint 2.7.0 - Concordium Escrow Readiness

## Tasks
- [ ] T-270-1 Define settlement transitions signing authority and upstream capability matrix (priority:high, assignee:backend)
- [ ] T-270-2 Implement the escrow simulator and reconcile race fixtures (priority:high, assignee:backend)
- [ ] T-270-3 Exercise failure and zero-price regression scenarios (priority:high, assignee:test)
- [ ] T-270-4 Document the pending status and the production activation checklist (priority:high, assignee:documentation)

**Phase:** [Phase 2](README.md)
**Status:** planned
**Created:** 2026-11-13
**Priority:** High

## Goal

Specify and simulate delivery-based settlement while Concordium Protocol-Level Locks are pending.

## Dependencies

[2.5.0](sprint-2.5.0.md) for agreement and delivery state and [2.6.0](sprint-2.6.0.md) for wallet policy and finality. The simulator can start against the agreed contracts.

## Acceptance Criteria

1. Document Simple and Enhanced PLL capability assumptions and a dated upstream status. Specify the proposed lock asset, atomic amount, network, payer, beneficiary, release authority, expiry and return path. Mark unsupported or unconfirmed semantics for validation in 2.10.0.
2. Model funding requested, lock pending, funded, release pending, released, return pending, returned, and uncertain settlement. Bind transitions to one agreement version, approved submission and lock reference. Maintain distinct work, decision and settlement states.
3. Simulate buyer approval, lock confirmation, accepted delivery, release, rejected or expired work, cancellation, return and dispute hold. A dispute resolution can authorize a requested action only when the supported protocol rules allow it.
4. Simulate duplicate events, concurrent release and expiry, lost submission response, provider outage, signer rotation and restart. Record idempotency identifiers, keep reservations during uncertain finality, and reconcile before retry.
5. The production feature stays disabled and clearly labelled pending. Simulation never uses a live signer or custody. Zero-price work remains available and immediate x402 settlement uses its independent path.
6. Pagination, error parsing and loading button states are N/A for this sprint because it adds no production endpoints or controls.

## Escrow scenarios

| Scenario | Simulated decision | Required proof for activation |
| --- | --- | --- |
| Fund agreed work | Wallet owner approves a lock bound to one agreement version. | Released protocol and SDK produce a finalized lock with the expected token, atomic amount, authority, expiry and beneficiary. |
| Accept delivered work | Authorized actor requests release for a specific accepted submission. | Confirm the lock and release authority, finality and destination. Prevent duplicate release. |
| Cancel or expire | Apply the agreement rules and reconcile release versus return. | Verify who can cancel, the exact expiry behavior and where funds become available. |
| Dispute | Suspend settlement eligibility pending a recorded decision. | Verify protocol support before claiming that a marketplace dispute can constrain an on-chain release. |

## User Validation

An operator can walk through each escrow decision in a simulator and see which required actions depend on Simple or Enhanced PLL.

## Affected Modules

Commerce and marketplace settlement contracts, `packages/concordium-commerce/src/`, `agent-os/scripts/verify-commerce.ts`, `docs/agent-wallets-and-payments-plan.md` and an escrow lifecycle reference.

## Reuse Check

Reuse wallet binding verification, spending reservations, audit events and marketplace agreement versions. Add a simulator boundary and a release capability matrix.

## Work Breakdown

| Task | Depends on | Acceptance criteria |
| --- | --- | --- |
| T-270-1 | 2.5.0, 2.6.0 | 1–2 |
| T-270-2 | T-270-1 | 2–4 |
| T-270-3 | T-270-2 | 3–6 |
| T-270-4 | T-270-1, T-270-3 | 1, 4–6 |

## Agent Assignment

| Role | Responsibility |
| --- | --- |
| Backend | Lead simulator and settlement model. |
| Security and User Validation | Review custody, authority, dispute and funds recovery. |
| Test | Exercise deterministic lifecycle and concurrency scenarios. |
| Accessibility Specialist | Lead accessibility verification. |

## C.1 API Contract Trace

N/A — no API or production client is added. Document the proposed adapter operations and the independent upstream capability checks.

## C.2 Form Completeness Gate

N/A — no forms or buttons. Review required agreement and lock fields in simulator fixtures.

## B5 Accessibility

Accessibility Specialist reviews the status and lifecycle documentation for keyboard-readable tables, clear state text and meaningful links. N/A for frontend WCAG interaction checks because this sprint adds no UI.

## Verification and Closeout

Run `npm run verify-commerce` and marketplace zero-price regression fixtures. Cover expiry and release races, restart and unsupported capability cases. Record what remains contingent on released upstream behavior.

## Risk Assessment

Concordium's roadmap dates and semantics can change. Keep assumptions in a versioned capability matrix and treat the simulator as acceptance design.

## Out of Scope

| Item | Classification | Action |
| --- | --- | --- |
| Testnet and mainnet activation | Scope boundary | Conditional 2.10.0 owns the released protocol integration. |
| Alternative custody mechanism | Scope boundary | The approved escrow path uses Concordium PLL. |
