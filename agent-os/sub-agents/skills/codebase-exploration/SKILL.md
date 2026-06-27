Title: Codebase Exploration
Keywords: search, grep, glob, imports, modules, exploration, codebase
Agents: research
When to use: When systematically searching the codebase to understand structure, find patterns, trace dependencies, or answer architecture questions.
Version: 1.0.0
Last updated: 2026-03-10

Systematic codebase search using Glob for file patterns, Grep for content, and Read for verification. Trace imports and exports to map module boundaries. Return structured findings with file path, line number, relevant code, and assessment.

---

## Workflow

### Step 1 — Define the Search Goal

Before searching, articulate what you need to find:

- A specific function, class, or type definition
- All usages of a module or export
- The implementation of a feature across backend/frontend
- Configuration or seed data for a module

### Step 2 — Use Glob for File Patterns

Find files by name or directory structure:

```
# Find all service files
Glob: src/backend/src/modules/**/*-service.ts

# Find all page components
Glob: src/frontend/src/pages/admin/**/*.tsx

# Find all test files for a module
Glob: src/backend/src/modules/<module>/**/*.test.ts

# Find all seed files
Glob: src/backend/src/db/seed-*.ts

# Find all locale files
Glob: src/frontend/src/locales/*/common.json
```

### Step 3 — Use Grep for Content

Search file contents for patterns:

```
# Find where a type is used
Grep: pattern="TaskStatus", path="src/"

# Find all audit event emissions
Grep: pattern="auditLog\(", path="src/backend/"

# Find all route registrations
Grep: pattern="router\.(get|post|put|patch|delete)", path="src/backend/src/modules/<module>/"

# Find permission checks
Grep: pattern="requirePermission", path="src/backend/src/modules/<module>/"

# Find i18n key usage
Grep: pattern="t\('module_name\.", path="src/frontend/"
```

### Step 4 — Use Read for Verification

After finding candidates with Glob/Grep, read the file to confirm:

- The function signature and parameters
- The full context around a code pattern
- Import/export relationships
- How a module is wired into the application

### Step 5 — Trace Import/Export Chains

To understand a module's boundaries:

1. **Find the module's index or main export:**
   ```
   Grep: pattern="export.*from.*<module>", path="src/"
   ```

2. **Find all importers:**
   ```
   Grep: pattern="import.*from.*<module>", path="src/"
   ```

3. **Map the chain:** source file → export → importer → usage

### Step 6 — Map Module Boundaries

For a complete module understanding, trace:

| Layer | What to find | How |
|-------|-------------|-----|
| Types | Shared type definitions | `Glob: src/shared/src/types/<module>.ts` |
| Permissions | Permission constants | `Grep: pattern="<MODULE>", path="src/shared/src/constants/permissions.ts"` |
| Service | Business logic | `Glob: src/backend/src/modules/<module>/*-service.ts` |
| Routes | API endpoints | `Glob: src/backend/src/modules/<module>/routes.ts` |
| App wiring | Route mounting | `Grep: pattern="<module>", path="src/backend/src/app.ts"` |
| API client | Frontend API calls | `Grep: pattern="<module>", path="src/frontend/src/services/api-client.ts"` |
| Pages | UI components | `Glob: src/frontend/src/pages/admin/<module>/*.tsx` |
| Navigation | Menu entries | `Grep: pattern="<module>", path="src/frontend/src/layouts/AdminLayout.tsx"` |
| Routes | Frontend routes | `Grep: pattern="<module>", path="src/frontend/src/App.tsx"` |
| Tests | Test files | `Glob: src/**/modules/<module>/**/*.test.ts` |

### Step 7 — Return Structured Findings

Format results as:

| File | Line | Code | Assessment |
|------|------|------|------------|
| `src/backend/src/modules/tasks/task-service.ts` | 42 | `async create(org_id: string, data: CreateTaskInput)` | Service method follows pattern |
| `src/frontend/src/pages/admin/tasks/TasksPage.tsx` | 15 | `const { t } = useLocale()` | i18n correctly initialized |

### Search Strategy Tips

- Start broad (Glob for files), then narrow (Grep for content), then verify (Read)
- If Grep returns too many results, add path constraints or refine the pattern
- When tracing a bug, follow the data flow: seed data → service → API response → frontend render
- For cross-module dependencies, grep for the module name across the entire `src/` directory
- Check both `.ts` and `.tsx` extensions for frontend code

## Input Schema

```yaml
input:
  search_goal:
    type: string
    required: true
    description: "What to find — a function, module boundary, feature implementation, or config"
  scope:
    type: string
    required: false
    description: "Directory or module to constrain the search (e.g., src/backend/src/modules/tasks)"
  depth:
    type: enum[shallow, deep]
    required: false
    default: "shallow"
    description: "shallow = Glob+Grep only; deep = full import/export chain tracing"
```

## Output Schema

```yaml
output:
  findings:
    type: array
    items:
      file:
        type: string
        description: "Absolute file path"
      line:
        type: number
        description: "Line number of the match"
      code:
        type: string
        description: "Relevant code snippet"
      assessment:
        type: string
        description: "Brief assessment of the finding"
  module_map:
    type: object
    required: false
    description: "Module boundary map (populated when depth=deep)"
  summary:
    type: string
    description: "Plain-language summary of findings"
```

## Quality Gate

- All findings include file path, line number, and code snippet — no unverified entries.
- If depth=deep, the import/export chain has been fully traced with no broken links.
- Findings table contains at least one entry, or an explicit "no results" explanation is provided.
- Search scope was respected — no results from outside the specified scope.

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "codebase-exploration"
  stage: "S1"
  suggested_next:
    - slug: "impact-analysis"
      stage: "S1"
      reason: "After exploring the codebase, assess the blast radius of proposed changes"
    - slug: "codebase-graph-navigation"
      stage: "S1"
      reason: "Use the dependency graph for deeper structural analysis"
```

## Error Handling

- If Glob returns zero matches, broaden the pattern (e.g., remove directory constraints) before reporting "not found."
- If Grep returns excessive results (>100), narrow with path constraints or refine the regex before presenting findings.
- If a file path from Glob/Grep cannot be read (deleted or moved), note it as stale and exclude from findings.
- If import/export chain tracing hits a circular dependency, flag it and stop traversal at the cycle point.
