/**
 * @symbol #paradigm-stage
 *
 * TD-2026-10-27-833 (follow-up to slice C2'): the first-party Paradigm MCP runs for LOCAL sessions only from a STAGED,
 * hashed copy inside the Gnomon home, never from its install (an install can be an `npm link` into a checkout a
 * session can write).
 *
 *   what     the single-file bundle when the install ships one (dist/mcp-bundle/manifest.json, schema
 *            paradigm-mcp-bundle:v1: exactly the files it names), else the package tree (every file, `.bin` dirs of
 *            node_modules skipped). Any staged entry that is a symlink, a hardlink (nlink > 1), a special file or
 *            resolves outside the source tree refuses the WHOLE stage.
 *   where    <home>/mcp/first-party/paradigm/<version>-<treeSha12>/ (dirs 0700, files 0400), built in a temp dir and
 *            renamed into place; <dir>.manifest.json [{relativePath, mode, sha256, size}] beside it; pin.json
 *            {schema, version, source, sourceKind npm-global | linked-checkout, treeSha256, stagedAt, entry, layout,
 *            dirty}. The home is read- and write-denied to every session (§15.5).
 *   hash     sha256 over the sorted lines `<rel>\0<mode octal>\0<sha256>\n` of the COPY (never the source).
 *   when     an npm-global install: automatically when its version (or source dir) differs from the pin. A linked
 *            checkout: never automatically, only by the human's request.mcp.paradigm.stage. Never on a file change.
 *   verify   verifyStaged at session open: pin, manifest and the staged tree agree exactly (file set, modes, regular
 *            files, nlink 1, sha256, tree hash, dir name); recheckStaged right before spawn: a synchronous
 *            size/mtime/inode/regular-file check per file. A mismatch means Paradigm is not offered (pin-mismatch).
 */
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const PARADIGM_STAGE_REL: readonly string[] = Object.freeze(['mcp', 'first-party', 'paradigm']);
export const PARADIGM_PIN_FILE = 'pin.json';
export const PARADIGM_PIN_SCHEMA = 'gnomon-paradigm-pin:v1' as const;
export const PARADIGM_BUNDLE_MANIFEST = ['dist', 'mcp-bundle', 'manifest.json'] as const;
export const PARADIGM_BUNDLE_SCHEMA = 'paradigm-mcp-bundle:v1' as const;
export const STAGED_FILE_MODE = 0o400;
export const STAGED_DIR_MODE = 0o700;
export const STAGE_MAX_FILES = 20_000;
export const STAGE_MAX_BYTES = 768 * 1024 * 1024;
const PIN_MAX_BYTES = 64 * 1024;
const MANIFEST_MAX_BYTES = 8 * 1024 * 1024;

export type ParadigmSourceKind = 'npm-global' | 'linked-checkout';
export interface StagedEntry {
  relativePath: string;
  mode: number;
  sha256: string;
  size: number;
}
export interface ParadigmPin {
  schema: typeof PARADIGM_PIN_SCHEMA;
  version: string;
  source: string;
  sourceKind: ParadigmSourceKind;
  treeSha256: string;
  stagedAt: string;
  /** the entry script, relative to the staged dir (posix) */
  entry: string;
  layout: 'bundle' | 'tree';
  /** a linked checkout's git dirty state when it was staged (null: unknown or not a checkout) */
  dirty: boolean | null;
}
/** What the kernel knows of the install it would stage (#mcp-servers FirstPartyLaunch). */
export interface ParadigmSource {
  dir: string;
  entry: string;
  version: string | null;
  linked: boolean;
}
export interface StagedSnapshot {
  files: ReadonlyArray<{ abs: string; size: number; mtimeMs: number; ino: number }>;
}
export type VerifyResult = { ok: true; pin: ParadigmPin; dir: string; entry: string; snapshot: StagedSnapshot } | { ok: false; why: string };

export class StageRefused extends Error {
  constructor(
    readonly why: 'symlink' | 'hardlink' | 'outside' | 'special' | 'too-large' | 'no-entry' | 'no-version' | 'inside-home' | 'bad-manifest',
    message: string,
  ) {
    super(`#paradigm-stage: ${message}`);
  }
}

export const stageRoot = (home: string): string => path.join(home, ...PARADIGM_STAGE_REL);
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const hex64 = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const safeRel = (r: string): boolean => r.length > 0 && r.length <= 1024 && !r.startsWith('/') && !/^[A-Za-z]:/.test(r) && !r.includes('\\') && !r.split('/').some((c) => c === '' || c === '.' || c === '..');
const within = (p: string, root: string): boolean => {
  const r = path.relative(root, p);
  return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
};
const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const safeVersion = (v: string): string => v.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64) || 'unknown';

