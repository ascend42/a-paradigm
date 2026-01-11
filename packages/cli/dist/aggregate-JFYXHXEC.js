// src/commands/dream/aggregate.ts
import * as fs from "fs";
import * as path from "path";
import chalk from "chalk";
import ora from "ora";
import {
  aggregateFromDream,
  aggregateFromDirectory,
  parseDreamFile,
  buildSymbolIndex,
  getSymbolCounts
} from "@horizon/dream-core";
async function dreamAggregateCommand(targetPath) {
  const cwd = process.cwd();
  const absolutePath = path.resolve(cwd, targetPath);
  console.log(chalk.blue("\n\u{1F52E} Aggregating Dream...\n"));
  const spinner = ora("Loading sources...").start();
  try {
    let result;
    const dreamPath = path.join(absolutePath, ".dream");
    if (fs.existsSync(dreamPath)) {
      const { data, errors } = parseDreamFile(dreamPath);
      if (errors.length > 0) {
        spinner.warn("Warnings parsing .dream file");
        for (const error of errors) {
          console.log(chalk.yellow(`  \u26A0 ${error}`));
        }
      }
      if (data) {
        result = await aggregateFromDream(data, absolutePath);
      }
    }
    if (!result) {
      result = await aggregateFromDirectory(absolutePath);
    }
    spinner.succeed("Aggregated all sources");
    const index = buildSymbolIndex(result);
    const counts = getSymbolCounts(index);
    console.log(chalk.white("\nSources"));
    console.log(chalk.gray("\u2500".repeat(40)));
    console.log(`  Purpose files:  ${chalk.cyan(result.purposeFiles.length.toString())}`);
    console.log(`  Gate files:     ${chalk.cyan(result.gateFiles.length.toString())}`);
    console.log(chalk.white("\nSymbol Index"));
    console.log(chalk.gray("\u2500".repeat(40)));
    const symbolLines = [
      { prefix: "@", name: "Features", count: counts.feature, color: chalk.blue },
      { prefix: "#", name: "Components", count: counts.component, color: chalk.green },
      { prefix: "$", name: "Flows", count: counts.flow, color: chalk.yellow },
      { prefix: "%", name: "States", count: counts.state, color: chalk.magenta },
      { prefix: "^", name: "Gates", count: counts.gate, color: chalk.red },
      { prefix: "!", name: "Signals", count: counts.signal, color: chalk.yellow },
      { prefix: "?", name: "Ideas", count: counts.idea, color: chalk.white }
    ];
    for (const { prefix, name, count, color } of symbolLines) {
      if (count > 0) {
        console.log(`  ${color(prefix)} ${name.padEnd(12)} ${chalk.cyan(count.toString())}`);
      }
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log(chalk.gray("\u2500".repeat(40)));
    console.log(`  Total:          ${chalk.cyan(total.toString())}`);
    if (result.errors.length > 0) {
      console.log(chalk.yellow("\nErrors"));
      console.log(chalk.gray("\u2500".repeat(40)));
      for (const error of result.errors) {
        console.log(chalk.red(`  \u2717 [${error.source}] ${error.filePath}: ${error.message}`));
      }
    }
    console.log("");
  } catch (error) {
    spinner.fail("Aggregation failed");
    console.log(chalk.red(`Error: ${error.message}
`));
    process.exit(1);
  }
}
export {
  dreamAggregateCommand
};
