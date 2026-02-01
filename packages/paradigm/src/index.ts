/**
 * Paradigm CLI - Unified command-line interface
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { initCommand } from './commands/init.js';
import { visualizeCommand } from './commands/visualize.js';
import { statusCommand } from './commands/status.js';

const VERSION = '0.6.0';

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
  .option('--name <name>', 'Project name')
  .option('--ide <ide>', 'Target IDE: cursor, copilot, windsurf, claude')
  .option('--migrate', 'Output migration prompt for existing IDE files')
  .option('--quick', 'Non-interactive mode with smart defaults')
  .option('--dry-run', 'Show what would be created without creating')
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
  .option('-p, --port <port>', 'Port to run the visualizer on', '42197')
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

portalCmd
  .command('watch [path]')
  .alias('w')
  .description('Launch the Portal Viewer - real-time visualization dashboard')
  .option('-p, --port <port>', 'WebSocket port for SDK connections', '42196')
  .option('-u, --ui-port <port>', 'HTTP port for UI', '42195')
  .option('-c, --config <path>', 'Path to portal.yaml config')
  .option('--no-open', 'Do not auto-open browser')
  .action(async (path, options) => {
    const { portalWatchCommand } = await import('./commands/portal/watch.js');
    await portalWatchCommand(path, options);
  });

portalCmd
  .command('report <session>')
  .description('Generate a report from a session file')
  .option('-f, --format <format>', 'Output format: json, markdown, slack, discord', 'markdown')
  .option('-o, --output <path>', 'Output file path')
  .action(async (session, options) => {
    const { portalReportCommand } = await import('./commands/portal/watch.js');
    await portalReportCommand(session, options);
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

// paradigm lint
program
  .command('lint [path]')
  .description('Validate .purpose files for schema errors')
  .option('-f, --fix', 'Auto-fix issues where possible')
  .option('-s, --strict', 'Fail on warnings (not just errors)')
  .option('-q, --quiet', 'Suppress output except errors')
  .option('--json', 'Output as JSON')
  .action(async (path, options) => {
    const { lintCommand } = await import('./commands/lint.js');
    await lintCommand(path, options);
  });

// paradigm cost
program
  .command('cost [path]')
  .description('Analyze token costs for AI context')
  .option('-d, --detailed', 'Show detailed breakdown by file')
  .option('--json', 'Output as JSON')
  .action(async (path, options) => {
    const { costCommand } = await import('./commands/cost.js');
    await costCommand(path, options);
  });

// paradigm scan <subcommand>
const scanCmd = program
  .command('scan')
  .description('Visual discovery and auto-generation commands');

scanCmd
  .command('auto [path]')
  .description('Auto-generate .purpose files from code analysis')
  .option('-n, --dry-run', 'Show what would be generated without writing')
  .option('-f, --force', 'Overwrite existing .purpose files')
  .option('--json', 'Output as JSON')
  .action(async (path, options) => {
    const { autoScanCommand } = await import('./commands/scan/auto.js');
    await autoScanCommand(path, options);
  });

// Default scan action (show help)
scanCmd
  .action(() => {
    console.log('\nUsage: paradigm scan <command>\n');
    console.log('Commands:');
    console.log('  auto [path]  Auto-generate .purpose files from code analysis');
    console.log('\nRun `paradigm scan auto --help` for options.\n');
  });

// paradigm team <subcommand>
const teamCmd = program
  .command('team')
  .description('Multi-agent orchestration commands');

teamCmd
  .command('init [path]')
  .description('Initialize team configuration with default agents')
  .option('-f, --force', 'Overwrite existing configuration')
  .option('--json', 'Output as JSON')
  .action(async (path, options) => {
    const { teamInitCommand } = await import('./commands/team/index.js');
    await teamInitCommand(path, options);
  });

teamCmd
  .command('status [path]')
  .description('Show current team status')
  .option('--json', 'Output as JSON')
  .action(async (path, options) => {
    const { teamStatusCommand } = await import('./commands/team/index.js');
    await teamStatusCommand(path, options);
  });

teamCmd
  .command('handoff [path]')
  .description('Hand off current task to another agent')
  .requiredOption('-t, --to <agent>', 'Target agent name')
  .option('-s, --summary <text>', 'Summary of what was done')
  .option('--json', 'Output as JSON')
  .action(async (path, options) => {
    const { teamHandoffCommand } = await import('./commands/team/index.js');
    await teamHandoffCommand(path, options);
  });

teamCmd
  .command('accept [handoff-id] [path]')
  .description('Accept a pending handoff')
  .option('-n, --note <text>', 'Acceptance note')
  .option('--json', 'Output as JSON')
  .action(async (handoffId, path, options) => {
    const { teamAcceptCommand } = await import('./commands/team/index.js');
    await teamAcceptCommand(handoffId, path, options);
  });

teamCmd
  .command('check [path]')
  .description('Check for conflicts and team health issues')
  .option('--json', 'Output as JSON')
  .action(async (path, options) => {
    const { teamCheckCommand } = await import('./commands/team/index.js');
    await teamCheckCommand(path, options);
  });

teamCmd
  .command('history [path]')
  .description('Show full activity log')
  .option('-l, --limit <number>', 'Number of entries to show', '50')
  .option('--json', 'Output as JSON')
  .action(async (path, options) => {
    const { teamHistoryCommand } = await import('./commands/team/index.js');
    await teamHistoryCommand(path, { ...options, limit: parseInt(options.limit) });
  });

teamCmd
  .command('reset [path]')
  .description('Reset team state for fresh start')
  .option('-f, --force', 'Force reset even with pending work')
  .option('--json', 'Output as JSON')
  .action(async (path, options) => {
    const { teamResetCommand } = await import('./commands/team/index.js');
    await teamResetCommand(path, options);
  });

// Default team action (show status)
teamCmd
  .action(async () => {
    const { teamStatusCommand } = await import('./commands/team/index.js');
    await teamStatusCommand(undefined, {});
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

// paradigm constellation
program
  .command('constellation [path]')
  .alias('const')
  .description('Generate .paradigm/constellation.json - symbol relationship graph for AI agents')
  .option('-f, --format <format>', 'Output format: json or yaml', 'json')
  .option('-o, --output <path>', 'Custom output path')
  .option('-q, --quiet', 'Suppress output')
  .action(async (path, options) => {
    const { constellationCommand } = await import('./commands/constellation.js');
    await constellationCommand(path, options);
  });

// paradigm beacon
program
  .command('beacon [path]')
  .description('Generate .paradigm/beacon.md - quick-start orientation for AI agents')
  .option('-r, --refresh', 'Regenerate even if beacon exists')
  .option('-o, --output <path>', 'Custom output path')
  .option('--json', 'Output as JSON (for AI agent queries)')
  .option('-q, --quiet', 'Suppress output')
  .action(async (path, options) => {
    const { beaconCommand } = await import('./commands/beacon.js');
    await beaconCommand(path, options);
  });

// paradigm ripple
program
  .command('ripple <symbol> [path]')
  .description('Show change impact analysis for a symbol')
  .option('-d, --depth <depth>', 'Analysis depth (default: 1)', '1')
  .option('--json', 'Output as JSON')
  .option('-q, --quiet', 'Suppress output')
  .action(async (symbol, path, options) => {
    const { rippleCommand } = await import('./commands/ripple.js');
    await rippleCommand(symbol, path, options);
  });

// paradigm thread <command>
const threadCmd = program
  .command('thread')
  .description('Session continuity - pass context between AI agent sessions');

threadCmd
  .command('show [path]')
  .alias('s')
  .description('Show current thread')
  .option('--json', 'Output as JSON (for AI agent queries)')
  .action(async (path, options) => {
    const { threadShowCommand } = await import('./commands/thread.js');
    await threadShowCommand(path, options);
  });

threadCmd
  .command('save <message> [path]')
  .description('Save activity to the thread trail')
  .option('-q, --quiet', 'Suppress output')
  .action(async (message, path, options) => {
    const { threadSaveCommand } = await import('./commands/thread.js');
    await threadSaveCommand(message, path, options);
  });

threadCmd
  .command('todo <task> [path]')
  .description('Add a loose end (unfinished task)')
  .option('-q, --quiet', 'Suppress output')
  .action(async (task, path, options) => {
    const { threadTodoCommand } = await import('./commands/thread.js');
    await threadTodoCommand(task, path, options);
  });

threadCmd
  .command('note <note> [path]')
  .description('Add a breadcrumb (note for next agent)')
  .option('-q, --quiet', 'Suppress output')
  .action(async (note, path, options) => {
    const { threadNoteCommand } = await import('./commands/thread.js');
    await threadNoteCommand(note, path, options);
  });

threadCmd
  .command('clear [path]')
  .description('Clear the thread')
  .option('-q, --quiet', 'Suppress output')
  .action(async (path, options) => {
    const { threadClearCommand } = await import('./commands/thread.js');
    await threadClearCommand(path, options);
  });

// Default thread action (show)
threadCmd
  .option('--json', 'Output as JSON (for AI agent queries)')
  .action(async (options) => {
    const { threadShowCommand } = await import('./commands/thread.js');
    await threadShowCommand(undefined, options);
  });

// paradigm echo <command>
const echoCmd = program
  .command('echo')
  .description('Error-to-symbol mapping - find related symbols for error codes');

echoCmd
  .command('lookup <errorCode> [path]')
  .alias('l')
  .description('Look up an error code')
  .option('--json', 'Output as JSON (for AI agent queries)')
  .action(async (errorCode, path, options) => {
    const { echoCommand } = await import('./commands/echo.js');
    await echoCommand(errorCode, path, options);
  });

echoCmd
  .command('init [path]')
  .description('Create .paradigm/echoes.yaml template')
  .option('-q, --quiet', 'Suppress output')
  .action(async (path, options) => {
    const { echoInitCommand } = await import('./commands/echo.js');
    await echoInitCommand(path, options);
  });

echoCmd
  .command('list [path]')
  .alias('ls')
  .description('List all error mappings')
  .action(async (path) => {
    const { echoListCommand } = await import('./commands/echo.js');
    await echoListCommand(path);
  });

// Default echo action (with error code argument)
echoCmd
  .argument('[errorCode]', 'Error code to look up')
  .option('--json', 'Output as JSON (for AI agent queries)')
  .action(async (errorCode, options) => {
    if (errorCode) {
      const { echoCommand } = await import('./commands/echo.js');
      await echoCommand(errorCode, undefined, options);
    } else {
      const { echoListCommand } = await import('./commands/echo.js');
      await echoListCommand();
    }
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

// paradigm mcp <command>
const mcpCmd = program
  .command('mcp')
  .description('MCP server configuration for AI clients');

mcpCmd
  .command('setup')
  .description('Configure MCP server for detected AI clients')
  .option('-c, --client <client>', 'Target client: cursor, claude-desktop, continue, cline, all')
  .option('-f, --force', 'Overwrite existing config')
  .option('--json', 'Output as JSON')
  .option('--no-gitignore', 'Do not add config to .gitignore')
  .action(async (options) => {
    const { mcpSetupCommand } = await import('./commands/mcp/setup.js');
    await mcpSetupCommand(options);
  });

mcpCmd
  .command('status')
  .description('Show MCP configuration status across clients')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { mcpStatusCommand } = await import('./commands/mcp/setup.js');
    await mcpStatusCommand(options);
  });

mcpCmd
  .command('list')
  .alias('ls')
  .description('List all configured MCP servers across all clients')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { mcpListCommand } = await import('./commands/mcp/setup.js');
    await mcpListCommand(options);
  });

mcpCmd
  .command('remove [server]')
  .alias('rm')
  .description('Remove MCP server from client configs')
  .option('-c, --client <client>', 'Target client: cursor, claude-desktop, continue, cline, all')
  .option('-f, --force', 'Skip confirmation')
  .option('--json', 'Output as JSON')
  .action(async (server, options) => {
    const { mcpRemoveCommand } = await import('./commands/mcp/setup.js');
    await mcpRemoveCommand(server, options);
  });

// Default mcp action (show status)
mcpCmd
  .action(async () => {
    const { mcpStatusCommand } = await import('./commands/mcp/setup.js');
    await mcpStatusCommand({});
  });

// Parse and run
program.parse();
