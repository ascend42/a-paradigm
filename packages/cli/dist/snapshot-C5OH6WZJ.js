// src/commands/dream/snapshot.ts
import * as fs from "fs";
import * as path from "path";
import chalk from "chalk";
import ora from "ora";
import {
  parseDreamFile,
  createSnapshot,
  serializeDreamFile
} from "@horizon/dream-core";
async function dreamSnapshotCommand(name, description) {
  const cwd = process.cwd();
  const dreamPath = path.join(cwd, ".dream");
  console.log(chalk.blue("\n\u{1F4F8} Creating Snapshot...\n"));
  const spinner = ora("Loading .dream file...").start();
  try {
    if (!fs.existsSync(dreamPath)) {
      spinner.fail(".dream file not found");
      console.log(chalk.yellow('\nRun "horizon init" first to create a .dream file\n'));
      process.exit(1);
    }
    const { data, errors } = parseDreamFile(dreamPath);
    if (errors.length > 0) {
      spinner.warn("Warnings parsing .dream file");
      for (const error of errors) {
        console.log(chalk.yellow(`  \u26A0 ${error}`));
      }
    }
    if (!data) {
      spinner.fail("Failed to parse .dream file");
      process.exit(1);
    }
    spinner.text = "Creating snapshot...";
    const updated = createSnapshot(data, name, description);
    const snapshotCount = updated.snapshots?.length || 0;
    fs.writeFileSync(dreamPath, serializeDreamFile(updated));
    spinner.succeed(`Created snapshot "${name}"`);
    console.log(chalk.white("\nSnapshot Details"));
    console.log(chalk.gray("\u2500".repeat(40)));
    console.log(`  Name:         ${chalk.cyan(name)}`);
    if (description) {
      console.log(`  Description:  ${chalk.gray(description)}`);
    }
    console.log(`  Nodes:        ${chalk.cyan(data.nodes.length.toString())}`);
    console.log(`  Connections:  ${chalk.cyan(data.connections.length.toString())}`);
    console.log(`  Total:        ${chalk.cyan(snapshotCount.toString())} snapshot(s)`);
    console.log("");
  } catch (error) {
    spinner.fail("Failed to create snapshot");
    console.log(chalk.red(`Error: ${error.message}
`));
    process.exit(1);
  }
}
export {
  dreamSnapshotCommand
};
