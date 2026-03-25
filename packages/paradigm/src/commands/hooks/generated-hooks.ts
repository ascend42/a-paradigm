// AUTO-GENERATED — DO NOT EDIT
// Source: packages/paradigm/src/commands/hooks/scripts/*.sh
// Generator: packages/paradigm/scripts/generate-hooks.mjs
//
// To update, edit the .sh files and run: node scripts/generate-hooks.mjs

export const COMMON_HOOK = `#!/bin/sh
# paradigm-common.sh — Shared compliance checks for Paradigm stop hooks
# Sourced by claude-code-stop.sh and cursor-stop.sh
#
# Caller must set:
#   CWD      — Project root directory (already cd'd into)
#   MODIFIED — Output of \`git diff --name-only HEAD\`
#
# Caller may set:
#   PARADIGM_AUTO_FIX — Set to "1" to auto-fix trivial violations (missing .purpose stubs, missing lore)
#
# Sets:
#   VIOLATIONS      — Newline-separated violation messages
#   VIOLATION_COUNT — Number of violations
#   ADVISORY        — Non-blocking advisory text
#   SOURCE_COUNT    — Number of modified source files
#   AUTO_FIXED      — Newline-separated auto-fix actions taken
#   AUTO_FIX_COUNT  — Number of auto-fixes applied
#
# Checks:
#   1. Source files modified without .purpose updates (threshold: 2+)
#   2. Modified source directories missing .purpose files entirely
#   3. Route-like patterns added without portal.yaml updates
#   4. Aspect anchor files that no longer exist
#   5. Per-directory .purpose freshness (tracked via .pending-review)
#   6. Aspect coverage advisory
#   7. Lore entry expected for significant sessions (3+ source files)
#   8. Blocking habits not satisfied (from unified compliance-check)
#   9. Purpose-required patterns from config.yaml
#  10. Aspect drift detection with auto-heal (from unified compliance-check)
#  11. Portal gate implementation compliance (from unified compliance-check)

VIOLATIONS=""
VIOLATION_COUNT=0
AUTO_FIXED=""
AUTO_FIX_COUNT=0
PARADIGM_AUTO_FIX="\${PARADIGM_AUTO_FIX:-0}"

# --- Cache .purpose file paths (avoid repeated find scans) ---
PURPOSE_CACHE=".paradigm/.purpose-paths"
if [ -f "$PURPOSE_CACHE" ]; then
  PURPOSE_PATHS=$(cat "$PURPOSE_CACHE")
else
  PURPOSE_PATHS=$(find . -name ".purpose" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null)
  if [ -n "$PURPOSE_PATHS" ]; then
    echo "$PURPOSE_PATHS" > "$PURPOSE_CACHE"
  fi
fi

# --- Check 1: Source files modified without .purpose updates ---
# Instead of counting total source files globally, check per-directory:
# only flag directories where source files were modified but no .purpose
# exists in that directory's ancestor chain OR the covering .purpose was not updated.
SOURCE_COUNT=0
PARADIGM_COUNT=0
UNCOVERED_SOURCE_DIRS=""

for file in $MODIFIED; do
  case "$file" in
    .paradigm/*|*.purpose|portal.yaml)
      PARADIGM_COUNT=$((PARADIGM_COUNT + 1))
      ;;
    *.md|*.lock|*.log|.gitignore|.env*|*.json) ;;
    *)
      SOURCE_COUNT=$((SOURCE_COUNT + 1))
      # Check if this file's directory has a covering .purpose that was modified
      src_dir=$(dirname "$file")
      covering=""
      walk_dir="$src_dir"
      while [ "$walk_dir" != "." ] && [ "$walk_dir" != "" ]; do
        if [ -f "$walk_dir/.purpose" ]; then
          covering="$walk_dir/.purpose"
          break
        fi
        walk_dir=$(dirname "$walk_dir")
      done
      if [ -z "$covering" ] && [ -f ".purpose" ]; then
        covering=".purpose"
      fi
      # If there IS a covering .purpose, check if it was modified too
      if [ -n "$covering" ]; then
        purpose_was_modified=false
        for mod_file in $MODIFIED; do
          if [ "$mod_file" = "$covering" ]; then
            purpose_was_modified=true
            break
          fi
        done
        if [ "$purpose_was_modified" = false ]; then
          # Deduplicate by directory
          case "$UNCOVERED_SOURCE_DIRS" in
            *"$src_dir"*) ;;
            *) UNCOVERED_SOURCE_DIRS="$UNCOVERED_SOURCE_DIRS $src_dir" ;;
          esac
        fi
      else
        # No .purpose at all — already caught by Check 2
        :
      fi
      ;;
  esac
done

# Only flag if there are uncovered directories AND zero paradigm files were touched
if [ -n "$UNCOVERED_SOURCE_DIRS" ] && [ "$PARADIGM_COUNT" -eq 0 ]; then
  # Count uncovered dirs
  UNCOVERED_DIR_COUNT=0
  for _d in $UNCOVERED_SOURCE_DIRS; do
    UNCOVERED_DIR_COUNT=$((UNCOVERED_DIR_COUNT + 1))
  done
  VIOLATIONS="$VIOLATIONS
  - You modified source files in $UNCOVERED_DIR_COUNT director(ies) without updating their .purpose files:
   $UNCOVERED_SOURCE_DIRS
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
  if [ "$PARADIGM_AUTO_FIX" = "1" ]; then
    # Auto-fix: create stub .purpose files for directories missing them
    for dir in $DIRS_WITHOUT_PURPOSE; do
      dir_basename=$(basename "$dir")
      cat > "$dir/.purpose" <<PURPOSEEOF
# Auto-generated .purpose stub — update with real descriptions
components:
  $dir_basename:
    description: "TODO: describe this component"
    tags: []
PURPOSEEOF
      AUTO_FIXED="$AUTO_FIXED
  - Created stub .purpose in $dir (update descriptions)"
      AUTO_FIX_COUNT=$((AUTO_FIX_COUNT + 1))
    done
  else
    VIOLATIONS="$VIOLATIONS
  - These directories have modified source files but no .purpose file anywhere in their path:
   $DIRS_WITHOUT_PURPOSE
    Create a .purpose file using paradigm_purpose_init + paradigm_purpose_add_component."
    VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
  fi
fi

# --- Check 3: Route patterns added without portal.yaml ---
if [ -f "portal.yaml" ] || echo "$MODIFIED" | grep -q "portal.yaml"; then
  : # portal.yaml exists or was modified — OK
else
  # Check if any modified files contain route-like patterns
  # Skip: test/spec/fixture files, markdown, and comment-only matches
  ROUTE_FILES=""
  for file in $MODIFIED; do
    # Skip test, spec, and fixture files entirely
    case "$file" in
      *test*|*spec*|*fixture*|*__tests__*|*__mocks__*|*.test.*|*.spec.*) continue ;;
    esac
    case "$file" in
      *.ts|*.js|*.tsx|*.jsx|*.py|*.rs|*.go)
        if [ -f "$file" ]; then
          # Grep for route patterns, then filter out comment lines and description strings
          ROUTE_MATCH=$(grep -nE '\\.(get|post|put|patch|delete)\\s*\\(|router\\.|app\\.(get|post|put|delete)|@(Get|Post|Put|Delete)|#\\[actix_web::(get|post)' "$file" 2>/dev/null \\
            | grep -v '^\\s*[0-9]*:\\s*//' \\
            | grep -v '^\\s*[0-9]*:\\s*\\*' \\
            | grep -v '^\\s*[0-9]*:\\s*#' \\
            | grep -v '^\\s*[0-9]*:\\s*<!--' \\
            | grep -v 'description:' \\
            | grep -v 'summary:' \\
            | grep -v 'comment:' \\
            | grep -v '@example' \\
            | grep -v '@see' \\
            || true)
          if [ -n "$ROUTE_MATCH" ]; then
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
for purpose_file in $PURPOSE_PATHS; do
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
# Uses .pending-review if available, plus a git-based fallback that cross-references
# modified source files against .purpose modification times.
PENDING_FILE=".paradigm/.pending-review"
STALE_PURPOSES=""

# Helper: record a stale .purpose (deduplicating)
_record_stale_purpose() {
  _cov="$1"
  case "$STALE_PURPOSES" in
    *"$_cov"*) ;;
    *) STALE_PURPOSES="$STALE_PURPOSES $_cov" ;;
  esac
}

# Strategy A: Use .pending-review tracking file if present
if [ -f "$PENDING_FILE" ]; then
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
        _record_stale_purpose "$covering_purpose"
      fi
    fi
  done < "$PENDING_FILE"
fi

# Strategy B: Git-based fallback — for each modified source file, check whether
# its covering .purpose was modified more recently (by filesystem mtime).
# This catches cases where .pending-review is missing or out of sync.
for file in $MODIFIED; do
  case "$file" in
    .paradigm/*|*.md|*.lock|*.log|.gitignore|.env*|*.json|*.purpose|portal.yaml) continue ;;
  esac
  [ -f "$file" ] || continue

  # Find covering .purpose
  check_dir=$(dirname "$file")
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
  [ -n "$covering_purpose" ] || continue

  # Skip if .purpose was in the modified list (already updated this session)
  echo "$MODIFIED" | grep -qxF "$covering_purpose" && continue

  # Compare modification times: if source file is newer than .purpose, it's stale
  if [ -f "$covering_purpose" ]; then
    # Use portable stat-based mtime comparison (works on macOS + Linux)
    if command -v stat >/dev/null 2>&1; then
      # macOS stat: -f %m gives epoch seconds; Linux stat: -c %Y
      src_mtime=$(stat -f %m "$file" 2>/dev/null || stat -c %Y "$file" 2>/dev/null || echo "0")
      purpose_mtime=$(stat -f %m "$covering_purpose" 2>/dev/null || stat -c %Y "$covering_purpose" 2>/dev/null || echo "0")
      if [ "$src_mtime" -gt "$purpose_mtime" ] 2>/dev/null; then
        _record_stale_purpose "$covering_purpose"
      fi
    fi
  fi
done

if [ -n "$STALE_PURPOSES" ]; then
  VIOLATIONS="$VIOLATIONS
  - These .purpose files cover modified source code but were NOT updated:
   $STALE_PURPOSES
    Update each with: #components, ~aspects (with anchors), !signals, \\$flows, ^gates."
  VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
fi

# --- Check 6: Aspect coverage advisory ---
ADVISORY=""
HAS_ASPECTS=false
for purpose_file in $PURPOSE_PATHS; do
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
    if [ "$PARADIGM_AUTO_FIX" = "1" ]; then
      # Auto-fix: create a stub lore entry with modified file info
      TODAY=$(date -u +"%Y-%m-%d" 2>/dev/null || date +"%Y-%m-%d")
      LORE_TIMESTAMP=$(date -u +"%H%M%S" 2>/dev/null || date +"%H%M%S")
      LORE_DIR=".paradigm/lore/entries/$TODAY"
      mkdir -p "$LORE_DIR" 2>/dev/null
      LORE_ID="L-\${TODAY}-auto-\${LORE_TIMESTAMP}"
      LORE_FILE="$LORE_DIR/\${LORE_ID}.yaml"

      # Extract symbols from modified file paths (directory basenames as component names)
      LORE_SYMBOLS=""
      for file in $MODIFIED; do
        case "$file" in
          .paradigm/*|*.md|*.lock|*.log|.gitignore|.env*|*.json|*.purpose|portal.yaml) continue ;;
        esac
        sym_dir=$(basename "$(dirname "$file")")
        case "$LORE_SYMBOLS" in
          *"#$sym_dir"*) ;;
          *) LORE_SYMBOLS="$LORE_SYMBOLS \\"#$sym_dir\\"" ;;
        esac
      done

      cat > "$LORE_FILE" <<LOREEOF
id: "$LORE_ID"
type: agent-session
title: "Auto-recorded session — $SOURCE_COUNT files modified"
summary: "Session modified $SOURCE_COUNT source files. Auto-recorded by stop hook."
symbols_touched: [$(echo $LORE_SYMBOLS | sed 's/^ //')]
timestamp: "$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date +"%Y-%m-%dT%H:%M:%SZ")"
LOREEOF
      AUTO_FIXED="$AUTO_FIXED
  - Created stub lore entry $LORE_ID (update with real summary)"
      AUTO_FIX_COUNT=$((AUTO_FIX_COUNT + 1))
    else
      VIOLATIONS="$VIOLATIONS
  - You modified $SOURCE_COUNT source files but recorded no lore entry.
    Record your session: paradigm_lore_record (MCP) or paradigm lore record (CLI).
    Include: type, title, summary, and symbols_touched."
      VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
    fi
  fi
fi

# --- Checks 8, 10, 11: Unified compliance check (single Node.js process) ---
# Replaces 3 separate subprocess calls (habits check, drift check, portal check)
# with a single \`paradigm compliance-check\` invocation.
COMPLIANCE_RESULT=""
if command -v paradigm >/dev/null 2>&1; then
  COMPLIANCE_RESULT=$(paradigm compliance-check --json --auto-heal --learn --trigger on-stop 2>/dev/null) || true
elif command -v npx >/dev/null 2>&1; then
  COMPLIANCE_RESULT=$(npx paradigm compliance-check --json --auto-heal --learn --trigger on-stop 2>/dev/null) || true
fi

if [ -n "$COMPLIANCE_RESULT" ]; then
  # --- Check 8: Blocking habits (from unified result) ---
  # The compliance-check command writes .habits-blocking marker internally
  if [ -f ".paradigm/.habits-blocking" ]; then
    HABITS_BLOCKING=$(cat ".paradigm/.habits-blocking")
    VIOLATIONS="$VIOLATIONS
  - Blocking habit(s) not satisfied:
    $HABITS_BLOCKING
    Call paradigm_habits_check with trigger=\\"on-stop\\" after fixing the above."
    VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
  fi

  # --- Check 10: Aspect drift (from unified result) ---
  DRIFTED_COUNT=$(echo "$COMPLIANCE_RESULT" | grep -o '"driftedCount":[0-9]*' | sed 's/.*://')
  HEALED_COUNT=$(echo "$COMPLIANCE_RESULT" | grep -o '"healedCount":[0-9]*' | sed 's/.*://')

  if [ -n "$HEALED_COUNT" ] && [ "$HEALED_COUNT" -gt 0 ] 2>/dev/null; then
    echo "[paradigm] Auto-healed $HEALED_COUNT shifted anchor(s)." >&2
  fi

  if [ -n "$DRIFTED_COUNT" ] && [ "$DRIFTED_COUNT" -gt 0 ] 2>/dev/null; then
    VIOLATIONS="$VIOLATIONS
  - $DRIFTED_COUNT aspect anchor(s) have drifted (content genuinely changed).
    Run paradigm_aspect_check to review. Update anchors in .purpose files."
    VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
  fi

  # --- Check 11: Portal gate compliance (from unified result) ---
  UNDECLARED=$(echo "$COMPLIANCE_RESULT" | grep -o '"usedButUndeclaredCount":[0-9]*' | sed 's/.*://')

  if [ -n "$UNDECLARED" ] && [ "$UNDECLARED" -gt 0 ] 2>/dev/null; then
    UNDECLARED_LIST=$(echo "$COMPLIANCE_RESULT" | grep -o '"usedButUndeclared":\\[[^]]*\\]' | sed 's/.*\\[//;s/\\].*//;s/"//g')
    VIOLATIONS="$VIOLATIONS
  - $UNDECLARED gate(s) used in code but not declared in portal.yaml:
    $UNDECLARED_LIST
    Add them to portal.yaml or use paradigm_portal_add_gate."
    VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
  fi
else
  # Fallback: check habits blocking marker even if compliance-check unavailable
  if [ -f ".paradigm/.habits-blocking" ]; then
    HABITS_BLOCKING=$(cat ".paradigm/.habits-blocking")
    VIOLATIONS="$VIOLATIONS
  - Blocking habit(s) not satisfied:
    $HABITS_BLOCKING
    Call paradigm_habits_check with trigger=\\"on-stop\\" after fixing the above."
    VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
  fi
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
    if [ "$PARADIGM_AUTO_FIX" = "1" ]; then
      # Auto-fix: create stub .purpose files for required patterns
      for dir in $MISSING_REQUIRED; do
        dir_basename=$(basename "$dir")
        cat > "$dir/.purpose" <<PURPOSEEOF
# Auto-generated .purpose stub (purpose-required) — update with real descriptions
components:
  $dir_basename:
    description: "TODO: describe this component"
    tags: []
PURPOSEEOF
        AUTO_FIXED="$AUTO_FIXED
  - Created stub .purpose in $dir (purpose-required pattern)"
        AUTO_FIX_COUNT=$((AUTO_FIX_COUNT + 1))
      done
    else
      VIOLATIONS="$VIOLATIONS
  - These directories match purpose-required patterns but have no .purpose file:
   $MISSING_REQUIRED
    Create .purpose files: paradigm_purpose_init + paradigm_purpose_add_component."
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
  if echo "$VIOLATIONS" | grep -q "source file.*without .purpose\\|missing .purpose\\|purpose.*stale" 2>/dev/null; then
    if grep -q "purpose-coverage" ".paradigm/graduation.yaml" 2>/dev/null && grep -A1 "purpose-coverage" ".paradigm/graduation.yaml" | grep -q "tier: hook" 2>/dev/null; then
      echo "$NOW" >> "$GRAD_FAILURES_DIR/purpose-coverage"
    fi
  fi

  # Portal gate violations → gates-for-routes habit
  if echo "$VIOLATIONS" | grep -q "portal.yaml\\|gate.*undeclared\\|gate.*not declared" 2>/dev/null; then
    if grep -q "gates-for-routes" ".paradigm/graduation.yaml" 2>/dev/null && grep -A1 "gates-for-routes" ".paradigm/graduation.yaml" | grep -q "tier: hook" 2>/dev/null; then
      echo "$NOW" >> "$GRAD_FAILURES_DIR/gates-for-routes"
    fi
  fi

  # Lore entry violations → record-lore-for-significant habit
  if echo "$VIOLATIONS" | grep -q "lore entry expected\\|no lore" 2>/dev/null; then
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
`;

