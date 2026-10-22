/**
 * @symbol #loop-registry
 *
 * #loop-registry, the content hash (docs/specs/gnomon-loops.md §3.1 "Content hash"; build plan LP2 and the LP1
 * review notes). A loop's content hash is sha256 over canonicalJson of:
 *
 *   - `def`: sha256 of canonicalJson(the PARSED compiled definition), never the file bytes;
 *   - `argv`: per run check, argv0 as the runner resolves it (resolveArgv0: a path word against the repo root, a
 *     bare name in `<repo>/node_modules/.bin` then the session PATH), its realpath and sha256, and the shebang
 *     interpreter's realpath and sha256 when argv0 is a script (`#!/usr/bin/env node` resolves `node` the way the
 *     runner will: the kernel's own node, process.execPath); plus the realpath and sha256 of every file an argv word
 *     names, in or out of the repo (a directory by its realpath; a missing path-like word as `missing`, so a file
 *     that appears later changes the hash);
 *   - `closure`: the config closure, a digest of the gate-class files a check reads (closureOf: test config,
 *     tsconfig*, package.json and lockfiles, lint configs, env files, npm/yarn rc, per manifest/layers.ts
 *     gateClassPathRule) in the repo root and in every directory on the way to an argv path, never under
 *     node_modules;
 *   - `calls`: each call node's pin and the callee's CURRENT content hash (so any change to a callee changes the
 *     caller's hash, and re-trusting a callee pauses the caller until it is re-trusted too: G-LOOP-21).
 *
 * `coreHash` is the same without the closure, so the registry can tell a closure-only change (§3.1 "Closure changes
 * by origin") from a definition, argv or callee change. Pure functions of the filesystem; file digests are cached
 * by (dev, ino, size, mtime, ctime): ctime cannot be set back from user space, so a same-size edit still rehashes.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { canonicalJson } from '@a-company/gnomon-contracts';
import { argvPathWords, type CompiledLoop } from '../../loops/index.js';
import { gateClassPathRule } from '../manifest/layers.js';
import { defaultSessionPath, sessionNodeDir } from '../runner/env.js';
import { readShebang, resolveShebangInterpreter } from './shebang.js';

export { readShebang, shebangProgram } from './shebang.js';

export const LOOP_HASH_VERSION = 1;
/** The card lists at most this many closure files (every file is hashed; the rest are counted in `truncated`). */
export const CLOSURE_MAX_FILES = 512;
/** A file larger than this is hashed by its stat identity only (a 2 GiB fixture is not read on every rescan). */
export const HASH_MAX_BYTES = 512 * 1024 * 1024;

const shaHex = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');
const tagged = (hex: string): string => `sha256:${hex}`;

export interface FileHashCache {
  get(real: string, st: fs.Stats): string | undefined;
  set(real: string, st: fs.Stats, sha: string): void;
}

/** The default digest cache, keyed by realpath and validated by (dev, ino, size, mtime, ctime). */
export function createFileHashCache(max = 4096): FileHashCache {
  const m = new Map<string, { id: string; sha: string }>();
  const idOf = (st: fs.Stats): string => `${st.dev}:${st.ino}:${st.size}:${st.mtimeMs}:${st.ctimeMs}`;
  return {
    get: (real, st) => {
      const e = m.get(real);
      return e && e.id === idOf(st) ? e.sha : undefined;
    },
    set: (real, st, sha) => {
      m.delete(real);
      m.set(real, { id: idOf(st), sha });
      while (m.size > max) m.delete(m.keys().next().value as string);
    },
  };
}

export interface HashContext {
  /** The repo root the loop runs in (realpath'd by the caller). Relative argv words resolve against it. */
  repoRoot: string;
  /** The node a `#!/usr/bin/env node` script runs under (the runner's node). Default process.execPath. */
  execPath?: string;
  /** Where a bare argv0 is looked up after `<repo>/node_modules/.bin` (the session PATH). Default defaultSessionPath. */
  pathDirs?: readonly string[];
  cache?: FileHashCache;
  platform?: NodeJS.Platform;
}

