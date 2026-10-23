/**
 * @symbol #loop-land
 * @symbol #loop-git
 *
 * The land step's git and file mechanics (docs/specs/gnomon-loops.md §3.2 "Landing", LL4, threat 37; build plan step
 * 11, LP6b; G-LOOP-07, G-LOOP-09, G-LOOP-24, G-LOOP-25). `landCommit` moves ONE parked loop commit (step 10's park
 * repo) onto the branch the run started on, as a path-disjoint fast-forward, under the repo's land lock:
 *
 *   1. Fast refusals: a merge, rebase, cherry-pick, revert or bisect in progress, `index.lock` present, a human turn
 *      in flight (all `waitable`: the lander retries them until `land.maxWaitMin`).
 *   2. The LAND LOCK: the per-repo in-process mutex (one land at a time per repo, `withLandLock`) AND the human's own
 *      `<gitDir>/index.lock`, taken O_CREAT|O_EXCL exactly as git takes it. While the kernel holds it no git command
 *      of the human's can write the index, check out, commit or switch branch; it is released by renaming the new
 *      index over `index` (git's lockfile protocol) or by unlinking it (only if it is still our inode).
 *   3. Under the lock, refusals (each lands nothing, G-LOOP-24): HEAD is not the symbolic ref the run started on
 *      (`symbolic-ref`; a detached HEAD or another branch), the branch moved since the run's base (no rebase in 8.0),
 *      a rename (an add and a delete of the same blob), a gitlink at or above a touched path, a `.git` component, a
 *      control or bidi character, a case or Unicode-normalization collision with any index path, an unmerged,
 *      assume-unchanged or skip-worktree index entry, a staged change on a touched path, an untracked or ignored
 *      file where an add lands, any `.gitattributes` attribute on a touched path (and core.autocrlf / core.eol /
 *      core.splitIndex / core.sparseCheckout, which change what a checkout writes), and a worktree file whose bytes
 *      or exec bit differ from the BASE blob (the human's edit: never overwritten, G-LOOP-07).
 *   4. Objects: the land commit is re-made in the park repo with the kernel identity and trailers (§3.2, D3), then
 *      every object `rev-list --objects <land> --not <base>` names is read raw from the park repo, its id re-hashed
 *      in the kernel, and written into the human store with `hash-object -w` (blobs --no-filters; trees and commits
 *      validated by git). `rev-list --objects --missing=error` in the human repo must then pass. This is the one
 *      place the human `.git` is written besides the ref and the index, and it is under the lock.
 *   5. `beforeLand` (the kernel-signed `loop.landed{runId, sha, paths}` row) is awaited BEFORE any visible change:
 *      a commit or file change is the loop's own only through that row (G-LOOP-15), never its trailer.
 *   6. Files, each in a parent dir guarded by `DirGuard` (every component lstat'd a real directory, never a link;
 *      realpath equal to `<repo>/<dir>`; the dir's inode held open and re-compared before and after each step): a
 *      modified or deleted file is MOVED ASIDE (rename to a random name in the same dir), its bytes compared to the
 *      base blob again (O_NOFOLLOW|O_NONBLOCK, fstat a regular file), then the new bytes, already written to a temp
 *      file (O_CREAT|O_EXCL|O_NOFOLLOW, the blob's mode, the old file's permission bits kept, no exec bit the blob
 *      does not carry), are LINKED into place: link() never replaces, so a file the human recreates in between is
 *      never overwritten. A symlink is created with symlink() (also no-replace). Any mismatch rolls every placed
 *      file back from its moved-aside original and lands nothing (G-LOOP-25).
 *   7. The index: a copy (its mtime the original's, rounded down: racy git, Aegis H2) updated with
 *      `update-index --index-info` for the touched paths only (private GIT_INDEX_FILE), written fully into the held
 *      `index.lock`, fsync'd, read back and its trailer checksum verified, all BEFORE the ref moves (Aegis H1).
 *   8. The ref: `update-ref <headRef> <new> <base>` (compare-and-swap), then `symbolic-ref` again, then the lock
 *      renamed over `index`. A switched HEAD or a failed rename swaps the ref back and rolls the files back; an undo
 *      CAS that fails (the ref moved again) leaves the files and reports a conflict (Aegis L2).
 * Read-only queries (config, check-attr, check-ignore) see the human's own global, XDG and system git config
 * (Aegis M2); every write call keeps the clean env.
 * Every git call is hardenedGit (the pinned absolute git, no hooks, no fsmonitor, no protocol, a clean env) with
 * GIT_CEILING_DIRECTORIES and GIT_LITERAL_PATHSPECS; no checkout, no filter, no hook ever runs.
 */
import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LoopLandWaitReason } from '@a-company/gnomon-contracts';
import { GitRefusal, hardenedGit, hardenedGitEnv, PARK_LIMITS, stripTrailers, unsafeComponent, type ManifestEntry } from './scratch.js';

const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const HEAD_REF = /^refs\/heads\/[^\s\0~^:?*[\\]+$/;
const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;
const NONBLOCK = fs.constants.O_NONBLOCK ?? 0;
const DIRECTORY = fs.constants.O_DIRECTORY ?? 0;
/** in-progress markers in the worktree's git dir (§3.2: merge, rebase, cherry-pick, revert, bisect) */
const IN_PROGRESS = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'REBASE_HEAD', 'rebase-merge', 'rebase-apply', 'BISECT_LOG', 'sequencer'];
/** objects a land may carry (the park caps bound the blobs) */
export const LAND_MAX_OBJECTS = 20_000;

export type LandStep = 'locked' | 'checked' | 'objects' | 'staged' | 'landed-row' | 'placed' | 'index-written' | 'ref-moved';

export interface LandTrailers {
  /** the human the loop acts for (who trusted it) */
  onBehalfOf: string;
  /** the loop-trust card */
  trustedBy: string;
  /** `<id>@<hash8>` */
  loop: string;
  /** the loop definition's author (`file` or an agent principal) */
  authoredBy: string;
}

export interface LandCommitInput {
  /** the human repo (its top level) */
  repo: string;
  /** step 10's park repo for this repo */
  parkRepo: string;
  /** the parked commit (refs/gnomon/loops/<id>/<runId>) */
  parkedSha: string;
  /** the HEAD the run's scratch was read from */
  baseSha: string;
  /** the symbolic ref HEAD named when the run started */
  headRef: string;
  loopId: string;
  runId: string;
  /** land.message (trailer-shaped lines are stripped; a `Symbols:` line's symbols are kept) */
  message: string;
  trailers: LandTrailers;
  /** a human attended session in the repo has a turn in flight */
  humanBusy?: () => boolean;
  /** writes the kernel-signed loop.landed row; awaited BEFORE the ref or any file moves; a throw lands nothing */
  beforeLand: (l: { sha: string; paths: string[]; ref: string; baseSha: string }) => Promise<void>;
  env?: Record<string, string>;
  now?: () => number;
  /** TEST seam: called at named points of the land (a TOCTOU swap, a concurrent edit) */
  step?: (name: LandStep, info: { repo: string; paths: string[] }) => void;
  /**
   * The human's own git environment for the READ-ONLY queries (config, check-attr, check-ignore): their global and
   * XDG config and attributes decide what a checkout would write (Aegis M2). Default: the kernel's HOME and
   * XDG_CONFIG_HOME. The system config is read too. Write calls keep the clean env.
   */
  userEnv?: { HOME?: string; XDG_CONFIG_HOME?: string };
  /** where a moved-aside original that changed after its check is kept (Aegis L3); default: left beside the file */
  recoverDir?: string;
  /** TEST seam: the index write and the final rename (a short write, ENOSPC, a failing rename) */
  io?: { writeSync?: (fd: number, buf: Buffer, off: number, len: number) => number; renameSync?: (from: string, to: string) => void };
}

