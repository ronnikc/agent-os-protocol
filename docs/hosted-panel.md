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
1. **Provider-config custody** *(PR1 ✅)* — shared AES-256-GCM secret box; a `ProviderKeyConfig`
   model + store, scoped **per-lobby with per-agent override**; write-only (plaintext never
   returned); rotate/revoke. No spend metering.
2. **Wallet session auth core** *(PR2 ✅)* — **hardened session token** (HMAC-signed; the previous
   token was plain base64 and forgeable — anyone could mint a session for any wallet) + the
   `POST /auth/nonce` and `POST /auth/verify` endpoints (reuse `identityProof`) + a `GET .../session`
   whoami used by the panel/CLI and as the authz base for gated endpoints.
   *Caveat:* signature verification currently supports a PEM/MOCK verifier; the real Concordium
   ed25519 verifier (fetch the account's credential keys from the indexer/gRPC and verify the
   wallet's `signMessage` output) is a scoped follow-up before production sign-in.
3. **Lobby ownership + gated config API + CLI** *(PR3 ✅)* — a lobby is bound to the creating wallet
   (owner member); an `isLobbyManager` authz guard; the REST provider-config endpoints
   (`/lobbies/:id/provider-keys` GET/POST/DELETE) gated by it; a `agent-os config` CLI (`npm run
   config`) over the API; and the [hosted onboarding guide](hosted-onboarding.md) (create a
   Concordium wallet/ID → sign in → configure a key → issue Agent IDs).

### Phase 2 — Server-side execution runtime ✅
- **`api` runtime adapter** (`packages/adapters/src/api-runtime.ts`) drives the Anthropic/OpenAI-
  compatible APIs directly (no local CLI), reusing the `providers` clients with the wallet-scoped
  key injected in-process (never from env). Same `startAgent → sendInput → readOutput` contract as
  the CLI adapters, so the existing driver works unchanged.
- **`HostedAgentRunner`** runs a server-side agent on the lobby host and turns an inbound lobby
  message into a reply via one API-runtime turn (persistent session for continuity).
- **Launch-from-lobby API** (wallet-gated): `POST/GET/DELETE /lobbies/:id/hosted-agents`. Launch
  resolves the per-agent (or per-lobby) key from custody, opens an API-runtime session, and registers
  the agent into the lobby via a virtual socket so it appears in the roster and exchanges messages
  like any agent — replies stream back over the lobby WS. `npm run config -- launch-agent …`.
- Verified end-to-end: a wallet-authed owner configures a key → launches a hosted agent (no local
  machine) → a WS client messages it → the agent runs via the API runtime and replies.

### Phase 3 — Hosted panel UX ✅ (first cut)
The `apps/lobby-web` dashboard's **Manage → Hosted Mode** card: **Sign in with wallet**
(nonce → `signMessage` → verify → session token), a **Provider Keys** panel (set/list/revoke,
per-lobby or per-agent, masked), and **Launch / Stop** server-side agents — all gated by the wallet
session. Creating a lobby with a connected wallet binds it to that wallet as owner.

**Production sign-in ✅:** a bound, single-use challenge (`POST /auth/challenge`, TTL 90s, bound to
account + origin + network + session + lobby) is signed by the wallet and verified server-side via
`POST /auth/verify-wallet` against the account's **fresh on-chain credentials** — the Concordium SDK
`verifyMessageSignature` over a `getAccountInfo` fetched at verify time (`auth/concordium-verifier.ts`,
gRPC node injectable for tests). Client-supplied keys are never trusted; failures are generic. The
`AGENT_OS_DEV_TRUST_WALLET_SIGNATURES` bridge remains only for the legacy `/auth/verify` path (demo/
testnet) and the server **refuses to start** if it is set in production.

### Phase 4 — Full hosted panel ✅
The hosted experience should be the **whole Agent OS Panel** (every sub-menu), not a single
Hosted-Mode widget. Approach: serve the existing `agent-os-panel` SPA from the lobby server under
`/panel`, made **hosted-aware**, and implement its API surface against the lobby's server-side model
so the same UI runs hosted. Built in slices, each testable on its own:

- **Phase 4.1 — shell (done):** the lobby serves the panel SPA at `/panel` and injects
  `window.AGENT_OS_HOSTED` (+ lobby origin). lobby-web gets a **Panel** nav entry. In hosted mode the
  panel shows a context banner and hides the local-only views (Files, Gantt, Scheduled, Memory, Loop)
  whose data comes from a local filesystem/process host. `fetchJson` degrades unmapped endpoints to
  empty states, so nothing crashes while backends are wired.
- **Phase 4.2 — Agents (done):** `/api/agents` (+ overview stats) → the lobby roster joined with hosted agents; start/stop → the hosted-agents launch/stop API; "Create ID" already works via the registry proxy. Gated by the wallet session. Injected `repoClient` into the hosted agent runner so agents can use repository tools (`read_file`, `write_file`, `list_files`, `create_pr`).
- **Phase 4.3 — Lobby / Messages / Tasks / Requests (done):** mapped to the lobby's remote backend endpoints (`/api/lobby/remote/*`) so they display live remote swarm state instead of local files or blank views.
- **Phase 4.4 — Identity (done):** the Identity tab's card authoring + registration wired to the sponsored mint + registry proxy (same logic as the per-agent "Create ID"), supporting direct Concordium web-wallet co-signed gasless transactions on-chain.
- **Phase 4.5 — Provider keys under Agents (done):** folded the per-lobby / per-agent provider-key config (already in the Hosted-Mode card) into the panel's Agents view, allowing users to configure default or override API keys for models directly in the panel.
- **Phase 4.6 — Knowledge Base / KB (done):** refactored and renamed the panel's "Memory" tab to "KB". Added repo URL / branch settings configuration and direct file upload -> convert to markdown -> remote commit via the lobby's GitHub App installation token.
- **Local-only views (Files, Gantt, Scheduled, Loop):** either given hosted data sources (wallet-scoped server-side state) or kept hidden in hosted mode.

## The working repository (GitHub App)

The connected repository is the **durable home of everything the lobby manages** — the lobby host
stores only ephemeral coordination state. The working repo is always visible in the panel's top
bar (`📁 owner/repo@branch`); every surface below depends on it and tells you to connect the
GitHub App first when it isn't.

**Initialization** (`POST /lobbies/:id/repo/initialize`, or the "Initialize Agent OS structure"
button in the Lobby tab's GitHub card) seeds the repo in ONE atomic commit with the parts of Agent
OS needed to manage a swarm there. Idempotent — files already in the repo are never overwritten:

| Path seeded | Purpose |
|---|---|
| `agent-os/sub-agents/agents/*.md` | Agent definitions — the launchable roster; bound Agent IDs (`Identity:` lines) live here |
| `agent-os/sub-agents/skills/*/SKILL.md` | Skills agents can invoke |
| `agent-os/scheduled/prompts/*.md` + `agent-os/config.json` | Self-learning scheduled tasks (graph update, PR quality review, fix-sprint executor) |
| `agent-os/shared-memory/` | Shared memories (facts, lessons, diaries) written by the swarm |
| `agent-os/training/packs/` | Locally trained (`/train`) packs promoted to the repo |
| `agent-os/.agent-os.json` | Initialization manifest (who/when/what) — the "initialized" marker |

**Everything that depends on the connected repo:**

| Feature | Repo dependency |
|---|---|
| Launching agents | Definitions merged repo-over-catalog (repo wins per slug); a definition's `Identity:` DID becomes the agent's join token |
| Agent IDs (mint / Set ID) | The DID is committed to the agent's definition file (bootstrapped if missing) |
| Agent work (repo tools) | Hosted agents get `read_file`/`write_file`/`create_pr` against the working repo |
| Knowledge Base | Uploaded docs are converted and committed under the KB root path |
| Scheduled self-learning | `config.json` + prompts are read from / written to the repo |
| Files tab | Read-only browse of the working repo |
| Memories | Shared memory lands in the repo (`shared-memory/`, KB indices) — restarts lose nothing |

All repo operations mint **fresh** installation tokens per call (the GitHub App's ~1h token expiry
never surfaces), and the lobby holds no long-lived credential — uninstalling the App revokes
everything.

## Verification

Each phase ships an offline, seam-injected verify suite (`npm run verify-hosted`) — no live wallet,
network, or model calls — matching the repo's existing verify-* philosophy.
