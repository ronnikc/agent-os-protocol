Title: Skill Maintenance & Authoring
Keywords: skill-review, staleness, maintenance, accuracy, deduplication, method-names, examples, skill-creation, authoring, TDD-skills
Agents: code-review, documentation
When to use: During pattern compliance reviews, post-sprint housekeeping, or when creating/editing skill files — load this skill to verify accuracy and follow skill authoring best practices.
Version: 1.0.0
Last updated: 2026-03-18

Verify that skill files in `sub-agents/skills/` remain accurate: method names match real source, examples compile, no redundant skills exist, metadata is current. Also provides the methodology for creating NEW skills. Prevents skill drift — the #1 risk to Agent OS quality over time.

---

## When to Run This Review

- **Every sprint** that changes backend services, frontend components, or shared types (method renames, field changes, API refactors)
- **Every sprint** that adds or modifies a skill file
- **Post-phase close-out** (mandatory — full sweep of all skills)
- **When a sub-agent produces incorrect output** traceable to stale skill instructions

## Checklist

### 1. Method Name Accuracy

Skills reference real method names from source code. Verify they still exist.

```
# Check service-pattern.md references against real services
Grep: pattern="async (create|update|delete|get|list|find)", path="the backend modules, head_limit=20

# Check test-patterns.md mock methods against real api-client.ts
Grep: pattern="async \w+\(", path="the frontend, head_limit=30

# Check component-pattern.md hook references
Grep: pattern="export function use\w+", path="the frontend, head_limit=20
```

For each skill, verify:
- [ ] Method names referenced in examples match current source signatures
- [ ] Constructor patterns described match current implementations
- [ ] Import paths shown in examples are still valid

### 2. Example Code Accuracy

Skills contain code examples. Verify they reflect current patterns.

- [ ] `service-pattern.md` — constructor takes `db`, methods take `org_id` first? Still true?
- [ ] `component-pattern.md` — `useLocale()`, `apiClient` named import, CSS class prefixes? Still the convention?
- [ ] `test-patterns.md` — `createMockDb`, `vi.mock` patterns, `beforeEach` reset? Still how tests are written?
- [ ] `seed-data.md` — permission seeding pattern, collection naming? Still current?
- [ ] `domain-pack.md` — framework seed structure, form template format? Match latest seed files?

### 3. Skill Redundancy Check

No two skills should encode the same procedure. Look for overlap.

| Potential overlap | Check |
|-------------------|-------|
| `pattern-compliance` vs `service-pattern` | Pattern compliance is a review checklist; service pattern is implementation guidance. Both needed — no overlap. |
| `accessibility-audit` vs `accessibility-testing` | Audit = evaluation; testing = automated checks. Both needed. |
| `i18n-batch-processing` vs `i18n-anti-pattern-detection` | Batch = workflow for adding keys; anti-pattern = detecting violations. Both needed. |
| Any NEW skill vs existing skills | Before creating, scan this table and all summaries in README.md. If >70% overlap exists, extend the existing skill instead. |

If redundancy is found:
1. Merge the smaller skill into the larger one
2. Update all agent definition files that reference the retired skill
3. Remove the retired skill file
4. Update `skills/README.md` index

### 4. Metadata Freshness

Every skill file starts with a metadata block. Verify:

