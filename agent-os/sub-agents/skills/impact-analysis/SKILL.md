Title: Impact Analysis
Keywords: impact, blast-radius, dependencies, risk, change-analysis, imports
Agents: research, planning
When to use: When assessing the blast radius of a proposed change to understand affected files, modules, tests, and documentation.
Version: 1.0.0
Last updated: 2026-03-10

Assess the blast radius of a code change. Identify directly modified files, trace imports and dependents, check test coverage for affected areas, identify documentation impacts, and produce a structured impact matrix with file, change type, risk level, and test coverage status.

---

## Workflow

### Step 1 — Identify Directly Modified Files

List every file that the change will create or modify:

```
| File | Change type |
|------|-------------|
| src/shared/src/types/tasks.ts | New file |
| src/backend/src/modules/tasks/task-service.ts | New file |
| src/shared/src/constants/permissions.ts | Modified — add permission constants |
```

### Step 2 — Trace Import Dependents

For each modified file, find everything that imports it:

```
# Find all files that import from the modified module
Grep: pattern="import.*from.*permissions", path="src/"

# Find all files that reference the modified type
Grep: pattern="TaskStatus", path="src/"
```

Build an import chain: `modified file → direct importers → transitive importers`

### Step 3 — Classify Change Types

| Change type | Risk | Examples |
|------------|------|---------|
| New file (additive) | Low | New service, new page, new type |
| New export from existing file | Medium | Adding to permissions.ts, adding to index.ts |
| Modified function signature | High | Changing service method params, changing API response shape |
| Modified shared type | High | Changing a type in src/shared — affects both backend and frontend |
| Deleted export | Critical | Removing something that may be imported elsewhere |
| Seed data change | Medium | Changing field names or values in seed files |
| Configuration change | High | Changing app.ts wiring, route mounting, middleware order |

### Step 4 — Check Test Coverage

For each affected file, determine if tests exist and what they cover:

```
# Find test file for a service
Glob: src/backend/src/modules/<module>/__tests__/<service>.test.ts

# Find test file for a frontend page
Glob: src/frontend/src/pages/admin/<module>/__tests__/*.test.tsx

# Check if the specific function is tested
Grep: pattern="<function-name>", path="src/**/modules/<module>/__tests__/"
```

Mark each affected file:

| Coverage status | Meaning |
|----------------|---------|
| Covered | Test file exists and tests the affected code path |
| Partial | Test file exists but does not cover the affected code path |
| Uncovered | No test file exists |
| N/A | File type not testable (types, constants, config) |

### Step 5 — Identify Documentation Impacts

Check if the change requires documentation updates:

- **API changes** → `docs/backend/api-contracts.md`
- **Data model changes** → `docs/backend/data-model.md`
- **Permission changes** → `docs/security/permission-matrix.md`
- **New UI pages** → `docs/frontend/ui-modules.md` or `docs/frontend/user-flows.md`
- **New audit events** → `docs/compliance/audit-event-taxonomy.md`
- **i18n changes** → All 16 locale files under `src/frontend/src/locales/`

### Step 6 — Produce Impact Matrix

Output the final assessment:

| # | File | Change type | Risk | Test coverage | Doc impact |
|---|------|------------|------|---------------|------------|
| 1 | `src/shared/src/types/tasks.ts` | New file | Low | N/A | None |
| 2 | `src/shared/src/constants/permissions.ts` | Modified export | Medium | N/A | permission-matrix.md |
| 3 | `src/backend/src/modules/tasks/task-service.ts` | New file | Low | Uncovered (needs test) | api-contracts.md |
| 4 | `src/backend/src/app.ts` | Modified wiring | High | Partial | None |
| 5 | `src/frontend/src/services/api-client.ts` | Modified export | Medium | Partial | None |

### Step 7 — Risk Summary

Provide a brief risk summary:

- **Total files affected:** N (M direct + N transitive)
- **High/Critical risk items:** list them
- **Uncovered code paths:** list them
- **Required documentation updates:** list them
- **Recommendation:** proceed / proceed with caution / decompose further

### Rules

- Always trace imports for modified shared types — they ripple across backend and frontend.
- A change to `src/shared/src/constants/permissions.ts` affects seed data, backend RBAC checks, and frontend permission guards.
- A change to `api-client.ts` method signatures affects every page that calls that method.
- Seed data field name changes are high risk — they break the frontend if the frontend reads the old field name.
- When risk is high on 3+ files, recommend decomposing the change into smaller increments.

## Input Schema

```yaml
input:
  changed_files:
    type: array
    items:
      type: string
    required: true
    description: "List of files being created or modified"
  change_description:
    type: string
    required: false
    description: "Brief description of the proposed change"
  base_branch:
    type: string
    required: false
    default: "main"
    description: "Branch to compare against for blast radius"
```

## Output Schema

```yaml
output:
  impact_matrix:
    type: array
    items:
      file:
        type: string
      change_type:
        type: string
      risk:
        type: enum[Low, Medium, High, Critical]
      test_coverage:
        type: enum[Covered, Partial, Uncovered, N/A]
      doc_impact:
        type: string
  risk_summary:
    total_files_affected:
      type: number
    high_critical_items:
      type: array
    uncovered_code_paths:
      type: array
    required_doc_updates:
      type: array
    recommendation:
      type: enum[proceed, proceed_with_caution, decompose_further]
```

## Quality Gate

- Every directly modified file appears in the impact matrix with correct change type and risk level.
- Import dependents have been traced for all modified shared types and exported functions.
- Test coverage status is verified (not assumed) for each affected file.
- A clear recommendation (proceed / proceed with caution / decompose further) is provided.

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "impact-analysis"
  stage: "S1"
  suggested_next:
    - slug: "coverage-enforcement"
      stage: "S1"
      reason: "Verify test coverage for all affected files identified in the impact matrix"
    - slug: "codebase-graph-navigation"
      stage: "S1"
      reason: "Use the dependency graph for precise transitive impact counts"
```

## Error Handling

- If a listed changed file does not exist yet (new file), classify it as "New file" with Low risk and skip import tracing.
- If import tracing finds circular dependencies, flag the cycle and assess risk as High for all files in the cycle.
- If test file existence cannot be confirmed (e.g., non-standard test directory), mark coverage as "Unknown" rather than "Uncovered."
- If the change spans more than 20 files, recommend decomposition before completing the full matrix.
