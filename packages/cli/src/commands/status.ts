/**
 * horizon status - Show project status
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import {
  aggregateFromDirectory,
  buildSymbolIndex,
  getSymbolCounts,
} from '@horizon/dream-core';
import { findPurposeFiles } from '@horizon/purpose-core';
import { findGateFiles } from '@horizon/gate-core';

export async function statusCommand() {
  const cwd = process.cwd();

  console.log(chalk.blue('\n📊 Horizon Status\n'));
  console.log(chalk.gray('─'.repeat(40)));

  const spinner = ora('Scanning project...').start();

  // Check for config files
  const hasDream = fs.existsSync(path.join(cwd, '.dream'));
  const hasPurpose = fs.existsSync(path.join(cwd, '.purpose'));
  const hasGate = fs.existsSync(path.join(cwd, 'gate.yaml'));

  spinner.stop();

  // Config files status
  console.log(chalk.white('\nConfiguration Files'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(`  .dream:     ${hasDream ? chalk.green('✓ Found') : chalk.yellow('○ Not found')}`);
  console.log(`  .purpose:   ${hasPurpose ? chalk.green('✓ Found') : chalk.yellow('○ Not found')}`);
  console.log(`  gate.yaml:  ${hasGate ? chalk.green('✓ Found') : chalk.yellow('○ Not found')}`);

  // Find all files
  spinner.start('Counting files...');
  
  const purposeFiles = await findPurposeFiles(cwd);
  const gateFiles = await findGateFiles(cwd);

  spinner.stop();

  console.log(chalk.white('\nSource Files'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(`  Purpose files:  ${chalk.cyan(purposeFiles.length.toString())}`);
  console.log(`  Gate files:     ${chalk.cyan(gateFiles.length.toString())}`);

  // Aggregate and count symbols
  if (hasDream || hasPurpose || hasGate) {
    spinner.start('Aggregating symbols...');
    
    try {
      const result = await aggregateFromDirectory(cwd);
      const index = buildSymbolIndex(result);
      const counts = getSymbolCounts(index);

      spinner.stop();

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
        console.log(chalk.white('\nWarnings'));
        console.log(chalk.gray('─'.repeat(40)));
        for (const error of result.errors) {
          console.log(chalk.yellow(`  ⚠ ${error.source}: ${error.message}`));
        }
      }
    } catch (error) {
      spinner.fail('Failed to aggregate');
      console.log(chalk.red(`  Error: ${(error as Error).message}`));
    }
  }

  console.log('');
}