/** The default PATH a bare argv0 is looked up on (the kernel's session PATH; never process.env). */
export function defaultLoopPathDirs(platform: NodeJS.Platform = process.platform, execPath: string = process.execPath): string[] {
  const nodeDir = sessionNodeDir(execPath, { platform }) ?? undefined;
  return defaultSessionPath({ platform, ...(nodeDir ? { nodeDir } : {}) }) ?? (nodeDir ? [nodeDir] : []);
}

export interface FileDigest {
  /** the word as the argv names it */
  word: string;
  kind: 'file' | 'dir' | 'missing' | 'unreadable';
  real?: string;
  sha256?: string;
}

export interface InterpreterDigest {
  /** the shebang line, without `#!` */
  shebang: string;
  /** the program the shebang runs (`node` for `/usr/bin/env node`) */
  program: string;
  /** how the kernel resolved it: the runner's node, an absolute path, or the PATH */
  via: 'kernel-node' | 'absolute' | 'path' | 'unresolved';
  real?: string;
  sha256?: string;
}

export interface Argv0Digest {
  argv0: string;
  /** the path the runner will exec, or null when not found */
  resolved: string | null;
  real?: string;
  sha256?: string;
  interpreter?: InterpreterDigest;
}

export interface NodeArgvDigest {
  node: string;
  argv0: Argv0Digest;
  files: FileDigest[];
}

export interface ClosureFile {
  /** repo-relative, forward slashes */
  rel: string;
  sha256: string;
}

export interface Closure {
  /** sha256 over EVERY closure file */
  digest: string;
  /** the listing the card shows (capped at CLOSURE_MAX_FILES) */
  files: ClosureFile[];
  /** how many files the listing leaves out (they are still in the digest) */
  truncated: number;
  /** every closure file (protected set, change lists) */
  all: ClosureFile[];
}

export interface CallDigest {
  node: string;
  pin: string;
  callee: string;
  /** the callee's current content hash, or null (absent, refused or a cycle) */
  calleeHash: string | null;
}

export interface LoopHash {
  contentHash: string;
  /** the hash without the closure (definition, argv and calls) */
  coreHash: string;
  defHash: string;
  argv: NodeArgvDigest[];
  closure: Closure;
  calls: CallDigest[];
}

const realOf = (p: string): string | null => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
};

