/**
 * Git Hooks, Claude Code Hooks & Cursor Hooks CLI Commands
 *
 * Commands:
 * - paradigm hooks install - Install git hooks + Claude Code hooks + Cursor hooks
 * - paradigm hooks install --claude-code - Install only Claude Code hooks
 * - paradigm hooks install --cursor - Install only Cursor hooks
 * - paradigm hooks uninstall - Remove git hooks
 * - paradigm hooks uninstall --cursor - Remove Cursor hooks
 * - paradigm hooks status - Check hook status
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

const POST_COMMIT_HOOK = `#!/bin/sh
# Paradigm post-commit hook - captures history from commits
# Installed by: paradigm hooks install

# Get the commit message and hash
COMMIT_HASH=$(git rev-parse HEAD)
COMMIT_MSG=$(git log -1 --pretty=%B)

# Get changed files
CHANGED_FILES=$(git diff-tree --no-commit-id --name-only -r HEAD)

# Extract symbols from changed files (look for .purpose files)
extract_symbols() {
  local symbols=""
  for file in $CHANGED_FILES; do
    # Check if there's a .purpose file in the directory
    dir=$(dirname "$file")
    while [ "$dir" != "." ]; do
      if [ -f "$dir/.purpose" ]; then
        # Extract feature/component names from .purpose
        purpose_symbols=$(grep -E '^(features|components|gates|flows):' "$dir/.purpose" -A 10 2>/dev/null | grep -E '^  - (name|id):' | sed 's/.*: //' | tr '\\n' ',' | sed 's/,$//')
        if [ -n "$purpose_symbols" ]; then
          symbols="$symbols,$purpose_symbols"
        fi
        break
      fi
      dir=$(dirname "$dir")
    done
  done
  echo "$symbols" | sed 's/^,//' | tr ',' '\\n' | sort -u | tr '\\n' ',' | sed 's/,$//'
}

SYMBOLS=$(extract_symbols)

# Extract symbols from commit message Symbols: trailer
MSG_SYMBOLS=$(echo "$COMMIT_MSG" | grep -E '^Symbols:' | sed 's/^Symbols: //' | tr -d ' ')
if [ -n "$MSG_SYMBOLS" ]; then
  if [ -n "$SYMBOLS" ]; then
    SYMBOLS="$SYMBOLS,$MSG_SYMBOLS"
  else
    SYMBOLS="$MSG_SYMBOLS"
  fi
  # Deduplicate
  SYMBOLS=$(echo "$SYMBOLS" | tr ',' '\\n' | sort -u | tr '\\n' ',' | sed 's/,$//')
fi

# Determine intent from commit message
determine_intent() {
  case "$COMMIT_MSG" in
    feat*|feature*|add*) echo "feature" ;;
    fix*|bug*) echo "fix" ;;
    refactor*) echo "refactor" ;;
    *) echo "feature" ;;
  esac
}

INTENT=$(determine_intent)

# Record if we found symbols (from .purpose or commit message) and .paradigm/history exists
if [ -n "$SYMBOLS" ] && [ -d ".paradigm/history" ]; then
  # Generate entry ID
  if [ -f ".paradigm/history/log.jsonl" ]; then
    COUNT=$(wc -l < ".paradigm/history/log.jsonl" | tr -d ' ')
    COUNT=$((COUNT + 1))
  else
    COUNT=1
  fi
  ID=$(printf "h%04d" $COUNT)

  # Create entry
  TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  AUTHOR=$(git config user.name || echo "unknown")

  # Format symbols as JSON array
  SYMBOLS_JSON=$(echo "$SYMBOLS" | sed 's/,/","/g' | sed 's/^/"/' | sed 's/$/"/')

  # Format files as JSON array
  FILES_JSON=$(echo "$CHANGED_FILES" | tr '\\n' ',' | sed 's/,$//' | sed 's/,/","/g' | sed 's/^/"/' | sed 's/$/"/')

  # Write entry
  echo "{\\"id\\":\\"$ID\\",\\"ts\\":\\"$TIMESTAMP\\",\\"type\\":\\"implement\\",\\"symbols\\":[$SYMBOLS_JSON],\\"author\\":{\\"type\\":\\"human\\",\\"id\\":\\"$AUTHOR\\"},\\"commit\\":\\"$COMMIT_HASH\\",\\"intent\\":\\"$INTENT\\",\\"files\\":[$FILES_JSON],\\"description\\":\\"$(echo "$COMMIT_MSG" | head -1 | sed 's/"/\\\\"/g')\\"}" >> .paradigm/history/log.jsonl

  echo "[paradigm] History entry $ID recorded"
fi
`;

const PRE_PUSH_HOOK = `#!/bin/sh
# Paradigm pre-push hook - reindex history before pushing
# Installed by: paradigm hooks install

if [ -d ".paradigm/history" ] && [ -f ".paradigm/history/log.jsonl" ]; then
  echo "[paradigm] Reindexing history..."
  npx paradigm history reindex 2>/dev/null || true
fi
`;

const CLAUDE_CODE_STOP_HOOK = `#!/bin/sh
# Paradigm Claude Code Stop Hook
# Validates paradigm compliance before allowing the agent to finish.
# Installed by: paradigm hooks install --claude-code
#
# Hook type: Stop
# Exit 0 = allow, Exit 2 = block with message
#
# Checks:
#   1. Source files modified without .purpose updates
#   2. Modified source directories missing .purpose files entirely
#   3. Route-like patterns added without portal.yaml updates
#   4. Aspect anchor files that no longer exist

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

if [ "$SOURCE_COUNT" -gt 2 ] && [ "$PARADIGM_COUNT" -eq 0 ]; then
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
# Quick check: grep anchors from .purpose files and verify files exist
# Anchor paths are relative to the directory containing the .purpose file
for purpose_file in $(find . -name ".purpose" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null); do
  if grep -q "anchors:" "$purpose_file" 2>/dev/null; then
    purpose_dir=$(dirname "$purpose_file")
    # Extract anchor file paths (lines after "anchors:" that start with "- ")
    in_anchors=false
    while IFS= read -r line; do
      case "$line" in
        *"anchors:"*) in_anchors=true; continue ;;
        *"- "*)
          if [ "$in_anchors" = true ]; then
            # Extract file path (before :linenum)
            anchor_path=$(echo "$line" | sed 's/.*- //' | sed 's/:.*//' | tr -d ' ')
            if [ -n "$anchor_path" ]; then
              # Resolve relative to the .purpose file's directory
              resolved_path="$purpose_dir/$anchor_path"
              if [ ! -f "$resolved_path" ]; then
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

