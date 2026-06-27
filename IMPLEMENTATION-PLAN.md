# IMPLEMENTATION-PLAN.md — Agent OS Protocol (Independent Fork)

> **Status:** Sprint 0 deliverable — **final implementation plan, pending Ronni's approval.**
> **No implementation beyond planning docs has been performed.**
> **Repository:** `github.com/ronnikc/agent-os-protocol` · branch `claude/new-session-pxa8cs`
> **Charter:** see [`planning.md`](planning.md) (the source brief this plan answers).
> **Author / Copyright holder of the new platform:** Gothar.dk // Ronni K. Gothard Christiansen.
> **Boundary:** `grc-suite-test` is **read-only source**. Nothing in it will be modified.

This document answers all 15 required outputs (charter §21) and all 10 open questions
(charter §20), grounded in a real inspection of the source repository.

---

## 0. Executive Summary

The single most important discovery: **`agent-os-protocol` is currently an empty git
repository (0 files, no commits).** It is *not* a partial or full copy of the Agent OS
code. Therefore the fork is a **curated extraction** from `grc-suite-test/agent-os/**`
(plus the relay) into a clean, ComplianceOne-free, personally-owned repository — **not**
a "copy everything then scrub" exercise.

Three findings shape the whole plan:

1. **The Claude CLI flow is already ~95% decoupled.** The relay (`relay-server.ts`,
   1,267 lines) has only **two** ComplianceOne touchpoints — both *type-only* imports —
   and one branded system prompt. The panel server (2,820 lines) imports only `ws` and
   couples through **one** hardcoded relay path. The panel UI has **one** ComplianceOne
   string. Preserving the working local flow is low-risk.

2. **~96% of ComplianceOne "references" live in regenerable artifacts**, not
   hand-authored files: `graph.json` (959 matches), `.graph-modified-files` (5,416),
   `observations/index.md` (2,034), memory indexes, registries, scheduled state. These
   are **regenerated from the codebase and must never be forked.** Dropping them removes
   the vast bulk of the neutralization burden at zero cost.

3. **Agent OS Panel and Agent OS UI Assist are both first-class, in-scope deliverables**
   of the fork (confirmed per Ronni's directive). They are treated as Layer 2 (Local
   Control Plane) and a cross-cutting integration product, respectively — see §4, §9, §12.
   Two corrections folded in per Ronni: the Panel's **generic scheduler** (the
   `agent-os/scheduled/` system behind the Scheduled tab) is **kept** (only its
   ComplianceOne state/prompts reset, §7a), and the Panel's **agent-lobby logic is the
   clone source** for the new Vercel remote-swarm app `apps/lobby-web` (§9).

