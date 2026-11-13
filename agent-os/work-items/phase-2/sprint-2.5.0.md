---
id: 2.5.0
title: Marketplace Delivery Review and Disputes
phase: phase-2
status: planned
owner: backend
---

# Sprint 2.5.0 - Marketplace Delivery Review and Disputes

## Tasks
- [ ] T-250-1 Bind execution and evidence to an agreement and task attempt (priority:high, assignee:backend)
- [ ] T-250-2 Implement review revisions disputes feedback and cancellation (priority:high, assignee:backend)
- [ ] T-250-3 Build buyer specialist and reviewer views (priority:high, assignee:frontend)
- [ ] T-250-4 Run the three execution paths and negative authorization cases (priority:high, assignee:test)

**Phase:** [Phase 2](README.md)
**Status:** planned
**Created:** 2026-11-13
**Priority:** High

## Goal

Give buyers and specialist owners an auditable delivery and review flow across local, hosted and cloud execution.

## Dependencies

[2.4.0](sprint-2.4.0.md) agreements and assignments, [2.2.0](sprint-2.2.0.md) workspace handoff, and [2.3.0](sprint-2.3.0.md) for all six cloud choices.

## Acceptance Criteria

1. A hired specialist can accept and execute a named assignment using a local relay, hosted runner or an owner-approved cloud workspace. Only authorized task data is staged. The buyer can see the assigned agent, source revision and execution status.
2. Each submission records the agreement version, attempt, source revision, patch digest or PR commit, test results and controlled artifact references. Keep prior submissions and scope access to the participants and authorized reviewers.
3. Support assigned, in progress, submitted, revision requested, accepted, cancelled, expired and disputed work states. Only eligible actors can transition them. A revision creates a new submission while preserving the previous one. Expiry and cancellation revoke task access and trigger workspace cleanup.
4. A buyer can accept a specific submission or request revisions with reasons. A dispute freezes work acceptance and settlement eligibility while an authorized reviewer records a decision, reason and references. Preserve the original terms and all transition history.
5. One completed engagement permits one feedback entry per participant. Moderators can suspend listings and hide abusive feedback with an audit trail. The initial buyer flow completes zero-price work and stores evidence without a payment action.
6. Apply R-23 to paginated submissions and history, use error parsing for stale or forbidden actions and show a disabled saving button state while the request is pending.

## Delivery decisions

| Event | Actor | Result |
| --- | --- | --- |
| Submit evidence | Assigned specialist | Record a versioned submission and move work into buyer review. |
| Request changes | Buyer | Record reasons and reopen work within the current scope. A scope change returns to agreement approval. |
| Accept delivery | Buyer | Accept the specific current submission. Close a zero-price engagement. For a separately approved paid pilot, make that agreement version eligible for settlement review. |
| Cancel or expire | Authorized party or scheduled policy | Record the reason, revoke task access and initiate workspace teardown. Preserve the evidence under the retention policy. |
| Open or resolve a dispute | Participant opens. Authorized reviewer resolves. | Freeze acceptance and settlement eligibility. Record resolution and authorize only the permitted next work or settlement transition. |

## User Validation

A buyer reviews a patch and test evidence, requests one revision and accepts the new submission. A separate disputed engagement remains traceable through operator review.

## Affected Modules

`packages/lobby-server/src/hosted/`, coordinator, models, store and routes, `packages/lobby-client/src/`, `apps/lobby-web/`, `agent-os-panel/tabs/tasks.js`, `agent-os/scripts/verify-lobby.ts`, `agent-os/scripts/verify-hosted.ts` and the marketplace guide.

## Reuse Check

Reuse the existing task repository guard, coordinator lifecycle, workspace artifacts, lobby events and panel task status. Add a marketplace submission and review record with a separate decision lifecycle.

## Work Breakdown

| Task | Depends on | Acceptance criteria |
| --- | --- | --- |
| T-250-1 | 2.4.0, 2.2.0 | 1–3 |
| T-250-2 | T-250-1 | 3–5 |
| T-250-3 | T-250-2 | 2–6 |
| T-250-4 | T-250-3 | 1–6 |

## Agent Assignment

| Role | Responsibility |
| --- | --- |
| Backend | Lead delivery and moderation state machines. |
| Frontend | Own artifact, revision and dispute flows. |
| User Validation and Test | Verify buyer, seller and reviewer journeys. |
| Accessibility Specialist | Lead accessibility verification. |

## C.1 API Contract Trace

Trace task status and artifact sources in the coordinator and hosted runner. Document the marketplace evidence, review, cancellation, dispute and feedback contracts, including role-based access and idempotency, before wiring the lobby and panel views.

## C.2 Form Completeness Gate

Require a submission reference for review, a reason for revision or dispute and an explicit decision for resolution. Select submission and task references from authorized data.

## B5 Accessibility

WCAG checks for readable diffs and test status, keyboard review and dispute actions, labelled decision controls, and announced state changes.

## Verification and Closeout

Run lobby, hosted and UI checks. Exercise a zero-price delivery through each execution path, unauthorized artifact access, concurrent acceptance and dispute, cancellation cleanup and feedback uniqueness.

## Risk Assessment

Accepting a submission against changed terms can invalidate an engagement. Pin agreement and submission versions in decisions, and reject concurrent conflicting updates.

## Out of Scope

| Item | Classification | Action |
| --- | --- | --- |
| Automatic settlement | Scope boundary | 2.6.0 covers gated immediate payments and 2.10.0 covers conditional escrow. |
| Open marketplace enrollment | Scope boundary | 2.8.0 validates the curated invite-only cohort. |
