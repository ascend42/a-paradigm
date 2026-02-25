// AUTO-GENERATED — DO NOT EDIT
// Source: packages/paradigm/src/commands/hooks/scripts/*.sh
// Generator: packages/paradigm/scripts/generate-hooks.mjs
//
// To update, edit the .sh files and run: node scripts/generate-hooks.mjs

export const CLAUDE_CODE_STOP_HOOK = `#!/bin/sh
# Paradigm Claude Code Stop Hook (v2)
# Validates paradigm compliance before allowing the agent to finish.
# Installed by: paradigm hooks install --claude-code
#
# Hook type: Stop
# Exit 0 = allow, Exit 2 = block with message
#
# Checks:
#   1. Source files modified without .purpose updates (threshold: 2+)
#   2. Modified source directories missing .purpose files entirely
#   3. Route-like patterns added without portal.yaml updates
#   4. Aspect anchor files that no longer exist
#   5. Per-directory .purpose freshness (tracked via .pending-review)
#   6. Aspect coverage advisory
#   7. Lore entry expected for significant sessions (3+ source files)
#   8. Blocking habits not satisfied (from paradigm_habits_check)

# Read JSON from stdin (hook input)
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
MODIFIED=$(git diff --name-only HEAD 2>/dev/null)
if [ -z "$MODIFIED" ]; then
  # Clean up pending-review on pass
  rm -f ".paradigm/.pending-review"
  exit 0
fi

VIOLATIONS=""
VIOLATION_COUNT=0

# --- Check 1: Source files modified without .purpose updates ---
SOURCE_COUNT=0
PARADIGM_COUNT=0

for file in $MODIFIED; do
  case "$file" in
    .paradigm/*|*.purpose|portal.yaml)
      PARADIGM_COUNT=$((PARADIGM_COUNT + 1))
      ;;
    *.md|*.lock|*.log|.gitignore|.env*|*.json) ;;
    *)
      SOURCE_COUNT=$((SOURCE_COUNT + 1))
      ;;
  esac
done

if [ "$SOURCE_COUNT" -gt 1 ] && [ "$PARADIGM_COUNT" -eq 0 ]; then
  VIOLATIONS="$VIOLATIONS
  - You modified $SOURCE_COUNT source files but 0 paradigm files (.purpose/portal.yaml).
    Update the nearest .purpose file for each modified code area."
  VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
fi

# --- Check 2: Modified source directories missing .purpose files ---
DIRS_WITHOUT_PURPOSE=""

for file in $MODIFIED; do
  case "$file" in
    .paradigm/*|*.md|*.lock|*.log|.gitignore|.env*|*.json|*.purpose|portal.yaml) continue ;;
  esac

  dir=$(dirname "$file")
  # Walk up to find a .purpose file
  found_purpose=false
  check_dir="$dir"
  while [ "$check_dir" != "." ] && [ "$check_dir" != "" ]; do
    if [ -f "$check_dir/.purpose" ]; then
      found_purpose=true
      break
    fi
    check_dir=$(dirname "$check_dir")
  done
  # Also check root
  if [ "$found_purpose" = false ] && [ -f ".purpose" ]; then
    found_purpose=true
  fi

  if [ "$found_purpose" = false ]; then
    # Deduplicate directory names
    case "$DIRS_WITHOUT_PURPOSE" in
      *"$dir"*) ;;
      *) DIRS_WITHOUT_PURPOSE="$DIRS_WITHOUT_PURPOSE $dir" ;;
    esac
  fi
done

if [ -n "$DIRS_WITHOUT_PURPOSE" ]; then
  VIOLATIONS="$VIOLATIONS
  - These directories have modified source files but no .purpose file anywhere in their path:
   $DIRS_WITHOUT_PURPOSE
    Create a .purpose file using paradigm_purpose_init + paradigm_purpose_add_component."
  VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
fi

# --- Check 3: Route patterns added without portal.yaml ---
if [ -f "portal.yaml" ] || echo "$MODIFIED" | grep -q "portal.yaml"; then
  : # portal.yaml exists or was modified — OK
else
  # Check if any modified files contain route-like patterns
  ROUTE_FILES=""
  for file in $MODIFIED; do
    case "$file" in
      *.ts|*.js|*.tsx|*.jsx|*.py|*.rs|*.go)
        if [ -f "$file" ]; then
          if grep -qE '\\.(get|post|put|patch|delete)\\s*\\(|router\\.|app\\.(get|post|put|delete)|@(Get|Post|Put|Delete)|#\\[actix_web::(get|post)' "$file" 2>/dev/null; then
            ROUTE_FILES="$ROUTE_FILES $file"
          fi
        fi
        ;;
    esac
  done

  if [ -n "$ROUTE_FILES" ]; then
    VIOLATIONS="$VIOLATIONS
  - Route/endpoint patterns found in modified files but no portal.yaml exists:
   $ROUTE_FILES
    Create portal.yaml with gate definitions. Use paradigm_gates_for_route for suggestions."
    VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
  fi
fi

# --- Check 4: Aspect anchor files that no longer exist ---
for purpose_file in $(find . -name ".purpose" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null); do
  if grep -q "anchors:" "$purpose_file" 2>/dev/null; then
    purpose_dir=$(dirname "$purpose_file")
    in_anchors=false
    while IFS= read -r line; do
      case "$line" in
        *"anchors:"*) in_anchors=true; continue ;;
        *"- "*)
          if [ "$in_anchors" = true ]; then
            anchor_path=$(echo "$line" | sed 's/.*- //' | sed 's/:.*//' | tr -d ' ')
            if [ -n "$anchor_path" ]; then
              # Try relative to .purpose dir first, then project root
              if [ ! -f "$purpose_dir/$anchor_path" ] && [ ! -f "./$anchor_path" ]; then
                VIOLATIONS="$VIOLATIONS
  - Aspect anchor '$anchor_path' in $purpose_file does not exist.
    Update the anchor or remove the stale aspect."
                VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
              fi
            fi
          fi
          ;;
        *) in_anchors=false ;;
      esac
    done < "$purpose_file"
  fi
done

# --- Check 5: Per-directory .purpose freshness ---
PENDING_FILE=".paradigm/.pending-review"
if [ -f "$PENDING_FILE" ]; then
  STALE_PURPOSES=""
  while IFS= read -r tracked_file; do
    [ -z "$tracked_file" ] && continue
    # Find covering .purpose for this tracked file
    check_dir=$(dirname "$tracked_file")
    covering_purpose=""
    while [ "$check_dir" != "." ] && [ "$check_dir" != "" ]; do
      if [ -f "$check_dir/.purpose" ]; then
        covering_purpose="$check_dir/.purpose"
        break
      fi
      check_dir=$(dirname "$check_dir")
    done
    if [ -z "$covering_purpose" ] && [ -f ".purpose" ]; then
      covering_purpose=".purpose"
    fi
    # Check if covering .purpose was also modified
    if [ -n "$covering_purpose" ]; then
      if ! echo "$MODIFIED" | grep -qxF "$covering_purpose"; then
        # Deduplicate
        case "$STALE_PURPOSES" in
          *"$covering_purpose"*) ;;
          *) STALE_PURPOSES="$STALE_PURPOSES $covering_purpose" ;;
        esac
      fi
    fi
  done < "$PENDING_FILE"

  if [ -n "$STALE_PURPOSES" ]; then
    VIOLATIONS="$VIOLATIONS
  - These .purpose files cover modified source code but were NOT updated:
   $STALE_PURPOSES
    Update each with: #components, ~aspects (with anchors), !signals, \\$flows, ^gates."
    VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
  fi
fi

# --- Check 6: Aspect coverage advisory ---
ADVISORY=""
HAS_ASPECTS=false
for purpose_file in $(find . -name ".purpose" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null); do
  if grep -qE '^\\s*~' "$purpose_file" 2>/dev/null; then
    HAS_ASPECTS=true
    break
  fi
done

if [ "$HAS_ASPECTS" = true ] && [ "$SOURCE_COUNT" -gt 0 ]; then
  ASPECT_UPDATED=false
  for file in $MODIFIED; do
    case "$file" in
      *.purpose)
        if grep -qE '^\\s*~|anchors:|applies-to:' "$file" 2>/dev/null; then
          ASPECT_UPDATED=true
          break
        fi
        ;;
    esac
  done

  if [ "$ASPECT_UPDATED" = false ]; then
    ADVISORY="  This project defines ~aspects with code anchors. Check if existing
  ~aspects need updated anchors or applies-to patterns."
  fi
fi

# --- Check 7: Lore entry expected for significant sessions ---
if [ "$SOURCE_COUNT" -ge 3 ] && [ -d ".paradigm/lore" ]; then
  LORE_RECORDED=false

  # Check git diff first (covers staged/committed lore)
  for file in $MODIFIED; do
    case "$file" in
      .paradigm/lore/entries/*.yaml|.paradigm/lore/entries/*/*.yaml)
        LORE_RECORDED=true
        break
        ;;
    esac
  done

  # Also check for recent lore on disk (covers MCP-written entries not yet staged)
  if [ "$LORE_RECORDED" = false ]; then
    TODAY=$(date -u +"%Y-%m-%d")
    if [ -d ".paradigm/lore/entries/$TODAY" ]; then
      ENTRY_COUNT=$(find ".paradigm/lore/entries/$TODAY" -name "*.yaml" 2>/dev/null | head -1)
      if [ -n "$ENTRY_COUNT" ]; then
        LORE_RECORDED=true
      fi
    fi
  fi

  if [ "$LORE_RECORDED" = false ]; then
    VIOLATIONS="$VIOLATIONS
  - You modified $SOURCE_COUNT source files but recorded no lore entry.
    Record your session: paradigm_lore_record (MCP) or paradigm lore record (CLI).
    Include: type, title, summary, and symbols_touched."
    VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
  fi
fi

# --- Auto-evaluate on-stop habits via CLI ---
if command -v paradigm >/dev/null 2>&1; then
  paradigm habits check --trigger on-stop --record --json 2>/dev/null || true
elif command -v npx >/dev/null 2>&1; then
  npx paradigm habits check --trigger on-stop --record --json 2>/dev/null || true
fi

# --- Check 8: Blocking habits ---
if [ -f ".paradigm/.habits-blocking" ]; then
  HABITS_BLOCKING=$(cat ".paradigm/.habits-blocking")
  VIOLATIONS="$VIOLATIONS
  - Blocking habit(s) not satisfied:
    $HABITS_BLOCKING
    Call paradigm_habits_check with trigger=\\"on-stop\\" after fixing the above."
  VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
fi

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
  exit 2
fi

# Print advisory even on pass (informational)
if [ -n "$ADVISORY" ]; then
  echo "" >&2
  echo "[paradigm] Advisory:" >&2
  echo "$ADVISORY" >&2
fi

# Clean up pending-review on pass
rm -f ".paradigm/.pending-review"
rm -f ".paradigm/.habits-blocking"

exit 0
`;

