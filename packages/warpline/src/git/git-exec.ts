/**
 * #git-exec — thin, READ-ONLY wrappers over git.
 *
 * The Warpline Engine NEVER mutates the user's HEAD, index, or worktree. ABSORB
 * materializes a ref's tree with `git archive | tar` into a throwaway temp dir
 * (no worktree, no `.git/worktrees` lock — so absorbs run concurrently against one
 * repo). The only remaining `git worktree` user is the git<2.38 merge-tree
 * FALLBACK, which needs real merge machinery; it is serialized per-repo (see
 * #repo-lock) and torn down in a `finally`. The user's primary worktree is never
 * touched.
 *
 * Library code: no console output. Callers handle their own logging.
 *
 * ARG-INJECTION HARDENING: refs reach git via execFile arg arrays (no shell), so
 * shell injection is impossible — but a ref like `--upload-pack=…` would still be
 * parsed by git AS A FLAG. Every command that takes a user-controlled ref/path
 * interposes `--end-of-options` (git ≥2.24) so all following args are treated as
 * operands, never options. Callers SHOULD also validate refs at their boundary.
 */

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { withRepoLock } from './repo-lock.js';

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
  return git(['rev-parse', '--verify', '--end-of-options', ref], opts);
}

/** Resolve a ref to its TREE SHA — provenance for a WarpState. */
export async function revParseTree(ref: string, opts: GitOptions = {}): Promise<string> {
  return git(['rev-parse', '--verify', '--end-of-options', `${ref}^{tree}`], opts);
}

/** The merge-base (common ancestor) of two refs. */
export async function mergeBase(a: string, b: string, opts: GitOptions = {}): Promise<string> {
  return git(['merge-base', '--end-of-options', a, b], opts);
}

/** The commit subject line of a ref's tip. */
export async function commitSubject(ref: string, opts: GitOptions = {}): Promise<string> {
  return git(['log', '-1', '--format=%s', '--end-of-options', ref], opts);
}

/** The author (name <email>) of a ref's tip commit. */
export async function commitAuthor(ref: string, opts: GitOptions = {}): Promise<string> {
  return git(['log', '-1', '--format=%an <%ae>', '--end-of-options', ref], opts);
}

/**
 * Add a DETACHED, quiet worktree for `ref` in a fresh temp dir and return its
 * path. The caller MUST pass the returned path to `worktreeRemove` (ideally in
 * a `finally`). Never points at the user's worktree.
 */
export async function worktreeAdd(ref: string, opts: GitOptions = {}): Promise<string> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'warpline-wt-'));
  // `git worktree add` wants the leaf dir to NOT exist yet.
  const tmp = path.join(base, 'tree');
  await git(['worktree', 'add', '--detach', '--quiet', '--end-of-options', tmp, ref], opts);
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

/**
 * Materialize a ref's tree into a fresh temp dir WITHOUT a git worktree, and
 * return the dir. Runs `git archive <sha> | tar -x` — a pure object-DB read that
 * takes NO `.git/worktrees` lock, so absorbs run concurrently against one repo.
 * The caller MUST pass the returned path to `releaseTree` (ideally in a `finally`).
 * Never touches the user's HEAD/index/worktree, and the materialized dir has no
 * `.git` (the parse pipeline reads files only — see #absorb).
 */
export async function materializeTree(ref: string, opts: GitOptions = {}): Promise<string> {
  const cwd = opts.cwd ?? process.cwd();
  // Pin to an immutable SHA first: provenance + injection-safe (a hex sha is never
  // parsed as a flag, so no `--end-of-options` dance is needed past this point).
  const sha = await revParse(ref, { cwd });
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'warpline-tree-'));
  const dest = path.join(base, 'tree');
  await fs.mkdir(dest);

  type Exit = { code: number | null; signal: NodeJS.Signals | null };
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (e: Error): void => {
        if (!settled) {
          settled = true;
          reject(e);
        }
      };
      const done = (): void => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      // No shell — two execFile-style spawns piped through Node streams. `tar -f -`
      // reads stdin (portable across GNU tar and macOS bsdtar).
      const archive = spawn('git', ['archive', '--format=tar', sha], { cwd });
      const extract = spawn('tar', ['-x', '-f', '-', '-C', dest]);

      let aErr = '';
      let xErr = '';
      archive.stderr.on('data', (d) => {
        aErr += d.toString();
      });
      extract.stderr.on('data', (d) => {
        xErr += d.toString();
      });

      // If either side dies mid-stream the pipe EPIPEs — route every error to one path.
      archive.on('error', fail);
      extract.on('error', fail);
      archive.stdout.on('error', fail);
      extract.stdin.on('error', fail);

      archive.stdout.pipe(extract.stdin);

      let aExit: Exit | null = null;
      let xExit: Exit | null = null;
      const check = (): void => {
        if (aExit === null || xExit === null) return;
        // A SIGNAL-killed producer (code null, signal set) must NOT count as success:
        // a truncated tar stream can leave `tar` exiting 0 on a PARTIAL extract → a
        // smaller-but-valid-looking WarpState with no error, silently breaking the
        // ~determinism thesis. Treat signal OR non-zero on EITHER side as failure, so
        // a truncated materialize throws rather than returning a wrong tree.
        if (aExit.signal !== null || aExit.code !== 0) {
          return fail(
            new Error(`git archive ${sha} failed: ${aExit.signal ? `killed by ${aExit.signal}` : aErr.trim()}`),
          );
        }
        if (xExit.signal !== null || xExit.code !== 0) {
          return fail(
            new Error(`tar extract failed: ${xExit.signal ? `killed by ${xExit.signal}` : xErr.trim()}`),
          );
        }
        done();
      };
      archive.on('close', (code, signal) => {
        aExit = { code, signal };
        check();
      });
      extract.on('close', (code, signal) => {
        xExit = { code, signal };
        check();
      });
    });
  } catch (err) {
    // The pipe failed AFTER we created the temp dir; absorb's `finally` only runs
    // once materializeTree RETURNS a path, so clean up here before re-throwing.
    await releaseTree(dest);
    throw err;
  }

  return dest;
}

/**
 * Remove a tree dir created by `materializeTree` (its mkdtemp parent and all).
 * Best-effort: never throws. No `git worktree prune` — nothing was registered.
 */
export async function releaseTree(tmp: string): Promise<void> {
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
    await execFileAsync('git', ['merge-tree', '--write-tree', '--name-only', '--end-of-options', a, b], {
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
  // This path genuinely needs a real worktree (git's merge machinery). It is the
  // one remaining `.git/worktrees` user, so serialize it per-repo: concurrent
  // fallbacks on one repo can't race the worktree lock. Distinct repos run free.
  const root = await repoRoot({ cwd }).catch(() => cwd);
  return withRepoLock(root, async () => {
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
  });
}

function dedupeSorted(arr: string[]): string[] {
  return Array.from(new Set(arr)).sort((x, y) => x.localeCompare(y));
}
