# MEMORY — Agent OS Protocol Memory Index

> **Last updated:** 2026-04-27
> **Purpose:** Memory index and retrieval rules. Pointers to detailed memory files.
> **Precedence:** See RULES.md → Precedence Hierarchy.

---

## Loading Layers (Sprint 46.6.0)

Every agent prompt has a predictable token budget per loading layer. Read top-down,
stop at the first layer that answers the question.

| Layer | Budget | Source | Loaded by |
|---|---|---|---|
| **L0 — Identity** | ≤ 150 tokens | Hard-coded preamble in `CLAUDE.md` (project intro + precedence pointer) | Always |
| **L1 — Essential story** | ≤ 800 tokens | `RULES.md` summary + `ETHICS.md` core + the first ~400 tokens of `INDEX.aaak` | SessionStart hook (`agent-os/scripts/hooks/session-context-hook.sh`) |
| **L1 — Sub-agent recall** | ≤ 200 lines | `agent-os/sub-agents/<name>/diary.md` (Sprint 46.6.2 — short, persistent recall corpus per agent) | Spawn-prompt template (`SUB-AGENTS.md`) |
| **L2 — On-demand** | ≤ 500 tokens / file | A specific `agent-os/memories/<file>.md` or `agent-os/sub-agents/<name>/lessons/<sprint-id>.md` opened **by anchor** from `INDEX.aaak` | Agent decision during a task |
| **L3 — Deep search** | unbounded | `grep` / Explore agent over the full repo | Agent decision when L2 misses |

**Rule:** read L0 + L1 by default. Open L2 only after consulting `INDEX.aaak` —
never scan a memory file directly without checking the index first. If the literal
scan misses (cross-language paraphrase, synonym, or different framing of the same
concept) **and** `MEMORY_SEMANTIC_RECALL` is set to `on` or `byok`, fall back to
the semantic recall escape hatch documented below before reaching for L3:

```bash
bash agent-os/scripts/embeddings-recall.sh "<query>" --top 5
# add --corpus index or --corpus diaries to narrow
```

Treat the top results as candidate anchors — open the underlying L2 file by `ref`
the same way you would for a literal hit. Fall back to L3 (`grep` / Explore agent)
only when both literal scan and semantic recall return nothing relevant.

`INDEX.aaak.jsonl` is the committed source of truth (`{topic, entities, ref, scope, updated}` per line).
`INDEX.aaak` is a generated, gitignored, compressed pointer view (`topic|→ref` per line).

Regenerate with:

```bash
bash agent-os/scripts/build-memory-index.sh
```

A pre-commit guard (`agent-os/scripts/hooks/memory-index-staleness.sh`, wired from
`.husky/pre-commit`) refuses commits that edit a memory file without regenerating
`INDEX.aaak.jsonl`.

### Docs Index — `docs-index.aaak.jsonl`

Companion index pointing at slow-changing reference content under `docs/`,
separate from the institutional-knowledge `INDEX.aaak.jsonl`. Same record
shape (`{topic, entities, ref, scope, updated}`) so the same retrieval
protocol applies — scan first, open by anchor.

| Aspect | INDEX.aaak.jsonl | docs-index.aaak.jsonl |
|---|---|---|
| Corpus | `agent-os/memories/`, sub-agent lessons + diaries | Allow-listed overview docs in `docs/content/` |
| Scope values | `global`, `sub-agent:*` | `doc:content` (extensible per docs/ subdir) |
| When to consult | Decisions, lessons, playbooks, gotchas | Module overviews, persona/use-case maps, regulatory framework summaries, sector overlay plans |
| Regenerate | `bash agent-os/scripts/build-memory-index.sh` | `node agent-os/scripts/build-docs-index.mjs` |

Allow-listed docs (Sprint 46.7.0):

- `docs/content/modules-overview.md` + `.vi.md`
- `docs/content/module-reference.md`
- `docs/content/personas-and-use-cases-overview.md`
- `docs/content/vn-regulatory-frameworks.md`
- `docs/content/maturity-phase-module-feature-additions.md`
- `docs/content/sector-overlay-plans.md`

Sprint specs, release notes, and per-module deep-dives are intentionally
excluded — too volatile and too detailed for L2 lookup. Add new docs by
extending the `DOCS` array in `agent-os/scripts/build-docs-index.mjs`.

---

## Facts Layer (Sprint 46.6.1)

Rule supersession, phase status changes, and other "what was true on which day"
facts live as structured triples in `agent-os/facts.jsonl` — one JSON object per
line, append-only, committed.

