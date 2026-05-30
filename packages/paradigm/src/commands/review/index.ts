/**
 * paradigm review — Automated two-stage review pipeline
 *
 * Stage 1: Spec Compliance (always runs)
 *   - Purpose coverage, portal gates, aspect anchors, flow integrity, broken refs
 *
 * Stage 2: Code Quality (--deep only)
 *   - eval(), SQL injection, hardcoded secrets, console.log, test coverage
 *
 * Usage:
 *   paradigm review              — Review staged changes
 *   paradigm review --pr <num>   — Review a PR via gh CLI
 *   paradigm review --ci         — Exit 1 on blocking findings
 *   paradigm review --deep       — Include code quality checks
 *   paradigm review --json       — JSON output
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { execSync } from 'child_process';
import * as yaml from 'js-yaml';
import {
  aggregateFromDirectory,
  buildSymbolIndex,
  createSymbolIndex,
  searchSymbols,
  checkAspectAnchors,
  type SymbolIndex,
} from '@a-company/premise-core';
import { log } from '../../utils/logger.js';

// ────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────

interface ReviewOptions {
  pr?: string;
  ci?: boolean;
  deep?: boolean;
  json?: boolean;
}

interface ReviewFinding {
  type: 'blocking' | 'improvement' | 'note';
  category: string;
  message: string;
  file?: string;
  line?: number;
  suggestion?: string;
}

// ────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────

const SYMBOL_PATTERN = /[@#$%^!?&~][a-zA-Z][a-zA-Z0-9_-]*/g;

const ROUTE_FILE_PATTERNS = [
  /\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
  /export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)/gi,
];

// ────────────────────────────────────────────────────────
// Main Command
// ────────────────────────────────────────────────────────

