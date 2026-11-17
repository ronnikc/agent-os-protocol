<!-- SPDX-License-Identifier: Apache-2.0 -->

# Sprint 3.7.0 — Pilot, release and rollback

**Status** — Proposed. [Phase 3 plan](README.md).

## Goal

Prove the full Phase 3 workflow independently and release each capability only where its wallet, issuer, chain and operator gates pass.

## Dependencies and affected modules

Use the [promotion matrix](pilot-contract.md#promotion-matrix) for dependencies by capability. The existing-account CMP/App pilot depends on applicable registry, JS integration, consent/access and commerce tests. DTS, retained-factor rCuK, origin-ID device enrollment/total-loss recovery, derived Web3 ID, WordPress and other wallets have separate gates. Full origin-ID product completion requires both 3.1.2 journeys and any applicable native authority activation. Use isolated deployments and test accounts. Production additionally requires applicable approvals, authorized funds and supported release. Maintain health checks, user docs, deployment configuration and changelog.

## Work breakdown

1. From a clean checkout, run a reference presentation through the local/current-protocol issuance service, deploy and verify the account, register and link from CMP and verify the Agent Card. Install through the Agent OS App. Create a scoped delegation and prove x401 access and relay of a recorded human choice. Use local and hosted agent runtimes and a verifier independent of the issuer. Complete one test x402 payment and reconcile it against the chain. Capture versions and scrub all evidence.
2. Exercise a real-device profile for each enabled wallet and issuer in each target environment. Check desktop to mobile handoff, denied/missing fields, accessibility, expired status, capability discovery, and re-entry after losing connectivity. Compare prompt and completion counts and median and tail timings against the agreed pilot target. Distinguish issuer latency, chain finality, stale endpoint readback and first authorized use. Use only synthetic fixtures in committed artifacts.
3. Test the [three-developer shared-lobby case](pilot-contract.md#conformance-and-promotion), transfer, link revocation, expiry, issuer failover, key rotation/recovery, signer shutdown, withdrawal, partial deployment and rollback. Verify consent-before-tracking and subject isolation, including concurrent revocation and shared-budget attempts. Reconcile the original transaction and keep settlements and escrow recovery actionable after disabling new transactions.
4. Exercise Phase 3 without PLL and on the candidate P11 environment when available. Include Local Stack custom genesis, named-to-genesis equivalence, legacy DID resolution, unsupported verifier and connector versions, and mismatched-network rejection at enrollment, registry, proof and payment. Phase 2 owns lock lifecycle tests using matched SDK/node/base. Never activate escrow based on a branch status or availability of Phase 3 identity alone.
5. Introduce isolated capability flags and release gates for verifier profiles, native issuance, registry write, delegation, proof, x402 and Phase 2 escrow. Record evidence per feature. Roll out first to an isolated pilot using approved counterparties and limits. Broad availability waits for approval and failure drills.
6. Run the [rCuK reference](sprint-3.1.1.md) from a clean installation with the old device and its secrets unavailable. Supply the independently retained user factor plus independent authorization. Record restore time, factor and backup dependencies, restored account and Agent ID results, identity-proof readiness and compromise handling separately. Capture traffic for the supported self-hosted routine verification path. Report production recovery status independently.
7. Run the [3.1.2 lifecycle](sprint-3.1.2.md) as separate additional-device and total-loss demonstrations. The loss run has no original device, user kit or exported key. Verify same account/assets/Agent ID, promised identity proof, fresh-device signing and failed old-device signatures. Test private reissuance discovery, partial initial recovery enrollment, per-device revocation and limits, concurrent changes and payer outage. Identify standard-node and candidate-protocol results and approved deployment scope separately.
8. Run the [3.1.3 install-free signer](sprint-3.1.3.md) from a fresh supported browser with no installed Concordium signer or existing session. Complete wallet approval, native account finality and first authorized use. Verify trusted-origin messaging, key/identity-material isolation and reviewed persistence/update behavior. Record prompt counts, unsupported browsers and any installation fallback independently.

## Acceptance criteria

- [ ] A clean environment reproduces the local end-to-end journey with independent chain, registry and x401 verification. CI fixtures and Phase 2 checks run without production credentials or funds.
- [ ] Each enabled wallet and issuer passes the agreed profile matrix and documented sample, completion, fallback, latency, freshness and recovery thresholds. Unapproved capabilities remain disabled with operator-readable reasons.
- [ ] Before enabling a DTS profile, a new user completes real existing-wallet native enrollment and the pilot reports all prompts, repeat capture and sponsor mint. The first-time CMP install-free claim passes 3.1.3 fresh-browser first use and signer security review. Pending evidence leaves that capability gated independently of a passed existing-account deployment.
- [ ] Eligibility works without native enrollment. Report onboarding stages and fallbacks. Independently gate retained-factor rCuK and both origin-ID journeys. Full lifecycle completion requires no-factor same-account recovery, original Agent ID/assets, old-device rejection and promised proof readiness. Document issuer/service, payer, authority/activation and network dependencies. Pending lifecycle results remain visible when other capabilities ship.
- [ ] Access succeeds for approved purpose and fails after expiry, withdrawal where relevant, registry revocation, ownership transfer and key rotation. Evidence shows no unintended human data disclosure.
- [ ] The CMP and App demo shows consent before tracking in JS, distinct authority for three users and their agents, interruption of the removed user's grants only, human review for a new purpose, distinct receipts and downstream withdrawal. WordPress passes the same checks and upgrade/rollback before that package is enabled. Pending WordPress evidence leaves its capability disabled independently.
- [ ] One approved test purchase yields exactly one reconciled settlement. An interrupted flow resumes without an extra charge, and disabling new payments preserves recovery and settlement records.
- [ ] Phase 3 access and payment work without PLL. Legacy and equivalent genesis forms pass on supported counterparties, wrong chains or unsupported mixed versions cannot authorize an operation, and the P11 record lists verified revisions or pending status. Phase 2 retains its own activation and rollback record.
- [ ] Production-native issuance and optional autonomous Concordium credentials stay gated until reviewed. Any requested live transaction has documented approval, limits and finalized evidence.
- [ ] Existing paginated receipts follow R-23, deployed UI error parsing preserves actionable policy-specific messages, and loading/disabled button behavior is covered on desktop and mobile. Published help reflects enabled capabilities.

## User validation and assignments

New operators and site owners complete the documented task from a fresh installation. Reviewers independently check the evidence and rehearse rollback and account recovery on the pilot environment.

| Role | Assignment |
| --- | --- |
| Release Lead and User Validation Specialist | Co-lead release evidence and actual user workflows. |
| Identity, Commerce and Phase 2 owners | Confirm their independent enablement scopes and recovery. |
| Security Specialist and QA | Verify environment gates, key handling, finality and data retention. |
| Accessibility Specialist | Lead end-to-end review across wallet handoff, CMP, access and receipts. |
| I18N Specialist and Product QA Specialist | Review status and error wording and complete real UI workflows. |

## Reuse check

The reuse catalog is absent in this checkout. Reuse `npm run verify-identity`, `npm run verify-commerce`, `npm run verify-hosted` and `npm run verify-launch`, the Phase 2 isolated merchant, existing test tooling and the local issuer fixture. Add cross-service evidence cases covering the new end-to-end workflow.

## C.1 API Contract Trace

N/A for new routes. Exercise any UI against the pinned API traces from 3.1.0–3.5.0, existing commerce endpoints and deployed capabilities. Record verified route, access role, response and evidence in the release workfile.

## C.2 Form Completeness Gate

N/A for new forms. Re-run required/optional field rules, selections, validation and approval behavior for the deployed enrollment, app connection, consent, delegation and receipt flows.

## B5 Accessibility, B6 help, B7 documentation

Verify keyboard, screen reader, focus restoration after wallet requests, status updates and mobile handoff across operator and end-user flows. Update the actual release notes, docs index, installation guide, wallet support matrix, security notes and rollback guide from shipped evidence.

## Out of scope

| Item | Classification | Action |
| --- | --- | --- |
| Network activation by Agent OS | Scope boundary | Use confirmed Concordium activation and the selected node/SDK builds. |
| Phase 2 PLL go-live | Scope boundary | Keep the Phase 2 escrow release checklist and fallback independent. |
| Unapproved full-market rollout | Scope boundary | Deliver the scoped pilot and require explicit authorization for broader production activation. |
