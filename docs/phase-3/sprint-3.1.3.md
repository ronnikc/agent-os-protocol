<!-- SPDX-License-Identifier: Apache-2.0 -->

# Sprint 3.1.3 — Install-free CMP signer

**Status** — Proposed production-path candidate. [Phase 3 plan](README.md). Local test credentials can be used before production signer review.

## Goal

Let a first-time CMP visitor use an existing identity wallet to create and control a native Concordium account through a supported browser journey with no additional wallet application installation and no manual seed/private-key handling.

## Dependencies and affected modules

Use [3.0.0](sprint-3.0.0.md) contracts and capability matrix, [3.1.0](sprint-3.1.0.md) standard issuance and signer interface, and [3.1.2](sprint-3.1.2.md) device/recovery authority and continuity. The browser candidate can demonstrate issuance and device-local use before native total-loss recovery is approved. Its promised recovery mode must be accurately disclosed. Coordinate the AX-WebSigner package in AesirX Consent with AX-2A/C and the optional Agent OS App. Record the exact package path and host configuration after inspecting the target repository revision. Keep portable protocol types in AO-1A.

## Work breakdown

1. Reuse an existing compatible signer/SDK where source, license, browser support, signing and recovery meet the contract. Pin the selected implementation and audit surface. Otherwise implement the bounded web signer using Concordium's standard SDK behind the existing signer interface. The separate local signer remains available for its own reference tests.
2. Serve the browser candidate on a dedicated signer origin and use a top-level trusted signer surface for enrollment and sensitive approvals. Generate device keys and identity secrets within that origin. Keep SDK secret processing in its memory and approved encrypted persistence. Evaluate Web Crypto key storage, recovery and any SDK requirement for raw secret bytes. A non-extractable key still permits signing by code executing in its origin. Review that authority explicitly.
3. Accept messages only from exact registered parent origins and protected sessions. Bind request, issuer, genesis, intent, target keys, method/payload and one-time challenge. Apply the same target-signer pairing and substitution tests as 3.1.0. Keep account and identity secrets outside the merchant page, CMP backend, lobby and agent runtime. Restrict the signing interface to approved operations and require the appropriate human approval. A connected agent cannot request arbitrary signatures.
4. Pin signer assets and dependency versions, prevent unapproved third-party script execution, and specify CSP, framing/opener isolation, update control, storage encryption/unlock and session expiry. Model signer-origin compromise, malicious merchant messages, browser extensions, storage deletion, device theft and mobile browser limits. Compare a popup/top-level return and accessible cross-device fallback on the selected browsers.
5. Implement a cold-browser CMP flow from no Concordium signer through wallet approval, DTS/test issuance, account finality and a user-authorized first operation. Record every signer, wallet and issuer prompt. Offer Agent ID registration as a separate explicit approval. Show pending recovery enrollment and restricted proof readiness truthfully. A fallback that needs an installation is reported separately from the install-free result.
6. Exercise the same web signer on a second device and after clearing all original browser storage under 3.1.2. Reuse the origin identity and approved account authority. Keep retained-factor and native total-loss outcomes separate. Test upgrade and rollback of signer assets without losing supported access or exposing material to an old incompatible client.

## Acceptance criteria

- [ ] AX-WebSigner has a pinned source/license and package/hosting decision with signer-origin data flow, key-storage behavior and an independent security review plan. Synthetic code can merge disabled while production review is pending.
- [ ] A fresh supported browser with no Concordium wallet/app/local signer installed completes the reference-wallet presentation, native test account deployment and authorized first use. Independent readback verifies the account. Record wallet approval, all other prompts and fallbacks separately.
- [ ] Wrong parent origin, merchant, session, key, account, genesis, request digest, altered callback, replay and an agent-requested arbitrary signature fail. No secret or raw identity material reaches the merchant, lobby, CMP telemetry or shared fixtures.
- [ ] The selected browser/device matrix covers mobile handoff, popup restrictions, interruption, storage limits/deletion, unlock/session expiry and accessibility. An unsupported environment displays an accurate capability and separately reviewed fallback.
- [ ] A clean second browser and a total-storage-loss fixture execute the 3.1.2 journeys only under their approved authority. Recovery setup, account signing, identity-proof readiness, original account/Agent ID and old-device revocation have independent results. Pending native recovery leaves that capability gated.
- [ ] Signer update and rollback preserve compatible access and secret isolation. Current deployment approval covers asset/dependency integrity, approved origins, custody, identity-material persistence, compromise response and the recovery mode actually promised to users.
- [ ] R-23 pagination is N/A for signer requests/status. Error parsing identifies unsupported signer, denied approval, pending finality and unavailable recovery. Continue/sign/retry controls have loading/disabled states and safe duplicate handling.

## User validation and assignments

A first-time website visitor begins with their existing identity wallet and a fresh supported browser. They complete or decline native onboarding, inspect who holds signing authority, then approve an Agent ID separately. Reviewers count the actual prompts and reproduce a fresh-browser return.

| Role | Assignment |
| --- | --- |
| Wallet Engineering Lead and User Validation Specialist | Co-lead signer reuse, first-time visitor and device-loss journeys. |
| AesirX CMP Maintainer and Security Specialist | Review origin isolation, message authorization, key processing, dependencies and asset update authority. |
| Accessibility Specialist | Lead trusted-surface handoff, popup/return, focus and non-QR alternatives. |
| I18N Specialist and Product QA Specialist | Review supported browsers, prompt counts, recovery status and failure wording. |

## Reuse check

The reuse catalog is absent in this checkout. Reuse standard Concordium SDK issuance/signing APIs, 3.1.0 signer contracts, 3.1.2 lifecycle fixtures and existing AesirX wallet-return UX. Inspect compatible existing web signers before adding new implementation. The current separate-process reference does not establish the first-time install-free browser outcome.

## C.1 API Contract Trace

AO-1A versions the signer capability, pairing, create-request, approved-sign, public-status and lifecycle interfaces. AX-WebSigner implements those inside its approved origin. AX-2A/C uses authenticated request/response binding and receives public references and redacted status. Pin actual messages, endpoint mounts, destination allowlist and errors before wiring the merchant UI. Reuse the issuer and lifecycle service contracts.

## C.2 Form Completeness Gate

Show relying party, selected network, requested operation, relevant disclosure, account/device and current recovery capability before approval. Obtain session and key binding through the flow. Prevent duplicate signing. Return focus and preserve an actionable pending/denied state after wallet or signer return.

## B5 Accessibility, B6 help, B7 documentation

Test keyboard and screen-reader operation, top-level origin recognition, focus restoration and mobile return. Document supported browser storage, account/device controls, real recovery availability, signer update ownership and installation fallback.

## Out of scope

| Item | Classification | Action |
| --- | --- | --- |
| Automatic support in every browser or third-party wallet | Scope boundary | Enable only the tested supported matrix and negotiate capabilities explicitly. |
| Production authority from a synthetic recovery demo | Scope boundary | Use 3.1.2, partner review and applicable 3.6.1 activation for the actual recovery claim. |
| Custody of user account keys in the lobby or CMP service | Scope boundary | Key processing stays in the approved user signer. A service custody alternative requires its own decision. |
