#!/bin/sh
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
          if grep -qE '\.(get|post|put|patch|delete)\s*\(|router\.|app\.(get|post|put|delete)|@(Get|Post|Put|Delete)|#\[actix_web::(get|post)' "$file" 2>/dev/null; then
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
    Update each with: #components, ~aspects (with anchors), !signals, \$flows, ^gates."
    VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
  fi
fi

# --- Check 6: Aspect coverage advisory ---
ADVISORY=""
HAS_ASPECTS=false
for purpose_file in $(find . -name ".purpose" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null); do
  if grep -qE '^\s*~' "$purpose_file" 2>/dev/null; then
    HAS_ASPECTS=true
    break
  fi
done

if [ "$HAS_ASPECTS" = true ] && [ "$SOURCE_COUNT" -gt 0 ]; then
  ASPECT_UPDATED=false
  for file in $MODIFIED; do
    case "$file" in
      *.purpose)
        if grep -qE '^\s*~|anchors:|applies-to:' "$file" 2>/dev/null; then
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
  for file in $MODIFIED; do
    case "$file" in
      .paradigm/lore/entries/*.yaml|.paradigm/lore/entries/*/*.yaml)
        LORE_RECORDED=true
        break
        ;;
    esac
  done

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
    Call paradigm_habits_check with trigger=\"on-stop\" after fixing the above."
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
