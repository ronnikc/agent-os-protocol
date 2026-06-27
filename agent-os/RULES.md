# RULES — Agent OS Protocol Operational Rules

> **Last updated:** 2026-06-21
> **Purpose:** Canonical location for all non-negotiable operational rules that apply to the main agent and all sub-agents at all times. This is the single authority on "what rules apply and in what order."
> **Ownership:** Main agent (orchestrator). Sub-agents may NOT modify this file.
> **When to update:**
> - New non-negotiable rule established from sprint lessons
> - Precedence hierarchy changes
> - Agent modification permissions change
> - Rule removed because it no longer applies (must document why)
>
> **Anti-drift rule:** Only update RULES.md when a rule is (a) established by a sprint lesson or incident, (b) approved by the user, or (c) required by a governance model change. Never add speculative rules. Every rule must cite its origin (incident number, sprint, or user directive).
>
> **Rule timeline (Sprint 46.6.1):** Rule supersession and introduction dates are also recorded in `agent-os/facts.jsonl` as structured triples. Use `bash agent-os/scripts/facts-query.sh subject:R-N` to see the timeline of any rule. The prose marker in the table stays for human readability — the *fact* is now also queryable.

---

## Precedence Hierarchy

When rules in different files conflict, resolve in this order (highest priority first):

