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
import * as os from 'os';
import { execSync } from 'child_process';
import chalk from 'chalk';
import {
  CLAUDE_CODE_STOP_HOOK,
  CLAUDE_CODE_POSTWRITE_HOOK,
  CLAUDE_CODE_PRECOMMIT_HOOK,
  CURSOR_SESSION_START_HOOK,
  CURSOR_STOP_HOOK,
  CURSOR_POSTWRITE_HOOK,
  CURSOR_PRECOMMIT_HOOK,
  CURSOR_PRETOOLUSE_HOOK,
  CURSOR_POSTTOOLUSE_HOOK,
} from './generated-hooks.js';

/**
 * Detect whether the Paradigm plugin is active in Claude Code.
 * Checks ~/.claude/settings.json for enabledPlugins and verifies the cache exists.
 */
function isParadigmPluginActive(): { active: boolean; cacheVersion?: string } {
  try {
    const globalSettingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    if (!fs.existsSync(globalSettingsPath)) return { active: false };

    const settings = JSON.parse(fs.readFileSync(globalSettingsPath, 'utf8'));
    const enabled = settings.enabledPlugins?.['paradigm@a-paradigm'];
    if (!enabled) return { active: false };

    // Verify the cache actually exists with hooks
    const cacheBase = path.join(os.homedir(), '.claude', 'plugins', 'cache', 'a-paradigm', 'paradigm');
    if (!fs.existsSync(cacheBase)) return { active: false };

    const versions = fs.readdirSync(cacheBase)
      .filter(d => fs.statSync(path.join(cacheBase, d)).isDirectory())
      .sort()
      .reverse();

    if (versions.length === 0) return { active: false };

    const latestCache = path.join(cacheBase, versions[0]);
    const hooksJson = path.join(latestCache, 'hooks', 'hooks.json');
    if (!fs.existsSync(hooksJson)) return { active: false };

    return { active: true, cacheVersion: versions[0] };
  } catch {
    return { active: false };
  }
}

/**
 * Check if the cached plugin version is compatible with the current paradigm version.
 * Reads compatibleVersions from the plugin's hooks.json if available.
 */
function checkPluginVersionCompatibility(): { compatible: boolean; message?: string } {
  try {
    const pluginInfo = isParadigmPluginActive();
    if (!pluginInfo.active || !pluginInfo.cacheVersion) {
      return { compatible: true }; // No plugin, no check needed
    }

    // Read hooks.json from the plugin cache
    const hooksJsonPath = path.join(
      os.homedir(), '.claude', 'plugins', 'cache', 'a-paradigm', 'paradigm',
      pluginInfo.cacheVersion, 'hooks.json'
    );

    if (!fs.existsSync(hooksJsonPath)) {
      return { compatible: true }; // No hooks.json, skip check
    }

    const hooksData = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8'));
    const compatibleVersions = hooksData.compatibleVersions as string | undefined;

    if (!compatibleVersions) {
      return { compatible: true }; // No compatibility field defined
    }

    // Simple semver range check: ">=3.0.0 <4.0.0"
    const currentVersion = getCurrentParadigmVersion();
    if (!currentVersion) {
      return { compatible: true };
    }

    // Parse the range — support ">=X.Y.Z" and "<X.Y.Z"
    const parts = compatibleVersions.split(/\s+/);
    for (const part of parts) {
      const match = part.match(/^(>=?|<=?)\s*(\d+\.\d+\.\d+)/);
      if (!match) continue;
      const [, op, ver] = match;
      const cmp = compareVersions(currentVersion, ver);
      if (op === '>=' && cmp < 0) return { compatible: false, message: `Plugin requires paradigm ${compatibleVersions}, current: ${currentVersion}` };
      if (op === '>' && cmp <= 0) return { compatible: false, message: `Plugin requires paradigm ${compatibleVersions}, current: ${currentVersion}` };
      if (op === '<=' && cmp > 0) return { compatible: false, message: `Plugin requires paradigm ${compatibleVersions}, current: ${currentVersion}` };
      if (op === '<' && cmp >= 0) return { compatible: false, message: `Plugin requires paradigm ${compatibleVersions}, current: ${currentVersion}` };
    }

    return { compatible: true };
  } catch {
    return { compatible: true }; // On error, don't block
  }
}