# --- Final verdict ---
if [ "$VIOLATION_COUNT" -gt 0 ]; then
  echo "" >&2
  echo "Paradigm compliance check failed ($VIOLATION_COUNT violation(s)):" >&2
  echo "$VIOLATIONS" >&2
  echo "" >&2
  echo "Fix these issues, then call paradigm_reindex before finishing." >&2
  exit 2
fi

exit 0
`;

const CLAUDE_CODE_POSTWRITE_HOOK = `#!/bin/sh
# Paradigm Claude Code PostToolUse Hook
# Fires after Edit/Write tool calls to remind agents about .purpose files.
# Installed by: paradigm hooks install --claude-code
#
# Hook type: PostToolUse (matcher: Edit,Write)
# Exit 0 always (never blocks — advisory only)
# Prints reminder if the edited file's directory has no .purpose file

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

# Skip .paradigm directory
case "$FILE_PATH" in
  */.paradigm/*|.paradigm/*) exit 0 ;;
esac

# Not a paradigm project — pass
if [ ! -d ".paradigm" ]; then
  exit 0
fi

# Walk up from the file's directory to find a .purpose file
dir=$(dirname "$FILE_PATH")
found_purpose=false

while [ "$dir" != "." ] && [ "$dir" != "/" ] && [ "$dir" != "" ]; do
  if [ -f "$dir/.purpose" ]; then
    found_purpose=true
    break
  fi
  dir=$(dirname "$dir")
done

# Check root .purpose
if [ "$found_purpose" = false ] && [ -f ".purpose" ]; then
  found_purpose=true
fi

if [ "$found_purpose" = false ]; then
  file_dir=$(dirname "$FILE_PATH")
  echo "[paradigm] No .purpose file covers $file_dir — consider creating one with paradigm_purpose_init." >&2
fi

exit 0
`;

const CLAUDE_CODE_PRECOMMIT_HOOK = `#!/bin/sh
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

/**
 * paradigm hooks install
 */
