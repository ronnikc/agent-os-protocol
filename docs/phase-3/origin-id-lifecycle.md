<!-- SPDX-License-Identifier: Apache-2.0 -->

# Origin-ID device and recovery design

[Phase 3 plan](README.md) · [Sprint 3.1.2](sprint-3.1.2.md) · [rCuK reference](rcuk-design.md) · [Risk register](risk-and-gaps-register.md)

**Status** — Proposed design for owner, DTS and Concordium review. The source review below establishes constraints. Node execution, real issuer continuity and production authorization remain to be demonstrated. The native recovery-only authority described here is a candidate protocol extension.

## Product outcome and current constraints

After approved existing-wallet onboarding, the user can present the enrolled origin identity to add a device or recover the original Concordium account after every original device and personal recovery factor is lost. Keys are generated and used inside the signer. The same account, assets and CIS-8004 ownership remain independently verifiable. The retained-factor example in 3.1.1 has its own acceptance criteria. Completion of that example alone leaves this product outcome pending.

The SDK supports adding account credentials and changing the account threshold through an authorized transaction. Credential index 0 remains on the account. A threshold of one allows each credential to authorize transactions independently. These semantics affect both lost-device revocation and the power of any service enrolled as an ordinary account signer. [SDK transaction guide](https://docs.concordium.com/concordium-node-sdk-js/12.0.1/pages/transactions.html)

The node's `handleUpdateCredentialKeys` checks for a signature from the credential being changed and can return `CredentialHolderDidNotSign`. `handleUpdateCredentials` rejects removing credential index 0 with `RemoveFirstCredential`. A fresh identity presentation and signatures from other account credentials therefore do not establish a path to replacing every lost credential's keys. Public node revision `57ab504c27eb7fce3d35f3bf537589e1b6890c22` was inspected on 17 November 2026. Reproduce these cases on the selected protocol before implementing a workaround. [Credential key signature check](https://github.com/Concordium/concordium-node/blob/57ab504c27eb7fce3d35f3bf537589e1b6890c22/concordium-consensus/src/Concordium/Scheduler.hs#L2670) · [Index-0 removal rejection](https://github.com/Concordium/concordium-node/blob/57ab504c27eb7fce3d35f3bf537589e1b6890c22/concordium-consensus/src/Concordium/Scheduler.hs#L3040)

The documented identity-object recovery API also uses a seed-derived secret. Assess recovery of signing authority and readiness to produce identity proofs independently. [Wallet SDK identity recovery](https://docs.concordium.com/en/mainnet/how-to/integrations/wallet-sdk/wallet-sdk-identity-recovery.html)

## Candidate authority model

| Journey or design | Phase 3 action and acceptance |
| --- | --- |
| Add while an existing device works | Use current authorized credential-management operations and fresh target-device proof. Test the selected key/credential layout and threshold. Preserve the other enrolled devices and demonstrate their continued use. |
| Total-loss recovery | Prepare a pre-enrolled, recovery-only native authority proposal for Concordium. It authorizes a specific replacement of signing authority on the same account. It needs a protocol or equivalent enforceable authorization mechanism when the existing credentials cannot do so. |
| Service keys under ordinary account thresholds | Measure their actual powers in a synthetic fixture. A policy in a service cannot constrain a key accepted by the chain for general spending. Adoption of this custody model requires an explicit owner decision and applicable review. |
| Service-held recovery archive | Evaluate separately only if requested as a delivery option. Its availability, collusion and key-release risks need a custody decision. The 3.1.1 package requires the surviving user factor and cannot satisfy total-loss recovery. |

The proposed native role is enrolled by the account owner while their signer is available. Store the account binding, policy epoch, allowed recovery authorization keys and threshold, allowed actions and approved timing controls in enforceable account state. Keep person identifiers and issuer continuity records private. The role directly authorizes only the specified credential replacement. Its signatures cannot directly authorize CCD/PLT transfers, registry transfers, unrelated contract calls or recovery-policy changes. A malicious sufficient recovery quorum could still replace the owner's keys and take over indirectly. Include that residual power in the owner decision and security review.

Use two separately keyed authorizer fixtures to test the roles of continuity verification and independent recovery approval. This is a local test configuration. DTS and Concordium must agree the real operators, quorum, evidence verification, compromise response, delay or dispute controls and continuity-service exit plan. Origin-ID recovery requires surviving service authority or another enforceable recovery mechanism even when the user holds no surviving wallet secret.

The protocol specification must address the index-0 rule explicitly. Specify replacement of its signing keys and the resulting credential/threshold state while preserving the account address and identity-disclosure history. If fresh identity proofs require an additional normal credential and new issuer-approved identity material, specify its authorized attachment as well. Define how every lost device loses effective signing authority. Preserve the standard identity issuance and accountability requirements. A fresh account, asset migration or a transfer to a new owner account does not pass same-account recovery acceptance.

## Same-person continuity and private discovery

1. At onboarding, obtain authorization for origin-ID device and recovery enrollment. The issuer or approved continuity service assigns a random recovery-scoped enrollment handle and a private person-to-enrollment mapping. Bind each enrollment to its genesis, account and recovery policy. The service proves that fresh evidence concerns the enrolled person under a named issuer policy. A document number, name/date-of-birth match, presentation hash, wallet key or general age predicate cannot supply this guarantee.
2. On a new device, authenticate with a fresh supported credential to the approved continuity service through the trusted signer pairing. Discover the authorized enrollments through that service. Return account choices only after continuity checks. Rate-limit discovery and use indistinguishable unauthorized/not-found responses. Keep this mapping outside CMP, the lobby and public chain records. Allow a person to have several intentionally created accounts and require explicit selection.
3. Test reissued credentials with different holder keys and credential identifiers. Verify credential status and a separately versioned recovery-enrollment status. Revocation of a lost Wallet Unit can be compatible with an approved replacement credential. An active dispute or disabled recovery enrollment must block release. Record how issuer key rotation, renewal, name changes, expiry and issuer closure affect availability. A different issuer requires an approved continuity bridge or an owner-enrolled alternate while access still exists.
4. A renewed identity presentation authorizes this attempt for a fresh signer key. Give the user a trusted display of the account, action and target-device fingerprint. Verify both wallet holder control and new-device possession through the paired channel. Notify according to the enrolled policy using available channels. Notification delivery cannot silently become a replacement identity check or a mandatory old-device factor in the total-loss journey.

Account deployment and recovery enrollment may finalize in separate steps. Report recovery as pending until the authority and private enrollment binding are verified. Resume failed setup against the existing account. Older accounts require valid owner-authorized enrollment while access exists. A lost, unenrolled account cannot silently acquire this new recovery path.

EUDI describes reissuance during migration to another Wallet Unit. The actual issuer must support the continuity required above. Google and Apple profiles require their own evidence. Existing eligibility support does not establish recovery continuity. [EUDI Wallet lifecycle](https://github.com/eu-digital-identity-wallet/eudi-doc-architecture-and-reference-framework/blob/main/docs/main/06-trust-model.md)

## Shared operation contract and races

AO-1A versions the following contract before dependent code. Routes are proposed service-relative paths. Pin the actual mount, authorization and types in each implementation PR.

| Field or surface | Required behavior |
| --- | --- |
| Request | `intent` is `add-device`, `recover-account` or `revoke-device`. Bind protocol/profile version, authenticated relying party, genesis, exact account, enrollment/policy epoch, target public keys and proof of possession, intended credential changes, expected account-state digest, operation ID, nonce, issued-at and expiry. Keep the private person reference at the continuity service. |
| `POST /origin-id-operations` | Create a persisted challenge under the protected session. Authenticate discovery before disclosing an account. Require a unique operation ID and matching request digest. A changed payload with the same idempotency key is rejected. |
| `GET /origin-id-operations/:id` | Return only session-authorized redacted state and an allowed next step. Never expose a presentation or other person's enrollments. |
| `POST /origin-id-operations/:id/authorize` | Verify current continuity, target-key proof and current policy. Consume one challenge atomically. Produce an audience- and action-bound signed authorization over the exact credential-change digest. The selected native proposal defines the chain-verifiable encoding and authorized signer set. |
| Signer submission and readback | Independently validate authorization, account state, genesis, intended changes, payer and bounded fee before submission. Record the transaction hash before reporting success. Read finality and credentials independently. User account keys remain in the signer. |

For the local profile use a maximum five-minute challenge lifetime, maximum 60-second off-chain authorization lifetime and one active replacement operation per account/policy epoch. These are proposed fixture values. Pin production expiry, delays, status freshness and compromise controls with reviewers. Chain timestamps and the approved pending-operation semantics determine on-chain expiry.

The workflow records `challenge-issued`, `evidence-verified`, `authorized`, `submitted`, `finalized`, `denied`, `expired` and `reconcile`. A timing policy can add `waiting` and `cancelled`. Define what can be canceled at each state. Serialize authorization against enrollment revocation and concurrent device changes using the expected account state and epoch. Native execution must reject a stale state or consumed recovery nonce. Before broadcast, reconcile an unknown submission. Retry the same known transaction or return its result. A second replacement must obtain a new challenge against current finalized state.

Test two recovery attempts, recovery racing a device addition or policy change, signer restart, missing callback, expired authorization, sponsor outage and a transaction that finalized before its response was lost. Hold grants and new payment signing that depend on old device authority during reconciliation. Resume only after current owner/holder checks and explicit reauthorization. Preserve the original transaction's settlement reconciliation.

## Device keys and identity-proof readiness

Use independent device keys and record the account credential and key indices that each device controls. Validate the finite credential/key limits and the trade-off between keys within a credential and separate credentials on the pinned network. Show individual device revocation and behavior at the limit. Never claim that a local device-list deletion revokes an on-chain signer.

For each journey report account signing, usable identity proof material, current Agent ID ownership and delegation state separately. Do not copy identity secrets through CMP or the lobby. Reissue or transfer compatible identity material only through the approved issuer/signer channel. If signing works while proof material is unavailable, expose that restricted state and keep dependent ZKP actions disabled. Recovery acceptance records whether the promised proof capability is restored and what issuer participation it requires.

### Dependent grant invalidation

Account key replacement can preserve both the account address and registry owner. The new delegated-agent profile therefore binds a grant to an account-authority fingerprint as well as the token owner and agent key. AO-1A fixes the domain-separated digest encoding of genesis, canonical account, account threshold and sorted credential/key identifiers, public keys and thresholds. Compute it from finalized account state at grant approval and recheck before new consent mutations, proof authorization or payment signing. A changed fingerprint requires owner reauthorization for dependent grants. This reference policy also applies after device addition. Show that consequence in the approval UI.

Test recovery with the registry owner and Agent Card unchanged, delayed recovery notifications and an agent that still holds a previously valid proof credential. The live fingerprint check must stop new dependent actions. A successful account recovery cannot silently reactivate revoked grants. Scope the new fingerprint to the versioned Phase 3 profile and participating services. Reconcile transactions already signed or finalized under their original operations.

## Fees and availability

Credential deployment creates an account without charging a sender transaction fee. Later credential-management operations and any proposed recovery operation need their own payer and resource rules. Distinguish protocol support for sponsorship from the operations an actual sponsor service accepts. [Concordium gRPC transaction types](https://docs.concordium.com/concordium-grpc-api/) · [Sponsored transactions](https://docs.concordium.com/en/mainnet/learn/transactions/sponsored-transactions.html)

Reuse the existing official Agent Registry sponsor for its verified registry operations. Obtain a separate explicit coverage decision for device addition, revocation and recovery. Record a configured operator-funded sponsor or approved user fee flow when required. Run a zero-balance fixture, declined/empty sponsor and unknown-outcome retry. Sponsor availability and service continuity are production dependencies. A finalized account remains available when a later operation cannot proceed.

## Cross-repository delivery and closure evidence

| Work package | Scope and evidence |
| --- | --- |
| AO-1A / 3.0.0 | Freeze lifecycle operation and negative vectors independently of runtime code. Include continuity, replay, state-change and index-0 constraints in the capability matrix. |
| AO-DeviceLifecycle / 3.1.2 | Implement signer device inventory and pairing, add/revoke, recovery orchestration and explicit proof-readiness states. Reproduce same-account and same-Agent-ID results. Current-protocol unsupported cases return a gated result. A candidate-protocol test labels its custom node explicitly. |
| AX-1C / 3.1.2 | In the verifier facade add the continuity adapter, protected discovery and request/authorization/status seam against a synthetic issuer. Share AO-1A fixtures. Add real issuer profiles only after their evidence and approval. |
| AX-2C / 3.1.2 with 3.4.0 | In Consent add initial recovery enrollment and device/recovery UX using the user-controlled signer and AX-1C. Show add and total-loss availability independently. Exercise the same capabilities in the optional Agent OS App. AX-3 consumes the pinned compatible release. |
| CC-7 / 3.1.2 and 3.6.0 | Prepare a provider-neutral credential-management conformance example with current-node negative results, identity-material requirements and an origin-ID recovery RFC. Route a demonstrated wallet API/helper gap to a separate small patch. Give Concordium an independent reproduction without AesirX services. |
| CC-4 / conditional 3.6.1 | Implement an approved recovery-only native authority specification in separate Base, Node and SDK PRs. Scope it separately from direct external-proof account admission. Include state migration, legacy accounts, deterministic validation, fees, activation, recovery takeover and lost-key tests. |

The origin-ID release evidence must include an actual second-device run and a separate total-loss run with old devices, user kit and exported keys absent. Verify original account address, assets, Agent ID, target device signature, failed signing by revoked old devices, usable promised identity proof, replay rejection and recovery-policy state. Include the potential for a sufficient authorization quorum to take over, issuer or service outage and limits on cancellation after chain execution. Pin a specific test, source revision, result and responsible reviewer for each item. Pending partner decisions and unexecuted tests remain open in the risk register when the planning PR is reviewed.
