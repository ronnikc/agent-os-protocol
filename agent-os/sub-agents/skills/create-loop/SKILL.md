Title: Create Loop
Keywords: work-item, loop, loop-mode, exit-criteria, authoring, canonical-schema, create-loop
Slug: create-loop
Scope: Author a valid `LoopSpec` (Loop Mode) on a work item so it iterates until measurable exit criteria pass — safely.
Last updated: Phase 11

Owns the rules for attaching a **Loop Mode** spec to a work item (§12B). Pairs with
`create-phase` / `create-sprint` / `create-task`: those define *what* the work is; this defines
*how to iterate to done* — the machine-checkable conditions under which the Boss's control loop
(`loop-orchestrator`, engine `@agent-os/loop`) is allowed to stop. The canonical type is
`LoopSpec` in `@agent-os/protocol-core`; a loop attaches to a `Sprint` via `Sprint.loop`.

> **"Until perfection" must be operationalized.** A loop with vague success ("make it perfect")
> never converges and burns budget. This skill's central job is to force **measurable**
> `exitCriteria`. If you cannot state a criterion a machine can check, it is not an exit criterion.

---

## Workflow

1. **State the goal** — one outcome-focused sentence (`goal`). Not a task list; the *done* state.

2. **Define machine-checkable `exitCriteria` (≥1; ALL must pass to converge).** Reuse the gate
   skills — every criterion is one of:
   - `{ type: 'gate', skill: '<gate-skill>', threshold? }` — e.g. `build-validation`,
     `verification-gate`, `coverage-enforcement` (with a numeric threshold where relevant).
   - `{ type: 'tests', mustPass: true }`.
   - `{ type: 'review', approver: 'code-review' | 'product-qa' | 'human' }`.
   - `{ type: 'assertion', expr: '<machine-checkable expression>' }`.

3. **Set the hard caps.** `maxIterations` (a positive integer — never unbounded) and an optional
   `budget` (`tokens` / `costUSD` / `wallClockMin`). The loop halts and reports on either.

4. **Pick a `strategy`** — `fix-forward` (default), `tdd`, `review-driven`, or `custom`.

5. **Gate irreversible actions.** List `approvalCheckpoints` — any of
   `commit` / `merge` / `deploy` / `scope-change` that must stay human-approved. **Default: gate
   all of them.** Do not narrow this without a reason recorded in the goal/notes.

6. **Leave `unattended` OFF (default).** Set `unattended: true` ONLY for a loop intended to run
   without a human present — and even then it takes effect only when an operator explicitly enables
   it (the Panel's per-loop mode-changer) plus an allowlist of safe actions. **Never** set it to
   bypass a checkpoint.

7. **Choose end behaviour.** `onConverge`: `stop` | `handoff` | `open-pr`. `onExhaust`:
   `stop-and-report` | `escalate-to-human`.

8. **Validate.** The engine rejects an empty `exitCriteria`, a non-positive `maxIterations`, or a
   missing `goal` (`InvalidLoopSpecError`) — author to pass that, don't rely on it to catch sloppy
   specs.

---

## Input Schema

```yaml
inputs:
  sprintId:
    type: string
    description: "The sprint this loop drives (the loop attaches to Sprint.loop)"
  goal:
    type: string
    description: "One outcome-focused sentence describing the converged state"
  exitCriteria:
    type: array
    description: "≥1 machine-checkable criteria (gate | tests | review | assertion); ALL must pass"
  maxIterations:
    type: integer
    description: "Hard cap (> 0) — no infinite loops"
  budget:
    type: object
    description: "Optional { tokens?, costUSD?, wallClockMin? }"
  strategy:
    type: string
    enum: ["fix-forward", "tdd", "review-driven", "custom"]
  approvalCheckpoints:
    type: array
    description: "Irreversible actions kept human-gated (default: all of commit/merge/deploy/scope-change)"
  unattended:
    type: boolean
    description: "Default false. True only for explicitly-operated unattended loops + an allowlist"
```

## Output Schema

```yaml
outputs:
  loopSpec:
    type: object
    description: "A valid LoopSpec attached to Sprint.loop, ready for the loop-orchestrator"
  rationale:
    type: string
    description: "Why each exit criterion proves the goal, and why any checkpoint was narrowed"
```

## Quality Gate

- `goal` is a single, outcome-focused sentence (a state, not a task list)
- `exitCriteria` is non-empty and **every** entry is machine-checkable (no prose-only criteria)
- `maxIterations` is a positive integer; a `budget` is set for any unattended loop
- `approvalCheckpoints` gates every irreversible action unless a narrowing is justified in writing
- `unattended` is `false` unless this is a deliberately-operated unattended loop with an allowlist
- The resulting spec passes the engine's validation (no `InvalidLoopSpecError`)

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "create-loop"
  stage: "S1"
  suggested_next:
    - slug: "loop-orchestrator"
      stage: "S1"
      reason: "Hand the validated LoopSpec to the Boss to run the control loop"
    - slug: "create-sprint"
      stage: "S1"
      reason: "A loop attaches to a sprint; author the sprint first if it doesn't exist"
```

## Error Handling

- If a proposed criterion cannot be made machine-checkable, do **not** encode it as an
  `exitCriterion` — record it as a manual review note and add a `review` criterion with a human
  approver instead.
- If no `maxIterations` is given, refuse to author the loop (a loop without a hard cap is invalid).
- If asked to set `unattended: true` without an allowlist or operator opt-in, author it `false` and
  explain that unattended is enabled at run time, not in the spec.
