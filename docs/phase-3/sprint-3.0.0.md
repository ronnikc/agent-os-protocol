<!-- SPDX-License-Identifier: Apache-2.0 -->

# Sprint 3.0.0 — Baselines and protocol fit

**Status** — Proposed. [Phase 3 plan](README.md).

## Goal

Establish the verified starting point for wallet enrollment, Agent ID, commerce, and P11 coordination so first-party work can proceed with a documented partner decision path.

## Dependencies and affected modules

Read Phase 2 release gates, current x401/x402 documentation, registry references, the three AesirX repositories, and the Concordium JS SDK, Base, Node, and Local Stack. Record baselines, proposed interfaces, decisions and sanitized evidence under Phase 3. No production service changes are needed for this sprint.

## Work breakdown

1. Create a capability matrix with exact source commit, package version, chain ID, supported issuer and claim profile, status mechanism, browser and target environment. Mark separately what is documented, inspected, locally reproduced, independently verified and approved for production.
2. Trace current code from Apps and wallet sign-in to the lobby, MCP registry, merchant, and proof/signing services. Confirm the wallet and connector methods actually present for age, deployment and signing. Map evidence and license boundaries in AesirX, including the Google backend owner and whether its existing production approval covers the pilot.
3. Separate EU age attestation, EUDI PID and other identity evidence. Identify one candidate Member State issuer and wallet plus Google and Apple candidates. Record exact required attributes, status and issuer roots, production reader or relying-party requirements, device and signer UX, and distinct eligibility, Concordium-derived credential and native issuance gates.
4. Pin a candidate PLL SDK/node/base baseline. Trace the high-level Lock client, supported query and lifecycle surfaces, and expiry changes. Record branch, PR and tag states, the proposed test environment, and what still needs maintainer confirmation. Use the Phase 2 owner’s evidence for escrow status.
5. Prepare the current-protocol DTS issuance release path with SDK/reference-provider delivery aligned with PLL where possible. Prepare separately scoped native recovery-only authority and direct external-proof admission proposals when needed. Record the release cutoff question, decisions needed, and fallback when inclusion is unavailable. Start CC-7 credential-rule reproduction and recovery RFC after early feasibility so its review can run alongside the CMP build.
6. Define a timing and prompt baseline for the existing onboarding and proposed wallet flow. Separate issuer time, deployment finality, first verified account readback, first authorized use and a lagging or bootstrapping node. Record what must be measured on current builds before taking any HotSync proposal upstream.
7. Freeze the [pilot contract](pilot-contract.md) in AO-1A, including signed x401/OpenID4VP, authority and controller-subject binding, cross-service revocation, and exact contract ownership. Publish reusable schema and versioned, executable conformance fixtures as the first mergeable PR. Keep enrollment UX and signer changes in AO-1B. Use the repository placement in the [AesirX specs](aesirx-cmp.md).
8. Record the local user-controlled signer and inspect reusable install-free browser signers for [3.1.3](sprint-3.1.3.md). Cover key/identity storage, origin/message authorization, wallet return, updates and recovery threats. Agree the native issuer handoff, relying-party topology and profile. Keep live signer/issuer decisions pending review. Record verified genesis and canonical chain reference and pin compatible SDK/Base/node revisions. Track [Base #986](https://github.com/Concordium/concordium-base/pull/986) and [SDK #711](https://github.com/Concordium/concordium-node-sdk-js/pull/711) separately from release/deployment.
9. For [3.1.1](sprint-3.1.1.md), select the SDK signer restore format and document the wallet import/export matrix. Threat-model surviving user-factor custody, trustee collusion, backup discovery and availability, latest authorized policy, signer compromise and supported post-restore actions. Define the self-hosted network trace used to distinguish routine verification from enrollment, recovery and reissuance.
10. Freeze the [3.1.2 lifecycle contract](origin-id-lifecycle.md) with private continuity/discovery, action/key/account/epoch binding, account-authority fingerprint for dependent grants, races, proof readiness and payer rules. Separate device addition, total-loss and retained-factor results. Inspect initial-credential/old-signature constraints, service signer powers and key/credential limits. Pin source revisions and require CC-7 node reproduction.

## Acceptance criteria

- [ ] The matrix links the pinned SDK/base and AesirX sources, exact x401/x402 baselines, lock PRs, and current network activation evidence or its absence.
- [ ] At least one test credential and its supported verifier route are selected. The production EUDI PID and EU age profiles have distinct issuer and claim requirements.
- [ ] The EUDI, Google Wallet and Apple Wallet matrix covers one-approval issuance candidates and eligibility profiles, with the open approval decisions and a fixture path for each supported format.
- [ ] The baseline accounts for legacy wallet sign-in, the current CMP ID App verifier, Google backend discovery, current public badge format and existing x401 and x402 QA artifacts.
- [ ] A release decision record distinguishes current-protocol issuance, separately scoped native recovery and external-proof admission, and Phase 2 PLL activation. It routes early CC-7 review without waiting for the final CMP pilot.
- [ ] The risk and evidence lists include signer custody, evidence-to-account binding, issuer validation, licensing, data retention and approval counts. The rCuK decision names the mandatory user factor and the cryptographic policy review, compatibility matrix, restore test and routine-verification network trace.
- [ ] The baseline defines sample counts, timing boundaries, completion and fallback outcomes, and how to capture repeat document scans. Historical estimates are labelled separately from measured data.
- [ ] AO-1A is independently mergeable with versioned contracts and executable fixtures, including lifecycle continuity, target binding, concurrency, expiry, discovery and payer outcomes. The EUDI reference wallet, PID issuer and verifier pass the chosen profile round trip. Freeze authority and revocation behavior and signer handoff. Record live-profile approval separately.
- [ ] Named and equivalent genesis-prefix references resolve to the same verified network with a compatible SDK. Wrong or malformed network values cannot authorize enrollment, registry actions, proof or payment. Custom Local Stack and legacy DID compatibility pass against documented revisions, with production genesis form gated on counterparty support.
- [ ] N/A for pagination (R-23), browser error parsing and button loading state because this sprint introduces no API or frontend.

## User validation and assignments

The User Validation Specialist reviews expected flows for a first-time EUDI holder, existing Concordium owner, site operator and DTS/Concordium reviewers against the evidence map.

| Role | Assignment |
| --- | --- |
| Planning Lead and User Validation Specialist | Co-lead. Establish personas, use cases and evidence. |
| Security Specialist | Review trust, key custody and release boundaries. |
| Accessibility Specialist | Lead accessibility requirements for the future cross-device flow. No UI changes in this sprint. |

## Reuse check

The planning checkout has no reuse catalog. Reuse the Phase 2 baseline, hosted Apps and wallet sign-in sources, AesirX verifier, and existing compatibility checks. The combined revision and assurance matrix has no existing counterpart and belongs in the Phase 3 evidence.

## C.1 API Contract Trace

N/A. Trace current routes as reference inputs. This sprint adds no API or endpoints.

## C.2 Form Completeness Gate

N/A. This sprint adds no forms.

## B5 Accessibility, B6 help, B7 documentation

Plan WCAG 2.1 AA keyboard operation, wallet return focus, readable mobile status, and an equivalent handoff where QR scanning is unavailable. The output for this sprint is a planning and reviewer packet.

## Out of scope

| Item | Classification | Action |
| --- | --- | --- |
| Escrow implementation | Scope boundary | Keep implementation and activation in Phase 2 Sprint 7. |
| Sending partner materials or opening PRs | Scope boundary | Prepare materials in Agent OS for owner review and later authorization. |
