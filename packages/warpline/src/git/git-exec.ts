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
 * PERF (T-2026-07-04-003): `catFileBatch` reads many blobs through ONE
 * `git cat-file --batch` process and `diffRaw` yields full-sha per-path change
 * records — the plumbing behind the batched/incremental native snapshot.
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

/**
 * Resolve a git-dir-relative path (e.g. `hooks/post-commit`) to an ABSOLUTE
 * path — worktree-correct (honors `.git` files + GIT_DIR), unlike joining
 * repoRoot + '.git'. Read-only.
 */
export async function gitPath(rel: string, opts: GitOptions = {}): Promise<string> {
  const cwd = opts.cwd ?? process.cwd();
  const p = await git(['rev-parse', '--git-path', rel], opts);
  return path.isAbsolute(p) ? p : path.resolve(cwd, p);
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

/**
 * The contents of `filePath` at `ref` (read-only). Throws if absent at that ref.
 * BYTE-FAITHFUL — does NOT trim (a merge must preserve trailing newlines etc.;
 * trimming would drift bytes, which v2 materialization exists to prevent).
 */
export async function gitShow(ref: string, filePath: string, opts: GitOptions = {}): Promise<string> {
  const cwd = opts.cwd ?? process.cwd();
  try {
    const { stdout } = await execFileAsync('git', ['show', `${ref}:${filePath}`], {
      cwd,
      maxBuffer: MAX_BUFFER,
      encoding: 'utf8',
    });
    return stdout; // no trim — exact blob bytes
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    throw new Error(`git show ${ref}:${filePath} failed: ${(e.stderr || e.message || '').trim()}`);
  }
}

/** The RAW bytes of `filePath` at `ref` (read-only) — for binary detection. */
export async function gitShowBuffer(ref: string, filePath: string, opts: GitOptions = {}): Promise<Buffer> {
  const cwd = opts.cwd ?? process.cwd();
  try {
    const { stdout } = await execFileAsync('git', ['show', `${ref}:${filePath}`], {
      cwd,
      maxBuffer: MAX_BUFFER,
      encoding: 'buffer',
    });
    return stdout as unknown as Buffer;
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    throw new Error(`git show ${ref}:${filePath} failed: ${(e.stderr || e.message || '').trim()}`);
  }
}

/**
 * BATCH blob read (read-only): the raw bytes of many git objects through ONE
 * `git cat-file --batch` process, instead of one `git show` spawn per file —
 * the per-spawn overhead is what made whole-tree snapshots O(minutes) on a real
 * monorepo (T-2026-07-04-003). Returns sha → bytes; FAILS CLOSED if any
 * requested object is missing/unreadable (a partial snapshot must never look
 * like a complete one).
 */
export async function catFileBatch(shas: string[], opts: GitOptions = {}): Promise<Map<string, Buffer>> {
  const cwd = opts.cwd ?? process.cwd();
  const unique = Array.from(new Set(shas));
  const out = new Map<string, Buffer>();
  if (unique.length === 0) return out;

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
    const child = spawn('git', ['cat-file', '--batch'], { cwd });
    const chunks: Buffer[] = [];
    let err = '';
    child.stdout.on('data', (d: Buffer) => chunks.push(d));
    child.stderr.on('data', (d) => {
      err += d.toString();
    });
    child.on('error', fail);
    child.stdin.on('error', fail); // EPIPE if git dies mid-stream
    child.on('close', (code, signal) => {
      if (signal !== null || code !== 0) {
        return fail(new Error(`git cat-file --batch failed: ${signal ? `killed by ${signal}` : err.trim()}`));
      }
      try {
        parseCatFileBatch(Buffer.concat(chunks), out);
        done();
      } catch (e) {
        fail(e as Error);
      }
    });
    child.stdin.write(unique.join('\n') + '\n');
    child.stdin.end();
  });

  for (const sha of unique) {
    if (!out.has(sha)) {
      throw new Error(`git cat-file --batch: object ${sha} missing — refusing a partial snapshot (fail closed)`);
    }
  }
  return out;
}

