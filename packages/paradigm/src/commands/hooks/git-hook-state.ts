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

/** Bump together with the `paradigm-hook-version:` marker in the git hook bodies (hooks/index.ts). */
export const GIT_HOOK_VERSION = 3;

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

export function readGitHook(rootDir: string, name: GitHookName): string | null {
  try {
    return fs.readFileSync(path.join(rootDir, '.git', 'hooks', name), 'utf8');
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
