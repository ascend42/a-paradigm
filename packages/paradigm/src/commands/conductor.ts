/**
 * paradigm conductor — Launch the Conductor multimodal overlay
 *
 * Builds (if needed) and launches the native macOS Conductor app
 * from packages/conductor/.
 */

import { execSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { log } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ConductorOptions {
  build?: boolean;
  verbose?: boolean;
}

export async function conductorCommand(options: ConductorOptions): Promise<void> {
  const cmdLog = log.command('conductor');

  // Locate the conductor package relative to this CLI
  const conductorDir = findConductorDir();
  if (!conductorDir) {
    cmdLog.error('Could not locate packages/conductor/');
    console.log(chalk.gray('  Ensure the Paradigm monorepo is intact.'));
    process.exit(1);
  }

  const buildDir = path.join(conductorDir, '.build', 'release');
  const binaryPath = path.join(buildDir, 'conductor');
  const needsBuild = options.build || !fs.existsSync(binaryPath);

  // Build if needed
  if (needsBuild) {
    cmdLog.info('Building Conductor…');
    try {
      const buildCmd = 'swift build -c release';
      execSync(buildCmd, {
        cwd: conductorDir,
        stdio: options.verbose ? 'inherit' : 'pipe',
      });
      cmdLog.success('Build complete');
    } catch (error) {
      cmdLog.error('Build failed');
      const errMsg = (error as Error).message || '';
      if (errMsg.includes('xcode-select')) {
        console.log(chalk.gray('  Xcode Command Line Tools are required.'));
        console.log(chalk.gray('  Install with: xcode-select --install'));
      } else {
        console.log(chalk.gray(`  ${errMsg.slice(0, 200)}`));
      }
      process.exit(1);
    }
  }

  // Launch
  cmdLog.info('Launching Conductor…');
  const child = spawn(binaryPath, [], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  console.log(chalk.cyan('\n  Paradigm Conductor is running.'));
  console.log(chalk.gray('  Look for the waveform icon in your menu bar.'));
  console.log(chalk.gray('  Quit via the menu bar icon or Cmd+Q.\n'));
}

/**
 * Walk up from the CLI dist dir to find packages/conductor/.
 */
function findConductorDir(): string | null {
  // When running from dist, we're at packages/paradigm/dist/
  // Walk up to find the monorepo root
  let dir = path.resolve(__dirname, '..');
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, 'packages', 'conductor');
    if (fs.existsSync(path.join(candidate, 'Package.swift'))) {
      return candidate;
    }
    dir = path.dirname(dir);
  }

  // Also try cwd-based resolution
  const cwdCandidate = path.join(process.cwd(), 'packages', 'conductor');
  if (fs.existsSync(path.join(cwdCandidate, 'Package.swift'))) {
    return cwdCandidate;
  }

  return null;
}
