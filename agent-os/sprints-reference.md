# SPRINTS Reference — Incident History, Hook Configs, Templates

> **Purpose:** Detailed reference material moved from SPRINTS.md to reduce token cost.
> SPRINTS.md contains the procedures. This file contains the "why" narratives, hook configs, and templates.
> **Last updated:** 2026-04-06

---

## Hook Configuration (already in .claude/settings.json)

```jsonc
{
  "hooks": {
    "PostToolUse": [
      { "matcher": "Read", "hooks": [{ "command": "bash agent-os/scripts/hooks/sprint-pre-gate-hook.sh" }] },
      { "matcher": "Write", "hooks": [{ "command": "bash agent-os/scripts/hooks/sprint-spec-quality-hook.sh" }] },
      { "matcher": "Edit", "hooks": [{ "command": "bash agent-os/scripts/hooks/sprint-spec-quality-hook.sh" }] }
    ],
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [{ "command": "bash agent-os/scripts/hooks/sprint-close-gate-hook.sh" }] }
    ]
  }
}
```

## Hook Scripts

| Script | Purpose | Behavior |
|--------|---------|----------|
| `sprint-pre-gate-hook.sh` | Pre-implementation gate | Fires on Read of sprint spec. Runs `sprint-gate-runner.sh --pre`. Advisory (exit 0). |
| `sprint-close-gate-hook.sh` | Close-out gate | Fires on `gh pr create`. Runs `sprint-gate-runner.sh --close`. **Blocking (exit 2)** on failure. |
| `sprint-spec-quality-hook.sh` | Sprint planning quality | Fires on Write/Edit of sprint spec. Runs `lint-sprint-contract.sh` + `lint-sprint-spec.sh`. Advisory. |

## Lint Scripts

| Script | Purpose |
|--------|---------|
| `lint-sprint-spec.sh` | Gate -2: 9 structural checks (C.1, C.2, accessibility, out-of-scope table, sub-sprints, pagination, error parsing, button states). |
| `lint-sprint-contract.sh` | Step A contract: 14 checks (header, Goal, ACs, Out of Scope 3-column table, Dependencies, Affected Modules, Work Breakdown, Agent Assignment, Risk Assessment). |

---

## Incident Citations

These explain WHY each gate exists. Read when you need context on a specific gate.

### Gate -2 (Sprint Spec Structure)
Phase 21 initial planning produced 18 sprint specs in parallel. All 18 had identical gaps (6 missing sections each). Rework took longer than writing correctly the first time.

### Gate -1 (Pre-Implementation)
33 sprints shipped without close-out documentation, translations, or status updates. Instructions alone do not prevent skipping — only interlocks do.

### Sprint Gate Enforcer (Hook System)
Phase 21 post-mortem: 18 main sprints + 8 sub-sprints delivered with ZERO gate compliance. Gates were documented as "non-negotiable" but the agent skipped them every time under implementation pressure. Hooks remove the agent from the enforcement loop.

### C.1 API Contract Trace
Sprint 25.3.0 planning audit found 8 systemic failure patterns across all 62 Phase 17/19 views: wrong URLs (15+ modules), field mismatches (12+), paginated responses as arrays (6), missing form fields (10+).

### C.2 Form Completeness Gate
Phase 17 had 18+ modules with free-text ID fields and 10+ modules with missing required form inputs.

### E10 (PR Creation as Delivery Boundary)
Until 2026-03-23, PRs were created manually. Close-out gates had no enforcement point. Making PR creation an agent step creates the hook target.

### E11 (Self-Verification Checklist)
Sprint 21.3.0: earlier gates existed but sub-agent memory write-back was systematically skipped for 10+ sprints. Visible output prevents silent skipping.

### E12 (Module Production Readiness)
Phase 22 delivered 42 sprints passing E0-E11 but left 628 production readiness issues (113 P0) across 246 pages. Existing gates verify build/tests/docs/i18n but NOT user safety.

### D.6 (Product QA Review)
9 rounds of QA on Sprint 26.7.0 revealed production-readiness issues (raw modals, hardcoded strings, broken workflows, raw ObjectIds) systematically missed without a dedicated review step.

