<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen -->

# Agent OS Protocol — Documentation

Everything you need to run Agent OS Protocol from a fresh clone, understand how the pieces fit,
and extend it. Start at the top and follow the links.

> **New here?** Read [Getting started](getting-started.md) — it takes you from `git clone` to a
> running panel and a connected lobby, then points you at the rest of these guides.

## Start here

| Guide | What it covers |
|---|---|
| **[Getting started](getting-started.md)** | Install, boot Local Mode, configure `.env`, connect to a lobby, and verify your install |
| **[Examples](examples.md)** | Concrete, copy-pasteable walkthroughs: a local team, swarm connect, `/train`, UI Assist embed, work items |
| **[Security model](security.md)** | The trust boundaries: local-first, BYOK, server-side lobby control, identity, human-in-the-loop |

## Capability guides

| Area | Guide | Verified by |
|---|---|---|
| **Runtime adapters (CLI)** | [`adapters/`](adapters/README.md) — the compatibility matrix + per-runtime spikes | `npm run verify-adapters` |
| **API providers (fuel, BYOK)** | [`providers/`](providers/README.md) — the provider contract + BYOK model | `npm run verify-providers` |
| **The lobby** | [`lobby/`](lobby/README.md) — coordination model · **[Lobby hosting](lobby-hosting.md)** — run your own | `npm run verify-lobby` |
| **Agent identity** | [`identity/`](identity/README.md) — read-only Concordium verification, no keys | `npm run verify-identity` |
| **UI Assist** | [`ui-assist/`](ui-assist/README.md) + [framework guides](ui-assist/frameworks.md) | `npm run verify-ui-assist` |
| **Training agents** | **[Training agents](training-agents.md)** — teach a generic agent your domain with `/train` | (exercised end-to-end) |

## Reference

- **[`../README.md`](../README.md)** — product overview, architecture diagram, core concepts.
- **[`../IMPLEMENTATION-PLAN.md`](../IMPLEMENTATION-PLAN.md)** — the phase-by-phase build plan (the source of truth for what is built, in what order).
- **[`../agent-os/STATE.md`](../agent-os/STATE.md)** — current implementation state and known follow-ups.
- **[`../agent-os/ARCHITECTURE.md`](../agent-os/ARCHITECTURE.md)** — the four-layer architecture.
- **[`../CLAUDE.md`](../CLAUDE.md)** — how to work in this repo (structure, run/verify commands, conventions).
- Governance: [`RULES`](../agent-os/RULES.md) · [`SPRINTS`](../agent-os/SPRINTS.md) · [`SUB-AGENTS`](../agent-os/SUB-AGENTS.md) · [`LOBBY-PROTOCOL`](../agent-os/LOBBY-PROTOCOL.md) · [`ETHICS`](../agent-os/ETHICS.md) · [`SOUL`](../agent-os/SOUL.md).

## Verify everything

A fresh clone should pass all the layer verifications plus the launch-readiness check:

```bash
npm install
npm run verify-all          # adapters + providers + lobby + identity + ui-assist + launch
```

`npm run verify-launch` on its own checks the launch invariants (required docs present, scripts
wired, brand/domain gates clean, no dangling skill references, license present). See
[Getting started → Verify your install](getting-started.md#verify-your-install).

---

Licensed under **Apache-2.0** · © 2026 Gothard.dk // Ronni K. Gothard Christiansen.
