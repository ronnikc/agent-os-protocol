# Schedule B — PR Quality Review

> **Type:** Scheduled task (daily at 04:10 local time, 10 minutes after graph update)
> **Duration:** ~15-40 minutes depending on PR volume (capped by `max_prs_per_run`)

## HARD RULES (read first)

1. **NEVER run `git push`** — it will 403. The proxy is read-only.
2. **NEVER run `gh`** — it is not installed.
3. **NEVER run `git commit`** — there is nothing to commit locally.
4. **ALL remote writes use `agent-os/scripts/mcp-push.sh` and `agent-os/scripts/mcp-create-pr.sh`** — never call MCP tools directly for writes.
5. **ALL PR discovery / read calls use `agent-os/scripts/mcp-call.sh`** — NOT `mcp__github__list_pull_requests` as a tool-namespace call. The Claude Code scheduled session environment does NOT register `mcp__github__*` tools in the tool namespace (proven failure mode 2026-04-04 through 2026-04-10), but the underlying MCP GitHub server IS reachable through the proxy tunnel — `mcp-call.sh` calls it directly the same way `mcp-push.sh` does.
6. **NEVER try to sync local branch with remote after MCP push** — local and remote diverge, that's fine.
7. **NEVER create a fix sprint PR if there are no high/medium findings.**
8. **NEVER force-push or amend commits.**
9. **State files go to `claude/scheduled-state`, artifacts go to feature branches** — `pending-fix-sprints.json` and `last-review.json` MUST be pushed to `claude/scheduled-state` so Task C (in a separate session) can read them. Never push state to main (branch protection blocks it).
10. **Honor `max_prs_per_run` from `config.json`** — newest-first within the lookback window, skip already-reviewed PRs (tracked in `last-review.json → reviewed_prs`), leave the rest for the next run. This gives the pipeline a catch-up lane without overwhelming any single session.
11. **NEVER push fix-sprint specs to the session's own sandbox branch.** The Claude Scheduled Cloud harness assigns each run a whimsical branch name (e.g. `claude/determined-ptolemy-<ID>`). That is a local sandbox — it must stay empty on the remote. All fix-sprint artefacts go to `claude/fix-sprint-YYYYMMDD-HHMM-<RUN_ID>` where `RUN_ID` is derived deterministically in Step 6 (see below). No-op runs (all-clear, no-prs) must leave zero remote artefacts beyond the state file push. Failing to honour this leaks orphan branches (observed 2026-04-17).

## Dependency chain

**Upstream:** Task A (graph update) may have created a PR that is not yet merged. This does NOT block Task B — Task B reviews already-merged PRs, not pending ones.

**Downstream:** Task C (fix sprint executor) depends on `pending-fix-sprints.json` being on `claude/scheduled-state`. The queue entries MUST include **embedded findings** so Task C can work without fetching from unmerged branches.

## Prerequisites

Read these files before starting:
- `agent-os/scheduled/config.json` — agent routing rules and settings
- `agent-os/SUB-AGENTS.md` — sub-agent system, mandatory prompt template, verification rules

## Step 0 — Install dependencies and fetch shared state

```bash
npm install --silent 2>&1 | tail -3
```

Fetch the shared state branch (may not exist yet):

```bash
git fetch origin claude/scheduled-state 2>/dev/null || echo "State branch does not exist yet — will be created on first push"
```

If it exists, restore state files locally so we can read/update them:

```bash
if git rev-parse origin/claude/scheduled-state >/dev/null 2>&1; then
  git show origin/claude/scheduled-state:agent-os/scheduled/state/last-review.json > agent-os/scheduled/state/last-review.json 2>/dev/null || true
  git show origin/claude/scheduled-state:agent-os/scheduled/state/pending-fix-sprints.json > agent-os/scheduled/state/pending-fix-sprints.json 2>/dev/null || true
fi
```

## Step 1 — Discover recent merged PRs

Read `lookback_hours` and `max_prs_per_run` from `config.json → schedules.pr-quality-review.settings`. Defaults: `lookback_hours: 504` (21 days) and `max_prs_per_run: 20`.

```bash
LOOKBACK_HOURS=$(jq -r '.schedules."pr-quality-review".settings.lookback_hours // 504' agent-os/scheduled/config.json)
MAX_PRS_PER_RUN=$(jq -r '.schedules."pr-quality-review".settings.max_prs_per_run // 5' agent-os/scheduled/config.json)
```

**Discovery path (via `mcp-call.sh`, NOT via `mcp__github__*` tool-namespace calls):**

```bash
# Discover merged PRs via mcp-call.sh. Output is raw JSON (array) — pipe to jq.
bash agent-os/scripts/mcp-call.sh list_pull_requests \
  '{"owner":"ronnikc","repo":"agent-os-protocol","state":"closed","sort":"updated","direction":"desc","perPage":100}' \
  > /tmp/prs-page-1.json
```

