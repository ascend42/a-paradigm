/**
 * @symbol #loop-check
 *
 * The loop check executor (docs/specs/gnomon-loops.md §2 check nodes, §4 "Sandboxes" and "Evidence", §7; build
 * plan step 4). One `effect: read` check node runs once, deterministically, and yields `pass | fail | error`:
 *
 * 1. COPY. `git ls-files -co --exclude-standard` (tracked + untracked-not-ignored; `core.fsmonitor` off so a repo
 *    config runs nothing) is copied into the KERNEL-OWNED run dir `<home>/loop-work/check-<runId>/repo` (0700,
 *    under the Gnomon home, which sessions cannot read; never inside the repo, so the kernel never writes through
 *    a repo path). Capped at CHECK_COPY_LIMITS (50 000 files, 500 MiB): past it the check is `error`
 *    `copy-too-large` and nothing runs. Every parent directory is lstat'd (a link or a non-directory refuses the
 *    copy), each file is read through an O_NOFOLLOW fd for at most its lstat size, and afterwards the parent chain
 *    (dev:ino), the file identity (lstat vs fstat) and the parent's realpath containment are checked again: a swap
 *    mid-copy refuses the whole copy. Repo symlinks are recreated as links (the sandbox resolves them, so one
 *    pointing out of the copy reads nothing). The Gnomon dir, node_modules and Warpline token paths are never
 *    copied. Every `node_modules` next to a copied dir is LINKED to the real one, only when its realpath is inside
 *    the repo (a link to ~/Documents would widen the reads): the profile grants it read and never write.
 * 2. ENVIRONMENT. #session-runner's allowlist and scrub (runner/env.ts buildCheckEnv): NODE_OPTIONS, GNOMON_*,
 *    ANTHROPIC_* and every non-allowlisted secret never reach the child (G-SEC-02); HOME and TMPDIR are the
 *    run's private dirs; PATH is the kernel node's dir + the system dirs (no ~/.local/bin).
 * 3. RUN. argv is exec'd directly (no shell) under the `loop-check` profile (kernel/sandbox/loop-check.ts), in
 *    its own process group; at `timeoutSec` the group gets SIGTERM, then SIGKILL after CHECK_KILL_GRACE_MS, and
 *    after any exit the group is SIGKILLed. The tree is listed every CHECK_TREE_POLL_MS through the
 *    process-control snapshot, and descendants that left the group (setsid) are SIGKILLed after it by pid and
 *    start witness. A `run` check's argv0 must still hash to its trusted pin (argv0 inside the repo is exec'd from
 *    the copy and its copy re-hashed); a script argv0 must have a pinned, unchanged interpreter (shebang.ts, the
 *    one parser shared with the registry hash), the only other exec allowed. A builtin runs as
 *    `node <paradigm cli> loop builtin <name> --json` with the digest of the CLI's whole dist dir pinned.
 * 4. VERDICT. The pass rule (check-parse.ts) on a child that exited; a crash (signal), timeout, spawn failure,
 *    pin mismatch, sandbox refusal or unparseable report is `error`; a builtin also needs its JSON verdict (exit 2
 *    or no valid verdict is `error`). A json rule's value is bounded and secret-scanned before it is returned.
 * 5. EVIDENCE. stdout and stderr tails (CHECK_EVIDENCE_TAIL_BYTES each), parsed counts and duration, run through
 *    the secret scanner (secret-scan.ts) before they are returned, and labelled `private` (sensitive).
 * 6. CLEANUP. The run dir is removed after a pass or fail; on `error` it is kept for debugging with a retention
 *    note, and sweepCheckCopies removes kept dirs past the retention window (`loops.retentionDays`).
 * Residual (8.0): a check's node_modules dependencies are not pinned (only the lockfile, via the config closure);
 * pinning them, or shipping the builtins inside Gnomon, is 8.1.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CheckPass } from '../../loops/schema.js';
import { isLifecycleRefusal } from '../lifecycle/refusal.js';
import { processControlFor } from '../lifecycle/process-control.js';
import { buildCheckEnv, defaultSessionPath, sessionIdentity, sessionNodeDir, type SessionIdentity } from '../runner/env.js';
import { LOOP_WORK_DIR, loopCheckLaunchPlan, type LoopCheckLaunchInput } from '../sandbox/loop-check.js';
import { readShebang, resolveShebangInterpreter } from './shebang.js';
import type { ChildLaunchPlan } from '../sandbox/transport.js';
import type { MacosProbe, SipProbe } from '../../platform/darwin/macos.js';
import { applyPassRule, type ParsedCounts } from './check-parse.js';
import { scanSecrets, type Redaction } from './secret-scan.js';

export const CHECK_COPY_LIMITS = Object.freeze({ maxFiles: 50_000, maxBytes: 500 * 1024 * 1024, maxNodeModules: 500 });
export const CHECK_EVIDENCE_TAIL_BYTES = 64 * 1024;
/** stdout kept for the parsers; past it a parse or json rule is `error` (output-too-large) */
export const CHECK_PARSE_MAX_BYTES = 8 * 1024 * 1024;
export const CHECK_KILL_GRACE_MS = 2_000;
/** a check's runId: one path component, no separators */
export const CHECK_RUN_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** repo-relative paths never copied (the session profile's Warpline token denies, the repo's own Gnomon dir) */
const NEVER_COPY = [/^\.gnomon(\/|$)/, /(^|\/)node_modules(\/|$)/, /^\.warpline\/keys(\/|$)/, /^\.warpline\/daemon-tokens\.jsonl$/, /^\.warpline\/daemon\/mcp-tokens\.json$/, /^\.warpline\/daemon\/mcp\.token$/, /(^|\/)\.git(\/|$)/];

