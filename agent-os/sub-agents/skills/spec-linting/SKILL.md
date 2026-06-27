Title: Sprint Spec Linting
Keywords: spec, linting, gate-2, structure, validation, quality, governance
Agents: product, code-review
When to use: Before committing any sprint spec file, or when reviewing spec quality during planning.
Version: 1.0.0
Last updated: 2026-03-17

Validate sprint specification files against the 9 structural checks defined in Gate -2 (SPRINTS.md Step A.-1). Uses `agent-os/scripts/lint-sprint-spec.sh` for automated validation and provides remediation guidance for failures.

---

## Workflow

### Step 1 — Run the Lint Script

Execute the lint script against the target sprint spec file(s):

```bash
bash agent-os/scripts/lint-sprint-spec.sh docs/product/phases/phase-N/sprint-X.Y.Z.md
```

For batch validation of all specs in a phase:

```bash
bash agent-os/scripts/lint-sprint-spec.sh docs/product/phases/phase-N/sprint-*.md
```

**Note:** Sub-sprint files (X.Y.Z.N pattern) are automatically skipped — they have lighter structural requirements.

### Step 2 — Interpret Results

The script checks 9 structural requirements:

| Check | What It Validates | Common Fix |
|-------|-------------------|------------|
| 1 | C.1 API Contract Trace section present | Add B1 work breakdown with 7-step trace template, or document "N/A — no API endpoints" |
| 2 | C.2 Form Completeness Gate section present | Add form gate with entity reference, required field, enum selector, array multi-select, and button state checks, or "N/A — no forms" |
| 3 | Accessibility section with WCAG checks | Add B5/B6/B7 section with per-component WCAG checks (keyboard nav, ARIA, focus management, contrast) |
| 4 | Accessibility Specialist listed as lead agent | Add row to Agent Assignment table: Accessibility Specialist as lead for accessibility task |
| 5 | Out of Scope 3-column table (Item \| Classification \| Action) | Convert to 3-column format; ensure "Deferred improvement" items have sub-sprint numbers |
| 6 | Deferred improvements have sub-sprint numbers | Add `**Sub-sprint X.Y.Z.N**` to the Action column for all deferred items |
| 7 | Pagination unwrap (R-23) mentioned | Add AC or cross-cutting gate for `(res as any).data ?? []` unwrap pattern, or "N/A — no paginated endpoints" |
| 8 | Error parsing pattern present | Add AC or cross-cutting gate for `err?.response?.error?.message ?? 'Operation failed'` pattern, or "N/A — no API error handling" |
| 9 | Button loading/disabled state present | Add AC or cross-cutting gate for `disabled={saving}` pattern, or "N/A — no buttons/forms" |

### Step 3 — Fix Failures

For each failed check:

1. Read the sprint spec to understand the module context
2. Determine if the check is genuinely N/A (no API endpoints, no forms, no frontend UI) or if the section is truly missing
3. If N/A: add explicit documentation explaining why (e.g., "N/A — this sprint modifies only i18n locale files and test mock patterns")
4. If missing: add the required section following the templates in SPRINTS.md

### Step 4 — Re-run and Verify

After fixes, re-run the lint script to confirm all 9 checks pass:

```bash
bash agent-os/scripts/lint-sprint-spec.sh docs/product/phases/phase-N/sprint-X.Y.Z.md
# Expected: → PASS (all 9 checks)
```

### Step 5 — Sequential Planning Check

If planning >3 sprints simultaneously, verify each spec passes Gate -2 before starting the next. Do NOT write all specs first and lint later — the sequential mandate prevents systematic omissions from propagating across specs.

---

## N/A Pattern Reference

The lint script recognizes these N/A patterns:

- **Checks 1-2:** `N/A.*no API`, `N/A.*no endpoint`, `N/A.*infrastructure`, `N/A.*no forms`
- **Check 3-4:** `N/A.*no frontend`, `N/A.*no UI`
- **Check 7:** `N/A.*no paginated`, `no paginated endpoint`
- **Check 9:** `N/A.*no forms`, `N/A.*no buttons`

When documenting N/A, use a dedicated section (e.g., "B4.5. Cross-cutting Gates") with clear explanation.

---

## Related

- SPRINTS.md → Step A.-1 — Gate -2 definition
- RULES.md → R-27 — Sprint spec structure gate rule
- `agent-os/scripts/lint-sprint-spec.sh` — the lint script source
- `memories/product-sprint-planning-discipline.md` — planning lessons

## Input Schema

```yaml
input:
  spec_paths:
    type: array
    items: string
    required: true
    description: "One or more paths to sprint spec files to lint"
  fix_mode:
    type: boolean
    required: false
    default: false
    description: "If true, attempt to add missing sections with N/A documentation where appropriate"
```

## Output Schema

```yaml
output:
  specs_checked:
    type: integer
    description: "Number of spec files linted"
  all_passed:
    type: boolean
    description: "True if all specs passed all 9 checks"
  results:
    type: array
    items:
      type: object
      properties:
        spec_path: string
        checks_passed: integer
        checks_failed: integer
        failures:
          type: array
          items:
            type: object
            properties:
              check_number: integer
              description: string
              remediation: string
    description: "Per-file lint results with failure details and remediation guidance"
```

## Quality Gate

- All 9 structural checks pass for every spec file provided
- Sub-sprint files (X.Y.Z.N pattern) are correctly skipped
- Any N/A documentation uses recognized patterns from the N/A Pattern Reference
- When linting >3 specs, sequential planning order is verified

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "spec-linting"
  stage: "S1"
  suggested_next:
    - slug: "build-validation"
      stage: "S1"
      reason: "After spec is validated, proceed to build validation before implementation"
    - slug: "skill-maintenance"
      stage: "S1"
      reason: "Spec changes may affect skill accuracy — verify skills remain current"
```

## Error Handling

- If the lint script (`agent-os/scripts/lint-sprint-spec.sh`) is missing or not executable, report the error and fall back to manual check descriptions from the 9-check table
- If a spec file path does not exist, skip it and report as an error in the results
- If batch mode includes >10 spec files, warn about potential output length and suggest phase-by-phase linting