| Priority | Source | Authority |
|----------|--------|-----------|
| 1 | `docs/engineering/README.md` | Implementation source of truth — architecture, data model, API contracts |
| 2 | Current sprint spec / acceptance criteria | Definition of done for active work |
| 3 | **RULES.md** (this file) | Non-negotiable operational rules |
| 4 | **CLAUDE.md** | Repo operations, build commands, code patterns |
| 5 | **ETHICS.md** | Quality commitment, accountability standards, escalation guidance |
| 6 | **SUB-AGENTS.md** + **sub-agents/** | Agent system, routing, verification |
| 7 | **SPRINTS.md** | Sprint process, execution order, close-out |
| 8 | **STATE.md** | Current implementation state (informative, not normative) |
| 9 | **ARCHITECTURE.md** | System architecture summary (informative, not normative) |
| 10 | **SOUL.md** | Voice, tone, working style |
| 11 | **README.md** | Informative only, never normative |

**Conflict resolution procedure:**
1. Identify the two conflicting sources
2. Apply the priority table above — higher priority wins
3. If both sources have equal priority, the more specific rule wins
4. If ambiguity remains, ask the user before proceeding
5. After resolution, update the lower-priority source to eliminate the conflict

---

## Non-Negotiable Rules (Always Active)

These rules apply to every session, every sprint, every agent invocation. No exceptions unless the user explicitly overrides.

### Build & Compilation

| # | Rule | Origin |
|---|------|--------|
| R-01 | **Build order is sacred:** shared → backend → frontend. Shared must build first. | Architecture constraint |
| R-02 | **Zero tolerance for "pre-existing" errors.** No TypeScript compilation error, missing dependency, or broken import may be dismissed as "pre-existing." If it exists, it is today's problem. | Sprint 12.3.0, enforced by Build Integrity Specialist |
| R-03 | **Tests must pass for modified modules BEFORE committing.** `tsc` verifies types; `vitest` verifies behavior. Both are required. A commit that passes `tsc` but breaks existing tests is a gate failure. | Sprint 22.7.0 — DashboardPage rewrite committed without running tests, causing 23 failures |

### Sprint Discipline

| # | Rule | Origin |
|---|------|--------|
| R-04 | **Plan before code.** Describe approach and wait for approval before implementing. | SOUL.md interaction protocol |
| R-05 | **>3 files changed = decompose first** — UNLESS the change is a single cohesive unit of work (one QA punch-list, one bug-fix sprint touching multiple call sites of the same fix, one i18n key rename across locales, one styling pass across sibling components). Decomposition is required when the task spans **independent concerns** that could ship separately; it is NOT required when one concern naturally touches many files. When in doubt, prefer one focused sprint over multiple sprints with no real content. | SOUL.md scope control; clarified 2026-04-28 after repeated over-decomposition proposals (e.g. proposing 5 separate sprints for one QA punch-list of CSS + i18n fixes) |
| R-06 | **Do not implement features from a later phase** unless explicitly directed. | Phase-gated development model |
| R-07 | **Every sprint must follow the Sprint Completion Gates** in SPRINTS.md. Code without doc updates is incomplete. | Sprint 20.1.0 — close-out repeatedly skipped |
| R-08 | **A sprint is not complete because it builds — it is complete because its acceptance criteria are met.** Gate E0 (Spec vs Ship Reconciliation) is mandatory. | Sprint 20.2.0 — 3 of 6 epics never implemented but sprint marked "Complete" |
| R-09 | **Sprint Completion Gate is mandatory and automatic.** The user should NEVER have to ask "did you update the README?" — these are blocking, not optional. Gate -1 must be completed BEFORE writing sprint code. | 33 sprints shipped without close-out in Phase 19 |

### Branch & PR Hygiene

| # | Rule | Origin |
|---|------|--------|
| R-35 | **Sprint branches must be git-stacked, not branched off main independently.** Pattern: when starting sprint N within the same session, branch from the previous sprint's local branch tip, not from main: `git checkout sprint/<N-1> && git checkout -b sprint/<N>`. The PR for sprint N still targets `main` directly — as N-1 merges to main, N's diff narrows to a clean delta against the new main. After each PR merges, rebase all downstream branches onto new main with `git rebase origin/main && git push --force-with-lease`. Only the very first sprint of a session branches from `origin/main`. **Why:** when each branch is independently created off main, every PR ends up with parallel changes to the same governance files (CLAUDE.md, STATE.md, phase-25/README.md, release-notes/README.md, RESUMPTION-PLAN.md) — sequential merge then forces 4 conflicts per PR (~30 minutes of manual reconciliation across a 5-PR batch). Stacked branches make each rebase mechanical because the chain is genuinely linear. | 2026-04-25 — discovered during 50.5.0 sprint kickoff inspection: PRs #1651–#1655 were all branched off `fb9ccd0d2` directly despite the "stacked PR" label in RESUMPTION-PLAN.md hard rule #5. Sequential merge required 4 conflicts per PR × 4 PRs = 16 manual resolutions on identical file regions. |

### Code Quality

| # | Rule | Origin |
|---|------|--------|
| R-10 | **Fix root causes, not symptoms.** Frontend filters that hide bad data are not fixes. | Sprint 15.4.0 |
| R-11 | **Verify field name contracts end-to-end.** Seed → service → API → frontend — any mismatch = a bug. | Bug-fix discipline playbook |
| R-12 | **No hardcoded user-visible strings.** Every string shown to the user must come from the i18n system. | Sprint 11.3.0 |
| R-36 | **Surgical scope.** Every changed line must trace to the user's request. Don't "improve" adjacent code, refactor unrequested patterns, "fix" formatting/comments not in scope, or delete pre-existing dead code without explicit ask. When your edits create orphans (unused imports/variables/functions that *your* changes made unused), remove them. The test: every changed line traces to the request. | SOUL.md craft discipline; recurring drive-by-cleanup pattern flagged in `lessons-fix-sprint-marathon-20260411.md` |
| R-37 | **No time-based effort estimates in sprint specs or PR descriptions.** Phrases like "~2 weeks", "~5 days", "~3 hours", "~10 working days", "~30 minutes" are forbidden in `docs/product/phases/**/sprint-*.md`, sprint workfiles, PR descriptions, and release notes. Why: AI-author estimates are systematically wrong by orders of magnitude — sprints estimated at 10 days complete in 30 minutes on BigMachine, and the inverse can also happen. The estimates have no predictive value but they trigger sprint executors to unnecessarily decompose into sub-sprints, gate work behind imagined deadlines, or skip steps to "stay on schedule." Allowed instead: structural decomposition signals (e.g. "decompose into N sub-agent batches", "checkpoint after each batch"), volume metrics (e.g. "~50K translation units", "37 forms", "322 hardcoded refs"), and complexity callouts (e.g. "Banking forms dominate the unit count"). The executor decides effort allocation. | User feedback 2026-04-28: BigMachine executor wasted time decomposing a "10-day" sprint that completed in 30 minutes; multiple sprint specs in PRs #1707/#1708 carried useless time estimates. |

### API & Frontend Contract (added Sprint 25.3.0 — Phase 17/19 postmortem)

| # | Rule | Origin |
|---|------|--------|
| R-22 | **API client URLs must be traced from routes.ts, never guessed.** Read `app.ts` mount point + `routes.ts` sub-path. Do not construct URLs from module names. | Phase 17 — 15+ modules had wrong API URLs → all calls returned 404 |
| R-23 | **Paginated responses must be unwrapped.** Backend returns `{ data, total, page, page_size }`. Frontend must use `response.data`, never treat the response object as an array. | Phase 17 — 6 modules had permanently empty tables |
| R-24 | **Entity reference form fields must use selectors, not free text.** Fields for `*_id`, `*_code`, `*_ids` require dropdowns populated by list endpoints. `<input type="text">` for entity references is forbidden. | Phase 17 — 18+ modules had unusable free-text ID forms |
| R-25 | **Frontend forms must include all backend-required fields.** Every field validated by backend must have a corresponding form input. | Phase 17 — 10+ modules had forms that always failed validation |
| R-26 | **Sub-agents writing frontend MUST read backend routes.ts first.** Agent prompts must include the backend file path and require the agent to trace the API contract before writing API client methods or pages. | Phase 17 — root cause of all 8 systemic failure patterns |
| R-27 | **Sprint specs must pass the Structure Gate (Gate -2) before commit.** Every sprint spec must contain C.1 trace template, C.2 form gate, accessibility section with Accessibility Specialist as lead, 3-column Out of Scope table with sub-sprint numbers for deferred items, and cross-cutting ACs for pagination/error parsing/button states. When planning >3 sprints, specs must be written sequentially (not parallelized). See SPRINTS.md Step A.-1. | Phase 21 — all 18 sprint specs lacked 6 mandatory sections due to parallel batch planning |
| R-34 | **Permission-gated mutating UI controls MUST use the hide pattern `{canX && (<button .../>)}`, not the visible-disabled pattern `<button disabled={!canX} />`.** Hiding controls a user cannot use is the canonical UX across the app. The visible-disabled pattern leaks the existence of actions to read-only users and creates inconsistent UX between modules. Multi-source disabled props (e.g. `disabled={!canWrite \|\| saving}`) become `{canWrite && <button disabled={saving} />}`. | Fix Sprint 20260418-0500 Finding 9 — Sprint 44.0.5 introduced visible-disabled pattern in incident-ops while sister sprints 44.0.6–44.0.9 used hidden pattern, creating a within-module split that confused QA. |

### Testing Efficiency

| # | Rule | Origin |
|---|------|--------|
| R-28 | **Full test suite runs MUST log output to a file via `\| tee tmp/<name>.log`.** Never re-run a full suite to grep/tail results — check the log file. Single-file targeted runs are exempt. Enforced by `agent-os/scripts/hooks/test-log-enforcer.sh`. | User feedback — ~1 hour/day lost to re-running tests with different tail/grep filters |
| R-29 | **Use the correct vitest config for each module.** Backend: `--config src/backend/vitest.config.ts`. Frontend: `--config src/frontend/vitest.config.ts`. Never use `vite.config.ts` (build config, not test config). Never run frontend test paths without frontend config. | User feedback — wrong config causes 6000+ false failures |

### Research Efficiency

| # | Rule | Origin |
|---|------|--------|
| R-31 | **Use `graph-navigator` for cross-file research FIRST.** Any task that would otherwise require >5 Grep/Read/Glob calls across different files MUST start with a single `graph-navigator` agent query. This includes: "where is X used?", "what depends on Y?", "what modules touch file Z?", blast-radius assessment, dependency analysis, impact analysis, and multi-module refactor planning. Spawning `general-purpose` or `Explore` agents for these tasks is an anti-pattern — they do manual traversal at the cost of hundreds of tool calls. Graph-navigator walks the pre-built dependency graph in <10 calls. Falling back to manual Grep/Read for multi-file research requires an explicit one-line justification in the reply (e.g., "graph-navigator does not cover SCSS imports — using Grep"). | Phase 24 retrospective (2026-04-11) — one session spawned 4 general-purpose agents making ~350 combined tool calls for a blast-radius review that graph-navigator could have done in ~10. Token burn was 3× baseline; wall-clock was ~30 minutes vs. an estimated ~5 minutes via graph-navigator. User-reported correlated symptoms: high token burn, slow write completion, weekly budget exhausted early. |
| R-33 | **All exports MUST flow through `UnifiedExportService`.** Direct usage of `pdfkit`, `jsPDF`, `docx`, `exceljs`, `adm-zip`, or client-side CSV generation (`new Blob([csv], { type: 'text/csv' })`) is FORBIDDEN outside of `src/backend/src/services/export/`. Backend route handlers must call `unifiedExportService.generate()`, `.generateFromDefinition()`, or `.generateRawBytes()` and return the resulting `AttachmentRef`. Frontend pages must call the apiClient method to receive the `AttachmentRef`, then `apiClient.downloadPlatformFile(ref.file_id, ref.filename)` to trigger the download. New export buttons must use the `ExportFormatMenu` component (single button when `formats.length === 1`, dropdown otherwise). This guarantees every export lands in `grc_attachments`, appears in `FilesBrowserPage`, respects org file settings, and has an audit trail. See `docs/engineering/exports.md` for the canonical pattern. | Sprint 42.2.3 — consolidated 7 PDF generators + 14 CSV routes + 6 client-side CSV generators into one service. Without this rule, future engineers reinvent ad-hoc export paths and the File Component drift recurs (Sprint 42.0.0/42.1.0/42.2.x history). |

> **R-32 removed 2026-04-17:** originally introduced 2026-04-11 to force Bash heredoc as a workaround for `Write` tool stalls on long markdown. In practice the rule created more friction than it saved: heredoc parsing fails on content containing `$`, backticks, or mixed quotes, forcing a `touch` + `Read` + `Write` workaround that bypasses the rule's intent. The built-in `Write` / `Edit` "read-before-write" guard already covers the stale-view bug class that R-32 implicitly relied on. Web/Desktop `Write` timeouts — the symptom R-32 was meant to address — are an API-layer payload-size issue, not a per-repo enforcement concern; they should be filed upstream as a tool/API bug rather than papered over with a hook that only runs in Claude Code CLI.

### i18n

| # | Rule | Origin |
|---|------|--------|
| R-13 | **i18n completeness is mandatory per sprint.** Every new key translated in ALL 16 locale files. Zero `// TODO: translate` stubs. The I18N Specialist agent MUST be invoked for real translations — EN-copy placeholders in non-EN locales are a gate failure. | Violated for 33 consecutive sprints in Phase 19 |

