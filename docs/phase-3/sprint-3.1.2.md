<!-- SPDX-License-Identifier: Apache-2.0 -->

# Sprint 3.1.2 — Origin-ID device enrollment and recovery

**Status** — Phase 3 product target. Local feasibility work can proceed with test credentials. Real user activation requires approved issuer continuity evidence and enforceable account authorization. The [lifecycle design](origin-id-lifecycle.md) specifies current constraints and the native recovery-only authority candidate. The retained-factor reference has separate criteria.

## Goal

Let someone who enrolled a Concordium account using an existing identity wallet reuse that origin identity to add another device or regain access to the same account after device loss without entering or exporting a seed phrase or private key.

## Dependencies and affected modules

Use [3.0.0](sprint-3.0.0.md) lifecycle fixtures, [3.1.0](sprint-3.1.0.md) for the local signer and standard account path, and [3.2.0](sprint-3.2.0.md) for wallet evidence. Reuse compatible 3.1.1 fixtures independently. Use [3.3.0](sprint-3.3.0.md) for Agent ID continuity. AO-DeviceLifecycle, AX-1C, AX-2C and CC-7 own the changes in the [delivery map](origin-id-lifecycle.md#cross-repository-delivery-and-closure-evidence). Test EUDI first. Google and Apple each need separate evidence. Prepare CC-7 conformance and RFC early. An approved native implementation in conditional 3.6.1 can be a dependency of the total-loss pass result without blocking current-rule feasibility or device-add work.

## Work breakdown

1. During existing-wallet onboarding, let the user opt in to origin-ID device enrollment and recovery. Bind the approved issuer's recovery-scoped continuity reference and authority policy to the newly created account under the user's consent. Make the enrollment discoverable through the approved issuer on a new device. Keep the person-to-account mapping private. Report extra approval prompts separately from the one wallet presentation target.
2. Use a fresh presentation from the original or replacement identity wallet. Confirm the same enrolled person, current issuer trust and credential status, and bind the exact action, genesis, account, policy, challenge and new device public key. Use newly generated device keys. Never require the old identity wallet's holder key or export of a Concordium key.
3. **Add a device:** with the account still active elsewhere, authorize adding the new credential under the agreed policy. Prove that both devices can use the same account as permitted. Record whether the existing device must confirm the addition. Removing one device must preserve the others.
4. **Replace a lost device:** start with no original device, seed or retained user-held factor. Reproduce current credential-update rules, including index-0 removal and update without that credential's signature. Prepare the pre-enrolled native recovery-only authority RFC and approved account-state transition. Test the actual power of service keys to spend directly or take over indirectly. Keep unsupported flows gated. A custody alternative needs a separate explicit owner decision.
5. Record a device inventory and audit events, enforce replay and policy version, notify on sensitive additions or recovery, and validate account and Agent ID continuity after finalized readback. Keep stale agent grants disabled and require explicit reauthorization. Share only synthetic traces.
6. Implement private discovery across reissuance, per-device key/credential indices and supported limits. Verify identity-proof readiness separately from signing. Serialize concurrent recovery and policy changes, reconcile unknown submissions and test a zero-balance payer path. Distinguish lost-credential revocation from disabled recovery enrollment. Use the [shared operation contract](origin-id-lifecycle.md#shared-operation-contract-and-races).

## Acceptance criteria

- [ ] The local onboarding flow records the evidence binding, recovery opt-in and account continuity policy. It reports prompts separately for identity presentation, signer setup and any recovery approval.
- [ ] A fresh presentation on a second device authorizes an addition under the pinned test policy. Both devices resolve the original finalized account and Agent ID. No wallet seed or private key is entered, copied or exported by the user.
- [ ] The loss scenario uses a newly issued, same-person credential with original devices and factors absent. A pass requires finalized access to the same account and an explicit result for replacing lost signing authority. Creating another account or an unvalidated mock result does not pass.
- [ ] Reject a different or unlinked identity, copied identity attributes, revoked policy, mismatched signer, wrong genesis, expired request, replay and unauthorized credential addition. Removing one device does not authorize removal of others or restore stale agent grants.
- [ ] Review the surviving authority's actual power to spend or change credentials, issuer compromise/collusion, factor-loss and recovery timing. Enable real accounts only after the issuer and Concordium-compatible authority design is approved. An unavailable loss path can be reported separately from a verified additional-device flow.
- [ ] CC-7 reproduces current-node signature/removal constraints and service signer powers with exact revisions. Its RFC scopes recovery separately from direct external-proof account admission. A proposed recovery role cannot directly authorize unrelated spending or policy replacement. Record quorum takeover risk and identify any custom-node result explicitly.
- [ ] Reissued evidence with a new holder key discovers only authorized enrollments. Reject account enumeration and concurrent stale-state replacement. Two attempts, policy revocation, sponsor outage, expiry and lost finality response yield one reconciled effect under the pinned lifecycle contract.
- [ ] Verify per-device revocation on chain, credential/key limits, original account assets and Agent ID. Report identity-proof readiness and verify the promised proof after recovery. Test both a zero-balance supported payer and payer decline. A UI device deletion or restored signing alone cannot satisfy the remaining promised capabilities.
- [ ] R-23 pagination is N/A for the single-operation endpoints. Error parsing identifies unsupported wallet/profile, missing authority and rejected device binding. Device approval and finish controls have loading/disabled states with a safe retry.

## User validation and assignments

A user adds a second device from an existing origin wallet. Another user loses all their original devices and follows the origin-ID recovery walkthrough. Both compare approvals, account addresses, Agent ID and what remains active after the operation.

| Role | Assignment |
| --- | --- |
| Wallet Engineering Lead and User Validation Specialist | Co-lead the device and loss flows. |
| Security Specialist and Concordium reviewer | Review the surviving authority and actual account powers. |
| Accessibility Specialist | Lead cross-device handoff, confirmation and accessible status review. |
| I18N Specialist and Product QA Specialist | Review prompts, device naming and failure guidance. |

## Reuse check

Reuse the local signer, origin wallet verifier, canonical chain and registry readback, supported Concordium credential-update APIs and 3.1.1 fixtures. A private enrollment continuity and new-device authorization flow is needed for this product goal.

## C.1 API Contract Trace

Use the versioned [lifecycle operation contract](origin-id-lifecycle.md#shared-operation-contract-and-races) for protected create/status/authorize and local signer submission. Bind intent, expected account-state digest, target keys, policy epoch, network and expiry. Pin actual route mounts and credential payloads before wiring UI. Persist only redacted status in the lobby. Native transaction encoding follows the approved CC-7/CC-4 specification.

## C.2 Form Completeness Gate

Show the selected account, received device key fingerprint, purpose, and which devices or permissions change before approval. Show pending finality and disable duplicate submission. Recovery may reveal a protected account reference only after approved subject continuity.

## B5 Accessibility, B6 help, B7 documentation

Test keyboard and screen-reader support, focus after wallet return, device approval and support for failures that require the issuer. Document add, replace, revoke, and current wallet compatibility.

## Out of scope

| Item | Classification | Action |
| --- | --- | --- |
| Automatic production recovery on every previously created account | Scope boundary | Require enrolled authority and opted-in, approved profiles. |
| Universal Google or Apple recovery support | Scope boundary | Verify each issuer's continuity and wallet profile independently. |
| Consensus change without review | Scope boundary | Use conditional 3.6.1 if the current protocol cannot enforce the agreed authority. |
