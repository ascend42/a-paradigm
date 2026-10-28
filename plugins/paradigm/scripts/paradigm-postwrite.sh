#!/bin/sh
# Paradigm Claude Code PostToolUse (Write|Edit|MultiEdit|NotebookEdit) — the session's touched-files ledger.
# Appends the edited file, relative to the project root, to
# <root>/.paradigm/.sessions/<session_id>.touched. The Stop hook judges only the
# files in this ledger; the rest of the tree's changes (Bash edits, other
# sessions, other worktrees) are reported as advisory, never blocked on.
# Installed by: paradigm hooks install --claude-code
#
# Hook type: PostToolUse (matcher: Write|Edit|MultiEdit|NotebookEdit)
# Contract: NEVER fails loudly — always exit 0, no stdout/stderr output.

# Hook self-monitoring (#hook-monitor, fail open): wall time + outcome -> .paradigm/events/hook-timings.jsonl
case "$0" in */*) _PM_DIR=${0%/*} ;; *) _PM_DIR=. ;; esac
[ -f "$_PM_DIR/paradigm-hook-monitor.sh" ] && . "$_PM_DIR/paradigm-hook-monitor.sh" && _pm_begin PostToolUse-Write 10000 2000
[ -f "$_PM_DIR/paradigm-resolve.sh" ] && . "$_PM_DIR/paradigm-resolve.sh"
command -v _pm_project_root >/dev/null 2>&1 || exit 0

INPUT=$(cat 2>/dev/null)
[ -n "$INPUT" ] || exit 0

CWD=$(_pm_slashes "$(_pm_json_field "$INPUT" cwd)")
[ -n "$CWD" ] || CWD=$(pwd)
_pm_project_root "$CWD" || exit 0
_pm_session_id "$INPUT"
[ -n "$PM_SID" ] || exit 0
_pm_session_started

# Write, Edit and MultiEdit send tool_input.file_path; NotebookEdit sends notebook_path.
if command -v jq >/dev/null 2>&1; then
  FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' 2>/dev/null)
else
  FILE=$(printf '%s' "$INPUT" | grep -oE '"(file_path|notebook_path)"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*"' 2>/dev/null | head -n 1 | sed -E 's/^"[a-z_]+"[[:space:]]*:[[:space:]]*"//; s/"$//' 2>/dev/null)
fi
FILE=$(_pm_slashes "$FILE")
[ -n "$FILE" ] || exit 0
case "$FILE" in /*|[A-Za-z]:*) ;; *) FILE="$CWD/$FILE" ;; esac

# Root-relative path, the form `git diff --name-only --relative` prints.
REL=$(_pm_rel "$FILE") || exit 0  # outside the project
[ -n "$REL" ] || exit 0

LEDGER="$PM_ROOT/.paradigm/.sessions/$PM_SID.touched"
mkdir -p "${LEDGER%/*}" 2>/dev/null
if ! grep -qxF -- "$REL" "$LEDGER" 2>/dev/null; then
  printf '%s\n' "$REL" >> "$LEDGER" 2>/dev/null
fi

exit 0
