<!-- SPDX-License-Identifier: Apache-2.0 -->

# Sprint 3.4.0 — CMP Agent ID, Agent OS App and integration skills

**Status** — Proposed. [Phase 3 plan](README.md).

## Goal

Let a site owner register or link a native Agent ID in CMP and use the Agent OS App and integration agent to install and verify CMP in a supported project.

## Dependencies and affected modules

Build against pinned contract fixtures from [3.0.0](sprint-3.0.0.md). Use [3.2.0](sprint-3.2.0.md) wallet verification and [3.3.0](sprint-3.3.0.md) registry readback for final tests. Candidate surfaces are `agent-os-panel/tabs/apps.js`, the Panel server/proxy and lobby integration store, the opt-in integration agent and training pack, `aesirxio/consent`, the CMP API service, the WordPress plugin, and operator guides. [3.5.0](sprint-3.5.0.md) delivers runtime consent execution and commerce. See the [delivery plan](delivery.md) for AO-3, AX-2A/B and AX-3 boundaries.

## Work breakdown

1. Add an owner-connected CMP App with connect, health/status, setup preview and disconnect. Store tenant connections securely in the existing connection model with a masked credential status. Support an owner-configured local connection as well as hosted setup. Confirm the HTTPS origin for production and provide an explicit development configuration.
2. Build an opt-in AesirX CMP integration agent and skills for installation and verification, wallet profile configuration, Agent ID linking, and delegated-consent testing. Detect standalone JS or WordPress and produce reversible, owner-reviewable changes. Keep AesirX-specific content in the optional integration and reusable contracts in core.
3. Add website policy selection for human eligibility, agent access and any human privacy decisions. Default to the narrow eligibility check when that satisfies policy. Offer native issuance as an explicit separate choice and show the purpose, recipient and additional fields before the wallet request. Use the shared verifier and registry contracts. Include an operator view of available profiles, active policies, decisions and revocations. Expose distinct statuses for configured, verified and unavailable capabilities.
4. Add an **Agents** view in CMP for registering a native Agent ID from an existing or freshly enrolled account and linking a pre-existing active ID. Validate owner and holder keys, verify the finalized agent and card, persist a tenant-scoped binding, and show pending, active, revoked and unlink outcomes. Use the same status and actions in the Agent OS App. Build a protected reference JS/API resource and WordPress integration with server enforcement and rollback.
5. Implement the human-purpose consent view and [controller subject binding](pilot-contract.md#authority-and-the-controllers-subject). Use the site's authenticated subject or protected session and a one-time reference to connect the remote grant to the intended controller, purpose and notice. Enforce consent before tracking in JS and WordPress, including pending requests. Preserve direct user withdrawal and make localhost/custom network configuration follow the validated chain.
6. Integrate AX-2C and AO-DeviceLifecycle through the [3.1.2 lifecycle contract](origin-id-lifecycle.md). The CMP and optional App expose initial enrollment, device management and total-loss recovery as separate capabilities, including signing versus proof readiness. Share the same protected signer handoff and authorized status. Missing capability fields in older versions keep the new flow unavailable. Test WordPress lifecycle features only against the pinned supporting release.

## Acceptance criteria

- [ ] A project owner can connect, configure, test and disconnect CMP from a clean hosted and local Agent OS setup. Other roles and lobbies cannot use the connection credentials or change protected policy.
- [ ] The opt-in agent and skills produce a reviewable setup for JS and WordPress and can verify the install. Re-running detects existing configuration. Rollback restores the previous site behavior.
- [ ] CMP can register a finalized CIS-8004 Agent ID from a test account and link an existing ID with current-owner and agent-key proof. Pending, rejected or wrong-owner actions cannot produce an active CMP binding. The App and CMP show the same status.
- [ ] The App exposes capabilities, linked agents and pending approvals through the shared CMP APIs. It negotiates device/recovery support independently and correctly displays pending enrollment and restricted proof readiness. Disconnect blocks dependent actions in hosted and local flows. Deployment credentials and proof material stay outside prompts, skills and generated diffs.
- [ ] A protected reference route exercises server-verified human wallet eligibility and the agent access test contract. Optional status or UI flags cannot grant access by themselves.
- [ ] Declining native enrollment or lacking an issuance field preserves a valid eligibility result within its own policy. Opting in later reauthorizes the new request and does not repurpose a previous presentation or change the recorded assurance of an earlier decision.
- [ ] The consent screen records controller, purpose, policy version, decision and withdrawal correctly, accessible from the same site. Agent access and payments do not create human privacy decisions.
- [ ] JS and WordPress send no applicable tracking request before the server applies a valid opt-in or during a pending agent decision. Withdrawal blocks subsequent covered requests. Direct API calls, stale cache, edited browser flags, another site's subject and disconnected agents cannot bypass the gate.
- [ ] Receipt and settings views reveal only authorized, redacted information. Revoking or disconnecting the project removes access without deleting reconciliation records still needed by the operator.
- [ ] R-23 unwrap is exercised for any paginated receipt response and N/A for single integration status. Error parsing uses the stable code and shows an actionable message. Connection and setup buttons have loading/disabled states and omit owner-only controls for unauthorized roles.

## User validation and assignments

A site owner installs with a fresh JS project and WordPress. A human visitor understands what is being requested and can withdraw a prior decision. A delegated agent reaches the protected API with the test verifier.

| Role | Assignment |
| --- | --- |
| Integration Engineering Lead and User Validation Specialist | Co-lead installer, site owner and human consent flows. |
| CMP Maintainer and Security Specialist | Review plugin boundary, origin validation, tenant isolation and data handling. |
| Accessibility Specialist | Lead the Apps tile, policy form and CMP decision controls. |
| I18N Specialist and Product QA Specialist | Review strings, installation and rollback across both targets. |

## Reuse check

The reuse catalog is absent in this checkout. Reuse existing Apps cards, connection helpers and sealed integration records, Agent OS training/skill structures, CMP configuration and WordPress packaging, and the shared proof and registry services. Add an optional integration profile and installer steps for CMP because the current deploy/chat/data integrations do not install a CMP.

## C.1 API Contract Trace

The current Apps UI uses Panel proxy routes under `/api/lobby/remote/integrations`. Trace the actual proxy and lobby provider route mount before adding the proposed `aesirx-cmp` provider. Define connect/disconnect/status with existing conventions. The connect request carries the CMP base URL, associated tenant and a narrowly scoped secret where required. Status returns only a masked hint, capabilities and health. Project policies and receipts are owner- or operator-scoped CMP endpoints. Record final methods, payloads, pagination envelope and error schema before wiring the panels.

Trace register, link, unlink and status from CMP's actual service route to the registry adapter and current owner checks. Allow only authenticated tenants to mutate a binding. The client receives a redacted operation or binding status.

## C.2 Form Completeness Gate

Select the connected repo, detected framework, site and available verifier policy from server-backed options. Validate the CMP origin and any required credential against the same backend constraints. Show authorization scope and installer changes before submission and disable mutating buttons while saving.

## B5 Accessibility, B6 help, B7 documentation

Check keyboard navigation, field labels, connected and error status, modal focus and return, readable policy and consent choices, and purpose selection without reliance on colour. Ship setup and rollback guides for JS and WordPress, and user-facing help for decisions and withdrawal.

## Out of scope

| Item | Classification | Action |
| --- | --- | --- |
| New issuance or payment protocol | Scope boundary | Integrate the artifacts supplied by 3.1.0 and 3.5.0. |
| Automatically applying human marketing or tracking consent | Scope boundary | Keep the human CMP decision flow. |
| All frameworks and CMSes | Scope boundary | Ship the JS and WordPress paths and document the extension seam. |
