/**
 * @symbol #gnomon-local
 *
 * The child's tools (spec §13.1: the child owns the model loop and the
 * tools). Slice 1: read_file, write_file, list_dir; slice B1 (TD-2026-10-27-833,
 * retrieval.ts): read_section, grep, outline, edit. Every path goes through
 * the confinement in confine.ts (roots by realpath, .git deny, hard links,
 * symlinked final components, protect globs) — see that file's comment.
 *   - read_file reads at most MAX_READ bytes from an open handle (R6);
 *     T-2026-10-26-003: it is PAGED in BYTES — optional `offset` (byte offset,
 *     default 0) and `limit` (bytes, default and ceiling = the read cap). The
 *     read cap is the session's share (ctx.readCap, set by the agent from the
 *     working budget), never above MAX_READ (the absolute ceiling). A page
 *     ends on a UTF-8 character boundary; a page that is not the whole file
 *     ends with a note naming the total size, the bytes returned and the next
 *     offset ("call read_file with offset=N for more");
 *   - list_dir (slice B1) prints at most LIST_MAX_ENTRIES names, then how many
 *     more (dirs and files) it did not show;
 *   - TOOLS is in the fixed surface order (compat.ts TOOL_ORDER).
 * `bash` is slice 2.
 */
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { orderTools, type ToolSpec } from './compat.js';
import { canonRoots, openRead, resolveRead, resolveWrite, sourceOf, writeConfined, type ToolContext, type ToolResult } from './confine.js';
import { edit, grep, outline, readSection } from './retrieval.js';

export { canonRoots, insideRoots, isDotGit, lexicalRefusal, PathRefused, PATH_CASE_INSENSITIVE, PATH_SEP, resolveRead, resolveWrite, type ResultSource, type ToolContext, type ToolResult } from './confine.js';

/** list_dir prints at most this many entries (slice B1), then a count of the rest. */
export const LIST_MAX_ENTRIES = 200;

export type ToolImpl = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;

/** The absolute ceiling of one read_file page, whatever the session's budget (R6). */
export const MAX_READ = 256 * 1024;
/** The smallest page a read cap may set (a tiny budget still reads something useful). */
export const MIN_READ = 512;