### Regulatory & Validation

| # | Rule | Origin |
|---|------|--------|
| R-14 | **Regulatory pack intake is mandatory.** New frameworks must be staged under `docs/pending/regulatory-frameworks/<slug>/` with README.md and source PDFs before sprint planning. | Regulatory framework governance model |
| R-15 | **Persona/use case coverage assessment before sprint planning.** The User Validation Specialist must assess coverage BEFORE sprint planning begins. | User validation layer (10 personas, 19 use cases) |
| R-16 | **Use cases are sprint gates.** Every relevant sprint must declare: (a) persona(s) served, (b) use case(s) improved, (c) user pain removed, (d) acceptance proof. | SPRINTS.md Step A |
| R-17 | **Roadmap prioritization must be use-case-grounded.** Features that serve no documented user workflow should be deprioritized or rejected. | User validation layer |

### Session Discipline

| # | Rule | Origin |
|---|------|--------|
| R-30 | **Maximum 5 sprints between full gate checkpoints.** After every 5th sprint in a session, the agent MUST pause and run: full test suite (`npm run test:all`), housekeeping lint (`lint-housekeeping.sh`), i18n completeness (`check-i18n-completeness.sh`), and output the E11 self-verification checklist. Skipping this checkpoint is a gate failure. If the user requests >5 sprints without a checkpoint, the agent must flag the risk and propose a checkpoint schedule. | Phase 24 marathon (2026-03-27) — 31 sprints delivered with progressive gate-skipping. After sprint ~10, self-governance failed completely. Gate compliance inversely correlates with sprint count. |

