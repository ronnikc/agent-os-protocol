---
id: 2.9.0
title: Release Evidence and Public Launch
phase: phase-2
status: planned
owner: documentation
---

# Sprint 2.9.0 - Release Evidence and Public Launch

## Tasks
- [ ] T-290-1 Run and validate reproducible benchmark results on the release candidate (priority:high, assignee:test)
- [ ] T-290-2 Record the stabilized flagship demo and publish accessible evidence (priority:high, assignee:documentation)
- [ ] T-290-3 Reconcile public claims docs site and release notes (priority:high, assignee:documentation)
- [ ] T-290-4 Verify clean install public links flags and release checklist (priority:high, assignee:test)

**Phase:** [Phase 2](README.md)
**Status:** planned
**Created:** 2026-11-13
**Priority:** High

## Goal

Publish the Phase 2 launch material from the finished and stabilized product.

## Dependencies

[2.8.0](sprint-2.8.0.md) beta exit and a frozen, reproducible release candidate. Live PLL is independent.

## Acceptance Criteria

1. Record the flagship demo after Phase 2 development and beta fixes are complete. Show a verified multi-machine, multi-runtime lobby, provider connection, specialist hire, scoped assignment, reviewed patch and test evidence.
2. Run reproducible comparisons against a single-agent baseline and one external orchestrator using equivalent models, task inputs and budgets where practical. Publish fixtures, pinned versions, results and limitations for completion, time, model and compute cost, interventions, regressions and failure recovery.
3. Align README, docs index, website, tour, roster counts and release notes with the verified release. Describe Local, Swarm, Hosted and cloud credential boundaries accurately. Describe the beta access policy and the verified status of x401, x402 and PLL.
4. A fresh install reproduces the reference workflow. Verify public links and instructions, provider capabilities, release flag defaults and recovery or rollback steps against the candidate.
5. Publish accessible demo captions or transcript, readable benchmark tables and a developer path from install through first successful task. Retain scrubbed release evidence and launch sign-off.
6. Pagination and application error parsing and loading button states are N/A because no product flows or API endpoints are added. Check any launch-site controls for keyboard and status behavior.

## User Validation

A developer can install Agent OS, follow the released cloud and marketplace documentation and compare the published evidence with the demonstrated workflow.

## Affected Modules

`README.md`, `RELEASING.md`, `CHANGELOG.md`, `docs/README.md`, hosted and marketplace guides, `apps/website/`, and reproducible demo and benchmark references.

## Reuse Check

Reuse v1 release and Visual Tour structure, provider conformance and beta scenarios, and existing verification scripts. Keep benchmark fixtures and measurement methods pinned to the release.

## Work Breakdown

| Task | Depends on | Acceptance criteria |
| --- | --- | --- |
| T-290-1 | 2.8.0 | 2, 4 |
| T-290-2 | 2.8.0 | 1, 5 |
| T-290-3 | T-290-1, T-290-2 | 3–6 |
| T-290-4 | T-290-3 | 3–6 |

## Agent Assignment

| Role | Responsibility |
| --- | --- |
| Documentation | Lead release evidence, demo and public updates. |
| Test | Lead benchmark repeatability and clean install. |
| User Validation | Verify first-time onboarding and claims. |
| Accessibility Specialist | Lead accessibility verification. |

## C.1 API Contract Trace

N/A — no API or new product endpoints. Validate links and the documented release workflow against the candidate.

## C.2 Form Completeness Gate

N/A — no new product forms or buttons. Check the release links and any website navigation changes.

## B5 Accessibility

WCAG checks for captions, transcript, semantic comparison tables, descriptive links and keyboard navigation on updated launch content.

## Verification and Closeout

Run `npm run verify-all` and the repository smoke check against the release candidate. Link evidence and deployment checks in the release notes. Publish after launch approval.

## Risk Assessment

An early recording or benchmark can misrepresent the product after beta fixes. Tie published evidence to the frozen release revision and rerun affected scenarios if that revision changes.

## Out of Scope

| Item | Classification | Action |
| --- | --- | --- |
| New product development | Scope boundary | Close functional work before beginning release recording and public benchmarking. |
| Production PLL rollout | Scope boundary | Conditional 2.10.0. |

## Repository preparation

The [release evidence plan](../../../docs/phase-2-release-evidence.md) defines candidate verification, a controlled comparison protocol, the recording sequence and the publication checklist. Recording, benchmark execution and release claims remain gated on beta exit.