/** Byte offset/limit argument: absent ⇒ the default; else a non-negative integer. */
const byteArg = (v: unknown, name: string): number | undefined => {
  if (v === undefined || v === null) return undefined;
  const n = typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer (bytes)`);
  return n;
};

/** End of a page at or before `end` that does not split a UTF-8 sequence (never before `start` + 1 when bytes remain). */
export function utf8Boundary(buf: Buffer, end: number): number {
  if (end >= buf.length) return buf.length;
  let e = end;
  // buf[e] is the first byte NOT returned: a continuation byte (10xxxxxx) means the cut splits a character
  while (e > 0 && (buf[e]! & 0xc0) === 0x80) e--;
  return e > 0 ? e : end;
}

/** One read_file page of `size`-byte `file`: `[offset, offset + limit)` within the cap, a note when there is more. */
export async function readPage(file: string, a: Record<string, unknown>, ctx: ToolContext, shown: string): Promise<ToolResult> {
  const r = await page(file, a, ctx, shown);
  // Aegis M5: file content is labelled (shape.ts): model-generated for a file the model wrote this session, else workspace
  return { ...r, source: sourceOf(file, ctx) };
}

async function page(file: string, a: Record<string, unknown>, ctx: ToolContext, shown: string): Promise<ToolResult> {
  const cap = Math.min(MAX_READ, Math.max(MIN_READ, Math.floor(ctx.readCap ?? MAX_READ)));
  const offset = byteArg(a.offset, 'offset') ?? 0;
  const limit = Math.min(cap, byteArg(a.limit, 'limit') ?? cap);
  // Aegis L1/L4: a regular file checked before the open, O_NONBLOCK, the handle verified against the path
  const fh = await openRead(file, await canonRoots(ctx.roots));
  try {
    const size = (await fh.stat()).size;
    if (offset >= size && size > 0) return { content: `[read_file: ${shown} is ${size} bytes; offset=${offset} is past the end]`, isError: false };
    // one byte more than the page tells whether a character continues past the cut
    const want = Math.max(0, Math.min(limit, size - offset));
    const buf = Buffer.alloc(want + 4);
    const { bytesRead } = await fh.read(buf, 0, Math.min(want + 4, Math.max(0, size - offset)), offset);
    const got = buf.subarray(0, bytesRead);
    const end = bytesRead > want ? utf8Boundary(got, want) : bytesRead;
    const text = got.subarray(0, end).toString('utf8');
    const next = offset + end;
    if (offset === 0 && next >= size) return { content: text, isError: false };
    const more = next < size ? ` Call read_file with path="${shown}" offset=${next} for more.` : ' This is the end of the file.';
    return { content: `${text}\n[read_file: ${shown} is ${size} bytes; returned bytes ${offset}-${next} (${end} bytes).${more}]`, isError: false };
  } finally {
    await fh.close();
  }
}

const str = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || v.length === 0) throw new Error(`${name} must be a non-empty string`);
  return v;
};

const TOOL_LIST: ReadonlyArray<ToolSpec & { run: ToolImpl }> = [
  {
    name: 'list_dir',
    description: `List a directory (path relative to the working dir; default "."); at most ${LIST_MAX_ENTRIES} entries, then a count of the rest.`,
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: [] },
    run: async (a, ctx) => {
      const p = await resolveRead(typeof a.path === 'string' && a.path ? a.path : '.', ctx);
      const ents = await fsp.readdir(p, { withFileTypes: true });
      const names = ents.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort();
      if (names.length <= LIST_MAX_ENTRIES) return { content: names.join('\n'), isError: false };
      const rest = names.slice(LIST_MAX_ENTRIES);
      const dirs = rest.filter((n) => n.endsWith('/')).length;
      return { content: `${names.slice(0, LIST_MAX_ENTRIES).join('\n')}\n[list_dir: ${rest.length} more entries not shown (${dirs} dirs, ${rest.length - dirs} files); use grep with glob= or list a subdirectory.]`, isError: false };
    },
  },
  {
    name: 'read_file',
    description: 'Read a UTF-8 file (path relative to the working dir), paged: offset/limit in BYTES; a partial page names the next offset.\nA page that is not the whole file ends with a note giving the total size, the bytes returned and the offset to pass for the next page. Read only the files the question needs.',
    parameters: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'integer', description: 'byte offset to start at (default 0)' }, limit: { type: 'integer', description: 'most bytes to return (default and maximum: the session page size)' } }, required: ['path'] },
    run: async (a, ctx) => {
      const raw = str(a.path, 'path');
      return readPage(await resolveRead(raw, ctx), a, ctx, raw.slice(0, 200));
    },
  },
  {
    name: 'read_section',
    description: 'Read lines from..to of a file, a symbol\'s section (path + symbol, via outline), or a shaped result (handle="@r1").\nLines are 1-based and inclusive; a long section is paged and names the next from.',
    parameters: { type: 'object', properties: { path: { type: 'string' }, from: { type: 'integer', description: 'first line (1-based, default 1)' }, to: { type: 'integer', description: 'last line (inclusive)' }, symbol: { type: 'string', description: 'a name outline lists' }, handle: { type: 'string', description: 'a spill handle like @r1' } }, required: [] },
    run: readSection,
  },
  {
    name: 'grep',
    description: 'Search files for pattern (literal; regex=true for a regex); path=dir or file, glob="*.ts"; prints path:line: text.\nSkips binaries, symlinks, .git and node_modules; at most 60 hits and 2000 files.',
    parameters: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' }, glob: { type: 'string' }, max: { type: 'integer' }, regex: { type: 'boolean' } }, required: ['pattern'] },
    run: grep,
  },
  {
    name: 'outline',
    description: "List a source file's functions, classes, types, exports and md headings with line numbers (ts/js, py, go, rs, md).",
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    run: outline,
  },
  {
    name: 'edit',
    description: 'Replace the one exact occurrence of old with new in an existing file (old must match once, whitespace included).\nZero or several matches are refused with the count; add surrounding lines to make old unique.',
    parameters: { type: 'object', properties: { path: { type: 'string' }, old: { type: 'string' }, new: { type: 'string' } }, required: ['path', 'old', 'new'] },
    run: edit,
  },
  {
    name: 'write_file',
    description: 'Write a UTF-8 text file, creating parent directories (path relative to the working directory).',
    parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    run: async (a, ctx) => {
      if (typeof a.content !== 'string') throw new Error('content must be a string');
      const p = await resolveWrite(str(a.path, 'path'), ctx);
      await writeConfined(p, a.content, ctx);
      return { content: `wrote ${Buffer.byteLength(a.content)} bytes to ${path.relative(ctx.cwd, p) || p}`, isError: false };
    },
  },
];

/** Every tool, in the fixed surface order (compat.ts TOOL_ORDER). */
export const TOOLS: ReadonlyArray<ToolSpec & { run: ToolImpl }> = Object.freeze(orderTools(TOOL_LIST));

export async function runTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const t = TOOLS.find((x) => x.name === name && (!ctx.allow || ctx.allow.includes(x.name)));
  if (!t) return { content: `unknown tool ${name.slice(0, 64)}`, isError: true };
  try {
    return await t.run(args, ctx);
  } catch (err) {
    return { content: (err as Error).message.slice(0, 500), isError: true };
  }
}
