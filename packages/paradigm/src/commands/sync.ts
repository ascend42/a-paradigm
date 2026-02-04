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
}

export async function syncCommand(ide: string | undefined, options: SyncOptions) {
  const rootDir = process.cwd();
  const spinner = ora();

  console.log(chalk.blue('\n🔄 Paradigm Sync\n'));

  // Load Paradigm files
  spinner.start('Loading .paradigm/ configuration...');
  const files = loadParadigmFiles(rootDir);

  if (!files) {
    spinner.fail('No .paradigm/ directory found');
    log.command('sync').error('Missing .paradigm/ directory');
    console.log(chalk.gray('\nRun `paradigm init` to initialize Paradigm in this project.\n'));
    process.exit(1);
  }

  spinner.succeed(`Loaded configuration for ${chalk.cyan(files.projectName)}`);
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

  // Determine target IDE
  let targetIDE = ide;
  
  if (!targetIDE) {
    spinner.start('Auto-detecting IDE...');
    const detection = detectIDE(rootDir);
    
    if (detection.detected) {
      targetIDE = detection.detected;
      spinner.succeed(`Detected ${chalk.cyan(targetIDE)} (${detection.reason})`);
    } else {
      spinner.warn('Could not auto-detect IDE, defaulting to Cursor');
      targetIDE = 'cursor';
    }
  }

  // Validate IDE
  const adapter = getAdapter(targetIDE);
  if (!adapter) {
    console.log(chalk.red(`\n❌ Unknown IDE: ${targetIDE}`));
    console.log(chalk.gray(`\nAvailable IDEs: ${getAdapterNames().join(', ')}\n`));
    log.command('sync').error('Unknown IDE', { ide: targetIDE, available: getAdapterNames() });
    process.exit(1);
  }

  // Sync
  const isMultiFile = adapter.multiFile;
  spinner.start(`Generating ${isMultiFile ? adapter.outputPath + '/' : adapter.outputPath}...`);
  
  const tracker = log.operation(`sync-${targetIDE}`).start('Syncing IDE files', { ide: targetIDE });
  const result = syncToIDE(rootDir, targetIDE, files, options.force);

  if (result.success) {
    spinner.succeed(chalk.green(result.message));
    tracker.success('IDE files generated', { ide: targetIDE, path: result.outputPath });
    console.log(chalk.gray(`\n  Path: ${result.outputPath}`));

    // Show individual files for multi-file adapters
    if (isMultiFile && adapter.generateFiles) {
      const generatedFiles = adapter.generateFiles(files);
      for (const file of generatedFiles) {
        console.log(chalk.gray(`    └─ ${file.path}`));
      }
    }

    // Generate MCP config if requested or by default for supporting IDEs
    if (options.mcp !== false && adapter.generateMcpConfig) {
      const mcpResult = writeMcpConfig(rootDir, targetIDE);
      if (mcpResult.success) {
        console.log(chalk.green(`\n  ✓ ${mcpResult.message}`));
        log.component('mcp-config').success('MCP config generated', { ide: targetIDE, path: mcpResult.path });
      }
    }

    // Generate nested contexts if requested (Claude only currently)
    if (options.nested && adapter.generateNestedContexts) {
      const nestedResult = writeNestedContexts(rootDir, targetIDE, files);
      if (nestedResult.success && nestedResult.count > 0) {
        console.log(chalk.green(`\n  ✓ ${nestedResult.message}`));
        log.component('nested-contexts').success('Nested contexts generated', { ide: targetIDE, count: nestedResult.count });
      }
    }

    console.log('');
  } else {
    spinner.fail(chalk.red(result.message));
    tracker.error('Sync failed', { ide: targetIDE, message: result.message });
    process.exit(1);
  }
}
