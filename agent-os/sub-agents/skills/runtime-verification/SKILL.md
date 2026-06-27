Title: Runtime Verification
Keywords: verify, build, test, lint, type-check, runtime, quality-gate
Agents: build-integrity, sprint-gate-enforcer, code-review
When to use: When verifying that the codebase is in a clean state — all types compile, tests pass, lint is clean. Used before commits, before close-out, and after agent work.
Version: 1.0.0
Last updated: 2026-03-21

Run comprehensive runtime verification checks to ensure codebase health. Two modes: quick (type-check only, ~10s) and full (type-check + lint + tests + security, ~3-5 min).

---

## Workflow

### Step 1 — Choose Verification Mode

| Mode | When to Use | Duration |
|------|-------------|----------|
| `--quick` | After single file edits, during development | ~10 seconds |
| `--full` | Before commits, before close-out, after agent work | ~3-5 minutes |

### Step 2 — Run Verification

```bash
# Quick verification (type-check only)
bash agent-os/scripts/runtime-verify.sh --quick

# Full verification (type-check + lint + tests + security)
bash agent-os/scripts/runtime-verify.sh --full
```

### Step 3 — Interpret Results

Exit code 0 = all checks pass. Any non-zero = failures found.

The script reports each check individually:
```
[1] Building shared types...    PASS/FAIL
[2] Type-checking backend...    PASS/FAIL
[3] Type-checking frontend...   PASS/FAIL
[4] Running linter...           PASS/FAIL (full only)
[5] Running tests...            PASS/FAIL (full only)
[6] Security audit...           PASS/WARN (full only)
[7] Governance lint...          PASS/WARN (full only)
```

### Step 4 — Handle Failures

| Failure | Action |
|---------|--------|
| Shared compile error | Fix first — backend and frontend depend on it (R-01) |
| Backend type error | Fix before frontend (build order) |
| Frontend type error | Fix after shared and backend are clean |
| Lint error | Fix before commit |
| Test failure | Investigate — is it your change or pre-existing? Use stash-verify-pop pattern |
| Security warning | Review but don't block (advisory unless audit-level=critical) |

### Step 5 — Integration Points

| Gate | Verification Mode | Required By |
|------|-------------------|-------------|
| Pre-commit hook | `--quick` | Every commit |
| Gate -1 (pre-implementation) | `--quick` | SPRINTS.md |
| Gate E1 (close-out build check) | `--full` | SPRINTS.md |
| Agent self-verification | `--quick` | SUB-AGENTS.md |
| Sprint Gate Enforcer --close | `--full` | SPRINTS.md |

### Rules

1. **Never skip verification** to save time — it always costs more time later
2. **Run `--quick` after every agent completes** — catch type errors before they propagate
3. **Run `--full` before declaring any sprint done** — the gate is mandatory
4. **If tests fail after your change:** use `git stash && npx vitest run && git stash pop` to isolate whether the failure is pre-existing
5. **Verification is not optional for "simple" changes** — Phase 21 proved every exception becomes the rule

## Input Schema

```yaml
input:
  mode:
    type: string
    required: true
    enum: ["--quick", "--full"]
    description: "Verification mode: --quick for type-check only, --full for type-check + lint + tests + security"
  working_directory:
    type: string
    required: false
    default: "."
    description: "Root directory of the project to verify"
```

## Output Schema

```yaml
output:
  verification_result:
    type: object
    description: "Runtime verification check results"
    properties:
      mode:
        type: string
      exit_code:
        type: integer
      checks:
        type: array
        items:
          type: object
          properties:
            step: integer
            name: string
            result: "PASS | FAIL | WARN"
      overall_status:
        type: "PASS | FAIL"
      failure_summary:
        type: string
```

## Quality Gate

- All checks in the selected mode return PASS (exit code 0).
- Shared types compile successfully before backend and frontend checks run.
- Any test failures have been isolated to determine if they are pre-existing or caused by recent changes.

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "runtime-verification"
  stage: "S3"
  suggested_next:
    - slug: "sprint-gate-enforcement"
      stage: "S2"
      reason: "Feed verification results into sprint gate checks for close-out compliance"
    - slug: "review-request"
      stage: "S2"
      reason: "Request code review after verification confirms the codebase is clean"
```

## Error Handling

- If the runtime-verify.sh script is missing or not executable, report the missing script and fall back to running individual type-check commands manually (shared, backend, frontend in order).
- If shared type compilation fails, skip backend and frontend checks and report that downstream verification is blocked until shared types are fixed.
- If test failures are detected, use the stash-verify-pop pattern to isolate pre-existing failures from new regressions before reporting results.
