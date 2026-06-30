Title: Chaos Testing
Keywords: chaos-engineering, failure-injection, latency-test, resilience, recovery-audit
Agents: chaos-steward, performance-analyst, test
When to use: When executing mock network delays, testing API failover rates, simulating crash recoveries, and checking circuit-breakers.
Version: 1.0.0
Last updated: 2026-06-30

Inject failures, latency, and resource limits into test environments to audit the system's fault-tolerance, failover paths, and exception handling.

---

## Workflow

### Step 1 — Select Target Failure
Identify the specific failure simulation to perform:
- **Network Latency:** Inject 1000ms+ delay on API/database endpoints.
- **Service Outage:** Kill or block connection to secondary services (e.g. Concordium Indexer, Lobby durastore).
- **Process Crash:** Abruptly terminate the runner thread or WebSocket bridge in mid-execution.

### Step 2 — Establish Baseline Metrics
Verify the system status before injecting chaos: check response times, success rates, and memory foot-print.

### Step 3 — Inject Failure
Trigger the failure simulation using mock intercepts, proxy delays, or Docker container shutdowns in local test clusters.

### Step 4 — Evaluate Recovery Behavior
Monitor and check that:
- Exception handlers catch the failure safely (fail-closed, no token leaks).
- Retries or fallback strategies engage (e.g. local InMemory fallback store when the remote lobby database is offline).
- The system recovers gracefully and returns to baseline state once the fault resolves.

---

## Input Schema

```yaml
input:
  target_service:
    type: string
    required: true
    description: "The name of the service or client model to inject faults into"
  fault_type:
    type: enum
    values: [latency, disconnect, process_kill]
    required: true
    description: "Type of failure simulation to perform"
```

## Output Schema

```yaml
output:
  resilience_report:
    type: object
    properties:
      recovery_successful: { type: boolean }
      recovery_time_ms: { type: integer }
      verdict: { type: enum, values: [Resilient, Vulnerable] }
  findings:
    type: array
    items:
      type: object
      properties:
        symptom: { type: string }
        failure_trapped: { type: boolean }
        error_leak_found: { type: boolean }
```

## Quality Gate

- Zero uncaught fatal exceptions leak out during failure injection
- The system reverts to baseline operation within 5000ms of fault removal
- All temporary connections, buffers, and open sockets are cleanly released on error

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "chaos-testing"
  stage: "S3"
  suggested_next:
    - slug: "root-cause-debugging"
      stage: "S3"
      reason: "Any failure to recover gracefully requires systematic root-cause tracing and fix planning"
```

## Error Handling

- If the baseline environment is already unhealthy, abort the injection and request env fix.
- Ensure all injected chaos triggers automatically time out after 60s to prevent locking developer workspaces.