### Marketing Content

| # | Rule | Origin |
|---|------|--------|
| R-19 | **Marketing content is governed documentation.** Landing pages and blog posts under `docs/content/marketing/` may only be revised when triggered by product changes, framework changes, persona/use case changes, or explicit sprint scope. No silent drift. | Phase 20 content system creation |
| R-20 | **No fabricated claims in marketing content.** Every feature, workflow, and regulatory claim must be traceable to a specific repo source. Unverified claims must be marked `[VERIFY]`. | Agent OS Protocol Content Agent anti-fabrication rule |

### Security & Confidentiality

| # | Rule | Origin |
|---|------|--------|
| R-21 | **Agent OS Protocol is NOT open source** and must not be published publicly. | Business constraint |

---

## Agent Modification Rules

These rules define which agents may modify which governance files.

### Governance file permissions

| File | Main agent | Sub-agents | When modifiable |
|------|-----------|------------|-----------------|
| **RULES.md** | Write | Read-only | New rule from incident/lesson, user directive, or governance change |
| **STATE.md** | Write | Read-only | After every completed sprint (close-out gate) |
| **ARCHITECTURE.md** | Write | Read-only | When module structure, tech stack, or data flow actually changes in code |
| **CLAUDE.md** | Write | Read-only | Build commands change, new module area added |
| **ETHICS.md** | Write | Read-only | New quality failure incident, user corrects laziness pattern, escalation guidance refined |
| **MEMORY.md** | Write | Read-only | Memory index changes, retrieval rules change |
| **SPRINTS.md** | Write | Read-only | Sprint process changes, new gate added |
| **SUB-AGENTS.md** | Write | Read-only | Agent roster changes, routing rules change, new verification pattern |
| **SOUL.md** | Write | Read-only | User corrects working style |
| **README.md** | Write | Read-only | Sprint close-out (stats, status updates) |
| **I18N.md** | Write | I18N Specialist (read-only for others) | i18n architecture changes |

