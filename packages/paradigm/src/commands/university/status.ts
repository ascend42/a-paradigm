/**
 * University status command - Content overview and completion.
 * v6.0: honors selectors; reports which pack the status reflects.
 */

import chalk from 'chalk';
import { loadUniversityIndex, loadDiplomas } from '../../core/university/index.js';
import { resolvePackContext, type SelectorOptions } from './selectors.js';

interface StatusOptions extends SelectorOptions {
  json?: boolean;
}

export async function universityStatusCommand(options: StatusOptions): Promise<void> {
  const rootDir = process.cwd();
  const ctx = resolvePackContext(rootDir, options);
  const index = loadUniversityIndex(rootDir);

  if (!index || index.totalContent === 0) {
    console.log(chalk.yellow('\n  No university content found.'));
    console.log(chalk.gray('  Create content with: paradigm university add note --title "My Note"\n'));
    return;
  }

  const diplomas = loadDiplomas(rootDir);

  // Count by type
  const typeCounts: Record<string, number> = {};
  const tagCounts: Record<string, number> = {};
  const difficultyCounts: Record<string, number> = {};

  for (const entry of index.entries) {
    typeCounts[entry.type] = (typeCounts[entry.type] || 0) + 1;
    if (entry.difficulty) {
      difficultyCounts[entry.difficulty] = (difficultyCounts[entry.difficulty] || 0) + 1;
    }
    for (const tag of entry.tags) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
  }

  if (options.json) {
    console.log(JSON.stringify({
      pack: ctx.subPackId ?? ctx.packId,
      totalContent: index.totalContent,
      typeCounts,
      difficultyCounts,
      tagCounts,
      diplomaCount: diplomas.length,
    }, null, 2));
    return;
  }

  console.log(chalk.blue(`\n  University Status — pack: ${ctx.subPackId ?? ctx.packId}\n`));

  console.log(chalk.white(`  Total content: ${index.totalContent}`));
  for (const [type, count] of Object.entries(typeCounts).sort()) {
    console.log(`    ${chalk.cyan(type)}: ${count}`);
  }

  if (Object.keys(difficultyCounts).length > 0) {
    console.log();
    console.log(chalk.white('  By difficulty:'));
    for (const [diff, count] of Object.entries(difficultyCounts)) {
      const color = diff === 'advanced' ? chalk.red : diff === 'intermediate' ? chalk.yellow : chalk.green;
      console.log(`    ${color(diff)}: ${count}`);
    }
  }

  if (Object.keys(tagCounts).length > 0) {
    console.log();
    console.log(chalk.white('  Top tags:'));
    const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
    for (const [tag, count] of topTags) {
      console.log(`    ${chalk.gray(tag)}: ${count}`);
    }
  }

  console.log();
  console.log(chalk.white(`  Diplomas earned: ${diplomas.length}`));
  if (diplomas.length > 0) {
    for (const d of diplomas.slice(0, 5)) {
      const status = d.passed ? chalk.green('PASS') : chalk.red('FAIL');
      console.log(`    ${status} ${d.source} — ${d.student} (${d.percentage}%) ${chalk.gray(d.earnedAt.slice(0, 10))}`);
    }
    if (diplomas.length > 5) {
      console.log(chalk.gray(`    ... and ${diplomas.length - 5} more`));
    }
  }

  console.log();
}
