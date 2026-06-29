# STATE.md — Agent OS Protocol

> **Purpose:** Current implementation state of the independent platform. Informative, not
> normative. Updated as phases progress. The authoritative build plan is
> [`../IMPLEMENTATION-PLAN.md`](../IMPLEMENTATION-PLAN.md).
> **Last updated:** Phase 11.

## Status summary

The platform is being forked into an independent, Apache-2.0, product-neutral repository per
the phase plan. **Phases 0–10 are merged to `main` (Phase 10 — launch readiness — via #11) and the
first release `v0.1.0` is tagged. Phase 11 (Loop Mode) is implemented on a feature branch with a PR
open; Phases 12–13 are planned.**

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
| 9 | UI Assist integration package | ✅ merged (#10) |
| 10 | Launch readiness (docs, verify-launch, smoke, v0.1.0) | ✅ merged (#11) + `v0.1.0` tagged |
| 11 | Loop / autonomous iterative execution | ✅ implemented — PR open |
| 12 | Agent OS Panel UI redesign (DESIGN.md alignment) | ✅ complete |
| 13 | Agent OS Protocol website (public landing site) | ✅ complete |
| 14 | Website Optimization & Agent Review | ✅ complete |

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
- **Phase 9 — UI Assist integration package (merged #10):** the neutral, embeddable overlay slice.
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
- **Phase 10 — launch readiness (merged #11, `v0.1.0` tagged):** the fork is shippable as a coherent whole. The launch
  documentation set under `docs/` (getting-started, examples, security, lobby-hosting,
  training-agents + a docs index) is written to the verified reality of the code and wired together;
  the root README points at it. The documented configuration is now **real**: a zero-dependency
  `.env` loader in `@agent-os/protocol-core` plus `AGENT_OS_LOBBY_URL` / `AGENT_OS_PANEL_PORT` /
  `AGENT_OS_RELAY_PORT` / `AGENT_OS_LOBBY_PORT` honoured across panel/relay/lobby with **flag → `.env`
  → default** precedence (previously these were advertised but read by no code, and `.env` was never
  loaded). The roster is self-consistent — the last domain-gate leak and all dangling skill
  references are cleared, and two generic skills (`persona-usecase-validation`,
  `module-production-review`) authored so the kept agents resolve. New checkable artifacts:
  `npm run verify-launch` (49 launch invariants — docs present, scripts wired, brand+domain gates,
  no dangling skill refs, Apache-2.0 license, `.env` loader behaviour, CHANGELOG↔version match),
  `npm run verify-all` (all six suites), and `npm run smoke` — the fresh-clone boot smoke
  (install → verify-all → boot Panel + Lobby + Relay → HTTP probes → teardown). First release
  prepared: version `0.1.0`, `CHANGELOG.md`, `RELEASING.md` (the `v0.1.0` tag is cut on the merge
  commit). **Exit met:** a fresh clone runs Local Mode and connects to a configured lobby; all six
  suites pass; brand+domain gates clean; the read-only source repo untouched (reference only). Verified
  by `npm run smoke` (PASSED) and `npm run verify-all` (16/11/15/23/31/49).
- **Phase 11 — Loop Mode (PR open):** Loop Mode ships (§12B), built on the `LoopSpec`/`ExitCriterion`
  schema Phase 4 seeded. New `packages/loop` (`@agent-os/loop`) — the `LoopOrchestrator` runs
  `Assess → Delegate → Verify → Reflect → Decide` over a work item behind injected seams (evaluate /
  delegate / approveCheckpoint / now / isKilled / emit), so the whole controller + every safety rule
  verifies with no LLM/lobby/network: hard `maxIterations` + token/cost/wall-clock budget,
  convergence + stall detection, a regression guard, human approval checkpoints (fail-closed), a kill
  switch, full audit, and **unattended OFF by default** (opt-in at run time; allowlisted actions
  only). Authoring + orchestration via the new `create-loop` and `loop-orchestrator` skills (wired
  into boss-agent + SUB-AGENTS). The **`continuous-quality` preset** expresses the Scheduled-QA
  workload as a `LoopSpec` (`onConverge: open-pr`, commit-only unattended allowlist). Runnable via
  `npm run loop` (simulated driver) and a Panel **Loop** tab + `/api/loops` endpoints with
  `loop-event`/`loop-done` WS streaming. New `npm run verify-loop` (17) wired into `verify-all` and
  required by `verify-launch` (now 53); guide at `docs/loop-mode.md`. README given a full
    stale-information refresh. **Exit met:** a loop converges on a work item against measurable exit
  criteria, respects iteration/budget caps + human checkpoints, is fully auditable + stoppable, and
  is runtime-agnostic (local now via the runner; swarm via the lobby). Verified by `npm run verify-loop`
  (17/17), `npm run loop` (attended + unattended converge), the Panel loop endpoints (attended +
  unattended runs converge 4/4), and `npm run verify-all` (16/11/15/23/31/17/53).
- **Phase 12 — Panel UI Redesign (complete):** The localhost Panel UI has been fully evolved from its early functional layout into the refined, dark glassmorphic control-plane design defined in `DESIGN.md`. Features a reusable CSS token system (deep-navy `#050B18` bg, radial-gradient, glassmorphism panels, cyan→violet gradients, active glow borders, Outfit/Inter typography, custom scrollbars) ensuring no functional regression across any page. Implemented the brand hex/cube 3D SVG logo mark and a redesigned header status bar. Built the polished Panel Loop view (featuring presets list sidebar, runs logging list, start/pause/stop buttons, individual criterion checkmarks, token/cost/time budget burn progress bars, unattended/attended toggles, and interactive checkpoint approval/rejection card overlays) wired to live endpoints (`/api/loops/pause`, `/api/loops/resume`, `/api/loops/decide`). Integrated overview metrics cards row on the Agents view backed by a new `/api/overview-stats` server aggregator. Verified by new automated verification script `verify-ui` (all 7 suites green in `verify-all`, 55 launch invariants green in `verify-launch`).
- **Phase 13 — Agent OS Protocol Website (complete):** Built a premium, zero-dependency static public website under `apps/website/` based on the 10-slide deck and the visual style conventions of `DESIGN.md` (deep navy bg, Outfit/Inter typography, linear brand gradients, glassmorphism cards, and comparative matrices). Includes interactive operating modes tabs switcher, problem/solution grids, architecture diagram blocks, trust-layer (identity) charts, ecosystem integrations, and open-source licensing overviews. Implemented a preview HTTP server script `apps/website/server.ts` wired into `package.json` (`npm run website` on port 4802). Integrated automated verification into `verify-ui` and `verify-launch`. All 56 checks green.
- **Phase 14 — Website Optimization & Agent Review (complete):** Evolved and optimized the public website based on user feedback and a multi-agent review suite. Removed the "Ecosystem Integrations" and "Built on What's Proven" sections. Integrated the Concordium double-C brand SVG logo and a custom badge linking to `https://concordium.com` in the Trust Layer. Added a visual showcase carousel gallery utilizing the 7 panel mockup screenshots, and an "Under the Hood" tabbed navigation detailing the Agent OS Panel, UI Assist CLI/HUD, and Specialist Agent Roster. Executed accessibility (WCAG AA text contrast, skip links, aria role tablist, and scrollable container key focus) and SEO enhancements (JSON-LD schema structured metadata, OpenGraph tags, H1-H3 structural hierarchies). Hardened the local server script against traversal vulnerabilities and directory EISDIR exceptions. All 56 launch checks green.

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
- **Launch follow-ups (Phase 10):** the verifiable core ships (`verify-launch`, `verify-all`,
  `smoke`, the docs, real `.env`). Deferred / infra-gated: (1) **npm publishing** of the
  `@agent-os/*` packages + the bundled UI Assist framework wrappers; (2) the **hosted swarm lobby**
  `apps/lobby-web` (Vercel + Upstash) — a deploy, not a tag artifact; (3) **live Concordium indexer**
  wiring + on-chain (wallet-side) registration; (4) **`AGENT_OS_RUNTIME` is parsed but not yet
  honoured** by the relay — selecting the driver per the runtime adapter (so Codex/others fuel a turn
  through the relay) rides on the relay-driver refactor noted above; it is marked "planned" in
  `.env.example`. Pre-existing Phase-2 roster debt also remains (gate-clean, so not a launch blocker):
  a few agent startup protocols still cite origin-era doc paths, and some governance skill/agent
  counts are stale — both to be refreshed organically (or in a housekeeping pass).
- **Loop Mode follow-ups (Phase 11):** the engine, skills, preset, runner, Panel tab/endpoints, and
  docs ship and are verified. Deferred / infra-gated: (1) **live execution wiring** — binding the
  engine's `evaluate` seam to real gate-skill runs and `delegate` to the Boss/lobby turn loop (the
  `npm run loop` driver and the Panel runs are deterministic simulations until then; rides on the
  relay-driver refactor); (2) **unattended cron** — the scheduler driving a preset loop on a cadence
  over a remote swarm with cost budgets + verified identities; (3) **loop resumability** —
  `awaiting_checkpoint` is currently terminal (a paused loop is re-run, not suspended/resumed mid-iteration).
