/**
 * paradigm dream snapshot - Create a timeline snapshot
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import {
  parseDreamFile,
  createSnapshot,
  serializeDreamFile,
} from '@a-company/premise-core';

export async function dreamSnapshotCommand(name: string, description?: string) {
  const cwd = process.cwd();
  const dreamPath = path.join(cwd, '.premise');

  console.log(chalk.blue('\n📸 Creating Snapshot...\n'));

  const spinner = ora('Loading .premise file...').start();

  try {
    if (!fs.existsSync(dreamPath)) {
      spinner.fail('.premise file not found');
      console.log(chalk.yellow('\nRun "paradigm init" first to create a .premise file\n'));
      process.exit(1);
    }

    const { data, errors } = parseDreamFile(dreamPath);
    
    if (errors.length > 0) {
      spinner.warn('Warnings parsing .premise file');
      for (const error of errors) {
        console.log(chalk.yellow(`  ⚠ ${error}`));
      }
    }

    if (!data) {
      spinner.fail('Failed to parse .premise file');
      process.exit(1);
    }

    spinner.text = 'Creating snapshot...';

    const updated = createSnapshot(data, name, description);
    const snapshotCount = updated.snapshots?.length || 0;

    // Write back
    fs.writeFileSync(dreamPath, serializeDreamFile(updated));

    spinner.succeed(`Created snapshot "${name}"`);

    console.log(chalk.white('\nSnapshot Details'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`  Name:         ${chalk.cyan(name)}`);
    if (description) {
      console.log(`  Description:  ${chalk.gray(description)}`);
    }
    console.log(`  Nodes:        ${chalk.cyan(data.nodes.length.toString())}`);
    console.log(`  Connections:  ${chalk.cyan(data.connections.length.toString())}`);
    console.log(`  Total:        ${chalk.cyan(snapshotCount.toString())} snapshot(s)`);
    console.log('');

  } catch (error) {
    spinner.fail('Failed to create snapshot');
    console.log(chalk.red(`Error: ${(error as Error).message}\n`));
    process.exit(1);
  }
}
