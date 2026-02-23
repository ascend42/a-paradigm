import chalk from 'chalk';
import { loadLoreEntries, type LoreEntry } from '../../core/lore/index.js';

export async function loreTimelineCommand(options: {
  limit?: string;
  json?: boolean;
}): Promise<void> {
  const rootDir = process.cwd();
  const limit = parseInt(options.limit || '20', 10);

  const entries = await loadLoreEntries(rootDir, { limit });

  if (entries.length === 0) {
    if (options.json) {
      console.log(JSON.stringify({ entries: [], byDate: {}, hotSymbols: [], authors: [] }, null, 2));
    } else {
      console.log(chalk.gray('\nNo lore entries found.\n'));
    }
    return;
  }

  // Group by date
  const byDate = new Map<string, LoreEntry[]>();
  for (const entry of entries) {
    const date = entry.timestamp.slice(0, 10);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(entry);
  }

  // Compute hot symbols
  const symbolCounts = new Map<string, number>();
  for (const entry of entries) {
    for (const sym of entry.symbols_touched) {
      symbolCounts.set(sym, (symbolCounts.get(sym) || 0) + 1);
    }
  }
  const hotSymbols = Array.from(symbolCounts.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([symbol, count]) => ({ symbol, count }));

  // Compute author activity
  const authorActivity = new Map<string, { count: number; type: string; lastActive: string }>();
  for (const entry of entries) {
    const aid = entry.author.id;
    const existing = authorActivity.get(aid);
    if (!existing) {
      authorActivity.set(aid, { count: 1, type: entry.author.type, lastActive: entry.timestamp });
    } else {
      existing.count++;
      if (entry.timestamp > existing.lastActive) existing.lastActive = entry.timestamp;
    }
  }

  if (options.json) {
    const grouped: Record<string, Array<{ id: string; type: string; title: string; author: string; symbols: string[] }>> = {};
    for (const [date, dayEntries] of byDate) {
      grouped[date] = dayEntries.map(e => ({
        id: e.id,
        type: e.type,
        title: e.title,
        author: e.author.id,
        symbols: e.symbols_touched,
      }));
    }

    console.log(JSON.stringify({
      total: entries.length,
      byDate: grouped,
      hotSymbols,
      authors: Array.from(authorActivity.entries()).map(([id, info]) => ({
        id, type: info.type, entries: info.count, lastActive: info.lastActive,
      })),
    }, null, 2));
    return;
  }

  // Type colors
  const typeColor: Record<string, (s: string) => string> = {
    'agent-session': chalk.hex('#818cf8'),
    'human-note': chalk.hex('#34d399'),
    'decision': chalk.hex('#fbbf24'),
    'review': chalk.hex('#c084fc'),
    'incident': chalk.hex('#f87171'),
    'milestone': chalk.hex('#60a5fa'),
  };

  console.log(chalk.magenta(`\n  Lore Timeline (${entries.length} entries)\n`));

  for (const [date, dayEntries] of byDate) {
    console.log(chalk.white.bold(`  ${date}`) + chalk.gray(` (${dayEntries.length} entries)`));

    for (const entry of dayEntries) {
      const colorFn = typeColor[entry.type] || chalk.white;
      const time = entry.timestamp.slice(11, 16);
      const authorIcon = entry.author.type === 'agent' ? '🤖' : '👤';

      console.log(`    ${chalk.gray(time)} ${colorFn(entry.type.padEnd(14))} ${chalk.white(entry.title)}`);
      console.log(`           ${authorIcon} ${chalk.gray(entry.author.id)}  ${entry.symbols_touched.slice(0, 4).map(s => chalk.cyan(s)).join(' ')}`);
    }
    console.log();
  }

  // Hot symbols
  if (hotSymbols.length > 0) {
    console.log(chalk.white('  Hot Symbols:'));
    for (const { symbol, count } of hotSymbols.slice(0, 5)) {
      const bar = '█'.repeat(Math.min(count, 20));
      console.log(`    ${chalk.cyan(symbol.padEnd(25))} ${chalk.gray(bar)} ${count}`);
    }
    console.log();
  }

  // Authors
  if (authorActivity.size > 0) {
    console.log(chalk.white('  Active Authors:'));
    for (const [id, info] of authorActivity) {
      const icon = info.type === 'agent' ? '🤖' : '👤';
      console.log(`    ${icon} ${chalk.white(id)} - ${info.count} entries`);
    }
    console.log();
  }
}
