/**
 * @symbol #doctor
 *
 * History storage audit (T-2026-11-06-001). Commit history is derived from
 * git on read; a repository that has not migrated still has the symptoms the
 * change removed:
 *   - a post-commit hook below v4 appends to the tracked log.jsonl, so the
 *     tree is dirty after every commit;
 *   - a tracked .paradigm/history/index.yaml (it is generated and ignored now);
 *   - no `merge=union` attribute on log.jsonl (authored rows from two branches conflict);
 *   - legacy ids the old `wc -l + 1` rule minted twice (they resolve as `<id>@<sha7>`).
 * The fix for the first three is `paradigm sync && paradigm hooks install`.
 * Never throws; git runs through execFileSync with no shell.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { gitHookState, gitHookVersion, HISTORY_FREE_POST_COMMIT_VERSION } from '../hooks/git-hook-state.js';
import { hasHistoryGitattributes } from '../../core/session-markers-gitignore.js';

export interface HistoryAuditCheck {
  name: string;
  status: 'ok' | 'warn' | 'info';
  message: string;
  fix?: string;
}

export const HISTORY_MIGRATION_FIX = 'paradigm sync && paradigm hooks install (then commit the index.yaml removal and .gitattributes)';

function git(rootDir: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['--no-optional-locks', ...args], { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: false, timeout: 5000 });
  } catch {
    return null;
  }
}

/** The repository's hooks directory (worktree-aware: `git rev-parse --git-path hooks`). */
function hooksDir(rootDir: string): string | null {
  const out = git(rootDir, ['rev-parse', '--git-path', 'hooks']);
  if (!out) return null;
  const p = out.trim();
  return path.isAbsolute(p) ? p : path.join(rootDir, p);
}

/** Legacy log.jsonl ids that occur more than once. */
export function duplicateLegacyIds(rootDir: string): string[] {
  let text: string;
  try {
    text = fs.readFileSync(path.join(rootDir, '.paradigm', 'history', 'log.jsonl'), 'utf8');
  } catch {
    return [];
  }
  const counts = new Map<string, number>();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as { id?: unknown; source?: unknown };
      if (typeof row.id === 'string' && row.source !== 'authored') counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
    } catch { /* malformed line: not an id */ }
  }
  return [...counts].filter(([, n]) => n > 1).map(([id]) => id).sort();
}

export function historyAuditChecks(rootDir: string): HistoryAuditCheck[] {
  if (!fs.existsSync(path.join(rootDir, '.paradigm'))) return [];
  if (git(rootDir, ['rev-parse', '--is-inside-work-tree'])?.trim() !== 'true') return [];
  const checks: HistoryAuditCheck[] = [];

  const dir = hooksDir(rootDir);
  let postCommit: string | null = null;
  try {
    if (dir) postCommit = fs.readFileSync(path.join(dir, 'post-commit'), 'utf8');
  } catch { /* none */ }
  if (postCommit !== null && gitHookState(postCommit, 'post-commit') !== 'foreign' && gitHookVersion(postCommit) < HISTORY_FREE_POST_COMMIT_VERSION) {
    checks.push({
      name: 'History hook',
      status: 'warn',
      message: `post-commit is v${gitHookVersion(postCommit)}: it writes tracked history, so the tree is dirty after every commit`,
      fix: HISTORY_MIGRATION_FIX,
    });
  }

  if ((git(rootDir, ['ls-files', '--', '.paradigm/history/index.yaml']) ?? '').trim()) {
    checks.push({
      name: 'History index',
      status: 'warn',
      message: '.paradigm/history/index.yaml is still tracked (it is generated from git and log.jsonl now)',
      fix: HISTORY_MIGRATION_FIX,
    });
  }

  if (fs.existsSync(path.join(rootDir, '.paradigm', 'history', 'log.jsonl')) && !hasHistoryGitattributes(rootDir)) {
    checks.push({
      name: 'History merge',
      status: 'warn',
      message: '.gitattributes has no `.paradigm/history/log.jsonl merge=union`: authored rows from two branches will conflict',
      fix: 'paradigm sync',
    });
  }

  const dups = duplicateLegacyIds(rootDir);
  if (dups.length > 0) {
    checks.push({
      name: 'History ids',
      status: 'info',
      message: `${dups.length} legacy history id(s) occur more than once (${dups.slice(0, 3).join(', ')}${dups.length > 3 ? ', ...' : ''}); each resolves as <id>@<sha7>`,
    });
  }

  if (checks.length === 0) {
    checks.push({ name: 'History', status: 'ok', message: 'derived from git; index generated and ignored' });
  }
  return checks;
}
