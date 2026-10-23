/**
 * @symbol #loop-git
 * @symbol #loop-act
 *
 * Scratch worktrees and parked refs for loop act nodes (docs/specs/gnomon-loops.md §3.2 "Where loops work", §3.3
 * kill switch, §4 retention; build plan step 10, LP6a; G-GIT-01).
 *
 * THE CHOICE (recorded in docs/plans/gnomon-loops-build.md, step 10 notes): the scratch is NOT `git worktree add`.
 * `worktree add` writes the human's `.git` (worktrees/<name>, the index of the new tree) and runs a checkout, which
 * applies the repo's smudge/eol filters and a post-checkout hook unless every one is disabled; the step 3 review
 * removed kernel git calls that act on repo config. Instead:
 *   1. READ the human repo with plumbing only: `rev-parse` (HEAD sha, its symbolic ref, the common dir),
 *      `ls-tree -r -z -l <head>` and `cat-file --batch` (raw blobs: no filters, no textconv, no checkout). Every
 *      call is hardened (hardenedGit: GIT_CONFIG_GLOBAL=/dev/null, GIT_CONFIG_NOSYSTEM, GIT_ATTR_NOSYSTEM, a clean
 *      env with no inherited GIT_* that could redirect it, `--no-optional-locks`, `-c core.hooksPath=/dev/null
 *      -c core.fsmonitor=false -c core.sshCommand=false -c protocol.allow=never -c credential.helper=`). These
 *      reads start no program from repo config (fsmonitor is the one a read would run; it is forced off), and
 *      write nothing to the repo: the same footing as step 4's `git ls-files` for check copies.
 *   2. WRITE the HEAD tree's blobs into the KERNEL-OWNED run dir `<home>/loop-work/act-<runId>/tree` (0700; never
 *      inside the repo, so the founder's checkout and `.git` stay byte-identical, G-GIT-01), each file opened
 *      O_CREAT|O_EXCL|O_NOFOLLOW; symlinks are recreated as links last (the tools and the sandbox resolve them).
 *      The repo's `node_modules` dirs are LINKED in, only when their realpath is inside the repo (read only in the
 *      `loop-act` profile; act nodes may not edit them, LOOP_ALWAYS_PROTECTED). There is no `.git` in the scratch.
 *   3. DIFF in-kernel: every scratch file's git blob id against the HEAD manifest (added, modified, deleted).
 *   4. PARK in a kernel-owned bare repo per repo, `<home>/loop-work/park/<repoHash>.git`, whose object store
 *      borrows the human's through `objects/info/alternates` (read only): the changed blobs are written there with
 *      `hash-object -w --no-filters`, the tree through a private GIT_INDEX_FILE, the commit with the Gnomon Loop
 *      identity and the kernel trailers, and the ref `refs/gnomon/loops/<id>/<runId>`. The human's repo gets no
 *      ref and no object in step 10; landing (step 11) moves them under the land lock.
 *   5. CLEANUP: the scratch tree is removed when the run ends (the parked commit holds its work); sweepLoopScratch
 *      removes stale run dirs and parked refs past the retention window (loops.retentionDays).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { LOOP_WORK_DIR } from '../sandbox/loop-check.js';

export const SCRATCH_LIMITS = Object.freeze({ maxFiles: 50_000, maxBytes: 500 * 1024 * 1024, maxNodeModules: 500 });
/** a scratch's runId: one path component */
export const SCRATCH_RUN_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const PARK_REF_PREFIX = 'refs/gnomon/loops/';
/** the diff a propose card carries (characters); the full diff stays in the parked commit */
export const SCRATCH_DIFF_CHARS = 64 * 1024;

export type GitRefusalReason = 'git-failed' | 'not-a-repo' | 'too-large' | 'bad-input' | 'escape' | 'git-too-old';

/** The oldest git the kernel runs (2.39.4: the CVE-2024-32002/32004/32465 fixes). */
export const GIT_MIN_VERSION: readonly [number, number, number] = Object.freeze([2, 39, 4]);
/** park caps (Aegis L5): one changed file and all of them */
export const PARK_LIMITS = Object.freeze({ maxFileBytes: 32 * 1024 * 1024, maxTotalBytes: 128 * 1024 * 1024 });

export class GitRefusal extends Error {
  constructor(readonly reason: GitRefusalReason, message: string) {
    super(message);
  }
}

/**
 * The flags every kernel git call carries (gnomon.md §15 git hardening, S16-2, S22-H4). No safe.directory (Aegis
 * M4): createScratch checks instead that the repo and its common dir belong to the kernel's uid, and the park repo is
 * the kernel's own.
 */
