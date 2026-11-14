# Phase 2 release evidence plan

Start capture after the beta coordinator records Sprint 2.8.0 exit and identifies a frozen candidate commit. Run the installation and recovery checks in RELEASING.md from a clean checkout of that commit. Record the OS, Node and npm versions, candidate SHA, lockfile checksum and test logs. Check public links and confirm the marketplace and payment feature defaults.

## Benchmark protocol

Use the same pinned task revision, acceptance checks, model, per-run token and compute budgets, and time limits for Agent OS Swarm, a single-agent baseline, and one external orchestrator. Record the orchestrator and provider versions, region, plan and runtime profile. Start each run from the same clean input and alternate run order. Save raw results and disclose unavailable metrics and any differences in configuration.

For every attempt record completion, elapsed time, model usage, compute estimate and reported charge, interventions, regressions, cleanup and recovery. Include failed attempts in denominators and show sample sizes. Publish the fixtures and result tables together after review.

## Flagship recording

Record a verified lobby across two machines and runtimes. Show the owner connecting a provider, finding and hiring a specialist, assigning scoped work, and reviewing the pinned patch and test evidence. Use disposable accounts and redact credentials and private artifact links. Publish captions or a transcript with the recording.

After evidence review, reconcile the README, docs index, website tour, release notes and operator guides against the candidate. Verify all claims against recorded results. External proof and payment qualifications and PLL require their own evidence. Record the release decision before publication.

Status: awaiting beta exit. No public benchmark results or recording yet.

### Measurement tooling

Freeze an expected-attempt manifest before collecting results. Give it the same `revision` and an `attempts` array with each planned `id`, `scenario`, and `group`. Run `node scripts/summarize-phase-2-benchmark.mjs attempts.json manifest.json` to reject missing or unexpected attempts, including entirely missing scenarios.

After beta exit, keep the raw observations for the frozen revision and summarize them with node scripts/summarize-phase-2-benchmark.mjs attempts.json. Supply a JSON object with a full lowercase Git SHA in revision and an attempts array. Each attempt needs a unique id, scenario, group (swarm, single-agent, or external), outcome (completed, failed, timed-out, or cancelled), elapsedMs, regression (boolean), cleanup (confirmed, failed, or not-applicable), and recovery (succeeded, failed, or not-attempted). Record modelTokens, modelCostMicros, computeMicrosEstimated, computeMicrosReported, and interventions as nonnegative integers when measured. Omit unavailable measurements or use null.

The summary retains every outcome in the denominator and reports measurement coverage alongside totals and means. Provide configurations keyed by group. Each group records runner, runnerVersion, model, runtime, provider, providerVersion, region, plan, tokenBudget, computeBudgetMicros and timeoutMs. The summary carries these settings forward so reviewers can identify differences. To check the calculation without running a comparison, use node scripts/verify-phase-2-benchmark.mjs.
