/**
 * Paradigm CLI - Unified command-line interface
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { initCommand } from './commands/init.js';
import { visualizeCommand } from './commands/visualize.js';
import { statusCommand } from './commands/status.js';

const VERSION = '0.4.0';

const program = new Command();

// ASCII art banner
const banner = `
${chalk.magenta('╔═╗')}${chalk.cyan('┌─┐┬─┐┌─┐┌┬┐┬┌─┐┌┬┐')}
${chalk.magenta('╠═╝')}${chalk.cyan('├─┤├┬┘├─┤ │││││ ┬│││')}
${chalk.magenta('╩  ')}${chalk.cyan('┴ ┴┴└─┴ ┴─┴┘┴└─┘┴ ┴')} ${chalk.gray(`v${VERSION}`)}
`;

program
  .name('paradigm')
  .description('Unified developer tools ecosystem')
  .version(VERSION)
  .addHelpText('before', banner);

// paradigm init
program
  .command('init')
  .description('Initialize Paradigm in the current project')
  .option('-f, --force', 'Overwrite existing files')
  .option('--name <name>', 'Project name for .premise file')
  .option('--ide <ide>', 'Target IDE: cursor (.cursorrules), copilot (.github/copilot-instructions.md), windsurf (.windsurfrules), claude (CLAUDE.md)')
  .action(initCommand);

// paradigm setup
program
  .command('setup [path]')
  .description('Interactive setup wizard for Paradigm')
  .option('-y, --yes', 'Accept all defaults (non-interactive)')
  .option('-f, --force', 'Overwrite existing .paradigm config')
  .action(async (path, options) => {
    const { setupCommand } = await import('./commands/setup.js');
    await setupCommand(path, options);
  });

// paradigm visualize
program
  .command('visualize')
  .alias('vis')
  .alias('v')
  .description('Launch the Prism visualizer')
  .option('-p, --port <port>', 'Port to run the visualizer on', '3000')
  .option('--no-open', 'Do not auto-open browser')
  .action(visualizeCommand);

// paradigm status
program
  .command('status')
  .alias('st')
  .description('Show project status and symbol counts')
  .action(statusCommand);

// paradigm purpose <command>
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

// paradigm portal <command>
const portalCmd = program
  .command('portal')
  .description('Portal-related commands');

portalCmd
  .command('validate [path]')
  .description('Validate portal.yaml configuration')
  .action(async (path = './portal.yaml') => {
    const { gateValidateCommand } = await import('./commands/portal/validate.js');
    await gateValidateCommand(path);
  });

portalCmd
  .command('test [path]')
  .description('Test portals and generate test files')
  .option('--generate', 'Generate test files from portal.yaml')
  .option('--portal <portalId>', 'Test specific portal')
  .option('--component', 'Validate component access')
  .option('--framework <framework>', 'Test framework (jest, vitest, mocha)', 'jest')
  .option('--output <dir>', 'Output directory for generated tests', 'tests/portals')
  .action(async (path, options) => {
    const { gateTestCommand } = await import('./commands/portal/test.js');
    await gateTestCommand(path, options);
  });

// paradigm premise <command>
const premiseCmd = program
  .command('premise')
  .description('Premise-related commands');

premiseCmd
  .command('aggregate [path]')
  .description('Aggregate all sources into symbol index')
  .action(async (path = '.') => {
    const { dreamAggregateCommand } = await import('./commands/premise/aggregate.js');
    await dreamAggregateCommand(path);
  });

premiseCmd
  .command('snapshot <name>')
  .description('Create a timeline snapshot')
  .option('-d, --description <desc>', 'Snapshot description')
  .action(async (name, options) => {
    const { dreamSnapshotCommand } = await import('./commands/premise/snapshot.js');
    await dreamSnapshotCommand(name, options.description);
  });

// paradigm sync
program
  .command('sync [ide]')
  .description('Generate IDE instruction files from .paradigm/ config')
  .option('--all', 'Sync all supported IDEs')
  .option('-f, --force', 'Overwrite existing files')
  .action(async (ide, options) => {
    const { syncCommand } = await import('./commands/sync.js');
    await syncCommand(ide, options);
  });

// paradigm cursorrules (deprecated, alias for sync cursor)
program
  .command('cursorrules [path]')
  .description('[DEPRECATED] Use `paradigm sync cursor` instead')
  .option('-a, --append', 'Append to existing .cursorrules')
  .option('-f, --force', 'Overwrite existing .cursorrules')
  .option('-p, --preview', 'Preview output without writing')
  .option('--init', 'Create default .paradigm config if missing')
  .option('--with-scan', 'Include probe protocol section')
  .action(async (path, options) => {
    console.log('\x1b[33m⚠️  `paradigm cursorrules` is deprecated. Use `paradigm sync cursor` instead.\x1b[0m\n');
    const { cursorrrulesCommand } = await import('./commands/cursorrules.js');
    await cursorrrulesCommand(path, options);
  });

// paradigm index
program
  .command('index [path]')
  .description('Generate probe index for visual discovery')
  .option('-o, --output <path>', 'Output path for probe-index.json')
  .option('-q, --quiet', 'Suppress output')
  .action(async (path, options) => {
    const { indexCommand } = await import('./commands/probe/index.js');
    await indexCommand(path, options);
  });

// paradigm probe <subcommand>
const probeCmd = program
  .command('probe')
  .description('Probe-related commands');

probeCmd
  .command('index [path]')
  .description('Generate probe index (alias for `paradigm index`)')
  .option('-o, --output <path>', 'Output path for probe-index.json')
  .option('-q, --quiet', 'Suppress output')
  .action(async (path, options) => {
    const { indexCommand } = await import('./commands/probe/index.js');
    await indexCommand(path, options);
  });

// paradigm upgrade
program
  .command('upgrade [path]')
  .description('Upgrade project with new Paradigm features')
  .option('--features <features...>', 'Features to upgrade (probe, logger)')
  .option('--all', 'Apply all available upgrades')
  .option('--from-horizon', 'Migrate from Horizon to Paradigm')
  .option('--dry-run', 'Show what would be upgraded without making changes')
  .option('-f, --force', 'Force re-upgrade even if already configured')
  .action(async (path, options) => {
    const { upgradeCommand } = await import('./commands/upgrade.js');
    await upgradeCommand(path, options);
  });

// paradigm doctor
program
  .command('doctor')
  .description('Health check - validate Paradigm setup')
  .action(async () => {
    const { doctorCommand } = await import('./commands/doctor.js');
    await doctorCommand();
  });

// paradigm watch
program
  .command('watch')
  .description('Watch for changes and auto-sync IDE files')
  .action(async () => {
    const { watchCommand } = await import('./commands/watch.js');
    await watchCommand();
  });

// paradigm summary
program
  .command('summary')
  .description('Generate .paradigm/project.md with project stats')
  .action(async () => {
    const { summaryCommand } = await import('./commands/summary.js');
    await summaryCommand();
  });

// paradigm tutorial <command>
const tutorialCmd = program
  .command('tutorial')
  .description('Interactive tutorial system');

tutorialCmd
  .command('start [path]')
  .description('Start the tutorial')
  .action(async (path) => {
    const { tutorialStartCommand } = await import('./commands/tutorial/index.js');
    await tutorialStartCommand(path);
  });

tutorialCmd
  .command('step [n] [path]')
  .description('Show tutorial step')
  .action(async (n, path) => {
    const { tutorialStepCommand } = await import('./commands/tutorial/index.js');
    await tutorialStepCommand(path, n);
  });

tutorialCmd
  .command('checkpoint [path]')
  .description('Validate current checkpoint')
  .action(async (path) => {
    const { tutorialCheckpointCommand } = await import('./commands/tutorial/index.js');
    await tutorialCheckpointCommand(path);
  });

tutorialCmd
  .command('next [path]')
  .description('Move to next step')
  .action(async (path) => {
    const { tutorialNextCommand } = await import('./commands/tutorial/index.js');
    await tutorialNextCommand(path);
  });

tutorialCmd
  .command('status [path]')
  .description('Show tutorial progress')
  .action(async (path) => {
    const { tutorialStatusCommand } = await import('./commands/tutorial/index.js');
    await tutorialStatusCommand(path);
  });

tutorialCmd
  .command('reset [path]')
  .description('Reset tutorial to beginning')
  .action(async (path) => {
    const { tutorialResetCommand } = await import('./commands/tutorial/index.js');
    await tutorialResetCommand(path);
  });

tutorialCmd
  .command('bugs [path]')
  .description('List intentional bugs')
  .action(async (path) => {
    const { tutorialBugsCommand } = await import('./commands/tutorial/index.js');
    await tutorialBugsCommand(path);
  });

// Parse and run
program.parse();
