/**
 * #history-git — history rows derived from git (T-2026-11-06-001, Option C).
 *
 * Every commit row is a pure function of (SHA, message, changed files, the
 * .purpose files at that SHA), so it is derived on read instead of being
 * appended to a tracked file by the post-commit hook (which dirtied the tree
 * after every commit and minted colliding `wc -l + 1` ids across branches).
 *
 * deriveCommitEntries(root):
 *   1. `git rev-list HEAD`                      — the reachable SHAs
 *   2. the machine-home cache                    — rows already derived, keyed by SHA
 *   3. one `git log --no-walk --stdin` over the missing SHAs only (incremental)
 *   4. for commits without a `Symbols:` trailer, the nearest .purpose at that
 *      SHA via two `git cat-file --batch` calls (oids, then unique blobs)
 *   5. append the new rows to the cache; return the reachable rows with symbols
 *
 * The cache lives in the machine home (<state dir>/<repoId>/history/commits.jsonl)
 * because it is a memo, not learning data: deleting it only costs a rebuild.
 * Rows for SHAs that are no longer reachable (amended, other branches) stay in
 * the cache and are filtered out by the rev-list step.
 *
 * Every git call goes through execFileSync with an argv array (no shell) and
 * `--no-optional-locks`, so a read never takes the index lock.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import * as yaml from 'js-yaml';
import { log } from './mcp-logger.js';
import { machineHomeFor } from './learning-stores.js';
import type { HistoryEntry, HistoryIntent } from '../types/history.js';

/** Bump when the derivation of a row changes; cached rows of another version are re-derived. */
export const HISTORY_DERIVE_VERSION = 2; // 2: narrowed .purpose fallback (only symbols whose path matches a changed file)

const FS = '\x1f';
const RS = '\x1e';
const MAX_BUFFER = 512 * 1024 * 1024;

export interface RawCommit {
  sha: string;
  authorName: string;
  authorDate: string;
  message: string;
  /** Changed files (none for a merge commit: git log shows no diff for merges by default). */
  files: string[];
}

export interface DerivedHistory {
  /** Reachable commits with at least one symbol, newest first (rev-list order). */
  entries: HistoryEntry[];
  shallow: boolean;
  head: string | null;
  /**
   * False when some reachable commit could not be derived this call (a git
   * failure or timeout, or the per-call budget ran out). Callers must not
   * treat an incomplete result as the current state (no fresh stamp, no write).
   */
  complete: boolean;
}

export interface DeriveOptions {
  cacheFile?: string;
  /** SHAs per `git log` call (default 2000). */
  chunk?: number;
  /** Most SHAs derived per call (default 20000); the rest wait for the next read. */
  maxPerCall?: number;
  /** Compaction bounds (tests): unreachable rows that trigger it, and how many newest to keep. */
  compact?: { trigger: number; keep: number };
}

/** Test-only fault injection: make one git step fail as a timeout would. */
const faults: { revList?: boolean; log?: boolean; catFile?: boolean } = {};
export function __setHistoryGitFaultsForTests(f: { revList?: boolean; log?: boolean; catFile?: boolean }): void {
  faults.revList = f.revList;
  faults.log = f.log;
  faults.catFile = f.catFile;
}
function fault(step: 'revList' | 'log' | 'catFile'): void {
  if (faults[step]) throw new Error(`injected ${step} failure`);
}

interface CacheRow {
  v: number;
  sha: string;
  /** null: the commit carries no symbols (kept so it is not derived again). */
  entry: HistoryEntry | null;
}

/**
 * Environment for a history READ: inherited GIT_DIR / GIT_WORK_TREE /
 * GIT_INDEX_FILE dropped (git hooks set them, and a hook-run read must look at
 * the root it was given), no credential prompt, and no lazy fetch in a partial
 * clone (a read never touches the network).
 */
export function historyGitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_PREFIX;
  env.GIT_TERMINAL_PROMPT = '0';
  env.GIT_NO_LAZY_FETCH = '1';
  return env;
}
const gitEnv = historyGitEnv;

function git(root: string, args: readonly string[], input?: string | Buffer): string {
  return execFileSync('git', ['--no-optional-locks', '-c', 'core.quotePath=false', ...args], {
    cwd: root,
    env: gitEnv(),
    encoding: 'utf8',
    input,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: MAX_BUFFER,
    timeout: 120_000,
  });
}

