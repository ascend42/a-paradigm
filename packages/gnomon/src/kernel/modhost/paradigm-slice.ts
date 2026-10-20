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
 * anywhere in the slice: the root is reported as a hue (the feed's
 * sha256(cwd) % 8) and a sanitised basename only.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { sanitizeDisplayText } from '@a-company/gnomon-contracts';

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
export const MAX_ASCEND = 16;
export const SLICE_HUES = 8;

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
  /** the project hue (feed.ts session.open project): sha256(session cwd)[0] % 8 */
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
const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_-]*):(?:[ ]+(.*)|)$/;
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

/** One scalar, or undefined when it is not a scalar this reader accepts. */
function scalar(raw: string): string | undefined {
  const s = raw.trim();
  if (s.startsWith("'")) return unquoteSingle(s);
  if (s.startsWith('"')) return unquoteDouble(s);
  if (/^[&*!%@`|>{[]/.test(s)) return undefined; // anchors, aliases, tags, directives, reserved, blocks, flow
  return s.replace(/\s+#.*$/, '');
}

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
    const m = KEY_LINE.exec(line);
    if (!m) return null;
    const key = m[1]!;
    if (Object.hasOwn(out, key)) return null; // duplicate key
    const v = (m[2] ?? '').trim();
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
      const fl = flowList([v, ...owned.map((l) => l.trim())].join(' '));
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
    const sv = scalar(joined);
    if (sv === undefined) return null;
    out[key] = sv;
  }
  return out;
}

/* ── display text ─────────────────────────────────────────────────────── */

const PATH_UNIX = /(^|[^\w.~:/\\-])\/[^\s/'"`<>()[\]{},;]+(?:\/[^\s'"`<>()[\]{},;]*)+/g;
const PATH_HOME = /(^|[^\w.~/\\-])~[/\\][^\s'"`<>()[\]{},;]*/g;
const PATH_WIN = /(^|[^\w])[A-Za-z]:[\\/][^\s'"`<>()[\]{},;]*/g;
const PATH_UNC = /(^|[^\w\\])\\\\[^\s'"`<>()[\]{},;\\]+\\[^\s'"`<>()[\]{},;]*/g;
export const PATH_GLYPH = '\u27e8path\u27e9';

/** Redact absolute paths (POSIX with ≥ 2 segments, ~/…, X:\…, \\server\…) to ⟨path⟩. */
export function redactPaths(s: string): string {
  return s.replace(PATH_UNC, `$1${PATH_GLYPH}`).replace(PATH_WIN, `$1${PATH_GLYPH}`).replace(PATH_HOME, `$1${PATH_GLYPH}`).replace(PATH_UNIX, `$1${PATH_GLYPH}`);
}

/** A display title: §4.5 sanitised, one line, paths redacted, capped at `max` code points (… when cut). */
export function displayTitle(raw: string, max = TITLE_MAX): { text: string; flags: string[] } {
  const s = sanitizeDisplayText(raw);
  const one = redactPaths(s.text.replace(/[\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim());
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
    try {
      const names = fs.readdirSync(abs);
      if (names.length > MAX_ENTRIES) this.c.truncated = true;
      return names.sort().slice(-MAX_ENTRIES);
    } catch {
      return null;
    }
  }
  inside(abs: string): boolean {
    let r: string;
    try {
      r = fs.realpathSync(abs);
    } catch {
      return false;
    }
    if (r === this.real || r.startsWith(this.real + path.sep)) return true;
    this.c.refused++;
    return false;
  }
  /** one file's YAML map, or null (missing, symlink, escape, oversize, malformed — each counted but missing) */
  read(abs: string): Record<string, YVal> | null {
    let st: fs.Stats;
    try {
      st = fs.lstatSync(abs);
    } catch {
      return null;
    }
    if (st.isSymbolicLink() || !st.isFile() || st.size > MAX_FILE_BYTES || !this.inside(abs)) {
      if (st.isSymbolicLink() || st.size > MAX_FILE_BYTES) this.c.refused++;
      return null;
    }
    let fd: number | undefined;
    let text: string;
    try {
      fd = fs.openSync(abs, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      const fst = fs.fstatSync(fd);
      if (!fst.isFile() || fst.size > MAX_FILE_BYTES || fst.ino !== st.ino) {
        this.c.refused++;
        return null;
      }
      const buf = Buffer.alloc(Math.min(fst.size, MAX_FILE_BYTES));
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
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

function titleOf(raw: string): { title: string; flags?: string[] } {
  const t = displayTitle(raw);
  return { title: t.text, ...(t.flags.length ? { flags: t.flags } : {}) };
}

/** The repo root for a session cwd: the nearest ancestor holding a REAL `.paradigm` dir (see the header). */
export function paradigmRootOf(cwd: string, opts: { home?: string } = {}): { root: string | null; refused: boolean } {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) return { root: null, refused: false };
  const home = path.resolve(opts.home ?? os.homedir());
  let dir = path.resolve(cwd);
  for (let k = 0; k < MAX_ASCEND; k++) {
    if (dir === home || home.startsWith(dir + path.sep) || dir === path.parse(dir).root) return { root: null, refused: false };
    const p = path.join(dir, '.paradigm');
    try {
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink()) return { root: null, refused: true };
      if (st.isDirectory()) return { root: dir, refused: false };
    } catch {
      /* none here */
    }
    if (fs.existsSync(path.join(dir, '.git'))) return { root: null, refused: false };
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return { root: null, refused: false };
}

/** The feed's project hue for a cwd (feed.ts session.open). */
export function projectHue(cwd: string): number {
  return createHash('sha256').update(cwd, 'utf8').digest()[0]! % SLICE_HUES;
}

/**
 * The `paradigm-slice:v1` for a LIVE session's cwd. Never throws; never
 * reports a path. `now` (ms) sets `at`.
 */
export function paradigmSlice(cwd: string, opts: { home?: string; now?: number } = {}): ParadigmSlice {
  const at = new Date(opts.now ?? Date.now()).toISOString().slice(0, 10);
  const project = typeof cwd === 'string' ? projectHue(cwd) : 0;
  const { root, refused } = paradigmRootOf(cwd, opts);
  const c: Counters = { malformed: 0, refused: refused ? 1 : 0, secret: 0, truncated: false };
  if (!root) return { v: PARADIGM_SLICE_V1, state: 'absent', project, at, ...(refused ? { skipped: { ...c } } : {}) };
  const name = displayTitle(path.basename(root), NAME_MAX).text;
  let real: string;
  try {
    real = fs.realpathSync(path.join(root, '.paradigm'));
  } catch {
    return { v: PARADIGM_SLICE_V1, state: 'absent', project, at };
  }
  const box = new Confined(real, c);
  const P = path.join(root, '.paradigm');

  // tasks: every active task (bounded), counts + top SLICE_TOP (high first, newest first)
  const active: Array<{ id: string; blurb: string; priority: string; created: string }> = [];
  let budget = MAX_ENTRIES;
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
  const taskItems = active.slice(0, SLICE_TOP).map((t) => ({ id: t.id, ...titleOf(t.blurb), priority: t.priority }));

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
  const decItems = decs.slice(0, SLICE_TOP).map((d) => ({ id: d.id, ...titleOf(d.title), date: DATE.exec(d.ts)?.[1] ?? null }));

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
    project,
    name,
    at,
    newest: dates.length ? dates[dates.length - 1]! : null,
    tasks: { open: active.length, high: active.filter((t) => t.priority === 'high').length, items: taskItems, count: { n: taskItems.length, of: active.length } },
    decisions: { items: decItems, count: { n: decItems.length, of: decNames.length } },
    lore: { items: loreTop.map((l) => ({ id: l.id, ...titleOf(l.title), type: l.type })), count: { n: loreTop.length, of: loreTotal } },
    symbols,
    skipped: { ...c },
  };
}

/** The unfocused slice (no live session focused, or the focus names none). */
export function unfocusedSlice(): ParadigmSlice {
  return { v: PARADIGM_SLICE_V1, state: 'unfocused' };
}

/** A small TTL cache over paradigmSlice, keyed by the session cwd (bounded). */
export class ParadigmSliceCache {
  readonly #ttlMs: number;
  readonly #max: number;
  readonly #m = new Map<string, { at: number; s: ParadigmSlice }>();
  constructor(ttlMs = 3_000, max = 32) {
    this.#ttlMs = ttlMs;
    this.#max = max;
  }
  get(cwd: string, now: number, opts: { home?: string } = {}): ParadigmSlice {
    const hit = this.#m.get(cwd);
    if (hit && now - hit.at < this.#ttlMs) return hit.s;
    const s = paradigmSlice(cwd, { ...opts, now });
    this.#m.delete(cwd);
    if (this.#m.size >= this.#max) this.#m.delete(this.#m.keys().next().value!);
    this.#m.set(cwd, { at: now, s });
    return s;
  }
}
