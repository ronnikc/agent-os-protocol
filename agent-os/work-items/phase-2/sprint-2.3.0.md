---
id: 2.3.0
title: Daytona Modal Upstash Box and Vercel Sandbox
phase: phase-2
status: planned
owner: backend
---

# Sprint 2.3.0 - Daytona Modal Upstash Box and Vercel Sandbox

## Tasks
- [ ] T-230-1 Implement Daytona and Modal adapters (priority:high, assignee:backend)
- [ ] T-230-2 Implement Upstash Box and Vercel Sandbox adapters (priority:high, assignee:backend)
- [ ] T-230-3 Show all six provider profiles and Vercel Sandbox setup (priority:high, assignee:frontend)
- [ ] T-230-4 Run common conformance and document plan-specific setup (priority:high, assignee:test)

**Phase:** [Phase 2](README.md)
**Status:** planned
**Created:** 2026-11-13
**Priority:** High

## Goal

Make all six approved cloud providers usable through the same Apps and lobby task workflow.

## Dependencies

[2.2.0](sprint-2.2.0.md). Users supply their own provider credentials when connecting a provider in Apps. Development and CI use fixtures.

## Acceptance Criteria

1. Daytona supports a verified Linux sandbox profile. Surface container and VM capabilities and enforce actual tier egress restrictions. A profile unable to honor the lobby policy fails before source is staged.
2. Modal uses the supported JavaScript Sandbox SDK with explicit runtime, resource limits and termination. Its estimated usage reflects requested versus observed CPU and memory billing where supported.
3. Upstash Box uses the TypeScript EphemeralBox API with a per-attempt expiry, creation-time egress policy and explicit early deletion. Surface container isolation and active-CPU billing.
4. Vercel Sandbox is visible alongside Vercel Deploy in Apps. An owner explicitly connects a sandbox project through team, project and approved credentials for external hosting, or project-scoped OIDC where supported. Use the existing project as a selectable target when available. Create disposable workspaces with persistence disabled and keep deployment credentials in GitHub Actions.
5. Every provider passes the common pinned-revision build, test, artifact, cancel, timeout, retry, disconnection and teardown checks. No provider or region is switched without owner authorization. A connection exposes only supported and policy-eligible profiles.
6. Apply R-23 to paginated run history, use shared error parsing and show a disabled loading button state while a connection or task action is in flight.

## User Validation

Owners see six provider choices in Apps, can use their approved provider and project, and see meaningful reasons when a configuration fails policy.

## Affected Modules

`packages/lobby-server/src/hosted/`, `server.ts`, `agent-os-panel/tabs/apps.js`, `agent-os/scripts/verify-hosted.ts`, `docs/hosted-onboarding.md` and `docs/security.md`.

## Reuse Check

Reuse the 2.1.0 workspace and Apps contracts, 2.2.0 conformance suite and the existing Vercel Deploy entry point for discoverability. Add a dedicated Sandbox authorization scoped by lobby and project.

## Work Breakdown

| Task | Depends on | Acceptance criteria |
| --- | --- | --- |
| T-230-1 | 2.2.0 | 1–2, 5 |
| T-230-2 | 2.2.0 | 3–5 |
| T-230-3 | T-230-1, T-230-2 | 4–6 |
| T-230-4 | T-230-3 | 1–6 |

## Agent Assignment

| Role | Responsibility |
| --- | --- |
| Backend | Lead four provider adapters and policy mapping. |
| Frontend | Own provider configuration and status presentation. |
| Security and Test | Qualify each connection and runtime class. |
| Accessibility Specialist | Lead accessibility verification. |

## C.1 API Contract Trace

Reuse the method and route map established in 2.2.0. Trace the existing Vercel deployment scaffold in `packages/lobby-server/src/server.ts` and the Apps card before adding Sandbox setup. Verify each vendor's create, execute, file, usage and teardown responses with its pinned interface.

## C.2 Form Completeness Gate

Use provider-specific fields only where needed. Validate Vercel team/project ownership and account access, mask credentials, and render profiles only after backend capability detection.

## B5 Accessibility

WCAG checks for the six provider cards, labelled selectors and focus order, textual status independent of color and keyboard-operable connection controls.

## Verification and Closeout

Run hosted and UI suites and the conformance matrix for all six providers. Capture plan, region, runtime class, source revision, outcome and cleanup evidence for each live qualification. Update provider setup guides.

## Risk Assessment

Network control, session caps and metering differ by plan and region. Record detected capabilities and reject mismatches early. Confirm provider teardown rather than treating a stop response as deletion.

## Out of Scope

| Item | Classification | Action |
| --- | --- | --- |
| GPU, desktop, always-on, custom agent services and public port exposure | Scope boundary | The launch contract covers short-lived Linux coding tasks. |
| Additional provider integrations | Scope boundary | The approved catalog contains six providers. |
