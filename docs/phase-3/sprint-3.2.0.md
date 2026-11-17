<!-- SPDX-License-Identifier: Apache-2.0 -->

# Sprint 3.2.0 — Wallet verification and Concordium-derived credentials

**Status** — Proposed. [Phase 3 plan](README.md).

## Goal

Verify supported wallet claims and prototype a Concordium Web3 ID credential derived from approved external wallet evidence.

## Dependencies and affected modules

Requires [3.0.0](sprint-3.0.0.md). Coordinate fixture and evidence types with [3.1.0](sprint-3.1.0.md). Candidate changes are shared types, lobby verification and policy, a wallet selection and return flow in the hosted lobby, tests, AesirX Consent and the verifier facade. External test dependencies are an EU reference wallet/issuer, a national wallet for real-device validation, Google sandbox or approved integration, and Apple reader credentials for production.

## Work breakdown

1. Define typed proof requests and results. Track credential profile, issuer or trust policy, claim type, exact predicate outcome, assurance, expiry/status source, purpose and enrollment binding. Avoid storing raw presentations, government identifiers and claims that were not requested. Keep evidence at the verifier and access decisions in the relying party's authorized store.
2. Reuse the AesirX verifier facade for Concordium ID App. Pin the exact SDK/connector methods, use the wallet's response only through backend verification, and check the stored request, context, predicate and session. Reuse the browser wallet presentation API with the same server verdict contract.
3. Add EU age verification against the EU reference implementation, then validate one national wallet. Add one EUDI PID path with issuer trust and status checks. Track mdoc, SD-JWT and experimental ZK profiles explicitly. Keep PID evidence eligible for DTS evaluation and age-only evidence eligible for an age rule.
4. Verify the existing Google Wallet backend's proof profile and approved origin/use before reuse. Implement the integration seam for Google using its documented OpenID4VP profile and test Longfellow only where the credential supports the requested predicate. Implement Apple's mdoc route with reader authentication and capability-gate it. Extend new wallets by format and issuer, using one fixture for an additional adapter to demonstrate the seam.
5. Build the [Concordium-derived credential prototype](product-contracts.md#concordium-derived-credential-prototype). Use a local Web3 ID issuer and CIS-4 registry to test verified external evidence, holder-key proof, signed claims, wallet presentation, expiry and revocation. Record whether the supported signer and wallet can use the credential without requiring an ID App install. Prepare a provider-neutral Concordium example patch from this prototype.
6. Use single-use requests bound to the authenticated relying party, origin, tenant, action, policy and expiry. Where profile-compatible, refresh signed shared status artifacts independently of user requests and test their validity and maximum acceptable age. Document required online checks and residual correlation. A verified age predicate must not require extra identity disclosure for native issuance unless the operator separately opts in.
7. Apply the [pilot relying-party model](pilot-contract.md#pilot-scope-and-relying-parties). Pin site, registration or certificate owner, trusted origin, tenant, allowed attributes, callback and issuer permissions. Reuse compatible SDK DID handling for Web3 ID and keep named network output where a verifier or wallet lacks genesis-form support.
8. Provide a test recovery evidence profile for [3.1.1](sprint-3.1.1.md). Verify accepted claims and freshness without treating the original predicate or any CIS-4 credential as release authority. Record privacy and network dependencies and exercise a supported self-hosted path with no per-presentation callback to origin issuers or an upstream AesirX service.
9. Share synthetic same-person continuity fixtures with AX-1C and [3.1.2](sprint-3.1.2.md). Reissue to a different holder key and credential identifier. Distinguish revoked lost credential, active replacement and disabled enrollment. A profile's eligibility success does not enable continuity or recovery. Require an approved bridge for a changed issuer and test unsupported transitions explicitly.

## Acceptance criteria

- [ ] Existing Concordium Wallet and ID App produce verified server outcomes for the requested age and nationality policies. Declined or invalid results never grant access.
- [ ] EU age reference fixtures and one actual national-wallet profile exercise the permissioned age path, or that wallet remains explicitly disabled with the exact blocker. The EUDI PID fixture follows a separate policy and only eligible evidence reaches the issuer handoff.
- [ ] Google test requests prove the configured credential and format, or the adapter remains disabled with a documented prerequisite. Tests cover the difference between nationality, issuing country and residence. Apple verifies tested mdoc responses or remains disabled pending reader credentials; capability labels follow actual verification.
- [ ] Replay, audience/origin mismatch, wrong tenant or callback, wrong genesis, substituted claims, stale issuer status, revoked issuer, wrong holder and unexpected proof configuration are rejected. Verify named-network compatibility and reject a new DID form on unsupported counterparts. Continuity fixtures distinguish same-person reissuance, disabled enrollment, unrelated identity and an issuer change without an approved bridge.
- [ ] Session data and logs contain only the allowed verdict metadata. Withdrawal or expiry terminates any scoped credential that depends on the session.
- [ ] A local Concordium Web3 ID issuer can issue a fixture credential based on a verified external wallet claim. An independent verifier accepts only the holder and requested claims and rejects expired or revoked credentials. Record what is public and the observed wallet requirements.
- [ ] A one-time eligibility check completes without credential issuance. A derived-credential test never reports a native account or grants CIS-8004 ownership. The evidence lists what would require a distinct issuer, wallet, registry or protocol change.
- [ ] Where cached signed status is supported, a normal visit generates no per-credential issuer call. Tests reject stale or rolled-back snapshots and cross-site reuse, and record the behavior of profiles that require another status method.
- [ ] R-23 pagination is N/A for a single verification operation and an unpaginated capability list. Error parsing maps stable verdict codes, and each wallet button has loading/disabled states with an accessible fallback.

## User validation and assignments

A wallet holder knows the exact information requested and can select, cancel, retry, or see why a capability is unavailable. A site operator can reproduce which profiles satisfy a rule.

| Role | Assignment |
| --- | --- |
| Identity Engineering Lead and User Validation Specialist | Co-lead profile and policy verification. |
| Security Specialist and QA | Review trust sources, verifier inputs, retention and negative vectors. |
| Accessibility Specialist | Lead wallet picker, mobile handoff and error presentation review. |
| I18N Specialist and Product QA Specialist | Review translated claims/status and real device usability. |

## Reuse check

The reuse catalog is absent in this checkout. Reuse AesirX's ID App hook/facade, Google browser handoff, EU reference verifiers, the already used Concordium SDK, and lobby policy/state patterns. A shared issuer/profile policy contract is needed because the existing registry verifier resolves agent records and does not validate third-party presentations.

## C.1 API Contract Trace

Proposed lobby mount is `/api/v1/agent-lobby`. Trace the final routes, auth and request schema in the workfile. Use an authenticated internal facade for upstream verifier results.

| Route | Contract |
| --- | --- |
| `GET /api/v1/agent-lobby/wallet-capabilities` | Intended lobby and operation return an unpaginated list of profiles and supported claims. |
| `POST /api/v1/agent-lobby/wallet-presentations` | Server selects allowable profile and policy for session. Returns one signed or otherwise profile-compliant request and expiry. |
| `GET /api/v1/agent-lobby/wallet-presentations/:id` | Same tenant and flow authorization. Returns redacted verdict, claim type and expiry. Provider callbacks validate issuer transport and persisted session before committing results. |

The local Concordium Web3 ID issuer example reuses the upstream issue, status and revoke methods. Bind test issuance to the verified session and holder key and document the checked claim, issuer policy and registered status.

## C.2 Form Completeness Gate

Wallet, issuer profile and claim choices come from the backend. Consent or purpose preview matches the server's request. Disable repeated clicks and restore state after return. Country policies show the actual claim, with constrained country and threshold input.

## B5 Accessibility, B6 help, B7 documentation

Check keyboard focus and provider choice, screen-reader status, text alternatives to wallet logos and readable claim semantics. Publish wallet/device matrices, reference setup, production prerequisites, and how to recover from a failed handoff.

## Out of scope

| Item | Classification | Action |
| --- | --- | --- |
| Generalized proof-of-identity from arbitrary ZKP formats | Scope boundary | Approve adapters by credential, scheme and issuer; use a fixture to prove extensibility. |
| Direct use of age-only evidence for native issuance | Scope boundary | Evaluate native profile acceptance with DTS in 3.6.0. |
| Apple or Google production enablement without relying-party credentials | Scope boundary | Keep profile gated, with evidence tracked in 3.7.0. |
