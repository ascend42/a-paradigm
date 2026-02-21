import chalk from 'chalk';
import { recordLore, type LoreEntry } from '../../core/lore/index.js';

export async function loreRecordCommand(options: Record<string, unknown>): Promise<void> {
  const rootDir = process.cwd();

  const entry: LoreEntry = {
    id: '', // auto-generated
    type: (options.type as LoreEntry['type']) || 'human-note',
    timestamp: new Date().toISOString(),
    author: {
      type: 'human',
      id: options.author as string || 'unknown',
    },
    title: options.title as string || 'Untitled',
    summary: options.summary as string || '',
    symbols_touched: options.symbols ? (options.symbols as string).split(',').map(s => s.trim()) : [],
    tags: options.tags ? (options.tags as string).split(',').map(t => t.trim()) : undefined,
  };

  await recordLore(rootDir, entry);

  console.log(chalk.green(`\n  ✓ Lore entry recorded: ${entry.id}\n`));
}
