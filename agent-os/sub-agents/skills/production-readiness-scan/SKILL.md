Title: Production Readiness Scan
Keywords: production-readiness, qa-scan, systemic-patterns, triage, grep-scan, anti-patterns
Agents: product-qa, frontend, code-review, sprint-gate-enforcer
When to use: When performing a quick triage scan for systemic production readiness issues before or after a specialist review. NOT a substitute for full Product QA review — grep finds ~30% of real issues.
Version: 1.0.0
Last updated: 2026-03-26

Quick triage scan for the 7 systemic anti-patterns discovered across 22 modules during Phase 22 QA finalization. Use this skill to identify WHERE to look — then escalate to the Product QA Specialist agent for the full A–H checklist review.

**Critical warning:** This scan finds ~30% of real issues. It is triage, NOT QA. Grep cannot detect wrong API calls, destructive edit patterns, setSaving stuck states, free-text ObjectId inputs (without context), raw modals vs AccessibleModal, Fragment key bugs, or hardcoded English in announce() calls. Always follow up with a specialist review.

---

## Workflow

1. **Receive scope** — module directory path(s) to scan (e.g., the frontend pages).

2. **Run triage grep scans** — execute the 7 pattern scans below against the scoped files.

3. **Tally results** — count instances per pattern per file.

4. **Escalate to specialist** — ALWAYS escalate to the Product QA Specialist agent for full review. Grep results tell you where problems MIGHT be — only a line-by-line specialist review confirms real issues.

5. **Report triage results** — output the scan results with the explicit caveat that these are triage findings, not confirmed issues.

---

## The 7 Systemic Patterns

### Pattern 1: Free-Text ObjectId Inputs (P0)

Users forced to type raw MongoDB ObjectIds instead of selecting from a dropdown.

```bash
# Triage: find text inputs that might be for ObjectId fields
grep -rn 'type="text"' --include="*.tsx" <module_path> | grep -i '_id\|Id\|identifier'
# Also check for missing Select components where IDs are expected
grep -rn 'onChange.*_id\|name=".*_id"' --include="*.tsx" <module_path>
```

**What grep misses:** Input fields named generically (e.g., `value`, `selected`) that are actually used for ObjectIds. Only reading the full component context reveals this.

### Pattern 2: No Permission Checks (P1)

Backend enforces RBAC but frontend shows all actions to all users.

```bash
# Triage: find pages without permission checks
grep -rL 'usePermission\|hasPermission\|Permission\.' --include="*.tsx" <module_path>
# Check for action buttons without permission gates
grep -rn 'onClick.*delete\|onClick.*remove\|onClick.*create' --include="*.tsx" <module_path>
```

**What grep misses:** Pages that import Permission but don't actually gate UI elements behind checks.

### Pattern 3: replace(/_/g, ' ') English-Only Labels (P1)

Enum values converted to display labels using string replacement instead of i18n.

```bash
# Triage: find replace-based label generation
grep -rn "replace(/_/g" --include="*.tsx" <module_path>
grep -rn "replace(/_/g" --include="*.ts" <module_path>
# Also check for .replace(' ', '_') reverse patterns
grep -rn "\.replace(/\s/g\|\.replace(/ /g" --include="*.tsx" <module_path>
```

**What grep misses:** Custom label functions that do the same thing without `.replace()`.

### Pattern 4: setSaving Bugs (P0/P1)

Two variants:
- **Variant 1 (P1):** `setSaving(false)` in finally without ever calling `setSaving(true)`. Buttons never disable.
- **Variant 2 (P0):** `setSaving(true)` called but no finally block. On error, button permanently disabled.

```bash
# Triage: find setSaving usage patterns
grep -rn 'setSaving' --include="*.tsx" <module_path>
# Check for try blocks without finally
grep -rn 'setSaving(true)' --include="*.tsx" <module_path>
# Cross-reference: do these files have finally blocks?
grep -rn 'finally' --include="*.tsx" <module_path>
```

**What grep misses:** The actual control flow — whether `setSaving(true)` is called before the try, whether the finally block is in the right scope, whether early returns bypass the finally.

### Pattern 5: Raw ObjectId Display (P0)

