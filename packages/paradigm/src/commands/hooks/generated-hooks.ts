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
#  12. Graduation failure tracking (auto-demotion)
#  13. Orchestration required for complex tasks
#  14. Active remediations from agent-authored .paradigm/remediations/ (v6.1)
#  15. Native memory hygiene nudge (advisory only, TD-2026-09-19-110)
#
# Generated-state scope: when every modified file is Paradigm's or Warpline's
# own generated state (.paradigm/*, .warpline/* — the hooks, post-commit and
# MCP tools write these themselves), no code changed, so the checks that need
# code (purpose discovery + anchors, the compliance-check CLI) are skipped.
# .warpline/* is never counted as a source file.

# Per-section timing (#hook-monitor): the Claude Code Stop hook sources
# paradigm-hook-monitor.sh, which records each section's ms to
# .paradigm/events/stop-timing.jsonl. Callers without the monitor (Cursor) get
# no-ops, so every _pm_mark below costs nothing there.
command -v _pm_mark >/dev/null 2>&1 || _pm_mark() { :; }
command -v _pm_count >/dev/null 2>&1 || _pm_count() { :; }

VIOLATIONS=""
VIOLATION_COUNT=0
AUTO_FIXED=""
AUTO_FIX_COUNT=0
PARADIGM_AUTO_FIX="\${PARADIGM_AUTO_FIX:-0}"

# --- Scope: only Paradigm's own generated state modified? ---
# .paradigm/* (events, indexes, history, lore, curriculum) and .warpline/*
# (fabric, refs) are rewritten by the hooks, post-commit and MCP tools on every
# turn, so \`git diff\` is almost never empty. When nothing else changed there is
# no code to check: the expensive, code-driven steps below are skipped. Cheap
# state checks (remediations, purpose-required patterns, memory) still run.
PARADIGM_GENERATED_ONLY=true
_MODIFIED_COUNT=0
for file in $MODIFIED; do
  _MODIFIED_COUNT=$((_MODIFIED_COUNT + 1))
  case "$file" in
    .paradigm/*|.warpline/*) ;;
    *) PARADIGM_GENERATED_ONLY=false ;;
  esac
done
# An empty list is not "generated only": callers that reach here with nothing
# modified (the Claude Code hook exits before sourcing) keep the full pass.
[ "$_MODIFIED_COUNT" -eq 0 ] && PARADIGM_GENERATED_ONLY=false
_pm_count modified "$_MODIFIED_COUNT"
[ "$PARADIGM_GENERATED_ONLY" = "true" ] && _pm_count generated_only 1

_pm_mark cli-resolve
# --- Resolve the paradigm CLI once (fail-closed on absence) ---
# Every compliance check below runs through $PARADIGM_BIN. If NO real paradigm
# CLI is resolvable, treat this as UNAVAILABLE (never a clean pass) and warn
# loudly. The npx branch uses \`--no-install\` so npx never auto-installs the
# unrelated public 'paradigm' registry package as a false positive.
PARADIGM_BIN=""
PARADIGM_AVAILABLE=false
if command -v paradigm >/dev/null 2>&1; then
  PARADIGM_BIN="paradigm"
  PARADIGM_AVAILABLE=true
elif command -v npx >/dev/null 2>&1 && npx --no-install paradigm --version >/dev/null 2>&1; then
  PARADIGM_BIN="npx --no-install paradigm"
  PARADIGM_AVAILABLE=true
fi

if [ "$PARADIGM_AVAILABLE" != "true" ]; then
  printf '%s\\n' "[paradigm] WARNING: paradigm CLI not found — compliance checks were SKIPPED, this is NOT a clean pass. Install with 'npm i -g @a-company/paradigm' or add it as a devDependency." >&2
fi

_pm_mark enforcement-resolve
# --- Load enforcement config ---
ENFORCEMENT_MAP=""
if [ "$PARADIGM_AVAILABLE" = "true" ]; then
  ENFORCEMENT_MAP=$($PARADIGM_BIN enforcement resolve --json 2>/dev/null) || true
fi
# Normalise to compact JSON ONCE: drop every whitespace character that sits
# outside a string literal (escapes inside strings respected). The CLI prints
# pretty JSON (\`"id": "value"\`); the lookups below match the compact
# \`"id":"value"\` form, so without this every configured severity was silently
# ignored and each check ran at its hard-coded default.
if [ -n "$ENFORCEMENT_MAP" ]; then
  ENFORCEMENT_MAP=$(printf '%s\\n' "$ENFORCEMENT_MAP" | awk '
    BEGIN { ins = 0; esc = 0; out = "" }
    {
      line = $0
      for (i = 1; i <= length(line); i++) {
        c = substr(line, i, 1)
        if (ins) {
          out = out c
          if (esc) esc = 0
          else if (c == "\\\\") esc = 1
          else if (c == "\\"") ins = 0
        } else if (c == "\\"") { ins = 1; out = out c }
        else if (c != " " && c != "\\t" && c != "\\r") out = out c
      }
    }
    END { print out }')
fi

# Helper: get severity for a check ID
_check_severity() {
  _id="$1"
  _default="$2"
  if [ -z "$ENFORCEMENT_MAP" ]; then
    echo "$_default"
    return
  fi
  _val=$(echo "$ENFORCEMENT_MAP" | grep -o "\\"$_id\\":\\"[^\\"]*\\"" | sed 's/.*":\\"//' | sed 's/"//')
  if [ -n "$_val" ]; then
    echo "$_val"
  else
    echo "$_default"
  fi
}

# Read orchestration threshold
ORCH_THRESHOLD=3
if [ -n "$ENFORCEMENT_MAP" ]; then
  _ot=$(echo "$ENFORCEMENT_MAP" | grep -o '"orchestrationThreshold":[0-9]*' | sed 's/.*://')
  [ -n "$_ot" ] && ORCH_THRESHOLD="$_ot"
fi

_pm_mark roster
# --- Missing-CLI enforcement (fail-closed) ---
# When no paradigm CLI is resolvable, none of the compliance checks below can
# run — a missing tool is NOT a clean pass. Record a blocking violation by
# default, honoring the same 'portal-compliance' severity knob used for a failed
# compliance-check run. Only an explicit 'off' fully suppresses it; anything
# else downgrades to a non-blocking advisory. (With the CLI absent the
# ENFORCEMENT_MAP is empty, so _check_severity returns the 'block' default.)
if [ "$PARADIGM_AVAILABLE" != "true" ]; then
  _SEV_PARADIGM_MISSING=$(_check_severity "portal-compliance" "block")
  if [ "$_SEV_PARADIGM_MISSING" = "block" ]; then
    VIOLATIONS="$VIOLATIONS
  - paradigm CLI not found — compliance checks were SKIPPED (NOT a clean pass).
    Install with 'npm i -g @a-company/paradigm' or add it as a devDependency."
    VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
  elif [ "$_SEV_PARADIGM_MISSING" != "off" ]; then
    ADVISORY="$ADVISORY
  - (warn) paradigm CLI not found — compliance checks were SKIPPED (NOT a clean pass)."
  fi
fi

# --- Detect compliance archetype on roster (v6.0.4) ---
# Sets HAS_COMPLIANCE_CLAIMANT=true iff .paradigm/roster.yaml has 'compliance'
# under its 'active:' list (block- or inline-array form). Falls back to false on
# missing/unparseable. Wave 1: helper only — no callers yet (Wave 2 wires Check
# 6 and Check 10 to consume this gate).
HAS_COMPLIANCE_CLAIMANT=false
_ROSTER_FILE=".paradigm/roster.yaml"
if [ -f "$_ROSTER_FILE" ]; then
  # Extract the 'active:' section: from 'active:' line until the next non-indented
  # top-level key, then look for 'compliance' as a list item or array entry.
  _ACTIVE_BLOCK=$(awk '/^active:/{flag=1; print; next} /^[A-Za-z]/{flag=0} flag' "$_ROSTER_FILE" 2>/dev/null)
  if echo "$_ACTIVE_BLOCK" | grep -Eq '(^[[:space:]]*-[[:space:]]*compliance[[:space:]]*$|[[\\,[:space:]]compliance[\\],[:space:]])'; then
    HAS_COMPLIANCE_CLAIMANT=true
  fi
fi

_pm_mark remediations-fetch
# --- Cache active remediations JSON (v6.1, consumed by Check 14) ---
# Single shell-out per stop-hook run. Helper outputs \`[]\` on every error path
# (missing dir, parse failure, missing binary) so this never breaks the hook.
_REMEDIATIONS_JSON="[]"
if [ "$PARADIGM_AVAILABLE" = "true" ]; then
  _REMEDIATIONS_JSON=$($PARADIGM_BIN internal active-remediations --json 2>/dev/null) || _REMEDIATIONS_JSON="[]"
  [ -z "$_REMEDIATIONS_JSON" ] && _REMEDIATIONS_JSON="[]"
fi

# --- Helpers that avoid a fork per call (hot loops below) ---
# Every $(dirname ...) / $(echo | grep) costs a subshell plus a process. On a
# repo with many modified files those forks alone eat seconds of the Stop
# hook's 30 s budget, so the hot loops use these builtin-only helpers.
_NL='
'
# _parent <path> — sets _PD to dirname(<path>) without forking.
_parent() {
  case "$1" in
    */*) _PD=\${1%/*}; [ -z "$_PD" ] && _PD=/ ;;
    *) _PD=. ;;
  esac
}
# _is_modified <path> — true iff <path> is a whole line of $MODIFIED.
_is_modified() {
  case "$_NL$MODIFIED$_NL" in
    *"$_NL$1$_NL"*) return 0 ;;
  esac
  return 1
}

_pm_mark purpose-discovery
# --- Discover .purpose files (fresh every run, never a persisted cache) ---
# Ask git, not find: \`git ls-files\` lists tracked + untracked-not-ignored files
# in milliseconds and does NOT descend into nested repositories — in particular
# Claude Code agent worktrees under .claude/worktrees/, each a full copy of the
# repo. The old \`find . -not -path "*/node_modules/*"\` walked every one of them
# (and every node_modules, since -not -path filters but does not prune), which
# on a repo with 16 agent worktrees found 2,195 .purpose files in 6 s and made
# Check 4 below take 30 s — the whole Stop hook timeout, so Claude Code killed
# the hook on every turn. The old .paradigm/.purpose-paths cache is no longer
# read: it was only cleared on a passing run, so a killed or blocked run left a
# stale list behind forever. Outside git (not reachable from the Stop hook,
# which needs \`git diff\`), fall back to a find that PRUNES those trees.
# Generated-state scope: no code changed, so no anchor can have broken (a
# deleted source file is itself a non-generated change) — skip discovery, which
# also turns Checks 4 and 6 into no-ops.
PURPOSE_PATHS=""
if [ "$PARADIGM_GENERATED_ONLY" != "true" ]; then
  PURPOSE_PATHS=$(git ls-files -co --exclude-standard 2>/dev/null | grep -E '(^|/)\\.purpose$' | sed 's|^|./|')
  if [ -z "$PURPOSE_PATHS" ] && ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    PURPOSE_PATHS=$(find . \\( -name node_modules -o -name .git -o -path ./.claude/worktrees \\) -prune -o -name ".purpose" -type f -print 2>/dev/null)
  fi
fi
_pm_nwords() { _PM_NW=$#; }
_pm_nwords $PURPOSE_PATHS
_pm_count purpose_files "$_PM_NW"

_pm_mark check1-purpose-coverage
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
    .warpline/*|*.md|*.lock|*.log|.gitignore|.env*|*.json) ;;
    *)
      SOURCE_COUNT=$((SOURCE_COUNT + 1))
      # Check if this file's directory has a covering .purpose that was modified
      _parent "$file"; src_dir=$_PD
      covering=""
      walk_dir="$src_dir"
      while [ "$walk_dir" != "." ] && [ "$walk_dir" != "" ] && [ "$walk_dir" != "/" ]; do
        if [ -f "$walk_dir/.purpose" ]; then
          covering="$walk_dir/.purpose"
          break
        fi
        _parent "$walk_dir"; walk_dir=$_PD
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

_pm_count source "$SOURCE_COUNT"
# Only flag if there are uncovered directories AND zero paradigm files were touched
_SEV=$(_check_severity "purpose-coverage" "block")
if [ "$_SEV" != "off" ] && [ -n "$UNCOVERED_SOURCE_DIRS" ] && [ "$PARADIGM_COUNT" -eq 0 ]; then
  # Count uncovered dirs
  UNCOVERED_DIR_COUNT=0
  for _d in $UNCOVERED_SOURCE_DIRS; do
    UNCOVERED_DIR_COUNT=$((UNCOVERED_DIR_COUNT + 1))
  done
  if [ "$_SEV" = "block" ]; then
    VIOLATIONS="$VIOLATIONS
  - You modified source files in $UNCOVERED_DIR_COUNT director(ies) without updating their .purpose files:
   $UNCOVERED_SOURCE_DIRS
    Update the nearest .purpose file for each modified code area."
    VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
  else
    ADVISORY="$ADVISORY
  - (warn) Source files in $UNCOVERED_DIR_COUNT director(ies) modified without .purpose updates:
   $UNCOVERED_SOURCE_DIRS"
  fi
fi

_pm_mark check2-purpose-exists
# --- Check 2: Modified source directories missing .purpose files ---
DIRS_WITHOUT_PURPOSE=""

for file in $MODIFIED; do
  case "$file" in
    .paradigm/*|.warpline/*|*.md|*.lock|*.log|.gitignore|.env*|*.json|*.purpose|portal.yaml) continue ;;
  esac

  _parent "$file"; dir=$_PD
  # Walk up to find a .purpose file
  found_purpose=false
  check_dir="$dir"
  while [ "$check_dir" != "." ] && [ "$check_dir" != "" ] && [ "$check_dir" != "/" ]; do
    if [ -f "$check_dir/.purpose" ]; then
      found_purpose=true
      break
    fi
    _parent "$check_dir"; check_dir=$_PD
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

_SEV=$(_check_severity "purpose-exists" "block")
if [ "$_SEV" != "off" ] && [ -n "$DIRS_WITHOUT_PURPOSE" ]; then
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
  elif [ "$_SEV" = "block" ]; then
    VIOLATIONS="$VIOLATIONS
  - These directories have modified source files but no .purpose file anywhere in their path:
   $DIRS_WITHOUT_PURPOSE
    Create a .purpose file using paradigm_purpose (op: init) + paradigm_purpose (op: add_component)."
    VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
  else
    ADVISORY="$ADVISORY
  - (warn) Directories with modified source files but no .purpose file:
   $DIRS_WITHOUT_PURPOSE"
  fi
fi

_pm_mark check3-portal-routes
# --- Check 3: Route patterns added without portal.yaml ---
_SEV=$(_check_severity "portal-gates" "block")
if [ "$_SEV" != "off" ]; then
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
      if [ "$_SEV" = "block" ]; then
        VIOLATIONS="$VIOLATIONS
  - Route/endpoint patterns found in modified files but no portal.yaml exists:
   $ROUTE_FILES
    Create portal.yaml with gate definitions. Use paradigm_gates_for_route for suggestions."
        VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
      else
        ADVISORY="$ADVISORY
  - (warn) Route/endpoint patterns found without portal.yaml:
   $ROUTE_FILES"
      fi
    fi
  fi
fi

_pm_mark check4-aspect-anchors
# --- Check 4: Aspect anchor files that no longer exist ---
_SEV=$(_check_severity "aspect-anchors" "block")
if [ "$_SEV" != "off" ] && [ -n "$PURPOSE_PATHS" ]; then
  # ONE awk pass extracts every (purpose file, anchor) pair; the shell then only
  # runs builtin \`[ -f ]\` tests. The old loop forked echo|sed|sed|tr for every
  # anchor line — 10,817 lines x 4 processes = 30 s on a large repo.
  # Extraction rules are unchanged: a line containing "anchors:" opens an
  # anchor list; a line containing "- " inside it is an anchor (text after the
  # LAST "- ", cut at the first ":", spaces removed); any other line closes it.
  _ANCHOR_PAIRS=$(awk '
    FNR == 1 { in_a = 0 }
    index($0, "anchors:") { in_a = 1; next }
    index($0, "- ") {
      if (in_a) {
        a = $0; sub(/.*- /, "", a); sub(/:.*/, "", a); gsub(/ /, "", a)
        if (a != "") print FILENAME "\\t" a
      }
      next
    }
    { in_a = 0 }
  ' $PURPOSE_PATHS 2>/dev/null)
  _TAB=$(printf '\\t')
  _ANCHOR_N=0
  while IFS="$_TAB" read -r purpose_file anchor_path; do
    [ -n "$anchor_path" ] || continue
    _ANCHOR_N=$((_ANCHOR_N + 1))
    _parent "$purpose_file"; purpose_dir=$_PD
    # Try relative to .purpose dir first, then project root
    if [ ! -f "$purpose_dir/$anchor_path" ] && [ ! -f "./$anchor_path" ]; then
      if [ "$_SEV" = "block" ]; then
        VIOLATIONS="$VIOLATIONS
  - Aspect anchor '$anchor_path' in $purpose_file does not exist.
    Update the anchor or remove the stale aspect."
        VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
      else
        ADVISORY="$ADVISORY
  - (warn) Aspect anchor '$anchor_path' in $purpose_file does not exist."
      fi
    fi
  done <<ANCHOREOF
