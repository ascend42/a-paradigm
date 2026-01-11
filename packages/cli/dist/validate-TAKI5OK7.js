// src/commands/purpose/validate.ts
import * as path from "path";
import chalk from "chalk";
import ora from "ora";
import { getAllPurposeFiles, validatePurposeFile, formatValidationResult } from "@horizon/purpose-core";
async function purposeValidateCommand(targetPath) {
  const cwd = process.cwd();
  const absolutePath = path.resolve(cwd, targetPath);
  console.log(chalk.blue("\n\u{1F50D} Validating Purpose Files...\n"));
  const spinner = ora("Finding purpose files...").start();
  try {
    const files = await getAllPurposeFiles(absolutePath);
    spinner.succeed(`Found ${files.length} purpose file(s)`);
    let hasErrors = false;
    let totalWarnings = 0;
    let totalErrors = 0;
    for (const { filePath, data } of files) {
      const relativePath = path.relative(cwd, filePath);
      const result = validatePurposeFile(data, relativePath);
      const errors = result.issues.filter((i) => i.type === "error").length;
      const warnings = result.issues.filter((i) => i.type === "warning").length;
      totalErrors += errors;
      totalWarnings += warnings;
      if (!result.valid) {
        hasErrors = true;
      }
      if (result.issues.length > 0) {
        console.log(chalk.white(`
${relativePath}`));
        console.log(formatValidationResult(result));
      } else {
        console.log(chalk.green(`  \u2713 ${relativePath}`));
      }
    }
    console.log(chalk.white("\n" + "\u2500".repeat(50)));
    if (hasErrors) {
      console.log(chalk.red(`
\u274C Validation failed: ${totalErrors} error(s), ${totalWarnings} warning(s)
`));
      process.exit(1);
    } else if (totalWarnings > 0) {
      console.log(chalk.yellow(`
\u2713 Valid with ${totalWarnings} warning(s)
`));
    } else {
      console.log(chalk.green("\n\u2713 All purpose files are valid\n"));
    }
  } catch (error) {
    spinner.fail("Validation failed");
    console.log(chalk.red(`Error: ${error.message}
`));
    process.exit(1);
  }
}
export {
  purposeValidateCommand
};
