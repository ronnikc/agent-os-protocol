Title: Asset Prototyping
Keywords: asset-prototyping, html-sandbox, mockups, stub-assets, wireframes
Agents: design, frontend, demo-architect
When to use: When building sandboxed UI wireframes, generating layout mockups, and stubbing local placeholder images for front-end review.
Version: 1.0.0
Last updated: 2026-06-30

Generate stand-alone HTML mockups, prepare sandboxed design layouts, and stub local image dimensions to accelerate front-end prototyping.

---

## Workflow

### Step 1 — Initialize Sandbox Environment
Set up a temporary, sandboxed HTML file in a local dev folder. Wire in root design variables (`styles.css`) and responsive layout resets.

### Step 2 — Construct Layout Wireframe
Write semantically correct, static HTML blocks reflecting the target UI screen:
- Place layout columns, tables, headers, and card components.
- Enforce the use of flexbox and CSS grid structures rather than absolute positions.

### Step 3 — Stub Visual Assets
Where real images are not yet created, generate local placeholder paths:
- Map image source tags to local asset folders.
- Insert inline styling variables setting explicit dimensions (e.g. width/height aspect ratios) to prevent page layout shifts.

### Step 4 — Verify Local Execution
Open the static sandbox in a browser shell, verifying that interactions, hover states, and typography render correctly.

---

## Input Schema

```yaml
input:
  sandbox_name:
    type: string
    required: true
    description: "Name of the sandbox HTML file to create (e.g., dashboard-prototype)"
  framework_target:
    type: enum
    values: [html, react, vue, svelte]
    required: false
    default: html
    description: "Target layout framework to mock"
```

## Output Schema

```yaml
output:
  prototype_status:
    type: object
    properties:
      file_path: { type: string }
      responsive_verified: { type: boolean }
  asset_stubs:
    type: array
    items:
      type: object
      properties:
        element_id: { type: string }
        mock_source: { type: string }
        dimensions: { type: string }
```

## Quality Gate

- Standalone prototype renders cleanly without making network API requests
- All image tags specify explicit dimensions (width/height attributes)
- Mock buttons and tabs execute basic state triggers on click

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "asset-prototyping"
  stage: "S1"
  suggested_next:
    - slug: "component-pattern"
      stage: "S1"
      reason: "Audited HTML prototypes should be migrated into first-class reusable UI components"
```

## Error Handling

- If styling assets cannot be found in the workspace root, fallback to basic inline CSS resets.
- If mock source images fail to load locally, render a stylized CSS box representing the boundaries.