/** sha256 over the sorted `<rel>\0<mode octal>\0<sha256>\n` lines. */
export function stagedTreeHash(entries: readonly StagedEntry[]): string {
  const h = createHash('sha256');
  for (const e of [...entries].sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0))) h.update(`${e.relativePath}\0${e.mode.toString(8)}\0${e.sha256}\n`);
  return h.digest('hex');
}

/** One source file to stage: regular, nlink 1, never a link, inside the source tree. */
function checkSourceFile(abs: string, rel: string, rootReal: string): fs.Stats {
  const st = fs.lstatSync(abs);
  if (st.isSymbolicLink()) throw new StageRefused('symlink', `the source holds a symlink: ${rel.slice(0, 200)}`);
  if (!st.isFile()) throw new StageRefused('special', `the source holds a non-regular entry: ${rel.slice(0, 200)}`);
  if (st.nlink > 1) throw new StageRefused('hardlink', `the source holds a hardlink: ${rel.slice(0, 200)}`);
  if (!within(fs.realpathSync.native(abs), rootReal)) throw new StageRefused('outside', `a source entry resolves outside the source tree: ${rel.slice(0, 200)}`);
  return st;
}

/** What to copy: the bundle's named files when the install ships a bundle manifest, else the package tree. */
export function selectStageFiles(src: ParadigmSource): { layout: 'bundle' | 'tree'; entry: string; files: Array<{ rel: string; abs: string }> } {
  const rootReal = fs.realpathSync.native(src.dir);
  const manifestPath = path.join(rootReal, ...PARADIGM_BUNDLE_MANIFEST);
  let bundle: Record<string, unknown> | null = null;
  try {
    const st = fs.lstatSync(manifestPath);
    if (st.isFile() && st.size <= MANIFEST_MAX_BYTES) bundle = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  } catch {
    bundle = null;
  }
  if (bundle && bundle.schema === PARADIGM_BUNDLE_SCHEMA) {
    const files = Array.isArray(bundle.files) ? bundle.files : [];
    const base = path.dirname(manifestPath);
    const out = files.map((f) => {
      const rel = isObj(f) && typeof f.relativePath === 'string' ? f.relativePath : '';
      if (!safeRel(rel)) throw new StageRefused('bad-manifest', 'the bundle manifest names an unsafe path');
      const abs = path.join(base, ...rel.split('/'));
      checkSourceFile(abs, rel, rootReal);
      return { rel, abs };
    });
    const entry = typeof bundle.entry === 'string' ? bundle.entry : '';
    if (!safeRel(entry) || !out.some((f) => f.rel === entry)) throw new StageRefused('no-entry', 'the bundle manifest entry is not one of its files');
    if (out.length > STAGE_MAX_FILES) throw new StageRefused('too-large', 'the bundle names too many files');
    return { layout: 'bundle', entry, files: out };
  }
  const out: Array<{ rel: string; abs: string }> = [];
  let bytes = 0;
  const walk = (d: string, prefix: string): void => {
    for (const name of fs.readdirSync(d).sort()) {
      const abs = path.join(d, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      // node_modules/.bin holds only links to package bins; node's resolution never reads it
      if (name === '.bin' && path.basename(d) === 'node_modules') continue;
      const st = fs.lstatSync(abs);
      if (st.isDirectory()) walk(abs, rel);
      else {
        checkSourceFile(abs, rel, rootReal);
        bytes += st.size;
        if (out.length >= STAGE_MAX_FILES || bytes > STAGE_MAX_BYTES) throw new StageRefused('too-large', 'the package tree is too large to stage');
        out.push({ rel, abs });
      }
    }
  };
  walk(rootReal, '');
  const entryReal = fs.realpathSync.native(src.entry);
  if (!within(entryReal, rootReal)) throw new StageRefused('no-entry', 'the paradigm-mcp entry lies outside the package');
  const entry = path.relative(rootReal, entryReal).split(path.sep).join('/');
  if (!out.some((f) => f.rel === entry)) throw new StageRefused('no-entry', 'the paradigm-mcp entry is not a staged file');
  return { layout: 'tree', entry, files: out };
}

/** The pin, or null when absent or malformed (fail closed: no pin, no first-party server). */
export function readParadigmPin(home: string): ParadigmPin | null {
  try {
    const p = path.join(stageRoot(home), PARADIGM_PIN_FILE);
    const st = fs.lstatSync(p);
    if (!st.isFile() || st.size > PIN_MAX_BYTES) return null;
    const v = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
    if (v.schema !== PARADIGM_PIN_SCHEMA || typeof v.version !== 'string' || typeof v.source !== 'string' || !hex64(v.treeSha256) || typeof v.stagedAt !== 'string' || typeof v.entry !== 'string' || !safeRel(v.entry)) return null;
    if (v.sourceKind !== 'npm-global' && v.sourceKind !== 'linked-checkout') return null;
    if (v.layout !== 'bundle' && v.layout !== 'tree') return null;
    return { schema: PARADIGM_PIN_SCHEMA, version: v.version, source: v.source, sourceKind: v.sourceKind, treeSha256: v.treeSha256, stagedAt: v.stagedAt, entry: v.entry, layout: v.layout, dirty: typeof v.dirty === 'boolean' ? v.dirty : null };
  } catch {
    return null;
  }
}

export const stagedDirName = (pin: Pick<ParadigmPin, 'version' | 'treeSha256'>): string => `${safeVersion(pin.version)}-${pin.treeSha256.slice(0, 12)}`;

function chmodTree(dir: string, mode: number): void {
  try {
    fs.chmodSync(dir, mode);
    for (const n of fs.readdirSync(dir)) {
      const p = path.join(dir, n);
      if (fs.lstatSync(p).isDirectory()) chmodTree(p, mode);
    }
  } catch {
    /* gone */
  }
}
function removeTree(dir: string): void {
  chmodTree(dir, 0o700);
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Stage `src` into the Gnomon home and write the pin. Copies into a temp dir, hashes the COPY, renames it into place
 * (a concurrent stage of the same tree is success), then writes the manifest and pin.json (0600, atomic).
 */
export function stageParadigm(home: string, src: ParadigmSource, o: { sourceKind: ParadigmSourceKind; dirty?: boolean | null; now?: () => number }): ParadigmPin {
  if (!src.version) throw new StageRefused('no-version', 'the install names no version');
  const homeReal = fs.realpathSync.native(home);
  const srcReal = fs.realpathSync.native(src.dir);
  if (within(srcReal, homeReal) || within(homeReal, srcReal)) throw new StageRefused('inside-home', 'the source overlaps the Gnomon home');
  const sel = selectStageFiles(src);
  const root = stageRoot(home);
  fs.mkdirSync(root, { recursive: true, mode: STAGED_DIR_MODE });
  const tmp = path.join(root, `.tmp-${randomBytes(8).toString('hex')}`);
  fs.mkdirSync(tmp, { mode: STAGED_DIR_MODE });
  try {
    const entries: StagedEntry[] = [];
    for (const f of sel.files) {
      const to = path.join(tmp, ...f.rel.split('/'));
      fs.mkdirSync(path.dirname(to), { recursive: true, mode: STAGED_DIR_MODE });
      fs.copyFileSync(f.abs, to, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(to, STAGED_FILE_MODE);
      const b = fs.readFileSync(to);
      entries.push({ relativePath: f.rel, mode: STAGED_FILE_MODE, sha256: sha256(b), size: b.length });
    }
    const treeSha256 = stagedTreeHash(entries);
    const pin: ParadigmPin = { schema: PARADIGM_PIN_SCHEMA, version: src.version, source: srcReal, sourceKind: o.sourceKind, treeSha256, stagedAt: new Date((o.now ?? Date.now)()).toISOString(), entry: sel.entry, layout: sel.layout, dirty: o.dirty ?? null };
    const dest = path.join(root, stagedDirName(pin));
    const manifestPath = `${dest}.manifest.json`;
    const writeAtomic = (p: string, text: string, mode: number): void => {
      const t = `${p}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
      fs.writeFileSync(t, text, { mode: 0o600 });
      fs.chmodSync(t, mode);
      fs.renameSync(t, p);
    };
    if (fs.existsSync(dest)) {
      // what is there must verify as THIS tree, else it is replaced
      const ok = verifyTree(dest, manifestPath, pin);
      if (ok !== null) removeTree(dest);
    }
    if (!fs.existsSync(dest)) {
      try {
        fs.renameSync(tmp, dest);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (!(code === 'EEXIST' || code === 'ENOTEMPTY')) throw err;
      }
    }
    writeAtomic(manifestPath, `${JSON.stringify(entries)}\n`, 0o400);
    if (verifyTree(dest, manifestPath, pin) !== null) throw new StageRefused('bad-manifest', 'the staged copy does not verify');
    writeAtomic(path.join(root, PARADIGM_PIN_FILE), `${JSON.stringify(pin, null, 2)}\n`, 0o600);
    pruneStages(root, stagedDirName(pin));
    return pin;
  } finally {
    if (fs.existsSync(tmp)) removeTree(tmp);
  }
}

/** Keep the current stage and the newest previous one (a live session may still spawn from it); drop the rest. */
function pruneStages(root: string, current: string): void {
  try {
    const dirs = fs.readdirSync(root).filter((n) => n !== current && !n.startsWith('.') && fs.lstatSync(path.join(root, n)).isDirectory());
    const byAge = dirs.map((n) => ({ n, t: fs.lstatSync(path.join(root, n)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const d of byAge.slice(1)) {
      removeTree(path.join(root, d.n));
      fs.rmSync(path.join(root, `${d.n}.manifest.json`), { force: true });
    }
  } catch {
    /* best effort */
  }
}

/** Full verification of one staged dir against its manifest and pin; null = ok, else why. */
function verifyTree(dir: string, manifestPath: string, pin: ParadigmPin, snap?: StagedSnapshot['files'][number][]): string | null {
  let manifest: StagedEntry[];
  try {
    const st = fs.lstatSync(manifestPath);
    if (!st.isFile() || st.size > MANIFEST_MAX_BYTES) return 'the manifest is missing';
    const v = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown;
    if (!Array.isArray(v)) return 'the manifest is malformed';
    manifest = v.filter((e): e is StagedEntry => isObj(e) && typeof e.relativePath === 'string' && safeRel(e.relativePath) && typeof e.mode === 'number' && hex64(e.sha256) && typeof e.size === 'number');
    if (manifest.length !== v.length) return 'the manifest is malformed';
  } catch {
    return 'the manifest is unreadable';
  }
  if (stagedTreeHash(manifest) !== pin.treeSha256) return 'the manifest does not hash to the pin';
  if (!manifest.some((e) => e.relativePath === pin.entry)) return 'the pinned entry is not in the manifest';
  const want = new Map(manifest.map((e) => [e.relativePath, e]));
  const seen = new Set<string>();
  const walk = (d: string, prefix: string): string | null => {
    const dst = fs.lstatSync(d);
    if (dst.isSymbolicLink() || !dst.isDirectory()) return `${prefix || '.'} is not a real directory`;
    if (process.platform !== 'win32' && (dst.mode & 0o777) !== STAGED_DIR_MODE) return `${prefix || '.'} has mode ${(dst.mode & 0o777).toString(8)}`;
    for (const n of fs.readdirSync(d).sort()) {
      const abs = path.join(d, n);
      const rel = prefix ? `${prefix}/${n}` : n;
      const st = fs.lstatSync(abs);
      if (st.isDirectory()) {
        const r = walk(abs, rel);
        if (r) return r;
        continue;
      }
      const e = want.get(rel);
      if (!e) return `an unexpected file: ${rel.slice(0, 200)}`;
      if (st.isSymbolicLink() || !st.isFile()) return `${rel.slice(0, 200)} is not a regular file`;
      if (st.nlink > 1) return `${rel.slice(0, 200)} is a hardlink`;
      if (process.platform !== 'win32' && (st.mode & 0o777) !== e.mode) return `${rel.slice(0, 200)} has mode ${(st.mode & 0o777).toString(8)}`;
      if (st.size !== e.size || sha256(fs.readFileSync(abs)) !== e.sha256) return `${rel.slice(0, 200)} changed`;
      seen.add(rel);
      snap?.push({ abs, size: st.size, mtimeMs: st.mtimeMs, ino: st.ino });
    }
    return null;
  };
  try {
    const r = walk(dir, '');
    if (r) return r;
  } catch (e) {
    return `the staged copy is unreadable (${(e as Error).message.slice(0, 120)})`;
  }
  if (seen.size !== want.size) return 'a staged file is missing';
  return null;
}

/** Session open: the pin, its manifest and the staged tree agree exactly. */
export function verifyStaged(home: string): VerifyResult {
  const pin = readParadigmPin(home);
  if (!pin) return { ok: false, why: 'no pin' };
  const dir = path.join(stageRoot(home), stagedDirName(pin));
  const files: StagedSnapshot['files'][number][] = [];
  const why = verifyTree(dir, `${dir}.manifest.json`, pin, files);
  if (why) return { ok: false, why };
  let real: string;
  try {
    real = fs.realpathSync.native(dir);
  } catch {
    return { ok: false, why: 'the staged dir vanished' };
  }
  return { ok: true, pin, dir: real, entry: path.join(real, ...pin.entry.split('/')), snapshot: { files: files.map((f) => ({ ...f, abs: path.join(real, path.relative(dir, f.abs)) })) } };
}

/** Right before spawn, synchronously: every staged file still has the size, mtime and inode verifyStaged saw. */
export function recheckStaged(s: StagedSnapshot): string | null {
  for (const f of s.files) {
    let st: fs.Stats;
    try {
      st = fs.lstatSync(f.abs);
    } catch {
      return `${path.basename(f.abs)} is gone`;
    }
    if (!st.isFile() || st.isSymbolicLink() || st.nlink > 1 || st.size !== f.size || st.mtimeMs !== f.mtimeMs || st.ino !== f.ino) return `${path.basename(f.abs)} changed since the session opened`;
  }
  return null;
}

const NULL_DEV = process.platform === 'win32' ? 'NUL' : '/dev/null';
/** git, hardened: no fsmonitor, no hooks, no system or global config, no lazy fetch, no prompt. */
function git(dir: string, args: readonly string[]): { ok: boolean; out: string } {
  const r = spawnSync('git', ['-c', 'core.fsmonitor=false', '-c', `core.hooksPath=${NULL_DEV}`, '-C', dir, ...args], {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: NULL_DEV, GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0', GIT_ATTR_NOSYSTEM: '1' },
  });
  return { ok: r.status === 0 && typeof r.stdout === 'string', out: typeof r.stdout === 'string' ? r.stdout : '' };
}

/**
 * Aegis H3: a checkout's full status under the package — tracked changes, untracked AND ignored files (dist/mcp-bundle
 * is gitignored, so a hidden rebuild shows only here). null when it is not a git checkout.
 */
export function gitStatusOf(dir: string): { dirty: boolean; count: number; entries: string[] } | null {
  const r = git(dir, ['status', '--porcelain', '--ignored', '--untracked-files=all', '--', '.']);
  if (!r.ok) return null;
  const lines = r.out.split('\n').filter((l) => l.length > 0);
  return { dirty: lines.length > 0, count: lines.length, entries: lines.slice(0, 50).map((l) => l.slice(0, 300)) };
}

/** A checkout's dirty state (tracked, untracked and ignored files under the package), or null. */
export function gitDirtyOf(dir: string): boolean | null {
  return gitStatusOf(dir)?.dirty ?? null;
}

/** HEAD's commit time (ms), or null. */
export function headCommitTimeOf(dir: string): number | null {
  const r = git(dir, ['log', '-1', '--no-ext-diff', '--no-textconv', '--format=%ct']);
  const t = Number(r.out.trim());
  return r.ok && Number.isFinite(t) && t > 0 ? t * 1000 : null;
}

/** When the code that would be staged was built: the bundle manifest's mtime, else the entry's (ms), or null. */
export function builtAtOf(src: ParadigmSource): number | null {
  for (const p of [path.join(src.dir, ...PARADIGM_BUNDLE_MANIFEST), src.entry]) {
    try {
      return fs.statSync(p).mtimeMs;
    } catch {
      /* next */
    }
  }
  return null;
}

export const sourceKindOf = (src: Pick<ParadigmSource, 'linked'>): ParadigmSourceKind => (src.linked ? 'linked-checkout' : 'npm-global');

/**
 * The automatic rule: an npm-global install is staged when its version or source dir differs from the pin (or there
 * is no pin). A linked checkout is NEVER staged here (only by the human's request). Returns what happened.
 */
export function autoStage(home: string, src: ParadigmSource): { staged: boolean; pin: ParadigmPin | null; why?: string } {
  const pin = readParadigmPin(home);
  if (src.linked) return { staged: false, pin, why: 'linked-checkout' };
  let srcReal: string;
  try {
    srcReal = fs.realpathSync.native(src.dir);
  } catch {
    return { staged: false, pin, why: 'source-missing' };
  }
  if (pin && pin.sourceKind === 'npm-global' && pin.version === src.version && pin.source === srcReal) return { staged: false, pin };
  try {
    return { staged: true, pin: stageParadigm(home, src, { sourceKind: 'npm-global' }) };
  } catch (e) {
    return { staged: false, pin, why: (e as Error).message.slice(0, 200) };
  }
}
