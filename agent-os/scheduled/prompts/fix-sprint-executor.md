# Schedule C — Fix Sprint Executor

> **Type:** Scheduled task (daily at 05:00 local time, 60 minutes after graph update)
> **Duration:** ~15-45 minutes depending on fix complexity
>
> **Scheduling note (2026-04-11):** moved from 04:30 → 05:00 local time so Task C always starts AFTER Task B (04:00 local time) has finished producing its output. The earlier 20-minute gap caused a race where Task C read pre-B state, found no pending entries, and exited before Task B's output landed.

## HARD RULES (read first)

1. **NEVER run `git push`** — it will 403. The proxy is read-only.
2. **NEVER run `gh`** — it is not installed.
3. **NEVER run `git commit`** — there is nothing to commit locally.
4. **ALL remote writes use `agent-os/scripts/mcp-push.sh` and `agent-os/scripts/mcp-create-pr.sh`** — never call MCP tools directly for writes.
5. **NEVER try to sync local branch with remote after MCP push** — local and remote diverge, that's fine.
6. **NEVER push to main** — code fixes go to feature branches only. State files go to `claude/scheduled-state`.
7. **NEVER merge PRs** — that's for humans.
8. **NEVER force-push or amend commits.**
9. **State files go to `claude/scheduled-state`, code fixes go to feature branches** — `pending-fix-sprints.json` and `last-executor.json` MUST be pushed to `claude/scheduled-state`. Never push to main (branch protection blocks it).

## Dependency chain

**Upstream:** Task B (PR quality review) pushes `pending-fix-sprints.json` to `claude/scheduled-state` with **embedded findings**. Task B's fix sprint specs are on an unmerged feature branch — do NOT try to fetch them. Use the embedded findings from the queue entry instead.

**If `pending-fix-sprints.json` does not exist on `claude/scheduled-state` or has no pending entries, Task B has not produced work yet. Exit cleanly.**

## Prerequisites

Read these files before starting:
- `agent-os/scheduled/config.json` — executor settings
- `agent-os/SUB-AGENTS.md` — sub-agent system, mandatory prompt template, verification rules
- `agent-os/SPRINTS.md` — sprint lifecycle (lightweight adaptation for automated fixes)
- `agent-os/memories/engineering-code-patterns.md` — canonical code patterns

## Step 0 — Install dependencies and fetch shared state

```bash
npm install --silent 2>&1 | tail -3
```

Fetch the shared state branch:

```bash
git fetch origin claude/scheduled-state 2>/dev/null || echo "State branch does not exist — no pending work"
```

If it exists, restore state files locally:

```bash
if git rev-parse origin/claude/scheduled-state >/dev/null 2>&1; then
  git show origin/claude/scheduled-state:agent-os/scheduled/state/pending-fix-sprints.json > agent-os/scheduled/state/pending-fix-sprints.json 2>/dev/null || true
  git show origin/claude/scheduled-state:agent-os/scheduled/state/last-executor.json > agent-os/scheduled/state/last-executor.json 2>/dev/null || true
fi
```

If the state branch doesn't exist, go to Step 8 with `"status": "no-pending"`.

## Step 0.5 — Codebase health check (build-only, fail-fast)

Verify that `origin/main` builds cleanly. This step is a **gate**, not a repair station — if main is broken, stop and let humans triage.

> **Why build-only, no test run here?** The cloud scheduled session cannot reliably complete the full test suite (409 frontend files / ~4 min per run, Monitor notifications unreliable). On 2026-04-13 Task C burned the entire session in this step fixing pre-existing test failures and re-running the full suite — it never reached Step 1. `tsc` builds finish in seconds and are deterministic; tests are not. Verification of the fix sprint's actual behavior happens in **Step 6**, scoped to the files this sprint changed.
>
> **Why fail-fast instead of fix?** Task C is a fix-sprint executor, not a general-purpose healer. Pre-existing build errors are either (a) a recent regression humans must fix, or (b) already covered by a queued fix sprint spec from Task B — burning this session on them defeats Task C's purpose. CLAUDE.md's "zero tolerance for pre-existing errors" (R-02) still applies — but via the full build check in **Step 5** scoped to this sprint's changes, not via an open-ended repair loop before work begins.

