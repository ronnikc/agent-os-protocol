Title: Sprint Gate Enforcement
Keywords: gate, enforcement, pre-sprint, close-out, blocking, verification, E0-E11, Gate-2, Gate-1, sprint-lifecycle, compliance
Agents: sprint-gate-enforcer, planning
When to use: At exactly two mandatory checkpoints in every sprint: before implementation starts (pre-gates) and before declaring sprint complete (close-out gates).
Version: 1.0.0
Last updated: 2026-03-18

Run consolidated gate checks at two mandatory sprint checkpoints using `sprint-gate-runner.sh`. Automated checks produce pass/fail exit codes. Manual items are verified by the Sprint Gate Enforcer agent. Sprint is BLOCKED on any automated failure. No exceptions.

---

## Mandatory Invocation Points

The orchestrator MUST invoke the Sprint Gate Enforcer agent at these two points:

```
Sprint Lifecycle:

  1. Sprint spec identified
  2. ──▶ INVOKE: Sprint Gate Enforcer (--pre)  ◀── MANDATORY
  3. Gate Enforcer reports PASS or BLOCKED
  4. If BLOCKED → fix → re-invoke (repeat until PASS)
  5. If PASS → proceed to implementation
  6. Implementation (sub-agents, coding, testing)
  7. Implementation complete
  8. ──▶ INVOKE: Sprint Gate Enforcer (--close) ◀── MANDATORY
  9. Gate Enforcer reports PASS or BLOCKED
  10. If BLOCKED → fix → re-invoke (repeat until PASS)
  11. If PASS → close-out commit, PR, declare done
```

---

## Pre-Implementation Check

```bash
bash agent-os/scripts/sprint-gate-runner.sh --pre <sprint-spec.md> [workfile.md]
```

**What it checks (automated):**
- Gate -2: Sprint spec structure (9 checks via `lint-sprint-spec.sh`)
- Gate -1: Work file exists, acceptance criteria present, i18n agent planned, user validation for regulated workflows
- C.1/C.2: API Contract Trace and Form Completeness Gate sections present
- Accessibility Specialist referenced

**What requires manual verification:**
- Close-out planned in sprint scope
- Sub-agent assignment is explicit
- Work file has header and baseline

---

## Close-Out Check

```bash
bash agent-os/scripts/sprint-gate-runner.sh --close <sprint-spec.md> <workfile.md>
```

**What it checks (automated):**
- E1: Build verification (shared → backend → frontend, 0 errors each)
- E2: All tests pass
- D.5.1: No `TODO: translate` stubs, i18n completeness script passes
- D.5.3: No FIXME/HACK/XXX markers in changed files
- E3: Release notes, README.md, CLAUDE.md modified in branch
- E7: Housekeeping lint passes (governance file counts consistent)
- E8: I18N Specialist referenced in work file (if sprint has i18n)
- E9: Work file has Lessons Learned section (minimum 2 entries), Deferred section exists

**What requires manual verification:**
- E0: Every acceptance criterion has status (Done/Deferred)
- E0: Deferred items have follow-up sprint numbers
- E3: README Codebase Stats match E6 output
- E8: Non-EN locales have real translations (not EN copies)
- E9B: Sub-agent memory files updated
- E11: Self-verification checklist output to user
- STATE.md updated, ARCHITECTURE.md if structure changed, RULES.md if new rule

---

## Handling Failures

| Exit Code | Meaning | Action |
|-----------|---------|--------|
| 0 | All automated checks pass | Verify manual items, then proceed |
| 1+ | N automated checks failed | BLOCKED — fix failures, re-invoke |

**Re-invocation is mandatory after fixes.** The orchestrator cannot self-certify that fixes are correct. The Gate Enforcer must re-run the script.

---

## Integration with Sprint Workflows

This skill replaces the previous approach of embedding gate checklists inline in SPRINTS.md. The gate definitions remain in SPRINTS.md as reference documentation, but enforcement is now:

1. **Automated** via `sprint-gate-runner.sh`
2. **Agent-verified** via the Sprint Gate Enforcer
3. **Blocking** — exit code non-zero = sprint cannot proceed

The Sprint Gate Enforcer agent is the ONLY agent that can certify gate compliance. The orchestrator invoking it is non-negotiable.

---

## Checklist

- [ ] Sprint Gate Enforcer invoked BEFORE implementation (--pre mode)
- [ ] Pre-gate check returned PASS (exit code 0)
- [ ] All manual pre-gate items verified
- [ ] Implementation completed
- [ ] Sprint Gate Enforcer invoked BEFORE close-out commit (--close mode)
- [ ] Close-out check returned PASS (exit code 0)
- [ ] All manual close-out items verified
- [ ] E11 self-verification checklist output to user
- [ ] Close-out committed and pushed

## Input Schema

```yaml
input:
  mode:
    type: string
    required: true
    enum: ["--pre", "--close"]
    description: "Gate check mode: --pre for pre-implementation, --close for close-out"
  sprint_spec_path:
    type: string
    required: true
    description: "Path to the sprint spec markdown file"
  workfile_path:
    type: string
    required: false
    description: "Path to the sprint work file (required for --close mode)"
```

## Output Schema

```yaml
output:
  gate_result:
    type: object
    description: "Consolidated gate check result"
    properties:
      mode:
        type: string
      exit_code:
        type: integer
      status:
        type: "PASS | BLOCKED"
      automated_checks:
        type: array
        items:
          type: object
          properties:
            gate_id: string
            description: string
            result: "pass | fail"
      manual_checks:
        type: array
        items:
          type: object
          properties:
            gate_id: string
            description: string
            verified: boolean
      blocking_failures:
        type: integer
```

## Quality Gate

- The sprint-gate-runner.sh script returns exit code 0 for all automated checks.
- All manual verification items have been explicitly confirmed by the Sprint Gate Enforcer agent.
- Re-invocation was performed after any fixes (no self-certification of fixes).
- E11 self-verification checklist has been output to the user (close-out mode only).

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "sprint-gate-enforcement"
  stage: "S2"
  suggested_next:
    - slug: "runtime-verification"
      stage: "S3"
      reason: "Run full runtime verification as part of close-out gate compliance"
    - slug: "verification-gate"
      stage: "S3"
      reason: "Verify all gate claims have fresh evidence before declaring sprint complete"
```

## Error Handling

- If sprint-gate-runner.sh is missing or not executable, report the missing script path and block the sprint until the script is restored.
- If the sprint spec file cannot be found at the given path, prompt for the correct path rather than skipping the gate check.
- If automated checks fail but manual verification passes, the sprint remains BLOCKED — automated failures are non-negotiable and must be fixed before re-invocation.