function gitBuffer(root: string, args: readonly string[], input: string): Buffer {
  return execFileSync('git', ['--no-optional-locks', ...args], {
    cwd: root,
    env: gitEnv(),
    input,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: MAX_BUFFER,
    timeout: 120_000,
  });
}

/** HEAD's SHA, or null outside git or before the first commit. Never throws. */
export function gitHead(root: string): string | null {
  try {
    const out = git(root, ['rev-parse', '--verify', '--quiet', 'HEAD']).trim();
    return /^[0-9a-f]{40,64}$/.test(out) ? out : null;
  } catch {
    return null;
  }
}

/** True in a shallow clone. Never throws. */
export function isShallowRepo(root: string): boolean {
  try {
    return git(root, ['rev-parse', '--is-shallow-repository']).trim() === 'true';
  } catch {
    return false;
  }
}

/** Where the derived rows are cached for `root`. */
export function historyCachePath(root: string): string {
  return path.join(machineHomeFor(root), 'history', 'commits.jsonl');
}

/**
 * Parse `git log --format=%x1e%H%x1f%an%x1f%aI%x1f%B%x1f --name-only` output.
 * The record separator leads each record so the file list (which git prints
 * after the formatted part) stays inside its own record.
 */
export function parseCommitLog(raw: string): RawCommit[] {
  const out: RawCommit[] = [];
  for (const rec of raw.split(RS)) {
    if (!rec.trim()) continue;
    const parts = rec.split(FS);
    if (parts.length < 5) continue;
    const [sha, authorName, authorDate, message] = parts;
    const files = parts.slice(4).join(FS).split('\n').map((f) => f.trim()).filter(Boolean);
    out.push({ sha: sha.trim(), authorName, authorDate: authorDate.trim(), message: message.replace(/\r\n/g, '\n').replace(/\s+$/, ''), files });
  }
  return out;
}

const SYMBOL_RE = /^[#$^!~][A-Za-z0-9][A-Za-z0-9._:/-]*$/;

/**
 * Symbols from EVERY `Symbols:` line of a commit message. A GitHub squash
 * merge concatenates the messages of all its commits, so one body can carry
 * several trailers. An empty `Symbols:` line contributes nothing.
 */
export function trailerSymbols(message: string): string[] {
  const out = new Set<string>();
  for (const line of message.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:[*-]\s+)?Symbols:\s*(.*)$/);
    if (!m) continue;
    for (const raw of m[1].split(/[,\s]+/)) {
      const s = raw.trim().replace(/^`|`$/g, '');
      if (SYMBOL_RE.test(s)) out.add(s);
    }
  }
  return [...out].sort();
}

const SECTION_PREFIX: Record<string, string> = {
  features: '#',
  components: '#',
  gates: '^',
  flows: '$',
  signals: '!',
  aspects: '~',
};

export interface PurposeItem {
  symbol: string;
  /** Declared `path` / `file` / `files` (as written: relative to the .purpose dir, the package, or the repo). */
  paths: string[];
}

function declaredPaths(v: unknown): string[] {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return [];
  const o = v as Record<string, unknown>;
  const out: string[] = [];
  for (const k of ['path', 'file', 'files']) {
    const x = o[k];
    for (const p of Array.isArray(x) ? x : [x]) {
      if (typeof p === 'string' && p.trim()) out.push(p.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, ''));
    }
  }
  return out;
}

/**
 * Symbols a .purpose file declares, with their declared paths:
 * `components:` / `features:` map keys or list items (`- id:` / `- name:`)
 * → `#id`, `gates:` → `^`, `flows:` → `$`, `signals:` → `!`, `aspects:` → `~`,
 * plus quoted top-level keys that already carry a prefix. [] on bad YAML.
 */
