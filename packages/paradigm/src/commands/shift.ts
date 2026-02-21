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
import * as yaml from 'js-yaml';
import { log } from '../utils/logger.js';
import { initCommand } from './init.js';
import { indexCommand } from './scan/index.js';
import { syncCommand } from './sync.js';
import { doctorCommand } from './doctor.js';
import { teamInitCommand } from './team/index.js';
import { agentsConfigured } from './team/loader.js';
import { hooksInstallCommand } from './hooks/index.js';
import { detectDiscipline } from '../core/discipline.js';

export interface ShiftOptions {
  force?: boolean;
  quick?: boolean;
  verify?: boolean;
  ide?: string;
  /** Force model configuration prompts during team init */
  configureModels?: boolean;
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
    spinner.start('Step 1/6: Initializing Paradigm...');
    try {
      await initCommand({
        force: options.force,
        quick: true, // We'll scan separately for better UX
        name: projectName,
      });
      spinner.succeed(chalk.green('Paradigm initialized'));
    } catch (error) {
      spinner.fail(chalk.red(`Init failed: ${(error as Error).message}`));
      tracker.error('Shift failed at init', { error: (error as Error).message });
      return;
    }
  } else {
    spinner.succeed(chalk.gray('Step 1/6: Already initialized (use --force to reinit)'));

    // If already initialized, check if discipline is still 'auto' and offer to set it
    const configPath = path.join(paradigmDir, 'config.yaml');
    if (fs.existsSync(configPath)) {
      try {
        const configContent = fs.readFileSync(configPath, 'utf8');
        const config = yaml.load(configContent) as Record<string, unknown>;
        if (!config.discipline || config.discipline === 'auto') {
          const detected = detectDiscipline(cwd);
          if (detected !== 'backend') {
            // Update config.yaml with detected discipline
            const updated = configContent.replace(
              /^discipline:\s*auto\b.*$/m,
              `discipline: ${detected}`
            );
            if (updated !== configContent) {
              fs.writeFileSync(configPath, updated, 'utf8');
              console.log(chalk.green(`  ✓ Detected discipline: ${chalk.cyan(detected)} (updated config.yaml)`));
            }
          } else if (!config.discipline) {
            // No discipline field at all — add it after the project line
            const withDiscipline = configContent.replace(
              /^(project:\s*.+)$/m,
              `$1\ndiscipline: ${detected}`
            );
            if (withDiscipline !== configContent) {
              fs.writeFileSync(configPath, withDiscipline, 'utf8');
              console.log(chalk.green(`  ✓ Added discipline: ${chalk.cyan(detected)} to config.yaml`));
            }
          }
        }
      } catch {
        // Non-fatal — continue shift
      }
    }
  }

  // Step 2: Team init (if needed)
  // Always run interactive model configuration — it's a fun step in the setup process
  const teamConfigured = agentsConfigured(cwd);
  if (!teamConfigured || options.force) {
    console.log(chalk.cyan('  Step 2/6: Initializing team configuration...'));
    try {
      await teamInitCommand(cwd, {
        force: options.force,
        json: false,
        configureModels: true,
        noConfigureModels: false,
      });
      console.log(chalk.green('  ✓ Team configuration initialized\n'));
    } catch (error) {
      console.log(chalk.yellow(`  ⚠ Team init warning: ${(error as Error).message}\n`));
    }
  } else {
    spinner.succeed(chalk.gray('Step 2/6: Team already configured (use --force to reinit)'));
  }

  // Step 3: Scan/Index
  if (!options.quick) {
    spinner.start('Step 3/6: Scanning and indexing symbols...');
    try {
      await indexCommand(cwd, { quiet: true });
      spinner.succeed(chalk.green('Symbols indexed'));
    } catch (error) {
      spinner.warn(chalk.yellow(`Scan warning: ${(error as Error).message}`));
      // Don't fail - scan is optional
    }
  } else {
    spinner.succeed(chalk.gray('Step 3/6: Skipped scan (--quick mode)'));
  }

  // Ensure .paradigm/lore/ directory exists
  const lorePath = path.join(cwd, '.paradigm', 'lore');
  if (!fs.existsSync(lorePath)) {
    fs.mkdirSync(lorePath, { recursive: true });
  }

  // Step 4: Sync all IDEs
  // Always generate both CLAUDE.md and .cursor/rules/ since users often have multiple AI tools
  spinner.start('Step 4/6: Syncing IDE configurations...');
  try {
    const ideTargets = options.ide ? [options.ide] : ['claude', 'cursor', 'copilot', 'windsurf', 'agents'];
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

  // Step 5: Install hooks (git + Claude Code)
  spinner.start('Step 5/6: Installing hooks...');
  try {
    await hooksInstallCommand({ force: options.force });
    spinner.succeed(chalk.green('Hooks installed (git + Claude Code + Cursor)'));
  } catch (error) {
    spinner.warn(chalk.yellow(`Hooks warning: ${(error as Error).message}`));
  }

  // Step 6: Doctor (verify)
  if (options.verify) {
    spinner.start('Step 6/6: Running health checks...');
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
    spinner.succeed(chalk.gray('Step 6/6: Skipped verify (use --verify to check health)'));
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
    { path: '.paradigm/agents.yaml', desc: 'Team agent configuration' },
    { path: '.purpose', desc: 'Root feature definitions' },
    { path: '.paradigm/lore/', desc: 'Project lore timeline', isDir: true },
    { path: 'portal.yaml', desc: 'Authorization gates', optional: true },
    { path: 'CLAUDE.md', desc: 'Claude Code AI instructions' },
    { path: 'AGENTS.md', desc: 'Universal AI agent instructions' },
    { path: '.cursor/rules/', desc: 'Cursor AI instructions', isDir: true },
    { path: '.claude/hooks/', desc: 'Claude Code enforcement hooks', isDir: true, optional: true },
    { path: '.cursor/hooks/', desc: 'Cursor enforcement hooks', isDir: true, optional: true },
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
  console.log(chalk.cyan('  • ') + chalk.white('Record lore entries to capture work history'));
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