/**
 * Parse `git cat-file --batch` output: per object `<sha> <type> <size>\n<bytes>\n`,
 * or `<name> missing\n`. Missing entries are simply not added; the caller's
 * completeness check fails closed on them.
 */
function parseCatFileBatch(buf: Buffer, out: Map<string, Buffer>): void {
  let pos = 0;
  while (pos < buf.length) {
    const nl = buf.indexOf(0x0a, pos);
    if (nl < 0) break;
    const header = buf.subarray(pos, nl).toString('utf8');
    pos = nl + 1;
    const parts = header.split(' ');
    if (parts.length >= 3) {
      const size = Number.parseInt(parts[2], 10);
      if (!Number.isFinite(size) || size < 0 || pos + size > buf.length) {
        throw new Error(`git cat-file --batch: malformed/truncated record for ${parts[0]}`);
      }
      out.set(parts[0], buf.subarray(pos, pos + size));
      pos += size + 1; // skip the record-terminating LF
    }
    // `<name> missing` (2 parts) → skip; completeness is checked by the caller.
  }
}

/** One `git diff --raw` record between two tree-ish refs. */
export interface RawDiffEntry {
  oldMode: string; // 6-digit git mode, 000000 when absent in refA
  newMode: string; // 6-digit git mode, 000000 when deleted in refB
  oldSha: string; // full blob sha at refA (all-zero when absent)
  newSha: string; // full blob sha at refB (all-zero when deleted)
  status: string; // A/M/D/T (single letter — --no-renames)
  path: string; // repo-relative path
}

/**
 * The full per-path change records between two refs (read-only) — the changed-
 * path inventory for an INCREMENTAL native snapshot (T-2026-07-04-003): modes +
 * full blob shas in one git call, so changed bytes can be batch-read by sha and
 * overlaid on the parent's native tree. `--no-renames` for the same load-bearing
 * reason as `changedPaths`; `--no-abbrev` because the shas feed `catFileBatch`
 * (raw-format sha abbreviation is controlled by --abbrev, NOT --full-index);
 * `-z` so exotic paths survive unquoted.
 */
export async function diffRaw(refA: string, refB: string, opts: GitOptions = {}): Promise<RawDiffEntry[]> {
  const cwd = opts.cwd ?? process.cwd();
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      'git',
      ['diff', '--raw', '-z', '--no-renames', '--no-abbrev', '--end-of-options', refA, refB],
      { cwd, maxBuffer: MAX_BUFFER, encoding: 'utf8' },
    ));
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    throw new Error(`git diff --raw ${refA} ${refB} failed: ${(e.stderr || e.message || '').trim()}`);
  }
  // -z record: ":<oldMode> <newMode> <oldSha> <newSha> <status>\0<path>\0"
  const fields = stdout.split('\0');
  const entries: RawDiffEntry[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const meta = fields[i];
    if (!meta.startsWith(':')) break; // trailing empty field / malformed tail
    const m = meta.slice(1).split(' ');
    if (m.length < 5) {
      throw new Error(`git diff --raw: malformed record ${JSON.stringify(meta)}`);
    }
    entries.push({ oldMode: m[0], newMode: m[1], oldSha: m[2], newSha: m[3], status: m[4], path: fields[i + 1] });
  }
  return entries;
}

/**
 * The repo-relative paths that differ between two refs (read-only).
 *
 * `--no-renames` is LOAD-BEARING: with git's default rename detection on, a pure
 * rename lists ONLY the new path, so the delete of the OLD path is dropped — and a
 * merge that overrides the base tree with only the additions leaves BOTH files (a
 * rename silently becomes a copy). Decomposing every rename into delete-of-old +
 * add-of-new lets the 3-way merge apply the delete, and makes a rename racing an
 * edit of the old path fail closed as add/delete-vs-edit instead of mis-merging.
 *
 * `-z` is LOAD-BEARING TOO (C-2), for the same reason as its siblings `diffRaw`
 * and `lsTree`: `core.quotePath` defaults TRUE, so without `-z` git returns
 * `café.txt` as the octal-escaped literal `"caf\303\251.txt"`. That phantom path
 * enters the merge plan as a DELETE (absent on all three sides), the REAL path
 * never enters at all, and the merged tree silently keeps the BASE version — a
 * wrong merge with zero conflicts. NUL-delimited output is deliberately NOT
 * trimmed: a path may legitimately begin or end with a space.
 */
