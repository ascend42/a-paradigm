/**
 * horizon cursorrules - Generate .cursorrules from .horizon config
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { parseHorizonConfig, getDefaultHorizonConfig, serializeHorizonConfig } from '../core/horizon-config';
import { 
  writeCursorrules, 
  cursorrrulesExists, 
  horizonConfigExists,
  generateCursorrules,
  CursorRulesMode 
} from '../core/cursorrules';

interface CursorrrulesOptions {
  append?: boolean;
  force?: boolean;
  preview?: boolean;
  init?: boolean;
  withScan?: boolean;
}

export async function cursorrrulesCommand(targetPath: string | undefined, options: CursorrrulesOptions) {
  const rootDir = targetPath ? path.resolve(targetPath) : process.cwd();
  const projectName = path.basename(rootDir);
  const configPath = path.join(rootDir, '.horizon');

  const spinner = ora();

  // Check if .horizon exists
  if (!horizonConfigExists(rootDir)) {
    if (options.init) {
      // Create default .horizon config
      spinner.start('Creating .horizon config...');
      const defaultConfig = getDefaultHorizonConfig(projectName);
      fs.writeFileSync(configPath, serializeHorizonConfig(defaultConfig), 'utf8');
      spinner.succeed(chalk.green('.horizon config created'));
    } else {
      console.log(chalk.red('\n❌ No .horizon file found.'));
      console.log(chalk.gray('\nRun with --init to create a default .horizon config:'));
      console.log(chalk.cyan('  horizon cursorrules --init\n'));
      process.exit(1);
    }
  }

  // Load config
  let config;
  try {
    const content = fs.readFileSync(configPath, 'utf8');
    config = parseHorizonConfig(content);
  } catch (err) {
    const error = err as Error;
    console.log(chalk.red(`\n❌ Failed to parse .horizon: ${error.message}\n`));
    process.exit(1);
  }

  // Auto-detect scan if scan-index exists (check both locations)
  const scanIndexExists = 
    fs.existsSync(path.join(rootDir, '.horizon', 'scan-index.json')) ||
    fs.existsSync(path.join(rootDir, '.horizon-scan-index.json'));
  const includeScan = options.withScan || scanIndexExists;

  // Preview mode
  if (options.preview) {
    const content = generateCursorrules(config, projectName, { withScan: includeScan });
    console.log(chalk.blue('\n--- Preview of .cursorrules content ---\n'));
    console.log(content);
    console.log(chalk.blue('\n--- End preview ---\n'));
    return;
  }

  // Determine mode
  let mode: CursorRulesMode = 'create';
  
  if (options.append) {
    mode = 'append';
  } else if (!options.force && cursorrrulesExists(rootDir)) {
    console.log(chalk.yellow('\n⚠️  .cursorrules already exists.'));
    console.log(chalk.gray('Use --force to overwrite, or --append to add Horizon section.\n'));
    process.exit(1);
  }

  // Generate
  spinner.start('Generating .cursorrules...');
  const result = writeCursorrules(rootDir, config, mode, projectName, { withScan: includeScan });

  if (result.success) {
    spinner.succeed(chalk.green(result.message));
    console.log(chalk.gray(`\n  Path: ${result.path}`));
    if (includeScan) {
      console.log(chalk.gray('  Includes: Scan protocol'));
    }
    console.log();
  } else {
    spinner.fail(chalk.red('Failed to generate .cursorrules'));
    process.exit(1);
  }
}
