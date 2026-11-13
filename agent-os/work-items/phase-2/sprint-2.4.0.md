---
id: 2.4.0
title: Marketplace Discovery Bidding and Hiring
phase: phase-2
status: planned
owner: backend
---

# Sprint 2.4.0 - Marketplace Discovery Bidding and Hiring

## Tasks
- [ ] T-240-1 Define marketplace state models and preview migration (priority:high, assignee:backend)
- [ ] T-240-2 Implement discovery eligibility terms acceptance and single hire dispatch (priority:high, assignee:backend)
- [ ] T-240-3 Build catalog listing bid and agreement review views (priority:high, assignee:frontend)
- [ ] T-240-4 Verify migration permissions version races and buyer walkthrough (priority:high, assignee:test)

**Phase:** [Phase 2](README.md)
**Status:** planned
**Created:** 2026-11-13
**Priority:** High

## Goal

Let buyers discover verified specialists, agree terms with their owners and create a single authorized lobby assignment.

## Dependencies

Phase 1 Marketplace preview and Concordium registry verifier, plus the lobby roles and workspace policy in [2.1.0](sprint-2.1.0.md).

## Acceptance Criteria

1. In an invite-only catalog, a verified owner publishes, updates, unpublishes or suspends a specialist profile with Agent ID, skills, supported runtimes, availability and work samples. Buyers can filter and paginate by capability and runtime. Distinguish identity, capabilities and delivery evidence in the profile.
2. A buyer publishes a structured listing containing the deliverable, acceptance checks, repository or artifact scope, deadline and a zero-price or explicitly gated paid quote. A specialist owner submits, updates or withdraws a versioned bid with price, asset where relevant, turnaround, prerequisites and assumptions. Competing bidders see only information allowed by the listing policy.
3. Use separate catalog, listing, bid, agreement and assignment identities. Listings support draft, open, hired, cancelled and expired. Bids support submitted, withdrawn, selected and declined. Preserve the terms accepted by both authenticated owners as an immutable version. Reapproval is required after a scope, deadline or price change.
4. Derive actor and lobby scope server-side from the authenticated session and verify active registry ownership on publish, bid and hire. A role or registry change blocks new commitments. Administrative moderation and signed authorization references appear in the event history.
5. Hiring atomically selects one eligible bid and creates one agreement linked to one directed coordinator assignment through a durable handoff. Concurrent selections and retries leave one winner. A hired specialist gets only the scoped access authorized by the buyer.
6. Migrate existing preview records with compatibility reads and preserve legacy wallet-signed messages as authorization history. A preview signature never transitions a listing to paid or funded. Document rollback and keep ordinary coordinator task behavior intact.
7. Unwrap paginated search and bid results (R-23), use error parsing for invalid state and stale terms, and show a disabled saving button state while publish, withdraw or hire is pending.

## Marketplace records and permissions

| Record | Required identity and access | Version and handoff |
| --- | --- | --- |
| Specialist profile | Active Agent ID, authenticated specialist owner and publication consent. Public profile fields are explicitly selected. | Preserve profile provenance. Recheck ownership at offer and hire. Suspend discovery when verification lapses. |
| Listing | Buyer identity, target lobby and intended audience. Private source links and acceptance artifacts are visible only to authorized participants. | Edits update a listing version. Material edits invalidate consent to the previous offer. Closing a listing prevents new bids. |
| Bid | Verified specialist owner and agent, listing version, offer, runtime requirements and expiry. | A withdrawn, expired or superseded bid cannot be hired. Store quoted amounts as integers in atomic units with explicit asset and network where relevant. |
| Agreement | Both owners consent to the same selected bid and scope version. Store actor, acceptance time and terms digest. | Pin one agreement per successful hire and use its identifier as the assignment idempotency key. No task access before approval and policy checks. |

## User Validation

An external specialist owner makes a profile discoverable and submits a bid. A buyer compares offers, approves a specific version and sees the corresponding named task.

## Affected Modules

`packages/lobby-server/src/models.ts`, `store.ts`, `server.ts`, lobby coordinator and registry verifier, `packages/protocol-core/src/`, `apps/lobby-web/`, `agent-os-panel/tabs/tasks.js`, `agent-os/scripts/verify-lobby.ts`, and a marketplace onboarding guide under `docs/`.

## Reuse Check

Reuse `MarketplaceTask` and `TaskBid` for migration, the existing Marketplace view for navigation, CIS-8004 verification, `LobbyTask` for dispatch and lobby events for audit. Add agreements and versioned bids to preserve accepted terms independently of mutable preview fields.

## Work Breakdown

| Task | Depends on | Acceptance criteria |
| --- | --- | --- |
| T-240-1 | 2.1.0 | 1–4, 6 |
| T-240-2 | T-240-1 | 1–6 |
| T-240-3 | T-240-2 | 1–4, 7 |
| T-240-4 | T-240-2, T-240-3 | 1–7 |

## Agent Assignment

| Role | Responsibility |
| --- | --- |
| Backend | Lead data migration, state transitions and coordinator handoff. |
| Frontend | Own buyer and specialist flows. |
| User Validation and Test | Review marketplace consent, clarity and race conditions. |
| Accessibility Specialist | Lead accessibility verification. |

## C.1 API Contract Trace

Trace the shared lobby `/tasks` mount and Marketplace handlers in `server.ts` and their callers in `apps/lobby-web/app.js`. Document dedicated marketplace routes or unambiguous backwards-compatible contracts, including authorization, version conflicts, pagination and assignment status, before updating the clients.

## C.2 Form Completeness Gate

Use selectors for verified agent, lobby, repository and runtime references. Match backend validation for scope, deadline, acceptance checks and quote fields. Present the exact terms before each owner accepts.

## B5 Accessibility

WCAG checks for catalog search and filters, labelled listing and bid inputs, accessible version comparison, keyboard agreement review and focus management.

## Verification and Closeout

Run `npm run verify-lobby`, `npm run verify-identity` and `npm run verify-ui`. Verify legacy listings, wallet ownership changes, double hire, failed dispatch recovery and continued operation of ordinary lobby assignments.

| Criterion | Evidence |
| --- | --- |
| 1 | Private-lobby beta flag and session gate. Catalog fixture covers capability/runtime filtering and removes discovery eligibility when registry verification lapses. |
| 2–3 | Listing and bid records have independent versions. Terms include scope, deadline, checks, expiry and turnaround. The beta accepts only zero-price terms. The buyer sees competing offers and other bidders see their own. |
| 4 | Session-derived actors and lobby scope, current manager checks, active registry ownership checks for specialists and an audited consent digest. |
| 5 | The lobby fixture races two hires, interrupts dispatch, restarts the store and retries the same agreement. It observes one assignment and one successful retry handoff. |
| 6 | Preview records and signatures survive restart and appear as historical references. No compatibility read funds a beta agreement. Rollback and route contracts are documented in the marketplace onboarding guide. |
| 7 | Catalog, listing and bid pages unwrap `data`, use shared request error handling, and disable buttons during mutations. Browser accessibility and external buyer walkthroughs remain to be validated. |

## Risk Assessment

A request retry could otherwise create a second assignment or commit stale terms. Use one transactional hire decision, version checks and an idempotent assignment handoff.

## Out of Scope

| Item | Classification | Action |
| --- | --- | --- |
| Delivery, revisions and disputes | Scope boundary | Covered by 2.5.0. |
| Real funds and escrow | Scope boundary | Covered by the commerce and conditional PLL specs. |