```bash
git fetch origin main
git checkout -b health-check origin/main

npx tsc -p src/shared/tsconfig.json
npx tsc -p src/backend/tsconfig.json --noEmit
npx tsc -p src/frontend/tsconfig.json --noEmit
```

### Decision after Step 0.5

| Result | Action |
|---|---|
| All three builds pass | `git checkout main && git branch -D health-check`. Continue to Step 1. |
| Any build fails | Go to Step 8 with `"status": "codebase-broken"`. Capture the tsc error summary (tail of each failing build) into `last-executor.json` so humans can triage. **Stop. Do NOT attempt to fix pre-existing build errors in this step.** |

## Step 1 — Check for pending fix sprints (with already-fixed loop)

Read `agent-os/scheduled/state/pending-fix-sprints.json`.

### Decision after Step 1

| Result | Action |
|---|---|
| File missing or no `"status": "pending"` entries | Go to Step 8 with `"status": "no-pending"`. **Stop.** |
| Pending entry found | Select the **oldest** pending entry. Continue to Step 1.5. |

### Step 1.5 — Quick-verify: are the findings already fixed?

Before committing to a full implementation cycle, **quickly check if the findings are already resolved on main**. Read each file referenced in the embedded findings and verify whether the issue still exists.

Also check the spec file's `**Status:**` header — if it says `Already Fixed` or `Complete`, the sprint was already processed. Mark the queue entry and move on without re-verifying.

| Result | Action |
|---|---|
| Spec file status is `Already Fixed` or `Complete` | Mark queue entry `"status": "already-fixed"`. **Loop back** to Step 1 for next pending entry. |
| ALL findings already fixed on main | Mark queue entry `"status": "already-fixed"`, add `"resolution_note"`. **Update the spec file** (Step 1.6). Then **loop back** to Step 1 for next pending entry. |
| ANY finding still present | Mark the queue entry `"status": "in-progress"`. Continue to Step 2. |

> **Why loop?** `already-fixed` sprints take ~2 minutes to verify. They should NOT count against `max_sprints_per_run` — that limit is for sprints that require real implementation work. The executor should clear all stale queue entries in a single run, then do up to 1 real fix sprint.

### Step 1.6 — Update spec file status (for already-fixed sprints)

When a sprint is resolved as `already-fixed`, update the spec file's `**Status:**` header so anyone reading it sees the status immediately.

If the spec file exists on main (spec PR was merged):

```bash
if [ -f "<spec_path>" ]; then
  sed -i 's/^\*\*Status:\*\* Pending.*/**Status:** Already Fixed (verified <DATE>)/' "<spec_path>"
fi
```

If the spec file is NOT on main (spec PR still open), update it on the spec PR branch via MCP:

```bash
git show origin/<spec_branch>:<spec_path> > /tmp/spec-file.md 2>/dev/null && \
  sed -i 's/^\*\*Status:\*\* Pending.*/**Status:** Already Fixed (verified <DATE>)/' /tmp/spec-file.md && \
  cp /tmp/spec-file.md "<spec_path>" && \
  bash agent-os/scripts/mcp-push.sh \
    --branch "<spec_branch>" \
    --message "chore: mark fix-sprint as already-fixed" \
    -- "<spec_path>"
```

Then push updated `pending-fix-sprints.json` to `claude/scheduled-state` and **loop back to Step 1**.

## Step 2 — Prepare working branch

```bash
git fetch origin main
git checkout -b fix/<fix-sprint-id> origin/main
```

Example: `fix/fix-sprint-20260322-0605`

## Step 3 — Read findings from the queue entry (NOT from unmerged branches)

The queue entry in `pending-fix-sprints.json` contains an embedded `findings` array with all the information needed:

