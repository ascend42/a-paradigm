/**
 * #git-exec — thin, READ-ONLY wrappers over git.
 *
 * The Loom Engine NEVER mutates the user's HEAD, index, or worktree. Every
 * mutation in this file happens inside a throwaway, detached `git worktree`
 * created in the OS temp dir and torn down in a `finally`. The user's primary
 * worktree is never touched.
 *
 * Library code: no console output. Callers handle their own logging.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

const execFileAsync = promisify(execFile);

const MAX_BUFFER = 64 * 1024 * 1024; // 64MB — symbol-heavy repos can be chatty.

export interface GitOptions {
  /** Repo root the git command runs in (defaults to process.cwd()). */
  cwd?: string;
}

/**
 * Run a git command read-only and return trimmed stdout.
 * Throws a descriptive error on non-zero exit.
 */
async function git(args: string[], opts: GitOptions = {}): Promise<string> {
  const cwd = opts.cwd ?? process.cwd();
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      maxBuffer: MAX_BUFFER,
      encoding: 'utf8',
    });
    return stdout.trim();
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    const detail = (e.stderr || e.message || '').trim();
    throw new Error(`git ${args.join(' ')} failed: ${detail}`);
  }
}

/** The repository root for the given cwd (top-level worktree path). */
export async function repoRoot(opts: GitOptions = {}): Promise<string> {
  return git(['rev-parse', '--show-toplevel'], opts);
}

/** Resolve a ref to its full commit SHA. */
export async function revParse(ref: string, opts: GitOptions = {}): Promise<string> {
  return git(['rev-parse', '--verify', ref], opts);
}

/** Resolve a ref to its TREE SHA — provenance for a WarpState. */
export async function revParseTree(ref: string, opts: GitOptions = {}): Promise<string> {
  return git(['rev-parse', '--verify', `${ref}^{tree}`], opts);
}

/** The merge-base (common ancestor) of two refs. */
export async function mergeBase(a: string, b: string, opts: GitOptions = {}): Promise<string> {
  return git(['merge-base', a, b], opts);
}

/** The commit subject line of a ref's tip. */
export async function commitSubject(ref: string, opts: GitOptions = {}): Promise<string> {
  return git(['log', '-1', '--format=%s', ref], opts);
}

/** The author (name <email>) of a ref's tip commit. */
export async function commitAuthor(ref: string, opts: GitOptions = {}): Promise<string> {
  return git(['log', '-1', '--format=%an <%ae>', ref], opts);
}

/**
 * Add a DETACHED, quiet worktree for `ref` in a fresh temp dir and return its
 * path. The caller MUST pass the returned path to `worktreeRemove` (ideally in
 * a `finally`). Never points at the user's worktree.
 */
export async function worktreeAdd(ref: string, opts: GitOptions = {}): Promise<string> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'loom-wt-'));
  // `git worktree add` wants the leaf dir to NOT exist yet.
  const tmp = path.join(base, 'tree');
  await git(['worktree', 'add', '--detach', '--quiet', tmp, ref], opts);
  return tmp;
}

/**
 * Remove a worktree created by `worktreeAdd` and clean up its temp parent.
 * Best-effort: never throws (teardown must not mask the original error).
 */
