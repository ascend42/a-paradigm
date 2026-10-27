/**
 * @symbol #local-retrieval-tools
 * @symbol #gnomon-local
 *
 * Retrieval tools for small local models (slice B1, TD-2026-10-27-833): find
 * and read the few lines a question needs instead of whole files. All of them
 * use confine.ts — the SAME confinement as read_file/write_file:
 *
 *   grep{pattern, path?, glob?, max?, regex?}
 *     - LITERAL by default (String.indexOf per line: linear time);
 *     - regex only with regex=true, checked by checkRegex BEFORE compiling:
 *       at most REGEX_MAX_CHARS, no backreference (`\1`…`\9`, `\k<…>`), no
 *       lookbehind (`(?<=`, `(?<!`), compiled with the `u` flag; it RUNS in
 *       a worker thread (regexWorker) with a wall-clock budget of
 *       REGEX_TIME_MS for the whole call: a pathological pattern is
 *       terminated, never hangs the child; each tested line is cut to
 *       REGEX_LINE_CHARS;
 *     - the walk starts at resolveRead(path) (realpath inside the roots) and
 *       descends in code-unit name order (deterministic); it NEVER follows a
 *       symlink (file or directory: lstat-typed dirents, skipped and
 *       counted), never enters `.git` (isDotGit: case/alias-insensitive) or a
 *       nested node_modules, re-checks every directory and every file through
 *       its realpath against the canonical roots (confinedDir/confinedFile:
 *       a raced symlink lands outside and is skipped), and skips any file
 *       with more than one hard link (confinedFile) and binaries (a NUL byte
 *       in the first BINARY_PROBE bytes) and files over GREP_FILE_BYTES;
 *     - bounded: at most GREP_MAX_FILES files read, GREP_MAX_ENTRIES
 *       directory entries visited, GREP_MAX_HITS hits (`max` lowers it),
 *       each printed line cut to GREP_LINE_CHARS; output `path:line: text`
 *       with the path relative to the cwd in POSIX form.
 *   outline{path}: a deterministic regex extractor per extension (OUTLINE
 *     table: ts/js/tsx/jsx/mjs/cjs/mts/cts, py, go, rs, md headings outside
 *     fences): functions, classes, exports, types, methods, with line
 *     numbers. Fixed patterns only (never model text), each line cut to
 *     OUTLINE_LINE_CHARS before matching. No model.
 *   read_section{path, from?, to?} | {path, symbol} | {handle, from?, to?}:
 *     lines from..to (1-based, inclusive) of a confined file; a symbol's
 *     section via outline (to the next entry at the same or a shallower
 *     depth); or of a spill handle `@rN` (shape.ts) — a handle keeps its
 *     model-source label. The page is sized under ctx.resultCap so shaping
 *     never re-spills it; a cut page names the next `from`.
 *   edit{path, old, new}: exact replacement of the ONE occurrence of `old`
 *     (0 or more than 1 ⇒ refused with the count and lines); the target goes
 *     through resolveWrite (roots, .git, protect globs, symlink final
 *     component, hard links) and writeConfined (write_file's sequence);
 *     edits of one file are serialised inside the child.
 * A result that carries text from a file the model wrote this session sets
 * modelSource (shape.ts labels and escapes it).
 */
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import { canonRoots, confinedDir, confinedFile, isDotGit, PathRefused, readConfined, resolveRead, resolveWrite, shownPath, writeConfined, type ToolContext, type ToolResult } from './confine.js';
import { protectGlob } from './protect.js';
import { escapeData, HANDLE_RE, MIN_SHAPE_CHARS, SHAPE_CAP_CHARS } from './shape.js';

export const GREP_MAX_FILES = 2000;
export const GREP_MAX_ENTRIES = 20_000;
export const GREP_MAX_HITS = 60;
export const GREP_LINE_CHARS = 200;
export const GREP_FILE_BYTES = 1024 * 1024;
export const GREP_MAX_DEPTH = 64;
export const BINARY_PROBE = 8192;
export const REGEX_MAX_CHARS = 256;
export const REGEX_LINE_CHARS = 4096;
export const REGEX_TIME_MS = 3000;
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

