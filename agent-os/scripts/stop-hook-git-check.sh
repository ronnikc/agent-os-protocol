#!/bin/bash
#
# agent-os/scripts/stop-hook-git-check.sh
#
# Canonical Claude Code Stop hook — nags about uncommitted / unpushed
# changes so work never rots in the working tree. This is the repo-versioned
# canonical copy; each developer's ~/.claude/stop-hook-git-check.sh should
# either BE this file (symlink) or source it:
#
#   # ~/.claude/stop-hook-git-check.sh
#   #!/bin/bash
#   REPO_ROOT="$(git -C "$PWD" rev-parse --show-toplevel 2>/dev/null)"
#   if [ -x "$REPO_ROOT/agent-os/scripts/stop-hook-git-check.sh" ]; then
#     exec "$REPO_ROOT/agent-os/scripts/stop-hook-git-check.sh"
#   fi
#   exit 0
#
# ── Telemetry exemption ──────────────────────────────────────────
#
# The Agent OS Protocol runs PostToolUse hooks that append to tracked
# telemetry files after every tool call:
#
#   - agent-os/observations/current-session.jsonl  (observation-capture-hook.sh)
#   - agent-os/observations/index.md               (observation rollup)
#   - agent-os/.graph-modified-files               (graph-update-hook.sh)
#
# Keeping these tracked in git is intentional: it lets multiple developers
# and multiple machines see what each session touched. But nagging about
# them after every tool call produced an interrupt loop: tool call → hook
# dirties telemetry → stop hook nags → Claude restarts long draft from
# scratch. This hook EXEMPTS the telemetry files from the dirty-set check
# so they can be committed later (session end, scheduled task, or manual)
# without interrupting in-progress writes.
#
# Any OTHER dirty file is still flagged. The nag still fires on real code
# changes.
#
set -uo pipefail

# Read the JSON input from stdin
input=$(cat)

# Check if stop hook is already active (recursion prevention)
stop_hook_active=$(echo "$input" | jq -r '.stop_hook_active' 2>/dev/null)
if [[ "$stop_hook_active" = "true" ]]; then
  exit 0
fi

# Check if we're in a git repository - bail if not
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  exit 0
fi

# ── Telemetry paths that are allowed to be dirty ─────────────────
# Order matters: the -e arguments below are passed to `grep -vE` to
# strip these paths from the list of dirty files before deciding
# whether to nag.
TELEMETRY_PATHS=(
  '^agent-os/observations/current-session\.jsonl$'
  '^agent-os/observations/index\.md$'
  '^agent-os/observations/archive/.*\.jsonl$'
  '^agent-os/\.graph-modified-files$'
)

# Build one extended regex that matches any telemetry path.
telemetry_regex="$(IFS='|'; echo "${TELEMETRY_PATHS[*]}")"

# Collect tracked dirty files (both staged and unstaged), stripping
# telemetry exemptions.
dirty_tracked=$(git diff --name-only 2>/dev/null; git diff --cached --name-only 2>/dev/null)
dirty_tracked_filtered=$(echo "$dirty_tracked" | grep -v '^$' | grep -vE "$telemetry_regex" || true)

if [[ -n "$dirty_tracked_filtered" ]]; then
  first_few=$(echo "$dirty_tracked_filtered" | head -5 | sed 's/^/  /')
  extra_count=$(echo "$dirty_tracked_filtered" | wc -l | tr -d ' ')
  echo "There are uncommitted changes in the repository (${extra_count} file(s), excluding telemetry). Please commit and push these changes to the remote branch." >&2
  echo "$first_few" >&2
  exit 2
fi

# Check for untracked files that might be important (same exemption).
untracked_files=$(git ls-files --others --exclude-standard 2>/dev/null | grep -vE "$telemetry_regex" || true)
if [[ -n "$untracked_files" ]]; then
  first_few=$(echo "$untracked_files" | head -5 | sed 's/^/  /')
  extra_count=$(echo "$untracked_files" | wc -l | tr -d ' ')
  echo "There are ${extra_count} untracked file(s) in the repository. Please commit and push these changes to the remote branch." >&2
  echo "$first_few" >&2
  exit 2
fi

# Unpushed commit check (unchanged from original).
current_branch=$(git branch --show-current 2>/dev/null)
if [[ -n "$current_branch" ]]; then
  if git rev-parse "origin/$current_branch" >/dev/null 2>&1; then
    unpushed=$(git rev-list "origin/$current_branch..HEAD" --count 2>/dev/null) || unpushed=0
    if [[ "$unpushed" -gt 0 ]]; then
      echo "There are $unpushed unpushed commit(s) on branch '$current_branch'. Please push these changes to the remote repository." >&2
      exit 2
    fi
  else
    unpushed=$(git rev-list "origin/HEAD..HEAD" --count 2>/dev/null) || unpushed=0
    if [[ "$unpushed" -gt 0 ]]; then
      echo "Branch '$current_branch' has $unpushed unpushed commit(s) and no remote branch. Please push these changes to the remote repository." >&2
      exit 2
    fi
  fi
fi

exit 0
