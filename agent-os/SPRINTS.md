# SPRINTS — Sprint Execution Playbook

> **Last updated:** 2026-04-06
> **Reference:** Incident history, hook configs, templates in [sprints-reference.md](sprints-reference.md)

---

## Sprint Gate Enforcer (Hook-Enforced)

Gates are enforced by hooks — not by agent self-discipline. The agent cannot skip them.

```
Planning:   Write/Edit spec -> hook runs lint-sprint-spec.sh (advisory)
            git commit spec  -> hook blocks until Gate -2 passes
Start:      Read spec        -> hook runs sprint-gate-runner.sh --pre (advisory)
Delivery:   gh pr create     -> hook runs sprint-gate-runner.sh --close (BLOCKS on failure)
```

Gate scripts: `sprint-gate-runner.sh --pre <spec>` and `sprint-gate-runner.sh --close <spec> <workfile>`. Exit 0 = pass.

---

## Gate -2 — Sprint Spec Structure (BLOCKING before commit)

Enforced by `lint-sprint-spec.sh`. Every sprint spec must have:

1. C.1 API Contract Trace section (or "N/A — [reason]")
2. C.2 Form Completeness Gate section (or "N/A — [reason]")
3. B5/B6/B7 Accessibility section with per-component WCAG checks
4. Accessibility Specialist as lead in Agent Assignment table
5. Out of Scope table with 3 columns: Item | Classification | Action
6. Every "Deferred improvement" has a sub-sprint number
7. At least one AC mentions pagination unwrap R-23 (or "N/A")
8. At least one AC includes error parsing pattern
9. At least one AC includes button loading state pattern

Sequential planning: when planning >3 sprints, write and verify one spec at a time.

---

## Gate -1 — Pre-Implementation (BLOCKING before code)

Before writing ANY code, confirm:

1. Sprint spec exists with acceptance criteria
2. Work file created (`docs/product/phases/phase-N/sprint-X.Y.Z-workfile.md`)
3. If i18n keys added: I18N Specialist agent planned
4. Close-out planned as part of sprint scope
5. Sub-agent assignment planned (see SUB-AGENTS.md)
6. If regulated workflows: User Validation Specialist is co-lead on planning

---

## Step A — Lock the Sprint Contract

Sprint spec (`docs/product/phases/phase-{N}/sprint-{X.Y.Z}.md`) must contain:

1. **Goal** — one sentence
2. **Acceptance criteria** — 5-10 testable items (definition of done)
3. **Out of scope** — explicit list (3-column table: Item | Classification | Action)
4. **Dependencies** — prior sprints or infrastructure
5. **Affected modules** — every source dir and doc file that changes
6. **User validation** — persona(s), use case(s), user pain removed, acceptance proof
7. **Reuse check** — for every service, hook, component, or utility the sprint will create, cite the `agent-os/REUSE.md` entry consulted and state "reuse: `ComponentName`" OR "no match: `<reason>`". This is a **BLOCKING** gate — a sprint spec without a reuse check cannot proceed to implementation (R-43).

### A.2 Reuse Check Protocol (BLOCKING — R-43)

Before writing any implementation plan, the planning agent MUST:

1. Open `agent-os/REUSE.md`
2. For each new piece of infrastructure the sprint touches (export, download, audit, file upload, permission check, pagination, search, API client method, form, modal, toast, error handler, loading state, date formatter, i18n hook, status badge, DB index, pack installer), find the matching entry
3. Record in the sprint spec:
   - **Reusing**: `UnifiedExportService` for PDF/CSV export — no new export service needed
   - **No match**: creating `RegulatorySearchIndex` — no existing full-text regulatory search exists (nearest: `useFormFilterData` covers form-level filters only, not cross-framework content search)
4. Sub-agents receive the reuse check as part of their prompt context

Failure to complete the reuse check before implementation is a gate violation equivalent to skipping C.1 API Contract Trace.

### A.1 Sub-Sprint Pattern

Deferred scope gets patch-version numbers: parent `X.Y.0`, sub-sprints `X.Y.1`, `X.Y.2`, etc.

Every "Out of scope" item must be classified:
- **Scope boundary** — not this module's concern. No sub-sprint. State why.
- **Deferred improvement** — should be done, can't fit. Sub-sprint spec required immediately.

