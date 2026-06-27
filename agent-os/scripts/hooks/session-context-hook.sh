#!/bin/bash
# agent-os/scripts/hooks/session-context-hook.sh
# SessionStart hook — injects recent observations and compact state into new sessions.
# Also handles post-compaction context restoration.
#
# Inspired by PAI's PostCompact relay + claude-mem's progressive disclosure.
# Sprint 38.5.0 — Phase 2: Automatic Observations / Phase 4: Context Preservation
#
# Exit codes: 0 always (never block session)

set -uo pipefail

# ── Paths ──
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
OBS_FILE="$REPO_ROOT/agent-os/observations/current-session.jsonl"
SHARED_SUMMARY="$REPO_ROOT/agent-os/shared-memory/summary.md"

SESSION_ID="${CLAUDE_SESSION_ID:-${PPID:-$$}}"
COMPACT_STATE_FILE="/tmp/agent-os-compact-state-${SESSION_ID}.json"

OUTPUT=""

# ── Check for post-compaction state restoration ──
# Look for any compact state file (wildcard for session IDs)
COMPACT_FILE=""
for f in /tmp/agent-os-compact-state-*.json; do
  if [ -f "$f" ]; then
    COMPACT_FILE="$f"
    break
  fi
done

if [ -n "$COMPACT_FILE" ] && [ -f "$COMPACT_FILE" ]; then
  COMPACT_STATE=$(cat "$COMPACT_FILE" 2>/dev/null || true)
  if [ -n "$COMPACT_STATE" ]; then
    OUTPUT="## Context Restored (post-compaction)
${COMPACT_STATE}

Resume from where you left off. Do NOT re-read files you already processed.
---
"
    # Clean up compact state file after injection
    rm -f "$COMPACT_FILE" 2>/dev/null || true
  fi
fi

# ── Inject mandatory governance docs (RULES.md summary + ETHICS.md core) ──
# These are injected directly so the agent cannot skip reading them.
RULES_FILE="$REPO_ROOT/agent-os/RULES.md"
ETHICS_FILE="$REPO_ROOT/agent-os/ETHICS.md"

if [ -f "$RULES_FILE" ]; then
  # Extract the Non-Negotiable Rules section (the actual rules table, ~80 lines)
  RULES_CONTENT=$(sed -n '/^## Non-Negotiable Rules/,/^## [^N]/p' "$RULES_FILE" | head -120 || true)
  if [ -n "$RULES_CONTENT" ]; then
    OUTPUT="${OUTPUT}## RULES.md — Non-Negotiable Rules (auto-injected at session start)
${RULES_CONTENT}
"
  fi
fi

if [ -f "$ETHICS_FILE" ]; then
  # Extract the core commitment section (~30 lines)
  ETHICS_CONTENT=$(sed -n '/^## The Commitment/,/^## [^T]/p' "$ETHICS_FILE" | head -40 || true)
  if [ -n "$ETHICS_CONTENT" ]; then
    OUTPUT="${OUTPUT}## ETHICS.md — Core Commitment (auto-injected at session start)
${ETHICS_CONTENT}
"
  fi
fi

# ── Inject the AAAK memory index (Sprint 46.6.0 — Loading Layer L1) ──
# Inject the first 50 lines of INDEX.aaak (~400 tokens / 1.5 KB) so agents
# can locate the right memory file from a topic name without reading the
# full corpus. Full INDEX is at agent-os/memories/INDEX.aaak — open by
# anchor (L2) for any specific entry.
INDEX_FILE="$REPO_ROOT/agent-os/memories/INDEX.aaak"
if [ -f "$INDEX_FILE" ]; then
  INDEX_PREVIEW=$(head -50 "$INDEX_FILE" 2>/dev/null || true)
  if [ -n "$INDEX_PREVIEW" ]; then
    OUTPUT="${OUTPUT}## INDEX.aaak — Memory pointer index (auto-injected, head-50 preview)
