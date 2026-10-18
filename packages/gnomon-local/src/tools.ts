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
 *   - out-of-root writes are REFUSED in slice 1 (no card); a card-gated
 *     out-of-root write is slice 2.
 * `bash` and edit-in-place are slice 2.
 */
import { constants, promises as fsp } from 'node:fs';
import * as path from 'node:path';
import type { ToolSpec } from './compat.js';

export interface ToolResult {
  content: string;
  isError: boolean;
}

export interface ToolContext {
  cwd: string;
  /** realpath'd roots (cwd + worktree); a path outside every root is refused */
  roots: string[];
}

export type ToolImpl = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;

const MAX_READ = 256 * 1024;

export class PathRefused extends Error {}

const str = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || v.length === 0) throw new Error(`${name} must be a non-empty string`);
  return v;
};

function inside(p: string, roots: readonly string[]): string | null {
  for (const r of roots) if (p === r || p.startsWith(r.endsWith(path.sep) ? r : r + path.sep)) return r;
  return null;
}

/** A read target: must exist; its realpath lies inside a root. */
export async function resolveRead(raw: string, ctx: ToolContext): Promise<string> {
  const real = await fsp.realpath(path.resolve(ctx.cwd, raw));
  if (!inside(real, ctx.roots)) throw new PathRefused(`path is outside the session roots: ${raw.slice(0, 200)}`);
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
  const root = inside(target, ctx.roots);
  if (!root || target === root) throw new PathRefused(`write outside the session roots is refused (slice 1): ${raw.slice(0, 200)}`);
  if (path.relative(root, target).split(path.sep).includes('.git')) throw new PathRefused('writes under .git are refused');
  try {
    if ((await fsp.lstat(target)).isSymbolicLink()) throw new PathRefused('the final path component is a symlink');
  } catch (err) {
    if (err instanceof PathRefused) throw err;
  }
  return target;
}

export const TOOLS: ReadonlyArray<ToolSpec & { run: ToolImpl }> = Object.freeze([
  {
    name: 'read_file',
    description: 'Read a UTF-8 text file (path relative to the working directory).',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    run: async (a, ctx) => {
      const b = await fsp.readFile(await resolveRead(str(a.path, 'path'), ctx));
      return { content: b.subarray(0, MAX_READ).toString('utf8'), isError: false };
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
      if (!inside(await fsp.realpath(path.dirname(p)), ctx.roots)) throw new PathRefused('the parent moved outside the session roots');
      const fh = await fsp.open(p, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0), 0o644);
      try {
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
  const t = TOOLS.find((x) => x.name === name);
  if (!t) return { content: `unknown tool ${name.slice(0, 64)}`, isError: true };
  try {
    return await t.run(args, ctx);
  } catch (err) {
    return { content: (err as Error).message.slice(0, 500), isError: true };
  }
}