export const CLAUDE_CODE_POSTWRITE_HOOK = `#!/bin/sh
# Paradigm Claude Code PostToolUse Hook (v2)
# Fires after Edit/Write tool calls.
# Tracks modified source files in .paradigm/.pending-review
# and outputs compliance reminders.
# Installed by: paradigm hooks install --claude-code
#
# Hook type: PostToolUse (matcher: Edit,Write)
# Exit 0 always (never blocks — advisory only)

# Read JSON from stdin (hook input)
INPUT=$(cat)

# Extract the file path from tool_input
if command -v jq >/dev/null 2>&1; then
  FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.filePath // empty' 2>/dev/null)
else
  FILE_PATH=$(echo "$INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
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
  echo "  -> #components, ~aspects (with anchors), !signals, \\$flows, ^gates" >&2
  echo "  The stop hook WILL BLOCK if .purpose files aren't updated." >&2
fi

exit 0
`;

export const CLAUDE_CODE_PRECOMMIT_HOOK = `#!/bin/sh
# Paradigm Claude Code Pre-Commit Hook
# Intercepts git commit Bash calls and auto-rebuilds the index.
# Installed by: paradigm hooks install --claude-code
#
# Hook type: PreToolUse (matcher: Bash)
# Exit 0 = allow (never blocks), just ensures index is fresh

# Read JSON from stdin (hook input)
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

# If no .paradigm directory, not a paradigm project
if [ ! -d ".paradigm" ]; then
  exit 0
fi

# Run paradigm index --quiet (the existing CLI command)
if command -v paradigm >/dev/null 2>&1; then
  paradigm index --quiet 2>/dev/null || true
elif command -v npx >/dev/null 2>&1; then
  npx paradigm index --quiet 2>/dev/null || true
fi

# Stage the rebuilt files if they exist
for f in .paradigm/scan-index.json .paradigm/navigator.yaml .paradigm/flow-index.json; do
  if [ -f "$f" ]; then
    git add "$f" 2>/dev/null || true
  fi
done

# Never block — exit 0
exit 0
`;