export const CLAUDE_CODE_STOP_HOOK = `#!/bin/sh
# Paradigm Claude Code Stop Hook (v2)
# Validates paradigm compliance before allowing the agent to finish.
# Installed by: paradigm hooks install --claude-code
#
# Hook type: Stop
# Exit 0 = allow, Exit 2 = block with message
#
# Checks 1–11 are defined in paradigm-common.sh (shared with Cursor hook).

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
  # Clean up session markers on pass (no modifications)
  rm -f ".paradigm/.pending-review"
  rm -f ".paradigm/.session-started"
  exit 0
fi

# Source shared compliance checks
SCRIPT_DIR=$(dirname "$0")
. "$SCRIPT_DIR/paradigm-common.sh"

# --- Report auto-fixes if any ---
if [ "$AUTO_FIX_COUNT" -gt 0 ]; then
  echo "" >&2
  echo "[paradigm] Auto-fixed $AUTO_FIX_COUNT issue(s):" >&2
  echo "$AUTO_FIXED" >&2
fi

# --- Final verdict ---
if [ "$VIOLATION_COUNT" -gt 0 ]; then
  # Emit compliance-violation event (fire-and-forget, backgrounded)
  # NOTE: Could be absorbed into compliance-check command in a future iteration.
  if command -v paradigm >/dev/null 2>&1; then
    paradigm event emit --type compliance-violation --source stop-hook --severity error --context "Stop hook: $VIOLATION_COUNT violation(s)" &
  fi
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
  echo "" >&2
  echo "Tip: Set PARADIGM_AUTO_FIX=1 to auto-fix trivial violations (missing .purpose stubs, missing lore)." >&2
  exit 2
fi

# Print advisory even on pass (informational)
if [ -n "$ADVISORY" ]; then
  echo "" >&2
  echo "[paradigm] Advisory:" >&2
  echo "$ADVISORY" >&2
fi

# Auto-demote graduated habits with 3+ failures
# NOTE: Could be absorbed into compliance-check command in a future iteration.
if [ -d ".paradigm/.graduation-failures" ]; then
  for fail_file in .paradigm/.graduation-failures/*; do
    [ -f "$fail_file" ] || continue
    habit_id=$(basename "$fail_file")
    fail_count=$(wc -l < "$fail_file" | tr -d ' ')
    if [ "$fail_count" -ge 3 ]; then
      if command -v paradigm >/dev/null 2>&1; then
        paradigm graduate demote "$habit_id" --cooldown 14 2>/dev/null || true
      fi
      rm -f "$fail_file"
      echo "[paradigm] Auto-demoted '$habit_id' after $fail_count failures." >&2
    fi
  done
fi

# Clean up session markers on pass
rm -f ".paradigm/.pending-review"
rm -f ".paradigm/.habits-blocking"
rm -f ".paradigm/.session-started"
rm -f ".paradigm/.purpose-paths"

exit 0
`;

