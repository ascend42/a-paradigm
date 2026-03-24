/**
 * paradigm conductor — Launch the Conductor multimodal overlay
 *
 * Three-tier binary resolution:
 *   1. Installed binary at ~/.paradigm/conductor/bin/conductor
 *   2. Dev binary at packages/conductor/.build/release/conductor (monorepo)
 *   3. Error with install instructions
 *
 * --install: Build and copy binary to ~/.paradigm/conductor/bin/
 */

import { execSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { log } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INSTALLED_BINARY = path.join(os.homedir(), '.paradigm', 'conductor', 'bin', 'conductor');

interface ConductorOptions {
  build?: boolean;
  verbose?: boolean;
  install?: boolean;
}

export async function conductorCommand(options: ConductorOptions): Promise<void> {
  const cmdLog = log.command('conductor');

  // --install: build and copy binary to global location
  if (options.install) {
    await installConductor(options, cmdLog);
    return;
  }

  // Three-tier binary resolution
  const binaryPath = resolveBinary(options, cmdLog);
  if (!binaryPath) {
    return; // resolveBinary already printed the error
  }

  // Force rebuild if --build and we're in monorepo
  if (options.build) {
    const conductorDir = findConductorDir();
    if (conductorDir) {
      buildFromSource(conductorDir, options, cmdLog);
      // After rebuild, use the dev binary
      const devBinary = path.join(conductorDir, '.build', 'release', 'conductor');
      launchBinary(devBinary, cmdLog);
      return;
    } else {
      cmdLog.error('--build requires the Paradigm monorepo');
      console.log(chalk.gray('  Run from inside the a-paradigm repo, or use --install to update the global binary.'));
      process.exit(1);
    }
  }

  launchBinary(binaryPath, cmdLog);
}

// ─────────────────────────────────────────────────────────
// Binary Resolution
// ─────────────────────────────────────────────────────────

function resolveBinary(
  options: ConductorOptions,
  cmdLog: ReturnType<typeof log.command>,
): string | null {
  // Tier 1: Installed binary
  if (fs.existsSync(INSTALLED_BINARY)) {
    return INSTALLED_BINARY;
  }

  // Tier 2: Dev binary in monorepo
  const conductorDir = findConductorDir();
  if (conductorDir) {
    const devBinary = path.join(conductorDir, '.build', 'release', 'conductor');
    if (fs.existsSync(devBinary)) {
      return devBinary;
    }
    // Binary not built yet — build it
    cmdLog.info('Dev binary not found, building…');
    buildFromSource(conductorDir, options, cmdLog);
    if (fs.existsSync(devBinary)) {
      return devBinary;
    }
  }

  // Tier 3: Not found
  cmdLog.error('Conductor binary not found');
  console.log('');
  console.log(chalk.white('  To install Conductor:'));
  console.log(chalk.cyan('    cd <paradigm-repo> && paradigm conductor --install'));
  console.log('');
  console.log(chalk.gray('  This builds the native binary and installs it to ~/.paradigm/conductor/bin/'));
  console.log(chalk.gray('  After that, `paradigm conductor` works from any directory.'));
  console.log('');
  process.exit(1);
  return null;
}

// ─────────────────────────────────────────────────────────
// Install
// ─────────────────────────────────────────────────────────

async function installConductor(
  options: ConductorOptions,
  cmdLog: ReturnType<typeof log.command>,
): Promise<void> {
  const conductorDir = findConductorDir();
  if (!conductorDir) {
    cmdLog.error('Cannot install — not in the Paradigm monorepo');
    console.log(chalk.gray('  Run this command from inside the a-paradigm repository.'));
    process.exit(1);
  }

  const devBinary = path.join(conductorDir, '.build', 'release', 'conductor');

  // Build if needed
  if (!fs.existsSync(devBinary) || options.build) {
    buildFromSource(conductorDir, options, cmdLog);
  }

  if (!fs.existsSync(devBinary)) {
    cmdLog.error('Build did not produce a binary');
    process.exit(1);
  }

  // Copy to global location
  const installDir = path.dirname(INSTALLED_BINARY);
  fs.mkdirSync(installDir, { recursive: true });
  fs.copyFileSync(devBinary, INSTALLED_BINARY);
  fs.chmodSync(INSTALLED_BINARY, 0o755);

  const size = (fs.statSync(INSTALLED_BINARY).size / (1024 * 1024)).toFixed(1);
  cmdLog.success(`Conductor installed (${size} MB)`);
  console.log('');
  console.log(chalk.green('  ✓ ') + chalk.white('Installed to ') + chalk.cyan('~/.paradigm/conductor/bin/conductor'));
  console.log(chalk.green('  ✓ ') + chalk.white('Run ') + chalk.cyan('paradigm conductor') + chalk.white(' from any directory'));
  console.log('');
}

// ─────────────────────────────────────────────────────────
// Build
// ─────────────────────────────────────────────────────────

function buildFromSource(
  conductorDir: string,
  options: ConductorOptions,
  cmdLog: ReturnType<typeof log.command>,
): void {
  cmdLog.info('Building Conductor…');
  try {
    execSync('swift build -c release', {
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

// ─────────────────────────────────────────────────────────
// Launch
// ─────────────────────────────────────────────────────────

function launchBinary(
  binaryPath: string,
  cmdLog: ReturnType<typeof log.command>,
): void {
  cmdLog.info('Launching Conductor…');
  const child = spawn(binaryPath, [], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  const isInstalled = binaryPath === INSTALLED_BINARY;
  console.log(chalk.cyan('\n  Paradigm Conductor is running.'));
  if (isInstalled) {
    console.log(chalk.gray('  Binary: ~/.paradigm/conductor/bin/conductor'));
  }
  console.log(chalk.gray('  Look for the waveform icon in your menu bar.'));
  console.log(chalk.gray('  Quit via the menu bar icon or Cmd+Q.\n'));
}

// ─────────────────────────────────────────────────────────
// Find Source
// ─────────────────────────────────────────────────────────

/**
 * Walk up from the CLI dist dir to find packages/conductor/.
 */
function findConductorDir(): string | null {
  // When running from dist, we're at packages/paradigm/dist/
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

  // Check if cwd itself is the conductor directory
  if (fs.existsSync(path.join(process.cwd(), 'Package.swift'))) {
    const basename = path.basename(process.cwd());
    if (basename === 'conductor') {
      return process.cwd();
    }
  }

  // Walk up from cwd to find monorepo root
  let cwdDir = process.cwd();
  for (let i = 0; i < 5; i++) {
    cwdDir = path.dirname(cwdDir);
    const candidate = path.join(cwdDir, 'packages', 'conductor');
    if (fs.existsSync(path.join(candidate, 'Package.swift'))) {
      return candidate;
    }
  }

  return null;
}
