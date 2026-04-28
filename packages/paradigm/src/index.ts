/**
 * Paradigm CLI - Unified command-line interface
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { createRequire } from 'node:module';
import { registerUtilCommands } from './commands/util/index.js';

const require = createRequire(import.meta.url);
const { version: VERSION } = require('../package.json');

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

// v6.0.4 — one-time migration notice for cohort C (projects with ~aspects
// but no compliance archetype on the roster). preAction fires before any
// subcommand action; commander short-circuits before this for --version /
// --help, so those invocations stay quiet.
program.hook('preAction', async () => {
  try {
    const { checkAndEmitMigrationNotices } = await import('./core/migration-notices.js');
    await checkAndEmitMigrationNotices(process.cwd());
  } catch {
    // Never let migration-notice machinery interfere with command execution.
  }
});

// paradigm init
program
  .command('init')
  .description('Initialize Paradigm in the current project')
  .option('-f, --force', 'Overwrite existing files')
  .option('--name <name>', 'Project name')
  .option('--ide <ide>', 'Target IDE: cursor, copilot, windsurf, claude')
  .option('--stack <stack>', 'Stack preset (e.g., nextjs, fastapi, swift-ios). Auto-detected if omitted.')
  .option('--migrate', 'Output migration prompt for existing IDE files')
  .option('--quick', 'Non-interactive mode with smart defaults')
  .option('--dry-run', 'Show what would be created without creating')
  .action(async (options) => {
    const { initCommand } = await import('./commands/init.js');
    await initCommand(options);
  });

// paradigm shift - one command to rule them all
program
  .command('shift')
  .description('Full project setup in one command (init + team init + scan + sync all IDEs + doctor)')
  .option('-f, --force', 'Reinitialize even if already setup')
  .option('-q, --quick', 'Skip slow operations (scan)')
  .option('--verify', 'Run health checks after setup')
  .option('--ide <ide>', 'Target specific IDE instead of all')
  .option('--configure-models', 'Force model configuration prompts for team agents')
  .option('--stack <stack>', 'Stack preset (e.g., nextjs, fastapi, swift-ios). Auto-detected if omitted.')
  .option('--workspace <name>', 'Create or join a multi-project workspace with this name (creates ../.paradigm-workspace)')
  .option('--workspace-path <path>', 'Custom workspace file location (default: ../.paradigm-workspace)')
  .option('--no-prompt', 'Skip interactive prompts (e.g., compliance-archetype nomination)')
  .action(async (options) => {
    const { shiftCommand } = await import('./commands/shift.js');
    await shiftCommand(options);
  });

// paradigm presets - list available stack presets
program
  .command('presets')
  .description('List available stack presets for paradigm init/shift')
  .option('-d, --discipline <discipline>', 'Filter by discipline (e.g., fullstack, api, mobile)')
  .action(async (options) => {
    const { listStackPresets } = await import('./core/discipline.js');
    const chalk = (await import('chalk')).default;
    const presets = listStackPresets(options.discipline);

    if (presets.length === 0) {
      console.log(chalk.yellow(`\n  No presets found${options.discipline ? ` for discipline: ${options.discipline}` : ''}\n`));
      return;
    }

    console.log(chalk.blue('\n  Available Stack Presets\n'));
    console.log(chalk.gray('  Use with: paradigm init --stack <id> or paradigm shift --stack <id>\n'));

    // Group by discipline
    const byDiscipline = new Map<string, typeof presets>();
    for (const preset of presets) {
      const group = byDiscipline.get(preset.discipline) || [];
      group.push(preset);
      byDiscipline.set(preset.discipline, group);
    }

    for (const [discipline, group] of byDiscipline) {
      console.log(chalk.white(`  ${discipline}`));
      for (const preset of group) {
        console.log(chalk.cyan(`    ${preset.id.padEnd(20)}`) + chalk.gray(preset.name));
      }
      console.log('');
    }

    console.log(chalk.gray(`  ${presets.length} presets available. Auto-detected when --stack is omitted.\n`));
  });

// paradigm event emit — fire-and-forget event for hook integration
const eventCmd = program
  .command('event')
  .description('Ambient event stream commands');

eventCmd
  .command('emit')
  .description('Emit an event to the ambient event stream (fast, for hook integration)')
  .requiredOption('--type <type>', 'Event type (e.g., file-modified, compliance-violation)')
  .requiredOption('--source <source>', 'Event source (e.g., post-write-hook, stop-hook)')
  .option('--path <path>', 'File path (if applicable)')
  .option('--symbols <symbols...>', 'Paradigm symbols referenced')
  .option('--context <context>', 'Brief context snippet')
  .option('--severity <severity>', 'Severity: info, warning, error, critical')
  .action(async (options) => {
    const { eventEmitCommand } = await import('./commands/event.js');
    await eventEmitCommand(options);
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
  .action(async () => {
    const { statusCommand } = await import('./commands/status.js');
    await statusCommand();
  });

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
  .command('check')
  .description('Check portal gate implementation compliance (declared vs used)')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { portalCheckCommand } = await import('./commands/portal-check.js');
    await portalCheckCommand(options);
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

portalCmd
  .command('export [path]')
  .description('Export portal configuration in json, csv, or markdown format')
  .option('-f, --format <format>', 'Output format: json, csv, markdown', 'json')
  .option('-o, --output <path>', 'Output file path')
  .option('-c, --config <path>', 'Path to portal.yaml')
  .action(async (path, options) => {
    const { portalExportCommand } = await import('./commands/portal/watch.js');
    await portalExportCommand(path, options);
  });

// paradigm premise <command>
const premiseCmd = program
  .command('premise')
  .description('Premise-related commands');

premiseCmd
  .command('aggregate [path]')
  .description('Aggregate all sources into symbol index')
  .action(async (path = '.') => {
    const { premiseAggregateCommand } = await import('./commands/premise/aggregate.js');
    await premiseAggregateCommand(path);
  });

premiseCmd
  .command('snapshot <name>')
  .description('Create a timeline snapshot')
  .option('-d, --description <desc>', 'Snapshot description')
  .action(async (name, options) => {
    const { premiseSnapshotCommand } = await import('./commands/premise/snapshot.js');
    await premiseSnapshotCommand(name, options.description);
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

// paradigm sync-llms
program
  .command('sync-llms')
  .description('Generate llms.txt — LLM-readable project summary')
  .option('-o, --output <path>', 'Output path (default: ./llms.txt)')
  .action(async (options) => {
    process.stderr.write('⚠ `paradigm sync-llms` has moved. Use `paradigm util sync-llms` instead.\n');
    const { syncLlmsCommand } = await import('./commands/sync-llms.js');
    await syncLlmsCommand(options);
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
    process.stderr.write('⚠ `paradigm probe` has moved. Use `paradigm util probe` instead.\n');
    const { indexCommand } = await import('./commands/probe/index.js');
    await indexCommand(path, options);
  });

// paradigm migrate
const migrateCmd = program
  .command('migrate')
  .description('Detect and apply migrations to bring project up to date')
  .option('--dry-run', 'Preview changes without applying')
  .option('--apply', 'Apply all auto migrations without prompting')
  .option('-f, --force', 'Re-run previously applied migrations')
  .option('--only <ids...>', 'Run specific migrations by ID')
  .option('--category <cat>', 'Run migrations in a category (directory, config, template, hook)')
  .option('--no-sync', 'Skip template sync')
  .option('--list', 'List all migrations and their status')
  .option('-v, --verbose', 'Show detailed output')
  .action(async (options) => {
    const { migrateCommand } = await import('./commands/migrate/index.js');
    await migrateCommand(options);
  });

// paradigm migrate decisions — v6.0 decision-store consolidation (hidden)
migrateCmd
  .command('decisions', { hidden: true })
  .description('v6.0: consolidate wisdom-decisions + lore-decisions into .paradigm/decisions/')
  .option('--dry-run', 'Preview migration without writes')
  .option('--json', 'Emit JSON summary')
  .action(async (options) => {
    const { migrateDecisionsCommand } = await import('./commands/migrate-decisions.js');
    await migrateDecisionsCommand(options);
  });

// paradigm upgrade (deprecated — use `paradigm migrate`)
program
  .command('upgrade [path]')
  .description('(Deprecated) Upgrade project with new Paradigm features — use `paradigm migrate`')
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
  .option('--auto-populate', 'Scan for undocumented source dirs and suggest .purpose entries (use with --fix to write)')
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

// paradigm explain-files
program
  .command('explain-files')
  .alias('files')
  .description('Explain all Paradigm config and generated files')
  .action(async () => {
    const { explainFilesCommand } = await import('./commands/explain-files.js');
    await explainFilesCommand();
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
  .option('--init', 'Full project initialization: generate .purpose files + portal.yaml')
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

// paradigm flow <subcommand>
const flowCmd = program
  .command('flow')
  .description('Flow management commands');

flowCmd
  .command('diagram <flowId>')
  .description('Generate Mermaid diagram for a flow')
  .option('-o, --output <path>', 'Output file path')
  .action(async (flowId, options) => {
    const { flowDiagramCommand } = await import('./commands/flow.js');
    await flowDiagramCommand(flowId, options);
  });

flowCmd.action(() => {
  flowCmd.outputHelp();
});

// paradigm team <subcommand>
const teamCmd = program
  .command('team')
  .description('Multi-agent orchestration commands');

teamCmd
  .command('init [path]')
  .description('Initialize team configuration with default agents')
  .option('-f, --force', 'Overwrite existing configuration')
  .option('--configure-models', 'Force model configuration prompts')
  .option('--no-configure-models', 'Skip model configuration')
  .option('--json', 'Output as JSON')
  .action(async (path, options) => {
    const { teamInitCommand } = await import('./commands/team/index.js');
    await teamInitCommand(path, {
      ...options,
      configureModels: options.configureModels,
      noConfigureModels: options.configureModels === false,
    });
  });

teamCmd
  .command('status [path]')
  .description('Show current team status')
  .option('--running', 'Show only running orchestrations')
  .option('--id <id>', 'Show specific orchestration')
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
  .option('--background', 'Run in background mode (returns immediately)')
  .option('--notify <methods>', 'Notification methods: bell,desktop,file,webhook (default: bell)')
  .option('-m, --model <model>', 'Orchestrator model: opus, sonnet, haiku')
  .option('-p, --provider <provider>', 'Provider: auto, claude, claude-code, claude-cli, manual')
  .option('--budget <budget>', 'Budget limits (e.g., "tokens=500000,cost=5")')
  .option('--checkpoint', 'Pause for approval between agents')
  .option('--live', 'Stream agent output live')
  .option('--pm', 'Enable PM governance (compliance checks before/after)')
  .option('-q, --quiet', 'Suppress output')
  .option('--json', 'Output as JSON')
  .action(async (task, path, options) => {
    const { teamOrchestrateCommand } = await import('./commands/team/orchestrate.js');
    await teamOrchestrateCommand(task, path, options);
  });

// paradigm team diff <orchestration-id>
teamCmd
  .command('diff <orchestration-id> [path]')
  .description('Show diff of changes from a completed orchestration')
  .option('--full', 'Show full file contents')
  .option('--json', 'Output as JSON')
  .action(async (orchestrationId, path, options) => {
    const { teamDiffCommand } = await import('./commands/team/diff.js');
    await teamDiffCommand(orchestrationId, path, options);
  });

// paradigm team accept-orch <orchestration-id>
teamCmd
  .command('accept-orch <orchestration-id> [path]')
  .description('Accept orchestration changes')
  .option('-n, --note <text>', 'Acceptance note')
  .option('--json', 'Output as JSON')
  .action(async (orchestrationId, path, options) => {
    const { teamAcceptOrchestrationCommand } = await import('./commands/team/accept-orchestration.js');
    await teamAcceptOrchestrationCommand(orchestrationId, path, options);
  });

// paradigm team reject-orch <orchestration-id>
teamCmd
  .command('reject-orch <orchestration-id> [path]')
  .description('Reject orchestration changes')
  .option('-r, --reason <text>', 'Rejection reason')
  .option('--cleanup', 'Delete created files')
  .option('--json', 'Output as JSON')
  .action(async (orchestrationId, path, options) => {
    const { teamRejectOrchestrationCommand } = await import('./commands/team/accept-orchestration.js');
    await teamRejectOrchestrationCommand(orchestrationId, path, options);
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

// paradigm team models
teamCmd
  .command('models [path]')
  .description('Configure or view agent model assignments')
  .option('--refresh', 'Refresh model cache from environment')
  .option('--json', 'Output as JSON')
  .action(async (path, options) => {
    const { teamModelsCommand } = await import('./commands/team/index.js');
    await teamModelsCommand(path, options);
  });

// paradigm team agents <subcommand>
const agentsCmd = teamCmd
  .command('agents')
  .description('Agent management commands');

agentsCmd
  .command('suggest <task>')
  .description('Suggest agents for a task based on triggers')
  .option('--json', 'Output as JSON')
  .action(async (task, options) => {
    const { agentsSuggestCommand } = await import('./commands/team/agents-suggest.js');
    await agentsSuggestCommand(task, options);
  });

// Default agents action (help)
agentsCmd
  .action(() => {
    console.log('\nUsage: paradigm team agents <command>\n');
    console.log('Commands:');
    console.log('  suggest <task>  Suggest agents for a task based on triggers');
    console.log('\nRun `paradigm team agents suggest --help` for options.\n');
  });

// Default team action (show status)
teamCmd
  .action(async () => {
    const { teamStatusCommand } = await import('./commands/team/index.js');
    await teamStatusCommand(undefined, {});
  });

// paradigm plugin <command>
const pluginCmd = program
  .command('plugin')
  .description('Plugin management commands');

pluginCmd
  .command('check')
  .description('Check for updates to installed Claude Code plugins')
  .option('-u, --update', 'Pull latest changes for all stale marketplace clones')
  .action(async (options) => {
    const { pluginCheckCommand } = await import('./commands/plugin/check.js');
    await pluginCheckCommand(options);
  });

// Default plugin action (check)
pluginCmd
  .action(async () => {
    const { pluginCheckCommand } = await import('./commands/plugin/check.js');
    await pluginCheckCommand({});
  });

// paradigm workspace <subcommand>
const workspaceCmd = program
  .command('workspace')
  .description('Multi-project workspace commands');

workspaceCmd
  .command('init')
  .description('Create a .paradigm-workspace file from sibling projects')
  .option('-n, --name <name>', 'Workspace name (default: directory name)')
  .option('-f, --force', 'Overwrite existing workspace file')
  .action(async (options) => {
    const { workspaceInitCommand } = await import('./commands/workspace/index.js');
    await workspaceInitCommand(options);
  });

workspaceCmd
  .command('status')
  .description('Show workspace member status and symbol counts')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { workspaceStatusCommand } = await import('./commands/workspace/index.js');
    await workspaceStatusCommand(options);
  });

workspaceCmd
  .command('reindex')
  .description('Rebuild scan-index.json for all workspace members')
  .option('-q, --quiet', 'Suppress progress output')
  .action(async (options) => {
    const { workspaceReindexCommand } = await import('./commands/workspace/index.js');
    await workspaceReindexCommand(options);
  });

// Default workspace action (show status)
workspaceCmd
  .action(async () => {
    const { workspaceStatusCommand } = await import('./commands/workspace/index.js');
    await workspaceStatusCommand({});
  });

// paradigm doctor
program
  .command('doctor')
  .description('Health check - validate Paradigm setup')
  .option('--context', 'Run only context audit checks (CLAUDE.md quality)')
  .option('--explain', 'Include human-readable gap narrations explaining each issue and how to fix it')
  .action(async (options) => {
    const { doctorCommand } = await import('./commands/doctor/index.js');
    await doctorCommand(options);
  });

// paradigm integrity
program
  .command('integrity')
  .description('Symbol integrity check — broken refs, duplicates, orphans, missing anchors')
  .option('--json', 'Output machine-readable JSON')
  .action(async (options) => {
    const { integrityCommand } = await import('./commands/integrity.js');
    await integrityCommand(options);
  });

// paradigm review
program
  .command('review')
  .description('Automated two-stage review pipeline — spec compliance + code quality')
  .option('--pr <number>', 'Review a PR via gh CLI')
  .option('--ci', 'Exit 1 on blocking findings')
  .option('--deep', 'Include code quality checks (eval, secrets, console.log)')
  .option('--json', 'Output machine-readable JSON')
  .action(async (options) => {
    const { reviewCommand } = await import('./commands/review/index.js');
    await reviewCommand(options);
  });

// paradigm sweep
program
  .command('sweep')
  .description('Entropy detection and cleanup — find orphaned symbols, stale purpose files, phantom gates')
  .option('--dry', 'Report only, no fixes applied')
  .option('--skip-fix', 'Same as --dry')
  .option('-q, --quiet', 'Minimal output')
  .action(async (options) => {
    const { sweepCommand } = await import('./commands/sweep/index.js');
    await sweepCommand(options);
  });

// paradigm drift <subcommand>
const driftCmd = program
  .command('drift')
  .description('Aspect anchor drift detection');

driftCmd
  .command('check')
  .description('Check aspect anchors for drift and auto-heal shifted anchors')
  .option('--json', 'Output as JSON')
  .option('--auto-heal', 'Auto-heal shifted anchors (default: true)')
  .option('--no-auto-heal', 'Disable auto-healing')
  .action(async (options) => {
    const { driftCheckCommand } = await import('./commands/drift.js');
    await driftCheckCommand(options);
  });

// paradigm global <subcommand>
const globalCmd = program
  .command('global')
  .description('Manage Global Brain (~/.paradigm/)');

globalCmd
  .command('clean')
  .description('Remove old files from ~/.paradigm/ (Global Brain rotation)')
  .option('--older-than <duration>', 'Remove files older than duration (e.g., 90d, 30d, 7d)', '90d')
  .option('-n, --dry-run', 'Show what would be deleted without deleting')
  .action(async (options) => {
    const { globalCleanCommand } = await import('./commands/global.js');
    await globalCleanCommand(options);
  });

globalCmd.action(() => {
  globalCmd.outputHelp();
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
    process.stderr.write('⚠ `paradigm constellation` has moved. Use `paradigm util constellation` instead.\n');
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
    process.stderr.write('⚠ `paradigm beacon` has moved. Use `paradigm util beacon` instead.\n');
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
    process.stderr.write('⚠ `paradigm thread` is being consolidated. Use `paradigm util thread` instead.\n');
    const { threadShowCommand } = await import('./commands/thread.js');
    await threadShowCommand(path, options);
  });

threadCmd
  .command('save <message> [path]')
  .description('Save activity to the thread trail')
  .option('-q, --quiet', 'Suppress output')
  .action(async (message, path, options) => {
    process.stderr.write('⚠ `paradigm thread` is being consolidated. Use `paradigm util thread` instead.\n');
    const { threadSaveCommand } = await import('./commands/thread.js');
    await threadSaveCommand(message, path, options);
  });

threadCmd
  .command('todo <task> [path]')
  .description('Add a loose end (unfinished task)')
  .option('-q, --quiet', 'Suppress output')
  .action(async (task, path, options) => {
    process.stderr.write('⚠ `paradigm thread` is being consolidated. Use `paradigm util thread` instead.\n');
    const { threadTodoCommand } = await import('./commands/thread.js');
    await threadTodoCommand(task, path, options);
  });

threadCmd
  .command('note <note> [path]')
  .description('Add a breadcrumb (note for next agent)')
  .option('-q, --quiet', 'Suppress output')
  .action(async (note, path, options) => {
    process.stderr.write('⚠ `paradigm thread` is being consolidated. Use `paradigm util thread` instead.\n');
    const { threadNoteCommand } = await import('./commands/thread.js');
    await threadNoteCommand(note, path, options);
  });

threadCmd
  .command('clear [path]')
  .description('Clear the thread')
  .option('-q, --quiet', 'Suppress output')
  .action(async (path, options) => {
    process.stderr.write('⚠ `paradigm thread` is being consolidated. Use `paradigm util thread` instead.\n');
    const { threadClearCommand } = await import('./commands/thread.js');
    await threadClearCommand(path, options);
  });

// Default thread action (show)
threadCmd
  .option('--json', 'Output as JSON (for AI agent queries)')
  .action(async (options) => {
    process.stderr.write('⚠ `paradigm thread` is being consolidated. Use `paradigm util thread` instead.\n');
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
    process.stderr.write('⚠ `paradigm echo` has moved. Use `paradigm util echo` instead.\n');
    const { echoCommand } = await import('./commands/echo.js');
    await echoCommand(errorCode, path, options);
  });

echoCmd
  .command('init [path]')
  .description('Create .paradigm/echoes.yaml template')
  .option('-q, --quiet', 'Suppress output')
  .action(async (path, options) => {
    process.stderr.write('⚠ `paradigm echo` has moved. Use `paradigm util echo` instead.\n');
    const { echoInitCommand } = await import('./commands/echo.js');
    await echoInitCommand(path, options);
  });

echoCmd
  .command('list [path]')
  .alias('ls')
  .description('List all error mappings')
  .action(async (path) => {
    process.stderr.write('⚠ `paradigm echo` has moved. Use `paradigm util echo` instead.\n');
    const { echoListCommand } = await import('./commands/echo.js');
    await echoListCommand(path);
  });

// Default echo action (with error code argument)
echoCmd
  .argument('[errorCode]', 'Error code to look up')
  .option('--json', 'Output as JSON (for AI agent queries)')
  .action(async (errorCode, options) => {
    process.stderr.write('⚠ `paradigm echo` has moved. Use `paradigm util echo` instead.\n');
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

mcpCmd
  .command('use-dev')
  .description('Switch MCP configs to use local dev build')
  .option('-c, --client <client>', 'Target client: cursor, claude-desktop, claude-code, continue, cline')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { mcpUseDevCommand } = await import('./commands/mcp/switch.js');
    await mcpUseDevCommand(options);
  });

mcpCmd
  .command('use-prod')
  .description('Switch MCP configs back to global production binary')
  .option('-c, --client <client>', 'Target client: cursor, claude-desktop, claude-code, continue, cline')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { mcpUseProdCommand } = await import('./commands/mcp/switch.js');
    await mcpUseProdCommand(options);
  });

// Default mcp action (show enhanced status with DEV/PROD indicators)
mcpCmd
  .action(async () => {
    const { mcpSwitchStatusCommand } = await import('./commands/mcp/switch.js');
    await mcpSwitchStatusCommand({});
  });

// paradigm promote
program
  .command('promote')
  .description('Copy local build to production (~/.paradigm-cli/)')
  .option('-f, --force', 'Create production directory if missing')
  .option('--skip-build', 'Skip npm run build step')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { promoteCommand } = await import('./commands/promote.js');
    await promoteCommand(options);
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
  .description('Install git hooks, Claude Code hooks, and Cursor hooks')
  .option('-f, --force', 'Overwrite existing hooks')
  .option('--post-commit', 'Only install post-commit hook')
  .option('--pre-push', 'Only install pre-push hook')
  .option('--claude-code', 'Only install Claude Code hooks (stop + pre-commit)')
  .option('--cursor', 'Only install Cursor hooks (.cursor/hooks.json)')
  .option('--dry-run', 'Show what would be installed without making changes')
  .action(async (options) => {
    const { hooksInstallCommand } = await import('./commands/hooks/index.js');
    await hooksInstallCommand(options);
  });

hooksCmd
  .command('uninstall')
  .description('Remove paradigm hooks (git hooks, or --cursor for Cursor hooks)')
  .option('--cursor', 'Remove Cursor hooks instead of git hooks')
  .option('--dry-run', 'Show what would be removed without making changes')
  .action(async (options) => {
    const { hooksUninstallCommand } = await import('./commands/hooks/index.js');
    await hooksUninstallCommand(options);
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

// paradigm lore <command>
const loreCmd = program
  .command('lore')
  .description('Project lore - timeline of everything that happened to this project');

loreCmd
  .command('list')
  .alias('ls')
  .description('List recent lore entries')
  .option('--author <author>', 'Filter by author')
  .option('--type <type>', 'Filter by type: agent-session, human-note, decision, review, incident, milestone, retro, insight')
  .option('--symbol <symbol>', 'Filter by symbol')
  .option('--tags <tags>', 'Filter by tags (comma-separated)')
  .option('--from <date>', 'Filter from date (ISO format, e.g., 2026-02-20)')
  .option('--to <date>', 'Filter to date (ISO format)')
  .option('-l, --limit <number>', 'Number of entries', '20')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { loreListCommand } = await import('./commands/lore/list.js');
    await loreListCommand(options);
  });

loreCmd
  .command('show <id>')
  .description('Show full detail for a lore entry')
  .option('--json', 'Output as JSON')
  .action(async (id, options) => {
    const { loreShowCommand } = await import('./commands/lore/show.js');
    await loreShowCommand(id, options);
  });

loreCmd
  .command('record')
  .description('Record a new lore entry (human note, milestone, etc.)')
  .option('--type <type>', 'Entry type: human-note, decision, milestone, retro, insight', 'human-note')
  .option('--author <author>', 'Author name')
  .option('--title <title>', 'Entry title')
  .option('--summary <summary>', 'Entry summary')
  .option('--symbols <symbols>', 'Comma-separated symbols')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('--files-modified <files>', 'Comma-separated files modified')
  .option('--files-created <files>', 'Comma-separated files created')
  .option('--commit <hash>', 'Git commit hash')
  .option('--learnings <items>', 'Comma-separated learnings')
  .option('--duration <minutes>', 'Duration in minutes')
  .option('--meta <json>', 'Project-defined metadata as JSON (e.g., \'{"sprint": 12}\')')
  .option('--body <text>', 'Long-form content (detailed notes, rationale, etc.)')
  .option('--link-lore <ids>', 'Comma-separated lore entry IDs to link')
  .option('--link-commits <shas>', 'Comma-separated git commit SHAs to link')
  .option('--confidence <number>', 'Confidence in correctness (0.0 to 1.0)')
  .action(async (options) => {
    const { loreRecordCommand } = await import('./commands/lore/record.js');
    await loreRecordCommand(options);
  });

loreCmd
  .command('review <id>')
  .description('Add a review to a lore entry')
  .option('--reviewer <name>', 'Reviewer name')
  .option('--completeness <n>', 'Completeness score (1-5)', '3')
  .option('--quality <n>', 'Quality score (1-5)', '3')
  .option('--notes <text>', 'Review notes')
  .action(async (id, options) => {
    const { loreReviewCommand } = await import('./commands/lore/review.js');
    await loreReviewCommand(id, options);
  });

loreCmd
  .command('assess <id> <verdict>')
  .description('Record an assessment verdict on a lore entry (correct/partial/incorrect)')
  .option('--assessor <name>', 'Assessor name')
  .option('--notes <text>', 'Assessment notes')
  .action(async (id, verdict, options) => {
    const { loreAssessCommand } = await import('./commands/lore/assess.js');
    await loreAssessCommand(id, verdict, options);
  });

loreCmd
  .command('calibration')
  .description('Show calibration statistics across assessed lore entries')
  .option('--symbol <symbol>', 'Filter by symbol')
  .option('--tag <tag>', 'Filter by tag')
  .option('--author <author>', 'Filter by author')
  .option('--group-by <dimension>', 'Group by: symbol, tag, type')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { loreCalibrationCommand } = await import('./commands/lore/calibration.js');
    await loreCalibrationCommand(options);
  });

loreCmd
  .command('edit <id>')
  .description('Edit an existing lore entry')
  .option('--title <title>', 'New title')
  .option('--summary <summary>', 'New summary')
  .option('--type <type>', 'New type: agent-session, human-note, decision, review, incident, milestone')
  .option('--symbols <symbols>', 'Comma-separated symbols')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('--learnings <items>', 'Comma-separated learnings')
  .action(async (id, options) => {
    const { loreEditCommand } = await import('./commands/lore/edit.js');
    await loreEditCommand(id, options);
  });

loreCmd
  .command('delete <id>')
  .description('Delete a lore entry')
  .option('-y, --yes', 'Skip confirmation')
  .option('--dry-run', 'Show what would be deleted without making changes')
  .action(async (id, options) => {
    const { loreDeleteCommand } = await import('./commands/lore/delete.js');
    await loreDeleteCommand(id, options);
  });

loreCmd
  .command('migrate-assessments')
  .description('Migrate assessment entries to lore with arc: tags')
  .option('--dry-run', 'Show what would be migrated without making changes')
  .action(async (options) => {
    const { loreMigrateAssessmentsCommand } = await import('./commands/lore/migrate-assessments.js');
    await loreMigrateAssessmentsCommand(options);
  });

loreCmd
  .command('retag')
  .description('Add or remove tags from matching lore entries')
  .option('--add <tag>', 'Tag to add')
  .option('--remove <tag>', 'Tag to remove')
  .option('--type <type>', 'Filter by entry type')
  .option('--symbol <symbol>', 'Filter by symbol')
  .option('--author <author>', 'Filter by author')
  .option('--from <date>', 'Filter from date')
  .option('--to <date>', 'Filter to date')
  .option('--tags <tags>', 'Filter by existing tags (comma-separated)')
  .option('--dry-run', 'Show what would change without making changes')
  .action(async (options) => {
    const { loreRetagCommand } = await import('./commands/lore/retag.js');
    await loreRetagCommand(options);
  });

loreCmd
  .command('timeline')
  .description('Show lore timeline grouped by date with hot symbols and authors')
  .option('-l, --limit <number>', 'Number of entries', '20')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { loreTimelineCommand } = await import('./commands/lore/timeline.js');
    await loreTimelineCommand(options);
  });

// Default lore action: launch timeline UI
loreCmd
  .option('-p, --port <port>', 'Port to run on', '3840')
  .option('--no-open', "Don't open browser automatically")
  .action(async (options) => {
    const { loreServeCommand } = await import('./commands/lore/serve.js');
    await loreServeCommand(undefined, options);
  });

// paradigm serve — unified Platform server
program
  .command('serve')
  .description('Launch Paradigm Platform — unified development management UI')
  .option('-p, --port <port>', 'Port to run on', '3850')
  .option('--no-open', "Don't open browser automatically")
  .option('--sections <list>', 'Comma-separated sections to enable (e.g., lore,graph,git)')
  .action(async (options) => {
    const { serveCommand } = await import('./commands/serve.js');
    await serveCommand(options);
  });

// paradigm graph — interactive symbol graph (with subcommands)
const graphCmd = program
  .command('graph')
  .description('Interactive symbol relationship graph')
  .argument('[path]', 'Project directory', undefined)
  .option('-p, --port <port>', 'Port to run on', '3841')
  .option('--no-open', "Don't open browser automatically")
  .action(async (path, options) => {
    const { graphCommand } = await import('./commands/graph.js');
    await graphCommand(path, options);
  });

graphCmd
  .command('generate')
  .description('Generate a named graph file in .paradigm/graphs/')
  .argument('<name>', 'Graph name (used as filename: {name}.graph.json)')
  .argument('[path]', 'Project directory', undefined)
  .option('-s, --symbols <list>', 'Comma-separated symbol names to include')
  .option('-g, --group <spec...>', 'Group spec: "Label:#sym1,#sym2" (repeatable)')
  .option('-l, --link <spec...>', 'Link spec: "Source>Target:label" (repeatable)')
  .action(async (name, path, options) => {
    const { graphGenerateCommand } = await import('./commands/graph.js');
    await graphGenerateCommand(name, path, options);
  });

// paradigm habits <command>
const habitsCmd = program
  .command('habits')
  .description('Behavioral habits - practice tracking and compliance');

habitsCmd
  .command('list')
  .alias('ls')
  .description('List all configured habits')
  .option('--trigger <trigger>', 'Filter by trigger: preflight, postflight, on-stop, on-commit')
  .option('--category <category>', 'Filter by category: discovery, verification, testing, documentation, collaboration, security')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { habitsListCommand } = await import('./commands/habits/index.js');
    await habitsListCommand(options);
  });

habitsCmd
  .command('status')
  .description('Show practice profile with compliance rates')
  .option('-p, --period <period>', 'Time period: 7d, 30d, 90d, all', '30d')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { habitsStatusCommand } = await import('./commands/habits/index.js');
    await habitsStatusCommand(options);
  });

habitsCmd
  .command('init')
  .description('Initialize habits.yaml with seed habits')
  .option('-f, --force', 'Overwrite existing file')
  .action(async (options) => {
    const { habitsInitCommand } = await import('./commands/habits/index.js');
    await habitsInitCommand(options);
  });

habitsCmd
  .command('check')
  .description('Evaluate habit compliance for a trigger point')
  .requiredOption('-t, --trigger <trigger>', 'Trigger: preflight, postflight, on-stop, on-commit')
  .option('--record', 'Record practice events to Sentinel')
  .option('--json', 'Output as JSON')
  .option('--files <files>', 'Comma-separated files modified (default: git diff)')
  .option('--symbols <symbols>', 'Comma-separated symbols touched')
  .action(async (options) => {
    const { habitsCheckCommand } = await import('./commands/habits/index.js');
    await habitsCheckCommand(options);
  });

habitsCmd
  .command('add')
  .description('Add a custom habit')
  .requiredOption('--id <id>', 'Habit ID (kebab-case)')
  .requiredOption('--name <name>', 'Human-readable name')
  .requiredOption('--description <desc>', 'What this habit enforces')
  .requiredOption('--category <category>', 'Category: discovery, verification, testing, documentation, collaboration, security')
  .requiredOption('--trigger <trigger>', 'Trigger: preflight, postflight, on-stop, on-commit')
  .option('--severity <severity>', 'Severity: advisory, warn, block', 'advisory')
  .option('--tools <tools>', 'Comma-separated tools to check (for tool-called check type)')
  .option('--check-type <type>', 'Check type: tool-called, file-exists, file-modified, lore-recorded, symbols-registered, gates-declared, tests-exist, git-clean', 'tool-called')
  .option('--patterns <patterns>', 'Comma-separated patterns (for file-exists, file-modified, tests-exist check types)')
  .action(async (options) => {
    const { habitsAddCommand } = await import('./commands/habits/index.js');
    await habitsAddCommand({ ...options, checkType: options.checkType });
  });

habitsCmd
  .command('edit <id>')
  .description('Edit a habit (seed habits: only severity/enabled; custom: all fields)')
  .option('--name <name>', 'New name')
  .option('--description <desc>', 'New description')
  .option('--category <category>', 'New category')
  .option('--trigger <trigger>', 'New trigger')
  .option('--severity <severity>', 'New severity: advisory, warn, block')
  .option('--enabled <bool>', 'Enable or disable: true, false')
  .option('--check-type <type>', 'New check type')
  .option('--patterns <patterns>', 'Comma-separated patterns')
  .option('--tools <tools>', 'Comma-separated tools')
  .action(async (id, options) => {
    const { habitsEditCommand } = await import('./commands/habits/index.js');
    await habitsEditCommand(id, { ...options, checkType: options.checkType });
  });

habitsCmd
  .command('remove <id>')
  .description('Remove a custom habit (seed habits cannot be removed, only disabled)')
  .option('-y, --yes', 'Skip confirmation')
  .action(async (id, options) => {
    const { habitsRemoveCommand } = await import('./commands/habits/index.js');
    await habitsRemoveCommand(id, options);
  });

habitsCmd
  .command('enable <id>')
  .description('Enable a habit')
  .action(async (id) => {
    const { habitsToggleCommand } = await import('./commands/habits/index.js');
    await habitsToggleCommand(id, 'enable');
  });

habitsCmd
  .command('disable <id>')
  .description('Disable a habit')
  .action(async (id) => {
    const { habitsToggleCommand } = await import('./commands/habits/index.js');
    await habitsToggleCommand(id, 'disable');
  });

// Default habits action (list)
habitsCmd
  .action(async () => {
    const { habitsListCommand } = await import('./commands/habits/index.js');
    await habitsListCommand({});
  });

// paradigm graduate - Automation tier graduation
const graduateCmd = program
  .command('graduate')
  .description('Automation tier graduation — migrate habits to hooks');

graduateCmd
  .command('status', { isDefault: true })
  .description('Show current automation tier of every habit')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { graduateStatusCommand } = await import('./commands/graduate/index.js');
    await graduateStatusCommand(options);
  });

graduateCmd
  .command('promote <habitId>')
  .description('Graduate a habit to hook tier (skip MCP evaluation)')
  .action(async (habitId) => {
    const { graduatePromoteCommand } = await import('./commands/graduate/index.js');
    await graduatePromoteCommand(habitId);
  });

graduateCmd
  .command('demote <habitId>')
  .description('Demote a habit from hook back to habit tier')
  .option('--cooldown <days>', 'Cooldown period in days before re-graduation', '14')
  .action(async (habitId, options) => {
    const { graduateDemoteCommand } = await import('./commands/graduate/index.js');
    await graduateDemoteCommand(habitId, options);
  });

// paradigm persona - Actor-driven journey testing
const personaCmd = program
  .command('persona')
  .description('Personas — actor-driven journey testing');

personaCmd
  .command('list', { isDefault: true })
  .alias('ls')
  .description('List all personas')
  .option('--tag <tag>', 'Filter by tag')
  .option('--trigger <type>', 'Filter by trigger type (root, invitation, signup, api)')
  .option('--gate <gate>', 'Filter by gate usage')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { personaListCommand } = await import('./commands/persona/index.js');
    await personaListCommand(options);
  });

personaCmd
  .command('show <id>')
  .description('Show full persona detail')
  .option('--json', 'Output as JSON')
  .action(async (id, options) => {
    const { personaShowCommand } = await import('./commands/persona/index.js');
    await personaShowCommand(id, options);
  });

personaCmd
  .command('validate [id]')
  .description('Validate persona schema and cross-references')
  .option('--json', 'Output as JSON')
  .action(async (id, options) => {
    const { personaValidateCommand } = await import('./commands/persona/index.js');
    await personaValidateCommand(id, options);
  });

personaCmd
  .command('coverage')
  .description('Coverage report — routes and gates with/without persona coverage')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { personaCoverageCommand } = await import('./commands/persona/index.js');
    await personaCoverageCommand(options);
  });

personaCmd
  .command('run <id>')
  .description('Execute persona journey against a running server')
  .requiredOption('--base-url <url>', 'Base URL (e.g. http://localhost:3000)')
  .option('--dry-run', 'Show steps without making HTTP requests')
  .option('--json', 'Output as JSON')
  .action(async (id, options) => {
    const { personaRunCommand } = await import('./commands/persona/index.js');
    await personaRunCommand(id, options);
  });

personaCmd
  .command('affected <symbol>')
  .description('Show which personas reference a given symbol (gate, flow, signal)')
  .option('--json', 'Output as JSON')
  .action(async (symbol, options) => {
    const { personaAffectedCommand } = await import('./commands/persona/index.js');
    await personaAffectedCommand(symbol, options);
  });

personaCmd
  .command('delete <id>')
  .description('Delete a persona')
  .action(async (id) => {
    const { personaDeleteCommand } = await import('./commands/persona/index.js');
    await personaDeleteCommand(id);
  });

// paradigm sentinel defend - Launch the unified codebase intelligence UI
const sentinelCmd = program
  .command('sentinel')
  .description('Sentinel — semantic error monitoring');

sentinelCmd
  .command('defend [path]', { isDefault: true })
  .description('Launch the Sentinel UI - unified codebase intelligence visualizer')
  .option('-p, --port <port>', 'Port to run on', '3838')
  .option('--no-open', "Don't open browser automatically")
  .action(async (path, options) => {
    const { sentinelCommand } = await import('./commands/sentinel.js');
    await sentinelCommand(path, options);
  });

// paradigm conductor - Launch the multimodal mission control overlay
program
  .command('conductor')
  .description('Launch Paradigm Conductor — multimodal mission control for Claude Code sessions')
  .option('--build', 'Force rebuild the native binary')
  .option('--install', 'Install Conductor binary to ~/.paradigm/conductor/bin/')
  .option('-v, --verbose', 'Show build output')
  .action(async (options) => {
    const { conductorCommand } = await import('./commands/conductor.js');
    await conductorCommand(options);
  });

// paradigm university <command> - Per-project university & global learning platform
const universityCmd = program
  .command('university')
  .description('Per-project university - knowledge base, quizzes, learning paths & PLSAT certification');

universityCmd
  .command('serve')
  .description('Launch Paradigm University learning platform')
  .option('-p, --port <port>', 'Port to run on', '3839')
  .option('--no-open', "Don't open browser automatically")
  .option('--pack <id>', 'v6.0: mount a specific content pack by id')
  .option('--project', 'v6.0: mount the local project pack')
  .option('--discipline <name>', 'v6.0: scope to a discipline sub-pack')
  .action(async (options) => {
    const { universityServeCommand } = await import('./commands/university/serve.js');
    await universityServeCommand(undefined, options);
  });

universityCmd
  .command('list')
  .alias('ls')
  .description('List discovered packs (default) or entries within a pack (with --pack/--project)')
  .option('--type <type>', 'Filter by type: note, policy, guide, runbook, quiz, path')
  .option('--tag <tag>', 'Filter by tag')
  .option('--difficulty <level>', 'Filter by difficulty: beginner, intermediate, advanced')
  .option('--symbol <symbol>', 'Filter by Paradigm symbol')
  .option('--pack <id>', 'v6.0: target a specific content pack by id')
  .option('--project', 'v6.0: target the local project pack')
  .option('--discipline <name>', 'v6.0: scope to a discipline sub-pack')
  .option('-l, --limit <number>', 'Number of entries', '20')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { universityListCommand } = await import('./commands/university/list.js');
    await universityListCommand(options);
  });

universityCmd
  .command('add <type>')
  .description('Create university content (note, policy, guide, runbook, quiz)')
  .option('--title <title>', 'Content title (required)')
  .option('--body <text>', 'Content body (markdown)')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('--symbols <symbols>', 'Comma-separated Paradigm symbols')
  .option('--difficulty <level>', 'Difficulty: beginner, intermediate, advanced')
  .option('--minutes <n>', 'Estimated reading time in minutes')
  .option('--pack <id>', 'v6.0: target a specific content pack by id')
  .option('--project', 'v6.0: target the local project pack (default)')
  .option('--discipline <name>', 'v6.0: scope to a discipline sub-pack')
  .action(async (type, options) => {
    const { universityAddCommand } = await import('./commands/university/add.js');
    await universityAddCommand(type, options);
  });

universityCmd
  .command('show <id>')
  .description('Show a content item in full; id accepts bare or <pack-id>:<entry-id>')
  .option('--json', 'Output as JSON')
  .option('--pack <id>', 'v6.0: disambiguate bare id against a specific pack')
  .option('--project', 'v6.0: target the local project pack')
  .option('--discipline <name>', 'v6.0: scope to a discipline sub-pack')
  .action(async (id, options) => {
    const { universityShowCommand } = await import('./commands/university/show.js');
    await universityShowCommand(id, options);
  });

universityCmd
  .command('quiz <id>')
  .description('Take an interactive quiz in the terminal')
  .option('--pack <id>', 'v6.0: target a specific content pack by id')
  .option('--project', 'v6.0: target the local project pack')
  .option('--discipline <name>', 'v6.0: scope to a discipline sub-pack')
  .action(async (id, options) => {
    const { universityQuizCommand } = await import('./commands/university/quiz.js');
    await universityQuizCommand(id, options);
  });

universityCmd
  .command('status')
  .description('Show university content overview and completion stats')
  .option('--json', 'Output as JSON')
  .option('--pack <id>', 'v6.0: target a specific content pack by id')
  .option('--project', 'v6.0: target the local project pack')
  .option('--discipline <name>', 'v6.0: scope to a discipline sub-pack')
  .action(async (options) => {
    const { universityStatusCommand } = await import('./commands/university/status.js');
    await universityStatusCommand(options);
  });

universityCmd
  .command('validate')
  .description('Validate university content integrity')
  .option('--deep', 'Enable deep cross-reference checks against scan-index')
  .option('--id <id>', 'Validate a specific content item')
  .option('--json', 'Output as JSON')
  .option('--pack <id>', 'v6.0: target a specific content pack by id')
  .option('--project', 'v6.0: target the local project pack')
  .option('--discipline <name>', 'v6.0: scope to a discipline sub-pack')
  .action(async (options) => {
    const { universityValidateCommand } = await import('./commands/university/validate.js');
    await universityValidateCommand(options);
  });

// paradigm university init — scaffold .paradigm/university/pack.yaml (v6.0)
universityCmd
  .command('init')
  .description('Scaffold .paradigm/university/pack.yaml (use --discipline for sub-pack)')
  .option('--discipline <name>', 'Scaffold a discipline sub-pack at .paradigm/university/<name>/')
  .option('-f, --force', 'Overwrite an existing pack.yaml')
  .action(async (options) => {
    const { universityInitCommand } = await import('./commands/university/init.js');
    await universityInitCommand(options);
  });

// paradigm university migrate-plsat — hidden one-shot PLSAT migration (v6.0)
universityCmd
  .command('migrate-plsat', { hidden: true })
  .description('Migrate PLSAT JSON content to v6.0 pack layout (internal)')
  .option('--content-dir <path>', 'Override source content directory')
  .option('-f, --force', 'Overwrite existing target files')
  .option('--delete-sources', 'Delete source JSON files after migration (gated per D4)')
  .option('--json', 'Emit JSON summary')
  .action(async (options) => {
    const { universityMigratePlsatCommand } = await import('./commands/university/migrate-plsat.js');
    await universityMigratePlsatCommand(options);
  });

// Default university action: launch server (backward compat with bare `paradigm university`)
// Selectors --pack/--project/--discipline are surfaced on the `serve` subcommand
// and individual subcommands. Keeping them off the parent avoids Commander
// intercepting them before the subcommand dispatch.
universityCmd
  .option('-p, --port <port>', 'Port to run on', '3839')
  .option('--no-open', "Don't open browser automatically")
  .action(async (options) => {
    const { universityServeCommand } = await import('./commands/university/serve.js');
    await universityServeCommand(undefined, options);
  });

// paradigm docs <command> - Auto-generated documentation from the symbol graph
const docsCmd = program
  .command('docs')
  .description('Auto-generated documentation from the symbol graph');

docsCmd
  .command('serve')
  .description('Launch interactive docs viewer in browser')
  .option('-p, --port <port>', 'Port number (default: 3850)')
  .option('--no-open', 'Do not open browser automatically')
  .action(async (options) => {
    const { docsServeCommand } = await import('./commands/docs/index.js');
    await docsServeCommand(options);
  });

docsCmd
  .command('build')
  .description('Build static documentation site')
  .option('-o, --output <dir>', 'Output directory (default: from config or .paradigm/docs-site)')
  .action(async (options) => {
    const { docsBuildCommand } = await import('./commands/docs/index.js');
    await docsBuildCommand(options);
  });

docsCmd
  .command('scaffold')
  .description('Generate .index.yaml stubs for docs-class .paradigm/ subdirectories')
  .option('--dry-run', 'Preview what would be created without writing files')
  .option('-q, --quiet', 'Suppress output')
  .action(async (options) => {
    const { docsScaffoldCommand } = await import('./commands/docs/scaffold.js');
    await docsScaffoldCommand({ dryRun: options.dryRun, quiet: options.quiet });
  });

// Default docs action: launch serve (bare `paradigm docs`)
docsCmd
  .action(async () => {
    const { docsServeCommand } = await import('./commands/docs/index.js');
    await docsServeCommand({});
  });

// paradigm pipeline <command>
const pipelineCmd = program
  .command('pipeline')
  .description('Spec pipeline — structured feature workflow with configurable gates');

pipelineCmd
  .command('start <description>')
  .description('Create a new pipeline for a feature')
  .option('--template <template>', 'Pipeline template (add-feature, bug-fix, security-change, refactor)', 'add-feature')
  .option('--gates <gates>', 'Custom gate modes: specify,plan,task,implement,validate')
  .action(async (description, options) => {
    const { pipelineStartCommand } = await import('./commands/pipeline/index.js');
    await pipelineStartCommand(description, options);
  });

pipelineCmd
  .command('status [feature]')
  .description('Show pipeline status')
  .action(async (feature) => {
    const { pipelineStatusCommand } = await import('./commands/pipeline/index.js');
    await pipelineStatusCommand(feature);
  });

pipelineCmd
  .command('advance <feature>')
  .description('Advance pipeline past current gate')
  .action(async (feature) => {
    const { pipelineAdvanceCommand } = await import('./commands/pipeline/index.js');
    await pipelineAdvanceCommand(feature);
  });

pipelineCmd
  .command('configure <feature>')
  .description('Change gate mode on active pipeline')
  .requiredOption('--stage <stage>', 'Stage to configure')
  .requiredOption('--gate <gate>', 'New gate mode (auto, manual, sentinel)')
  .option('--reason <reason>', 'Reason for change')
  .action(async (feature, options) => {
    const { pipelineConfigureCommand } = await import('./commands/pipeline/index.js');
    await pipelineConfigureCommand(feature, options);
  });

pipelineCmd
  .command('abort <feature>')
  .description('Cancel a pipeline')
  .action(async (feature) => {
    const { pipelineAbortCommand } = await import('./commands/pipeline/index.js');
    await pipelineAbortCommand(feature);
  });

pipelineCmd
  .command('list')
  .description('List all active pipelines')
  .action(async () => {
    const { pipelineListCommand } = await import('./commands/pipeline/index.js');
    await pipelineListCommand();
  });

// Default pipeline action (list)
pipelineCmd
  .action(async () => {
    const { pipelineListCommand } = await import('./commands/pipeline/index.js');
    await pipelineListCommand();
  });

// paradigm symphony <command> — The Score: agent-to-agent messaging
const symphonyCmd = program
  .command('symphony')
  .description('Symphony — agent-to-agent messaging for multi-session collaboration');

symphonyCmd
  .command('join')
  .description('Join this session to the Symphony network')
  .option('--remote <ip>', 'Connect to remote Symphony server')
  .action(async (options) => {
    const { symphonyJoinCommand } = await import('./commands/symphony/index.js');
    await symphonyJoinCommand(options);
  });

symphonyCmd
  .command('leave')
  .description('Remove this session from the Symphony network')
  .action(async () => {
    const { symphonyLeaveCommand } = await import('./commands/symphony/index.js');
    await symphonyLeaveCommand();
  });

symphonyCmd
  .command('whoami')
  .description('Show this agent\'s identity and linked peers')
  .action(async () => {
    const { symphonyWhoamiCommand } = await import('./commands/symphony/index.js');
    await symphonyWhoamiCommand();
  });

symphonyCmd
  .command('list')
  .alias('ls')
  .description('List all joined agents')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { symphonyListCommand } = await import('./commands/symphony/index.js');
    await symphonyListCommand(options);
  });

symphonyCmd
  .command('send <message>')
  .description('Send a note to agents')
  .option('--to <agent>', 'Send to specific agent (omit for broadcast)')
  .option('--thread <id>', 'Reply to existing thread')
  .action(async (message, options) => {
    const { symphonySendCommand } = await import('./commands/symphony/index.js');
    await symphonySendCommand(message, options);
  });

symphonyCmd
  .command('read')
  .description('Show unread notes')
  .action(async () => {
    const { symphonyReadCommand } = await import('./commands/symphony/index.js');
    await symphonyReadCommand();
  });

symphonyCmd
  .command('inbox')
  .description('Show unread notes (alias for read)')
  .action(async () => {
    const { symphonyReadCommand } = await import('./commands/symphony/index.js');
    await symphonyReadCommand();
  });

symphonyCmd
  .command('threads')
  .description('List all threads')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { symphonyThreadsCommand } = await import('./commands/symphony/index.js');
    await symphonyThreadsCommand(options);
  });

symphonyCmd
  .command('thread <id>')
  .description('Show full thread conversation')
  .action(async (id) => {
    const { symphonyThreadCommand } = await import('./commands/symphony/index.js');
    await symphonyThreadCommand(id);
  });

symphonyCmd
  .command('resolve <id>')
  .description('Mark a thread as resolved')
  .option('--decision <text>', 'Decision text to record')
  .action(async (id, options) => {
    const { symphonyResolveCommand } = await import('./commands/symphony/index.js');
    await symphonyResolveCommand(id, options);
  });

symphonyCmd
  .command('status')
  .description('Show Symphony network status')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { symphonyStatusCommand } = await import('./commands/symphony/index.js');
    await symphonyStatusCommand(options);
  });

symphonyCmd
  .command('serve')
  .description('Start Symphony relay server for cross-machine networking')
  .option('--port <port>', 'Port to listen on', '3939')
  .option('--public', 'Show connection string for internet access')
  .action(async (options) => {
    const { symphonyServeCommand } = await import('./commands/symphony/index.js');
    await symphonyServeCommand(options);
  });

// peers subcommands
const peersCmd = symphonyCmd
  .command('peers')
  .description('Manage trusted remote peers');

peersCmd
  .command('list', { isDefault: true })
  .description('List trusted peers and their agents')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { symphonyPeersCommand } = await import('./commands/symphony/peers.js');
    await symphonyPeersCommand(options);
  });

peersCmd
  .command('revoke <id>')
  .description('Revoke trust for a peer (disconnects immediately)')
  .action(async (id) => {
    const { symphonyPeersRevokeCommand } = await import('./commands/symphony/peers.js');
    await symphonyPeersRevokeCommand(id);
  });

peersCmd
  .command('forget')
  .description('Clear all peer trust records')
  .option('--force', 'Skip confirmation')
  .action(async (options) => {
    const { symphonyPeersForgetCommand } = await import('./commands/symphony/peers.js');
    await symphonyPeersForgetCommand(options);
  });

peersCmd
  .action(async () => {
    const { symphonyPeersCommand } = await import('./commands/symphony/peers.js');
    await symphonyPeersCommand({});
  });

symphonyCmd
  .command('request <file>')
  .description('Request a file from another agent')
  .option('--from <agent>', 'Agent to request from')
  .option('--reason <text>', 'Why this file is needed')
  .action(async (file, options) => {
    const { symphonyRequestCommand } = await import('./commands/symphony/index.js');
    await symphonyRequestCommand(file, options);
  });

symphonyCmd
  .command('requests')
  .description('List pending file requests')
  .action(async () => {
    const { symphonyRequestsCommand } = await import('./commands/symphony/index.js');
    await symphonyRequestsCommand();
  });

symphonyCmd
  .command('approve <id>')
  .description('Approve a file request')
  .option('--redact', 'Strip sensitive lines before sending')
  .action(async (id, options) => {
    const { symphonyApproveCommand } = await import('./commands/symphony/index.js');
    await symphonyApproveCommand(id, options);
  });

symphonyCmd
  .command('deny <id>')
  .description('Deny a file request')
  .option('--reason <text>', 'Reason for denial')
  .action(async (id, options) => {
    const { symphonyDenyCommand } = await import('./commands/symphony/index.js');
    await symphonyDenyCommand(id, options);
  });

symphonyCmd
  .command('watch')
  .description('Watch inbox in real-time — zero AI tokens, pure file monitoring')
  .option('--interval <ms>', 'Poll interval in milliseconds (default: 2000)')
  .option('--thread <id>', 'Only show messages from this thread')
  .option('--quiet', 'Minimal output — messages only, no header')
  .action(async (options) => {
    const { symphonyWatchCommand } = await import('./commands/symphony/index.js');
    await symphonyWatchCommand(options);
  });

// Default symphony action (status)
symphonyCmd
  .action(async () => {
    const { symphonyStatusCommand } = await import('./commands/symphony/index.js');
    await symphonyStatusCommand({});
  });

// paradigm ambient <command> — Ambient coordination tools
const ambientCmd = program
  .command('ambient')
  .description('Ambient coordination — nominations, verdicts, and learning loop');

ambientCmd
  .command('postflight')
  .description('Run postflight learning pass — converts pending verdicts into journal entries and promotes high-confidence entries to notebooks')
  .option('--dry-run', 'Preview what would be written without writing')
  .option('--project <path>', 'Project root (defaults to cwd)')
  .action(async (options) => {
    const { ambientPostflightCommand } = await import('./commands/ambient.js');
    await ambientPostflightCommand(options);
  });

ambientCmd
  .action(async () => {
    const { ambientPostflightCommand } = await import('./commands/ambient.js');
    await ambientPostflightCommand({});
  });

// paradigm notebook <command> — Agent notebook management
const notebookCmd = program
  .command('notebook')
  .description('Agent notebook management — curated snippet libraries');

notebookCmd
  .command('list')
  .alias('ls')
  .description('List notebook entries')
  .option('--agent <id>', 'Filter by agent ID')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { notebookListCommand } = await import('./commands/notebook/index.js');
    await notebookListCommand(options);
  });

notebookCmd
  .command('show <id>')
  .description('Show a specific notebook entry')
  .option('--agent <id>', 'Agent ID')
  .option('--json', 'Output as JSON')
  .action(async (id, options) => {
    const { notebookShowCommand } = await import('./commands/notebook/index.js');
    await notebookShowCommand(id, options);
  });

notebookCmd
  .command('export')
  .description('Export notebook entries')
  .option('--agent <id>', 'Filter by agent ID')
  .option('--format <format>', 'Output format: yaml or json (default: yaml)')
  .action(async (options) => {
    const { notebookExportCommand } = await import('./commands/notebook/index.js');
    await notebookExportCommand(options);
  });

notebookCmd
  .action(async () => {
    const { notebookListCommand } = await import('./commands/notebook/index.js');
    await notebookListCommand({});
  });

// paradigm agent <command> — Agent identity management
const agentCmd = program
  .command('agent')
  .description('Agent identity management — persistent profiles with expertise tracking');

agentCmd
  .command('list')
  .alias('ls')
  .description('List all agent identity profiles')
  .option('--json', 'Output as JSON')
  .option('--global', 'Show only global profiles')
  .option('--project', 'Show only project-level profiles')
  .action(async (options) => {
    const { agentListCommand } = await import('./commands/agent/index.js');
    await agentListCommand(options);
  });

agentCmd
  .command('show <id>')
  .description('Show full agent profile with expertise table')
  .option('--json', 'Output as JSON')
  .action(async (id, options) => {
    const { agentShowCommand } = await import('./commands/agent/index.js');
    await agentShowCommand(id, options);
  });

agentCmd
  .command('create <id>')
  .description('Create a new .agent identity file')
  .option('-r, --role <role>', 'Agent role description')
  .option('-d, --description <desc>', 'Extended description')
  .option('-g, --global', 'Create in global ~/.paradigm/agents/ (default)')
  .option('--deny-paths <patterns>', 'Comma-separated glob patterns to deny (e.g., ".env*,*.key")')
  .action(async (id, options) => {
    const { agentCreateCommand } = await import('./commands/agent/index.js');
    await agentCreateCommand(id, { ...options, global: options.global !== false });
  });

agentCmd
  .command('sync <id>')
  .description('Bootstrap expertise from existing project lore')
  .option('-n, --dry-run', 'Show what would change without writing')
  .option('--json', 'Output as JSON')
  .action(async (id, options) => {
    const { agentSyncCommand } = await import('./commands/agent/index.js');
    await agentSyncCommand(id, options);
  });

const rosterCmd = agentCmd
  .command('roster')
  .description('Manage per-project agent roster (.paradigm/roster.yaml)');

rosterCmd
  .command('init')
  .description('Create a roster based on detected project type')
  .option('-f, --force', 'Overwrite existing roster')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { rosterInitCommand } = await import('./commands/agent/roster.js');
    await rosterInitCommand(options);
  });

rosterCmd
  .command('add <ids...>')
  .description('Add one or more agents to the active roster')
  .option('--json', 'Output as JSON')
  .action(async (ids, options) => {
    const { rosterAddCommand } = await import('./commands/agent/roster.js');
    await rosterAddCommand(ids, options);
  });

rosterCmd
  .command('remove <ids...>')
  .description('Remove one or more agents from the active roster')
  .option('--json', 'Output as JSON')
  .action(async (ids, options) => {
    const { rosterRemoveCommand } = await import('./commands/agent/roster.js');
    await rosterRemoveCommand(ids, options);
  });

rosterCmd
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { rosterShowCommand } = await import('./commands/agent/roster.js');
    await rosterShowCommand(options);
  });

agentCmd
  .command('bench <id>')
  .description('Bench an agent — Maestro will skip it during orchestration')
  .action(async (id) => {
    const { agentBenchCommand } = await import('./commands/agent/index.js');
    await agentBenchCommand(id);
  });

agentCmd
  .command('activate <id>')
  .description('Activate a benched agent — restore to Maestro orchestration')
  .action(async (id) => {
    const { agentActivateCommand } = await import('./commands/agent/index.js');
    await agentActivateCommand(id);
  });

agentCmd
  .command('review [id]')
  .description('Review pending scope changes for agents')
  .option('--json', 'Output as JSON')
  .action(async (id, options) => {
    const { agentReviewCommand } = await import('./commands/agent/scopes-commands.js');
    await agentReviewCommand(id, options);
  });

agentCmd
  .command('approve <id>')
  .description('Quick-approve an agent\'s pending scope changes')
  .option('--json', 'Output as JSON')
  .action(async (id, options) => {
    const { agentApproveCommand } = await import('./commands/agent/scopes-commands.js');
    await agentApproveCommand(id, options);
  });

agentCmd
  .command('deny <id>')
  .description('Deny an agent\'s pending scope changes')
  .option('--json', 'Output as JSON')
  .action(async (id, options) => {
    const { agentDenyCommand } = await import('./commands/agent/scopes-commands.js');
    await agentDenyCommand(id, options);
  });

agentCmd
  .command('scopes <id>')
  .description('Display an agent\'s current approved scopes')
  .option('--json', 'Output as JSON')
  .action(async (id, options) => {
    const { agentScopesCommand } = await import('./commands/agent/scopes-commands.js');
    await agentScopesCommand(id, options);
  });

// --- nevr.land registry commands ---

agentCmd
  .command('install <source>')
  .description('Install an agent from nevr.land registry')
  .option('--global', 'Install globally to ~/.paradigm/agents/')
  .action(async (source: string, options: { global?: boolean }) => {
    const { agentInstallCommand } = await import('./commands/agent/registry.js');
    await agentInstallCommand(source, options);
  });

agentCmd
  .command('search <query>')
  .description('Search nevr.land registry for agents')
  .option('--limit <n>', 'Limit results', '10')
  .action(async (query: string, options: { limit?: string }) => {
    const { agentSearchCommand } = await import('./commands/agent/registry.js');
    await agentSearchCommand(query, options);
  });

agentCmd
  .command('publish')
  .description('Publish agent to nevr.land registry')
  .option('--namespace <ns>', 'Organization namespace')
  .action(async (options: { namespace?: string }) => {
    const { agentPublishCommand } = await import('./commands/agent/registry.js');
    await agentPublishCommand(options);
  });

// Default agent action (list)
agentCmd
  .action(async () => {
    const { agentListCommand } = await import('./commands/agent/index.js');
    await agentListCommand({});
  });

// paradigm enforcement <command>
const enforcementCmd = program
  .command('enforcement')
  .description('Manage enforcement configuration (check severities and levels)');

enforcementCmd
  .command('set <level>')
  .description('Set enforcement level preset (strict, balanced, minimal)')
  .action(async (level) => {
    const { enforcementSetCommand } = await import('./commands/enforcement.js');
    await enforcementSetCommand(level);
  });

enforcementCmd
  .command('override <check-id> <severity>')
  .description('Set a per-check severity override (block, warn, off)')
  .action(async (checkId, severity) => {
    const { enforcementOverrideCommand } = await import('./commands/enforcement.js');
    await enforcementOverrideCommand(checkId, severity);
  });

enforcementCmd
  .command('reset [check-id]')
  .description('Remove a per-check override, or all overrides if no check-id given')
  .action(async (checkId) => {
    const { enforcementResetCommand } = await import('./commands/enforcement.js');
    await enforcementResetCommand(checkId);
  });

enforcementCmd
  .command('resolve')
  .description('Output the fully resolved severity map (used by stop hook)')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { enforcementResolveCommand } = await import('./commands/enforcement.js');
    await enforcementResolveCommand(options);
  });

enforcementCmd
  .command('status', { isDefault: true })
  .description('Show enforcement status table (default)')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { enforcementStatusCommand } = await import('./commands/enforcement.js');
    await enforcementStatusCommand(options);
  });

// paradigm compliance-check — unified compliance checker for stop hooks
program
  .command('compliance-check')
  .description('Run all compliance checks (habits, drift, portal) in a single process')
  .option('--json', 'Output as JSON')
  .option('--auto-heal', 'Auto-heal drift violations')
  .option('--trigger <event>', 'Trigger context (e.g., on-stop)', 'on-stop')
  .option('--learn', 'Run postflight learning pass (convert session verdicts to journal entries)')
  .action(async (options) => {
    const { complianceCheckCommand } = await import('./commands/compliance.js');
    await complianceCheckCommand(options);
  });

// paradigm internal — hidden command namespace for hook-side helpers (v6.1)
const internalCmd = program
  .command('internal', { hidden: true })
  .description('Internal helpers for hook integration (not for direct use)');

internalCmd
  .command('active-remediations', { hidden: true })
  .description('Emit JSON array of currently-active remediations (consumed by Stop hook Check 14)')
  .option('--json', 'Emit JSON (default and only supported mode)')
  .action(async (options) => {
    const { activeRemediationsCommand } = await import('./commands/internal/active-remediations.js');
    await activeRemediationsCommand(options);
  });

// paradigm util — utility command namespace (canonical home for beacon, constellation, echo, sync-llms, thread, probe)
registerUtilCommands(program);

// Parse and run
program.parse();
