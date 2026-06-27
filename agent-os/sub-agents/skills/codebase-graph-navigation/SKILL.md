Title: Codebase Graph Navigation
Keywords: dependency-graph, graph-query, blast-radius, import-chain, transitive-impact
Agents: graph-navigator, research, planning
When to use: When you need to understand the structural impact of a change, trace dependency chains, or determine which files must be reviewed together.
Version: 1.0.0
Last updated: 2026-03-21

Navigate the codebase dependency graph to answer structural questions. Build the graph from TypeScript imports/exports, query for dependents and dependencies, and assess blast radius for proposed changes.

---

## Workflow

### Step 1 — Ensure Graph Freshness

Before querying, verify the graph is current:

```bash
# Check if graph exists
ls -la agent-os/graph.json

# If missing or >24h old, rebuild
bash agent-os/scripts/graph-build.sh

# If only recent changes needed, incremental update
bash agent-os/scripts/graph-update.sh
```

### Step 2 — Query for a Specific File

To understand a file's role in the codebase:

```bash
# Find all files that depend on this file
bash agent-os/scripts/graph-query.sh "src/shared/src/types/tasks.ts"

# Find all dependents of a module (pattern match)
bash agent-os/scripts/graph-query.sh "permissions"
```

Output includes:
- Direct importers (1st level)
- Target's own dependencies
- Transitive importers (2nd level)

### Step 3 — Assess Blast Radius for a Branch

To understand the impact of all changes on a branch:

```bash
# Compare against main branch
bash agent-os/scripts/graph-impact.sh main

# Compare against a specific commit
bash agent-os/scripts/graph-impact.sh HEAD~5
```

Output includes:
- Changed files with risk classification
- Direct importer count per file
- Overall risk summary and recommendation

### Step 4 — Trace an Import Chain

To understand how module A reaches module B:

1. Query A's dependents: `graph-query.sh "module-a"`
2. Query B's dependencies: `graph-query.sh "module-b"`
3. Find the intersection — files that appear in both results
4. Trace the chain: A → intermediate file → B

### Step 5 — Identify Review Groups

Files that should be reviewed together (they share dependencies):

1. Run `graph-impact.sh` on the current branch
2. Group files by shared importers
3. Report which files form a "review unit" — changing one without reviewing the others is risky

### Step 6 — Report Structural Findings

Format results as:

| File | Dependents | Risk | Review Group |
|------|-----------|------|-------------|
| `src/shared/src/types/tasks.ts` | 12 | High | shared-types |
| `src/backend/src/modules/tasks/task-service.ts` | 3 | Medium | tasks-module |

### Integration with Impact Analysis Skill

This skill provides the graph data that the `impact-analysis` skill consumes:

1. Graph Navigation builds the dependency map
2. Impact Analysis classifies changes, checks test coverage, identifies doc impacts
3. Together they produce a complete risk assessment

### Rules

- Always rebuild graph before major decisions (sprint planning, large refactors)
- Cross-verify graph counts with grep for high-risk assessments
- Shared type files (`src/shared/`) always have high blast radius — flag them
- Configuration files (app.ts, routes.ts) are high-risk graph nodes
- Test files are excluded from the dependency graph — they are consumers, not dependencies

## Input Schema

```yaml
input:
  query_type:
    type: enum[file_dependents, blast_radius, import_chain, review_groups]
    required: true
    description: "Type of graph query to execute"
  target:
    type: string
    required: true
    description: "File path, module name, or branch name depending on query_type"
  compare_base:
    type: string
    required: false
    default: "main"
    description: "Base branch or commit for blast_radius queries"
```

## Output Schema

```yaml
output:
  graph_results:
    type: array
    items:
      file:
        type: string
      dependents_count:
        type: number
      risk:
        type: enum[Low, Medium, High]
      review_group:
        type: string
  import_chain:
    type: array
    required: false
    description: "Ordered list of files in the import chain (for import_chain queries)"
  summary:
    type: string
    description: "Plain-language summary of structural findings"
```

## Quality Gate

- Graph freshness has been verified (rebuilt if older than 24 hours or if recent changes exist).
- All reported dependent counts are cross-verified with grep for high-risk files.
- Review groups are logically coherent — files in the same group share actual dependencies.

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "codebase-graph-navigation"
  stage: "S1"
  suggested_next:
    - slug: "impact-analysis"
      stage: "S1"
      reason: "Classify changes and check test coverage using the graph data"
    - slug: "task-routing"
      stage: "S1"
      reason: "Route identified review groups to the correct specialist agents"
```

## Error Handling

- If `graph.json` is missing or stale, run `graph-build.sh` before proceeding; do not query a stale graph.
- If `graph-build.sh` fails, fall back to manual grep-based import tracing and note reduced accuracy.
- If a queried file is not present in the graph (e.g., new untracked file), report it as "not in graph" and suggest a rebuild.
- If circular dependencies are detected in the import chain, report the cycle and terminate chain traversal at the loop point.