export type CheckErrorReason = 'sandbox-unavailable' | 'sandbox-refused' | 'copy-too-large' | 'copy-failed' | 'pin-mismatch' | 'spawn-failed' | 'timeout' | 'crash' | 'output-too-large' | 'unparseable' | 'builtin-error' | 'bad-input' | 'killed';

/** `paradigm loop builtin` exit codes: 0 pass, 1 fail, 2 the builtin could not judge (error) */
export const BUILTIN_ERROR_EXIT = 2;

function builtinError(stdout: Buffer): string {
  try {
    const e = (JSON.parse(stdout.toString('utf8')) as { error?: unknown }).error;
    if (typeof e === 'string') return scanSecrets(`the builtin could not judge: ${e}`.slice(0, 300)).text;
  } catch {
    /* not JSON */
  }
  return 'the builtin could not judge (exit 2)';
}

export interface CheckNodeSpec {
  id: string;
  run?: readonly string[];
  builtin?: string;
  args?: Record<string, unknown>;
  pass: CheckPass;
  timeoutSec: number;
}

export interface FilePin {
  /** absolute path (realpath'd at trust) */
  real: string;
  /** hex sha256 of its bytes (with or without a `sha256:` prefix) */
  sha256: string;
}

export interface CheckExecInput {
  runId: string;
  repo: string;
  /** the Gnomon home (denied to the check) */
  home: string;
  node: CheckNodeSpec;
  /** `run` checks: argv0 as hashed at trust */
  argv0?: FilePin;
  /** `run` checks: argv0's shebang interpreter as hashed at trust (verified when given) */
  interpreter?: FilePin;
  /** builtins: the paradigm CLI entry, pinned */
  paradigmCli?: FilePin;
  /** the daemon env the child env is filtered from (default process.env) */
  envFrom?: Readonly<Record<string, string | undefined>>;
  /** default sessionIdentity() */
  identity?: SessionIdentity | null;
  /** the kernel node (default process.execPath) */
  nodePath?: string;
  userHome?: string;
  limits?: Partial<typeof CHECK_COPY_LIMITS>;
  /** keep the run dir on `error` (default true) */
  keepOnError?: boolean;
  platform?: string;
  probe?: MacosProbe;
  sip?: SipProbe;
  /**
   * #loop-runner's kill switch and pause (gnomon-loops.md §3.3): aborting kills the check's process group at once
   * (SIGKILL, then the setsid sweep) and the check is `error` `killed`. Aborted before the spawn, nothing runs.
   */
  abort?: AbortSignal;
  /** step 10 (#loop-act): copy this scratch worktree (its kernel-walked file list) instead of the repo's files */
  scratch?: { tree: string; files: readonly string[] };
}

export interface CheckEvidence {
  stdoutTail: string;
  stderrTail: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  redactions: Redaction[];
  /** evidence is never egressed and is redacted before any escalation or log.read (§4) */
  label: 'private';
  sensitive: true;
}

export interface CheckResult {
  verdict: 'pass' | 'fail' | 'error';
  reason?: CheckErrorReason;
  detail?: string;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  counts?: ParsedCounts;
  /** the json rule's value at its path */
  value?: unknown;
  evidence: CheckEvidence;
  profileHash: string | null;
  /** names only, never values */
  envKeys: string[];
  copy: { dir: string; files: number; bytes: number; kept: boolean; retention?: string };
  /** descendants that left the process group (setsid) and were killed after it (pid + start witness) */
  escapedKilled?: number;
}

export interface CheckCopy {
  /** check-<runId>/: the sandbox's read + write root */
  runDir: string;
  /** the repo copy (cwd) */
  tree: string;
  home: string;
  tmp: string;
  files: number;
  bytes: number;
  /** real node_modules dirs linked in (read only) */
  nodeModules: string[];
}

export class CheckCopyRefusal extends Error {
  constructor(readonly reason: 'copy-too-large' | 'copy-failed' | 'bad-input', message: string) {
    super(message);
  }
}

const within = (p: string, dir: string): boolean => p === dir || p.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);
const hex = (s: string): string => s.replace(/^sha256:/, '').toLowerCase();
const sha256File = (p: string): string => createHash('sha256').update(fs.readFileSync(p)).digest('hex');

/** `<home>/loop-work`: the kernel-owned parent of every check run dir (0700, a real dir, never a link). */
export function checkWorkDir(home: string): string {
  return path.join(home, LOOP_WORK_DIR);
}

