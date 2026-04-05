/**
 * paradigm conductor — Launch the Conductor multimodal overlay
 *
 * Auto-install flow:
 *   1. OS check — macOS only
 *   2. Binary exists at ~/.paradigm/conductor/bin/conductor → launch immediately
 *   3. Binary missing → auto-install:
 *      a. Monorepo found → build from source → install → launch
 *      b. No monorepo → download pre-compiled binary from GitHub releases → launch
 *      c. Nothing worked → clear error with manual instructions
 *
 * Flags:
 *   --install  Force reinstall (rebuild or re-download even if already installed)
 *   --build    Force source rebuild (requires Paradigm monorepo + Swift toolchain)
 */

import { execSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as https from 'node:https';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { log } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INSTALLED_BINARY = path.join(os.homedir(), '.paradigm', 'conductor', 'bin', 'conductor');
const GITHUB_REPO = 'ascend42/a-paradigm';

interface ConductorOptions {
  build?: boolean;
  verbose?: boolean;
  install?: boolean;
}

export async function conductorCommand(options: ConductorOptions): Promise<void> {
  const cmdLog = log.command('conductor');

  // ── 1. OS check ──────────────────────────────────────────────────────────
  if (process.platform !== 'darwin') {
    cmdLog.error('Conductor is macOS only');
    console.log(chalk.gray('  Conductor is a native macOS overlay app (macOS 14 Sonoma or later).'));
    console.log(chalk.gray('  It is not available on ' + process.platform + '.'));
    process.exit(1);
  }

  // ── 2. Force rebuild ──────────────────────────────────────────────────────
  if (options.build) {
    const conductorDir = findConductorDir();
    if (!conductorDir) {
      cmdLog.error('--build requires the Paradigm monorepo');
      printCloneInstructions();
      process.exit(1);
    }
    buildFromSource(conductorDir, options, cmdLog);
    copyToInstalled(conductorDir, cmdLog);
    launchBinary(INSTALLED_BINARY, cmdLog);
    return;
  }

  // ── 3. Already installed → just launch (unless --install forces reinstall) ─
  if (!options.install && fs.existsSync(INSTALLED_BINARY)) {
    launchBinary(INSTALLED_BINARY, cmdLog);
    return;
  }

  // ── 4. Not installed (or --install) → auto-install ───────────────────────
  if (options.install) {
    console.log(chalk.cyan('\n  Reinstalling Conductor…\n'));
  } else {
    console.log(chalk.cyan('\n  Conductor not installed. Installing now…\n'));
  }

  const installed = await autoInstall(options, cmdLog);
  if (!installed) {
    process.exit(1);
  }

  // ── 5. Launch after install ───────────────────────────────────────────────
  launchBinary(INSTALLED_BINARY, cmdLog);
}

// ─────────────────────────────────────────────────────────
// Auto-install: monorepo build → GitHub download → error
// ─────────────────────────────────────────────────────────

async function autoInstall(
  options: ConductorOptions,
  cmdLog: ReturnType<typeof log.command>,
): Promise<boolean> {
  // Path A: build from monorepo source
  const conductorDir = findConductorDir();
  if (conductorDir) {
    cmdLog.info('Paradigm monorepo found — building from source…');
    try {
      buildFromSource(conductorDir, options, cmdLog);
      copyToInstalled(conductorDir, cmdLog);
      return true;
    } catch {
      cmdLog.warn('Source build failed, trying binary download…');
    }
  }

  // Path B: download pre-compiled binary from GitHub releases
  const downloaded = await downloadBinary(cmdLog);
  if (downloaded) {
    return true;
  }

  // Path C: nothing worked
  console.log('');
  console.log(chalk.red('  Could not install Conductor automatically.'));
  console.log('');
  console.log(chalk.white('  Option 1 — Clone the repo and install:'));
  printCloneInstructions();
  console.log(chalk.white('  Option 2 — Check GitHub releases for a pre-compiled binary:'));
  console.log(chalk.gray(`    https://github.com/${GITHUB_REPO}/releases`));
  console.log('');
  return false;
}

// ─────────────────────────────────────────────────────────
// Build from source
// ─────────────────────────────────────────────────────────

function buildFromSource(
  conductorDir: string,
  options: ConductorOptions,
  cmdLog: ReturnType<typeof log.command>,
): void {
  cmdLog.info('Building Conductor (this takes ~30s)…');
  try {
    execSync('swift build -c release', {
      cwd: conductorDir,
      stdio: options.verbose ? 'inherit' : 'pipe',
    });
    cmdLog.success('Build complete');
  } catch (error) {
    const errMsg = (error as Error).message || '';
    if (errMsg.includes('xcode-select') || errMsg.includes('xcrun') || errMsg.includes('no developer')) {
      console.log('');
      console.log(chalk.yellow('  Xcode Command Line Tools are required to build Conductor.'));
      console.log(chalk.gray('  Install with: ') + chalk.cyan('xcode-select --install'));
      console.log(chalk.gray('  Then re-run: ') + chalk.cyan('paradigm conductor'));
      console.log('');
    } else if (options.verbose) {
      console.log(chalk.gray(`  ${errMsg.slice(0, 400)}`));
    }
    throw error;
  }
}

function copyToInstalled(
  conductorDir: string,
  cmdLog: ReturnType<typeof log.command>,
): void {
  // SwiftPM output uses capital C for the target name
  const devBinary = path.join(conductorDir, '.build', 'release', 'Conductor');
  const devBinaryLower = path.join(conductorDir, '.build', 'release', 'conductor');
  const src = fs.existsSync(devBinary) ? devBinary : devBinaryLower;

  if (!fs.existsSync(src)) {
    throw new Error('Build did not produce a binary');
  }

  const installDir = path.dirname(INSTALLED_BINARY);
  fs.mkdirSync(installDir, { recursive: true });
  fs.copyFileSync(src, INSTALLED_BINARY);
  fs.chmodSync(INSTALLED_BINARY, 0o755);

  const size = (fs.statSync(INSTALLED_BINARY).size / (1024 * 1024)).toFixed(1);
  cmdLog.success(`Conductor installed (${size} MB)`);
  console.log(chalk.green('  ✓ ') + chalk.gray('~/.paradigm/conductor/bin/conductor'));
  console.log('');
}

// ─────────────────────────────────────────────────────────
// Download pre-compiled binary from GitHub releases
// ─────────────────────────────────────────────────────────

async function downloadBinary(cmdLog: ReturnType<typeof log.command>): Promise<boolean> {
  const arch = os.arch() === 'arm64' ? 'arm64' : 'x86_64';
  const url = `https://github.com/${GITHUB_REPO}/releases/latest/download/conductor-${arch}`;

  cmdLog.info(`Downloading Conductor binary (${arch})…`);

  try {
    await downloadFile(url, INSTALLED_BINARY);
    fs.chmodSync(INSTALLED_BINARY, 0o755);
    const size = (fs.statSync(INSTALLED_BINARY).size / (1024 * 1024)).toFixed(1);
    cmdLog.success(`Conductor downloaded (${size} MB)`);
    console.log(chalk.green('  ✓ ') + chalk.gray('~/.paradigm/conductor/bin/conductor'));
    console.log('');
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('404') || msg.includes('Not Found')) {
      cmdLog.warn('No pre-compiled binary available for this release');
    } else {
      cmdLog.warn(`Download failed: ${msg}`);
    }
    return false;
  }
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const installDir = path.dirname(dest);
    fs.mkdirSync(installDir, { recursive: true });

    const follow = (targetUrl: string, redirects = 0): void => {
      if (redirects > 5) {
        reject(new Error('Too many redirects'));
        return;
      }
      https.get(targetUrl, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
          const location = res.headers.location;
          if (!location) {
            reject(new Error('Redirect with no Location header'));
            return;
          }
          res.resume();
          follow(location, redirects + 1);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
        file.on('error', (e) => {
          fs.unlink(dest, () => {});
          reject(e);
        });
      }).on('error', reject);
    };

    follow(url);
  });
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
  console.log(chalk.cyan('\n  Paradigm Conductor is running.'));
  console.log(chalk.gray('  Look for the waveform icon in your menu bar.'));
  console.log(chalk.gray('  To reinstall: paradigm conductor --install\n'));
}

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

function printCloneInstructions(): void {
  console.log('');
  console.log(chalk.gray('    git clone https://github.com/ascend42/a-paradigm.git'));
  console.log(chalk.gray('    cd a-paradigm'));
  console.log(chalk.gray('    paradigm conductor'));
  console.log('');
}

/**
 * Walk up from the CLI dist dir (or cwd) to find packages/conductor/.
 */
function findConductorDir(): string | null {
  // Walk up from CLI dist directory (works in monorepo dev)
  let dir = path.resolve(__dirname, '..');
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, 'packages', 'conductor');
    if (fs.existsSync(path.join(candidate, 'Package.swift'))) {
      return candidate;
    }
    dir = path.dirname(dir);
  }

  // Walk up from cwd (works when user is inside the cloned repo)
  let cwdDir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(cwdDir, 'packages', 'conductor');
    if (fs.existsSync(path.join(candidate, 'Package.swift'))) {
      return candidate;
    }
    // Check if cwd itself is the conductor directory
    if (fs.existsSync(path.join(cwdDir, 'Package.swift')) && path.basename(cwdDir) === 'conductor') {
      return cwdDir;
    }
    cwdDir = path.dirname(cwdDir);
  }

  return null;
}
