# Schedule A — Dependency Graph Update

> **Type:** Scheduled task (daily at 04:00 UTC)
> **Duration:** ~2-5 minutes

## HARD RULES (read first)

1. **NEVER run `git push`** — it will 403. The proxy is read-only.
2. **NEVER run `gh`** — it is not installed.
3. **NEVER run `git commit`** — there is nothing to commit locally.
4. **ALL remote writes use `agent-os/scripts/mcp-push.sh` and `agent-os/scripts/mcp-create-pr.sh`** — never call MCP tools directly, never use the Read tool to load graph.json into context.
5. **NEVER create a PR if graph content did not change** — check for `GRAPH_CHANGED:` marker.
6. **NEVER try to sync local branch with remote after push** — local and remote diverge, that's fine.
7. **ALWAYS push the state file to `claude/scheduled-state`** — this persistent branch is the shared state store for all scheduled tasks. Never push state to main (branch protection blocks it).
8. **NEVER push graph.json to the session's own sandbox branch.** The Claude Scheduled Cloud harness assigns each run a whimsical branch name (e.g. `claude/intelligent-tesla-<ID>`). That is a local sandbox — it must stay empty on the remote. All graph artefacts go to `claude/scheduled-graph-update-<RUN_ID>` (derived deterministically in Step 2, see below). Failing to honour this leaks orphan branches (observed 2026-04-17). This also means: do NOT `git commit` any file locally to "persist" it — the sandbox branch must stay empty on the remote regardless of whether a final MCP push was made.
9. **NEVER reformat `agent-os/graph.json`** — do not run `jq -c`, `jq .`, or any other transformation on it to work around push failures. The script emits a byte-exact artefact; push it as-is. Reformatting turns a real 6-line diff into a `-10,655 / +1` wall of noise (observed 2026-04-20 when a scheduled run compacted the file to shrink payload, then had to push twice to restore pretty-print). If `mcp-push.sh` fails repeatedly, go to **Error handling** — do NOT improvise a workaround.
10. **NEVER bypass `mcp-push.sh` / `mcp-create-pr.sh`** by writing ad-hoc Node/curl/MCP tool calls. If the script fails (proxy down, timeout, auth), that is a harness issue — write state with `"status": "error"` and stop. The scripts now auto-fall-back from proxy to direct HTTPS and honour `MCP_TIMEOUT_MS` (default 180s); if they still fail, bypassing them hides the bug from future runs.

## Dependency chain

This task has **no upstream dependencies**. It runs first in the daily cycle.

Downstream: Future Task A runs depend on the **state file being on `claude/scheduled-state`**.

## Step 0 — Install dependencies and fetch shared state

```bash
npm install --silent 2>&1 | tail -3
```

Fetch the shared state branch (may not exist on first run):

```bash
git fetch origin claude/scheduled-state 2>/dev/null || echo "State branch does not exist yet — will be created on first push"
```

If it exists, read the previous state:

```bash
if git rev-parse origin/claude/scheduled-state >/dev/null 2>&1; then
  git show origin/claude/scheduled-state:agent-os/scheduled/state/last-graph-update.json > agent-os/scheduled/state/last-graph-update.json 2>/dev/null || true
fi
```

## Step 1 — Run graph update

```bash
# Determine base ref from previous run's state file (falls back to HEAD~50)
BASE_REF="HEAD~50"
STATE_FILE="agent-os/scheduled/state/last-graph-update.json"
if [ -f "$STATE_FILE" ]; then
  SAVED=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('$STATE_FILE','utf8')).last_commit||'')}catch{console.log('')}")
  if [ -n "$SAVED" ] && git rev-parse --verify "$SAVED" >/dev/null 2>&1; then
    BASE_REF="$SAVED"
  fi
fi
echo "Using base ref: $BASE_REF"

set +e
bash agent-os/scripts/graph-update.sh --base "$BASE_REF" --output agent-os/graph.json
GRAPH_EXIT=$?
set -e
```

### Decision after Step 1

| Exit code | Script output contains | Action |
|---|---|---|
| 0 | `NO_CHANGES:` (or legacy `No TypeScript files changed`) | Go to Step 3 — **no PR**. |
| 0 | `GRAPH_CHANGED:` | Continue to Step 2. |
| 2 | `ERROR: base ref ... is not resolvable` | Go to **Error handling** — write state with `"status": "error"` and stop. **Do NOT fall through to Step 3** (that would overwrite `last_commit` with today's HEAD and bake the broken base into tomorrow's run). |
| any other non-zero | — | Go to **Error handling**. |

