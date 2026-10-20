/**
 * @symbol #mod-host
 * @symbol #paradigm-context-mod
 *
 * K1: the `paradigm-slice:v1` kernel projection (#paradigm-context-mod's only
 * input). The KERNEL reads a bounded summary of one repo's Paradigm stores and
 * hands it to a mod granted `paradigm.read:summary` as HOST-COMPOSED view
 * input (host.ts composeRelayedInput); the mod never reads a file, never sees
 * a path and never names the repo. The repo is the one of a LIVE session the
 * host joined server-side from the GUI's `{focus:{hsid}}` (K3).
 *
 * READ SCOPE (Aegis): only `<root>/.paradigm/tasks/entries/<date>/*.yaml`,
 * `<root>/.paradigm/decisions/TD-*.yaml` and
 * `<root>/.paradigm/lore/entries/<date>/*.{lore,yaml}`, where <root> is the
 * nearest ancestor of the session cwd holding a REAL `.paradigm` directory
 * (the walk stops at a `.git` holder, the filesystem root, or after
 * MAX_ASCEND levels; the user home and above are never a root). Every
 * directory and file on the way is lstat'ed: a symlink is REFUSED (counted),
 * a file is opened O_NOFOLLOW where the platform has it, and its realpath must
 * stay inside the realpath of `.paradigm` (an escape is refused, counted).
 * Files are capped at MAX_FILE_BYTES; scans at MAX_ENTRIES per store.
 *
 * FORMAT: the files are js-yaml dumps (packages/paradigm-mcp task-loader,
 * decision-loader, lore-loader). The kernel has zero dependencies (G-SEC-01),
 * so a strict YAML SUBSET reader is used: top-level `key: scalar` (plain,
 * quoted, `|`/`>` block), `key: [flow, list]` and `key:` + `- scalar` items;
 * nested mappings are skipped whole. Anything else (a tab indent, a duplicate
 * key, a stray top-level line, an anchor/alias/tag) makes the FILE malformed:
 * it is skipped and counted, never half-read.
 *
 * OUTPUT (bounded, sanitised): open (open ∪ in-progress) and high task
 * counts and the top SLICE_TOP task titles (high first, newest first); the
 * last SLICE_TOP decisions {id, title, date}; the last SLICE_TOP lore entries
 * {id, title, type}; the symbols touched in those entries (closed symbol
 * shape, ≤ MAX_SYMBOLS). Every title goes through the contracts display
 * sanitiser (§4.5), newlines and tabs collapse to spaces, absolute paths are
 * redacted to ⟨path⟩ and it is capped at TITLE_MAX code points. An item marked
 * `sensitivity: secret` is dropped (counted). No absolute path appears
 * anywhere in the slice: the root is reported as a hue (the feed's and GUI's
 * contracts projectHue(cwd)) and a sanitised basename only.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { projectHue as contractsProjectHue, sanitizeDisplayText } from '@a-company/gnomon-contracts';

export const PARADIGM_SLICE_V1 = 'paradigm-slice:v1';
/** The capability that grants the slice (CAPABILITY_FORMS; not a clientApiId / modAbiId / kitId input). */
export const PARADIGM_SUMMARY_CAPABILITY = 'paradigm.read:summary';
export const SLICE_TOP = 5;
export const TITLE_MAX = 120;
export const NAME_MAX = 64;
export const MAX_SYMBOLS = 24;
export const MAX_FILE_BYTES = 64 * 1024;
/** Directory entries looked at per store (tasks / decisions / lore), dated dirs included. */
export const MAX_ENTRIES = 4096;
/** Files PARSED per store for decisions and lore (newest first). Tasks parse every active file up to MAX_ENTRIES. */
export const MAX_PARSED = 64;
/** Task files PARSED per slice (Aegis M3: lower than MAX_ENTRIES). */
export const MAX_TASK_PARSED = 512;
/** Total bytes read per slice across every store (Aegis M3). */
export const SLICE_BYTE_BUDGET = 3 * 1024 * 1024;
/** Aegis H1: a scalar or a title longer than this never reaches a regex (a longer scalar is skipped like a nested value). */
export const SCALAR_MAX = 4096;
const KEY_MAX = 128;
export const MAX_ASCEND = 16;

