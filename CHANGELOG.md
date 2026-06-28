<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen -->

# Changelog

All notable changes to **Agent OS Protocol** are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — Loop Mode (Phase 11)

- **`@agent-os/loop` engine** — a Boss-driven `Assess → Delegate → Verify → Reflect → Decide`
  control loop over a work item (the `LoopSpec`/`ExitCriterion` schema seeded in Phase 4), behind
  injected seams so the whole controller verifies with no LLM/lobby/network. Safety: hard
  `maxIterations` + token/cost/wall-clock budget, convergence + stall detection, a regression guard,
  human approval checkpoints (fail-closed), a kill switch, full audit, and **unattended OFF by
  default** (opt-in at run time, allowlisted actions only).
- **Authoring + orchestration skills** — `create-loop` (forces machine-checkable exit criteria,
  hard caps, gated checkpoints) and `loop-orchestrator` (the Boss control-loop skill); wired into
  the boss-agent definition and SUB-AGENTS routing.
- **`continuous-quality` preset** — the Scheduled-QA workload as a `LoopSpec` (build + tests +
  coverage + Product-QA review; `onConverge: open-pr`, never an autonomous merge); the canonical
  deliberately-operated unattended loop with a commit-only allowlist.
- **`npm run loop`** — a simulated/dry-run driver that runs a preset through the real engine and
  prints the iteration audit trail (attended and unattended).
- **Panel Loop tab + endpoints** — `GET /api/loops`, `POST /api/loops/run`, `POST /api/loops/stop`
  with `loop-event`/`loop-done` WS streaming, and a minimal Loop tab.
- **`npm run verify-loop`** (17 checks) — wired into `verify-all` and required by `verify-launch`
  (now 53). **[`docs/loop-mode.md`](docs/loop-mode.md)** guide.

### Planned

- Panel UI redesign (Phase 12) and the public website (Phase 13). See
  [`IMPLEMENTATION-PLAN.md`](IMPLEMENTATION-PLAN.md).
- Loop Mode follow-ups (infra-gated): live `evaluate`/`delegate` wiring through the relay/lobby,
  unattended cron over a swarm, and the polished Panel Loop view (folds into Phase 12).

## [0.1.0] — 2026-06-28

The first launch-ready, publicly runnable cut of the independent fork. A fresh clone boots Local
Mode, connects to a configured lobby, and passes every verification suite — proven end-to-end by
`npm run smoke`. Apache-2.0, product-neutral, no domain knowledge baked in.

### Added

- **Local Mode (Phase 1).** Browser **Agent OS Panel** + **relay** + a built-in local lobby boot
  with `npm run agent-os-panel`. Apache-2.0 `LICENSE`/`NOTICE`, de-branded throughout.
- **Generic agent roster (Phase 2).** 30 project-neutral agents (24 generic specialists + 6
  platform agents: domain-specialist, identity, lobby-architect, runtime-adapter,
  ui-assist-integration, training) and a curated generic skill set.
- **`/train` (Phase 3).** Teach a generic agent from your own docs — reviewable, reversible,
  secret-safe, local by default (`npm run train`, the `/train` command). See
  [Training agents](docs/training-agents.md).
- **Runtime adapters + canonical work items (Phase 4).** `@agent-os/protocol-core` shared types
  and `@agent-os/adapters` registry; the Claude CLI adapter extracted from the relay; the
  `Phase/Sprint/Task` schema with `create-phase`/`create-sprint`/`create-task` authoring skills
  (`npm run work-items`).
- **Codex CLI adapter (Phase 5).** A second first-class runtime (`codex exec --experimental-json`,
  thread resume). Compatibility matrix + spikes in [`docs/adapters/`](docs/adapters/README.md).
- **API provider (fuel) layer, BYOK (Phase 6).** `@agent-os/providers` — OpenAI- and
  Anthropic-compatible `complete()` + SSE `stream()`; BYOK is structural (configs store only the
  env-var name; keys never serialize or reach a lobby). See [providers](docs/providers/README.md).
- **Independent lobby (Phase 7).** `@agent-os/lobby-server` (portable Node HTTP+WS) +
  `@agent-os/lobby-client`, with server-side floor control, lobby-scoping, directed-task-only,
  private allowlist, public rate-limit, and a durable event log (`npm run lobby`). See
  [Lobby hosting](docs/lobby-hosting.md).
- **Concordium agent identity (Phase 8).** Read-only, key-free verification + Agent Card
  authoring; the private-lobby identity policy ladder enforced server-side, fail-closed. See
  [identity](docs/identity/README.md).
- **UI Assist integration (Phase 9).** `@agent-os/ui-assist-core` + `@agent-os/ui-assist-embed`
  (dependency-free `embed.js`), the Integration Agent (`npm run ui-assist-integrate`, 8
  frameworks), suggest-only by default. See [UI Assist](docs/ui-assist/README.md).
- **Launch readiness (Phase 10).**
  - The launch documentation set under [`docs/`](docs/README.md): getting-started, examples,
    security, lobby-hosting, training-agents, and the documentation index — wired together and the
    root README pointed at them.
  - `npm run verify-launch` (47 launch invariants) and `npm run verify-all` (all six suites), plus
    `npm run smoke` — the fresh-clone boot smoke (install → verify-all → boot Panel/Lobby/Relay →
    HTTP probes → teardown).
  - Real `.env` configuration: a zero-dependency loader in `@agent-os/protocol-core` and
    `AGENT_OS_LOBBY_URL` / `AGENT_OS_PANEL_PORT` / `AGENT_OS_RELAY_PORT` / `AGENT_OS_LOBBY_PORT`
    honoured with **flag → `.env` → default** precedence.

### Changed

- `.env.example` rewritten for accuracy (documents `AGENT_OS_LOBBY_PORT`, states the precedence,
  and demotes the not-yet-wired `AGENT_OS_RUNTIME` to a clearly-labelled "planned").
- Two generic skills (`persona-usecase-validation`, `module-production-review`) authored so the
  kept `user-validation` / `product-qa` agents are self-consistent.

### Fixed

- Cleared the last domain-gate leak and all dangling skill references in the agent roster (the
  `security` agent cited two dropped regulatory skills).

### Security

- The trust model is documented in one place: [`docs/security.md`](docs/security.md) — local-first,
  structural BYOK, server-side lobby enforcement, read-only identity, UI Assist least-privilege.

### Deferred / infra-gated (tracked in [`agent-os/STATE.md`](agent-os/STATE.md))

- Publishing the `@agent-os/*` packages and bundled UI Assist framework wrappers to npm.
- The hosted swarm lobby `apps/lobby-web` (Vercel + Upstash) — REST + SSE over the same
  store/coordinator.
- Live Concordium indexer wiring and on-chain (wallet-side) registration.
- Routing the relay's turn loop through the runtime adapter so `AGENT_OS_RUNTIME` selects the
  driver (and a panel provider/runtime selector).

[Unreleased]: https://github.com/ronnikc/agent-os-protocol/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ronnikc/agent-os-protocol/releases/tag/v0.1.0