// ─── Cursor Hook Scripts ────────────────────────────────────────────────────

const CURSOR_STOP_HOOK = `#!/bin/sh
# Paradigm Cursor Stop Hook
# Validates paradigm compliance before allowing the agent to finish.
# Installed by: paradigm hooks install --cursor
#
# Hook type: stop
# Exit 0 = allow, Exit 2 = block with message
#
# Checks:
#   1. Source files modified without .purpose updates
#   2. Modified source directories missing .purpose files entirely
#   3. Route-like patterns added without portal.yaml updates
#   4. Aspect anchor files that no longer exist

# Read JSON from stdin (hook input)
INPUT=$(cat)

# Extract workspace root from Cursor's input (try jq first, fallback to grep)
if command -v jq >/dev/null 2>&1; then
  CWD=$(echo "$INPUT" | jq -r '.workspace_roots[0] // empty' 2>/dev/null)
else
  CWD=$(echo "$INPUT" | grep -o '"workspace_roots"[[:space:]]*:[[:space:]]*\\\\["[^"]*"' | head -1 | sed 's/.*\\\\["//' | sed 's/"$//')
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

if [ "$SOURCE_COUNT" -gt 2 ] && [ "$PARADIGM_COUNT" -eq 0 ]; then
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
          if grep -qE '\\\\.(get|post|put|patch|delete)\\\\s*\\\\(|router\\\\.|app\\\\.(get|post|put|delete)|@(Get|Post|Put|Delete)|#\\\\[actix_web::(get|post)' "$file" 2>/dev/null; then
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
              resolved_path="$purpose_dir/$anchor_path"
              if [ ! -f "$resolved_path" ]; then
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

# --- Final verdict ---
if [ "$VIOLATION_COUNT" -gt 0 ]; then
  echo "" >&2
  echo "Paradigm compliance check failed ($VIOLATION_COUNT violation(s)):" >&2
  echo "$VIOLATIONS" >&2
  echo "" >&2
  echo "Fix these issues, then call paradigm_reindex before finishing." >&2
  exit 2
fi

exit 0
`;

const CURSOR_POSTWRITE_HOOK = `#!/bin/sh
# Paradigm Cursor PostWrite Hook
# Fires after file edits to remind agents about .purpose files.
# Installed by: paradigm hooks install --cursor
#
# Hook type: afterFileEdit
# Exit 0 always (never blocks — advisory only)
# Prints reminder if the edited file's directory has no .purpose file

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

# Skip .paradigm directory
case "$FILE_PATH" in
  */.paradigm/*|.paradigm/*) exit 0 ;;
esac

# Not a paradigm project — pass
if [ ! -d ".paradigm" ]; then
  exit 0
fi

# Walk up from the file's directory to find a .purpose file
dir=$(dirname "$FILE_PATH")
found_purpose=false

while [ "$dir" != "." ] && [ "$dir" != "/" ] && [ "$dir" != "" ]; do
  if [ -f "$dir/.purpose" ]; then
    found_purpose=true
    break
  fi
  dir=$(dirname "$dir")
done

# Check root .purpose
if [ "$found_purpose" = false ] && [ -f ".purpose" ]; then
  found_purpose=true
fi

if [ "$found_purpose" = false ]; then
  file_dir=$(dirname "$FILE_PATH")
  echo "[paradigm] No .purpose file covers $file_dir — consider creating one with paradigm_purpose_init." >&2
fi

exit 0
`;

