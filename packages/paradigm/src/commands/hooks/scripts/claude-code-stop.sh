#!/bin/sh
# Paradigm Claude Code Stop Hook (v2)
# Validates paradigm compliance before allowing the agent to finish.
# Installed by: paradigm hooks install --claude-code
#
# Hook type: Stop
# Exit 0 = allow, Exit 2 = block with message
#
# Checks 1–13 are defined in paradigm-common.sh (shared with Cursor hook).

# Read JSON from stdin (hook input)
# Hook self-monitoring (#hook-monitor, fail open): wall time + outcome -> .paradigm/events/hook-timings.jsonl
case "$0" in */*) _PM_DIR=${0%/*} ;; *) _PM_DIR=. ;; esac
[ -f "$_PM_DIR/paradigm-hook-monitor.sh" ] && . "$_PM_DIR/paradigm-hook-monitor.sh" && _pm_begin Stop 30000 10000
# Per-section timing -> .paradigm/events/stop-timing.jsonl (no-ops without the monitor)
command -v _pm_mark >/dev/null 2>&1 || _pm_mark() { :; }
command -v _pm_count >/dev/null 2>&1 || _pm_count() { :; }

_pm_mark read-input
INPUT=$(cat)

# Extract cwd from input (try jq first, fallback to grep)
if command -v jq >/dev/null 2>&1; then
  CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
else
  CWD=$(echo "$INPUT" | grep -o '"cwd"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*"cwd"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
fi

if [ -z "$CWD" ]; then
  CWD="$(pwd)"
fi

# Not a paradigm project — pass
if [ ! -d "$CWD/.paradigm" ]; then
  exit 0
fi

cd "$CWD" || exit 0

# Get modified files (uncommitted changes)
_pm_mark git-diff
MODIFIED=$(git diff --name-only HEAD 2>/dev/null)
if [ -z "$MODIFIED" ]; then
  # Clean up session markers on pass (no modifications)
  rm -f ".paradigm/.pending-review"
  rm -f ".paradigm/.session-started"
  exit 0
fi

# Source shared compliance checks
SCRIPT_DIR=$(dirname "$0")
. "$SCRIPT_DIR/paradigm-common.sh"

_pm_mark verdict
# --- Report auto-fixes if any ---
if [ "$AUTO_FIX_COUNT" -gt 0 ]; then
  echo "" >&2
  echo "[paradigm] Auto-fixed $AUTO_FIX_COUNT issue(s):" >&2
  echo "$AUTO_FIXED" >&2
fi

# --- Final verdict ---
if [ "$VIOLATION_COUNT" -gt 0 ]; then
  # Emit compliance-violation event (fire-and-forget, backgrounded)
  # NOTE: Could be absorbed into compliance-check command in a future iteration.
  # FULLY detached: a background child that inherits the hook's stdout/stderr
  # keeps Claude Code's pipe open, and Claude Code waits for EOF on that pipe —
  # not for this script's exit — until the hook timeout. Never background a
  # command in a hook without </dev/null >/dev/null 2>&1.
  if [ "$PARADIGM_AVAILABLE" = "true" ]; then
    $PARADIGM_BIN event emit --type compliance-violation --source stop-hook --severity error --context "Stop hook: $VIOLATION_COUNT violation(s)" </dev/null >/dev/null 2>&1 &
  fi
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
  exit 2
fi

# Print advisory even on pass (informational)
if [ -n "$ADVISORY" ]; then
  echo "" >&2
  echo "[paradigm] Advisory:" >&2
  echo "$ADVISORY" >&2
fi

# Auto-demote graduated habits with 3+ failures
# NOTE: Could be absorbed into compliance-check command in a future iteration.
if [ -d ".paradigm/.graduation-failures" ]; then
  for fail_file in .paradigm/.graduation-failures/*; do
    [ -f "$fail_file" ] || continue
    habit_id=$(basename "$fail_file")
    fail_count=$(wc -l < "$fail_file" | tr -d ' ')
    if [ "$fail_count" -ge 3 ]; then
      if [ "$PARADIGM_AVAILABLE" = "true" ]; then
        $PARADIGM_BIN graduate demote "$habit_id" --cooldown 14 2>/dev/null || true
      fi
      rm -f "$fail_file"
      echo "[paradigm] Auto-demoted '$habit_id' after $fail_count failures." >&2
    fi
  done
fi

# Clean up session markers on pass
rm -f ".paradigm/.pending-review"
rm -f ".paradigm/.habits-blocking"
rm -f ".paradigm/.session-started"
rm -f ".paradigm/.purpose-paths"
# NOTE: .orchestrated / .solo-declared / .team-prompted / .team-reminded /
# .team-bypass-recorded are deliberately NOT cleared here — Stop fires per assistant turn, and clearing
# would erase solo declarations mid-session and re-nag every turn. They expire
# by age instead (PARADIGM_GATE_TTL_HOURS, default 4h).

# Postflight learning already ran above: paradigm-common.sh calls
# `compliance-check --learn`, which runs the same runPostflightLearning pass in
# the foreground. The old second `ambient postflight &` here was a duplicate
# pass, and as a background child holding the hook's stdout open it made
# Claude Code wait for EOF until the hook timeout.

exit 0
