# Agent OS Protocol — Project Context (CLAUDE.md)

> **Purpose:** How to work in this repository — structure, run commands, governance map, conventions.
> **Status:** Forking in progress (Phases 0–10 merged — through launch readiness; `v0.1.0` tagged. Phase 11 — Loop Mode — PR open; Phases 12–13 planned). See
> [`IMPLEMENTATION-PLAN.md`](IMPLEMENTATION-PLAN.md) for the phase-by-phase plan and
> [`agent-os/STATE.md`](agent-os/STATE.md) for current state.
> **License:** Apache-2.0 · © 2026 Gothard.dk // Ronni K. Gothard Christiansen.

## What this is

Agent OS Protocol is an open, runtime-agnostic platform for coordinating fleets of AI coding
agents — locally or across an accountable remote swarm. It is **local-first**, **provider-neutral**,
and ships **no domain knowledge** by default (agents are taught via `/train`). See
[`README.md`](README.md) for the product overview and [`agent-os/ARCHITECTURE.md`](agent-os/ARCHITECTURE.md)
for the four-layer architecture.

## Repository structure

```
agent-os-protocol/
  README.md  CLAUDE.md  planning.md  IMPLEMENTATION-PLAN.md  MIGRATION.md  CHANGELOG.md  RELEASING.md
  LICENSE  NOTICE  .env.example  package.json
  agent-os/                       # Layer 1 — Protocol Core
    RULES.md SPRINTS.md SUB-AGENTS.md ARCHITECTURE.md MEMORY.md
    LOBBY-PROTOCOL.md UI-ASSIST.md UI-ASSIST-GUIDE.md ETHICS.md SOUL.md
    HOUSEKEEPING.md sprints-reference.md whisper-rules.md STATE.md
    scripts/                      # panel server, tray (+ generic infra — Phase 1 cont.)
    sub-agents/                   # generic agent roster (established in Phase 2)
    scheduled/                    # recurring-task engine (Phase 1 cont.)
    observations/ shared-memory/ logs/ training/   # runtime state (regenerated)
  agent-os-panel/                 # Layer 2 — local control-plane UI (vanilla JS SPA)
    index.html app.js styles.css presets.json tabs/ lib/
  packages/                       # Layers 3 & 4
    protocol-core/src/            # canonical shared types (runtime-adapter, work-items, lobby, provider, agent-identity) + .env loader
    adapters/src/                 # runtime adapters + registry (claude-cli, codex-cli)
    providers/src/                # model providers (API fuel): openai-/anthropic-compatible, BYOK
    lobby-server/src/             # independent lobby (store + coordinator + HTTP/WS) — npm run lobby
    lobby-client/src/             # typed WS lobby client (discover, register, heartbeat)
    identity-concordium/src/      # read-only agent-identity verification + Agent Card authoring (no keys)
    ui-assist-core/src/           # neutral UI Assist engine: event contract, transport seam, session, permission gate, integration
    ui-assist-embed/              # repo-local embeddable overlay <script> (embed.js) + demo page
    loop/src/                     # Loop Mode engine (LoopOrchestrator + presets) — npm run loop
    relay/src/                    # relay-server.ts + lobby-types.ts
  apps/lobby-web/                 # hosted swarm lobby (Vercel + Upstash) — planned increment
  docs/                           # launch guides: getting-started, examples, security, lobby-hosting, training-agents (+ index)
    adapters/ providers/ lobby/ identity/ ui-assist/  # capability references: contracts, spikes, matrices
  scripts/                        # repo-level scripts (smoke.sh — fresh-clone boot smoke)
  design-specs/                   # panel design mockups
```

## Run commands