const CURSOR_PRECOMMIT_HOOK = `#!/bin/sh
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

/**
 * paradigm hooks install
 */
export async function hooksInstallCommand(options: {
  force?: boolean;
  postCommit?: boolean;
  prePush?: boolean;
  claudeCode?: boolean;
  cursor?: boolean;
} = {}): Promise<void> {
  const rootDir = process.cwd();

  const onlyClaudeCode = options.claudeCode && !options.postCommit && !options.prePush && !options.cursor;
  const onlyCursor = options.cursor && !options.postCommit && !options.prePush && !options.claudeCode;

  // Install git hooks (unless --claude-code or --cursor was the only flag)
  if (!onlyClaudeCode && !onlyCursor) {
    // Check if we're in a git repo
    const gitDir = path.join(rootDir, '.git');
    if (!fs.existsSync(gitDir)) {
      console.log(chalk.red('Not a git repository.'));
      return;
    }

    const hooksDir = path.join(gitDir, 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });

    const installAll = !options.postCommit && !options.prePush && !options.claudeCode;
    const installed: string[] = [];

    // Install post-commit hook
    if (installAll || options.postCommit) {
      const hookPath = path.join(hooksDir, 'post-commit');
      if (fs.existsSync(hookPath) && !options.force) {
        const content = fs.readFileSync(hookPath, 'utf8');
        if (!content.includes('paradigm')) {
          console.log(chalk.yellow('post-commit hook exists. Use --force to overwrite.'));
        } else {
          console.log(chalk.gray('post-commit hook already installed by paradigm'));
        }
      } else {
        fs.writeFileSync(hookPath, POST_COMMIT_HOOK);
        fs.chmodSync(hookPath, '755');
        installed.push('post-commit');
      }
    }

    // Install pre-push hook
    if (installAll || options.prePush) {
      const hookPath = path.join(hooksDir, 'pre-push');
      if (fs.existsSync(hookPath) && !options.force) {
        const content = fs.readFileSync(hookPath, 'utf8');
        if (!content.includes('paradigm')) {
          console.log(chalk.yellow('pre-push hook exists. Use --force to overwrite.'));
        } else {
          console.log(chalk.gray('pre-push hook already installed by paradigm'));
        }
      } else {
        fs.writeFileSync(hookPath, PRE_PUSH_HOOK);
        fs.chmodSync(hookPath, '755');
        installed.push('pre-push');
      }
    }

    if (installed.length > 0) {
      console.log(chalk.green(`Git hooks installed: ${installed.join(', ')}`));
    }

    // Initialize history if needed
    const historyDir = path.join(rootDir, '.paradigm/history');
    if (!fs.existsSync(historyDir)) {
      console.log(chalk.gray('Tip: Run `paradigm history init` to initialize history tracking'));
    }
  }

  // Install Claude Code hooks (when --claude-code flag or no specific flags)
  const installAll = !options.postCommit && !options.prePush && !options.claudeCode && !options.cursor;
  if (installAll || options.claudeCode) {
    await installClaudeCodeHooks(rootDir, options.force);
  }

  // Install Cursor hooks (when --cursor flag or no specific flags)
  if (installAll || options.cursor) {
    await installCursorHooks(rootDir, options.force);
  }
}

/**
 * Install Claude Code hooks (.claude/hooks/ scripts + settings.json)
 */
async function installClaudeCodeHooks(rootDir: string, force?: boolean): Promise<void> {
  const claudeHooksDir = path.join(rootDir, '.claude', 'hooks');
  fs.mkdirSync(claudeHooksDir, { recursive: true });

  const installed: string[] = [];

  // Hook scripts as embedded constants
  const hookScripts = [
    { name: 'paradigm-stop.sh', content: CLAUDE_CODE_STOP_HOOK },
    { name: 'paradigm-precommit.sh', content: CLAUDE_CODE_PRECOMMIT_HOOK },
    { name: 'paradigm-postwrite.sh', content: CLAUDE_CODE_POSTWRITE_HOOK },
  ];

  for (const hook of hookScripts) {
    const destPath = path.join(claudeHooksDir, hook.name);

    if (fs.existsSync(destPath) && !force) {
      console.log(chalk.gray(`  ${hook.name}: already installed`));
      continue;
    }

    fs.writeFileSync(destPath, hook.content, 'utf8');
    fs.chmodSync(destPath, '755');
    installed.push(hook.name);
  }

  // Update .claude/settings.json
  const settingsPath = path.join(rootDir, '.claude', 'settings.json');
  let settings: Record<string, unknown> = {};

  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch {
      // Start fresh if corrupt
    }
  }

  // Merge hooks configuration (preserve existing hooks)
  const hooks = (settings.hooks || {}) as Record<string, unknown[]>;

  const stopHookEntry = {
    hooks: [{
      type: 'command',
      command: `bash "$CLAUDE_PROJECT_DIR/.claude/hooks/paradigm-stop.sh"`,
      timeout: 10,
    }],
  };

  const preCommitHookEntry = {
    matcher: 'Bash',
    hooks: [{
      type: 'command',
      command: `bash "$CLAUDE_PROJECT_DIR/.claude/hooks/paradigm-precommit.sh"`,
      timeout: 30,
    }],
  };

  // Add Stop hook if not already present
  const stopHooks = (hooks.Stop || []) as Array<Record<string, unknown>>;
  const hasParadigmStop = stopHooks.some(
    (h) => JSON.stringify(h).includes('paradigm-stop.sh'),
  );
  if (!hasParadigmStop) {
    stopHooks.push(stopHookEntry);
  }
  hooks.Stop = stopHooks;

  // Add PreToolUse hook if not already present
  const preToolUseHooks = (hooks.PreToolUse || []) as Array<Record<string, unknown>>;
  const hasParadigmPrecommit = preToolUseHooks.some(
    (h) => JSON.stringify(h).includes('paradigm-precommit.sh'),
  );
  if (!hasParadigmPrecommit) {
    preToolUseHooks.push(preCommitHookEntry);
  }
  hooks.PreToolUse = preToolUseHooks;

  // Add PostToolUse hook (advisory reminder after source edits)
  const postWriteHookEntry = {
    matcher: 'Edit,Write',
    hooks: [{
      type: 'command',
      command: `bash "$CLAUDE_PROJECT_DIR/.claude/hooks/paradigm-postwrite.sh"`,
      timeout: 5,
    }],
  };

  const postToolUseHooks = (hooks.PostToolUse || []) as Array<Record<string, unknown>>;
  const hasParadigmPostwrite = postToolUseHooks.some(
    (h) => JSON.stringify(h).includes('paradigm-postwrite.sh'),
  );
  if (!hasParadigmPostwrite) {
    postToolUseHooks.push(postWriteHookEntry);
  }
  hooks.PostToolUse = postToolUseHooks;

  settings.hooks = hooks;

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');

  if (installed.length > 0) {
    console.log(chalk.green(`Claude Code hooks installed: ${installed.join(', ')}`));
  }
  console.log(chalk.green('Claude Code settings.json updated with hook configuration'));
}

/**
 * Install Cursor hooks (.cursor/hooks/ scripts + hooks.json)
 */
async function installCursorHooks(rootDir: string, force?: boolean): Promise<void> {
  const cursorHooksDir = path.join(rootDir, '.cursor', 'hooks');
  fs.mkdirSync(cursorHooksDir, { recursive: true });

  const installed: string[] = [];

  const hookScripts = [
    { name: 'paradigm-stop.sh', content: CURSOR_STOP_HOOK },
    { name: 'paradigm-precommit.sh', content: CURSOR_PRECOMMIT_HOOK },
    { name: 'paradigm-postwrite.sh', content: CURSOR_POSTWRITE_HOOK },
  ];

  for (const hook of hookScripts) {
    const destPath = path.join(cursorHooksDir, hook.name);

    if (fs.existsSync(destPath) && !force) {
      console.log(chalk.gray(`  ${hook.name}: already installed (Cursor)`));
      continue;
    }

    fs.writeFileSync(destPath, hook.content, 'utf8');
    fs.chmodSync(destPath, '755');
    installed.push(hook.name);
  }

  // Write/merge .cursor/hooks.json
  const hooksJsonPath = path.join(rootDir, '.cursor', 'hooks.json');
  let hooksConfig: Record<string, unknown> = {};

  if (fs.existsSync(hooksJsonPath)) {
    try {
      hooksConfig = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8'));
    } catch {
      // Start fresh if corrupt
    }
  }

  hooksConfig.version = 1;

  const hooks = (hooksConfig.hooks || {}) as Record<string, unknown[]>;

  // Paradigm hook entries
  const paradigmStopEntry = {
    command: '.cursor/hooks/paradigm-stop.sh',
    timeout: 10,
  };
  const paradigmPostwriteEntry = {
    command: '.cursor/hooks/paradigm-postwrite.sh',
    timeout: 5,
  };
  const paradigmPrecommitEntry = {
    command: '.cursor/hooks/paradigm-precommit.sh',
    matcher: 'git commit',
    timeout: 30,
  };

  // Merge stop hooks (preserve non-paradigm entries)
  const stopHooks = (hooks.stop || []) as Array<Record<string, unknown>>;
  const hasParadigmStop = stopHooks.some(
    (h) => JSON.stringify(h).includes('paradigm-stop.sh'),
  );
  if (!hasParadigmStop) {
    stopHooks.push(paradigmStopEntry);
  }
  hooks.stop = stopHooks;

  // Merge afterFileEdit hooks
  const afterFileEditHooks = (hooks.afterFileEdit || []) as Array<Record<string, unknown>>;
  const hasParadigmPostwrite = afterFileEditHooks.some(
    (h) => JSON.stringify(h).includes('paradigm-postwrite.sh'),
  );
  if (!hasParadigmPostwrite) {
    afterFileEditHooks.push(paradigmPostwriteEntry);
  }
  hooks.afterFileEdit = afterFileEditHooks;

  // Merge beforeShellExecution hooks
  const beforeShellHooks = (hooks.beforeShellExecution || []) as Array<Record<string, unknown>>;
  const hasParadigmPrecommit = beforeShellHooks.some(
    (h) => JSON.stringify(h).includes('paradigm-precommit.sh'),
  );
  if (!hasParadigmPrecommit) {
    beforeShellHooks.push(paradigmPrecommitEntry);
  }
  hooks.beforeShellExecution = beforeShellHooks;

  hooksConfig.hooks = hooks;

  fs.writeFileSync(hooksJsonPath, JSON.stringify(hooksConfig, null, 2) + '\n', 'utf8');

  if (installed.length > 0) {
    console.log(chalk.green(`Cursor hooks installed: ${installed.join(', ')}`));
  }
  console.log(chalk.green('Cursor hooks.json updated with hook configuration'));
}

/**
 * paradigm hooks uninstall
 */
export async function hooksUninstallCommand(options: { cursor?: boolean } = {}): Promise<void> {
  const rootDir = process.cwd();

  if (!options.cursor) {
    // Uninstall git hooks
    const gitDir = path.join(rootDir, '.git');

    if (!fs.existsSync(gitDir)) {
      console.log(chalk.red('Not a git repository.'));
      return;
    }

    const hooksDir = path.join(gitDir, 'hooks');
    const removed: string[] = [];

    for (const hookName of ['post-commit', 'pre-push']) {
      const hookPath = path.join(hooksDir, hookName);
      if (fs.existsSync(hookPath)) {
        const content = fs.readFileSync(hookPath, 'utf8');
        if (content.includes('paradigm')) {
          fs.unlinkSync(hookPath);
          removed.push(hookName);
        }
      }
    }

    if (removed.length > 0) {
      console.log(chalk.green(`Git hooks removed: ${removed.join(', ')}`));
    } else {
      console.log(chalk.gray('No paradigm git hooks found to remove'));
    }
  }

  if (options.cursor) {
    // Uninstall Cursor hooks
    const cursorHooksDir = path.join(rootDir, '.cursor', 'hooks');
    const cursorRemoved: string[] = [];

    for (const hookName of ['paradigm-stop.sh', 'paradigm-precommit.sh', 'paradigm-postwrite.sh']) {
      const hookPath = path.join(cursorHooksDir, hookName);
      if (fs.existsSync(hookPath)) {
        fs.unlinkSync(hookPath);
        cursorRemoved.push(hookName);
      }
    }

    // Remove paradigm entries from .cursor/hooks.json
    const hooksJsonPath = path.join(rootDir, '.cursor', 'hooks.json');
    if (fs.existsSync(hooksJsonPath)) {
      try {
        const hooksConfig = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8'));
        const hooks = hooksConfig.hooks || {};

        for (const key of ['stop', 'afterFileEdit', 'beforeShellExecution']) {
          if (Array.isArray(hooks[key])) {
            hooks[key] = hooks[key].filter(
              (h: Record<string, unknown>) => !JSON.stringify(h).includes('paradigm-'),
            );
            if (hooks[key].length === 0) {
              delete hooks[key];
            }
          }
        }

        hooksConfig.hooks = hooks;
        fs.writeFileSync(hooksJsonPath, JSON.stringify(hooksConfig, null, 2) + '\n', 'utf8');
      } catch {
        // Ignore parse errors
      }
    }

    if (cursorRemoved.length > 0) {
      console.log(chalk.green(`Cursor hooks removed: ${cursorRemoved.join(', ')}`));
    } else {
      console.log(chalk.gray('No paradigm Cursor hooks found to remove'));
    }
  }
}

/**
 * paradigm hooks status
 */
export async function hooksStatusCommand(): Promise<void> {
  const rootDir = process.cwd();
  const gitDir = path.join(rootDir, '.git');

  // Git hooks status
  if (fs.existsSync(gitDir)) {
    console.log(chalk.magenta('\n  Git Hooks Status\n'));

    const hooksDir = path.join(gitDir, 'hooks');
    const hooks = ['post-commit', 'pre-push'];

    for (const hookName of hooks) {
      const hookPath = path.join(hooksDir, hookName);
      if (fs.existsSync(hookPath)) {
        const content = fs.readFileSync(hookPath, 'utf8');
        if (content.includes('paradigm')) {
          console.log(chalk.green(`  ${hookName}: installed (paradigm)`));
        } else {
          console.log(chalk.yellow(`  ${hookName}: exists (other)`));
        }
      } else {
        console.log(chalk.gray(`  ${hookName}: not installed`));
      }
    }

    console.log();

    // Check history directory
    const historyDir = path.join(rootDir, '.paradigm/history');
    if (fs.existsSync(historyDir)) {
      const logPath = path.join(historyDir, 'log.jsonl');
      if (fs.existsSync(logPath)) {
        const content = fs.readFileSync(logPath, 'utf8');
        const count = content.split('\n').filter((l) => l.trim()).length;
        console.log(chalk.white(`  History entries: ${count}`));
      }
    } else {
      console.log(chalk.gray('  History: not initialized'));
      console.log(chalk.gray('  Run `paradigm history init` to enable'));
    }
  } else {
    console.log(chalk.gray('\n  Not a git repository (git hooks N/A)\n'));
  }

  // Claude Code hooks status
  console.log(chalk.magenta('  Claude Code Hooks Status\n'));

  const claudeHooksDir = path.join(rootDir, '.claude', 'hooks');
  const claudeHooks = ['paradigm-stop.sh', 'paradigm-precommit.sh', 'paradigm-postwrite.sh'];

  for (const hookName of claudeHooks) {
    const hookPath = path.join(claudeHooksDir, hookName);
    if (fs.existsSync(hookPath)) {
      console.log(chalk.green(`  ${hookName}: installed`));
    } else {
      console.log(chalk.gray(`  ${hookName}: not installed`));
    }
  }

  // Check settings.json
  const settingsPath = path.join(rootDir, '.claude', 'settings.json');
  if (fs.existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      const hooks = settings.hooks || {};
      const hasStop = JSON.stringify(hooks.Stop || []).includes('paradigm-stop.sh');
      const hasPrecommit = JSON.stringify(hooks.PreToolUse || []).includes('paradigm-precommit.sh');
      const hasPostwrite = JSON.stringify(hooks.PostToolUse || []).includes('paradigm-postwrite.sh');
      console.log(chalk.gray(`  settings.json Stop hook: ${hasStop ? 'configured' : 'missing'}`));
      console.log(chalk.gray(`  settings.json PreToolUse hook: ${hasPrecommit ? 'configured' : 'missing'}`));
      console.log(chalk.gray(`  settings.json PostToolUse hook: ${hasPostwrite ? 'configured' : 'missing'}`));
    } catch {
      console.log(chalk.yellow('  settings.json: parse error'));
    }
  } else {
    console.log(chalk.gray('  settings.json: not found'));
  }

  // Cursor hooks status
  console.log(chalk.magenta('\n  Cursor Hooks Status\n'));

  const cursorHooksDir = path.join(rootDir, '.cursor', 'hooks');
  const cursorHooks = ['paradigm-stop.sh', 'paradigm-precommit.sh', 'paradigm-postwrite.sh'];

  for (const hookName of cursorHooks) {
    const hookPath = path.join(cursorHooksDir, hookName);
    if (fs.existsSync(hookPath)) {
      console.log(chalk.green(`  ${hookName}: installed`));
    } else {
      console.log(chalk.gray(`  ${hookName}: not installed`));
    }
  }

  // Check hooks.json
  const cursorHooksJsonPath = path.join(rootDir, '.cursor', 'hooks.json');
  if (fs.existsSync(cursorHooksJsonPath)) {
    try {
      const hooksJson = JSON.parse(fs.readFileSync(cursorHooksJsonPath, 'utf8'));
      const hooks = hooksJson.hooks || {};
      const hasStop = JSON.stringify(hooks.stop || []).includes('paradigm-stop.sh');
      const hasPostwrite = JSON.stringify(hooks.afterFileEdit || []).includes('paradigm-postwrite.sh');
      const hasPrecommit = JSON.stringify(hooks.beforeShellExecution || []).includes('paradigm-precommit.sh');
      console.log(chalk.gray(`  hooks.json stop: ${hasStop ? 'configured' : 'missing'}`));
      console.log(chalk.gray(`  hooks.json afterFileEdit: ${hasPostwrite ? 'configured' : 'missing'}`));
      console.log(chalk.gray(`  hooks.json beforeShellExecution: ${hasPrecommit ? 'configured' : 'missing'}`));
    } catch {
      console.log(chalk.yellow('  hooks.json: parse error'));
    }
  } else {
    console.log(chalk.gray('  hooks.json: not found'));
  }

  console.log();
}
