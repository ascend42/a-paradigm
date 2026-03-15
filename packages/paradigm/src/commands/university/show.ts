/**
 * University show command - Display a content item
 */

import chalk from 'chalk';
import { loadNote, loadQuiz, loadPath } from '../../core/university/index.js';

interface ShowOptions {
  json?: boolean;
}

export async function universityShowCommand(id: string, options: ShowOptions): Promise<void> {
  const rootDir = process.cwd();

  // Try note/policy
  const note = loadNote(rootDir, id);
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
  const quiz = loadQuiz(rootDir, id);
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
  const lp = loadPath(rootDir, id);
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
