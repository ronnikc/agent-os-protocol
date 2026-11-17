<!-- SPDX-License-Identifier: Apache-2.0 -->

# Sprint 3.1.0 — Native enrollment on the local chain

**Status** — Proposed. [Phase 3 plan](README.md).

## Goal

Create a standard Concordium account from an existing wallet credential on an unmodified local chain, with a user-controlled signer and one wallet presentation approval on the supported happy path.

## Dependencies and affected modules

Requires [3.0.0](sprint-3.0.0.md). Coordinate the wallet verification contract and fixture with [3.2.0](sprint-3.2.0.md). Candidate surfaces are `packages/protocol-core/src`, `packages/lobby-server/src` and its store, an enrollment view in `apps/lobby-web`, the JS SDK example, and the local test identity provider in Concordium Base or Local Stack. Document the repeatable local path and public fixture format in Phase 3. DTS acceptance is a dependency for production issuance.

## Work breakdown

1. Boot pinned Concordium Local Stack, standard node, test issuer, independent user-controlled signer and selected EUDI reference Android wallet/PID mdoc verifier. Keep synthetic evidence as a CI option. Use the SDK to create the pre-identity request locally and pair the intended signer through the [trusted pairing flow](pilot-contract.md#native-issuer-handoff-and-signer). Test wrong comparison code and signer substitution. Keep the signer outside the web page and agent runtime and use the proposed [DTS handoff](dts.md).
2. Implement the [signed issuer handoff](pilot-contract.md#native-issuer-handoff-and-signer) using the selected adapter and standard issuance protocol. Show the purpose and minimum disclosure before opt-in. Verify the original holder, intended signer and exact issuance request. Give the test issuer a separate approve/deny/step-up decision and use a protected channel for any required attributes. Keep evidence and identity secrets in their authorized components.
3. Issue the standard identity object and deploy the existing account credential through the SDK. Record issuer turnaround, transaction submission, finalized deployment, account readback at the serving integration, and first accepted authorized use independently. A stale node is a resumable pending state. Corroborate through an approved independent in-sync node. An owner-approved local transaction demonstrates signing and spending capability without production funds.
4. Store only the minimum operation metadata, state and expiry needed to resume. Handle a lost wallet return, stale callback, restart, expired session and unknown deployment outcome. Reconcile before another issuance or deployment attempt. Validate the compatible backup/import artifact in the local signer and which identity material it must preserve. Provide a local-only adapter boundary to [3.1.1](sprint-3.1.1.md). Never export it to CMP or the lobby.
5. Package the SDK and issuer reference PRs with local setup, deterministic vectors, trust assumptions and a demonstration from a clean chain. Mocked issuer approval must be visible in the evidence.
6. Provide the initial enrollment seam for [3.1.2](sprint-3.1.2.md). Record approved recovery capability, private continuity enrollment and the account-authorized policy binding. If account creation finalizes before recovery setup, expose recovery setup as pending/unavailable until its authority is independently verified. Reconcile partial setup without issuing another account. Report any additional setup prompts and fees.

## Acceptance criteria

- [ ] A supported fixture wallet presentation yields a standard on-chain account on an unmodified local node. A second client independently reads the account and verifies a locally authorized transaction.
- [ ] The verifier and test issuer reject relayed or swapped sessions, a different intended signer, altered pre-identity digest, wrong genesis, wrong relying party or issuer, unsupported/expired proof and concurrent consumption. The eligibility-only result cannot authorize issuance.
- [ ] Abort, decline, out-of-order callback and restart recover to a truthful state. A duplicate completion cannot create another account or repeat issuance for the operation.
- [ ] Account and identity secrets remain in the user's signer, and no raw presentation or personal claim enters the Agent OS datastore, logs or chain.
- [ ] The demo records approval count, account readiness and cancellation outcomes, and documents the user-controlled recovery flow and its unresolved production assumptions. A deployed account with incomplete recovery setup cannot be labeled origin-ID-recoverable. Resume setup against the existing account.
- [ ] A real reference-wallet round trip on test credentials uses one identity presentation approval and no duplicate capture or Concordium ID App install. Report first-time signer pairing and other prompts separately. A synthetic fixture alone cannot establish this result. The matched DTS production profile remains independently gated.
- [ ] A lagging query endpoint cannot create a duplicate issuance or prematurely report a usable account. An operator can track finalized deployment, first readback and first authorized use separately. The signer can be restored through its supported backup path without deriving a key from identity data.
- [ ] Enrollment routes return single resources, so R-23 pagination unwrap is N/A. Error parsing uses the stable response code and the Continue button has a loading/disabled state until the attempt resolves or can be resumed.
- [ ] The reference example can run with a synthetic issuer and verified standard account deployment, with no consensus change or DTS account required.

## User validation and assignments

A new user completes or cancels the cross-device flow and can explain who issues the ID, who holds their keys, and how to recover the account.

| Role | Assignment |
| --- | --- |
| Identity Engineering Lead and User Validation Specialist | Co-lead the issuance reference and human workflow review. |
| Security Specialist and QA | Review proof binding, signer boundaries, state machine and negative vectors. |
| Accessibility Specialist | Lead wallet handoff, status and recovery accessibility checks. |
| I18N Specialist and Product QA Specialist | Review localized states and the end-to-end UI. |

## Reuse check

The reuse catalog is absent in this checkout. Reuse `createIdentityRequestWithKeys`, SDK credential deployment, Local Stack test-provider setup and the repo's existing wallet challenge/store patterns. Enrollment needs its own operation state because the wallet sign-in challenge proves control of an existing account.

## C.1 API Contract Trace

Proposed Agent OS lobby routes below. Record the implemented mount and handler in the workfile before wiring browser calls. The test-provider adapter reuses the upstream issuance interface.

| Route | Contract |
| --- | --- |
| `POST /api/v1/agent-lobby/identity-enrollments` | Tenant authorization, signer/network selection, pre-identity request binding and profile. Creates one enrollment and approved wallet handoff. |
| `GET /api/v1/agent-lobby/identity-enrollments/:id` | Enrollment authority required. Returns a redacted single status, expiry and authorized next action. |
| `POST /api/v1/agent-lobby/identity-enrollments/:id/finalize` | User signer proof and deployment reference, bound to stored operation. Reconcile finalized credential and return one account result. |

Wallet and issuer callbacks are adapter-specific and return to an allowlisted relying-party origin. No wallet evidence is accepted via a client-supplied success flag.

## C.2 Form Completeness Gate

Use available signer, network and credential profile selectors that match backend policy. The enrollment ID and pre-identity request are obtained from the flow, with no manual input. Prevent duplicate submission and restore the selected provider and accessible error on return.

## B5 Accessibility, B6 help, B7 documentation

Check keyboard operation, focus after the wallet returns, non-colour-only state announcements and a QR alternative. Document local dependencies, dev credentials, account recovery, and the difference between a local test issuer and DTS.

## Out of scope

| Item | Classification | Action |
| --- | --- | --- |
| Production issuer acceptance | Scope boundary | Obtain through 3.6.0 and verify in 3.7.0. |
| Mint and external-key binding | Scope boundary | 3.3.0 owns registry and card workflow. |
| Direct external proof admission in consensus | Scope boundary | Evaluate under 3.6.0. This reference uses the existing protocol. |
| rCuK protection and restore orchestration | Scope boundary | Deliver the local signer and import/export fixture here. Implement the independently authorized restore in 3.1.1. |
