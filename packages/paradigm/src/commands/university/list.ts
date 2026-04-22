/**
 * University list command — v6.0: lists discovered packs by default;
 * lists entries within a pack when a selector (--pack / --project /
 * --discipline) is provided.
 */

import chalk from 'chalk';
import { searchContent, loadUniversityIndex } from '../../core/university/index.js';
import type { Difficulty } from '../../core/university/types.js';
import {
  discoverPacksForCli,
  resolvePackContext,
  hasSelector,
  type SelectorOptions,
} from './selectors.js';

interface ListOptions extends SelectorOptions {
  type?: string;
  tag?: string;
  difficulty?: string;
  symbol?: string;
  limit?: string;
  json?: boolean;
}

export async function universityListCommand(options: ListOptions): Promise<void> {
  const rootDir = process.cwd();

  // Pack-listing mode (default, no selector)
  if (!hasSelector(options)) {
    const packs = discoverPacksForCli(rootDir);

    if (options.json) {
      console.log(JSON.stringify({ packs }, null, 2));
      return;
    }

    if (packs.length === 0) {
      console.log(chalk.yellow('\n  No content packs discovered.'));
      console.log(chalk.gray('  Scaffold one with: paradigm university init\n'));
      return;
    }

    console.log(chalk.blue(`\n  Content packs (${packs.length})\n`));
    for (const p of packs) {
      const tk = p.tenantKind === 'first-party'
        ? chalk.cyan('first-party')
        : p.tenantKind === 'project'
          ? chalk.green('project')
          : chalk.yellow('external');
      const disciplines = p.disciplines && p.disciplines.length > 0
        ? chalk.gray(` [${p.disciplines.join(', ')}]`)
        : '';
      console.log(`  ${chalk.white(p.id.padEnd(28))} ${tk}  ${p.entryCount} entries${disciplines}`);
      if (p.name && p.name !== p.id) {
        console.log(chalk.gray(`    ${p.name}`));
      }
    }
    console.log(chalk.gray(`\n  Tip: paradigm university list --project   (list entries in project pack)`));
    console.log('');
    return;
  }

  // Entry-listing mode — selector provided
  const ctx = resolvePackContext(rootDir, options);

  // When a discipline sub-pack is resolved, scope the display to it.
  const displayPackId = ctx.subPackId ?? ctx.packId;

  const index = loadUniversityIndex(rootDir);

  if (!index || index.totalContent === 0) {
    console.log(chalk.yellow(`\n  No content found in pack "${displayPackId}".`));
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
    console.log(JSON.stringify({ pack: displayPackId, results }, null, 2));
    return;
  }

  console.log(chalk.blue(`\n  University Content — pack: ${displayPackId} (${results.length} of ${index.totalContent})\n`));

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

    console.log(`  ${chalk.cyan(icon)} ${chalk.white(`${displayPackId}:${entry.id}`)} — ${entry.title}${tags}`);
    if (entry.difficulty) {
      console.log(`    ${diffColor(entry.difficulty)} · ${entry.author} · ${entry.updated || entry.created}`);
    }
  }

  if (index.diplomaCount > 0) {
    console.log(chalk.gray(`\n  ${index.diplomaCount} diploma${index.diplomaCount > 1 ? 's' : ''} earned`));
  }
  console.log();
}
