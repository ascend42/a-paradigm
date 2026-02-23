#!/bin/sh
# Paradigm Cursor PostWrite Hook (v2)
# Fires after file edits.
# Tracks modified source files in .paradigm/.pending-review
# and outputs compliance reminders.
# Installed by: paradigm hooks install --cursor
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

if [ -z "$found_purpose" ]; then
  file_dir=$(dirname "$REL_PATH")
  echo "" >&2
  echo "[paradigm] No .purpose file covers $file_dir/" >&2
  echo "  Create one: paradigm_purpose_init + paradigm_purpose_add_component" >&2
  echo "  $PENDING_COUNT file(s) pending review. The stop hook WILL BLOCK." >&2
elif [ "$PENDING_COUNT" -gt 0 ] && [ "$((PENDING_COUNT % 3))" -eq 0 ]; then
  echo "" >&2
  echo "[paradigm] $PENDING_COUNT source file(s) modified. Update $found_purpose:" >&2
  echo "  -> #components, ~aspects (with anchors), !signals, \$flows, ^gates" >&2
  echo "  The stop hook WILL BLOCK if .purpose files aren't updated." >&2
fi

exit 0