$_ANCHOR_PAIRS
ANCHOREOF
  _pm_count anchors "$_ANCHOR_N"
fi

_pm_mark check5-purpose-freshness
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
  _PENDING_N=0
  while IFS= read -r tracked_file; do
    [ -z "$tracked_file" ] && continue
    _PENDING_N=$((_PENDING_N + 1))
    # Find covering .purpose for this tracked file
    _parent "$tracked_file"; check_dir=$_PD
    covering_purpose=""
    while [ "$check_dir" != "." ] && [ "$check_dir" != "" ] && [ "$check_dir" != "/" ]; do
      if [ -f "$check_dir/.purpose" ]; then
        covering_purpose="$check_dir/.purpose"
        break
      fi
      _parent "$check_dir"; check_dir=$_PD
    done
    if [ -z "$covering_purpose" ] && [ -f ".purpose" ]; then
      covering_purpose=".purpose"
    fi
    # Check if covering .purpose was also modified
    if [ -n "$covering_purpose" ]; then
      if ! _is_modified "$covering_purpose"; then
        _record_stale_purpose "$covering_purpose"
      fi
    fi
  done < "$PENDING_FILE"
  _pm_count pending_review "$_PENDING_N"
fi

# Strategy B: Git-based fallback — for each modified source file, check whether
# its covering .purpose was modified more recently (by filesystem mtime).
# This catches cases where .pending-review is missing or out of sync.
for file in $MODIFIED; do
  case "$file" in
    .paradigm/*|.warpline/*|*.md|*.lock|*.log|.gitignore|.env*|*.json|*.purpose|portal.yaml) continue ;;
  esac
  [ -f "$file" ] || continue

  # Find covering .purpose
  _parent "$file"; check_dir=$_PD
  covering_purpose=""
  while [ "$check_dir" != "." ] && [ "$check_dir" != "" ] && [ "$check_dir" != "/" ]; do
    if [ -f "$check_dir/.purpose" ]; then
      covering_purpose="$check_dir/.purpose"
      break
    fi
    _parent "$check_dir"; check_dir=$_PD
  done
  if [ -z "$covering_purpose" ] && [ -f ".purpose" ]; then
    covering_purpose=".purpose"
  fi
  [ -n "$covering_purpose" ] || continue

  # Skip if .purpose was in the modified list (already updated this session)
  _is_modified "$covering_purpose" && continue

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

_SEV=$(_check_severity "purpose-freshness" "warn")
if [ "$_SEV" != "off" ] && [ -n "$STALE_PURPOSES" ]; then
  if [ "$_SEV" = "block" ]; then
    VIOLATIONS="$VIOLATIONS
  - These .purpose files cover modified source code but were NOT updated:
   $STALE_PURPOSES
    Update each with: #components, ~aspects (with anchors), !signals, \\$flows, ^gates."
    VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
  else
    ADVISORY="$ADVISORY
  - (warn) These .purpose files cover modified source code but were NOT updated:
   $STALE_PURPOSES"
  fi
fi

_pm_mark check6-aspect-advisory
# --- Check 6: Aspect coverage advisory ---
ADVISORY=""
_SEV=$(_check_severity "aspect-advisory" "warn")
if [ "$_SEV" != "off" ]; then
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

    # v6.0.4: emit only when a compliance archetype is rostered (Rune owns aspect
    # advisories). Detection above runs unconditionally for data-continuity
    # symmetry with Check 10; only the user-facing emission is gated.
    if [ "$ASPECT_UPDATED" = false ] && [ "$HAS_COMPLIANCE_CLAIMANT" = "true" ]; then
      ADVISORY="  This project defines ~aspects with code anchors. Check if existing
  ~aspects need updated anchors or applies-to patterns."
    fi
  fi
fi

_pm_mark check7-lore
# --- Check 7: Lore entry expected for significant sessions ---
_SEV=$(_check_severity "lore-required" "block")
if [ "$_SEV" != "off" ] && [ "$SOURCE_COUNT" -ge 3 ] && [ -d ".paradigm/lore" ]; then
  LORE_RECORDED=false

  # Check git diff first (covers staged/committed lore)
  for file in $MODIFIED; do
    case "$file" in
      .paradigm/lore/entries/*.yaml|.paradigm/lore/entries/*/*.yaml|.paradigm/lore/entries/*.lore|.paradigm/lore/entries/*/*.lore)
        LORE_RECORDED=true
        break
        ;;
    esac
  done

  # Also check for recent lore on disk (covers MCP-written entries not yet staged)
  if [ "$LORE_RECORDED" = false ]; then
    TODAY=$(date -u +"%Y-%m-%d")
    if [ -d ".paradigm/lore/entries/$TODAY" ]; then
      ENTRY_COUNT=$(find ".paradigm/lore/entries/$TODAY" \\( -name "*.yaml" -o -name "*.lore" \\) 2>/dev/null | head -1)
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
          .paradigm/*|.warpline/*|*.md|*.lock|*.log|.gitignore|.env*|*.json|*.purpose|portal.yaml) continue ;;
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
    elif [ "$_SEV" = "block" ]; then
      VIOLATIONS="$VIOLATIONS
  - You modified $SOURCE_COUNT source files but recorded no lore entry.
    Record your session: paradigm_lore (op: record) (MCP) or paradigm lore record (CLI).
    Include: type, title, summary, and symbols_touched."
      VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
    else
      ADVISORY="$ADVISORY
  - (warn) $SOURCE_COUNT source files modified without a lore entry."
    fi
  fi
fi

_pm_mark compliance-check-cli
# --- Checks 8, 10, 11: Unified compliance check (single Node.js process) ---
# Replaces 3 separate subprocess calls (habits check, drift check, portal check)
# with a single \`paradigm compliance-check\` invocation.
#
# v5.37.12 fail-closed fix (security audit 2026-04-22, Scenario D):
# the prior \`|| true\` swallowed non-zero exits, which masked every upstream
# failure mode (missing binary, corrupt index, uncaught exception on malformed
# portal.yaml). On non-zero exit we now record the exit code and block with
# an explicit "compliance check failed to run" violation — never silently
# fall through to the habits-only branch.
COMPLIANCE_RESULT=""
COMPLIANCE_EXIT=0
if [ "$PARADIGM_GENERATED_ONLY" = "true" ]; then
  # Generated-state scope: habits, drift, portal gates and postflight learning
  # all read code changes; none happened. The next turn that changes code runs
  # the full pass (pending verdicts wait in their durable store until then).
  :
elif [ "$PARADIGM_AVAILABLE" = "true" ]; then
  COMPLIANCE_RESULT=$($PARADIGM_BIN compliance-check --json --auto-heal --learn --trigger on-stop 2>/dev/null)
  COMPLIANCE_EXIT=$?
else
  # No binary available at all — mark as unavailable, not as silent success.
  # (The npx-degrade branch is gone: it masked "not installed" as a run. The
  # loud missing-CLI banner + fail-closed violation are emitted upfront.)
  COMPLIANCE_EXIT=127
fi

# Fail-closed: non-zero exit MUST block the stop hook. The prior behavior
# silently dropped this signal via \`|| true\`.
# Only fires when the CLI is PRESENT (catches a present-but-crashing CLI). The
# absent-CLI case is already reported once, with an actionable install hint, by
# the upfront missing-CLI enforcement block above — gating on PARADIGM_AVAILABLE
# here avoids a redundant, misleading "run paradigm compliance-check manually"
# violation when the CLI does not exist to run.
_SEV_COMPLIANCE_RUN=$(_check_severity "portal-compliance" "block")
if [ "$PARADIGM_AVAILABLE" = "true" ] && [ "$COMPLIANCE_EXIT" -ne 0 ] && [ "$_SEV_COMPLIANCE_RUN" != "off" ]; then
  if [ "$_SEV_COMPLIANCE_RUN" = "block" ]; then
    VIOLATIONS="$VIOLATIONS
  - paradigm compliance-check failed to run (exit $COMPLIANCE_EXIT).
    Refusing to complete session. Run 'paradigm compliance-check' manually
    to see the error. If portal.yaml is malformed, run 'paradigm doctor'."
    VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
  else
    ADVISORY="$ADVISORY
  - (warn) paradigm compliance-check failed to run (exit $COMPLIANCE_EXIT)."
  fi
fi

if [ -n "$COMPLIANCE_RESULT" ]; then
  # --- Check 8: Blocking habits (from unified result) ---
  _SEV=$(_check_severity "habits-blocking" "block")
  if [ "$_SEV" != "off" ] && [ -f ".paradigm/.habits-blocking" ]; then
    HABITS_BLOCKING=$(cat ".paradigm/.habits-blocking")
    if [ "$_SEV" = "block" ]; then
      VIOLATIONS="$VIOLATIONS
  - Blocking habit(s) not satisfied:
    $HABITS_BLOCKING
    Fix: satisfy the habit(s), or change severity to 'warn' in .paradigm/habits.yaml to make advisory."
      VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
    else
      ADVISORY="$ADVISORY
  - (warn) Blocking habit(s) not satisfied: $HABITS_BLOCKING"
    fi
  fi

  # --- Check 10: Aspect drift (from unified result) ---
  _SEV=$(_check_severity "drift-detection" "block")
  DRIFTED_COUNT=$(echo "$COMPLIANCE_RESULT" | grep -o '"driftedCount":[0-9]*' | sed 's/.*://')
  HEALED_COUNT=$(echo "$COMPLIANCE_RESULT" | grep -o '"healedCount":[0-9]*' | sed 's/.*://')

  if [ -n "$HEALED_COUNT" ] && [ "$HEALED_COUNT" -gt 0 ] 2>/dev/null; then
    echo "[paradigm] Auto-healed $HEALED_COUNT shifted anchor(s)." >&2
  fi

  # v6.0.4: drift emission gated on compliance archetype being rostered (Rune
  # owns aspect-drift policy). DRIFTED_COUNT compute above stays unconditional
  # so it still flows to compliance-history.jsonl for Loid's data continuity.
  # NOTE: gate placement matters — invocation (lines ~538-547) and the
  # v5.37.12 fail-closed audit fix (lines ~549-563) MUST stay outside this
  # guard. Only the user-facing emission is gated.
  if [ "$HAS_COMPLIANCE_CLAIMANT" = "true" ] && [ "$_SEV" != "off" ] && [ -n "$DRIFTED_COUNT" ] && [ "$DRIFTED_COUNT" -gt 0 ] 2>/dev/null; then
    if [ "$_SEV" = "block" ]; then
      VIOLATIONS="$VIOLATIONS
  - $DRIFTED_COUNT aspect anchor(s) have drifted (content genuinely changed).
    Run paradigm_aspect (op: check) to review. Update anchors in .purpose files."
      VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
    else
      ADVISORY="$ADVISORY
  - (warn) $DRIFTED_COUNT aspect anchor(s) have drifted."
    fi
  fi

  # --- Check 11: Portal gate compliance (from unified result) ---
  _SEV=$(_check_severity "portal-compliance" "block")
  UNDECLARED=$(echo "$COMPLIANCE_RESULT" | grep -o '"usedButUndeclaredCount":[0-9]*' | sed 's/.*://')

  # v5.37.12: detect unparseable-portal sentinel (classifier, not a gate name).
  # checkPortalCompliance emits \`__portal_unparseable__\` in usedButUndeclared
  # to force a block when portal.yaml fails to parse. We never render the
  # sentinel or the raw YAMLException to the user — only a redacted class.
  PORTAL_ERR_CLASS=$(echo "$COMPLIANCE_RESULT" | grep -o '"errorClass":"[^"]*"' | head -1 | sed 's/.*"errorClass":"\\([^"]*\\)".*/\\1/')

  if [ "$_SEV" != "off" ] && [ -n "$UNDECLARED" ] && [ "$UNDECLARED" -gt 0 ] 2>/dev/null; then
    UNDECLARED_LIST=$(echo "$COMPLIANCE_RESULT" | grep -o '"usedButUndeclared":\\[[^]]*\\]' | sed 's/.*\\[//;s/\\].*//;s/"//g')
    # Strip the unparseable-portal sentinel from the user-visible list.
    CLEAN_LIST=$(echo "$UNDECLARED_LIST" | sed 's/__portal_unparseable__,//g; s/,__portal_unparseable__//g; s/__portal_unparseable__//g')

    if echo "$UNDECLARED_LIST" | grep -q '__portal_unparseable__'; then
      # Portal unparseable path — redacted message, classifier only.
      if [ "$_SEV" = "block" ]; then
        VIOLATIONS="$VIOLATIONS
  - portal.yaml unparseable\${PORTAL_ERR_CLASS:+ ($PORTAL_ERR_CLASS)}.
    Run 'paradigm doctor' locally for line-specific details.
    Fix the YAML error or run 'paradigm portal check'."
        VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
      else
        ADVISORY="$ADVISORY
  - (warn) portal.yaml unparseable\${PORTAL_ERR_CLASS:+ ($PORTAL_ERR_CLASS)} — run 'paradigm doctor'."
      fi
    elif [ -n "$CLEAN_LIST" ]; then
      # Real undeclared gates — existing behavior.
      if [ "$_SEV" = "block" ]; then
        VIOLATIONS="$VIOLATIONS
  - $UNDECLARED gate(s) used in code but not declared in portal.yaml:
    $CLEAN_LIST
    Add them to portal.yaml or use paradigm_purpose (op: portal_add_gate)."
        VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
      else
        ADVISORY="$ADVISORY
  - (warn) $UNDECLARED gate(s) used in code but not declared in portal.yaml: $CLEAN_LIST"
      fi
    fi
  fi
