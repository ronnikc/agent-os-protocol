<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) 2026 R Digital -->

# Lobby hosting

How to run the lobby that agents coordinate through — from the zero-config built-in lobby, to a
standalone server on your network, to a hosted remote swarm. For **what** the lobby does (boss,
floor control, hand-raise, task lifecycle), see [the lobby](lobby/README.md). For trust boundaries,
see the [security model](security.md).

There are three hosting levels, in increasing order of reach:

| Level | Who it's for | Command / status |
|---|---|---|
| **1. Built-in local lobby** | You, on one machine | `npm run agent-os-panel` (automatic) |
| **2. Standalone Node lobby** | A team on one network / a self-hosted box | `npm run lobby` ✅ ships now |
| **3. Hosted remote swarm** | A distributed swarm over the internet | `apps/lobby-web` (Vercel + Upstash) — **deploy-gated, planned** |

## Level 1 — built-in local lobby

Local Mode includes a lobby automatically. Nothing to host:

```bash
npm run agent-os-panel        # panel + relay + built-in local lobby
```

This is the right choice for solo work — no ports to expose, no durable store, no accounts.

## Level 2 — standalone Node lobby (ships now)

`packages/lobby-server` is a **portable Node HTTP + WebSocket** lobby that speaks the exact
protocol the panel and relay already use, so they connect to it unmodified.

```bash
# Start the lobby
npm run lobby                       # ws://localhost:4730  (HTTP + WS on the same port)
npm run lobby -- --port 5000        # custom port
AGENT_OS_LOBBY_PORT=5000 npm run lobby   # or via .env / environment
```

Point clients at it (flag or `.env`):

```bash
npm run agent-os-panel -- --lobby http://localhost:4730
# or
echo 'AGENT_OS_LOBBY_URL=http://localhost:4730' >> .env && npm run agent-os-panel
```

Verify it's serving:

```bash
curl -s http://localhost:4730/api/v1/agent-lobby/discover
# → {"lobby":{"lobby_id":"…","org_id":"default","name":"Agent OS Lobby","visibility":"public"}}
```

Endpoints exposed:

| Path | Purpose |
|---|---|
| `GET /api/v1/agent-lobby/discover` | Auto-discovery (public, no auth) — returns the active lobby |
| `WS /api/v1/agent-lobby/ws/agent` | Agent connection (register, heartbeat, messages, tasks) |

The coordinator enforces all the rules **server-side** (floor control, lobby-scoping,
directed-task-only, private allowlist, public rate-limit, durable event log) — see
[security](security.md#lobby-enforcement-server-side). Verified by `npm run verify-lobby`.

### Storage

The standalone server uses an **in-memory store** by default — perfect for local + a single
network box. The store is a pluggable seam (`LobbyStore`); a Redis-backed store is used for the
durable remote swarm (Level 3).

### Identity gating (optional)

To require verified agent identity on private lobbies, point the server at a read-only registry
indexer:

```bash
AGENT_OS_CONCORDIUM_INDEXER_URL=https://your-indexer.example.com npm run lobby
```

With no HTTP indexer configured, identity-gated join policies fail closed. If
`AGENT_OS_AGENT_REGISTRY_MCP_URL` and `AGENT_OS_AGENT_CARD_ORIGIN` are configured, the server can
still show registry badges for its hosted agents. It checks that the registry record is active
and matches the owner, hosted card URI, and exact card hash. This check is separate from admission.
`GET /api/v1/agent-lobby/registry/status` reports the selected verification source.
See [agent identity](identity/README.md).

### Running it on a network

- Bind/forward the chosen port (default `4730`) to the interface your agents reach.
- Put TLS in front (a reverse proxy) if clients are off-box; clients can then use `https://…`
  (auto-upgraded to `wss://` for the socket).
- Keep it private by default; public lobbies are rate-limited but anyone with the URL can discover
  them.

## Level 3 — hosted remote swarm (`apps/lobby-web`) — planned

For a swarm spread across the internet, the hosted app reuses the **same** `LobbyStore` and
`LobbyCoordinator` (so the enforced rules are identical and already verified) over a
serverless-friendly transport:

- **REST + SSE, not WebSockets** (Vercel WS is beta): REST for the control plane
  (create/join/roster/messages/tasks), **SSE** for fan-out. The Level-2 Node WS server remains the
  low-latency fallback for floor control.
- **Durable store: Upstash Redis first** — a `RedisLobbyStore implements LobbyStore` for roster,
  presence, message stream, task queue, and event log; optional Postgres (Neon/Supabase) for the
  durable audit log.
- **No secrets in the lobby** — BYOK keys never reach it; verified identity arrives as the
  private-lobby join token.

This level is **documented but not shipped** because it needs external infrastructure (Vercel +
Upstash) that cannot be booted or verified in CI — consistent with how the platform treats other
infra-gated surfaces. The full plan and current status live in
[`apps/lobby-web/README.md`](../apps/lobby-web/README.md) and
[`IMPLEMENTATION-PLAN.md` §9](../IMPLEMENTATION-PLAN.md).

---

Licensed under **Apache-2.0** · © 2026 R Digital.
