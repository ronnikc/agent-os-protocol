Title: Accessibility Audit
Keywords: accessibility, WCAG, audit, compliance, a11y, checklist, severity
Agents: accessibility, ux
When to use: When auditing new or modified UI components for WCAG 2.1 AA compliance. Invoke for every sprint with frontend changes.
Version: 1.0.0
Last updated: 2026-03-10

Audit UI components against WCAG 2.1 AA success criteria. Covers all 4 principles (Perceivable, Operable, Understandable, Robust). Produces a findings table with component, issue, WCAG criterion, severity, and remediation. Uses both automated (axe-core) and manual testing.

---

## WCAG 2.1 AA Audit Checklist

### Perceivable

| # | Criterion | Check | Severity if missing |
|---|-----------|-------|---------------------|
| 1.1.1 | Non-text Content | All images have alt text; decorative images have alt="" | Critical |
| 1.2.1 | Audio/Video alternatives | Captions or transcripts for media | Major |
| 1.3.1 | Info and Relationships | Semantic HTML (headings, lists, tables, landmarks) | Critical |
| 1.3.2 | Meaningful Sequence | DOM order matches visual order | Major |
| 1.3.3 | Sensory Characteristics | Instructions don't rely solely on shape/color/size | Major |
| 1.3.4 | Orientation | Content not locked to portrait/landscape | Minor |
| 1.3.5 | Identify Input Purpose | Form inputs have autocomplete where applicable | Minor |
| 1.4.1 | Use of Color | Color is not sole means of conveying info | Critical |
| 1.4.2 | Audio Control | Auto-playing audio can be paused/stopped | Major |
| 1.4.3 | Contrast (Minimum) | Text: 4.5:1; Large text: 3:1 | Critical |
| 1.4.4 | Resize Text | Text scales to 200% without loss | Major |
| 1.4.5 | Images of Text | Real text used, not images of text | Major |
| 1.4.10 | Reflow | Content reflows at 320px width | Major |
| 1.4.11 | Non-text Contrast | UI components/graphics: 3:1 contrast | Major |
| 1.4.12 | Text Spacing | Content works with increased text spacing | Minor |
| 1.4.13 | Content on Hover/Focus | Tooltips dismissible, hoverable, persistent | Major |

### Operable

| # | Criterion | Check | Severity if missing |
|---|-----------|-------|---------------------|
| 2.1.1 | Keyboard | All functionality via keyboard | Critical |
| 2.1.2 | No Keyboard Trap | Focus can leave all components | Critical |
| 2.1.4 | Character Key Shortcuts | Single-char shortcuts can be remapped/disabled | Minor |
| 2.2.1 | Timing Adjustable | Time limits can be turned off/extended | Major |
| 2.3.1 | Three Flashes | No content flashes more than 3x/second | Critical |
| 2.4.1 | Bypass Blocks | Skip navigation link present | Major |
| 2.4.2 | Page Titled | Each page has a descriptive title | Major |
| 2.4.3 | Focus Order | Focus order is logical and meaningful | Critical |
| 2.4.4 | Link Purpose (In Context) | Links have descriptive text | Major |
| 2.4.5 | Multiple Ways | Multiple ways to find pages | Minor |
| 2.4.6 | Headings and Labels | Headings/labels are descriptive | Major |
| 2.4.7 | Focus Visible | Keyboard focus indicator is visible | Critical |
| 2.5.1 | Pointer Gestures | Complex gestures have single-pointer alternatives | Major |
| 2.5.2 | Pointer Cancellation | Down-event doesn't trigger action (use click/up) | Major |
| 2.5.3 | Label in Name | Visible label is part of accessible name | Major |
| 2.5.4 | Motion Actuation | Motion input has alternatives + can be disabled | Major |

### Understandable

| # | Criterion | Check | Severity if missing |
|---|-----------|-------|---------------------|
| 3.1.1 | Language of Page | html lang attribute set | Major |
| 3.1.2 | Language of Parts | lang attribute on foreign-language content | Minor |
| 3.2.1 | On Focus | No context change on focus alone | Major |
| 3.2.2 | On Input | No context change on input alone | Major |
| 3.2.3 | Consistent Navigation | Nav consistent across pages | Major |
| 3.2.4 | Consistent Identification | Same function = same label | Major |
| 3.3.1 | Error Identification | Errors identified and described in text | Critical |
| 3.3.2 | Labels or Instructions | Form inputs have visible labels | Critical |
| 3.3.3 | Error Suggestion | Error messages suggest corrections | Major |
| 3.3.4 | Error Prevention (Legal/Financial) | Reversible, checked, or confirmed | Major |