export async function worktreeRemove(tmp: string, opts: GitOptions = {}): Promise<void> {
  try {
    await git(['worktree', 'remove', '--force', tmp], opts);
  } catch {
    /* best-effort */
  }
  try {
    await git(['worktree', 'prune'], opts);
  } catch {
    /* best-effort */
  }
  try {
    // tmp is <mkdtemp>/tree — remove the mkdtemp parent too.
    await fs.rm(path.dirname(tmp), { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

export interface MergeTreeResult {
  /** true when the two-way merge of a..b has textual conflicts. */
  conflicted: boolean;
  /** repo-relative paths that conflicted. */
  conflictPaths: string[];
}

/**
 * Compute git's ACTUAL merge of two refs, READ-ONLY.
 *
 * Primary path (git ≥2.38): `git merge-tree --write-tree <a> <b>`. Exit code 1
 * ⇒ conflicts; the "Conflicting files" section lists the paths.
 *
 * Fallback (older git): a throwaway worktree on `a` + `git merge --no-commit
 * --no-ff b`, parse `git diff --name-only --diff-filter=U`, then `git merge
 * --abort` and tear the worktree down. Either way the user's worktree is
 * untouched.
 */
export async function mergeTree(
  a: string,
  b: string,
  opts: GitOptions = {},
): Promise<MergeTreeResult> {
  const cwd = opts.cwd ?? process.cwd();

  // ── Primary: merge-tree --write-tree (git ≥2.38) ──
  try {
    // Exit 0 ⇒ clean merge. (stdout is just the resulting tree oid here.)
    await execFileAsync('git', ['merge-tree', '--write-tree', '--name-only', a, b], {
      cwd,
      maxBuffer: MAX_BUFFER,
      encoding: 'utf8',
    });
    return { conflicted: false, conflictPaths: [] };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string; message?: string };
    // Exit code 1 with a parseable body ⇒ conflicts (the documented behavior).
    if (e.code === 1 && typeof e.stdout === 'string') {
      const paths = parseMergeTreePaths(e.stdout);
      if (paths.length > 0) {
        return { conflicted: true, conflictPaths: paths };
      }
      // Conflicted but couldn't parse paths — still honest about the conflict.
      return { conflicted: true, conflictPaths: [] };
    }
    // Anything else (e.g. unknown flag on git <2.38) ⇒ use the fallback.
  }

  return mergeTreeFallback(a, b, opts);
}

/**
 * Parse `git merge-tree --write-tree --name-only` conflict output.
 *
 * Format on conflict (exit 1):
 *   <oid>\n
 *   <conflicted-path>\n
 *   <conflicted-path>\n
 *   \n
 *   <Conflicted file info / messages>
 *
 * The block before the first blank line, minus the leading oid, is the path
 * list under --name-only.
 */
function parseMergeTreePaths(stdout: string): string[] {
  const lines = stdout.split('\n');
  const paths: string[] = [];
  // line 0 is the tree oid; collect until the first blank line.
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') break;
    paths.push(line.trim());
  }
  return dedupeSorted(paths);
}

/**
 * git <2.38 fallback: real (no-ff, no-commit) merge inside a throwaway worktree,
 * read the unmerged paths, abort, tear down. Never touches the user's worktree.
 */
async function mergeTreeFallback(
  a: string,
  b: string,
  opts: GitOptions = {},
): Promise<MergeTreeResult> {
  const cwd = opts.cwd ?? process.cwd();
  // Resolve b to a SHA before we leave the primary worktree's ref namespace.
  const bSha = await revParse(b, opts);
  const tmp = await worktreeAdd(a, opts);
  try {
    let conflicted = false;
    try {
      await execFileAsync('git', ['merge', '--no-commit', '--no-ff', bSha], {
        cwd: tmp,
        maxBuffer: MAX_BUFFER,
        encoding: 'utf8',
      });
    } catch {
      // Non-zero ⇒ conflict (or merge that needs a commit). Inspect unmerged.
      conflicted = true;
    }
    let paths: string[] = [];
    try {
      const out = await git(['diff', '--name-only', '--diff-filter=U'], { cwd: tmp });
      paths = dedupeSorted(out.split('\n').map((s) => s.trim()).filter(Boolean));
    } catch {
      /* ignore */
    }
    if (paths.length > 0) conflicted = true;
    // Abort any in-progress merge so the throwaway worktree is removable cleanly.
    try {
      await git(['merge', '--abort'], { cwd: tmp });
    } catch {
      /* best-effort */
    }
    return { conflicted, conflictPaths: paths };
  } finally {
    await worktreeRemove(tmp, { cwd });
  }
}

function dedupeSorted(arr: string[]): string[] {
  return Array.from(new Set(arr)).sort((x, y) => x.localeCompare(y));
}
