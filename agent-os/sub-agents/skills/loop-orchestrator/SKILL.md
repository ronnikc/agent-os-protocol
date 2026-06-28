Title: Loop Orchestrator
Keywords: loop-mode, boss, control-loop, iterate, exit-criteria, convergence, budget, checkpoint, autonomous
Agents: boss-agent
When to use: When the Boss runs a work item in **Loop Mode** — iterating plan→build→verify→reflect→fix until the loop's measurable exit criteria pass or a cap/budget is reached. Attended or (explicitly opted-in) unattended; local or swarm.
Slug: loop-orchestrator
Last updated: Phase 11

The Boss's capability for **Loop Mode** (§12B): drive a control loop over a work item that carries
a `LoopSpec` (authored via `create-loop`), using the `@agent-os/loop` engine. Loop Mode
**complements** Sprint Mode — it does not replace it; both share the §12A work-item schema and the
same gate skills. One iteration is **Assess → Delegate → Verify → Reflect → Decide**, mapped onto
the existing five lobby phases so no new coordination protocol is needed.

> The engine (`LoopOrchestrator` in `@agent-os/loop`) enforces every safety rule mechanically. This
> skill is how the Boss *supplies the seams* (evaluate via gate skills, delegate via the lobby) and
> honours the loop's checkpoints and mode.

---

## Workflow (one iteration = Assess → Delegate → Verify → Reflect → Decide)

1. **Load the loop.** Read `Sprint.loop` (`LoopSpec`). If absent/invalid, stop — author one with
   `create-loop` first. Confirm the run **mode**: attended by default; unattended only if the
   operator enabled it for this loop (Panel mode-changer) with an action allowlist.

2. **Assess.** Evaluate every `exitCriterion` against the current state — this is the engine's
   `evaluate` seam. Each criterion maps to a gate skill / test run / review:
   - `gate` → run the named gate skill (`build-validation`, `verification-gate`,
     `coverage-enforcement`, …) and compare to any threshold;
   - `tests` → run the suite; pass only if green;
   - `review` → request the named approver (a specialist or a human);
   - `assertion` → check the expression.
   The gap = the failing criteria.

3. **Delegate.** Assign work to close the gap — the engine's `delegate` seam — via the **normal
   Boss dispatch** (named specialist, ACK required, never broadcast `*`). Report resource usage
   (tokens/cost) back so the engine accrues budget.

4. **Verify.** Re-run Assess. The engine adopts the new results **only if** no
   previously-passing criterion regressed (regression guard); a regressing result is rejected.

5. **Reflect.** The engine records progress and an audit event. If there is no improvement for the
   stall window, it stops (`stalled`).

6. **Decide.** Converged (all pass) → `onConverge` (`stop` / `handoff` / `open-pr`). Otherwise
   continue until `maxIterations` / `budget` → `onExhaust` (`stop-and-report` / `escalate-to-human`).

## Safety the Boss must honour (the engine enforces; do not route around it)

- **Hard caps:** `maxIterations` + `budget` (tokens/cost/wall-clock). On exhaustion, stop and report.
- **Regression guard:** never accept an iteration that flips a passing criterion to failing.
- **Stall guard:** stop when N iterations make no progress (anti-churn).
- **Approval checkpoints:** `commit` / `merge` / `deploy` / `scope-change` stay **human-gated by
  default** (the engine pauses `awaiting_checkpoint` until approved — consistent with the Boss's
  "no autonomous approvals" rule).
- **Unattended is OFF by default (Ronni-locked).** It runs unattended only when an operator opted
  in for this loop; even then, only **allowlisted** actions auto-approve — everything else pauses.
  Always surface whether a loop is running attended or unattended.
- **Kill switch + audit:** every iteration is auditable and a human can stop the loop at any time.
- **Swarm:** unattended swarm loops require verified identities in a private lobby (Phase 8).

## Input Schema

```yaml
inputs:
  sprintId:
    type: string
    description: "The sprint whose Sprint.loop drives this run"
  mode:
    type: string
    enum: ["attended", "unattended"]
    description: "unattended only if the operator enabled it for this loop"
  allowlist:
    type: array
    description: "Actions auto-approved when unattended (subset of the approvalCheckpoints)"
```

## Output Schema

```yaml
outputs:
  status:
    type: string
    enum: ["converged", "exhausted", "stalled", "killed", "awaiting_checkpoint", "error"]
  iterations:
    type: integer
  passing:
    type: string
    description: "criteria passing / total"
  budgetUsed:
    type: object
  pendingAction:
    type: string
    description: "set when awaiting_checkpoint — the action needing human approval"
```

## Quality Gate

- The loop ran against a **valid** `LoopSpec` (never an unbounded or criteria-less loop)
- Every delegation used named-specialist dispatch with ACK — never a broadcast
- No irreversible action was taken without approval (or an explicit unattended allowlist entry)
- The run mode (attended/unattended) was surfaced; the audit trail is complete and stoppable
- On exhaust/stall, the Boss reported the gap (which criteria still fail) — not a silent stop

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "loop-orchestrator"
  stage: "S1"
  suggested_next:
    - slug: "verification-gate"
      stage: "S1"
      reason: "Exit criteria are gate skills — verification-gate is the canonical converge check"
    - slug: "review-request"
      stage: "S1"
      reason: "A review-type exit criterion or an approval checkpoint requests a reviewer"
```

## Error Handling

- Missing/invalid `Sprint.loop` → stop and route to `create-loop`; never improvise an unbounded loop.
- `awaiting_checkpoint` → surface the pending action to the human and wait; do not self-approve.
- Repeated `stalled`/`regression_blocked` → escalate with the failing-criteria diff rather than
  re-running the same delegation.
- An unattended request without operator opt-in → run attended and say so.