**Copyright/licensing (per Ronni's directive):** every `AesirX.io Ltd.` copyright header
and the proprietary `LICENSE.md` will be replaced with
**`Copyright (c) 2026 Gothar.dk // Ronni K. Gothard Christiansen`** and the
**Apache License 2.0** (see §6). All `AesirX` / `ComplianceOne` /
`Forseti` branding and domain content is planned for **complete removal** from the
default distribution (§3, §7).

---

## 1. Repository Confirmation & Boundary Check (charter §21.1)

Run at session start (charter §0/§3 — non-negotiable):

| Check | Result |
|---|---|
| `pwd` (target) | `/home/user/agent-os-protocol` |
| `git remote -v` (target) | `origin … /ronnikc/agent-os-protocol` ✅ correct repo |
| `git status` (target) | `On branch claude/new-session-pxa8cs` · **No commits yet** · clean |
| Target file count | **0** (empty repo — fork not yet started) |
| `grc-suite-test` remote | `origin … /ronnikc/grc-suite-test` (read-only source) |
| `grc-suite-test` status | **clean**, `claude/new-session-pxa8cs` — **untouched and will remain so** |

**Boundary verdict:** ✅ Active repo is the independent `agent-os-protocol`. `grc-suite-test`
is present only as read-only reference. No write, rename, move, lint, or format will ever
target it. The safety check (`pwd` / `git remote -v` / `git status --short`) will be
re-run at the start of every phase; any `grc-suite` remote/path = **stop**.

---

## 2. Current File Inventory (charter §21.2)

**Target (`agent-os-protocol/`):** empty except the two planning docs added by this
Sprint 0 (`planning.md`, `IMPLEMENTATION-PLAN.md`).

**Fork source (`grc-suite-test/`, read-only)** — the Agent OS material to extract:

| Area | Path | Contents | Disposition |
|---|---|---|---|
| Governance docs | `agent-os/*.md` | 18 files: RULES, SPRINTS, SUB-AGENTS, ARCHITECTURE, MEMORY, LOBBY-PROTOCOL, UI-ASSIST(+GUIDE), ETHICS, SOUL, HOUSEKEEPING, REUSE, I18N, STATE, README, sprints-reference, whisper-rules | Copy + neutralize (except STATE → regenerate) |
| Panel UI | `agent-os/agent-os-panel/**` | `app.js`, `index.html`, `styles.css`, `presets.json`, `favicon.ico`, `lib/marked.umd.js`, 11 `tabs/*.js` | Copy + 1-string fix |
| Panel server | `agent-os/scripts/agent-os-panel-server.ts` (2,820 L), `agent-os-panel-tray.ts` | Localhost control plane | Copy + relay-path fix + header |
| Relay | `src/backend/src/modules/ui-assist/relay-server.ts` (1,267 L) | Claude CLI bridge + lobby client | Extract + localize 2 types + de-brand |
| Sub-agents | `agent-os/sub-agents/**` | **35 agent defs**, **79 skills**, `templates/`, `diary-routing.yaml`, per-agent memories | Curate (see §7 roster) |
| Scripts | `agent-os/scripts/**` | ~60 scripts + `hooks/` (28), `load/`, `codemods/`, `help/` | Curate generic vs ComplianceOne |
| Memory system | `agent-os/memories/**` | INDEX.aaak, decisions/patterns/lessons/playbooks, `closed/` | Copy framework, drop content, regenerate index |
| **Scheduling system** | `agent-os/scheduled/**` (config.json, prompts/, templates/, daily runner) + panel-server `/api/scheduled/*` + `tabs/scheduled.js` | **Generic Agent OS scheduler** — powers the panel Scheduled tab (3 tasks: graph update, PR review, fix-sprint exec) | **KEEP engine** + neutralize prompts; `state/` regenerated |
| Runtime state | `observations/`, `shared-memory/`, `logs/`, `registries/`, `spawn-requests-archive/`, `scheduled/state/` | Session/QA state | **Do not fork** — ship empty scaffolds |
| Generated graphs | `agent-os/graph.json` (459 KB), `.graph-modified-files` (437 KB), `facts.jsonl`, `embeddings.config.jsonl` | Derived artifacts | **Do not fork** — regenerate |
| **Lobby logic (swarm source)** | `src/backend/src/modules/agent-lobby/**` (7 files: coordinator, message/request/session/task services, `relay-lobby-bridge.ts`, routes) + panel lobby client (`agent-os-panel-server.ts`: `discoverLobbyId`/`lobby-register`/`lobby-heartbeat`/`localLobbyAgents`) + `tabs/lobby.js` + relay client | **Reference implementation of the lobby** | **Clone/port** → `packages/lobby-server` + `apps/lobby-web` (Vercel swarm) |

**Source-of-truth answer to Open Q#2:** the relay is at
`src/backend/src/modules/ui-assist/relay-server.ts` (moved into the backend module tree,
**not** `scripts/relay-server.ts`).

---

## 3. AesirX / ComplianceOne / Forseti Reference Audit (charter §21.3)

Counts from `grep -RniF` across `grc-suite-test/agent-os/`:

| Term | Matches | Where they live |
|---|---:|---|
| `grc-suite` | 7,473 | ~96% in `.graph-modified-files`, `graph.json`, `observations/index.md` (generated) |
| `Forseti` | 534 | `closed/` memories, Forseti agents (`ai-advisor`, `redline-review`, …), `seed-forseti-api-key.ts`, `forseti-brand-purity.sh` |
| `AesirX` | 110 | Copyright headers (9 files), STATE.md, governance docs, relay |
| `ComplianceOne` / `complianceone` | 103 / 103 | STATE.md, SUB-AGENTS.md, RULES.md, README, relay system prompt |
| `vn-grc` | 850 | Generated graphs + the 2 relay type imports |
| `complianceone.demo.aesirx.io` | 14 | Hardcoded lobby URL in relay + docs |
| Domain (`PDPL`/`DPIA`/`DSAR`/`Decree`/`MPS`/`Vietnam`) | ~1,200 | Regulatory skills, packs, memories, STATE.md |
| `regulatory` / `compliance` (words) | ~2,050 | Domain skills + governance examples |

**Key audit insight:** the headline 7,473 figure is misleading — the hand-authored,
must-edit surface is small and concentrated. Hotspot hand-authored files: STATE.md (73),
`closed/FORSETI-FAMILY-…` (44), `INDEX.aaak.jsonl` (23), `protected-event-taxonomy.v1.json`
(20), `help/manual-labels.json` (16), `assemble-manual.ts` (12), the Forseti agent defs
(5–9 each), SUB-AGENTS.md (8), RULES.md (7), `forseti-brand-purity.sh` (7), REUSE.md (5).

**Classification policy** (charter §6 table) is applied per-occurrence:
branding→rename, ComplianceOne agents→retire/convert, domain skills→drop (or optional
pack), generated artifacts→regenerate, history→`MIGRATION.md`.

**Acceptance gate** (charter §6 / §18) — after Phase 1–2 this must return nothing
runtime, only documented historical notes in `MIGRATION.md`:

```bash
grep -RniE "AesirX|ComplianceOne|complianceone\.demo|grc-suite|Forseti" . \
  --exclude-dir=.git --exclude-dir=node_modules
```

---

## 4. Proposed Target Architecture (charter §21.4)

Four conceptual layers (charter §5), realized as an **npm-workspaces monorepo**
(answer to Open Q#3 — see §20). Panel and UI Assist are first-class.

```
agent-os-protocol/
  README.md  CLAUDE.md  planning.md  IMPLEMENTATION-PLAN.md  MIGRATION.md
  LICENSE + NOTICE  (Apache-2.0, © Gothar.dk // Ronni K. Gothard Christiansen)
  .env.example   package.json (workspaces)
  agent-os/                      # ── Layer 1: Protocol Core ──
    RULES.md SPRINTS.md SUB-AGENTS.md ARCHITECTURE.md MEMORY.md
    LOBBY-PROTOCOL.md UI-ASSIST.md ETHICS.md SOUL.md HOUSEKEEPING.md REUSE.md
    sub-agents/  (generic roster + new agents + skills + templates)
    memories/    (framework only; trained content user-local)
    scripts/     (generic infra: graph, facts, shared-mem, lobby, memory-index, hooks, load)
    scheduled/   (generic scheduler: config, prompts, templates — powers panel Scheduled tab)
    training/    (inbox/ reviewed/ rejected/ packs/  — /train workspace)
    observations/  shared-memory/   (empty scaffolds, .gitkeep)
  agent-os-panel/                # ── Layer 2: Local Control Plane (UI) ──
    index.html app.js styles.css presets.json tabs/ lib/
  packages/                      # ── Layers 3 & 4 ──
    protocol-core/               # shared protocol types (lobby msgs, hand-raise, agent card)
    relay/                       # extracted relay-server (runtime-agnostic core)
    lobby-client/   lobby-server/
    adapters/
      claude-cli/ codex-cli/ opencode/ cursor-cli/ hermes-agent/ openclaw/
      openai-compatible/ anthropic-compatible/
    identity-concordium/
    ui-assist-core/  ui-assist-embed/  (ui-assist-react/next/vue later)
  apps/
    lobby-web/                   # Vercel-hosted remote lobby (Next.js)
  scripts/                       # repo-level (panel server launcher, build, release)
  docs/                          # getting-started, architecture, lobby-hosting, identity, …
```

**Protocol stability principle (charter §5/§12):** the relay and lobby speak one stable
internal protocol (`packages/protocol-core`); every CLI/API is a swappable **adapter**.
Nothing is hardwired to Claude CLI.

**Phasing note:** Phase 1 keeps a *minimal* layout (working `agent-os/` + `agent-os-panel/`
+ relay) so the local flow boots immediately; `packages/` and `apps/` are introduced
incrementally (Phase 4+). Charter §16: "do not over-engineer the first pass."

---

## 5. Phase-by-Phase Plan (charter §21.5)

Each phase re-runs the boundary check first. Phases 0–3 are pure
fork/neutralization (low risk); 4–6 are the adapter refactor; 7–10 are new platform.

### Phase 0 — Discovery, Safety, Planning ✅ (this document)
- Boundary confirmed; inventory + audit complete; plan written. **No code changes.**
- **Exit:** repo inventory ✅, grep report ✅, final plan ✅, `grc-suite` untouched ✅.

### Phase 1 — Repo Isolation, Branding & Copyright Neutralization
- Extract the **copy-then-neutralize** set (§7 manifest) into `agent-os/` + `agent-os-panel/`.
- Replace **all** `Copyright (c) 2026 AesirX.io Ltd. All rights reserved.` +
  `proprietary and confidential` headers → `Copyright (c) 2026 Gothar.dk // Ronni K.
  Gothard Christiansen` (+ `SPDX-License-Identifier: Apache-2.0`). Replace `LICENSE.md`
  with the **Apache-2.0** `LICENSE` + `NOTICE`; set `package.json` license/author (§6).
- Replace `complianceone.demo.aesirx.io` → configurable `AGENT_OS_LOBBY_URL`; add `.env.example`.
- De-brand relay system prompt ("AesirX ComplianceOne GRC platform" → neutral).
- New `README.md`, `CLAUDE.md`, `MIGRATION.md`.
- **Exit:** local panel starts; Claude relay works; `grep` gate (§3) clean of runtime refs.

### Phase 2 — Generic Agent Roster & Domain Specialist Model
- Apply roster transformation (§7): keep/generalize generic agents; retire Forseti/
  ComplianceOne agents; add **Domain Specialist, Identity, Lobby Architect, Runtime
  Adapter, UI Assist Integration, Training** agents. Update `presets.json`, routing tables.
- **Exit:** agent list project-neutral; no default agent carries AesirX memories/skills.

### Phase 3 — `/train [agent]` Command (design + first impl)
- Training inbox/review/activation tree (§11); skill-draft generator; source metadata;
  `--dry-run`; secret detection; pack activate/deactivate.
- **Exit:** dry-run shows planned writes; reviewable drafts created; core rules untouched.

### Phase 4 — Runtime Adapter Abstraction
- Define `AgentRuntimeAdapter` (charter §12) in `packages/protocol-core`; extract relay
  into `packages/relay` + `adapters/claude-cli`; add panel runtime detection/selector.
- **Exit:** Claude CLI works *through* the adapter; relay protocol stable; adapter docs.

### Phase 5 — Additional CLI Adapter Spikes
- **Codex CLI first** (Open Q#4), then OpenCode, Cursor, Hermes, OpenClaw. Per-runtime
  discovery spike (§8) + compatibility matrix.
- **Exit:** ≥1 new runtime PoC (Codex); others documented with blockers.

### Phase 6 — API Provider (Fuel) Layer
- `ModelProviderAdapter` (charter §13): OpenAI-compatible + Anthropic-compatible; BYOK
  local-only; validation; streaming; per-agent provider selection.
- **Exit:** API provider fuels a generic agent in local mode; **no keys ever sent to lobby**.

### Phase 7 — Independent Lobby Platform
- `apps/lobby-web` (Next.js on Vercel) + `packages/lobby-server`/`lobby-client`; durable
  store; public/private flows; server-side boss/floor control; Node WS fallback (§9).
- **Exit:** panel connects to new lobby URL; local mode intact; messages lobby-scoped.

### Phase 8 — Concordium Agent Registry Integration
- Identity Agent flows; Agent Card schema; registry-reference storage (non-secret);
  verification via indexer/API; private-lobby access policies; roster identity badges (§10).
- **Exit:** a lobby can require verified identity; refs verify/fail; **no keys stored/sent**.

### Phase 9 — UI Assist Integration Package
- Neutral `ui-assist-core` + `ui-assist-embed`; framework guides (React/Next/Vue/Svelte/
  plain JS/Laravel/WordPress/Joomla); Integration Agent; secure panel/relay/lobby connect (§12).
- **Exit:** a dev can add UI Assist to a fresh app from docs; no ComplianceOne UI text.

### Phase 10 — Launch Readiness
- README/install/quick-start/examples/security/adapter-matrix/lobby-hosting/training guides;
  first release tag.
- **Exit:** fresh clone runs local mode + connects to configured lobby; all checks pass;
  zero AesirX/ComplianceOne runtime refs; `grc-suite` untouched.

---

## 6. Copyright, Licensing & Attribution (Ronni's directive)

**Locked:** copyright holder for the new platform =
**`Gothar.dk // Ronni K. Gothard Christiansen`**.

| Item | Current (source) | New (independent repo) |
|---|---|---|
| Per-file header (9 `.ts` + relay) | `// Copyright (c) 2026 AesirX.io Ltd. All rights reserved.`<br>`// This source code is proprietary and confidential.` | `// SPDX-License-Identifier: Apache-2.0`<br>`// Copyright (c) 2026 Gothar.dk // Ronni K. Gothard Christiansen` |
| Root license | `LICENSE.md` — AesirX **proprietary** | `LICENSE` (full **Apache-2.0** text) + `NOTICE` (attribution), same holder |
| Relay system prompt | "embedded in the AesirX ComplianceOne GRC platform" | neutral ("Agent OS UI Assist developer tool") |
| 3rd-party MIT attributions (Hemant Naik, in regulatory skills) | present | moot — those skills are **dropped**; if any generic skill is kept, preserve its upstream MIT notice in `references/` + `MIGRATION.md` |

**License — LOCKED: Apache License 2.0** (per Ronni's directive). Apache-2.0 fits a
public, personally-owned platform: permissive adoption **plus** an explicit patent grant
and a `NOTICE` mechanism. Phase 1 will add:
- `LICENSE` — the **full, verbatim Apache-2.0 text**.
- `NOTICE` — `Agent OS Protocol — Copyright (c) 2026 Gothar.dk // Ronni K. Gothard
  Christiansen`, plus any retained third-party attributions.
- Per-file SPDX header `// SPDX-License-Identifier: Apache-2.0` + the copyright line.
- `package.json` `"license": "Apache-2.0"` and matching `"author"`.

**Third-party compatibility:** any code/skill retained from an MIT-licensed upstream
(e.g. the dropped Hemant-Naik regulatory skills, should a *generic* one be kept) is
MIT→Apache-2.0 compatible; its original MIT notice is preserved in `references/` and
listed in `NOTICE` + `MIGRATION.md`.

**Enforcement:** a generic `copyright-header` hook (adapted from the retired
`forseti-brand-purity.sh`) will assert the new header on new source files and fail CI on
any `AesirX`/`proprietary and confidential` reappearance.

---

## 7. Extraction Manifest — Files to Change / Drop / Never Touch (charter §21.6, §21.7)

### 7a. COPY → NEUTRALIZE (hand-authored, generic value)
- **Governance:** RULES, SPRINTS, SUB-AGENTS, ARCHITECTURE, MEMORY, LOBBY-PROTOCOL,
  UI-ASSIST(+GUIDE), ETHICS, SOUL, HOUSEKEEPING, REUSE (+ I18N→optional). Strip
  ComplianceOne nouns; keep generic patterns.
- **Panel UI:** all of `agent-os-panel/**` (1 string fix; presets already generic).
- **Panel server:** `agent-os-panel-server.ts` + `-tray.ts` — repoint the hardcoded relay
  path (lines ~500, ~2655) to `packages/relay` (Phase 4) or interim local path (Phase 1).
- **Relay:** `relay-server.ts` — localize the 2 `import('@vn-grc/shared')` types
  (`LobbyToAgentMessage`, `HandRaiseCategory`) into `packages/protocol-core`; de-brand
  prompt + URL + header.
- **Generic scripts:** `graph-*`, `facts-*`, `shared-mem-*`, `lobby-*`, `embeddings-*`,
  `build-memory-index.*`, `build-docs-index.mjs`, `session-summary.sh`, `runtime-verify.sh`,
  `render-spawn-prompt.sh`, `process-spawn-requests.*`, `install-claude-hooks.sh`,
  `mcp-*.sh`, `load/`.
- **Generic hooks** (most of `scripts/hooks/`): block-no-verify, build-order-guard,
  no-skip-failures, scope-detector, session-*, graph-*, memory-index-staleness,
  reuse-guard, pre-compact-save, observation-capture, etc. (review each for ComplianceOne paths).
- **Sub-agents:** generic agent defs + `templates/` + `diary-routing.yaml` + generic skills.
- **Scheduling engine (generic — Ronni's correction):** `agent-os/scheduled/{config.json,
  templates/,process-spawn-requests-daily.sh}` + the 3 default task prompts
  (`graph-update.md`, `pr-quality-review.md`, `fix-sprint-executor.md`) **with repo refs
  made configurable** (drop grc-suite / Vietnam / GMT+7 specifics → target repo + timezone
  become config). This powers the Panel **Scheduled tab**, so preserve panel-server
  `SCHEDULED_DIR` + `/api/scheduled/*` endpoints + WS `scheduled-start/done/trigger` events
  + `tabs/scheduled.js` (252 L). The persistent state-branch workflow (`claude/scheduled-state`)
  becomes a configurable branch name.

### 7b. REGENERATE FRESH (never fork generated state)
- `graph.json`, `.graph-modified-files`, `.graph-stale`, `facts.jsonl`,
  `embeddings.config.jsonl` → rebuild via `graph-build.sh` / `facts-rebuild.sh` / memory-index.
- `observations/**`, `shared-memory/**`, `logs/**`, `registries/**`, `scheduled/state/**`
  → empty `.gitkeep` scaffolds (the scheduling **engine** is kept — §7a — only its
  ComplianceOne state, e.g. `pending-fix-sprints.json` with grc-suite PR URLs, resets).
- `memories/INDEX.aaak*` + indexes → rebuild from kept memories.
- **STATE.md** → author fresh neutral state (do **not** copy ComplianceOne sprint state).

### 7c. DROP (ComplianceOne / Forseti — do not fork)
- **Agents (retire):** `ai-advisor`, `ai-prompt-engineering`, `cost-governance`*,
  `tool-call-quality`, `redline-review`, `tips-widget`, `help-center-content`.
  (*`cost-governance` may be *re-introduced generically* in Phase 6 for API-fuel budgets.)
- **Agents (convert→generic):** `compliance`→**Domain Specialist**, `legal`→Policy/Legal
  Research (optional), `content-marketing`→fold into Content, `i18n`→Localization.
- **Skills (drop):** `cmmc`, `dora`, `dpdpa`, `eu-eprivacy`, `eu-nis2`, `fedramp`,
  `gdpr-compliance`, `iso*`, `nist-*`, `pci-*`, `swift-csp`, `soc2`, `content-compliance-audit`,
  `help-article-authoring`, + all regulatory/help skills. (Optional future "domain packs.")
- **Scripts (drop):** `help/**`, `build-vn-banking-form-sections.mjs`, `seed-forseti-api-key.ts`,
  `check-i18n-completeness.*`, `lint-vi-narrative.mjs`, `strip-14-locale-help-content.py`,
  `regen-taxonomy-registry.mjs`, `migrate-pack-fields-to-locale-maps.py`,
  `audit-pack-locale-coverage.py`, `populate-platform-integration.mjs`, `build-runtime-skills.ts`.
- **Hooks (drop):** `forseti-brand-purity.sh` (replace w/ generic copyright hook),
  `help-emit-check.sh`, `i18n-stub-detector.sh`, `lint-vi-narrative`, ComplianceOne
  sprint-spec hooks (review).
- **Wholesale:** `spawn-requests-archive/**`, `memories/closed/**` (Forseti plans),
  root `packs/**`, and the entire ComplianceOne app `src/**` (except the relay extraction
  + the `agent-lobby` module, which is *ported*, not run — see §9).
  *(Correction: the `scheduled/` **engine is KEPT** — §7a — it is generic Agent OS
  scheduling used by the Panel; only its ComplianceOne state/prompt refs are reset.)*

### 7d. NEVER TOUCH
- **Everything under `grc-suite-test/`** (read-only source) and any AesirX production repo.
- No symlinks/submodules/scripts that write back to `grc-suite`.
- No parent-directory-level commands that could touch both repos.

**Files to preserve exactly to keep the Claude CLI flow working (Open Q#10):**
`relay-server.ts` (with the 2 type imports localized + de-branded), `agent-os-panel-server.ts`
(relay path repointed), all of `agent-os-panel/**`, and the `relay` / `agent-os-panel` /
`agent-os-panel-tray` npm scripts + deps (`ws`, `@anthropic-ai/claude-agent-sdk`, `tsx`).

---

## 8. Runtime Adapter Compatibility Matrix (charter §21.8)

> Capability cells for non-Claude runtimes are **provisional** and must be confirmed in
> each Phase-5 discovery spike against the live docs in charter §23 before coding.

| Runtime | Phase | Install/Auth | Interactive | Headless | JSON/NDJSON | Resume | MCP | Status |
|---|---|---|---|---|---|---|---|---|
| **Claude CLI / Code** | 4 | Claude Max login / API key | ✅ | ✅ | ✅ | ✅ | ✅ | **Working today** (relay) → adapter |
| **Codex CLI** | 5 (1st) | `npm i -g`; OpenAI auth | ? | likely | likely | ? | ? | PoC target |
| **OpenCode** | 5 | per docs | ? | ? | ? | ? | ? | Spike |
| **Cursor CLI** | 5 | Cursor auth | ? | ? | ? | ? | ? | Spike |
| **Hermes Agent** | 5 | Nous auth | ? | ? | ? | ? | ? | Spike (after discovery) |
| **OpenClaw** | 5 | per docs | ? | ? | ? | ? | ? | Spike (after discovery) |
| **OpenAI-compatible API** | 6 | BYOK | n/a | ✅ | ✅ | n/a | tool-use | Provider adapter |
| **Anthropic-compatible API** | 6 | BYOK | n/a | ✅ | ✅ | n/a | tool-use | Provider adapter |

**Adapter acceptance (charter §12):** feature-flagged; missing runtime → panel explains
install; one adapter's failure never breaks the panel; relay protocol stays stable.

---

## 9. Lobby Platform Plan (charter §21.9)

**Source basis — what the Vercel swarm app clones (Ronni's directive):** the **Panel is the
reference lobby implementation**. Port from:
(a) backend `src/backend/src/modules/agent-lobby/**` — 7 files: `lobby-coordinator.ts`,
`lobby-message-service.ts`, `lobby-request-service.ts`, `lobby-session-service.ts`,
`lobby-task-service.ts`, `relay-lobby-bridge.ts`, `routes.ts`;
(b) panel-server lobby client — `discoverLobbyId`, `lobby-register`/`lobby-heartbeat`
(25 s send / 90 s stale) over `/api/v1/agent-lobby/ws/agent`, `LOBBY_STATE_FILE`,
`localLobbyAgents` map, + `tabs/lobby.js` (256 L);
(c) the relay's lobby client; (d) protocol in `LOBBY-PROTOCOL.md` + `lobby-*.sh`.
The independent platform reimplements this cleanly in `packages/lobby-server` (durable)
and **`apps/lobby-web` (Vercel remote swarm mode)**, keeping the Panel as a first-class
client of the new lobby URL.

- **Hosting (Open Q#5):** `apps/lobby-web` = **Next.js on Vercel** for control-plane REST
  (create/join/roster/messages/tasks) + **SSE** for fan-out. **Do not rely on Vercel
  in-memory function state or WS** (WS is beta — charter §10). Ship a **portable Node WS
  server** fallback (`packages/lobby-server` standalone) for low-latency floor control.
- **Durable store (Open Q#6):** **Upstash Redis** first (serverless-friendly: roster,
  presence, message stream, task queue, identity bindings), with optional Postgres
  (Neon/Supabase) for the durable **event log** (private accountability, charter §19).
- **Schemas:** implement charter §10 types (`Lobby`, `AgentParticipant`,
  `ConcordiumAgentRef`, `LobbyMessage`) in `packages/protocol-core`.
- **Capabilities:** create/join/leave/list/send/broadcast, appoint boss, hand-raise, floor
  control, task create/handoff, identity verify, invite/allowlist, public/private switch,
  session persistence, abuse controls, event log.
- **Security (charter §10/§19):** boss/floor enforced **server-side**; private lobbies deny
  unverified agents; public lobbies rate-limit; messages lobby-scoped; **no secrets/keys in
  lobby**; display name ≠ identity.

---

## 10. Concordium Agent Registry Integration Plan (charter §21.10)

> **Must verify before coding** (charter §11/§23): Agent Registry ref, CIS-8004, CIS-8,
> Agent Card format, MCP service, indexer, Concordium JS SDK.

- **Fastest safe path (Open Q#7):** **read-only verification via indexer/API first**
  (look up a registry reference, return verified/failed/pending). Use the JS SDK for Agent
  Card **hashing/integrity** only. **Defer on-chain writes**; registration is
  user-driven/wallet-side. This keeps Agent OS free of private keys entirely.
- **Identity Agent** (new, §11-roster): explains setup, drafts + validates Agent Card,
  links local profile ↔ registry ref, prepares (not submits) registration payloads.
- **Agent Card schema** (charter §11): name, description, capabilities, runtime, owner
  policy, optional contact URL, supported protocols, allowed scopes, version, timestamps,
  hashable content — **no secrets.**
- **Private-lobby policy ladder:** none → any registered → allowlisted → verified
  human-link → (future) org-link. Roster shows: unverified / registry-verified /
  human-linked / org-linked / failed.
- **Privacy principle (charter §11):** accountability, not doxxing — verify the anchor
  without exposing the human identity to every participant.

---

## 11. `/train [agent]` Plan (charter §21.11)

- **Syntax:** `/train [agent-slug]` (+ future `--source`, `--skill`, `--pack`, `--mode
  append|review`, `--dry-run`).
- **Inputs:** Markdown, text, code, API docs, patterns, checklists, playbooks, skill dirs,
  JSON/YAML packs.
- **Output tree** (charter §9):
  `agent-os/training/{inbox,reviewed,rejected,packs}` +
  `sub-agents/skills/trained/[slug]/[skill]/{SKILL.md,references/,metadata.json}` +
  `memories/trained/[slug]/{diary.md,facts.jsonl}`.
- **Safety (charter §9):** never overwrite core rules; trained content separated from core;
  source metadata + dates; explicit review→activate; reversible packs; **secret detection**
  rejects files with keys/tokens/passwords/`.env`; never train base agents on proprietary
  AesirX/ComplianceOne material.
- **Storage (Open Q#8):** trained packs **user-local by default** (gitignore
  `training/inbox`, `training/reviewed`, `memories/trained/`, `skills/trained/`); explicit
  opt-in to commit a reviewed pack. Core distribution ships **empty** training scaffolding.
- **Acceptance:** `--dry-run` shows planned writes only; deterministic skill paths;
  unrelated agents untouched.

---

## 12. UI Assist Integration Plan (charter §21.12) — confirmed in-scope

- **Packages:** `ui-assist-core` (transport/event contract/session) + `ui-assist-embed`
  (script tag) first; `ui-assist-react` / `-next` / `-vue` later. (Open Q#9: **repo-local
  embeddable script first**, npm publish at Phase 9/10.)
- **Integration Agent** (new): detects target project type; emits embed
  script/component scaffolding; install checks; event contract; secure connect to local
  panel/relay or remote lobby; theming.
- **Framework targets:** plain JS, React, Next.js, Vue, Svelte, Laravel/Blade, WordPress,
  Joomla.
- **Safety (charter §14):** UI Assist cannot edit a project without explicit permission;
  file/route awareness only where the user allows; product-neutral copy (de-brand the relay
  system prompt + any ComplianceOne UI strings).
- **Relay reuse:** the extracted, de-branded relay already implements the browser↔Claude
  bridge — UI Assist embeds connect to it (local) or to the lobby (remote).

---

## 12A. Work-Item Model Standardization — Phase / Sprint / Task (confirmed Panel defect)

**Ronni's hunch is correct and broader than the Gantt.** The Panel today has **no shared
schema** for Phase / Sprint / Task — five surfaces each invent their own, and the Gantt
compensates with a multi-syntax guesser. Evidence (read-only, from `grc-suite-test`):

| Surface | Task identity | Status vocabulary | How it reads/writes |
|---|---|---|---|
| **Gantt** `getGanttData()` `agent-os-panel-server.ts:829-1085` | `{title, done}` — **no id** | `complete / in-progress / planned / unknown` | **Reads 7 task formats in priority-fallback order** (checkbox `:959`, numbered `:968`, AC table `:982`, sub-sprint table `:1000`, issue table `:1013`, `## Epic` `:1028`, `### Step` `:1038`) + **3 status formats** (README `Status:` `:864`, `\| Status \|` table `:945`, `> Status:` blockquote `:947`); **fabricates** `done=true` for all tasks when the sprint is "complete" `:1048` |
| **Tasks store** `/api/tasks` → `shared-memory/tasks.jsonl` | `TASK-{ts}-{n}` (`nextTaskId`) | `pending / in_progress / done / failed / blocked` | JSONL append; also mirrors lobby tasks |
| **Sprint planner** `tabs/sprint.js` | `st-{ts}-{rand}` — **no status** | none | Ephemeral client state; on "execute" it (a) POSTs store tasks (`category:'sprint'`) **and** (b) emits a **free-text `# Sprint Plan` markdown** to the boss agent via `/api/messages`; new phase = a *prose instruction* to `mkdir docs/product/phases/phase-N/` |
| **Lobby tasks** | `task_id` | lobby set | mirrored into `tasks.jsonl` |
| **UI Assist / relay** `relay-server.ts:836+` | consumes lobby `task_id`, `updateTaskProgress()` | progress strings | system prompt hardcodes the `phase-N/sprint-X.Y.Z.md` convention as prose |

**Consequences:** (1) a task created in the Sprint planner becomes a store task + a prose
line to the boss, but **never a checkbox in the sprint markdown**, so it never appears under
its sprint in the Gantt; (2) three status vocabularies don't map; (3) phase/sprint-id parsing
(`phase-N`, `\d+\.\d+\.\d+`) is duplicated in panel-server *and* `sprint.js`; (4) the parser
*guesses*, so the same file renders differently depending on which pattern matches first.

### The Standard (one schema, written once, read everywhere)

1. **Canonical types in `packages/protocol-core`** — `Phase`, `Sprint`, `Task`, and a single
   `WorkItemStatus = 'planned' | 'in_progress' | 'blocked' | 'complete' | 'cancelled'`.
   Imported by **all five surfaces**: panel UI, panel-server, relay/UI Assist, lobby-server,
   and the Vercel swarm app. Single source of truth.
2. **One on-disk format** (kills the 7-syntax guesser):
   - **YAML front-matter** on `phase-N/README.md` (`id, name, status`) and
     `sprint-X.Y.Z.md` (`id, title, phase, status, owner`).
   - **One task syntax** — GitHub checkboxes under a required `## Tasks` / `## Acceptance
     Criteria` heading: `- [ ] AC-1: <title> {id, assignee, priority}`. The other six read
     paths are **deleted from the live reader**.
3. **One reader, one writer:**
   - **Reader** = a single `parseWorkItems()` in `protocol-core`; `getGanttData` collapses to
     call it. The legacy 7-format parser survives **only** inside a one-time migration codemod.
   - **Writer** = the Sprint planner + new `POST /api/phases` and `POST /api/sprints` write
     canonical front-matter + checkboxes to disk (instead of only messaging the boss).
4. **Unify task identity & linkage:** one `Task { id, status, priority, assignee, phaseId,
   sprintId }`. Gantt's `{title, done}` becomes a projection (`done = status==='complete'`).
   Markdown checkboxes carry the same `id` as the `tasks.jsonl` record, so a task shows under
   its sprint in the Gantt **no matter where it was created** (Tasks tab, Gantt menu, Sprint
   planner, lobby, or UI Assist).
5. **Enforcement:** extend the existing `lint-sprint-spec.sh` (Gate -2) and
   `lint-sprint-contract.sh` (Step A) to validate front-matter + the single task syntax; add a
   `validate-work-items` pre-commit hook + CI gate; surface a "schema drift" indicator in the
   panel. A `migrate-work-items` codemod upgrades any legacy specs on import.
6. **Reflected in UI Assist (Ronni's requirement):** the relay system prompt references the
   canonical schema/format (not freeform prose), and UI Assist task coordination + the
   embeddable overlay create/read the same `Task` records.

### Authoring skills — the missing "create" layer (Ronni's suggestion: **yes, do this**)

The roster already has skills for every step **except creation**:
`implementation-planning` + `sprint-decomposition` (break down), `spec-linting` (validate),
`sprint-gate-enforcement` / `verification-gate` (gate), `task-routing` (assign),
`agent-task-execution` (execute). The `planning` agent authors specs from **SPRINTS.md prose
+ a validate-*after*-the-fact linter** — there is **no skill that owns how to *create* a
Phase / Sprint / Task in the canonical schema.** That gap is exactly why the on-disk format
drifted into 7 syntaxes. Adding authoring skills closes the **author → validate → read** loop:

| New skill | Owns the rules for | Emits / enforces |
|---|---|---|
| `create-phase` | New phase | `phase-N` id rule, `README.md` front-matter (`id, name, status`), required phase sections |
| `create-sprint` | New sprint | semver `X.Y.Z` id, `sprint-X.Y.Z.md` front-matter (`id, title, phase, status, owner`), required contract sections (Goal / ACs / Out-of-Scope / Dependencies — same checks `lint-sprint-contract.sh` already verifies), the single `## Tasks` checkbox syntax |
| `create-task` | New task | canonical `Task { id, status, priority, assignee, phaseId, sprintId }`, the one checkbox form, valid `WorkItemStatus` |

(Ship as one layered `work-item-authoring` SKILL.md with three sections if you prefer fewer
skills — same contract either way.) Properties that make this the right fix:

- **Self-enforcing standard:** every creator (the `planning`/Planning Orchestrator agent, the
  Gantt "Create Task" menu, the Sprint planner, the **Training Agent**, **UI Assist**'s
  "add to sprint plan" path) calls the **same authoring contract** and writes the exact format
  the single `parseWorkItems()` reader expects — no more guessing.
- **Runtime-agnostic:** skills are plain instructions, so Codex / OpenCode / Cursor agents
  (§8) follow the identical creation rules through their adapters.
- **Pairs with, not replaces, the linter:** authoring skills write it right; `spec-linting`
  verifies it; the `validate-work-items` hook (item 5) blocks drift at commit.

These skills are added in **Phase 2** (roster) and wired to the writer endpoints in **Phase 4**.

### Where it lands in the phases
- **Authoring skills** (`create-phase` / `create-sprint` / `create-task`) → **Phase 2** (roster).
- **Schema + `protocol-core` types** → **Phase 4** (protocol-core is created there).
- **Panel reader/writer unification + migration codemod + linter extension** → **Phase 4**
  (dedicated task, alongside the relay/adapter extraction).
- **Lobby + Vercel swarm app consume the same schema** → **Phase 7**.
- **UI Assist alignment** → **Phase 9**.

The independent fork **ships the standard from day one** — it does not inherit the
multi-syntax guesser; the 7-format reader exists only as a migration aid.

---

## 13. Testing & Verification Plan (charter §21.13, §18)

```bash
npm install && npm run typecheck && npm run lint && npm test
npm run agent-os-panel -- --no-relay        # panel only
npm run agent-os-panel                       # panel + relay (local mode)
```
- **Per-phase manual QA (charter §18):** panel opens; local mode starts; relay auto-starts;
  agent joins roster; Messages/Tasks/Lobby tabs update; swarm mode accepts new lobby URL;
  invalid URL fails gracefully; adapter detection shows missing runtimes; training dry-run
  writes nothing unexpected; private-lobby identity failure is visible.
- **Grep gates (must be clean / justified):**
  ```bash
  grep -RniE "AesirX|ComplianceOne|complianceone\.demo|grc-suite|Forseti" . \
    --exclude-dir=.git --exclude-dir=node_modules
  grep -RniE "PDPL|DPIA|TIA|MPS|DSR|DSAR|Vietnam|Decree" agent-os agent-os-panel docs packages apps \
    --exclude-dir=.git --exclude-dir=node_modules
  ```
- **New CI hooks:** copyright-header check + the two grep gates run on every commit.

---

## 14. Risks & Mitigations (charter §21.14)

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Accidental write to `grc-suite-test` | Low | **Critical** | Boundary check every phase; all writes absolute-pathed to `agent-os-protocol`; no parent-dir commands; read-only discipline |
| R2 | Relay type extraction breaks Claude flow | Low | High | Port `LobbyToAgentMessage`/`HandRaiseCategory` to `protocol-core`; smoke-test relay after Phase 1 *and* Phase 4 |
| R3 | Forking generated artifacts re-imports 1000s of refs | Med | Med | **Never fork** graphs/observations/state — regenerate (§7b) |
| R4 | Missed branding/copyright slips into release | Med | Med | grep gates + copyright hook in CI; `MIGRATION.md` whitelists documented history only |
| R5 | Vercel WS beta blocks real-time lobby | Med | Med | SSE + durable Redis; portable Node WS fallback (§9) |
| R6 | Concordium scope creep / key handling | Med | High | Read-only indexer verification first; **no keys** in Agent OS; defer on-chain writes |
| R7 | Monorepo refactor destabilizes panel | Med | Med | Keep Phase 1 minimal; introduce `packages/` only at Phase 4; preserve npm scripts |
| R8 | Apache-2.0 notice/attribution compliance | Low | Low | **License locked: Apache-2.0**; `LICENSE`+`NOTICE` added Phase 1; retain third-party notices; SPDX headers enforced by CI hook |
| R9 | Dropping a skill/agent that was actually generic | Low | Low | Classification table reviewed before deletion; nothing deleted from source (drop = "don't copy") |

---

## 15. Exact First Sprint Recommendation (charter §21.15, §22)

**Sprint 0 — Independent Agent OS Protocol Planning & Boundary Lock** *(this sprint)*
- ✅ Repo confirmed; ✅ inventory + audit; ✅ `planning.md` + `IMPLEMENTATION-PLAN.md`
  written; ✅ `grc-suite` untouched; ✅ **license locked: Apache-2.0.** **Awaiting Ronni's
  approval to begin Sprint 1.**

**Then Sprint 1 — Isolation, Branding & Copyright Neutralization** (Phase 1 above):
the first *implementation* sprint, gated on approval. Deliverables: extract
copy-then-neutralize set, apply Gothar.dk copyright + chosen license, configurable lobby
URL + `.env.example`, de-branded relay, new README/CLAUDE/MIGRATION, **panel + Claude
relay verified working**, grep gate clean.

---

## 16. Answers to the 10 Open Questions (charter §20)

1. **Full copy or panel-only?** Neither — **empty repo, no commits.** Fork = curated
   extraction from `grc-suite-test/agent-os/**` + relay.
2. **Relay location?** `src/backend/src/modules/ui-assist/relay-server.ts` (moved into the
   backend module); self-contained except 2 type-only imports.
3. **Simple Node or monorepo?** **npm-workspaces monorepo**, introduced *incrementally*
   (minimal Phase 1 → `packages/`+`apps/` from Phase 4).
4. **First adapter after Claude CLI?** **Codex CLI.**
5. **Minimal Vercel lobby?** Next.js REST + **SSE** + durable Redis; **no** reliance on
   Vercel WS/in-memory state; portable Node WS fallback.
6. **Durable store first?** **Upstash Redis** (state/presence/queue) + optional Postgres
   (event log).
7. **Fastest registry verification?** **Indexer/API read-only** first; SDK for card hashing;
   defer on-chain writes.
8. **Trained packs committed/ignored/local?** **User-local by default** (gitignored);
   explicit opt-in to commit reviewed packs; core ships empty scaffolding.
9. **UI Assist npm now or repo-local?** **Repo-local embeddable script first**, npm at
   Phase 9/10.
10. **Files to preserve for Claude CLI flow?** relay (types localized + de-branded),
    `agent-os-panel-server.ts` (relay path repointed), all `agent-os-panel/**`, and the
    `relay`/`agent-os-panel`/`agent-os-panel-tray` scripts + deps.

---

## 17. Confirmations Requested From Ronni Before Implementation

1. **Approve this plan** (or request changes) — implementation starts only after approval.
2. Anything to **keep** that §7c currently drops (e.g., keep a generalized "compliance"
   skill as an optional domain pack)?

*License is decided (Apache-2.0) — no longer an open question.*

*No changes have been made to `grc-suite-test`. Only `planning.md` and this file have been
added to `agent-os-protocol`.*