```json
{
  "severity": "high|medium",
  "agent": "<agent-slug>",
  "file": "<file-path>",
  "line": "<line-number>",
  "rule": "<rule-id>",
  "description": "<what's wrong>",
  "suggested_fix": "<how to fix it>",
  "affected_tests": ["<test files that must be verified/updated>"],
  "test_command": "<specific vitest run command for this finding>"
}
```

The `affected_tests` and `test_command` fields tell you which tests to run after fixing each finding, and which test files may need updates. If these fields are missing (legacy format), identify affected tests yourself by searching for test files in the same module.

**Do NOT attempt to read spec files from the `spec_branch`.** The spec files are on an unmerged branch from Task B. The embedded findings contain everything you need.

If the queue entry does NOT have an embedded `findings` array (legacy format), check if the spec file exists locally at `spec_path`. If not, go to Step 8 with `"status": "spec-unavailable"`.

For each finding, understand:
- The affected file and location
- What's wrong and how to fix it
- The severity (high fixes take priority)

## Step 4 — Route to specialist agents (write mode)

For each finding, route to the appropriate specialist agent based on the file path (same routing rules as Schedule B). Agents are in **write mode** — they implement fixes, not just flag them.

**Agent invocation order (sequential dependencies):**
1. `src/shared/**` fixes first (types, constants) — Code Review Specialist
2. `src/backend/**` fixes second (services, routes) — Backend Specialist
3. `src/frontend/**` fixes last (components, pages) — Frontend Specialist
4. Cross-cutting fixes (security, i18n, accessibility) — respective specialists

Each agent must:
- Follow its **startup protocol** from its definition file in `agent-os/sub-agents/agents/`
- **Self-verify** before returning:
  - `npx tsc -p src/shared/tsconfig.json` (if shared files changed)
  - `npx tsc -p src/backend/tsconfig.json` (if backend files changed)
  - `npx tsc -p src/frontend/tsconfig.json --noEmit` (if frontend files changed)
- Fix any errors before returning

## Step 5 — Full build verification (mandatory)

```bash
npx tsc -p src/shared/tsconfig.json
npx tsc -p src/backend/tsconfig.json
npx tsc -p src/frontend/tsconfig.json --noEmit
```

### Decision after Step 5

| Result | Action |
|---|---|
| All pass | Continue to Step 6. |
| Any fail | Attempt fix (up to 3 attempts). If still failing → go to Step 8 with `"status": "build-failed"`. **Stop.** Do NOT push. |

## Step 6 — Targeted test verification (mandatory)

Run tests **scoped to files the fix sprint actually changed**. Full-suite runs do not complete reliably in the cloud scheduled session, and pre-existing failures in unrelated modules are not Task C's responsibility — Task B surfaces those as their own fix sprint specs.

**Compute test targets from changed files:**
```bash
CHANGED_SRC=$(git diff --name-only origin/main -- 'src/**/*.ts' 'src/**/*.tsx')

# Repo convention: colocated tests live at <dir>/__tests__/<basename>.test.{ts,tsx}
TEST_TARGETS=""
for f in $CHANGED_SRC; do
  dir=$(dirname "$f")
  base=$(basename "$f" | sed -E 's/\.(ts|tsx)$//')
  for ext in ts tsx; do
    candidate="$dir/__tests__/$base.test.$ext"
    [ -f "$candidate" ] && TEST_TARGETS="$TEST_TARGETS $candidate"
  done
  # If the fix directly touched a test file, run it
  case "$f" in *.test.ts|*.test.tsx) TEST_TARGETS="$TEST_TARGETS $f";; esac
done

TEST_TARGETS=$(echo "$TEST_TARGETS" | tr ' ' '\n' | sort -u | grep -v '^$' || true)
echo "Resolved test targets:"
printf '  %s\n' $TEST_TARGETS
```