export type LandResult =
  | { landed: true; sha: string; parkedSha: string; baseSha: string; ref: string; paths: string[]; /** originals that changed after their check, kept */ recovered?: string[] }
  | {
      landed: false; reason: LoopLandWaitReason; detail: string; waitable: boolean;
      /** the landed row was written, then everything was put back */ undone?: true; sha?: string;
      /** the ref could not be swapped back (someone moved it): the files were left as placed (Aegis L2) */ conflict?: true;
      recovered?: string[];
    };

class Refused extends Error {
  constructor(readonly reason: LoopLandWaitReason, readonly detail: string, readonly waitable = false) {
    super(detail);
  }
}

const show = (p: string): string => JSON.stringify(p.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (c) => `\\u{${c.codePointAt(0)!.toString(16)}}`)).slice(0, 160);
const foldKey = (p: string): string => p.normalize('NFD').toLowerCase();
function isDotGit(c: string): boolean {
  const x = c.toLowerCase().replace(/[. ]+$/, '');
  return x === '.git' || x === 'git~1';
}

/** A git object id of `type` over `bytes` (sha1, or sha256 for a sha256 repo). */
export function objectId(type: string, bytes: Buffer, algo: 'sha1' | 'sha256'): string {
  return createHash(algo).update(`${type} ${bytes.length}\0`).update(bytes).digest('hex');
}

// ── the land lock (one land at a time per repo, in this kernel) ──────────────────────────────────────────────────
const LOCKS = new Map<string, Promise<unknown>>();

/** Run `fn` under the repo's in-process land lock (serialized per repo realpath). */
export function withLandLock<T>(repo: string, fn: () => Promise<T>): Promise<T> {
  const prev = LOCKS.get(repo) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  const tail = next.catch(() => undefined);
  LOCKS.set(repo, tail);
  void tail.then(() => {
    if (LOCKS.get(repo) === tail) LOCKS.delete(repo);
  });
  return next;
}

// ── trailers and the commit message (§3.2 Commits, D3) ───────────────────────────────────────────────────────────

/** A trailer value: one line of printable ASCII (anything else is `?`), at most 200 characters. */
export function trailerValue(v: string): string {
  return (v.replace(/[^\x20-\x7e]/g, '?').trim() || '?').slice(0, 200);
}