- [ ] `Last updated` date is within 60 days (or since last sprint touching the skill's domain)
- [ ] `Agents` field lists all agents that actually use the skill (check agent definitions)
- [ ] `Keywords` field covers the skill's current scope (not just original scope)
- [ ] `When to use` trigger condition is still accurate

```
# List all skill files and their last-updated dates
Grep: pattern="Last updated:", path="sub-agents/skills/", output_mode="content"

# Cross-reference: which agents reference which skills
Grep: pattern="skills/", path="sub-agents/agents/", output_mode="content"
```

### 5. Skills Index Consistency

The index at `sub-agents/skills/README.md` must match the actual skill files.

- [ ] Every `.md` file in `sub-agents/skills/` (except README.md) has an entry in the index
- [ ] No index entries point to files that don't exist
- [ ] Summary lines in the index match the 3-5 line summary in each skill file
- [ ] `Used by agents` column matches the `Agents` metadata in each skill file

```
# List all skill files
Glob: pattern="sub-agents/skills/*.md"

# Compare with index entries
Read: sub-agents/skills/README.md
```

### 6. Agent Definition Cross-Reference

Agent definitions reference skills. Verify the references are bidirectional.

- [ ] Every skill listed in an agent's `Available Skills` table exists in `sub-agents/skills/`
- [ ] Every skill's `Agents` metadata includes all agents that reference it
- [ ] No agent references a skill that was renamed or retired

```
# Find all skill references in agent definitions
Grep: pattern="skills/\w+", path="sub-agents/agents/", output_mode="content"
```

## Severity Levels for Skill Issues

| Severity | Meaning | Action |
|----------|---------|--------|
| Critical | Method name in skill doesn't exist in source — agent will hallucinate | Fix immediately |
| Major | Example code uses deprecated pattern — agent will produce wrong output | Fix before next sprint |
| Minor | Metadata date stale or keyword incomplete | Fix during housekeeping |
| Info | Potential redundancy between skills | Evaluate during post-phase review |

---

## Skill Authoring Guidelines

When creating NEW skills or editing existing ones, follow these standards.

### Skill File Format

Every skill in `sub-agents/skills/` follows this structure:

```markdown
Title: [Human-readable name]
Keywords: [comma-separated search terms]
Agents: [agent slugs that use this skill]
When to use: [Trigger conditions — describe the SITUATION, not the workflow]
Last updated: [YYYY-MM-DD]

[3-5 line summary of what the skill does]

---

## [Sections: Procedure, Key Rules, Checklist, etc.]
```

### Metadata Rules

- **Title:** Descriptive, human-readable
- **Keywords:** Include error messages, symptoms, synonyms, and tool names agents would search for
- **Agents:** List ALL agents that should use this skill (cross-reference with agent definitions)
- **When to use:** Start with a situation description. Describe WHEN to use, NOT what the skill does. This prevents agents from following the summary instead of reading the full skill.
- **Last updated:** Must be within 60 days or since last domain change

### Description Anti-Pattern

```
❌ BAD: "Dispatch subagent per task with code review between tasks" (summarizes workflow)
✅ GOOD: "When executing sprint tasks via sub-agents" (describes situation only)
```

Why: Testing shows that when descriptions summarize workflow, agents follow the description shortcut instead of reading the full skill content.

### When to Create vs. Extend

**Create a NEW skill when:**
- A task type is performed repeatedly across sprints
- The task has specific rules agents need to follow consistently
- A non-obvious procedure was discovered and should be codified
- An agent needs domain knowledge beyond its definition file

**Extend an EXISTING skill when:**
- Adding detail to an established procedure
- Correcting a rule or adding a new edge case
- Reflecting a lessons-learned incident
- >70% overlap with an existing skill exists

### Registration Checklist for New Skills

When adding a new skill:
- [ ] Skill file created in `sub-agents/skills/` with proper metadata
- [ ] Entry added to `sub-agents/skills/README.md` index (correct category)
- [ ] Referenced in all relevant agent definition files (`Available Skills` table)
- [ ] No >70% overlap with existing skills (check redundancy table)
- [ ] `HOUSEKEEPING.md` skill count still accurate

## Output Format

Return results as:

```markdown
## Skill Maintenance Review

### Skills Reviewed
[count] of [total] skills checked

### Issues Found

#### [Skill Name] — [Issue Title]
- **Severity**: critical / major / minor / info
- **Detail**: [what is wrong]
- **Source reference**: [file:line where the real code differs]
- **Fix**: [what to change in the skill file]

### Redundancy Assessment
- [Any overlaps found, or "No redundancy detected"]

### Metadata Status
- [count] skills with current metadata
- [count] skills with stale metadata (>60 days or post-domain-change)

### Index Consistency
- [OK or list of mismatches]
```

## Input Schema

```yaml
input:
  scope:
    type: string
    required: false
    enum: ["full", "changed-only"]
    default: "changed-only"
    description: "Whether to review all skills or only those whose domain was touched in the current sprint"
  sprint_changed_files:
    type: array
    items: string
    required: false
    description: "List of files changed in the sprint — used to determine which skill domains were affected"
  include_authoring_guidelines:
    type: boolean
    required: false
    default: false
    description: "If true, also output the skill authoring guidelines for new skill creation"
```

## Output Schema

```yaml
output:
  skills_reviewed:
    type: integer
    description: "Number of skill files reviewed"
  skills_total:
    type: integer
    description: "Total number of skill files in the directory"
  issues:
    type: array
    items:
      type: object
      properties:
        skill_name: string
        issue_title: string
        severity: string
        detail: string
        source_reference: string
        fix: string
    description: "List of issues found with severity, detail, and remediation"
  redundancy_assessment:
    type: string
    description: "Summary of redundancy findings or 'No redundancy detected'"
  metadata_status:
    type: object
    properties:
      current: integer
      stale: integer
    description: "Count of skills with current vs stale metadata"
  index_consistent:
    type: boolean
    description: "Whether the skills/README.md index matches the actual skill files"
```

## Quality Gate

- All reviewed skills have method names verified against current source code
- No critical-severity issues remain unresolved (method references that do not exist in source)
- Skills index (README.md) is consistent with actual skill files on disk
- Every skill's `Agents` metadata is bidirectionally consistent with agent definition files

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "skill-maintenance"
  stage: "S1"
  suggested_next:
    - slug: "doc-housekeeping"
      stage: "S5"
      reason: "After verifying skill accuracy, ensure all documentation is up to date"
    - slug: "build-validation"
      stage: "S1"
      reason: "Skill changes may affect referenced code patterns — verify the build is still clean"
```

## Error Handling

- If a skill file references source files that do not exist (e.g., deleted modules), flag as critical and skip source verification for that skill rather than failing the entire review
- If the skills/README.md index file is missing, skip the index consistency check and report it as a warning
- If agent definition files cannot be read for cross-referencing, skip the bidirectional agent check and note it in the output
