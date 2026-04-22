/**
 * University show command - Display a content item.
 * v6.0: id accepts bare or <pack-id>:<entry-id>.
 */

import chalk from 'chalk';
import { loadNote, loadQuiz, loadPath } from '../../core/university/index.js';
import { resolvePackContext, type SelectorOptions } from './selectors.js';

interface ShowOptions extends SelectorOptions {
  json?: boolean;
}

/** Strip the <pack-id>: prefix if present; returns bare entry id. */
function splitAddress(address: string): { packId?: string; entryId: string } {
  const colonIdx = address.indexOf(':');
  if (colonIdx === -1) return { entryId: address };
  return {
    packId: address.slice(0, colonIdx),
    entryId: address.slice(colonIdx + 1),
  };
}

export async function universityShowCommand(id: string, options: ShowOptions): Promise<void> {
  const rootDir = process.cwd();
  const { packId: addressPackId, entryId } = splitAddress(id);

  // Selector flags + addressPackId both inform the pack context. The
  // <pack-id>:<entry-id> form wins over --pack when both are set (caller
  // was explicit in the address).
  const selectorOpts: SelectorOptions = { ...options };
  if (addressPackId) selectorOpts.pack = addressPackId;

  // Resolving the context is advisory — the paradigm CLI's core loader
  // still reads from .paradigm/university/. v5.39.0 doesn't split the
  // storage layer along pack boundaries (that's v6.0 core work). This
  // call ensures we surface the selector in messages and validate the
  // pack exists.
  resolvePackContext(rootDir, selectorOpts);

  // Try note/policy
  const note = loadNote(rootDir, entryId);
  if (note) {
    if (options.json) {
      console.log(JSON.stringify({ ...note.frontmatter, body: note.body }, null, 2));
      return;
    }
    console.log(chalk.blue(`\n  ${note.frontmatter.title}`));
    console.log(chalk.gray(`  ${note.frontmatter.type} · ${note.frontmatter.difficulty} · ${note.frontmatter.author}`));
    if (note.frontmatter.tags.length > 0) {
      console.log(chalk.gray(`  Tags: ${note.frontmatter.tags.join(', ')}`));
    }
    if (note.frontmatter.symbols.length > 0) {
      console.log(chalk.gray(`  Symbols: ${note.frontmatter.symbols.join(', ')}`));
    }
    console.log();
    console.log(note.body);
    console.log();
    return;
  }

  // Try quiz
  const quiz = loadQuiz(rootDir, entryId);
  if (quiz) {
    if (options.json) {
      console.log(JSON.stringify(quiz, null, 2));
      return;
    }
    console.log(chalk.blue(`\n  ${quiz.title}`));
    console.log(chalk.gray(`  quiz · ${quiz.difficulty} · ${quiz.questions.length} questions · pass: ${quiz.passThreshold * 100}%`));
    if (quiz.description) console.log(chalk.gray(`  ${quiz.description}`));
    console.log();
    for (const q of quiz.questions) {
      console.log(`  ${chalk.cyan(q.id)}: ${q.question}`);
      for (const [key, val] of Object.entries(q.choices)) {
        const marker = key === q.correct ? chalk.green('*') : ' ';
        console.log(`    ${marker} ${key}: ${val}`);
      }
      if (q.explanation) console.log(chalk.gray(`    → ${q.explanation}`));
      console.log();
    }
    return;
  }

  // Try path
  const lp = loadPath(rootDir, entryId);
  if (lp) {
    if (options.json) {
      console.log(JSON.stringify(lp, null, 2));
      return;
    }
    console.log(chalk.blue(`\n  ${lp.title}`));
    console.log(chalk.gray(`  learning path · ${lp.steps.length} steps · ${lp.ordered ? 'ordered' : 'unordered'}`));
    if (lp.description) console.log(chalk.gray(`  ${lp.description}`));
    console.log();
    for (let i = 0; i < lp.steps.length; i++) {
      const step = lp.steps[i];
      const req = step.required ? chalk.red('required') : chalk.gray('optional');
      console.log(`  ${i + 1}. ${chalk.cyan(step.content)} (${req})`);
      if (step.note) console.log(chalk.gray(`     ${step.note}`));
    }
    console.log();
    return;
  }

  console.error(chalk.red(`\n  Content "${id}" not found\n`));
  process.exit(1);
}
