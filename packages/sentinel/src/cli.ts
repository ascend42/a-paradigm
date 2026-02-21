/**
 * Sentinel CLI
 *
 * Standalone command-line tool for semantic error monitoring.
 *
 * Usage:
 *   sentinel              Launch dashboard
 *   sentinel init          Initialize in current project
 *   sentinel triage list   List incidents
 *   sentinel triage show   Show incident details
 *   sentinel triage resolve  Resolve an incident
 *   sentinel triage stats  Show statistics
 */

import { Command } from 'commander';

const program = new Command();

program
  .name('sentinel')
  .description('Semantic error monitoring — errors that speak your language')
  .version('0.2.0');

// Default: launch dashboard
program
  .command('dashboard', { isDefault: true })
  .description('Launch the Sentinel dashboard')
  .option('-p, --port <port>', 'Port number', '3838')
  .option('--no-open', "Don't open browser")
  .action(async (opts) => {
    const { launchDashboard } = await import('./cli/commands.js');
    await launchDashboard(opts);
  });

// Init
program
  .command('init')
  .description('Initialize Sentinel in current project')
  .option('--detect', 'Auto-detect symbols from codebase')
  .action(async (opts) => {
    const { initProject } = await import('./cli/commands.js');
    await initProject(opts);
  });

// Triage
const triage = program.command('triage').description('Incident triage');

triage
  .command('list')
  .description('List incidents')
  .option('-s, --status <status>', 'Filter by status (open, investigating, resolved, wont-fix)')
  .option('-e, --env <env>', 'Filter by environment')
  .option('--symbol <symbol>', 'Filter by symbol')
  .option('-n, --limit <n>', 'Max results', '10')
  .action(async (opts) => {
    const { triageList } = await import('./cli/commands.js');
    await triageList(opts);
  });

triage
  .command('show <id>')
  .description('Show incident details')
  .option('--timeline', 'Include flow timeline')
  .action(async (id, opts) => {
    const { triageShow } = await import('./cli/commands.js');
    await triageShow(id, opts);
  });

triage
  .command('resolve <id>')
  .description('Resolve an incident')
  .option('--pattern <id>', 'Pattern that resolved it')
  .option('--commit <hash>', 'Fix commit')
  .option('--notes <text>', 'Resolution notes')
  .action(async (id, opts) => {
    const { triageResolve } = await import('./cli/commands.js');
    await triageResolve(id, opts);
  });

triage
  .command('stats')
  .description('Show incident statistics')
  .option('-p, --period <period>', 'Period (7d, 30d, 90d)', '7d')
  .action(async (opts) => {
    const { triageStats } = await import('./cli/commands.js');
    await triageStats(opts);
  });

program.parse();
