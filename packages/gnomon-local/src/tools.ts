/**
 * @symbol #gnomon-local
 *
 * The child's tools (spec §13.1: the child owns the model loop and the
 * tools). Slice 1: read_file, write_file, list_dir. A local model is an
 * untrusted author of paths, and slice 1 has no per-tool approval card, so
 * the tools CONFINE themselves (Aegis H1, M1.8 round 2) — in addition to the
 * `session` sandbox profile the kernel runs the child under (§15.5, which
 * deliberately does not confine the worktree):
 *   - every path is resolved against the session cwd and REALPATH'd; it must
 *     lie inside one of the realpath'd roots (cwd + worktree), else refused
 *     (absolute paths, `../` escapes and symlinked dirs all land here);
 *   - writes realpath the nearest existing ancestor, refuse a symlink as the
 *     final component (and open with O_NOFOLLOW), and refuse anything under
 *     a `.git` directory (hooks, config);
 *   - the `.git` deny is CASE- and alias-insensitive (round 3, Aegis C1;
 *     git's is_hfs_dotgit / is_ntfs_dotgit idea): each component is
 *     lower-cased with trailing dots/spaces stripped and compared against
 *     `.git` and the 8.3 alias `git~1` (APFS/NTFS are case-insensitive);
 *   - a regular file with more than one hard link is refused for reads and
 *     writes (round 3, R1: a hard link out of the root);
 *   - read_file reads at most MAX_READ bytes from an open handle (R6);
 *     T-2026-10-26-003: it is PAGED in BYTES — optional `offset` (byte offset,
 *     default 0) and `limit` (bytes, default and ceiling = the read cap). The
 *     read cap is the session's share (ctx.readCap, set by the agent from the
 *     working budget), never above MAX_READ (the absolute ceiling). A page
 *     ends on a UTF-8 character boundary; a page that is not the whole file
 *     ends with a note naming the total size, the bytes returned and the next
 *     offset ("call read_file with offset=N for more");
 *   - ONE canonicalisation everywhere (Windows CI, 8.3 short names): roots,
 *     targets and the nearest-ancestor walk all go through the NATIVE
 *     realpath (fs.promises.realpath = uv_fs_realpath, which expands
 *     RUNNER~1); roots are re-canonicalised per call, so a caller holding a
 *     JS-flavour realpath still compares like for like; the inside check
 *     compares case-insensitively only where the platform's paths are
 *     (PATH_CASE_INSENSITIVE: win32 — darwin's native realpath returns the
 *     on-disk case and APFS may be case-sensitive, so it compares exactly);
 *   - out-of-root writes are REFUSED in slice 1 (no card); a card-gated
 *     out-of-root write is slice 2.
 * `bash` and edit-in-place are slice 2.
 */
import { constants, promises as fsp } from 'node:fs';
import * as path from 'node:path';
import type { ToolSpec } from './compat.js';
import { PROTECTED_PREFIX, ProtectedRefused, protectedHit } from './protect.js';

export interface ToolResult {
  content: string;
  isError: boolean;
}

export interface ToolContext {
  cwd: string;
  /** realpath'd roots (cwd + worktree); a path outside every root is refused */
  roots: string[];
  /**
   * Loops step 10 (a loop act session): the tool names the kernel allows (the trust card's declared tools, through
   * the loop clamp); absent = every tool. A tool outside it is refused like an unknown one.
   */
  allow?: readonly string[];
  /** Loops step 10: protected globs (repo-relative to the root); a write that hits one is refused PROTECTED_PREFIX */
  protect?: readonly RegExp[];
  /** T-2026-10-26-003: the most bytes one read_file returns (the agent's share of the working budget); capped at MAX_READ */
  readCap?: number;
}

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
  const cap = Math.min(MAX_READ, Math.max(MIN_READ, Math.floor(ctx.readCap ?? MAX_READ)));
  const offset = byteArg(a.offset, 'offset') ?? 0;
  const limit = Math.min(cap, byteArg(a.limit, 'limit') ?? cap);
  const fh = await fsp.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
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

export class PathRefused extends Error {}

/** git's dotgit test, re-derived: lower-case, strip trailing dots/spaces; `.git` or the 8.3 alias `git~1`. */
export function isDotGit(component: string): boolean {
  const c = component.toLowerCase().replace(/[. ]+$/, '');
  return c === '.git' || c === 'git~1';
}

const str = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || v.length === 0) throw new Error(`${name} must be a non-empty string`);
  return v;
};

/** Platforms whose path comparison is case-insensitive (data, not a branch). */
export const PATH_CASE_INSENSITIVE: Readonly<Record<string, boolean>> = Object.freeze({ win32: true });
/** The separator of a platform's canonical paths (data; default the host's). */
export const PATH_SEP: Readonly<Record<string, string>> = Object.freeze({ win32: '\\', darwin: '/', linux: '/' });

const fold = (p: string, platform: string): string => (PATH_CASE_INSENSITIVE[platform] ? p.toLowerCase() : p);