export async function changedPaths(refA: string, refB: string, opts: GitOptions = {}): Promise<string[]> {
  const cwd = opts.cwd ?? process.cwd();
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      'git',
      ['diff', '--name-only', '-z', '--no-renames', '--end-of-options', refA, refB],
      { cwd, maxBuffer: MAX_BUFFER, encoding: 'utf8' },
    ));
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    throw new Error(`git diff --name-only ${refA} ${refB} failed: ${(e.stderr || e.message || '').trim()}`);
  }
  return stdout.split('\0').filter((p) => p.length > 0);
}

/**
 * The tree-entry MODE of `filePath` at `ref` (read-only) — the 6-digit git mode
 * (`100644` regular, `100755` executable, `120000` symlink, `160000` gitlink),
 * or `null` when the path is absent at that ref. Used by the merge to 3-way the
 * file mode alongside the bytes and to fail closed on unmergeable entry types.
 *
 * FAILS CLOSED (C-8): a git ERROR is NOT an absence, and it must never be reported
 * as one — `null` here means "deleted on that side" to the merge, and to the stake
 * guard it means "not a stake, allow". The discriminator is STRUCTURAL rather than
 * prose: `ls-tree` exits 0 with EMPTY output for a genuinely absent path, and
 * non-zero for a bad ref, a corrupt object DB, EMFILE or ENOMEM. So the empty-output
 * case alone yields `null`; every error propagates to the caller.
 */
export async function treeEntryMode(ref: string, filePath: string, opts: GitOptions = {}): Promise<string | null> {
  const out = await git(['ls-tree', '--end-of-options', ref, '--', filePath], opts);
  // `ls-tree` line: "100755 blob <sha>\t<path>". No line ⇒ genuinely absent.
  const m = out.match(/^(\d{6}) /);
  return m ? m[1] : null;
}

export interface LsTreeEntry {
  mode: string; // 6-digit git mode (100644/100755/120000/160000)
  type: 'blob' | 'commit'; // commit = gitlink/submodule
  sha: string; // git object sha (blob sha, or the submodule commit sha)
  path: string; // repo-relative path (recursive; leaf entries only)
}

/**
 * Every LEAF entry of a ref's tree (read-only), recursively — the byte inventory
 * for a native snapshot. `-r` recurses to blobs; trees are rebuilt natively by the
 * caller, so `-t` is intentionally omitted. `-z` NUL-delimits so paths with spaces
 * or newlines survive intact.
 */
export async function lsTree(ref: string, opts: GitOptions = {}): Promise<LsTreeEntry[]> {
  const out = await git(['ls-tree', '-r', '-z', '--end-of-options', ref], opts);
  const entries: LsTreeEntry[] = [];
  for (const rec of out.split('\0')) {
    if (!rec) continue;
    // "<mode> <type> <sha>\t<path>"
    const tab = rec.indexOf('\t');
    if (tab < 0) continue;
    const meta = rec.slice(0, tab).split(/\s+/);
    entries.push({ mode: meta[0], type: meta[1] as 'blob' | 'commit', sha: meta[2], path: rec.slice(tab + 1) });
  }
  return entries;
}

/**
 * Every commit hash that touched `pathspec`, newest-first (read-only) — the
 * corroboration walk for the epoch anchor (attest §5.3). Empty [] when the path
 * was never committed. `--end-of-options` guards the pathspec; the `--` separates
 * it from revision args so a path that looks like a flag/ref can never be misparsed.
 */