export const HARDENED_GIT_FLAGS: readonly string[] = Object.freeze([
  '--no-optional-locks',
  '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'core.sshCommand=false', '-c', 'protocol.allow=never',
  '-c', 'core.pager=cat', '-c', 'credential.helper=', '-c', 'core.quotepath=off', '-c', 'core.longpaths=true', '-c', 'gc.auto=0',
]);

/** A clean env: no inherited GIT_* (GIT_DIR, GIT_INDEX_FILE … would redirect the call), no global or system config. */
export function hardenedGitEnv(from: Readonly<Record<string, string | undefined>> = process.env, extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: from.PATH ?? '/usr/bin:/bin', HOME: '/nonexistent', LC_ALL: 'C',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_ATTR_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat',
    GIT_NO_LAZY_FETCH: '1', GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_PROTOCOL_FROM_USER: '0', GIT_ALLOW_PROTOCOL: 'none',
    ...extra,
  };
}

interface GitCall {
  cwd?: string;
  gitDir?: string;
  input?: string | Buffer;
  env?: Record<string, string>;
  maxBuffer?: number;
  /** a non-zero exit is an answer (rev-parse --verify), not a failure */
  allowFail?: boolean;
}

let GIT_BIN: string | null = null;

/** git's absolute path, resolved ONCE from the kernel's PATH (realpath) and version-checked (Aegis M4). */
export function gitBinary(from: Readonly<Record<string, string | undefined>> = process.env): string {
  if (GIT_BIN) return GIT_BIN;
  let found: string | null = null;
  for (const d of (from.PATH ?? '/usr/bin:/bin').split(path.delimiter)) {
    if (!d || !path.isAbsolute(d)) continue;
    const c = path.join(d, 'git');
    try {
      fs.accessSync(c, fs.constants.X_OK);
      if (fs.statSync(c).isFile()) {
        found = fs.realpathSync.native(c);
        break;
      }
    } catch {
      /* next */
    }
  }
  if (!found) throw new GitRefusal('git-failed', 'no git on the kernel PATH');
  const v = spawnSync(found, ['--version'], { encoding: 'utf8', env: hardenedGitEnv(from), windowsHide: true });
  const m = /git version (\d+)\.(\d+)\.(\d+)/.exec(v.stdout ?? '');
  if (!m) throw new GitRefusal('git-failed', `could not read the git version of ${found}`);
  const have = [Number(m[1]), Number(m[2]), Number(m[3])];
  const old = have[0]! !== GIT_MIN_VERSION[0] ? have[0]! < GIT_MIN_VERSION[0] : have[1]! !== GIT_MIN_VERSION[1] ? have[1]! < GIT_MIN_VERSION[1] : have[2]! < GIT_MIN_VERSION[2];
  if (old) throw new GitRefusal('git-too-old', `git ${have.join('.')} at ${found} is older than ${GIT_MIN_VERSION.join('.')}: update git`);
  GIT_BIN = found;
  return found;
}

/** One hardened git call; stdout as a Buffer. */
export function hardenedGit(args: readonly string[], o: GitCall = {}): { status: number; stdout: Buffer; stderr: string } {
  const pre = [...HARDENED_GIT_FLAGS, ...(o.gitDir ? ['--git-dir', o.gitDir] : [])];
  const r = spawnSync(gitBinary(), [...pre, ...args], {
    ...(o.cwd ? { cwd: o.cwd } : {}), env: o.env ?? hardenedGitEnv(), ...(o.input !== undefined ? { input: o.input } : {}),
    maxBuffer: o.maxBuffer ?? 64 * 1024 * 1024, windowsHide: true,
  });
  const status = typeof r.status === 'number' ? r.status : -1;
  const stderr = (r.stderr ?? Buffer.alloc(0)).toString('utf8').trim().slice(0, 400);
  if (status !== 0 && !o.allowFail) throw new GitRefusal('git-failed', `git ${args[0] ?? ''} failed: ${stderr || String(r.error ?? `exit ${status}`)}`);
  return { status, stdout: r.stdout ?? Buffer.alloc(0), stderr };
}

const within = (p: string, dir: string): boolean => p === dir || p.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;

/** git's dotgit test (lower-cased, trailing dots and spaces stripped; the 8.3 alias), as gnomon-local's tools. */
function isDotGit(c: string): boolean {
  const x = c.toLowerCase().replace(/[. ]+$/, '');
  return x === '.git' || x === 'git~1';
}
/** repo-relative paths a scratch never holds (as the check copy's NEVER_COPY) */
const NEVER_SCRATCH = [/^\.gnomon(\/|$)/, /(^|\/)node_modules(\/|$)/, /^\.warpline\/keys(\/|$)/, /^\.warpline\/daemon-tokens\.jsonl$/, /^\.warpline\/daemon\/mcp-tokens\.json$/, /^\.warpline\/daemon\/mcp\.token$/];
/** A path component the kernel refuses (Aegis M3): control, format (bidi included) or separator characters, > 255 bytes. */
export function unsafeComponent(c: string): boolean {
  return /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(c) || Buffer.byteLength(c, 'utf8') > 255;
}
/** The collision key of a path (Aegis H1): APFS and NTFS fold case and Unicode normalization. */
const foldKey = (p: string): string => p.normalize('NFD').toLowerCase();

