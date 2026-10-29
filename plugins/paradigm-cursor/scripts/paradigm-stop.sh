#!/bin/sh
# Paradigm Cursor Stop Hook (v2)
# Validates paradigm compliance before allowing the agent to finish.
# Installed by: paradigm hooks install --cursor
#
# Hook type: stop
# Exit 0 = allow, Exit 2 = block with message
#
# Checks 1–13 are defined in paradigm-common.sh (shared with Claude Code hook).

# Read JSON from stdin (hook input)
INPUT=$(cat)

# Extract workspace root from Cursor's input (try jq first, fallback to grep)
# loop_count: how many times this stop hook already continued the conversation.
if command -v jq >/dev/null 2>&1; then
  CWD=$(echo "$INPUT" | jq -r '.workspace_roots[0] // empty' 2>/dev/null)
  LOOP_COUNT=$(echo "$INPUT" | jq -r '.loop_count // empty' 2>/dev/null)
else
  CWD=$(echo "$INPUT" | grep -o '"workspace_roots"[[:space:]]*:[[:space:]]*\["[^"]*"' | head -1 | sed 's/.*\["//' | sed 's/"$//')
  LOOP_COUNT=$(echo "$INPUT" | grep -o '"loop_count"[[:space:]]*:[[:space:]]*[0-9][0-9]*' | head -1 | sed 's/.*:[[:space:]]*//')
fi
case "$LOOP_COUNT" in ''|*[!0-9]*) LOOP_COUNT="" ;; esac

if [ -z "$CWD" ]; then
  CWD="$(pwd)"
fi

# Not a paradigm project — pass
if [ ! -d "$CWD/.paradigm" ]; then
  exit 0
fi

cd "$CWD" || exit 0

# --- Loop guard: prevent infinite retry loops ---
# Cursor's stop hook with loop_limit fires repeatedly. RETRY_COUNT is the
# number of blocks already in this loop: Cursor's loop_count when the input
# carries it, else the file counter. Capped at 3; an unchanged violation set
# after a retry ends the loop sooner (see the verdict below).
LOOP_GUARD_FILE=".paradigm/.stop-hook-active"
STOP_FP_FILE=".paradigm/.stop-block-fingerprint"
if [ -n "$LOOP_COUNT" ]; then
  RETRY_COUNT=$LOOP_COUNT
elif [ -f "$LOOP_GUARD_FILE" ]; then
  RETRY_COUNT=$(cat "$LOOP_GUARD_FILE" 2>/dev/null | tr -cd '0-9')
  RETRY_COUNT=${RETRY_COUNT:-0}
else
  RETRY_COUNT=0
fi
if [ "$RETRY_COUNT" -ge 3 ]; then
  # Max retries reached — allow session to end to avoid infinite loop
  echo "[paradigm] Stop hook: max retries (3) reached. Allowing session to end." >&2
  rm -f "$LOOP_GUARD_FILE"
  rm -f ".paradigm/.pending-review"
  rm -f ".paradigm/.habits-blocking"
  exit 0
fi
if [ -z "$LOOP_COUNT" ]; then
  echo "$((RETRY_COUNT + 1))" > "$LOOP_GUARD_FILE"
fi

# Get modified files (uncommitted changes)
MODIFIED=$(git diff --name-only HEAD 2>/dev/null)
if [ -z "$MODIFIED" ]; then
  # Clean up session markers on pass (no modifications)
  rm -f ".paradigm/.pending-review"
  rm -f ".paradigm/.session-started"
  rm -f "$STOP_FP_FILE"
  exit 0
fi

# Source shared compliance checks
SCRIPT_DIR=$(dirname "$0")
. "$SCRIPT_DIR/paradigm-common.sh"

# --- Report auto-fixes if any ---
if [ "$AUTO_FIX_COUNT" -gt 0 ]; then
  echo "" >&2
  echo "[paradigm] Auto-fixed $AUTO_FIX_COUNT issue(s):" >&2
  echo "$AUTO_FIXED" >&2
fi

