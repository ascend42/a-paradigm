#!/bin/sh
# Paradigm Claude Code Pre-Commit Hook
# Intercepts git commit Bash calls and auto-rebuilds the index.
# Installed by: paradigm hooks install --claude-code
#
# Hook type: PreToolUse (matcher: Bash)
# Exit 0 = allow (never blocks), just ensures index is fresh

# Read JSON from stdin (hook input)
# Hook self-monitoring (#hook-monitor, fail open): wall time + outcome -> .paradigm/events/hook-timings.jsonl
case "$0" in */*) _PM_DIR=${0%/*} ;; *) _PM_DIR=. ;; esac
[ -f "$_PM_DIR/paradigm-hook-monitor.sh" ] && . "$_PM_DIR/paradigm-hook-monitor.sh" && _pm_begin PreToolUse-Bash 15000 5000

INPUT=$(cat)

# Extract the command from tool_input
if command -v jq >/dev/null 2>&1; then
  COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
else
  COMMAND=$(echo "$INPUT" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"command"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
fi

# If command doesn't contain "git commit", pass through
case "$COMMAND" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

# The project root, not the directory the command runs in: Claude Code sets
# CLAUDE_PROJECT_DIR; otherwise the git toplevel, then the current directory.
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

# If no .paradigm directory, not a paradigm project
if [ ! -d "$ROOT/.paradigm" ]; then
  exit 0
fi
# Source before the cd: $_PM_DIR may be relative to where the hook started.
[ -f "$_PM_DIR/paradigm-resolve.sh" ] && . "$_PM_DIR/paradigm-resolve.sh"
cd "$ROOT" || exit 0

# Rebuild the index with the CLI paradigm-resolve.sh finds (shared with the
# Stop hooks): the project root's own @a-company/paradigm, then `paradigm` on
# PATH, then npx --no-install --package=@a-company/paradigm (never a fetch, never
# the unrelated public "paradigm" package).
if command -v _pm_resolve_paradigm >/dev/null 2>&1 && _pm_resolve_paradigm "$ROOT"; then
  $PARADIGM_BIN index --quiet 2>/dev/null || true
fi

# Stage the rebuilt files if they exist
for f in .paradigm/scan-index.json .paradigm/navigator.yaml .paradigm/flow-index.json; do
  if [ -f "$f" ]; then
    git add "$f" 2>/dev/null || true
  fi
done

# Never block — exit 0
exit 0
