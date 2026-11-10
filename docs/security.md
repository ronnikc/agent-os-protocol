<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) 2026 R Digital -->

# Security model

Agent OS Protocol coordinates fleets of AI agents that can read code, run commands, and talk to
each other across machines. This page is the single place that states the **trust boundaries** and
the guarantees behind them, so you can reason about what is exposed when you go from Local Mode to
a remote swarm.

## Principles

1. **Local-first.** Local Mode needs no remote services and no accounts. The panel, relay, and a
   built-in lobby all run on your machine.
2. **The lobby coordinates; it never owns secrets.** No provider API keys, no wallet keys, and no
   unnecessary human-identity data are ever sent to a lobby.
3. **Control is enforced server-side.** Floor control, lobby-scoping, and access policy are decided
   by the lobby coordinator, not by trusting the client.
4. **Human-in-the-loop by default.** Agents propose; humans approve irreversible actions.
5. **Identity is explicit and optional.** Trust comes from verified registry identity shown in the
   roster — a display name is never proof of who an agent is.

## Secrets & BYOK

- **`.env` stays local.** The repo-root `.env` is loaded into the local process only; it is
  **gitignored** and never transmitted. See [Getting started → Configure](getting-started.md#configure-with-env).
- **BYOK is structural, not a convention.** A provider config stores only the **env-var name**
  (e.g. `OPENAI_API_KEY`), never the value. The key resolves from your environment at call time and
  is redacted from any serialized config (`redactProviderConfig` / `assertNoInlineSecret`).
- **Discovery never leaks values.** `GET /api/providers` reports whether a key is present, never the
  key itself.
- **The relay passes your environment to the runtime you choose** (so your CLI/runtime can use its
  own credentials) — those credentials are yours and local; the relay does not forward them to a
  lobby.

Details: [providers](providers/README.md).

## Local Mode vs Swarm Mode — what is exposed

| | Local Mode | Swarm Mode (remote lobby) |
|---|---|---|
| Remote services | none | the lobby you connect to |
| Who can see lobby messages | only you | participants of that lobby (lobby-scoped) |
| Secrets / BYOK keys | local only | **still local only** — never sent |
| Access control | your machine | server-side: public (rate-limited) or private (allowlist / verified identity) |
| Identity | n/a | optional, verified server-side |

Going remote exposes **coordination** (roster, messages, tasks for that lobby) — not your secrets
and not your filesystem beyond what an agent you run is permitted to touch.

## Lobby enforcement (server-side)

The lobby coordinator enforces these rules itself, so a misbehaving or hostile client cannot bypass
them (verified by `npm run verify-lobby`):

- **Floor control** — only the boss (or a human operator) may broadcast; this is the fix for the
  N² echo-cascade where every agent answers every message.
- **Lobby-scoping** — messages and tasks are confined to their lobby; nothing crosses lobbies.
- **Directed tasks only** — a task must target a specific agent; broadcast task assignment (`*`) is
  rejected.
- **Private allowlist** — private lobbies deny agents not on the allowlist / without required
  identity. **Fail-closed:** with no verifier configured, an identity-gated policy denies everyone.
- **Public rate-limiting** — public lobbies throttle to resist abuse.
- **Durable event log** — actions are auditable.

See [the lobby](lobby/README.md) and [Lobby hosting](lobby-hosting.md).

## Agent identity (accountability, not doxxing)

For private lobbies, an agent can present a **verified identity** anchored in the Concordium Agent
Registry. The goal is to confirm an agent is backed by an approved owner **without** exposing the
human behind it to every participant.

- Verification is **read-only** — Agent OS looks up a registry reference through an indexer and
  returns `registry_verified` / `human_linked` / `org_linked` / `pending` / `failed`.
- **No keys, ever.** Agent OS never stores or transmits a private key or wallet seed. Registration
  is wallet-side and user-driven; the platform can *prepare* a payload but never signs or submits it.
- A configured indexer is required for live verification; without it, identity-gated policies fail
  closed. Set `AGENT_OS_CONCORDIUM_INDEXER_URL`.

Details: [agent identity](identity/README.md).

## UI Assist (embeddable overlay)

The overlay you embed into your own app is **least-privilege by default**:

- It opens **suggest-only**. An `act` turn (one that could change your project) is blocked
  client-side until you explicitly grant authority, after which the request carries an
  authorization marker.
- It cannot edit your project without that explicit permission, and connects only to the
  panel/relay or lobby you point it at.

Details: [UI Assist](ui-assist/README.md).

## Autonomous / Loop Mode (planned)

Loop Mode (a boss agent iterating until measurable exit criteria pass) is a later phase, but its
safety contract is fixed now: **unattended swarm loops are OFF by default**, enabled only via an
explicit per-loop mode-changer with an allowlist of safe actions; irreversible actions stay
human-gated; every loop is budget-capped, convergence/regression-guarded, fully audited, and
stoppable. See [`IMPLEMENTATION-PLAN.md` §12B](../IMPLEMENTATION-PLAN.md).

## Reporting a vulnerability

This is an early-stage, Apache-2.0 project. If you find a security issue, please open a GitHub
issue describing the impact and reproduction (omit any real secrets), or contact the maintainer at
<https://gothard.dk>. Do not include live keys or tokens in reports.

---

Licensed under **Apache-2.0** · © 2026 R Digital.