Default is "deferred improvement" — justify scope boundaries explicitly.

---

## Step B — Work Breakdown

Implementation order (prevents rework):

### B1. Shared types
- Create/update `src/shared/src/types/{module}.ts`, export from index
- Add permissions to `src/shared/src/constants/permissions.ts`
- Build: `npx tsc -p src/shared/tsconfig.json`

### B2. Backend
- Database indexes in `src/backend/src/db/indexes.ts`
- Services in `src/backend/src/modules/{module}/`
- Routes in `src/backend/src/modules/{module}/routes.ts`
- Wire into `src/backend/src/app.ts`
- Build: `npx tsc -p src/backend/tsconfig.json`

### B3. Frontend
- **Complete C.1 API Contract Trace BEFORE writing API client methods**
- API client methods in `src/frontend/src/services/api-client.ts`
- Pages in `src/frontend/src/pages/admin/{module}/`
- Entity reference fields: use `<select>` or searchable dropdown, never free text
- Required fields: match backend validation
- Navigation in `AdminLayout.tsx`, routes in `App.tsx`
- Build: `npx tsc -p src/frontend/tsconfig.json --noEmit`

### B4. Tests
- Write tests as you touch logic (not after). Unit + integration as applicable.
- Coverage must meet CI thresholds on the same commit.
- Mocks must match real method names and signatures exactly.

### B5. Accessibility
- Semantic HTML, ARIA, keyboard navigation. Follow Phase 11 patterns.
- Invoke Accessibility Specialist agent for all new/modified frontend components.

### B6. Help center
- User-facing features: add seed articles to `seed-sample-data.ts`
- New modules: update `docs/user-guide/README.md`

### B7. Documentation
- Release notes: `docs/release-notes/{X.Y.Z}.md`
- Update `docs/release-notes/README.md` version history table

---

## Step C — Guardrails

| Rule | Why |
|------|-----|
| No refactors unless required by ACs | Scope creep |
| Every state change emits audit events | Accountability |
| Mocks match real method names | Wrong names pass vitest but fail tsc |
| Coverage thresholds met same commit | No test debt |
| Build passes before commit | shared -> backend -> frontend |
| Tests pass for modified modules before commit | A commit that breaks tests is a gate failure |
| Documentation updates are blocking | Code without docs is incomplete |
| No hardcoded UI strings | Every page uses `useLocale()` |
| Fix root causes, not symptoms | Frontend filters hiding bad data is not a fix |
| Verify field names end-to-end | Seed -> service -> API -> frontend |
| >3 files = decompose first | Break into reviewable sub-tasks |

### C.1 API Contract Trace (BLOCKING before frontend)

For EVERY endpoint a page will call:

```
1. Mount point: grep "[module]" src/backend/src/app.ts -> /api/v1/[module]
2. Route path:  read src/backend/src/modules/[module]/routes.ts -> router.[method]('/[sub-path]')
3. Full URL:    /api/v1/[module]/[sub-path]
4. Request body: read service method params
5. Required fields: grep "if (!data." in service
6. Response shape: paginated { data, total, page, page_size } or single object?
7. Frontend unwrap: (res as any).data ?? [] for paginated
```

Document in work file. Sub-agent prompts MUST include the backend routes.ts path.

### C.2 Form Completeness (BLOCKING before frontend commit)

1. Entity reference fields (`_id`, `_code`, `_ids`) use `<select>`, not text input
2. Every backend-required field has a form input
3. Enum fields use `<select>` with matching options
4. Array fields use multi-select, not comma-separated text
5. Submit buttons have loading/disabled state during async

### C.3 Bug-Fix Discipline

Reproduce first. Fix root causes. Verify field name contracts. Validate full data lifecycle. Never mask broken data with frontend filters. See `memories/engineering-bug-fix-discipline.md`.

---

## Step D — Commit Structure

| Commit | Contents |
|--------|----------|
| 1. Types + backend | Shared types, permissions, services, routes, seed data, backend tests |
| 2. Frontend + tests | API client, pages, navigation, routes, frontend tests |
| 3. Docs + cleanup | Release notes, doc updates, README stats |

Single-commit sprints acceptable when small. Commit message: 1-2 sentences on "why".