/** sha256 hex of a regular file (cached), or null when it cannot be read. Never follows a FIFO or device. */
export function fileSha(p: string, cache?: FileHashCache): { real: string; sha256: string } | null {
  const real = realOf(p);
  if (!real) return null;
  let st: fs.Stats;
  try {
    st = fs.statSync(real);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;
  const hit = cache?.get(real, st);
  if (hit) return { real, sha256: hit };
  let sha: string;
  if (st.size > HASH_MAX_BYTES) {
    sha = shaHex(`oversize:${st.dev}:${st.ino}:${st.size}:${st.mtimeMs}:${st.ctimeMs}`);
  } else {
    const h = createHash('sha256');
    let fd: number | null = null;
    try {
      fd = fs.openSync(real, 'r');
      const buf = Buffer.allocUnsafe(1 << 20);
      for (;;) {
        const n = fs.readSync(fd, buf, 0, buf.length, null);
        if (n <= 0) break;
        h.update(buf.subarray(0, n));
      }
    } catch {
      return null;
    } finally {
      if (fd !== null) fs.closeSync(fd);
    }
    sha = h.digest('hex');
  }
  cache?.set(real, st, sha);
  return { real, sha256: sha };
}

const isPathWord = (w: string): boolean => w.includes('/') || w.includes('\\');
const regularFile = (p: string): boolean => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

/**
 * argv0 as the loop runner execs it (the runner MUST resolve through this function): an absolute path as is, a
 * path word against the repo root, a bare name in `<repo>/node_modules/.bin`, then the session PATH (on win32 the
 * name, then the name with `.exe`). null when nothing is found.
 */
export function resolveArgv0(argv0: string, ctx: Pick<HashContext, 'repoRoot' | 'pathDirs' | 'platform' | 'execPath'>): string | null {
  if (path.isAbsolute(argv0)) return argv0;
  if (isPathWord(argv0)) return path.resolve(ctx.repoRoot, argv0);
  const names = (ctx.platform ?? process.platform) === 'win32' && !/\.exe$/i.test(argv0) ? [argv0, `${argv0}.exe`] : [argv0];
  const dirs = [path.join(ctx.repoRoot, 'node_modules', '.bin'), ...(ctx.pathDirs ?? defaultLoopPathDirs(ctx.platform, ctx.execPath))];
  for (const d of dirs) for (const n of names) if (regularFile(path.join(d, n))) return path.join(d, n);
  return null;
}

function interpreterOf(shebang: string, ctx: HashContext): InterpreterDigest {
  // the ONE shebang parser the sandbox uses too (shebang.ts): NAME=value words skipped, `env node` = the kernel's node
  const i = resolveShebangInterpreter(shebang, { ...(ctx.execPath ? { execPath: ctx.execPath } : {}), pathDirs: ctx.pathDirs ?? defaultLoopPathDirs(ctx.platform, ctx.execPath) });
  const base = { shebang, program: i.program };
  if (!i.real) return { ...base, via: 'unresolved' };
  const d = fileSha(i.real, ctx.cache);
  return d ? { ...base, via: i.via as InterpreterDigest['via'], real: d.real, sha256: d.sha256 } : { ...base, via: 'unresolved' };
}

/** argv0's digest: what the runner execs, its realpath and sha256, and its shebang interpreter. */
export function argv0Digest(argv0: string, ctx: HashContext): Argv0Digest {
  const resolved = resolveArgv0(argv0, ctx);
  if (!resolved) return { argv0, resolved: null };
  const d = fileSha(resolved, ctx.cache);
  if (!d) return { argv0, resolved };
  const sb = readShebang(d.real);
  return { argv0, resolved, real: d.real, sha256: d.sha256, ...(sb ? { interpreter: interpreterOf(sb, ctx) } : {}) };
}

/** The candidate path words of argv[1..] (`--opt=value` values too). */
function argvWords(run: readonly string[]): string[] {
  const out: string[] = [];
  for (const w of run.slice(1)) {
    const v = w.startsWith('-') ? (w.includes('=') ? w.slice(w.indexOf('=') + 1) : '') : w;
    if (v && !v.startsWith('-')) out.push(v);
  }
  return out;
}

/** The files the argv words name (argv[1..]), in or out of the repo. */
export function argvFileDigests(run: readonly string[], ctx: HashContext): FileDigest[] {
  const out: FileDigest[] = [];
  const seen = new Set<string>();
  for (const w of argvWords(run)) {
    if (seen.has(w)) continue;
    seen.add(w);
    const looksLikePath = path.isAbsolute(w) || isPathWord(w) || /\.[A-Za-z0-9]+$/.test(w);
    const abs = path.isAbsolute(w) ? w : path.resolve(ctx.repoRoot, w);
    let st: fs.Stats | null = null;
    try {
      st = fs.statSync(abs);
    } catch {
      st = null;
    }
    if (!st) {
      if (looksLikePath) out.push({ word: w, kind: 'missing' });
      continue;
    }
    if (st.isDirectory()) {
      out.push({ word: w, kind: 'dir', real: realOf(abs) ?? abs });
      continue;
    }
    const d = fileSha(abs, ctx.cache);
    out.push(d ? { word: w, kind: 'file', real: d.real, sha256: d.sha256 } : { word: w, kind: 'unreadable' });
  }
  return out;
}

/** A gate-class file a check may read (the config closure): never a directory rule, a memory file or an alias. */
export function isClosureName(name: string): boolean {
  if (/^[tj]sconfig([.-][^/\\]*)?\.json$/i.test(name)) return true;
  const rule = gateClassPathRule(name);
  if (rule === null) return false;
  return rule.startsWith('file:') || rule === 'test-config' || rule === 'code-config' || rule === 'env-file';
}

const inside = (root: string, p: string): boolean => {
  const rel = path.relative(root, p);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/**
 * The config closure of a loop's run checks: the closure files directly in the repo root and in every directory on
 * the way (inside the repo) to argv0 and to each argv path, never under node_modules or .git. Builtins are
 * kernel-pinned and add nothing. A loop with no run check has an empty closure.
 */
export function closureOf(compiled: CompiledLoop, ctx: HashContext): Closure {
  const root = realOf(ctx.repoRoot) ?? ctx.repoRoot;
  const dirs = new Set<string>();
  const addChain = (p: string): void => {
    let d = p;
    for (let i = 0; i < 64 && inside(root, d); i++) {
      const segs = path.relative(root, d).split(path.sep);
      if (!segs.includes('node_modules') && !segs.includes('.git')) dirs.add(d);
      if (d === root) break;
      d = path.dirname(d);
    }
  };
  let anyRun = false;
  for (const n of compiled.nodes) {
    if (n.type !== 'check' || !n.run) continue;
    anyRun = true;
    const a0 = resolveArgv0(n.run[0]!, ctx);
    if (a0) addChain(path.dirname(path.resolve(a0)));
    for (const w of argvWords(n.run)) {
      const abs = path.isAbsolute(w) ? w : path.resolve(root, w);
      let isDir = false;
      try {
        isDir = fs.statSync(abs).isDirectory();
      } catch {
        isDir = false;
      }
      addChain(isDir ? abs : path.dirname(abs));
    }
  }
  if (!anyRun) return { digest: tagged(shaHex(canonicalJson({ files: [] }))), files: [], truncated: 0, all: [] };
  dirs.add(root);
  const files: ClosureFile[] = [];
  for (const d of [...dirs].sort()) {
    let names: string[];
    try {
      names = fs.readdirSync(d);
    } catch {
      continue;
    }
    for (const name of names.sort()) {
      if (!isClosureName(name)) continue;
      const abs = path.join(d, name);
      let st: fs.Stats;
      try {
        st = fs.lstatSync(abs);
      } catch {
        continue;
      }
      if (!st.isFile() && !st.isSymbolicLink()) continue;
      const dg = fileSha(abs, ctx.cache);
      files.push({ rel: path.relative(root, abs).split(path.sep).join('/'), sha256: dg ? dg.sha256 : 'unreadable' });
    }
  }
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  // EVERY closure file is hashed (Aegis LP2 #3); only the listing the card shows is capped
  const digest = tagged(shaHex(canonicalJson({ files })));
  const truncated = Math.max(0, files.length - CLOSURE_MAX_FILES);
  return { digest, files: files.slice(0, CLOSURE_MAX_FILES), truncated, all: files };
}

/** The repo-relative argv path words of every run check (for the protected set). */
export function runPathWords(compiled: CompiledLoop): string[] {
  const out: string[] = [];
  for (const n of compiled.nodes) if (n.type === 'check' && n.run) out.push(...argvPathWords(n.run));
  return out;
}

/**
 * The content hash (see the header). `parsed` is the JSON.parse of the file (hashed canonically), `calleeHash`
 * gives each callee's current content hash (or null).
 */
export function computeLoopHash(parsed: unknown, compiled: CompiledLoop, ctx: HashContext, calleeHash: (callee: string) => string | null): LoopHash {
  const defHash = tagged(shaHex(canonicalJson(parsed)));
  const argv: NodeArgvDigest[] = [];
  const calls: CallDigest[] = [];
  for (const n of compiled.nodes) {
    if (n.type === 'check' && n.run) argv.push({ node: n.id, argv0: argv0Digest(n.run[0]!, ctx), files: argvFileDigests(n.run, ctx) });
    if (n.type === 'call') calls.push({ node: n.id, pin: n.loop, callee: n.callee, calleeHash: calleeHash(n.callee) });
  }
  const closure = closureOf(compiled, ctx);
  const core = { v: LOOP_HASH_VERSION, def: defHash, argv, calls };
  const coreHash = tagged(shaHex(canonicalJson(core)));
  const contentHash = tagged(shaHex(canonicalJson({ ...core, closure: closure.digest })));
  return { contentHash, coreHash, defHash, argv, closure, calls };
}