### Schema

```json
{"id":"f_<sha-prefix>","subject":"R-33","predicate":"supersedes","object":"R-12","valid_from":"2026-04-12","valid_to":null,"confidence":1.0,"source_file":"agent-os/RULES.md","sprint":"46.0.0","extracted_at":"2026-04-27T12:34:56Z"}
```

- `id` is deterministic — `f_` + sha256 of `subject|predicate|object|valid_from` truncated to 16 chars. Re-recording the same fact appends nothing.
- `valid_to: null` means *currently true*. Invalidating a fact appends a new line with the same id and `valid_to` set; readers fold history by latest `extracted_at`.

### When to write

- A new R-* rule is introduced, deprecated, or superseded.
- A phase changes status (active → delivered).
- A decision recorded in a sprint retro is structurally queryable ("X was changed to Y", "rule N now means Z").

### When to invalidate

Append a new line with the same triple but `valid_to` set. **Never edit an existing line** — JSONL is append-only so merges are line-additive.

### How to query

```bash
bash agent-os/scripts/facts-query.sh subject:R-33                       # all current facts about R-33
bash agent-os/scripts/facts-query.sh subject:R-12 --as-of 2026-04-11    # R-12 as it was on that date
bash agent-os/scripts/facts-query.sh predicate:supersedes               # every supersession
bash agent-os/scripts/facts-query.sh object:R-12                        # everything pointing at R-12
```

### How to append

```bash
bash agent-os/scripts/facts-append.sh "<subject>|<predicate>|<object>|<valid_from>[|<valid_to>]" \
  --source <file> --sprint <id>
```

### Source of truth

`agent-os/facts.jsonl` is the **only** authoritative store. The Pre-Plan
spec scoped a sqlite derived cache (`agent-os/facts.sqlite3`); 46.6.1 ships
without that cache because the corpus (~60 facts at seed) makes a JSONL scan
sub-millisecond and a native `better-sqlite3` dependency adds Windows install
friction. The JSONL format is forward-compatible: a future sprint can derive
a sqlite cache from the same file without changing any caller. Until then,
`agent-os/scripts/facts-rebuild.sh` validates the JSONL and prints row counts.

### Concurrency

Two devs running `facts-append.sh` in parallel produce two JSONL lines locally.
On push, the merge is line-additive — git resolves it without conflict because
the file is append-only. Same-content appends are deduped by content equality
(not just id), so re-running the seed script is a no-op.

---

## Semantic Recall (optional, Sprint 46.6.6)

Optional layer over INDEX.aaak + per-agent diaries. **Default OFF.** Only enable
if literal substring search in the Panel + INDEX scan proves insufficient — the
46.6.6 spec ships with an explicit kill-switch noting this is the sprint most
worth abandoning.

### Feature flag

`MEMORY_SEMANTIC_RECALL` — three values:

| Value  | Behavior |
|--------|----------|
| `off`  (default) | Scripts exist but no embedder runs. SessionStart and spawn-prompt paths never call recall. INDEX literal scan stays unchanged. |
| `on`   | Local zero-dep **TF-IDF** embedder. Deterministic; computes term-frequency × inverse-document-frequency over INDEX entries + non-placeholder diaries. Cosine similarity for ranking. |
| `byok` | Bring-your-own external embeddings API. Requires `MEMORY_EMBEDDING_PROVIDER` (URL) + `MEMORY_EMBEDDING_API_KEY` (bearer). POSTs `{input}` and projects `data[0].embedding` (OpenAI-compatible). **Fails fast** when keys are missing — never falls back to local. |

### CLI

```bash
bash agent-os/scripts/embeddings-rebuild.sh             # walks corpus, writes embeddings.json
bash agent-os/scripts/embeddings-recall.sh "query"      # top-5 across both corpora
bash agent-os/scripts/embeddings-recall.sh "query" --corpus index --top 10
```

### Storage

- `agent-os/embeddings.config.jsonl` — committed; one line per (corpus, model). A model upgrade triggers a deterministic rebuild.
- `agent-os/embeddings.json` — gitignored derived cache (per-machine, ≤ ~80 KB at current corpus size).

### When to enable

Enable when literal scan misses cross-language paraphrase or synonym matches —
e.g., a query for "race conditions" should surface a memory titled "TOCTOU /
atomic upsert" even though the literal terms differ. If literal scan suffices,
keep `off`: the substrate is forward-compatible and you can flip on later
without reformatting any corpus.

---

## Orchestrator Pickup (Sprint 46.6.8)