**Rule:** Sub-agents may NEVER modify root governance files (*.md at project root). They may only modify files within their owned directories (see SUB-AGENTS.md agent roster for ownership).

### When agents read governance files

| Trigger | Files to read |
|---------|--------------|
| Session start | CLAUDE.md (automatic), RULES.md, ETHICS.md |
| Sprint kickoff | SPRINTS.md, STATE.md |
| Sub-agent spawning | SUB-AGENTS.md (orchestrator), agent definition file (agent) |
| Architecture question | ARCHITECTURE.md, then docs/engineering/README.md if more detail needed |
| Rule question or conflict | RULES.md → precedence hierarchy |

---

## Anti-Drift Rules

These rules prevent governance files from drifting out of sync with reality.

| # | Rule | Applies to |
|---|------|-----------|
| D-01 | **Only update governance files based on implemented code, approved sprint scope, or formal close-out.** Never update speculatively or based on planned-but-unimplemented work. | All governance files |
| D-02 | **STATE.md must match CLAUDE.md and README.md.** If any status information conflicts, STATE.md is authoritative. CLAUDE.md and README.md must be updated to match. | STATE.md, CLAUDE.md, README.md |
| D-03 | **ARCHITECTURE.md must match code.** If code structure changes (new module, removed module, new infrastructure), ARCHITECTURE.md must be updated in the same sprint. If ARCHITECTURE.md says something that code contradicts, code is authoritative. | ARCHITECTURE.md |
| D-04 | **RULES.md must cite its origin.** Every rule must reference the incident, sprint, or user directive that established it. Rules without origin are suspect and should be verified. | RULES.md |
| D-05 | **No duplicate rules across files.** If a rule appears in RULES.md, other files should reference it, not restate it. Exception: SPRINTS.md may restate rules as checklist items for enforcement purposes. | All governance files |
| D-06 | **"Last updated" dates must be accurate.** Every governance file must show the actual date of its last substantive change. Bumping a date without changing content is a violation. | All governance files |

