/**
 * Git Hooks CLI Commands - Automatic history capture
 *
 * Commands:
 * - paradigm hooks install - Install git hooks for history capture
 * - paradigm hooks uninstall - Remove git hooks
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

/**
 * paradigm hooks install
 */
export async function hooksInstallCommand(options: {
  force?: boolean;
  postCommit?: boolean;
  prePush?: boolean;
} = {}): Promise<void> {
  const rootDir = process.cwd();

  // Check if we're in a git repo
  const gitDir = path.join(rootDir, '.git');
  if (!fs.existsSync(gitDir)) {
    console.log(chalk.red('Not a git repository.'));
    return;
  }

  const hooksDir = path.join(gitDir, 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });

  const installAll = !options.postCommit && !options.prePush;
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

/**
 * paradigm hooks uninstall
 */
export async function hooksUninstallCommand(): Promise<void> {
  const rootDir = process.cwd();
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
    console.log(chalk.gray('No paradigm hooks found to remove'));
  }
}

/**
 * paradigm hooks status
 */
export async function hooksStatusCommand(): Promise<void> {
  const rootDir = process.cwd();
  const gitDir = path.join(rootDir, '.git');

  if (!fs.existsSync(gitDir)) {
    console.log(chalk.red('Not a git repository.'));
    return;
  }

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
}
