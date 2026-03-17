#!/bin/sh
# paradigm-common.sh — Shared compliance checks for Paradigm stop hooks
# Sourced by claude-code-stop.sh and cursor-stop.sh
#
# Caller must set:
#   CWD      — Project root directory (already cd'd into)
#   MODIFIED — Output of `git diff --name-only HEAD`
#
# Sets:
#   VIOLATIONS      — Newline-separated violation messages
#   VIOLATION_COUNT — Number of violations
#   ADVISORY        — Non-blocking advisory text
#   SOURCE_COUNT    — Number of modified source files
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
#   9. Purpose-required patterns from config.yaml
#  10. Aspect drift detection with auto-heal
#  11. Portal gate implementation compliance

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
    Call paradigm_habits_check with trigger=\"on-stop\" after fixing the above."
  VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
fi

# --- Check 9: Purpose-required patterns from config.yaml ---
CONFIG_FILE=".paradigm/config.yaml"
if [ -f "$CONFIG_FILE" ]; then
  MISSING_REQUIRED=""
  in_section=false
  current_pattern=""

  while IFS= read -r line; do
    # Detect start of purpose-required section
    case "$line" in
      "purpose-required:"*|"  purpose-required:"*)
        in_section=true
        continue
        ;;
    esac

    if [ "$in_section" = true ]; then
      # Check if we've left the section (new top-level or same-level key)
      case "$line" in
        "  - pattern:"*)
          current_pattern=$(echo "$line" | sed 's/.*pattern:[[:space:]]*//' | tr -d '"' | tr -d "'")
          ;;
        "    depth:"*)
          # We have pattern + depth — validate
          if [ -n "$current_pattern" ]; then
            for dir in $current_pattern; do
              [ -d "$dir" ] || continue
              if [ ! -f "$dir/.purpose" ]; then
                # Deduplicate
                case "$MISSING_REQUIRED" in
                  *"$dir"*) ;;
                  *) MISSING_REQUIRED="$MISSING_REQUIRED $dir" ;;
                esac
              fi
            done
            current_pattern=""
          fi
          ;;
        [a-z]*|[A-Z]*)
          # New top-level key — end of section
          # Handle last pattern if depth wasn't specified
          if [ -n "$current_pattern" ]; then
            for dir in $current_pattern; do
              [ -d "$dir" ] || continue
              if [ ! -f "$dir/.purpose" ]; then
                case "$MISSING_REQUIRED" in
                  *"$dir"*) ;;
                  *) MISSING_REQUIRED="$MISSING_REQUIRED $dir" ;;
                esac
              fi
            done
            current_pattern=""
          fi
          in_section=false
          ;;
      esac
    fi
  done < "$CONFIG_FILE"

  # Handle last pattern if file ended while in section
  if [ "$in_section" = true ] && [ -n "$current_pattern" ]; then
    for dir in $current_pattern; do
      [ -d "$dir" ] || continue
      if [ ! -f "$dir/.purpose" ]; then
        case "$MISSING_REQUIRED" in
          *"$dir"*) ;;
          *) MISSING_REQUIRED="$MISSING_REQUIRED $dir" ;;
        esac
      fi
    done
  fi

  if [ -n "$MISSING_REQUIRED" ]; then
    VIOLATIONS="$VIOLATIONS
  - These directories match purpose-required patterns but have no .purpose file:
   $MISSING_REQUIRED
    Create .purpose files: paradigm_purpose_init + paradigm_purpose_add_component."
    VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
  fi
fi

# --- Check 10: Aspect drift detection with auto-heal ---
if [ -f ".paradigm/aspect-graph.db" ]; then
  DRIFT_RESULT=""
  if command -v paradigm >/dev/null 2>&1; then
    DRIFT_RESULT=$(paradigm drift check --json --auto-heal 2>/dev/null) || true
  elif command -v npx >/dev/null 2>&1; then
    DRIFT_RESULT=$(npx paradigm drift check --json --auto-heal 2>/dev/null) || true
  fi

  if [ -n "$DRIFT_RESULT" ]; then
    DRIFTED_COUNT=$(echo "$DRIFT_RESULT" | grep -o '"driftedCount":[0-9]*' | sed 's/.*://')
    HEALED_COUNT=$(echo "$DRIFT_RESULT" | grep -o '"healedCount":[0-9]*' | sed 's/.*://')

    if [ -n "$HEALED_COUNT" ] && [ "$HEALED_COUNT" -gt 0 ] 2>/dev/null; then
      echo "[paradigm] Auto-healed $HEALED_COUNT shifted anchor(s)." >&2
    fi

    if [ -n "$DRIFTED_COUNT" ] && [ "$DRIFTED_COUNT" -gt 0 ] 2>/dev/null; then
      VIOLATIONS="$VIOLATIONS
  - $DRIFTED_COUNT aspect anchor(s) have drifted (content genuinely changed).
    Run paradigm_aspect_check to review. Update anchors in .purpose files."
      VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
    fi
  fi