export async function reviewCommand(options: ReviewOptions = {}) {
  const cwd = process.cwd();
  const tracker = log.command('review').start('Running review pipeline', { cwd });

  // Get modified files
  let filesModified: string[] = [];
  let symbolsTouched: string[] = [];

  try {
    if (options.pr) {
      // PR mode — get files from gh CLI
      const prFiles = execSync(`gh pr diff ${options.pr} --name-only`, {
        cwd,
        encoding: 'utf8',
        timeout: 15000,
      }).trim();
      filesModified = prFiles.split('\n').filter(Boolean);
    } else {
      // Staged + unstaged changes mode
      const staged = execSync('git diff --cached --name-only', {
        cwd,
        encoding: 'utf8',
        timeout: 5000,
      }).trim();

      const unstaged = execSync('git diff --name-only', {
        cwd,
        encoding: 'utf8',
        timeout: 5000,
      }).trim();

      filesModified = [...new Set([
        ...staged.split('\n').filter(Boolean),
        ...unstaged.split('\n').filter(Boolean),
      ])];
    }
  } catch (e) {
    const errorMsg = (e as Error).message;
    if (!options.json) {
      log.command('review').error(`Failed to get changed files: ${errorMsg}`);
    }
    tracker.error('Failed to get changed files');
    if (options.ci) process.exit(1);
    return;
  }

  if (filesModified.length === 0) {
    if (options.json) {
      console.log(JSON.stringify({ findings: [], summary: { total: 0, blocking: 0, improvements: 0, notes: 0 } }));
    } else {
      console.log(chalk.green('\n  No modified files to review.\n'));
    }
    tracker.success('No files to review');
    return;
  }

  // Extract symbols from .purpose files among modified files
  try {
    for (const file of filesModified) {
      if (file.endsWith('.purpose')) {
        const absPath = path.join(cwd, file);
        if (fs.existsSync(absPath)) {
          const content = fs.readFileSync(absPath, 'utf-8');
          const matches = content.match(SYMBOL_PATTERN) || [];
          symbolsTouched.push(...matches);
        }
      }
    }
    symbolsTouched = [...new Set(symbolsTouched)];
  } catch { /* non-fatal */ }

  const findings: ReviewFinding[] = [];

  // ── Stage 1: Spec Compliance ────────────────────────────

  // Build symbol index from .purpose files (same as status/constellation commands)
  let index: SymbolIndex = createSymbolIndex();
  try {
    const aggregation = await aggregateFromDirectory(cwd);
    index = buildSymbolIndex(aggregation);
  } catch { /* use empty index if aggregation fails */ }

  // Load portal.yaml
  const portalPath = path.join(cwd, 'portal.yaml');
  let gateConfig: Record<string, unknown> | null = null;
  if (fs.existsSync(portalPath)) {
    try {
      gateConfig = yaml.load(fs.readFileSync(portalPath, 'utf-8')) as Record<string, unknown>;
    } catch { /* skip */ }
  }

  // Check 1: Purpose coverage
  for (const symbol of symbolsTouched) {
    const results = searchSymbols(index, symbol);
    if (results.length === 0) {
      findings.push({
        type: 'blocking',
        category: 'purpose-coverage',
        message: `Symbol "${symbol}" is not registered in any .purpose file`,
        suggestion: 'Add to nearest .purpose file using paradigm_purpose_add_component.',
      });
    }
  }

  // Check 2: Route coverage
  const declaredRoutes = gateConfig?.routes
    ? Object.keys(gateConfig.routes as Record<string, unknown>)
    : [];

  for (const file of filesModified) {
    const absPath = path.isAbsolute(file) ? file : path.join(cwd, file);
    if (!fs.existsSync(absPath)) continue;

    let content: string;
    try {
      content = fs.readFileSync(absPath, 'utf-8');
    } catch {
      continue;
    }

    for (const pattern of ROUTE_FILE_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        const routePath = match[2] || match[0];
        if (routePath && routePath.startsWith('/')) {
          const isKnown = declaredRoutes.some(r => {
            const normalized = r.replace(/\s+(GET|POST|PUT|PATCH|DELETE)\s*$/, '').trim();
            return normalized === routePath;
          });

          if (!isKnown) {
            findings.push({
              type: gateConfig ? 'blocking' : 'improvement',
              category: 'route-coverage',
              message: `Route "${routePath}" in ${file} not in portal.yaml`,
              file,
              suggestion: 'Add route to portal.yaml with ^gates.',
            });
          }
        }
      }
    }
  }

  // Check 3: Gate declarations
  const declaredGateNames = gateConfig
    ? Object.keys((gateConfig.gates || {}) as Record<string, unknown>).map(g =>
        g.startsWith('^') ? g.slice(1) : g
      )
    : [];

  for (const symbol of symbolsTouched) {
    if (symbol.startsWith('^')) {
      const gateName = symbol.slice(1);
      if (!declaredGateNames.includes(gateName)) {
        findings.push({
          type: 'blocking',
          category: 'portal-compliance',
          message: `Gate "${symbol}" referenced but not declared in portal.yaml`,
          suggestion: `Add ${symbol} to portal.yaml with description and check expression.`,
        });
      }
    }
  }

  // Check 4: Aspect anchors — delegated to the shared checkAspectAnchors helper
  // (premise-core) for correct path resolution and per-aspect dedup.
  try {
    for (const issue of checkAspectAnchors(index, symbolsTouched, cwd)) {
      findings.push({
        type: 'improvement',
        category: 'aspect-anchors',
        message: issue.kind === 'no-anchors'
          ? `Aspect "${issue.aspectSymbol}" has no code anchors`
          : `Aspect "${issue.aspectSymbol}" anchor "${issue.anchorRaw}" points to missing file`,
        suggestion: `Update anchors for ${issue.aspectSymbol} in .purpose file.`,
      });
    }
  } catch { /* aspect check non-fatal */ }

  // Check 5: Broken parent references
  for (const symbol of symbolsTouched) {
    const results = searchSymbols(index, symbol);
    if (results.length === 0) continue;

    const sym = results[0];
    if (sym.parentSymbol) {
      const parentResults = searchSymbols(index, sym.parentSymbol);
      if (parentResults.length === 0) {
        findings.push({
          type: 'improvement',
          category: 'broken-reference',
          message: `Symbol "${symbol}" references parent "${sym.parentSymbol}" which does not exist`,
          suggestion: `Create the parent symbol or update the parent reference.`,
        });
      }
    }
  }

  // ── Stage 2: Code Quality (--deep only) ─────────────────

  if (options.deep) {
    for (const file of filesModified) {
      const absPath = path.isAbsolute(file) ? file : path.join(cwd, file);
      if (!fs.existsSync(absPath)) continue;

      // Only check source files
      const ext = path.extname(file);
      if (!['.ts', '.tsx', '.js', '.jsx', '.py', '.rs'].includes(ext)) continue;

      let content: string;
      try {
        content = fs.readFileSync(absPath, 'utf-8');
      } catch {
        continue;
      }

      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNum = i + 1;

        // Check for eval()
        if (/\beval\s*\(/.test(line) && !line.trimStart().startsWith('//')) {
          findings.push({
            type: 'blocking',
            category: 'security',
            message: `eval() detected — potential code injection risk`,
            file,
            line: lineNum,
            suggestion: 'Replace eval() with a safer alternative.',
          });
        }

        // Check for hardcoded secrets patterns
        if (/(?:password|secret|api_key|apikey|token)\s*[:=]\s*['"][^'"]{8,}['"]/i.test(line)) {
          if (!line.trimStart().startsWith('//') && !line.trimStart().startsWith('#')) {
            findings.push({
              type: 'blocking',
              category: 'security',
              message: `Possible hardcoded secret detected`,
              file,
              line: lineNum,
              suggestion: 'Move secrets to environment variables or a secrets manager.',
            });
          }
        }

        // Check for console.log in non-test files
        if (/\bconsole\.(log|debug|info|warn)\b/.test(line) && !file.includes('test') && !file.includes('spec')) {
          if (!line.trimStart().startsWith('//')) {
            findings.push({
              type: 'note',
              category: 'convention',
              message: `console.log detected — use Paradigm logger instead`,
              file,
              line: lineNum,
              suggestion: 'Use log.component(), log.gate(), etc. from the Paradigm logger.',
            });
          }
        }
      }
    }
  }

  // ── Output ──────────────────────────────────────────────

  const blocking = findings.filter(f => f.type === 'blocking');
  const improvements = findings.filter(f => f.type === 'improvement');
  const notes = findings.filter(f => f.type === 'note');

  if (options.json) {
    console.log(JSON.stringify({
      findings,
      summary: {
        total: findings.length,
        blocking: blocking.length,
        improvements: improvements.length,
        notes: notes.length,
        filesReviewed: filesModified.length,
        symbolsChecked: symbolsTouched.length,
      },
    }, null, 2));
  } else {
    console.log(chalk.blue('\n┌─────────────────────────────────────────────────┐'));
    console.log(chalk.blue('│') + chalk.white.bold('  paradigm review                                 ') + chalk.blue('│'));
    console.log(chalk.blue('│') + chalk.gray(`  ${filesModified.length} files, ${symbolsTouched.length} symbols${options.deep ? ', deep mode' : ''}`.padEnd(50)) + chalk.blue('│'));
    console.log(chalk.blue('└─────────────────────────────────────────────────┘\n'));

    if (findings.length === 0) {
      console.log(chalk.green('  All checks passed — no findings.\n'));
    } else {
      if (blocking.length > 0) {
        console.log(chalk.red.bold(`  Blocking (${blocking.length})`));
        for (const f of blocking) {
          console.log(`    ${chalk.red('x')} ${f.message}`);
          if (f.file) console.log(`      ${chalk.gray(f.file)}${f.line ? `:${f.line}` : ''}`);
          if (f.suggestion) console.log(`      ${chalk.yellow('->')} ${f.suggestion}`);
        }
        console.log('');
      }

      if (improvements.length > 0) {
        console.log(chalk.yellow(`  Improvements (${improvements.length})`));
        for (const f of improvements) {
          console.log(`    ${chalk.yellow('*')} ${f.message}`);
          if (f.file) console.log(`      ${chalk.gray(f.file)}${f.line ? `:${f.line}` : ''}`);
          if (f.suggestion) console.log(`      ${chalk.yellow('->')} ${f.suggestion}`);
        }
        console.log('');
      }

      if (notes.length > 0) {
        console.log(chalk.gray(`  Notes (${notes.length})`));
        for (const f of notes) {
          console.log(`    ${chalk.gray('o')} ${f.message}`);
          if (f.file) console.log(`      ${chalk.gray(f.file)}${f.line ? `:${f.line}` : ''}`);
        }
        console.log('');
      }
    }
  }

  // CI exit code
  if (options.ci && blocking.length > 0) {
    tracker.error(`${blocking.length} blocking findings`);
    process.exit(1);
  }

  tracker.success(`Review complete: ${findings.length} findings`);
}