// ---------------------------------------------------------------------------------------------------------------
// grep: regex limits (checked before compiling)
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
const WORKER_SRC = `
const { parentPort, workerData } = require('node:worker_threads');
const re = new RegExp(workerData.source, 'u');
parentPort.on('message', (lines) => {
  const hits = [];
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) hits.push(i);
  parentPort.postMessage(hits);
});
`;

interface Matcher {
  /** indexes of the matching lines, or 'timeout' once the call's regex budget is spent */
  match(lines: string[]): Promise<number[] | 'timeout'>;
  close(): Promise<void>;
}

function literalMatcher(pattern: string): Matcher {
  return {
    match: async (lines) => lines.flatMap((l, i) => (l.includes(pattern) ? [i] : [])),
    close: async () => undefined,
  };
}

function regexMatcher(source: string, budgetMs = REGEX_TIME_MS): Matcher {
  const w = new Worker(WORKER_SRC, { eval: true, workerData: { source }, resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 } });
  const deadline = Date.now() + budgetMs;
  let dead = false;
  return {
    match: (lines) =>
      new Promise((resolve) => {
        if (dead) return resolve('timeout');
        const left = deadline - Date.now();
        const t = setTimeout(() => {
          dead = true;
          w.removeAllListeners('message');
          void w.terminate();
          resolve('timeout');
        }, Math.max(0, left));
        w.once('message', (hits: number[]) => {
          clearTimeout(t);
          resolve(hits);
        });
        w.postMessage(lines.map((l) => l.slice(0, REGEX_LINE_CHARS)));
      }),
    close: async () => {
      dead = true;
      await w.terminate();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// grep
// ---------------------------------------------------------------------------------------------------------------

export async function grep(a: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
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
  let globRe: RegExp | null = null;
  let globBase = false;
  if (a.glob !== undefined && a.glob !== null && a.glob !== '') {
    const g = str(a.glob, 'glob');
    if (g.length > 256) throw new Error('glob is over 256 chars');
    globRe = protectGlob(g);
    globBase = !g.includes('/');
  }
  const startRaw = typeof a.path === 'string' && a.path ? a.path : '.';
  const start = await resolveRead(startRaw, ctx);
  const croots = await canonRoots(ctx.roots);
  const ccwd = await fsp.realpath(ctx.cwd).catch(() => ctx.cwd);
  const st = await fsp.stat(start);

  const hits: string[] = [];
  const hitFiles = new Set<string>();
  let modelSource = false;
  const skipped = { binary: 0, large: 0, links: 0, other: 0 };
  let files = 0;
  let entries = 0;
  let stop: string | null = null;
  const matcher = useRegex ? regexMatcher(pattern) : literalMatcher(pattern);

  const scanFile = async (p: string, rel: string): Promise<void> => {
    if (globRe && !globRe.test(globBase ? path.posix.basename(rel) : rel)) return;
    if (files >= GREP_MAX_FILES) {
      stop = `the ${GREP_MAX_FILES}-file cap`;
      return;
    }
    const real = await confinedFile(p, croots);
    if (!real) {
      skipped.other++;
      return;
    }
    let buf: Buffer;
    try {
      buf = await readConfined(real, GREP_FILE_BYTES);
    } catch {
      skipped.large++;
      return;
    }
    files++;
    if (isBinary(buf)) {
      skipped.binary++;
      return;
    }
    const lines = splitLines(buf.toString('utf8'));
    const found = await matcher.match(lines);
    if (found === 'timeout') {
      stop = `the ${REGEX_TIME_MS / 1000} s regex time limit (simplify the pattern)`;
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
      if (ctx.written?.has(real)) modelSource = true;
    }
  };

  const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
    if (stop || depth > GREP_MAX_DEPTH) return;
    if (!(await confinedDir(dir, croots))) return;
    let ents;
    try {
      ents = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    ents.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
    for (const e of ents) {
      if (stop) return;
      if (++entries > GREP_MAX_ENTRIES) {
        stop = `the ${GREP_MAX_ENTRIES}-entry walk cap`;
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

  try {
    if (st.isDirectory()) await walk(start, '', 0);
    else await scanFile(start, path.basename(start));
  } finally {
    await matcher.close();
  }
  const skip = Object.entries(skipped).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(', ');
  const summary = `[grep: ${hits.length ? `${hits.length} hit${hits.length === 1 ? '' : 's'} in ${hitFiles.size} file${hitFiles.size === 1 ? '' : 's'}` : 'no matches'}; scanned ${files} file${files === 1 ? '' : 's'}${skip ? ` (skipped: ${skip})` : ''}${stop ? `; stopped at ${stop}` : ''}.]`;
  return { content: [...hits, summary].join('\n'), isError: false, ...(modelSource ? { modelSource: true as const } : {}) };
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
const JS: readonly Rule[] = [
  ['function', /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/],
  ['class', /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/],
  ['type', /^\s*(?:export\s+)?(?:declare\s+)?(?:interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/],
  ['function', /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]{0,200})?=\s*(?:async\s+)?(?:function\b|\([^)]{0,300}\)\s*(?::[^=]{0,200})?=>|[A-Za-z_$][\w$]*\s*=>)/],
  ['export', /^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/],
  ['method', /^\s+(?:(?:public|private|protected|static|readonly|async|override|abstract|get|set)\s+)*(#?[A-Za-z_$][\w$]*)\s*(?:<[^>]{0,200}>)?\s*\([^)]{0,300}\)\s*(?::\s*[^{;]{0,200})?\{\s*$/],
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
  ['impl', /^\s*impl\b(?:<[^>]{0,200}>)?\s*(?:[\w:<>, ]{0,200}\s+for\s+)?([A-Za-z_][\w:]*)/],
];

/** The extractor per extension (data). md is handled by its own heading scan. */
export const OUTLINE: Readonly<Record<string, readonly Rule[] | 'md'>> = Object.freeze({
  '.ts': JS, '.tsx': JS, '.mts': JS, '.cts': JS, '.js': JS, '.jsx': JS, '.mjs': JS, '.cjs': JS,
  '.py': PY, '.go': GO, '.rs': RS, '.md': 'md', '.markdown': 'md',
});

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
      if (/^\s{0,3}(```|~~~)/.test(l)) fence = !fence;
      const m = fence ? null : /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l);
      if (m) out.push({ line: i + 1, name: m[2]!, kind: 'heading', depth: m[1]!.length, text: l.trim() });
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

async function readText(real: string, max: number): Promise<string> {
  const buf = await readConfined(real, max);
  if (isBinary(buf)) throw new PathRefused('a binary file is refused (a NUL byte)');
  return buf.toString('utf8');
}

export async function outline(a: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const raw = str(a.path, 'path');
  const real = await resolveRead(raw, ctx);
  const ext = path.extname(real).toLowerCase();
  if (!OUTLINE[ext]) throw new Error(`no outline for "${ext || 'no extension'}" files (ts/js, py, go, rs, md); use grep or read_section`);
  const text = await readText(real, OUTLINE_FILE_BYTES);
  const entries = outlineOf(text, ext)!;
  const total = splitLines(text).length;
  const shown = raw.slice(0, 200);
  const body = entries.map((e) => `${e.line}: ${' '.repeat(Math.min(e.kind === 'heading' ? (e.depth - 1) * 2 : e.depth, 12))}${cutLine(e.text, 160)}`);
  const head = `[outline ${shown}: ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}, ${total} lines${entries.length >= OUTLINE_MAX_ENTRIES ? `; the first ${OUTLINE_MAX_ENTRIES}` : ''}. Read one with read_section path="${shown}" symbol=<name>.]`;
  return { content: [head, ...body].join('\n'), isError: false, ...(ctx.written?.has(real) ? { modelSource: true as const } : {}) };
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
  let label: boolean;
  let name: string;
  let ext = '';
  if (handleArg !== null) {
    if (!HANDLE_RE.test(handleArg)) throw new Error('handle must look like @r12');
    const e = ctx.spill?.get(handleArg);
    if (!e) throw new Error(`handle ${handleArg} is unknown or expired; run the tool again`);
    ({ text } = e);
    label = e.modelSource;
    name = `${handleArg} (${e.tool} result)`;
  } else {
    const raw = str(a.path, 'path (or handle)');
    const real = await resolveRead(raw, ctx);
    text = await readText(real, SECTION_FILE_BYTES);
    label = ctx.written?.has(real) === true;
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
    if (idx < 0) throw new Error(`no symbol "${sym}" in ${name}; outline lists: ${entries.slice(0, 12).map((e) => e.name).join(', ') || '(nothing)'}`);
    ({ from, to } = sectionOf(entries, idx, total));
    const others = entries.filter((e, i) => i !== idx && e.name === entries[idx]!.name).map((e) => e.line);
    what = ` (${entries[idx]!.kind} ${entries[idx]!.name}${others.length ? `; also at line ${others.slice(0, 5).join(', ')}` : ''})`;
  }
  if (total === 0) return { content: `[read_section ${name}: empty]`, isError: false, ...(label ? { modelSource: true as const } : {}) };
  if (from > total) throw new Error(`from=${from} is past the end (${total} lines)`);
  const end = Math.min(total, to ?? total);
  if (end < from) throw new Error('to must be at or after from');
  const room = Math.max(MIN_SHAPE_CHARS, Math.floor(ctx.resultCap ?? SHAPE_CAP_CHARS) - PAGE_OVERHEAD);
  const size = (l: string): number => (label ? escapeData(l) : l).length + 1;
  const page: string[] = [];
  let used = 0;
  let last = from - 1;
  for (let i = from; i <= end; i++) {
    const l = lines[i - 1]!;
    if (used + size(l) > room) {
      // one line alone over the page: its head goes (never an empty page)
      if (!page.length) {
        page.push(`${l.slice(0, Math.floor(room / (label ? 4 : 1)))} […line cut]`);
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
  return { content, isError: false, ...(label ? { modelSource: true as const } : {}) };
}

// ---------------------------------------------------------------------------------------------------------------
// edit
// ---------------------------------------------------------------------------------------------------------------

/** One edit at a time per target inside the child (two parallel edits of a file never lose one). */
const editLocks = new Map<string, Promise<unknown>>();

export async function edit(a: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const raw = str(a.path, 'path');
  const old = str(a.old, 'old');
  if (typeof a.new !== 'string') throw new Error('new must be a string');
  const next = a.new;
  if (old === next) throw new Error('old and new are the same');
  const p = await resolveWrite(raw, ctx);
  const prev = editLocks.get(p) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(async (): Promise<ToolResult> => {
    let text: string;
    try {
      text = await readText(p, EDIT_FILE_BYTES);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`${raw.slice(0, 200)} does not exist; use write_file to create it`);
      throw err;
    }
    const at: number[] = [];
    for (let i = text.indexOf(old); i >= 0 && at.length < 11; i = text.indexOf(old, i + 1)) at.push(i);
    const lineAt = (i: number): number => text.slice(0, i).split('\n').length;
    if (at.length === 0) {
      const hint = /&(lt|amp);/.test(old) ? ' The text you read may have been escaped (&lt; &amp;): use the literal characters.' : '';
      throw new Error(`old text not found in ${raw.slice(0, 200)} (0 matches); it must match exactly, whitespace included. Re-read the lines with read_section.${hint}`);
    }
    if (at.length > 1) throw new Error(`old text matches ${at.length > 10 ? 'more than 10' : at.length} times in ${raw.slice(0, 200)} (lines ${at.slice(0, 10).map(lineAt).join(', ')}); include more surrounding text so it matches once`);
    const i = at[0]!;
    await writeConfined(p, text.slice(0, i) + next + text.slice(i + old.length), ctx);
    const n = (t: string): number => t.split('\n').length;
    return { content: `edited ${raw.slice(0, 200)}: replaced 1 occurrence at line ${lineAt(i)} (${n(old)} line${n(old) === 1 ? '' : 's'} → ${n(next)})`, isError: false };
  });
  editLocks.set(p, run);
  try {
    return await run;
  } finally {
    if (editLocks.get(p) === run) editLocks.delete(p);
  }
}