> Format: \`topic|→file#anchor\`. Full index: \`agent-os/memories/INDEX.aaak\` (~360 entries).
> Read this first when you need a memory file. Do NOT scan the memory corpus directly.
\`\`\`
${INDEX_PREVIEW}
\`\`\`
"
  fi
fi

# ── Inject the last 3 per-agent lessons (Sprint 46.6.2 — L1 essential story) ──
# Each entry is the lesson title + first line. Helps agents notice what was
# learned recently across the system without opening the full corpus.
LESSONS_DIR="$REPO_ROOT/agent-os/sub-agents"
LESSON_PREVIEW=""
if [ -d "$LESSONS_DIR" ]; then
  # Find the 3 most-recently-modified lesson files across all agents.
  recent_lessons=$(find "$LESSONS_DIR" -path '*/lessons/*.md' -type f 2>/dev/null \
    | xargs -I{} stat -c '%Y {}' {} 2>/dev/null \
    | sort -rn | head -3 | awk '{print $2}')
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    [ ! -f "$f" ] && continue
    rel=${f#"$REPO_ROOT/"}
    title=$(grep -m1 '^# ' "$f" 2>/dev/null | sed 's/^# //')
    first_line=$(grep -m1 -E '^[A-Za-z0-9]' "$f" 2>/dev/null | head -1)
    [ -z "$title" ] && title="(untitled)"
    LESSON_PREVIEW="${LESSON_PREVIEW}- ${rel} — ${title}
"
  done <<< "$recent_lessons"

  if [ -n "$LESSON_PREVIEW" ]; then
    OUTPUT="${OUTPUT}## Recent agent lessons (auto-injected, top 3 by mtime)
${LESSON_PREVIEW}"
  fi
fi

# Mark session docs as injected (other hooks can check this file)
SESSION_FLAG_DIR="/tmp/agent-os-session-flags"
mkdir -p "$SESSION_FLAG_DIR" 2>/dev/null || true
echo "$(date -Iseconds)" > "$SESSION_FLAG_DIR/docs-injected" 2>/dev/null || true

# ── Inject recent observations as timeline ──
if [ -f "$OBS_FILE" ]; then
  OBS_COUNT=$(wc -l < "$OBS_FILE" 2>/dev/null || echo "0")

  if [ "$OBS_COUNT" -gt 0 ] 2>/dev/null; then
    # Get last 15 observations, format as compact timeline
    TIMELINE=$(tail -15 "$OBS_FILE" 2>/dev/null | while IFS= read -r line; do
      TS=$(echo "$line" | grep -oP '"timestamp"\s*:\s*"([^"]*)"' | sed 's/.*"\([^"]*\)"$/\1/' | sed 's/T/ /;s/Z//' || true)
      TYPE=$(echo "$line" | grep -oP '"type"\s*:\s*"([^"]*)"' | sed 's/.*"\([^"]*\)"$/\1/' || true)
      TITLE=$(echo "$line" | grep -oP '"title"\s*:\s*"([^"]*)"' | sed 's/.*"\([^"]*\)"$/\1/' || true)

      if [ -n "$TYPE" ] && [ -n "$TITLE" ]; then
        # Compact format: time [type] title
        TIME_SHORT=$(echo "$TS" | grep -oP '\d{2}:\d{2}' | head -1 || echo "??:??")
        echo "  ${TIME_SHORT} [${TYPE}] ${TITLE}"
      fi
    done)

    if [ -n "$TIMELINE" ]; then
      OUTPUT="${OUTPUT}## Recent Activity (last ${OBS_COUNT} observations, showing latest 15)
${TIMELINE}
"
    fi
  fi
fi

# ── Inject shared memory summary if exists ──
if [ -f "$SHARED_SUMMARY" ] && [ -s "$SHARED_SUMMARY" ]; then
  SUMMARY_SIZE=$(wc -c < "$SHARED_SUMMARY" 2>/dev/null || echo "0")
  if [ "$SUMMARY_SIZE" -gt 50 ] 2>/dev/null; then
    # Only include if there's meaningful content (not just the header)
    SUMMARY_CONTENT=$(head -30 "$SHARED_SUMMARY" 2>/dev/null || true)
    OUTPUT="${OUTPUT}
## Team Memory
${SUMMARY_CONTENT}
"
  fi
fi

# ── Output to stdout (Claude Code injects as context) ──
if [ -n "$OUTPUT" ]; then
  cat <<CONTEXT
<agent-os-session-context>
${OUTPUT}
</agent-os-session-context>
CONTEXT
fi

exit 0
