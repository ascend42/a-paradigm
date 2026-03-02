import chalk from 'chalk';
import { loadLoreEntry, deleteLoreEntry } from '../../core/lore/index.js';

export async function loreDeleteCommand(id: string, options: { yes?: boolean; dryRun?: boolean }): Promise<void> {
  const rootDir = process.cwd();

  // Load entry to confirm it exists
  const entry = await loadLoreEntry(rootDir, id);
  if (!entry) {
    console.error(chalk.red(`\n  Entry not found: ${id}\n`));
    process.exitCode = 1;
    return;
  }

  if (options.dryRun) {
    console.log(chalk.cyan(`\n  [dry-run] Would delete lore entry:`));
    console.log(chalk.white(`    ${entry.id} - ${entry.title}`));
    console.log(chalk.gray(`    Type: ${entry.type} | Author: ${entry.author} | ${entry.timestamp}`));
    console.log(chalk.gray(`    Symbols: ${(entry.symbols_touched || []).join(', ')}`));
    console.log(chalk.cyan(`\n  [dry-run] No changes made.\n`));
    return;
  }

  if (!options.yes) {
    console.log(chalk.yellow(`\n  Will delete lore entry:`));
    console.log(chalk.white(`    ${entry.id} - ${entry.title}`));
    console.log(chalk.gray(`    Type: ${entry.type} | Author: ${entry.author} | ${entry.timestamp}`));
    console.log(chalk.gray(`    Symbols: ${(entry.symbols_touched || []).join(', ')}`));
    console.log(chalk.gray(`\n  Use --yes to confirm deletion.\n`));
    return;
  }

  const success = await deleteLoreEntry(rootDir, id);

  if (success) {
    console.log(chalk.green(`\n  Deleted lore entry: ${id}\n`));
  } else {
    console.error(chalk.red(`\n  Failed to delete: ${id}\n`));
    process.exitCode = 1;
  }
}
