import chalk from 'chalk';
import { loadLoreEntry } from '../../core/lore/index.js';

export async function loreShowCommand(id: string, options: Record<string, unknown>): Promise<void> {
  const rootDir = process.cwd();
  const entry = await loadLoreEntry(rootDir, id);

  if (!entry) {
    console.error(chalk.red(`\nEntry not found: ${id}\n`));
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify(entry, null, 2));
    return;
  }

  const typeColor: Record<string, (s: string) => string> = {
    'agent-session': chalk.hex('#818cf8'),
    'human-note': chalk.hex('#34d399'),
    'decision': chalk.hex('#fbbf24'),
    'review': chalk.hex('#c084fc'),
    'incident': chalk.hex('#f87171'),
    'milestone': chalk.hex('#60a5fa'),
  };

  const colorFn = typeColor[entry.type] || chalk.white;

  console.log();
  console.log(chalk.white.bold(`  ${entry.title}`));
  console.log(chalk.gray(`  ${entry.id} · ${colorFn(entry.type)} · ${entry.timestamp}`));
  console.log();

  // Author
  console.log(`  👤 ${chalk.white(entry.author)}`);
  if (entry.agent) {
    console.log(`  🤖 ${chalk.gray(entry.agent.model)}${entry.agent.provider ? chalk.gray(` (${entry.agent.provider})`) : ''}`);
  }
  if (entry.duration_minutes) {
    console.log(`  ⏱  ${entry.duration_minutes} minutes`);
  }
  console.log();

  // Summary
  console.log(chalk.gray('  Summary:'));
  console.log(`  ${entry.summary}`);
  console.log();

  // Symbols
  if (entry.symbols_touched?.length > 0) {
    console.log(chalk.gray('  Symbols touched:'));
    console.log(`  ${entry.symbols_touched.map(s => chalk.cyan(s)).join('  ')}`);
    console.log();
  }

  if (entry.symbols_created && entry.symbols_created.length > 0) {
    console.log(chalk.gray('  Symbols created:'));
    console.log(`  ${entry.symbols_created.map(s => chalk.green(s)).join('  ')}`);
    console.log();
  }

  // Files
  if (entry.files_created && entry.files_created.length > 0) {
    console.log(chalk.gray(`  Files created (${entry.files_created.length}):`));
    for (const f of entry.files_created.slice(0, 10)) {
      console.log(`    ${chalk.green('+')} ${f}`);
    }
    if (entry.files_created.length > 10) console.log(chalk.gray(`    ... and ${entry.files_created.length - 10} more`));
    console.log();
  }

  if (entry.files_modified && entry.files_modified.length > 0) {
    console.log(chalk.gray(`  Files modified (${entry.files_modified.length}):`));
    for (const f of entry.files_modified.slice(0, 10)) {
      console.log(`    ${chalk.yellow('~')} ${f}`);
    }
    if (entry.files_modified.length > 10) console.log(chalk.gray(`    ... and ${entry.files_modified.length - 10} more`));
    console.log();
  }

  if (entry.lines_added || entry.lines_removed) {
    console.log(`  ${chalk.green(`+${entry.lines_added || 0}`)} ${chalk.red(`-${entry.lines_removed || 0}`)} lines`);
    console.log();
  }

  // Decisions
  if (entry.decisions && entry.decisions.length > 0) {
    console.log(chalk.gray('  Decisions:'));
    for (const d of entry.decisions) {
      console.log(`    ${chalk.yellow('►')} ${chalk.white(d.decision)}`);
      console.log(`      ${chalk.gray(d.rationale)}`);
    }
    console.log();
  }

  // Errors
  if (entry.errors_encountered && entry.errors_encountered.length > 0) {
    console.log(chalk.gray('  Errors encountered:'));
    for (const e of entry.errors_encountered) {
      console.log(`    ${chalk.red('✗')} ${e.description}`);
      console.log(`      ${chalk.green('→')} ${e.resolution}${e.time_to_fix ? chalk.gray(` (${e.time_to_fix})`) : ''}`);
    }
    console.log();
  }

  // Learnings
  if (entry.learnings && entry.learnings.length > 0) {
    console.log(chalk.gray('  Learnings:'));
    for (const l of entry.learnings) {
      console.log(`    ${chalk.blue('•')} ${l}`);
    }
    console.log();
  }

  // Verification
  if (entry.verification) {
    const statusIcon = entry.verification.status === 'pass' ? chalk.green('✓ pass')
      : entry.verification.status === 'fail' ? chalk.red('✗ fail')
      : entry.verification.status === 'partial' ? chalk.yellow('⚠ partial')
      : chalk.gray('· untested');
    console.log(`  Verification: ${statusIcon}`);
    if (entry.verification.details) {
      for (const [k, v] of Object.entries(entry.verification.details)) {
        const icon = v === 'pass' ? chalk.green('✓') : chalk.red('✗');
        console.log(`    ${icon} ${k}`);
      }
    }
    console.log();
  }

  // Review
  if (entry.review) {
    const stars = (n: number) => chalk.yellow('★'.repeat(n) + '☆'.repeat(5 - n));
    console.log(chalk.gray('  Review:'));
    console.log(`    Reviewer: ${entry.review.reviewer}`);
    console.log(`    Completeness: ${stars(entry.review.completeness)}`);
    console.log(`    Quality: ${stars(entry.review.quality)}`);
    if (entry.review.notes) console.log(`    Notes: ${entry.review.notes}`);
    console.log();
  }

  // Commit
  if (entry.commit) {
    console.log(`  Commit: ${chalk.gray(entry.commit)}`);
  }

  // Tags
  if (entry.tags && entry.tags.length > 0) {
    console.log(`  Tags: ${entry.tags.map(t => chalk.gray(`[${t}]`)).join(' ')}`);
  }
  console.log();
}
