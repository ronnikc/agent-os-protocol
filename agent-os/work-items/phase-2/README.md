---
id: phase-2
name: Cloud Workspaces and Verified Agent Marketplace
status: planned
---

# Cloud Workspaces and Verified Agent Marketplace

## Objective

A lobby owner can connect an affordable cloud workspace, hire a verified specialist, assign scoped work and review an exact patch with test evidence. Phase 2 adds this workflow to the v1.0.0 orchestration baseline, with an invite-only marketplace beta and separate gates for paid work and on-chain escrow.

The November 13 competitive review informs the demo, documentation, benchmarks, hosted hardening, interoperability and independent onboarding. Development and beta stabilization come before recording the flagship demo, publishing comparisons and refreshing the website.

## Authorization and release gates

- The overall plan was approved on November 13, 2026. This planning PR records the approved scope and implementation contracts. Start execution only after it merges and the owner separately approves the start.
- The marketplace beta exercises real assignments and delivery with zero-price agreements. Paid x402 work requires independent interoperability evidence and separate approval for any real-money pilot. Zero-price workflows support lobbies with commerce disabled.
- Live Concordium Protocol-Level Locks (PLL) remain pending. On November 13, 2026 Concordium's roadmap listed Simple PLL for January 2027 and Enhanced PLL for March 2027. These are upstream targets. Each live settlement action depends on the released protocol, compatible wallet and SDK, supported asset and testnet evidence. Keep advanced release and dispute rules disabled until their required capabilities pass. [Concordium roadmap](https://www.concordium.com/roadmap)
- Keep hosted, marketplace and commerce flags under operator control. The release candidate must show rollback, credential revocation, workspace cleanup and recovery of pending settlements. Publish user-facing claims from completed checks.

## Sprint sequence

| Sprint | Outcome | Prerequisites |
| --- | --- | --- |
| [2.1.0 Hosted controls and workspace contract](sprint-2.1.0.md) | Enforce budgets and define a common workspace lifecycle. | v1.0.0 |
| [2.2.0 E2B and Agent37](sprint-2.2.0.md) | Deliver the complete cloud task flow from Apps through artifact handoff. | 2.1.0 |
| [2.3.0 Daytona, Modal, Upstash Box and Vercel Sandbox](sprint-2.3.0.md) | Qualify the remaining four adapters through the same workflow. | 2.2.0 |
| [2.4.0 Marketplace discovery, bidding and hiring](sprint-2.4.0.md) | Publish verified profiles, compare bids and create a scoped assignment from mutually approved terms. | 2.1.0 and existing registry and preview |
| [2.5.0 Marketplace delivery, review and disputes](sprint-2.5.0.md) | Bind execution, evidence, review and moderation to the engagement. | 2.4.0 and workspace handoff from 2.2.0, with all six choices from 2.3.0 |
| [2.6.0 Wallet operations and independent commerce](sprint-2.6.0.md) | Close wallet operations and verify hosted x401 and x402 externally. | Existing wallet and commerce packages, with 2.5.0 for marketplace payment |
| [2.7.0 Escrow readiness](sprint-2.7.0.md) | Simulate funding, release, expiry, return and disputes. | Agreement, wallet and finality contracts from 2.5.0 and 2.6.0 |
| [2.8.0 Invite-only beta and stabilization](sprint-2.8.0.md) | Validate six providers and the marketplace with external participants. | 2.3.0, 2.5.0, 2.6.0 and 2.7.0 |
| [2.9.0 Release evidence and public launch](sprint-2.9.0.md) | Record the demo and publish benchmarks and launch materials after development. | 2.8.0 release candidate |
| [2.10.0 Conditional PLL activation](sprint-2.10.0.md) | Validate released protocol support and propose a capped mainnet pilot. | 2.7.0, upstream capabilities and explicit pilot approval |

Marketplace discovery and independent interoperability can proceed while the cloud integrations are under development once their dependencies are available. Conditional PLL activation is outside the critical path for the beta and public release.

