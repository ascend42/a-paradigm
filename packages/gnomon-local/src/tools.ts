/**
 * @symbol #gnomon-local
 *
 * The child's tools (spec §13.1: the child owns the model loop and the
 * tools). Slice 1: read_file, write_file, list_dir, resolved against the
 * session cwd. Confinement is the `session` sandbox profile the kernel runs
 * the child under (§15.5; G-LCL-06: ~/.gnomon/keys is unreadable) — the tools
 * deliberately do not re-implement it, so the profile is what the oracle
 * tests. `bash` and edit-in-place are slice 2.
 */
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import type { ToolSpec } from './compat.js';

export interface ToolResult {
  content: string;
  isError: boolean;
}

export type ToolImpl = (args: Record<string, unknown>, cwd: string) => Promise<ToolResult>;

const MAX_READ = 256 * 1024;

const str = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || v.length === 0) throw new Error(`${name} must be a non-empty string`);
  return v;
};

export const TOOLS: ReadonlyArray<ToolSpec & { run: ToolImpl }> = Object.freeze([
  {
    name: 'read_file',
    description: 'Read a UTF-8 text file (path relative to the working directory).',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    run: async (a, cwd) => {
      const p = path.resolve(cwd, str(a.path, 'path'));
      const b = await fsp.readFile(p);
      return { content: b.subarray(0, MAX_READ).toString('utf8'), isError: false };
    },
  },
  {
    name: 'write_file',
    description: 'Write a UTF-8 text file, creating parent directories (path relative to the working directory).',
    parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    run: async (a, cwd) => {
      const p = path.resolve(cwd, str(a.path, 'path'));
      if (typeof a.content !== 'string') throw new Error('content must be a string');
      await fsp.mkdir(path.dirname(p), { recursive: true });
      await fsp.writeFile(p, a.content);
      return { content: `wrote ${Buffer.byteLength(a.content)} bytes to ${path.relative(cwd, p) || p}`, isError: false };
    },
  },
  {
    name: 'list_dir',
    description: 'List a directory (path relative to the working directory; default ".").',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: [] },
    run: async (a, cwd) => {
      const p = path.resolve(cwd, typeof a.path === 'string' && a.path ? a.path : '.');
      const ents = await fsp.readdir(p, { withFileTypes: true });
      return { content: ents.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort().join('\n'), isError: false };
    },
  },
]);

export async function runTool(name: string, args: Record<string, unknown>, cwd: string): Promise<ToolResult> {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) return { content: `unknown tool ${name.slice(0, 64)}`, isError: true };
  try {
    return await t.run(args, cwd);
  } catch (err) {
    return { content: (err as Error).message.slice(0, 500), isError: true };
  }
}