/** Refuse a set of paths where two differ only by case or normalization, at any parent prefix. */
export function refuseCollisions(rels: readonly string[]): void {
  const seen = new Map<string, string>();
  for (const rel of rels) {
    const parts = rel.split('/');
    for (let k = 1; k <= parts.length; k++) {
      const pre = parts.slice(0, k).join('/');
      const prev = seen.get(foldKey(pre));
      if (prev !== undefined && prev !== pre) throw new GitRefusal('escape', `the tree has paths that collide by case or Unicode normalization (${JSON.stringify(prev)} and ${JSON.stringify(pre)}): refused`);
      seen.set(foldKey(pre), pre);
    }
  }
}

/** Create `relDir` under treeReal one component at a time, each lstat'd a real directory (never through a link). */
function mkParents(treeReal: string, relDir: string): string {
  let cur = treeReal;
  for (const c of relDir ? relDir.split('/') : []) {
    cur = path.join(cur, c);
    try {
      fs.mkdirSync(cur, { mode: 0o755 });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    const st = fs.lstatSync(cur);
    if (!st.isDirectory() || st.isSymbolicLink()) throw new GitRefusal('escape', `${relDir} passes through a non-directory: refused`);
  }
  return cur;
}

/** The parent of dst must be EXACTLY treeReal/relDir after realpath (Aegis H1). */
function assertParent(treeReal: string, relDir: string, dst: string): void {
  const want = path.join(treeReal, ...(relDir ? relDir.split('/') : []));
  if (fs.realpathSync.native(path.dirname(dst)) !== want) throw new GitRefusal('escape', `${relDir || '.'} resolves outside the scratch: refused`);
}

/**
 * Read one scratch entry without following a link or blocking (Aegis M1): a link through lstat + readlink; a file
 * through O_RDONLY|O_NOFOLLOW|O_NONBLOCK with fstat (a regular file, one link, at most `cap` bytes).
 */
export function readScratchEntry(p: string, mode: ManifestEntry['mode'], cap: number): Buffer {
  if (mode === '120000') {
    if (!fs.lstatSync(p).isSymbolicLink()) throw new GitRefusal('escape', `${path.basename(p)} changed type`);
    return Buffer.from(fs.readlinkSync(p), 'utf8');
  }
  const fd = fs.openSync(p, fs.constants.O_RDONLY | NOFOLLOW | (fs.constants.O_NONBLOCK ?? 0));
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) throw new GitRefusal('escape', `${path.basename(p)} is not a regular file`);
    if (st.nlink !== 1) throw new GitRefusal('escape', `${path.basename(p)} has ${st.nlink} hard links`);
    if (st.size > cap) throw new GitRefusal('too-large', `${path.basename(p)} is over ${cap} bytes`);
    const buf = Buffer.alloc(st.size);
    let at = 0;
    while (at < buf.length) {
      const n = fs.readSync(fd, buf, at, buf.length - at, at);
      if (n === 0) break;
      at += n;
    }
    return buf.subarray(0, at);
  } finally {
    fs.closeSync(fd);
  }
}

const skipRel = (rel: string): boolean => rel.split('/').some((c) => c === '' || c === '.' || c === '..' || isDotGit(c)) || NEVER_SCRATCH.some((re) => re.test(rel));

/** The git object id of a blob (sha1, or sha256 for a sha256 repo). */
export function blobId(content: Buffer, algo: 'sha1' | 'sha256'): string {
  return createHash(algo).update(`blob ${content.length}\0`).update(content).digest('hex');
}

export interface ManifestEntry {
  mode: '100644' | '100755' | '120000';
  oid: string;
}

export interface Scratch {
  runId: string;
  loopId: string;
  /** the human repo (realpath) */
  repo: string;
  /** `<home>/loop-work/act-<runId>` (realpath) */
  runDir: string;
  /** the scratch worktree, `<runDir>/tree` */
  tree: string;
  /** a private TMPDIR for the act session, `<runDir>/tmp` */
  tmp: string;
  headSha: string;
  /** the symbolic ref HEAD pointed at (refs/heads/<branch>), or null when detached */
  headRef: string | null;
  objectFormat: 'sha1' | 'sha256';
  /** the human repo's object store (alternates of the park repo; read only) */
  objectsDir: string;
  /** the repo's git common dir and its other worktrees' checkouts (the loop-act profile denies reading them) */
  commonDir: string;
  siblingWorktrees: string[];
  manifest: ReadonlyMap<string, ManifestEntry>;
  nodeModules: string[];
  files: number;
  bytes: number;
}

