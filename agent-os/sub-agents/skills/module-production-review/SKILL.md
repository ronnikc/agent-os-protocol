Title: Module Production Review
Keywords: production-readiness, module-review, qa, views, systematic-review, close-out, fit-and-finish
Agents: product-qa, frontend, code-review
When to use: When a module / feature area is approaching done and needs a systematic, view-by-view review for production readiness — beyond a quick grep triage. Use at sprint close-out, before declaring a module shippable, or when a feature spans several screens/endpoints that must hold together as a whole.
Version: 1.0.0
Last updated: 2026-06-28

Systematically review **every view in a module** for production readiness, rather than spot-checking. A quick grep triage (see `production-readiness-scan`) finds where to look; this skill is the full, line-of-sight pass a specialist makes over each surface a user actually touches.

This is a generic procedure. It assumes nothing about the project's domain or stack — it adapts its checklist to whatever surfaces the module exposes (pages, panels, endpoints, CLI commands).

---

## Workflow

1. **Enumerate the surfaces.** List every user-facing surface in the module — each page/screen, each significant state of each screen (empty, loading, error, populated, permission-denied), and each public endpoint or command. A surface you did not enumerate is a surface you did not review.

2. **Triage first (optional).** If the module is large, run `production-readiness-scan` to point at likely hotspots — but treat its output as triage (~30% of issues), never as the review itself.

3. **Review each surface against the checklist** (A–H below), recording a verdict and evidence per surface:
   - **A. States** — empty, loading, error, and success states all handled and coherent.
   - **B. Inputs & validation** — every input validated at its boundary; bad input fails safely with a clear message.
   - **C. Permissions** — the surface respects role/permission boundaries; denied states are explicit, not blank.
   - **D. Accessibility** — keyboard reachable, labelled, announced; not colour-only signalling.
   - **E. Consistency** — shared components used (not one-off re-implementations); language/format consistent.
   - **F. Errors & recovery** — failures are caught, surfaced, and recoverable; no silent dead ends or stuck states.
   - **G. Data integrity** — no destructive action without confirmation; no irreversible default; correct identifiers.
   - **H. Performance & limits** — large/slow/edge inputs degrade gracefully; pagination/limits where unbounded.

4. **Classify findings.** Tag each finding P0 (blocks ship) / P1 (fix this sprint) / P2 (follow-up), with the surface, the checklist letter, and a concrete repro or location.

5. **Route, don't just report.** Hand P0/P1 findings to the owning specialist as actionable items; P0s block the close-out gate.

6. **Re-verify after fixes.** A finding is closed only when re-reviewed on the actual surface — not when the diff lands.

---

## Input Schema

```yaml
inputs:
  module:
    type: string
    description: "The module / feature area under review (path or name)"
  surfaces:
    type: array
    description: "Optional explicit list of surfaces; if omitted, the skill enumerates them in step 1"
  triage_first:
    type: boolean
    description: "Run production-readiness-scan as a pre-pass for large modules (default true)"
```

## Output Schema

```yaml
outputs:
  surfaces_reviewed:
    type: array
    description: "Each surface with its per-checklist (A–H) verdicts"
  findings:
    type: array
    description: "Each finding: { surface, checklist_letter, severity: P0|P1|P2, detail, location }"
  blocking:
    type: integer
    description: "Count of P0 findings — must be 0 to pass the close-out gate"
  verdict:
    type: string
    enum: ["production-ready", "ready-with-followups", "not-ready"]
```

## Quality Gate

- Every enumerated surface has a verdict against all eight checklist items (A–H)
- No surface state (empty / loading / error / denied) is skipped
- Every P0/P1 finding is routed to an owning specialist with a concrete location or repro
- `verdict: production-ready` is returned only when `blocking == 0`
- Triage (`production-readiness-scan`) is never treated as a substitute for the full review

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "module-production-review"
  stage: "S1"
  suggested_next:
    - slug: "production-readiness-scan"
      stage: "S1"
      reason: "Use as the triage pre-pass that points the full review at hotspots"
    - slug: "verification-gate"
      stage: "S1"
      reason: "Feed the P0/P1 findings into the close-out verification gate"
    - slug: "persona-usecase-validation"
      stage: "S1"
      reason: "Pair production fit-and-finish with persona/use-case fitness"
```

## Error Handling

- If surfaces cannot be fully enumerated (e.g. dynamic routes), review what is enumerable and explicitly flag the un-enumerated remainder as unreviewed — never imply full coverage
- If a surface cannot be exercised (missing data/permissions in the review environment), record it as `blocked` and request the access needed rather than passing it by default
- If the triage scan tool is unavailable, proceed with the manual review and note the missing pre-pass
- If P0 findings remain after a fix round, hold the verdict at `not-ready` until re-verified on the surface
