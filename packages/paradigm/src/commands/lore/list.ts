import chalk from 'chalk';
import { loadLoreEntries, type LoreFilter, type LoreEntry } from '../../core/lore/index.js';

export async function loreListCommand(options: Record<string, unknown>): Promise<void> {
  const rootDir = process.cwd();
  const filter: LoreFilter = {};

  if (options.author) filter.author = options.author as string;
  if (options.type) filter.type = options.type as LoreEntry['type'];
  if (options.symbol) filter.symbol = options.symbol as string;
  if (options.tags) filter.tags = (options.tags as string).split(',');
  if (options.from) filter.dateFrom = options.from as string;
  if (options.to) filter.dateTo = options.to as string;
  filter.limit = parseInt(options.limit as string || '20', 10);

  const entries = await loadLoreEntries(rootDir, filter);

  if (options.json) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }

  if (entries.length === 0) {
    console.log(chalk.gray('\nNo lore entries found.\n'));
    console.log(chalk.gray('Record one with: paradigm lore record'));
    return;
  }

  console.log(chalk.cyan(`\n  Lore Entries (${entries.length})\n`));

  // Type colors
  const typeColor: Record<string, (s: string) => string> = {
    'agent-session': chalk.hex('#818cf8'),
    'human-note': chalk.hex('#34d399'),
    'decision': chalk.hex('#fbbf24'),
    'review': chalk.hex('#c084fc'),
    'incident': chalk.hex('#f87171'),
    'milestone': chalk.hex('#60a5fa'),
  };

  for (const entry of entries) {
    const colorFn = typeColor[entry.type] || chalk.white;
    const date = new Date(entry.timestamp);
    const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const authorIcon = entry.author.type === 'agent' ? '🤖' : '👤';
    const verifyIcon = entry.verification?.status === 'pass' ? chalk.green('✓')
      : entry.verification?.status === 'fail' ? chalk.red('✗')
      : entry.verification?.status === 'partial' ? chalk.yellow('⚠')
      : chalk.gray('·');
    const reviewStr = entry.review ? chalk.yellow('★'.repeat(entry.review.quality) + '☆'.repeat(5 - entry.review.quality)) : '';

    console.log(`  ${chalk.gray(entry.id)} ${colorFn(entry.type.padEnd(14))} ${verifyIcon} ${chalk.white(entry.title)}`);
    console.log(`  ${chalk.gray(dateStr + ' ' + timeStr)}  ${authorIcon} ${chalk.gray(entry.author.id)}  ${entry.symbols_touched.map(s => chalk.cyan(s)).join(' ')} ${reviewStr}`);
    console.log();
  }
}
