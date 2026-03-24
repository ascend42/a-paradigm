#!/bin/sh
# Paradigm Claude Code PostToolUse Hook (v2)
# Fires after Edit/Write tool calls.
# Tracks modified source files in .paradigm/.pending-review
# and outputs compliance reminders.
# Installed by: paradigm hooks install --claude-code
#
# Hook type: PostToolUse (matcher: Edit,Write)
# Exit 0 always (never blocks — advisory only)
#
# NOTE: stdin JSON can be 8KB+ (tool_response includes full file contents).
# Using echo "$INPUT" | jq corrupts the JSON via shell string handling.
# Fix: write stdin to temp file, use jq < file for all extractions.

# Save stdin to temp file — avoids echo corruption on large JSON
TMPINPUT=$(mktemp)
trap 'rm -f "$TMPINPUT"' EXIT
cat > "$TMPINPUT"

# Extract the file path from tool_input
if command -v jq >/dev/null 2>&1; then
  FILE_PATH=$(jq -r '.tool_input.file_path // .tool_input.filePath // empty' < "$TMPINPUT" 2>/dev/null)
else
  FILE_PATH=$(grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' "$TMPINPUT" | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
  if [ -z "$FILE_PATH" ]; then
    FILE_PATH=$(grep -o '"filePath"[[:space:]]*:[[:space:]]*"[^"]*"' "$TMPINPUT" | head -1 | sed 's/.*"filePath"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
  fi
fi

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Extract cwd from input
if command -v jq >/dev/null 2>&1; then
  CWD=$(jq -r '.cwd // empty' < "$TMPINPUT" 2>/dev/null)
else
  CWD=$(grep -o '"cwd"[[:space:]]*:[[:space:]]*"[^"]*"' "$TMPINPUT" | sed 's/.*"cwd"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
fi
if [ -n "$CWD" ]; then
  cd "$CWD" || exit 0
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

# Pseudo-session-start: first edit of session emits one-time guidance
if [ ! -f ".paradigm/.session-started" ]; then
  PREV_PENDING=$(cat .paradigm/.pending-review 2>/dev/null | wc -l | tr -d ' ')
  if [ "$PREV_PENDING" -gt 0 ] 2>/dev/null; then
    echo "[paradigm] Session started. $PREV_PENDING uncovered edit(s) from last session." >&2
  fi
  touch ".paradigm/.session-started"
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

# Emit file-modified event (fire-and-forget)
if command -v paradigm >/dev/null 2>&1; then
  paradigm event emit --type file-modified --source post-write-hook --path "$REL_PATH" &
fi

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

# Surface high-urgency agent nominations (system-level, not agent-specific)
if [ "$PENDING_COUNT" -ge 5 ] && [ "$((PENDING_COUNT % 5))" -eq 0 ]; then
  echo "" >&2
  echo "[paradigm] $PENDING_COUNT files pending review. Check agent nominations: paradigm_ambient_nominations" >&2
fi

# Context budget heuristic: suggest handoff check at high edit counts
if [ "$PENDING_COUNT" -ge 30 ]; then
  echo "[paradigm] ~$PENDING_COUNT edits this session. Consider preparing handoff." >&2
fi

exit 0
