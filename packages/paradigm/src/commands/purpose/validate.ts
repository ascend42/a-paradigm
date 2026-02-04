/**
 * paradigm purpose validate - Validate purpose files
 */

import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { log } from '../../utils/logger.js';
import { getAllPurposeFiles, validatePurposeFile, formatValidationResult } from '@a-company/purpose-core';

export async function purposeValidateCommand(targetPath: string) {
  const cwd = process.cwd();
  const absolutePath = path.resolve(cwd, targetPath);

  console.log(chalk.blue('\n🔍 Validating Purpose Files...\n'));

  const spinner = ora('Finding purpose files...').start();

  try {
    const files = await getAllPurposeFiles(absolutePath);
    spinner.succeed(`Found ${files.length} purpose file(s)`);

    let hasErrors = false;
    let totalWarnings = 0;
    let totalErrors = 0;

    for (const { filePath, data } of files) {
      const relativePath = path.relative(cwd, filePath);
      const result = validatePurposeFile(data, relativePath);

      const errors = result.issues.filter(i => i.type === 'error').length;
      const warnings = result.issues.filter(i => i.type === 'warning').length;

      totalErrors += errors;
      totalWarnings += warnings;

      if (!result.valid) {
        hasErrors = true;
      }

      if (result.issues.length > 0) {
        console.log(chalk.white(`\n${relativePath}`));
        console.log(formatValidationResult(result));
      } else {
        console.log(chalk.green(`  ✓ ${relativePath}`));
      }
    }

    // Summary
    console.log(chalk.white('\n' + '─'.repeat(50)));
    if (hasErrors) {
      console.log(chalk.red(`\n❌ Validation failed: ${totalErrors} error(s), ${totalWarnings} warning(s)\n`));
      process.exit(1);
    } else if (totalWarnings > 0) {
      console.log(chalk.yellow(`\n✓ Valid with ${totalWarnings} warning(s)\n`));
    } else {
      console.log(chalk.green('\n✓ All purpose files are valid\n'));
    }

  } catch (error) {
    spinner.fail('Validation failed');
    console.log(chalk.red(`Error: ${(error as Error).message}\n`));
    process.exit(1);
  }
}