/** Live scratches by runId (openLoop accepts an act session root only when it is one of these). */
const LIVE = new Map<string, Scratch>();

/** The live scratch for a run, or null (module state: a forged path is never a scratch). */
export function liveScratch(runId: string): Readonly<Scratch> | null {
  return LIVE.get(runId) ?? null;
}

export function loopWorkDir(home: string): string {
  return path.join(home, LOOP_WORK_DIR);
}

function ensureDir(dir: string): string {
  try {
    fs.mkdirSync(dir, { mode: 0o700 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
  const st = fs.lstatSync(dir);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new GitRefusal('escape', `${dir} is not a real directory (a link or swap is refused)`);
  fs.chmodSync(dir, 0o700);
  return dir;
}

export interface CreateScratchInput {
  home: string;
  repo: string;
  loopId: string;
  runId: string;
  limits?: Partial<typeof SCRATCH_LIMITS>;
  env?: Record<string, string>;
}

/**
 * Create the scratch worktree for a run: the HEAD tree of `repo`, detached, in `<home>/loop-work/act-<runId>/tree`.
 * Throws GitRefusal (nothing left behind) on a repo with no commit, a tree past the caps or any escape.
 */
export function createScratch(i: CreateScratchInput): Scratch {
  if (!SCRATCH_RUN_ID.test(i.runId)) throw new GitRefusal('bad-input', `runId must match ${SCRATCH_RUN_ID}`);
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(i.loopId)) throw new GitRefusal('bad-input', 'loopId must be kebab-case');
  if (LIVE.has(i.runId)) throw new GitRefusal('bad-input', `run ${i.runId} already has a scratch`);
  const limits = { ...SCRATCH_LIMITS, ...(i.limits ?? {}) };
  const repo = fs.realpathSync.native(i.repo);
  const homeReal = fs.realpathSync.native(i.home);
  if (within(homeReal, repo) || within(repo, homeReal)) throw new GitRefusal('bad-input', 'the repo and the Gnomon home must not contain each other');
  // Aegis L2: discovery never climbs above the repo's parent
  const env = { ...(i.env ?? hardenedGitEnv()), GIT_CEILING_DIRECTORIES: path.dirname(repo) };
  const g = (args: string[], extra: Partial<GitCall> = {}) => hardenedGit(args, { cwd: repo, env, ...extra });
  const top = g(['rev-parse', '--show-toplevel'], { allowFail: true });
  if (top.status !== 0) throw new GitRefusal('not-a-repo', `${repo} is not a git working tree`);
  // Aegis L2: the repo is its own top level (never a dir inside another repo's tree)
  let topReal: string;
  try {
    topReal = fs.realpathSync.native(top.stdout.toString('utf8').trim());
  } catch {
    throw new GitRefusal('not-a-repo', 'the repo top level could not be resolved');
  }
  if (topReal !== repo) throw new GitRefusal('not-a-repo', `${repo} is not the top level of its git tree (${topReal})`);
  const head = g(['rev-parse', '--verify', '-q', 'HEAD^{commit}'], { allowFail: true }).stdout.toString('utf8').trim();
  if (!OID.test(head)) throw new GitRefusal('not-a-repo', `${repo} has no commit at HEAD`);
  const sym = g(['symbolic-ref', '-q', 'HEAD'], { allowFail: true });
  const headRef = sym.status === 0 && /^refs\/heads\/[^\s]+$/.test(sym.stdout.toString('utf8').trim()) ? sym.stdout.toString('utf8').trim() : null;
  const commonDir = fs.realpathSync.native(g(['rev-parse', '--path-format=absolute', '--git-common-dir']).stdout.toString('utf8').trim());
  const objectsDir = fs.realpathSync.native(path.join(commonDir, 'objects'));
  if (!fs.statSync(objectsDir).isDirectory()) throw new GitRefusal('not-a-repo', 'the repo has no object store');
  // Aegis L1: the alternates file is line-based; a path with a newline or a leading quote is refused
  if (/[\n\r]/.test(objectsDir) || objectsDir.startsWith('"')) throw new GitRefusal('bad-input', 'the object store path cannot be an alternate');
  // Aegis M4: in place of safe.directory, the repo and its common dir are the kernel's own uid
  const uid = process.getuid?.();
  if (uid !== undefined) for (const d of [repo, commonDir]) if (fs.statSync(d).uid !== uid) throw new GitRefusal('bad-input', `${d} is not owned by this user: refused`);
  const siblingWorktrees: string[] = [];
  try {
    for (const w of fs.readdirSync(path.join(commonDir, 'worktrees'))) {
      try {
        const gd = fs.readFileSync(path.join(commonDir, 'worktrees', w, 'gitdir'), 'utf8').trim();
        const wt = fs.realpathSync.native(path.dirname(gd));
        if (wt !== repo) siblingWorktrees.push(wt);
      } catch {
        /* a stale worktree entry */
      }
    }
  } catch {
    /* no linked worktrees */
  }
  const objectFormat: 'sha1' | 'sha256' = head.length === 64 ? 'sha256' : 'sha1';

  // the HEAD tree (long form: sizes for the caps); blobs only, gitlinks and specials skipped
  const ls = g(['ls-tree', '-r', '-z', '-l', '--full-tree', head], { maxBuffer: 256 * 1024 * 1024 }).stdout.toString('utf8');
  const manifest = new Map<string, ManifestEntry>();
  const wanted: Array<{ rel: string; mode: ManifestEntry['mode']; oid: string; size: number }> = [];
  let bytes = 0;
  for (const rec of ls.split('\0')) {
    if (!rec) continue;
    const tab = rec.indexOf('\t');
    const [mode, type, oid, size] = rec.slice(0, tab).split(/\s+/);
    const rel = rec.slice(tab + 1);
    if (type !== 'blob' || (mode !== '100644' && mode !== '100755' && mode !== '120000') || !OID.test(oid ?? '')) continue;
    if (skipRel(rel)) continue;
    if (rel.split('/').some(unsafeComponent)) throw new GitRefusal('bad-input', `the tree has a path with control, format or bidi characters or a component over 255 bytes: ${JSON.stringify(rel).slice(0, 120)}`);
    const n = Number(size);
    bytes += Number.isFinite(n) ? n : 0;
    wanted.push({ rel, mode, oid: oid!, size: n });
    manifest.set(rel, { mode, oid: oid! });
    if (wanted.length > limits.maxFiles) throw new GitRefusal('too-large', `the scratch would hold more than ${limits.maxFiles} files`);
    if (bytes > limits.maxBytes) throw new GitRefusal('too-large', `the scratch would exceed ${Math.round(limits.maxBytes / 1024 / 1024)} MiB`);
  }

  // Aegis H1: case- or normalization-colliding paths (a link `X` beside `x/foo`) could route a write through a link
  refuseCollisions(wanted.map((w) => w.rel));
  const work = ensureDir(loopWorkDir(homeReal));
  const runDir = path.join(work, `act-${i.runId}`);
  if (fs.existsSync(runDir)) throw new GitRefusal('bad-input', `${runDir} already exists`);
  const tree = path.join(runDir, 'tree');
  const tmp = path.join(runDir, 'tmp');
  try {
    fs.mkdirSync(runDir, { mode: 0o700 });
    fs.mkdirSync(tree, { mode: 0o700 });
    fs.mkdirSync(tmp, { mode: 0o700 });
    const treeReal = fs.realpathSync.native(tree);
    // raw blobs (no filters, no textconv): `<oid> blob <size>\n<bytes>\n` per object
    const out = wanted.length ? g(['cat-file', '--batch'], { input: wanted.map((w) => w.oid).join('\n') + '\n', maxBuffer: bytes + wanted.length * 128 + 1024 }).stdout : Buffer.alloc(0);
    let at = 0;
    const blobs = new Map<string, Buffer>();
    for (let k = 0; k < wanted.length; k++) {
      const nl = out.indexOf(10, at);
      const hdr = out.subarray(at, nl).toString('utf8').split(' ');
      if (hdr[1] !== 'blob' || hdr[0] !== wanted[k]!.oid) throw new GitRefusal('git-failed', `cat-file returned ${hdr.join(' ').slice(0, 120)} for ${wanted[k]!.oid}`);
      const size = Number(hdr[2]);
      blobs.set(wanted[k]!.oid, out.subarray(nl + 1, nl + 1 + size));
      at = nl + 1 + size + 1;
    }
    const links: typeof wanted = [];
    for (const w of wanted) {
      if (w.mode === '120000') {
        links.push(w);
        continue;
      }
      const relDir = path.posix.dirname(w.rel) === '.' ? '' : path.posix.dirname(w.rel);
      const dst = path.join(treeReal, ...w.rel.split('/'));
      mkParents(treeReal, relDir);
      assertParent(treeReal, relDir, dst);
      const fd = fs.openSync(dst, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, w.mode === '100755' ? 0o755 : 0o644);
      try {
        fs.writeSync(fd, blobs.get(w.oid)!);
      } finally {
        fs.closeSync(fd);
      }
    }
    // links last: no file is ever written through one
    for (const w of links) {
      const relDir = path.posix.dirname(w.rel) === '.' ? '' : path.posix.dirname(w.rel);
      const dst = path.join(treeReal, ...w.rel.split('/'));
      mkParents(treeReal, relDir);
      assertParent(treeReal, relDir, dst);
      fs.symlinkSync(blobs.get(w.oid)!.toString('utf8'), dst);
    }
    // the repo's node_modules next to every scratch dir, linked (read only in the profile) when inside the repo
    const nodeModules: string[] = [];
    const dirs = new Set<string>(['']);
    for (const w of wanted) if (w.mode !== '120000') for (let d = path.posix.dirname(w.rel); d !== '.' && d !== ''; d = path.posix.dirname(d)) dirs.add(d);
    for (const d of [...dirs].sort()) {
      const src = path.join(repo, ...(d ? d.split('/') : []), 'node_modules');
      let real: string;
      try {
        real = fs.realpathSync.native(src);
      } catch {
        continue;
      }
      // Aegis L3: a real node_modules dir inside the repo, named node_modules, under no .git component
      if (!within(real, repo) || !fs.statSync(real).isDirectory() || path.basename(real) !== 'node_modules' || real.slice(repo.length).split(path.sep).some(isDotGit)) throw new GitRefusal('escape', `${path.posix.join(d, 'node_modules')} resolves outside the repo or to a non-node_modules dir (${real}): refused`);
      const dst = path.join(treeReal, ...(d ? d.split('/') : []), 'node_modules');
      let pst: fs.Stats;
      try {
        pst = fs.lstatSync(path.dirname(dst));
      } catch {
        continue;
      }
      if (!pst.isDirectory() || pst.isSymbolicLink()) continue;
      assertParent(treeReal, d, dst);
      if (fs.lstatSync(dst, { throwIfNoEntry: false })) continue;
      if (nodeModules.length >= limits.maxNodeModules) throw new GitRefusal('too-large', `more than ${limits.maxNodeModules} node_modules dirs to link`);
      fs.symlinkSync(real, dst, 'dir');
      nodeModules.push(real);
    }
    fs.writeFileSync(path.join(runDir, 'scratch.json'), `${JSON.stringify({ schema: 'gnomon-loop-scratch:v1', loopId: i.loopId, runId: i.runId, repo, headSha: head, headRef, createdAt: new Date().toISOString() })}\n`, { mode: 0o600 });
    const s: Scratch = { runId: i.runId, loopId: i.loopId, repo, runDir: fs.realpathSync.native(runDir), tree: fs.realpathSync.native(tree), tmp: fs.realpathSync.native(tmp), headSha: head, headRef, objectFormat, objectsDir, commonDir, siblingWorktrees, manifest, nodeModules: [...new Set(nodeModules)], files: wanted.length, bytes };
    LIVE.set(i.runId, s);
    return s;
  } catch (err) {
    fs.rmSync(runDir, { recursive: true, force: true });
    if (err instanceof GitRefusal) throw err;
    throw new GitRefusal('git-failed', `creating the scratch worktree failed: ${(err as Error).message.slice(0, 300)}`);
  }
}

/** Every file and link in a scratch tree (repo-relative, POSIX), never node_modules or a `.git` component. */
export function listScratchFiles(tree: string, maxFiles = SCRATCH_LIMITS.maxFiles): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (unsafeComponent(e.name)) throw new GitRefusal('bad-input', `the scratch has a path with control, format or bidi characters or a component over 255 bytes: ${JSON.stringify(r).slice(0, 120)}`);
      if (skipRel(r)) continue;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else if (!e.isFile() && !e.isSymbolicLink()) throw new GitRefusal('escape', `${JSON.stringify(r).slice(0, 120)} is not a regular file (a FIFO, socket or device in the scratch is refused)`);
      else {
        out.push(r);
        if (out.length > maxFiles) throw new GitRefusal('too-large', `the scratch holds more than ${maxFiles} files`);
      }
    }
  };
  walk(tree, '');
  return out.sort();
}