**Split targets by workspace and run (log via `| tee` per R-28):**
```bash
BACKEND_TARGETS=$(echo "$TEST_TARGETS"  | grep '^src/backend/'  || true)
FRONTEND_TARGETS=$(echo "$TEST_TARGETS" | grep '^src/frontend/' || true)
SHARED_TARGETS=$(echo "$TEST_TARGETS"   | grep '^src/shared/'   || true)

mkdir -p tmp

if [ -n "$BACKEND_TARGETS" ]; then
  npx vitest run --config src/backend/vitest.config.ts $BACKEND_TARGETS 2>&1 | tee tmp/test-fix-backend.log
fi
if [ -n "$FRONTEND_TARGETS" ]; then
  npx vitest run --config src/frontend/vitest.config.ts $FRONTEND_TARGETS 2>&1 | tee tmp/test-fix-frontend.log
fi
if [ -n "$SHARED_TARGETS" ]; then
  npm -w @agent-os/shared run test -- $SHARED_TARGETS 2>&1 | tee tmp/test-fix-shared.log
fi
```

**No targets resolved?** The fix sprint touched only files without colocated tests (docs, config, types-only, etc.). Record `"tests_skipped_reason": "no-colocated-tests"` in `last-executor.json` and continue to Step 7.

### Decision after Step 6

| Result | Action |
|---|---|
| All targeted tests pass (or no targets resolved) | Continue to Step 7. |
| Any targeted test fails | **Fix it.** The failure is inside the fix sprint's blast radius — you changed a file, its test now fails. Attempt fix (up to 3 attempts). If still failing → go to Step 8 with `"status": "test-failed"`. **Stop. Do NOT push.** |

> **Rule scope.** CLAUDE.md's "fix ALL test failures — no exceptions" applies to tests in the files your fix sprint touched. Pre-existing failures in unrelated modules are Task B's territory — they surface as their own fix sprint spec, not as blockers for your current work.

## Step 7 — Push fixes to feature branch + state to `claude/scheduled-state` (TWO separate pushes)

**7a. Push code fixes to a feature branch:**

Collect all modified files:
```bash
CHANGED_FILES=$(git diff --name-only origin/main)
```

```bash
bash agent-os/scripts/mcp-push.sh \
  --branch "claude/fix/<fix-sprint-id>-<SESSION_ID>" \
  --message "fix: automated quality fixes [<fix-sprint-id>]" \
  -- $CHANGED_FILES
```

The script reads files from disk directly — no need to load them into the conversation context, even for large files.

**Chunked push for large changesets (mandatory when >20 files):**

Split changed files into chunks of **15 files** per `mcp-push.sh` call. This prevents MCP payload size limits from causing timeouts. After each chunk push, verify it succeeded before proceeding to the next.

```bash
# Example: chunk and push
CHANGED_FILES=$(git diff --name-only origin/main)
FILE_COUNT=$(echo "$CHANGED_FILES" | wc -l)

if [ "$FILE_COUNT" -gt 20 ]; then
  # Split into chunks of 15 and push sequentially
  echo "$CHANGED_FILES" | xargs -n 15 bash -c '
    bash agent-os/scripts/mcp-push.sh \
      --branch "claude/fix/<fix-sprint-id>-<SESSION_ID>" \
      --message "fix: automated quality fixes [chunk]" \
      -- "$@"
  ' _
else
  bash agent-os/scripts/mcp-push.sh \
    --branch "claude/fix/<fix-sprint-id>-<SESSION_ID>" \
    --message "fix: automated quality fixes [<fix-sprint-id>]" \
    -- $CHANGED_FILES
fi
```

**Post-push verification (mandatory):** After all chunks are pushed, verify the remote file count matches local expectations. If any files are missing, re-push the missing files immediately — do NOT leave incomplete pushes and declare done.

```bash
# Verify remote file count matches
REMOTE_COUNT=$(git diff --name-only origin/main..origin/claude/fix/<fix-sprint-id>-<SESSION_ID> | wc -l)
LOCAL_COUNT=$(echo "$CHANGED_FILES" | wc -l)
if [ "$REMOTE_COUNT" -lt "$LOCAL_COUNT" ]; then
  echo "WARNING: Remote has $REMOTE_COUNT files but expected $LOCAL_COUNT — re-push missing files"
fi
```