export const CURSOR_SESSION_START_HOOK = `#!/bin/sh
# Paradigm Cursor Session Start Hook
# Fires before the agent does anything — injects additional_context
# that acts as a deterministic system prompt (not subject to context compaction).
# Installed by: paradigm hooks install --cursor
#
# Hook type: sessionStart
# Output: JSON with additional_context + continue: true
# Exit 0 always (never blocks)

# Read JSON from stdin (hook input)
INPUT=$(cat)

# Extract workspace root from Cursor's input
if command -v jq >/dev/null 2>&1; then
  CWD=$(echo "$INPUT" | jq -r '.workspace_roots[0] // empty' 2>/dev/null)
else
  CWD=$(echo "$INPUT" | grep -o '"workspace_roots"[[:space:]]*:[[:space:]]*\\["[^"]*"' | head -1 | sed 's/.*\\["//' | sed 's/"$//')
fi

if [ -z "$CWD" ]; then
  CWD="$(pwd)"
fi

# Not a paradigm project — pass without injection
if [ ! -d "$CWD/.paradigm" ]; then
  echo '{"continue":true}'
  exit 0
fi

# Build the additional_context payload
# This is injected as a system-level context that survives context compaction.

# Detect project characteristics for task-size guidance
HAS_PORTAL="false"
if [ -f "$CWD/portal.yaml" ]; then
  HAS_PORTAL="true"
fi

HAS_LORE="false"
if [ -d "$CWD/.paradigm/lore" ]; then
  HAS_LORE="true"
fi

HAS_FLOWS="false"
if [ -f "$CWD/.paradigm/flow-index.json" ]; then
  HAS_FLOWS="true"
fi

# Build context string (escaped for JSON)
CONTEXT="MANDATORY PARADIGM PROTOCOL — These rules are NON-NEGOTIABLE:\\\\n\\\\n"
CONTEXT="\${CONTEXT}Rule 1: SESSION BOOKENDS\\\\n"
CONTEXT="\${CONTEXT}  - FIRST action: Call paradigm_session_recover() to load previous session context\\\\n"
CONTEXT="\${CONTEXT}  - LAST action before finishing: Call paradigm_pm_postflight() with filesModified and symbolsTouched\\\\n\\\\n"

CONTEXT="\${CONTEXT}Rule 2: .PURPOSE UPDATES\\\\n"
CONTEXT="\${CONTEXT}  - Every source file you modify MUST have a covering .purpose file\\\\n"
CONTEXT="\${CONTEXT}  - Update the nearest .purpose file with: #components, ~aspects (with anchors), !signals\\\\n"
CONTEXT="\${CONTEXT}  - The STOP HOOK WILL BLOCK you if .purpose files are not updated\\\\n\\\\n"

CONTEXT="\${CONTEXT}Rule 3: RIPPLE BEFORE MODIFY\\\\n"
CONTEXT="\${CONTEXT}  - Before modifying any existing symbol, call paradigm_ripple({ symbol: \\\\\\"#symbol-name\\\\\\" })\\\\n"
CONTEXT="\${CONTEXT}  - This shows the blast radius — what else will break if you change it\\\\n\\\\n"

CONTEXT="\${CONTEXT}ESSENTIAL MCP TOOLS:\\\\n"
CONTEXT="\${CONTEXT}  paradigm_session_recover()          — Load previous session (call FIRST)\\\\n"
CONTEXT="\${CONTEXT}  paradigm_ripple({ symbol })          — Check impact before modifying\\\\n"
CONTEXT="\${CONTEXT}  paradigm_pm_postflight({ filesModified, symbolsTouched }) — Compliance check (call LAST)\\\\n"
CONTEXT="\${CONTEXT}  paradigm_purpose_add_component({ path, name, description }) — Register code units\\\\n"
CONTEXT="\${CONTEXT}  paradigm_reindex()                   — Rebuild indexes after .purpose changes\\\\n"
CONTEXT="\${CONTEXT}  paradigm_lore_record({ type, title, summary, symbols_touched }) — Record session\\\\n"

if [ "$HAS_PORTAL" = "true" ]; then
  CONTEXT="\${CONTEXT}  paradigm_gates_for_route({ method, path }) — Get auth gate suggestions for endpoints\\\\n"
  CONTEXT="\${CONTEXT}  paradigm_portal_add_route({ method, path, gates }) — Register route with gates\\\\n"
fi

CONTEXT="\${CONTEXT}\\\\nTASK-SIZE TIERS:\\\\n"
CONTEXT="\${CONTEXT}  1 file:   Session bookends only (recover + postflight)\\\\n"
CONTEXT="\${CONTEXT}  2-3 files: + ripple before modify + update .purpose files\\\\n"
CONTEXT="\${CONTEXT}  3+ files:  + full workflow (ripple, .purpose, lore entry"

if [ "$HAS_PORTAL" = "true" ]; then
  CONTEXT="\${CONTEXT}, portal.yaml for routes"
fi

if [ "$HAS_FLOWS" = "true" ]; then
  CONTEXT="\${CONTEXT}, flow validation"
fi

CONTEXT="\${CONTEXT})\\\\n"

if [ "$HAS_LORE" = "true" ]; then
  CONTEXT="\${CONTEXT}\\\\nLORE: This project tracks session history. Record a lore entry when modifying 3+ source files.\\\\n"
fi

# Output JSON to stdout
printf '{"additional_context":"%s","continue":true}\\n' "$CONTEXT"

exit 0
`;

