/**
 * horizon gate validate - Validate gate.yaml configuration
 */

import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { parseGateConfig, validateGateConfig, formatValidationResult } from '@horizon/gate-core';

export async function gateValidateCommand(configPath: string) {
  const cwd = process.cwd();
  const absolutePath = path.resolve(cwd, configPath);

  console.log(chalk.blue('\n🔍 Validating Gate Configuration...\n'));

  const spinner = ora(`Parsing ${configPath}...`).start();

  try {
    const config = await parseGateConfig(absolutePath);
    spinner.succeed('Parsed gate.yaml');

    const result = validateGateConfig(config);

    console.log(chalk.white(`\nGates: ${config.gates.length}`));
    console.log(chalk.white(`Flows: ${config.flows.length}`));
    console.log(formatValidationResult(result));

    if (!result.valid) {
      process.exit(1);
    }

    console.log('');

  } catch (error) {
    spinner.fail('Validation failed');
    console.log(chalk.red(`Error: ${(error as Error).message}\n`));
    process.exit(1);
  }
}