export const CLAUDE_CODE_POSTWRITE_HOOK = `#!/bin/sh
# Legacy afterFileEdit hook — replaced by paradigm-posttooluse.sh (postToolUse)
# Kept as a no-op because Claude Code expects the file to exist.
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
# Checks 1–11 are defined in paradigm-common.sh (shared with Claude Code hook).

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

# --- Loop guard: prevent infinite retry loops ---
# Cursor's stop hook with loop_limit fires repeatedly. Cap retries at 3.
LOOP_GUARD_FILE=".paradigm/.stop-hook-active"
if [ -f "$LOOP_GUARD_FILE" ]; then
  RETRY_COUNT=$(cat "$LOOP_GUARD_FILE" 2>/dev/null | tr -d '[:space:]')
  RETRY_COUNT=\${RETRY_COUNT:-0}
  if [ "$RETRY_COUNT" -ge 3 ]; then
    # Max retries reached — allow session to end to avoid infinite loop
    echo "[paradigm] Stop hook: max retries (3) reached. Allowing session to end." >&2
    rm -f "$LOOP_GUARD_FILE"
    rm -f ".paradigm/.pending-review"
    rm -f ".paradigm/.habits-blocking"
    exit 0
  fi
  RETRY_COUNT=$((RETRY_COUNT + 1))
  echo "$RETRY_COUNT" > "$LOOP_GUARD_FILE"
else
  echo "1" > "$LOOP_GUARD_FILE"
fi

# Get modified files (uncommitted changes)
MODIFIED=$(git diff --name-only HEAD 2>/dev/null)
if [ -z "$MODIFIED" ]; then
  # Clean up session markers on pass (no modifications)
  rm -f ".paradigm/.pending-review"
  rm -f ".paradigm/.session-started"
  exit 0
fi

# Source shared compliance checks
SCRIPT_DIR=$(dirname "$0")
. "$SCRIPT_DIR/paradigm-common.sh"

# --- Report auto-fixes if any ---
if [ "$AUTO_FIX_COUNT" -gt 0 ]; then
  echo "" >&2
  echo "[paradigm] Auto-fixed $AUTO_FIX_COUNT issue(s):" >&2
  echo "$AUTO_FIXED" >&2
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
  echo "" >&2
  echo "Tip: Set PARADIGM_AUTO_FIX=1 to auto-fix trivial violations (missing .purpose stubs, missing lore)." >&2

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

# Auto-demote graduated habits with 3+ failures
if [ -d ".paradigm/.graduation-failures" ]; then
  for fail_file in .paradigm/.graduation-failures/*; do
    [ -f "$fail_file" ] || continue
    habit_id=$(basename "$fail_file")
    fail_count=$(wc -l < "$fail_file" | tr -d ' ')
    if [ "$fail_count" -ge 3 ]; then
      if command -v paradigm >/dev/null 2>&1; then
        paradigm graduate demote "$habit_id" --cooldown 14 2>/dev/null || true
      fi
      rm -f "$fail_file"
      echo "[paradigm] Auto-demoted '$habit_id' after $fail_count failures." >&2
    fi
  done
fi

# Clean up session markers and loop guard on pass
rm -f ".paradigm/.pending-review"
rm -f ".paradigm/.habits-blocking"
rm -f ".paradigm/.stop-hook-active"
rm -f ".paradigm/.session-started"
rm -f ".paradigm/.purpose-paths"

exit 0
`;

