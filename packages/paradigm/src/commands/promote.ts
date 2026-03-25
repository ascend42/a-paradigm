/**
 * paradigm promote - Copy local build to production (~/.paradigm-cli/)
 *
 * Since `npm install -g` created symlinks to the dist/ files,
 * updating them in ~/.paradigm-cli/ immediately updates the global binaries.
 *
 * Steps:
 * 1. Validate we're in the paradigm source repo
 * 2. Run `npm run build` (unless --skip-build)
 * 3. Copy dist/ directories to ~/.paradigm-cli/
 * 4. Switch MCP configs back to prod mode
 * 5. Verify with version check
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import chalk from 'chalk';
import ora from 'ora';
import { out, success, warn, error as cliError, dim, header, json as cliJson } from '../utils/cli-output.js';

// ============================================================================
// Types
// ============================================================================

export interface PromoteOptions {
  force?: boolean;
  skipBuild?: boolean;
  json?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const PARADIGM_CLI_DIR = path.join(os.homedir(), '.paradigm-cli');

/** Package directories to copy */
const PACKAGES_TO_COPY = [
  'packages/paradigm/dist',
  'packages/paradigm/lore-ui/dist',
  'packages/paradigm-mcp/dist',
  'packages/premise/core/dist',
  'packages/portal/core/dist',
  'packages/purpose/core/dist',
  'packages/sentinel/dist',
];

// ============================================================================
// Helpers
// ============================================================================

/**
 * Find the paradigm source root from CWD
 */
function findSourceRoot(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (
      fs.existsSync(path.join(dir, 'packages', 'paradigm', 'package.json')) &&
      fs.existsSync(path.join(dir, 'packages', 'paradigm-mcp', 'package.json'))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Copy a directory recursively
 */
function copyDirRecursive(src: string, dest: string): { files: number; errors: string[] } {
  let files = 0;
  const errors: string[] = [];

  if (!fs.existsSync(src)) {
    errors.push(`Source not found: ${src}`);
    return { files, errors };
  }

  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    try {
      if (entry.isDirectory()) {
        const sub = copyDirRecursive(srcPath, destPath);
        files += sub.files;
        errors.push(...sub.errors);
      } else {
        fs.copyFileSync(srcPath, destPath);
        files++;
      }
    } catch (err) {
      errors.push(`Failed to copy ${srcPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { files, errors };
}

// ============================================================================
// Command
// ============================================================================

export async function promoteCommand(options: PromoteOptions): Promise<void> {
  const spinner = ora();

  // 1. Validate source repo
  const sourceRoot = findSourceRoot();
  if (!sourceRoot) {
    if (options.json) {
      cliJson({ error: 'Not in paradigm source repo' });
    } else {
      cliError('Not in the paradigm source repository.');
      dim('Run this command from the a-paradigm directory.\n');
    }
    return;
  }

  // 2. Check production directory
  if (!fs.existsSync(PARADIGM_CLI_DIR)) {
    if (!options.force) {
      if (options.json) {
        cliJson({ error: 'Production directory not found', path: PARADIGM_CLI_DIR });
      } else {
        cliError(`Production directory not found: ${PARADIGM_CLI_DIR}`);
        dim('Paradigm CLI may not be globally installed.');
        dim('Install with: curl -fsSL https://a-company.org/install | bash\n');
      }
      return;
    }
    fs.mkdirSync(PARADIGM_CLI_DIR, { recursive: true });
  }

  if (!options.json) {
    header('📦 Promoting local build to production');
    out('');
    dim(`  Source: ${sourceRoot}`);
    dim(`  Target: ${PARADIGM_CLI_DIR}\n`);
  }

  // 3. Build (unless skipped)
  if (!options.skipBuild) {
    spinner.start('Building packages...');
    try {
      execSync('npm run build', {
        cwd: sourceRoot,
        stdio: 'pipe',
        timeout: 120_000,
      });
      spinner.succeed('Build complete');
    } catch (err) {
      spinner.fail('Build failed');
      if (options.json) {
        cliJson({
          error: 'Build failed',
          details: err instanceof Error ? err.message : String(err),
        });
      } else {
        cliError(`${err instanceof Error ? err.message : err}`);
        dim('Fix build errors and try again, or use --skip-build.\n');
      }
      return;
    }
  }

  // 4. Copy dist directories
  spinner.start('Copying dist/ to production...');
  let totalFiles = 0;
  const allErrors: string[] = [];
  const copiedPackages: string[] = [];

  for (const pkg of PACKAGES_TO_COPY) {
    const srcDir = path.join(sourceRoot, pkg);
    const destDir = path.join(PARADIGM_CLI_DIR, pkg);

    if (!fs.existsSync(srcDir)) {
      continue; // Skip packages that don't have dist yet
    }

    const { files, errors } = copyDirRecursive(srcDir, destDir);
    totalFiles += files;
    allErrors.push(...errors);

    if (errors.length === 0 && files > 0) {
      copiedPackages.push(pkg);
    }
  }

  if (allErrors.length > 0) {
    spinner.warn(`Copied with ${allErrors.length} error(s)`);
  } else {
    spinner.succeed(`Copied ${totalFiles} files`);
  }

  // 5. Switch MCP configs back to prod
  spinner.start('Switching MCP configs to PROD...');
  try {
    const { mcpUseProdCommand } = await import('./mcp/switch.js');
    await mcpUseProdCommand({ json: true });
    spinner.succeed('MCP configs switched to PROD');
  } catch {
    spinner.info('MCP config switch skipped (no configs found)');
  }

  // 6. Verify version
  let version = 'unknown';
  try {
    version = execSync('paradigm --version', { encoding: 'utf-8', timeout: 5000 }).trim();
  } catch {
    // Version check is best-effort
  }

  // Output
  if (options.json) {
    cliJson({
      success: allErrors.length === 0,
      source: sourceRoot,
      target: PARADIGM_CLI_DIR,
      packages: copiedPackages,
      totalFiles,
      errors: allErrors,
      version,
    });
  } else {
    out('');
    if (allErrors.length === 0) {
      success('Promotion complete!\n');
    } else {
      warn(`Promotion completed with ${allErrors.length} error(s)\n`);
      for (const err of allErrors.slice(0, 5)) {
        cliError(`  ${err}`);
      }
      out('');
    }

    dim(`  Packages: ${copiedPackages.length}`);
    dim(`  Files:    ${totalFiles}`);
    dim(`  Version:  ${version}`);
    out('');
  }
}
