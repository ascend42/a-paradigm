/**
 * Paradigm CLI - Unified command-line interface
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { initCommand } from './commands/init.js';
import { statusCommand } from './commands/status.js';

const VERSION = '1.3.0';

const program = new Command();

// ASCII art banner
const banner = `
${chalk.magenta('╔═╗')}${chalk.cyan('┌─┐┬─┐┌─┐┌┬┐┬ ┌─┐┌┬┐')}
${chalk.magenta('╠═╝')}${chalk.cyan('├─┤├┬┘├─┤ │││ ├─┐│││')}
${chalk.magenta('╩  ')}${chalk.cyan('┴ ┴┴└─┴ ┴─┴┘┴ └─┘┴ ┴')} ${chalk.gray(`v${VERSION}`)}
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

// paradigm shift - one command to rule them all
program
  .command('shift')
  .description('Full project setup in one command (init + scan + sync all IDEs + doctor)')
  .option('-f, --force', 'Reinitialize even if already setup')
  .option('-q, --quick', 'Skip slow operations (scan)')
  .option('--verify', 'Run health checks after setup')
  .option('--ide <ide>', 'Target specific IDE instead of all')
  .action(async (options) => {
    const { shiftCommand } = await import('./commands/shift.js');
    await shiftCommand(options);
  });

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
  .option('--mcp', 'Generate MCP configuration (default: true)')
  .option('--no-mcp', 'Skip MCP configuration generation')
  .option('--nested', 'Generate nested CLAUDE.md files for directories with .purpose')
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

// paradigm team spawn <agent>
teamCmd
  .command('spawn <agent> [path]')
  .description('Spawn an AI agent to work on a task')
  .requiredOption('-t, --task <task>', 'Task for the agent to perform')
  .option('-m, --model <model>', 'Model to use: opus, sonnet, haiku')
  .option('-p, --provider <provider>', 'Provider: auto, claude, claude-code, claude-cli, manual')
  .option('--budget <budget>', 'Budget limits (e.g., "tokens=100000,cost=2")')
  .option('--timeout <ms>', 'Timeout in milliseconds')
  .option('--checkpoint', 'Pause for approval before writes/deletes')
  .option('-q, --quiet', 'Suppress output')
  .option('--json', 'Output as JSON')
  .action(async (agent, path, options) => {
    const { teamSpawnCommand } = await import('./commands/team/spawn.js');
    await teamSpawnCommand(agent, path, options);
  });

// paradigm team orchestrate <task>
teamCmd
  .command('orchestrate <task> [path]')
  .description('Orchestrate a multi-agent task')
  .option('--solo', 'Run in solo mode (single Claude)')
  .option('--faceted', 'Run in faceted mode (multi-agent, default)')
  .option('--compare', 'Run both modes and compare results')
  .option('-m, --model <model>', 'Orchestrator model: opus, sonnet, haiku')
  .option('-p, --provider <provider>', 'Provider: auto, claude, claude-code, claude-cli, manual')
  .option('--budget <budget>', 'Budget limits (e.g., "tokens=500000,cost=5")')
  .option('--checkpoint', 'Pause for approval between agents')
  .option('--live', 'Stream agent output live')
  .option('-q, --quiet', 'Suppress output')
  .option('--json', 'Output as JSON')
  .action(async (task, path, options) => {
    const { teamOrchestrateCommand } = await import('./commands/team/orchestrate.js');
    await teamOrchestrateCommand(task, path, options);
  });

// paradigm team cost
teamCmd
  .command('cost [path]')
  .description('Show cost summary for orchestrations')
  .option('--from <date>', 'From date (ISO format)')
  .option('--to <date>', 'To date (ISO format)')
  .option('--days <n>', 'Last N days')
  .option('-d, --detailed', 'Show detailed breakdown')
  .option('--json', 'Output as JSON')
  .action(async (path, options) => {
    const { teamCostCommand } = await import('./commands/team/cost.js');
    await teamCostCommand(path, options);
  });

// paradigm team export
teamCmd
  .command('export [path]')
  .description('Export orchestration data')
  .option('-f, --format <format>', 'Output format: json, csv', 'json')
  .option('--from <date>', 'From date (ISO format)')
  .option('--to <date>', 'To date (ISO format)')
  .option('-o, --output <file>', 'Output file path')
  .action(async (path, options) => {
    const { teamExportCommand } = await import('./commands/team/export.js');
    await teamExportCommand(path, options);
  });

// paradigm team providers
teamCmd
  .command('providers [path]')
  .description('Show available agent providers and their status')
  .option('--set <provider>', 'Set preferred provider: auto, claude, claude-code, claude-cli, manual')
  .option('--json', 'Output as JSON')
  .action(async (path, options) => {
    const { teamProvidersCommand } = await import('./commands/team/providers.js');
    await teamProvidersCommand(path, options);
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

// paradigm wisdom <command>
const wisdomCmd = program
  .command('wisdom')
  .description('Team wisdom - preferences, antipatterns, decisions, expertise');

wisdomCmd
  .command('show [symbol]')
  .description('Display wisdom for symbols or overview')
  .option('--json', 'Output as JSON')
  .action(async (symbol, options) => {
    const { wisdomShowCommand } = await import('./commands/wisdom/index.js');
    await wisdomShowCommand(symbol, options);
  });

wisdomCmd
  .command('init')
  .description('Initialize wisdom directory with templates')
  .option('-f, --force', 'Overwrite existing files')
  .action(async (options) => {
    const { wisdomInitCommand } = await import('./commands/wisdom/index.js');
    await wisdomInitCommand(options);
  });

wisdomCmd
  .command('add-antipattern')
  .description('Add a new antipattern')
  .requiredOption('--id <id>', 'Antipattern ID (e.g., api-001)')
  .requiredOption('--symbols <symbols>', 'Comma-separated symbols')
  .requiredOption('--description <desc>', 'What NOT to do')
  .requiredOption('--reason <reason>', 'Why this is bad')
  .requiredOption('--alternative <alt>', 'What to do instead')
  .action(async (options) => {
    const { wisdomAddAntipatternCommand } = await import('./commands/wisdom/index.js');
    await wisdomAddAntipatternCommand(options);
  });

wisdomCmd
  .command('decide')
  .description('Create a new decision record (ADR)')
  .requiredOption('--id <id>', 'Decision ID (e.g., 001)')
  .requiredOption('--title <title>', 'Decision title')
  .requiredOption('--symbols <symbols>', 'Comma-separated symbols')
  .requiredOption('--context <context>', 'Context/problem')
  .requiredOption('--decision <decision>', 'The decision made')
  .option('--status <status>', 'Status: proposed, accepted', 'proposed')
  .action(async (options) => {
    const { wisdomDecideCommand } = await import('./commands/wisdom/index.js');
    await wisdomDecideCommand(options);
  });

wisdomCmd
  .command('expert [query]')
  .description('Find experts for symbols or areas')
  .option('--json', 'Output as JSON')
  .action(async (query, options) => {
    const { wisdomExpertCommand } = await import('./commands/wisdom/index.js');
    await wisdomExpertCommand(query, options);
  });

// Default wisdom action (show)
wisdomCmd
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { wisdomShowCommand } = await import('./commands/wisdom/index.js');
    await wisdomShowCommand(undefined, options);
  });

// paradigm history <command>
const historyCmd = program
  .command('history')
  .description('Implementation history - tracking changes, validation, fragility');

historyCmd
  .command('show [symbol]')
  .description('Display history for symbols or overview')
  .option('--json', 'Output as JSON')
  .option('-l, --limit <number>', 'Number of entries', '10')
  .action(async (symbol, options) => {
    const { historyShowCommand } = await import('./commands/history/index.js');
    await historyShowCommand(symbol, { ...options, limit: parseInt(options.limit) });
  });

historyCmd
  .command('init')
  .description('Initialize history directory')
  .option('-f, --force', 'Overwrite existing files')
  .action(async (options) => {
    const { historyInitCommand } = await import('./commands/history/index.js');
    await historyInitCommand(options);
  });

historyCmd
  .command('fragile')
  .description('Show fragile symbols that need extra care')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { historyFragileCommand } = await import('./commands/history/index.js');
    await historyFragileCommand(options);
  });

historyCmd
  .command('reindex')
  .description('Regenerate index from log')
  .action(async () => {
    const { historyReindexCommand } = await import('./commands/history/index.js');
    await historyReindexCommand();
  });

historyCmd
  .command('record')
  .description('Record an implementation event')
  .requiredOption('--type <type>', 'Type: implement, refactor, rollback')
  .requiredOption('--symbols <symbols>', 'Comma-separated symbols')
  .requiredOption('--description <desc>', 'What was done')
  .option('--intent <intent>', 'Intent: feature, fix, refactor')
  .option('--commit <hash>', 'Git commit hash')
  .option('--reason <reason>', 'Reason for rollback')
  .action(async (options) => {
    const { historyRecordCommand } = await import('./commands/history/index.js');
    await historyRecordCommand(options);
  });

historyCmd
  .command('validate')
  .description('Record a validation result')
  .requiredOption('--result <result>', 'Result: pass, fail, partial')
  .option('--ref <id>', 'Implementation ID being validated')
  .option('--passed <n>', 'Tests passed')
  .option('--failed <n>', 'Tests failed')
  .action(async (options) => {
    const { historyValidateCommand } = await import('./commands/history/index.js');
    await historyValidateCommand({
      ...options,
      passed: options.passed ? parseInt(options.passed) : undefined,
      failed: options.failed ? parseInt(options.failed) : undefined,
    });
  });

// Default history action (show)
historyCmd
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { historyShowCommand } = await import('./commands/history/index.js');
    await historyShowCommand(undefined, options);
  });

// paradigm hooks <command>
const hooksCmd = program
  .command('hooks')
  .description('Git hooks for automatic history capture');

hooksCmd
  .command('install')
  .description('Install git hooks for history capture')
  .option('-f, --force', 'Overwrite existing hooks')
  .option('--post-commit', 'Only install post-commit hook')
  .option('--pre-push', 'Only install pre-push hook')
  .action(async (options) => {
    const { hooksInstallCommand } = await import('./commands/hooks/index.js');
    await hooksInstallCommand(options);
  });

hooksCmd
  .command('uninstall')
  .description('Remove paradigm git hooks')
  .action(async () => {
    const { hooksUninstallCommand } = await import('./commands/hooks/index.js');
    await hooksUninstallCommand();
  });

hooksCmd
  .command('status')
  .description('Check git hooks status')
  .action(async () => {
    const { hooksStatusCommand } = await import('./commands/hooks/index.js');
    await hooksStatusCommand();
  });

// Default hooks action (status)
hooksCmd
  .action(async () => {
    const { hooksStatusCommand } = await import('./commands/hooks/index.js');
    await hooksStatusCommand();
  });

// paradigm triage <command>
const triageCmd = program
  .command('triage')
  .description('Semantic error triage - incident management and pattern matching');

triageCmd
  .command('list')
  .alias('ls')
  .description('List recent incidents with matched patterns')
  .option('-l, --limit <number>', 'Maximum incidents to show', '10')
  .option('-s, --status <status>', 'Filter by status: open, investigating, resolved, wont-fix, all')
  .option('--symbol <symbol>', 'Filter by symbol (e.g., @checkout, ^auth)')
  .option('-e, --env <environment>', 'Filter by environment')
  .option('--search <text>', 'Search in error messages')
  .option('--from <date>', 'Filter from date (ISO format)')
  .option('--to <date>', 'Filter to date (ISO format)')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { triageListCommand } = await import('./commands/triage/index.js');
    await triageListCommand(options);
  });

triageCmd
  .command('show <id>')
  .description('Show full incident details')
  .option('--timeline', 'Include flow timeline')
  .option('--json', 'Output as JSON')
  .action(async (id, options) => {
    const { triageShowCommand } = await import('./commands/triage/index.js');
    await triageShowCommand(id, options);
  });

triageCmd
  .command('resolve <id>')
  .description('Mark incident as resolved')
  .option('-p, --pattern <patternId>', 'Pattern that led to resolution')
  .option('-c, --commit <hash>', 'Git commit hash of fix')
  .option('--pr <url>', 'Pull request URL')
  .option('-n, --notes <text>', 'Resolution notes')
  .option('--wont-fix', 'Mark as will not fix')
  .action(async (id, options) => {
    const { triageResolveCommand } = await import('./commands/triage/index.js');
    await triageResolveCommand(id, options);
  });

triageCmd
  .command('note <id> <note>')
  .description('Add a note to an incident')
  .action(async (id, note) => {
    const { triageNoteCommand } = await import('./commands/triage/index.js');
    await triageNoteCommand(id, note);
  });

triageCmd
  .command('link <id1> <id2>')
  .description('Link two related incidents')
  .action(async (id1, id2) => {
    const { triageLinkCommand } = await import('./commands/triage/index.js');
    await triageLinkCommand(id1, id2);
  });

// paradigm triage patterns <subcommand>
const triagePatternsCmd = triageCmd
  .command('patterns')
  .description('Manage failure patterns');

triagePatternsCmd
  .command('list')
  .alias('ls')
  .description('List all patterns')
  .option('--source <source>', 'Filter by source: manual, suggested, imported, community')
  .option('--min-confidence <score>', 'Minimum confidence score')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { triagePatternsListCommand } = await import('./commands/triage/index.js');
    await triagePatternsListCommand(options);
  });

triagePatternsCmd
  .command('show <id>')
  .description('Show pattern details')
  .option('--json', 'Output as JSON')
  .action(async (id, options) => {
    const { triagePatternsShowCommand } = await import('./commands/triage/index.js');
    await triagePatternsShowCommand(id, options);
  });

triagePatternsCmd
  .command('add')
  .description('Create a new pattern')
  .requiredOption('--id <id>', 'Pattern ID (kebab-case)')
  .requiredOption('--name <name>', 'Human-readable name')
  .option('--description <text>', 'Pattern description')
  .option('--symbols <pairs>', 'Symbol criteria (e.g., "feature:@checkout,gate:^auth")')
  .option('--error-contains <keywords>', 'Error keywords (comma-separated)')
  .option('--missing-signals <signals>', 'Expected missing signals (comma-separated)')
  .option('--strategy <strategy>', 'Resolution strategy: retry, fallback, fix-data, fix-code, ignore, escalate', 'fix-code')
  .option('--priority <priority>', 'Priority: low, medium, high, critical', 'medium')
  .option('--code-hint <text>', 'Code hint for resolution')
  .option('--tags <tags>', 'Tags (comma-separated)')
  .option('--from-incident <id>', 'Generate suggestion from incident')
  .action(async (options) => {
    const { triagePatternsAddCommand } = await import('./commands/triage/index.js');
    await triagePatternsAddCommand(options);
  });

triagePatternsCmd
  .command('delete <id>')
  .alias('rm')
  .description('Delete a pattern')
  .action(async (id) => {
    const { triagePatternsDeleteCommand } = await import('./commands/triage/index.js');
    await triagePatternsDeleteCommand(id);
  });

triagePatternsCmd
  .command('test <id>')
  .description('Test pattern against historical incidents')
  .option('-l, --limit <number>', 'Max incidents to test against', '100')
  .option('--json', 'Output as JSON')
  .action(async (id, options) => {
    const { triagePatternsTestCommand } = await import('./commands/triage/index.js');
    await triagePatternsTestCommand(id, options);
  });

triagePatternsCmd
  .command('seed')
  .description('Load built-in seed patterns')
  .action(async () => {
    const { triagePatternsSeedCommand } = await import('./commands/triage/index.js');
    await triagePatternsSeedCommand();
  });

// Default patterns action (list)
triagePatternsCmd
  .action(async () => {
    const { triagePatternsListCommand } = await import('./commands/triage/index.js');
    await triagePatternsListCommand({});
  });

triageCmd
  .command('export <type>')
  .description('Export patterns or full backup (type: patterns, backup)')
  .option('-o, --output <path>', 'Output file path')
  .option('--include-private', 'Include private patterns')
  .action(async (type, options) => {
    const { triageExportCommand } = await import('./commands/triage/index.js');
    await triageExportCommand(type, options);
  });

triageCmd
  .command('import <file>')
  .description('Import patterns from JSON file')
  .option('--overwrite', 'Overwrite existing patterns')
  .action(async (file, options) => {
    const { triageImportCommand } = await import('./commands/triage/index.js');
    await triageImportCommand(file, options);
  });

triageCmd
  .command('restore <file>')
  .description('Restore from full backup')
  .action(async (file) => {
    const { triageRestoreCommand } = await import('./commands/triage/index.js');
    await triageRestoreCommand(file);
  });

triageCmd
  .command('stats')
  .description('Show statistics dashboard')
  .option('-p, --period <period>', 'Time period: 1d, 7d, 30d, 90d', '7d')
  .option('--symbol <symbol>', 'Show health for specific symbol')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { triageStatsCommand } = await import('./commands/triage/index.js');
    await triageStatsCommand(options);
  });

triageCmd
  .command('record')
  .description('Manually record an incident')
  .requiredOption('--error <message>', 'Error message')
  .requiredOption('-e, --env <environment>', 'Environment')
  .option('--feature <symbol>', 'Feature symbol (@...)')
  .option('--component <symbol>', 'Component symbol (#...)')
  .option('--flow <symbol>', 'Flow symbol ($...)')
  .option('--gate <symbol>', 'Gate symbol (^...)')
  .option('--signal <symbol>', 'Signal symbol (!...)')
  .option('--state <symbol>', 'State symbol (%...)')
  .option('--integration <symbol>', 'Integration symbol (&...)')
  .option('--service <name>', 'Service name')
  .option('--version <version>', 'App version')
  .option('--stack <trace>', 'Stack trace')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { triageRecordCommand } = await import('./commands/triage/index.js');
    await triageRecordCommand(options);
  });

// Default triage action (list)
triageCmd
  .option('-l, --limit <number>', 'Maximum incidents to show', '10')
  .option('-s, --status <status>', 'Filter by status')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { triageListCommand } = await import('./commands/triage/index.js');
    await triageListCommand(options);
  });

// Parse and run
program.parse();
