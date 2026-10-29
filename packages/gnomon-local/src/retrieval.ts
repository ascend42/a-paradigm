/**
 * @symbol #local-retrieval-tools
 * @symbol #gnomon-local
 *
 * Retrieval tools for small local models (slice B1, TD-2026-10-27-833): find
 * and read the few lines a question needs instead of whole files. All of them
 * use confine.ts — the SAME confinement as read_file/write_file:
 *
 *   grep{pattern, path?, glob?, max?, regex?}
 *     - LITERAL by default (String.includes per line: linear time);
 *     - regex only with regex=true, checked by checkRegex BEFORE compiling:
 *       at most REGEX_MAX_CHARS, no backreference (`\1`…`\9`, `\k<…>`), no
 *       lookbehind (`(?<=`, `(?<!`), compiled with the `u` flag; it RUNS in
 *       a worker thread (regexMatcher) with a wall-clock budget of
 *       REGEX_TIME_MS for the whole call: a pathological pattern is
 *       terminated, never hangs the child; a worker that errors or exits
 *       (OOM, RangeError) ends the call "regex failed: …" (Aegis M1); each
 *       tested line is cut to REGEX_LINE_CHARS;
 *     - `glob` is matched by globMatcher — an O(n·m) position-set matcher
 *       for `*`, `**`, `?` and `{a,b}`, never a regex (Aegis H1: the kernel
 *       dialect's protectGlob regex backtracks on adversarial globs; it stays
 *       for the kernel's own config globs only);
 *     - the walk starts at resolveRead(path) (realpath inside the roots; a
 *       start under `.git` is refused, L2) and descends in code-unit name
 *       order (deterministic); it NEVER follows a symlink (file or directory:
 *       lstat-typed dirents, skipped and counted), never enters `.git`
 *       (isDotGit: case/alias-insensitive) or a nested node_modules,
 *       re-checks every directory and every file through its realpath against
 *       the canonical roots (confinedDir/confinedFile), opens files through
 *       openRead (verified handle, O_NONBLOCK) and skips any file with more
 *       than one hard link, binaries (a NUL byte in the first BINARY_PROBE
 *       bytes) and files over GREP_FILE_BYTES;
 *     - bounded (Aegis M2): at most GREP_MAX_FILES files read,
 *       GREP_MAX_BYTES bytes read, GREP_MAX_ENTRIES directory entries,
 *       GREP_TIME_MS wall clock (both modes), GREP_MAX_HITS hits (`max`
 *       lowers it); at most GREP_CONCURRENCY greps run at once in the child
 *       (a semaphore; the rest wait); the run's AbortSignal (ctx.signal)
 *       stops the walk; each printed line is cut to GREP_LINE_CHARS; output
 *       `path:line: text` with the path relative to the cwd in POSIX form.
 *   outline{path}: a deterministic regex extractor per extension (OUTLINE
 *     table: ts/js/tsx/jsx/mjs/cjs/mts/cts, py, go, rs; md headings outside
 *     fences by a fixed regex plus string trimming, Aegis H2). Fixed patterns
 *     only (never model text), written without adjacent overlapping
 *     quantifiers; each line cut to OUTLINE_LINE_CHARS before matching. No
 *     model.
 *   read_section{path, from?, to?} | {path, symbol} | {handle, from?, to?}:
 *     lines from..to (1-based, inclusive) of a confined file; a symbol's
 *     section via outline (to the next entry at the same or a shallower
 *     depth); or of a spill handle `@rN` (shape.ts) — a handle keeps its
 *     source label. The page is sized under ctx.resultCap so shaping never
 *     re-spills it; a cut page names the next `from`.
 *   edit{path, old, new}: exact replacement of the ONE occurrence of `old`
 *     (0 or more than 1 ⇒ refused with the count and lines); the target goes
 *     through resolveWrite (roots, .git, protect globs, symlink final
 *     component, hard links) and updateConfined (Aegis M3: the per-target lock
 *     shared with write_file; the file must be unchanged between the read and
 *     the write).
 * Every result that carries file content sets `source` (shape.ts labels it).
 */
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import { canonRoots, confinedDir, confinedFile, isDotGit, PathRefused, readConfined, relComponents, resolveRead, resolveWrite, shownPath, sourceOf, updateConfined, type ResultSource, type ToolContext, type ToolResult } from './confine.js';
import { bodyOf, escapeData, HANDLE_RE, MIN_SHAPE_CHARS, restoreSpecialTokens, SHAPE_CAP_CHARS } from './shape.js';

