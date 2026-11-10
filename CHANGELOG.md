<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) 2026 R Digital -->

# Changelog

All notable changes to **Agent OS Protocol** are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- Document the Phase 1 panel and the Phase 2 commerce status on the website and in the README,
  including the finalized 10 CCD Verify & Pay pilot.
- Save Agent IDs through pull requests when the connected repository protects its target branch.
- Add an opt-in, wallet-free admin account scoped to a dedicated private test lobby.
- Require signed sessions for private lobby creation and enforce membership and manager access at
  the server. Record moderation under the authenticated identity and disconnect revoked members.
- Require explicit consent before a remote lobby can trigger local relay execution.
- Verify Linux and Windows changes in CI, gate deployments on the build and test suite, and expose
  the deployed revision in health checks.

## [0.2.0] — 2026-06-30

The first beta release of the independent platform. Integrates autonomous Loop Mode, a fully responsive glassmorphism control panel redesign, a public landing website, and a local swarm lobby preview dashboard with stats telemetry.

### Added

- **Loop Mode (Phase 11):** `@agent-os/loop` engine with autonomous iterative execution to meet exit criteria. Includes scheduling, attended/unattended modes, and `npm run loop`.
- **Panel UI Redesign (Phase 12):** Premium dark glassmorphism styling, keyboard navigation, and WCAG AA contrast compliance.
- **Landing Website (Phase 13-14):** Main website served locally via `npm run website` containing visual showcases, roster references, and command guides.
- **Lobby Dashboard & Swarm Telemetry (Phase 15):** Standalone lobby dashboard serving on `http://localhost:4730/` featuring real-time telemetry counters (users, agents, verified Concordium identities, public/private lobbies) and Swarm Mode connection documentation.

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

[Unreleased]: https://github.com/ronnikc/agent-os-protocol/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/ronnikc/agent-os-protocol/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ronnikc/agent-os-protocol/releases/tag/v0.1.0