export const CURSOR_STOP_HOOK = `#!/bin/sh
# Paradigm Cursor Stop Hook (v2)
# Validates paradigm compliance before allowing the agent to finish.
# Installed by: paradigm hooks install --cursor
#
# Hook type: stop
# Exit 0 = allow, Exit 2 = block with message
#
# Checks:
#   1. Source files modified without .purpose updates (threshold: 2+)
#   2. Modified source directories missing .purpose files entirely
#   3. Route-like patterns added without portal.yaml updates
#   4. Aspect anchor files that no longer exist
#   5. Per-directory .purpose freshness (tracked via .pending-review)
#   6. Aspect coverage advisory
#   7. Lore entry expected for significant sessions (3+ source files)
#   8. Blocking habits not satisfied (from paradigm_habits_check)

# Read JSON from stdin (hook input)
INPUT=$(cat)

# Extract workspace root from Cursor's input (try jq first, fallback to grep)
if command -v jq >/dev/null 2>&1; then
  CWD=$(echo "$INPUT" | jq -r '.workspace_roots[0] // empty' 2>/dev/null)
else
  CWD=$(echo "$INPUT" | grep -o '"workspace_roots"[[:space:]]*:[[:space:]]*\\["[^"]*"' | head -1 | sed 's/.*\\["//' | sed 's/"$//')
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
MODIFIED=$(git diff --name-only HEAD 2>/dev/null)
if [ -z "$MODIFIED" ]; then
  # Clean up pending-review on pass
  rm -f ".paradigm/.pending-review"
  exit 0
fi

VIOLATIONS=""
VIOLATION_COUNT=0

# --- Check 1: Source files modified without .purpose updates ---
SOURCE_COUNT=0
PARADIGM_COUNT=0

for file in $MODIFIED; do
  case "$file" in
    .paradigm/*|*.purpose|portal.yaml)
      PARADIGM_COUNT=$((PARADIGM_COUNT + 1))
      ;;
    *.md|*.lock|*.log|.gitignore|.env*|*.json) ;;
    *)
      SOURCE_COUNT=$((SOURCE_COUNT + 1))
      ;;
  esac
done

if [ "$SOURCE_COUNT" -gt 1 ] && [ "$PARADIGM_COUNT" -eq 0 ]; then
  VIOLATIONS="$VIOLATIONS
  - You modified $SOURCE_COUNT source files but 0 paradigm files (.purpose/portal.yaml).
    Update the nearest .purpose file for each modified code area."
  VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
fi

# --- Check 2: Modified source directories missing .purpose files ---
DIRS_WITHOUT_PURPOSE=""

for file in $MODIFIED; do
  case "$file" in
    .paradigm/*|*.md|*.lock|*.log|.gitignore|.env*|*.json|*.purpose|portal.yaml) continue ;;
  esac

  dir=$(dirname "$file")
  # Walk up to find a .purpose file
  found_purpose=false
  check_dir="$dir"
  while [ "$check_dir" != "." ] && [ "$check_dir" != "" ]; do
    if [ -f "$check_dir/.purpose" ]; then
      found_purpose=true
      break
    fi
    check_dir=$(dirname "$check_dir")
  done
  # Also check root
  if [ "$found_purpose" = false ] && [ -f ".purpose" ]; then
    found_purpose=true
  fi

  if [ "$found_purpose" = false ]; then
    # Deduplicate directory names
    case "$DIRS_WITHOUT_PURPOSE" in
      *"$dir"*) ;;
      *) DIRS_WITHOUT_PURPOSE="$DIRS_WITHOUT_PURPOSE $dir" ;;
    esac
  fi
done

if [ -n "$DIRS_WITHOUT_PURPOSE" ]; then
  VIOLATIONS="$VIOLATIONS
  - These directories have modified source files but no .purpose file anywhere in their path:
   $DIRS_WITHOUT_PURPOSE
    Create a .purpose file using paradigm_purpose_init + paradigm_purpose_add_component."
  VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
fi

# --- Check 3: Route patterns added without portal.yaml ---
if [ -f "portal.yaml" ] || echo "$MODIFIED" | grep -q "portal.yaml"; then
  : # portal.yaml exists or was modified — OK
else
  # Check if any modified files contain route-like patterns
  ROUTE_FILES=""
  for file in $MODIFIED; do
    case "$file" in
      *.ts|*.js|*.tsx|*.jsx|*.py|*.rs|*.go)
        if [ -f "$file" ]; then
          if grep -qE '\\.(get|post|put|patch|delete)\\s*\\(|router\\.|app\\.(get|post|put|delete)|@(Get|Post|Put|Delete)|#\\[actix_web::(get|post)' "$file" 2>/dev/null; then
            ROUTE_FILES="$ROUTE_FILES $file"
          fi
        fi
        ;;
    esac
  done

  if [ -n "$ROUTE_FILES" ]; then
    VIOLATIONS="$VIOLATIONS
  - Route/endpoint patterns found in modified files but no portal.yaml exists:
   $ROUTE_FILES
    Create portal.yaml with gate definitions. Use paradigm_gates_for_route for suggestions."
    VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
  fi
fi

# --- Check 4: Aspect anchor files that no longer exist ---
for purpose_file in $(find . -name ".purpose" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null); do
  if grep -q "anchors:" "$purpose_file" 2>/dev/null; then
    purpose_dir=$(dirname "$purpose_file")
    in_anchors=false
    while IFS= read -r line; do
      case "$line" in
        *"anchors:"*) in_anchors=true; continue ;;
        *"- "*)
          if [ "$in_anchors" = true ]; then
            anchor_path=$(echo "$line" | sed 's/.*- //' | sed 's/:.*//' | tr -d ' ')
            if [ -n "$anchor_path" ]; then
              # Try relative to .purpose dir first, then project root
              if [ ! -f "$purpose_dir/$anchor_path" ] && [ ! -f "./$anchor_path" ]; then
                VIOLATIONS="$VIOLATIONS
  - Aspect anchor '$anchor_path' in $purpose_file does not exist.
    Update the anchor or remove the stale aspect."
                VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
              fi
            fi
          fi
          ;;
        *) in_anchors=false ;;
      esac
    done < "$purpose_file"
  fi
done

# --- Check 5: Per-directory .purpose freshness ---
PENDING_FILE=".paradigm/.pending-review"
if [ -f "$PENDING_FILE" ]; then
  STALE_PURPOSES=""
  while IFS= read -r tracked_file; do
    [ -z "$tracked_file" ] && continue
    # Find covering .purpose for this tracked file
    check_dir=$(dirname "$tracked_file")
    covering_purpose=""
    while [ "$check_dir" != "." ] && [ "$check_dir" != "" ]; do
      if [ -f "$check_dir/.purpose" ]; then
        covering_purpose="$check_dir/.purpose"
        break
      fi
      check_dir=$(dirname "$check_dir")
    done
    if [ -z "$covering_purpose" ] && [ -f ".purpose" ]; then
      covering_purpose=".purpose"
    fi
    # Check if covering .purpose was also modified
    if [ -n "$covering_purpose" ]; then
      if ! echo "$MODIFIED" | grep -qxF "$covering_purpose"; then
        # Deduplicate
        case "$STALE_PURPOSES" in
          *"$covering_purpose"*) ;;
          *) STALE_PURPOSES="$STALE_PURPOSES $covering_purpose" ;;
        esac
      fi
    fi
  done < "$PENDING_FILE"

  if [ -n "$STALE_PURPOSES" ]; then
    VIOLATIONS="$VIOLATIONS
  - These .purpose files cover modified source code but were NOT updated:
   $STALE_PURPOSES
    Update each with: #components, ~aspects (with anchors), !signals, \\$flows, ^gates."
    VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
  fi
fi

# --- Check 6: Aspect coverage advisory ---
ADVISORY=""
HAS_ASPECTS=false
for purpose_file in $(find . -name ".purpose" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null); do
  if grep -qE '^\\s*~' "$purpose_file" 2>/dev/null; then
    HAS_ASPECTS=true
    break
  fi
done

if [ "$HAS_ASPECTS" = true ] && [ "$SOURCE_COUNT" -gt 0 ]; then
  ASPECT_UPDATED=false
  for file in $MODIFIED; do
    case "$file" in
      *.purpose)
        if grep -qE '^\\s*~|anchors:|applies-to:' "$file" 2>/dev/null; then
          ASPECT_UPDATED=true
          break
        fi
        ;;
    esac
  done

  if [ "$ASPECT_UPDATED" = false ]; then
    ADVISORY="  This project defines ~aspects with code anchors. Check if existing
  ~aspects need updated anchors or applies-to patterns."
  fi
fi

# --- Check 7: Lore entry expected for significant sessions ---
if [ "$SOURCE_COUNT" -ge 3 ] && [ -d ".paradigm/lore" ]; then
  LORE_RECORDED=false

  # Check git diff first (covers staged/committed lore)
  for file in $MODIFIED; do
    case "$file" in
      .paradigm/lore/entries/*.yaml|.paradigm/lore/entries/*/*.yaml)
        LORE_RECORDED=true
        break
        ;;
    esac
  done

  # Also check for recent lore on disk (covers MCP-written entries not yet staged)
  if [ "$LORE_RECORDED" = false ]; then
    TODAY=$(date -u +"%Y-%m-%d")
    if [ -d ".paradigm/lore/entries/$TODAY" ]; then
      ENTRY_COUNT=$(find ".paradigm/lore/entries/$TODAY" -name "*.yaml" 2>/dev/null | head -1)
      if [ -n "$ENTRY_COUNT" ]; then
        LORE_RECORDED=true
      fi
    fi
  fi

  if [ "$LORE_RECORDED" = false ]; then
    VIOLATIONS="$VIOLATIONS
  - You modified $SOURCE_COUNT source files but recorded no lore entry.
    Record your session: paradigm_lore_record (MCP) or paradigm lore record (CLI).
    Include: type, title, summary, and symbols_touched."
    VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
  fi
fi

# --- Auto-evaluate on-stop habits via CLI ---
if command -v paradigm >/dev/null 2>&1; then
  paradigm habits check --trigger on-stop --record --json 2>/dev/null || true
elif command -v npx >/dev/null 2>&1; then
  npx paradigm habits check --trigger on-stop --record --json 2>/dev/null || true
fi

# --- Check 8: Blocking habits ---
if [ -f ".paradigm/.habits-blocking" ]; then
  HABITS_BLOCKING=$(cat ".paradigm/.habits-blocking")
  VIOLATIONS="$VIOLATIONS
  - Blocking habit(s) not satisfied:
    $HABITS_BLOCKING
    Call paradigm_habits_check with trigger=\\"on-stop\\" after fixing the above."
  VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
fi

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
  # Escape violations for JSON embedding (newlines → \\n, quotes → \\", backslash → \\\\)
  ESCAPED_VIOLATIONS=$(printf '%s' "$VIOLATIONS" | sed 's/\\\\/\\\\\\\\/g' | sed 's/"/\\\\"/g' | sed ':a;N;$!ba;s/\\n/\\\\n/g')
  printf '{"followup_message":"Paradigm compliance check found %d violation(s). Fix these:\\\\n%s\\\\nThen try finishing again."}\\n' "$VIOLATION_COUNT" "$ESCAPED_VIOLATIONS"

  exit 2
fi

# Print advisory even on pass (informational)
if [ -n "$ADVISORY" ]; then
  echo "" >&2
  echo "[paradigm] Advisory:" >&2
  echo "$ADVISORY" >&2
fi

# Clean up pending-review on pass
rm -f ".paradigm/.pending-review"
rm -f ".paradigm/.habits-blocking"

exit 0
`;

