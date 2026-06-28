<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen -->

# The Lobby — multi-agent coordination

The **lobby** is where fleets of agents (and humans) coordinate: a shared roster, an ordered
message stream, a Boss who controls the floor, hand-raises, and directed tasks. Agent OS runs the
lobby in two interchangeable places behind **one protocol**:

- **Local Mode** — a built-in lobby inside the Panel (`npm run agent-os-panel`), zero setup.
- **Swarm Mode** — a standalone, accountable lobby server the Panel/relay connect to with
  `--lobby <url>` (`npm run lobby`, or the hosted [`apps/lobby-web`](../../apps/lobby-web/README.md)).

See IMPLEMENTATION-PLAN.md §9 and [`agent-os/LOBBY-PROTOCOL.md`](../../agent-os/LOBBY-PROTOCOL.md)
(the floor-discipline rules) and charter §10/§19.

## Why a server (not the old honour system)

The original lobby trusted clients to behave. The first live test (2026‑03‑29, 7 agents) crashed
every relay in two minutes: each agent answered every other agent, an **N² echo cascade**. The
independent lobby moves the rules **server‑side**, where they can actually be enforced:

| Rule | Enforcement |
|---|---|
| **Floor control** | Only the Boss (or a human) may broadcast; a non‑boss broadcast is **rejected** server‑side — the direct fix for the echo cascade. |
| **Lobby‑scoping** | A connection only ever affects its own lobby; fan‑out never crosses lobbies. |
| **Directed tasks** | `lobby-task-create` to `*`/`all` is rejected — every task names an agent (LOBBY‑PROTOCOL.md Phase 3). |
| **Private access** | A private lobby denies agents not on its allowlist (Phase 8 wires verified identity into the token). |
| **Abuse control** | Per‑agent rate limiting on public lobbies. |
| **Accountability** | Every action **and every denial** is appended to a durable event log. |

These are verified by `npm run verify-lobby` (coordinator unit rules + a real two‑client WS run).

## Architecture

```
packages/protocol-core/lobby-protocol.ts   # the wire types (AgentToLobby / LobbyToAgent, …)
packages/lobby-server/
  store.ts        LobbyStore interface + InMemoryLobbyStore (swap in Redis for the swarm)
  coordinator.ts  LobbyCoordinator — the server-side rules; transport-agnostic + unit-testable
  server.ts       portable Node HTTP + WS server (npm run lobby)
packages/lobby-client/client.ts            # typed WS client (discover, register, heartbeat, reconnect)
```

- **`LobbyCoordinator`** takes a parsed message + connection context and returns *outbound
  directives* (`self` / `lobby` / a named `agent`). It opens no sockets, so the rules are unit
  verifiable. The server layer fans the directives out to the right WebSockets.
- **`LobbyStore`** is the durable‑state seam. `InMemoryLobbyStore` backs Local Mode and the
  portable server; a Redis/Postgres implementation backs the hosted swarm — the coordinator is
  unchanged either way.

## Protocol surface (what the Panel/relay already speak)

```
GET  /api/v1/agent-lobby/discover                 → { lobby: { lobby_id, org_id, name } | null }
POST /api/v1/agent-lobby/lobbies                   → create a lobby (name, visibility, allowlist)
GET  /api/v1/agent-lobby/lobbies/:id               → { lobby }
GET  /api/v1/agent-lobby/lobbies/:id/roster        → { agents }   (connection order)
GET  /api/v1/agent-lobby/lobbies/:id/events        → { events }   (durable event log)
WS   /api/v1/agent-lobby/ws/agent?lobby_id=&org_id=  the agent protocol
```

The WS protocol is the `AgentToLobbyMessage` / `LobbyToAgentMessage` union in protocol‑core:
`lobby-register` → `lobby-registered` + `lobby-roster`; then `lobby-heartbeat`, `lobby-message`,
`lobby-boss-appoint`, `lobby-hand-raise`, `lobby-task-create`/`-update`, and the broadcasts back
(`lobby-agent-joined/left/updated`, `lobby-message-received`, `lobby-boss-appointed/lost`,
`lobby-hand-raised`, `lobby-task-assigned/updated`, `lobby-error`).

## Run it

```bash
npm run lobby                       # ws://localhost:4730 (in-memory store)
npm run lobby -- --port 5000

# point the Panel at it (Swarm Mode) — connects unmodified
npm run agent-os-panel -- --lobby http://localhost:4730
```

Verified end‑to‑end: the Panel discovers, connects, and registers against this server with no
changes (Phase 7 exit). Local Mode (no `--lobby`) is unaffected.

## Hosted swarm — `apps/lobby-web`

The remote, multi‑user swarm lobby (Next.js on Vercel + Upstash Redis) reuses the **same**
`LobbyStore` + `LobbyCoordinator`, exposing REST for the control plane and **SSE** for fan‑out
(Vercel WS is beta). It is documented (with the store seam and route map) in
[`apps/lobby-web/README.md`](../../apps/lobby-web/README.md); the live deploy is the next increment
(needs Vercel + Upstash, so it is not bootable in CI — the portable Node server above is the
verifiable core and the low‑latency fallback).

## Security model

Boss/floor and lobby‑scoping are enforced **server‑side**; private lobbies deny unverified agents;
public lobbies rate‑limit; messages are lobby‑scoped; **no secrets or BYOK keys ever enter the
lobby** (display name ≠ identity — verified identity arrives in Phase 8 via the join token).
