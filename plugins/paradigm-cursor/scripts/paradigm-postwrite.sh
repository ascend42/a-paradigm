#!/bin/sh
# Paradigm Cursor PostWrite Hook (v2) — LEGACY
# Fires after file edits via Cursor's afterFileEdit hook type.
# Installed by: paradigm hooks install --cursor
#
# IMPORTANT: Cursor ignores all output (stdout + stderr) from afterFileEdit hooks.
# This hook's advisory messages are INVISIBLE to the agent. The postToolUse hook
# (cursor-posttooluse.sh) is now the primary advisory mechanism.
#
# This hook is kept for backward compatibility and background file tracking only.
# Both preToolUse and stop hooks depend on the .pending-review file this writes.
#
# Hook type: afterFileEdit
# Exit 0 always (never blocks — advisory only)

# Read JSON from stdin (hook input)
INPUT=$(cat)

# Extract file path from Cursor's afterFileEdit input
if command -v jq >/dev/null 2>&1; then
  FILE_PATH=$(echo "$INPUT" | jq -r '.file // .filePath // empty' 2>/dev/null)
else
  FILE_PATH=$(echo "$INPUT" | grep -o '"file"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
  if [ -z "$FILE_PATH" ]; then
    FILE_PATH=$(echo "$INPUT" | grep -o '"filePath"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"filePath"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
  fi
fi

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Skip non-source files
case "$FILE_PATH" in
  *.purpose|portal.yaml|*.md|*.lock|*.log|*.json|*.yaml|*.yml|.gitignore|.env*) exit 0 ;;
esac

# Skip .paradigm, .claude, and .cursor directories
case "$FILE_PATH" in
  */.paradigm/*|.paradigm/*|*/.claude/*|.claude/*|*/.cursor/*|.cursor/*) exit 0 ;;
esac

# Not a paradigm project — pass
if [ ! -d ".paradigm" ]; then
  exit 0
fi

# Convert to relative path (strip project root prefix)
PROJECT_ROOT="$(pwd)"
REL_PATH="$FILE_PATH"
case "$FILE_PATH" in
  "$PROJECT_ROOT"/*) REL_PATH=$(echo "$FILE_PATH" | sed "s|^$PROJECT_ROOT/||") ;;
esac

# If still absolute, file is outside project — skip
case "$REL_PATH" in
  /*) exit 0 ;;
esac

# Track: append to .paradigm/.pending-review (deduplicated)
PENDING_FILE=".paradigm/.pending-review"
if [ -f "$PENDING_FILE" ]; then
  if ! grep -qxF "$REL_PATH" "$PENDING_FILE" 2>/dev/null; then
    echo "$REL_PATH" >> "$PENDING_FILE"
  fi
else
  echo "$REL_PATH" > "$PENDING_FILE"
fi

# Count pending files
PENDING_COUNT=$(wc -l < "$PENDING_FILE" | tr -d ' ')

# Walk up from the file's directory to find a .purpose file
dir=$(dirname "$REL_PATH")
found_purpose=""

while [ "$dir" != "." ] && [ "$dir" != "/" ] && [ "$dir" != "" ]; do
  if [ -f "$dir/.purpose" ]; then
    found_purpose="$dir/.purpose"
    break
  fi
  dir=$(dirname "$dir")
done

# Check root .purpose
if [ -z "$found_purpose" ] && [ -f ".purpose" ]; then
  found_purpose=".purpose"
fi

# NOTE: No stderr output here — Cursor ignores afterFileEdit output.
# Advisory messages are handled by cursor-posttooluse.sh (postToolUse hook).

exit 0
