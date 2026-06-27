Title: Coverage Enforcement
Keywords: coverage, ci, thresholds, vitest, statements, branches, functions, testing
Agents: test, backend, frontend
When to use: When verifying CI coverage thresholds are met, identifying uncovered code paths, or ensuring new code has adequate test coverage.
Version: 1.0.0
Last updated: 2026-03-10

CI coverage thresholds enforced on every commit. Backend: 60% statements, 50% branches, 60% functions. Frontend: 55% statements. Check with `npm run test:all`. Coverage must be met on the same commit — no "follow-up test PR" debt. Use coverage reports to identify uncovered paths.

---

## Coverage Thresholds

| Scope | Metric | Threshold | Enforced since |
|-------|--------|-----------|---------------|
| Backend | Statements | 60% | Sprint 12.4.0 |
| Backend | Branches | 50% | Sprint 12.4.0 |
| Backend | Functions | 60% | Sprint 12.4.0 |
| Frontend | Statements | 55% | Sprint 12.4.2 |
| Frontend | Branches | 30% | Sprint 12.4.0 |
| Frontend | Functions | 10% | Sprint 12.4.0 |
| Frontend | Lines | 30% | Sprint 12.4.0 |
| Per-module backend | Varies | 70-80% | Sprints 11.9.0-12.2.0 |

**These are CI gates, not aspirational targets.** If CI fails on coverage, fix it. Never lower a threshold without explicit approval.

## Workflow

### Step 1 — Run Tests with Coverage

```bash
# Run all tests with coverage
npm run test:all

# Run only backend tests
cd the backend && npx vitest run --coverage

# Run only frontend tests
cd the frontend && npx vitest run --coverage
```

### Step 2 — Read the Coverage Report

After running tests, check the coverage summary:

```
# Coverage report is printed to stdout. Key lines:
# Statements   : 62.5% ( 1250/2000 )
# Branches     : 51.2% ( 400/781 )
# Functions    : 63.1% ( 240/380 )
# Lines        : 61.8% ( 1230/1990 )
```

### Step 3 — Identify Uncovered Paths

When coverage drops below the threshold after new code:

1. **Find the new/modified service file:**
   ```
   Glob: the backend modules
   ```

2. **Check if a test file exists:**
   ```
   Glob: the backend modules
   ```

3. **If test exists, find uncovered methods:**
   - Read the coverage detail for the specific file
   - Look for functions/branches with 0% coverage
   - These are the methods that need tests

4. **If no test exists, create one** following the test-patterns skill.

### Step 4 — Common Coverage Gaps

| Gap type | How to detect | Fix |
|----------|--------------|-----|
| No test file for new service | `Glob` for `__tests__/*.test.ts` returns nothing | Create test file following test-patterns |
| Error paths untested | Branches < threshold | Add tests for AppError throws (validation, not-found, conflict) |
| Audit log untested | Functions < threshold (private auditLog) | Verify audit collection after state-changing operations |
| Edge cases untested | Branches < threshold | Add tests for empty inputs, boundary values, concurrent operations |
| New frontend page untested | Frontend statements drop | Create component test with mock API client |

### Step 5 — Enforce Same-Commit Coverage

**Rule: Coverage must be met on the same commit as the feature code.** No "I'll add tests in a follow-up PR."

When implementing a new module:
1. Write the service code
2. Write the test file in the same commit
3. Run `npm run test:all` to verify thresholds
4. If coverage drops, add more tests before committing

### Step 6 — Per-Module Thresholds

Some modules have higher thresholds (70-80%) set in their vitest config. Check:

```
Grep: pattern="coverageThreshold|thresholds", path="the backendvitest.config.ts"
Grep: pattern="coverageThreshold|thresholds", path="the frontendvitest.config.ts"
```

Per-module thresholds override global thresholds. If a module has an 80% threshold, it must meet 80% even if the global threshold is 60%.

## Rules

- **Never lower thresholds** to make CI pass. Fix the coverage instead.
- **Never set thresholds higher than actual coverage** — this breaks CI. Thresholds must reflect reality.
- **Coverage debt is not allowed.** Every PR must meet thresholds independently.
- **Prefer meaningful tests over coverage gaming.** Testing trivial getters to hit a number is worthless. Test business logic and error paths.
- **Mock method names must match real signatures** — wrong names pass vitest but fail `tsc --noEmit`, creating false confidence.

## Quick Verification

```bash
# Verify thresholds are met
npm run test:all

# If failing, check which files are below threshold
# Look at the per-file coverage table in the output
# Focus on files with < 60% statements (backend) or < 55% (frontend)
```

## Checklist

- [ ] `npm run test:all` passes
- [ ] Backend statements >= 60%
- [ ] Backend branches >= 50%
- [ ] Backend functions >= 60%
- [ ] Frontend statements >= 55%
- [ ] No new uncovered service files
- [ ] Error paths tested (validation, not-found, conflict)
- [ ] Coverage met on same commit as feature code

## Input Schema

```yaml
input:
  scope:
    type: enum[all, backend, frontend, module]
    required: true
    description: "Which coverage scope to verify"
  module_name:
    type: string
    required: false
    description: "Specific module name (required when scope=module)"
  fix_mode:
    type: boolean
    required: false
    default: false
    description: "When true, identify and suggest fixes for uncovered paths"
```

## Output Schema

```yaml
output:
  thresholds_met:
    type: boolean
    description: "Whether all applicable coverage thresholds pass"
  coverage_report:
    type: object
    properties:
      statements:
        type: number
      branches:
        type: number
      functions:
        type: number
      lines:
        type: number
  gaps:
    type: array
    items:
      file:
        type: string
      metric:
        type: string
      actual:
        type: number
      threshold:
        type: number
  suggested_fixes:
    type: array
    required: false
    description: "Populated when fix_mode=true"
```

## Quality Gate

- `npm run test:all` has been executed and the output parsed — no stale or cached results.
- All threshold comparisons use the exact values from vitest config, not approximations.
- Any coverage gaps are reported with specific file paths and uncovered methods.
- Same-commit rule is confirmed — no deferred test debt.

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "coverage-enforcement"
  stage: "S1"
  suggested_next:
    - slug: "impact-analysis"
      stage: "S1"
      reason: "Verify that newly covered paths align with the change's blast radius"
    - slug: "task-routing"
      stage: "S1"
      reason: "Route uncovered modules to the correct agent for test creation"
```

## Error Handling

- If `npm run test:all` fails with a non-coverage error (e.g., compilation error), report the build failure and halt coverage analysis.
- If per-module thresholds conflict with global thresholds, the stricter (per-module) threshold takes precedence.
- If coverage report output format changes (e.g., vitest upgrade), flag the parsing failure and report raw output.
- If a test file exists but all tests are skipped, treat coverage as "Uncovered" for that file.