### D.5 Pre-Commit Verification (BLOCKING)

1. **i18n:** `grep -r 'TODO: translate' src/shared/src/i18n/` returns zero + `check-i18n-completeness.sh` passes
2. **Docs:** branch has changes to all 9 mandatory doc items from E3
3. **No deferred markers:** `FIXME|HACK|XXX` in modified files returns zero
4. **Stats current:** README codebase stats match reality, governance file dates set to today

### D.6 Product QA Review (mandatory for frontend/workflow sprints)

After implementation, before close-out: invoke Product QA Specialist on all modified frontend pages. Fix all P0 and P1 findings before Step E. P2 may defer to sub-sprint.

---

## Step E — Post-Sprint Verification

Automated checks: `sprint-gate-runner.sh --close <spec> <workfile>` handles E1, E2, D.5.1, D.5.3, E3 (partial), E7, E8 (partial), E9 (partial).

### E0. Spec vs Ship Reconciliation
Produce table: AC# | Criterion | Status | Evidence. Must appear in release notes and work file.

### E1. Build verification
`tsc` for shared, backend, frontend.

### E2. Test verification
`npm run test:all`

### E3. Documentation updates (every sprint)

| # | File | Update |
|---|------|--------|
| 1 | `docs/release-notes/{X.Y.Z}.md` | Create |
| 2 | `docs/release-notes/README.md` | Add to version history |
| 3 | `docs/developer-handoff.md` | Add to priority matrix |
| 4 | `docs/product/phases/phase-{N}/README.md` | Mark sprint Complete |
| 5 | `CLAUDE.md` -> Implementation Status | Update phase status |
| 6 | `README.md` -> Sprint table | Mark Delivered |
| 7 | `README.md` -> Codebase Stats | Update metrics (run E6 commands) |
| 8 | `README.md` -> Maintenance | Set date to today |
| 9 | All modified governance files | Set "Last updated" to today |

### E4. Conditional updates
New API endpoints -> `api-contracts.md`, `api-reference.md`. New permissions -> `permission-matrix.md`. New collections -> `data-model.md`. New user-facing module -> `user-guide/README.md`, `getting-started.md`, `admin-guide.md`. New features -> help articles in `seed-sample-data.ts`. Last sprint of phase -> E5 phase-completion items.

### E5. Phase-completion updates
Update README phase status, codebase stats, API modules table, documentation coverage, `docs/product/README.md`, `CLAUDE.md` status.

### E6. Codebase stats verification
Run count commands for: backend modules, services, routes, frontend pages, shared types, API client methods, permissions, collections, i18n keys, test files, SLoC, doc files, release notes. Verify README matches.

### E7. Housekeeping
`bash agent-os/scripts/lint-housekeeping.sh` — cross-file count consistency, codebase metrics, phase consistency.

### E8. I18N Translation Verification
If new i18n keys: invoke I18N Specialist for all 15 non-EN locales. Spot-check 2+ locales are NOT English copies. EN-copy placeholders = gate failure.

### E8.5. Idea Catalog
Check spec/workfile for deferred items without sub-sprints. Add unplanned items to `docs/content/idea-catalog.md`.

### E9. Lessons Learned & Memory Write-Back

**Part A — Global:** Review work file lessons, fold into appropriate memory files (lessons-learned, bug-fix-discipline, gotchas, phase-knowledge, instincts, RULES.md).

**Part B — Sub-Agent (if agents used):** See SUB-AGENTS.md -> Memory Write-Back.

**Part C — Background capture (Sprint 46.6.2 + 46.6.8):** As the final close-out, run

```
bash agent-os/scripts/hooks/post-sprint-memory.sh <sprint-id>
bash agent-os/scripts/process-spawn-requests.sh
```

`post-sprint-memory.sh` writes a structured spawn request to `.claude/spawn-requests/post-sprint-memory-<sprint>.json` and logs the decision to `agent-os/logs/post-sprint-memory/<sprint>.log`. `process-spawn-requests.sh` (Sprint 46.6.8) consumes the queue, writes per-agent diary entries derived from `git log` + `git diff --name-only` mapped through a deterministic `fileToAgents` table, emits sprint-completion facts via `agent-os/scripts/facts-append.sh`, rolls over diaries that exceed 200 lines (with `## Earlier (summarised)` placeholder honoring `MEMORY_DIARY_SUMMARISE`), and moves the request to `.claude/spawn-requests/consumed/`.