**7b. Create PR for human review:**

> **CRITICAL — PR body formatting.** Always write the PR body to a file and pass
> it via `--body-file`. Never pass a multi-line body via `--body "..."`: literal
> `\n` in a bash double-quoted string is NOT a newline, and GitHub will render
> the body with visible `\n` characters (see PRs #1513 and #1514, 2026-04-19,
> for the symptom). Heredocs with quoted delimiters (`<<'EOF'`) preserve real
> newlines and skip every class of shell-escaping bug.

```bash
cat > /tmp/fix-executor-pr-body.md <<'EOF'
## Summary

Automated fix sprint executing findings from [<fix-sprint-id>](<spec PR URL>).

### <Category 1> (<N> findings fixed)
- <detail>

### Verification
- `tsc` builds pass (shared → backend → frontend)
- Targeted tests pass: <N> tests across <M> files
- Lint-staged passed on commit

## Files changed (<COUNT>)
- <breakdown>

Human review required.
EOF

bash agent-os/scripts/mcp-create-pr.sh \
  --head "claude/fix/<fix-sprint-id>-<SESSION_ID>" \
  --base main \
  --title "fix: Automated quality fixes [<fix-sprint-id>]" \
  --body-file /tmp/fix-executor-pr-body.md
```

Capture the PR URL from the output.

**7c. Update spec file status:**

Update the spec file's `**Status:**` header to reflect completion. If the spec file exists on main (spec PR was merged):

```bash
if [ -f "<spec_path>" ]; then
  sed -i 's/^\*\*Status:\*\* Pending.*/**Status:** Complete (fixes in PR <PR_URL>)/' "<spec_path>"
fi
```

If the spec file is on an unmerged branch, push the update via MCP:

```bash
git show origin/<spec_branch>:<spec_path> > /tmp/spec-file.md 2>/dev/null && \
  sed -i 's/^\*\*Status:\*\* Pending.*/**Status:** Complete (fixes in PR <PR_URL>)/' /tmp/spec-file.md && \
  cp /tmp/spec-file.md "<spec_path>" && \
  bash agent-os/scripts/mcp-push.sh \
    --branch "<spec_branch>" \
    --message "chore: mark fix-sprint as complete" \
    -- "<spec_path>"
```

**7d. Update the executed entry in `pending-fix-sprints.json`:**

Track, during Steps 2–6, exactly which findings you fixed. Let `FIXED_COUNT` =
number of findings actually committed to the PR and `TOTAL_COUNT` = the entry's
`findings_count`.

- **Full run (`FIXED_COUNT == TOTAL_COUNT`):** set the entry's status to
  `"pr-opened"`, add `"pr_url"`, `"executed_at"`, `"findings_fixed"`.
- **Partial run (`FIXED_COUNT < TOTAL_COUNT`):** set the entry's status to
  `"pr-opened-partial"` and ALSO record `"partial": true`,
  `"findings_fixed": FIXED_COUNT`, `"deferred_findings": (TOTAL_COUNT - FIXED_COUNT)`,
  and `"deferred_finding_indexes": [...]` (1-based indexes into the `findings`
  array that were NOT fixed). Then you MUST run **Step 7e** before pushing.

Do not push yet if this was a partial run — Step 7e adds the follow-up entry to
the same file so both changes go up in one push.

```bash
# Full run only — partial runs push after Step 7e
bash agent-os/scripts/mcp-push.sh \
  --branch claude/scheduled-state \
  --message "chore(scheduled): update fix sprint queue [pr-opened]" \
  -- agent-os/scheduled/state/pending-fix-sprints.json
```

**7c (partial variant). Spec-file status header:** when partial, set the header to
`**Status:** Partial — <FIXED_COUNT> of <TOTAL_COUNT> findings fixed (fixes in PR <PR_URL>); <N> deferred to <fix-sprint-id>-followup` instead of `Complete`.