const SYMBOL = /^[#$^!~][a-z0-9][a-z0-9-]{0,63}$/;

/** The land commit's message: the loop's text with trailer-shaped lines stripped, then the kernel's trailers LAST. */
export function landMessage(message: string, loopId: string, runId: string, t: LandTrailers): string {
  const symbols: string[] = [];
  for (const line of message.split('\n')) {
    const m = /^\s*Symbols:\s*(.*)$/.exec(line);
    if (!m) continue;
    for (const s of m[1]!.split(/[\s,]+/)) if (SYMBOL.test(s) && !symbols.includes(s) && symbols.length < 32) symbols.push(s);
  }
  const body = stripTrailers(message) || `loop ${loopId}: change`;
  const trailers = [
    `On-Behalf-Of: ${trailerValue(t.onBehalfOf)}`,
    `Trusted-By: ${trailerValue(t.trustedBy)}`,
    `Gnomon-Loop: ${trailerValue(t.loop)}`,
    `Gnomon-Run: ${trailerValue(runId)}`,
    `Loop-Authored-By: ${trailerValue(t.authoredBy)}`,
    ...(symbols.length ? [`Symbols: ${symbols.join(', ')}`] : []),
  ];
  return `${body}\n\n${trailers.join('\n')}\n`;
}

// ── the parent-directory guard (no symlinked parent, realpath inside the repo, the inode held) ──────────────────

export class DirGuard {
  readonly #held = new Map<string, { fd: number; dev: number; ino: number }>();
  constructor(readonly root: string) {}

  /** Verify `relDir` (POSIX, '' = the root): every component a real directory, the realpath exact, the inode held. */
  verify(relDir: string): string {
    let cur = this.root;
    const comps = relDir ? relDir.split('/') : [];
    const rst = fs.lstatSync(cur);
    if (!rst.isDirectory() || rst.isSymbolicLink()) throw new Refused('bytes-changed', 'the repo root is not a real directory');
    for (const c of comps) {
      cur = path.join(cur, c);
      const st = fs.lstatSync(cur, { throwIfNoEntry: false });
      if (!st || !st.isDirectory() || st.isSymbolicLink()) throw new Refused('bytes-changed', `${show(relDir)} passes through a link or a non-directory (a parent was swapped or is not a real directory)`);
    }
    let real: string;
    try {
      real = fs.realpathSync.native(cur);
    } catch {
      throw new Refused('bytes-changed', `${show(relDir)} vanished during the land`);
    }
    if (real !== cur) throw new Refused('bytes-changed', `${show(relDir)} resolves outside the repo (${show(real)})`);
    const st = fs.lstatSync(cur);
    const h = this.#held.get(relDir);
    if (h) {
      if (st.dev !== h.dev || st.ino !== h.ino) throw new Refused('bytes-changed', `${show(relDir || '.')} was replaced during the land`);
    } else {
      const fd = fs.openSync(cur, fs.constants.O_RDONLY | DIRECTORY | NOFOLLOW);
      const fst = fs.fstatSync(fd);
      if (fst.dev !== st.dev || fst.ino !== st.ino || !fst.isDirectory()) {
        fs.closeSync(fd);
        throw new Refused('bytes-changed', `${show(relDir || '.')} was replaced during the land`);
      }
      this.#held.set(relDir, { fd, dev: st.dev, ino: st.ino });
    }
    return cur;
  }

  /** The deepest existing prefix of `relDir` is verified; returns the components still to create. */
  missing(relDir: string): string[] {
    const comps = relDir ? relDir.split('/') : [];
    for (let k = comps.length; k >= 0; k--) {
      const pre = comps.slice(0, k).join('/');
      const st = fs.lstatSync(path.join(this.root, ...(pre ? pre.split('/') : [])), { throwIfNoEntry: false });
      if (st) {
        this.verify(pre);
        return comps.slice(k);
      }
    }
    return comps;
  }

  /** Create `relDir` one component at a time (0755), each verified after; records what it created. */
  mkdirs(relDir: string, created: string[]): string {
    const comps = relDir ? relDir.split('/') : [];
    for (let k = 1; k <= comps.length; k++) {
      const pre = comps.slice(0, k).join('/');
      const parent = this.verify(comps.slice(0, k - 1).join('/'));
      const abs = path.join(parent, comps[k - 1]!);
      try {
        fs.mkdirSync(abs, { mode: 0o755 });
        created.push(pre);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      }
      this.verify(pre);
    }
    return this.verify(relDir);
  }

  close(): void {
    for (const h of this.#held.values()) {
      try {
        fs.closeSync(h.fd);
      } catch {
        /* closed */
      }
    }
    this.#held.clear();
  }
}

// ── worktree reads ───────────────────────────────────────────────────────────────────────────────────────────────

interface Want {
  mode: ManifestEntry['mode'];
  bytes: Buffer;
}

/** Does the worktree entry at `abs` hold exactly `want` (null: no entry)? Never follows a link, never blocks. */
export function entryMatches(abs: string, want: Want | null): boolean {
  const st = fs.lstatSync(abs, { throwIfNoEntry: false });
  if (!want) return !st;
  if (!st) return false;
  if (want.mode === '120000') return st.isSymbolicLink() && Buffer.from(fs.readlinkSync(abs), 'utf8').equals(want.bytes);
  if (!st.isFile() || st.isSymbolicLink()) return false;
  if (((st.mode & 0o100) !== 0) !== (want.mode === '100755')) return false;
  if (st.size !== want.bytes.length) return false;
  let fd: number;
  try {
    fd = fs.openSync(abs, fs.constants.O_RDONLY | NOFOLLOW | NONBLOCK);
  } catch {
    return false;
  }
  try {
    const fst = fs.fstatSync(fd);
    if (!fst.isFile() || fst.size !== want.bytes.length) return false;
    const buf = Buffer.alloc(fst.size);
    let at = 0;
    while (at < buf.length) {
      const n = fs.readSync(fd, buf, at, buf.length - at, at);
      if (n === 0) break;
      at += n;
    }
    return at === buf.length && buf.equals(want.bytes);
  } finally {
    fs.closeSync(fd);
  }
}

// ── git helpers ──────────────────────────────────────────────────────────────────────────────────────────────────

/** `cat-file --batch` for `oids`: each object's type and bytes, its id re-hashed in the kernel. */
function catObjects(g: (args: string[], o?: { input?: string; maxBuffer?: number }) => { stdout: Buffer }, oids: readonly string[], algo: 'sha1' | 'sha256', cap: number): Map<string, { type: string; bytes: Buffer }> {
  const out = new Map<string, { type: string; bytes: Buffer }>();
  if (!oids.length) return out;
  const raw = g(['cat-file', '--batch'], { input: oids.join('\n') + '\n', maxBuffer: cap + oids.length * 160 + 1024 }).stdout;
  let at = 0;
  for (const oid of oids) {
    const nl = raw.indexOf(10, at);
    if (nl < 0) throw new GitRefusal('git-failed', 'cat-file ended early');
    const hdr = raw.subarray(at, nl).toString('utf8').split(' ');
    if (hdr[0] !== oid || hdr.length !== 3) throw new GitRefusal('git-failed', `cat-file returned ${hdr.join(' ').slice(0, 120)} for ${oid}`);
    const size = Number(hdr[2]);
    const bytes = raw.subarray(nl + 1, nl + 1 + size);
    if (bytes.length !== size || objectId(hdr[1]!, bytes, algo) !== oid) throw new GitRefusal('escape', `object ${oid} does not hash to its id`);
    out.set(oid, { type: hdr[1]!, bytes: Buffer.from(bytes) });
    at = nl + 1 + size + 1;
  }
  return out;
}

interface Change {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  oldMode?: ManifestEntry['mode'];
  oldOid?: string;
  newMode?: ManifestEntry['mode'];
  newOid?: string;
}

const FILE_MODES = new Set(['100644', '100755', '120000']);

/** The land commit's changes against the base (diff-tree -r -z --raw --no-renames), validated. */
function readChanges(raw: Buffer, zero: string): Change[] {
  const parts = raw.toString('utf8').split('\0');
  const out: Change[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const meta = parts[i]!;
    const p = parts[i + 1]!;
    if (!meta) break;
    const m = /^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) ([AMDT])$/.exec(meta);
    if (!m) throw new Refused('rename', `the land diff has an unsupported entry ${show(meta)}`);
    const [, om, nm, oo, no, st] = m;
    if (om === '160000' || nm === '160000') throw new Refused('gitlink', `${show(p)} is a gitlink (a submodule)`);
    if (st === 'A') {
      if (!FILE_MODES.has(nm!)) throw new Refused('gitlink', `${show(p)} has mode ${nm}`);
      out.push({ path: p, status: 'added', newMode: nm as ManifestEntry['mode'], newOid: no! });
    } else if (st === 'D') {
      if (!FILE_MODES.has(om!)) throw new Refused('gitlink', `${show(p)} has mode ${om}`);
      out.push({ path: p, status: 'deleted', oldMode: om as ManifestEntry['mode'], oldOid: oo! });
    } else {
      if (!FILE_MODES.has(om!) || !FILE_MODES.has(nm!)) throw new Refused('gitlink', `${show(p)} has mode ${om} → ${nm}`);
      out.push({ path: p, status: 'modified', oldMode: om as ManifestEntry['mode'], oldOid: oo!, newMode: nm as ManifestEntry['mode'], newOid: no! });
    }
    if (no !== zero && !OID.test(no!)) throw new Refused('rename', `bad object id for ${show(p)}`);
  }
  return out;
}

// ── landCommit ───────────────────────────────────────────────────────────────────────────────────────────────────

interface Placed {
  c: Change;
  rel: string;
  relDir: string;
  dst: string;
  /** the moved-aside original (modified, deleted) */
  bak?: string;
  /** the new entry is in place */
  placed: boolean;
  /** the loop's new entry (null: a delete) */
  next: Want | null;
  /** the base entry (null: an add) */
  old: Want | null;
}

/**
 * Land a parked loop commit on the human's branch (see the header). Never throws for a refusal: it returns
 * `{landed:false, reason, detail, waitable}`; a GitRefusal from a git call is a non-waitable refusal too.
 */
export function landCommit(i: LandCommitInput): Promise<LandResult> {
  let repo: string;
  try {
    repo = fs.realpathSync.native(i.repo);
  } catch {
    return Promise.resolve({ landed: false, reason: 'held', detail: 'the repo is gone', waitable: false });
  }
  return withLandLock(repo, () => landLocked(i, repo));
}

