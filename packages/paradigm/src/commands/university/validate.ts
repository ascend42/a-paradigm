/**
 * University validate command - Validate content integrity.
 * v6.0: honors selectors; reports the validated pack.
 * v6.5: section-aware validation — duplicate id, two defaults, unknown ref,
 *       invalid style, dangling section warning, non-kebab id.
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

// ── v6.5: section validation helpers ───────────────────────

const SECTION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VALID_SECTION_STYLES = new Set(['track', 'index', 'chronological', 'featured']);

interface RawSection {
  id?: unknown;
  name?: unknown;
  order?: unknown;
  style?: unknown;
  description?: unknown;
  default?: unknown;
}

/**
 * Read a pack's `sections:` block as raw YAML (no Zod). The CLI is intentionally
 * loader-independent (matches selectors.ts pattern). Returns null when the
 * manifest can't be read; that's not an error — bare project packs without a
 * manifest fall through to the implicit-default contract.
 */
function readPackSections(packRoot: string): RawSection[] | null {
  const manifestPath = path.join(packRoot, 'pack.yaml');
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const data = yaml.load(raw) as { sections?: RawSection[] } | null;
    return Array.isArray(data?.sections) ? data!.sections : null;
  } catch {
    return null;
  }
}

/**
 * Validate the section block itself + cross-reference entry section refs.
 * Pushes onto the shared `issues` array; never throws. All issues are scoped
 * to the contentId 'pack.yaml' (the pack manifest is the offending content).
 */
function validateSectionBlock(
  rawSections: RawSection[] | null,
  entrySectionRefs: Set<string>,
  issues: Issue[],
): { knownIds: Set<string>; hadValidationError: boolean } {
  const knownIds = new Set<string>();
  let hadValidationError = false;

  // Missing or empty → implicit default {id:'main'}. The synthesizer in
  // paradigm-mcp produces 'main'; we mirror that here so unknown-ref checks
  // line up for packs that don't declare sections explicitly.
  if (!rawSections || rawSections.length === 0) {
    knownIds.add('main');
    return { knownIds, hadValidationError };
  }

  const seenIds = new Set<string>();
  let defaultCount = 0;

  for (let i = 0; i < rawSections.length; i++) {
    const s = rawSections[i];
    const path = `sections[${i}]`;

    // id: required, kebab-case
    if (typeof s.id !== 'string' || !SECTION_ID_PATTERN.test(s.id)) {
      issues.push({
        contentId: 'pack.yaml',
        severity: 'error',
        check: 'section-bad-id',
        message: `${path}.id must be kebab-case matching /^[a-z0-9][a-z0-9-]{0,63}$/`,
        fix: 'Use lowercase letters, digits, and hyphens; start with a letter or digit',
      });
      hadValidationError = true;
      continue;
    }
    if (seenIds.has(s.id)) {
      issues.push({
        contentId: 'pack.yaml',
        severity: 'error',
        check: 'section-duplicate-id',
        message: `duplicate section id "${s.id}"`,
        fix: 'Each section id must be unique within the pack',
      });
      hadValidationError = true;
      continue;
    }
    seenIds.add(s.id);
    knownIds.add(s.id);

    // style: required, must be one of the four enum values
    if (typeof s.style !== 'string' || !VALID_SECTION_STYLES.has(s.style)) {
      issues.push({
        contentId: 'pack.yaml',
        severity: 'error',
        check: 'section-bad-style',
        message: `${path}.style must be one of: ${Array.from(VALID_SECTION_STYLES).join(', ')}`,
      });
      hadValidationError = true;
    }

    // default: counted across the array
    if (s.default === true) defaultCount++;
  }

  // Two defaults — error. (Single-section auto-promotion happens in the loader;
  // the CLI validator mirrors the loader's "at most one default" rule for
  // multi-section packs.)
  if (defaultCount > 1) {
    issues.push({
      contentId: 'pack.yaml',
      severity: 'error',
      check: 'section-multiple-defaults',
      message: `at most one section may set default: true (found ${defaultCount})`,
      fix: 'Set default: true on exactly one section',
    });
    hadValidationError = true;
  }

  // Dangling section refs — entries that reference a section id the pack
  // doesn't declare. Warning (not error) so authoring iterations don't break
  // the build; the entries quietly fall through to default at render time.
  for (const ref of entrySectionRefs) {
    if (!knownIds.has(ref)) {
      issues.push({
        contentId: 'pack.yaml',
        severity: 'warning',
        check: 'section-unknown-ref',
        message: `entries reference unknown section "${ref}"`,
        fix: `Declare section "${ref}" in pack.yaml, or remove the section: field from those entries`,
      });
    }
  }

  return { knownIds, hadValidationError };
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

  // v6.5: section validation — runs once per command (not per entry). Reads
  // the resolved pack's manifest sections, cross-references all entry section
  // refs in the index, and pushes findings into the shared `issues` array.
  const packRootForSections = ctx.subPackRoot ?? ctx.packRoot;
  const rawSections = readPackSections(packRootForSections);
  const entrySectionRefs = new Set<string>();
  for (const e of index.entries) {
    if (e.section && typeof e.section === 'string' && e.section.length > 0) {
      entrySectionRefs.add(e.section);
    }
  }
  validateSectionBlock(rawSections, entrySectionRefs, issues);

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