export const CURSOR_POSTWRITE_HOOK = `#!/bin/sh
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
  echo "  -> #components, ~aspects (with anchors), !signals, \\$flows, ^gates" >&2
  echo "  The stop hook WILL BLOCK if .purpose files aren't updated." >&2
fi

exit 0
`;

export const CURSOR_PRECOMMIT_HOOK = `#!/bin/sh
# Paradigm Cursor Pre-Commit Hook
# Intercepts git commit shell executions and auto-rebuilds the index.
# Installed by: paradigm hooks install --cursor
#
# Hook type: beforeShellExecution (matcher: "git commit")
# Exit 0 = allow (never blocks), just ensures index is fresh

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

# If no .paradigm directory, not a paradigm project
if [ ! -d ".paradigm" ]; then
  exit 0
fi

# Run paradigm index --quiet (the existing CLI command)
if command -v paradigm >/dev/null 2>&1; then
  paradigm index --quiet 2>/dev/null || true
elif command -v npx >/dev/null 2>&1; then
  npx paradigm index --quiet 2>/dev/null || true
fi

# Stage the rebuilt files if they exist
for f in .paradigm/scan-index.json .paradigm/navigator.yaml .paradigm/flow-index.json; do
  if [ -f "$f" ]; then
    git add "$f" 2>/dev/null || true
  fi
done

# Never block — exit 0
exit 0
`;