| D-07 | **Whisper rules must stay in sync with RULES.md.** `agent-os/whisper-rules.md` contains a subset of rules injected via `UserPromptSubmit` hook on every prompt. If a referenced rule (R-01, R-02, etc.) changes in RULES.md, whisper-rules.md must be updated in the same commit. Origin: Sprint 38.5.0 — whisper rules implementation. | whisper-rules.md, RULES.md |

---

## Whisper Rules Injection

`agent-os/whisper-rules.md` is injected by `UserPromptSubmit` hook on every prompt. Contains R-01, R-02, R-03, R-04, R-05, R-09, R-26, R-27, R-28 plus scope exemptions. Survives context compaction and `/clear`.

---

## Revision Procedures

### Before editing any governance file

1. **Read the file's header** — check purpose, ownership, and update triggers
2. **Verify the change is justified** — does it match an update trigger? If not, do not edit.
3. **Check for conflicts** — will this change conflict with any higher-priority source in the precedence hierarchy?
4. **For RULES.md specifically:** cite the origin (incident number, sprint, or user directive) for any new rule

### After editing any governance file

1. **Update "Last updated" date** to today
2. **Verify no drift** — check that the change doesn't contradict other governance files
3. **If STATE.md was edited:** verify CLAUDE.md and README.md status sections match
4. **If RULES.md was edited:** verify the new rule doesn't duplicate content in other files
5. **If ARCHITECTURE.md was edited:** verify the change reflects actual code, not planned code

### Sprint close-out requirements for governance files

These files must be checked and potentially updated during every sprint close-out (SPRINTS.md Step E):

| File | Close-out check |
|------|----------------|
| **STATE.md** | MANDATORY — update implementation status, codebase metrics, current sprint |
| **RULES.md** | IF new rule established — add with origin citation |
| **ARCHITECTURE.md** | IF module structure, tech stack, or data flow changed — update to match code |
| **CLAUDE.md** | IF build commands or code patterns changed |
| **ETHICS.md** | IF new quality failure incident warrants a narrative addition |
| **README.md** | MANDATORY — update sprint count, codebase stats, maintenance date |

---

*Last updated: 2026-06-21 (Added R-43 — mandatory REUSE.md pre-implementation check for all agents and sprints; origin: user directive 2026-06-21 after repeated incidents of agents creating new export methods, audit hooks, download utilities, and file handlers when canonical implementations already existed.)*

| R-43 | **Check `agent-os/REUSE.md` BEFORE creating any service, hook, component, or utility.** Before writing a new export method, download handler, audit event logger, file upload handler, permission check, pagination utility, API client method, form component, modal, toast, error handler, loading state, date formatter, status badge, DB index registration, or pack installer — open `REUSE.md` and verify no existing implementation covers the need. If a match exists, use it. If no match exists, document in the sprint spec *why* no existing component fits, then create the new component and add its entry to `REUSE.md` in the same commit. Sub-agents must cite the REUSE.md entry (or the explicit "no match" justification) in their implementation plan before writing code. Violation pattern: creating `new PdfService()`, `new CsvExporter()`, `new AuditLogger()`, `new FileHandler()`, `new DownloadUtil()`, or any other generic infrastructure outside the canonical paths listed in REUSE.md. | User directive 2026-06-21 — repeated pattern of agents inventing new export/audit/download/file/pagination/permission implementations when canonical ones already exist in the codebase, causing drift, maintenance burden, and audit gaps. |

---
