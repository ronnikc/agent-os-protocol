Title: Documentation Housekeeping
Keywords: documentation, housekeeping, sprint-completion, mandatory-updates, stats
Agents: documentation
When to use: After completing a sprint to ensure all mandatory documentation files are updated. Part of sprint close-out (SPRINTS.md Step E).
Version: 1.0.0
Last updated: 2026-03-10

Post-sprint documentation updates covering 9 mandatory files, conditional updates, phase-completion items, and codebase stats verification. Every sprint must complete all items before declaring done.

---

## Mandatory Updates (Every Sprint) — 9 Items

| # | File | What to update |
|---|------|----------------|
| 1 | `docs/release-notes/{X.Y.Z}.md` | Create per-sprint release note |
| 2 | `docs/release-notes/README.md` | Add to version history table |
| 3 | `docs/developer-handoff.md` | Add sprint to priority matrix |
| 4 | `docs/product/phases/phase-{N}/README.md` | Mark sprint as Complete |
| 5 | `CLAUDE.md` → Implementation Status | Update phase-level status |
| 6 | `README.md` → Sprint table | Mark as Delivered |
| 7 | `README.md` → Codebase Stats | Update all stale metrics |
| 8 | `README.md` → Maintenance | Set "Last updated" to today |
| 9 | All modified governance files | Set "Last updated" to today |

## Conditional Updates

| Trigger | Files to update |
|---------|----------------|
| New API endpoints | `docs/backend/api-contracts.md`, `docs/user-guide/api-reference.md` |
| New permissions | `docs/security/permission-matrix.md` |
| New collections | `docs/backend/data-model.md`, `src/backend/src/db/indexes.ts` |
| New shared types | `docs/reference/json-schemas.md` |
| New user-facing module | `docs/user-guide/README.md`, `docs/training/admin-guide.md` |
| New user-facing features | `src/backend/src/db/seed-sample-data.ts` (help articles) |
| Last sprint of phase | See phase-completion items below |

## Codebase Stats Verification Commands

Run before pushing to verify README stats match reality:

```bash
ls -d src/backend/src/modules/*/ | wc -l          # Backend modules
find src/backend/src/modules -name '*-service.ts' | wc -l  # Services
find src/frontend/src/pages/admin -name '*.tsx' ! -path '*__tests__*' ! -name '*.test.tsx' | wc -l  # Admin pages
grep -cE '(async |= async )' src/frontend/src/services/api-client.ts  # API methods
find docs -name '*.md' | wc -l                     # Doc files
```

## Input Schema

```yaml
input:
  sprint_version:
    type: string
    required: true
    description: "Sprint version number (e.g., 1.2.3)"
  phase_number:
    type: integer
    required: true
    description: "Phase number the sprint belongs to"
  changed_files:
    type: array
    items: string
    required: false
    description: "List of files changed in the sprint (used to determine conditional updates)"
```

## Output Schema

```yaml
output:
  mandatory_items_completed:
    type: integer
    description: "Number of mandatory items completed out of 9"
  conditional_updates_applied:
    type: array
    items: string
    description: "List of conditional update triggers that were detected and applied"
  stats_verified:
    type: boolean
    description: "Whether codebase stats were verified against reality"
  all_clear:
    type: boolean
    description: "True if all mandatory and applicable conditional updates are complete"
```

## Quality Gate

- All 9 mandatory files are confirmed updated for the current sprint
- Codebase stats in README.md match output of verification commands
- All conditional updates triggered by changed files are applied
- Every modified governance file has its "Last updated" date set to today

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "doc-housekeeping"
  stage: "S5"
  suggested_next:
    - slug: "release-checklist"
      stage: "S5"
      reason: "After documentation is updated, run the full release checklist to verify readiness"
    - slug: "branch-completion"
      stage: "S5"
      reason: "Once all docs are updated, proceed to branch integration"
```

## Error Handling

- If a mandatory file does not exist at the expected path, log a warning and skip that item rather than failing the entire checklist
- If codebase stats commands fail (e.g., missing directories), report the discrepancy and mark stats as unverified
- If conditional update triggers cannot be determined (no changed files list provided), prompt the operator to supply the list or run `git diff --name-only main`
