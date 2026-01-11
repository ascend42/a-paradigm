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

// horizon cursorrules
program
  .command('cursorrules [path]')
  .description('Generate .cursorrules from .horizon config')
  .option('-a, --append', 'Append to existing .cursorrules')
  .option('-f, --force', 'Overwrite existing .cursorrules')
  .option('-p, --preview', 'Preview output without writing')
  .option('--init', 'Create default .horizon config if missing')
  .action(async (path, options) => {
    const { cursorrrulesCommand } = await import('./commands/cursorrules.js');
    await cursorrrulesCommand(path, options);
  });

// Parse and run
program.parse();
