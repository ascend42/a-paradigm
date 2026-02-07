/**
 * paradigm purpose remember - Aggregate and display purpose context
 */

import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { getAllPurposeFiles, aggregatePurposes } from '@a-company/purpose-core';

export async function purposeRememberCommand(targetPath: string) {
  const cwd = process.cwd();
  const absolutePath = path.resolve(cwd, targetPath);

  console.log(chalk.blue('\n📖 Remembering Purpose...\n'));

  const spinner = ora('Aggregating purpose files...').start();

  try {
    const files = await getAllPurposeFiles(absolutePath);
    const aggregated = aggregatePurposes(files);

    spinner.succeed(`Found ${files.length} purpose file(s)`);

    // Display aggregated context
    console.log(chalk.white('\n' + '═'.repeat(50)));
    
    if (aggregated.description) {
      console.log(chalk.white('\nDescription'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(chalk.cyan(aggregated.description));
    }

    if (aggregated.context.length > 0) {
      console.log(chalk.white('\nContext'));
      console.log(chalk.gray('─'.repeat(50)));
      for (const ctx of aggregated.context) {
        console.log(chalk.gray('  • ') + ctx);
      }
    }

    if (Object.keys(aggregated.rules).length > 0) {
      console.log(chalk.white('\nRules'));
      console.log(chalk.gray('─'.repeat(50)));
      for (const [key, value] of Object.entries(aggregated.rules)) {
        console.log(chalk.gray('  ') + chalk.yellow(key) + chalk.gray(': ') + String(value));
      }
    }

    if (Object.keys(aggregated.features).length > 0) {
      console.log(chalk.white('\nFeatures'));
      console.log(chalk.gray('─'.repeat(50)));
      for (const [id, feature] of Object.entries(aggregated.features)) {
        console.log(chalk.blue('  @' + id));
        if (feature.description) {
          console.log(chalk.gray('    ' + feature.description));
        }
      }
    }

    if (Object.keys(aggregated.components).length > 0) {
      console.log(chalk.white('\nComponents'));
      console.log(chalk.gray('─'.repeat(50)));
      for (const [id, component] of Object.entries(aggregated.components)) {
        console.log(chalk.green('  #' + id));
        if (component.description) {
          console.log(chalk.gray('    ' + component.description));
        }
      }
    }

    if (aggregated.ruleConflicts.length > 0) {
      console.log(chalk.yellow('\nWarnings'));
      console.log(chalk.gray('─'.repeat(50)));
      for (const conflict of aggregated.ruleConflicts) {
        console.log(chalk.yellow('  ⚠ ' + conflict));
      }
    }

    console.log(chalk.white('\n' + '═'.repeat(50) + '\n'));

  } catch (error) {
    spinner.fail('Failed to aggregate');
    console.log(chalk.red(`Error: ${(error as Error).message}\n`));
  }
}
