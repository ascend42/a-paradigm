#!/bin/sh
# Paradigm Cursor Pre-Commit Hook
# Intercepts git commit shell executions and auto-rebuilds the index.
# Installed by: paradigm hooks install --cursor
#
# Hook type: beforeShellExecution (matcher: "git commit")
# Exit 0 = allow (never blocks), just ensures index is fresh

# Sibling scripts (paradigm-resolve.sh) sit beside this one.
case "$0" in */*) _PM_DIR=${0%/*} ;; *) _PM_DIR=. ;; esac

# Read JSON from stdin (hook input)
INPUT=$(cat)

# Extract the command from Cursor's beforeShellExecution input
if command -v jq >/dev/null 2>&1; then
  COMMAND=$(echo "$INPUT" | jq -r '.command // .shellCommand // empty' 2>/dev/null)
else
  COMMAND=$(echo "$INPUT" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"command"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
fi

# If command doesn't contain "git commit", pass through
case "$COMMAND" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

# The project root, not a subdirectory: the input's cwd, otherwise the git
# toplevel, then the current directory.
if command -v jq >/dev/null 2>&1; then
  ROOT=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
else
  ROOT=$(echo "$INPUT" | grep -o '"cwd"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"cwd"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
fi
[ -n "$ROOT" ] || ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)

# If no .paradigm directory, not a paradigm project
if [ ! -d "$ROOT/.paradigm" ]; then
  exit 0
fi
# Source before the cd: $_PM_DIR may be relative to where the hook started.
[ -f "$_PM_DIR/paradigm-resolve.sh" ] && . "$_PM_DIR/paradigm-resolve.sh"
cd "$ROOT" || exit 0

# Rebuild the index with the CLI paradigm-resolve.sh finds (shared with the
# Stop hooks): the project root's own @a-company/paradigm (never one committed to
# git), then `paradigm` on PATH. No npx: never a fetch inside a hook.
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
