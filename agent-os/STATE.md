# STATE.md — Agent OS Protocol

> **Purpose:** Current implementation state of the independent platform. Informative, not
> normative. Updated as phases progress. The authoritative build plan is
> [`../IMPLEMENTATION-PLAN.md`](../IMPLEMENTATION-PLAN.md).
> **Last updated:** Phase 9.

## Status summary

The platform is being forked into an independent, Apache-2.0, product-neutral repository per
the phase plan. **Phases 0–8 are merged to `main` (Phase 8 — Concordium agent identity &
verification — via #9). Phase 9 (UI Assist integration package) is implemented on a feature
branch with a PR open; Phases 10–13 are planned.**

## Phase status

| Phase | Title | Status |
|------:|-------|--------|
| 0 | Discovery, safety, planning | ✅ complete |
| 1 | Repo isolation, branding & Apache-2.0 relicensing; runnable local mode | ✅ merged (#2) |
| 2 | Generic agent roster + Domain Specialist + new platform agents | ✅ merged (#3) |
| 3 | `/train [agent]` command | ✅ merged (#4) |
| 4 | Runtime adapter abstraction + canonical work-item schema | ✅ merged (#5) |
| 5 | Additional CLI adapters (Codex first) | ✅ merged (#6) |
| 6 | API provider (fuel) layer, BYOK | ✅ merged (#7) |
| 7 | Independent lobby platform (public/private, durable state) | ✅ merged (#8) |
| 8 | Concordium agent identity & verification | ✅ merged (#9) |
| 9 | UI Assist integration package | ✅ implemented — PR open |
| 10 | Launch readiness | ⬜ planned |
| 11 | Loop / autonomous iterative execution | ⬜ planned |
| 12 | Agent OS Panel UI redesign (DESIGN.md alignment) | ⬜ planned |
| 13 | Agent OS Protocol website (public landing site) | ⬜ planned |

## Done so far

- **Phase 1 — isolation + local mode (merged):** Apache-2.0 `LICENSE`/`NOTICE`, config, `.gitignore`,
  `MIGRATION.md`; the Panel UI + panel server/tray + relay extracted and de-branded (local types
  ported); governance docs neutralized; generic scripts/hooks + the scheduler engine kept.
  `npm run agent-os-panel` and the relay both boot.
- **Phase 2 — roster (merged):** 30-agent project-neutral roster (24 generic specialists + 6 new
  platform agents: domain-specialist, identity, lobby-architect, runtime-adapter,
  ui-assist-integration, training); 43 generic skills (domain skill packs dropped);
  presets + routing updated. Panel discovers all 30.
- **Phase 3 — `/train` (merged #4):** `agent-os/scripts/train.mjs` engine + the `train` skill +
  `.claude/commands/train.md` + `npm run train`. Generates reviewable skill drafts with provenance,
  dry-run, **secret detection** (rejects keys/tokens/passwords/.env), explicit activation, and
  list/deactivate/remove. Writes confined to `training/` + `skills/trained/` + `memories/trained/`;
  never touches core rules. Verified end-to-end.
- **Phase 4 — runtime adapter abstraction + work-item schema (merged #5):** `packages/protocol-core`
  (canonical shared types: runtime-adapter, work-items + format, model-provider, lobby-protocol) +
  `packages/adapters` (the `AdapterRegistry` + the first-class `claude-cli` adapter, extracted from
  the relay) + the canonical work-item engine (`npm run work-items`) and create-phase/sprint/task
  authoring skills. The panel detects runtimes via `GET /api/runtimes` → `runtimeRegistry.detectAll()`.
- **Phase 5 — Codex CLI adapter (merged #6):** second first-class adapter — `packages/adapters/src/codex-cli.ts`
  drives OpenAI's Codex CLI in headless mode (`codex exec --experimental-json`, spawned binary
  detected on PATH) with a pure `mapCodexEvent()` parser and thread-id session resume. Registered
  alongside `claude-cli`; missing runtime degrades to an install message. Verified by
  `npm run verify-adapters` (16/16, injected fake spawn over a canned JSONL transcript). Discovery
  spikes + the confirmed compatibility matrix in `docs/adapters/` (OpenCode/Cursor/Hermes/OpenClaw
  documented with blockers).
- **Phase 6 — API provider (fuel) layer (merged #7):** `packages/providers` implements the
  `ModelProviderAdapter` contract — `openai-compatible` (Chat Completions) + `anthropic-compatible`
  (Messages), each with `complete()` + SSE `stream()` over an injectable fetch, plus a
  `ProviderRegistry`. **BYOK is structural**: configs store only the env-var *name*; keys resolve
  from the local env at call time and never serialize, log, or reach a lobby (`redactProviderConfig`
  / `assertNoInlineSecret`). Panel discovery via `GET /api/providers` (reports key present/absent,
  never the value). Verified by `npm run verify-providers` (11/11, injected fake fetch — no network/
  key). Contract + BYOK model in `docs/providers/`.
- **Phase 7 — independent lobby platform (merged #8):** `packages/lobby-server` is a portable Node
  HTTP+WS lobby that speaks the protocol the Panel/relay already use (`/api/v1/agent-lobby/discover`
  + `/ws/agent`), so they connect via `--lobby <url>` unmodified — a clean-room reimplementation of
  the prior bespoke coordinator. **Rules are enforced server-side** by `LobbyCoordinator`: floor control
  (only the Boss/human may broadcast — the fix for the N² echo-cascade), lobby-scoping, directed-
  task-only (`*` rejected), private-lobby allowlist, public rate-limit, and a durable event log.
  `LobbyStore` is a pluggable seam (InMemory now; Redis backs the swarm). `packages/lobby-client`
  is the typed WS client. Verified by `npm run verify-lobby` (15/15: coordinator unit rules + a
  real two-client WS run incl. on-wire lobby-scoping) **and** an end-to-end Panel connect
  (`--lobby` → discover → register → roster). `apps/lobby-web` (Vercel + Upstash) documented as the
  deploy-gated next increment. `npm run lobby`; docs in `docs/lobby/`.
- **Phase 8 — Concordium agent identity & verification (merged #9):** the verifiable, read-only,
  key-free identity slice. `packages/protocol-core/agent-identity.ts` adds the **Agent Card** (public,
  hashable, A2A-shaped — `application/a2a-agent-card+json`), `ConcordiumAgentRef` (non-secret pointer),
  the verification **status ladder** (registry_verified → human_linked → org_linked / pending / failed),
  and `LobbyJoinPolicy`. New `packages/identity-concordium` implements read-only verification behind an
  **injectable transport seam** (`HttpIndexerTransport` = GET-only against a registry indexer; a fake in
  tests) + Agent Card draft/validate/hash + `prepareRegistration` (**wallet-side-only — never signs or
  submits**) + `linkProfile`. The **Identity Agent** is now functional (definition + `identity-verification`
  skill). The lobby coordinator enforces the **private-lobby policy ladder** server-side
  (none → registered → allowlisted → verified_human_link) via an injected verifier seam — fails closed with
  no verifier; the server wires a live verifier only when `AGENT_OS_CONCORDIUM_INDEXER_URL` is set (default
  boot unchanged). The Panel roster shows **identity badges**. Verified by `npm run verify-identity` (23/23,
  injected fake transport/verifier — no network, no key) with the other three suites still green
  (adapters 16, providers 11, lobby 15). The verified Concordium references (CIS-8004/CIS-8, MCP service,
  indexer tools, JS SDK, VCK/VCDC) and the deferred on-chain writes are recorded in `docs/identity/`.
- **Phase 9 — UI Assist integration package (PR open):** the neutral, embeddable overlay slice.
  `packages/ui-assist-core` is the framework-agnostic engine — the browser↔runtime **event contract**
  (named to match the relay wire), a **transport seam** (local relay / remote lobby / fake in tests),
  the **session** state machine, the explicit-**permission gate** (suggest-only by default; an `act`
  turn is blocked client-side until the developer grants authority, then carries an authorisation
  marker), the response-render rule (UI-ASSIST.md Rule 1), and the **integration engine**
  (`detectProjectType` + `emitIntegrationPlan`). No DOM, no socket — everything injected, so it
  verifies in Node. `packages/ui-assist-embed` ships `embed.js` — a **dependency-free, repo-local
  embeddable `<script>`** (no build step) that renders the overlay and speaks the contract to the
  relay, plus a demo page. The **Integration Agent** is functional via
  `npm run ui-assist-integrate` (detects plain JS / React / Next.js / Vue / Svelte / Laravel / WordPress
  / Joomla and prints — never applies — the embed snippet + install checks + secure-connect summary);
  guides in `docs/ui-assist/`. The reused relay was further **de-branded** (origin roleKeywords/sprint
  refs removed) and the UI Assist docs neutralized. Verified by `npm run verify-ui-assist` (31/31 — an
  injected fake WebSocket + a DOM stub that mounts `embed.js` itself and cross-checks its action parser
  against the core) with the other four suites green (adapters 16, providers 11, lobby 15, identity 23).

## Known follow-ups

- Brand and domain neutralization is complete: the repo passes the brand + domain gates (the only
  origin references live in the three fork-describing docs). The governance docs retain some
  illustrative incident history from the origin project (now neutralized); it will be refreshed
  organically as the platform accrues its own history.
- **Next adapter: OpenCode** (no hard blocker — `opencode run --format json` / ACP nd-JSON);
  **Cursor** needs a PTY shim (TTY-only). See `docs/adapters/runtime-spikes.md`.
- **Provider follow-up:** the fuel engine ships, but binding "agent X → provider Y" into live turn
  execution (and a panel provider selector UI) rides on the relay driver refactor below; an
  Anthropic-/OpenAI-compatible Hermes endpoint would slot in here as a config, not a new runtime.
- The relay still drives Claude inline via the SDK `query()`; routing its turn loop through the
  adapter's `startAgent`/`readOutput` (so both runtimes — and providers — share one driver path) is
  a later refactor.
- **Lobby follow-ups:** the portable Node WS server is the verified core; the hosted swarm
  `apps/lobby-web` (Next.js on Vercel + a `RedisLobbyStore`, REST + SSE) is the deploy-gated next
  increment (needs Vercel + Upstash, so not bootable in CI). Wiring the Panel Lobby tab's phase
  switching + the relay's lobby client onto `@agent-os/lobby-client` (replacing their bespoke
  clients) is a follow-up.
- **Identity follow-ups (Phase 8):** the read-only verification slice ships and is the verifiable
  core. Three parts are intentionally deferred / config-gated: (1) **live indexer wiring** —
  `HttpIndexerTransport` needs a running registry indexer (`AGENT_OS_CONCORDIUM_INDEXER_URL`); its
  exact record routes/fields must be confirmed against a live indexer (the seam isolates this).
  (2) **On-chain registration writes** stay wallet-side (Agent OS prepares, never signs/submits) —
  the `@concordium/web-sdk` serialization path is future work. (3) **Panel/relay join_token UX** —
  presenting an identity reference from the Panel join screen + the relay's `lobby-register`, and a
  card-authoring panel view, build on the shipped protocol field. No private keys are ever stored or
  sent in any of these.
- **UI Assist follow-ups (Phase 9):** the repo-local `<script>` + the core/integration engine are the
  verifiable core. Three parts are intentionally deferred / infra-gated: (1) a **bundled/minified
  `dist`** and **npm-published framework wrapper packages** (`-react`/`-next`/`-vue`/…) — needs a
  bundler + an npm registry (Open Q#9: repo-local script first); (2) **live framework install
  validation** against real React/Next/WordPress/Joomla apps — needs those toolchains in CI; (3)
  wiring the overlay's **Suggest/Act mode through to the relay's runtime permission mode** (the relay
  currently runs the runtime in a permissive edit mode; the explicit-permission gate is enforced
  overlay-side + by the system prompt until then). Also: routing the Panel's Assist tab + the relay
  onto `@agent-os/ui-assist-core`'s contract/session (replacing their inline copies) is a follow-up.
