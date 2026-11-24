/**
 * paradigm status - Show project status
 *
 * Every number printed here comes from #project-counts, the module `paradigm
 * doctor` reads too, so the two commands report the same gates, .purpose files
 * and isolated symbols.
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { log } from '../utils/logger.js';
import { dim } from '../utils/cli-output.js';
import { listProjectFiles } from '../core/project-files.js';
import {
  collectProjectCounts,
  listPurposeFiles,
  listPortalFiles,
  GATE_COUNT_SCOPE,
  describeGateCounts,
} from '../core/project-counts.js';

export async function statusCommand() {
  const cwd = process.cwd();

  console.log(chalk.blue('\n📊 Paradigm Status\n'));
  console.log(chalk.gray('─'.repeat(40)));

  const tracker = log.command('status').start('Getting project status');
  const spinner = ora('Scanning project...').start();

  // Check for config files
  const hasDream = fs.existsSync(path.join(cwd, '.premise'));
  const hasPurpose = fs.existsSync(path.join(cwd, '.purpose'));
  const hasGate = fs.existsSync(path.join(cwd, 'portal.yaml'));

  spinner.stop();

  // Config files status
  console.log(chalk.white('\nConfiguration Files'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(`  .premise:     ${hasDream ? chalk.green('✓ Found') : chalk.yellow('○ Not found')}`);
  console.log(`  .purpose:   ${hasPurpose ? chalk.green('✓ Found') : chalk.yellow('○ Not found')}`);
  console.log(`  portal.yaml:  ${hasGate ? chalk.green('✓ Found') : chalk.yellow('○ Not found')}`);

  // Find all files: one list (#project-files), the same one doctor reads
  spinner.start('Counting files...');

  const projectFiles = listProjectFiles(cwd);
  const purposeFiles = listPurposeFiles(projectFiles);
  const gateFiles = listPortalFiles(projectFiles);

  spinner.stop();

  console.log(chalk.white('\nSource Files'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(`  Purpose files:  ${chalk.cyan(purposeFiles.length.toString())}`);
  console.log(`  Gate files:     ${chalk.cyan(gateFiles.length.toString())}`);

  // Aggregate and count symbols
  if (hasDream || hasPurpose || hasGate) {
    spinner.start('Aggregating symbols...');

    try {
      const counts = await collectProjectCounts(cwd, projectFiles);

      spinner.stop();

      if (counts.purposeFilesNotIndexed.length > 0) {
        const n = counts.purposeFilesNotIndexed.length;
        dim(`  ${n} .purpose file${n === 1 ? ' is' : 's are'} not in the symbol index (unparsable, or under build output): ${counts.purposeFilesNotIndexed.slice(0, 3).join(', ')}${n > 3 ? ', …' : ''}`);
      }

      console.log(chalk.white('\nSymbol Index'));
      console.log(chalk.gray('─'.repeat(40)));

      const symbolLines = [
        { prefix: '#', name: 'Components', count: counts.symbols.component, color: chalk.green },
        { prefix: '$', name: 'Flows', count: counts.symbols.flow, color: chalk.yellow },
        { prefix: '^', name: 'Gates', count: counts.symbols.gate, color: chalk.red },
        { prefix: '!', name: 'Signals', count: counts.symbols.signal, color: chalk.cyan },
        { prefix: '~', name: 'Aspects', count: counts.symbols.aspect, color: chalk.magenta },
      ];

      for (const { prefix, name, count, color } of symbolLines) {
        if (count > 0) {
          console.log(`  ${color(prefix)} ${name.padEnd(12)} ${chalk.cyan(count.toString())}`);
        }
      }

      const total = counts.totalSymbols;
      console.log(chalk.gray('─'.repeat(40)));
      console.log(`  Total:          ${chalk.cyan(total.toString())}`);
      console.log(`  Isolated:       ${chalk.cyan(counts.isolated.length.toString())}`);

      dim('  Declared symbols only.');
      if (counts.undeclaredReferences > 0) {
        const n = counts.undeclaredReferences;
        dim(`  ${n} undeclared reference${n === 1 ? '' : 's'} not counted (paradigm integrity lists them).`);
      }
      if (counts.gates.total > 0) {
        dim(`  Gates: ${GATE_COUNT_SCOPE}; ${describeGateCounts(counts.gates)}.`);
      }
      dim('  Isolated: declared, with no connection to another symbol.');

      tracker.success('Status retrieved', {
        symbols: total,
        gates: counts.symbols.gate,
        isolated: counts.isolated.length,
        purposeFiles: purposeFiles.length,
        portalFiles: gateFiles.length,
      });

      // Show errors if any
      if (counts.errors.length > 0) {
        console.log(chalk.white('\nWarnings'));
        console.log(chalk.gray('─'.repeat(40)));
        for (const error of counts.errors) {
          console.log(chalk.yellow(`  ⚠ ${error.source}: ${error.message}`));
        }
        log.command('status').warn('Aggregation had errors', { count: counts.errors.length });
      }
    } catch (error) {
      spinner.fail('Failed to aggregate');
      tracker.error('Status failed', { error: (error as Error).message });
      console.log(chalk.red(`  Error: ${(error as Error).message}`));
    }
  }

  console.log('');
}