Silent zero is forbidden — both the per-sprint log and the global processor log (`agent-os/logs/post-sprint-memory/process-spawn-requests.log`) are always written. Re-running the processor is idempotent: diary dedup keys on the sprint-id-prefixed entry header; fact dedup keys on full content equality.

When an LLM-bound orchestrator (Agent OS Panel / boss-agent) ships, it can replace the deterministic baseline by editing the same per-agent diary entries. The processor's contract is stable.

### E10. Commit, Push & Create PR
Commit close-out as `docs: Sprint X.Y.Z close-out`. Push. Create PR via `gh pr create` (hook enforces gates).

### E10.1. PR Format

**Title:** `Sprint X.Y.Z — [Sprint Title]`

**Body sections:** Summary (goal + 2-5 bullets), Commits table, Acceptance Criteria table, Test Plan.

**Test Plan rules:** Every user-visible AC gets at least one concrete test step. Steps must be actionable ("Navigate to X > Click Y"). Expected results must be specific. Include error/edge cases and regression checks. No "verify it works" steps.

### E11. Self-Verification Checklist

Output before declaring done (abbreviated — full list in sprints-reference.md):

```
Sprint X.Y.Z Close-Out:
[] Gate A.0 completed? [] D.6 Product QA? [] E0 Spec reconciliation?
[] E3 Release notes? [] E3 README updated? [] E7 Housekeeping lint?
[] E8 I18N verified? [] E8.5 Idea catalog? [] E9A Lessons written?
[] E9B Sub-agent memories? [] STATE.md updated? [] ARCHITECTURE.md (if needed)?
[] E10 PR created? [] E10.1 Test Plan included? [] E12 Production readiness?
```

### E12. Module Production Readiness (BLOCKING for frontend sprints)

After implementation + tests pass: Product QA Specialist reviews all modified page files using full Production Readiness Checklist (A-H). P0 = block close-out. P1 = document with fix assignment. P2 = defer with justification.

---

## Step F — Lessons Learned

| What changed | Where to update |
|-------------|----------------|
| Code pattern | `memories/engineering-code-patterns.md` |
| Architecture decision | `memories/engineering-architecture-decisions.md` |
| Surprising failure | `memories/engineering-lessons-learned.md` |
| Quality gate | `memories/engineering-testing-quality-gates.md` |
| Working style | SOUL.md |
| Non-negotiable rule | RULES.md (cite origin) |
| Module structure | ARCHITECTURE.md |
| Phase/sprint status | STATE.md |
| Build command | CLAUDE.md |
| Phase knowledge | `memories/product-phase-knowledge.md` |

---

## Quick Reference: Sprint Kickoff

```
Sprint [X.Y.Z] — [Title]

Pre-Implementation:
- [ ] Sprint spec exists with ACs
- [ ] Work file created
- [ ] I18N Specialist planned (if i18n keys)
- [ ] Close-out planned as sprint scope
- [ ] Sub-agent assignment done

Implementation:
- [ ] Shared types + build
- [ ] Backend services/routes + build
- [ ] Frontend pages/API/nav/routes + build
- [ ] Tests written and passing
- [ ] Accessibility review (if frontend)

Close-out:
- [ ] All builds pass (shared -> backend -> frontend)
- [ ] All tests pass
- [ ] i18n: zero TODO stubs
- [ ] All E3 mandatory docs modified
- [ ] Release notes + README stats verified
- [ ] Lessons learned in work file
- [ ] PR created via gh pr create
```

---

## Session Crash Recovery

1. Every sprint has a work file capturing: baseline metrics, findings, completed batches with hashes, commands, lessons learned
2. Commit every ~10 files or ~15 minutes. After passing tests: commit -> push.
3. On recovery: read work file first. Trust only committed state.
4. Work file must have: Lessons Learned section (populated during sprint, not deferred), sub-agent usage record, Deferred/Not-Done section.
5. Minimum 2 numbered lessons per sprint if >5 files or >1 module or sub-agents used.

Work file location: `docs/product/phases/phase-{N}/sprint-{X.Y.Z}-workfile.md`
