/**
 * paradigm purpose validate - Validate purpose files
 */

import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import ora from 'ora';
import { getAllPurposeFiles, parsePurposeFile, validatePurposeFile, formatValidationResult, type ParsedPurposeFile } from '@a-company/purpose-core';

export async function purposeValidateCommand(targetPath: string) {
  const cwd = process.cwd();
  const absolutePath = path.resolve(cwd, targetPath);

  console.log(chalk.blue('\n🔍 Validating Purpose Files...\n'));

  const spinner = ora('Finding purpose files...').start();

  try {
    // Distinguish a single .purpose FILE from a directory to scan. getAllPurposeFiles
    // globs '**/.purpose' with its argument as cwd — passing a file yields 0 matches,
    // so a file path must be validated directly rather than globbed.
    let stat: fs.Stats;
    try {
      stat = fs.statSync(absolutePath);
    } catch {
      spinner.fail('Validation failed');
      console.log(chalk.red(`Error: path not found: ${path.relative(cwd, absolutePath) || absolutePath}\n`));
      process.exit(1);
    }

    let files: ParsedPurposeFile[];
    if (stat!.isDirectory()) {
      files = await getAllPurposeFiles(absolutePath);
    } else {
      // Single file: it must be a .purpose file to validate.
      if (path.basename(absolutePath) !== '.purpose') {
        spinner.fail('Validation failed');
        console.log(chalk.red(`Error: not a .purpose file: ${path.relative(cwd, absolutePath) || absolutePath}\n`));
        process.exit(1);
      }
      const { data } = parsePurposeFile(absolutePath);
      files = data ? [{ filePath: absolutePath, data }] : [];
    }
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