fi

# --- Check 11: Portal gate implementation compliance ---
if [ -f "portal.yaml" ]; then
  PORTAL_RESULT=""
  if command -v paradigm >/dev/null 2>&1; then
    PORTAL_RESULT=$(paradigm portal check --json 2>/dev/null) || true
  elif command -v npx >/dev/null 2>&1; then
    PORTAL_RESULT=$(npx paradigm portal check --json 2>/dev/null) || true
  fi

  if [ -n "$PORTAL_RESULT" ]; then
    UNDECLARED=$(echo "$PORTAL_RESULT" | grep -o '"usedButUndeclaredCount":[0-9]*' | sed 's/.*://')

    if [ -n "$UNDECLARED" ] && [ "$UNDECLARED" -gt 0 ] 2>/dev/null; then
      UNDECLARED_LIST=$(echo "$PORTAL_RESULT" | grep -o '"usedButUndeclared":\[[^]]*\]' | sed 's/.*\[//;s/\].*//;s/"//g')
      VIOLATIONS="$VIOLATIONS
  - $UNDECLARED gate(s) used in code but not declared in portal.yaml:
    $UNDECLARED_LIST
    Add them to portal.yaml or use paradigm_portal_add_gate."
      VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
    fi
  fi
fi

# --- Check 12: Graduation failure tracking ---
# When violations occur for graduated habits, record failures for auto-demotion.
if [ "$VIOLATION_COUNT" -gt 0 ] && [ -f ".paradigm/graduation.yaml" ]; then
  GRAD_FAILURES_DIR=".paradigm/.graduation-failures"
  mkdir -p "$GRAD_FAILURES_DIR" 2>/dev/null

  # Map violations to graduated habit IDs
  # Check 1/2/5 → purpose-coverage, Check 3/11 → gates-for-routes, Check 7 → record-lore-for-significant
  NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date +%Y-%m-%dT%H:%M:%SZ)

  # Purpose coverage violations → purpose-coverage habit
  if echo "$VIOLATIONS" | grep -q "source file.*without .purpose\|missing .purpose\|purpose.*stale" 2>/dev/null; then
    if grep -q "purpose-coverage" ".paradigm/graduation.yaml" 2>/dev/null && grep -A1 "purpose-coverage" ".paradigm/graduation.yaml" | grep -q "tier: hook" 2>/dev/null; then
      echo "$NOW" >> "$GRAD_FAILURES_DIR/purpose-coverage"
    fi
  fi

  # Portal gate violations → gates-for-routes habit
  if echo "$VIOLATIONS" | grep -q "portal.yaml\|gate.*undeclared\|gate.*not declared" 2>/dev/null; then
    if grep -q "gates-for-routes" ".paradigm/graduation.yaml" 2>/dev/null && grep -A1 "gates-for-routes" ".paradigm/graduation.yaml" | grep -q "tier: hook" 2>/dev/null; then
      echo "$NOW" >> "$GRAD_FAILURES_DIR/gates-for-routes"
    fi
  fi

  # Lore entry violations → record-lore-for-significant habit
  if echo "$VIOLATIONS" | grep -q "lore entry expected\|no lore" 2>/dev/null; then
    if grep -q "record-lore-for-significant" ".paradigm/graduation.yaml" 2>/dev/null && grep -A1 "record-lore-for-significant" ".paradigm/graduation.yaml" | grep -q "tier: hook" 2>/dev/null; then
      echo "$NOW" >> "$GRAD_FAILURES_DIR/record-lore-for-significant"
    fi
  fi

  # Count recent failures and emit advisory if approaching demotion threshold
  for fail_file in "$GRAD_FAILURES_DIR"/*; do
    [ -f "$fail_file" ] || continue
    habit_id=$(basename "$fail_file")
    fail_count=$(wc -l < "$fail_file" | tr -d ' ')
    if [ "$fail_count" -ge 3 ]; then
      ADVISORY="$ADVISORY
  - Graduated habit '$habit_id' has $fail_count failures — auto-demotion triggered.
    Run paradigm_graduate_status to review tier changes."
    elif [ "$fail_count" -ge 2 ]; then
      ADVISORY="$ADVISORY
  - Graduated habit '$habit_id' has $fail_count failures (demotion at 3).
    Fix the underlying issue or it will be demoted to habit tier."
    fi
  done
fi
