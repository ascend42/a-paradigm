import chalk from 'chalk';
import { recordLore, resolveAuthor, type LoreEntry } from '../../core/lore/index.js';

export async function loreRecordCommand(options: Record<string, unknown>): Promise<void> {
  const rootDir = process.cwd();

  const entry: LoreEntry = {
    id: '', // auto-generated
    type: (options.type as LoreEntry['type']) || 'human-note',
    timestamp: new Date().toISOString(),
    duration_minutes: options.duration ? parseInt(options.duration as string, 10) : undefined,
    author: (options.author as string) || resolveAuthor(),
    title: options.title as string || 'Untitled',
    summary: options.summary as string || '',
    symbols_touched: options.symbols ? (options.symbols as string).split(',').map(s => s.trim()) : [],
    files_modified: options.filesModified ? (options.filesModified as string).split(',').map(f => f.trim()) : undefined,
    files_created: options.filesCreated ? (options.filesCreated as string).split(',').map(f => f.trim()) : undefined,
    commit: options.commit as string || undefined,
    learnings: options.learnings ? (options.learnings as string).split(',').map(l => l.trim()) : undefined,
    tags: options.tags ? (options.tags as string).split(',').map(t => t.trim()) : undefined,
    meta: options.meta ? JSON.parse(options.meta as string) : undefined,
    body: options.body as string || undefined,
    linked_lore: options.linkLore ? (options.linkLore as string).split(',').map(l => l.trim()) : undefined,
    linked_commits: options.linkCommits ? (options.linkCommits as string).split(',').map(c => c.trim()) : undefined,
    // git_context is auto-captured by recordLore
  };

  await recordLore(rootDir, entry);

  console.log(chalk.green(`\n  Lore entry recorded: ${entry.id}\n`));
}
