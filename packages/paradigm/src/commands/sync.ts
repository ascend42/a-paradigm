/**
 * paradigm sync - Generate IDE instruction files from .paradigm/ config
 */

import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
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
    spinner.fail(chalk.red('No .paradigm/ directory found'));
    console.log(chalk.gray('\nRun `paradigm init` to initialize Paradigm in this project.\n'));
    process.exit(1);
  }

  spinner.succeed(`Loaded configuration for ${chalk.cyan(files.projectName)}`);

  // Sync to all IDEs if --all flag
  if (options.all) {
    console.log(chalk.gray('\nSyncing to all IDEs...\n'));
    
    const results = syncToAllIDEs(rootDir, files, options.force);
    
    for (const result of results) {
      if (result.success) {
        console.log(chalk.green(`  ✓ ${result.ide}`), chalk.gray(`→ ${result.outputPath}`));
      } else {
        console.log(chalk.red(`  ✗ ${result.ide}`), chalk.gray(`→ ${result.message}`));
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    console.log(chalk.gray(`\n${successCount}/${results.length} IDE files generated.`));

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
    process.exit(1);
  }

  // Sync
  const isMultiFile = adapter.multiFile;
  spinner.start(`Generating ${isMultiFile ? adapter.outputPath + '/' : adapter.outputPath}...`);
  const result = syncToIDE(rootDir, targetIDE, files, options.force);

  if (result.success) {
    spinner.succeed(chalk.green(result.message));
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
      }
    }

    // Generate nested contexts if requested (Claude only currently)
    if (options.nested && adapter.generateNestedContexts) {
      const nestedResult = writeNestedContexts(rootDir, targetIDE, files);
      if (nestedResult.success && nestedResult.count > 0) {
        console.log(chalk.green(`\n  ✓ ${nestedResult.message}`));
      }
    }

    console.log('');
  } else {
    spinner.fail(chalk.red(result.message));
    process.exit(1);
  }
}