async function landLocked(i: LandCommitInput, repo: string): Promise<LandResult> {
  if (!OID.test(i.parkedSha) || !OID.test(i.baseSha)) return { landed: false, reason: 'held', detail: 'bad commit ids', waitable: false };
  if (!HEAD_REF.test(i.headRef) || i.headRef.split('/').some((c) => c === '' || c === '.' || c === '..' || c.endsWith('.lock'))) return { landed: false, reason: 'branch-moved', detail: 'the run started on a detached HEAD', waitable: false };
  const algo: 'sha1' | 'sha256' = i.baseSha.length === 64 ? 'sha256' : 'sha1';
  const zero = '0'.repeat(i.baseSha.length);
  const env: Record<string, string> = { ...(i.env ?? hardenedGitEnv()), GIT_CEILING_DIRECTORIES: path.dirname(repo), GIT_LITERAL_PATHSPECS: '1' };
  // read-only queries see the human's own global, XDG and system config and attributes (Aegis M2)
  const { GIT_CONFIG_GLOBAL: _g, GIT_CONFIG_NOSYSTEM: _s, GIT_ATTR_NOSYSTEM: _a, ...readBase } = env;
  const home = i.userEnv?.HOME ?? process.env.HOME;
  const xdg = i.userEnv?.XDG_CONFIG_HOME ?? process.env.XDG_CONFIG_HOME;
  const readEnv: Record<string, string> = { ...readBase, ...(home ? { HOME: home } : {}), ...(xdg ? { XDG_CONFIG_HOME: xdg } : {}) };
  const hg = (args: string[], o: { input?: string | Buffer; maxBuffer?: number; allowFail?: boolean; env?: Record<string, string> } = {}) => hardenedGit(args, { cwd: repo, env: o.env ?? env, ...(o.input !== undefined ? { input: o.input } : {}), ...(o.maxBuffer ? { maxBuffer: o.maxBuffer } : {}), ...(o.allowFail ? { allowFail: true } : {}) });
  const pg = (args: string[], o: { input?: string | Buffer; maxBuffer?: number; allowFail?: boolean; env?: Record<string, string> } = {}) => hardenedGit(args, { gitDir: i.parkRepo, env: o.env ?? (i.env ?? hardenedGitEnv()), ...(o.input !== undefined ? { input: o.input } : {}), ...(o.maxBuffer ? { maxBuffer: o.maxBuffer } : {}), ...(o.allowFail ? { allowFail: true } : {}) });
  const step = (name: LandStep, paths: string[] = []): void => i.step?.(name, { repo, paths });

  let lockFd: number | null = null;
  let lockPath = '';
  let lockIno = -1;
  let tmpIndex = '';
  const temps: string[] = [];
  const placed: Placed[] = [];
  const createdDirs: string[] = [];
  const guard = new DirGuard(repo);
  let rowWritten = false;
  let refMoved = false;
  let landSha = '';
  let failed = false;
  try {
    // ── the repo itself (as createScratch: its own top level, the kernel's uid) ──
    const top = hg(['rev-parse', '--show-toplevel'], { allowFail: true });
    if (top.status !== 0) throw new Refused('held', 'not a git working tree');
    let topReal: string;
    try {
      topReal = fs.realpathSync.native(top.stdout.toString('utf8').trim());
    } catch {
      throw new Refused('held', 'the repo top level could not be resolved');
    }
    if (topReal !== repo) throw new Refused('held', `${show(repo)} is not the top level of its git tree`);
    const gitDir = fs.realpathSync.native(hg(['rev-parse', '--absolute-git-dir']).stdout.toString('utf8').trim());
    const commonDir = fs.realpathSync.native(hg(['rev-parse', '--path-format=absolute', '--git-common-dir']).stdout.toString('utf8').trim());
    const uid = process.getuid?.();
    if (uid !== undefined) for (const d of [repo, gitDir, commonDir]) if (fs.statSync(d).uid !== uid) throw new Refused('held', `${show(d)} is not owned by this user`);
    for (const d of [gitDir, commonDir]) {
      const st = fs.lstatSync(d);
      if (!st.isDirectory() || st.isSymbolicLink()) throw new Refused('held', 'the git dir is not a real directory');
    }

    // ── fast refusals (waitable) ──
    for (const m of IN_PROGRESS) if (fs.existsSync(path.join(gitDir, m))) throw new Refused('in-progress', `${m} is present: a merge, rebase, cherry-pick, revert or bisect is in progress`, true);
    lockPath = path.join(gitDir, 'index.lock');
    if (fs.existsSync(lockPath)) throw new Refused('index-lock', 'index.lock exists (git is busy in the repo)', true);
    if (i.humanBusy?.()) throw new Refused('human-turn', 'a session in this repo has a turn in flight', true);
    const indexPath = path.join(gitDir, 'index');
    const ist = fs.lstatSync(indexPath, { throwIfNoEntry: false });
    if (!ist || !ist.isFile() || ist.isSymbolicLink()) throw new Refused('held', 'the repo has no index file');

    // ── the land commit: the parked tree on the base, the kernel's identity and trailers (D3) ──
    const parked = catObjects((a, o) => pg(a, o ?? {}), [i.parkedSha], algo, 1 << 20).get(i.parkedSha)!;
    if (parked.type !== 'commit') throw new Refused('held', 'the parked ref is not a commit');
    const head = parked.bytes.toString('utf8').split('\n\n')[0]!.split('\n');
    const tree = /^tree ([0-9a-f]+)$/.exec(head[0] ?? '')?.[1];
    const parents = head.filter((l) => l.startsWith('parent ')).map((l) => l.slice(7));
    if (!tree || !OID.test(tree) || parents.length !== 1 || parents[0] !== i.baseSha) throw new Refused('held', 'the parked commit is not one commit on the run\'s base');
    const when = `${Math.floor((i.now?.() ?? Date.now()) / 1000)} +0000`;
    const ident = { GIT_AUTHOR_NAME: 'Gnomon Loop', GIT_AUTHOR_EMAIL: `loop+${i.loopId}@gnomon.invalid`, GIT_AUTHOR_DATE: when, GIT_COMMITTER_NAME: 'Gnomon Loop', GIT_COMMITTER_EMAIL: `loop+${i.loopId}@gnomon.invalid`, GIT_COMMITTER_DATE: when };
    landSha = pg(['-c', 'commit.gpgSign=false', 'commit-tree', '--no-gpg-sign', tree, '-p', i.baseSha, '-F', '-'], { env: { ...(i.env ?? hardenedGitEnv()), ...ident }, input: landMessage(i.message, i.loopId, i.runId, i.trailers) }).stdout.toString('utf8').trim();
    if (!OID.test(landSha)) throw new Refused('held', 'commit-tree returned no id');

    // ── THE LOCK: the human's index.lock, exactly as git takes it ──
    try {
      lockFd = fs.openSync(lockPath, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, 0o644);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new Refused('index-lock', 'index.lock exists (git is busy in the repo)', true);
      throw err;
    }
    lockIno = fs.fstatSync(lockFd).ino;
    step('locked');
    // Aegis L1: a merge or rebase that started between the fast check and the lock
    for (const m of IN_PROGRESS) if (fs.existsSync(path.join(gitDir, m))) throw new Refused('in-progress', `${m} is present: a merge, rebase, cherry-pick, revert or bisect is in progress`, true);

    // ── under the lock: the branch ──
    const sym = hg(['symbolic-ref', '-q', 'HEAD'], { allowFail: true });
    const symRef = sym.status === 0 ? sym.stdout.toString('utf8').trim() : null;
    if (symRef === null) throw new Refused('branch-moved', 'HEAD is detached');
    if (symRef !== i.headRef) throw new Refused('branch-moved', `HEAD is on ${show(symRef)}, the run started on ${show(i.headRef)}`);
    const tip = hg(['rev-parse', '--verify', '-q', `${i.headRef}^{commit}`], { allowFail: true }).stdout.toString('utf8').trim();
    if (tip !== i.baseSha) throw new Refused('branch-moved', `${show(i.headRef)} moved since the run's base (${i.baseSha.slice(0, 12)} → ${tip.slice(0, 12) || 'none'})`);
    // Aegis L5: the branch checked out in another worktree too (its checkout would silently fall behind)
    const wts = hg(['worktree', 'list', '--porcelain', '-z'], { allowFail: true });
    if (wts.status !== 0) throw new Refused('held', 'the worktree list could not be read');
    let wtPath = '';
    for (const line of wts.stdout.toString('utf8').split('\0')) {
      if (line.startsWith('worktree ')) wtPath = line.slice(9);
      else if (line === `branch ${i.headRef}`) {
        let real = wtPath;
        try {
          real = fs.realpathSync.native(wtPath);
        } catch {
          /* a missing worktree still holds the branch */
        }
        if (real !== repo) throw new Refused('held', `${show(i.headRef)} is also checked out in another worktree (${show(wtPath)})`);
      }
    }

    // ── the changes ──
    const changes = readChanges(pg(['diff-tree', '-r', '-z', '--raw', '--no-renames', '--no-abbrev', i.baseSha, landSha], { maxBuffer: 64 * 1024 * 1024 }).stdout, zero);
    if (!changes.length) throw new Refused('held', 'the parked commit changes nothing');
    const paths = changes.map((c) => c.path);
    for (const p of paths) {
      const comps = p.split('/');
      if (comps.some((c) => c === '' || c === '.' || c === '..' || isDotGit(c))) throw new Refused('gate-class', `${show(p)} names a .git component or an empty, . or .. segment`);
      if (comps.some(unsafeComponent)) throw new Refused('case-fold', `${show(p)} has control, format or bidi characters or a component over 255 bytes`);
    }
    // a rename: a delete and an add of the same blob
    const deletedOids = new Set(changes.filter((c) => c.status === 'deleted').map((c) => c.oldOid));
    const renamed = changes.find((c) => c.status === 'added' && deletedOids.has(c.newOid));
    if (renamed) throw new Refused('rename', `the diff renames a file to ${show(renamed.path)}`);

    // ── config that changes what a checkout writes: the human's repo, global, XDG and system config (Aegis M2) ──
    const listed = hg(['config', '--list'], { allowFail: true, env: readEnv });
    // git only WARNS about an unreadable global or system file and goes on without it: that is a refusal here
    if (listed.status !== 0 || /unable to access|permission denied/i.test(listed.stderr)) throw new Refused('attributes', `your git config could not be read (${listed.stderr.slice(0, 160)})`);
    const xdgDir = readEnv.XDG_CONFIG_HOME ?? (readEnv.HOME ? path.join(readEnv.HOME, '.config') : undefined);
    const attrFile = hg(['config', '--get', 'core.attributesFile'], { allowFail: true, env: readEnv }).stdout.toString('utf8').trim();
    const userFiles = [readEnv.HOME ? path.join(readEnv.HOME, '.gitconfig') : '', xdgDir ? path.join(xdgDir, 'git', 'config') : '', xdgDir ? path.join(xdgDir, 'git', 'attributes') : '', attrFile.startsWith('~/') && readEnv.HOME ? path.join(readEnv.HOME, attrFile.slice(2)) : attrFile];
    for (const f of userFiles) {
      if (!f || !fs.existsSync(f)) continue;
      try {
        fs.accessSync(f, fs.constants.R_OK);
      } catch {
        throw new Refused('attributes', `your git config could not be read (${show(f)})`);
      }
    }
    const cfgRaw = (k: string): string => hg(['config', '--get', k], { allowFail: true, env: readEnv }).stdout.toString('utf8').trim().toLowerCase();
    const bool = (k: string): boolean | null => {
      const r = hg(['config', '--type=bool', '--get', k], { allowFail: true, env: readEnv });
      if (r.status === 1) return null;
      if (r.status !== 0) throw new Refused('attributes', `${k} is not a boolean`);
      return r.stdout.toString('utf8').trim() === 'true';
    };
    if (cfgRaw('core.autocrlf') === 'input') throw new Refused('attributes', 'core.autocrlf is input: a raw blob would not be what a checkout writes');
    if (bool('core.autocrlf') === true) throw new Refused('attributes', 'core.autocrlf is on: a raw blob would not be what a checkout writes');
    if (cfgRaw('core.eol') === 'crlf') throw new Refused('attributes', 'core.eol is crlf');
    if (bool('core.splitindex') === true) throw new Refused('attributes', 'core.splitIndex is on');
    if (hg(['rev-parse', '--shared-index-path'], { allowFail: true }).stdout.toString('utf8').trim()) throw new Refused('attributes', 'the index is split (a shared index)');
    if (bool('core.sparsecheckout') === true) throw new Refused('attributes', 'sparse checkout is on');
    if (bool('core.symlinks') === false && changes.some((c) => c.newMode === '120000' || c.oldMode === '120000')) throw new Refused('attributes', 'core.symlinks is off and the land changes a symlink');
    const skipHash = bool('index.skiphash') === true;

    // ── the index: entries for touched paths are the base's, stage 0, no flags; no gitlink above; no collision ──
    const idx = new Map<string, { tag: string; mode: string; oid: string; stage: string }>();
    for (const rec of hg(['ls-files', '-s', '-v', '-z'], { maxBuffer: 256 * 1024 * 1024 }).stdout.toString('utf8').split('\0')) {
      if (!rec) continue;
      const tab = rec.indexOf('\t');
      const [tag, mode, oid, stage] = rec.slice(0, tab).split(' ');
      const p = rec.slice(tab + 1);
      if (stage !== '0') throw new Refused('in-progress', `${show(p)} is unmerged in the index`, true);
      idx.set(p, { tag: tag!, mode: mode!, oid: oid!, stage: stage! });
    }
    const folded = new Map<string, string>();
    for (const p of idx.keys()) {
      const parts = p.split('/');
      for (let k = 1; k <= parts.length; k++) {
        const pre = parts.slice(0, k).join('/');
        if (!folded.has(foldKey(pre))) folded.set(foldKey(pre), pre);
      }
    }
    const touchedFold = new Map<string, string>();
    for (const c of changes) {
      const parts = c.path.split('/');
      for (let k = 1; k <= parts.length; k++) {
        const pre = parts.slice(0, k).join('/');
        const other = folded.get(foldKey(pre));
        if (other !== undefined && other !== pre) throw new Refused('case-fold', `${show(c.path)} collides with ${show(other)} by case or Unicode normalization`);
        const t = touchedFold.get(foldKey(pre));
        if (t !== undefined && t !== pre) throw new Refused('case-fold', `${show(pre)} collides with ${show(t)}`);
        touchedFold.set(foldKey(pre), pre);
        if (k < parts.length) {
          const e = idx.get(pre);
          if (e?.mode === '160000') throw new Refused('gitlink', `${show(pre)} is a gitlink above ${show(c.path)}`);
          if (e) throw new Refused('dirty', `${show(pre)} is a file in the index where ${show(c.path)} needs a directory`, true);
        }
      }
      const e = idx.get(c.path);
      if (e?.mode === '160000') throw new Refused('gitlink', `${show(c.path)} is a gitlink`);
      if (c.status === 'added') {
        if (e) throw new Refused('dirty', `${show(c.path)} is already staged`, true);
        const prefix = `${c.path}/`;
        for (const p of idx.keys()) if (p.startsWith(prefix)) throw new Refused('dirty', `${show(c.path)} is a directory in the index`, true);
      } else {
        if (!e) throw new Refused('dirty', `${show(c.path)} is not in the index (a staged delete)`, true);
        if (e.tag !== 'H') throw new Refused('dirty', `${show(c.path)} is assume-unchanged or skip-worktree in the index`);
        if (e.mode !== c.oldMode || e.oid !== c.oldOid) throw new Refused('dirty', `${show(c.path)} has a staged change`, true);
      }
    }

    // ── attributes and ignores (read only: check-attr and check-ignore run no filter) ──
    const attrs = hg(['check-attr', '-a', '-z', '--stdin'], { input: paths.join('\0') + '\0', env: readEnv }).stdout.toString('utf8');
    if (attrs.length) {
      const first = attrs.split('\0');
      throw new Refused('attributes', `${show(first[0] ?? '')} has a .gitattributes entry (${show(`${first[1] ?? ''}=${first[2] ?? ''}`)})`);
    }
    const added = changes.filter((c) => c.status === 'added');
    if (added.length) {
      // check-ignore takes paths, not pathspecs (it refuses GIT_LITERAL_PATHSPECS)
      const { GIT_LITERAL_PATHSPECS: _lit, ...plain } = readEnv;
      const ign = hg(['check-ignore', '-z', '--stdin'], { input: added.map((c) => c.path).join('\0') + '\0', allowFail: true, env: plain });
      if (ign.status !== 0 && ign.status !== 1) throw new Refused('held', `check-ignore failed: ${ign.stderr.slice(0, 160)}`);
      const hit = ign.stdout.toString('utf8').split('\0').filter(Boolean);
      if (hit.length) throw new Refused('ignored', `${show(hit[0]!)} is ignored in the checkout`);
    }

    // ── the bytes: the base blobs (human store) and the new ones (park), each re-hashed ──
    const oldOids = [...new Set(changes.filter((c) => c.oldOid && c.oldMode).map((c) => c.oldOid!))];
    const newOids = [...new Set(changes.filter((c) => c.newOid && c.newMode).map((c) => c.newOid!))];
    const base = catObjects((a, o) => hg(a, o ?? {}), oldOids, algo, PARK_LIMITS.maxTotalBytes * 2);
    const next = catObjects((a, o) => pg(a, o ?? {}), newOids, algo, PARK_LIMITS.maxTotalBytes * 2);
    const wantOld = (c: Change): Want | null => (c.oldOid && c.oldMode ? { mode: c.oldMode, bytes: base.get(c.oldOid)!.bytes } : null);
    const wantNew = (c: Change): Want | null => (c.newOid && c.newMode ? { mode: c.newMode, bytes: next.get(c.newOid)!.bytes } : null);
    for (const c of changes) {
      if (c.oldOid && base.get(c.oldOid)?.type !== 'blob') throw new Refused('held', `${show(c.path)}: the base object is not a blob`);
      if (c.newOid && next.get(c.newOid)?.type !== 'blob') throw new Refused('held', `${show(c.path)}: the new object is not a blob`);
    }

    // ── the worktree: every parent a real dir inside the repo; every touched entry still the base's (G-LOOP-07) ──
    const oldPerm = new Map<string, number>();
    for (const c of changes) {
      const relDir = path.posix.dirname(c.path) === '.' ? '' : path.posix.dirname(c.path);
      const dst = path.join(repo, ...c.path.split('/'));
      if (c.status === 'added') {
        const missing = guard.missing(relDir);
        if (!missing.length && fs.lstatSync(dst, { throwIfNoEntry: false })) throw new Refused('untracked', `${show(c.path)} exists untracked in the checkout`, true);
        continue;
      }
      guard.verify(relDir);
      if (!entryMatches(dst, wantOld(c))) throw new Refused('dirty', `${show(c.path)} has uncommitted changes in the checkout`, true);
      oldPerm.set(c.path, fs.lstatSync(dst).mode & 0o777);
    }
    step('checked', paths);

    // ── objects into the human store (verified), then rev-list --missing=error ──
    const objs = pg(['rev-list', '--objects', '--no-object-names', landSha, '--not', i.baseSha], { maxBuffer: 16 * 1024 * 1024 }).stdout.toString('utf8').split('\n').filter(Boolean);
    if (objs.length > LAND_MAX_OBJECTS) throw new Refused('held', `the land carries more than ${LAND_MAX_OBJECTS} objects`);
    if (objs.some((o) => !OID.test(o))) throw new Refused('held', 'rev-list returned a bad id');
    const raw = catObjects((a, o) => pg(a, o ?? {}), objs, algo, PARK_LIMITS.maxTotalBytes * 2);
    const order = (t: string): number => (t === 'blob' ? 0 : t === 'tree' ? 1 : 2);
    for (const oid of [...objs].sort((a, b) => order(raw.get(a)!.type) - order(raw.get(b)!.type))) {
      const o = raw.get(oid)!;
      if (o.type !== 'blob' && o.type !== 'tree' && o.type !== 'commit') throw new Refused('held', `object ${oid} is a ${o.type}`);
      const wrote = hg(['hash-object', '-t', o.type, '-w', ...(o.type === 'blob' ? ['--no-filters'] : []), '--stdin'], { input: o.bytes }).stdout.toString('utf8').trim();
      if (wrote !== oid) throw new Refused('held', `hash-object disagreed for ${oid}`);
    }
    if (hg(['rev-list', '--objects', '--missing=error', landSha, '--not', i.baseSha], { allowFail: true, maxBuffer: 16 * 1024 * 1024 }).status !== 0) throw new Refused('held', 'the land commit\'s objects are not all in the repo');
    step('objects', paths);

    // ── the new index (a private copy; written into the held index.lock at the end) ──
    tmpIndex = path.join(gitDir, `gnomon-land-${randomBytes(8).toString('hex')}.index`);
    fs.copyFileSync(indexPath, tmpIndex, fs.constants.COPYFILE_EXCL);
    // Aegis H2 (racy git): the copy keeps the original's mtime, rounded down to the second, so an entry that was racily
    // clean in the human's index stays racy (update-index smudges it) instead of looking clean against a newer stamp.
    // copyFile does not keep it on macOS (measured), so it is set whatever the platform does.
    const ist0 = fs.statSync(indexPath);
    const stamp = Math.floor(ist0.mtimeMs / 1000);
    fs.utimesSync(tmpIndex, stamp, stamp);
    const lines = changes.map((c) => (c.status === 'deleted' ? `0 ${zero}\t${c.path}` : `${c.newMode} ${c.newOid}\t${c.path}`));
    hg(['update-index', '-z', '--index-info'], { input: lines.join('\0') + '\0', env: { ...env, GIT_INDEX_FILE: tmpIndex } });

    step('staged', paths);

    // ── G-LOOP-15: the kernel-signed loop.landed row BEFORE the ref or any file moves ──
    await i.beforeLand({ sha: landSha, paths, ref: i.headRef, baseSha: i.baseSha });
    rowWritten = true;
    step('landed-row', paths);

    // ── place each file: its new bytes into a temp file in the same dir (created only now, so a swap caught at
    // the first verify leaves nothing behind), the original moved aside and compared to the base again, the new
    // bytes linked in (no-replace) ──
    for (const c of changes) {
      const relDir = path.posix.dirname(c.path) === '.' ? '' : path.posix.dirname(c.path);
      const dir = c.status === 'added' ? guard.mkdirs(relDir, createdDirs) : guard.verify(relDir);
      const dst = path.join(dir, path.posix.basename(c.path));
      let tmp: string | null = null;
      if (c.status !== 'deleted' && c.newMode !== '120000') {
        tmp = path.join(dir, `.gnomon-land-${randomBytes(8).toString('hex')}.tmp`);
        const exec = c.newMode === '100755';
        const prev = oldPerm.get(c.path);
        // the old file's permission bits kept; exec bits only where the blob mode says so (read bits shifted)
        const perm = prev === undefined ? (exec ? 0o755 : 0o644) : exec ? (prev & ~0o111) | ((prev & 0o444) >> 2) : prev & ~0o111;
        const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, perm);
        temps.push(tmp);
        try {
          fs.fchmodSync(fd, perm);
          fs.writeSync(fd, wantNew(c)!.bytes);
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
        guard.verify(relDir);
      }
      const pl: Placed = { c, rel: c.path, relDir, dst, placed: false, next: wantNew(c), old: wantOld(c) };
      placed.push(pl);
      if (c.status !== 'added') {
        const bak = path.join(dir, `.gnomon-land-${randomBytes(8).toString('hex')}.bak`);
        try {
          fs.renameSync(dst, bak);
        } catch {
          throw new Refused('bytes-changed', `${show(c.path)} changed during the land`);
        }
        pl.bak = bak;
        guard.verify(relDir);
        if (!entryMatches(bak, wantOld(c))) throw new Refused('bytes-changed', `${show(c.path)} changed during the land: the human's bytes stay`);
      }
      if (c.status !== 'deleted') {
        try {
          if (c.newMode === '120000') fs.symlinkSync(wantNew(c)!.bytes.toString('utf8'), dst);
          else fs.linkSync(tmp!, dst);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new Refused(c.status === 'added' ? 'untracked' : 'bytes-changed', `${show(c.path)} appeared during the land`, c.status === 'added');
          throw err;
        }
        pl.placed = true;
        guard.verify(relDir);
        if (!entryMatches(dst, wantNew(c))) throw new Refused('bytes-changed', `${show(c.path)} changed during the land`);
      }
    }
    step('placed', paths);

    // ── Aegis H1: the new index fully into the held lock and verified BEFORE the ref moves; after the CAS only the
    // rename is left, and a failed rename puts the ref and the files back ──
    const bytes = fs.readFileSync(tmpIndex);
    const write = i.io?.writeSync ?? ((fd: number, b: Buffer, off: number, len: number) => fs.writeSync(fd, b, off, len, off));
    for (let at = 0; at < bytes.length; ) {
      const n = write(lockFd, bytes, at, bytes.length - at);
      if (!(n > 0)) throw new Refused('held', 'the index could not be written (a zero-length write)');
      at += n;
    }
    fs.fsyncSync(lockFd);
    const lockSt = fs.fstatSync(lockFd);
    if (lockSt.size !== bytes.length || lockSt.ino !== lockIno) throw new Refused('held', `the index write is ${lockSt.size} of ${bytes.length} bytes`);
    const back = Buffer.alloc(bytes.length);
    for (let at = 0; at < back.length; ) {
      const n = fs.readSync(lockFd, back, at, back.length - at, at);
      if (n <= 0) break;
      at += n;
    }
    if (!indexTrailerOk(back, algo, skipHash) || !back.equals(bytes)) throw new Refused('held', 'the written index does not verify (its checksum or bytes differ)');
    step('index-written', paths);

    // ── the ref: compare-and-swap from the base, HEAD still on the run's branch after ──
    const before = hg(['symbolic-ref', '-q', 'HEAD'], { allowFail: true }).stdout.toString('utf8').trim();
    if (before !== i.headRef) throw new Refused('branch-moved', `HEAD moved to ${show(before || 'a detached HEAD')} during the land`);
    const cas = hg(['update-ref', '-m', `gnomon loop ${i.loopId}: land ${i.runId}`, i.headRef, landSha, i.baseSha], { allowFail: true, env: { ...env, ...ident } });
    if (cas.status !== 0) throw new Refused('branch-moved', `${show(i.headRef)} moved during the land (compare-and-swap failed)`);
    refMoved = true;
    const after = hg(['symbolic-ref', '-q', 'HEAD'], { allowFail: true }).stdout.toString('utf8').trim();
    if (after !== i.headRef) throw new Refused('branch-moved', `HEAD moved to ${show(after || 'a detached HEAD')} during the land`);
    step('ref-moved', paths);

    // ── the index: the verified lock renamed over `index` (git's lockfile protocol); a failure undoes the land ──
    try {
      fs.closeSync(lockFd);
      lockFd = null;
      const lst = fs.lstatSync(lockPath);
      if (lst.ino !== lockIno) throw new Error('index.lock was replaced');
      (i.io?.renameSync ?? fs.renameSync)(lockPath, indexPath);
      lockIno = -1;
    } catch (err) {
      throw new Refused('held', `the index could not be renamed into place (${err instanceof Error ? err.message.slice(0, 120) : 'failed'})`);
    }
    // ── done: the originals go, each compared with the base once more (Aegis L3: a write through an open handle
    // after the move-aside is the human's; it is kept in recoverDir, never deleted) ──
    const recovered: string[] = [];
    for (const pl of placed) {
      if (!pl.bak) continue;
      if (pl.old && entryMatches(pl.bak, pl.old)) {
        fs.rmSync(pl.bak, { force: true });
        continue;
      }
      recovered.push(keepAside(pl.bak, pl.rel, i.recoverDir, i.runId));
    }
    for (const t of temps) fs.rmSync(t, { force: true });
    for (const c of changes) {
      if (c.status !== 'deleted') continue;
      // git removes the dirs a delete empties; so does the land (rmdir: only an empty dir)
      for (let d = path.posix.dirname(c.path); d !== '.' && d !== ''; d = path.posix.dirname(d)) {
        try {
          guard.verify(d);
          fs.rmdirSync(path.join(repo, ...d.split('/')));
        } catch {
          break;
        }
      }
    }
    return { landed: true, sha: landSha, parkedSha: i.parkedSha, baseSha: i.baseSha, ref: i.headRef, paths, ...(recovered.length ? { recovered } : {}) };
  } catch (err) {
    // ── nothing lands: the ref back, every placed file back from its original ──
    const r: Refused = err instanceof Refused ? err : new Refused('held', err instanceof Error ? err.message.slice(0, 240) : 'the land failed');
    if (refMoved) {
      const undo = hg(['update-ref', '-m', `gnomon loop ${i.loopId}: undo ${i.runId}`, i.headRef, i.baseSha, landSha], { allowFail: true, env: { ...env, GIT_COMMITTER_NAME: 'Gnomon Loop', GIT_COMMITTER_EMAIL: `loop+${i.loopId}@gnomon.invalid` } });
      if (undo.status !== 0) {
        // Aegis L2: someone moved the ref after our CAS; putting the files back would desync them from it. Leave both
        // as they are and say so: the human resolves it (git status shows the state)
        return { landed: false, reason: 'branch-moved', detail: `${r.detail}; CONFLICT: ${show(i.headRef)} moved again after the land, so the land's files were left in place (check git status)`, waitable: false, conflict: true, ...(rowWritten ? { undone: true as const, sha: landSha } : {}) };
      }
    }
    failed = true;
    const notes = rollback(placed, guard, repo);
    return { landed: false, reason: r.reason, detail: notes.length ? `${r.detail}; ${notes.join('; ')}` : r.detail, waitable: r.waitable && !rowWritten, ...(rowWritten ? { undone: true as const, sha: landSha } : {}) };
  } finally {
    for (const t of temps) fs.rmSync(t, { force: true });
    // the dirs this land created, emptied again (each parent re-verified: never an rmdir through a swapped link)
    if (failed) {
      for (const d of [...createdDirs].reverse()) {
        try {
          const parent = path.posix.dirname(d) === '.' ? '' : path.posix.dirname(d);
          guard.verify(parent);
          guard.verify(d);
          fs.rmdirSync(path.join(repo, ...d.split('/')));
        } catch {
          /* not empty, gone, or no longer the dir this land created */
        }
      }
    }
    if (tmpIndex) {
      fs.rmSync(tmpIndex, { force: true });
      fs.rmSync(`${tmpIndex}.lock`, { force: true });
    }
    if (lockFd !== null) fs.closeSync(lockFd);
    if (lockIno !== -1) {
      // release the lock only if it is still ours
      const st = fs.lstatSync(lockPath, { throwIfNoEntry: false });
      if (st && st.ino === lockIno) fs.rmSync(lockPath, { force: true });
    }
    guard.close();
  }
}

