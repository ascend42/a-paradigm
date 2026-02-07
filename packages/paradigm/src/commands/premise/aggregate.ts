/**
 * paradigm premise aggregate - Aggregate all sources
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { log } from '../../utils/logger.js';
import {
  aggregateFromPremise,
  aggregateFromDirectory,
  parsePremiseFile,
  buildSymbolIndex,
  getSymbolCounts,
} from '@a-company/premise-core';

export async function premiseAggregateCommand(targetPath: string) {
  const cwd = process.cwd();
  const absolutePath = path.resolve(cwd, targetPath);

  console.log(chalk.blue('\n🔮 Aggregating Premise...\n'));

  const spinner = ora('Loading sources...').start();

  try {
    let result;
    
    // Check for .premise file
    const premisePath = path.join(absolutePath, '.premise');
    if (fs.existsSync(premisePath)) {
      const { data, errors } = parsePremiseFile(premisePath);
      if (errors.length > 0) {
        spinner.warn('Warnings parsing .premise file');
        for (const error of errors) {
          console.log(chalk.yellow(`  ⚠ ${error}`));
        }
        // If there are validation errors, the .premise file format may be outdated
        // Fall back to directory aggregation
        console.log(chalk.gray('  Falling back to directory aggregation...\n'));
      }
      if (data && !errors.some(e => e.includes('Required'))) {
        // Only use .premise file if it's valid (no required field errors)
        try {
          result = await aggregateFromPremise(data, absolutePath);
        } catch (error) {
          // If aggregation fails, fall back to directory aggregation
          console.log(chalk.yellow(`  ⚠ Error using .premise file: ${(error as Error).message}`));
          console.log(chalk.gray('  Falling back to directory aggregation...\n'));
        }
      }
    }
    
    if (!result) {
      result = await aggregateFromDirectory(absolutePath);
    }

    spinner.succeed('Aggregated all sources');

    // Build index and show stats
    const index = buildSymbolIndex(result);
    const counts = getSymbolCounts(index);

    console.log(chalk.white('\nSources'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`  Purpose files:  ${chalk.cyan(result.purposeFiles.length.toString())}`);
    console.log(`  Gate files:     ${chalk.cyan(result.portalFiles.length.toString())}`);

    console.log(chalk.white('\nSymbol Index'));
    console.log(chalk.gray('─'.repeat(40)));

    const symbolLines = [
      { prefix: '@', name: 'Features', count: counts.feature, color: chalk.blue },
      { prefix: '#', name: 'Components', count: counts.component, color: chalk.green },
      { prefix: '$', name: 'Flows', count: counts.flow, color: chalk.yellow },
      { prefix: '%', name: 'States', count: counts.state, color: chalk.magenta },
      { prefix: '^', name: 'Gates', count: counts.gate, color: chalk.red },
      { prefix: '!', name: 'Signals', count: counts.signal, color: chalk.yellow },
      { prefix: '?', name: 'Ideas', count: counts.idea, color: chalk.white },
    ];

    for (const { prefix, name, count, color } of symbolLines) {
      if (count > 0) {
        console.log(`  ${color(prefix)} ${name.padEnd(12)} ${chalk.cyan(count.toString())}`);
      }
    }

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`  Total:          ${chalk.cyan(total.toString())}`);

    // Show errors if any
    if (result.errors.length > 0) {
      console.log(chalk.yellow('\nErrors'));
      console.log(chalk.gray('─'.repeat(40)));
      for (const error of result.errors) {
        console.log(chalk.red(`  ✗ [${error.source}] ${error.filePath}: ${error.message}`));
      }
    }

    console.log('');

  } catch (error) {
    spinner.fail('Aggregation failed');
    console.log(chalk.red(`Error: ${(error as Error).message}\n`));
    process.exit(1);
  }
}