/** Get current paradigm version from package.json */
function getCurrentParadigmVersion(): string | null {
  try {
    const pkgPath = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg.version || null;
  } catch {
    return null;
  }
}

/** Compare two semver strings. Returns -1, 0, or 1. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
  }
  return 0;
}

/**
 * Remove paradigm project-level Claude Code hooks (scripts + settings.json entries).
 * Called when the plugin is handling hooks instead.
 */
function cleanupProjectClaudeCodeHooks(rootDir: string): { cleaned: boolean; removed: string[] } {
  const removed: string[] = [];

  // Remove hook scripts
  const claudeHooksDir = path.join(rootDir, '.claude', 'hooks');
  if (fs.existsSync(claudeHooksDir)) {
    for (const hookName of ['paradigm-stop.sh', 'paradigm-precommit.sh', 'paradigm-postwrite.sh']) {
      const hookPath = path.join(claudeHooksDir, hookName);
      if (fs.existsSync(hookPath)) {
        fs.unlinkSync(hookPath);
        removed.push(hookName);
      }
    }
    // Remove hooks dir if empty
    try {
      const remaining = fs.readdirSync(claudeHooksDir);
      if (remaining.length === 0) {
        fs.rmdirSync(claudeHooksDir);
      }
    } catch {
      // Not critical
    }
  }

  // Remove paradigm hook entries from settings.json
  const settingsPath = path.join(rootDir, '.claude', 'settings.json');
  if (fs.existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      const hooks = settings.hooks as Record<string, unknown[]> | undefined;

      if (hooks) {
        let modified = false;

        for (const [key, arr] of Object.entries(hooks)) {
          if (!Array.isArray(arr)) continue;
          const filtered = arr.filter(
            (h: unknown) => !JSON.stringify(h).includes('paradigm-'),
          );
          if (filtered.length !== arr.length) {
            modified = true;
            if (filtered.length === 0) {
              delete hooks[key];
            } else {
              hooks[key] = filtered;
            }
          }
        }

        if (modified) {
          // Remove empty hooks object
          if (Object.keys(hooks).length === 0) {
            delete settings.hooks;
          } else {
            settings.hooks = hooks;
          }
          fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
          removed.push('settings.json hooks');
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  return { cleaned: removed.length > 0, removed };
}

/**
 * Validate bash syntax of a hook script using `bash -n`.
 * Returns null on success or an error string on failure.
 */
function validateBashSyntax(scriptContent: string, scriptName: string): string | null {
  try {
    // Write to a temp file and check syntax
    const tmpPath = path.join(os.tmpdir(), `paradigm-hook-validate-${Date.now()}.sh`);
    fs.writeFileSync(tmpPath, scriptContent, 'utf8');
    try {
      execSync(`bash -n "${tmpPath}" 2>&1`, { encoding: 'utf-8' });
      return null; // Syntax OK
    } catch (err) {
      return `${scriptName}: bash syntax error — ${(err as Error).message?.split('\n')[0] || 'unknown error'}`;
    } finally {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  } catch {
    return null; // Can't validate, assume OK
  }
}

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
  claudeCode?: boolean;
  cursor?: boolean;
  dryRun?: boolean;
} = {}): Promise<void> {
  const rootDir = process.cwd();
  const dryRun = options.dryRun || false;

  if (dryRun) {
    console.log(chalk.cyan('\n  [dry-run] Showing what would be installed:\n'));
  }

  const onlyClaudeCode = options.claudeCode && !options.postCommit && !options.prePush && !options.cursor;
  const onlyCursor = options.cursor && !options.postCommit && !options.prePush && !options.claudeCode;

  // Validate hook script syntax before installation
  if (!dryRun) {
    const scriptsToValidate = [
      { name: 'post-commit', content: POST_COMMIT_HOOK },
      { name: 'pre-push', content: PRE_PUSH_HOOK },
      { name: 'claude-code-stop', content: CLAUDE_CODE_STOP_HOOK },
      { name: 'claude-code-precommit', content: CLAUDE_CODE_PRECOMMIT_HOOK },
      { name: 'claude-code-postwrite', content: CLAUDE_CODE_POSTWRITE_HOOK },
      { name: 'cursor-session-start', content: CURSOR_SESSION_START_HOOK },
      { name: 'cursor-stop', content: CURSOR_STOP_HOOK },
      { name: 'cursor-precommit', content: CURSOR_PRECOMMIT_HOOK },
      { name: 'cursor-postwrite', content: CURSOR_POSTWRITE_HOOK },
      { name: 'cursor-pretooluse', content: CURSOR_PRETOOLUSE_HOOK },
      { name: 'cursor-posttooluse', content: CURSOR_POSTTOOLUSE_HOOK },
    ];

    for (const script of scriptsToValidate) {
      const err = validateBashSyntax(script.content, script.name);
      if (err) {
        console.log(chalk.red(`Hook syntax error: ${err}`));
        console.log(chalk.gray('Aborting installation. Fix the hook script and try again.'));
        return;
      }
    }
  }

  // Check plugin version compatibility
  const compat = checkPluginVersionCompatibility();
  if (!compat.compatible) {
    console.log(chalk.yellow(`\n⚠  ${compat.message}`));
    console.log(chalk.gray('  Hook installation will continue, but behavior may differ from plugin expectations.\n'));
  }

  // Install git hooks (unless --claude-code or --cursor was the only flag)
  if (!onlyClaudeCode && !onlyCursor) {
    // Check if we're in a git repo
    const gitDir = path.join(rootDir, '.git');
    if (!fs.existsSync(gitDir)) {
      console.log(chalk.red('Not a git repository.'));
      return;
    }

    const hooksDir = path.join(gitDir, 'hooks');

    const installAllGit = !options.postCommit && !options.prePush && !options.claudeCode;
    const installed: string[] = [];

    // Install post-commit hook
    if (installAllGit || options.postCommit) {
      const hookPath = path.join(hooksDir, 'post-commit');
      if (dryRun) {
        const action = fs.existsSync(hookPath) && !options.force ? 'skip (exists)' : 'install';
        console.log(chalk.gray(`  post-commit: ${action} → ${hookPath}`));
      } else {
        if (fs.existsSync(hookPath) && !options.force) {
          const content = fs.readFileSync(hookPath, 'utf8');
          if (!content.includes('paradigm')) {
            console.log(chalk.yellow('post-commit hook exists. Use --force to overwrite.'));
          } else {
            console.log(chalk.gray('post-commit hook already installed by paradigm'));
          }
        } else {
          fs.mkdirSync(hooksDir, { recursive: true });
          fs.writeFileSync(hookPath, POST_COMMIT_HOOK);
          fs.chmodSync(hookPath, '755');
          installed.push('post-commit');
        }
      }
    }

    // Install pre-push hook
    if (installAllGit || options.prePush) {
      const hookPath = path.join(hooksDir, 'pre-push');
      if (dryRun) {
        const action = fs.existsSync(hookPath) && !options.force ? 'skip (exists)' : 'install';
        console.log(chalk.gray(`  pre-push: ${action} → ${hookPath}`));
      } else {
        if (fs.existsSync(hookPath) && !options.force) {
          const content = fs.readFileSync(hookPath, 'utf8');
          if (!content.includes('paradigm')) {
            console.log(chalk.yellow('pre-push hook exists. Use --force to overwrite.'));
          } else {
            console.log(chalk.gray('pre-push hook already installed by paradigm'));
          }
        } else {
          fs.mkdirSync(hooksDir, { recursive: true });
          fs.writeFileSync(hookPath, PRE_PUSH_HOOK);
          fs.chmodSync(hookPath, '755');
          installed.push('pre-push');
        }
      }
    }

    if (!dryRun && installed.length > 0) {
      console.log(chalk.green(`Git hooks installed: ${installed.join(', ')}`));
    }

    // Initialize history if needed
    const historyDir = path.join(rootDir, '.paradigm/history');
    if (!fs.existsSync(historyDir) && !dryRun) {
      console.log(chalk.gray('Tip: Run `paradigm history init` to initialize history tracking'));
    }
  }

  // Install Claude Code hooks (when --claude-code flag or no specific flags)
  const installAll = !options.postCommit && !options.prePush && !options.claudeCode && !options.cursor;
  if (installAll || options.claudeCode) {
    if (dryRun) {
      console.log(chalk.gray('  Claude Code hooks: would install paradigm-stop.sh, paradigm-precommit.sh, paradigm-postwrite.sh'));
      console.log(chalk.gray(`  → ${path.join(rootDir, '.claude', 'hooks')}/`));
      console.log(chalk.gray('  → Update .claude/settings.json with hook configuration'));
    } else {
      await installClaudeCodeHooks(rootDir, options.force);
    }
  }

  // Install Cursor hooks (when --cursor flag or no specific flags)
  if (installAll || options.cursor) {
    if (dryRun) {
      console.log(chalk.gray('  Cursor hooks: would install paradigm-session-start.sh, paradigm-stop.sh, paradigm-precommit.sh, paradigm-postwrite.sh, paradigm-pretooluse.sh, paradigm-posttooluse.sh'));
      console.log(chalk.gray(`  → ${path.join(rootDir, '.cursor', 'hooks')}/`));
      console.log(chalk.gray('  → Update .cursor/hooks.json'));
    } else {
      await installCursorHooks(rootDir, options.force);
    }
  }

  if (dryRun) {
    console.log(chalk.cyan('\n  [dry-run] No changes made.\n'));
  }
}

/**
 * Install Claude Code hooks (.claude/hooks/ scripts + settings.json)
 *
 * When the Paradigm plugin is active, project-level hooks are unnecessary —
 * the plugin's hooks.json delivers hooks via ${CLAUDE_PLUGIN_ROOT}/scripts/
 * which always resolves to the latest cached version. In that case, we skip
 * installation and clean up any existing stale project hooks.
 */
async function installClaudeCodeHooks(rootDir: string, force?: boolean): Promise<void> {
  // Check if the plugin is handling hooks
  const plugin = isParadigmPluginActive();

  if (plugin.active) {
    console.log(chalk.cyan(`  Paradigm plugin v${plugin.cacheVersion} is active — hooks are managed by the plugin.`));

    // Clean up any stale project-level hooks that would shadow the plugin
    const { cleaned, removed } = cleanupProjectClaudeCodeHooks(rootDir);
    if (cleaned) {
      console.log(chalk.green(`  Cleaned up stale project hooks: ${removed.join(', ')}`));
    } else {
      console.log(chalk.gray('  No stale project hooks to clean up.'));
    }

    console.log(chalk.gray('  Plugin hooks auto-update with each session — no manual install needed.'));
    return;
  }

  // No plugin — install project-level hooks as before
  const claudeHooksDir = path.join(rootDir, '.claude', 'hooks');
  fs.mkdirSync(claudeHooksDir, { recursive: true });

  const installed: string[] = [];

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
    { name: 'paradigm-session-start.sh', content: CURSOR_SESSION_START_HOOK },
    { name: 'paradigm-stop.sh', content: CURSOR_STOP_HOOK },
    { name: 'paradigm-precommit.sh', content: CURSOR_PRECOMMIT_HOOK },
    { name: 'paradigm-postwrite.sh', content: CURSOR_POSTWRITE_HOOK },
    { name: 'paradigm-pretooluse.sh', content: CURSOR_PRETOOLUSE_HOOK },
    { name: 'paradigm-posttooluse.sh', content: CURSOR_POSTTOOLUSE_HOOK },
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
  const paradigmSessionStartEntry = {
    command: '.cursor/hooks/paradigm-session-start.sh',
    timeout: 5,
  };
  const paradigmStopEntry = {
    command: '.cursor/hooks/paradigm-stop.sh',
    timeout: 10,
    loop_limit: 3,
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

  // Merge sessionStart hooks
  const sessionStartHooks = (hooks.sessionStart || []) as Array<Record<string, unknown>>;
  const hasParadigmSessionStart = sessionStartHooks.some(
    (h) => JSON.stringify(h).includes('paradigm-session-start.sh'),
  );
  if (!hasParadigmSessionStart) {
    sessionStartHooks.push(paradigmSessionStartEntry);
  }
  hooks.sessionStart = sessionStartHooks;

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

  // Merge preToolUse hooks (graduated blocking before Edit/Write)
  const paradigmPretoolUseEntry = {
    command: '.cursor/hooks/paradigm-pretooluse.sh',
    matcher: 'Edit|Write',
    timeout: 5,
  };
  const preToolUseHooks = (hooks.preToolUse || []) as Array<Record<string, unknown>>;
  const hasParadigmPretoolUse = preToolUseHooks.some(
    (h) => JSON.stringify(h).includes('paradigm-pretooluse.sh'),
  );
  if (!hasParadigmPretoolUse) {
    preToolUseHooks.push(paradigmPretoolUseEntry);
  }
  hooks.preToolUse = preToolUseHooks;

  // Merge postToolUse hooks (advisory feedback after Edit/Write)
  const paradigmPosttoolUseEntry = {
    command: '.cursor/hooks/paradigm-posttooluse.sh',
    matcher: 'Edit|Write',
    timeout: 5,
  };
  const postToolUseHooks = (hooks.postToolUse || []) as Array<Record<string, unknown>>;
  const hasParadigmPosttoolUse = postToolUseHooks.some(
    (h) => JSON.stringify(h).includes('paradigm-posttooluse.sh'),
  );
  if (!hasParadigmPosttoolUse) {
    postToolUseHooks.push(paradigmPosttoolUseEntry);
  }
  hooks.postToolUse = postToolUseHooks;

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
export async function hooksUninstallCommand(options: { cursor?: boolean; dryRun?: boolean } = {}): Promise<void> {
  const rootDir = process.cwd();
  const dryRun = options.dryRun || false;

  if (dryRun) {
    console.log(chalk.cyan('\n  [dry-run] Showing what would be removed:\n'));
  }

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
          if (dryRun) {
            console.log(chalk.gray(`  Would remove: ${hookPath}`));
          } else {
            fs.unlinkSync(hookPath);
          }
          removed.push(hookName);
        }
      }
    }

    if (!dryRun) {
      if (removed.length > 0) {
        console.log(chalk.green(`Git hooks removed: ${removed.join(', ')}`));
      } else {
        console.log(chalk.gray('No paradigm git hooks found to remove'));
      }
    } else if (removed.length === 0) {
      console.log(chalk.gray('  No paradigm git hooks to remove'));
    }
  }

  if (options.cursor) {
    // Uninstall Cursor hooks
    const cursorHooksDir = path.join(rootDir, '.cursor', 'hooks');
    const cursorRemoved: string[] = [];

    for (const hookName of ['paradigm-session-start.sh', 'paradigm-stop.sh', 'paradigm-precommit.sh', 'paradigm-postwrite.sh', 'paradigm-pretooluse.sh', 'paradigm-posttooluse.sh']) {
      const hookPath = path.join(cursorHooksDir, hookName);
      if (fs.existsSync(hookPath)) {
        if (dryRun) {
          console.log(chalk.gray(`  Would remove: ${hookPath}`));
        } else {
          fs.unlinkSync(hookPath);
        }
        cursorRemoved.push(hookName);
      }
    }

    // Remove paradigm entries from .cursor/hooks.json
    const hooksJsonPath = path.join(rootDir, '.cursor', 'hooks.json');
    if (fs.existsSync(hooksJsonPath)) {
      if (dryRun) {
        console.log(chalk.gray(`  Would clean paradigm entries from: ${hooksJsonPath}`));
      } else {
        try {
          const hooksConfig = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8'));
          const hooks = hooksConfig.hooks || {};

          for (const key of ['sessionStart', 'stop', 'afterFileEdit', 'beforeShellExecution', 'preToolUse', 'postToolUse']) {
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
    }

    if (!dryRun) {
      if (cursorRemoved.length > 0) {
        console.log(chalk.green(`Cursor hooks removed: ${cursorRemoved.join(', ')}`));
      } else {
        console.log(chalk.gray('No paradigm Cursor hooks found to remove'));
      }
    } else if (cursorRemoved.length === 0) {
      console.log(chalk.gray('  No paradigm Cursor hooks to remove'));
    }
  }

  if (dryRun) {
    console.log(chalk.cyan('\n  [dry-run] No changes made.\n'));
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

  const plugin = isParadigmPluginActive();
  if (plugin.active) {
    console.log(chalk.cyan(`  Plugin: paradigm v${plugin.cacheVersion} (active)`));
    console.log(chalk.green('  Hooks are managed by the plugin — auto-updates with each session.'));

    // Warn about stale project hooks that shadow the plugin
    const claudeHooksDir = path.join(rootDir, '.claude', 'hooks');
    const staleHooks: string[] = [];
    for (const hookName of ['paradigm-stop.sh', 'paradigm-precommit.sh', 'paradigm-postwrite.sh']) {
      if (fs.existsSync(path.join(claudeHooksDir, hookName))) {
        staleHooks.push(hookName);
      }
    }

    const settingsPath = path.join(rootDir, '.claude', 'settings.json');
    let hasProjectHookEntries = false;
    if (fs.existsSync(settingsPath)) {
      try {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        hasProjectHookEntries = JSON.stringify(settings.hooks || {}).includes('paradigm-');
      } catch {
        // Ignore
      }
    }

    if (staleHooks.length > 0 || hasProjectHookEntries) {
      console.log(chalk.yellow(`  WARNING: Stale project hooks detected (${staleHooks.join(', ')}${hasProjectHookEntries ? ', settings.json entries' : ''})`));
      console.log(chalk.yellow('  These shadow the plugin hooks and may run outdated logic.'));
      console.log(chalk.gray('  Run `paradigm hooks install --claude-code` to clean them up.'));
    }
  } else {
    console.log(chalk.gray('  Plugin: not active (using project-level hooks)'));

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
  }

  // Cursor hooks status
  console.log(chalk.magenta('\n  Cursor Hooks Status\n'));

  const cursorHooksDir = path.join(rootDir, '.cursor', 'hooks');
  const cursorHooks = ['paradigm-session-start.sh', 'paradigm-stop.sh', 'paradigm-precommit.sh', 'paradigm-postwrite.sh', 'paradigm-pretooluse.sh', 'paradigm-posttooluse.sh'];

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
      const hasSessionStart = JSON.stringify(hooks.sessionStart || []).includes('paradigm-session-start.sh');
      const hasStop = JSON.stringify(hooks.stop || []).includes('paradigm-stop.sh');
      const hasPostwrite = JSON.stringify(hooks.afterFileEdit || []).includes('paradigm-postwrite.sh');
      const hasPrecommit = JSON.stringify(hooks.beforeShellExecution || []).includes('paradigm-precommit.sh');
      const hasPretoolUse = JSON.stringify(hooks.preToolUse || []).includes('paradigm-pretooluse.sh');
      const hasPosttoolUse = JSON.stringify(hooks.postToolUse || []).includes('paradigm-posttooluse.sh');
      console.log(chalk.gray(`  hooks.json sessionStart: ${hasSessionStart ? 'configured' : 'missing'}`));
      console.log(chalk.gray(`  hooks.json stop: ${hasStop ? 'configured' : 'missing'}`));
      console.log(chalk.gray(`  hooks.json afterFileEdit: ${hasPostwrite ? 'configured' : 'missing'}`));
      console.log(chalk.gray(`  hooks.json preToolUse: ${hasPretoolUse ? 'configured' : 'missing'}`));
      console.log(chalk.gray(`  hooks.json postToolUse: ${hasPosttoolUse ? 'configured' : 'missing'}`));
      console.log(chalk.gray(`  hooks.json beforeShellExecution: ${hasPrecommit ? 'configured' : 'missing'}`));
    } catch {
      console.log(chalk.yellow('  hooks.json: parse error'));
    }
  } else {
    console.log(chalk.gray('  hooks.json: not found'));
  }

  console.log();
}