/** The index trailer: the hash of everything before it, or all zeros under index.skipHash. */
export function indexTrailerOk(b: Buffer, algo: 'sha1' | 'sha256', skipHash: boolean): boolean {
  const n = algo === 'sha1' ? 20 : 32;
  if (b.length < 12 + n || b.subarray(0, 4).toString('latin1') !== 'DIRC') return false;
  const trailer = b.subarray(b.length - n);
  if (skipHash && trailer.every((x) => x === 0)) return true;
  return createHash(algo).update(b.subarray(0, b.length - n)).digest().equals(trailer);
}

/** Keep a moved-aside original the human changed: into `<recoverDir>/<runId>/<path>`, or left where it is. */
function keepAside(bak: string, rel: string, recoverDir: string | undefined, runId: string): string {
  if (!recoverDir) return bak;
  try {
    const dst = path.join(recoverDir, runId, ...rel.split('/'));
    fs.mkdirSync(path.dirname(dst), { recursive: true, mode: 0o700 });
    if (fs.lstatSync(bak).isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(bak), dst);
    else fs.copyFileSync(bak, dst, fs.constants.COPYFILE_EXCL);
    fs.rmSync(bak, { force: true });
    return dst;
  } catch {
    return bak;
  }
}

/** Put every placed entry back (newest first). Returns notes for what could not be put back (the human's bytes kept). */
function rollback(placed: Placed[], guard: DirGuard, repo: string): string[] {
  const notes: string[] = [];
  for (const pl of [...placed].reverse()) {
    try {
      guard.verify(pl.relDir);
      if (pl.placed) {
        // move the loop's entry aside; if it is no longer exactly the loop's, the human changed it: keep theirs
        const aside = path.join(path.dirname(pl.dst), `.gnomon-land-${randomBytes(8).toString('hex')}.undo`);
        fs.renameSync(pl.dst, aside);
        if (!entryMatches(aside, pl.next)) {
          restoreNoReplace(aside, pl.dst);
          notes.push(`${show(pl.rel)} was changed again; left as it is`);
          continue;
        }
        fs.rmSync(aside, { force: true });
      }
      if (pl.bak) {
        if (!restoreNoReplace(pl.bak, pl.dst)) notes.push(`${show(pl.rel)}: the original is kept at ${show(path.relative(repo, pl.bak))}`);
      }
    } catch {
      notes.push(`${show(pl.rel)} could not be put back${pl.bak ? `; the original is at ${show(path.relative(repo, pl.bak))}` : ''}`);
    }
  }
  return notes;
}

