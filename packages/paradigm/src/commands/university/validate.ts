/**
 * University validate command - Validate content integrity.
 * v6.0: honors selectors; reports the validated pack.
 */

import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { loadUniversityIndex, loadQuiz, loadPath } from '../../core/university/index.js';
import { resolvePackContext, type SelectorOptions } from './selectors.js';

interface ValidateOptions extends SelectorOptions {
  deep?: boolean;
  id?: string;
  json?: boolean;
}

interface Issue {
  contentId: string;
  severity: 'error' | 'warning';
  check: string;
  message: string;
  fix?: string;
}

export async function universityValidateCommand(options: ValidateOptions): Promise<void> {
  const rootDir = process.cwd();
  const ctx = resolvePackContext(rootDir, options);
  const index = loadUniversityIndex(rootDir);

  if (!index || index.totalContent === 0) {
    console.log(chalk.yellow('\n  No university content to validate.\n'));
    return;
  }

  const issues: Issue[] = [];
  let entriesToCheck = index.entries;

  if (options.id) {
    entriesToCheck = entriesToCheck.filter(e => e.id === options.id);
    if (entriesToCheck.length === 0) {
      console.error(chalk.red(`\n  Content "${options.id}" not found\n`));
      process.exit(1);
    }
  }

  // Load known symbols for deep checks
  let knownSymbols: Set<string> | null = null;
  if (options.deep) {
    knownSymbols = new Set<string>();
    const scanIndexPath = path.join(rootDir, '.paradigm', 'scan-index.json');
    if (fs.existsSync(scanIndexPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(scanIndexPath, 'utf8'));
        if (raw.symbols && Array.isArray(raw.symbols)) {
          for (const sym of raw.symbols) {
            if (sym.symbol) knownSymbols.add(sym.symbol);
          }
        }
      } catch { /* skip */ }
    }
  }

  const allContentIds = new Set(index.entries.map(e => e.id));

  for (const entry of entriesToCheck) {
    // Schema checks
    if (!entry.title) {
      issues.push({ contentId: entry.id, severity: 'error', check: 'missing-title', message: 'Content is missing a title' });
    }

    // Quiz validation
    if (entry.type === 'quiz') {
      const quiz = loadQuiz(rootDir, entry.id);
      if (!quiz) {
        issues.push({ contentId: entry.id, severity: 'error', check: 'unreadable-quiz', message: 'Quiz file could not be parsed' });
      } else {
        for (const q of quiz.questions) {
          if (!q.choices || !(q.correct in q.choices)) {
            issues.push({
              contentId: entry.id,
              severity: 'error',
              check: 'invalid-quiz-answer',
              message: `Question ${q.id}: correct "${q.correct}" not in choices [${Object.keys(q.choices || {}).join(', ')}]`,
              fix: `Set correct to one of: ${Object.keys(q.choices || {}).join(', ')}`,
            });
          }
        }
      }
    }

    // Path validation
    if (entry.type === 'path') {
      const lp = loadPath(rootDir, entry.id);
      if (!lp) {
        issues.push({ contentId: entry.id, severity: 'error', check: 'unreadable-path', message: 'Learning path file could not be parsed' });
      } else {
        for (const step of lp.steps) {
          if (!step.content.startsWith('plsat:') && !allContentIds.has(step.content)) {
            issues.push({
              contentId: entry.id,
              severity: 'error',
              check: 'broken-path-step',
              message: `Step references "${step.content}" which doesn't exist`,
              fix: `Create content with id "${step.content}"`,
            });
          }
        }
      }
    }

    // Deep: symbol references
    if (knownSymbols && entry.symbols.length > 0) {
      for (const sym of entry.symbols) {
        if (!knownSymbols.has(sym)) {
          issues.push({
            contentId: entry.id,
            severity: 'warning',
            check: 'broken-symbol-ref',
            message: `Symbol "${sym}" not found in scan-index`,
          });
        }
      }
    }
  }

  if (options.json) {
    console.log(JSON.stringify({
      status: issues.some(i => i.severity === 'error') ? 'errors' : issues.length > 0 ? 'warnings' : 'healthy',
      totalContent: index.totalContent,
      checked: entriesToCheck.length,
      issues,
    }, null, 2));
    return;
  }

  // Display results
  console.log(chalk.blue(`\n  University Validation — pack: ${ctx.subPackId ?? ctx.packId} (${entriesToCheck.length} items${options.deep ? ', deep mode' : ''})\n`));

  if (issues.length === 0) {
    console.log(chalk.green('  All checks passed.\n'));
    return;
  }

  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');

  for (const issue of errors) {
    console.log(chalk.red(`  x ${issue.contentId}: ${issue.message}`));
    if (issue.fix) console.log(chalk.gray(`    Fix: ${issue.fix}`));
  }

  for (const issue of warnings) {
    console.log(chalk.yellow(`  ! ${issue.contentId}: ${issue.message}`));
    if (issue.fix) console.log(chalk.gray(`    Fix: ${issue.fix}`));
  }

  console.log();
  if (errors.length > 0) console.log(chalk.red(`  ${errors.length} error${errors.length > 1 ? 's' : ''}`));
  if (warnings.length > 0) console.log(chalk.yellow(`  ${warnings.length} warning${warnings.length > 1 ? 's' : ''}`));
  console.log();
}
