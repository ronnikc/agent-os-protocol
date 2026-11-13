---
id: 2.2.0
title: Cloud Workspaces with E2B and Agent37
phase: phase-2
status: planned
owner: backend
---

# Sprint 2.2.0 - Cloud Workspaces with E2B and Agent37

## Tasks
- [ ] T-220-1 Implement E2B and Agent37 lifecycle adapters (priority:high, assignee:backend)
- [ ] T-220-2 Connect repository staging hosted tools and artifact handoff (priority:high, assignee:backend)
- [ ] T-220-3 Expose workspace provider setup progress and results (priority:high, assignee:frontend)
- [ ] T-220-4 Run provider conformance and live opt-in checks (priority:high, assignee:test)

**Phase:** [Phase 2](README.md)
**Status:** planned
**Created:** 2026-11-13
**Priority:** High

## Goal

Deliver a complete lobby coding task in an owner-connected E2B or Agent37 workspace.

## Dependencies

[2.1.0](sprint-2.1.0.md), GitHub App connection and approved provider test accounts.

## Acceptance Criteria

1. In Apps, a manager connects, verifies, rotates and disconnects either account. The lobby exposes masked connection status, the region, limits and the supported isolation profile. New jobs stop on revocation while cleanup remains available.
2. A named hosted agent starts a short-lived Linux workspace from a pinned repository commit, runs approved build and test commands, and returns bounded logs, exit status, artifacts and a patch. A human approves any subsequent repository write through the existing task repository path.
3. Stage the approved source from the lobby without exposing the GitHub App credential. Keep model calls and long-lived credentials outside the workspace. Default to deny-all egress and require an approved policy before networked builds. Reject jobs when the selected account cannot enforce the policy.
4. Implement E2B microVM lifecycle and Agent37 Cloud API lifecycle using explicit sizing, bounded operations and supported isolation. Show Agent37 standard and VM capabilities accurately and account for disk retention. Capture artifacts before teardown and verify deletion or termination on success, cancel, timeout, failed boot and restart.
5. Report estimated and observed compute use where supported. Tag resources by run and reconcile a timed-out create without starting a second billable attempt.
6. Unwrap paginated history (R-23), use error parsing for provider failures and show a disabled loading button state while connect, launch or cancel is pending.

## User Validation

A lobby owner without a local worker connects either account, sees the agent's progress, and reviews a runnable patch and its test evidence.

## Affected Modules

`packages/lobby-server/src/hosted/`, `server.ts`, `store.ts`, `packages/protocol-core/src/`, `agent-os-panel/tabs/apps.js`, `agent-os/scripts/verify-hosted.ts` and `docs/hosted-onboarding.md`.

## Reuse Check

Reuse the 2.1.0 contract, `HostedAgentRunner`, task repository scoping and existing Apps status and connection patterns. New code implements E2B and Agent37 adapters behind the common contract.

## Work Breakdown

| Task | Depends on | Acceptance criteria |
| --- | --- | --- |
| T-220-1 | 2.1.0 | 1, 3–5 |
| T-220-2 | T-220-1 | 2–5 |
| T-220-3 | T-220-2 | 1, 2, 6 |
| T-220-4 | T-220-2, T-220-3 | 1–6 |

## Agent Assignment

| Role | Responsibility |
| --- | --- |
| Backend | Lead adapters, execution and artifact handoff. |
| Frontend | Own connection and task execution controls. |
| Security and Test | Verify egress, credential boundaries and lifecycle. |
| Accessibility Specialist | Lead accessibility verification. |

## C.1 API Contract Trace

Trace the existing Apps relay and `/integrations` route family, plus hosted task dispatch in `packages/lobby-server/src/hosted/hosted-agent-runner.ts`. Record the final routes and status/error shapes for connection, start, logs, artifacts and cancellation before wiring Apps. Pin vendor SDK or REST versions and run authenticated staging tests.

## C.2 Form Completeness Gate

Render credentials only during setup, bind resource and isolation selectors to validated capabilities, and explain missing permissions without returning secrets.

## B5 Accessibility

WCAG checks for accessible form errors, keyboard connection and cancel controls, focus restoration, and throttled live announcements for streaming task status.

## Verification and Closeout

Use `npm run verify-hosted`, `npm run verify-lobby` and `npm run verify-ui` plus opt-in live conformance on E2B and Agent37. Record Agent37 retention from its policy and confirm billable resource cleanup separately. Document owner onboarding for both.

## Risk Assessment

Provider create may succeed after the local request times out. Reconcile by run identity before retrying. Agent37 documents a post-deletion recovery copy. Validate whether retention is acceptable for the lobby data class.

## Out of Scope

| Item | Classification | Action |
| --- | --- | --- |
| Remaining four providers | Scope boundary | Covered by 2.3.0. |
| Always-on workspaces and provider-managed agent loops | Scope boundary | Phase 2 uses task-attempt workspaces and Agent OS orchestration. |
