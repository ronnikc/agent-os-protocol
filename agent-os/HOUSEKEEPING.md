# HOUSEKEEPING — Agent OS Protocol Governance File Sync

> **Last updated:** 2026-03-17
> **Purpose:** Canonical checklist for keeping governance files consistent after every sprint. Prevents count drift, stale dates, missing phase entries, and cross-file contradictions.
> **Ownership:** Main agent (orchestrator). Sub-agents may NOT modify this file.
> **When to update:**
> - New governance file added to the project
> - New cross-file consistency rule discovered
> - Verification command changes
> - New count or metric tracked
>
> **Origin:** Created after Phase 21 planning revealed 25 stale items across 6 governance files. Housekeeping had been requested manually ~100 times across 200+ sprints with no automated enforcement.

---

## When to Run This Checklist

This checklist is **Gate E.7 (Housekeeping Verification)** in SPRINTS.md. It runs after Gate E6 (Codebase Stats) and before Gate E8 (I18N Translation Verification).

**Triggers:**
- After every sprint close-out (mandatory)
- After any governance file update (Gate -2 specs, new rules, new agents, etc.)
- After phase planning completion (new phase added)
- When the user requests a housekeeping audit

---

## Section 1: Cross-File Count Consistency

These values must match across files. Run `agent-os/scripts/lint-housekeeping.sh` or verify manually.

### 1.1 Agent Count

The agent count must be identical in all locations:

| File | Location | What to check |
|------|----------|---------------|
| **SUB-AGENTS.md** | Heading "Agent Roster (N Agents)" | Must match actual agent count |
| **SUB-AGENTS.md** | Footer `*Last updated:*` line | Must match heading count |
| **README.md** | Agent OS intro paragraph | "N specialized sub-agents" |
| **README.md** | Agent OS diagram | "(N total)" in diagram |
| **README.md** | Agent OS diagram footer | "N agent definitions" |
| **README.md** | Governance Files table | "links to all N definitions" |
| **MEMORY.md** | Sub-Agent System paragraph | "N specialized agents" |
| **sub-agents/README.md** | File header or intro | Agent count if mentioned |

**Verification command:**
```bash
ls sub-agents/agents/*.md | wc -l
```

### 1.2 Rule Count

| File | Location | What to check |
|------|----------|---------------|
| **RULES.md** | Count rules in all tables | Total R-XX rules |
| **README.md** | Agent OS Governance Files table | "N non-negotiable rules" |
| **README.md** | Agent OS diagram | "RULES.md (N rules)" |

**Verification:** Count all `| R-XX |` rows in RULES.md.

### 1.3 Skill Count

| File | Location | What to check |
|------|----------|---------------|
| **README.md** | Agent OS diagram footer | "N reusable skill modules" |
| **README.md** | Skill Modules heading | "(N)" or "(N + README)" |
| **README.md** | Governance Files table | "N reusable skill modules" |
| **README.md** | Repository Structure | sub-agents description |

**Verification command:**
```bash
ls sub-agents/skills/*.md | grep -v README | wc -l
```

### 1.4 Memory Count

| File | Location | What to check |
|------|----------|---------------|
| **README.md** | Agent OS diagram footer | "N evolved lesson files" |
| **README.md** | Repository Structure | sub-agents description |

**Verification command:**
```bash
ls sub-agents/memories/*.md | grep -v README | wc -l
```

### 1.5 Phase Count

| File | Location | What to check |
|------|----------|---------------|
| **CLAUDE.md** | Development Phases | "N phases (X.Y.Z–A.B.C)" |
| **CLAUDE.md** | Quick reference | "N of M phases delivered" |
| **README.md** | Agent OS "Why" paragraph | "N phases" |
| **STATE.md** | Implementation Status table | Row count and totals |

**Verification:** Count rows in STATE.md Implementation Status table.

---

## Section 2: Date Consistency

Every governance file has a "Last updated" field. After any sprint close-out, verify:

| File | Field | Rule |
|------|-------|------|
| **STATE.md** | Header `> **Last updated:**` | MUST be updated every sprint |
| **STATE.md** | Footer `*Last updated:*` | MUST match header date |
| **README.md** | Maintenance section `> **Last updated:**` | MUST be updated every sprint |
| **CLAUDE.md** | Header `> **Last updated:**` | Update if CLAUDE.md content changed |
| **RULES.md** | Header + footer | Update only if rules changed |
| **SUB-AGENTS.md** | Header + footer | Update only if agent system changed |
| **MEMORY.md** | Footer `*Last updated:*` | Update only if memory index changed |
| **ARCHITECTURE.md** | Header + footer | Update only if architecture changed |
| **sub-agents/README.md** | Header | Update if agent roster changed |

**Anti-drift rule (from RULES.md D-06):** Never bump a date without changing content.

---

## Section 3: Phase & Sprint Status Sync

After every sprint close-out, these must be consistent:

| Check | Files involved | Rule |
|-------|---------------|------|
| Active phase | STATE.md "Current Phase" table | Must name the phase currently being worked on |
| Phase progress | STATE.md "Phase progress" field | Must show correct N/M count |
| Phase row | STATE.md Implementation Status table | Must have a row for every phase (1–21+) |
| Phase status | README.md Project Status table | Must match STATE.md |
| Phase header | README.md Implementation Summary | Phase header must say "Complete" or "In Progress" or "Planned" correctly |
| Repository Structure | README.md Repository Structure tree | Must list all phase-N/ directories |
| CLAUDE.md quick ref | CLAUDE.md Quick reference | Must match STATE.md active phase |
| Total counts | STATE.md "Total sprints delivered" / "Total phases complete" | Must match actual state |

---

## Section 4: Codebase Metrics Sync

These must match between STATE.md and README.md. Run the verification commands (from SPRINTS.md E6) and update both files.

| Metric | STATE.md field | README.md field | Verification command |
|--------|---------------|-----------------|---------------------|
| Backend modules | Codebase Metrics table | Codebase Stats table | `ls -d src/backend/src/modules/*/ \| wc -l` |
| Backend services | Codebase Metrics table | Codebase Stats table | `find src/backend/src/modules -name '*-service.ts' \| wc -l` |
| Route files | Codebase Metrics table | Codebase Stats table | `find src/backend/src/modules -name 'routes.ts' \| wc -l` |
| Frontend pages | Codebase Metrics table | Codebase Stats table | `find src/frontend/src/pages/admin -name '*.tsx' ! -path '*__tests__*' ! -name '*.test.tsx' \| wc -l` |
| Shared type files | Codebase Metrics table | Codebase Stats table | `find src/shared/src/types -name '*.ts' ! -name 'index.ts' \| wc -l` |
| API client methods | Codebase Metrics table | Codebase Stats table | `grep -cE '(async \|= async )' src/frontend/src/services/api-client.ts` |
| Permissions | Codebase Metrics table | Codebase Stats table | `grep -oP "'[a-z][a-z_.:]+'..." \| sort -u \| wc -l` |
| MongoDB collections | Codebase Metrics table | Codebase Stats table | `grep -oP 'grc_[a-z_]+' src/backend/src/db/indexes.ts \| sort -u \| wc -l` |
| Test files | Codebase Metrics table | Codebase Stats table | `find src -name '*.test.ts' -o -name '*.test.tsx' \| wc -l` |
| Documentation files | Codebase Metrics table | Codebase Stats table | `find docs -name '*.md' \| wc -l` |
| Product docs | N/A | Documentation Coverage table | `find docs/product -name '*.md' \| wc -l` |
| Release notes | N/A | Documentation Coverage table | `find docs/release-notes -name '*.md' ! -name 'README.md' ! -name 'index.md' \| wc -l` |
| Frontend page groups | N/A | Codebase Stats table | `ls -d src/frontend/src/pages/admin/*/ \| wc -l` |

---

## Section 5: README.md Internal Consistency

These values within README.md must be self-consistent:

| Check | Locations | Rule |
|-------|-----------|------|
| Release notes count | Codebase Stats vs Documentation Coverage | Must match |
| Agent/skill/memory counts | Repository Structure vs Agent OS section vs Governance Files table | Must match |
| Phase status | Project Status table vs Implementation Summary headers | Must match |
| Sprint range in phase dir | Repository Structure comments vs Project Status table | Must match |

---

## Automated Verification

Run `agent-os/scripts/lint-housekeeping.sh` to check all automatable items. The script verifies:

1. Agent count consistency across files
2. Rule count consistency
3. Skill/memory count consistency
4. Codebase metrics match between STATE.md and README.md
5. Date staleness (warns if any governance file hasn't been updated in >7 days during active development)
6. Phase count consistency

**Usage:**
```bash
bash agent-os/scripts/lint-housekeeping.sh
```

Exit code 0 = all checks pass. Non-zero = failures listed.

---

## Relationship to Other Files

| File | Relationship |
|------|-------------|
| **SPRINTS.md** | Gate E.7 references this file. HOUSEKEEPING.md is the checklist; SPRINTS.md is the gate. |
| **STATE.md** | HOUSEKEEPING.md verifies STATE.md is current. STATE.md is the source of truth for status. |
| **README.md** | HOUSEKEEPING.md verifies README.md matches STATE.md. README.md is informative. |
| **CLAUDE.md** | HOUSEKEEPING.md verifies CLAUDE.md references are current. |
| **RULES.md** | HOUSEKEEPING.md verifies rule counts match. RULES.md is authoritative for rules. |
| **SUB-AGENTS.md** | HOUSEKEEPING.md verifies agent/skill/memory counts match. |

---

## Revision Procedures

### Before editing HOUSEKEEPING.md

1. Verify the change addresses a real consistency gap (not speculative)
2. Check that the new item has a verification command or clear manual check

### After editing HOUSEKEEPING.md

1. Update "Last updated" date
2. If a new check was added, update `agent-os/scripts/lint-housekeeping.sh` to automate it
3. If a new governance file was added, add its date and count rules to the appropriate sections

---

*Last updated: 2026-03-17 (Created — 25 housekeeping items discovered across 6 files after Phase 21 planning)*
