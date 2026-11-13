---
id: 2.1.0
title: Hosted Controls and Workspace Contract
phase: phase-2
status: review
owner: backend
---

# Sprint 2.1.0 - Hosted Controls and Workspace Contract

## Tasks
- [x] T-210-1 Define workspace capabilities and persistent state transitions (priority:high, assignee:backend)
- [x] T-210-2 Enforce hosted budgets authorization cancellation and audit (priority:high, assignee:backend)
- [x] T-210-3 Expose owner limits usage and recovery in Apps (priority:high, assignee:frontend)
- [x] T-210-4 Verify concurrency restart and authorization with a fake provider (priority:high, assignee:test)

**Phase:** [Phase 2](README.md)
**Status:** implementation review
**Created:** 2026-11-13
**Priority:** High

## Goal

Give lobby owners enforceable hosted model and workspace limits and define one workspace contract for six providers.

## Dependencies

Agent OS Protocol v1.0.0, existing hosted agent runner, Apps integrations, wallet-authenticated lobby sessions and durable lobby storage.

## Acceptance Criteria

1. Define provider capabilities for resource sizes, isolation class, egress, max runtime, deletion, credentials, region and usage reporting. Every workspace is bound to a lobby, named task and attempt, selected connection and source revision.
2. Persist workspace states from requested through provisioning, running, collecting artifacts, and a terminal outcome. Track cleanup separately until confirmed. Retry provisioning and teardown safely after disconnect, duplicate requests or server restart.
3. Reserve model and compute budget before starting work, enforce per-run and lobby-period ceilings plus concurrency and deadlines, and reconcile estimated and actual usage. An unknown bill stays pending and cannot reopen spent capacity.
4. Only authorized lobby managers can connect, rotate, disable, or disconnect providers and change budgets. Credentials are sealed, masked and excluded from agent processes and logs. Existing lobbies can keep running with workspace execution disabled.
5. Owner cancellation stops further work, triggers teardown and leaves an audit record. Denied cross-lobby access and concurrent budget reservations are verified.
6. Unwrap paginated run history (R-23), use error parsing for actionable messages and show a disabled saving button state while the request is pending.

## User Validation

A lobby owner caps unattended spend, reviews estimated and reported charges, and cancels an over-budget task. A non-manager cannot alter settings.

## Affected Modules

`packages/protocol-core/src/`, `packages/lobby-server/src/models.ts`, `store.ts`, `server.ts`, `src/hosted/`, `agent-os-panel/tabs/apps.js`, `agent-os/scripts/verify-hosted.ts`, `docs/security.md` and `docs/hosted-panel.md`.

## Reuse Check

Use `LobbyIntegration`, `IntegrationSecret`, the existing owner authorization and sealed hosted key storage. Follow the reservation and reconciliation pattern in `packages/concordium-commerce/src/spending-ledger.ts` while keeping compute, model and payment ledgers independent. New contracts cover sandbox lifecycle and provider capabilities. The base checkout has no `agent-os/REUSE.md`.

## Work Breakdown

| Task | Depends on | Acceptance criteria |
| --- | --- | --- |
| T-210-1 | Phase 1 baseline | 1–2 |
| T-210-2 | T-210-1 | 2–5 |
| T-210-3 | T-210-2 | 4–6 |
| T-210-4 | T-210-2, T-210-3 | 1–6 |

## Agent Assignment

| Role | Responsibility |
| --- | --- |
| Backend | Lead contracts, policy, storage and lifecycle. |
| Frontend | Own Apps settings and status. |
| Security and Test | Review credential boundaries and exercise concurrent operations. |
| Accessibility Specialist | Lead accessibility verification. |

## C.1 API Contract Trace

Trace the existing lobby `/integrations` and hosted runtime handlers in `packages/lobby-server/src/server.ts`, and the panel relay in `agent-os/scripts/agent-os-panel-server.ts`. Record method, full mount path, authorization, request and response envelopes and failure codes before wiring owner settings and run status. Exercise both authorized and denied calls.

## C.2 Form Completeness Gate

Match required budget period, ceilings and concurrency to backend validation. Use selectors for provider and approved resource profiles. Preserve input on failure and prevent duplicate submissions.

## B5 Accessibility

WCAG checks for keyboard-operated budget and cancellation controls, explicit units, focus restoration after confirmation and announced budget and cleanup status.

## Verification and Closeout

Run `npm run verify-hosted`, `npm run verify-lobby` and `npm run verify-ui` with fixtures for policy, accounting and cleanup. Document trust and billing boundaries in the hosted and security guides.

## Risk Assessment

A provider may return late or incomplete usage. Cap admission against reserved worst-case cost and record estimates and reconciliation explicitly.

## Out of Scope

| Item | Classification | Action |
| --- | --- | --- |
| Live sandbox adapters | Scope boundary | Covered by 2.2.0 and 2.3.0. |
| Marketplace settlement | Scope boundary | Covered by 2.6.0, 2.7.0 and conditional 2.10.0. |
