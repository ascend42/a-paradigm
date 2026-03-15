/**
 * University list command - List university content
 */

import chalk from 'chalk';
import { searchContent, loadUniversityIndex } from '../../core/university/index.js';
import type { Difficulty } from '../../core/university/types.js';

interface ListOptions {
  type?: string;
  tag?: string;
  difficulty?: string;
  symbol?: string;
  limit?: string;
  json?: boolean;
}

export async function universityListCommand(options: ListOptions): Promise<void> {
  const rootDir = process.cwd();
  const index = loadUniversityIndex(rootDir);

  if (!index || index.totalContent === 0) {
    console.log(chalk.yellow('\n  No university content found.'));
    console.log(chalk.gray('  Create content with: paradigm university add note --title "My Note"\n'));
    return;
  }

  const results = searchContent(rootDir, {
    type: options.type,
    tag: options.tag,
    difficulty: options.difficulty as Difficulty | undefined,
    symbol: options.symbol,
    limit: options.limit ? parseInt(options.limit, 10) : 20,
  });

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  console.log(chalk.blue(`\n  University Content (${results.length} of ${index.totalContent})\n`));

  const typeIcons: Record<string, string> = {
    note: 'N',
    policy: 'P',
    guide: 'N',
    runbook: 'N',
    quiz: 'Q',
    path: 'LP',
  };

  for (const entry of results) {
    const icon = typeIcons[entry.type] || '?';
    const diffColor = entry.difficulty === 'advanced' ? chalk.red : entry.difficulty === 'intermediate' ? chalk.yellow : chalk.green;
    const tags = entry.tags.length > 0 ? chalk.gray(` [${entry.tags.join(', ')}]`) : '';

    console.log(`  ${chalk.cyan(icon)} ${chalk.white(entry.id)} — ${entry.title}${tags}`);
    if (entry.difficulty) {
      console.log(`    ${diffColor(entry.difficulty)} · ${entry.author} · ${entry.updated || entry.created}`);
    }
  }

  if (index.diplomaCount > 0) {
    console.log(chalk.gray(`\n  ${index.diplomaCount} diploma${index.diplomaCount > 1 ? 's' : ''} earned`));
  }
  console.log();
}
