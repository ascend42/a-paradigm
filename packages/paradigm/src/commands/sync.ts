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
} from '../core/ide-adapters/index.js';

interface SyncOptions {
  all?: boolean;
  force?: boolean;
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
    console.log(chalk.gray(`\n${successCount}/${results.length} IDE files generated.\n`));
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
    console.log('');
  } else {
    spinner.fail(chalk.red(result.message));
    process.exit(1);
  }
}
