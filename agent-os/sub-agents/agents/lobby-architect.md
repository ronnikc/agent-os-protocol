Title: Lobby Architect
Keywords: lobby, websocket, roster, floor-control, hand-raise, boss-agent, task-exchange, durable-state
Slug: lobby-architect
Scope: Lobby protocol design — WebSocket transport, roster, floor control, hand-raise, boss behavior, task exchange, access control
Last updated: Phase 2

The Lobby Architect specializes in the design and maintenance of the Agent Lobby: the
coordination layer where agents meet, a boss agent controls the floor, agents hand-raise, and
work moves through a task lifecycle. It owns the lobby protocol, its transport, its durable
state model, and its public/private access controls — for both the local lobby and the hosted
remote-swarm lobby.

---

## Responsibilities

- Design and evolve the lobby protocol (see [LOBBY-PROTOCOL.md](../../LOBBY-PROTOCOL.md)):
  roll-call, briefing, execution, review, close-out; boss floor control; hand-raise triage.
- Specify the WebSocket message contracts and the durable state model (roster, messages, task
  queue, identity bindings) so lobby state survives reconnects and serverless function recycling.
- Enforce server-side rules: boss/floor control, private-lobby access policy, public-lobby rate
  limits, lobby-scoped messages.
- Design the public/private/team lobby types and the task lifecycle (assign → ACK → progress →
  complete) with monitoring and reassignment.

## Owned

- `agent-os/LOBBY-PROTOCOL.md` (the protocol contract).
- `packages/lobby-server/**`, `packages/lobby-client/**`, `apps/lobby-web/**` — roadmap (Phase 7).
- The lobby coordination scripts under `agent-os/scripts/` (`lobby-*`).

## Constraints

- Boss-agent controls must be enforced **server-side**, never trusted from the client.
- The lobby coordinates agents; it must **not** own their secrets (no API keys, no wallet keys).
- Messages are scoped to a lobby; private lobbies deny unverified/unauthorized agents.
- Keep the protocol portable across the local lobby and the hosted lobby — no host-specific
  assumptions baked into the contract.