```bash
npm install                                      # install deps (Node >= 20)

# Local Mode — Panel + relay + built-in local lobby
npm run agent-os-panel                            # http://localhost:4800

# Panel only (no relay; no Claude auth needed)
npm run agent-os-panel -- --no-relay

# Options
npm run agent-os-panel -- --port 5000             # custom panel port
npm run agent-os-panel -- --lobby <url>           # Swarm Mode: connect to a remote lobby
npm run agent-os-panel-tray                       # system-tray launcher

# Relay only — bridges the browser/UI Assist to your agent runtime (default: Claude Code)
npm run relay                                     # ws://localhost:4722
npm run relay -- --port 5001 --cwd /path/to/repo

# UI Assist — embed the overlay into your own app (Integration Agent)
npm run ui-assist-integrate -- /path/to/app       # detect framework + print the embed plan
npm run ui-assist-integrate -- /path/to/app --json --lobby wss://lobby.example.com

# Lobby server — standalone Swarm Mode lobby the Panel/relay connect to (--lobby <url>)
npm run lobby                                     # ws://localhost:4730
npm run lobby -- --port 5000

# Loop Mode — run a preset loop through the engine (simulated / dry-run driver)
npm run loop -- --list
npm run loop -- --preset continuous-quality [--unattended]

# Verify the layers (no runtime/key/service needed — injected seams)
npm run verify-adapters
npm run verify-providers
npm run verify-lobby
npm run verify-identity
npm run verify-ui-assist
npm run verify-loop       # Loop Mode engine: caps, convergence/stall, regression, checkpoints
npm run verify-launch     # launch-readiness invariants (docs, scripts, gates, references, license)
npm run verify-all        # all seven suites in one chain
npm run smoke             # fresh-clone boot smoke: install → verify-all → boot Panel/Lobby/Relay → probe
```

Configuration is via `.env` (copy from `.env.example`): `AGENT_OS_LOBBY_URL` (empty = Local Mode),
`AGENT_OS_PANEL_PORT`, `AGENT_OS_RELAY_PORT`. BYOK provider keys stay local and are never sent to a lobby.
`AGENT_OS_CONCORDIUM_INDEXER_URL` (empty = no identity verification) points the lobby at a **read-only**
registry indexer for the private-lobby identity policy ladder — no private keys are ever stored or sent.

## Governance map

> **Precedence** (highest first): current sprint/plan → RULES → CLAUDE → ETHICS → SUB-AGENTS →
> SPRINTS → STATE → ARCHITECTURE → SOUL → README. STATE/ARCHITECTURE are informative, not normative.

| File | What it covers |
|------|----------------|
| [`IMPLEMENTATION-PLAN.md`](IMPLEMENTATION-PLAN.md) | The fork build plan (Phases 0–13), extraction manifest, risks |
| [`agent-os/RULES.md`](agent-os/RULES.md) | Non-negotiable operational rules + precedence |
| [`agent-os/SPRINTS.md`](agent-os/SPRINTS.md) | Sprint lifecycle, gates, close-out |
| [`agent-os/SUB-AGENTS.md`](agent-os/SUB-AGENTS.md) | Sub-agent roster, routing, verification |
| [`agent-os/LOBBY-PROTOCOL.md`](agent-os/LOBBY-PROTOCOL.md) | Lobby coordination (boss, floor control, hand-raise) |
| [`agent-os/MEMORY.md`](agent-os/MEMORY.md) | Memory system + retrieval rules |
| [`agent-os/ARCHITECTURE.md`](agent-os/ARCHITECTURE.md) | Four-layer system architecture |
| [`agent-os/ETHICS.md`](agent-os/ETHICS.md) | Quality commitment, accountability |
| [`agent-os/SOUL.md`](agent-os/SOUL.md) | Voice, tone, interaction protocol |
| [`agent-os/HOUSEKEEPING.md`](agent-os/HOUSEKEEPING.md) | Governance-file consistency checklist |
| [`agent-os/UI-ASSIST.md`](agent-os/UI-ASSIST.md) | UI Assist overlay interaction rules |

## Conventions

- **TypeScript, ESM, run via `tsx`.** Node ≥ 20. No build step for the panel/relay (run directly).
- **Keep the platform product-neutral.** No domain-specific branding or content in the core —
  domain knowledge belongs in optional, `/train`-able packs (see `agent-os/training/`).
- **Runtime state is regenerated, never committed** (observations, shared-memory state, logs,
  graph artifacts, scheduler state, trained packs are gitignored).
- **Branch + PR.** Develop on a feature branch; never push straight to `main`; open a PR to merge.
- **Verify before done.** A change isn't done because it compiles — boot the panel/relay and
  exercise the affected flow (see IMPLEMENTATION-PLAN.md §13.1 Functional Flow Verification).

## Working in this repo

The platform is mid-fork. When in doubt about scope or sequencing, consult
[`IMPLEMENTATION-PLAN.md`](IMPLEMENTATION-PLAN.md) — it is the source of truth for what is being
built, in what order, and what must not be touched (the original source repo is read-only reference).