### Sub-Sprint Pattern (A.1)
Sprint 20.2.0 deferred 3 of 6 epics with vague notes. No sprint numbers assigned, no specs written, deferrals only discovered during Phase 19 review.

### Work File Lessons Learned
Sprints 20.6.0–21.0.0 executed with zero lessons captured. 11 Phase 19 work files used identical placeholder text.

---

## Module QA Finalization Sprint (Type A.2)

Use when a module passed sprint ACs but fails the full Production Readiness Checklist (A-H) on holistic review.

**Process:**
1. QA Scan (max 4 agents parallel) — each applies full checklist to assigned views
2. Consolidation — aggregate findings, classify systemic vs view-specific
3. Fix Execution — fix cross-cutting patterns first across ALL affected views, then view-specific

**Scaling:** For many modules, run automated pattern scan first (grep for 7 known anti-patterns), prioritize by finding density, batch 2-3 modules per sub-sprint.

**Sprint spec template:**
```markdown
# Sprint X.Y.Z — [Module Name]: Production Readiness QA Fixes
Phase: [N] | Status: Planned | Parent Sprint: X.Y.0
Sprint Type: Module QA Finalization (see SPRINTS.md -> A.2)

## Goal
Fix all production readiness issues across [N] sub-module views.

## Acceptance Criteria
[Organized by cross-cutting pattern, not by view]

## Out of Scope
[3-column table: Item | Classification | Action]
```

---

## Regulatory Framework Pack Intake

### Intake Location
```
docs/pending/regulatory-frameworks/<framework-slug>/
```

### Required Contents
| File | Required | Purpose |
|------|----------|---------|
| `README.md` | Yes | Implementation brief: pack identity, compliance scope, required outputs |
| Source PDF(s) | Yes | Official law/regulation text |
| Supporting `.md` | Optional | Forms tracker, submission channels, procedures |

### Process
1. User Validation Specialist assesses persona/use case coverage BEFORE sprint planning
2. Sprint spec must list: pack metadata, requirements mapped to modules, artifacts, form templates, workflows, matching personas/use cases
3. Template pattern: Sprint 15.9.0 (VN AI Law) and Sprint 16.0.0 (VN E-Commerce Law)

### User Validation Rules
- Every VN framework sprint references at least one persona ID, one use case ID, one coverage status
- No sprint approved based only on template counts — acceptance must prove end-to-end user success
- Three-tier ID classification: official (verified) / provisional / internal
- Personas: `docs/user-validation/personas/` | Use cases: `docs/user-validation/use-cases/`

---

## Automatic Session Artifacts & Hook Systems

### Whisper Rules (UserPromptSubmit)
`whisper-rules-hook.sh` injects `agent-os/whisper-rules.md` on every prompt — 9 mandatory rules surviving context compaction.

### Observation Capture (PostToolUse)
`observation-capture-hook.sh` classifies tool calls into: decision (commit/push), change (edit/write), discovery (read/search), gate-check (test/typecheck). Stored in `observations/current-session.jsonl`.

### Graph Intelligence (PostToolUse)
- Sprint spec read: blast radius analysis of high-risk files
- TypeScript edit: graph staleness warning for `src/shared/` files

### Context Preservation (Stop + SessionStart)
- Stop: saves sprint/task/files state to temp file
- SessionStart: re-injects as compact timeline after compaction
- Stop: archives observations to daily JSONL, updates index

### Shared Memory Bus
| Script | Purpose |
|--------|---------|
| `shared-mem-write.sh <agent> <key> <value>` | Write per-agent state |
| `shared-mem-read.sh [agent]` | Read agent states |
| `shared-mem-send.sh <from> <to> <type> <content>` | Send typed messages |
| `shared-mem-inbox.sh <agent>` | Read unread messages |

### Agent OS Panel
`npm run agent-os-panel` — localhost web UI with 7 tabs: Agents, Scheduled, Lobby, Messages, Tasks, Assist, Gantt.
