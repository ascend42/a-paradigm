#!/bin/sh
# Paradigm Claude Code PreToolUse — Team Edit Gate (advisory tier)
# Fires before Write/Edit tool calls. If source code is about to be edited in a
# session that has neither orchestrated nor declared solo, emits a one-time
# advisory. Second line of defense after the prompt-gate (UserPromptSubmit) —
# catches sessions where the task only became implementation-shaped mid-way.
#
# Hook type: PreToolUse (matcher: Write|Edit)
# Exit 0 = always allows (advisory only — never blocks at this tier).
# Graduation to a blocking guard happens only after baseline telemetry
# justifies it (Loid: "advisory-everywhere first, four weeks minimum").
#
# Fires at most once per session (.paradigm/.sessions/<id>.team-reminded).
# Escape hatch: PARADIGM_TEAM_GATE=off

# Read JSON from stdin (hook input)
# Hook self-monitoring (#hook-monitor, fail open): wall time + outcome -> .paradigm/events/hook-timings.jsonl
case "$0" in */*) _PM_DIR=${0%/*} ;; *) _PM_DIR=. ;; esac
[ -f "$_PM_DIR/paradigm-hook-monitor.sh" ] && . "$_PM_DIR/paradigm-hook-monitor.sh" && _pm_begin PreToolUse-Write 5000 2000

INPUT=$(cat)

# Kill switch
if [ "$PARADIGM_TEAM_GATE" = "off" ]; then
  exit 0
fi

# Extract cwd from input
if command -v jq >/dev/null 2>&1; then
  CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
else
  CWD=$(echo "$INPUT" | grep -o '"cwd"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*"cwd"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
fi

if [ -z "$CWD" ]; then
  CWD="$(pwd)"
fi

# Project root + session (paradigm-resolve.sh): markers live at the root, so a
# delegation credited from a worktree counts here too. Not a paradigm project — pass.
[ -f "$_PM_DIR/paradigm-resolve.sh" ] && . "$_PM_DIR/paradigm-resolve.sh"
command -v _pm_project_root >/dev/null 2>&1 || exit 0
_pm_project_root "$CWD" || exit 0
CWD=$PM_ROOT
_pm_session_id "$INPUT"

# Session already resolved the gate (team agent delegated this session, or a
# fresh shared marker / solo declaration) — pass
if _pm_gate_resolved; then
  exit 0
fi

# Extract the target file path
if command -v jq >/dev/null 2>&1; then
  FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
else
  FILE_PATH=$(printf '%s' "$INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
fi

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Only fire for source files — docs/config/purpose edits are not team-eligible
case "$FILE_PATH" in
  *.md|*.markdown|*.yaml|*.yml|*.json|*.txt|*.purpose) exit 0 ;;
  */docs/*|*/.paradigm/*) exit 0 ;;
esac

# Remind once per session (per TTL window without a session id)
_pm_once team-reminded || exit 0

# Record the edit-advisory event (telemetry)
EVENTS_DIR="$CWD/.paradigm/events"
mkdir -p "$EVENTS_DIR" 2>/dev/null
FILE_BASE=$(basename -- "$FILE_PATH" | tr -cd 'a-zA-Z0-9._-' | head -c 60)
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "{\"timestamp\":\"$TS\",\"type\":\"edit-advisory\",\"source\":\"team-gate\",\"file\":\"$FILE_BASE\"}" >> "$EVENTS_DIR/team-funnel.jsonl" 2>/dev/null

# Emit advisory (non-blocking)
echo "" >&2
echo "[paradigm] Source edit without team orchestration this session." >&2
echo "  Standing opt-in exists: delegate to a team agent with the Agent tool (a paradigm:* agent, or one in" >&2
echo "  .claude/agents or ~/.claude/agents), or declare solo explicitly:" >&2
echo "  paradigm solo <trivial|hotfix|user-directed|exploratory> [note]" >&2
echo "  Undeclared solo work on eligible tasks is recorded as a bypass at session end." >&2

exit 0
