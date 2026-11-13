---
id: 2.8.0
title: Invite Only Beta and Stabilization
phase: phase-2
status: awaiting-external-validation
owner: test
---

# Sprint 2.8.0 - Invite Only Beta and Stabilization

## Tasks
- [x] T-280-1 Define cohort scenarios evidence and release criteria (priority:high, assignee:test)
- [ ] T-280-2 Run external zero-price journeys and accessibility review (priority:high, assignee:user-validation)
- [ ] T-280-3 Qualify six providers and exercise rollback recovery (priority:high, assignee:test)
- [ ] T-280-4 Record beta fixes retests and release sign-off evidence (priority:high, assignee:documentation)

**Phase:** [Phase 2](README.md)
**Status:** repository readiness verified, external beta pending
**Created:** 2026-11-13
**Priority:** High

## Goal

Validate the six cloud providers and the marketplace with external participants before freezing the Phase 2 release scope.

## Dependencies

[2.3.0](sprint-2.3.0.md), [2.5.0](sprint-2.5.0.md), [2.6.0](sprint-2.6.0.md) and [2.7.0](sprint-2.7.0.md). Live PLL is independent.

## Acceptance Criteria

1. Onboard at least one external buyer and one independently operated specialist owner using the documented path. Record blockers and fix release-blocking issues before repeating the journey from a clean setup.
2. Complete zero-price jobs from discovery and signed-off terms to accepted delivery. Include a revision, a cancelled run and a dispute resolution across pilot scenarios. Verify the same final artifacts and access boundaries across local, hosted and cloud execution.
3. Record live conformance for each of the six providers on an eligible account and runtime. Test authorization, budget denial, quota failure, timeout, operator stop, restart recovery and absence of lingering billable workspaces. Reconcile estimated and vendor-reported cost where available.
4. Collect completion rate, time to verified delivery, interventions, cost per accepted task, failed and retried attempts, cleanup failures and review outcomes. Define operational owners and release criteria before the cohort starts.
5. Exercise the rollback for feature flags, existing preview migration, provider disconnection and pending settlements. Publish the operator runbook and validate zero-price operation while escrow is pending.
6. Verify R-23 pagination, error parsing and loading button states on the marketplace and Apps flows. Record accessibility issues and retest fixes before sign-off.

## User Validation

An invited buyer and specialist can onboard independently and complete a job. An operator can recover a failed attempt and account for the associated costs.

## Affected Modules

`agent-os/scripts/verify-*.ts`, marketplace and cloud workspace code touched by beta defects, `docs/hosted-onboarding.md`, `docs/security.md`, and marketplace and operational guides.

## Reuse Check

Reuse the Phase 2 provider conformance, commerce and marketplace fixtures, existing feature flags and the published clean-install checklist. Add a shared pilot evidence matrix.

## Work Breakdown

| Task | Depends on | Acceptance criteria |
| --- | --- | --- |
| T-280-1 | 2.3.0, 2.5.0, 2.6.0, 2.7.0 | 1–4 |
| T-280-2 | T-280-1 | 1–2, 6 |
| T-280-3 | T-280-1 | 3–5 |
| T-280-4 | T-280-2, T-280-3 | 1–6 |

## Agent Assignment

| Role | Responsibility |
| --- | --- |
| Test | Lead provider qualification and stabilization evidence. |
| User Validation | Lead external participant onboarding and acceptance. |
| Documentation | Own setup and operator runbooks. |
| Accessibility Specialist | Lead accessibility verification. |

## C.1 API Contract Trace

No new API is planned. Trace any defect fix to the existing handler and callers, and rerun its role, request and response cases.

## C.2 Form Completeness Gate

No new forms are planned. Retest connect, listing, bid, hire, revision, dispute and cancellation forms against server validation.

## B5 Accessibility

WCAG checks for provider connection, keyboard-only marketplace navigation, visible focus, readable task evidence and live statuses.

## Verification and Closeout

Run `npm run verify-all` and the live pilot matrix. Record the eligible tier, isolation and region per provider. Resolve release blockers, repeat failed checks and request release sign-off against the evidence.

## Risk Assessment

A single pilot may hide provider-specific failure modes. Use the same conformance tasks for all six providers and retain reproducible evidence per runtime and account tier.

## Out of Scope

| Item | Classification | Action |
| --- | --- | --- |
| Flagship demo and public benchmark publication | Scope boundary | 2.9.0 follows development and stabilization. |
| Real marketplace escrow | Scope boundary | Conditional 2.10.0. |

## Candidate readiness

The [beta operator runbook](../../../docs/phase-2-beta-runbook.md) records the participant roles, shared scenarios, metrics, evidence matrix and rollback. Repository fixtures cover zero-price terms, revision, disputes, authorized evidence, restart recovery and pending reservations. External cohort results, six live provider rows, live rollback, manual accessibility and release sign-off remain pending. This preparation leaves the public recording and benchmark gate closed.

| Criterion | Repository evidence | External evidence |
| --- | --- | --- |
| 1 | Runbook defines fresh-install roles and journey. | Independently operated buyer and specialist pending. |
| 2 | Lobby fixtures cover zero-price revision, cancellation and dispute; local, hosted and cloud evidence binding. | Participant walkthrough and live artifact comparison pending. |
| 3 | Hosted fixtures cover admission, cancellation, restart and cleanup. | All six plan, region and billing rows pending. |
| 4 | Runbook defines owners, release criteria and metrics. | Cohort measurements pending. |
| 5 | HTTP fixture verifies beta flag rollback, preserved preview records and cross-lobby denial; commerce checks preserve uncertain reservations. | Deployment rollback drill pending. |
| 6 | UI checks cover labels, status regions, paginated evidence and disabled mutations. | Keyboard and screen-reader walkthrough pending. |

### Beta stabilization fix

Cloud staging now requires an exact repository and commit approved in the marketplace agreement. The lobby fixture confirms that a matching pin reaches ordinary workspace admission and that an absent pin, a different commit or a changed repository is rejected before any compute reservation. This verifies the source authorization boundary locally. Live provider and cohort evidence remains pending.
