/**
 * #safe-git — git calls that never go through a shell.
 *
 * Anchor paths come from `.purpose` files and commit ids come from the aspect
 * graph, so both are repo content. Building a shell string from them lets a
 * file named `a$(cmd).ts` run `cmd`. Everything here uses execFileSync with an
 * argv array (no shell), puts `--` before paths, and refuses any commit id
 * that is not a plain hex object name.
 */

import { execFileSync } from 'child_process';
import { log } from './mcp-logger.js';

/** A full or abbreviated git object name: 7 to 64 lowercase hex characters. */
export const COMMIT_SHA_RE = /^[0-9a-f]{7,64}$/;

export function isCommitSha(ref: unknown): ref is string {
  return typeof ref === 'string' && COMMIT_SHA_RE.test(ref);
}

/** Run git with an argv array and no shell. Throws on a non-zero exit. */
export function runGit(rootDir: string, args: readonly string[], timeout = 5000): string {
  return execFileSync('git', [...args], {
    cwd: rootDir,
    encoding: 'utf8',
    timeout,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  });
}

/**
 * `git diff <fromCommit>..HEAD --unified=0 -- <filePath>`, with external diff
 * drivers and textconv off. Returns null when the commit id is refused or git
 * fails (not a repo, file not tracked, unknown commit).
 */
export function gitDiffSinceCommit(rootDir: string, fromCommit: string, filePath: string): string | null {
  if (!isCommitSha(fromCommit)) {
    log.component('#safe-git').warn('Refused a non-hex commit id for git diff', { fromCommit: String(fromCommit).slice(0, 80) });
    return null;
  }
  try {
    return runGit(rootDir, ['diff', '--no-ext-diff', '--no-textconv', `${fromCommit}..HEAD`, '--unified=0', '--', filePath]);
  } catch {
    return null;
  }
}

/**
 * `git log --follow --diff-filter=R --name-status --format= -- <filePath>`.
 * Returns the raw output, or null when git fails.
 */
export function gitRenameLog(rootDir: string, filePath: string): string | null {
  try {
    return runGit(rootDir, ['log', '--no-ext-diff', '--no-textconv', '--follow', '--diff-filter=R', '--name-status', '--format=', '--', filePath]);
  } catch {
    return null;
  }
}
