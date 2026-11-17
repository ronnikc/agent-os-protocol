<!-- SPDX-License-Identifier: Apache-2.0 -->

# Sprint 3.6.0 — DTS and Concordium approval package

**Status** — Proposed. [Phase 3 plan](README.md) · [Draft partner proposal](partner-proposal.md).

## Goal

Give DTS and Concordium a reproducible proposal and reviewable changes, with a clear decision on which part can ship alongside P11/PLL.

## Dependencies and affected modules

Start scope and cutoff discovery after [3.0.0](sprint-3.0.0.md). Submit CC-7's current-rule conformance and origin-ID recovery RFC for early review as soon as that evidence is available. Total-loss implementation can depend on approved native changes. This review must not wait for its own successful total-loss demo or the final CMP build. The final pilot package references verified deliverables from 3.1.0–3.5.0 and records each pending capability. Maintain the proposal, evidence manifest and change briefs in Agent OS. A production-intended node branch requires the approved protocol scope.

## Work breakdown

1. Use the draft partner proposal to request named reviewers and decisions with the owner's authorization. For DTS, agree on an issuer and credential profile, assurance and supplemental checks, signed status or other supported status behavior, a claim mapping with provenance and fallback, the protected handoff, supported recovery, incident contact, test environment and production approval process.
2. For Concordium, request approval of the standard issuer/account path, review routing for CC-1–3, and the release cutoff. Show the P11 SDK/PLL work already present and propose a coordinated release if the compatibility and maintainer review fits. Ask for a confirmed target node/SDK release and testnet activation mechanism. Review measured time to finality, readback and first authorized use before considering any node sync work. Keep escrows under Phase 2 ownership.
3. Prepare code, tests and reviewable PRs from the [delivery plan](delivery.md), [Concordium specs](concordium.md) and [AesirX specs](aesirx-cmp.md). Each needs a base revision, test commands, API compatibility notes, rollout, rollback and evidence. Keep the [DTS approval](dts.md) packet separate. Verify the cross-repo run from a clean checkout with synthetic or explicitly permitted credentials. Mark each [risk register entry](risk-and-gaps-register.md) with its evidence or remaining decision.
4. Document why the reference DTS issuance path uses the existing protocol. Prepare the origin-ID recovery-only authority RFC independently of any direct external-proof admission RFC. Specify trust, deterministic inputs, domain separation, privacy/disclosure, costs, recovery-policy governance, state migration, compatibility and activation for each. For recovery, specify index-0 signing replacement, fresh credential/proof material, concurrent attempts, indirect quorum takeover and a payer. Obtain an agreed protocol design and review/activation path before production-intended [3.6.1](sprint-3.6.1.md) code. Seek PLL release coordination early without requiring a slot to prepare local conformance or the RFC.
5. Independently review partner-facing claims against evidence. Record green, gated and rejected decisions with decision owner and reason. If an upgrade slot is unavailable, keep product work on the existing protocol and carry any approved consensus proposal separately.
6. Prepare CC-6 from [3.1.1](sprint-3.1.1.md) for SDK or wallet reviewers, including supported import, restoration of signing keys versus identity objects, factor and commitment model, and dependencies. Request a maintainer opinion on demonstrated compatibility gaps and any separate wallet PR. Keep rollout and wallet vendor approval independent.
7. Prepare CC-7 from [3.1.2](sprint-3.1.2.md), including current-node constraints and proposed recovery-only authority. Request DTS's private continuity/discovery and reissuance decision. Record real authorizer operators, quorum, compromise/availability and issuer-transition controls. Account separately for registry sponsor coverage and device/recovery fee funding. Present second-device and total-loss evidence independently as it becomes available.

## Acceptance criteria

- [ ] The approved-to-share package contains the clean local demo, wire contracts and diagrams, signed release artifact references or checksums, negative test evidence, threat/data review, license boundaries and a rollback runbook.
- [ ] The local proof-to-native-account, account-to-CIS-8004, access and optional settlement steps reproduce with documented commands on pinned revisions.
- [ ] The proposal has named owners for issuer approval, SDK/demo review, release scheduling and any protocol decision. Status explicitly distinguishes requests submitted, decisions recorded, and production approval.
- [ ] The DTS decision covers exact credential/assurance for issuance, identity and retention obligations, and the private continuity/discovery, reissuance, dispute and issuer-transition requirements for origin-ID recovery. Record approved and pending operators and profiles independently.
- [ ] The partner packet contains observed wallet prompts, repeat capture and latency stages. It tracks the full origin-ID lifecycle as a product target with its own release gate and leaves it pending until both journeys pass. Existing-account CMP/App, retained-factor and issuance evidence retain their own gates.
- [ ] A recorded DTS profile and handoff review and an SDK maintainer outcome identify approved interfaces or open gaps. Record Base and SDK release and counterparty compatibility. A coordinated release claim requires a confirmed scope and release decision. No feature is treated as included based solely on development PRs.
- [ ] Every prepared PR has a scoped base and a validation plan. Upstream submissions occur only after the owner directs them. N/A for R-23 pagination, browser error parsing and button loading state because this sprint adds no browser UI or API.
- [ ] Concordium's derived-credential review records issuer and wallet support, visible chain identifiers, how it could serve as issuance evidence, and what would need a separate change to account deployment or registry authority.
- [ ] CC-7 has an independently runnable current-node reproduction and separately scoped recovery RFC. The decision records exact authority, index-0 replacement, proof readiness, compromise power, payer and activation questions. Early protocol review can proceed before implementation of the missing recovery mechanism.

## User validation and assignments

DTS and Concordium reviewers can reproduce the demo and make scoped decisions from the packet. An Agent OS maintainer can turn the decision into explicit rollout gates.

| Role | Assignment |
| --- | --- |
| Architecture Lead and User Validation Specialist | Co-lead the partner and operator evidence. |
| Security Specialist and Protocol Engineer | Review the proposed trust path, upgrade eligibility and RFC. |
| Accessibility Specialist | Lead review of captured user experience evidence and demo documentation. |
| AesirX and Agent OS maintainers | Review patch boundaries and the requested submission order. |

## Reuse check

The reuse catalog is absent in this checkout. Reuse the JS SDK and Local Stack tests, Phase 2 compatibility/reconciliation evidence, sprint outputs and the existing AesirX flows. The partner decision and PR cross-reference are new planning records.

## C.1 API Contract Trace

N/A. This sprint proposes no new API endpoints. Include versioned copies or links to previously verified API traces in its evidence.

## C.2 Form Completeness Gate

N/A. This sprint introduces no forms.

## B5 Accessibility, B6 help, B7 documentation

Review the human enrollment and consent demo for accessibility and provide a text walkthrough of each approval and failure state. Keep the exact decision history, versions, approvals and reproduction steps in the Agent OS Phase 3 folder.

## Out of scope

| Item | Classification | Action |
| --- | --- | --- |
| Implementing a speculative node change | Scope boundary | Submit a design only if needed, and use agreed governance and network rollout before any production node work. |
| Partner contact or PR submission without instruction | Scope boundary | Prepare in Agent OS and wait for the owner's external submission decision. |
| Turning on escrow | Scope boundary | Phase 2 owns its enablement and verification. |
