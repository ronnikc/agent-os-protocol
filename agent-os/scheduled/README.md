# Scheduled Quality Assurance System

> **Last updated:** 2026-04-11
> **Purpose:** Automated PR quality review, fix sprint generation, and fix sprint execution on a daily cycle.
> **Status:** Active — Task B is in **catch-up mode** (21-day lookback, 20 PR/run cap) clearing a ~260-PR backlog accumulated 2026-04-04 through 2026-04-10 while the pipeline was down.
>
> **Manual trigger:** All 3 tasks can be triggered manually from the Agent OS Panel at `http://localhost:4800` → Scheduled tab. The panel also supports enable/disable and schedule editing.
>
> **2026-04-11 changes (see "Changelog" at the bottom):**
> - Schedule timezone: **local time**, not UTC as earlier docs implied
> - Schedule times rebalanced: A=03:00, B=04:00, C=05:00 local time (was A=04:00, B=04:10, C=04:30 — Task C used to race past Task B's output)
> - Read-side MCP calls moved to `agent-os/scripts/mcp-call.sh` (the tool namespace `mcp__github__*` is NOT available in the Claude Scheduled Cloud session, only the proxy tunnel)
> - Task B catch-up mode added (`lookback_hours: 504`, `max_prs_per_run: 20`, `reviewed_prs` tracker in `last-review.json`)

## Overview

The Scheduled QA System extends the Agent OS Protocol with three automated daily tasks via Claude Code's scheduled task feature. The system provides continuous quality assurance by reviewing merged PRs, generating fix-sprint specs for issues found, and executing those fix-sprints with full build/test verification.

**This system operates entirely outside CI** — all fix-sprint work goes through PRs for human review.

## Dependency Chain & State Management

Each scheduled task runs in a **separate session starting from `main`**. Tasks cannot read files from unmerged branches created by upstream tasks. To solve this:

**Rule: State files go to `claude/scheduled-state`, artifacts go to feature branches.**

The `claude/scheduled-state` branch is a persistent, unprotected branch that serves as the shared state store. It is NOT a feature branch — it is never merged or PR'd. All tasks push state there and fetch from it.

| File type | Push to | Why |
|---|---|---|
| State files (`state/*.json`) | `claude/scheduled-state` | Downstream tasks fetch and read them immediately |
| Artifacts (graph.json, specs, code fixes) | Feature branch + PR | Human review before merge |

```
Task A → pushes graph to branch+PR, state to claude/scheduled-state
          ↓ (state on claude/scheduled-state)
Task B → fetches claude/scheduled-state, pushes specs to branch+PR, queue+state to claude/scheduled-state
          ↓ (queue with embedded findings on claude/scheduled-state)
Task C → fetches claude/scheduled-state, reads queue, pushes fixes to branch+PR, updated queue to claude/scheduled-state
```

**Key design:** Task B embeds full findings in `pending-fix-sprints.json` queue entries. Task C reads findings from the queue — it never needs to fetch spec files from Task B's unmerged branch.

Each task starts with:
```bash
git fetch origin claude/scheduled-state 2>/dev/null || echo "First run"
git show origin/claude/scheduled-state:agent-os/scheduled/state/<file>.json > agent-os/scheduled/state/<file>.json
```

## Architecture

```
Schedule A (03:00 local time)  Schedule B (04:00 local time)        Schedule C (05:00 local time)
────────────────────────  ──────────────────────────────  ────────────────────────────
Graph Update              PR Quality Review               Fix Sprint Executor
│                         │                               │
├─ graph-update.sh        ├─ mcp-call.sh list_prs         ├─ Read pending-fix-sprints
├─ mcp-push.sh            ├─ mcp-call.sh pr_read          │   (embedded findings)
├─ mcp-create-pr.sh       ├─ Filter by reviewed_prs       ├─ Create fix/<id> branch
└─ Write state            ├─ Cap at max_prs_per_run       ├─ Route to write-mode agents
                          ├─ Classify → route agents     ├─ Build verification (tsc)
                          ├─ Agent assessment per PR     ├─ Test verification
                          ├─ Generate fix-sprint spec    ├─ mcp-push.sh changed files
                          ├─ mcp-push.sh specs           ├─ mcp-create-pr.sh
                          ├─ mcp-create-pr.sh            └─ Write state (real wall-clock)
                          └─ Append reviewed_prs
```

**Gap between tasks is 60 minutes** (was 10/20 minutes) so Task B always finishes before Task C starts — the earlier spacing caused a race where Task C read pre-B state 20 minutes into B's ~45-minute run and exited with `no-pending` before B's output landed.

## Directory Structure

```
agent-os/scheduled/
  config.json              # Schedule configuration and agent routing rules
  README.md                # This file
  state/                   # Pushed to claude/scheduled-state branch by each task
    last-graph-update.json # Timestamp of last graph update
    last-review.json       # Timestamp + metadata of last PR review
    last-executor.json     # Timestamp + metadata of last executor run
    pending-fix-sprints.json # Queue of fix-sprints awaiting execution
  prompts/                 # Claude Code scheduled task prompts
    graph-update.md        # Schedule A prompt
    pr-quality-review.md   # Schedule B prompt
    fix-sprint-executor.md # Schedule C prompt
  templates/               # Templates for generated artifacts
    fix-sprint-spec.md     # Fix sprint spec template
    fix-sprint-workfile.md # Workfile template
    review-report.md       # Quality assessment report template

docs/product/fix-sprints/  # COMMITTED — fix sprint specs for human review
  README.md                # Index of all fix sprints + status table
```

## Agent Routing

Changed files are classified by path pattern and routed to specialist agents:

| File pattern | Lead Agent | Supporting Agents |
|-------------|-----------|-------------------|
| `src/backend/**` | Backend | Security, Code Review |
| `src/frontend/**` | Frontend | Accessibility, Code Review, I18N |
| `src/shared/**` | Code Review | Backend, Frontend |
| `docs/**` | Documentation | Compliance |
| `agent-os/**` | Planning | Code Review |

For mixed changes (e.g., backend + frontend), Code Review Specialist leads with domain specialists supporting.

## Severity Levels

| Severity | Triggers fix sprint? | Examples |
|----------|---------------------|----------|
| **High** | Yes | Missing RBAC middleware, SQL injection vector, broken build |
| **Medium** | Yes | Missing audit events, i18n violations, pattern non-compliance |
| **Low** | No (logged only) | Style inconsistencies, minor documentation gaps |

## Fail-Safe Behavior

- **Build fails** → Executor stops, sprint marked `build-failed`, awaits human intervention
- **Tests fail** → Executor stops, sprint marked `test-failed`, awaits human intervention
- **No PRs in window** → Reviewer writes timestamp and exits cleanly
- **No pending fix-sprints** → Executor writes timestamp and exits cleanly
- **Broken code never reaches a PR** — verification gates are mandatory

## Configuration

See `config.json` for all configurable parameters. Key settings:

- `interval` — cycle frequency (daily)
- `time_utc` — scheduled run time (name kept for compat; **actual cron runs in local time** — the Claude Scheduled Cloud UI is the source of truth)
- `lookback_hours` — Task B only: how far back to look for merged PRs. **2026-04-11: raised to 504 (21 days)** for catch-up mode. Before that the default was 24. Drop back to 168 (1 week) once the backlog clears.
- `max_prs_per_run` — Task B only: hard cap on PRs reviewed per run (default: 20). Newest-first; anything over the cap is left for the next run.
- `skip_already_reviewed` — Task B only: when true, the `reviewed_prs` array in `last-review.json` is consulted to skip PRs already processed on previous runs. This is what makes the catch-up lane work without duplicate reviews.
- `min_severity_for_fix_sprint` — minimum severity to trigger a fix sprint (default: medium)
- `max_findings_per_sprint` — cap on findings per sprint to keep scope manageable (default: 50). Overflow findings create additional fix sprints.
- `require_clean_build` / `require_tests_pass` — Task C only: mandatory verification gates.

## Setting Up Schedules

Create three scheduled tasks in the Claude Scheduled Cloud UI:

```
# Schedule A — Graph Update (daily at 03:00 local time)
# Prompt: contents of prompts/graph-update.md

# Schedule B — PR Quality Review (daily at 04:00 local time)
# Prompt: contents of prompts/pr-quality-review.md

# Schedule C — Fix Sprint Executor (daily at 05:00 local time)
# Prompt: contents of prompts/fix-sprint-executor.md
```

Each prompt file is self-contained — it includes all instructions the scheduled session needs. **Whenever you edit a prompt file in the repo, you must also paste the updated content into the Claude Scheduled Cloud UI** — the cloud sessions don't re-read the repo's prompt files at runtime; they use the prompt body that was stored in the Claude Scheduled Cloud record at task-creation/edit time.

## MCP in Scheduled Cloud Sessions (read + write)

The Claude Scheduled Cloud environment has these constraints:
- **`git push` → BLOCKED** (403, proxy is read-only)
- **`gh` CLI → NOT available**
- **`mcp__github__*` tool namespace → NOT available.** The Claude Code scheduled cloud session does NOT register GitHub MCP tools in its tool catalog, so `mcp__github__list_pull_requests`, `mcp__github__pull_request_read`, etc. appear as "not available" when called directly. This was the primary failure mode 2026-04-04 → 2026-04-10 (Task B errored out every single run).
- **MCP GitHub server via proxy tunnel → AVAILABLE.** The underlying MCP server is reachable at `POST /v2/ccr-sessions/<sessionId>/github/mcp` through the proxy tunnel (`21.0.0.31:15004` by default). All three scripts below use this path.

Three scripts handle all remote MCP operations:

**Push files (write):**
```bash
bash agent-os/scripts/mcp-push.sh \
  --branch claude/my-branch-SESSION_ID \
  --message "commit message" \
  -- file1.json file2.md
```

**Create PRs (write):**
```bash
bash agent-os/scripts/mcp-create-pr.sh \
  --head claude/my-branch-SESSION_ID \
  --base main \
  --title "PR title" \
  --body "PR description"
```

**Any other MCP GitHub tool (read or write):**
```bash
# List merged PRs (Task B)
bash agent-os/scripts/mcp-call.sh list_pull_requests \
  '{"owner":"ronnikc","repo":"agent-os-protocol","state":"closed","sort":"updated","direction":"desc","perPage":30}'

# Get files changed in a PR (Task B)
bash agent-os/scripts/mcp-call.sh pull_request_read \
  '{"owner":"ronnikc","repo":"agent-os-protocol","pullNumber":1309,"method":"get_files"}'

# Date-filtered search (Task B pagination)
bash agent-os/scripts/mcp-call.sh search_pull_requests \
  '{"query":"repo:ronnikc/agent-os-protocol is:pr is:merged merged:>=2026-04-10"}'
```

All three scripts call the MCP GitHub server directly via the Anthropic API proxy tunnel. They auto-detect auth tokens, session ID, proxy config, and repo owner/name. They bypass the Claude Code tool namespace entirely — that's why they work in scheduled cloud sessions where the tool namespace is empty.

**Important:**
- Do NOT try to sync local branch with remote after MCP push — it creates merge loops
- Branch names must follow `claude/<name>-<SESSION_ID>` format
- `mcp-push.sh` reads files from disk — no size limits, no context window issues
- `mcp-create-pr.sh` outputs `PR_URL=<url>` on success — parse it to capture the URL
- `mcp-call.sh` output is the raw tool result text — pipe through `jq` to parse further
- **Never call `mcp__github__*` directly in scheduled cloud session prompts** — use these scripts. (Interactive sessions CAN still use the tool namespace because it's populated there; scheduled sessions CANNOT.)

## Catch-up Mode (Task B)

Task B was down 2026-04-04 through 2026-04-10 because it tried to call `mcp__github__list_pull_requests` as a Claude Code tool-namespace invocation, which returned "not available" in every scheduled cloud session. ~260 merged PRs accumulated during the outage without being reviewed.

The 2026-04-11 fix introduced a per-run cap so Task B can gradually work through the backlog without overwhelming any single session:

- **`lookback_hours: 504`** (21 days) — wider window so old backlog PRs are still in range
- **`max_prs_per_run: 20`** — hard cap per run; the next 20 newest unreviewed PRs are picked up, the rest wait for tomorrow
- **`reviewed_prs` array in `last-review.json`** — tracker of PR numbers already processed. Each run appends its PR numbers; the array is capped at the last 500 entries to bound file size. Subsequent runs filter this list out of their Step 1 output.
- **Skip queue overlap** — any PR already appearing as a `source_prs` entry in `pending-fix-sprints.json` is also skipped, so Task C's in-flight queue doesn't get re-reviewed.

**Math:** ~260 backlog PRs ÷ 20 per run = **~13 days of normal runs** to clear the backlog. After that, daily volume is low and each run processes a handful of PRs in minutes. Drop `lookback_hours` back to 168 (1 week) once the `reviewed_prs` array has fully absorbed the backlog — see "Exit criteria for catch-up mode" below.

### Exit criteria for catch-up mode

Once both conditions hold:
1. Task B's last run reports `prs_reviewed` equal to the count of merged PRs in the current 24h window (no backlog residue)
2. The `reviewed_prs` array in `last-review.json` contains every PR number merged since 2026-04-04

…drop `config.json → lookback_hours` back to `168` (one week) and optionally lower `max_prs_per_run` back to `10`. Normal daily steady-state operation resumes.

## Scheduling Race (Task B ↔ Task C) — Historical

Before 2026-04-11, the schedule was A=04:00, B=04:10, C=04:30 local time — only a 20-minute gap between B and C. In practice Task B took ~45 minutes on 2026-04-10, so Task C started 20 minutes into B's run, read pre-B state, found no pending entries, and exited at 04:41 with `status: no-pending`. B finished at 04:55 and wrote the new queue entry — too late for C. The `fix-sprint-20260410-0410` entry then sat pending until a human manually executed it as PR #1310.

**Fix:** schedule gaps widened to 60 minutes each — A=03:00, B=04:00, C=05:00 local time. Task B has a full hour to finish before Task C starts. Combined with the `mcp-call.sh` plumbing fix, this closed both failure modes that had been causing Task C to exit with `no-pending` daily.

## Changelog

- **2026-06-22** — Deferred-findings leak fixed (Task C). A review found that when Task C does a *partial* run (fixes fewer than all findings in a sprint, due to the 1-sprint-per-run budget or MCP payload limits), the deferred findings were silently orphaned: the queue entry was marked terminal (`pr-opened`) and **nothing ever re-queued the leftovers**, despite executor notes claiming "deferred for separate sprints." 31 findings across three partial runs were affected (`20260619-0053` 18/36, `20260620-0029` 5/6, `20260620-2109` 6/18 — including one HIGH-severity i18n finding). Two changes:
  - **New Step 7e in `prompts/fix-sprint-executor.md` — mandatory auto-requeue.** On any partial run the executor now marks the entry `pr-opened-partial` (with `partial`/`findings_fixed`/`deferred_findings`/`deferred_finding_indexes`) and appends a fresh `pending` follow-up entry (`<id>-followup`) carrying only the deferred findings. Idempotent (never double-queues); the next run re-verifies each against `main` via Step 1.5 so re-queues can't cause duplicate fixes. Step 7c/7d updated to write partial spec headers and the `pr-opened-partial` status.
  - **Back-fill.** The three orphaned sprints above were re-queued (`*-followup` entries + spec files) and their partial source entries annotated; their spec headers were corrected from the misleading `Pending` to `Partial — N of M`.
- **2026-04-13** — Task C session-budget fix. Task C ran at 05:00 local time, detected pre-existing webhook test failures in the Step 0.5 health check, fixed them, then hung on the full-suite re-run verification — it never reached Step 1 and no fix sprint was executed. Two structural changes:
  - **Step 0.5 is now build-only and fail-fast.** `tsc` for shared/backend/frontend only (seconds, deterministic). If any build fails on `origin/main`, exit immediately with `"status": "codebase-broken"` — no fix attempts. Task C is a fix-sprint executor, not a general-purpose healer; pre-existing issues are human-triage or Task B's territory.
  - **Step 6 now runs targeted tests, not the full suite.** Resolves colocated test files for each changed source file (`<dir>/__tests__/<basename>.test.{ts,tsx}`) and runs only those via vitest per workspace config. The full suite (409 frontend files, ~4 min, flaky Monitor notifications) is not completable in a cloud scheduled session; targeted tests cover the fix sprint's actual blast radius.
  - `config.json` schedule times were also stale (still `04:00 / 04:10 / 04:30`); synced to `03:00 / 04:00 / 05:00` local time to match the real cloud cron and the README.
- **2026-04-11** — Post-sprint backlog review (fix sprints A/B/C/D). Major pipeline fixes:
  - New `agent-os/scripts/mcp-call.sh` for read-side MCP GitHub tool calls via proxy tunnel
  - Task B: `lookback_hours 24 → 504`, new `max_prs_per_run: 20`, new `reviewed_prs` tracker, every `mcp__github__*` call replaced with `mcp-call.sh` invocations
  - Task C: schedule `04:30 → 05:00 local time`, `last_run` now uses real `date -u -Iseconds` wall-clock (was being written as fabricated round-number timestamps copied from the playbook schedule text)
  - All playbook headers: `"UTC" → "local time"` (reflects reality)
  - See PR #1317 for the full diff.
- **2026-04-04** — README last updated; scheduled pipeline was stable with 24h lookback and 04:10 UTC run time. Then the tool-namespace issue hit and Task B started erroring out every night.