**If the output does NOT contain `GRAPH_CHANGED:`, skip Step 2 entirely.**

> **2026-04-20 note — why exit 2 exists.** For months Task A silently reported
> "no changes" when `base_ref` was missing from the ephemeral session clone
> (shallow-clone horizon, or a sandbox-branch hash that never reached
> `origin/main`). `graph-update.sh` previously had `2>/dev/null || true` on
> the diff and treated every failure mode as "no changes", then wrote today's
> HEAD as tomorrow's base — a self-perpetuating false negative. The script
> now validates `BASE`, attempts a targeted fetch, and exits 2 if still
> unresolvable. Task A must honour that exit code and leave state untouched
> except for the error marker.

## Step 2 — Push graph to branch + PR (only if GRAPH_CHANGED)

**2a. Derive a collision-free `RUN_ID` and push graph.json to a feature branch:**

```bash
SHORT_TS=$(date -u +%Y-%m-%dT%H:%M)
# RUN_ID is a deterministic, unique-per-run identifier. Do NOT use the session's
# own branch name (HARD RULE #8) — if the harness reuses a stable ID, pushing to
# `claude/scheduled-graph-update-<that-ID>` would collide with yesterday's merged
# PR branch and create no-op orphans.
RUN_ID=$(date -u +%Y%m%dT%H%M%SZ)
RUN_BRANCH="claude/scheduled-graph-update-${RUN_ID}"

bash agent-os/scripts/mcp-push.sh \
  --branch "$RUN_BRANCH" \
  --message "chore(graph): scheduled graph update [$SHORT_TS]" \
  -- agent-os/graph.json
```

This script handles files of any size — it reads them from disk directly, never loads them into the conversation context. **Do NOT attempt to read graph.json with the Read tool.**

**2b. Create a PR:**

```bash
bash agent-os/scripts/mcp-create-pr.sh \
  --head "$RUN_BRANCH" \
  --base main \
  --title "chore(graph): scheduled graph update [$SHORT_TS]" \
  --body "Automated dependency graph update from scheduled task."
```

The script outputs the PR URL. Capture it for the state file.

**2c. Push state file to `claude/scheduled-state`:**

```bash
CURRENT_COMMIT=$(git rev-parse HEAD)
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
```

Write to `agent-os/scheduled/state/last-graph-update.json`:

```json
{
  "last_run": "<TIMESTAMP>",
  "last_commit": "<CURRENT_COMMIT>",
  "status": "success",
  "base_ref": "<BASE_REF used>",
  "pr_url": "<PR URL from 2b>",
  "message": "<script output summary>"
}
```

```bash
bash agent-os/scripts/mcp-push.sh \
  --branch claude/scheduled-state \
  --message "chore(graph): update graph state [success]" \
  -- agent-os/scheduled/state/last-graph-update.json
```

**Done.** Stop here.

## Step 3 — No changes: push state file only (no PR)

Even when the graph didn't change, the state file must be updated so the next run has the correct `last_commit`.

```bash
CURRENT_COMMIT=$(git rev-parse HEAD)
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
```

Write to `agent-os/scheduled/state/last-graph-update.json`:

```json
{
  "last_run": "<TIMESTAMP>",
  "last_commit": "<CURRENT_COMMIT>",
  "status": "no_changes",
  "base_ref": "<BASE_REF used>",
  "pr_url": null,
  "message": "<script output summary>"
}
```

```bash
bash agent-os/scripts/mcp-push.sh \
  --branch claude/scheduled-state \
  --message "chore(graph): update graph state [no changes]" \
  -- agent-os/scheduled/state/last-graph-update.json
```

**Done.** Stop here. Do NOT create a PR. Do NOT push anything to the session's sandbox branch (HARD RULE #8) — no-op runs must leave zero remote artefacts beyond the state file above.

## Error handling

- `graph-update.sh` fails → write state with `"status": "error"`, push state to `claude/scheduled-state`, stop
- `mcp-push.sh` fails → write state locally with `"status": "error"`, do not retry