export const CURSOR_POSTWRITE_HOOK = `#!/bin/sh
# Legacy afterFileEdit hook — replaced by paradigm-posttooluse.sh (postToolUse)
# Kept as a no-op because Cursor expects the file to exist.
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

export const CURSOR_PRETOOLUSE_HOOK = `#!/bin/sh
# Paradigm Cursor PreToolUse Hook — Graduated Blocking
# Fires BEFORE the agent calls Edit or Write.
# Uses graduated enforcement based on uncovered source edits.
# Installed by: paradigm hooks install --cursor
#
# Hook type: preToolUse
# Matcher: Edit|Write
# Exit 0 = allow, Exit 2 = block with stderr message
#
# Graduated enforcement:
#   1-2 uncovered edits → silent pass (exit 0)
#   3-4 uncovered edits → warn via stderr (exit 0)
#   5+  uncovered edits → BLOCK (exit 2 + stderr)

# Read JSON from stdin (hook input)
INPUT=$(cat)

# Extract tool_name and file_path from preToolUse input
if command -v jq >/dev/null 2>&1; then
  TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
  FILE_PATH=$(echo "$INPUT" | jq -r '.file_path // .input.file_path // empty' 2>/dev/null)
else
  TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"tool_name"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
  FILE_PATH=$(echo "$INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
fi

# Must have a file path to check
if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Extract workspace root
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

# Convert to relative path
REL_PATH="$FILE_PATH"
case "$FILE_PATH" in
  "$CWD"/*) REL_PATH=$(echo "$FILE_PATH" | sed "s|^$CWD/||") ;;
esac

# If still absolute, file is outside project — skip
case "$REL_PATH" in
  /*) exit 0 ;;
esac

# Skip non-source files (paradigm metadata, docs, config)
case "$REL_PATH" in
  *.purpose|portal.yaml|*.md|*.lock|*.log|*.json|*.yaml|*.yml|.gitignore|.env*) exit 0 ;;
esac

# Skip .paradigm, .claude, and .cursor directories
case "$REL_PATH" in
  .paradigm/*|.claude/*|.cursor/*) exit 0 ;;
esac

# Check if target file has a covering .purpose file
dir=$(dirname "$REL_PATH")
has_purpose=false

while [ "$dir" != "." ] && [ "$dir" != "/" ] && [ "$dir" != "" ]; do
  if [ -f "$dir/.purpose" ]; then
    has_purpose=true
    break
  fi
  dir=$(dirname "$dir")
done

# Check root .purpose
if [ "$has_purpose" = false ] && [ -f ".purpose" ]; then
  has_purpose=true
fi

# If this file already has .purpose coverage, always allow
if [ "$has_purpose" = true ]; then
  exit 0
fi

# Count uncovered source edits from .pending-review
PENDING_FILE=".paradigm/.pending-review"
UNCOVERED_COUNT=0

if [ -f "$PENDING_FILE" ]; then
  while IFS= read -r tracked_file; do
    [ -z "$tracked_file" ] && continue
    # Check if this tracked file has .purpose coverage
    check_dir=$(dirname "$tracked_file")
    found=false
    while [ "$check_dir" != "." ] && [ "$check_dir" != "/" ] && [ "$check_dir" != "" ]; do
      if [ -f "$check_dir/.purpose" ]; then
        found=true
        break
      fi
      check_dir=$(dirname "$check_dir")
    done
    if [ "$found" = false ] && [ -f ".purpose" ]; then
      found=true
    fi
    if [ "$found" = false ]; then
      UNCOVERED_COUNT=$((UNCOVERED_COUNT + 1))
    fi
  done < "$PENDING_FILE"
fi

# Include the current file (not yet tracked)
UNCOVERED_COUNT=$((UNCOVERED_COUNT + 1))

# Graduated enforcement
if [ "$UNCOVERED_COUNT" -le 2 ]; then
  # Silent pass — don't slow down small fixes
  exit 0
elif [ "$UNCOVERED_COUNT" -le 4 ]; then
  # Warn but allow
  echo "" >&2
  echo "[paradigm] Warning: $UNCOVERED_COUNT source files modified without .purpose coverage." >&2
  echo "  Update the nearest .purpose file before the stop hook blocks you." >&2
  echo "  Use: paradigm_purpose_init + paradigm_purpose_add_component" >&2
  exit 0
else
  # Block — too many uncovered edits
  echo "" >&2
  echo "[paradigm] BLOCKED: $UNCOVERED_COUNT source files modified without .purpose coverage." >&2
  echo "  You must update .purpose files before continuing." >&2
  echo "  Steps:" >&2
  echo "    1. paradigm_purpose_init — create .purpose in uncovered directories" >&2
  echo "    2. paradigm_purpose_add_component — register code units" >&2
  echo "    3. paradigm_reindex — rebuild the index" >&2
  echo "  Then retry your edit." >&2
  exit 2
fi
`;

export const CURSOR_POSTTOOLUSE_HOOK = `#!/bin/sh
# Paradigm Cursor PostToolUse Hook — Advisory Feedback
# Fires AFTER the agent calls Edit or Write.
# Tracks modified source files and outputs advisory the agent can see.
# Installed by: paradigm hooks install --cursor
#
# Hook type: postToolUse
# Matcher: Edit|Write
# Exit 0 always (never blocks — advisory only)
#
# Unlike afterFileEdit, postToolUse output is visible to the Cursor agent.
# This is the primary advisory mechanism for Cursor enforcement.

# Read JSON from stdin (hook input)
INPUT=$(cat)

# Extract file_path from postToolUse input
if command -v jq >/dev/null 2>&1; then
  FILE_PATH=$(echo "$INPUT" | jq -r '.file_path // .input.file_path // empty' 2>/dev/null)
else
  FILE_PATH=$(echo "$INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
fi

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Extract workspace root
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

# Pseudo-session-start: first edit of session emits one-time guidance
if [ ! -f ".paradigm/.session-started" ]; then
  PREV_PENDING=$(cat .paradigm/.pending-review 2>/dev/null | wc -l | tr -d ' ')
  if [ "$PREV_PENDING" -gt 0 ] 2>/dev/null; then
    echo "[paradigm] Session started. $PREV_PENDING uncovered edit(s) from last session." >&2
  fi
  touch ".paradigm/.session-started"
fi

# Convert to relative path
REL_PATH="$FILE_PATH"
case "$FILE_PATH" in
  "$CWD"/*) REL_PATH=$(echo "$FILE_PATH" | sed "s|^$CWD/||") ;;
esac

# If still absolute, file is outside project — skip
case "$REL_PATH" in
  /*) exit 0 ;;
esac

# Skip non-source files
case "$REL_PATH" in
  *.purpose|portal.yaml|*.md|*.lock|*.log|*.json|*.yaml|*.yml|.gitignore|.env*) exit 0 ;;
esac

# Skip .paradigm, .claude, and .cursor directories
case "$REL_PATH" in
  .paradigm/*|.claude/*|.cursor/*) exit 0 ;;
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

# Context budget heuristic: suggest handoff check at high edit counts
if [ "$PENDING_COUNT" -ge 30 ]; then
  echo "[paradigm] ~$PENDING_COUNT edits this session. Consider preparing handoff." >&2
fi

exit 0
`;

