/**
 * horizon init - Initialize Horizon in a project
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { getDefaultPurposeContent } from '@horizon/purpose-core';
import { getDefaultGateConfig } from '@horizon/gate-core';
import { getDefaultDreamContent } from '@horizon/dream-core';
import { getDefaultHorizonConfig, serializeHorizonConfig } from '../core/horizon-config.js';
import { writeCursorrules } from '../core/cursorrules.js';

interface InitOptions {
  force?: boolean;
  name?: string;
  cursorrules?: boolean;
}

export async function initCommand(options: InitOptions) {
  const cwd = process.cwd();
  const projectName = options.name || path.basename(cwd);

  console.log(chalk.blue('\n🌅 Initializing Horizon...\n'));

  const spinner = ora();

  // Create .horizon config (AI instructions)
  const horizonPath = path.join(cwd, '.horizon');
  if (fs.existsSync(horizonPath) && !options.force) {
    console.log(chalk.yellow('  ⚠ .horizon config already exists'));
  } else {
    spinner.start('Creating .horizon config...');
    const config = getDefaultHorizonConfig(projectName);
    fs.writeFileSync(horizonPath, serializeHorizonConfig(config));
    spinner.succeed(chalk.green('.horizon config created (AI guidelines & symbol system)'));
  }

  // Create .dream file
  const dreamPath = path.join(cwd, '.dream');
  if (fs.existsSync(dreamPath) && !options.force) {
    console.log(chalk.yellow('  ⚠ .dream file already exists (use --force to overwrite)'));
  } else {
    spinner.start('Creating .dream file...');
    fs.writeFileSync(dreamPath, getDefaultDreamContent(projectName));
    spinner.succeed(chalk.green('.dream file created'));
  }

  // Create root .purpose file if it doesn't exist
  const purposePath = path.join(cwd, '.purpose');
  if (fs.existsSync(purposePath) && !options.force) {
    console.log(chalk.yellow('  ⚠ .purpose file already exists'));
  } else {
    spinner.start('Creating .purpose file...');
    fs.writeFileSync(purposePath, getDefaultPurposeContent());
    spinner.succeed(chalk.green('.purpose file created'));
  }

  // Check for gate.yaml
  const gatePath = path.join(cwd, 'gate.yaml');
  if (fs.existsSync(gatePath)) {
    console.log(chalk.green('  ✓ Detected existing gate.yaml'));
  } else if (options.force) {
    spinner.start('Creating gate.yaml...');
    fs.writeFileSync(gatePath, getDefaultGateConfig());
    spinner.succeed(chalk.green('gate.yaml created'));
  } else {
    console.log(chalk.gray('  ○ No gate.yaml found (optional)'));
  }

  // Generate .cursorrules if requested or by default
  const cursorrrulesPath = path.join(cwd, '.cursorrules');
  if (options.cursorrules !== false) {
    const config = getDefaultHorizonConfig(projectName);
    if (fs.existsSync(cursorrrulesPath) && !options.force) {
      console.log(chalk.yellow('  ⚠ .cursorrules already exists (use --force to overwrite)'));
    } else {
      spinner.start('Generating .cursorrules...');
      const result = writeCursorrules(cwd, config, 'create', projectName);
      if (result.success) {
        spinner.succeed(chalk.green('.cursorrules generated (Cursor AI integration)'));
      } else {
        spinner.warn(chalk.yellow('Could not generate .cursorrules'));
      }
    }
  }

  console.log(chalk.blue('\n✨ Horizon initialized!\n'));
  console.log(chalk.gray('Files created:'));
  console.log(chalk.white('  • .horizon      - AI guidelines & symbol system'));
  console.log(chalk.white('  • .dream        - Project overview & ideas'));
  console.log(chalk.white('  • .purpose      - Feature & component context'));
  console.log(chalk.white('  • .cursorrules  - Cursor AI integration'));
  console.log('');
  console.log(chalk.gray('Next steps:'));
  console.log(chalk.white('  1. Edit ' + chalk.cyan('.horizon') + ' to customize AI instructions'));
  console.log(chalk.white('  2. Edit ' + chalk.cyan('.purpose') + ' to define your project context'));
  console.log(chalk.white('  3. Run ' + chalk.cyan('horizon visualize') + ' to open the Dreamscape'));
  console.log(chalk.white('  4. Run ' + chalk.cyan('horizon cursorrules') + ' to regenerate after changes\n'));
}
