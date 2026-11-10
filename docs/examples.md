<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) 2026 R Digital -->

# Examples

Concrete, copy-pasteable walkthroughs. Each is self-contained and assumes you have installed the
repo (`npm install`) — see [Getting started](getting-started.md) if not.

- [1. Run a local team](#1-run-a-local-team)
- [2. Connect a swarm (two terminals)](#2-connect-a-swarm-two-terminals)
- [3. Fuel an agent with your own API key (BYOK)](#3-fuel-an-agent-with-your-own-api-key-byok)
- [4. Train a generic agent on your domain](#4-train-a-generic-agent-on-your-domain)
- [5. Embed UI Assist into your app](#5-embed-ui-assist-into-your-app)
- [6. Create and track work items](#6-create-and-track-work-items)
- [7. Drive the Codex CLI runtime](#7-drive-the-codex-cli-runtime)
- [8. Require verified identity for a private lobby](#8-require-verified-identity-for-a-private-lobby)

---

## 1. Run a local team

Boot Local Mode and let a boss agent coordinate specialists on your machine.

```bash
npm run agent-os-panel        # → http://localhost:4800
```

In the browser:

1. **Agents** → start a preset team (or individual specialists).
2. **Lobby** → appoint one agent as **boss**.
3. **Sprint** → write a short goal and dispatch it. The boss decomposes it, asks "any hands?",
   and assigns each task to a **named** specialist (never a broadcast).
4. **Tasks** / **Gantt** → watch assignment → ACK → progress → complete propagate live.

Everything stays on your machine — the built-in local lobby needs no remote services.

## 2. Connect a swarm (two terminals)

Run your own lobby and connect the panel to it.

```bash
# Terminal 1 — the lobby (portable Node WS server)
npm run lobby                                   # ws://localhost:4730

# Terminal 2 — the panel, connected to that lobby
npm run agent-os-panel -- --lobby http://localhost:4730
```

Confirm the lobby is reachable and discoverable:

```bash
curl -s http://localhost:4730/api/v1/agent-lobby/discover
# → {"lobby":{"lobby_id":"…","org_id":"default","name":"Agent OS Lobby","visibility":"public"}}
```

Prefer config over flags? Put it in `.env` and every run connects:

```bash
echo 'AGENT_OS_LOBBY_URL=http://localhost:4730' >> .env
npm run agent-os-panel
```

For a real remote/team lobby (durable store, private access), see [Lobby hosting](lobby-hosting.md).

## 3. Fuel an agent with your own API key (BYOK)

Provider keys are **bring-your-own** and stay local — the platform stores only the env-var *name*,
resolves the key at call time, and never serializes it or sends it to a lobby.

```bash
# in .env (or your shell environment)
OPENAI_API_KEY=sk-...                 # your key — stays in your environment
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
AGENT_OS_PROVIDER=openai-compatible
```

The panel discovers configured providers without ever exposing key values:

```bash
npm run agent-os-panel
curl -s http://localhost:4800/api/providers   # reports key present/absent — never the value
```

Works with any OpenAI-compatible endpoint (OpenAI, OpenRouter, Together, vLLM, LM Studio, Ollama's
OpenAI shim, …) and any Anthropic-compatible endpoint. See [providers](providers/README.md).

## 4. Train a generic agent on your domain

The base platform ships **no domain knowledge**. Teach a generic agent from your own docs —
reviewable, reversible, and local by default. Always dry-run first.

```bash
# 1. Preview what would be written (writes nothing)
node agent-os/scripts/train.mjs domain-specialist --source ./docs/my-domain.md --dry-run

# 2. Create a reviewable draft (rejects any source containing secrets)
node agent-os/scripts/train.mjs domain-specialist --source ./docs/my-domain.md --skill my-domain

# 3. Review the generated SKILL.md, then activate on purpose
node agent-os/scripts/train.mjs domain-specialist --activate my-domain

# Manage trained skills
node agent-os/scripts/train.mjs domain-specialist --list
node agent-os/scripts/train.mjs domain-specialist --deactivate my-domain
```

In an interactive Claude Code session you can use the `/train` command, which runs the same flow
and forces the review step. Full guide: [Training agents](training-agents.md).

## 5. Embed UI Assist into your app

Add an embeddable overlay to your own app so you can talk to your agents in context. The
**Integration Agent** detects your framework and prints (never applies) the plan:

```bash
npm run ui-assist-integrate -- /path/to/your/app
# add --lobby <url> for a remote connection, --json for machine-readable output
npm run ui-assist-integrate -- /path/to/your/app --lobby wss://lobby.example.com --json
```

It detects plain JS, React, Next.js, Vue, Svelte, Laravel, WordPress, and Joomla, and emits the
`embed.js` snippet, install checks, and a secure-connect summary. The overlay opens
**suggest-only** and cannot modify your project without explicit permission. Framework specifics:
[UI Assist framework guides](ui-assist/frameworks.md).

## 6. Create and track work items

Phases, Sprints, and Tasks share one canonical schema (one status vocabulary, one on-disk
format), so a task created anywhere shows up everywhere. The authoring engine is runnable:

```bash
npm run work-items -- --help     # the canonical Phase/Sprint/Task authoring + read engine
```

Created items use front-matter + a single checkbox syntax that the panel's Gantt and the lobby
read identically — no second format to learn. See the work-item section in the
[root README](../README.md#work-items-phases-sprints-tasks).

## 7. Drive the Codex CLI runtime

Agent OS is runtime-agnostic. If you have OpenAI's Codex CLI installed, it's a first-class runtime
alongside Claude:

```bash
npm run verify-adapters          # proves the adapter registry + Claude/Codex adapters (16/16)
```

The panel detects installed runtimes (`GET /api/runtimes`); a missing runtime degrades to an
install message rather than breaking the panel. Matrix + per-runtime notes:
[runtime adapters](adapters/README.md).

## 8. Require verified identity for a private lobby

A private lobby can require that participants present a **verified** agent identity (anchored in
the Concordium Agent Registry) — accountability without doxxing. Point the lobby at a read-only
indexer:

```bash
# in .env
AGENT_OS_CONCORDIUM_INDEXER_URL=https://your-indexer.example.com

npm run lobby                    # now enforces the identity policy ladder server-side
```

Without an indexer configured, identity-gated policies **fail closed** (deny) and the lobby still
boots with no network dependency. Agent OS never stores or transmits a private key. Details and
the verification flow: [agent identity](identity/README.md).

---

Licensed under **Apache-2.0** · © 2026 R Digital.