export const GREP_MAX_FILES = 2000;
export const GREP_MAX_ENTRIES = 20_000;
export const GREP_MAX_HITS = 60;
export const GREP_LINE_CHARS = 200;
export const GREP_FILE_BYTES = 1024 * 1024;
/** Aegis M2: the most bytes one grep call reads, both modes */
export const GREP_MAX_BYTES = 32 * 1024 * 1024;
/** Aegis M2: one grep call's wall clock, both modes (the regex worker has its own REGEX_TIME_MS inside it) */
export const GREP_TIME_MS = 5000;
/** Aegis M2: greps running at once in the child (a turn may hold up to 32 tool calls) */
export const GREP_CONCURRENCY = 2;
export const GREP_MAX_DEPTH = 64;
export const BINARY_PROBE = 8192;
export const REGEX_MAX_CHARS = 256;
export const REGEX_LINE_CHARS = 4096;
export const REGEX_TIME_MS = 3000;
export const GLOB_MAX_CHARS = 256;
export const OUTLINE_FILE_BYTES = 1024 * 1024;
export const OUTLINE_LINE_CHARS = 1000;
export const OUTLINE_MAX_ENTRIES = 400;
export const SECTION_FILE_BYTES = 4 * 1024 * 1024;
export const EDIT_FILE_BYTES = 4 * 1024 * 1024;
/** room a read_section page leaves under its cap for the header, the note and a label */
const PAGE_OVERHEAD = 400;

const str = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || v.length === 0) throw new Error(`${name} must be a non-empty string`);
  return v;
};

/** A 1-based line number argument (absent ⇒ undefined). */
const lineArg = (v: unknown, name: string): number | undefined => {
  if (v === undefined || v === null) return undefined;
  const n = typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) throw new Error(`${name} must be a line number (1 or more)`);
  return n;
};

const isBinary = (b: Buffer): boolean => b.subarray(0, BINARY_PROBE).includes(0);
const splitLines = (t: string): string[] => {
  const ls = t.split(/\r?\n/);
  if (ls.length > 1 && ls.at(-1) === '') ls.pop();
  return ls;
};
const cutLine = (t: string, n: number): string => (t.length > n ? `${t.slice(0, n)}…` : t);
const withSource = (src: ResultSource | undefined): Partial<ToolResult> => (src ? { source: src } : {});

// ---------------------------------------------------------------------------------------------------------------
// globs (Aegis H1): a position-set matcher, never a regex
// ---------------------------------------------------------------------------------------------------------------

type GlobToken = { t: 'lit'; c: string } | { t: 'any' } | { t: 'star' } | { t: 'globstar' } | { t: 'globdir' } | { t: 'alt'; alts: string[] };

/**
 * A model-written glob as a matcher over a repo-relative POSIX path, case-insensitive (the kernel dialect's
 * semantics: `*` within a component, `**` across components, `**​/` zero or more directories, `?` one non-`/` char,
 * `{a,b}` literal alternatives, a glob with no wildcard also matches everything beneath it). Matching keeps the SET of
 * reachable path positions per token — O(path length × glob length), no backtracking.
 */
