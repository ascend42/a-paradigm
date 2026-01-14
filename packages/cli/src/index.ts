#!/usr/bin/env node

/**
 * Horizon CLI - Unified command-line interface
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { initCommand } from './commands/init.js';
import { visualizeCommand } from './commands/visualize.js';
import { statusCommand } from './commands/status.js';

const VERSION = '0.1.0';

const program = new Command();

// ASCII art banner
const banner = `
${chalk.blue('╦ ╦')}${chalk.cyan('┌─┐┬─┐┬┌─┐┌─┐┌┐┌')}
${chalk.blue('╠═╣')}${chalk.cyan('│ │├┬┘│┌─┘│ ││││')}
${chalk.blue('╩ ╩')}${chalk.cyan('└─┘┴└─┴└─┘└─┘┘└┘')} ${chalk.gray(`v${VERSION}`)}
`;

program
  .name('horizon')
  .description('Unified developer tools ecosystem')
  .version(VERSION)
  .addHelpText('before', banner);

// horizon init
program
  .command('init')
  .description('Initialize Horizon in the current project')
  .option('-f, --force', 'Overwrite existing files')
  .option('--name <name>', 'Project name for .dream file')
  .action(initCommand);

// horizon setup
program
  .command('setup [path]')
  .description('Interactive setup wizard for Horizon')
  .option('-y, --yes', 'Accept all defaults (non-interactive)')
  .option('-f, --force', 'Overwrite existing .horizon config')
  .action(async (path, options) => {
    const { setupCommand } = await import('./commands/setup.js');
    await setupCommand(path, options);
  });

// horizon visualize
program
  .command('visualize')
  .alias('vis')
  .alias('v')
  .description('Launch the Dreamscape visualizer')
  .option('-p, --port <port>', 'Port to run the visualizer on', '3000')
  .option('--no-open', 'Do not auto-open browser')
  .action(visualizeCommand);

// horizon status
program
  .command('status')
  .alias('st')
  .description('Show project status and symbol counts')
  .action(statusCommand);

// horizon purpose <command>
const purposeCmd = program
  .command('purpose')
  .description('Purpose-related commands');

purposeCmd
  .command('remember [path]')
  .description('Aggregate and display purpose context')
  .action(async (path = '.') => {
    const { purposeRememberCommand } = await import('./commands/purpose/remember.js');
    await purposeRememberCommand(path);
  });

purposeCmd
  .command('validate [path]')
  .description('Validate purpose files')
  .action(async (path = '.') => {
    const { purposeValidateCommand } = await import('./commands/purpose/validate.js');
    await purposeValidateCommand(path);
  });

// horizon gate <command>
const gateCmd = program
  .command('gate')
  .description('Gate-related commands');

gateCmd
  .command('validate [path]')
  .description('Validate gate.yaml configuration')
  .action(async (path = './gate.yaml') => {
    const { gateValidateCommand } = await import('./commands/gate/validate.js');
    await gateValidateCommand(path);
  });

// horizon dream <command>
const dreamCmd = program
  .command('dream')
  .description('Dream-related commands');

dreamCmd
  .command('aggregate [path]')
  .description('Aggregate all sources into symbol index')
  .action(async (path = '.') => {
    const { dreamAggregateCommand } = await import('./commands/dream/aggregate.js');
    await dreamAggregateCommand(path);
  });

dreamCmd
  .command('snapshot <name>')
  .description('Create a timeline snapshot')
  .option('-d, --description <desc>', 'Snapshot description')
  .action(async (name, options) => {
    const { dreamSnapshotCommand } = await import('./commands/dream/snapshot.js');
    await dreamSnapshotCommand(name, options.description);
  });

// horizon sync
program
  .command('sync [ide]')
  .description('Generate IDE instruction files from .horizon/ config')
  .option('--all', 'Sync all supported IDEs')
  .option('-f, --force', 'Overwrite existing files')
  .action(async (ide, options) => {
    const { syncCommand } = await import('./commands/sync.js');
    await syncCommand(ide, options);
  });

// horizon cursorrules (deprecated, alias for sync cursor)
program
  .command('cursorrules [path]')
  .description('[DEPRECATED] Use `horizon sync cursor` instead')
  .option('-a, --append', 'Append to existing .cursorrules')
  .option('-f, --force', 'Overwrite existing .cursorrules')
  .option('-p, --preview', 'Preview output without writing')
  .option('--init', 'Create default .horizon config if missing')
  .option('--with-scan', 'Include scan protocol section')
  .action(async (path, options) => {
    console.log('\x1b[33m⚠️  `horizon cursorrules` is deprecated. Use `horizon sync cursor` instead.\x1b[0m\n');
    const { cursorrrulesCommand } = await import('./commands/cursorrules.js');
    await cursorrrulesCommand(path, options);
  });

// horizon index
program
  .command('index [path]')
  .description('Generate scan index for visual discovery')
  .option('-o, --output <path>', 'Output path for scan-index.json')
  .option('-q, --quiet', 'Suppress output')
  .action(async (path, options) => {
    const { indexCommand } = await import('./commands/scan/index.js');
    await indexCommand(path, options);
  });

// horizon scan <subcommand>
const scanCmd = program
  .command('scan')
  .description('Scan-related commands');

scanCmd
  .command('index [path]')
  .description('Generate scan index (alias for `horizon index`)')
  .option('-o, --output <path>', 'Output path for scan-index.json')
  .option('-q, --quiet', 'Suppress output')
  .action(async (path, options) => {
    const { indexCommand } = await import('./commands/scan/index.js');
    await indexCommand(path, options);
  });

// horizon upgrade
program
  .command('upgrade [path]')
  .description('Upgrade project with new Horizon features')
  .option('--features <features...>', 'Features to upgrade (scan, logger)')
  .option('--all', 'Apply all available upgrades')
  .option('--dry-run', 'Show what would be upgraded without making changes')
  .option('-f, --force', 'Force re-upgrade even if already configured')
  .action(async (path, options) => {
    const { upgradeCommand } = await import('./commands/upgrade.js');
    await upgradeCommand(path, options);
  });

// horizon doctor
program
  .command('doctor')
  .description('Health check - validate Horizon setup')
  .action(async () => {
    const { doctorCommand } = await import('./commands/doctor.js');
    await doctorCommand();
  });

// horizon watch
program
  .command('watch')
  .description('Watch for changes and auto-sync IDE files')
  .action(async () => {
    const { watchCommand } = await import('./commands/watch.js');
    await watchCommand();
  });

// horizon summary
program
  .command('summary')
  .description('Generate .horizon/project.md with project stats')
  .action(async () => {
    const { summaryCommand } = await import('./commands/summary.js');
    await summaryCommand();
  });

// Parse and run
program.parse();