export interface SliceItem {
  id: string;
  title: string;
  /** the §4.5 flags of the title, when any (hidden-chars, bidi) */
  flags?: string[];
}
export interface ParadigmSlice {
  v: typeof PARADIGM_SLICE_V1;
  /** ok: a .paradigm root was read; absent: the live session's repo has none; unfocused: no live session is focused */
  state: 'ok' | 'absent' | 'unfocused';
  /** the project hue (feed.ts session.open project): contracts projectHue(session cwd), 0..5 */
  project?: number;
  /** the repo root's basename, sanitised (never a path) */
  name?: string;
  /** the date the slice was computed (YYYY-MM-DD, UTC) */
  at?: string;
  /** the newest dated decision or lore entry (YYYY-MM-DD), null when none */
  newest?: string | null;
  tasks?: { open: number; high: number; items: Array<SliceItem & { priority: string }>; count: { n: number; of: number } };
  decisions?: { items: Array<SliceItem & { date: string | null }>; count: { n: number; of: number } };
  lore?: { items: Array<SliceItem & { type: string }>; count: { n: number; of: number } };
  symbols?: string[];
  skipped?: { malformed: number; refused: number; secret: number; truncated: boolean };
}

/* ── the YAML subset ─────────────────────────────────────────────────── */

type YVal = string | string[] | null; // null: a nested mapping / complex value (skipped)
/** a key: the text before the FIRST `:` of a top-level line (≤ KEY_MAX, checked before the regex) */
const KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;
/** the line terminators `.` never matched in the old KEY_LINE form: a line holding one stays malformed */
const ODD_TERMINATOR = /[\r\u2028\u2029]/;
const BLOCK = /^([|>])([+-]?)([1-9]?)([+-]?)\s*(#.*)?$/;
const indentOf = (l: string): number => l.length - l.trimStart().length;

function unquoteSingle(s: string): string | undefined {
  if (!s.startsWith("'")) return undefined;
  let out = '';
  for (let i = 1; i < s.length; i++) {
    if (s[i] === "'") {
      if (s[i + 1] === "'") {
        out += "'";
        i++;
        continue;
      }
      return /^\s*(#.*)?$/.test(s.slice(i + 1)) ? out : undefined;
    }
    out += s[i];
  }
  return undefined;
}

function unquoteDouble(s: string): string | undefined {
  if (!s.startsWith('"')) return undefined;
  let out = '';
  for (let i = 1; i < s.length; i++) {
    const c = s[i]!;
    if (c === '"') return /^\s*(#.*)?$/.test(s.slice(i + 1)) ? out : undefined;
    if (c === '\\') {
      const n = s[++i];
      if (n === undefined) return undefined;
      if (n === 'n') out += '\n';
      else if (n === 't') out += '\t';
      else if (n === '"' || n === '\\' || n === '/') out += n;
      else if (n === 'u' || n === 'x') {
        const len = n === 'u' ? 4 : 2;
        const hex = s.slice(i + 1, i + 1 + len);
        if (!new RegExp(`^[0-9A-Fa-f]{${len}}$`).test(hex)) return undefined;
        out += String.fromCharCode(parseInt(hex, 16));
        i += len;
      } else out += n;
      continue;
    }
    out += c;
  }
  return undefined;
}

/**
 * Aegis H1: a plain scalar's trailing comment, found by a LINEAR scan (the first `#` preceded by a space or a
 * tab). The old `/\s+#.*$/` backtracked quadratically on a long whitespace run.
 */
function stripComment(s: string): string {
  for (let i = s.indexOf('#'); i !== -1; i = s.indexOf('#', i + 1)) {
    const p = s.charCodeAt(i - 1);
    if (p === 0x20 || p === 0x09) return s.slice(0, i).trimEnd();
  }
  return s;
}

/** A top-level `key: value` line split by indexOf (no regex over the whole line), or null when it is not one. */
function keyLine(line: string): { key: string; value: string } | null {
  const colon = line.indexOf(':');
  if (colon <= 0 || colon > KEY_MAX) return null;
  const key = line.slice(0, colon);
  if (!KEY.test(key)) return null;
  const rest = line.slice(colon + 1);
  if (rest !== '' && rest.charCodeAt(0) !== 0x20) return null;
  if (ODD_TERMINATOR.test(rest)) return null;
  return { key, value: rest };
}

/** One scalar, or undefined when it is not a scalar this reader accepts. The caller caps the length (SCALAR_MAX). */
function scalar(raw: string): string | undefined {
  const s = raw.trim();
  if (s.startsWith("'")) return unquoteSingle(s);
  if (s.startsWith('"')) return unquoteDouble(s);
  if (/^[&*!%@`|>{[]/.test(s)) return undefined; // anchors, aliases, tags, directives, reserved, blocks, flow
  return stripComment(s);
}

/** Aegis H1: a value over SCALAR_MAX is skipped whole (null, as a nested value) before any regex sees it. */
const tooLong = (s: string): boolean => s.length > SCALAR_MAX;

function flowList(raw: string): string[] | undefined {
  const s = raw.trim();
  if (!s.startsWith('[') || !s.endsWith(']')) return undefined;
  const body = s.slice(1, -1).trim();
  if (!body) return [];
  const parts: string[] = [];
  let cur = '';
  let q: string | null = null;
  for (const c of body) {
    if (q) {
      cur += c;
      if (c === q) q = null;
    } else if (c === "'" || c === '"') {
      q = c;
      cur += c;
    } else if (c === ',') {
      parts.push(cur);
      cur = '';
    } else if (c === '[' || c === ']' || c === '{' || c === '}') return undefined;
    else cur += c;
  }
  if (q) return undefined;
  parts.push(cur);
  const out: string[] = [];
  for (const p of parts) {
    const v = scalar(p);
    if (v === undefined) return undefined;
    out.push(v);
  }
  return out;
}

/** A top-level map of the subset, or null when the text is malformed. Never throws. */
export function readYamlSubset(text: string): Record<string, YVal> | null {
  const lines = text.replace(/^\ufeff/, '').split(/\r?\n/);
  const out: Record<string, YVal> = Object.create(null) as Record<string, YVal>;
  let i = 0;
  if (lines[0]?.trim() === '---') i = 1;
  const body = (from: number): number => {
    // the indented (or blank) lines owned by the key on line from-1; a column-0 `- ` belongs to it too
    let j = from;
    while (j < lines.length) {
      const l = lines[j]!;
      if (l.trim() === '' || indentOf(l) > 0 || l.startsWith('- ') || l === '-') j++;
      else break;
    }
    return j;
  };
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '' || /^#/.test(line)) {
      i++;
      continue;
    }
    if (/^\s/.test(line)) return null; // an indented line nobody owns (or a tab indent)
    if (line === '...' ) break;
    const m = keyLine(line);
    if (!m) return null;
    const key = m.key;
    if (Object.hasOwn(out, key)) return null; // duplicate key
    const v = m.value.trim();
    const end = body(i + 1);
    const owned = lines.slice(i + 1, end);
    if (owned.some((l) => /^[ ]*\t/.test(l))) return null; // a tab in the indentation
    i = end;
    if (v === '' || v.startsWith('#')) {
      const items = owned.filter((l) => l.trim() !== '' && !/^\s*#/.test(l));
      if (items.length === 0) {
        out[key] = '';
        continue;
      }
      const ind = indentOf(items[0]!);
      const list = items.every((l) => indentOf(l) === ind && /^\s*-(\s|$)/.test(l));
      if (!list) {
        out[key] = null; // a nested mapping (or a list of maps): skipped whole
        continue;
      }
      const vals: string[] = [];
      for (const l of items) {
        if (tooLong(l)) {
          out[key] = null;
          break;
        }
        const sv = scalar(l.trim().slice(1));
        if (sv === undefined || /^[A-Za-z_][A-Za-z0-9_-]*:(\s|$)/.test(sv)) {
          out[key] = null;
          break;
        }
        vals.push(sv);
      }
      if (out[key] !== null) out[key] = vals;
      continue;
    }
    if (tooLong(v)) {
      out[key] = null;
      continue;
    }
    const b = BLOCK.exec(v);
    if (b) {
      const content = owned.slice();
      while (content.length && content[content.length - 1]!.trim() === '') content.pop();
      const ind = Math.min(...content.filter((l) => l.trim() !== '').map(indentOf), Number.MAX_SAFE_INTEGER);
      const strip = content.map((l) => (l.trim() === '' ? '' : l.slice(ind === Number.MAX_SAFE_INTEGER ? 0 : ind)));
      out[key] = b[1] === '|' ? strip.join('\n') : strip.join('\n').replace(/([^\n])\n(?=[^\n])/g, '$1 ');
      continue;
    }
    if (v.startsWith('[')) {
      const joinedList = [v, ...owned.map((l) => l.trim())].join(' ');
      if (tooLong(joinedList)) {
        out[key] = null;
        continue;
      }
      const fl = flowList(joinedList);
      if (fl === undefined) return null;
      out[key] = fl;
      continue;
    }
    if (v.startsWith('{')) {
      out[key] = null;
      continue;
    }
    // a scalar, possibly continued on indented lines (folded with spaces)
    const joined = [v, ...owned.map((l) => l.trim()).filter((l) => l !== '')].join(' ');
    if (tooLong(joined)) {
      out[key] = null;
      continue;
    }
    const sv = scalar(joined);
    if (sv === undefined) return null;
    out[key] = sv;
  }
  return out;
}

/* ── display text ─────────────────────────────────────────────────────── */

const PATH_UNIX = /\/[^\s/'"`<>()[\]{},;]+(?:\/[^\s'"`<>()[\]{},;]*)+/g;
const PATH_HOME = /~[/\\][^\s'"`<>()[\]{},;]*/g;
const PATH_WIN = /[A-Za-z]:\\[^\s'"`<>()[\]{},;]*/g;
const PATH_WIN_FWD = /(^|[^\w])[A-Za-z]:\/(?!\/)[^\s'"`<>()[\]{},;]*/g;
const PATH_UNC = /\\\\[^\s'"`<>()[\]{},;\\]+\\[^\s'"`<>()[\]{},;]*/g;
export const PATH_GLYPH = '\u27e8path\u27e9';

/**
 * Redact absolute paths to ⟨path⟩: every `~/…`, `X:\…` and `\\server\…`
 * anywhere; `X:/…` after a non-word character; a POSIX path of ≥ 2 segments
 * unless it continues a relative path (`packages/x/y`: preceded by a word
 * character, `.` or `-`) or a URL authority (preceded by `/`). The `scrub`
 * strings (the kernel's own root, its realpath, the cwd and the home) are
 * removed wherever they appear, glued or not.
 */
export function redactPaths(s: string, scrub: readonly string[] = []): string {
  let out = s;
  for (const x of [...scrub].filter((v) => v.length > 1).sort((a, b) => b.length - a.length)) out = out.split(x).join(PATH_GLYPH);
  out = out.replace(PATH_UNC, PATH_GLYPH).replace(PATH_WIN, PATH_GLYPH).replace(PATH_WIN_FWD, `$1${PATH_GLYPH}`).replace(PATH_HOME, PATH_GLYPH);
  return out.replace(PATH_UNIX, (m: string, at: number, all: string) => {
    const prev = at > 0 ? all[at - 1]! : '';
    return prev !== '' && /[\w./-]/.test(prev) ? m : PATH_GLYPH;
  });
}

/** Aegis H1: a title is cut to SCALAR_MAX code units (never inside a surrogate pair) before the sanitiser and any regex. */
function capInput(raw: string): string {
  if (raw.length <= SCALAR_MAX) return raw;
  const hi = raw.charCodeAt(SCALAR_MAX - 1);
  return raw.slice(0, hi >= 0xd800 && hi <= 0xdbff ? SCALAR_MAX - 1 : SCALAR_MAX);
}

/** A display title: §4.5 sanitised, one line, paths redacted, capped at `max` code points (… when cut). */
export function displayTitle(raw: string, max = TITLE_MAX, scrub: readonly string[] = []): { text: string; flags: string[] } {
  const s = sanitizeDisplayText(capInput(raw));
  const one = redactPaths(s.text.replace(/[\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim(), scrub);
  const cps = [...one];
  return { text: cps.length > max ? `${cps.slice(0, max - 1).join('').trimEnd()}\u2026` : one, flags: [...s.flags] };
}

const ID = /^[A-Za-z0-9._-]{1,64}$/;
const DATE = /^(\d{4}-\d{2}-\d{2})/;
const DATE_DIR = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN = /^[a-z][a-z0-9-]{0,31}$/;
/** A Paradigm symbol (# component, $ flow, ^ gate, ! signal, ~ aspect), kebab-case. */
export const SYMBOL = /^[#$^!~][a-z0-9][a-z0-9-]{0,63}$/;
const PRIORITIES = ['high', 'medium', 'low'];

/* ── the confined reader ──────────────────────────────────────────────── */

interface Counters {
  malformed: number;
  refused: number;
  secret: number;
  truncated: boolean;
}

/** darwin and win32 file systems are case-insensitive by default: compare paths case-folded there (Aegis M2). */
const FOLD = process.platform === 'darwin' || process.platform === 'win32';
const fold = (p: string): string => (FOLD ? p.toLowerCase() : p);
/** The realpath of the nearest EXISTING ancestor, plus the missing tail (a missing segment cannot be a symlink). */
function realExisting(p: string): string | null {
  const tail: string[] = [];
  let dir = p;
  for (let k = 0; k < 256; k++) {
    const r = realOr(dir);
    if (r !== null) return tail.length ? path.join(r, ...tail.reverse()) : r;
    const up = path.dirname(dir);
    if (up === dir) return null;
    tail.push(path.basename(dir));
    dir = up;
  }
  return null;
}
/** `inner` is `outer` or below it (case-folded where the platform folds). */
function within(inner: string, outer: string): boolean {
  const i = fold(inner);
  const o = fold(outer);
  return i === o || i.startsWith(o.endsWith(path.sep) ? o : o + path.sep);
}
const realOr = (p: string): string | null => {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
};

class Confined {
  readonly real: string;
  readonly c: Counters;
  constructor(real: string, c: Counters) {
    this.real = real;
    this.c = c;
  }
  /** a real directory (not a symlink) inside the root, else null (a symlink is counted refused) */
  dir(abs: string): string[] | null {
    let st: fs.Stats;
    try {
      st = fs.lstatSync(abs);
    } catch {
      return null;
    }
    if (st.isSymbolicLink()) {
      this.c.refused++;
      return null;
    }
    if (!st.isDirectory() || !this.inside(abs)) return null;
    // Aegis M3: a bounded opendir iteration (never readdirSync over a million entries); past MAX_ENTRIES the rest
    // is not listed and the slice says truncated
    let d: fs.Dir | undefined;
    const names: string[] = [];
    try {
      d = fs.opendirSync(abs);
      for (let e = d.readSync(); e !== null; e = d.readSync()) {
        if (names.length >= MAX_ENTRIES) {
          this.c.truncated = true;
          break;
        }
        names.push(e.name);
      }
    } catch {
      return null;
    } finally {
      try {
        d?.closeSync();
      } catch {
        /* closed */
      }
    }
    // L1: the directory listed is the one lstat'ed (no swap between the check and the open)
    try {
      const again = fs.lstatSync(abs);
      if (again.isSymbolicLink() || again.dev !== st.dev || again.ino !== st.ino) {
        this.c.refused++;
        return null;
      }
    } catch {
      return null;
    }
    return names.sort();
  }
  inside(abs: string): boolean {
    let r: string;
    try {
      r = fs.realpathSync(abs);
    } catch {
      return false;
    }
    if (within(r, this.real)) return true;
    this.c.refused++;
    return false;
  }
  /** bytes read so far in this slice (Aegis M3 budget) */
  bytes = 0;
  /** one file's YAML map, or null (missing, symlink, escape, oversize, malformed — each counted but missing) */
  read(abs: string): Record<string, YVal> | null {
    let st: fs.Stats;
    try {
      st = fs.lstatSync(abs);
    } catch {
      return null;
    }
    // L1: a hard link (nlink > 1) may name a file outside the root under an inside name: refused
    if (st.isSymbolicLink() || !st.isFile() || st.size > MAX_FILE_BYTES || st.nlink > 1 || !this.inside(abs)) {
      if (st.isSymbolicLink() || st.size > MAX_FILE_BYTES || (st.isFile() && st.nlink > 1)) this.c.refused++;
      return null;
    }
    // M3: the per-slice byte budget; past it nothing more is read and the slice says truncated
    if (this.bytes + st.size > SLICE_BYTE_BUDGET) {
      this.c.truncated = true;
      return null;
    }
    let fd: number | undefined;
    let text: string;
    try {
      fd = fs.openSync(abs, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      const fst = fs.fstatSync(fd);
      // L1: the open file is the lstat'ed one (dev + ino), still a single-link regular file
      if (!fst.isFile() || fst.size > MAX_FILE_BYTES || fst.dev !== st.dev || fst.ino !== st.ino || fst.nlink > 1) {
        this.c.refused++;
        return null;
      }
      // L1: after the open, the name still resolves inside the root, to the very file that is open
      const r = fs.realpathSync(abs);
      if (!within(r, this.real)) {
        this.c.refused++;
        return null;
      }
      const rst = fs.statSync(r);
      if (rst.dev !== fst.dev || rst.ino !== fst.ino) {
        this.c.refused++;
        return null;
      }
      const buf = Buffer.alloc(Math.min(fst.size, MAX_FILE_BYTES, SLICE_BYTE_BUDGET - this.bytes));
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      this.bytes += n;
      text = buf.subarray(0, n).toString('utf8');
    } catch {
      this.c.refused++;
      return null;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    const y = readYamlSubset(text);
    if (!y) this.c.malformed++;
    return y;
  }
}

const str = (v: YVal | undefined): string | undefined => (typeof v === 'string' ? v : undefined);
const isSecret = (y: Record<string, YVal>): boolean => str(y.sensitivity)?.trim().toLowerCase() === 'secret';
const firstLine = (s: string): string => s.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? '';

function titleOf(raw: string, scrub: readonly string[]): { title: string; flags?: string[] } {
  const t = displayTitle(raw, TITLE_MAX, scrub);
  return { title: t.text, ...(t.flags.length ? { flags: t.flags } : {}) };
}

/**
 * The repo root for a session cwd: the nearest ancestor holding a REAL `.paradigm` dir (see the header).
 * Aegis M2: the walk runs in REALPATH space: the cwd and the home are realpath'ed first, so a cwd that is a
 * symlink to the home (or a case variant of it on a case-insensitive platform) never reads the home; paths are
 * compared case-folded on darwin and win32, and no directory at or above the home's realpath is ever looked at.
 */
export function paradigmRootOf(cwd: string, opts: { home?: string } = {}): { root: string | null; refused: boolean; realCwd?: string; realHome?: string } {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) return { root: null, refused: false };
  const homeIn = path.resolve(opts.home ?? os.homedir());
  const home = realOr(homeIn) ?? homeIn;
  const realCwd = realExisting(path.resolve(cwd));
  if (realCwd === null) return { root: null, refused: false };
  const at = { realCwd, realHome: home };
  let dir = realCwd;
  for (let k = 0; k < MAX_ASCEND; k++) {
    if (within(home, dir) || dir === path.parse(dir).root) return { root: null, refused: false, ...at }; // the home, or above it
    const p = path.join(dir, '.paradigm');
    try {
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink()) return { root: null, refused: true, ...at };
      if (st.isDirectory()) return { root: dir, refused: false, ...at };
    } catch {
      /* none here */
    }
    if (fs.existsSync(path.join(dir, '.git'))) return { root: null, refused: false, ...at };
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return { root: null, refused: false, ...at };
}

/** The project hue for a cwd: the contracts projectHue the feed (feed.ts session.open) and the GUI rail use (0..5). */
export function projectHue(cwd: string): number {
  return contractsProjectHue(cwd);
}

/** A resolved slice target: the repo root and its `.paradigm` realpath (the cache key), or the absent slice. */
type Target = { kind: 'root'; root: string; real: string; scrub: string[] } | { kind: 'absent'; refused: boolean };

function targetOf(cwd: string, opts: { home?: string }): Target {
  const { root, refused, realCwd, realHome } = paradigmRootOf(cwd, opts);
  if (!root) return { kind: 'absent', refused };
  const real = realOr(path.join(root, '.paradigm'));
  if (real === null) return { kind: 'absent', refused: false };
  // L3: the cwd's realpath (and the home's) are scrubbed too, wherever a title spells them
  const homeIn = path.resolve(opts.home ?? os.homedir());
  const scrub = [...new Set([root, real, cwd, homeIn, ...(realCwd ? [realCwd] : []), ...(realHome ? [realHome] : [])])];
  return { kind: 'root', root, real, scrub };
}

const absentSlice = (project: number, at: string, refused: boolean): ParadigmSlice => ({
  v: PARADIGM_SLICE_V1,
  state: 'absent',
  project,
  at,
  ...(refused ? { skipped: { malformed: 0, refused: 1, secret: 0, truncated: false } } : {}),
});

/**
 * The `paradigm-slice:v1` for a LIVE session's cwd. Never throws; never
 * reports a path. `now` (ms) sets `at`.
 */
export function paradigmSlice(cwd: string, opts: { home?: string; now?: number } = {}): ParadigmSlice {
  const at = new Date(opts.now ?? Date.now()).toISOString().slice(0, 10);
  const project = typeof cwd === 'string' ? projectHue(cwd) : 0;
  const t = targetOf(cwd, opts);
  if (t.kind === 'absent') return absentSlice(project, at, t.refused);
  return { ...sliceOfRoot(t.root, t.real, t.scrub, at), project };
}

/** The slice of one resolved root (everything but the cwd's project hue, which the caller sets). */
function sliceOfRoot(root: string, real: string, scrub: readonly string[], at: string): ParadigmSlice {
  const c: Counters = { malformed: 0, refused: 0, secret: 0, truncated: false };
  const name = displayTitle(path.basename(root), NAME_MAX).text;
  const box = new Confined(real, c);
  const P = path.join(root, '.paradigm');

  // tasks: every active task (bounded), counts + top SLICE_TOP (high first, newest first)
  const active: Array<{ id: string; blurb: string; priority: string; created: string }> = [];
  let budget = MAX_TASK_PARSED;
  const tEntries = path.join(P, 'tasks', 'entries');
  if (box.dir(path.join(P, 'tasks')) !== null) {
    for (const d of (box.dir(tEntries) ?? []).filter((n) => DATE_DIR.test(n)).reverse()) {
      for (const f of (box.dir(path.join(tEntries, d)) ?? []).filter((n) => n.endsWith('.yaml'))) {
        if (budget-- <= 0) {
          c.truncated = true;
          break;
        }
        const y = box.read(path.join(tEntries, d, f));
        if (!y) continue;
        const id = str(y.id);
        const blurb = str(y.blurb) ?? str(y.title);
        const status = str(y.status);
        if (!id || !ID.test(id) || blurb === undefined || !status) {
          c.malformed++;
          continue;
        }
        if (isSecret(y)) {
          c.secret++;
          continue;
        }
        if (status !== 'open' && status !== 'in-progress') continue;
        const pr = str(y.priority);
        active.push({ id, blurb: firstLine(blurb), priority: pr && PRIORITIES.includes(pr) ? pr : 'medium', created: str(y.created) ?? '' });
      }
    }
  }
  active.sort((a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) || (a.created < b.created ? 1 : a.created > b.created ? -1 : a.id < b.id ? 1 : -1));
  const taskItems = active.slice(0, SLICE_TOP).map((t) => ({ id: t.id, ...titleOf(t.blurb, scrub), priority: t.priority }));

  // decisions: TD-*.yaml, newest MAX_PARSED by name, then by timestamp
  const decNames = (box.dir(path.join(P, 'decisions')) ?? []).filter((n) => /^TD-[A-Za-z0-9._-]+\.yaml$/.test(n));
  const decs: Array<{ id: string; title: string; ts: string }> = [];
  for (const f of decNames.slice(-MAX_PARSED).reverse()) {
    const y = box.read(path.join(P, 'decisions', f));
    if (!y) continue;
    const id = str(y.id);
    const title = str(y.title);
    if (!id || !ID.test(id) || title === undefined) {
      c.malformed++;
      continue;
    }
    if (isSecret(y)) {
      c.secret++;
      continue;
    }
    decs.push({ id, title, ts: str(y.timestamp) ?? str(y.date) ?? '' });
  }
  decs.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : a.id < b.id ? 1 : -1));
  const decItems = decs.slice(0, SLICE_TOP).map((d) => ({ id: d.id, ...titleOf(d.title, scrub), date: DATE.exec(d.ts)?.[1] ?? null }));

  // lore: entries/<date>/*.lore|*.yaml, newest dirs first, up to MAX_PARSED parsed
  const lEntries = path.join(P, 'lore', 'entries');
  const lore: Array<{ id: string; title: string; type: string; ts: string; symbols: string[] }> = [];
  let loreTotal = 0;
  let parsed = 0;
  if (box.dir(path.join(P, 'lore')) !== null) {
    const days = (box.dir(lEntries) ?? []).filter((n) => DATE_DIR.test(n)).reverse();
    for (const d of days) {
      const files = (box.dir(path.join(lEntries, d)) ?? []).filter((n) => n.endsWith('.lore') || n.endsWith('.yaml'));
      loreTotal += files.length;
      if (lore.length >= SLICE_TOP || parsed >= MAX_PARSED) continue; // the rest only counted
      for (const f of files.slice().reverse()) {
        if (parsed++ >= MAX_PARSED) break;
        const y = box.read(path.join(lEntries, d, f));
        if (!y) continue;
        const id = str(y.id);
        const title = str(y.title);
        if (!id || !ID.test(id) || title === undefined) {
          c.malformed++;
          continue;
        }
        if (isSecret(y)) {
          c.secret++;
          continue;
        }
        const ty = str(y.type);
        const st = y.symbols_touched;
        lore.push({ id, title, type: ty && TOKEN.test(ty) ? ty : 'note', ts: str(y.timestamp) ?? d, symbols: Array.isArray(st) ? st : [] });
      }
    }
  }
  lore.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : a.id < b.id ? 1 : -1));
  const loreTop = lore.slice(0, SLICE_TOP);
  const symbols: string[] = [];
  for (const l of loreTop) for (const s of l.symbols) if (SYMBOL.test(s) && !symbols.includes(s) && symbols.length < MAX_SYMBOLS) symbols.push(s);
  const dates = [...decItems.map((d) => d.date), ...loreTop.map((l) => DATE.exec(l.ts)?.[1] ?? null)].filter((d): d is string => d !== null).sort();
  return {
    v: PARADIGM_SLICE_V1,
    state: 'ok',
    name,
    at,
    newest: dates.length ? dates[dates.length - 1]! : null,
    tasks: { open: active.length, high: active.filter((t) => t.priority === 'high').length, items: taskItems, count: { n: taskItems.length, of: active.length } },
    decisions: { items: decItems, count: { n: decItems.length, of: decNames.length } },
    lore: { items: loreTop.map((l) => ({ id: l.id, ...titleOf(l.title, scrub), type: l.type })), count: { n: loreTop.length, of: loreTotal } },
    symbols,
    skipped: { ...c },
  };
}

/** The unfocused slice (no live session focused, or the focus names none). */
export function unfocusedSlice(): ParadigmSlice {
  return { v: PARADIGM_SLICE_V1, state: 'unfocused' };
}

/**
 * A small TTL cache over the slice (bounded). Aegis M3: keyed by the REALPATH of the `.paradigm` root, so two
 * cwds (or a symlink and its target) in one repo share one entry and one read; the cwd's project hue is applied
 * per call. Single-flight per root: the read is synchronous, so one get() per root runs at a time by
 * construction; a concurrent caller can only see the finished entry. (Moving the read to a worker, so a large
 * repo never holds the event loop for its bounded read, is a follow-up.)
 */
export class ParadigmSliceCache {
  readonly #ttlMs: number;
  readonly #max: number;
  readonly #m = new Map<string, { at: number; s: ParadigmSlice }>();
  constructor(ttlMs = 3_000, max = 32) {
    this.#ttlMs = ttlMs;
    this.#max = max;
  }
  get(cwd: string, now: number, opts: { home?: string } = {}): ParadigmSlice {
    const at = new Date(now).toISOString().slice(0, 10);
    const project = typeof cwd === 'string' ? projectHue(cwd) : 0;
    const t = targetOf(cwd, opts);
    if (t.kind === 'absent') return absentSlice(project, at, t.refused);
    const key = fold(t.real);
    const hit = this.#m.get(key);
    if (hit && now - hit.at < this.#ttlMs) return { ...hit.s, project };
    const s = sliceOfRoot(t.root, t.real, t.scrub, at);
    this.#m.delete(key);
    if (this.#m.size >= this.#max) this.#m.delete(this.#m.keys().next().value!);
    this.#m.set(key, { at: now, s });
    return { ...s, project };
  }
  /** entries held (tests) */
  get size(): number {
    return this.#m.size;
  }
}