/** Move `from` to `to` without replacing an entry at `to`; false when `to` exists (both are kept). */
function restoreNoReplace(from: string, to: string): boolean {
  const st = fs.lstatSync(from);
  if (fs.lstatSync(to, { throwIfNoEntry: false })) return false;
  if (st.isSymbolicLink()) {
    fs.renameSync(from, to);
    return true;
  }
  try {
    fs.linkSync(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  }
  fs.rmSync(from, { force: true });
  return true;
}

// ── revert detection (G-LOOP-9 "Reverting one emits merge.reverted") ─────────────────────────────────────────────

export interface RevertFound {
  /** the reverting commit */
  sha: string;
  detectedBy: 'content' | 'message';
}

/**
 * Has a commit on `ref` after the landed commit `landed` reverted it? Read only: `merge-base --is-ancestor`, then
 * the commits `landed..ref` that touch its paths (at most `limit`): a commit that sets every path the land changed
 * back to its pre-land blob is a revert by CONTENT; a `This reverts commit <landed>` line is one by MESSAGE (anyone
 * can write that line, but a false revert only tightens). Returns null when there is none, or the land is not on
 * `ref` any more (a rewrite is not a revert).
 */
export function findRevert(repo: string, landed: string, ref: string, o: { env?: Record<string, string>; limit?: number } = {}): RevertFound | null {
  if (!OID.test(landed) || !HEAD_REF.test(ref)) return null;
  const real = fs.realpathSync.native(repo);
  const env = { ...(o.env ?? hardenedGitEnv()), GIT_CEILING_DIRECTORIES: path.dirname(real) };
  const g = (args: string[], allowFail = false) => hardenedGit(args, { cwd: real, env, allowFail, maxBuffer: 64 * 1024 * 1024 });
  if (g(['merge-base', '--is-ancestor', landed, ref], true).status !== 0) return null;
  const zero = '0'.repeat(landed.length);
  const own = readChanges(g(['diff-tree', '-r', '-z', '--raw', '--no-renames', '--no-abbrev', '--root', landed]).stdout.subarray(landed.length + 1), zero);
  if (!own.length) return null;
  // Aegis L6: ONE read of the commits after the land, each with its raw diff (merges carry none: never judged by
  // content). Records are \x01<sha>\x02<message>\x03\0 then the raw entries; a message holding \x01 can at most fake
  // a revert signal, which only tightens (and message-only reverts do not drive strictness in 8.1, see the plan).
  const log = g(['log', '-z', '--raw', '--no-renames', '--no-abbrev', `--max-count=${o.limit ?? 500}`, '--format=%x01%H%x02%B%x03', `${landed}..${ref}`]).stdout;
  const recs = log.toString('latin1').split('\x01').slice(1);
  let byMessage: string | null = null;
  // oldest first: the first commit that reverts it is the one reported
  for (const rec of recs.reverse()) {
    const a = rec.indexOf('\x02');
    const b = rec.lastIndexOf('\x03');
    const sha = rec.slice(0, a);
    if (a < 0 || b < a || !OID.test(sha)) continue;
    const body = Buffer.from(rec.slice(a + 1, b), 'latin1').toString('utf8');
    let rawPart = rec.slice(b + 1).replace(/^\0/, '').replace(/^\n/, '');
    const theirs = new Map<string, Change>();
    if (rawPart) {
      try {
        for (const c of readChanges(Buffer.from(rawPart, 'latin1'), zero)) theirs.set(c.path, c);
      } catch {
        /* a gitlink or odd entry: not judged by content */
      }
    }
    rawPart = '';
    const reverts = own.every((c) => {
      const t = theirs.get(c.path);
      if (!t) return false;
      if (c.status === 'added') return t.status === 'deleted' && t.oldOid === c.newOid;
      if (c.status === 'deleted') return t.status === 'added' && t.newOid === c.oldOid && t.newMode === c.oldMode;
      return t.status === 'modified' && t.oldOid === c.newOid && t.newOid === c.oldOid;
    });
    if (reverts) return { sha, detectedBy: 'content' };
    if (!byMessage && body.includes(`This reverts commit ${landed}`)) byMessage = sha;
  }
  return byMessage ? { sha: byMessage, detectedBy: 'message' } : null;
}
