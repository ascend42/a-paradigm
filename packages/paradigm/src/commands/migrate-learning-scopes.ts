/**
 * paradigm migrate learning-stores --scopes — scoped learning S2
 * (TD-2026-10-28-820). A dry run by default; `--apply` writes.
 *
 * 1. Legacy repo learning logs for stores whose home is now `user`
 *    (verdicts, nominations, debates, promotion-decisions, provisional-mined,
 *    estimate-actuals) are FROZEN: they stay tracked and readable. `--apply`
 *    copies the CURRENT user's own rows (by author) into the user home and
 *    stamps those repo rows `migrated: true`, so union readers read the copy
 *    once and never the frozen row. A teammate's rows are never touched.
 * 2. Authorless legacy verdicts are consumed once, by whoever runs the
 *    migration, after a confirm prompt (`--yes` answers it; with no TTY and
 *    no --yes they are left alone). The copies carry this user's author.
 * 3. After `git init`, records a project without git wrote to the user home
 *    for repo-home stores (overrides, classroom certifications, notebook
 *    refs) are offered back to the repo (same confirm). The user copy is
 *    renamed `<file>.moved-to-repo`.
 *
 * Safe to run twice: stamped rows are skipped, copies are deduped against the
 * user file, and a moved user file no longer exists.
 *
 * Symbol: #migrate-learning-scopes
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { out, success, warn, dim, header, json as jsonOut } from '../utils/cli-output.js';
import {
  ARTIFACTS,
  currentAuthor,
  hasRepoHome,
  homeOf,
  isOwnAuthor,
  pathFor,
  readLearningHomeConfig,
  type LearningArtifact,
} from '../../../paradigm-mcp/src/utils/learning-stores.js';

/** Stores whose legacy repo log is frozen (home moved to user). */
export const FROZEN_USER_ARTIFACTS: readonly LearningArtifact[] = [
  'verdicts', 'nominations', 'debates', 'promotion-decisions', 'provisional-mined', 'estimate-actuals',
];

/** Repo-home stores a project without git wrote to the user home. */
export const REPO_HOME_ARTIFACTS: readonly LearningArtifact[] = ['overrides', 'classroom-certifications', 'notebook-refs'];

export interface MigrateScopesOptions {
  apply?: boolean;
  /** Answer the confirm prompts with yes. */
  yes?: boolean;
  json?: boolean;
  /** Prompt override (tests). Defaults to a TTY prompt; false without a TTY. */
  confirm?: (question: string) => Promise<boolean>;
}

export interface ScopeStep {
  artifact: LearningArtifact;
  kind: 'own-rows' | 'authorless-verdicts' | 'back-to-repo';
  rows: number;
  from: string;
  to: string;
  /** done | planned | declined | nothing */
  status: 'done' | 'planned' | 'declined' | 'nothing';
}

export interface MigrateScopesResult {
  dryRun: boolean;
  steps: ScopeStep[];
}

type Row = Record<string, unknown>;

function readLines(file: string): string[] {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim());
  } catch {
    return [];
  }
}

function parse(line: string): Row | null {
  try {
    const v = JSON.parse(line);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : null;
  } catch {
    return null;
  }
}

/** Identity of a row for dedupe: its content without the home / migration stamps. */
function rowKey(row: Row): string {
  const { home: _h, migrated: _m, author: _a, ...rest } = row;
  return JSON.stringify(Object.keys(rest).sort().map(k => [k, rest[k]]));
}

async function ttyConfirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>(resolve => rl.question(`${question} [y/N] `, resolve));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

