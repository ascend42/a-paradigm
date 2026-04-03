/**
 * paradigm util - Utility command namespace
 *
 * Groups utility commands under a single namespace:
 *   paradigm util beacon       — Generate quick-start orientation for AI agents
 *   paradigm util constellation — Generate symbol relationship graph
 *   paradigm util echo         — Error-to-symbol mapping
 *   paradigm util sync-llms    — Generate llms.txt for LLM consumption
 *   paradigm util thread       — Session continuity management
 *   paradigm util probe        — Probe-related commands
 */

import { Command } from 'commander';
import { log } from '../../utils/logger.js';

export function registerUtilCommands(program: Command): void {
  const tracker = log.component('#util-namespace');

  const utilCmd = program
    .command('util')
    .description('Utility commands — beacon, constellation, echo, sync-llms, thread, probe');

  // ── util beacon ────────────────────────────────────────────────────────────

  utilCmd
    .command('beacon [path]')
    .description('Generate .paradigm/beacon.md - quick-start orientation for AI agents')
    .option('-r, --refresh', 'Regenerate even if beacon exists')
    .option('-o, --output <path>', 'Custom output path')
    .option('--json', 'Output as JSON (for AI agent queries)')
    .option('-q, --quiet', 'Suppress output')
    .action(async (path, options) => {
      tracker.debug('util beacon invoked', { path });
      const { beaconCommand } = await import('../beacon.js');
      await beaconCommand(path, options);
    });

  // ── util constellation ─────────────────────────────────────────────────────

  utilCmd
    .command('constellation [path]')
    .alias('const')
    .description('Generate .paradigm/constellation.json - symbol relationship graph for AI agents')
    .option('-f, --format <format>', 'Output format: json or yaml', 'json')
    .option('-o, --output <path>', 'Custom output path')
    .option('-q, --quiet', 'Suppress output')
    .action(async (path, options) => {
      tracker.debug('util constellation invoked', { path });
      const { constellationCommand } = await import('../constellation.js');
      await constellationCommand(path, options);
    });

  // ── util echo ──────────────────────────────────────────────────────────────

  const utilEchoCmd = utilCmd
    .command('echo')
    .description('Error-to-symbol mapping - find related symbols for error codes');

  utilEchoCmd
    .command('lookup <errorCode> [path]')
    .alias('l')
    .description('Look up an error code')
    .option('--json', 'Output as JSON (for AI agent queries)')
    .action(async (errorCode, path, options) => {
      tracker.debug('util echo lookup invoked', { errorCode });
      const { echoCommand } = await import('../echo.js');
      await echoCommand(errorCode, path, options);
    });

  utilEchoCmd
    .command('init [path]')
    .description('Create .paradigm/echoes.yaml template')
    .option('-q, --quiet', 'Suppress output')
    .action(async (path, options) => {
      tracker.debug('util echo init invoked');
      const { echoInitCommand } = await import('../echo.js');
      await echoInitCommand(path, options);
    });

  utilEchoCmd
    .command('list [path]')
    .alias('ls')
    .description('List all error mappings')
    .action(async (path) => {
      tracker.debug('util echo list invoked');
      const { echoListCommand } = await import('../echo.js');
      await echoListCommand(path);
    });

  // Default echo action (with error code argument)
  utilEchoCmd
    .argument('[errorCode]', 'Error code to look up')
    .option('--json', 'Output as JSON (for AI agent queries)')
    .action(async (errorCode, options) => {
      if (errorCode) {
        const { echoCommand } = await import('../echo.js');
        await echoCommand(errorCode, undefined, options);
      } else {
        const { echoListCommand } = await import('../echo.js');
        await echoListCommand();
      }
    });

  // ── util sync-llms ─────────────────────────────────────────────────────────

  utilCmd
    .command('sync-llms')
    .description('Generate llms.txt — LLM-readable project summary')
    .option('-o, --output <path>', 'Output path (default: ./llms.txt)')
    .action(async (options) => {
      tracker.debug('util sync-llms invoked');
      const { syncLlmsCommand } = await import('../sync-llms.js');
      await syncLlmsCommand(options);
    });

  // ── util thread ────────────────────────────────────────────────────────────

  const utilThreadCmd = utilCmd
    .command('thread')
    .description('Session continuity - pass context between AI agent sessions');

  utilThreadCmd
    .command('show [path]')
    .alias('s')
    .description('Show current thread')
    .option('--json', 'Output as JSON (for AI agent queries)')
    .action(async (path, options) => {
      tracker.debug('util thread show invoked');
      const { threadShowCommand } = await import('../thread.js');
      await threadShowCommand(path, options);
    });

  utilThreadCmd
    .command('save <message> [path]')
    .description('Save activity to the thread trail')
    .option('-q, --quiet', 'Suppress output')
    .action(async (message, path, options) => {
      tracker.debug('util thread save invoked', { message });
      const { threadSaveCommand } = await import('../thread.js');
      await threadSaveCommand(message, path, options);
    });

  utilThreadCmd
    .command('todo <task> [path]')
    .description('Add a loose end (unfinished task)')
    .option('-q, --quiet', 'Suppress output')
    .action(async (task, path, options) => {
      tracker.debug('util thread todo invoked', { task });
      const { threadTodoCommand } = await import('../thread.js');
      await threadTodoCommand(task, path, options);
    });

  utilThreadCmd
    .command('note <note> [path]')
    .description('Add a breadcrumb (note for next agent)')
    .option('-q, --quiet', 'Suppress output')
    .action(async (note, path, options) => {
      tracker.debug('util thread note invoked', { note });
      const { threadNoteCommand } = await import('../thread.js');
      await threadNoteCommand(note, path, options);
    });

  utilThreadCmd
    .command('clear [path]')
    .description('Clear the thread')
    .option('-q, --quiet', 'Suppress output')
    .action(async (path, options) => {
      tracker.debug('util thread clear invoked');
      const { threadClearCommand } = await import('../thread.js');
      await threadClearCommand(path, options);
    });

  // Default thread action (show)
  utilThreadCmd
    .option('--json', 'Output as JSON (for AI agent queries)')
    .action(async (options) => {
      const { threadShowCommand } = await import('../thread.js');
      await threadShowCommand(undefined, options);
    });

  // ── util probe ─────────────────────────────────────────────────────────────

  const utilProbeCmd = utilCmd
    .command('probe')
    .description('Probe-related commands');

  utilProbeCmd
    .command('index [path]')
    .description('Generate probe index (alias for `paradigm index`)')
    .option('-o, --output <path>', 'Output path for probe-index.json')
    .option('-q, --quiet', 'Suppress output')
    .action(async (path, options) => {
      tracker.debug('util probe index invoked', { path });
      const { indexCommand } = await import('../probe/index.js');
      await indexCommand(path, options);
    });
}
