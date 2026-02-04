/**
 * paradigm sync - Generate IDE instruction files from .paradigm/ config
 */

import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { log, format } from '../utils/logger.js';
import {
  detectIDE,
  getAdapter,
  getAdapterNames,
  loadParadigmFiles,
  syncToIDE,
  syncToAllIDEs,
  writeMcpConfig,
  writeNestedContexts,
} from '../core/ide-adapters/index.js';

interface SyncOptions {
  all?: boolean;
  force?: boolean;
  mcp?: boolean;
  nested?: boolean;
  quiet?: boolean;
  target?: string; // alias for ide parameter when called programmatically
}

export async function syncCommand(ide: string | undefined, options: SyncOptions) {
  const rootDir = process.cwd();
  const spinner = ora();
  const targetIde = options.target || ide;
  const quiet = options.quiet;

  if (!quiet) {
    console.log(chalk.blue('\n🔄 Paradigm Sync\n'));
  }

  // Load Paradigm files
  if (!quiet) spinner.start('Loading .paradigm/ configuration...');
  const files = loadParadigmFiles(rootDir);

  if (!files) {
    if (!quiet) {
      spinner.fail('No .paradigm/ directory found');
      console.log(chalk.gray('\nRun `paradigm init` to initialize Paradigm in this project.\n'));
    }
    log.command('sync').error('Missing .paradigm/ directory');
    if (!quiet) process.exit(1);
    throw new Error('No .paradigm/ directory found');
  }

  if (!quiet) spinner.succeed(`Loaded configuration for ${chalk.cyan(files.projectName)}`);
  log.command('sync').debug('Configuration loaded', { projectName: files.projectName });

  // Sync to all IDEs if --all flag
  if (options.all) {
    console.log(chalk.gray('\nSyncing to all IDEs...\n'));
    
    const tracker = log.operation('sync-all').start('Syncing to all IDEs');
    const results = syncToAllIDEs(rootDir, files, options.force);
    
    for (const result of results) {
      if (result.success) {
        console.log(chalk.green(`  ✓ ${result.ide}`), chalk.gray(`→ ${result.outputPath}`));
        log.operation(`sync-${result.ide}`).success('IDE files generated', { path: result.outputPath });
      } else {
        console.log(chalk.red(`  ✗ ${result.ide}`), chalk.gray(`→ ${result.message}`));
        log.operation(`sync-${result.ide}`).error('Sync failed', { message: result.message });
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    console.log(chalk.gray(`\n${successCount}/${results.length} IDE files generated.`));
    
    if (successCount === results.length) {
      tracker.success('All IDE files generated', { count: results.length });
    } else {
      tracker.error('Some IDE syncs failed', { success: successCount, total: results.length });
    }

    // Generate MCP configs for IDEs that support it (unless --no-mcp)
    if (options.mcp !== false) {
      console.log('');
      const ideNames = getAdapterNames();
      for (const name of ideNames) {
        const adapter = getAdapter(name);
        if (adapter?.generateMcpConfig) {
          const mcpResult = writeMcpConfig(rootDir, name);
          if (mcpResult.success) {
            console.log(chalk.green(`  ✓ MCP config for ${name}`), chalk.gray(`→ ${path.relative(rootDir, mcpResult.path)}`));
            log.component('mcp-config').success('MCP config generated', { ide: name, path: mcpResult.path });
          }
        }
      }
    }

    console.log('');
    return;
  }

  // Determine target IDE (use targetIde from options.target or ide parameter)
  let finalTargetIde = targetIde;

  if (!finalTargetIde) {
    if (!quiet) spinner.start('Auto-detecting IDE...');
    const detection = detectIDE(rootDir);

    if (detection.detected) {
      finalTargetIde = detection.detected;
      if (!quiet) spinner.succeed(`Detected ${chalk.cyan(finalTargetIde)} (${detection.reason})`);
    } else {
      if (!quiet) spinner.warn('Could not auto-detect IDE, defaulting to Cursor');
      finalTargetIde = 'cursor';
    }
  }

  // Validate IDE
  const adapter = getAdapter(finalTargetIde);
  if (!adapter) {
    if (!quiet) {
      console.log(chalk.red(`\n❌ Unknown IDE: ${finalTargetIde}`));
      console.log(chalk.gray(`\nAvailable IDEs: ${getAdapterNames().join(', ')}\n`));
    }
    log.command('sync').error('Unknown IDE', { ide: finalTargetIde, available: getAdapterNames() });
    if (!quiet) process.exit(1);
    throw new Error(`Unknown IDE: ${finalTargetIde}`);
  }

  // Sync
  const isMultiFile = adapter.multiFile;
  if (!quiet) spinner.start(`Generating ${isMultiFile ? adapter.outputPath + '/' : adapter.outputPath}...`);

  const tracker = log.operation(`sync-${finalTargetIde}`).start('Syncing IDE files', { ide: finalTargetIde });
  const result = syncToIDE(rootDir, finalTargetIde, files, options.force);

  if (result.success) {
    if (!quiet) {
      spinner.succeed(chalk.green(result.message));
      console.log(chalk.gray(`\n  Path: ${result.outputPath}`));

      // Show individual files for multi-file adapters
      if (isMultiFile && adapter.generateFiles) {
        const generatedFiles = adapter.generateFiles(files);
        for (const file of generatedFiles) {
          console.log(chalk.gray(`    └─ ${file.path}`));
        }
      }
    }
    tracker.success('IDE files generated', { ide: finalTargetIde, path: result.outputPath });

    // Generate MCP config if requested or by default for supporting IDEs
    if (options.mcp !== false && adapter.generateMcpConfig) {
      const mcpResult = writeMcpConfig(rootDir, finalTargetIde);
      if (mcpResult.success) {
        if (!quiet) console.log(chalk.green(`\n  ✓ ${mcpResult.message}`));
        log.component('mcp-config').success('MCP config generated', { ide: finalTargetIde, path: mcpResult.path });
      }
    }

    // Generate nested contexts if requested (Claude only currently)
    if (options.nested && adapter.generateNestedContexts) {
      const nestedResult = writeNestedContexts(rootDir, finalTargetIde, files);
      if (nestedResult.success && nestedResult.count > 0) {
        if (!quiet) console.log(chalk.green(`\n  ✓ ${nestedResult.message}`));
        log.component('nested-contexts').success('Nested contexts generated', { ide: finalTargetIde, count: nestedResult.count });
      }
    }

    if (!quiet) console.log('');
  } else {
    if (!quiet) spinner.fail(chalk.red(result.message));
    tracker.error('Sync failed', { ide: finalTargetIde, message: result.message });
    if (!quiet) process.exit(1);
    throw new Error(result.message || 'Sync failed');
  }
}
