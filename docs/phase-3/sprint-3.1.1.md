<!-- SPDX-License-Identifier: Apache-2.0 -->

# Sprint 3.1.1 — rCuK recovery reference implementation

**Status** — Proposed Phase 3 deliverable. The pilot requires an independently enrolled user-held factor to survive device loss. See the [recovery contract](product-contracts.md#rcuk-recovery-contract) and [Phase 3 plan](README.md).

## Goal

Restore the original keys for a Concordium account on a clean installation without manual seed-phrase entry, using a user-held recovery factor, independent authorization and a verifiable Concordium policy commitment.

## Dependencies and affected modules

Requires [3.0.0](sprint-3.0.0.md) threat model and [3.1.0](sprint-3.1.0.md) local signer with a compatible backup and restore boundary. Use [3.2.0](sprint-3.2.0.md) for an approved test evidence profile. Run development and synthetic recovery tests alongside registry and CMP work. Final continuity tests consume finalized Agent ID and delegation state from [3.3.0](sprint-3.3.0.md) and [3.5.0](sprint-3.5.0.md). Candidate changes are the local signer and SDK adapter, provider-neutral recovery types, a local runner and fixture, optional test-chain commitment tooling, and operator docs. Use isolated test accounts and keys. Production activation is separate from completing this sprint.

## Work breakdown

1. Inventory the supported local signer backup format and its required components. Separate original account-key restoration, identity object re-import or issuer recovery, and verification of a new credential. Test the reference signer and standard Concordium transactions first. Mark official-wallet export/import as supported only when actually exercised.
2. Enroll with the current signer and independent user factor. Create a versioned policy and random opaque recovery ID. Encrypt the compatible package locally with an independently random key and a maintained authenticated-encryption implementation. Keep ciphertext and discovery information in recoverable user-controlled or customer-managed storage. Verify backup availability and retrieval without the lost device before reporting enrollment complete.
3. Implement the [selected rCuK reference design](rcuk-design.md) with a removable encrypted recovery kit and one independent trustee. The trustee unwraps only the user-encrypted intermediate after current policy and factor checks. The user factor remains necessary. Review nested AEAD, protected storage, collusion, intermediate material that may have escaped and availability.
4. Use the selected minimal Local Stack commitment contract and authorization checks. Publish an opaque versioned commitment, reject old or disabled epochs and require the agreed original-signer, factor and trustee authorizations for replacement. Keep identity, account mapping, locator and package off-chain. Treat publication and decryption authority separately.
5. Simulate loss on a clean target device. Authenticate the proven surviving factor and independent authorization against the original enrollment, exact genesis, current policy, one-time challenge and target device key. Validate approved recovery evidence separately. Reconstruct and decrypt only in the recovery signer boundary. Verify the expected account from finalized chain data, then refresh recovery protections, revoke stale sessions and reconcile dependent relationships. Treat loss of a device as possible compromise. Exercise credential rotation only with supported existing account authority.
6. Verify a routine proof and Agent ID check end-to-end with monitored network traffic. In the self-hosted supported test profile, the ordinary verification path uses local cryptographic verification and sufficiently fresh status, without per-presentation callbacks to origin issuers or an AesirX central service. Record which operations and credential profiles still need issuer, trustee, storage or node access. This test measures traffic in components we operate.

## Acceptance criteria

- [ ] A clean installation restores the original finalized test account and demonstrates a new authorized test signature using an independent surviving user-held factor and the required secondary authorization, without showing or manually entering a seed phrase.
- [ ] A trustee with all stored artifacts, the user kit plus the archive without trustee release, and an identity issuer each fail to reconstruct the package. Loss of the original device alone is recoverable. Loss of the mandatory user factor returns unavailable. Past release and already-copied keys are covered as residual risks.
- [ ] Wrong holder, wrong account or genesis, missing factor, stale or superseded policy, replay, wrong target key and substituted ciphertext fail. A valid identity predicate, CIS-4 record, Agent ID or chain commitment alone cannot trigger decryption.
- [ ] Independent verification matches the authorized policy version and backup commitment on the standard test chain. The chain contains no key, backup ciphertext, callback, personal identifier or explicit wallet/agent mapping. A missing or unverifiable current policy cannot authorize release.
- [ ] Key restoration, identity object/proof readiness, and any credential rotation have separate observed results. Document whether the chosen signer needs original issuer access for the identity object. Rotation cannot be represented as automatic revocation of a lost copy.
- [ ] An independently verified Agent ID still resolves to the correct account after restore. Recovery actions never bypass current registry ownership. Old delegations or spending do not reactivate and any pending payment reconciles under the original quote.
- [ ] Network traces show no per-visit issuer or centralized AesirX callback in the supported self-hosted verification path. Test stale status and report every observed dependency in enrollment, routine proofs, recovery and reissuance.
- [ ] Independent security review covers factor custody and collusion, replay and rollback, compromised-device and backup loss, cryptographic composition and signed-update authority before enabling real wallets. Pending results are labelled as prototype evidence.
- [ ] R-23 pagination is N/A for single-operation results. Error parsing distinguishes missing factor, stale policy, corrupt package and recovery unavailable without leaking secrets. In-flight actions use a loading/disabled button state and resume or cancel safely where applicable.

## User validation and assignments

An account holder loses their primary device, locates the separately retained factor and backup, and restores using a fresh installation. They can identify which providers still participate, recognize when recovery is unavailable, and approve any risky action after a suspected compromise.

| Role | Assignment |
| --- | --- |
| Wallet Engineering Lead and User Validation Specialist | Co-lead signer integration, recovery proof and device-loss walkthrough. |
| Security Specialist and independent cryptographic reviewer | Review factor composition, storage, chain commitment and lost-device threats. |
| Accessibility Specialist | Lead recovery and restore-status review, including non-QR handoff where applicable. |
| I18N Specialist and Product QA Specialist | Review recovery steps, failure language and accessibility across handoffs. |

## Reuse check

The reuse catalog is absent in this checkout. Reuse the supported Concordium SDK signer/import flow, Local Stack and fixture tooling, and existing registry and delegation checks. A recovery envelope and factor authorization contract are new because the signer backup alone cannot enforce the approved recovery policy.

## C.1 API Contract Trace

The local signer exposes enrollment, recovery begin, factor approval and status, and restore completion. Record the selected local transport, authentication, challenge binding, stable response codes and ownership in the workfile. CMP and the lobby see only redacted status and account proof or reference. No secret-bearing web endpoint is in scope. The chain read verifies the expected commitment and current authorized revision.

## C.2 Form Completeness Gate

Use the local signer's approved account and network selections. Show which independent factor, backup and authorization are required before enrollment. Never request a raw secret in an Agent OS or CMP page. Keep recovery pending until the signer has read back the original account. Support cancellation and accessible retry without duplicate recovery authorization.

## B5 Accessibility, B6 help, B7 documentation

Check keyboard operation, accessible progress and error announcements, and handoff and focus after factor approval. Publish a repeatable loss-and-restore runbook, compatibility table, threat review, backup verification and post-compromise response. Provide reproducible local fixtures for Concordium reviewers.

## Out of scope

| Item | Classification | Action |
| --- | --- | --- |
| Loss of every user-held factor | Scope boundary | This pilot requires the surviving factor. Test origin-ID continuity and account authorization separately in [3.1.2](sprint-3.1.2.md). |
| Native protocol changes and universal wallet or cross-chain import | Scope boundary | Use one SDK signer and a standard test-chain commitment. Any wallet-specific patch is capability-gated. |
| Guaranteed rotation or recovery from a proof alone | Scope boundary | Test account credential updates only with supported pre-existing account authority. |
