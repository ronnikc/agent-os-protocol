Title: Build Validation
Keywords: typescript, compilation, dependency-graph, import-resolution, build-health
Slug: build-validation
Used by: build-integrity
Version: 1.0.0
Last updated: 2026-03-11

---

## Purpose

Validate that the entire project builds cleanly with zero errors. This skill covers TypeScript compilation, dependency resolution, import path verification, and workspace graph integrity.

---

## Workflow

### Step 1: Environment Verification

```bash
# Verify Node.js version (must be >= 20)
node --version

# Verify npm and workspace setup
npm --version
npm ls --depth=0 2>&1 | grep -c "ERR"
```

If `npm ls` reports missing dependencies, run `npm ci` before proceeding.

### Step 2: Build Order Compilation

Build order is **sacred**: shared → backend → frontend.

```bash
# Step 2a: Shared (must succeed before backend/frontend)
npx tsc -p the shared packagetsconfig.json
# Expected: 0 errors

# Step 2b: Backend (depends on shared)
npx tsc -p the backendtsconfig.json
# Expected: 0 errors

# Step 2c: Frontend (depends on shared)
npx tsc -p the frontendtsconfig.json --noEmit
# Expected: 0 errors
```

**If any step fails:** Stop. Do not proceed to the next step. Categorize errors and report.

### Step 3: Dependency Graph Validation

```bash
# Verify workspace references
cat the backendpackage.json | grep "@agent-os/shared"
cat the frontendpackage.json | grep "@agent-os/shared"
# Both must show: "@agent-os/shared": "workspace:*"

# Verify no phantom dependencies (imports without package.json entries)
npx tsc -p the backendtsconfig.json --listFiles 2>/dev/null | grep "node_modules" | \
  sed 's|.*/node_modules/||' | cut -d'/' -f1-2 | sort -u
```

### Step 4: Import Resolution Check

```bash
# Check for broken imports in backend
grep -rn "from '\." the backendsrc --include="*.ts" | \
  while read line; do
    file=$(echo "$line" | cut -d: -f1)
    import=$(echo "$line" | grep -oP "from '\K[^']+")
    dir=$(dirname "$file")
    resolved="$dir/$import"
    if [ ! -f "${resolved}.ts" ] && [ ! -f "${resolved}/index.ts" ] && [ ! -f "${resolved}.d.ts" ]; then
      echo "BROKEN IMPORT: $line"
    fi
  done

# Same for frontend
grep -rn "from '\." the frontendsrc --include="*.ts" --include="*.tsx" | \
  while read line; do
    file=$(echo "$line" | cut -d: -f1)
    import=$(echo "$line" | grep -oP "from '\K[^']+")
    dir=$(dirname "$file")
    resolved="$dir/$import"
    if [ ! -f "${resolved}.ts" ] && [ ! -f "${resolved}.tsx" ] && [ ! -f "${resolved}/index.ts" ] && [ ! -f "${resolved}/index.tsx" ]; then
      echo "BROKEN IMPORT: $line"
    fi
  done
```

### Step 5: Build Health Report

Output format:

```
=== BUILD HEALTH REPORT ===
Date: YYYY-MM-DD
Sprint: X.Y.Z

Shared compilation:    PASS (0 errors)  |  FAIL (N errors)
Backend compilation:   PASS (0 errors)  |  FAIL (N errors)
Frontend compilation:  PASS (0 errors)  |  FAIL (N errors)
Dependency graph:      CLEAN            |  N missing refs
Import resolution:     CLEAN            |  N broken imports
Lint:                  PASS (0 errors)  |  FAIL (N errors)
Tests:                 PASS (N/N)       |  FAIL (N failures)

Overall: CLEAN / BLOCKED
```

---

## Error Remediation Patterns

### Missing node_modules

```bash
# Full clean install
rm -rf node_modules src/*/node_modules
npm ci
```

### Missing workspace reference

```json
// In the backendpackage.json or the frontendpackage.json
{
  "dependencies": {
    "@agent-os/shared": "workspace:*"
  }
}
```

### Stale shared build

```bash
# Rebuild shared before checking backend/frontend
npx tsc -p the shared packagetsconfig.json
```

### Type mismatch after shared changes

```bash
# Rebuild shared, then check consumers
npx tsc -p the shared packagetsconfig.json
npx tsc -p the backendtsconfig.json 2>&1 | head -20
npx tsc -p the frontendtsconfig.json --noEmit 2>&1 | head -20
```

---

## Anti-Patterns (NEVER DO)

1. **"Only pre-existing errors"** — This phrase means the build is broken. Fix it.
2. **"Works on my machine"** — Run `npm ci` from a clean state. If it fails, it's broken.
3. **"Missing node_modules is expected"** — It is never expected. Dependencies must resolve.
4. **"Environment-specific issue"** — Investigate. Usually a missing dependency or path issue.
5. **Skipping shared build** — Always build shared first. Backend and frontend depend on it.

## Input Schema

```yaml
input:
  sprint_version:
    type: string
    required: false
    description: "Sprint version for the build health report header"
  skip_import_resolution:
    type: boolean
    required: false
    default: false
    description: "If true, skip the import resolution check (Step 4) to save time on quick validations"
  clean_install:
    type: boolean
    required: false
    default: false
    description: "If true, run npm ci before starting the build chain"
```

## Output Schema

```yaml
output:
  shared_compilation:
    type: string
    enum: ["PASS", "FAIL"]
    description: "Result of shared TypeScript compilation"
  backend_compilation:
    type: string
    enum: ["PASS", "FAIL", "SKIPPED"]
    description: "Result of backend TypeScript compilation"
  frontend_compilation:
    type: string
    enum: ["PASS", "FAIL", "SKIPPED"]
    description: "Result of frontend TypeScript compilation"
  dependency_graph:
    type: string
    enum: ["CLEAN", "MISSING_REFS"]
    description: "Dependency graph validation result"
  import_resolution:
    type: string
    enum: ["CLEAN", "BROKEN_IMPORTS", "SKIPPED"]
    description: "Import resolution check result"
  overall:
    type: string
    enum: ["CLEAN", "BLOCKED"]
    description: "Overall build health status"
  error_count:
    type: integer
    description: "Total number of errors across all steps"
```

## Quality Gate

- Shared, backend, and frontend compilations all report zero errors
- Dependency graph shows workspace references are correctly configured
- No broken imports detected in backend or frontend source files
- Build health report is generated with accurate pass/fail status for every step

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "build-validation"
  stage: "S1"
  suggested_next:
    - slug: "release-checklist"
      stage: "S5"
      reason: "After build is validated, proceed to the full release checklist for pre-release verification"
    - slug: "spec-linting"
      stage: "S1"
      reason: "If build issues trace back to spec gaps, re-lint the sprint spec"
```

## Error Handling

- If shared compilation fails, skip backend and frontend compilation and report them as SKIPPED — do not attempt downstream builds
- If `npm ci` fails during clean install, report the npm error output and abort the entire validation
- If the import resolution check runs longer than 5 minutes, terminate it and report as SKIPPED with a timeout warning