### Robust

| # | Criterion | Check | Severity if missing |
|---|-----------|-------|---------------------|
| 4.1.1 | Parsing | Valid HTML (no duplicate IDs) | Major |
| 4.1.2 | Name, Role, Value | Custom controls have accessible name/role | Critical |
| 4.1.3 | Status Messages | Status messages use role="status" or aria-live | Major |

## Audit Workflow

### Per-component audit

1. **Semantic HTML check** — Is it using proper elements? (button vs div, nav vs div, etc.)
2. **ARIA attributes** — Are custom controls properly labeled? (aria-label, aria-describedby, role)
3. **Keyboard navigation** — Can you Tab to it? Enter/Space activate it? ESC dismiss it?
4. **Focus management** — Does focus move correctly? (modal open/close, error fields)
5. **Color contrast** — Does text meet 4.5:1? Large text 3:1? UI components 3:1?
6. **Screen reader** — Is content announced correctly? Are landmarks, headings, labels present?
7. **Reduced motion** — Does it respect prefers-reduced-motion?

### Automated checks

```bash
# Run axe-core in tests
# Test file pattern:
import { axe, toHaveNoViolations } from 'jest-axe';
expect.extend(toHaveNoViolations);

const { container } = render(<MyComponent />);
const results = await axe(container);
expect(results).toHaveNoViolations();
```

## Output Format

Return audit findings as a table:

| Component | Issue | WCAG Criterion | Severity | Remediation |
|-----------|-------|---------------|----------|-------------|
| LoginForm | Missing label on email input | 3.3.2 | Critical | Add `<label htmlFor="email">` |
| StatusBadge | Color-only status indicator | 1.4.1 | Critical | Add text/icon alongside color |
| Modal | Focus not trapped | 2.1.2 | Critical | Apply useFocusTrap hook |

## Severity Definitions

| Severity | Impact | SLA |
|----------|--------|-----|
| **Critical** | Blocks users; no workaround | Must fix in current sprint |
| **Major** | Significant barrier; workaround exists | Fix in current sprint if possible |
| **Minor** | Inconvenience; doesn't block functionality | Fix in next sprint |

## Input Schema

```yaml
input:
  scope:
    type: enum[component, page, full]
    required: true
    description: "component = single component; page = full page; full = all frontend pages"
  target:
    type: string
    required: false
    description: "Component or page file path (required when scope=component or scope=page)"
  include_automated:
    type: boolean
    required: false
    default: true
    description: "Whether to include axe-core automated checks in the audit"
```

## Output Schema

```yaml
output:
  findings:
    type: array
    items:
      component:
        type: string
      issue:
        type: string
      wcag_criterion:
        type: string
      severity:
        type: enum[Critical, Major, Minor]
      remediation:
        type: string
  summary:
    critical_count:
      type: number
    major_count:
      type: number
    minor_count:
      type: number
    overall_status:
      type: enum[pass, conditional_pass, fail]
      description: "pass = no critical/major; conditional_pass = majors only; fail = criticals found"
```

## Quality Gate

- All 4 WCAG principles (Perceivable, Operable, Understandable, Robust) have been checked — no principle skipped.
- Every finding includes the specific WCAG criterion number, severity, and a concrete remediation step.
- Critical findings block sprint completion — they must be routed to the accessibility-implementation skill.
- Automated axe-core checks have been run (if include_automated=true) in addition to manual review.

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "accessibility-audit"
  stage: "S4"
  suggested_next:
    - slug: "accessibility-implementation"
      stage: "S4"
      reason: "Implement fixes for critical and major accessibility findings"
    - slug: "i18n-anti-pattern-detection"
      stage: "S4"
      reason: "Verify that accessible labels use i18n keys, not hardcoded strings"
```

## Error Handling

- If axe-core is not installed or test infrastructure is unavailable, proceed with manual-only audit and note reduced coverage.
- If the target component or page file cannot be found, report the missing file and halt the audit for that target.
- If a WCAG criterion cannot be evaluated (e.g., no media content to check 1.2.1), mark it as "N/A" rather than "Pass."
- If the audit scope is "full" and exceeds 30 pages, report findings incrementally per page to avoid context overflow.
