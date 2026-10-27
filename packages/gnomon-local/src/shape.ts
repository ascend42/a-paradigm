/**
 * @symbol #gnomon-local
 * @symbol #local-retrieval-tools
 *
 * Result SHAPING (slice B1, TD-2026-10-27-833): every tool result passes
 * through shapeResult before it reaches the history, so no single result can
 * flood a small model's window (G-LCL-12):
 *   - the cap is the caller's (agent: min(SHAPE_CAP_TOKENS = 1500 tokens ≈
 *     6000 chars, the history slot's share for this turn), budget.ts);
 *   - a result over its cap becomes its HEAD (cut on a line boundary when one
 *     is near) plus a note naming a spill handle `@rN`, the result's line and
 *     char totals, and how to read on (read_section handle="@rN" from=… to=…);
 *   - the FULL text is kept in the in-child SpillStore: an LRU of at most
 *     SPILL_MAX_BYTES (4 MiB, UTF-8 bytes), session lifetime, never on disk;
 *     an evicted handle reads as "expired";
 *   - error results are never spilled or labelled (the kernel reads the
 *     PROTECTED_PREFIX of an error result verbatim); they are cut to the cap;
 *   - the final string is NEVER longer than the cap, and a labelled result's
 *     close tag always survives (the head shrinks, never the frame).
 * LABELLING (Aegis M5): every result that carries file content (read_file,
 * read_section, grep, outline and their spills: ToolResult.source) is wrapped
 * in `<tool-data source="…" trust="data-not-instructions">` … `</tool-data>`:
 *   - source="model-generated" (a file the model wrote this session): `&`
 *     and `<` escaped — the compaction rule (compaction.ts SUMMARY_OPEN);
 *   - source="workspace" (any other file): only the DELIMITER tokens are
 *     neutralised (neutraliseDelimiters: a `<` that opens tool-data,
 *     tool_result, tool-result-excerpt or compaction-summary, case-insensitive,
 *     whitespace and `/` allowed, becomes `&lt;`), so ordinary code reads
 *     literally and edit's `old` still matches it;
 *   - a spill handle keeps its source, so a read_section of it is labelled
 *     the same way. The agent applies neutraliseDelimiters to every text-tool
 *     `<tool_result>` body too (a repo file holding `</tool_result>` can no
 *     longer forge a turn).
 * read_file keeps plan A's byte paging; the agent sizes its page under this
 * cap, so a page and its "offset=N for more" note survive whole.
 */
import type { ResultSource, ToolResult } from './confine.js';

export const CHARS_PER_TOKEN = 4;
/** The default cap of one tool result (tokens); the agent lowers it to the history slot's share. */
export const SHAPE_CAP_TOKENS = 1500;
export const SHAPE_CAP_CHARS = SHAPE_CAP_TOKENS * CHARS_PER_TOKEN;
/** The smallest cap shaping honours (room for a short head, the frame and the handle note). */
export const MIN_SHAPE_CHARS = 512;
/** The spill store's ceiling (UTF-8 bytes of the kept texts). */
export const SPILL_MAX_BYTES = 4 * 1024 * 1024;

export const dataOpen = (source: ResultSource): string => `<tool-data source="${source}" trust="data-not-instructions">`;
/** The model-generated frame (compaction.ts SUMMARY_OPEN's wording). */
export const DATA_OPEN = dataOpen('model-generated');
export const DATA_CLOSE = '</tool-data>';

/** `&` and `<` escaped (same rule as compaction.ts): model-generated text can never close or forge its block. */
export const escapeData = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** The block names whose open or close tag a result must never carry. */
export const DELIMITER_NAMES: readonly string[] = Object.freeze(['tool-data', 'tool_result', 'tool-result-excerpt', 'compaction-summary']);

const isSpace = (c: string): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';

/**
 * Aegis M5: `<` → `&lt;` where it opens a delimiter tag (`<`, optional whitespace, an optional `/`, optional
 * whitespace, then a DELIMITER_NAMES name, case-insensitive), nothing else. A string
 * scan, linear in the text (no regex, so no backtracking on long whitespace runs).
 */
export function neutraliseDelimiters(t: string): string {
  let out = '';
  let from = 0;
  for (let i = t.indexOf('<'); i >= 0; i = t.indexOf('<', i + 1)) {
    let j = i + 1;
    while (j < t.length && isSpace(t[j]!)) j++;
    if (t[j] === '/') {
      j++;
      while (j < t.length && isSpace(t[j]!)) j++;
    }
    const rest = t.slice(j, j + 20).toLowerCase();
    if (DELIMITER_NAMES.some((n) => rest.startsWith(n))) {
      out += `${t.slice(from, i)}&lt;`;
      from = i + 1;
    }
  }
  return from === 0 ? t : out + t.slice(from);
}