For pagination (when the window is very wide and the first page doesn't cover everything), pass `"page": 2`, `"page": 3`, etc., until the oldest PR in the page is older than `now - lookback_hours`.

Parse each page with jq to filter to PRs merged within the lookback window AND not already reviewed:

```bash
# Extract candidate PR numbers (newest first, merged within lookback, not already reviewed)
CUTOFF=$(date -u -d "${LOOKBACK_HOURS} hours ago" +%s)
REVIEWED_IDS=$(jq -r '.reviewed_prs[]? // empty' agent-os/scheduled/state/last-review.json 2>/dev/null | sort -u)
# Also skip PRs that already appear as source_prs in the fix sprint queue (any status)
QUEUE_SOURCE_IDS=$(jq -r '.pending[].source_prs[]? // empty' agent-os/scheduled/state/pending-fix-sprints.json 2>/dev/null | sort -u)
SKIP_IDS=$(printf '%s\n%s\n' "$REVIEWED_IDS" "$QUEUE_SOURCE_IDS" | sort -u)

jq -r --argjson cutoff "$CUTOFF" \
  '.[] | select(.merged_at != null)
       | select((.merged_at | fromdateiso8601) >= $cutoff)
       | .number' \
  /tmp/prs-page-*.json \
  | { [ -n "$SKIP_IDS" ] && grep -vxFf <(printf '%s\n' "$SKIP_IDS") || cat; } \
  | head -n "$MAX_PRS_PER_RUN" \
  > /tmp/prs-to-review.txt
```

For each selected PR number, get its changed files via `pull_request_read` with `method: "get_files"` (the newer MCP tool API — `get_pull_request_files` no longer exists):

```bash
while read -r prnum; do
  ARGS=$(jq -n --argjson n "$prnum" \
    '{"owner":"ronnikc","repo":"agent-os-protocol","pullNumber":$n,"method":"get_files"}')
  bash agent-os/scripts/mcp-call.sh pull_request_read "$ARGS" \
    > "/tmp/pr-${prnum}-files.json"
done < /tmp/prs-to-review.txt
```

### Catch-up mode (2026-04-11 onward)

Task B was down 2026-04-04 through 2026-04-10. When it recovered, a ~3-week backlog of merged PRs existed. The `lookback_hours: 504` + `max_prs_per_run: 20` combination gives Task B a bounded per-run workload while still clearing the backlog over 10-14 days:

- Each run reviews up to 20 NEWEST unreviewed PRs within the 21-day window
- After each run, `last-review.json → reviewed_prs` is appended (cap at last 500 entries to bound file size)
- The next run picks up from where the previous left off
- Once the backlog clears, daily volume is low and each run processes a handful of PRs in minutes

### Decision after Step 1

| Result | Action |
|---|---|
| No unreviewed PRs in lookback window | Go to Step 7 with `"status": "no-prs"`. **Stop.** |
| Unreviewed PRs found | Continue to Step 2 with the top `max_prs_per_run` (newest first). |

## Step 2 — Classify changes and route to specialist agents

Use the agent routing table from `config.json`:

| File pattern | Lead Agent | Supporting Agents |
|---|---|---|
| `src/backend/**` | Backend Specialist | Security, Code Review |
| `src/frontend/**` | Frontend Specialist | Accessibility, Code Review, I18N |
| `src/shared/**` | Code Review Specialist | Backend, Frontend |
| `docs/**` | Documentation Specialist | Compliance |
| `agent-os/**` | Planning Specialist | Code Review |

If a PR touches multiple domains, invoke all relevant agents.

## Step 3 — Quality assessment per PR

Invoke each specialist agent using the **mandatory agent prompt template** from `SUB-AGENTS.md`. Each agent should:

1. Follow its **startup protocol** (read its owned docs, patterns, rules)
2. Review the changed files from the PR
3. Apply its specialized checks:

| Agent | Assessment Focus |
|---|---|
| **Code Review** | Pattern compliance (`engineering-code-patterns.md`), anti-patterns |
| **Backend** | Service patterns, route middleware, audit events, error handling |
| **Frontend** | Component patterns, hooks usage, state management |
| **Security** | RBAC middleware, injection vectors, auth patterns, secrets exposure |
| **Accessibility** | WCAG compliance, ARIA attributes, keyboard navigation |
| **I18N** | Missing translations, EN-copy violations, banned patterns, hardcoded strings |
| **Build Integrity** | TypeScript compilation, dependency resolution |
| **Compliance** | Audit trail completeness, data classification |

Each agent returns findings in this format:
```json
{
  "severity": "high|medium|low",
  "agent": "<agent-slug>",
  "file": "<file-path>",
  "line": "<line-number>",
  "rule": "<rule-id if applicable>",
  "description": "<what's wrong>",
  "suggested_fix": "<how to fix it>",
  "affected_tests": ["<test files that must be verified or updated when this finding is fixed>"],
  "test_command": "<specific vitest run command to verify the fix>"
}
```

**Test awareness is mandatory.** For each finding, agents MUST:
1. Identify test files in the same module that assert the current (broken) behavior
2. List them in `affected_tests` so the executor knows which tests need updating
3. Provide the `test_command` so the executor can verify each fix in isolation
4. **Verify claims against the actual codebase** — read the file to confirm the issue exists before reporting it. Do not report issues based on PR diffs alone if subsequent PRs may have fixed them.

## Step 4 — Decide: fix sprint or all-clear

Aggregate findings across all PRs reviewed.

| Result | Action |
|---|---|
| ANY `high` or `medium` findings | Continue to Step 5. |
| Only `low` findings | Go to Step 7 with `"status": "all-clear"`. Log findings in state. |
| No findings | Go to Step 7 with `"status": "all-clear"`. |

## Step 5 — Generate fix sprint spec

Use the template at `agent-os/scheduled/templates/fix-sprint-spec.md`.

**Naming:** `fix-sprint-YYYYMMDD-HHMM.md` (timestamp of this review run)

Write locally:
1. `docs/product/fix-sprints/fix-sprint-YYYYMMDD-HHMM.md` — the spec
2. `docs/product/fix-sprints/fix-sprint-YYYYMMDD-HHMM-workfile.md` — the workfile

**Grouping rules:**
- All findings from this review window → ONE fix sprint
- Order by severity (high first, then medium)
- Cap at 50 findings per sprint (from config `max_findings_per_sprint`). If findings exceed this cap, create additional fix sprints (e.g., `fix-sprint-YYYYMMDD-HHMM-2`)
- Reference originating PR numbers in each finding

## Step 6 — Push artifacts to branch + state to `claude/scheduled-state` (TWO separate pushes)

**6a. Derive a collision-free `RUN_ID` and push specs to a feature branch:**

```bash
# RUN_ID is a deterministic, unique-per-run identifier. Do NOT use the session's
# own sandbox branch name (HARD RULE #11). Pair it with the fix-sprint timestamp
# so the full branch is grep-friendly and cannot collide with any prior run.
RUN_ID=$(date -u +%Y%m%dT%H%M%SZ)
SPEC_BRANCH="claude/fix-sprint-YYYYMMDD-HHMM-${RUN_ID}"

bash agent-os/scripts/mcp-push.sh \
  --branch "$SPEC_BRANCH" \
  --message "docs(fix-sprint): quality review findings [YYYY-MM-DDTHH:MM]" \
  -- docs/product/fix-sprints/fix-sprint-YYYYMMDD-HHMM.md \
     docs/product/fix-sprints/fix-sprint-YYYYMMDD-HHMM-workfile.md
```

**6b. Create PR for human review:**

> **CRITICAL — PR body formatting.** Always write the PR body to a file and pass
> it via `--body-file`. Never pass a multi-line body via `--body "..."`: literal
> `\n` in a bash double-quoted string is NOT a newline, and GitHub will render
> the body with visible `\n` characters (see PRs #1513 and #1514, 2026-04-19,
> for the symptom). Heredocs with quoted delimiters (`<<'EOF'`) preserve real
> newlines and skip every class of shell-escaping bug.

```bash
cat > /tmp/fix-sprint-pr-body.md <<'EOF'
## Summary

Automated quality review of <N> merged PRs found **<FINDINGS_TOTAL> findings
(<HIGH> HIGH, <MEDIUM> MEDIUM)** across <MODULES_COUNT> modules.

### Key findings
- <finding 1>
- <finding 2>

### Source PRs reviewed
- #<pr-number> (<title>)

See fix-sprint spec for full details and implementation plan.
EOF

bash agent-os/scripts/mcp-create-pr.sh \
  --head "$SPEC_BRANCH" \
  --base main \
  --title "docs(fix-sprint): quality review findings [YYYYMMDD-HHMM]" \
  --body-file /tmp/fix-sprint-pr-body.md
```

Capture the PR URL from the output.

**6c. Push state files to `claude/scheduled-state` (critical for Task C):**

Update `agent-os/scheduled/state/pending-fix-sprints.json` — append to the `pending` array (do not overwrite existing entries). **Embed the full findings** so Task C can work without reading from the unmerged branch:

```json
{
  "id": "fix-sprint-YYYYMMDD-HHMM",
  "spec_path": "docs/product/fix-sprints/fix-sprint-YYYYMMDD-HHMM.md",
  "workfile_path": "docs/product/fix-sprints/fix-sprint-YYYYMMDD-HHMM-workfile.md",
  "spec_branch": "<SPEC_BRANCH from 6a>",
  "spec_pr_url": "<PR URL from 6b>",
  "created": "<ISO-8601>",
  "findings_count": 7,
  "high_count": 1,
  "medium_count": 4,
  "source_prs": [123, 124],
  "status": "pending",
  "findings": [
    {
      "severity": "high|medium",
      "agent": "<agent-slug>",
      "file": "<file-path>",
      "line": "<line-number>",
      "rule": "<rule-id>",
      "description": "<what's wrong>",
      "suggested_fix": "<how to fix it>"
    }
  ]
}
```

> **Why embed findings?** Task C runs in a separate session starting from `main`. The spec files are on an unmerged branch. By embedding findings in the queue entry (on `claude/scheduled-state`), Task C has everything it needs without fetching from feature branches.

```bash
bash agent-os/scripts/mcp-push.sh \
  --branch claude/scheduled-state \
  --message "chore(scheduled): update pending fix sprints queue" \
  -- agent-os/scheduled/state/pending-fix-sprints.json
```

## Step 7 — Write review state (always)

Set `last_run` to the REAL wall-clock time via `date -u -Iseconds`. Do not copy the schedule text from `config.json` — that produces fabricated timestamps like `2026-04-10T04:30:00Z` when the actual run happened at a completely different moment.

**Append reviewed PR numbers to `reviewed_prs`**, then cap at the last 500 entries to bound file size:

```bash
# Initialize defaults for variables that may not be set (e.g. no-prs / all-clear paths)
PRS_REVIEWED_COUNT=${PRS_REVIEWED_COUNT:-0}
FINDINGS_TOTAL=${FINDINGS_TOTAL:-0}
FINDINGS_HIGH=${FINDINGS_HIGH:-0}
FINDINGS_MEDIUM=${FINDINGS_MEDIUM:-0}
FINDINGS_LOW=${FINDINGS_LOW:-0}
FIX_SPRINT_ID=${FIX_SPRINT_ID:-""}
RUN_STATUS=${RUN_STATUS:-"unknown"}
PRS_DETAILS_JSON=${PRS_DETAILS_JSON:-"[]"}

# Build the new state file
NOW=$(date -u -Iseconds)
NEW_REVIEWED_JSON=$(cat /tmp/prs-to-review.txt | jq -R 'tonumber' | jq -s '.')
jq --arg now "$NOW" \
   --argjson new_reviewed "$NEW_REVIEWED_JSON" \
   --argjson prs_reviewed "$PRS_REVIEWED_COUNT" \
   --argjson prs_details "$PRS_DETAILS_JSON" \
   --argjson findings_total "$FINDINGS_TOTAL" \
   --argjson findings_high "$FINDINGS_HIGH" \
   --argjson findings_medium "$FINDINGS_MEDIUM" \
   --argjson findings_low "$FINDINGS_LOW" \
   --arg fix_sprint "$FIX_SPRINT_ID" \
   --arg status "$RUN_STATUS" \
   '{
     last_run: $now,
     prs_reviewed: $prs_reviewed,
     prs_details: $prs_details,
     findings_total: $findings_total,
     findings_high: $findings_high,
     findings_medium: $findings_medium,
     findings_low: $findings_low,
     fix_sprint_created: (if $fix_sprint == "" then null else $fix_sprint end),
     status: $status,
     reviewed_prs: ((.reviewed_prs // []) + $new_reviewed | unique_by(.) | sort | .[-500:])
   }' \
   agent-os/scheduled/state/last-review.json > /tmp/new-last-review.json
mv /tmp/new-last-review.json agent-os/scheduled/state/last-review.json
```

The `reviewed_prs` array is the **backlog tracker** — on the next Task B run, any PR whose number is in this array will be skipped in Step 1's filter. Combined with `max_prs_per_run`, this creates a natural catch-up lane that clears the ~260-PR backlog over ~13 days of normal runs without overwhelming any single session.

Push state to `claude/scheduled-state`:

```bash
bash agent-os/scripts/mcp-push.sh \
  --branch claude/scheduled-state \
  --message "chore(scheduled): update review state (reviewed $PRS_REVIEWED_COUNT PRs)" \
  -- agent-os/scheduled/state/last-review.json
```

**Done.** Stop here. If this run took the `no-prs` or `all-clear` path (no fix sprint created), do NOT push anything to the session's sandbox branch (HARD RULE #11) — no-op runs must leave zero remote artefacts beyond the state file above.

## Error handling

- `mcp-call.sh` fails → write state with `"status": "error"`, stop. Do NOT fall back to `mcp__github__*` tool-namespace calls (those are known-broken in the scheduled session environment).
- Agent fails during assessment → log the failure, continue with other agents
- MCP push fails → write state with `"status": "error"`, do not retry