## Step 7e — Re-queue deferred findings (MANDATORY on every partial run)

A run is *partial* whenever you fixed fewer than all findings — because of the
per-run budget (1 real sprint), an MCP payload-size limit, or a finding that
needs human judgement. **The deferred findings are NOT retried automatically:**
Step 1 only ever selects entries with `"status": "pending"`, and the entry you
just executed is now `"pr-opened-partial"` (terminal). Without an explicit
re-queue the deferred findings are orphaned forever.

> This is not hypothetical. On 2026-06-22 a review found 31 findings across three
> partial runs (`20260619-0053` 18/36, `20260620-0029` 5/6, `20260620-2109`
> 6/18) had been silently lost — each executor note said "deferred for separate
> sprints" but no separate sprint was ever created. This step closes that leak.

Append a NEW `"pending"` follow-up entry to `pending-fix-sprints.json` carrying
only the deferred findings, so the next executor run picks them up:

```bash
# DEFERRED_INDEXES = 1-based indexes of findings you did NOT fix, e.g. '[2,4,5,6]'
NOW=$(date -u -Iseconds)
SID="$FIX_SPRINT_ID"            # the entry you just executed
FID="${SID}-followup"
jq --arg sid "$SID" --arg fid "$FID" --arg now "$NOW" --arg pr "$PR_URL" \
   --argjson didx "$DEFERRED_INDEXES" '
  (.pending[] | select(.id==$sid)) as $src
  | $src.findings as $allf
  | [ $didx[] | $allf[.-1] ] as $deferred
  | (if any(.pending[]; .id==$fid) then .   # idempotent — never double-queue
     else .pending += [{
       id: $fid,
       spec_path: ("docs/product/fix-sprints/" + $fid + ".md"),
       workfile_path: ("docs/product/fix-sprints/" + $fid + "-workfile.md"),
       created: $now,
       findings_count: ($deferred|length),
       high_count:   ([ $deferred[]|select(.severity=="high") ]|length),
       medium_count: ([ $deferred[]|select(.severity=="medium") ]|length),
       source_prs: $src.source_prs,
       status: "pending",
       requeued_from: $sid,
       requeue_mode: "exact",
       origin_note: ("Auto-requeue of " + ($deferred|length|tostring) + " findings deferred by the partial run of " + $sid + " (PR " + $pr + ")."),
       findings: $deferred
     }] end)
  ' agent-os/scheduled/state/pending-fix-sprints.json > /tmp/q.json && mv /tmp/q.json agent-os/scheduled/state/pending-fix-sprints.json
```

Then generate the follow-up spec + workfile (so humans can review the carried-over
findings) and push BOTH the queue and the spec, the queue to `claude/scheduled-state`
and the spec to the fix branch:

```bash
bash agent-os/scripts/mcp-push.sh \
  --branch claude/scheduled-state \
  --message "chore(scheduled): partial run — re-queue deferred findings [${FID}]" \
  -- agent-os/scheduled/state/pending-fix-sprints.json
```

> **Note on the follow-up's findings:** the follow-up carries the *exact* deferred
> findings. The next executor run still verifies each against `main` (Step 1.5)
> and skips any already resolved, so a re-queue can never cause duplicate fixes.

## Step 8 — Write executor state (always)

Set `last_run` to the REAL wall-clock time via `date -u -Iseconds`. Do NOT copy the schedule text from the playbook header or `config.json` — that produces fabricated timestamps like `2026-04-10T04:30:00Z` that mislead every future diagnosis pass (this was the bug that made it look like Task C was running on schedule when it was actually stuck on a 17-hour delay).

Write to `agent-os/scheduled/state/last-executor.json`:

```bash
NOW=$(date -u -Iseconds)
jq -n \
  --arg now "$NOW" \
  --arg fix_sprint "$FIX_SPRINT_ID" \
  --arg status "$RUN_STATUS" \
  --arg pr_url "$PR_URL" \
  --arg branch "$BRANCH_NAME" \
  --argjson files_changed "$FILES_CHANGED" \
  --argjson findings_fixed "$FINDINGS_FIXED" \
  --argjson findings_total "$FINDINGS_TOTAL" \
  '{
    last_run: $now,
    fix_sprint: (if $fix_sprint == "" then null else $fix_sprint end),
    status: $status,
    pr_url: (if $pr_url == "" then null else $pr_url end),
    branch: (if $branch == "" then null else $branch end),
    files_changed: $files_changed,
    findings_fixed: $findings_fixed,
    findings_total: $findings_total
  }' > agent-os/scheduled/state/last-executor.json
```

Push state to `claude/scheduled-state`:

```bash
bash agent-os/scripts/mcp-push.sh \
  --branch claude/scheduled-state \
  --message "chore(scheduled): update executor state" \
  -- agent-os/scheduled/state/last-executor.json
```

If `pending-fix-sprints.json` was also modified (e.g., status changed to failed), include it in the same push:

```bash
bash agent-os/scripts/mcp-push.sh \
  --branch claude/scheduled-state \
  --message "chore(scheduled): update executor state + queue" \
  -- agent-os/scheduled/state/last-executor.json \
     agent-os/scheduled/state/pending-fix-sprints.json
```

**Done with state writes.** Continue to Step 9.

## Step 9 — Sync local working tree to remote (post-MCP cleanup)

`mcp-push.sh` writes files to the remote via the GitHub API but does **not** touch the local git index — the working tree still shows every modification even though the remote already has them. The Stop hook then nags about "uncommitted changes" that are actually already merged into their target branches. Sync local to remote so the session ends clean.

> **Precondition — only run Step 9 after every MCP push in Steps 7 and 8 succeeded.** If any push failed (`mcp-push.sh` non-zero exit, missing `PR_URL=` line, or the post-push verification in Step 7 reported missing files), the local working tree is your only copy of the work — **skip Step 9** and exit so humans can see the divergence and re-push manually.

### If a fix sprint was executed (feature branch was pushed in Step 7)

```bash
git fetch origin "claude/fix/<fix-sprint-id>-<SESSION_ID>"
git reset --hard "origin/claude/fix/<fix-sprint-id>-<SESSION_ID>"
```

The `agent-os/scheduled/state/*.json` updates were pushed to `claude/scheduled-state` (Step 7d / Step 8), not to this feature branch, so resetting to the feature branch is the right target — those state files exist on the state branch, not here.

### If no fix sprint was executed (Step 8 exit paths: `no-pending`, `already-fixed`, `codebase-broken`, `spec-unavailable`, `build-failed`, `test-failed`)

The only local modifications are the state files, and they were pushed to `claude/scheduled-state` in Step 8. Discard the local copies:

```bash
git checkout -- agent-os/scheduled/state/
```

### Verify

```bash
git status --short
```

Expected: empty output (or only telemetry files the canonical Stop hook already exempts — `agent-os/observations/current-session.jsonl`, `observations/index.md`, `observations/archive/*.jsonl`, `.graph-modified-files`).

**Done.** Stop here.

## Error handling

- Step 0.5 build fails on `origin/main` → `"status": "codebase-broken"`, push state to `claude/scheduled-state` with tsc failure summary, stop immediately — humans must triage. **No fix attempts in Step 0.5.**
- Step 5 full build fails after 3 attempts → `"status": "build-failed"`, push state to `claude/scheduled-state`, sprint stays in queue for human intervention
- Step 6 targeted tests fail after 3 attempts → `"status": "test-failed"`, push state to `claude/scheduled-state`, sprint stays in queue for human intervention
- Spec unavailable (no embedded findings and no local spec) → `"status": "spec-unavailable"`, push state to `claude/scheduled-state`, stop
- MCP push fails → write state locally with `"status": "error"`, do not retry. **Do not run Step 9** — the local working tree is the last copy of the work.