export function globMatcher(glob: string): (p: string) => boolean {
  if (glob.length > GLOB_MAX_CHARS) throw new Error(`glob is over ${GLOB_MAX_CHARS} chars`);
  const g = glob.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '').toLowerCase();
  const toks: GlobToken[] = [];
  let wild = false;
  for (let i = 0; i < g.length; i++) {
    const c = g[i]!;
    if (c === '*') {
      wild = true;
      if (g[i + 1] === '*') {
        i++;
        if (g[i + 1] === '/') {
          i++;
          toks.push({ t: 'globdir' });
        } else toks.push({ t: 'globstar' });
      } else toks.push({ t: 'star' });
    } else if (c === '?') {
      wild = true;
      toks.push({ t: 'any' });
    } else if (c === '{' && g.indexOf('}', i) > i) {
      wild = true;
      const end = g.indexOf('}', i);
      const alts = g.slice(i + 1, end).split(',');
      if (alts.length > 64) throw new Error('a glob {…} has more than 64 alternatives');
      toks.push({ t: 'alt', alts });
      i = end;
    } else toks.push({ t: 'lit', c });
  }
  if (!wild) return (p) => {
    const q = p.toLowerCase();
    return q === g || q.startsWith(`${g}/`);
  };
  return (p) => {
    const s = p.toLowerCase();
    const n = s.length;
    let cur = new Uint8Array(n + 1);
    cur[0] = 1;
    for (const tk of toks) {
      const nx = new Uint8Array(n + 1);
      let any = false;
      if (tk.t === 'lit') {
        for (let i = 0; i < n; i++) if (cur[i] && s[i] === tk.c) nx[i + 1] = 1;
      } else if (tk.t === 'any') {
        for (let i = 0; i < n; i++) if (cur[i] && s[i] !== '/') nx[i + 1] = 1;
      } else if (tk.t === 'star') {
        let run = false;
        for (let i = 0; i <= n; i++) {
          if (i > 0 && s[i - 1] === '/') run = false;
          run = run || cur[i] === 1;
          if (run) nx[i] = 1;
        }
      } else if (tk.t === 'globstar') {
        let run = false;
        for (let i = 0; i <= n; i++) {
          run = run || cur[i] === 1;
          if (run) nx[i] = 1;
        }
      } else if (tk.t === 'globdir') {
        // zero directories (stay) or any prefix ending in '/'
        let seen = false;
        for (let i = 0; i <= n; i++) {
          if (cur[i]) nx[i] = 1;
          if (seen && i > 0 && s[i - 1] === '/') nx[i] = 1;
          seen = seen || cur[i] === 1;
        }
      } else {
        for (let i = 0; i <= n; i++) {
          if (!cur[i]) continue;
          for (const a of tk.alts) if (s.startsWith(a, i)) nx[i + a.length] = 1;
        }
      }
      for (let i = 0; i <= n; i++) if (nx[i]) any = true;
      if (!any) return false;
      cur = nx;
    }
    return cur[n] === 1;
  };
}

// ---------------------------------------------------------------------------------------------------------------
// grep: regex limits (checked before compiling) and the matchers
// ---------------------------------------------------------------------------------------------------------------

/** Why a model-written regex is refused, or null when it may be compiled. Escapes are skipped as units. */
export function checkRegex(src: string): string | null {
  if (src.length > REGEX_MAX_CHARS) return `the regex is over ${REGEX_MAX_CHARS} chars`;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (c === '\\') {
      const n = src[i + 1] ?? '';
      if (/[1-9]/.test(n) || n === 'k') return 'backreferences are not allowed';
      i++;
      continue;
    }
    if (c === '(' && src.startsWith('(?<=', i)) return 'lookbehind is not allowed';
    if (c === '(' && src.startsWith('(?<!', i)) return 'lookbehind is not allowed';
  }
  try {
    new RegExp(src, 'u');
  } catch (err) {
    return `invalid regex: ${(err as Error).message.slice(0, 120)}`;
  }
  return null;
}

/**
 * The regex runs here, off the main thread: each message is one file's lines, the reply the matching indexes. The
 * caller terminates the worker when the call's REGEX_TIME_MS budget is spent (a catastrophic pattern never hangs).
 */
export const REGEX_WORKER_SRC = `
const { parentPort, workerData } = require('node:worker_threads');
const re = new RegExp(workerData.source, 'u');
parentPort.on('message', (lines) => {
  const hits = [];
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) hits.push(i);
  parentPort.postMessage(hits);
});
`;

/** A matcher's answer: the matching line indexes, the regex budget spent, or a failed worker (Aegis M1). */
export type MatchResult = number[] | 'timeout' | { failed: string };

export interface Matcher {
  match(lines: string[]): Promise<MatchResult>;
  close(): Promise<void>;
}

function literalMatcher(pattern: string): Matcher {
  return {
    match: async (lines) => lines.flatMap((l, i) => (l.includes(pattern) ? [i] : [])),
    close: async () => undefined,
  };
}

/**
 * The regex worker (module comment). Aegis M1: an `error` or `exit` of the worker (OOM, a RangeError, a crash) marks
 * the matcher dead, clears the timer and resolves the pending call with `{failed}` — never an unhandled error.
 * `src` is the worker's code (tests inject a failing one).
 */
