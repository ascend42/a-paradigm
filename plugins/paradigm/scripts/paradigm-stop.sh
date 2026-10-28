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

# Extract cwd and stop_hook_active from input (try jq first, fallback to grep).
# stop_hook_active=true: this Stop follows a turn that a Stop-hook block
# continued (the agent already had one attempt at fixing the violations).
if command -v jq >/dev/null 2>&1; then
  CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
  STOP_ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null)
else
  CWD=$(echo "$INPUT" | grep -o '"cwd"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*"cwd"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
  if echo "$INPUT" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
    STOP_ACTIVE=true
  else
    STOP_ACTIVE=false
  fi
fi
[ "$STOP_ACTIVE" = "true" ] || STOP_ACTIVE=false

if [ -z "$CWD" ]; then
  CWD="$(pwd)"
fi

# Project root (paradigm-resolve.sh): $CLAUDE_PROJECT_DIR, else the main
# checkout (parent of the git common dir), else $CWD. A linked worktree the
# session did not start in is judged at the project root.
SCRIPT_DIR=$(dirname "$0")
[ -f "$SCRIPT_DIR/paradigm-resolve.sh" ] && . "$SCRIPT_DIR/paradigm-resolve.sh"
if command -v _pm_project_root >/dev/null 2>&1; then
  _pm_project_root "$CWD" || exit 0  # Not a paradigm project — pass
  CWD=$PM_ROOT
  _pm_session_id "$INPUT"
else
  [ -d "$CWD/.paradigm" ] || exit 0
  PM_SID=""
fi

cd "$CWD" || exit 0

# The last blocked violation set: per session when the input has a session id.
if [ -n "$PM_SID" ]; then
  STOP_FP_FILE=".paradigm/.sessions/$PM_SID.stop-fp"
else
  STOP_FP_FILE=".paradigm/.stop-block-fingerprint"
fi

# Get modified files (uncommitted changes)
_pm_mark git-diff
MODIFIED_ALL=$(git diff --name-only HEAD 2>/dev/null)

# --- Session attribution (touched-files ledger) ---
# The PostToolUse Write|Edit hook records every file this session edited in
# .paradigm/.sessions/<session_id>.touched. Only those files are judged; the
# rest of the tree's changes (Bash edits, other sessions, generated state) are
# listed as advisory. Without a session id (older hosts, tests) the whole tree
# is judged, as before.
UNATTRIBUTED=""
if [ -n "$PM_SID" ]; then
  LEDGER=".paradigm/.sessions/$PM_SID.touched"
  MODIFIED=""
  _NL='
'
  for _f in $MODIFIED_ALL; do
    if [ -f "$LEDGER" ] && grep -qxF -- "$_f" "$LEDGER" 2>/dev/null; then
      MODIFIED="$MODIFIED$_f$_NL"
    else
      case "$_f" in
        .paradigm/*|.warpline/*|*/.paradigm/*|*/.warpline/*) ;;  # generated state
        *) UNATTRIBUTED="$UNATTRIBUTED$_f$_NL" ;;
      esac
    fi
  done
  MODIFIED=${MODIFIED%"$_NL"}
  UNATTRIBUTED=${UNATTRIBUTED%"$_NL"}
else
  MODIFIED=$MODIFIED_ALL
fi

# _print_unattributed — advisory list of changes this session did not make
# through Write/Edit (capped at 10 paths).
_print_unattributed() {
  [ -n "$UNATTRIBUTED" ] || return 0
  _n=$(printf '%s\n' "$UNATTRIBUTED" | wc -l | tr -d ' ')
  echo "" >&2
  echo "[paradigm] Advisory: $_n changed file(s) not edited through Write/Edit in this session (Bash, another session or worktree); not judged:" >&2
  printf '%s\n' "$UNATTRIBUTED" | head -n 10 | sed 's/^/  - /' >&2
  [ "$_n" -gt 10 ] && echo "  ... and $((_n - 10)) more" >&2
  return 0
}

if [ -z "$MODIFIED" ]; then
  _print_unattributed
  # Clean up session markers on pass (no modifications)
  rm -f ".paradigm/.pending-review"
  rm -f ".paradigm/.session-started"
  rm -f "$STOP_FP_FILE"
  exit 0
fi

# Source shared compliance checks
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
  # --- Loop cap: one block per violation set ---
  # A violation set blocks once. After that the identical set (digits
  # ignored) is advisory: on the Stop that follows a Stop-hook continuation
  # (stop_hook_active — the agent already had its fix attempt) and on every
  # later turn of the session. A changed set blocks again, up to 3 consecutive
  # continuations. The last blocked set is kept per session
  # (.paradigm/.sessions/<id>.stop-fp) and cleared by a passing run.
  # PARADIGM_OVERRIDE is unaffected: overridden remediations never reach
  # VIOLATIONS.
  STOP_FP=$(_pm_violation_fp)
  PREV_FP=""
  PREV_COUNT=0
  if [ -f "$STOP_FP_FILE" ]; then
    PREV_FP=$(sed -n 1p "$STOP_FP_FILE" 2>/dev/null)
    PREV_COUNT=$(sed -n 2p "$STOP_FP_FILE" 2>/dev/null | tr -cd '0-9')
    PREV_COUNT=${PREV_COUNT:-0}
  fi
  if [ "$STOP_ACTIVE" = "true" ] && { [ "$STOP_FP" = "$PREV_FP" ] || [ "$PREV_COUNT" -ge 3 ]; }; then
    echo "" >&2
    echo "Paradigm: unresolved after a fix attempt — ending the turn; advisory from now on ($VIOLATION_COUNT violation(s)):" >&2
    echo "$VIOLATIONS" >&2
    _print_unattributed
    _pm_record_unresolved "$STOP_FP" "$PREV_COUNT"
    exit 0
  fi
  if [ "$STOP_FP" = "$PREV_FP" ]; then
    echo "" >&2
    echo "[paradigm] Advisory: already reported this session, not blocking again ($VIOLATION_COUNT violation(s)):" >&2
    echo "$VIOLATIONS" >&2
    _print_unattributed
    exit 0
  fi
  if [ "$STOP_ACTIVE" = "true" ]; then
    STOP_COUNT=$((PREV_COUNT + 1))
  else
    STOP_COUNT=1
  fi
  mkdir -p "${STOP_FP_FILE%/*}" 2>/dev/null
  printf '%s\n%s\n' "$STOP_FP" "$STOP_COUNT" > "$STOP_FP_FILE" 2>/dev/null

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
  _print_unattributed
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
_print_unattributed

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
rm -f "$STOP_FP_FILE"
# NOTE: gate markers (.orchestrated / .solo-declared / .team-prompted /
# .team-reminded / .team-bypass-recorded, and the per-session files in
# .paradigm/.sessions/) are deliberately NOT cleared here — Stop fires per
# assistant turn, and clearing would erase delegation credit and solo
# declarations mid-session and re-nag every turn. Session files last for the
# session (pruned after 7 days); the shared markers expire by age
# (PARADIGM_GATE_TTL_HOURS, default 4h).
find ".paradigm/.sessions" -type f -mtime +7 -exec rm -f {} + 2>/dev/null

# Postflight learning already ran above: paradigm-common.sh calls
# `compliance-check --learn`, which runs the same runPostflightLearning pass in
# the foreground. The old second `ambient postflight &` here was a duplicate
# pass, and as a background child holding the hook's stdout open it made
# Claude Code wait for EOF until the hook timeout.

exit 0
