import chalk from 'chalk';
import { loadLoreEntry, updateLoreEntry, type LoreEntry } from '../../core/lore/index.js';

export async function loreEditCommand(id: string, options: Record<string, unknown>): Promise<void> {
  const rootDir = process.cwd();

  // Load existing entry
  const entry = await loadLoreEntry(rootDir, id);
  if (!entry) {
    console.error(chalk.red(`\n  Entry not found: ${id}\n`));
    process.exitCode = 1;
    return;
  }

  // Build partial update from options
  const partial: Partial<Omit<LoreEntry, 'id' | 'timestamp' | 'author'>> = {};

  if (options.title) partial.title = options.title as string;
  if (options.summary) partial.summary = options.summary as string;
  if (options.type) {
    const validTypes = ['agent-session', 'human-note', 'decision', 'review', 'incident', 'milestone'];
    if (!validTypes.includes(options.type as string)) {
      console.error(chalk.red(`Invalid type: ${options.type}. Valid: ${validTypes.join(', ')}`));
      process.exitCode = 1;
      return;
    }
    partial.type = options.type as LoreEntry['type'];
  }
  if (options.symbols) {
    partial.symbols_touched = (options.symbols as string).split(',').map(s => s.trim());
  }
  if (options.tags) {
    partial.tags = (options.tags as string).split(',').map(t => t.trim());
  }
  if (options.learnings) {
    partial.learnings = (options.learnings as string).split(',').map(l => l.trim());
  }

  if (Object.keys(partial).length === 0) {
    console.log(chalk.yellow('\n  No changes specified. Use --title, --summary, --type, --symbols, --tags, or --learnings.\n'));
    return;
  }

  const success = await updateLoreEntry(rootDir, id, partial);

  if (success) {
    console.log(chalk.green(`\n  Updated lore entry: ${id}`));
    for (const [key, value] of Object.entries(partial)) {
      const display = Array.isArray(value) ? value.join(', ') : String(value);
      console.log(chalk.gray(`    ${key}: ${display}`));
    }
    console.log();
  } else {
    console.error(chalk.red(`\n  Failed to update: ${id}\n`));
    process.exitCode = 1;
  }
}
