/**
 * Which state an installed git hook (.git/hooks/post-commit, pre-push) is in,
 * relative to the version `paradigm hooks install` writes today.
 *
 * Shared by `paradigm hooks install` (upgrades an outdated Paradigm-owned hook
 * without --force), `paradigm hooks status` and `paradigm doctor` (reports it).
 * Kept free of chalk / generated-hooks so doctor can load it cheaply.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

/** Bump together with the `paradigm-hook-version:` marker in the git hook bodies (hooks/index.ts). */
export const GIT_HOOK_VERSION = 4;

/**
 * The post-commit version that stopped writing history (T-2026-11-06-001).
 * Below it the hook appends to the tracked .paradigm/history/log.jsonl, so
 * the tree is dirty after every commit.
 */
export const HISTORY_FREE_POST_COMMIT_VERSION = 4;

/**
 * Blocks other tools manage inside a hook file, delimited by
 * `# >>> <name> >>>` … `# <<< <name> <<<` (Warpline's auto-seal block is one).
 * Returned verbatim, marker lines included, in file order.
 */
export function foreignManagedBlocks(content: string): string[] {
  const blocks: string[] = [];
  const re = /^# >>> (.+?) >>>[^\n]*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const endMarker = `# <<< ${m[1]} <<<`;
    const end = content.indexOf(endMarker, m.index);
    if (end === -1) continue; // malformed: leave it for the human (kept in the .bak)
    blocks.push(content.slice(m.index, end + endMarker.length));
    re.lastIndex = end + endMarker.length;
  }
  return blocks;
}

export type GitHookName = 'post-commit' | 'pre-push' | 'pre-commit';
export const GIT_HOOK_NAMES: GitHookName[] = ['post-commit', 'pre-push', 'pre-commit'];

/**
 * absent   — no hook file
 * foreign  — not written by Paradigm (missing its header); never touched
 * outdated — Paradigm's, but below GIT_HOOK_VERSION or still calling `npx paradigm`
 * current  — Paradigm's, up to date
 */
export type GitHookState = 'absent' | 'foreign' | 'outdated' | 'current';

/** The version a Paradigm hook declares (hooks from before the marker are version 1). */
export function gitHookVersion(content: string): number {
  const m = content.match(/paradigm-hook-version:\s*(\d+)/);
  return m ? Number(m[1]) : 1;
}

export function gitHookState(content: string | null, name: GitHookName): GitHookState {
  if (content === null) return 'absent';
  const owned = content.includes(`# Paradigm ${name} hook`) && content.includes('# Installed by: paradigm hooks install');
  if (!owned) return 'foreign';
  if (gitHookVersion(content) < GIT_HOOK_VERSION || /\bnpx\s+paradigm\b/.test(content)) return 'outdated';
  return 'current';
}

/**
 * The hooks directory git actually runs hooks from: `git rev-parse --git-path
 * hooks` (honours core.hooksPath, and in a linked worktree, where .git is a
 * file, names the common dir's hooks). Falls back to <root>/.git/hooks when
 * git cannot answer but <root>/.git is a folder; null outside git.
 */
export function gitHooksDir(rootDir: string): string | null {
  try {
    const env = { ...process.env };
    delete env.GIT_DIR;
    delete env.GIT_WORK_TREE;
    delete env.GIT_INDEX_FILE;
    const out = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], {
      cwd: rootDir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: false, timeout: 5000,
    }).trim();
    if (out) return path.resolve(rootDir, out);
  } catch { /* not a work tree git understands */ }
  try {
    if (fs.statSync(path.join(rootDir, '.git')).isDirectory()) return path.join(rootDir, '.git', 'hooks');
  } catch { /* no .git */ }
  return null;
}

function revParse(rootDir: string, args: string[]): string | null {
  try {
    const env = { ...process.env };
    delete env.GIT_DIR;
    delete env.GIT_WORK_TREE;
    delete env.GIT_INDEX_FILE;
    const out = execFileSync('git', ['rev-parse', ...args], {
      cwd: rootDir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: false, timeout: 5000,
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

const isUnder = (p: string, dir: string): boolean => {
  const rel = path.relative(dir, p);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/**
 * Where `paradigm hooks install` keeps backups of hooks it replaces: inside
 * the git dir (`git rev-parse --git-path paradigm-hook-backups`), never the
 * work tree. Falls back to the hooks dir when git cannot answer (then it is
 * <root>/.git/hooks, also inside the git dir).
 */
export function gitHookBackupDir(rootDir: string, hooksDir: string): string {
  const out = revParse(rootDir, ['--git-path', 'paradigm-hook-backups']);
  return out ? path.resolve(rootDir, out) : hooksDir;
}

/**
 * True when `hooksDir` lies in the work tree and outside the git dir, as with
 * core.hooksPath=.githooks or .husky/: those files are committed and shared,
 * so writing there needs --force.
 */
export function hooksDirInWorkTree(rootDir: string, hooksDir: string): boolean {
  const top = revParse(rootDir, ['--show-toplevel']);
  if (!top) return false;
  const gitDirs = [revParse(rootDir, ['--absolute-git-dir']), revParse(rootDir, ['--git-common-dir'])]
    .filter((d): d is string => !!d)
    .map((d) => path.resolve(rootDir, d));
  const real = (p: string) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  const h = real(hooksDir);
  if (gitDirs.some((d) => isUnder(h, real(d)))) return false;
  return isUnder(h, real(top));
}

export function readGitHook(rootDir: string, name: GitHookName): string | null {
  const dir = gitHooksDir(rootDir);
  if (!dir) return null;
  try {
    return fs.readFileSync(path.join(dir, name), 'utf8');
  } catch {
    return null;
  }
}

export interface GitHookFinding {
  name: GitHookName;
  version: number;
  npx: boolean;
}

/** Paradigm-owned git hooks in `rootDir` that `paradigm hooks install` would upgrade. */
export function outdatedGitHooks(rootDir: string): GitHookFinding[] {
  const found: GitHookFinding[] = [];
  for (const name of GIT_HOOK_NAMES) {
    const content = readGitHook(rootDir, name);
    if (content !== null && gitHookState(content, name) === 'outdated') {
      found.push({ name, version: gitHookVersion(content), npx: /\bnpx\s+paradigm\b/.test(content) });
    }
  }
  return found;
}