Sprint 2.1.0 is in implementation review. The flagship recording and public benchmarks are scheduled in Sprint 2.9.0 after the Sprint 2.8.0 beta stabilization gate.

## Cloud workspace experience

The owner connects their own provider account in **Apps → Cloud Workspaces**, selects an allowed region and runtime profile, and sets resource, network and spend limits. Agent OS provisions one disposable Linux workspace per task attempt. The task receives a pinned source revision, runs within its approved scope and returns logs, test results, artifacts and a patch for review. Keep repository write approval, model orchestration and provider credentials in the Agent OS control plane. Show provider capabilities and plan limits before admission, and record cleanup until the provider confirms it.

| Provider | Initial integration | Reference |
| --- | --- | --- |
| E2B | Firecracker microVM, command and file tools, explicit timeout and teardown. | [Security](https://e2b.dev/security) · [Pricing](https://e2b.dev/pricing) |
| Agent37 | Standard shared or full Linux VM profile when eligible. Meter compute and retained disk, and delete at closeout. Review the recovery-copy retention policy. | [Cloud docs](https://www.agent37.com/docs) · [Pricing](https://www.agent37.com/pricing) · [Retention](https://www.agent37.com/privacy) |
| Daytona | Linux container and VM capabilities, with account-tier network policy detection. | [Linux sandboxes](https://www.daytona.io/docs/en/linux-sandboxes/) · [Network policy](https://www.daytona.io/docs/en/network-limits/) |
| Modal | JavaScript Sandbox SDK with explicit Linux runtime and limits, accounting for requested versus actual usage. | [Sandboxes](https://modal.com/docs/guide/sandboxes) · [Resource billing](https://modal.com/docs/guide/sandbox-resources) |
| Upstash Box | Active-CPU billing and the disposable EphemeralBox command and file API. Restrict use to eligible container workloads. | [Ephemeral Box](https://upstash.com/docs/box/overall/ephemeral-box) · [Pricing](https://upstash.com/pricing/box) |
| Vercel Sandbox | Firecracker workspaces with persistence disabled by default. Connect explicitly next to Vercel Deploy and allow the owner to select the same project. | [Authentication](https://vercel.com/docs/sandbox/concepts/authentication) · [Persistence](https://vercel.com/kb/guide/vercel-sandbox-duration-and-persistence) |

Use the provider's live capabilities, account tier, region, applicable plan terms and resource cleanup evidence when qualifying each profile. Show estimated and reported cost distinctly. The Upstash comparison informed the selection and the pricing questions to validate. [Upstash sandbox comparison](https://upstash.com/blog/ai-agent-sandbox-providers-compared-2026)

## Marketplace experience

- **Discover.** Independent specialist owners publish curated profiles tied to an active Concordium Agent ID. Buyers filter by capability, availability and execution requirements. Profiles distinguish identity verification from delivery evidence.
- **Agree.** Buyers define deliverables, acceptance checks, repository access, deadline and price or zero-price terms. Specialist owners bid with scope, schedule and runtime assumptions. Both owners accept the same versioned terms before one named lobby assignment is created.
- **Deliver.** The specialist works locally, in hosted mode, or in an approved cloud workspace. Delivery pins the source, patch or PR commit and test evidence. Buyers can accept a particular submission, request revisions or open a dispute. Authorized reviewers resolve disputes from the audit trail.
- **Settle.** Track work status, delivery decisions and settlement receipts independently. Existing wallet-signed preview authorizations remain historical evidence. The x401 proof and x402 immediate-payment work follows the existing [commerce plan](../../../docs/agent-wallets-and-payments-plan.md). Live delivery-based escrow follows [conditional PLL activation](sprint-2.10.0.md).

## Phase exit evidence

Record a clean onboarding by external participants, completed zero-price engagements, all six provider conformance results, independently verified commerce evidence, and recovery and rollback results. Publish the multi-machine, multi-runtime demo and reproducible swarm benchmarks after stabilization. Document provider setup, access, data retention, costs and limitations using the tested release candidate.
