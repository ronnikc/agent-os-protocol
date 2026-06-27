Title: Verification Gate
Keywords: verification, evidence, completion, claims, testing, build, proof, assertion, gate
Agents: backend, frontend, api, test, build-integrity, code-review, release, infrastructure, planning, compliance, security, i18n, accessibility, documentation
When to use: When about to claim work is complete, fixed, or passing — before committing, creating PRs, or marking tasks done. Requires running verification commands and confirming output before making any success claims.
Version: 1.0.0
Last updated: 2026-03-18

No completion claims without fresh verification evidence. Claiming work is complete without verification is dishonesty, not efficiency. This skill applies to ALL agents across ALL sprint gates.

---

## The Iron Law

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
```

If you haven't run the verification command in this response, you cannot claim it passes.

---

## The Gate Function

```
BEFORE claiming any status:

1. IDENTIFY: What command proves this claim?
2. RUN: Execute the FULL command (fresh, complete)
3. READ: Full output, check exit code, count failures
4. VERIFY: Does output confirm the claim?
   - If NO: State actual status with evidence
   - If YES: State claim WITH evidence
5. ONLY THEN: Make the claim

Skip any step = unverified claim
```

---

## Common Claims and Required Evidence

| Claim | Requires | Not Sufficient |
|-------|----------|----------------|
| "Tests pass" | Test command output: 0 failures | Previous run, "should pass" |
| "Linter clean" | Linter output: 0 errors | Partial check, extrapolation |
| "Build succeeds" | Build command: exit 0 | Linter passing, "logs look good" |
| "Bug fixed" | Test original symptom: passes | "Code changed, assumed fixed" |
| "Regression test works" | Red-green cycle verified | Test passes once |
| "Sub-agent completed" | VCS diff shows changes | Agent reports "success" |
| "Requirements met" | Line-by-line checklist | "Tests passing" |
| "i18n complete" | All 16 locales verified | "Keys added" |
| "Sprint complete" | All Gates 0-5 verified | "All tasks done" |

---

## Verification Patterns

### Tests

```
✅ [Run test command] → [See: 34/34 pass] → "All tests pass"
❌ "Should pass now" / "Looks correct"
```

### Build

```
✅ [Run build: shared → backend → frontend] → [See: exit 0 each] → "Build passes"
❌ "Linter passed" (linter doesn't check compilation)
```

### Requirements

```
✅ Re-read sprint spec → Create checklist → Verify each → Report gaps or completion
❌ "Tests pass, sprint complete"
```

### Sub-Agent Delegation

```
✅ Agent reports success → Check VCS diff → Verify changes exist → Report actual state
❌ Trust agent report without verification
```

### Sprint Gate Verification

```
✅ Run each gate command → Read output → Confirm pass → Report with evidence
❌ "Gates should pass based on the work done"
```

---

## Red Flags — STOP

If you catch yourself:
- Using "should", "probably", "seems to", "looks like"
- Expressing satisfaction before verification ("Great!", "Perfect!", "Done!")
- About to commit/push/PR without running verification
- Trusting sub-agent success reports without checking
- Relying on partial verification ("I checked the backend, frontend should be fine")
- Thinking "just this once"
- **ANY wording implying success without having run verification**

**ALL of these mean: STOP. Run the verification command.**

---

## Rationalization Prevention

| Excuse | Reality |
|--------|---------|
| "Should work now" | RUN the verification |
| "I'm confident" | Confidence ≠ evidence |
| "Just this once" | No exceptions |
| "Linter passed" | Linter ≠ compiler ≠ tests |
| "Agent said success" | Verify independently |
| "Partial check is enough" | Partial proves nothing |
| "Different words so rule doesn't apply" | Spirit over letter |

---

## When to Apply

**ALWAYS before:**
- ANY variation of success/completion claims
- ANY positive statement about work state
- Committing, PR creation, task completion
- Moving to next task
- Marking sprint gates as passed
- Returning results from sub-agent work
- Declaring sprint complete

This is non-negotiable. Run the command. Read the output. THEN claim the result.

## Input Schema

```yaml
claim: string              # The completion claim being made (e.g., "tests pass", "build succeeds")
verification_command: string # The command that proves or disproves the claim
scope: enum                # "unit_test" | "build" | "lint" | "integration" | "sprint_gate" | "sub_agent" | "requirements"
```

## Output Schema

```yaml
output_schema_version: "1.0.0"
claim: string
verified: boolean
evidence: string           # Actual command output or summary
exit_code: number          # Command exit code
failures: number           # Count of failures (0 = clean)
verdict: enum              # "confirmed" | "refuted" | "partial"
```

## Quality Gate

Before returning:
1. The verification command was actually executed (not assumed from prior runs)
2. Full output was read — not just exit code but actual failure details
3. The claim matches the evidence — no "tests pass" when 2 failures exist
4. If verdict is "refuted", specific failure details are included

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "verification-gate"
  stage: "S3"
  suggested_next:
    - slug: "root-cause-debugging"
      stage: "S3"
      reason: "When verification fails, debug the root cause"
    - slug: "sprint-gate-enforcement"
      stage: "S2"
      reason: "Verification gate feeds into sprint gate checks"
    - slug: "branch-completion"
      stage: "S5"
      reason: "After verification passes, proceed to branch completion"
```

## Error Handling

- If the verification command fails to execute (not found, timeout), report as "unverifiable" — never default to pass
- If output is too large to read fully, focus on summary lines (pass/fail counts, exit code)
- If verification scope is ambiguous, default to the broadest applicable scope
- If sub-agent reports conflict with verification output, trust the verification output