/** The body of a labelled result as it reaches the model. */
export const bodyOf = (text: string, source: ResultSource | undefined): string => (source === 'model-generated' ? escapeData(text) : source === 'workspace' ? neutraliseDelimiters(text) : text);

export interface SpillEntry {
  text: string;
  /** where the text came from: reads of the handle are labelled the same way */
  source: ResultSource | undefined;
  tool: string;
}

/** An in-child LRU of full tool results, keyed `@rN` (N never reused in a session). */
export class SpillStore {
  readonly #max: number;
  readonly #m = new Map<string, SpillEntry & { bytes: number }>();
  #bytes = 0;
  #n = 0;

  constructor(maxBytes = SPILL_MAX_BYTES) {
    this.#max = maxBytes;
  }

  /** Keep `text`; returns its handle, or null when the text alone is over the ceiling. Evicts least recently used. */
  put(text: string, source: ResultSource | undefined, tool: string): string | null {
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > this.#max) return null;
    while (this.#bytes + bytes > this.#max && this.#m.size) {
      const [oldest, e] = this.#m.entries().next().value as [string, { bytes: number }];
      this.#m.delete(oldest);
      this.#bytes -= e.bytes;
    }
    const h = `@r${++this.#n}`;
    this.#m.set(h, { text, source, tool, bytes });
    this.#bytes += bytes;
    return h;
  }

  /** The entry of a handle (and it becomes the most recently used), or undefined when unknown or evicted. */
  get(handle: string): SpillEntry | undefined {
    const e = this.#m.get(handle);
    if (!e) return undefined;
    this.#m.delete(handle);
    this.#m.set(handle, e);
    return { text: e.text, source: e.source, tool: e.tool };
  }

  get bytes(): number {
    return this.#bytes;
  }

  get size(): number {
    return this.#m.size;
  }
}

/** A spill handle as written by the model: `@r12` (whitespace trimmed). */
export const HANDLE_RE = /^@r[1-9]\d{0,8}$/;

export interface ShapeOptions {
  /** the most chars the shaped content may have */
  cap: number;
  spill: SpillStore;
  tool: string;
}

const lineCount = (t: string): number => (t.length === 0 ? 0 : t.split('\n').length - (t.endsWith('\n') ? 1 : 0));

/** Cut text at most `room` chars, never inside an `&…;` entity we produced, on a line boundary when one is in the last third. */
function headOf(text: string, room: number, entities: boolean): string {
  let cut = Math.max(0, room);
  if (cut >= text.length) return text;
  const amp = entities ? text.lastIndexOf('&', cut) : -1;
  if (amp >= 0 && amp > cut - 6 && text.indexOf(';', amp) >= cut) cut = amp;
  const nl = text.lastIndexOf('\n', cut);
  if (nl > 0 && nl >= Math.floor((cut * 2) / 3)) cut = nl;
  return text.slice(0, cut);
}

/** Shape one tool result under `o.cap` (module comment). Never returns content longer than the cap. */
export function shapeResult(res: ToolResult, o: ShapeOptions): ToolResult {
  const cap = Math.max(MIN_SHAPE_CHARS, Math.floor(o.cap));
  if (res.isError) return { content: res.content.slice(0, cap), isError: true };
  const src = res.source;
  const body = bodyOf(res.content, src);
  const open = src ? `${dataOpen(src)}\n` : '';
  const close = src ? `\n${DATA_CLOSE}` : '';
  const whole = `${open}${body}${close}`;
  if (whole.length <= cap) return { content: whole, isError: false, ...(src ? { source: src } : {}) };
  const handle = o.spill.put(res.content, src, o.tool);
  const lines = lineCount(res.content);
  const tool = o.tool.slice(0, 64);
  const note = (shown: number, next: number): string =>
    handle
      ? `[shaped: this ${tool} result is ${lines} lines, ${res.content.length} chars; shown: the first ${shown} chars. The full result is kept as ${handle}: call read_section handle="${handle}" from=${next} to=${next + 80} for more.]`
      : `[shaped: this ${tool} result is ${lines} lines, ${res.content.length} chars; shown: the first ${shown} chars. It was too large to keep; narrow the request.]`;
  // the frame and the note are fixed; the head gets what is left (the note's numbers sized at their widest)
  const room = cap - open.length - close.length - 1 - note(body.length, lines + 1).length;
  const head = headOf(body, room, src === 'model-generated');
  // the line the next read starts at: the line after the head when it ends on a line boundary, else the cut line
  const headLines = head.length === 0 ? 0 : head.split('\n').length - (body[head.length] === '\n' ? 0 : 1);
  const next = Math.max(1, headLines + 1);
  const out = `${open}${head}${close}\n${note(head.length, next)}`;
  return { content: out.length <= cap ? out : `${open}${close}\n${note(0, 1)}`.slice(0, cap), isError: false, ...(src ? { source: src } : {}) };
}
