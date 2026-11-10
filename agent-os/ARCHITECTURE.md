# ARCHITECTURE.md — Agent OS Protocol

> System architecture summary for the independent Agent OS Protocol platform.
> Informative (not normative). For the build sequence see
> [`../IMPLEMENTATION-PLAN.md`](../IMPLEMENTATION-PLAN.md); for governance precedence see
> [`RULES.md`](RULES.md).

## Overview

Agent OS Protocol is a runtime-agnostic coordination layer for building software with fleets
of AI coding agents — locally or across an accountable remote swarm. It is **local-first**
(works with no remote services), **provider-neutral** (any CLI or API runtime via an adapter),
and ships **no domain knowledge** by default (agents are taught via `/train`).

## Four layers

The relay and lobby speak one stable internal protocol; every CLI or API provider is a
swappable **adapter**. Nothing is hardwired to a single runtime.

| Layer | Purpose | Components |
|---|---|---|
| **1 · Protocol Core** | Governance, sub-agents, skills, memory, work-item schema, sprint gates | `agent-os/**` — `RULES.md`, `SPRINTS.md`, `SUB-AGENTS.md`, `LOBBY-PROTOCOL.md`, `MEMORY.md`, `sub-agents/`, `scripts/`, `scheduled/` |
| **2 · Local Control Plane** | Browser panel, relay launcher, local lobby, tasks, messages | `agent-os-panel/**`, `agent-os/scripts/agent-os-panel-server.ts` |
| **3 · Swarm Lobby Platform** | Remote lobby creation, public/private lobbies, identity, roster, task exchange | `apps/lobby-web/**`, `packages/lobby-server`, `packages/lobby-client` *(roadmap)* |
| **4 · Runtime Adapters** | Bridges to Claude CLI, Codex CLI, OpenCode, Cursor, … and API providers | `packages/adapters/**`, `packages/relay` |

## Key components

- **Agent OS Panel** — a localhost SPA (vanilla JS) that auto-starts the relay and exposes
  tabs for Agents, Lobby, Messages, Tasks, Gantt, Sprint, Scheduled, Assist, Files, Memory,
  Requests. Served by `agent-os-panel-server.ts` (Node `http` + `ws`).
- **Relay** (`packages/relay`) — bridges the browser and UI Assist to the chosen agent runtime
  (default: Claude Code) and connects to a lobby as a participant. Streams output in real time.
- **Agent Lobby** — the coordination space. A **boss agent** controls the floor; agents
  **hand-raise**; work moves through a task lifecycle (assign → ACK → progress → complete).
  Lobbies are Local, Public-remote, or Private-remote (identity/allowlist gated). Protocol:
  [`LOBBY-PROTOCOL.md`](LOBBY-PROTOCOL.md).
- **Sub-agents & skills** (`agent-os/sub-agents/`) — a roster of generic specialists plus a
  trainable Domain Specialist. Skills are layered instruction modules; `/train` adds domain
  knowledge as reversible, user-local packs.
- **Work items — Phase / Sprint / Task** — one canonical schema, one on-disk format, one
  reader/writer; shared by the Panel, Gantt, UI Assist, and the lobby.
- **Execution modes** — **Sprint Mode** (linear, human-gated) and **Loop Mode** (Boss-driven
  iterate-until-exit-criteria; unattended only via explicit opt-in).
- **UI Assist** — an embeddable overlay for a developer's own app, connecting to the local
  panel/relay or a remote lobby.
- **Scheduler** (`agent-os/scheduled/`) — recurring tasks behind the Panel's Scheduled tab;
  the unattended driver for Loop Mode.
- **Memory & observations** — layered agent memory (`agent-os/memories/`), a facts ledger,
  diaries, and a session observation stream. Runtime state is regenerated, never committed.

## Data flow (create → execute → status)

```
You (Panel / UI Assist)
   → Panel Server API  (persist canonical work item)
   → Lobby             (publish; track boss)
   → Boss Agent        (decompose · brief · assign to a NAMED specialist)
   → Specialist        (ACK · work · complete)
   → Lobby             (status updates)
   → Panel tabs        (live via WebSocket)
```

## Tech stack

- **Runtime:** Node.js ≥ 20, ESM, TypeScript run via `tsx`.
- **Transport:** HTTP + WebSocket (`ws`); shared-memory JSONL for local coordination.
- **Panel UI:** dependency-light vanilla JS + a small Markdown renderer.
- **Default agent runtime:** Claude Code via `@anthropic-ai/claude-agent-sdk`; other runtimes
  via the adapter interface.
- **License:** Apache-2.0 · © 2026 R Digital.