MongoDB `_id` values shown to users as fallback text.

```bash
# Triage: find ObjectId fallback patterns
grep -rn '\._id\b' --include="*.tsx" <module_path> | grep -v 'key=\|find(\|filter(\|map('
# Check for direct _id rendering in JSX
grep -rn '{.*\._id}' --include="*.tsx" <module_path>
# Check fallback patterns
grep -rn "|| .*\._id\|?? .*\._id\|: .*\._id" --include="*.tsx" <module_path>
```

**What grep misses:** Indirect rendering through variables (e.g., `const label = item.name || item._id; ... {label}`).

### Pattern 6: No Pagination (P1)

Lists render unbounded data without pagination controls.

```bash
# Triage: find pages with lists/tables but no pagination
grep -rL 'Pagination\|page_size\|pageSize\|currentPage' --include="*.tsx" <module_path>
# Cross-reference: which of these have .map() renders?
grep -rn '\.map(' --include="*.tsx" <module_path>
```

**What grep misses:** Pages that import a Pagination component but don't wire it to the data fetch.

### Pattern 7: Raw div role="dialog" Modals (P0)

Modals without focus trap, Escape dismiss, or proper ARIA.

```bash
# Triage: find raw modal patterns
grep -rn 'role="dialog"\|modal-overlay\|className.*modal' --include="*.tsx" <module_path> | grep -v 'AccessibleModal'
# Check for modals without focus trap
grep -rn 'showModal\|isModalOpen\|modalOpen' --include="*.tsx" <module_path>
```

**What grep misses:** Custom modal components that wrap a div without using AccessibleModal.

---

## Input Schema

```yaml
module_paths:
  type: list[string]
  required: true
  description: Directory paths to scan (e.g., ["the frontend pages)
full_review:
  type: boolean
  required: false
  default: true
  description: Whether to escalate to Product QA Specialist after triage (should almost always be true)
```

## Output Schema

```yaml
triage_results:
  type: object
  properties:
    modules_scanned:
      type: integer
    files_scanned:
      type: integer
    patterns:
      type: list[object]
      items:
        pattern_name: string
        severity: string
        instances_found: integer
        files_affected: list[string]
    escalation_recommended:
      type: boolean
      description: Always true — grep triage is never sufficient alone
    caveat:
      type: string
      value: "Grep triage finds ~30% of real issues. These results identify WHERE to look, not WHAT is wrong. Full Product QA Specialist review required."
```

## Quality Gate

Before returning results:
- [ ] All 7 patterns scanned against all files in scope
- [ ] Results include the explicit caveat about grep limitations
- [ ] Escalation to Product QA Specialist recommended (always)
- [ ] No pattern scan results presented as confirmed findings

## Chain Metadata

```yaml
slug: production-readiness-scan
stage: S3  # Quality
suggested_next:
  - module-production-review  # Full specialist review
  - accessibility-audit       # If raw modals found
  - i18n-anti-pattern-detection  # If replace(/_/g) found
```

## Error Handling

- **No files found in path:** Report empty scope, do not scan parent directories
- **Grep returns no matches:** Report clean scan but still recommend specialist review — absence of grep hits does NOT mean absence of issues
- **Module path does not exist:** Report error, suggest checking the path

---

## A–H Checklist Reference

The full Production Readiness Checklist is defined in the Product QA Specialist agent definition (`agent-os/sub-agents/agents/product-qa.md`). The 8 sections are:

| Section | Focus | Items |
|---------|-------|-------|
| A | Accessibility & Component Patterns | A-1 to A-6 |
| B | Internationalization | B-1 to B-6 |
| C | Data Display & User Experience | C-1 to C-7 |
| D | Permissions & Security | D-1 to D-3 |
| E | API Integration & Error Handling | E-1 to E-4 |
| F | Workflow & Business Logic | F-1 to F-6 |
| G | Domain Data Integrity | G-1 to G-4 |
| H | Evidence Generation | H-1 to H-8 |

This scan covers a subset of items from sections A, B, C, and D. Sections E, F, G, and H require specialist review — they cannot be scanned with grep.

---

*Created: 2026-03-26 from Phase 22 QA finalization (628 findings across 246 pages)*