export function purposeItems(text: string): PurposeItem[] {
  let doc: unknown;
  try {
    doc = yaml.load(text);
  } catch {
    return [];
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return [];
  const out = new Map<string, PurposeItem>();
  const add = (prefix: string, id: unknown, body: unknown) => {
    if (typeof id !== 'string' || !id.trim()) return;
    const sym = /^[#$^!~]/.test(id) ? id.trim() : `${prefix}${id.trim()}`;
    if (!SYMBOL_RE.test(sym)) return;
    const item = out.get(sym) ?? { symbol: sym, paths: [] };
    for (const p of declaredPaths(body)) if (!item.paths.includes(p)) item.paths.push(p);
    out.set(sym, item);
  };
  for (const [key, value] of Object.entries(doc as Record<string, unknown>)) {
    if (/^[#$^!~]/.test(key)) {
      add('', key, value);
      continue;
    }
    const prefix = SECTION_PREFIX[key];
    if (!prefix || !value || typeof value !== 'object') continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') add(prefix, item, null);
        else if (item && typeof item === 'object') add(prefix, (item as Record<string, unknown>).id ?? (item as Record<string, unknown>).name, item);
      }
    } else {
      for (const [id, body] of Object.entries(value as Record<string, unknown>)) add(prefix, id, body);
    }
  }
  return [...out.values()].sort((a, b) => (a.symbol < b.symbol ? -1 : 1));
}

/** Every symbol id a .purpose declares (prefixed, sorted). */
export function purposeSymbols(text: string): string[] {
  return purposeItems(text).map((i) => i.symbol);
}

/**
 * The symbols of the .purpose in `purposeDir` that cover changed `file`
 * (repo-relative, forward slashes). A declared path matches when it names the
 * file or a folder holding it, read relative to the .purpose dir, to the repo
 * root, or as a trailing path (package-relative `src/x.ts`). A symbol with no
 * declared path matches only a file whose name stem equals its id
 * (login-form.ts, login-form.test.ts ↔ #login-form). No match, no symbols: a
 * commit never inherits every component of a .purpose.
 */
export function matchPurposeItems(items: PurposeItem[], purposeDir: string, file: string): string[] {
  const under = (f: string, t: string) => t.length > 0 && (f === t || f.startsWith(`${t}/`));
  const out: string[] = [];
  for (const item of items) {
    const hit = item.paths.length === 0
      ? path.posix.basename(file).split('.')[0] === item.symbol.slice(1)
      : item.paths.some((p) => under(file, path.posix.join(purposeDir, p)) || under(file, p) || file.endsWith(`/${p}`) || file.includes(`/${p}/`));
    if (hit) out.push(item.symbol);
  }
  return out;
}

/** True when a `Co-Authored-By:` trailer names an AI agent or a bot. */
export function isAgentCommit(message: string): boolean {
  for (const line of message.split(/\r?\n/)) {
    const m = line.match(/^\s*Co-Authored-By:\s*(.*)$/i);
    if (m && /(claude|anthropic|copilot|cursor|codex|openai|chatgpt|gpt-|gemini|devin|aider|\[bot\])/i.test(m[1])) return true;
  }
  return false;
}

/** Intent from the subject line (same rule as the pre-v4 post-commit hook). */
export function intentOf(subject: string): HistoryIntent {
  if (/^(feat|feature|add)/.test(subject)) return 'feature';
  if (/^(fix|bug)/.test(subject)) return 'fix';
  if (/^refactor/.test(subject)) return 'refactor';
  return 'feature';
}

/** The directories whose .purpose could cover `file`, nearest first (the repo root is never used). */
function candidateDirs(file: string): string[] {
  const dirs: string[] = [];
  let dir = path.posix.dirname(file);
  while (dir && dir !== '.' && dir !== '/') {
    dirs.push(dir);
    dir = path.posix.dirname(dir);
  }
  return dirs;
}

/**
 * Symbols of the nearest .purpose (at each commit's SHA) for the files of the
 * given commits. Two batched cat-file calls whatever the commit count.
 */
/**
 * True in a partial clone (`extensions.partialclone`, or any remote.*.promisor
 * = true), where a tree or blob may simply not be local. Never throws.
 */
export function isPartialClone(root: string): boolean {
  try {
    if (git(root, ['config', '--get', 'extensions.partialclone']).trim()) return true;
  } catch { /* unset */ }
  try {
    return git(root, ['config', '--get-regexp', '^remote\\..*\\.promisor$']).split('\n').some((l) => /\s(true|yes|on|1)\s*$/i.test(l));
  } catch {
    return false;
  }
}

function purposeSymbolsAt(root: string, commits: RawCommit[], partial = false): { map: Map<string, string[]>; ok: boolean; failed: Set<string> } {
  const result = new Map<string, string[]>();
  const failed = new Set<string>();
  // Pass 1: read the TREE of each candidate folder (`<sha>:<dir>`) and look for
  // a `.purpose` entry. Reading a tree never reads the blob, so in a partial
  // (blobless) clone a .purpose that is not local is still found here and
  // caught as missing in pass 2, instead of passing for "no .purpose".
  const dirSpecs: string[] = [];
  const seen = new Set<string>();
  for (const c of commits) {
    for (const f of c.files) {
      for (const d of candidateDirs(f)) {
        const spec = `${c.sha}:${d}`;
        if (!seen.has(spec)) {
          seen.add(spec);
          dirSpecs.push(spec);
        }
      }
    }
  }
  if (dirSpecs.length === 0) return { map: result, ok: true, failed };

  const oidOf = new Map<string, string>(); // `<sha>:<dir>/.purpose` → blob oid
  try {
    fault('catFile');
    const buf = gitBuffer(root, ['cat-file', '--batch'], dirSpecs.join('\n') + '\n');
    let at = 0;
    for (const spec of dirSpecs) {
      const nl = buf.indexOf(0x0a, at);
      if (nl < 0) break;
      const header = buf.subarray(at, nl).toString('utf8');
      at = nl + 1;
      const m = header.match(/^([0-9a-f]{40,64}) (\S+) (\d+)$/);
      // "<spec> missing": the folder does not exist at that commit (a deleted
      // file's folder) — or, in a partial (treeless) clone, its tree is not
      // local. There we fail closed: the commit is left underived, not cached.
      if (!m) {
        if (partial && / missing$/.test(header)) failed.add(spec.slice(0, spec.indexOf(':')));
        continue;
      }
      const size = Number(m[3]);
      const body = buf.subarray(at, at + size);
      at += size + 1;
      if (m[2] !== 'tree') continue;
      const rawLen = m[1].length / 2;
      let p = 0;
      while (p < body.length) {
        const sp = body.indexOf(0x20, p);
        const nul = body.indexOf(0x00, sp + 1);
        if (sp < 0 || nul < 0) break;
        const mode = body.subarray(p, sp).toString('utf8');
        const name = body.subarray(sp + 1, nul).toString('utf8');
        const oid = body.subarray(nul + 1, nul + 1 + rawLen).toString('hex');
        p = nul + 1 + rawLen;
        if (name === '.purpose' && mode.startsWith('100')) oidOf.set(`${spec}/.purpose`, oid);
      }
    }
  } catch (err) {
    log.component('#history-git').warn('cat-file batch (trees) failed; trailer-less commits left underived', { error: (err as Error).message });
    return { map: result, ok: false, failed };
  }
  // Pass 2: the contents of each distinct .purpose blob, parsed once.
  const blobs = [...new Set(oidOf.values())];
  const itemsOf = new Map<string, PurposeItem[]>();
  const missingBlobs = new Set<string>();
  if (blobs.length > 0) {
    try {
      const buf = gitBuffer(root, ['cat-file', '--batch'], blobs.join('\n') + '\n');
      let at = 0;
      for (const oid of blobs) {
        const nl = buf.indexOf(0x0a, at);
        if (nl < 0) break;
        const header = buf.subarray(at, nl).toString('utf8').split(' ');
        at = nl + 1;
        if (header[1] === 'missing') {
          missingBlobs.add(oid); // not local (partial clone): unknown, not "no symbols"
          continue;
        }
        if (header[1] !== 'blob') continue;
        const size = Number(header[2]);
        itemsOf.set(oid, purposeItems(buf.subarray(at, at + size).toString('utf8')));
        at += size + 1;
      }
    } catch (err) {
      log.component('#history-git').warn('cat-file batch failed; trailer-less commits left underived', { error: (err as Error).message });
      return { map: result, ok: false, failed };
    }
  }

  for (const c of commits) {
    const syms = new Set<string>();
    for (const f of c.files) {
      for (const d of candidateDirs(f)) {
        const oid = oidOf.get(`${c.sha}:${d}/.purpose`);
        if (!oid) continue;
        if (missingBlobs.has(oid)) failed.add(c.sha);
        for (const s of matchPurposeItems(itemsOf.get(oid) ?? [], d, f)) syms.add(s);
        break;
      }
    }
    result.set(c.sha, [...syms].sort());
  }
  return { map: result, ok: failed.size === 0, failed };
}

/**
 * The history row for one commit, or null when it carries no symbol.
 * Symbols come from the `Symbols:` trailers; a commit without any falls back
 * to the nearest .purpose of its changed files (`purpose`).
 */
export function entryForCommit(c: RawCommit, purpose: string[] = []): HistoryEntry | null {
  const fromTrailer = trailerSymbols(c.message);
  const symbols = fromTrailer.length > 0 ? fromTrailer : purpose;
  if (symbols.length === 0) return null;
  const subject = c.message.split(/\r?\n/)[0].trim();
  const when = new Date(c.authorDate);
  return {
    id: `h-${c.sha.slice(0, 12)}`,
    ts: Number.isNaN(when.getTime()) ? c.authorDate : when.toISOString(),
    type: 'implement',
    source: 'git',
    symbols,
    author: { type: isAgentCommit(c.message) ? 'agent' : 'human', id: c.authorName || 'unknown' },
    commit: c.sha,
    intent: intentOf(subject),
    files: c.files,
    description: subject,
  };
}

interface CacheRead {
  map: Map<string, HistoryEntry | null>;
  /** Rows of another derivation version (or torn lines). */
  stale: number;
  total: number;
}

function readCache(file: string): CacheRead {
  const map = new Map<string, HistoryEntry | null>();
  let stale = 0;
  let total = 0;
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { map, stale, total };
  }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    total++;
    try {
      const row = JSON.parse(line) as CacheRow;
      if (row && row.v === HISTORY_DERIVE_VERSION && typeof row.sha === 'string') map.set(row.sha, row.entry ?? null);
      else stale++;
    } catch {
      stale++; // a torn line from a concurrent append: re-derived next time
    }
  }
  return { map, stale, total };
}

