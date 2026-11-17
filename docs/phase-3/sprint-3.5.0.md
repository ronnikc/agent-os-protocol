<!-- SPDX-License-Identifier: Apache-2.0 -->

# Sprint 3.5.0 — Agentic consent, x401 access and x402 payment

**Status** — Proposed. [Phase 3 plan](README.md).

## Goal

Let a named agent carry out a recorded user consent instruction or authorized access action and optionally pay once within the approved Phase 2 spending policy.

## Dependencies and affected modules

Requires [3.2.0](sprint-3.2.0.md) for wallet evidence, [3.3.0](sprint-3.3.0.md) for finalized ownership, [3.4.0](sprint-3.4.0.md) for App and CMP policy, and the [Phase 2 commerce controls](../agent-wallets-and-payments-plan.md). Candidate changes are `packages/concordium-commerce`, hosted runtime tools and local relay, lobby authorization and audit storage, CMP verifier and operator views, commerce tests and docs. The public x401 shape remains pinned unless an implemented profile revision is documented and tested.

## Work breakdown

1. Define a signed delegation with unique grant ID, owner and agent registry references or an explicit CMP access issuer, holder key, allowed resource and operation, approved purpose, policy version, issuance/expiry, and revocation rules. Establish which signer can act for organizations. Require an owner approval for new material terms. Keep the presentation signer outside model-readable storage and expose only constrained proof and payment tools.
2. Implement the frozen AO-1 [signed x401 profile and race rules](pilot-contract.md#signed-x401-profile-and-race-handling). Verify the request signature and verifier identity on the receiving runtime, including relayed requests. Validate current authority at the receiving controller and bind the result to scope, request digest, audience and validated genesis. Keep the earlier unsigned profile on its existing compatible routes.
3. Implement the [agentic consent contract](product-contracts.md#agentic-consent-on-behalf-of-the-user). Separate the authenticated human choice, delegation to a named agent key, and execution receipt. Implement relay of a recorded choice, request for a human decision, and relay of refusal or withdrawal where expressly authorized. Verify the live choice, grant, purpose, controller, terms version and bound action. Atomically record execution with idempotency, and propagate withdrawal to the pilot downstream integration. Keep Concordium autonomous credential issuance behind an interoperability gate.
4. Return an access result for free resources. For paid resources use Concordium x402 exact after the required proof and current authorization check. Bind the purchase to the validated network and quote, reserve the shared budget atomically, and block new signing or dispatch when authority changes. Preserve and reconcile already-signed and uncertain operations using their original records. Keep access, settlement and human consent receipts distinct.
5. Exercise a hosted agent and a local agent against a CMP site and an independently operated x401 verifier. Test repeated requests, non-idempotent operations where enabled, changing terms, uncertain settlement, revoke and transfer. Operator actions must be visible before new approvals or spending.
6. For reported loss or suspected compromise, let the owner freeze affected grants and new spending in participating services. Retained-factor restore and [3.1.2 origin-ID recovery](sprint-3.1.2.md) require fresh owner/holder checks and explicit grant reauthorization. The new profile uses the [account-authority fingerprint](origin-id-lifecycle.md#dependent-grant-invalidation) so a finalized key change invalidates dependent grants even with unchanged token ownership and delayed notifications. Test device-add changes under the same policy. Reconcile in-flight payments under their original identity and quote.

## Acceptance criteria

- [ ] Owner-issued delegation works with a local and hosted agent and an independent x401 implementation. Trusted issuer, exact credential profile, nonce, holder, resource, purpose and current registry status are verified.
- [ ] Copied DID, wrong key/issuer/audience, replayed or expired proof, unapproved operation or policy version, and revoked, inactive or transferred registration are denied before payment.
- [ ] A user can record a choice, authorize a specific linked agent, and have it relay the choice once. The execution receipt records separate principal and actor references and the authorization used. An unrelated resource operator cannot authorize another person's privacy choice.
- [ ] Request-human-decision and explicit refusal/withdrawal modes work. Changed notices, wrong controller or purpose, unapproved actions, and concurrent withdrawal or grant revocation follow the defined ordering and produce no new approval. An identical retry returns the previous execution result. Confirm withdrawal reaches the pilot integration.
- [ ] A free resource completes with no payment. Approved paid access produces one finalized, independently checked test settlement for the chosen amount, asset, recipient and fee policy, including an interrupted retry that cannot debit twice.
- [ ] Revoking consent for human data propagates through CMP independently. Revoking the agent grant or changing its terms stops subsequent presentations, and presentation/payment receipts stay distinct from human consent.
- [ ] Receipt pagination unwrap follows R-23 where a paginated list is exposed. Error parsing distinguishes deny, expired grant and uncertain settlement. Approve, revoke and retry buttons present loading/disabled states appropriate to their operations.
- [ ] Disable proof or spending independently and reconcile pending records. In restored and origin-ID-recovered fixtures, frozen/superseded grants require current authority and explicit reauthorization. Changed account-authority fingerprints block new dependent actions with unchanged registry ownership and delayed notifications. Test device-add reauthorization and preserve original-payment reconciliation.
- [ ] Three developers and their distinct agents use one lobby with separate controller subject bindings and a shared budget policy. Removing one developer invalidates their dependent grants while the other two retain authority. A cross-user action fails even with a valid agent proof.
- [ ] Simultaneous use and revocation follow the [cross-service authority rules](pilot-contract.md#cross-service-authority-and-revocation). Test delayed or unavailable authority, an expired authorization, and an old opt-in arriving after withdrawal. Concurrent spends cannot oversubscribe. Reconcile signed or uncertain payments under the original operation after revocation.

## User validation and assignments

An operator can explain what an agent is allowed to do, change the grant, and stop it. A merchant can tell why access or settlement was approved, and a human can inspect or withdraw their own CMP choice.

| Role | Assignment |
| --- | --- |
| Commerce and Identity Leads with User Validation Specialist | Co-lead scoped authorization, protected access and payment use cases. |
| Security Specialist and QA | Review issuer trust, proof and payment binding, replay, limits and custody. |
| Accessibility Specialist | Lead approval, denial, revocation and receipt UX review. |
| I18N Specialist and Product QA Specialist | Review accessible errors and both local and hosted workflows. |

## Reuse check

The reuse catalog is absent in this checkout. Reuse `agent-id-proof.ts`, `access_agent_id_resource`, `requestWithSpendingLimit`, the existing ledger and receipt verification, the CMP consent workflow and shared registry resolver. A versioned purpose and authorization profile is needed because the existing resource-bound credential does not convey agent action scope, terms version or CMP withdrawal state.

## C.1 API Contract Trace

Trace x401 `PROOF-REQUEST`, `PROOF-RESPONSE` and result handling against the pinned profile and the existing protected resource code. Trace x402 challenge, signature and response handling against the Phase 2 resource and facilitator. Propose owner-scoped `POST /api/v1/agent-lobby/agent-delegations` for register and `POST /api/v1/agent-lobby/agent-delegations/:id/revoke` for revocation. Bind to tenant, verified owner, agent key and policy version, return redacted status, and record the implementation mount and handler in the workfile. Receipt endpoints return tenant-authorized single or paginated results and stable failure codes.

For human consent, trace CMP's user decision and withdrawal handlers separately from the Agent OS grant. The action handler receives the approved action ID and holder proof, verifies the stored decision version and exact request digest, and returns a safe result plus execution receipt. Negotiate new profile fields under a versioned application contract.

## C.2 Form Completeness Gate

Use existing site, agent and policy selectors. Confirm exact scope, expiry, key fingerprint, recipient and spending limits where relevant. Render in-flight and uncertain states with the correct available actions. Keep approval controls owner-only.

## B5 Accessibility, B6 help, B7 documentation

Check keyboard review and signing, focus restoration, readable amount and scope, screen-reader action status and receipt links. Document expiry, renewal, revocation, signer separation, merchant verification and cost reconciliation.

## Out of scope

| Item | Classification | Action |
| --- | --- | --- |
| Automatically approving new human data-processing purposes | Scope boundary | Use the human CMP flow in 3.4.0. |
| Escrow in the standard access flow | Scope boundary | Reuse Phase 2 only after its independent escrow release gate. |
| Production autonomous issuer without interoperability evidence | Scope boundary | Keep the native capability gated and track review in 3.6.0–3.7.0. |
