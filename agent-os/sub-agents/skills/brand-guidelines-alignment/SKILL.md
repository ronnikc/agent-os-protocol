Title: Brand Guidelines Alignment
Keywords: brand-guidelines, layout-audit, styling-audit, visual-variables, svg-audit
Agents: design, ux, design-system-custodian, comms-specialist
When to use: When verifying that layout copies, UI components, images, SVGs, and landing page elements align with the official branding guidelines.
Version: 1.0.0
Last updated: 2026-06-30

Audit visual copy, UI stylesheets, typography weights, logo dimensions, and SVG specifications against official brand requirements.

---

## Workflow

### Step 1 — Load Brand Specs
Load the official brand specification sheets containing:
- Primary, secondary, and accent HSL/HEX color codes.
- Typography font-families, line-heights, and weight restrictions.
- Logo spacing, minimum display sizing, and SVG asset constraints.

### Step 2 — Parse Target Components
Crawl the target UI layout (HTML, JS/JSX templates, or style files). Locate instances where brand assets are loaded, text headers are styled, or logos are embedded.

### Step 3 — Perform Style Variable Audit
Compare code style attributes against the loaded brand specs:
- Verify that color variables exactly map allowed brand tokens (e.g. primary cyan focus rings, glass-bg borders).
- Verify that logo SVGs retain the proper aspect ratios, viewBox variables, and clean path strokes.
- Flag any custom font weights or arbitrary pixel layouts.

### Step 4 — Generate Brand Conformity Report
Compile violations listing the target file, line range, current styling rule, and the remediation replacement.

---

## Input Schema

```yaml
input:
  target_ui_file:
    type: string
    required: true
    description: "Path to the layout or template file to audit"
  brand_rules_path:
    type: string
    required: false
    default: "docs/reference/brand-rules.json"
    description: "Path to the brand specifications configuration file"
```

## Output Schema

```yaml
output:
  brand_audit:
    type: object
    properties:
      violations_count: { type: integer }
      verdict: { type: enum, values: [Compliant, OutOfSync] }
  findings:
    type: array
    items:
      type: object
      properties:
        element_id: { type: string }
        property: { type: string }
        current_value: { type: string }
        expected_value: { type: string }
```

## Quality Gate

- All logo SVGs retain correct viewBox aspect ratios and stroke colors
- Color values map exactly to registered brand stylesheet variables
- Outbound headers utilize only the approved font-families

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "brand-guidelines-alignment"
  stage: "S4"
  suggested_next:
    - slug: "design-token-audit"
      stage: "S3"
      reason: "Brand variables must be matched down to CSS design tokens and contrast metrics"
```

## Error Handling

- If the target file or brand rules configuration is missing, return a validation error.
- If logo paths are dynamically composed in scripts, flag the component for manual browser inspection.
