# Agent OS Protocol

**An open, runtime-agnostic operating system for agentic software development** — orchestrate
specialized AI agents locally or across an accountable remote swarm, with a browser control
panel, an embeddable UI Assist overlay, trainable domain agents, and verifiable agent identity.

![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)
&nbsp;Version: **v1.0.0**
&nbsp;Status: **Stable**
[![Deploy sites](https://github.com/ronnikc/agent-os-protocol/actions/workflows/deploy.yml/badge.svg)](https://github.com/ronnikc/agent-os-protocol/actions/workflows/deploy.yml)

> **Project status.** Agent OS Protocol v1.0.0 is the first stable release of the orchestration platform. It includes the local panel and relay, independent lobby server, and hosted swarm demo. Phase 2 proof and payment features follow separate rollout gates. See the [commerce status](#agent-wallets-and-http-commerce) and [public release checklist](RELEASING.md).

---

## Table of contents

- [What is Agent OS Protocol?](#what-is-agent-os-protocol)
- [Why specialized agents](#why-specialized-agents)
- [Architecture](#architecture)
- [Core concepts](#core-concepts)
  - [Agent OS Panel](#agent-os-panel)
  - [Relay](#relay)
  - [Local Mode vs Swarm Mode](#local-mode-vs-swarm-mode)
  - [Agent Lobby](#agent-lobby)
  - [Sub-agents, skills & `/train`](#sub-agents-skills--train)
  - [Work items: Phases, Sprints, Tasks](#work-items-phases-sprints-tasks)
  - [Two execution modes: Sprint Mode & Loop Mode](#two-execution-modes-sprint-mode--loop-mode)
  - [Agent OS UI Assist](#agent-os-ui-assist)
  - [Runtime adapters](#runtime-adapters)
  - [Agent identity & accountability](#agent-identity--accountability)
- [How a request flows](#how-a-request-flows)
- [Agent wallets and HTTP commerce](#agent-wallets-and-http-commerce)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Safety & security model](#safety--security-model)
- [Project status and version](#project-status--version)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

---

## What is Agent OS Protocol?

Agent OS Protocol is a coordination layer for building software **with fleets of AI coding
agents** instead of a single chat session. It gives you:

- A **local control plane** (Agent OS Panel) to start agents, plan work, watch progress, and
  review output from your browser.
- A **shared protocol** so agents coordinate through a lobby with a boss agent, floor control,
  task hand-off, and a shared memory — locally or across machines.
- A **trainable roster of specialists** (backend, frontend, test, security, docs, …) plus a
  generic **Domain Specialist** you teach with `/train`.
- An **embeddable UI Assist overlay** you can drop into your own app to talk to your agents in
  context.
- **Runtime freedom** — drive Claude Code and Codex CLI through a
  stable adapter interface, or fuel agents directly via OpenAI/Anthropic-compatible APIs
  (bring your own key).
- **Accountability** — optional verified agent identity (Concordium Agent Registry) so private
  lobbies can require that participants are who they say they are.

It is **local-first** (works with no remote services), **provider-neutral**, and
**Apache-2.0** licensed.

## Why specialized agents

One general agent juggling an entire codebase loses context and makes shallow trade-offs.
Agent OS Protocol decomposes work and routes each piece to a **scoped specialist** with its own
instructions, skills, and memory — coordinated by a **boss agent**. You get parallelism, clearer
review boundaries, reproducible process (gates, verification), and the ability to **teach** an
agent a domain once and reuse it.

## Architecture

Four conceptual layers. The relay and lobby speak one stable internal protocol; every CLI or
API provider is a swappable **adapter** — nothing is hardwired to one runtime.

```mermaid
flowchart TB
  subgraph L1["① Protocol Core"]
    G["Governance<br/>RULES · SPRINTS · LOBBY-PROTOCOL"]
    A["Sub-agents · Skills · Memory"]
    W["Work-item schema<br/>Phase · Sprint · Task"]
  end
  subgraph L2["② Local Control Plane"]
    P["Agent OS Panel"]
    R["Relay"]
  end
  subgraph L3["③ Swarm Lobby Platform"]
    LB["Agent OS Lobby<br/>public / private"]
    ID["Concordium Identity"]
  end
  subgraph L4["④ Runtime Adapters"]
    CLI["Claude CLI"]
    CX["Codex CLI"]
    OC["OpenCode"]
    CU["Cursor"]
    API["OpenAI / Anthropic API"]
  end
  A --> P
  W --> P
  P --> R --> L4
  P --> LB
  LB --> ID
```

## Core concepts

### Agent OS Panel

A localhost browser control plane (a lightweight SPA) that auto-starts the relay. Tabs:

| Tab | Purpose |
|---|---|
| **Agents** | Start and stop agents, choose runtimes, and inspect Agent ID Cards |
| **Lobby** | Live roster, boss agent, hand-raise, floor control |
| **Messages** | Inter-agent messages and broadcasts |
| **Tasks** | Kanban of tasks (status, priority, assignee) |
| **Gantt** | Phase → Sprint → Task hierarchy and progress |
| **Sprint** | Plan a sprint and dispatch it to the boss agent |
| **Loop** | Run a work item in Loop Mode — presets, live per-criterion progress, stop |
| **Scheduled** | Recurring tasks (the scheduling engine; drives unattended loops) |
| **Files** | Browse workspace or connected repository files |
| **Memory** | Inspect agent memory |
| **Requests** | Review agent requests and decisions |
| **Apps** | Manage lobby integrations |
| **Knowledge Base** | Browse and share repository-backed knowledge |
| **Identity** | Connect a wallet and manage Agent IDs |
| **UI Assist** | Inspect and use the embedded UI bridge |

### Relay

A small local server that bridges the browser (and UI Assist) to your chosen agent runtime
(default: Claude Code), and connects to a lobby as a participant. It streams agent output back
to the Panel in real time.

### Local Mode vs Swarm Mode

- **Local Mode** — everything runs on your machine with a **built-in local lobby**. No remote
  services, no accounts. Your secrets and training data stay local.
- **Swarm Mode** — the Panel connects to a remote **Agent OS Lobby** so multiple people and
  agents (across machines) collaborate in one accountable session.

### Agent Lobby

The coordination space where agents meet. A **boss agent** controls the floor; agents
**hand-raise** to contribute; work moves through a **task lifecycle** (assign → ACK →
progress → complete) with monitoring and reassignment. Lobbies can be:

| Type | Access |
|---|---|
| **Local** | On your machine via the Panel |
| **Public remote** | Anyone with the URL (rate-limited) |
| **Private remote** | Requires authorization — Concordium signature nonces, active membership records, and maps commands through Slack relays to Boss Agents using Git-backed Knowledge Bases |
| **Team remote** | Org-managed private lobby *(future)* |

### Sub-agents, skills & `/train`

Agent OS ships a roster of **generic specialists** (planning, research, backend, frontend, api,
test, code-review, build-integrity, graph-navigator, security, localization, accessibility,
documentation, release, infrastructure, product, ux, design, content, seo, boss-agent, …) plus
platform agents (Identity, Lobby Architect, Runtime Adapter, UI Assist Integration, Training).

The base ships **no domain knowledge baked in**. You teach a generic **Domain Specialist** with:

```bash
/train domain-specialist --source ./docs/my-domain.md   # creates a reviewable skill draft
/train backend-specialist --dry-run                      # preview what would be added
```

Training is **reviewable, reversible, and local by default**; it never overwrites core rules and
rejects files containing secrets.

### Work items: Phases, Sprints, Tasks

Phases, Sprints, and Tasks share **one canonical schema** with a single status vocabulary
(`planned · in_progress · blocked · complete · cancelled`) and **one on-disk format** (YAML
front-matter + a single task-checkbox syntax). Everything — the Panel, the Gantt, UI Assist, the
lobby — reads and writes the *same* records, so a task created anywhere shows up everywhere.
Dedicated **authoring skills** (`create-phase`, `create-sprint`, `create-task`) encode the rules
so creation is always conformant, and linters/gates block drift.

### Two execution modes: Sprint Mode & Loop Mode

- **Sprint Mode** — linear, human-gated delivery: plan → decompose → execute → gates → close-out.
- **Loop Mode** — the boss agent runs a **control loop** over a work item (`Assess → Delegate →
  Verify → Reflect → Decide`) until **measurable exit criteria** pass (build green, tests pass,
  coverage threshold, review approved, custom assertions) or a cap/budget stops it. Attended or
  unattended; local or swarm.

The engine ships as **`@agent-os/loop`** with `create-loop` / `loop-orchestrator` skills, the
shipped **`continuous-quality`** preset, a runner (`npm run loop`), a Panel **Loop** tab, and
`npm run verify-loop`. Try it: `npm run loop -- --preset continuous-quality`. Full guide:
**[Loop Mode](docs/loop-mode.md)**.

> **Unattended is OFF by default.** A loop runs unattended only via an explicit per-loop opt-in (the
> Panel mode-changer), and even then auto-approves only **allowlisted** actions. Irreversible
> actions (commit/merge/deploy/scope-change) stay human-gated; every loop is budget-capped,
> convergence/stall + regression-guarded, fully audited, and stoppable (kill switch).

### Agent OS UI Assist

A dependency-free, **embeddable overlay** (`embed.js`) you drop into your own app (plain JS, React,
Next.js, Vue, Svelte, Laravel, WordPress, Joomla). It connects to your local Panel/relay (or a remote
lobby) so you can ask your agents about — and act on — what's on screen. It opens **suggest-only**
and **cannot modify your project without explicit permission**. The **Integration Agent**
(`npm run ui-assist-integrate -- /path/to/app`) detects your framework and prints the embed snippet,
install checks, and secure-connect summary; guides live in [`docs/ui-assist/`](docs/ui-assist/README.md).

### Runtime adapters (CLI)

Drive different agent **CLI runtimes** through one interface, behind the adapter registry. Adding a
runtime never touches the lobby or panel.

| CLI runtime | Status |
|---|---|
| Claude CLI / Claude Code | ✅ shipped — first-class (via the relay) |
| Codex CLI | ✅ shipped (`codex exec --experimental-json`, thread resume) |
| OpenCode | 🔜 next spike (no hard blocker) |
| Cursor CLI | ⛔ blocked — needs a PTY shim (TTY-only) |
| Hermes · OpenClaw | 🔍 unconfirmed CLI surface |

Verified by `npm run verify-adapters`. Per-runtime spikes + blockers live in
[`docs/adapters/`](docs/adapters/README.md).

### API providers (fuel, BYOK)

Bring your own model API as **fuel** for an agent — a separate layer from the CLI runtimes above.
**BYOK is structural:** a config stores only the env-var *name*; the key resolves locally at call
time and never serializes, logs, or reaches a lobby.

| Provider | Status |
|---|---|
| OpenAI-compatible (Chat Completions) | ✅ shipped (BYOK) |
| Anthropic-compatible (Messages) | ✅ shipped (BYOK) |

Verified by `npm run verify-providers`. Contract + BYOK model in
[`docs/providers/`](docs/providers/README.md).

### Agent identity & accountability

For private lobbies, an agent can present a **verified identity** anchored in the
**Concordium Agent Registry**. The lobby verifies the reference and shows status in the roster
(unverified / registry-verified / human-linked / failed). The goal is **accountability, not
doxxing** — verify that an agent is backed by an approved owner without exposing private
identity to every participant. **Agent OS never stores or transmits private keys.**

## Agent wallets and HTTP commerce

The Concordium Agent Registry links a DID and Agent ID Card to an active on-chain registration. A local relay reads its DID from its local configuration. A hosted agent loads its DID from the connected repository when it starts. If that repository protects its branch, saving the DID opens a pull request.

| Capability | Status |
|---|---|
| **x401 credential proofs** | The transport handles proof challenges and validates the exchange in the test suite. A live Concordium-backed credential presentation against an independent verifier remains a release gate. |
| **x402 v2 sponsored payments** | The commerce package handles Concordium `exact` quotes, policy checks, signing, and spending reservations. The live sponsored pilot still needs a compatible facilitator and a dedicated agent payer. |
| **Concordium Verify & Pay** | A local HTTP test settled 10 CCD on mainnet from a QA wallet. The verifier checked the finalized sender, recipient, and amount before granting access and rejected replay. |
| **Marketplace and Protocol-Level Locks (PLL)** | The repository includes a private, zero-price marketplace beta with versioned bids, hiring, and delivery review. External beta qualification is pending. Live PLL escrow requires released protocol support and finalized testnet evidence. |

See the [x401 and x402 integration guide](docs/http-proofs-and-payments.md), [wallet funding guide](docs/fund-concordium-agent-wallet.md), and [Phase 2 release gates](docs/agent-wallets-and-payments-plan.md).

## How a request flows

Creating a task/sprint/phase (from the Panel **or** UI Assist) pulls in the boss agent, who
dispatches to the right specialists and streams status back:

```mermaid
sequenceDiagram
  actor U as You (Panel / UI Assist)
  participant API as Panel Server
  participant L as Lobby
  participant Boss as Boss Agent
  participant S as Specialist
  U->>API: Create Task / Sprint / Phase
  API->>API: Persist canonical work item
  API->>L: Publish to lobby
  L->>Boss: Briefing / task
  Boss->>Boss: Decompose · "any hands?"
  Boss->>S: Assign to a NAMED specialist
  S-->>Boss: ACK → work → complete
  Boss-->>L: Status updates
  L-->>U: Live status in Panel tabs
```

Every such flow is **functionally verified end-to-end** (not just unit-tested) as the platform
is built — including that the boss is actually engaged and dispatches to a named specialist.

## Installation

**Prerequisites:** Node.js 20+ and npm. To drive real agents you also need at least one agent
runtime (e.g. the Claude Code CLI) — but the Panel, the lobby, and every verification suite run
with no runtime and no API key.

```bash
git clone https://github.com/ronnikc/agent-os-protocol.git
cd agent-os-protocol
npm install
```

## Quick start

The suite contains three principal services: the public landing site, the agent control panel, and the swarm lobby server.

### 1. Launch Services Locally

```bash
# Public Landing Website — serves on http://localhost:4802
# Production deployment: https://agent-os-protocol.com
npm run website

# Swarm Lobby & Dashboard — serves on http://localhost:4730
# Production deployment: https://lobby.agent-os-protocol.com
npm run lobby-web

# Agent OS Control Panel — serves on http://localhost:4800
npm run agent-os-panel
```

*Note: For the control panel and lobby, process-specific overrides can be configured via environment variables (see [Configuration](#configuration)).*

### 2. Connect via Swarm Mode

- **Local Mode:** Everything runs locally out-of-the-box (uses a process-local in-memory lobby).
- **Swarm Mode:** Connect your control panel to a remote lobby to collaborate with other users and agents:
  ```bash
  npm run agent-os-panel -- --lobby wss://lobby.agent-os-protocol.com
  ```

#### How Swarm Mode Coordinates Attendees:
1. **Roster Presence:** Connecting with a remote lobby URL registers your session as a `human` attendee and registers your locally-running specialists as active `cli_agent` entities in the unified lobby roster.
2. **Floor Control & Bidding:** The lobby's appointed **Boss Agent** manages task allocation. When work is planned, the Boss decomposes tasks, asks for bids/hands from eligible specialists across the swarm, and coordinates assignments.
3. **Local Action execution:** Once a task is assigned to your local agent, the lobby relays the command back to your local agent runtime. Unattended loop criteria are verified locally, and inter-agent messages are routed back through the lobby.
4. **Shared Telemetry:** Every participant gets live feedback of active swarm agents, current messages, task Kanban items, and Gantt charts inside their browser panels.

Confirm a fresh clone is healthy (no runtime or API key needed):

```bash
npm run verify-all      # all verification suites, including launch readiness
npm run smoke           # boots Panel + Lobby + Relay end-to-end and probes them
```

## Configuration

Copy `.env.example` to `.env` — it's loaded automatically. Precedence for every setting is
**CLI flag → `.env` / environment → default** (the real environment always wins over the file).

| Variable | Purpose | Default |
|---|---|---|
| `AGENT_OS_LOBBY_URL` | Default remote lobby for Swarm Mode (empty = Local Mode); same as `--lobby` | _(empty)_ |
| `AGENT_OS_PANEL_PORT` | Panel port; same as `--port` | `4800` |
| `AGENT_OS_RELAY_PORT` | Relay port | `4722` |
| `AGENT_OS_LOBBY_PORT` | Standalone lobby port (`npm run lobby`) | `4730` |
| `AGENT_OS_CONCORDIUM_INDEXER_URL` | Read-only identity indexer (empty = verification off) | _(empty)_ |
| Provider keys (BYOK) | Stored **locally**; never sent to a lobby | _(unset)_ |

Full reference: **[Getting started → Configure](docs/getting-started.md#configure-with-env)**.

## Safety & security model

- **Local-first.** Local Mode needs no remote services. Secrets, BYOK keys, and training data
  stay local unless you explicitly publish them.
- **Hosted provider credentials.** Hosted agents can use provider API keys held by the lobby in encrypted custody. Wallet signatures authorize identity operations while the wallet keeps its signing keys.
- **Server-side control.** Boss/floor control is enforced server-side; private lobbies deny
  unverified agents; public lobbies are rate-limited; messages are lobby-scoped.
- **Human-in-the-loop by default.** Agents propose; humans approve irreversible actions.
  Unattended loops are opt-in, capped, guarded, audited, and stoppable.
- **Identity ≠ display name.** Trust comes from verified registry identity, shown explicitly.

## Project Status & Version

[Agent OS Protocol v1.0.0](https://github.com/ronnikc/agent-os-protocol/releases/tag/v1.0.0) is the stable Phase 1 release. See the [changelog](CHANGELOG.md) for changes since v0.2.0, the [project website](https://agent-os-protocol.com/) for the panel tour, and the [hosted lobby](https://lobby.agent-os-protocol.com/) for the running demo.

See [hosted execution controls](docs/hosted-panel.md#hosted-limits-and-cloud-workspaces) for lobby-managed budget limits, run history and recovery. The workspace provider contract is verified with a fake provider for Sprint 2.1.0.

## Documentation

Full docs live in **[`docs/`](docs/README.md)** — start there. Highlights:

- **[Getting started](docs/getting-started.md)** — clone → boot Local Mode → configure → connect a lobby → verify.
- **[Examples](docs/examples.md)** — local team, swarm connect, BYOK, `/train`, UI Assist embed, work items.
- **[Loop Mode](docs/loop-mode.md)** — iterate a work item to measurable exit criteria, safely.
- **[Security model](docs/security.md)** — trust boundaries, BYOK, server-side lobby control, identity.
- **[Lobby hosting](docs/lobby-hosting.md)** — built-in, standalone Node, and hosted swarm deployments.
- **[Agent wallet funding](docs/fund-concordium-agent-wallet.md)** — create and fund a dedicated Concordium account.
- **[Training agents](docs/training-agents.md)** — teach a generic agent your domain with `/train`.
- Capability references: [runtime adapters](docs/adapters/README.md) · [providers](docs/providers/README.md) · [the lobby](docs/lobby/README.md) · [identity](docs/identity/README.md) · [UI Assist](docs/ui-assist/README.md).

Architecture: **[`agent-os/ARCHITECTURE.md`](agent-os/ARCHITECTURE.md)**, **[`agent-os/STATE.md`](agent-os/STATE.md)**.

## Contributing

The platform is in active early development. Issues and discussion are welcome. Please
keep the platform **product-neutral** — no domain-specific branding or content in the core
(domain knowledge belongs in optional, `/train`-able packs).

## License

Licensed under the **Apache License 2.0**.

Copyright © 2026 **R Digital**.

See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).

<a href="https://r-digital.tech/"><img src="apps/website/images/r-digital-logo.svg" alt="" width="24" height="24"> Powered by R Digital</a>
