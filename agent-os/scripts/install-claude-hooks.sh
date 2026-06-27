#!/bin/bash
#
# agent-os/scripts/install-claude-hooks.sh
#
# Idempotent installer that wires the developer's ~/.claude/ to the
# canonical repo-versioned Agent OS hook scripts. Run once per dev
# machine after cloning the repo:
#
#   bash agent-os/scripts/install-claude-hooks.sh
#
# What it does:
#   1. Creates ~/.claude/ if missing.
#   2. Backs up any existing ~/.claude/stop-hook-git-check.sh to
#      ~/.claude/backups/stop-hook-git-check.sh.<timestamp> so nothing
#      is lost.
#   3. Writes ~/.claude/stop-hook-git-check.sh as a thin stub that
#      finds the nearest git repo root and execs the canonical
#      repo-versioned script at agent-os/scripts/stop-hook-git-check.sh.
#      If the current working directory is NOT inside a git repo, the
#      stub exits 0 (no-op), so the hook stays silent for non-repo work.
#   4. Ensures ~/.claude/settings.json has a Stop hook pointing at
#      ~/.claude/stop-hook-git-check.sh. If the file exists, it's
#      patched non-destructively using jq. If it doesn't, a minimal
#      file is created.
#
# Safe to re-run. Emits clear "OK / SKIP / UPDATED" lines so you can
# see what changed.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CANONICAL_HOOK="$REPO_ROOT/agent-os/scripts/stop-hook-git-check.sh"

if [ ! -x "$CANONICAL_HOOK" ]; then
  echo "ERROR: canonical hook not found or not executable at $CANONICAL_HOOK" >&2
  exit 1
fi

CLAUDE_DIR="$HOME/.claude"
HOOK_STUB="$CLAUDE_DIR/stop-hook-git-check.sh"
SETTINGS_FILE="$CLAUDE_DIR/settings.json"
BACKUP_DIR="$CLAUDE_DIR/backups"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

# 1. Ensure ~/.claude/ exists.
mkdir -p "$CLAUDE_DIR" "$BACKUP_DIR"

# 2. Backup any existing stub.
if [ -e "$HOOK_STUB" ] && ! grep -q "AGENT_OS_STUB_VERSION" "$HOOK_STUB" 2>/dev/null; then
  cp "$HOOK_STUB" "$BACKUP_DIR/stop-hook-git-check.sh.$TIMESTAMP"
  echo "BACKED UP existing $HOOK_STUB -> $BACKUP_DIR/stop-hook-git-check.sh.$TIMESTAMP"
fi

# 3. Write the stub. It walks up from $PWD to find a repo, then exec
#    the canonical script from that repo. Non-repo sessions are no-ops.
cat > "$HOOK_STUB" <<'STUB'
#!/bin/bash
# AGENT_OS_STUB_VERSION=1
# Installed by agent-os/scripts/install-claude-hooks.sh — do not edit by hand.
# Updates are tracked in the repo; re-run the installer to pick them up.

# Find the nearest git repo root starting from $PWD.
repo_root="$(git -C "${PWD:-.}" rev-parse --show-toplevel 2>/dev/null || true)"

if [ -z "$repo_root" ]; then
  # Not in a git repo — nothing to nag about.
  exit 0
fi

canonical="$repo_root/agent-os/scripts/stop-hook-git-check.sh"
if [ -x "$canonical" ]; then
  exec "$canonical"
fi

# Repo doesn't ship the Agent OS canonical hook — stay silent rather
# than fall back to a legacy blocker that doesn't know about telemetry
# exemptions. (Legacy repos can ship their own ~/.claude script.)
exit 0
STUB
chmod +x "$HOOK_STUB"
echo "OK wrote $HOOK_STUB (stub -> $CANONICAL_HOOK)"

# 4. Ensure ~/.claude/settings.json wires the Stop hook.
if [ ! -f "$SETTINGS_FILE" ]; then
  cat > "$SETTINGS_FILE" <<'SETTINGS'
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "~/.claude/stop-hook-git-check.sh" }
        ]
      }
    ]
  }
}
SETTINGS
  echo "OK created $SETTINGS_FILE with Stop hook wiring"
else
  # Non-destructive patch via jq (only if jq is available).
  if command -v jq >/dev/null 2>&1; then
    tmp="$(mktemp)"
    jq '
      .hooks //= {} |
      .hooks.Stop //= [] |
      if (.hooks.Stop | any(.hooks // [] | any(.command == "~/.claude/stop-hook-git-check.sh"))) then
        .
      else
        .hooks.Stop += [ { "matcher": "", "hooks": [ { "type": "command", "command": "~/.claude/stop-hook-git-check.sh" } ] } ]
      end
    ' "$SETTINGS_FILE" > "$tmp" && mv "$tmp" "$SETTINGS_FILE"
    echo "OK patched $SETTINGS_FILE Stop hook wiring (idempotent)"
  else
    echo "WARN jq not found; cannot patch $SETTINGS_FILE. Add this Stop hook manually:"
    echo '  "Stop": [{"matcher": "", "hooks": [{"type": "command", "command": "~/.claude/stop-hook-git-check.sh"}]}]'
  fi
fi

echo ""
echo "Done. The Claude Code Stop hook will now run:"
echo "  $HOOK_STUB"
echo "which execs the canonical repo-versioned hook at:"
echo "  $CANONICAL_HOOK"
echo ""
echo "Telemetry files (agent-os/observations/*.jsonl, .graph-modified-files)"
echo "will no longer trigger false 'uncommitted changes' nags between tool calls."
