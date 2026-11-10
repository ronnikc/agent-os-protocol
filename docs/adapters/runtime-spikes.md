<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) 2026 R Digital -->

# Runtime discovery spikes — the rest of the Phase 5 queue

Phase 5 ships **one** new adapter end-to-end (Codex — see [codex-cli.md](codex-cli.md)) and
**documents the remaining candidate runtimes with their blockers** so the next adapter can start
from a known surface rather than from scratch. Capability claims below are **provisional** until
confirmed against a live install with a spawn-based harness (charter §8); each entry ends with the
concrete blocker that must clear before an adapter is worth building.

Recommended build order (lowest-friction first): **OpenCode → Cursor → Hermes / OpenClaw.**

---

## OpenCode

> `sst/opencode` — terminal AI coding agent. **Best next adapter** (clean headless + JSON).

| | |
|---|---|
| Install / auth | `npm i -g opencode-ai` (or curl installer); provider via `opencode auth login` (BYOK) |
| Headless | `opencode run "<prompt>"` — runs a prompt without the TUI |
| JSON stream | `opencode run "<prompt>" --format json` (pipe to `jq`); also an **ACP** (Agent Client Protocol) server over stdin/stdout **nd-JSON**, and a headless HTTP server |
| Resume | session-based (`--session` / `--continue`) |
| MCP | ✅ supported |

**Fit:** maps cleanly onto the adapter contract — `detect()` via `opencode --version`,
`readOutput()` over `opencode run --format json`. The ACP nd-JSON server is an even better
long-run transport (persistent process, no per-turn cold start) and is the recommended path.

**Blocker (minor):** confirm the exact `--format json` event shape (single final object vs.
streamed events) and whether ACP or one-shot `run` is the better driver for multi-turn sessions.
No hard blocker — this is the next adapter to build.

---

## Cursor CLI

> `cursor-agent` — Cursor's headless coding agent.

| | |
|---|---|
| Install / auth | Cursor install; `cursor login` |
| Headless | `cursor-agent -p` / `--print` (non-interactive) |
| JSON stream | `--output-format json` (single final object) or `stream-json` (deltas + tool events) |
| Resume | `--resume <chat-id>` |
| MCP | ✅ supported |

**Fit:** the `stream-json` format maps well onto `RuntimeEvent` (deltas → `output`, tool events →
`tool_call`).

**Blocker (real — documented):** `cursor-agent` **requires a real TTY**; invoked directly from a
subprocess / automation context (exactly how an adapter spawns it) it **hangs indefinitely and
never returns**. An adapter therefore needs a **PTY shim** (e.g. `node-pty`) rather than a plain
`spawn` with piped stdio. That PTY dependency is the gate: decide whether to take it on (it also
helps any other TTY-only runtime) before building the Cursor adapter.

---

## Hermes

> Nous Research "Hermes" agent.

**Status:** not yet spiked. Hermes is primarily a **model family**; a stable, documented
*non-interactive coding-CLI* surface (install command, headless run, structured output, resume)
has **not been confirmed**. Until that exists, an adapter has nothing stable to target.

**Blocker:** confirm whether a first-party Hermes **CLI** with a headless/JSON mode exists and is
stable. If Hermes is only reachable as an API/model, it belongs in the **Phase 6 provider (fuel)
layer** (`ModelProviderAdapter`), not as a runtime adapter. **Resolve which layer it lives in
before any code.**

---

## OpenClaw

> Candidate runtime named in the Phase 5 queue.

**Status:** not yet spiked. No stable, first-party CLI surface (install / headless run / output
format / auth) has been confirmed for this environment.

**Blocker:** confirm the project's canonical CLI, its non-interactive mode, and its output format
against live docs before committing to an adapter. Treat as **deferred** until that discovery is
done — do not guess a surface.

---

## What "documented with blockers" buys us

The adapter contract is proven against a real second runtime (Codex), and the next three
candidates each have a **named, concrete gate** instead of an open-ended "investigate":

- **OpenCode** — pick the driver (one-shot `run --format json` vs. ACP nd-JSON server). _No hard blocker._
- **Cursor** — take on a **PTY shim** to survive its TTY requirement.
- **Hermes** — first decide **runtime adapter vs. Phase 6 provider** (it may be a model, not a CLI).
- **OpenClaw** — confirm a **canonical CLI + headless surface** exists at all.
