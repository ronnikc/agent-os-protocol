Title: Pipeline Configuration
Keywords: ci-cd, actions, workflows, pipeline-audit, devops
Agents: pipeline-specialist, infrastructure
When to use: When editing CI/CD configuration files (GitHub Actions, GitLab files), dependency caching, build configurations, and test pipelines.
Version: 1.0.0
Last updated: 2026-06-30

Configure, validate, and optimize automated integration pipelines, job caching, test runners, and build triggers.

---

## Workflow

### Step 1 — Parse Pipeline Definition
Read the YAML/JSON build pipeline config (e.g. `.github/workflows/verify.yml`). Extract triggers, environment setups, and sequential job steps.

### Step 2 — Verify Cache Integrity
Review dependency install steps:
- Verify that caching actions (e.g. `actions/cache`) are correctly configured using the hash of package lock files (e.g. `package-lock.json`).
- Ensure node modules are cached to speed up build iterations.

### Step 3 — Audit Security Gaps
Identify pipeline vulnerabilities:
- Look for secrets exposed in plaintext environment variables (always map from repository settings).
- Assert that third-party actions cite a specific, immutable commit SHA rather than a mutable tag.

### Step 4 — Run Local dry-run Check
Run a local dry-run or validation parser (e.g. using `actionlint`) to verify syntax before pushing.

---

## Input Schema

```yaml
input:
  pipeline_file_path:
    type: string
    required: true
    description: "Path to the pipeline configuration file to audit or write"
  validate_only:
    type: boolean
    required: false
    default: true
    description: "If true, validates syntax without making changes"
```

## Output Schema

```yaml
output:
  pipeline_status:
    type: object
    properties:
      valid_syntax: { type: boolean }
      security_issues_found: { type: integer }
      performance_warnings: { type: integer }
  details:
    type: array
    items:
      type: object
      properties:
        step_name: { type: string }
        issue: { type: string }
        severity: { type: enum, values: [High, Medium, Low] }
```

## Quality Gate

- Commit SHA pinning is used for all third-party pipeline actions
- Repository secrets are never referenced directly in plain text
- The pipeline script syntax validates successfully against schema checkers

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "pipeline-configuration"
  stage: "S5"
  suggested_next:
    - slug: "deployment-verification"
      stage: "S5"
      reason: "Configured pipeline triggers need verification on target server environments post-deploy"
```

## Error Handling

- If the pipeline configuration contains invalid YAML syntax, fail validation and report the line and character offset.
- If a target runner machine is misconfigured, halt execution and report the platform compatibility mismatch.
