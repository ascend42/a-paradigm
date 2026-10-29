/**
 * @symbol #loop-check
 *
 * The ONE shebang parser for loops (docs/specs/gnomon-loops.md §3.1: argv0's shebang interpreter is hashed at
 * trust and is the only other program a check may exec). Used by #loop-check's executor and by the registry's
 * hash (step 3), so both name the same interpreter for the same file.
 * - readShebang: the first line (without `#!`) of a file, at most 256 bytes, or null.
 * - shebangProgram: `/usr/bin/env [-flags] [NAME=value …] prog …` → prog (via env); otherwise the first word.
 *   Flags (`-S`, `-i`, `-u`) and NAME=value assignments are skipped: env runs the first word that is neither.
 * - resolveShebangInterpreter: the realpath of what runs. Via env, `node` is the KERNEL's node (the check PATH
 *   puts its dir first); another program is looked up in `pathDirs`; an absolute program is itself.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { childNodePath } from '../lifecycle/sea.js';

export function readShebang(file: string): string | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(256);
    const n = fs.readSync(fd, buf, 0, 256, 0);
    const head = buf.subarray(0, n).toString('utf8');
    if (!head.startsWith('#!')) return null;
    return head.slice(2).split(/\r?\n/)[0]!.trim() || null;
  } catch {
    return null;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;

export function shebangProgram(shebang: string): { program: string; viaEnv: boolean; envPath: string | null } {
  const words = shebang.split(/\s+/).filter(Boolean);
  const first = words[0] ?? '';
  if (path.posix.basename(first) === 'env') {
    const rest = words.slice(1).filter((w) => !(w.startsWith('-') && w !== '-') && !ENV_ASSIGN.test(w));
    return { program: rest[0] ?? '', viaEnv: true, envPath: first };
  }
  return { program: first, viaEnv: false, envPath: null };
}

export interface ShebangInterpreter {
  shebang: string;
  program: string;
  /** realpath of the env binary when the shebang goes through env */
  env: string | null;
  /** realpath of the interpreter that runs the script, or null when unresolved */
  real: string | null;
  via: 'kernel-node' | 'absolute' | 'path' | 'unresolved';
}

const realOrNull = (p: string): string | null => {
  try {
    const r = fs.realpathSync.native(p);
    return fs.statSync(r).isFile() ? r : null;
  } catch {
    return null;
  }
};

export function resolveShebangInterpreter(shebang: string, o: { execPath?: string; pathDirs: readonly string[] }): ShebangInterpreter {
  const { program, viaEnv, envPath } = shebangProgram(shebang);
  const env = envPath ? realOrNull(envPath) : null;
  const base = { shebang, program, env };
  if (viaEnv && path.posix.basename(program) === 'node') {
    const r = realOrNull(o.execPath ?? childNodePath());
    return { ...base, real: r, via: r ? 'kernel-node' : 'unresolved' };
  }
  if (!program) return { ...base, real: null, via: 'unresolved' };
  if (path.isAbsolute(program)) {
    const r = realOrNull(program);
    return { ...base, real: r, via: r ? 'absolute' : 'unresolved' };
  }
  if (!viaEnv) return { ...base, real: null, via: 'unresolved' };
  for (const d of o.pathDirs) {
    const r = realOrNull(path.join(d, program));
    if (r) return { ...base, real: r, via: 'path' };
  }
  return { ...base, real: null, via: 'unresolved' };
}