export async function migrateLearningScopes(rootDir: string, opts: MigrateScopesOptions = {}): Promise<MigrateScopesResult> {
  const root = path.resolve(rootDir);
  const apply = !!opts.apply;
  const confirm = async (q: string) => (opts.yes ? true : (opts.confirm ?? ttyConfirm)(q));
  const steps: ScopeStep[] = [];
  const repoHome = hasRepoHome(root);
  const config = readLearningHomeConfig(root);

  if (repoHome) {
    for (const artifact of FROZEN_USER_ARTIFACTS) {
      if (homeOf(artifact, null, config) === 'repo') continue; // configured back to repo: nothing frozen
      const repoFile = path.join(root, '.paradigm', ...ARTIFACTS[artifact].rel);
      const lines = readLines(repoFile);
      if (lines.length === 0) continue;
      const own: number[] = [];
      const authorless: number[] = [];
      lines.forEach((line, i) => {
        const row = parse(line);
        if (!row || row.migrated === true) return;
        if (isOwnAuthor(row.author, root)) own.push(i);
        else if (artifact === 'verdicts' && row.author === undefined) authorless.push(i);
      });
      const userFile = pathFor(artifact, 'user', root);
      const consume = async (idx: number[], kind: ScopeStep['kind']) => {
        if (idx.length === 0) return;
        const step: ScopeStep = { artifact, kind, rows: idx.length, from: repoFile, to: userFile, status: 'planned' };
        steps.push(step);
        if (!apply) return;
        if (kind === 'authorless-verdicts'
          && !(await confirm(`Consume ${idx.length} authorless legacy verdict(s) as yours (copied to your user home)?`))) {
          step.status = 'declined';
          return;
        }
        const have = new Set(readLines(userFile).map(l => parse(l)).filter((r): r is Row => !!r).map(rowKey));
        const me = currentAuthor(root);
        const copies: string[] = [];
        for (const i of idx) {
          const row = parse(lines[i])!;
          if (have.has(rowKey(row))) continue;
          have.add(rowKey(row));
          const { migrated: _m, ...rest } = row;
          copies.push(JSON.stringify({ ...rest, author: row.author ?? me, home: 'user' }));
        }
        if (copies.length > 0) {
          fs.mkdirSync(path.dirname(userFile), { recursive: true });
          fs.appendFileSync(userFile, copies.join('\n') + '\n', 'utf8');
        }
        for (const i of idx) lines[i] = JSON.stringify({ ...parse(lines[i])!, migrated: true });
        fs.writeFileSync(repoFile, lines.join('\n') + '\n', 'utf8');
        step.status = 'done';
      };
      await consume(own, 'own-rows');
      await consume(authorless, 'authorless-verdicts');
    }

    // Records written to the user home while the project had no git.
    for (const artifact of REPO_HOME_ARTIFACTS) {
      if (homeOf(artifact, null, config) !== 'repo') continue;
      const userFile = pathFor(artifact, 'user', root);
      const rows = readLines(userFile).map(parse).filter((r): r is Row => !!r);
      if (rows.length === 0) continue;
      const repoFile = pathFor(artifact, 'repo', root);
      const step: ScopeStep = { artifact, kind: 'back-to-repo', rows: rows.length, from: userFile, to: repoFile, status: 'planned' };
      steps.push(step);
      if (!apply) continue;
      if (!(await confirm(`Move ${rows.length} ${artifact} record(s) written before \`git init\` back to the repo?`))) {
        step.status = 'declined';
        continue;
      }
      const have = new Set(readLines(repoFile).map(parse).filter((r): r is Row => !!r).map(rowKey));
      const moved = rows.filter(r => !have.has(rowKey(r))).map(r => JSON.stringify({ ...r, home: 'repo' }));
      if (moved.length > 0) {
        fs.mkdirSync(path.dirname(repoFile), { recursive: true });
        fs.appendFileSync(repoFile, moved.join('\n') + '\n', 'utf8');
      }
      fs.renameSync(userFile, `${userFile}.moved-to-repo`);
      step.status = 'done';
    }
  }

  return { dryRun: !apply, steps };
}

export async function migrateLearningScopesCommand(options: MigrateScopesOptions = {}): Promise<void> {
  const res = await migrateLearningScopes(process.cwd(), options);
  if (options.json) {
    jsonOut(res);
    return;
  }
  header('paradigm migrate learning-stores --scopes');
  if (res.dryRun) dim('  mode: dry run (no writes); re-run with --apply');
  if (res.steps.length === 0) {
    success('nothing to migrate: legacy repo logs are frozen and still read; new rows go to the user home');
    return;
  }
  for (const s of res.steps) {
    out(`  ${s.artifact} (${s.kind}): ${s.rows} row(s) ${s.status}`);
    dim(`    ${s.from} -> ${s.to}`);
  }
  if (res.steps.some(s => s.status === 'declined')) warn('Some steps were declined; re-run with --apply to be asked again.');
  else success(res.dryRun ? 'dry run complete' : 'migrate learning-stores --scopes complete');
}