# --- Final verdict ---
if [ "$VIOLATION_COUNT" -gt 0 ]; then
  # Fingerprint rule (same as the Claude Code hook): on a retry, an unchanged
  # violation set means the fix attempt changed nothing — end the loop, log
  # stop-block-unresolved, keep the marker; the next turn blocks again.
  STOP_FP=$(_pm_violation_fp)
  PREV_FP=""
  [ -f "$STOP_FP_FILE" ] && PREV_FP=$(sed -n 1p "$STOP_FP_FILE" 2>/dev/null)
  if [ "$RETRY_COUNT" -gt 0 ] && [ "$STOP_FP" = "$PREV_FP" ]; then
    echo "" >&2
    echo "Paradigm: unresolved after a fix attempt — ending the turn; these will block again next turn ($VIOLATION_COUNT violation(s)):" >&2
    echo "$VIOLATIONS" >&2
    _pm_record_unresolved "$STOP_FP" "$RETRY_COUNT"
    rm -f "$LOOP_GUARD_FILE"
    exit 0
  fi
  printf '%s\n%s\n' "$STOP_FP" "$((RETRY_COUNT + 1))" > "$STOP_FP_FILE" 2>/dev/null

  echo "" >&2
  echo "Paradigm compliance check failed ($VIOLATION_COUNT violation(s)):" >&2
  echo "$VIOLATIONS" >&2
  if [ -n "$ADVISORY" ]; then
    echo "" >&2
    echo "Advisory:" >&2
    echo "$ADVISORY" >&2
  fi
  echo "" >&2
  echo "Run these MCP tools to fix:" >&2
  echo "  1. paradigm_purpose (op: add_component) — register new code units" >&2
  echo "  2. paradigm_purpose (op: add_aspect) — register cross-cutting concerns (with anchors)" >&2
  echo "  3. paradigm_purpose (op: portal_add_route) — register new endpoints with gates" >&2
  echo "  4. paradigm_reindex — rebuild indexes after updates" >&2
  echo "  5. paradigm_lore (op: record) — record session lore entry" >&2
  echo "  6. paradigm_habits (op: check) — evaluate habit compliance" >&2
  echo "" >&2
  echo "Tip: Set PARADIGM_AUTO_FIX=1 to auto-fix trivial violations (missing .purpose stubs, missing lore)." >&2
  echo "Help: See .paradigm/docs/troubleshooting.md for step-by-step resolution guides." >&2

  # Output followup_message JSON to stdout for Cursor's compliance loop.
  # Cursor auto-submits this as the next user message, creating a retry loop.
  # Escape violations for JSON embedding (newlines → \n, quotes → \", backslash → \\)
  ESCAPED_VIOLATIONS=$(printf '%s' "$VIOLATIONS" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | sed ':a;N;$!ba;s/\n/\\n/g')
  printf '{"followup_message":"Paradigm compliance check found %d violation(s). Fix these:\\n%s\\nThen try finishing again."}\n' "$VIOLATION_COUNT" "$ESCAPED_VIOLATIONS"

  exit 2
fi

# Print advisory even on pass (informational)
if [ -n "$ADVISORY" ]; then
  echo "" >&2
  echo "[paradigm] Advisory:" >&2
  echo "$ADVISORY" >&2
fi

# Auto-demote graduated habits with 3+ failures
if [ -d ".paradigm/.graduation-failures" ]; then
  for fail_file in .paradigm/.graduation-failures/*; do
    [ -f "$fail_file" ] || continue
    habit_id=$(basename "$fail_file")
    fail_count=$(wc -l < "$fail_file" | tr -d ' ')
    if [ "$fail_count" -ge 3 ]; then
      if command -v paradigm >/dev/null 2>&1; then
        paradigm graduate demote "$habit_id" --cooldown 14 2>/dev/null || true
      fi
      rm -f "$fail_file"
      echo "[paradigm] Auto-demoted '$habit_id' after $fail_count failures." >&2
    fi
  done
fi

# Clean up session markers and loop guard on pass
rm -f ".paradigm/.pending-review"
rm -f ".paradigm/.habits-blocking"
rm -f ".paradigm/.stop-hook-active"
rm -f ".paradigm/.session-started"
rm -f ".paradigm/.purpose-paths"
rm -f "$STOP_FP_FILE"
# NOTE: .orchestrated / .solo-declared / .team-prompted / .team-reminded /
# .team-bypass-recorded are deliberately NOT cleared here — stop fires per turn; they expire by age
# instead (PARADIGM_GATE_TTL_HOURS, default 4h).

exit 0