export interface ScratchChange {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  mode?: ManifestEntry['mode'];
  oid?: string;
  oldOid?: string;
}

/** What the run changed in its scratch, against the HEAD manifest (in-kernel blob ids; no git). */
export function scratchChanges(s: Readonly<Scratch>): ScratchChange[] {
  const seen = new Set<string>();
  const out: ScratchChange[] = [];
  for (const rel of listScratchFiles(s.tree)) {
    seen.add(rel);
    const p = path.join(s.tree, ...rel.split('/'));
    const st = fs.lstatSync(p);
    const mode: ManifestEntry['mode'] = st.isSymbolicLink() ? '120000' : st.mode & 0o111 ? '100755' : '100644';
    if (!st.isSymbolicLink() && !st.isFile()) throw new GitRefusal('escape', `${rel} is not a regular file`);
    const oid = blobId(readScratchEntry(p, mode, PARK_LIMITS.maxFileBytes), s.objectFormat);
    const m = s.manifest.get(rel);
    if (!m) out.push({ path: rel, status: 'added', mode, oid });
    else if (m.oid !== oid || m.mode !== mode) out.push({ path: rel, status: 'modified', mode, oid, oldOid: m.oid });
  }
  for (const [rel, m] of s.manifest) if (!seen.has(rel)) out.push({ path: rel, status: 'deleted', oldOid: m.oid });
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** The kernel-owned park repo for `repo` (bare; its objects borrow the human's through alternates). */
export function parkRepoDir(home: string, repo: string): string {
  return path.join(loopWorkDir(home), 'park', `${createHash('sha256').update(repo).digest('hex').slice(0, 16)}.git`);
}

function ensureParkRepo(home: string, s: Readonly<Scratch>, env: Record<string, string>): string {
  const homeReal = fs.realpathSync.native(home);
  ensureDir(ensureDir(loopWorkDir(homeReal)) && path.join(loopWorkDir(homeReal), 'park'));
  const dir = parkRepoDir(homeReal, s.repo);
  if (!fs.existsSync(dir)) hardenedGit(['init', '--bare', '-q', '--template=', `--object-format=${s.objectFormat}`, dir], { env, cwd: path.dirname(dir) });
  const st = fs.lstatSync(dir);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new GitRefusal('escape', `${dir} is not a real directory`);
  const alt = path.join(dir, 'objects', 'info', 'alternates');
  fs.mkdirSync(path.dirname(alt), { recursive: true });
  const want = `${s.objectsDir}\n`;
  if (!fs.existsSync(alt) || fs.readFileSync(alt, 'utf8') !== want) fs.writeFileSync(alt, want, { mode: 0o600 });
  return dir;
}

export interface ParkInput {
  home: string;
  /** the commit subject (trailer-shaped lines are stripped) */
  message: string;
  /** `<id>@<hash8>` for the Gnomon-Loop trailer */
  loopTrailer: string;
  env?: Record<string, string>;
  now?: () => number;
}

export interface Parked {
  sha: string;
  ref: string;
  parkRepo: string;
  changes: ScratchChange[];
  /** the diff for the card (SCRATCH_DIFF_CHARS) */
  diff: string;
  diffTruncated: boolean;
  /** the diff scanned for land hazards (SCRATCH_SCAN_CHARS; past it the scan is incomplete and the run proposes) */
  scanDiff: string;
  scanComplete: boolean;
}

/** the diff the kernel scans for suppression markers (characters) */
export const SCRATCH_SCAN_CHARS = 8 * 1024 * 1024;

/** Strip trailer-shaped lines (`Key: value`) from a loop-supplied message (§3.2); the kernel appends its own last. */
export function stripTrailers(message: string): string {
  return message.split('\n').filter((l) => !/^[A-Za-z][A-Za-z0-9-]*:\s/.test(l.trim())).join('\n').trim();
}

/**
 * Park the scratch's work as a commit on HEAD at `refs/gnomon/loops/<id>/<runId>` in the kernel-owned park repo.
 * Returns null when the run changed nothing.
 */
export function parkScratch(s: Readonly<Scratch>, i: ParkInput): Parked | null {
  const changes = scratchChanges(s);
  if (!changes.length) return null;
  const env = i.env ?? hardenedGitEnv();
  const dir = ensureParkRepo(i.home, s, env);
  const index = path.join(s.runDir, 'park.index');
  fs.rmSync(index, { force: true });
  const genv = { ...env, GIT_INDEX_FILE: index };
  const g = (args: string[], extra: Partial<GitCall> = {}) => hardenedGit(args, { gitDir: dir, env: genv, ...extra });
  g(['read-tree', s.headSha]);
  const lines: string[] = [];
  let total = 0;
  for (const c of changes) {
    if (c.status === 'deleted') {
      lines.push(`0 ${'0'.repeat(s.objectFormat === 'sha256' ? 64 : 40)}\t${c.path}`);
      continue;
    }
    const p = path.join(s.tree, ...c.path.split('/'));
    // Aegis M1/L4/L5: no link followed, no FIFO, capped; the bytes must be the ones scratchChanges hashed
    const content = readScratchEntry(p, c.mode!, PARK_LIMITS.maxFileBytes);
    total += content.length;
    if (total > PARK_LIMITS.maxTotalBytes) throw new GitRefusal('too-large', `the change is over ${PARK_LIMITS.maxTotalBytes} bytes`);
    if (blobId(content, s.objectFormat) !== c.oid) throw new GitRefusal('escape', `${c.path} changed after it was scanned: refused`);
    const oid = g(['hash-object', '-w', '--no-filters', '--stdin'], { input: content }).stdout.toString('utf8').trim();
    if (oid !== c.oid) throw new GitRefusal('git-failed', `hash-object disagreed for ${c.path}`);
    lines.push(`${c.mode} ${oid}\t${c.path}`);
  }
  g(['update-index', '-z', '--index-info'], { input: lines.join('\0') + '\0' });
  const treeOid = g(['write-tree']).stdout.toString('utf8').trim();
  const when = `${Math.floor((i.now?.() ?? Date.now()) / 1000)} +0000`;
  const ident = { GIT_AUTHOR_NAME: 'Gnomon Loop', GIT_AUTHOR_EMAIL: `loop+${s.loopId}@gnomon.invalid`, GIT_AUTHOR_DATE: when, GIT_COMMITTER_NAME: 'Gnomon Loop', GIT_COMMITTER_EMAIL: `loop+${s.loopId}@gnomon.invalid`, GIT_COMMITTER_DATE: when };
  const msg = `${stripTrailers(i.message) || `loop ${s.loopId}: proposed change`}\n\nGnomon-Loop: ${i.loopTrailer}\nGnomon-Run: ${s.runId}\n`;
  const sha = hardenedGit(['-c', 'commit.gpgSign=false', 'commit-tree', '--no-gpg-sign', treeOid, '-p', s.headSha, '-F', '-'], { gitDir: dir, env: { ...genv, ...ident }, input: msg }).stdout.toString('utf8').trim();
  if (!OID.test(sha)) throw new GitRefusal('git-failed', 'commit-tree returned no id');
  const ref = `${PARK_REF_PREFIX}${s.loopId}/${s.runId}`;
  g(['update-ref', ref, sha, '']);
  fs.rmSync(index, { force: true });
  const raw = g(['diff-tree', '-p', '--no-renames', '--no-ext-diff', '--no-textconv', '--no-color', s.headSha, sha], { maxBuffer: 256 * 1024 * 1024 }).stdout.toString('utf8');
  const diffTruncated = raw.length > SCRATCH_DIFF_CHARS;
  return { sha, ref, parkRepo: dir, changes, diff: diffTruncated ? raw.slice(0, SCRATCH_DIFF_CHARS) : raw, diffTruncated, scanDiff: raw.slice(0, SCRATCH_SCAN_CHARS), scanComplete: raw.length <= SCRATCH_SCAN_CHARS };
}

/** Delete a parked ref (a rejected proposal); false when it is gone already. */
export function dropParkedRef(home: string, repo: string, ref: string): boolean {
  if (!ref.startsWith(PARK_REF_PREFIX)) return false;
  const dir = parkRepoDir(fs.realpathSync.native(home), repo);
  if (!fs.existsSync(dir)) return false;
  return hardenedGit(['update-ref', '-d', ref], { gitDir: dir, allowFail: true }).status === 0;
}

/** Remove a run's scratch tree (the parked commit holds its work). */
export function removeScratch(s: Readonly<Scratch>): void {
  LIVE.delete(s.runId);
  fs.rmSync(s.runDir, { recursive: true, force: true });
}

/** Retention: scratch run dirs and parked refs older than `maxAgeMs` (never a live scratch). Returns what went. */
export function sweepLoopScratch(home: string, maxAgeMs: number, now: number = Date.now()): string[] {
  const gone: string[] = [];
  let work: string;
  try {
    work = fs.realpathSync.native(loopWorkDir(home));
  } catch {
    return gone;
  }
  const live = new Set([...LIVE.values()].map((s) => s.runDir));
  for (const e of fs.readdirSync(work, { withFileTypes: true })) {
    if (!e.isDirectory() || !e.name.startsWith('act-')) continue;
    const p = path.join(work, e.name);
    if (live.has(p)) continue;
    if (now - fs.statSync(p).mtimeMs > maxAgeMs) {
      fs.rmSync(p, { recursive: true, force: true });
      gone.push(p);
    }
  }
  const park = path.join(work, 'park');
  if (!fs.existsSync(park)) return gone;
  for (const e of fs.readdirSync(park, { withFileTypes: true })) {
    if (!e.isDirectory() || !e.name.endsWith('.git')) continue;
    const dir = path.join(park, e.name);
    const refs = hardenedGit(['for-each-ref', '--format=%(refname) %(committerdate:unix)', PARK_REF_PREFIX], { gitDir: dir, allowFail: true }).stdout.toString('utf8');
    for (const line of refs.split('\n')) {
      const [ref, at] = line.split(' ');
      if (!ref || !at || now - Number(at) * 1000 <= maxAgeMs) continue;
      if (hardenedGit(['update-ref', '-d', ref], { gitDir: dir, allowFail: true }).status === 0) gone.push(`${dir}#${ref}`);
    }
  }
  return gone;
}