elif [ "$PARADIGM_GENERATED_ONLY" != "true" ]; then
  # Fallback: check habits blocking marker even if compliance-check unavailable
  _SEV=$(_check_severity "habits-blocking" "block")
  if [ "$_SEV" != "off" ] && [ -f ".paradigm/.habits-blocking" ]; then
    HABITS_BLOCKING=$(cat ".paradigm/.habits-blocking")
    if [ "$_SEV" = "block" ]; then
      VIOLATIONS="$VIOLATIONS
  - Blocking habit(s) not satisfied:
    $HABITS_BLOCKING
    Fix: satisfy the habit(s), or change severity to 'warn' in .paradigm/habits.yaml to make advisory."
      VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
    else
      ADVISORY="$ADVISORY
  - (warn) Blocking habit(s) not satisfied: $HABITS_BLOCKING"
    fi
  fi
fi

_pm_mark check9-required-patterns
# --- Check 9: Purpose-required patterns from config.yaml ---
_SEV=$(_check_severity "purpose-required-patterns" "block")
CONFIG_FILE=".paradigm/config.yaml"
if [ "$_SEV" != "off" ] && [ -f "$CONFIG_FILE" ]; then
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
    elif [ "$_SEV" = "block" ]; then
      VIOLATIONS="$VIOLATIONS
  - These directories match purpose-required patterns but have no .purpose file:
   $MISSING_REQUIRED
    Create .purpose files: paradigm_purpose (op: init) + paradigm_purpose (op: add_component)."
      VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
    else
      ADVISORY="$ADVISORY
  - (warn) Directories matching purpose-required patterns without .purpose file:
   $MISSING_REQUIRED"
    fi
  fi
