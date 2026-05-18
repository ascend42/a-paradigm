/**
 * University add command - Create new university content.
 * v6.0: honors --pack / --project / --discipline selectors.
 */

import chalk from 'chalk';
import { saveNote, saveQuiz, rebuildUniversityIndex } from '../../core/university/index.js';
import type { UniversityFrontmatter, UniversityQuiz, Difficulty } from '../../core/university/types.js';
import { resolvePackContext, readPackSections, type SelectorOptions } from './selectors.js';
import { execSync } from 'child_process';
import * as os from 'os';

function resolveAuthor(): string {
  try {
    return execSync('git config user.name', { encoding: 'utf-8', timeout: 3000 }).trim()
      .toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 20) || 'unknown';
  } catch {
    try { return os.userInfo().username; } catch { return 'unknown'; }
  }
}

interface AddOptions extends SelectorOptions {
  title?: string;
  body?: string;
  tags?: string;
  symbols?: string;
  difficulty?: string;
  minutes?: string;
  // v6.5 sections
  section?: string;
  order?: string;
}

export async function universityAddCommand(type: string, options: AddOptions): Promise<void> {
  const rootDir = process.cwd();
  // Default to project pack when no selector set, matching spec §3.2.
  const effectiveOptions: SelectorOptions = options.pack || options.project || options.discipline
    ? options
    : { ...options, project: true };
  const ctx = resolvePackContext(rootDir, effectiveOptions);
  void ctx;  // v5.39.0: resolution surfaces in display/error paths, storage still project-scoped

  if (!options.title) {
    console.error(chalk.red('\n  Error: --title is required\n'));
    process.exit(1);
  }

  // v6.5: validate --section against pack's declared sections. The check only
  // fires when the pack has user-authored sections — packs that rely on the
  // loader's implicit-default `main` section accept any section ref (the
  // dangling-ref warning surfaces later in `paradigm university validate`).
  if (options.section) {
    const declared = readPackSections(ctx.subPackRoot ?? ctx.packRoot);
    if (declared.length > 0) {
      const known = new Set(declared.map(s => s.id));
      if (!known.has(options.section)) {
        const available = declared.map(s => s.id).join(', ');
        const packId = ctx.subPackId ?? ctx.packId;
        console.error(
          chalk.red(`\n  Error: section "${options.section}" not declared in pack "${packId}". Available: ${available}\n`),
        );
        process.exit(1);
      }
    }
  }

  const orderNum = options.order !== undefined ? parseInt(options.order, 10) : undefined;
  if (options.order !== undefined && (orderNum === undefined || Number.isNaN(orderNum))) {
    console.error(chalk.red(`\n  Error: --order must be an integer (got "${options.order}")\n`));
    process.exit(1);
  }

  const author = resolveAuthor();
  const today = new Date().toISOString().slice(0, 10);
  const slug = options.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const tags = options.tags ? options.tags.split(',').map(t => t.trim()) : [];
  const symbols = options.symbols ? options.symbols.split(',').map(s => s.trim()) : [];

  if (type === 'quiz') {
    const id = `Q-${slug}`;
    const quiz: UniversityQuiz = {
      id,
      title: options.title,
      description: options.body || '',
      author,
      created: today,
      updated: today,
      tags,
      symbols,
      difficulty: (options.difficulty as Difficulty) || 'beginner',
      passThreshold: 0.7,
      questions: [],
      ...(options.section ? { section: options.section } : {}),
      ...(orderNum !== undefined ? { order: orderNum } : {}),
    };
    saveQuiz(rootDir, quiz);
    rebuildUniversityIndex(rootDir);
    console.log(chalk.green(`\n  Created quiz: ${id}`));
    console.log(chalk.gray('  Add questions by editing the YAML file\n'));
    return;
  }

  // Note, policy, guide, runbook
  const prefix = type === 'policy' ? 'P' : 'N';
  const id = `${prefix}-${slug}`;
  const frontmatter: UniversityFrontmatter = {
    id,
    title: options.title,
    type: type as UniversityFrontmatter['type'],
    author,
    created: today,
    updated: today,
    tags,
    symbols,
    difficulty: (options.difficulty as Difficulty) || 'beginner',
    estimatedMinutes: options.minutes ? parseInt(options.minutes, 10) : undefined,
    prerequisites: [],
    ...(options.section ? { section: options.section } : {}),
    ...(orderNum !== undefined ? { order: orderNum } : {}),
  };

  saveNote(rootDir, frontmatter, options.body || '');
  rebuildUniversityIndex(rootDir);
  console.log(chalk.green(`\n  Created ${type}: ${id}`));
  console.log(chalk.gray(`  Edit at .paradigm/university/content/${type === 'policy' ? 'policies' : 'notes'}/${id}.md\n`));
}
