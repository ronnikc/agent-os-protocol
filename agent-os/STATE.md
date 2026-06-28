# STATE.md — Agent OS Protocol

> **Purpose:** Current implementation state of the independent platform. Informative, not
> normative. Updated as phases progress. The authoritative build plan is
> [`../IMPLEMENTATION-PLAN.md`](../IMPLEMENTATION-PLAN.md).
> **Last updated:** Phase 6.

## Status summary

The platform is being forked into an independent, Apache-2.0, product-neutral repository per
the 11-phase plan. **Phases 0–5 are merged to `main`; Phase 6 (API provider / fuel layer) is landing.**

## Phase status

| Phase | Title | Status |
|------:|-------|--------|
| 0 | Discovery, safety, planning | ✅ complete |
| 1 | Repo isolation, branding & Apache-2.0 relicensing; runnable local mode | ✅ merged (#2) |
| 2 | Generic agent roster + Domain Specialist + new platform agents | ✅ merged (#3) |
| 3 | `/train [agent]` command | ✅ merged (#4) |
| 4 | Runtime adapter abstraction + canonical work-item schema | ✅ merged (#5) |
| 5 | Additional CLI adapters (Codex first) | ✅ merged (#6) |
| 6 | API provider (fuel) layer, BYOK | 🔄 landing |
| 7 | Independent lobby platform (public/private, durable state) | ⬜ planned |
| 8 | Concordium agent identity & verification | ⬜ planned |
| 9 | UI Assist integration package | ⬜ planned |
| 10 | Launch readiness | ⬜ planned |
| 11 | Loop / autonomous iterative execution | ⬜ planned |

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
- **Phase 6 — API provider (fuel) layer (landing):** `packages/providers` implements the
  `ModelProviderAdapter` contract — `openai-compatible` (Chat Completions) + `anthropic-compatible`
  (Messages), each with `complete()` + SSE `stream()` over an injectable fetch, plus a
  `ProviderRegistry`. **BYOK is structural**: configs store only the env-var *name*; keys resolve
  from the local env at call time and never serialize, log, or reach a lobby (`redactProviderConfig`
  / `assertNoInlineSecret`). Panel discovery via `GET /api/providers` (reports key present/absent,
  never the value). Verified by `npm run verify-providers` (11/11, injected fake fetch — no network/
  key). Contract + BYOK model in `docs/providers/`.

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
