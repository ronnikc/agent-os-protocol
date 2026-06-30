Title: Memory & Performance Profiling
Keywords: memory-leak, profiling, heap-snapshot, performance-profiling, async-tracking
Agents: performance-analyst, test
When to use: When diagnosing Node.js or browser memory leaks, analyzing heap allocations, and tracking active async connections.
Version: 1.0.0
Last updated: 2026-06-30

Audit heap allocations, identify memory leaks, and profile active connections to optimize backend service stability.

---

## Workflow

### Step 1 — Collect Baseline Heap Snapshot
Start the target Node process or page execution with debugging flags active (e.g. `--inspect`). Capture the baseline heap allocation state.

### Step 2 — Execute Test Cycles
Execute repeated request iterations (e.g. 100 API queries, or opening and closing 20 WebSockets) to trigger potential resource accumulation paths.

### Step 3 — Capture Comparison Snapshot
Capture a second heap snapshot. Compare the baseline and post-run snapshots, tracking:
- Objects count and sizes that remain uncollected.
- References paths of dangling event listeners or closures.
- Unreleased TCP sockets or intervals.

### Step 4 — Formulate Mitigation Plan
Report the specific file and function boundaries responsible for retaining unreferenced objects.

---

## Input Schema

```yaml
input:
  process_target:
    type: string
    required: true
    description: "The name or process ID of the Node service to inspect"
  cycles_count:
    type: integer
    required: false
    default: 100
    description: "Number of request cycles to run before comparing snapshots"
```

## Output Schema

```yaml
output:
  profile:
    type: object
    properties:
      leak_detected: { type: boolean }
      heap_delta_bytes: { type: number }
  dangling_references:
    type: array
    items: string
```

## Quality Gate

- Profile reports locate the precise file and line range of the retained closures
- Event listener counts remain flat after test execution cycles
- Unused async timers are cleared during process shutdown phases

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "memory-profiling"
  stage: "S4"
  suggested_next:
    - slug: "performance-optimization"
      stage: "S4"
      reason: "Performance optimization routes verify bundle allocations and execution times"
```

## Error Handling

- If heap snapshot size exceeds memory limits, run heap sampling allocations instead.
- If target process is not inspectable, check Node version flags and environment permissions.