export async function gitLogHashes(pathspec: string, opts: GitOptions = {}): Promise<string[]> {
  const out = await git(['log', '--format=%H', '--end-of-options', '--', pathspec], opts).catch(() => '');
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[0-9a-f]{7,64}$/.test(l));
}

/**
 * How many commits `to` is ahead of `from` (`git rev-list --count from..to`),
 * or null when either end does not resolve. READ-ONLY.
 *
 * The one consumer is #warpline-health's SEAL LIVENESS line: the last strand
 * records the git commit it sealed at, so this answers "how far has git run on
 * without the fabric?" — the drift that makes an auto-seal hook look installed
 * while it silently does nothing. Null is returned rather than thrown because a
 * pruned or rewritten commit is a legitimate answer of "unknowable", and a
 * diagnostic must survive the condition it diagnoses.
 */
export async function revListCount(from: string, to: string, opts: GitOptions = {}): Promise<number | null> {
  const out = await git(['rev-list', '--count', '--end-of-options', `${from}..${to}`], opts).catch(() => '');
  return /^\d+$/.test(out.trim()) ? Number(out.trim()) : null;
}

/** The common ancestor of N refs (octopus merge-base) — the base for a consolidate. */
export async function mergeBaseN(refs: string[], opts: GitOptions = {}): Promise<string> {
  if (refs.length < 2) throw new Error('mergeBaseN needs at least 2 refs');
  return git(['merge-base', '--octopus', '--end-of-options', ...refs], opts);
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
 * The configured git user.name (read-only) — used as the default ACTOR for a
 * native fabric pick when the caller doesn't supply `--as`. Coexistence only:
 * git identity seeds Warpline attribution, it is never written back to git.
 */
export async function gitUserName(opts: GitOptions = {}): Promise<string | null> {
  const name = await git(['config', 'user.name'], opts).catch(() => '');
  return name.trim() || null;
}

/**
 * Add a DETACHED, quiet worktree for `ref` in a fresh temp dir and return its
 * path. The caller MUST pass the returned path to `worktreeRemove` (ideally in
 * a `finally`). Never points at the user's worktree.
 */
export async function worktreeAdd(ref: string, opts: GitOptions = {}): Promise<string> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'warpline-wt-'));
  // `git worktree add` wants the leaf dir to NOT exist yet.
  //
  // THE LEAF NAME IS NOT COSMETIC. git registers a worktree under
  // `.git/worktrees/<basename-of-path>`, de-duplicating by CHECKING whether that
  // name is taken and then creating it — a TOCTOU window. While every call named
  // its leaf `tree`, N concurrent adds against ONE repo all proposed the name
  // `tree`, raced in that window, and surfaced as
  // `failed to read .git/worktrees/tree/commondir` on the loser and ENOTEMPTY on
  // teardown. The mkdtemp suffix is already unique and collision-free, so reusing
  // it as the leaf makes the registry name unique too and the race cannot form.
  // (`materializeTree` keeps a fixed leaf: it is `git archive | tar` into a plain
  // directory and registers no worktree, so it never touches this namespace.)
  const tmp = path.join(base, `tree-${path.basename(base).slice('warpline-wt-'.length)}`);
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
  // This path genuinely needs a real worktree (git's merge machinery), so
  // serialize it per-repo: concurrent fallbacks on one repo can't race the
  // worktree registry. Distinct repos run free.
  //
  // It is NOT the only `.git/worktrees` user, though this comment claimed to be
  // for a long time — #oracle's loadBranchIndex is the other, and it ran UNLOCKED
  // while resolving both branches through `Promise.all`, i.e. two concurrent adds
  // against one repo on every oracle run. `git worktree add` validates the whole
  // registry as it runs, so a sibling mid-create fails the add with "failed to
  // read .git/worktrees/<other>/commondir". Both callers now take this lock; if a
  // third appears, it must take it too.
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
