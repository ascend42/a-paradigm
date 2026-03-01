#!/bin/sh
# Paradigm Cursor Stop Hook (v2)
# Validates paradigm compliance before allowing the agent to finish.
# Installed by: paradigm hooks install --cursor
#
# Hook type: stop
# Exit 0 = allow, Exit 2 = block with message
#
# Checks 1–11 are defined in paradigm-common.sh (shared with Claude Code hook).

# Read JSON from stdin (hook input)
INPUT=$(cat)

# Extract workspace root from Cursor's input (try jq first, fallback to grep)
if command -v jq >/dev/null 2>&1; then
  CWD=$(echo "$INPUT" | jq -r '.workspace_roots[0] // empty' 2>/dev/null)
else
  CWD=$(echo "$INPUT" | grep -o '"workspace_roots"[[:space:]]*:[[:space:]]*\["[^"]*"' | head -1 | sed 's/.*\["//' | sed 's/"$//')
fi

if [ -z "$CWD" ]; then
  CWD="$(pwd)"
fi

# Not a paradigm project — pass
if [ ! -d "$CWD/.paradigm" ]; then
  exit 0
fi

cd "$CWD" || exit 0

# --- Loop guard: prevent infinite retry loops ---
# Cursor's stop hook with loop_limit fires repeatedly. Cap retries at 3.
LOOP_GUARD_FILE=".paradigm/.stop-hook-active"
if [ -f "$LOOP_GUARD_FILE" ]; then
  RETRY_COUNT=$(cat "$LOOP_GUARD_FILE" 2>/dev/null | tr -d '[:space:]')
  RETRY_COUNT=${RETRY_COUNT:-0}
  if [ "$RETRY_COUNT" -ge 3 ]; then
    # Max retries reached — allow session to end to avoid infinite loop
    echo "[paradigm] Stop hook: max retries (3) reached. Allowing session to end." >&2
    rm -f "$LOOP_GUARD_FILE"
    rm -f ".paradigm/.pending-review"
    rm -f ".paradigm/.habits-blocking"
    exit 0
  fi
  RETRY_COUNT=$((RETRY_COUNT + 1))
  echo "$RETRY_COUNT" > "$LOOP_GUARD_FILE"
else
  echo "1" > "$LOOP_GUARD_FILE"
fi

# Get modified files (uncommitted changes)
MODIFIED=$(git diff --name-only HEAD 2>/dev/null)
if [ -z "$MODIFIED" ]; then
  # Clean up pending-review on pass
  rm -f ".paradigm/.pending-review"
  exit 0
fi

# Source shared compliance checks
SCRIPT_DIR=$(dirname "$0")
. "$SCRIPT_DIR/paradigm-common.sh"

# --- Final verdict ---
if [ "$VIOLATION_COUNT" -gt 0 ]; then
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
  echo "  1. paradigm_purpose_add_component — register new code units" >&2
  echo "  2. paradigm_purpose_add_aspect — register cross-cutting concerns (with anchors)" >&2
  echo "  3. paradigm_portal_add_route — register new endpoints with gates" >&2
  echo "  4. paradigm_reindex — rebuild indexes after updates" >&2
  echo "  5. paradigm_lore_record — record session lore entry" >&2
  echo "  6. paradigm_habits_check — evaluate habit compliance" >&2

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

# Clean up pending-review and loop guard on pass
rm -f ".paradigm/.pending-review"
rm -f ".paradigm/.habits-blocking"
rm -f ".paradigm/.stop-hook-active"

exit 0
