<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen -->

# Hosted Agent OS (design + roadmap)

> **Status:** Phase 1 in progress. This document is the north star for the hosted, wallet-authed,
> no-local-setup Agent OS experience for non-developers.

## Goal

Offer a **hosted Agent OS Panel** so people who don't run anything locally can orchestrate a swarm
directly from the online lobby: sign in with a Concordium wallet, configure their model provider
API keys, issue Agent IDs, and launch/observe agents — all server-side.

This is **purely additive**. Local Mode is untouched: `npm run agent-os-panel` on localhost keeps
its local relay + `claude-cli`/`codex-cli` runtime and **local-only BYOK** (keys never leave the
machine). Hosted Mode adds a server-side path alongside it.

## Founding-principle deltas (deliberate, hosted-only)

| Principle (Local Mode) | Hosted Mode |
|---|---|
| Agents run locally via relay + CLI runtime | Agents run **server-side** via an API runtime (Phase 2) |
| Provider keys never leave the machine (BYOK stores only the env-var *name*) | Provider keys are **encrypted server-side**, wallet-scoped, write-only over the API |
| No accounts | **Wallet sign-in** (Concordium); all data locked to the owner's `identity_ref` |

**No platform spend limits.** Spend is governed entirely by the user's own provider account/keys.
The platform never meters or caps model usage.

## What already exists (reused, not rebuilt)

- **Wallet auth primitive** — `auth/identityProof.ts`: nonce → wallet signature → session token.
- **Encrypted server-side secrets** — AES-256-GCM `encryptSecret`/`decryptSecret` + the
  `IntegrationSecret` model (`encrypted_value`, `encryption_key_id`, rotation/revocation).
- **Multi-tenant ownership** — `Lobby.owner_identity_ref` + member roles.
- **Runtime adapter registry** — `packages/adapters` abstracts runtimes (a server-side API runtime
  slots in as a new adapter).

## Phases

### Phase 1 — Foundation (in progress)
1. **Provider-config custody** *(PR1)* — shared AES-256-GCM secret box; a `ProviderKeyConfig` model +
   store, scoped **per-lobby with per-agent override**; write-only (plaintext never returned);
   rotate/revoke. No spend metering.
2. **Wallet session auth + gated config API + CLI** *(PR2)* — `POST /auth/nonce` + `POST /auth/verify`
   (reuse `identityProof`) issuing a session token; an authz guard binding every config/lobby
   mutation to the session's wallet; REST provider-config endpoints + a small `agent-os config` CLI;
   onboarding docs (create a Concordium wallet/ID → sign in → configure a key → issue Agent IDs).

### Phase 2 — Server-side execution runtime
An `api-runtime` adapter that drives the Anthropic/OpenAI-compatible APIs directly (no local CLI),
run in a managed worker pool, plus a **launch-agent-from-lobby** API that resolves the per-agent (or
per-lobby) key from custody and streams output back over the lobby WS.

### Phase 3 — Hosted panel UX
The online panel non-developers actually use: sign-up + wallet connect, provider-key config screens,
Agent-ID issuance, and launch/observe — reusing the `apps/lobby-web` dashboard.

## Verification

Each phase ships an offline, seam-injected verify suite (`npm run verify-hosted`) — no live wallet,
network, or model calls — matching the repo's existing verify-* philosophy.