export function regexMatcher(source: string, budgetMs = REGEX_TIME_MS, src = REGEX_WORKER_SRC): Matcher {
  const w = new Worker(src, { eval: true, workerData: { source }, resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 } });
  const deadline = Date.now() + budgetMs;
  let dead: MatchResult | null = null;
  let pending: { resolve: (r: MatchResult) => void; timer: NodeJS.Timeout } | null = null;
  const settle = (r: MatchResult): void => {
    if (!pending) return;
    clearTimeout(pending.timer);
    const p = pending;
    pending = null;
    p.resolve(r);
  };
  const fail = (why: string): void => {
    if (dead) return;
    dead = { failed: why.slice(0, 200) };
    settle(dead);
  };
  w.on('message', (hits: number[]) => settle(hits));
  w.on('error', (err: Error) => fail(`${err.name}: ${err.message}`));
  w.on('exit', (code) => fail(`the regex worker exited (code ${code})`));
  return {
    match: (lines) =>
      new Promise((resolve) => {
        if (dead) return resolve(dead);
        const timer = setTimeout(() => {
          dead = 'timeout';
          settle('timeout');
          void w.terminate();
        }, Math.max(0, deadline - Date.now()));
        pending = { resolve, timer };
        w.postMessage(lines.map((l) => l.slice(0, REGEX_LINE_CHARS)));
      }),
    close: async () => {
      dead = dead ?? 'timeout';
      await w.terminate();
    },
  };
}

/** Aegis M2: a counting semaphore (FIFO). */
export class Semaphore {
  #free: number;
  readonly #wait: Array<() => void> = [];
  peak = 0;
  #held = 0;

  constructor(n: number) {
    this.#free = n;
  }

  /** slots free right now (none held and none waiting ⇒ the count it was made with) */
  get available(): number {
    return this.#free;
  }

  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (this.#free > 0) this.#free--;
    else
      await new Promise<void>((resolve, reject) => {
        const go = (): void => {
          signal?.removeEventListener('abort', stop);
          resolve();
        };
        const stop = (): void => {
          const i = this.#wait.indexOf(go);
          if (i >= 0) this.#wait.splice(i, 1);
          reject(new Error('aborted'));
        };
        if (signal?.aborted) return stop();
        signal?.addEventListener('abort', stop, { once: true });
        this.#wait.push(go);
      });
    this.#held++;
    this.peak = Math.max(this.peak, this.#held);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.#held--;
      const next = this.#wait.shift();
      if (next) next();
      else this.#free++;
    };
  }
}

/** Aegis M2: the child's grep slots. */
export const grepSlots = new Semaphore(GREP_CONCURRENCY);

export interface GrepLimits {
  maxFiles: number;
  maxBytes: number;
  maxEntries: number;
  timeMs: number;
  regexMs: number;
}

export const GREP_LIMITS: Readonly<GrepLimits> = Object.freeze({ maxFiles: GREP_MAX_FILES, maxBytes: GREP_MAX_BYTES, maxEntries: GREP_MAX_ENTRIES, timeMs: GREP_TIME_MS, regexMs: REGEX_TIME_MS });

// ---------------------------------------------------------------------------------------------------------------
// grep
// ---------------------------------------------------------------------------------------------------------------

export async function grep(a: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  return grepWith(a, ctx, GREP_LIMITS);
}

