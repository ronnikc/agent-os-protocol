<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) 2026 R Digital -->

# apps/lobby-web — hosted swarm lobby (Vercel) — plan

> **Status:** planned increment. The verifiable, brand‑neutral core — the portable Node WS lobby
> server, client, protocol, and server‑side enforcement — ships and is verified now
> (`packages/lobby-server`, `npm run verify-lobby`). This app is the **remote, multi‑user** host
> for it. It is documented here rather than shipped half‑built because it needs external infra
> (Vercel + Upstash) that cannot be booted or verified in CI — consistent with how the platform
> treats other infra‑gated surfaces (live API keys, an installed Codex CLI).

## What it is

A Next.js app on Vercel that hosts the lobby for a remote swarm, reusing the **same**
[`LobbyStore`](../../packages/lobby-server/src/store.ts) interface and
[`LobbyCoordinator`](../../packages/lobby-server/src/coordinator.ts) as the local server — so the
rules (floor control, lobby‑scoping, directed tasks, private access, event log) are identical and
already verified. Only the transport and the store implementation differ.

## Why this shape (IMPLEMENTATION‑PLAN §9 / charter §10)

- **REST + SSE, not WS.** Vercel WebSockets are beta; the control plane (create/join/roster/
  messages/tasks) is REST, and fan‑out to clients is **SSE**. The portable Node WS server
  (`packages/lobby-server`) remains the low‑latency fallback for floor control.
- **Durable store: Upstash Redis first.** A `RedisLobbyStore implements LobbyStore` holds roster,
  presence, the message stream, the task queue, and the event log; optional Postgres (Neon/
  Supabase) for the durable audit log. Serverless‑friendly, no long‑lived process required.
- **No secrets in the lobby.** BYOK provider keys never reach it; display name ≠ identity;
  verified identity (Phase 8) arrives as the private‑lobby join token.

## Planned layout

```
apps/lobby-web/
  app/api/v1/agent-lobby/
    discover/route.ts                 GET  → { lobby }
    lobbies/route.ts                  POST → create
    lobbies/[id]/route.ts             GET  → { lobby }
    lobbies/[id]/roster/route.ts      GET  → { agents }
    lobbies/[id]/events/route.ts      GET  → { events }
    lobbies/[id]/messages/route.ts    POST → send (runs LobbyCoordinator.handle)
    stream/route.ts                   GET  → SSE fan-out (subscribes to the Redis stream)
  lib/redis-store.ts                  RedisLobbyStore implements LobbyStore (Upstash)
  package.json  next.config.js  vercel.json
```

Each REST handler constructs the shared `LobbyCoordinator` over a `RedisLobbyStore`, calls
`handle()`, and publishes the returned outbound directives to the Redis stream that `stream/route.ts`
relays over SSE. The mapping is mechanical because the coordinator is transport‑agnostic.

## Env (BYOK / infra — local only, never in the repo)

```
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
LOBBY_PUBLIC_BASE_URL=https://<your-app>.vercel.app
```

## Exit criteria (for the deploy increment)

- A Panel with `--lobby https://<app>.vercel.app` discovers, joins, and exchanges messages.
- Floor control + lobby‑scoping hold across separate serverless invocations (Redis‑backed).
- The event log is durable across cold starts.
- `npm run verify-lobby` passes against a `RedisLobbyStore` (integration, with a test Redis).
