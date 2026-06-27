Title: Release Checklist
Keywords: release, checklist, build, test, pre-commit, verification
Agents: release
When to use: Before declaring a sprint complete or pushing the final commit.
Version: 1.0.0
Last updated: 2026-03-10

Pre-release verification checklist: builds, tests, i18n, documentation, stats, and deferred work markers. All items must pass — no exceptions. Maps to SPRINTS.md Step D.5.

---

## Checklist

### 1. Builds pass

```bash
npx tsc -p src/shared/tsconfig.json
npx tsc -p src/backend/tsconfig.json
npx tsc -p src/frontend/tsconfig.json --noEmit
```

### 2. Tests pass

```bash
npm run test:all
```

### 3. i18n complete

```bash
grep -r 'TODO: translate' src/shared/src/i18n/  # Must return zero
bash agent-os/scripts/check-i18n-completeness.sh          # Must exit 0
```

### 4. Documentation complete

Verify all 9 mandatory doc files are modified in the branch:

```bash
git diff --name-only main -- docs/release-notes/ docs/developer-handoff.md docs/product/phases/ CLAUDE.md README.md
```

### 5. No deferred work markers

```bash
git diff --name-only main | xargs grep -l 'FIXME\|HACK\|XXX' 2>/dev/null || true  # Must return zero
```

### 6. Codebase stats current

Verify README.md stats match reality using SPRINTS.md E6 commands.

### 7. Commit message format

1–2 sentence summary of the "why", not the "what".

## Input Schema

```yaml
input:
  branch_name:
    type: string
    required: true
    description: "Feature branch being validated for release"
  base_branch:
    type: string
    required: false
    default: "main"
    description: "Base branch to diff against for documentation and marker checks"
```

## Output Schema

```yaml
output:
  checks_passed:
    type: integer
    description: "Number of checklist items that passed"
  checks_total:
    type: integer
    description: "Total number of checklist items (7)"
  failures:
    type: array
    items:
      type: object
      properties:
        check_number: integer
        check_name: string
        error_detail: string
    description: "List of failed checks with details"
  release_ready:
    type: boolean
    description: "True only if all 7 checks pass"
```

## Quality Gate

- All three TypeScript builds (shared, backend, frontend) complete with zero errors
- `npm run test:all` exits with code 0
- No `FIXME`, `HACK`, or `XXX` markers in changed files
- All 9 mandatory documentation files show as modified in the branch diff

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "release-checklist"
  stage: "S5"
  suggested_next:
    - slug: "branch-completion"
      stage: "S5"
      reason: "Once all release checks pass, proceed to branch integration or PR creation"
```

## Error Handling

- If the build fails at the shared layer, do not proceed to backend/frontend builds — report the shared errors first
- If `npm run test:all` hangs for more than 10 minutes, terminate and report a timeout
- If `git diff --name-only` fails (e.g., base branch not found), fall back to checking files against the working tree
