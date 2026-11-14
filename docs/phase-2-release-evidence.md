# Phase 2 release evidence plan

Start capture after the beta coordinator records Sprint 2.8.0 exit and identifies a frozen candidate commit. Run the installation and recovery checks in RELEASING.md from a clean checkout of that commit. Record the OS, Node and npm versions, candidate SHA, lockfile checksum and test logs. Check public links and confirm the marketplace and payment feature defaults.

## Clean-install rehearsal

On November 14, 2026, `scripts/smoke.sh` passed from a fresh Git clone of `003eac0b04a6b2ddc8d9bab60462e89521e05634` on Windows build 19045 with Git Bash, Node 24.14.0, and npm 11.9.0. The working-copy lockfile SHA-256 was `435ca45a1a922c821e92fa03916fb4b3f18ba9736c2f5915344ea8a967574d27`.

The run installed dependencies, passed `verify-all`, booted the local Panel, standalone Lobby, and Relay, and received HTTP 200 from the runtime and agent lists, lobby discovery, and relay health. The smoke script requires HTTP 200 at each service's readiness route and prints the last response status if a service stays unhealthy. Use a Git clone for this check because the memory suite inspects tracked hook modes and Git history. Repeat verification from the frozen candidate after beta exit.

On November 14, 2026, a clean Windows checkout with the x402 2.31.0 and transitive HTTP parser updates passed `npm ci`, `npx tsc -b`, and `npm run verify-all`. The production dependency audit reported four high and five moderate entries after the update, compared with seven high and three moderate before it. Remaining entries involve the Vercel SDK dependency chain, Concordium SDK dependencies, and the Express query parser. Keep the audit distinct from the functional verification and live commerce evidence.

The subsequent Slack relay lockfile update resolves Express 4.22.3 and qs 6.16.2. The Vercel and Concordium dependency chains still require separate compatibility work.

## Benchmark protocol

Use the same pinned task revision, acceptance checks, model, per-run token and compute budgets, and time limits for Agent OS Swarm, a single-agent baseline, and one external orchestrator. Record the orchestrator and provider versions, region, plan and runtime profile. Start each run from the same clean input and alternate run order. Save raw results and disclose unavailable metrics and any differences in configuration.

For every attempt record completion, elapsed time, model usage, compute estimate and reported charge, interventions, regressions, cleanup and recovery. Include failed attempts in denominators and show sample sizes. Publish the fixtures and result tables together after review.

## Flagship recording

Record a verified lobby across two machines and runtimes. Show the owner connecting a provider, finding and hiring a specialist, assigning scoped work, and reviewing the pinned patch and test evidence. Use disposable accounts and redact credentials and private artifact links. Publish captions or a transcript with the recording.

After evidence review, reconcile the README, docs index, website tour, release notes and operator guides against the candidate. Verify all claims against recorded results. External proof and payment qualifications and PLL require their own evidence. Record the release decision before publication.

The Visual Tour uses example lobby captures and separate captions for the current controls. Refresh the screenshots against the frozen candidate and check that Apps shows the hosted audit history, Agents shows the bundled roster and draft controls, and Marketplace shows the current escrow status. Keep sample data identifiable and omit credentials and private task content.

The current Apps screenshot was captured in an isolated local lobby with an example lesson in the hosted audit feed. It illustrates where operators can inspect training evidence. Refresh the capture after beta exit using the frozen candidate.

On November 14, 2026, the public deployment at `5067e6210b8e308269f42b48e95f338f5d3c0ebf` returned HTTP 200 for the website, Lobby, Panel, x401 test page, x402 merchant page and beta runbook. The website exposed the Marketplace tour and the Lobby page contained the escrow-pending notice. Repeat these checks on the frozen candidate after beta exit.

Status: awaiting beta exit. No public benchmark results or recording yet.

### Measurement tooling

Freeze an expected-attempt manifest before collecting results. Include the candidate `revision`, complete group `configurations`, and an `attempts` array with each planned `id`, `scenario`, and `group`. Run `node scripts/summarize-phase-2-benchmark.mjs attempts.json manifest.json` to reject configuration drift and missing or unexpected attempts, including entirely missing scenarios. Older manifests need the frozen configuration added before this command can verify them.

After beta exit, keep the raw observations for the frozen revision and summarize them with the frozen manifest. Supply a JSON object with a full lowercase Git SHA in revision and an attempts array. Each attempt needs a unique id, scenario, group (swarm, single-agent, or external), outcome (completed, failed, timed-out, or cancelled), elapsedMs, regression (boolean), cleanup (confirmed, failed, or not-applicable), and recovery (succeeded, failed, or not-attempted). Record modelTokens, modelCostMicros, computeMicrosEstimated, computeMicrosReported, and interventions as nonnegative integers when measured. Omit unavailable measurements or use null.

The summary retains every outcome in the denominator and reports measurement coverage alongside totals and means. Provide configurations keyed by group. Each group records runner, runnerVersion, model, runtime, provider, providerVersion, region, plan, tokenBudget, computeBudgetMicros and timeoutMs. The summary carries these settings forward so reviewers can identify differences. To check the calculation without running a comparison, use node scripts/verify-phase-2-benchmark.mjs.
