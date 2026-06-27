Title: Design Ideation
Keywords: brainstorming, design, spec, requirements, ideation, pre-implementation, approaches, trade-offs
Agents: planning, product, ux, design, research
When to use: When starting work on a new feature, capability, or significant change that requires design exploration before implementation — especially when requirements are ambiguous or multiple approaches exist.
Version: 1.0.0
Last updated: 2026-03-18

Structured pre-implementation design process: explore context → ask clarifying questions → propose approaches with trade-offs → present design → get approval → write spec. Hard gate: no implementation without an approved design. Even "simple" projects go through this — unexamined assumptions cause the most wasted work.

---

## The Hard Gate

```
DO NOT write any code, scaffold any project, or begin implementation
until the design is presented and approved.
```

This applies to EVERY feature regardless of perceived simplicity. The design can be short (a few sentences for truly simple projects), but it MUST be presented and approved.

---

## Workflow

### Step 1 — Explore Project Context

- Check relevant files, docs, recent commits
- Understand current state of the area being changed
- Identify constraints from existing architecture

### Step 2 — Assess Scope

Before detailed questions, assess scope:
- If the request describes multiple independent subsystems, flag this immediately
- Don't spend questions refining details of a project that needs decomposition first
- If too large for a single spec, help decompose into sub-projects

### Step 3 — Ask Clarifying Questions

- **One question at a time** — don't overwhelm with multiple questions
- **Prefer multiple choice** when possible — easier to answer than open-ended
- Focus on: purpose, constraints, success criteria
- If the topic involves visual/UX questions, note for design specialist involvement

### Step 4 — Propose 2-3 Approaches

- Present options conversationally with trade-offs
- Lead with recommended option and explain why
- Include: architecture implications, effort estimate (S/M/L), risk factors

### Step 5 — Present Design

Once you understand what you're building:
- Scale each section to its complexity (a few sentences if straightforward, more if nuanced)
- Ask after each section whether it looks right
- Cover: architecture, components, data flow, error handling, testing approach
- Be ready to go back and clarify

**Design for isolation and clarity:**
- Break system into smaller units with one clear purpose each
- Well-defined interfaces between units
- Each unit can be understood and tested independently

**Working in existing codebases:**
- Follow existing patterns (see `memories/engineering-code-patterns.md`)
- Where existing code has problems that affect the work, include targeted improvements
- Don't propose unrelated refactoring

### Step 6 — Write Design Spec

After approval:
- Write the validated design to the sprint spec or a design document
- Include: goal, architecture decisions, component breakdown, data flow, acceptance criteria
- Ensure every acceptance criterion is testable

### Step 7 — Transition to Implementation

- Invoke `sprint-decomposition` to break the design into tasks
- Or invoke `implementation-planning` for detailed step-by-step plans
- Do NOT begin coding directly from the design

---

## Key Principles

- **One question at a time** — don't overwhelm
- **Multiple choice preferred** — easier to answer when possible
- **YAGNI ruthlessly** — remove unnecessary features from all designs
- **Explore alternatives** — always propose 2-3 approaches before settling
- **Incremental validation** — present design sections, get approval before moving on
- **Design for isolation** — smaller, well-bounded units are easier to implement and test

---

## Anti-Patterns

- Jumping to implementation without design ("This is too simple")
- Asking too many questions at once
- Presenting only one approach (no alternatives)
- Designing in isolation without checking existing patterns
- Over-designing — adding features nobody asked for
- Not decomposing large projects before detailed design

---

## Checklist

- [ ] Project context explored (files, docs, recent changes)
- [ ] Scope assessed (single feature or needs decomposition?)
- [ ] Clarifying questions asked (one at a time)
- [ ] 2-3 approaches proposed with trade-offs
- [ ] Design presented and approved section by section
- [ ] Design spec written with testable acceptance criteria
- [ ] Transitioned to sprint-decomposition or implementation-planning

---

## Related Skills

- `sprint-decomposition` — breaks approved design into tasks
- `implementation-planning` — creates detailed step-by-step plans
- `persona-usecase-validation` — validates design against user personas

## Input Schema

```yaml
input:
  feature_description:
    type: string
    required: true
    description: "Description of the feature, capability, or change to design"
  project_context:
    type: string
    required: false
    description: "Relevant files, docs, or recent commits providing context"
  constraints:
    type: array
    items: string
    required: false
    description: "Known constraints from existing architecture or requirements"
```

## Output Schema

```yaml
output:
  design_spec:
    type: object
    description: "Approved design specification"
    properties:
      goal:
        type: string
      approaches:
        type: array
        items:
          type: object
          properties:
            name: string
            trade_offs: string
            effort: "S | M | L"
            recommended: boolean
      selected_approach:
        type: string
      architecture_decisions:
        type: array
        items: string
      component_breakdown:
        type: array
        items: string
      acceptance_criteria:
        type: array
        items: string
      approval_status:
        type: "approved | pending | rejected"
```

## Quality Gate

- At least 2 approaches proposed with explicit trade-offs before selecting one.
- Design spec includes testable acceptance criteria for every feature requirement.
- Design has been presented section-by-section and approved before transitioning to implementation.
- YAGNI check passed — no unnecessary features included in the design.

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "design-ideation"
  stage: "S2"
  suggested_next:
    - slug: "sprint-decomposition"
      stage: "S2"
      reason: "Break the approved design into implementable sprint tasks"
    - slug: "implementation-planning"
      stage: "S2"
      reason: "Create detailed step-by-step implementation plan from design"
```

## Error Handling

- If project context files are missing or inaccessible, ask the user to clarify scope before proceeding with design exploration.
- If the feature request spans multiple independent subsystems, flag immediately and help decompose into sub-projects before detailed design.
- If no existing patterns are found in the codebase for reference, document this gap and propose a new pattern with explicit justification.
- If approval is not granted after presenting the design, iterate on feedback rather than proceeding to implementation.
