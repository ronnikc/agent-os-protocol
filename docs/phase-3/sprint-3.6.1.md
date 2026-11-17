<!-- SPDX-License-Identifier: Apache-2.0 -->

# Sprint 3.6.1 — Conditional native identity and recovery changes

**Status** — Conditional, pending a Concordium protocol decision. [Phase 3 plan](README.md) · [3.6.0 approval package](sprint-3.6.0.md).

## Goal

Implement an approved native recovery-only authority or a separately approved external-proof account-deployment path. Keep their specifications, implementation patches and activation evidence independently reviewable.

## Dependencies and affected modules

Requires the applicable early 3.6.0 scope decision, named protocol owner, agreed trust/authority model, implementation/security reviewers, target network and activation mechanism, and identity disclosure/recovery responsibilities. Recovery uses CC-7's [3.1.2](sprint-3.1.2.md) current-rule evidence and [authority proposal](origin-id-lifecycle.md#candidate-authority-model). It can precede the final 3.1.2 total-loss demonstration. Proposed homes are Concordium specifications, Base data/crypto types, Node state/validation/activation and JS SDK encodings/test vectors. Agent OS owns integration, capability detection and evidence. Existing-protocol DTS issuance can progress independently.

## Work breakdown

1. Agree the exact semantic change in each accepted proposal. For recovery, specify owner opt-in, pre-enrolled authorization keys/quorum, limited direct permissions, recovery-policy update authority, index-0 key replacement, fresh identity credential attachment where needed, expected account-state/epoch/nonce and exact resulting keys/threshold. Preserve account address and identity-disclosure history. Define delay, cancellation, conflict, expiry and compromise semantics. Ordinary account threshold keys remain subject to their existing powers.
2. For approved direct external-proof deployment, compare ordinary issuer signing with native external proof validation. Select a credential profile, vetted configuration, bounded proof representation, trust/status inputs and explicit issuer/accountability model. Bind proof to keys, genesis, action, trust checkpoint and freshness. Define replay/uniqueness and recovery. For both proposals, validation is deterministic and independent of wallet/issuer HTTP/RPC. Use authenticated chain-recognized authorization/trust updates and a disable/migration plan.
3. Implement shared type and verification changes in Base first, candidate validation and activation in Node second, and SDK encoding/decoding and capability discovery last. Include bounded validation CPU, memory, payload length, and fee/energy behavior. Keep parsing and activation rules explicit for earlier protocol versions.
4. Produce deterministic vectors and compatibility tests, independent verification implementation or reviewed vectors, cross-platform builds, negative tests, upgrade/restart tests, and current-path regressions. Review privacy, linkability and recovery with Concordium and applicable issuers. Rehearse on a devnet with activation disabled, then enabled.
5. Coordinate the release candidate and exact cutoffs with Concordium. Run the combined PLL and identity compatibility suite only if both are in the approved candidate. Keep legacy credential deployment and escrow regression evidence. Expose support only after the selected node confirms activation.
6. For recovery, exercise a pre-enrolled account from creation through total device loss and finalized key replacement. Verify a new device can sign, every revoked old device fails, original assets/Agent ID remain and the promised ZKP works. Test ordinary spend attempts by recovery-role keys, quorum takeover, fees/sponsorship, parallel recovery/policy changes, service key rotation and recovery enrollment on older accounts. Report service or issuer outage truthfully.

## Acceptance criteria

- [ ] A signed-off specification, named maintainers, agreed issuer and identity-disclosure responsibilities, and activation decision are recorded before a production-intended node PR.
- [ ] Each accepted proposal has deterministic vectors across independent builds or environments with external wallet/issuer network access disabled. Recovery vectors apply the intended replacement to the original account. Deployment vectors create the intended account when that separate scope is approved.
- [ ] Wrong key, network, purpose, proof version, trust checkpoint, expired/revoked authorization, malformed/oversize input, replay, stale recovery state and pre-activation operations fail within agreed resource limits.
- [ ] Existing account creation, agent registration and payment flows pass regressions on the candidate. Recovery and revocation match the approved semantics. If bundled with PLL, Phase 2 compatibility and lock lifecycle results are recorded independently.
- [ ] SDK, Base and Node changes are pinned to compatible revisions. The activation rehearsal covers pre-upgrade nodes, enabled nodes, restart, and the agreed emergency response.
- [ ] Approved native recovery preserves the original account, assets and Agent ID, replaces lost signing authority including index 0 under reviewed semantics, and rejects old-device signatures. The promised identity proof works or the capability remains restricted. Recovery keys cannot directly authorize unrelated spending. Document indirect quorum takeover and actual compromise response.
- [ ] Recovery race, epoch rollback, cancellation/expiry, disabled enrollment, payer decline and lost submission response tests pass. Existing accounts acquire new recovery authority only through valid owner enrollment. All prior credential operations retain their defined behavior outside the new activated path.
- [ ] R-23 pagination, browser error parsing and button loading state are N/A because protocol/SDK conformance adds no browser UI. SDK returns stable typed rejection results and capability discovery permits a safe existing-protocol fallback.

## User validation and assignments

Protocol maintainers can reproduce every acceptance result. Existing operators can continue using their accounts. First-time operators see a truthful capability and fallback on unsupported networks.

| Role | Assignment |
| --- | --- |
| Concordium Protocol Lead and User Validation Specialist | Co-lead design acceptance and user impact assessment. |
| Protocol and Security Specialists | Lead cryptographic review, resource bounds, governance and activation. |
| Accessibility Specialist | Lead review of compatibility notice and fallback UX requirements. |
| QA and Release Engineering | Verify independently compiled vectors, migration and the matched release. |

## Reuse check

The reuse catalog is absent in this checkout. Reuse native credential/deployment encoding, shared verifiers, versioned protocol machinery, Local Stack and Phase 3 fixtures. Add consensus behavior only for a demonstrated gap and agreed design. Recovery authority has its own justification from CC-7's current-rule evidence.

## C.1 API Contract Trace

N/A for new Agent OS API endpoints. Document upstream transaction/state schemas, status and typed rejection codes before SDK wiring. Bind recovery authorization to the exact target key/state and define signature preimages. The existing UI consumes verified network capability and exposes device/recovery support independently of standard issuance.

## C.2 Form Completeness Gate

N/A. Use the enrollment selectors and user authorization from 3.1.0.

## B5 Accessibility, B6 help, B7 documentation

Review accessible upgrade/fallback messages in the existing enrollment UI. Document the protocol version, profile, trust policy, activation and recovery. Include maintainer instructions and conformance vectors in the release packet.

## Out of scope

| Item | Classification | Action |
| --- | --- | --- |
| Admission of arbitrary wallet proofs | Scope boundary | Accept only the profiles defined and reviewed by the protocol design. |
| Independent Mainnet rollout by Agent OS | Scope boundary | Concordium owns activation. Agent OS gates by verified capabilities. |
| Phase 2 PLL implementation | Scope boundary | Include compatibility evidence only. Phase 2 owns escrow. |
| HotSync and peer catch-up redesign | Scope boundary | Collect current readiness data in 3.7.0 and address a demonstrated node bottleneck separately. |
