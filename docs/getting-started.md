<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen -->

# Getting started

From a fresh clone to a running control plane in a few minutes. By the end you will have the
**Agent OS Panel** open in your browser (Local Mode), know how to configure it with `.env`, know
how to connect to a **lobby** (Swarm Mode), and know how to confirm your install is healthy.

## Prerequisites

- **Node.js ≥ 20** and **npm**. (Check with `node -v`.)
- **At least one agent runtime** to actually drive agents — the first-class one is the
  **Claude Code CLI**. The panel itself, the lobby, and all the verification suites run with no
  runtime and no API key; you only need a runtime when you start an agent that does real work.
- Optional: a Chromium build for screenshot/UI flows (one is bundled in CI-style environments).

## Install

```bash
git clone https://github.com/ronnikc/agent-os-protocol.git
cd agent-os-protocol
npm install          # links the @agent-os/* workspaces; no build step (everything runs via tsx)
```

There is **no build step** — the panel, relay, and lobby run directly through `tsx`.

## Boot Local Mode

Local Mode runs everything on your machine: the panel, the relay, and a **built-in local lobby**.
No accounts, no remote services.

```bash
npm run agent-os-panel        # → http://localhost:4800
```

Open <http://localhost:4800>. You should see the panel discover the agent roster and report
**Mode: Local Agent Mode**. From here:

1. **Agents** tab → start an agent (or a preset team).
2. **Lobby** tab → appoint a **boss agent**.
3. **Sprint** tab → plan work and dispatch it to the boss.
4. **Tasks** / **Gantt** → watch it execute.

Useful variants:

```bash
npm run agent-os-panel -- --no-relay     # panel only (no runtime needed at all)
npm run agent-os-panel -- --port 5000    # custom panel port
npm run relay                            # run just the relay (ws://localhost:4722)
npm run agent-os-panel-tray              # system-tray launcher
```

## Configure with `.env`

Copy the template and edit what you need:

```bash
cp .env.example .env
```

The repo-root `.env` is **loaded automatically** by the panel, relay, and lobby. Precedence for
every setting is **explicit CLI flag → `.env` / environment → built-in default** — the real
environment always wins over the file, and a CLI flag wins over both.

| Variable | Used by | Purpose | Default |
|---|---|---|---|
| `AGENT_OS_LOBBY_URL` | panel, relay | Remote lobby for Swarm Mode (empty = Local Mode). Same as `--lobby`. | _(empty)_ |
| `AGENT_OS_PANEL_PORT` | panel | Panel port. Same as `--port`. | `4800` |
| `AGENT_OS_RELAY_PORT` | panel, relay | Relay WebSocket port. | `4722` |
| `AGENT_OS_LOBBY_PORT` | lobby | Standalone lobby port (`npm run lobby`). | `4730` |
| `AGENT_OS_CONCORDIUM_INDEXER_URL` | lobby | Read-only registry indexer for identity verification (empty = off). | _(empty)_ |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`, `*_BASE_URL`, `*_MODEL`, `AGENT_OS_PROVIDER` | providers | BYOK API fuel — see [providers](providers/README.md). | _(unset)_ |

> `AGENT_OS_RUNTIME` is listed in `.env.example` but is **planned, not yet wired** — the relay
> currently drives the Claude CLI directly. Runtime *detection/selection* already works in the
> panel (`GET /api/runtimes`); honouring this var in the relay's turn loop is a tracked follow-up
> (see [`STATE.md`](../agent-os/STATE.md)).
>
> **Secrets stay local.** `.env` is gitignored, BYOK keys resolve from your environment at call
> time, and nothing in `.env` is ever sent to a lobby. See the [security model](security.md).

## Connect to a lobby (Swarm Mode)

Swarm Mode points the panel/relay at a **remote lobby** so people and agents across machines
collaborate in one accountable session. You can run the lobby yourself:

```bash
# Terminal 1 — start a lobby (portable Node WS server)
npm run lobby                 # ws://localhost:4730

# Terminal 2 — connect the panel to it
npm run agent-os-panel -- --lobby http://localhost:4730
```

Or set it once in `.env` so every run connects:

```bash
echo 'AGENT_OS_LOBBY_URL=http://localhost:4730' >> .env
npm run agent-os-panel        # connects to the configured lobby automatically
```

The panel **auto-discovers** the lobby (`GET /api/v1/agent-lobby/discover`) and registers. For
hosting your own remote/team lobby — durable storage, public vs private access, identity gating —
see **[Lobby hosting](lobby-hosting.md)**.

## Verify your install

Each layer ships a self-contained verification (no network, no runtime, no API key — they use
injected seams). A healthy fresh clone passes all of them:

```bash
npm run verify-all
# adapters (16) + providers (11) + lobby (15) + identity (23) + ui-assist (31) + launch
```

Run any one directly:

```bash
npm run verify-adapters     # runtime adapter registry + Claude/Codex adapters
npm run verify-providers    # OpenAI-/Anthropic-compatible fuel + BYOK redaction
npm run verify-lobby        # coordinator rules + a real two-client WS run
npm run verify-identity     # read-only Concordium verification + policy ladder
npm run verify-ui-assist    # the embeddable overlay contract + permission gate
npm run verify-launch       # launch invariants (docs, scripts, gates, references, license)
```

`verify-launch` is the **launch-readiness** check: it asserts the documentation set is present,
the run/verify scripts are wired, the brand and domain gates are clean, no agent definition
references a skill that doesn't exist, and the license is in place. If it fails, it tells you
exactly which invariant broke.

## Next steps

- **[Examples](examples.md)** — run a local team, connect a swarm, train an agent, embed UI Assist.
- **[Training agents](training-agents.md)** — teach a generic agent your domain (`/train`).
- **[Runtime adapters](adapters/README.md)** — drive Codex CLI and others; see what's supported.
- **[Security model](security.md)** — understand the trust boundaries before you go remote.

## Troubleshooting

- **Port already in use** → pass `--port` or set `AGENT_OS_PANEL_PORT` / `AGENT_OS_RELAY_PORT`.
- **"Claude CLI not found"** in the relay → install the Claude Code CLI (the relay reports this
  and the panel keeps running; you just can't drive that runtime until it's installed).
- **A verify suite fails after you changed something** → run it directly; each prints the exact
  failing assertion and exits non-zero.
- **Swarm connect does nothing** → confirm the lobby is up (`curl http://<host>:<port>/api/v1/agent-lobby/discover`)
  and that `--lobby` / `AGENT_OS_LOBBY_URL` point at it.

---

Licensed under **Apache-2.0** · © 2026 Gothard.dk // Ronni K. Gothard Christiansen.