/** Is canonical `p` equal to or under canonical root `r`? Returns the matching root. */
export function insideRoots(p: string, roots: readonly string[], platform: string = process.platform): string | null {
  const fp = fold(p, platform);
  for (const r of roots) {
    const fr = fold(r, platform);
    const sep = PATH_SEP[platform] ?? path.sep;
    if (fp === fr || fp.startsWith(fr.endsWith(sep) ? fr : fr + sep)) return r;
  }
  return null;
}

const inside = (p: string, roots: readonly string[]): string | null => insideRoots(p, roots);

/** Roots through the same native realpath as every target (8.3 names, symlinked tmp dirs). */
async function canonRoots(roots: readonly string[]): Promise<string[]> {
  return Promise.all(roots.map((r) => fsp.realpath(r).catch(() => r)));
}

/** A read target: must exist; its realpath lies inside a root. */
export async function resolveRead(raw: string, ctx: ToolContext): Promise<string> {
  const real = await fsp.realpath(path.resolve(ctx.cwd, raw));
  if (!inside(real, await canonRoots(ctx.roots))) throw new PathRefused(`path is outside the session roots: ${raw.slice(0, 200)}`);
  const st = await fsp.stat(real);
  if (st.isFile() && st.nlink > 1) throw new PathRefused('a file with more than one hard link is refused');
  return real;
}

/** A write target: realpath of the nearest existing ancestor + the rest; inside a root; not under .git; final component not a symlink. */
export async function resolveWrite(raw: string, ctx: ToolContext): Promise<string> {
  const abs = path.resolve(ctx.cwd, raw);
  let anc = abs;
  const rest: string[] = [];
  for (;;) {
    try {
      anc = await fsp.realpath(anc);
      break;
    } catch {
      const parent = path.dirname(anc);
      if (parent === anc) throw new PathRefused('no existing ancestor');
      rest.unshift(path.basename(anc));
      anc = parent;
    }
  }
  const target = path.join(anc, ...rest);
  const root = inside(target, await canonRoots(ctx.roots));
  if (!root || target === root) throw new PathRefused(`write outside the session roots is refused (slice 1): ${raw.slice(0, 200)}`);
  if (target.slice(root.length).split(/[\\/]/).some(isDotGit)) throw new PathRefused('writes under .git are refused');
  // Loops step 10 (Aegis M3): a name with control, format (bidi) or separator characters, or a component over 255
  // bytes, would forge or hide lines on the card that shows it: refused
  if (target.slice(root.length).split(/[\\/]/).some((c) => /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(c) || Buffer.byteLength(c, 'utf8') > 255)) throw new PathRefused('a path component with control, format or bidi characters, or over 255 bytes, is refused');
  if (ctx.protect) {
    const rel = target.slice(root.length).split(/[\\/]/).filter(Boolean).join('/');
    if (protectedHit(rel, ctx.protect)) throw new ProtectedRefused(`${PROTECTED_PREFIX} ${rel.slice(0, 200)} is a protected goal input of this loop (no edit, no card)`);
  }
  try {
    const st = await fsp.lstat(target);
    if (st.isSymbolicLink()) throw new PathRefused('the final path component is a symlink');
    if (st.nlink > 1) throw new PathRefused('a file with more than one hard link is refused');
  } catch (err) {
    if (err instanceof PathRefused || err instanceof ProtectedRefused) throw err;
  }
  return target;
}

export const TOOLS: ReadonlyArray<ToolSpec & { run: ToolImpl }> = Object.freeze([
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
    name: 'write_file',
    description: 'Write a UTF-8 text file, creating parent directories (path relative to the working directory).',
    parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    run: async (a, ctx) => {
      if (typeof a.content !== 'string') throw new Error('content must be a string');
      const p = await resolveWrite(str(a.path, 'path'), ctx);
      await fsp.mkdir(path.dirname(p), { recursive: true });
      // re-check after mkdir (a racing symlink), then open without following a final symlink
      if (!inside(await fsp.realpath(path.dirname(p)), await canonRoots(ctx.roots))) throw new PathRefused('the parent moved outside the session roots');
      // no O_TRUNC: fstat first, so a hard link raced in after the lstat is refused before any byte changes
      const fh = await fsp.open(p, constants.O_WRONLY | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0), 0o644);
      try {
        if ((await fh.stat()).nlink > 1) throw new PathRefused('a file with more than one hard link is refused');
        await fh.truncate(0);
        await fh.writeFile(a.content);
      } finally {
        await fh.close();
      }
      return { content: `wrote ${Buffer.byteLength(a.content)} bytes to ${path.relative(ctx.cwd, p) || p}`, isError: false };
    },
  },
  {
    name: 'list_dir',
    description: 'List a directory (path relative to the working directory; default ".").',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: [] },
    run: async (a, ctx) => {
      const p = await resolveRead(typeof a.path === 'string' && a.path ? a.path : '.', ctx);
      const ents = await fsp.readdir(p, { withFileTypes: true });
      return { content: ents.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort().join('\n'), isError: false };
    },
  },
]);

export async function runTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const t = TOOLS.find((x) => x.name === name && (!ctx.allow || ctx.allow.includes(x.name)));
  if (!t) return { content: `unknown tool ${name.slice(0, 64)}`, isError: true };
  try {
    return await t.run(args, ctx);
  } catch (err) {
    return { content: (err as Error).message.slice(0, 500), isError: true };
  }
}
