Title: Persona & Use-Case Validation
Keywords: persona, use-case, acceptance, user-validation, journey, fit-for-purpose, traceability
Agents: user-validation, product-qa, product, ux
When to use: When validating a plan or an implementation against the project's defined user personas and use cases — confirming the work actually serves the people who will use it, not just that the code compiles. Use during sprint planning (does the plan cover the relevant journeys?) and at close-out (does the implementation satisfy each use case end-to-end?).
Version: 1.0.0
Last updated: 2026-06-28

Validate that work is **fit for the people who will use it**. The base platform ships **no personas or use cases of its own** — they are project-specific artifacts the team defines (or trains an agent on via `/train`). This skill is the generic procedure for checking a plan or implementation against whatever persona / use-case set the project has declared.

If the project has not declared personas or use cases, this skill's first job is to say so and recommend defining them — do not invent them silently.

---

## Workflow

1. **Locate the source of truth.** Find the project's declared personas and use cases (e.g. a `personas.md` / `use-cases.md`, a trained pack, or a linked spec). If none exist, report that and stop — recommend the team define them before validation can be meaningful.

2. **Scope the validation.** Identify which personas and use cases are in scope for the work under review (a sprint, a feature, a module). Not every persona touches every change.

3. **Build a traceability map.** For each in-scope use case, list the concrete steps of the journey and map each step to the part of the plan or implementation that satisfies it. A use case with no mapped implementation is a gap.

4. **Walk each journey as the persona.** For each persona, walk their primary journey through the actual implementation (or the plan's described flow). Note friction, dead ends, missing affordances, and steps that assume knowledge the persona does not have.

5. **Check non-functional fit.** Confirm the work respects the persona's constraints (e.g. accessibility needs, permission/role boundaries, language, device) — not just the happy path.

6. **Record verdicts.** For each use case: `satisfied` / `partial` / `not-met`, with the evidence (where it is satisfied) or the specific gap. For each persona: a fit summary.

7. **Escalate gaps.** Route `not-met` / `partial` findings to the owning specialist (frontend, backend, ux, …) as concrete follow-ups; do not mark the work validated while material gaps remain.

---

## Input Schema

```yaml
inputs:
  scope:
    type: string
    description: "What is being validated (sprint id, feature, or module path)"
  personas_source:
    type: string
    description: "Path or reference to the project's declared personas (required — not shipped by the platform)"
  usecases_source:
    type: string
    description: "Path or reference to the project's declared use cases"
  artifact:
    type: string
    description: "What to validate against — a plan/spec path, or a running implementation"
  mode:
    type: string
    enum: ["plan", "implementation"]
    description: "Validate a forward-looking plan or a built implementation"
```

## Output Schema

```yaml
outputs:
  personas_source_found:
    type: boolean
    description: "False means validation could not run — personas/use cases are undefined"
  usecase_results:
    type: array
    description: "Per use case: { id, verdict: satisfied|partial|not-met, evidence_or_gap }"
  persona_fit:
    type: array
    description: "Per persona: { id, fit_summary, friction_points[] }"
  gaps:
    type: array
    description: "Actionable follow-ups routed to owning specialists"
  overall:
    type: string
    enum: ["validated", "validated-with-gaps", "not-validated"]
```

## Quality Gate

- Personas/use cases come from a declared project source — never invented by this skill
- Every in-scope use case has an explicit verdict with evidence or a named gap
- Every persona's primary journey has been walked, not just inspected statically
- No `not-met` use case is left unrouted to an owning specialist
- A missing personas/use-case source yields `not-validated` (fail-closed), not a false pass

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "persona-usecase-validation"
  stage: "S1"
  suggested_next:
    - slug: "module-production-review"
      stage: "S1"
      reason: "After persona/use-case fit, run a systematic production-readiness review of the module's views"
    - slug: "verification-gate"
      stage: "S1"
      reason: "Fold the persona/use-case verdicts into the close-out verification gate"
```

## Error Handling

- If no personas/use cases are declared for the project, report `personas_source_found: false`, return `not-validated`, and recommend defining them (optionally via `/train`) — do not fabricate them
- If the scope references a use case not present in the source, flag it as an undefined reference rather than guessing intent
- If validating in `plan` mode, base verdicts on the plan's described flow and mark them provisional until re-validated against the implementation
- If a persona's journey cannot be completed in `implementation` mode, record exactly which step blocks and route it as a `not-met` gap
