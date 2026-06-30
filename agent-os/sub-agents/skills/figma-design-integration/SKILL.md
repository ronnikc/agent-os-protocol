Title: Figma Design Integration
Keywords: figma-api, design-tokens, asset-sync, styling-variables, visual-extract
Agents: design, ux, design-system-custodian, frontend, demo-architect
When to use: When extracting design assets, layout coordinates, vector SVGs, and color/typography tokens from Figma file REST APIs.
Version: 1.0.0
Last updated: 2026-06-30

Interface with Figma REST APIs to extract colors, font weights, layout tokens, and SVG assets, mapping them directly into code variables.

---

## Workflow

### Step 1 — Connect to Figma API
Configure the connection parameter payload using a Figma Personal Access Token and the target File Key (`https://api.figma.com/v1/files/[key]`).

### Step 2 — Parse Canvas Styles
Fetch canvas node variables. Traverse the Figma document tree to locate:
- **Color Swatches:** Extract RGB/RGBA percentages, converting them into standard HEX or HSL formats.
- **Typography Swatches:** Extract font-family names, size properties, line-height percentages, and font weights.
- **Layout Grids:** Extract spacing margins, column configurations, and padding values.

### Step 3 — Map Node Variables to Code
Generate equivalent variable configurations:
- CSS variables (e.g. `--color-primary: #xxxxxx;`)
- Design token JSON files
- Component styling presets

### Step 4 — Extract Vector Assets
Export designated icon/graphics nodes as vector SVGs, optimizing the output markup to remove redundant editor properties.

---

## Input Schema

```yaml
input:
  figma_file_key:
    type: string
    required: true
    description: "The unique key of the Figma file to extract styles from"
  output_format:
    type: enum
    values: [css, json, tailwind]
    required: false
    default: css
    description: "Format of the generated style variables"
```

## Output Schema

```yaml
output:
  extracted_tokens:
    type: object
    properties:
      colors_count: { type: integer }
      font_styles_count: { type: integer }
      output_file_path: { type: string }
  assets_synced:
    type: array
    items: string
```

## Quality Gate

- Extracted colors are mapped directly to corresponding CSS variables
- SVG outputs are sanitized, containing zero editor-specific metadata tags
- Access tokens are resolved from environment variables only (never stored in files)

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "figma-design-integration"
  stage: "S4"
  suggested_next:
    - slug: "design-token-audit"
      stage: "S3"
      reason: "Extracted Figma design tokens must be verified against WCAG AA contrast rules"
```

## Error Handling

- If the Figma File Key is invalid or rate-limited, fail execution and suggest caching the local variables.
- If the token payload has expired, halt and request a token refresh in the environment settings.