fi

_pm_mark check12-graduation
# --- Check 12: Graduation failure tracking ---
# When violations occur for graduated habits, record failures for auto-demotion.
_SEV=$(_check_severity "graduation-tracking" "warn")
if [ "$_SEV" != "off" ] && [ "$VIOLATION_COUNT" -gt 0 ] && [ -f ".paradigm/graduation.yaml" ]; then
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
    Run paradigm_graduation (op: status) to review tier changes."
    elif [ "$fail_count" -ge 2 ]; then
      ADVISORY="$ADVISORY
  - Graduated habit '$habit_id' has $fail_count failures (demotion at 3).
    Fix the underlying issue or it will be demoted to habit tier."
    fi
  done
fi

_pm_mark check13-orchestration
# --- Check 13: Orchestration required for complex tasks (magnitude-based) ---
_SEV=$(_check_severity "orchestration-required" "warn")
if [ "$_SEV" != "off" ]; then
  # Compute magnitude score from multiple signals
  MAGNITUDE=0
  MAGNITUDE_REASONS=""

  # Signal 1: Source files modified (1 point each)
  MAGNITUDE=$((MAGNITUDE + SOURCE_COUNT))
  [ "$SOURCE_COUNT" -gt 0 ] && MAGNITUDE_REASONS="$SOURCE_COUNT source files"

  # Signal 2: Cross-package changes (2 points — different packages/ dirs)
  CROSS_PKG_COUNT=0
  SEEN_PKGS=""
  for file in $MODIFIED; do
    case "$file" in
      packages/*)
        _pkg=$(echo "$file" | cut -d'/' -f2)
        case "$SEEN_PKGS" in
          *"|$_pkg|"*) ;;
          *)
            SEEN_PKGS="$SEEN_PKGS|$_pkg|"
            CROSS_PKG_COUNT=$((CROSS_PKG_COUNT + 1))
            ;;
        esac
        ;;
    esac
  done
  if [ "$CROSS_PKG_COUNT" -ge 2 ]; then
    MAGNITUDE=$((MAGNITUDE + 2))
    MAGNITUDE_REASONS="$MAGNITUDE_REASONS, $CROSS_PKG_COUNT packages"
  fi

  # Signal 3: Security-adjacent files (2 points each)
  SEC_ADJACENT=0
  for file in $MODIFIED; do
    case "$file" in
      .paradigm/*|.warpline/*) ;;
      portal.yaml|*/portal.yaml) SEC_ADJACENT=$((SEC_ADJACENT + 1)) ;;
      *auth*|*permission*|*gate*|*security*|*token*|*session*) SEC_ADJACENT=$((SEC_ADJACENT + 1)) ;;
    esac
  done
  if [ "$SEC_ADJACENT" -gt 0 ]; then
    MAGNITUDE=$((MAGNITUDE + SEC_ADJACENT * 2))
    MAGNITUDE_REASONS="$MAGNITUDE_REASONS, $SEC_ADJACENT security-adjacent"
  fi

  # Signal 4: Symbol-bearing files (1 point if .purpose files were changed alongside source)
  SYMBOL_FILES=0
  for file in $MODIFIED; do
    case "$file" in
      *.purpose) SYMBOL_FILES=$((SYMBOL_FILES + 1)) ;;
    esac
  done
  if [ "$SYMBOL_FILES" -ge 2 ]; then
    MAGNITUDE=$((MAGNITUDE + 1))
    MAGNITUDE_REASONS="$MAGNITUDE_REASONS, $SYMBOL_FILES .purpose files"
  fi

  # Compare magnitude against threshold (default 3)
  if [ "$MAGNITUDE" -ge "$ORCH_THRESHOLD" ]; then
    # Gate markers expire by age (Stop fires per assistant turn, so clearing
    # them here would erase declarations mid-session). TTL default 4h.
    _GATE_TTL_MIN=$(( \${PARADIGM_GATE_TTL_HOURS:-4} * 60 ))
    _marker_fresh() {
      [ -f "$1" ] || return 1
      [ -n "$(find "$1" -mmin "-$_GATE_TTL_MIN" 2>/dev/null)" ]
    }
    # A structured solo declaration (paradigm solo <reason>) satisfies the gate —
    # bypass becomes a legible recorded choice instead of silent drift.
    if [ ! -f ".paradigm/.orchestrated" ] && ! _marker_fresh ".paradigm/.solo-declared"; then
      # Record the bypass to the team-funnel telemetry regardless of severity —
      # the invocation-rate metric needs the event even when only warning.
      # Deduped per TTL window: Stop fires per turn, and per-turn duplicates
      # would structurally deflate the invocation rate Loid calibrates from.
      if ! _marker_fresh ".paradigm/.team-bypass-recorded"; then
        mkdir -p ".paradigm/events" 2>/dev/null
        _BYPASS_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
        _BYPASS_REASONS=$(printf '%s' "$MAGNITUDE_REASONS" | tr -cd 'a-zA-Z0-9,. ' | head -c 120)
        echo "{\\"timestamp\\":\\"$_BYPASS_TS\\",\\"type\\":\\"bypass\\",\\"source\\":\\"stop-hook\\",\\"magnitude\\":$MAGNITUDE,\\"reasons\\":\\"$_BYPASS_REASONS\\",\\"severity\\":\\"$_SEV\\"}" >> ".paradigm/events/team-funnel.jsonl" 2>/dev/null
        touch ".paradigm/.team-bypass-recorded" 2>/dev/null
      fi

      if [ "$_SEV" = "block" ]; then
        VIOLATIONS="$VIOLATIONS
  - Task magnitude $MAGNITUDE >= $ORCH_THRESHOLD without orchestration ($MAGNITUDE_REASONS).
    Run paradigm_orchestrate_inline mode=\\"quick\\" for fast pre-check.
    Or declare solo explicitly: paradigm solo <trivial|hotfix|user-directed|exploratory>
    Override: paradigm enforcement override orchestration-required warn"
        VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
      else
        ADVISORY="$ADVISORY
  - (orchestration) Magnitude $MAGNITUDE ($MAGNITUDE_REASONS) without team orchestration.
    Bypass recorded to team-funnel telemetry. Next time: orchestrate, or declare \\\`paradigm solo <reason>\\\`."
      fi
    fi
  fi
fi

_pm_mark check14-remediations
# --- Check 14: Active remediations (v6.1 soft-block primitive) ---
# Iterates the cached _REMEDIATIONS_JSON array. severity=guard adds to
# VIOLATIONS (block); advise|auto-author goes to ADVISORY. PARADIGM_OVERRIDE
# (comma-separated id list) skips matching remediations and writes an
# override audit row to .paradigm/events/overrides.jsonl.
#
# Iteration uses a temp file + redirect (NOT pipe) so VIOLATION_COUNT
# increments propagate out of the loop (POSIX subshell-safe — spec §12 #4).
if [ "$_REMEDIATIONS_JSON" != "[]" ] && [ -n "$_REMEDIATIONS_JSON" ]; then
  _RMD_TMP="/tmp/.paradigm-rmds-$$"
  # Split JSON array into one record per line: strip outer brackets, split on \`},{\`.
  echo "$_REMEDIATIONS_JSON" | sed 's/^\\[//; s/\\]$//; s/},{/}\\n{/g' > "$_RMD_TMP"
  _OVERRIDE_LIST=",\${PARADIGM_OVERRIDE:-},"
  while IFS= read -r _line; do
    [ -z "$_line" ] && continue
    case "$_line" in
      *'"id":"'*) ;;
      *) continue ;;
    esac
    _RID=$(echo "$_line" | grep -o '"id":"[^"]*"' | head -1 | sed 's/^"id":"//; s/"$//')
    _RSEV=$(echo "$_line" | grep -o '"severity":"[^"]*"' | head -1 | sed 's/^"severity":"//; s/"$//')
    _RCLAIM=$(echo "$_line" | grep -o '"claimant":"[^"]*"' | head -1 | sed 's/^"claimant":"//; s/"$//')
    _RREASON=$(echo "$_line" | grep -o '"reason":"[^"]*"' | head -1 | sed 's/^"reason":"//; s/"$//')
    [ -z "$_RID" ] && continue

    # PARADIGM_OVERRIDE check — comma-separated list, exact id match.
    case "$_OVERRIDE_LIST" in
      *",$_RID,"*)
        # Write override audit event (mirror compliance-snapshot pattern, line 906).
        _ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date +"%Y-%m-%dT%H:%M:%SZ")
        mkdir -p ".paradigm/events" 2>/dev/null || true
        printf '{"timestamp":"%s","remediation_id":"%s","claimant":"%s","mechanism":"env","unblock_predicate_matched":false}\\n' \\
          "$_ts" "$_RID" "$_RCLAIM" >> ".paradigm/events/overrides.jsonl" 2>/dev/null || true
        continue
        ;;
    esac

    case "$_RSEV" in
      guard)
        VIOLATIONS="$VIOLATIONS
  - [$_RID] ($_RCLAIM) $_RREASON
    Override: paradigm override $_RID  (or PARADIGM_OVERRIDE=$_RID <cmd>)"
        VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
        ;;
      advise|auto-author)
        ADVISORY="$ADVISORY
  - (remediation:$_RSEV) [$_RID] ($_RCLAIM) $_RREASON"
        ;;
    esac
  done < "$_RMD_TMP"
  rm -f "$_RMD_TMP"
fi

_pm_mark check15-memory
# --- Check 15: Native memory hygiene nudge (advisory only, TD-2026-09-19-110) ---
# Cheap O(1)/O(entries) heuristic that nudges \`paradigm memory review\` when the
# native Claude Code memory store looks due for curation. This block is
# ADVISORY ONLY — it appends AT MOST ONE line to ADVISORY and NEVER touches
# VIOLATIONS / VIOLATION_COUNT, so it can never block a Stop.
#
# FAIL-OPEN on EVERYTHING (mirrors the _REMEDIATIONS_JSON="[]" discipline above):
# empty $HOME, missing memory dir, a stat/find/date that errors, or any slug
# surprise → emit NOTHING, never error. NO LLM, NO scan, NO file-content reads —
# only filesystem metadata (byte size, entry count, stamp mtime). On the common
# path (no threshold crossed) it emits nothing, adding zero tokens.
#
# Native memory lives OUTSIDE the repo at:
#   $HOME/.claude/projects/<slug>/memory/
# where <slug> = the absolute repo path ($CWD) with every '/' replaced by '-'.
#
# Tunable thresholds (edit these four vars to retune the nudge cadence):
_MEM_MAX_ENTRIES=25    # nudge if memory/*.md count (excl. MEMORY.md) exceeds this
_MEM_MAX_BYTES=32768   # nudge if MEMORY.md byte size exceeds this (32 KiB)
_MEM_MAX_DAYS=30       # nudge if days-since-review exceeds this
_MEM_NEVER_ENTRIES=15  # if never reviewed, nudge once entry count exceeds this
if [ -n "$HOME" ] && [ -n "$CWD" ]; then
  _mem_slug=$(printf %s "$CWD" | sed 's:/:-:g' 2>/dev/null)
  _MEM_DIR="$HOME/.claude/projects/$_mem_slug/memory"
  if [ -n "$_mem_slug" ] && [ -d "$_MEM_DIR" ]; then
    # Entry count: memory/*.md excluding MEMORY.md (metadata only, O(entries)).
    _mem_entries=$(find "$_MEM_DIR" -maxdepth 1 -type f -name '*.md' ! -name 'MEMORY.md' 2>/dev/null | wc -l | tr -d ' ')
    [ -z "$_mem_entries" ] && _mem_entries=0
    # MEMORY.md byte size — portable stat: BSD/macOS -f%z, GNU -c%s, wc -c fallback.
    _mem_bytes=0
    if [ -f "$_MEM_DIR/MEMORY.md" ]; then
      _mem_bytes=$(stat -f%z "$_MEM_DIR/MEMORY.md" 2>/dev/null || stat -c%s "$_MEM_DIR/MEMORY.md" 2>/dev/null || wc -c < "$_MEM_DIR/MEMORY.md" 2>/dev/null | tr -d ' ')
      [ -z "$_mem_bytes" ] && _mem_bytes=0
    fi
    # Days since review = now - mtime(.paradigm/.memory-last-review). Absent = never.
    _mem_never=1
    _mem_days=0
    if [ -f ".paradigm/.memory-last-review" ]; then
      _mem_never=0
      _mem_mtime=$(stat -f%m ".paradigm/.memory-last-review" 2>/dev/null || stat -c%Y ".paradigm/.memory-last-review" 2>/dev/null)
      _mem_now=$(date +%s 2>/dev/null)
      if [ -n "$_mem_mtime" ] && [ -n "$_mem_now" ] && [ "$_mem_now" -ge "$_mem_mtime" ] 2>/dev/null; then
        _mem_days=$(( (_mem_now - _mem_mtime) / 86400 ))
      fi
    fi
    # Decide — every comparison guarded (2>/dev/null) so a non-numeric surprise
    # simply fails the test rather than erroring out. At most one line emitted.
    _mem_nudge=0
    if [ "$_mem_entries" -gt "$_MEM_MAX_ENTRIES" ] 2>/dev/null; then _mem_nudge=1; fi
    if [ "$_mem_bytes" -gt "$_MEM_MAX_BYTES" ] 2>/dev/null; then _mem_nudge=1; fi
    if [ "$_mem_never" -eq 0 ] && [ "$_mem_days" -gt "$_MEM_MAX_DAYS" ] 2>/dev/null; then _mem_nudge=1; fi
    if [ "$_mem_never" -eq 1 ] && [ "$_mem_entries" -gt "$_MEM_NEVER_ENTRIES" ] 2>/dev/null; then _mem_nudge=1; fi
    if [ "$_mem_nudge" -eq 1 ]; then
      if [ "$_mem_never" -eq 1 ]; then
        _mem_since="never reviewed"
      else
        _mem_since="\${_mem_days}d since review"
      fi
      ADVISORY="$ADVISORY
  - (memory) $_mem_entries entries / $_mem_since — run: paradigm memory review"
    fi
  fi
fi
# --- END Check 15 ---

_pm_mark snapshot
# --- Compliance snapshot (non-fatal, fire-and-forget) ---
# Record this stop-hook run to .paradigm/events/compliance-history.jsonl for trend analysis.
# VIOLATION_COUNT and SOURCE_COUNT are now final at this point.
_compliance_snapshot() {
  _ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date +"%Y-%m-%dT%H:%M:%SZ")
  _checks=$((SOURCE_COUNT + PARADIGM_COUNT))
  [ "$_checks" -eq 0 ] && _checks=1  # Avoid divide-by-zero downstream
  _dir=".paradigm/events"
  mkdir -p "$_dir" 2>/dev/null || return
  printf '{"timestamp":"%s","violations":%d,"warnings":0,"checks":%d}\\n' \\
    "$_ts" "$VIOLATION_COUNT" "$_checks" >> "$_dir/compliance-history.jsonl" 2>/dev/null || true
}
_compliance_snapshot
`;