/** grep with explicit limits (the tool uses GREP_LIMITS; tests lower them) and, for tests, the regex matcher factory. */
export async function grepWith(a: Record<string, unknown>, ctx: ToolContext, lim: Readonly<GrepLimits>, makeRegex: (source: string, budgetMs: number) => Matcher = regexMatcher): Promise<ToolResult> {
  const pattern = str(a.pattern, 'pattern');
  if (pattern.length > REGEX_MAX_CHARS * 4) throw new Error(`pattern is over ${REGEX_MAX_CHARS * 4} chars`);
  const useRegex = a.regex === true || a.regex === 'true';
  if (useRegex) {
    const why = checkRegex(pattern);
    if (why) throw new Error(`regex refused: ${why} (or search literally: omit regex)`);
  }
  let max = GREP_MAX_HITS;
  if (a.max !== undefined && a.max !== null) {
    const m = typeof a.max === 'string' ? Number(a.max) : a.max;
    if (typeof m !== 'number' || !Number.isInteger(m) || m < 1) throw new Error('max must be a positive integer');
    max = Math.min(GREP_MAX_HITS, m);
  }
  let globOk: ((p: string) => boolean) | null = null;
  let globBase = false;
  if (a.glob !== undefined && a.glob !== null && a.glob !== '') {
    const g = str(a.glob, 'glob');
    globOk = globMatcher(g);
    // re-check B1: the matcher reads `\` as `/`; the basename decision must too (`src\*.ts` is a path glob)
    globBase = !g.replace(/\\/g, '/').includes('/');
  }
  const startRaw = typeof a.path === 'string' && a.path ? a.path : '.';
  const start = await resolveRead(startRaw, ctx);
  const croots = await canonRoots(ctx.roots);
  // L2: a start under .git is refused (the walk never enters .git; neither does a start)
  if ((relComponents(start, croots) ?? []).some(isDotGit)) throw new PathRefused('grep under .git is refused');
  const ccwd = await fsp.realpath(ctx.cwd).catch(() => ctx.cwd);
  const st = await fsp.stat(start);

  const deadline = Date.now() + lim.timeMs;
  const hits: string[] = [];
  const hitFiles = new Set<string>();
  let modelGenerated = false;
  const skipped = { binary: 0, large: 0, links: 0, other: 0 };
  let files = 0;
  let bytes = 0;
  let entries = 0;
  let stop: string | null = null;
  let failed: string | null = null;
  // built inside the try below (re-check B1, L-b): a matcher that throws while starting never leaks a slot
  let matcher: Matcher | null = null;
  const halt = (): boolean => {
    if (stop) return true;
    if (ctx.signal?.aborted) stop = 'an abort';
    else if (Date.now() > deadline) stop = `the ${lim.timeMs / 1000} s time limit`;
    return stop !== null;
  };

  const scanFile = async (p: string, rel: string): Promise<void> => {
    if (globOk && !globOk(globBase ? path.posix.basename(rel) : rel)) return;
    if (halt()) return;
    if (files >= lim.maxFiles) {
      stop = `the ${lim.maxFiles}-file cap`;
      return;
    }
    const real = await confinedFile(p, croots);
    if (!real) {
      skipped.other++;
      return;
    }
    const size = (await fsp.stat(real).catch(() => null))?.size ?? 0;
    if (size > GREP_FILE_BYTES) {
      skipped.large++;
      return;
    }
    if (bytes + size > lim.maxBytes) {
      stop = `the ${lim.maxBytes}-byte read budget`;
      return;
    }
    let buf: Buffer;
    try {
      ({ buf } = await readConfined(real, GREP_FILE_BYTES, croots));
    } catch {
      skipped.other++;
      return;
    }
    files++;
    bytes += buf.length;
    if (isBinary(buf)) {
      skipped.binary++;
      return;
    }
    const lines = splitLines(buf.toString('utf8'));
    const found = await matcher!.match(lines);
    if (found === 'timeout') {
      stop = `the ${lim.regexMs / 1000} s regex time limit (simplify the pattern)`;
      return;
    }
    if (!Array.isArray(found)) {
      failed = found.failed;
      stop = 'a failed regex';
      return;
    }
    const shown = shownPath(ccwd, real);
    for (const i of found) {
      if (hits.length >= max) {
        stop = `the ${max}-hit cap`;
        break;
      }
      hits.push(`${shown}:${i + 1}: ${cutLine(lines[i]!.trim(), GREP_LINE_CHARS)}`);
      hitFiles.add(shown);
      if (sourceOf(real, ctx) === 'model-generated') modelGenerated = true;
    }
  };

  const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
    if (halt() || depth > GREP_MAX_DEPTH) return;
    if (!(await confinedDir(dir, croots))) return;
    let ents;
    try {
      ents = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    ents.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
    for (const e of ents) {
      if (halt()) return;
      if (++entries > lim.maxEntries) {
        stop = `the ${lim.maxEntries}-entry walk cap`;
        return;
      }
      const p = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) skipped.links++;
      else if (e.isDirectory()) {
        if (!isDotGit(e.name) && e.name !== 'node_modules') await walk(p, r, depth + 1);
      } else if (e.isFile()) await scanFile(p, r);
    }
  };

  // the slot is taken right before the try that always releases it, and the matcher is built inside it (L-b)
  const release = await grepSlots.acquire(ctx.signal);
  try {
    matcher = useRegex ? makeRegex(pattern, lim.regexMs) : literalMatcher(pattern);
    if (st.isDirectory()) await walk(start, '', 0);
    else await scanFile(start, path.basename(start));
  } finally {
    try {
      await matcher?.close();
    } finally {
      release();
    }
  }
  if (failed !== null) throw new Error(`regex failed: ${failed}`);
  const skip = Object.entries(skipped).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(', ');
  const summary = `[grep: ${hits.length ? `${hits.length} hit${hits.length === 1 ? '' : 's'} in ${hitFiles.size} file${hitFiles.size === 1 ? '' : 's'}` : 'no matches'}; scanned ${files} file${files === 1 ? '' : 's'}${skip ? ` (skipped: ${skip})` : ''}${stop ? `; stopped at ${stop}` : ''}.]`;
  return { content: [...hits, summary].join('\n'), isError: false, ...withSource(hits.length ? (modelGenerated ? 'model-generated' : 'workspace') : undefined) };
}

