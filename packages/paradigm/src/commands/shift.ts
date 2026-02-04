/**
 * paradigm shift - Single command to fully initialize/sync a project
 *
 * Combines: init → scan → sync (all IDEs) → doctor
 *
 * Usage:
 *   paradigm shift              # Full setup for new or existing project
 *   paradigm shift --verify     # Also run verification checks
 *   paradigm shift --quick      # Skip slow operations
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { log } from '../utils/logger.js';
import { initCommand } from './init.js';
import { indexCommand } from './scan/index.js';
import { syncCommand } from './sync.js';
import { doctorCommand } from './doctor.js';

export interface ShiftOptions {
  force?: boolean;
  quick?: boolean;
  verify?: boolean;
  ide?: string;
}

export async function shiftCommand(options: ShiftOptions = {}) {
  const cwd = process.cwd();
  const projectName = path.basename(cwd);
  const paradigmDir = path.join(cwd, '.paradigm');
  const isInitialized = fs.existsSync(paradigmDir) && fs.statSync(paradigmDir).isDirectory();

  console.log(chalk.blue('\n┌─────────────────────────────────────────────────┐'));
  console.log(chalk.blue('│') + chalk.white.bold('  paradigm shift                                 ') + chalk.blue('│'));
  console.log(chalk.blue('│') + chalk.gray('  Full project setup in one command              ') + chalk.blue('│'));
  console.log(chalk.blue('└─────────────────────────────────────────────────┘\n'));

  console.log(chalk.white(`  📁 Project: ${chalk.cyan(projectName)}`));
  console.log(chalk.white(`  📍 Status: ${isInitialized ? chalk.green('Paradigm detected') : chalk.yellow('New project')}`));
  console.log('');

  const tracker = log.command('shift').start('Running paradigm shift', { project: projectName });

  // Step 1: Init (if needed)
  const spinner = ora();

  if (!isInitialized || options.force) {
    spinner.start('Step 1/4: Initializing Paradigm...');
    try {
      await initCommand({
        force: options.force,
        quick: true, // We'll scan separately for better UX
        name: projectName,
      });
      spinner.succeed(chalk.green('Paradigm initialized'));
    } catch (error) {
      spinner.fail(chalk.red(`Init failed: ${(error as Error).message}`));
      tracker.failure('Shift failed at init', { error: (error as Error).message });
      return;
    }
  } else {
    spinner.succeed(chalk.gray('Step 1/4: Already initialized (use --force to reinit)'));
  }

  // Step 2: Scan/Index
  if (!options.quick) {
    spinner.start('Step 2/4: Scanning and indexing symbols...');
    try {
      await indexCommand(cwd, { quiet: true });
      spinner.succeed(chalk.green('Symbols indexed'));
    } catch (error) {
      spinner.warn(chalk.yellow(`Scan warning: ${(error as Error).message}`));
      // Don't fail - scan is optional
    }
  } else {
    spinner.succeed(chalk.gray('Step 2/4: Skipped scan (--quick mode)'));
  }

  // Step 3: Sync all IDEs
  // Always generate both CLAUDE.md and .cursor/rules/ since users often have multiple AI tools
  spinner.start('Step 3/4: Syncing IDE configurations...');
  try {
    const ideTargets = options.ide ? [options.ide] : ['claude', 'cursor', 'copilot', 'windsurf'];
    const syncResults: string[] = [];

    for (const ide of ideTargets) {
      try {
        await syncCommand(ide, { quiet: true, force: true });
        syncResults.push(ide);
      } catch {
        // Some IDEs may not be configured, that's fine
      }
    }

    if (syncResults.length > 0) {
      spinner.succeed(chalk.green(`IDE configs synced: ${syncResults.join(', ')}`));
    } else {
      spinner.warn(chalk.yellow('No IDE configs to sync'));
    }
  } catch (error) {
    spinner.warn(chalk.yellow(`Sync warning: ${(error as Error).message}`));
  }

  // Step 4: Doctor (verify)
  if (options.verify) {
    spinner.start('Step 4/4: Running health checks...');
    try {
      const healthy = await doctorCommand({ quiet: true });
      if (healthy) {
        spinner.succeed(chalk.green('All health checks passed'));
      } else {
        spinner.warn(chalk.yellow('Some health checks need attention'));
      }
    } catch (error) {
      spinner.warn(chalk.yellow(`Doctor warning: ${(error as Error).message}`));
    }
  } else {
    spinner.succeed(chalk.gray('Step 4/4: Skipped verify (use --verify to check health)'));
  }

  // Summary
  console.log('');
  console.log(chalk.blue('┌─────────────────────────────────────────────────┐'));
  console.log(chalk.blue('│') + chalk.white.bold('  ✨ Paradigm shift complete!                    ') + chalk.blue('│'));
  console.log(chalk.blue('└─────────────────────────────────────────────────┘'));
  console.log('');

  // Show what was created/updated
  console.log(chalk.white('  Created/Updated:'));
  console.log(chalk.gray('  ─────────────────────────────────────────────────'));

  const files = [
    { path: '.paradigm/config.yaml', desc: 'Project configuration' },
    { path: '.paradigm/navigator.yaml', desc: 'Symbol navigation map' },
    { path: '.purpose', desc: 'Root feature definitions' },
    { path: 'portal.yaml', desc: 'Authorization gates', optional: true },
    { path: 'CLAUDE.md', desc: 'Claude Code AI instructions' },
    { path: '.cursor/rules/', desc: 'Cursor AI instructions', isDir: true },
  ];

  for (const file of files) {
    const fullPath = path.join(cwd, file.path);
    if (fs.existsSync(fullPath)) {
      console.log(chalk.green('  ✓ ') + chalk.white(file.path.padEnd(28)) + chalk.gray(file.desc));
    } else if (!file.optional) {
      console.log(chalk.yellow('  ○ ') + chalk.gray(file.path.padEnd(28)) + chalk.gray(`(${file.desc})`));
    }
  }

  console.log('');
  console.log(chalk.white('  AI agents will now:'));
  console.log(chalk.gray('  ─────────────────────────────────────────────────'));
  console.log(chalk.cyan('  • ') + chalk.white('Use MCP tools for navigation (paradigm_search, etc.)'));
  console.log(chalk.cyan('  • ') + chalk.white('Check .purpose files before modifying features'));
  console.log(chalk.cyan('  • ') + chalk.white('Update Paradigm files when making structural changes'));
  console.log(chalk.cyan('  • ') + chalk.white('Follow antipatterns and team preferences'));
  console.log('');

  console.log(chalk.white('  Next steps:'));
  console.log(chalk.gray('  ─────────────────────────────────────────────────'));
  console.log(chalk.white('  1. ') + chalk.gray('Edit ') + chalk.cyan('.purpose') + chalk.gray(' to define your features'));
  console.log(chalk.white('  2. ') + chalk.gray('Create ') + chalk.cyan('portal.yaml') + chalk.gray(' if you have authorization'));
  console.log(chalk.white('  3. ') + chalk.gray('Add ') + chalk.cyan('.purpose') + chalk.gray(' files to feature directories'));
  console.log(chalk.white('  4. ') + chalk.gray('Run ') + chalk.cyan('paradigm shift --verify') + chalk.gray(' to check health'));
  console.log('');

  tracker.success('Paradigm shift complete', { project: projectName });
}
