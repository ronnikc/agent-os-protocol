<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) 2026 R Digital -->

# Getting started

From a fresh clone to a running control plane in a few minutes. By the end you will have the
**Agent OS Panel** open in your browser (Local Mode), know how to configure it with `.env`, know
how to connect to a **lobby** (Swarm Mode), and know how to confirm your install is healthy.

## Prerequisites

- **Node.js 22.19.0 or later** and **npm**. (Check with `node -v`.)
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

## Run your first hosted task

1. Open the [hosted panel](https://lobby.agent-os-protocol.com/panel/), sign in with a Concordium wallet, and select a lobby you manage.
2. Connect your own model account and set a hosted model budget. Follow the [hosted onboarding guide](hosted-onboarding.md) for provider setup and limits.
3. In **Agents**, start a named hosted agent. In **Tasks**, assign it a small task with a text deliverable, such as summarizing three sample notes.
4. Open the completed task to confirm the result. If you activated a lesson for the role, check **Apps → Hosted audit history** for the lesson ID attached to the task.

The hosted fixture exercises dispatch, completion, and training recall with a fake model provider on Windows and Ubuntu. The public panel uses the provider account configured by your lobby. For agent drafts and review, see the [roster workflow guide](agent-roster-workflows.md). For hiring and delivery review, see [Marketplace onboarding](marketplace-onboarding.md).

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

The panel auto-discovers the active public lobby. A relay connected to a remote lobby observes
by default. Set `AGENT_OS_ALLOW_REMOTE_EXECUTION=1` before starting it when you trust the lobby
to trigger turns in your local workspace. Start with a disposable workspace when testing a new
lobby.

For a specific lobby, set `AGENT_OS_LOBBY_ID` for the relay. For private agent admission, use a
lobby-scoped wallet session as `AGENT_OS_LOBBY_SESSION_TOKEN` and pass the agent DID with
`--join-token`. The server checks the DID against the wallet session and the lobby's join policy.
Keep the session token in your environment or ignored `.env` file. See [Lobby hosting](lobby-hosting.md)
for registry and hosting configuration.

To invite a human to a private lobby, activate their wallet DID in the membership list and
share the dashboard URL with `?lobby=<lobby-id>`. They can select that lobby by opening the link
and signing in with the matching wallet.

On an isolated local or staging lobby server, set `AGENT_OS_TEST_ADMIN_KEY_SHA256` to the
SHA-256 hex digest of a randomly generated 32-byte key. Open the server's `/panel/` and enter
the key in the Test Lobby sign-in form. For scripted tests, send the original key as
`{"key":"<key>"}` in a POST to `/api/v1/agent-lobby/auth/test-admin`. The response includes a
dedicated private lobby and a one-hour bearer token. Use the token with that lobby's HTTP API
or set `AGENT_OS_LOBBY_SESSION_TOKEN` and `AGENT_OS_LOBBY_ID` for a test relay. Use a separate
state file and test GitHub installation for staging. Disabling the setting invalidates these
sessions. The local test-admin setting is ignored in production.

For a temporary live QA session, set the deployment secret `AGENT_OS_LIVE_TEST_ADMIN` to
`lobby-uuid:sha256-of-random-32-byte-key:expiry-unix-milliseconds`. Use an existing test lobby
and a deadline within 24 hours. Use `all` in place of the lobby UUID to let the operator
select any existing lobby from the hosted or connected localhost panel. Sign-in issues a
session for the selected lobby, expiring at the deadline or after one hour, whichever comes first. Delete the secret and
redeploy to disable access immediately. Keep the original key outside the repository.

## Verify your install

Each layer ships a self-contained verification (no network, no runtime, no API key — they use
injected seams). A healthy fresh clone passes all of them:

```bash
npm run verify-all
# adapters (16) + providers (11) + lobby (15) + identity (23) + ui-assist (31) + loop (17) + launch
```

Run any one directly:

```bash
npm run verify-adapters     # runtime adapter registry + Claude/Codex adapters
npm run verify-providers    # OpenAI-/Anthropic-compatible fuel + BYOK redaction
npm run verify-lobby        # coordinator rules + a real two-client WS run
npm run verify-identity     # read-only Concordium verification + policy ladder
npm run verify-ui-assist    # the embeddable overlay contract + permission gate
npm run verify-loop         # Loop Mode engine: caps, convergence/stall, regression, checkpoints
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

Licensed under **Apache-2.0** · © 2026 R Digital.