export function checkRunDir(home: string, runId: string): string {
  return path.join(checkWorkDir(home), `check-${runId}`);
}

function ensureWorkDir(homeReal: string): string {
  const dir = path.join(homeReal, LOOP_WORK_DIR);
  try {
    fs.mkdirSync(dir, { mode: 0o700 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
  const st = fs.lstatSync(dir);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new CheckCopyRefusal('copy-failed', `${dir} is not a real directory (a link or swap is refused)`);
  fs.chmodSync(dir, 0o700);
  return dir;
}

/** `git ls-files -co --exclude-standard` (NUL-separated), from the kernel with the check env's PATH. */
export function listRepoFiles(repo: string, env: Record<string, string>): string[] {
  const r = spawnSync('git', ['-c', 'core.fsmonitor=false', '-c', 'core.quotepath=off', 'ls-files', '-z', '-co', '--exclude-standard'], { cwd: repo, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  if (r.status !== 0 || typeof r.stdout !== 'string') throw new CheckCopyRefusal('copy-failed', `git ls-files failed in ${repo}: ${(r.stderr || String(r.error ?? '')).trim().slice(0, 300)}`);
  return [...new Set(r.stdout.split('\0').filter(Boolean))].filter((f) => !NEVER_COPY.some((re) => re.test(f)));
}

const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;
const escaped = (rel: string): CheckCopyRefusal => new CheckCopyRefusal('copy-failed', `${rel} resolves outside the repo or changed during the copy (a link or a swapped directory is refused)`);

/**
 * The identity of every directory between repoReal and `rel`'s parent: each must be a REAL directory (lstat,
 * never a link; git lists no path through a symlinked dir, so one means tampering). Compared before and after
 * each file is read: a parent swapped mid-copy changes it.
 */
function parentChain(repoReal: string, rel: string): string | null {
  const parent = path.posix.dirname(rel);
  if (parent === '.') return '';
  let cur = repoReal;
  const ids: string[] = [];
  for (const part of parent.split('/')) {
    if (!part || part === '.' || part === '..') return null;
    cur = path.join(cur, part);
    let st: fs.BigIntStats;
    try {
      st = fs.lstatSync(cur, { bigint: true });
    } catch {
      return null;
    }
    if (!st.isDirectory()) return null;
    ids.push(`${st.dev}:${st.ino}`);
  }
  return ids.join('/');
}

/**
 * Copy one regular file through an O_NOFOLLOW fd, reading at most `size` bytes (its lstat size at enumeration).
 * After the read the parent chain, the file's identity (lstat vs fstat) and the parent's realpath containment are
 * checked again: any change refuses the whole copy.
 */
function copyFileContained(repoReal: string, rel: string, dst: string, size: number): void {
  const src = path.join(repoReal, rel);
  const before = parentChain(repoReal, rel);
  if (before === null) throw escaped(rel);
  const fd = fs.openSync(src, fs.constants.O_RDONLY | NOFOLLOW);
  try {
    const st = fs.fstatSync(fd, { bigint: true });
    if (!st.isFile()) throw escaped(rel);
    const out = fs.openSync(dst, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, Number(st.mode) & 0o755);
    try {
      const buf = Buffer.allocUnsafe(Math.min(1024 * 1024, Math.max(1, size)));
      let left = size;
      while (left > 0) {
        const n = fs.readSync(fd, buf, 0, Math.min(buf.length, left), null);
        if (n === 0) break;
        fs.writeSync(out, buf, 0, n);
        left -= n;
      }
    } finally {
      fs.closeSync(out);
    }
    const after = fs.lstatSync(src, { bigint: true });
    if (parentChain(repoReal, rel) !== before || after.ino !== st.ino || after.dev !== st.dev || !within(fs.realpathSync.native(path.dirname(src)), repoReal)) throw escaped(rel);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Build the check copy (step 1) in the KERNEL-OWNED run dir `<home>/loop-work/check-<runId>/{repo,home,tmp}`,
 * never inside the repo (the kernel never writes through a repo path). Throws CheckCopyRefusal past the limits
 * or on any path that resolves outside the repo; a partial copy is removed.
 */
export function makeCheckCopy(repo: string, runId: string, env: Record<string, string>, limits: typeof CHECK_COPY_LIMITS = CHECK_COPY_LIMITS, gnomonHome?: string, from?: { tree: string; files: readonly string[] }): CheckCopy {
  if (!CHECK_RUN_ID.test(runId)) throw new CheckCopyRefusal('bad-input', `runId must match ${CHECK_RUN_ID}`);
  if (!gnomonHome) throw new CheckCopyRefusal('bad-input', 'the check copy lives under the Gnomon home');
  const repoReal = fs.realpathSync.native(repo);
  const homeReal = fs.realpathSync.native(gnomonHome);
  if (within(homeReal, repoReal) || within(repoReal, homeReal)) throw new CheckCopyRefusal('bad-input', 'the repo and the Gnomon home must not contain each other');
  // step 10 (#loop-act): a check in a loop with act nodes copies the run's SCRATCH worktree (kernel-owned, under
  // <home>/loop-work/act-<runId>/tree; its file list walked by the kernel), never the founder's checkout; its
  // node_modules links must still resolve inside the human repo
  let srcReal = repoReal;
  if (from) {
    srcReal = fs.realpathSync.native(from.tree);
    if (path.dirname(path.dirname(srcReal)) !== path.join(homeReal, LOOP_WORK_DIR) || !/^act-[A-Za-z0-9_-]{1,64}$/.test(path.basename(path.dirname(srcReal))) || path.basename(srcReal) !== 'tree') throw new CheckCopyRefusal('bad-input', 'a scratch check copy reads only a kernel scratch worktree');
  }
  const files = from ? from.files.filter((f) => !NEVER_COPY.some((re) => re.test(f))) : listRepoFiles(repoReal, env);
  if (files.length > limits.maxFiles) throw new CheckCopyRefusal('copy-too-large', `the repo copy would hold ${files.length} files, over the ${limits.maxFiles}-file cap for a loop check`);
  const entries: Array<{ rel: string; kind: 'file' | 'link'; size: number }> = [];
  let bytes = 0;
  for (const rel of files) {
    let st: fs.Stats;
    try {
      st = fs.lstatSync(path.join(srcReal, rel));
    } catch {
      continue; // tracked but deleted in the worktree
    }
    if (st.isFile()) {
      bytes += st.size;
      entries.push({ rel, kind: 'file', size: st.size });
    } else if (st.isSymbolicLink()) entries.push({ rel, kind: 'link', size: 0 });
    // a gitlink (submodule dir) or special file is not copied
    if (bytes > limits.maxBytes) throw new CheckCopyRefusal('copy-too-large', `the repo copy would exceed ${Math.round(limits.maxBytes / 1024 / 1024)} MiB, the size cap for a loop check`);
  }
  const runDir = path.join(ensureWorkDir(homeReal), `check-${runId}`);
  if (fs.existsSync(runDir)) throw new CheckCopyRefusal('bad-input', `${runDir} already exists`);
  const tree = path.join(runDir, 'repo');
  const home = path.join(runDir, 'home');
  const tmp = path.join(runDir, 'tmp');
  try {
    fs.mkdirSync(runDir, { mode: 0o700 });
    for (const d of [tree, home, tmp]) fs.mkdirSync(d, { mode: 0o700 });
    const dirs = new Set<string>(['']);
    for (const e of entries) {
      const dst = path.join(tree, ...e.rel.split('/'));
      const parent = path.posix.dirname(e.rel);
      if (parent !== '.') {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        for (let d = parent; d !== '.' && d !== ''; d = path.posix.dirname(d)) dirs.add(d);
      }
      if (e.kind === 'link') {
        const before = parentChain(srcReal, e.rel);
        if (before === null) throw escaped(e.rel);
        const target = fs.readlinkSync(path.join(srcReal, e.rel));
        if (parentChain(srcReal, e.rel) !== before) throw escaped(e.rel);
        fs.symlinkSync(target, dst); // the sandbox resolves it: a link out of the copy reads nothing
      } else copyFileContained(srcReal, e.rel, dst, e.size);
    }
    const nodeModules: string[] = [];
    for (const d of [...dirs].sort()) {
      if (d && parentChain(srcReal, `${d}/x`) === null) throw escaped(d);
      const src = path.join(srcReal, ...(d ? d.split('/') : []), 'node_modules');
      let st: fs.Stats;
      try {
        st = fs.lstatSync(src);
      } catch {
        continue;
      }
      if (!st.isDirectory() && !st.isSymbolicLink()) continue;
      // a node_modules link must stay inside the repo: one to ~/Documents would widen the profile's reads
      let real: string;
      try {
        real = fs.realpathSync.native(src);
      } catch {
        continue; // a dangling link
      }
      if (!within(real, repoReal) || !fs.statSync(real).isDirectory()) throw new CheckCopyRefusal('copy-failed', `${path.posix.join(d, 'node_modules')} resolves outside the repo (${real}): refused, it would widen the check's reads`);
      const dst = path.join(tree, ...(d ? d.split('/') : []), 'node_modules');
      if (fs.existsSync(dst)) continue;
      if (nodeModules.length >= limits.maxNodeModules) throw new CheckCopyRefusal('copy-too-large', `more than ${limits.maxNodeModules} node_modules dirs to link`);
      fs.symlinkSync(real, dst, 'dir');
      nodeModules.push(real);
    }
    return { runDir, tree, home, tmp, files: entries.length, bytes, nodeModules: [...new Set(nodeModules)] };
  } catch (err) {
    fs.rmSync(runDir, { recursive: true, force: true });
    if (err instanceof CheckCopyRefusal) throw err;
    throw new CheckCopyRefusal('copy-failed', `copying the repo for the check failed: ${(err as Error).message}`);
  }
}

/** Digest of a whole directory (the paradigm CLI dist): sha256 over sorted `rel\0sha256\n` lines; links refused. */
export function dirDigest(dir: string, caps: { maxFiles: number; maxBytes: number } = { maxFiles: 10_000, maxBytes: 200 * 1024 * 1024 }): string {
  const lines: string[] = [];
  let bytes = 0;
  const walk = (abs: string, rel: string): void => {
    for (const name of fs.readdirSync(abs).sort()) {
      const a = path.join(abs, name);
      const r = rel ? `${rel}/${name}` : name;
      const st = fs.lstatSync(a);
      if (st.isSymbolicLink()) throw new Error(`${r} in the pinned dir is a link`);
      if (st.isDirectory()) walk(a, r);
      else if (st.isFile()) {
        bytes += st.size;
        if (lines.length >= caps.maxFiles || bytes > caps.maxBytes) throw new Error('the pinned dir is over its digest caps');
        lines.push(`${r}\0${createHash('sha256').update(fs.readFileSync(a)).digest('hex')}\n`);
      }
    }
  };
  walk(dir, '');
  return createHash('sha256').update(lines.sort().join('')).digest('hex');
}

/** The paradigm CLI pin: the entry's realpath and the digest of its WHOLE dist dir (chunks included). */
export function pinParadigmCli(entry: string): FilePin {
  const real = fs.realpathSync.native(entry);
  return { real, sha256: dirDigest(path.dirname(real)) };
}

/** The paradigm CLI package dir and every node_modules dir above its entry (Node's resolution walk): read only. */
export function paradigmCliReadRoots(entryReal: string): string[] {
  const roots: string[] = [];
  let pkg: string | null = null;
  for (let d = path.dirname(entryReal); ; d = path.dirname(d)) {
    if (!pkg && fs.existsSync(path.join(d, 'package.json'))) pkg = d;
    const nm = path.join(d, 'node_modules');
    if (pkg && fs.existsSync(nm)) roots.push(fs.realpathSync.native(nm));
    if (d === path.dirname(d)) break;
  }
  return [pkg ?? path.dirname(entryReal), ...roots];
}

function emptyEvidence(): CheckEvidence {
  return { stdoutTail: '', stderrTail: '', stdoutTruncated: false, stderrTruncated: false, redactions: [], label: 'private', sensitive: true };
}

function tail(buf: Buffer, n: number): { text: string; truncated: boolean } {
  if (buf.length <= n) return { text: buf.toString('utf8'), truncated: false };
  return { text: buf.subarray(buf.length - n).toString('utf8').replace(/^[�]+/, ''), truncated: true };
}

function evidenceOf(stdout: Buffer, stderr: Buffer, outDropped: boolean): CheckEvidence {
  const o = tail(stdout, CHECK_EVIDENCE_TAIL_BYTES);
  const e = tail(stderr, CHECK_EVIDENCE_TAIL_BYTES);
  const so = scanSecrets(o.text);
  const se = scanSecrets(e.text);
  const kinds = new Map<string, number>();
  for (const r of [...so.redactions, ...se.redactions]) kinds.set(r.kind, (kinds.get(r.kind) ?? 0) + r.count);
  return { stdoutTail: so.text, stderrTail: se.text, stdoutTruncated: o.truncated || outDropped, stderrTruncated: e.truncated, redactions: [...kinds].map(([kind, count]) => ({ kind, count })), label: 'private', sensitive: true };
}

/** Remove kept check run dirs older than `maxAgeMs` from `<home>/loop-work` (the retention window). Links are never followed. */
export function sweepCheckCopies(home: string, maxAgeMs: number, now: number = Date.now()): string[] {
  const dir = checkWorkDir(home);
  const removed: string[] = [];
  let names: string[] = [];
  try {
    const st = fs.lstatSync(dir);
    if (!st.isDirectory() || st.isSymbolicLink()) return removed;
    names = fs.readdirSync(dir);
  } catch {
    return removed;
  }
  for (const n of names) {
    if (!/^check-[A-Za-z0-9_-]{1,64}$/.test(n)) continue;
    const p = path.join(dir, n);
    try {
      const st = fs.lstatSync(p);
      if (st.isDirectory() && !st.isSymbolicLink() && now - st.mtimeMs > maxAgeMs) {
        fs.rmSync(p, { recursive: true, force: true });
        removed.push(p);
      }
    } catch {
      /* raced */
    }
  }
  return removed;
}

interface Spawned {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  spawnError: string | null;
  stdout: Buffer;
  stderr: Buffer;
  stderrHead: string;
  outDropped: boolean;
  /** descendants that outlived the group kill (setsid) and were killed by the sweep */
  escaped: number;
}

/** How often the check's process tree is listed (async ps), so a child that leaves the group (setsid) is known. */
export const CHECK_TREE_POLL_MS = 500;

/**
 * Track every descendant of the check (pid + start witness) through the process-control snapshot: the group, and
 * anything whose parent chain reaches the check or an already-tracked pid. Residual: a process that forks AND
 * whose parent exits inside one poll interval is reparented before it is seen.
 */
class TreeTracker {
  readonly tracked = new Map<number, string>();
  constructor(private readonly pc: ReturnType<typeof processControlFor>, private readonly root: number) {}
  async poll(): Promise<void> {
    const rows = await this.pc.snapshot?.();
    if (!rows) return;
    let grew = true;
    const roots = new Set<number>([this.root, ...this.tracked.keys()]);
    while (grew) {
      grew = false;
      for (const r of rows) {
        if (r.pid === this.root || r.pid === process.pid || this.tracked.has(r.pid)) continue;
        if (r.pgid === this.root || roots.has(r.ppid)) {
          this.tracked.set(r.pid, r.start);
          roots.add(r.pid);
          grew = true;
        }
      }
    }
  }
  /** SIGKILL every tracked pid still alive with the SAME start witness (never a recycled pid). */
  async killAll(): Promise<number> {
    await this.poll();
    const rows = await this.pc.snapshot?.();
    if (!rows) return 0;
    let n = 0;
    for (const r of rows) {
      const start = this.tracked.get(r.pid);
      if (start !== undefined && start === r.start && this.pc.signalPid?.(r.pid, 'SIGKILL')) n++;
    }
    return n;
  }
}

function runPlan(plan: ChildLaunchPlan, cwd: string, timeoutSec: number, platform: string, abort?: AbortSignal): Promise<Spawned & { killed: boolean }> {
  const pc = processControlFor(platform as NodeJS.Platform);
  return new Promise((resolve) => {
    const out: Buffer[] = [];
    let outLen = 0;
    let outDropped = false;
    const err: Buffer[] = [];
    let errLen = 0;
    let stderrHead = '';
    let timedOut = false;
    let exitCode: number | null = null;
    let signal: string | null = null;
    let spawnError: string | null = null;
    let settled = false;
    let closed = false;
    let exited = false;
    const child = spawn(plan.command, plan.args, { cwd, env: plan.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const pgid = child.pid ?? 0;
    const tree = new TreeTracker(pc, pgid);
    let polling: Promise<void> = Promise.resolve();
    const poller = setInterval(() => {
      polling = polling.then(() => tree.poll()).catch(() => undefined);
    }, CHECK_TREE_POLL_MS);
    const keep = (arr: Buffer[], len: number, cap: number): number => {
      while (len > cap && arr.length > 1) len -= arr.shift()!.length;
      return len;
    };
    child.stdout!.on('data', (b: Buffer) => {
      out.push(b);
      outLen += b.length;
      if (outLen > CHECK_PARSE_MAX_BYTES) {
        outDropped = true;
        outLen = keep(out, outLen, CHECK_PARSE_MAX_BYTES);
      }
    });
    child.stderr!.on('data', (b: Buffer) => {
      if (stderrHead.length < 4096) stderrHead += b.toString('utf8').slice(0, 4096 - stderrHead.length);
      err.push(b);
      errLen = keep(err, errLen + b.length, CHECK_EVIDENCE_TAIL_BYTES * 2);
    });
    let killTimer: NodeJS.Timeout | null = null;
    let killed = false;
    const onAbort = (): void => {
      if (exited) return;
      killed = true;
      polling = polling.then(() => tree.poll()).catch(() => undefined);
      pc.signalGroup(pgid, 'SIGKILL');
    };
    abort?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      // list the tree BEFORE the kill: once the parent dies its setsid'd children are reparented
      polling = polling.then(() => tree.poll()).catch(() => undefined);
      pc.signalGroup(pgid, 'SIGTERM');
      killTimer = setTimeout(() => pc.signalGroup(pgid, 'SIGKILL'), CHECK_KILL_GRACE_MS);
    }, timeoutSec * 1000);
    const finish = (): void => {
      if (settled || !exited) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poller);
      abort?.removeEventListener('abort', onAbort);
      if (killTimer) clearTimeout(killTimer);
      // descendants that left the group (setsid) are swept by pid + start witness after the group kill
      void polling
        .then(() => tree.killAll())
        .catch(() => 0)
        .then((escaped) => resolve({ exitCode, signal, timedOut, spawnError, stdout: Buffer.concat(out), stderr: Buffer.concat(err), stderrHead, outDropped, escaped: escaped ?? 0, killed }));
    };
    child.on('error', (e) => {
      spawnError = e.message;
      exited = true;
      finish();
    });
    child.on('exit', (code, sig) => {
      exitCode = code;
      signal = sig;
      exited = true;
      // no straggler outlives the check: whatever is left in its group is killed (pipes then close)
      pc.signalGroup(pgid, 'SIGKILL');
      if (closed) finish();
      // a descendant that left the group could hold the pipes open: never wait on it past the grace
      else setTimeout(finish, CHECK_KILL_GRACE_MS).unref();
    });
    child.on('close', () => {
      closed = true;
      finish();
    });
  });
}

/** A json rule's value as stored: bounded (CHECK_VALUE_MAX_CHARS) and secret-scanned; numbers, booleans and null as is. */
export const CHECK_VALUE_MAX_CHARS = 256;
function boundedValue(v: unknown): unknown {
  if (v === null || typeof v === 'number' || typeof v === 'boolean') return v;
  const text = typeof v === 'string' ? v : JSON.stringify(v) ?? String(v);
  // scan a window wider than the bound (a secret straddling the cut is still seen), then cut to the bound
  const scanned = scanSecrets(text.slice(0, CHECK_VALUE_MAX_CHARS * 4)).text;
  return scanned.length > CHECK_VALUE_MAX_CHARS || text.length > CHECK_VALUE_MAX_CHARS * 4 ? `${scanned.slice(0, CHECK_VALUE_MAX_CHARS)}…` : scanned;
}

/** A builtin's stdout must be the CLI's JSON verdict for THIS builtin; anything else (a crash, a stack) is error. */
function builtinVerdict(stdout: Buffer, name: string): string | null {
  let doc: unknown;
  try {
    doc = JSON.parse(stdout.toString('utf8'));
  } catch {
    return 'the builtin printed no JSON verdict (it crashed or is not the paradigm CLI)';
  }
  const d = doc as { builtin?: unknown; ok?: unknown; failed?: unknown; passed?: unknown };
  if (!d || typeof d !== 'object' || d.builtin !== name || typeof d.ok !== 'boolean' || typeof d.failed !== 'number' || typeof d.passed !== 'number') return `the builtin's JSON is not a verdict for ${name}`;
  return null;
}

/** Run one `effect: read` check node under the loop-check profile on a fresh copy of the repo. */
export async function runCheck(i: CheckExecInput): Promise<CheckResult> {
  const t0 = Date.now();
  const platform = i.platform ?? process.platform;
  const limits = { ...CHECK_COPY_LIMITS, ...(i.limits ?? {}) };
  const nodePath = i.nodePath ?? process.execPath;
  const fail = (reason: CheckErrorReason, detail: string, extra: Partial<CheckResult> = {}): CheckResult => ({
    verdict: 'error', reason, detail, exitCode: null, signal: null, durationMs: Date.now() - t0, evidence: emptyEvidence(), profileHash: null, envKeys: [],
    copy: { dir: '', files: 0, bytes: 0, kept: false }, ...extra,
  });
  const n = i.node;
  if (!CHECK_RUN_ID.test(i.runId)) return fail('bad-input', `runId must match ${CHECK_RUN_ID}`);
  if (!!n.run === !!n.builtin) return fail('bad-input', 'a check has exactly one of run or builtin');
  if (!(Number.isFinite(n.timeoutSec) && n.timeoutSec > 0)) return fail('bad-input', 'timeoutSec must be positive');

  const nodeDir = sessionNodeDir(nodePath, { platform: platform as NodeJS.Platform });
  const pathDirs = defaultSessionPath({ platform: platform as NodeJS.Platform, ...(nodeDir ? { nodeDir } : {}) });
  const pathValue = pathDirs ? pathDirs.join(path.delimiter) : null;
  const identity = i.identity === undefined ? sessionIdentity() : i.identity;
  const kernelEnv = buildCheckEnv({ from: i.envFrom ?? process.env, identity, path: pathValue, home: '/nonexistent', tmpdir: '/nonexistent' }).env;

  let copy: CheckCopy;
  try {
    copy = makeCheckCopy(i.repo, i.runId, kernelEnv, limits, i.home, i.scratch);
  } catch (err) {
    if (err instanceof CheckCopyRefusal) return fail(err.reason, err.message);
    throw err;
  }
  const copyInfo = (kept: boolean): CheckResult['copy'] => ({ dir: copy.runDir, files: copy.files, bytes: copy.bytes, kept, ...(kept ? { retention: `kept for debugging at ${copy.runDir}; removed after the loops retention window (loops.retentionDays) by the next sweep` } : {}) });
  const done = (r: CheckResult): CheckResult => {
    const keep = r.verdict === 'error' && i.keepOnError !== false;
    if (!keep) fs.rmSync(copy.runDir, { recursive: true, force: true });
    return { ...r, copy: copyInfo(keep) };
  };
  const { env, envKeys } = buildCheckEnv({ from: i.envFrom ?? process.env, identity, path: pathValue, home: copy.home, tmpdir: copy.tmp, inject: { NO_COLOR: '1' } });

  // argv + the exec and read grants
  let argv: string[];
  const exec: string[] = [];
  const readPaths: string[] = [];
  try {
    if (n.run) {
      if (!i.argv0) return done(fail('pin-mismatch', 'a run check needs its trusted argv0 pin'));
      const repoReal = fs.realpathSync.native(i.repo);
      const pinned = fs.realpathSync.native(i.argv0.real);
      // argv0 inside the repo is exec'd from the COPY (same bytes, checked below); elsewhere from where it was hashed
      const target = within(pinned, repoReal) && !pinned.split(path.sep).includes('node_modules') ? path.join(copy.tree, path.relative(repoReal, pinned)) : pinned;
      if (pinned !== i.argv0.real || sha256File(target) !== hex(i.argv0.sha256)) return done(fail('pin-mismatch', `argv0 ${i.argv0.real} no longer matches its trusted hash`));
      const line = readShebang(target);
      if (line !== null) {
        // a script's interpreter is exec'd too: it must be pinned, resolved and unchanged (never run unpinned)
        const it = resolveShebangInterpreter(line, { execPath: nodePath, pathDirs: pathDirs ?? [] });
        if (!i.interpreter) return done(fail('pin-mismatch', `argv0 is a script (#!${line.slice(0, 80)}) but its interpreter has no trusted pin`));
        if (!it.real) return done(fail('pin-mismatch', `the interpreter of #!${line.slice(0, 80)} cannot be resolved on the check PATH`));
        if (it.real !== fs.realpathSync.native(i.interpreter.real) || sha256File(it.real) !== hex(i.interpreter.sha256)) {
          return done(fail('pin-mismatch', `argv0's interpreter ${it.real} no longer matches its trusted pin ${i.interpreter.real}`));
        }
        exec.push(...(it.env ? [it.env] : []), it.real);
      }
      argv = [target, ...n.run.slice(1)];
    } else {
      if (!i.paradigmCli) return done(fail('pin-mismatch', 'a builtin check needs the pinned paradigm CLI'));
      const entry = fs.realpathSync.native(i.paradigmCli.real);
      if (dirDigest(path.dirname(entry)) !== hex(i.paradigmCli.sha256)) return done(fail('pin-mismatch', `the paradigm CLI at ${path.dirname(entry)} no longer matches its pinned digest`));
      readPaths.push(...paradigmCliReadRoots(entry));
      argv = [fs.realpathSync.native(nodePath), entry, 'loop', 'builtin', n.builtin!, '--json', ...(n.args && Object.keys(n.args).length ? ['--args', JSON.stringify(n.args)] : [])];
    }
  } catch (err) {
    return done(fail('pin-mismatch', (err as Error).message));
  }

  let plan: ChildLaunchPlan;
  try {
    const li: LoopCheckLaunchInput = { home: i.home, copyDir: copy.runDir, nodeModules: copy.nodeModules, argv, exec, readPaths, env, nodePath, ...(i.userHome ? { userHome: i.userHome } : {}) };
    plan = loopCheckLaunchPlan(li, platform, i.probe, i.sip);
  } catch (err) {
    if (isLifecycleRefusal(err)) return done(fail('sandbox-unavailable', err.message, { envKeys }));
    throw err;
  }

  if (i.abort?.aborted) return done(fail('killed', 'the run was stopped (pause or kill switch) before the check started'));
  const s = await runPlan(plan, copy.tree, n.timeoutSec, platform, i.abort);
  const base = { exitCode: s.exitCode, signal: s.signal, durationMs: Date.now() - t0, evidence: evidenceOf(s.stdout, s.stderr, s.outDropped), profileHash: plan.profileHash, envKeys, escapedKilled: s.escaped, copy: copyInfo(false) };
  if (s.spawnError) return done({ ...base, verdict: 'error', reason: 'spawn-failed', detail: s.spawnError });
  if (s.killed) return done({ ...base, verdict: 'error', reason: 'killed', detail: 'the run was stopped (pause or kill switch): the check process group was killed' });
  if (s.timedOut) return done({ ...base, verdict: 'error', reason: 'timeout', detail: `the check ran past its ${n.timeoutSec}s timeout; its process group was killed` });
  if (/^sandbox-exec: /m.test(s.stderrHead)) return done({ ...base, verdict: 'error', reason: 'sandbox-refused', detail: scanSecrets(s.stderrHead.split('\n')[0]!.slice(0, 300)).text });
  if (s.signal !== null || s.exitCode === null) return done({ ...base, verdict: 'error', reason: 'crash', detail: `the check was killed by ${s.signal ?? 'an unknown signal'}` });
  if (s.outDropped && !('exit' in n.pass)) return done({ ...base, verdict: 'error', reason: 'output-too-large', detail: `the check printed more than ${CHECK_PARSE_MAX_BYTES} bytes; its report cannot be parsed whole` });
  if (n.builtin) {
    // a builtin judges only through its JSON verdict: exit 2 (could not judge) or no valid verdict is error
    if (s.exitCode === BUILTIN_ERROR_EXIT) return done({ ...base, verdict: 'error', reason: 'builtin-error', detail: builtinError(s.stdout) });
    const bad = builtinVerdict(s.stdout, n.builtin);
    if (bad) return done({ ...base, verdict: 'error', reason: 'builtin-error', detail: bad });
  }
  const r = applyPassRule(n.pass, { exitCode: s.exitCode, stdout: s.stdout.toString('utf8') });
  if (r.verdict === 'error') return done({ ...base, verdict: 'error', reason: r.reason, detail: r.detail });
  return done({ ...base, verdict: r.verdict, ...(r.counts ? { counts: r.counts } : {}), ...(r.value !== undefined ? { value: boundedValue(r.value) } : {}) });
}

/** Pin a file for a check (the registry pins at trust; tests and `gnomon loop show` use it too). */
export function pinFile(p: string): FilePin {
  const real = fs.realpathSync.native(p);
  return { real, sha256: sha256File(real) };
}
