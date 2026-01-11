// src/commands/gate/validate.ts
import * as path from "path";
import chalk from "chalk";
import ora from "ora";
import { parseGateConfig, validateGateConfig, formatValidationResult } from "@horizon/gate-core";
async function gateValidateCommand(configPath) {
  const cwd = process.cwd();
  const absolutePath = path.resolve(cwd, configPath);
  console.log(chalk.blue("\n\u{1F50D} Validating Gate Configuration...\n"));
  const spinner = ora(`Parsing ${configPath}...`).start();
  try {
    const config = await parseGateConfig(absolutePath);
    spinner.succeed("Parsed gate.yaml");
    const result = validateGateConfig(config);
    console.log(chalk.white(`
Gates: ${config.gates.length}`));
    console.log(chalk.white(`Flows: ${config.flows.length}`));
    console.log(formatValidationResult(result));
    if (!result.valid) {
      process.exit(1);
    }
    console.log("");
  } catch (error) {
    spinner.fail("Validation failed");
    console.log(chalk.red(`Error: ${error.message}
`));
    process.exit(1);
  }
}
export {
  gateValidateCommand
};