// ---------------------------------------------------------------------------------------------------------------
// outline
// ---------------------------------------------------------------------------------------------------------------

export interface OutlineEntry {
  line: number;
  name: string;
  kind: string;
  /** leading whitespace width (code) or heading level (markdown): a section ends at the next entry at ≤ depth */
  depth: number;
  text: string;
}

type Rule = readonly [kind: string, re: RegExp];

const JS_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'with', 'else', 'do', 'try', 'new', 'await', 'typeof', 'super']);
// Aegis H2: no two adjacent quantifiers here can match the same characters (no polynomial backtracking)
const JS: readonly Rule[] = [
  ['function', /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?function\s*(?:\*\s*)?([A-Za-z_$][\w$]*)/],
  ['class', /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/],
  ['type', /^\s*(?:export\s+)?(?:declare\s+)?(?:interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/],
  ['function', /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]{0,200})?=\s*(?:async\s+)?(?:function\b|\([^)]{0,300}\)\s*(?::[^=]{0,200})?=>|[A-Za-z_$][\w$]*\s*=>)/],
  ['export', /^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/],
  ['method', /^\s+(?:(?:public|private|protected|static|readonly|async|override|abstract|get|set)\s+)*(#?[A-Za-z_$][\w$]*)\s*(?:<[^>]{0,200}>\s*)?\([^)]{0,300}\)\s*(?::[^{;]{0,200})?\{\s*$/],
];
const PY: readonly Rule[] = [
  ['function', /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/],
  ['class', /^\s*class\s+([A-Za-z_]\w*)/],
];
const GO: readonly Rule[] = [
  ['function', /^func\s+(?:\([^)]{0,200}\)\s*)?([A-Za-z_]\w*)/],
  ['type', /^type\s+([A-Za-z_]\w*)/],
];
const RS: readonly Rule[] = [
  ['function', /^\s*(?:pub(?:\([^)]{0,50}\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]{0,20}"\s+)?fn\s+([A-Za-z_]\w*)/],
  ['type', /^\s*(?:pub(?:\([^)]{0,50}\))?\s+)?(?:struct|enum|trait|type|union|mod)\s+([A-Za-z_]\w*)/],
  ['impl', /^\s*impl(?:<[^>]{0,200}>)?\s+(?:[^\s{]{1,200}\s+for\s+)?([A-Za-z_][\w:]*)/],
];
/** Aegis H2: the markdown heading — the level and the raw rest; trailing `#`s and spaces are trimmed by string ops. */
const MD_HEADING = /^\s{0,3}(#{1,6})(?:\s([\s\S]*))?$/;

/** The extractor per extension (data). md is handled by its own heading scan. */
export const OUTLINE: Readonly<Record<string, readonly Rule[] | 'md'>> = Object.freeze({
  '.ts': JS, '.tsx': JS, '.mts': JS, '.cts': JS, '.js': JS, '.jsx': JS, '.mjs': JS, '.cjs': JS,
  '.py': PY, '.go': GO, '.rs': RS, '.md': 'md', '.markdown': 'md',
});

/** A markdown heading's text: leading and trailing spaces and the closing `#` run trimmed, without a regex. */
function headingText(rest: string): string {
  let e = rest.length;
  while (e > 0 && isWs(rest[e - 1]!)) e--;
  let h = e;
  while (h > 0 && rest[h - 1] === '#') h--;
  // a closing `#` run counts only after a space (or when it is the whole rest)
  if (h < e && (h === 0 || isWs(rest[h - 1]!))) e = h;
  while (e > 0 && isWs(rest[e - 1]!)) e--;
  let b = 0;
  while (b < e && isWs(rest[b]!)) b++;
  return rest.slice(b, e);
}
const isWs = (c: string): boolean => c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v';

/** Outline `text` as a file with extension `ext` (lower-case, with the dot); null when the extension has no extractor. */
export function outlineOf(text: string, ext: string): OutlineEntry[] | null {
  const rules = OUTLINE[ext];
  if (!rules) return null;
  const out: OutlineEntry[] = [];
  const lines = splitLines(text);
  let fence = false;
  for (let i = 0; i < lines.length && out.length < OUTLINE_MAX_ENTRIES; i++) {
    const l = lines[i]!.slice(0, OUTLINE_LINE_CHARS);
    if (rules === 'md') {
      if (/^\s{0,3}(?:```|~~~)/.test(l)) fence = !fence;
      const m = fence ? null : MD_HEADING.exec(l);
      const name = m ? headingText(m[2] ?? '') : '';
      if (m && name) out.push({ line: i + 1, name, kind: 'heading', depth: m[1]!.length, text: l.trim() });
      continue;
    }
    for (const [kind, re] of rules) {
      const m = re.exec(l);
      if (!m) continue;
      if (kind === 'method' && JS_KEYWORDS.has(m[1]!)) break;
      out.push({ line: i + 1, name: m[1]!, kind, depth: /^\s*/.exec(l)![0].length, text: l.trim() });
      break;
    }
  }
  return out;
}

async function readText(real: string, max: number, ctx: ToolContext): Promise<string> {
  const { buf } = await readConfined(real, max, await canonRoots(ctx.roots));
  if (isBinary(buf)) throw new PathRefused('a binary file is refused (a NUL byte)');
  return buf.toString('utf8');
}

export async function outline(a: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const raw = str(a.path, 'path');
  const real = await resolveRead(raw, ctx);
  const ext = path.extname(real).toLowerCase();
  if (!OUTLINE[ext]) throw new Error(`no outline for "${ext || 'no extension'}" files (ts/js, py, go, rs, md); use grep or read_section`);
  const text = await readText(real, OUTLINE_FILE_BYTES, ctx);
  const entries = outlineOf(text, ext)!;
  const total = splitLines(text).length;
  const shown = raw.slice(0, 200);
  const body = entries.map((e) => `${e.line}: ${' '.repeat(Math.min(e.kind === 'heading' ? (e.depth - 1) * 2 : e.depth, 12))}${cutLine(e.text, 160)}`);
  const head = `[outline ${shown}: ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}, ${total} lines${entries.length >= OUTLINE_MAX_ENTRIES ? `; the first ${OUTLINE_MAX_ENTRIES}` : ''}. Read one with read_section path="${shown}" symbol=<name>.]`;
  return { content: [head, ...body].join('\n'), isError: false, source: sourceOf(real, ctx) };
}

// ---------------------------------------------------------------------------------------------------------------
// read_section
// ---------------------------------------------------------------------------------------------------------------

/** The section of the entry at `idx`: its line to the line before the next entry at the same or a shallower depth. */
function sectionOf(entries: readonly OutlineEntry[], idx: number, total: number): { from: number; to: number } {
  const e = entries[idx]!;
  const next = entries.slice(idx + 1).find((x) => x.depth <= e.depth);
  return { from: e.line, to: next ? next.line - 1 : total };
}

export async function readSection(a: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const handleArg = typeof a.handle === 'string' && a.handle.trim() ? a.handle.trim() : typeof a.path === 'string' && HANDLE_RE.test(a.path.trim()) ? a.path.trim() : null;
  let text: string;
  let source: ResultSource | undefined;
  let name: string;
  let ext = '';
  if (handleArg !== null) {
    if (!HANDLE_RE.test(handleArg)) throw new Error('handle must look like @r12');
    const e = ctx.spill?.get(handleArg);
    if (!e) throw new Error(`handle ${handleArg} is unknown or expired; run the tool again`);
    ({ text, source } = e);
    name = `${handleArg} (${e.tool} result)`;
  } else {
    const raw = str(a.path, 'path (or handle)');
    const real = await resolveRead(raw, ctx);
    text = await readText(real, SECTION_FILE_BYTES, ctx);
    source = sourceOf(real, ctx);
    name = raw.slice(0, 200);
    ext = path.extname(real).toLowerCase();
  }
  const lines = splitLines(text);
  const total = lines.length;
  let from = lineArg(a.from, 'from') ?? 1;
  let to = lineArg(a.to, 'to');
  let what = '';
  if (typeof a.symbol === 'string' && a.symbol) {
    if (handleArg !== null) throw new Error('symbol needs a path (a handle has no outline)');
    const entries = outlineOf(text, ext);
    if (!entries) throw new Error(`no outline for "${ext || 'no extension'}" files; use from/to`);
    const sym = a.symbol.slice(0, 200);
    let idx = entries.findIndex((e) => e.name === sym);
    if (idx < 0) idx = entries.findIndex((e) => e.name.toLowerCase() === sym.toLowerCase());
    // L3: the names come from the file: escaped in the (unlabelled) error
    if (idx < 0) throw new Error(`no symbol "${escapeData(sym)}" in ${name}; outline lists: ${escapeData(entries.slice(0, 12).map((e) => e.name.slice(0, 80)).join(', ')) || '(nothing)'}`);
    ({ from, to } = sectionOf(entries, idx, total));
    const others = entries.filter((e, i) => i !== idx && e.name === entries[idx]!.name).map((e) => e.line);
    what = ` (${entries[idx]!.kind} ${entries[idx]!.name}${others.length ? `; also at line ${others.slice(0, 5).join(', ')}` : ''})`;
  }
  if (total === 0) return { content: `[read_section ${name}: empty]`, isError: false };
  if (from > total) throw new Error(`from=${from} is past the end (${total} lines)`);
  const end = Math.min(total, to ?? total);
  if (end < from) throw new Error('to must be at or after from');
  const room = Math.max(MIN_SHAPE_CHARS, Math.floor(ctx.resultCap ?? SHAPE_CAP_CHARS) - PAGE_OVERHEAD);
  // the page is sized as it will reach the model (labelled text may grow when escaped)
  const size = (l: string): number => bodyOf(l, source).length + 1;
  const page: string[] = [];
  let used = 0;
  let last = from - 1;
  for (let i = from; i <= end; i++) {
    const l = lines[i - 1]!;
    if (used + size(l) > room) {
      // one line alone over the page: its head goes (never an empty page)
      if (!page.length) {
        page.push(`${l.slice(0, Math.floor(room / (source === 'model-generated' ? 4 : 1)))} […line cut]`);
        last = i;
      }
      break;
    }
    page.push(l);
    used += size(l);
    last = i;
  }
  const src = handleArg !== null ? `handle="${handleArg}"` : `path="${name}"`;
  const more = last < end ? ` Call read_section ${src} from=${last + 1}${to !== undefined || what ? ` to=${end}` : ''} for more.` : '';
  const content = `[read_section ${name}${what}: lines ${from}-${last} of ${total}.${more}]\n${page.join('\n')}`;
  return { content, isError: false, ...withSource(source) };
}

// ---------------------------------------------------------------------------------------------------------------
// edit
// ---------------------------------------------------------------------------------------------------------------

export async function edit(a: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const raw = str(a.path, 'path');
  // re-check B1 (M-a): the model copies lines it read with special tokens split by a word joiner; restoring exactly
  // those joiners makes `old` match the file's literal text and `new` write it
  const old = restoreSpecialTokens(str(a.old, 'old'));
  if (typeof a.new !== 'string') throw new Error('new must be a string');
  const next = restoreSpecialTokens(a.new);
  if (old === next) throw new Error('old and new are the same');
  const p = await resolveWrite(raw, ctx);
  const shown = raw.slice(0, 200);
  try {
    // Aegis M3: read, check and write under the per-target lock shared with write_file; unchanged between read and write
    return await updateConfined(p, ctx, EDIT_FILE_BYTES, (buf) => {
      if (isBinary(buf)) throw new PathRefused('a binary file is refused (a NUL byte)');
      const text = buf.toString('utf8');
      const at: number[] = [];
      for (let i = text.indexOf(old); i >= 0 && at.length < 11; i = text.indexOf(old, i + 1)) at.push(i);
      const lineAt = (i: number): number => text.slice(0, i).split('\n').length;
      if (at.length === 0) {
        const hint = /&(lt|amp);/.test(old) ? ' The text you read may have been escaped (&lt; &amp;): use the literal characters.' : '';
        throw new Error(`old text not found in ${shown} (0 matches); it must match exactly, whitespace included. Re-read the lines with read_section.${hint}`);
      }
      if (at.length > 1) throw new Error(`old text matches ${at.length > 10 ? 'more than 10' : at.length} times in ${shown} (lines ${at.slice(0, 10).map(lineAt).join(', ')}); include more surrounding text so it matches once`);
      const i = at[0]!;
      const n = (t: string): number => t.split('\n').length;
      return { text: text.slice(0, i) + next + text.slice(i + old.length), result: { content: `edited ${shown}: replaced 1 occurrence at line ${lineAt(i)} (${n(old)} line${n(old) === 1 ? '' : 's'} → ${n(next)})`, isError: false } };
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`${shown} does not exist; use write_file to create it`);
    throw err;
  }
}