The 46.6.2 / 46.6.7 spawn-request queue is consumed by

```bash
bash agent-os/scripts/process-spawn-requests.sh
```

For every `post-sprint-memory-<sprint>.json` in `.claude/spawn-requests/`, the
processor:

1. Runs `git log <merge-base>..<head>` and `git diff --name-only <merge-base>..<head>`
2. Maps each changed file to one or more agent slugs via a static
   `fileToAgents` table (e.g. `src/backend/` → `[backend]`,
   `src/frontend/__tests__/` → `[test, frontend]`, `agent-os/RULES.md` →
   `[documentation, planning]`)
3. Appends a one-paragraph entry to each affected agent's `diary.md` with a
   `## YYYY-MM-DD — Sprint <id>` header
4. Emits `{subject:"Sprint <id>", predicate:"completed_at", ...}` via
   `facts-append.sh`
5. If any diary exceeds the 200-line cap after the write, runs `rolloverDiary`
   — moves the oldest entries verbatim to `lessons/<sprint>.md`, keeps the
   most-recent 5 + the `## Earlier (summarised)` block at the head of
   `diary.md` (replaced, never stacked — 46.6.7B contract)
6. Moves the request to `.claude/spawn-requests/consumed/<file>.json` with
   `processed_at` + `diary_writes` + `rollovers` + `fact_emitted` fields
   stamped in for forensics

The processor is **deterministic** by default — no LLM call. A future
LLM-bound orchestrator (Agent OS Panel / boss-agent) can swap the baseline
without changing the processor's interface; the diary-entry format and
fact-emission contract are stable.

`MEMORY_DIARY_SUMMARISE`:
- `off` — rollover writes a "see lessons/<sprint>.md" pointer
- `on` (default) — same pointer; an LLM-bound orchestrator may replace the
  `## Earlier (summarised)` section with a real summary later
- `byok` — best-effort POST to `MEMORY_EMBEDDING_PROVIDER` (the same env vars
  as semantic recall) for an inline summary; falls back to the deterministic
  pointer on failure

Wired into `SPRINTS.md` Step E.9 Part C as the second-stage close-out call.

### Auto-trigger paths (Sprint 46.6.9)

The processor runs without manual intervention via two paths:

1. **`.husky/post-merge`** — fires after every merge into the local working copy (incl. `git pull` fast-forwards). Skipped when the merge brought in zero commits. Idempotent — only pending requests get processed.
2. **`agent-os/scheduled/process-spawn-requests-daily.sh`** — daily fallback for environments where husky doesn't fire (CI, server, fresh clones). Mondays additionally run `archive-consumed.sh --age-days 30` to compact the consumed/ directory into `agent-os/spawn-requests-archive/<year-month>.jsonl`.

Both paths share the same processor logic and are deterministic — no per-sprint API cost. BYOK and `--with-task` interactive paths remain explicit opt-ins.

### consumed/ retention

`agent-os/scripts/archive-consumed.sh [--age-days N]` (default 30) collapses old consumed-marker files into a monthly JSONL archive. Idempotent — files already archived are not re-touched. The Panel **Activity** sub-tab reads from both locations.

### Diaries are indexed (Sprint 46.6.9)

`build-memory-index.mjs` walks every `agent-os/sub-agents/<name>/diary.md` for non-placeholder content. Diary entries get scope `sub-agent:<name>:diary` in INDEX.aaak.jsonl, so the Panel Index sub-tab + semantic recall both find them. Placeholders are skipped.

---

## Diary Routing & Rollover Summarisation (Sprint 46.6.7)

Two diary lifecycle improvements that share the same rollover plumbing.

### Cross-agent diary routing (Part A)

`agent-os/sub-agents/diary-routing.yaml` declares which peer diaries each
agent reads. The orchestrator runs

```bash
bash agent-os/scripts/render-spawn-prompt.sh <agent-slug>
```

to produce the rendered Diary + Routed Diaries L1 block. Default behaviour
(no routing entry) renders only the agent's own diary. Total Diary +
Routed Diaries token count never exceeds the **800-token L1 budget** from
Sprint 46.6.0 — the agent's own diary is never truncated to make room for
peers; oldest peer entries are truncated first.

Routing config is hand-curated and versioned. Lint-housekeeping rejects
typo'd agent names. `boss-agent: "*"` injects every agent's diary
truncated to the budget — use sparingly.

### Rollover auto-summarisation (Part B)

When `post-sprint-memory.sh` triggers a rollover (diary > 200 lines), the
orchestrator-spawned documentation agent:

1. Moves the evicted entries verbatim into the most recent
   `lessons/<sprint>.md` (the 46.6.2 mechanical contract).
2. Summarises the evicted entries into ≤ 5 bullet points using the cheapest
   capable model (Haiku family per current routing) and prepends the result
   as a `## Earlier (summarised)` section at the head of `diary.md`,
   **replacing** any existing such section (never stacking).

Cost guards (encoded into the spawn-request payload):
- One summarisation call per agent per rollover
- ≤ 4 KB of evicted entries fed to the summariser; if more, truncate to the
  most recent 4 KB and note "(older entries omitted from summary; see
  lesson file)"
- 10s timeout — on failure, fall back to pure mechanical rollover

Feature flag: `MEMORY_DIARY_SUMMARISE` — default ON. Set `off` to restore
pure 46.6.2 mechanical rollover. The verbatim entries always move to the
lesson file regardless of the flag — summary is a derived view, never the
source of truth.

---

## Non-Negotiable Rules → [RULES.md](RULES.md)

All non-negotiable operational rules (19 rules with incident citations) have been consolidated in **[RULES.md](RULES.md)**. RULES.md is the canonical authority for rules — do not duplicate rules here.

---

## Detailed Memories → [/memories/](memories/README.md)

All detailed decisions, patterns, lessons, and playbooks live in `/memories/`. See the [README](memories/README.md) for the full categorized list.

## Sub-Agent System → [SUB-AGENTS.md](SUB-AGENTS.md)

The sub-agent orchestration system (35 specialized agents) lives in [SUB-AGENTS.md](SUB-AGENTS.md) and [sub-agents/](sub-agents/README.md). Sub-agent-specific memories live in [sub-agents/memories/](sub-agents/memories/README.md). See SUB-AGENTS.md for routing rules, parallelism constraints, and crash prevention strategies.

### Retrieval behavior (mandatory)

1. First read ONLY the first 5 lines (headers) across relevant memory files (or via INDEX)
2. Select the minimum set of files likely relevant
3. Only then read deeper into those chosen files

### When to create a new memory file

- Content is >~30 lines
- It's a repeated lesson, recurring decision pattern, or playbook
- It's a durable constraint (architecture principle, compliance rule)
- It's a "reference chunk" that should be independently retrievable

### When to update an existing memory file

- Same topic — adding detail or correcting it
- Refining the same decision or playbook

Never store transient details (one-off tasks, short-lived status updates) in memories.

---

## New Memory Files (Added 2026-03-21)

| File | Purpose | When to Read |
|------|---------|-------------|
| `memories/engineering-gotchas.md` | Non-obvious failure modes discovered across 58 sprints (20 gotchas with origin citations) | Before starting unfamiliar work — scan for relevant gotchas |
| `memories/context-window-strategy.md` | Context budget model, strategic compaction, model routing, crash prevention lessons | When planning session work or agent parallelism |
| `memories/instincts/` | Project-scoped learned behaviors (instinct files in YAML) | During sprint planning — check if relevant instincts exist |

## New Memory Files (Added 2026-03-26)

| File | Purpose | When to Read |
|------|---------|-------------|
| `sub-agents/memories/platform-mission-evidence-by-design.md` | Core platform mission: evidence as operational byproduct, five architectural principles, per-agent implications | Before any review, QA, validation, UX, testing, or compliance task |
| `sub-agents/memories/vn-regulatory-domain-knowledge.md` | Maps 8 Vietnamese laws/decrees to platform modules, defines 4 compliance building blocks, execution compliance model | Before planning/validating regulatory or compliance features |
| `sub-agents/memories/qa-finalization-phase22-lessons.md` | 628 QA findings across 246 pages: 7 systemic anti-patterns, Gate E12 rationale, evidence-by-design in ACs | Before sprint close-out or production readiness review |

## New Memory Files (Added 2026-04-11)

| File | Purpose | When to Read |
|------|---------|-------------|
| `memories/lessons-fix-sprint-marathon-20260411.md` | 10 lessons from the 7-sprint / 152-finding Scheduled QA queue marathon: no preemptive deferral, script-driven bulk cleanup, sentinel placeholder, CRLF awareness, depth-aware tag matching, stacked PRs, atomic TOCTOU upsert, 5-sprint checkpoint cadence, TranslationKeys propagation, parseCSV warnings | Before a multi-sprint queue marathon, before writing codemod scripts, before atomic upsert refactors |

---

*Last updated: 2026-04-11 (Added fix-sprint marathon 2026-04-11 lessons)*
