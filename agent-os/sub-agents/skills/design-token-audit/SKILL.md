Title: Design Token Audit
Keywords: styling-audit, contrast-check, css-variables, visual-compliance, design-system
Agents: design-system-custodian, ux-researcher
When to use: When verifying CSS styling layouts, design token compliance, and WCAG accessibility contrast ratios in front-end pages.
Version: 1.0.0
Last updated: 2026-06-30

Audit visual assets, CSS configurations, and design systems for compliance with color palettes, typography, and contrast standards.

---

## Workflow

### Step 1 — Parse Style Declarations
Scan visual layout stylesheets (e.g. `styles.css`) or tailwind configuration scripts. Locate colors, sizes, borders, typography parameters, and transition values.

### Step 2 — Verify Token Compliance
Compare hardcoded visual strings or inline styles against the allowed design token schemas:
- Assert that only registered color values are used (e.g. HSL tailored color schemes, glassmorphic dark border tokens).
- Identify and reject arbitrary sizing values (e.g. `margin: 17px;`) that deviate from spacing metrics.

### Step 3 — Accessibility Contrast Check
Audit text colors against background overlays to evaluate Web Content Accessibility Guidelines (WCAG 2.1) compliance:
- Standard text should satisfy a minimum contrast ratio of **4.5:1** (AA standard).
- Large text should satisfy a minimum contrast ratio of **3:1** (AA standard).

### Step 4 — Generate Remediation Guide
Compile a structured list of styling violations, detailing the offending file, line range, current styling rule, and the compliant token value to replace it with.

---

## Input Schema

```yaml
input:
  styles_path:
    type: string
    required: true
    description: "Path to the styling stylesheet or tailwind config file to audit"
  contrast_level:
    type: enum
    values: [AA, AAA]
    required: false
    default: AA
    description: "Target WCAG compliance level for text contrast"
```

## Output Schema

```yaml
output:
  audit_summary:
    type: object
    properties:
      total_violations: { type: integer }
      compliance_status: { type: enum, values: [Passed, ActionRequired] }
  violations:
    type: array
    items:
      type: object
      properties:
        file_path: { type: string }
        line_number: { type: integer }
        property: { type: string }
        invalid_value: { type: string }
        suggested_token: { type: string }
        contrast_ratio: { type: string }
```

## Quality Gate

- All audited files contain zero arbitrary hardcoded colors
- Text/background combinations satisfy the minimum contrast target
- A corresponding remediation task is created for any detected violation

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "design-token-audit"
  stage: "S3"
  suggested_next:
    - slug: "accessibility-implementation"
      stage: "S4"
      reason: "Detected styling violations must be fixed using canonical accessibility implementation patterns"
```

## Error Handling

- If the style file is missing or unreadable, halt the audit and return a validation error.
- If contrast ratios cannot be computed due to dynamic class bindings, flag the line for manual visual inspection.