export const CLAUDE_CODE_STOP_HOOK = `#!/bin/sh
# Paradigm Claude Code Stop Hook (v2)
# Validates paradigm compliance before allowing the agent to finish.
# Installed by: paradigm hooks install --claude-code
#
# Hook type: Stop
# Exit 0 = allow, Exit 2 = block with message
#
# Checks 1–13 are defined in paradigm-common.sh (shared with Cursor hook).

# Read JSON from stdin (hook input)
# Hook self-monitoring (#hook-monitor, fail open): wall time + outcome -> .paradigm/events/hook-timings.jsonl
case "$0" in */*) _PM_DIR=\${0%/*} ;; *) _PM_DIR=. ;; esac
[ -f "$_PM_DIR/paradigm-hook-monitor.sh" ] && . "$_PM_DIR/paradigm-hook-monitor.sh" && _pm_begin Stop 30000 10000
# Per-section timing -> .paradigm/events/stop-timing.jsonl (no-ops without the monitor)
command -v _pm_mark >/dev/null 2>&1 || _pm_mark() { :; }
command -v _pm_count >/dev/null 2>&1 || _pm_count() { :; }

_pm_mark read-input
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
_pm_mark git-diff
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

_pm_mark verdict
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
  # FULLY detached: a background child that inherits the hook's stdout/stderr
  # keeps Claude Code's pipe open, and Claude Code waits for EOF on that pipe —
  # not for this script's exit — until the hook timeout. Never background a
  # command in a hook without </dev/null >/dev/null 2>&1.
  if [ "$PARADIGM_AVAILABLE" = "true" ]; then
    $PARADIGM_BIN event emit --type compliance-violation --source stop-hook --severity error --context "Stop hook: $VIOLATION_COUNT violation(s)" </dev/null >/dev/null 2>&1 &
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
  echo "  1. paradigm_purpose (op: add_component) — register new code units" >&2
  echo "  2. paradigm_purpose (op: add_aspect) — register cross-cutting concerns (with anchors)" >&2
  echo "  3. paradigm_purpose (op: portal_add_route) — register new endpoints with gates" >&2
  echo "  4. paradigm_reindex — rebuild indexes after updates" >&2
  echo "  5. paradigm_lore (op: record) — record session lore entry" >&2
  echo "  6. paradigm_habits (op: check) — evaluate habit compliance" >&2
  echo "" >&2
  echo "Tip: Set PARADIGM_AUTO_FIX=1 to auto-fix trivial violations (missing .purpose stubs, missing lore)." >&2
  echo "Help: See .paradigm/docs/troubleshooting.md for step-by-step resolution guides." >&2
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
      if [ "$PARADIGM_AVAILABLE" = "true" ]; then
        $PARADIGM_BIN graduate demote "$habit_id" --cooldown 14 2>/dev/null || true
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
rm -f ".paradigm/.orchestrated"
# NOTE: .solo-declared / .team-prompted / .team-reminded / .team-bypass-recorded
# are deliberately NOT cleared here — Stop fires per assistant turn, and clearing
# would erase solo declarations mid-session and re-nag every turn. They expire
# by age instead (PARADIGM_GATE_TTL_HOURS, default 4h).

# Postflight learning already ran above: paradigm-common.sh calls
# \`compliance-check --learn\`, which runs the same runPostflightLearning pass in
# the foreground. The old second \`ambient postflight &\` here was a duplicate
# pass, and as a background child holding the hook's stdout open it made
# Claude Code wait for EOF until the hook timeout.

exit 0
`;

export const CLAUDE_CODE_POSTWRITE_HOOK = `#!/bin/sh
# Legacy afterFileEdit hook — replaced by paradigm-posttooluse.sh (postToolUse)
# Kept as a no-op because Claude Code expects the file to exist.
# Hook self-monitoring (#hook-monitor, fail open): wall time + outcome -> .paradigm/events/hook-timings.jsonl
case "$0" in */*) _PM_DIR=\${0%/*} ;; *) _PM_DIR=. ;; esac
[ -f "$_PM_DIR/paradigm-hook-monitor.sh" ] && . "$_PM_DIR/paradigm-hook-monitor.sh" && _pm_begin PostToolUse-Write 10000 2000

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
# Hook self-monitoring (#hook-monitor, fail open): wall time + outcome -> .paradigm/events/hook-timings.jsonl
case "$0" in */*) _PM_DIR=\${0%/*} ;; *) _PM_DIR=. ;; esac
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

# If no .paradigm directory, not a paradigm project
if [ ! -d ".paradigm" ]; then
  exit 0
fi

# Run paradigm index --quiet (the existing CLI command)
if command -v paradigm >/dev/null 2>&1; then
  paradigm index --quiet 2>/dev/null || true
elif command -v npx >/dev/null 2>&1; then
  # --no-install: never let npx fetch the unrelated public "paradigm" package
  # (a network round-trip inside a 15 s hook, and the wrong binary).
  npx --no-install paradigm index --quiet 2>/dev/null || true
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

export const CLAUDE_CODE_NAVIGATE_REMIND_HOOK = `#!/bin/sh
# Paradigm Claude Code PreToolUse — Navigation Reminder
# Fires before Glob/Grep tool calls to inject scan-index context and prompt
# paradigm_navigate usage before broad file searches.
# Installed by: paradigm hooks install --claude-code
#
# Hook type: PreToolUse (matcher: Glob|Grep)
# Exit 0 = always allows (advisory only — never blocks)
#
# Advisory model: lightweight context injection that fires once per session.
# Unlike a pure text reminder, this reads the scan-index $meta and surfaces
# the symbol counts directly — agents can act on the context immediately
# without a separate tool call.
# Uses a session marker (.paradigm/.nav-reminded) to fire at most once.

