Title: Release Notes
Keywords: release-notes, sprint, changelog, documentation
Agents: documentation
When to use: When creating release notes for a completed sprint.
Version: 1.0.0
Last updated: 2026-03-10

Create sprint release notes in factual format mirroring acceptance criteria. No marketing language. Structure: What's New, Improvements, Bug Fixes, Technical. File: docs/release-notes/{X.Y.Z}.md. Update docs/release-notes/README.md version history table.

---

## File Location

```
docs/release-notes/{X.Y.Z}.md
```

## Format

```markdown
# Sprint {X.Y.Z} — {Title}

**Date:** {YYYY-MM-DD}
**Phase:** {N} — {Phase Name}

## What's New
- {Feature 1} — {brief description}
- {Feature 2} — {brief description}

## Improvements
- {Enhancement 1} — {what changed and why}

## Bug Fixes
- {Fix 1} — {what was broken, root cause, how it was fixed}

## Technical
- {Internal change 1} — {refactoring, tooling, CI changes}

## Files Changed
- {count} files modified across {areas}
```

## Rules

- Mirror acceptance criteria from the sprint spec — every criterion should map to a release note entry
- Factual language only — no "exciting", "powerful", "revolutionary"
- Describe the "what" and "why", not the "how" (implementation details)
- Include file change count for reference
- After creating the file, update `docs/release-notes/README.md` version history table

## Input Schema

```yaml
input:
  sprint_version:
    type: string
    required: true
    description: "Sprint version number (e.g., 1.2.3)"
  sprint_spec_path:
    type: string
    required: true
    description: "Path to the sprint spec file with acceptance criteria"
  phase_number:
    type: integer
    required: true
    description: "Phase number the sprint belongs to"
  phase_name:
    type: string
    required: true
    description: "Human-readable phase name"
```

## Output Schema

```yaml
output:
  release_notes_path:
    type: string
    description: "Path to the created release notes file"
  readme_updated:
    type: boolean
    description: "Whether the version history table in README.md was updated"
  sections_included:
    type: array
    items: string
    description: "List of sections included (e.g., whats_new, improvements, bug_fixes, technical)"
```

## Quality Gate

- Every acceptance criterion from the sprint spec maps to at least one release note entry
- No marketing language present (no "exciting", "powerful", "revolutionary", etc.)
- File saved to correct path: `docs/release-notes/{X.Y.Z}.md`
- `docs/release-notes/README.md` version history table updated with new entry

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "release-notes"
  stage: "S5"
  suggested_next:
    - slug: "doc-housekeeping"
      stage: "S5"
      reason: "Release notes are one of the 9 mandatory doc updates — run full housekeeping next"
    - slug: "release-checklist"
      stage: "S5"
      reason: "Verify all pre-release checks pass after documentation is complete"
```

## Error Handling

- If the sprint spec file is missing or unreadable, abort and report the missing path
- If `docs/release-notes/README.md` does not exist, create the release notes file but warn that the version history table could not be updated
- If no acceptance criteria are found in the sprint spec, produce an empty-section release note and flag for manual review
