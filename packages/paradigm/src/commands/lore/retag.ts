import chalk from 'chalk';
import { loadLoreEntries, updateLoreEntry, type LoreFilter } from '../../core/lore/index.js';

export async function loreRetagCommand(options: Record<string, unknown>): Promise<void> {
  const rootDir = process.cwd();
  const addTag = options.add as string | undefined;
  const removeTag = options.remove as string | undefined;

  if (!addTag && !removeTag) {
    console.error(chalk.red('\n  Must specify --add <tag> or --remove <tag>\n'));
    process.exit(1);
  }

  // Build filter from options
  const filter: LoreFilter = {};
  if (options.type) filter.type = options.type as LoreFilter['type'];
  if (options.symbol) filter.symbol = options.symbol as string;
  if (options.author) filter.author = options.author as string;
  if (options.from) filter.dateFrom = options.from as string;
  if (options.to) filter.dateTo = options.to as string;
  if (options.tags) filter.tags = (options.tags as string).split(',').map(t => t.trim());

  const entries = await loadLoreEntries(rootDir, filter);

  if (entries.length === 0) {
    console.log(chalk.yellow('\n  No matching entries found\n'));
    return;
  }

  const dryRun = !!options.dryRun;
  let updated = 0;

  for (const entry of entries) {
    const currentTags = entry.tags || [];
    let newTags: string[];

    if (addTag) {
      if (currentTags.includes(addTag)) continue; // Already has tag
      newTags = [...currentTags, addTag];
    } else {
      if (!currentTags.includes(removeTag!)) continue; // Doesn't have tag
      newTags = currentTags.filter(t => t !== removeTag);
    }

    if (dryRun) {
      const action = addTag ? chalk.green(`+${addTag}`) : chalk.red(`-${removeTag}`);
      console.log(chalk.gray(`  [dry-run] ${entry.id}: ${action}`));
    } else {
      await updateLoreEntry(rootDir, entry.id, { tags: newTags });
      const action = addTag ? chalk.green(`+${addTag}`) : chalk.red(`-${removeTag}`);
      console.log(`  ${entry.id}: ${action}`);
    }
    updated++;
  }

  console.log();
  if (dryRun) {
    console.log(chalk.yellow(`  Dry run: ${updated} entries would be updated`));
  } else {
    console.log(chalk.green(`  Updated ${updated} entries`));
  }
  console.log();
}