# Read JSON from stdin (hook input)
# Hook self-monitoring (#hook-monitor, fail open): wall time + outcome -> .paradigm/events/hook-timings.jsonl
case "$0" in */*) _PM_DIR=\${0%/*} ;; *) _PM_DIR=. ;; esac
[ -f "$_PM_DIR/paradigm-hook-monitor.sh" ] && . "$_PM_DIR/paradigm-hook-monitor.sh" && _pm_begin PreToolUse-Glob 5000 2000

INPUT=$(cat)

# Extract cwd from input
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

# Only remind once per session
MARKER="$CWD/.paradigm/.nav-reminded"
if [ -f "$MARKER" ]; then
  exit 0
fi

# Extract tool name to check we're in a search/read context
if command -v jq >/dev/null 2>&1; then
  TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
else
  TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"tool_name"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
fi

# Only fire for broad exploration tools (Glob/Grep) — not targeted Read calls
case "$TOOL_NAME" in
  Glob|Grep) ;;
  *) exit 0 ;;
esac

# Mark as reminded so this only fires once per session
touch "$MARKER" 2>/dev/null

# Read scan-index $meta for symbol counts (optional — graceful fallback)
SCAN_INDEX="$CWD/.paradigm/scan-index.json"
SYMBOL_SUMMARY=""
if [ -f "$SCAN_INDEX" ] && command -v jq >/dev/null 2>&1; then
  COMP_COUNT=$(jq '(.components // {}) | length' "$SCAN_INDEX" 2>/dev/null)
  FEAT_COUNT=$(jq '(.features // {}) | length' "$SCAN_INDEX" 2>/dev/null)
  FLOW_COUNT=$(jq '(.flows // {}) | length' "$SCAN_INDEX" 2>/dev/null)
  GATE_COUNT=$(jq '(.gates // {}) | length' "$SCAN_INDEX" 2>/dev/null)
  if [ -n "$COMP_COUNT" ] && [ -n "$FEAT_COUNT" ]; then
    SYMBOL_SUMMARY=" ($COMP_COUNT components, $FEAT_COUNT features, $FLOW_COUNT flows, $GATE_COUNT gates indexed)"
  fi
fi

# Emit context injection (non-blocking)
echo "" >&2
echo "[paradigm] Context available — use paradigm_navigate before searching.$SYMBOL_SUMMARY" >&2
echo "  paradigm_navigate({ intent: \\"context\\", task: \\"<your task>\\" })" >&2
echo "  Returns relevant .purpose files, symbols, and file paths — skips blind Glob/Grep." >&2
echo "  Scan index: $SCAN_INDEX" >&2
echo "  Navigator:  $CWD/.paradigm/navigator.yaml" >&2

exit 0
`;

export const CLAUDE_CODE_PROMPT_GATE_HOOK = `#!/bin/sh
# Paradigm Claude Code UserPromptSubmit — Team Invocation Gate (advisory tier)
# Fires on every user prompt. If the task looks orchestration-eligible and the
# session has neither orchestrated nor declared solo, injects a decision-time
# directive into the model's context (UserPromptSubmit stdout = context).
#
# Why decision-time: CLAUDE.md "always use the team" instructions sit far back
# in context and lose to the model's action bias. A directive injected at the
# moment of decision is deterministic — it fires 100% of the time.
#
# Hook type: UserPromptSubmit
# Exit 0 = always (advisory only — never blocks)
#
# Telemetry: every eligible prompt appends an \`eligible\` event to
# .paradigm/events/team-funnel.jsonl (even when the directive is capped),
# so the classifier's false-positive rate and the team-invocation rate are
# measurable from day one. Loid calibrates the gate from this data.
#
# Escape hatches: PARADIGM_TEAM_GATE=off env var; \`paradigm solo <reason>\`
# declares a legible solo session; orchestrating clears the gate naturally.

# Read JSON from stdin (hook input)
# Hook self-monitoring (#hook-monitor, fail open): wall time + outcome -> .paradigm/events/hook-timings.jsonl
case "$0" in */*) _PM_DIR=\${0%/*} ;; *) _PM_DIR=. ;; esac
[ -f "$_PM_DIR/paradigm-hook-monitor.sh" ] && . "$_PM_DIR/paradigm-hook-monitor.sh" && _pm_begin UserPromptSubmit 5000 2000

INPUT=$(cat)

# Kill switch
if [ "$PARADIGM_TEAM_GATE" = "off" ]; then
  exit 0
fi

# Extract cwd from input
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

# Markers expire by age, NOT by Stop-hook clearing — the Stop hook fires per
# assistant turn, so clearing there would erase solo declarations mid-session
# and turn the once-per-session cap into once-per-turn nagging. TTL default 4h.
TTL_MIN=$(( \${PARADIGM_GATE_TTL_HOURS:-4} * 60 ))
marker_fresh() {
  [ -f "$1" ] || return 1
  [ -n "$(find "$1" -mmin "-$TTL_MIN" 2>/dev/null)" ]
}

# Session already resolved the gate (team ran, or solo was declared) — pass
if [ -f "$CWD/.paradigm/.orchestrated" ] || marker_fresh "$CWD/.paradigm/.solo-declared"; then
  exit 0
fi

# Extract the prompt text
if command -v jq >/dev/null 2>&1; then
  PROMPT=$(printf '%s' "$INPUT" | jq -r '.prompt // empty' 2>/dev/null)
else
  PROMPT=$(printf '%s' "$INPUT" | grep -o '"prompt"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"prompt"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
fi

# Too short to be a task (confirmations, "yes", "continue") — pass
if [ "\${#PROMPT}" -lt 24 ]; then
  exit 0
fi

# Eligibility: implementation-shaped verbs. Deliberately simple — the funnel
# telemetry measures this classifier's false-positive rate; tune from data.
# printf (not echo): a prompt starting with -n/-e must not be mangled.
MATCHED=$(printf '%s\\n' "$PROMPT" | grep -ioE 'implement|build |fix |refactor|migrate|rewrite|integrate|add (a |an |the )?(feature|support|endpoint|command|tool|component)|create (a |an |the )?(feature|component|module|service)' | head -1)

if [ -z "$MATCHED" ]; then
  exit 0
fi

# Record the eligible event (telemetry fires every time, even when the
# directive itself is capped)
EVENTS_DIR="$CWD/.paradigm/events"
mkdir -p "$EVENTS_DIR" 2>/dev/null
MATCHED_CLEAN=$(printf '%s' "$MATCHED" | tr -cd 'a-zA-Z ' | head -c 40)
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "{\\"timestamp\\":\\"$TS\\",\\"type\\":\\"eligible\\",\\"source\\":\\"prompt-gate\\",\\"matched\\":\\"$MATCHED_CLEAN\\"}" >> "$EVENTS_DIR/team-funnel.jsonl" 2>/dev/null

# Inject the directive at most once per TTL window (age-based, see above)
MARKER="$CWD/.paradigm/.team-prompted"
if marker_fresh "$MARKER"; then
  exit 0
fi
touch "$MARKER" 2>/dev/null

# stdout on UserPromptSubmit = injected into the model's context
echo "[paradigm] This task looks orchestration-eligible (matched: \\"$MATCHED_CLEAN\\")."
echo "Standing opt-in for team orchestration exists in this project. Before editing source:"
echo "  - Run paradigm_orchestrate_inline (mode=\\"plan\\") to engage the agent team, OR"
echo "  - Declare solo explicitly: \\\`paradigm solo <trivial|hotfix|user-directed|exploratory> [note]\\\`"
echo "Solo work on eligible tasks without a declaration is recorded as a bypass at session end."

exit 0
`;

export const CLAUDE_CODE_TEAM_GATE_HOOK = `#!/bin/sh
# Paradigm Claude Code PreToolUse — Team Edit Gate (advisory tier)
# Fires before Write/Edit tool calls. If source code is about to be edited in a
# session that has neither orchestrated nor declared solo, emits a one-time
# advisory. Second line of defense after the prompt-gate (UserPromptSubmit) —
# catches sessions where the task only became implementation-shaped mid-way.
#
# Hook type: PreToolUse (matcher: Write|Edit)
# Exit 0 = always allows (advisory only — never blocks at this tier).
# Graduation to a blocking guard happens only after baseline telemetry
# justifies it (Loid: "advisory-everywhere first, four weeks minimum").
#
# Uses a session marker (.paradigm/.team-reminded) to fire at most once.
# Escape hatch: PARADIGM_TEAM_GATE=off

# Read JSON from stdin (hook input)
# Hook self-monitoring (#hook-monitor, fail open): wall time + outcome -> .paradigm/events/hook-timings.jsonl
case "$0" in */*) _PM_DIR=\${0%/*} ;; *) _PM_DIR=. ;; esac
[ -f "$_PM_DIR/paradigm-hook-monitor.sh" ] && . "$_PM_DIR/paradigm-hook-monitor.sh" && _pm_begin PreToolUse-Write 5000 2000

INPUT=$(cat)

# Kill switch
if [ "$PARADIGM_TEAM_GATE" = "off" ]; then
  exit 0
fi

# Extract cwd from input
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

# Markers expire by age, NOT by Stop-hook clearing (Stop fires per turn).
TTL_MIN=$(( \${PARADIGM_GATE_TTL_HOURS:-4} * 60 ))
marker_fresh() {
  [ -f "$1" ] || return 1
  [ -n "$(find "$1" -mmin "-$TTL_MIN" 2>/dev/null)" ]
}

# Session already resolved the gate — pass
if [ -f "$CWD/.paradigm/.orchestrated" ] || marker_fresh "$CWD/.paradigm/.solo-declared"; then
  exit 0
fi

# Only remind once per TTL window
MARKER="$CWD/.paradigm/.team-reminded"
if marker_fresh "$MARKER"; then
  exit 0
fi

# Extract the target file path
if command -v jq >/dev/null 2>&1; then
  FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
else
  FILE_PATH=$(printf '%s' "$INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
fi

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Only fire for source files — docs/config/purpose edits are not team-eligible
case "$FILE_PATH" in
  *.md|*.markdown|*.yaml|*.yml|*.json|*.txt|*.purpose) exit 0 ;;
  */docs/*|*/.paradigm/*) exit 0 ;;
esac

# Mark as reminded so this only fires once per session
touch "$MARKER" 2>/dev/null

# Record the edit-advisory event (telemetry)
EVENTS_DIR="$CWD/.paradigm/events"
mkdir -p "$EVENTS_DIR" 2>/dev/null
FILE_BASE=$(basename -- "$FILE_PATH" | tr -cd 'a-zA-Z0-9._-' | head -c 60)
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "{\\"timestamp\\":\\"$TS\\",\\"type\\":\\"edit-advisory\\",\\"source\\":\\"team-gate\\",\\"file\\":\\"$FILE_BASE\\"}" >> "$EVENTS_DIR/team-funnel.jsonl" 2>/dev/null

# Emit advisory (non-blocking)
echo "" >&2
echo "[paradigm] Source edit without team orchestration this session." >&2
echo "  Standing opt-in exists: run paradigm_orchestrate_inline (mode=\\"plan\\") to engage the team," >&2
echo "  or declare solo explicitly: paradigm solo <trivial|hotfix|user-directed|exploratory> [note]" >&2
echo "  Undeclared solo work on eligible tasks is recorded as a bypass at session end." >&2

exit 0
`;

export const CLAUDE_CODE_SKILL_USED_HOOK = `#!/bin/sh
# Paradigm Claude Code PostToolUse — Skill usage ledger (!skill-used)
# Fires after the host \`Skill\` tool runs. When the invoked skill is a Paradigm
# projection (\`pdg-<id>\`, optionally plugin-qualified \`x:pdg-<id>\`), appends a
# row to .paradigm/events/skill-usage.jsonl via the hidden
# \`paradigm skill record-usage\` verb (buildSkillUsageRow + appendSkillUsage).
# Installed by: paradigm hooks install --claude-code
#
# Hook type: PostToolUse (matcher: Skill)
# Contract: NEVER fails loudly — always exit 0, no stdout/stderr output.

# Hook self-monitoring (#hook-monitor, fail open): wall time + outcome -> .paradigm/events/hook-timings.jsonl
case "$0" in */*) _PM_DIR=\${0%/*} ;; *) _PM_DIR=. ;; esac
[ -f "$_PM_DIR/paradigm-hook-monitor.sh" ] && . "$_PM_DIR/paradigm-hook-monitor.sh" && _pm_begin PostToolUse-Skill 10000 3000

INPUT=$(cat)

# Cheap pre-filter: only Paradigm projections pay for a CLI spawn.
case "$INPUT" in
  *pdg-*) ;;
  *) exit 0 ;;
esac

# Only a \`paradigm\` already on PATH — no npx fallback (Aegis L3: never resolve
# an arbitrary package-local binary from an untrusted cwd). Absent → silent pass.
command -v paradigm >/dev/null 2>&1 || exit 0
printf '%s' "$INPUT" | paradigm skill record-usage >/dev/null 2>&1 || true

exit 0
`;

export const CLAUDE_CODE_SESSION_START_HOOK = `#!/bin/sh
# Paradigm Claude Code SessionStart hook — hook-health surfacing (#hook-health-warning)
# Reads the hook timing ring (.paradigm/events/hook-timings.jsonl, written by
# paradigm-hook-monitor.sh) and, when a Paradigm hook was killed (start with no
# end older than its timeout, or a recorded SIGTERM) or ran over its budget
# since the last warning, prints ONE line per hook to stdout — SessionStart
# stdout is added to the agent's context. Rate-limited to once per session
# (.paradigm/.hook-health-warned). Also trims the ring to its cap.
#
# Hook type: SessionStart. Contract: always exit 0; fail open.

case "$0" in */*) _PM_DIR=\${0%/*} ;; *) _PM_DIR=. ;; esac
[ -f "$_PM_DIR/paradigm-hook-monitor.sh" ] && . "$_PM_DIR/paradigm-hook-monitor.sh" && _pm_begin SessionStart 10000 3000

INPUT=$(cat)

ROOT="\${CLAUDE_PROJECT_DIR:-$PWD}"
[ -d "$ROOT/.paradigm" ] || exit 0
RING="$ROOT/.paradigm/events/hook-timings.jsonl"
[ -f "$RING" ] || exit 0
MARK="$ROOT/.paradigm/.hook-health-warned"

SID=$(printf '%s' "$INPUT" | grep -o '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\\([^"]*\\)"$/\\1/')
SINCE=0
if [ -f "$MARK" ]; then
  read -r _m_sid _m_ts < "$MARK" 2>/dev/null
  # once per session
  [ -n "$SID" ] && [ "$_m_sid" = "$SID" ] && exit 0
  case "$_m_ts" in ''|*[!0-9]*) ;; *) SINCE=$_m_ts ;; esac
fi

_pm_now 2>/dev/null || _pm_t=$(( $(date +%s) * 1000 ))
NOW=$_pm_t

# The ring is a plain file any process in the project can write, and this hook's
# stdout goes into the NEXT session's context (possibly an unsandboxed one). So
# (Aegis M-A) no ring text reaches stdout except numbers printed with %d and
# hook names from this exact allowlist; a record with any other \`hook\` value
# is dropped whole. Keep in sync with HOOK_NAMES in doctor/hook-health.ts.
HOOK_ALLOW="SessionStart Stop PreToolUse-Bash PreToolUse-Glob PreToolUse-Write UserPromptSubmit PostToolUse-Write PostToolUse-Skill"

# One awk pass: per hook, killed and over-budget counts after SINCE, earliest time, total lines.
SUMMARY=$(awk -v now="$NOW" -v since="$SINCE" -v grace=5000 -v allow="$HOOK_ALLOW" '
  BEGIN { na = split(allow, al, " "); for (i = 1; i <= na; i++) OK[al[i]] = 1 }
  function f(k,   r, p) {
    p = "\\"" k "\\":"
    if (!match($0, p "\\"?[^,\\"}]*")) return ""
    r = substr($0, RSTART + length(p), RLENGTH - length(p)); sub(/^"/, "", r); return r
  }
  { n++ ; ev = f("ev"); id = f("id"); h = f("hook"); t = f("t") + 0; if (!(h in OK)) next }
  ev == "start" { S[id] = t; H[id] = h; TO[id] = f("timeoutMs") + 0; B[id] = f("budgetMs") + 0 }
  ev == "end" {
    E[id] = 1
    if (t <= since) next
    if (f("outcome") == "killed") { K[h]++; if (!(h in FK) || t < FK[h]) FK[h] = t }
    else if ((id in B) && B[id] > 0 && f("ms") + 0 > B[id]) { SL[h]++; BU[h] = B[id]; if (!(h in FSL) || t < FSL[h]) FSL[h] = t }
  }
  END {
    for (id in S) if (!(id in E) && S[id] > since && now - S[id] > TO[id] + grace) { h = H[id]; K[h]++; if (!(h in FK) || S[id] < FK[h]) FK[h] = S[id] }
    for (h in K) printf "killed\\t%s\\t%d\\t%d\\n", h, K[h], FK[h]
    for (h in SL) printf "slow\\t%s\\t%d\\t%d\\t%d\\n", h, SL[h], FSL[h], BU[h]
    printf "lines\\t%d\\n", n
  }' "$RING" 2>/dev/null)

_fmt_date() { # epoch ms -> YYYY-MM-DD HH:MM (local)
  _s=$(( $1 / 1000 ))
  date -r "$_s" '+%Y-%m-%d %H:%M' 2>/dev/null || date -d "@$_s" '+%Y-%m-%d %H:%M' 2>/dev/null || echo "$_s"
}

WARNED=false
_TAB=$(printf '\\t')
while IFS="$_TAB" read -r kind hook count first budget; do
  # belt and braces (M-A): only allowlisted names and plain digits are ever printed
  case " $HOOK_ALLOW " in *" $hook "*) ;; *) [ "$kind" = lines ] || continue ;; esac
  case "\${count:-0}\${first:-0}\${budget:-0}" in *[!0-9]*) [ "$kind" = lines ] || continue ;; esac
  case "$kind" in
    killed)
      case "$hook" in
        Stop) consequence="enforcement did not run" ;;
        *) consequence="its checks did not run" ;;
      esac
      printf '%s\\n' "Paradigm $hook hook timed out $count time(s) since $(_fmt_date "$first"); $consequence. Run \\\`paradigm doctor\\\`."
      WARNED=true ;;
    slow)
      printf '%s\\n' "Paradigm $hook hook exceeded its $(( budget / 1000 ))s budget $count time(s) since $(_fmt_date "$first"). Run \\\`paradigm doctor\\\`."
      WARNED=true ;;
    lines)
      case "\${hook:-0}" in *[!0-9]*) continue ;; esac
      [ "\${hook:-0}" -gt "\${PARADIGM_HOOK_RING_MAX:-500}" ] 2>/dev/null && { _PM_RING_SAVE=$_PM_RING; _PM_RING=$RING; _pm_trim; _PM_RING=$_PM_RING_SAVE; } ;;
  esac
done <<EOF
$SUMMARY
EOF

if [ "$WARNED" = true ]; then
  { printf '%s %s\\n' "\${SID:-unknown}" "$NOW" > "$MARK"; } 2>/dev/null
fi
exit 0
`;

export const HOOK_MONITOR = `#!/bin/sh
# Paradigm hook self-monitoring (#hook-monitor) — sourced by every plugin hook.
#
#   case "$0" in */*) _PM_DIR=\${0%/*} ;; *) _PM_DIR=. ;; esac
#   [ -f "$_PM_DIR/paradigm-hook-monitor.sh" ] && . "$_PM_DIR/paradigm-hook-monitor.sh" && _pm_begin <Hook> <timeoutMs> <budgetMs>
#
# Appends a "start" record when the hook begins and an "end" record (wall ms
# + outcome ok|blocked|error|killed) when it exits, to the bounded ring
# .paradigm/events/hook-timings.jsonl. A hook killed with SIGKILL cannot write
# its end record; the next SessionStart (paradigm-session-start.sh) and
# \`paradigm doctor\` treat a start with no end, older than its timeout, as
# killed. Cost per run: two \`date\` calls and two appended lines through shell
# redirection — no CLI or node spawn. FAIL OPEN: nothing here may print to
# stdout, change the hook's exit code, or stop the hook; every write is
# best-effort (a read-only tree or sandbox just records nothing).

_pm_now() {
  _pm_t=$(date +%s%N 2>/dev/null)
  case "$_pm_t" in
    ''|*[!0-9]*) _pm_t=$(date +%s 2>/dev/null); _pm_t=$(( \${_pm_t:-0} * 1000 )) ;;
    *) _pm_t=\${_pm_t%??????} ;;
  esac
}

_pm_trim() {
  _pm_max=\${PARADIGM_HOOK_RING_MAX:-500}
  { tail -n "$_pm_max" "$_PM_RING" > "$_PM_RING.tmp.$$" && mv -f "$_PM_RING.tmp.$$" "$_PM_RING"; } 2>/dev/null || rm -f "$_PM_RING.tmp.$$" 2>/dev/null
}

_pm_end() {
  _pm_rc=$1
  [ -n "$_PM_RING" ] || return 0
  _pm_now
  _pm_ms=$(( _pm_t - _PM_T0 ))
  case "$_PM_OUTCOME:$_pm_rc" in
    killed:*) _pm_out=killed ;;
    *:0) _pm_out=ok ;;
    *:2) _pm_out=blocked ;;
    *) _pm_out=error ;;
  esac
  { printf '{"ev":"end","hook":"%s","id":"%s","t":%s,"ms":%s,"rc":%s,"outcome":"%s"}\\n' "$_PM_HOOK" "$_PM_ID" "$_pm_t" "$_pm_ms" "$_pm_rc" "$_pm_out" >> "$_PM_RING"; } 2>/dev/null
  # Bounded ring: trim on ~1 in 64 runs (one tail+mv), deterministically in
  # SessionStart. PARADIGM_HOOK_RING_TRIM_EVERY=1 trims every run (tests).
  _pm_every=\${PARADIGM_HOOK_RING_TRIM_EVERY:-64}
  [ "$_pm_every" -gt 0 ] 2>/dev/null || _pm_every=64
  [ $(( $$ % _pm_every )) -eq 0 ] && _pm_trim
  _pm_sections_flush
  _PM_RING=
  return 0
}

# --- Per-section timing (Stop hook; #hook-monitor) ---
# _pm_mark <section> closes the open section (its ms since the previous mark)
# and opens <section>. At exit _pm_end writes ONE record per run to the bounded
# ring .paradigm/events/stop-timing.jsonl: total ms, outcome, the section that
# was still open when the hook ended ("inflight": names where a killed run was
# stuck), each section's ms, and the counters set with _pm_count. A slow run
# then explains itself. Cost: one \`date\` per mark. Fail open like the rest.
_PM_SECS=
_PM_SEC=
_PM_SEC_T=
_PM_COUNTS=
_pm_mark() {
  [ -n "$_PM_RING" ] || return 0
  _pm_now
  [ -n "$_PM_SEC" ] && _PM_SECS="$_PM_SECS\${_PM_SECS:+,}\\"$_PM_SEC\\":$(( _pm_t - _PM_SEC_T ))"
  _PM_SEC=$1
  _PM_SEC_T=$_pm_t
  return 0
}
# _pm_count <name> <integer> — a counter recorded with the sections.
_pm_count() {
  [ -n "$_PM_RING" ] || return 0
  case "$2" in ''|*[!0-9]*) return 0 ;; esac
  _PM_COUNTS="$_PM_COUNTS\${_PM_COUNTS:+,}\\"$1\\":$2"
  return 0
}
_pm_sections_flush() {
  [ -n "$_PM_SECS$_PM_SEC" ] || return 0
  _pm_sf="\${_PM_RING%/*}/stop-timing.jsonl"
  _pm_inflight=
  if [ -n "$_PM_SEC" ]; then
    _PM_SECS="$_PM_SECS\${_PM_SECS:+,}\\"$_PM_SEC\\":$(( _pm_t - _PM_SEC_T ))"
    _pm_inflight=$_PM_SEC
  fi
  { printf '{"hook":"%s","id":"%s","t":%s,"ms":%s,"rc":%s,"outcome":"%s","inflight":"%s","sections":{%s},"counts":{%s}}\\n' "$_PM_HOOK" "$_PM_ID" "$_pm_t" "$_pm_ms" "$_pm_rc" "$_pm_out" "$_pm_inflight" "$_PM_SECS" "$_PM_COUNTS" >> "$_pm_sf"; } 2>/dev/null
  # Bounded: same 1-in-N cadence as the ring; PARADIGM_STOP_TIMING_MAX lines kept.
  if [ $(( $$ % _pm_every )) -eq 0 ]; then
    _pm_smax=\${PARADIGM_STOP_TIMING_MAX:-200}
    { tail -n "$_pm_smax" "$_pm_sf" > "$_pm_sf.tmp.$$" && mv -f "$_pm_sf.tmp.$$" "$_pm_sf"; } 2>/dev/null || rm -f "$_pm_sf.tmp.$$" 2>/dev/null
  fi
  _PM_SECS=
  _PM_SEC=
  return 0
}

_pm_begin() {
  _PM_HOOK=$1
  _PM_RING="\${CLAUDE_PROJECT_DIR:-$PWD}/.paradigm/events/hook-timings.jsonl"
  [ -n "$PARADIGM_HOOK_MONITOR_OFF" ] && { _PM_RING=; return 0; }
  [ -d "\${_PM_RING%/*}" ] || { _PM_RING=; return 0; }
  _PM_OUTCOME=
  _pm_now
  _PM_T0=$_pm_t
  _PM_ID="$$-$_pm_t"
  { printf '{"ev":"start","hook":"%s","id":"%s","t":%s,"timeoutMs":%s,"budgetMs":%s}\\n' "$_PM_HOOK" "$_PM_ID" "$_pm_t" "\${2:-30000}" "\${3:-2000}" >> "$_PM_RING"; } 2>/dev/null || { _PM_RING=; return 0; }
  trap '_pm_end $?' EXIT
  trap '_PM_OUTCOME=killed; exit 143' TERM HUP INT
  return 0
}
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
CONTEXT="\${CONTEXT}  - FIRST action: Call paradigm_session({op:'recover'}) to load previous session context\\\\n"
CONTEXT="\${CONTEXT}  - LAST action before finishing: Call paradigm_pm({op:'postflight'}) with filesModified and symbolsTouched\\\\n\\\\n"

CONTEXT="\${CONTEXT}Rule 2: .PURPOSE UPDATES\\\\n"
CONTEXT="\${CONTEXT}  - Every source file you modify MUST have a covering .purpose file\\\\n"
CONTEXT="\${CONTEXT}  - Update the nearest .purpose file with: #components, ~aspects (with anchors), !signals\\\\n"
CONTEXT="\${CONTEXT}  - The STOP HOOK WILL BLOCK you if .purpose files are not updated\\\\n\\\\n"

CONTEXT="\${CONTEXT}Rule 3: RIPPLE BEFORE MODIFY\\\\n"
CONTEXT="\${CONTEXT}  - Before modifying any existing symbol, call paradigm_ripple({ symbol: \\\\\\"#symbol-name\\\\\\" })\\\\n"
CONTEXT="\${CONTEXT}  - This shows the blast radius — what else will break if you change it\\\\n\\\\n"

CONTEXT="\${CONTEXT}ESSENTIAL MCP TOOLS:\\\\n"
CONTEXT="\${CONTEXT}  paradigm_session({op:'recover'})          — Load previous session (call FIRST)\\\\n"
CONTEXT="\${CONTEXT}  paradigm_ripple({ symbol })          — Check impact before modifying\\\\n"
CONTEXT="\${CONTEXT}  paradigm_pm({op:'postflight', filesModified, symbolsTouched }) — Compliance check (call LAST)\\\\n"
CONTEXT="\${CONTEXT}  paradigm_purpose({op:'add_component', path, name, description }) — Register code units\\\\n"
CONTEXT="\${CONTEXT}  paradigm_reindex()                   — Rebuild indexes after .purpose changes\\\\n"
CONTEXT="\${CONTEXT}  paradigm_lore({op:'record', type, title, summary, symbols_touched }) — Record session\\\\n"

if [ "$HAS_PORTAL" = "true" ]; then
  CONTEXT="\${CONTEXT}  paradigm_gates_for_route({ method, path }) — Get auth gate suggestions for endpoints\\\\n"
  CONTEXT="\${CONTEXT}  paradigm_purpose({op:'portal_add_route', method, path, gates }) — Register route with gates\\\\n"
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
# Checks 1–13 are defined in paradigm-common.sh (shared with Claude Code hook).

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
  echo "  1. paradigm_purpose (op: add_component) — register new code units" >&2
  echo "  2. paradigm_purpose (op: add_aspect) — register cross-cutting concerns (with anchors)" >&2
  echo "  3. paradigm_purpose (op: portal_add_route) — register new endpoints with gates" >&2
  echo "  4. paradigm_reindex — rebuild indexes after updates" >&2
  echo "  5. paradigm_lore (op: record) — record session lore entry" >&2
  echo "  6. paradigm_habits (op: check) — evaluate habit compliance" >&2
  echo "" >&2
  echo "Tip: Set PARADIGM_AUTO_FIX=1 to auto-fix trivial violations (missing .purpose stubs, missing lore)." >&2
  echo "Help: See .paradigm/docs/troubleshooting.md for step-by-step resolution guides." >&2

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
rm -f ".paradigm/.orchestrated"
# NOTE: .solo-declared / .team-prompted / .team-reminded / .team-bypass-recorded
# are deliberately NOT cleared here — stop fires per turn; they expire by age
# instead (PARADIGM_GATE_TTL_HOURS, default 4h).

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
  # --no-install: never let npx fetch the unrelated public "paradigm" package
  # (a network round-trip inside a 15 s hook, and the wrong binary).
  npx --no-install paradigm index --quiet 2>/dev/null || true
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
  echo "  Use: paradigm_purpose (op: init) + paradigm_purpose (op: add_component)" >&2
  exit 0
else
  # Block — too many uncovered edits
  echo "" >&2
  echo "[paradigm] BLOCKED: $UNCOVERED_COUNT source files modified without .purpose coverage." >&2
  echo "  You must update .purpose files before continuing." >&2
  echo "  Steps:" >&2
  echo "    1. paradigm_purpose (op: init) — create .purpose in uncovered directories" >&2
  echo "    2. paradigm_purpose (op: add_component) — register code units" >&2
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
  echo "  Create one: paradigm_purpose (op: init) + paradigm_purpose (op: add_component)" >&2
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