/** Write `text` to `file` atomically (temp file + rename in the same folder). */
export function writeFileAtomic(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, text, 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/**
 * The shallow boundary commits (`git rev-parse --git-path shallow`). Git
 * treats them as roots, so `--name-only` lists the whole tree for them.
 */
function shallowBoundary(root: string): Set<string> {
  try {
    const rel = git(root, ['rev-parse', '--git-path', 'shallow']).trim();
    const file = path.isAbsolute(rel) ? rel : path.join(root, rel);
    return new Set(fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

/** Unreachable rows beyond this many trigger a compaction, which keeps the newest COMPACT_KEEP of them. */
const COMPACT_UNREACHABLE = 4000;
const COMPACT_KEEP = 2000;

/**
 * Derive history rows from git for every commit reachable from HEAD,
 * incrementally (only SHAs missing from the machine-home cache are read, in
 * chunks, at most `maxPerCall` per call). Rows are cached only when fully
 * derived: a commit whose .purpose lookup failed and a shallow boundary
 * commit (derived trailer-only with no files) are never cached. Never throws;
 * `complete` says whether every reachable commit was derived.
 */
export function deriveCommitEntries(root: string, opts: DeriveOptions = {}): DerivedHistory {
  const head = gitHead(root);
  if (!head) return { entries: [], shallow: false, head: null, complete: true };
  const shallow = isShallowRepo(root);
  const chunk = Math.max(1, opts.chunk ?? 2000);
  const budget = Math.max(1, opts.maxPerCall ?? 20000);

  let reachable: string[];
  try {
    fault('revList');
    reachable = git(root, ['rev-list', 'HEAD']).split('\n').map((s) => s.trim()).filter(Boolean);
  } catch (err) {
    log.component('#history-git').warn('git rev-list failed; derived history incomplete', { error: (err as Error).message });
    return { entries: [], shallow, head, complete: false };
  }

  let cacheFile: string | null = opts.cacheFile ?? null;
  if (!cacheFile) {
    try {
      cacheFile = historyCachePath(root);
    } catch {
      cacheFile = null; // no home directory: derive without a cache
    }
  }
  const read = cacheFile ? readCache(cacheFile) : { map: new Map<string, HistoryEntry | null>(), stale: 0, total: 0 };
  const cache = read.map;
  const reachableSet = new Set(reachable);

  // Compact: rows of another derivation version, or many unreachable rows (amends, old branches).
  if (cacheFile && read.total > 0) {
    const trigger = opts.compact?.trigger ?? COMPACT_UNREACHABLE;
    const keepN = opts.compact?.keep ?? COMPACT_KEEP;
    const unreachable = [...cache.keys()].filter((sha) => !reachableSet.has(sha));
    if (read.stale > 0 || unreachable.length > trigger) {
      // The cache is shared by every worktree and branch: keep the newest
      // unreachable rows (file order = append order), drop only the oldest.
      const keepUnreachable = new Set(unreachable.slice(-keepN));
      const keep = [...cache].filter(([sha]) => reachableSet.has(sha) || keepUnreachable.has(sha));
      try {
        writeFileAtomic(cacheFile, keep.map(([sha, entry]) => JSON.stringify({ v: HISTORY_DERIVE_VERSION, sha, entry })).join('\n') + (keep.length ? '\n' : ''));
        for (const sha of unreachable) if (!keepUnreachable.has(sha)) cache.delete(sha);
      } catch (err) {
        log.component('#history-git').warn('Could not compact the history cache', { error: (err as Error).message });
      }
    }
  }

  const boundary = shallow ? shallowBoundary(root) : new Set<string>();
  const partial = isPartialClone(root); // once per derive
  const uncached = new Map<string, HistoryEntry | null>(); // derived this call, not cacheable
  const allMissing = reachable.filter((sha) => !cache.has(sha));
  const missing = allMissing.slice(0, budget);
  let complete = missing.length === allMissing.length;

  for (let i = 0; i < missing.length; i += chunk) {
    const part = missing.slice(i, i + chunk);
    let commits: RawCommit[];
    try {
      fault('log');
      const raw = git(
        root,
        ['log', '--no-walk=unsorted', '--stdin', '--no-renames', `--format=${RS}%H${FS}%an${FS}%aI${FS}%B${FS}`, '--name-only'],
        part.join('\n') + '\n',
      );
      commits = parseCommitLog(raw);
    } catch (err) {
      log.component('#history-git').warn('git log failed; derived history incomplete', { error: (err as Error).message });
      complete = false;
      break;
    }
    const rows: CacheRow[] = [];
    const normal: RawCommit[] = [];
    for (const c of commits) {
      if (boundary.has(c.sha)) {
        // a shallow root: its file list is the whole tree. Trailer-only, never cached (it changes on unshallow).
        uncached.set(c.sha, entryForCommit({ ...c, files: [] }, []));
      } else {
        normal.push(c);
      }
    }
    const needPurpose = normal.filter((c) => trailerSymbols(c.message).length === 0);
    const purpose = purposeSymbolsAt(root, needPurpose, partial);
    if (!purpose.ok) complete = false;
    for (const c of normal) {
      const trailerOnly = trailerSymbols(c.message).length > 0;
      // A failed lookup (git error, or a .purpose blob missing in a partial clone) is retried next read, never cached as "no symbols".
      if (!trailerOnly && (purpose.failed.has(c.sha) || (!purpose.ok && purpose.failed.size === 0))) continue;
      const entry = entryForCommit(c, purpose.map.get(c.sha) ?? []);
      cache.set(c.sha, entry);
      rows.push({ v: HISTORY_DERIVE_VERSION, sha: c.sha, entry });
    }
    if (cacheFile && rows.length > 0) {
      try {
        fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
        fs.appendFileSync(cacheFile, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
      } catch (err) {
        log.component('#history-git').warn('Could not write the history cache', { error: (err as Error).message });
      }
    }
  }
  if (missing.length > 0) log.component('#history-git').debug('Derived history rows', { derived: missing.length, reachable: reachable.length, complete });

  const entries = reachable
    .map((s) => (cache.has(s) ? cache.get(s) : uncached.get(s)))
    .filter((e): e is HistoryEntry => !!e);
  return { entries, shallow, head, complete };
}
