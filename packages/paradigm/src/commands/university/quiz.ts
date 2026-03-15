/**
 * University quiz command - Interactive terminal quiz
 */

import chalk from 'chalk';
import * as readline from 'readline';
import { loadQuiz, saveDiploma } from '../../core/university/index.js';
import type { Diploma } from '../../core/university/types.js';
import { execSync } from 'child_process';
import * as os from 'os';

function resolveStudent(): string {
  try {
    return execSync('git config user.name', { encoding: 'utf-8', timeout: 3000 }).trim()
      .toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 20) || 'unknown';
  } catch {
    try { return os.userInfo().username; } catch { return 'unknown'; }
  }
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, resolve));
}

export async function universityQuizCommand(id: string): Promise<void> {
  const rootDir = process.cwd();
  const quiz = loadQuiz(rootDir, id);

  if (!quiz) {
    console.error(chalk.red(`\n  Quiz "${id}" not found\n`));
    process.exit(1);
  }

  if (quiz.questions.length === 0) {
    console.log(chalk.yellow(`\n  Quiz "${id}" has no questions.\n`));
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log(chalk.blue(`\n  ${quiz.title}`));
  if (quiz.description) console.log(chalk.gray(`  ${quiz.description}`));
  console.log(chalk.gray(`  ${quiz.questions.length} questions · Pass: ${quiz.passThreshold * 100}%\n`));

  let correct = 0;

  for (let i = 0; i < quiz.questions.length; i++) {
    const q = quiz.questions[i];
    console.log(chalk.white(`  ${i + 1}. ${q.question}`));

    const choiceKeys = Object.keys(q.choices).sort();
    for (const key of choiceKeys) {
      console.log(`     ${chalk.cyan(key)}: ${q.choices[key]}`);
    }

    let answer = '';
    while (!choiceKeys.includes(answer.toUpperCase())) {
      answer = await ask(rl, chalk.gray(`  Your answer (${choiceKeys.join('/')}): `));
      answer = answer.trim().toUpperCase();
    }

    if (answer === q.correct) {
      correct++;
      console.log(chalk.green('  Correct!'));
    } else {
      console.log(chalk.red(`  Wrong — correct answer: ${q.correct}`));
    }
    if (q.explanation) console.log(chalk.gray(`  → ${q.explanation}`));
    console.log();
  }

  rl.close();

  const total = quiz.questions.length;
  const percentage = Math.round((correct / total) * 10000) / 100;
  const passed = percentage / 100 >= quiz.passThreshold;
  const student = resolveStudent();

  console.log(chalk.blue('  ─── Results ───'));
  console.log(`  Score: ${correct}/${total} (${percentage}%)`);
  console.log(`  Pass threshold: ${quiz.passThreshold * 100}%`);
  console.log(passed ? chalk.green('  PASSED') : chalk.red('  FAILED'));

  // Save diploma
  const today = new Date().toISOString().slice(0, 10);
  const diplomaId = `D-${today}-${student}-${id.replace(/^Q-/, '')}`;
  const diploma: Diploma = {
    id: diplomaId,
    type: 'quiz',
    student,
    earnedAt: new Date().toISOString(),
    source: id,
    score: correct,
    total,
    percentage,
    passed,
  };

  saveDiploma(rootDir, diploma);
  console.log(chalk.gray(`\n  Diploma saved: ${diplomaId}\n`));
}
