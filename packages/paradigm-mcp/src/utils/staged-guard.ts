/**
 * @symbol #gnomon-staged
 *
 * TD-2026-10-27-833 (Aegis M1): path confinement for the staged Gnomon mode, installed ONCE at server start, centrally,
 * around Node's own fs API (every op and helper calls fs, so no op can forget it). After installStagedGuard:
 *
 *   writes  (writeFile, appendFile, mkdir, rm, rmdir, unlink, rename, copyFile, cp, symlink, link, truncate, chmod,
 *           utimes, open with a write flag, createWriteStream, and their promise forms) are allowed only to
 *             <root>/.paradigm/**, any `.purpose` file, and `portal.yaml`, inside the project root, or
 *             the kernel's per-session HOME (Paradigm's global dir and session trail);
 *           a path whose lexical form or the realpath of its longest existing prefix has a `.git` component, that
 *           resolves outside those places, or whose final component is an existing symlink is refused EACCES.
 *   reads   (readFile, readdir, open read-only, createReadStream, opendir and promise forms) are allowed only inside the
 *           project root, HOME and the server's own bundle dir.
 * Metadata calls (stat, lstat, exists, realpath, access) stay open: they reveal no content and feature detection uses
 * them everywhere.
 */
import { createRequire, syncBuiltinESMExports } from 'module';
import * as path from 'path';

// the MUTABLE CommonJS fs object (an ESM namespace is frozen); syncBuiltinESMExports then refreshes every
// `import * as fs from 'fs'` binding (including the bundle's external node:fs imports) to the guarded functions
const fs = createRequire(import.meta.url)('fs') as typeof import('fs');

export interface StagedGuardOptions {
  root: string;
  home: string;
  /** the server's own code dir (the bundle and its wasm) */
  selfDir: string;
  platform?: string;
}

export class StagedPathRefused extends Error {
  readonly code = 'EACCES';
  constructor(readonly op: string, readonly target: string, why: string) {
    super(`${op} refused in the staged Gnomon mode: ${why} (${target.slice(0, 300)})`);
  }
}

const realLoose = (p: string): string => {
  let cur = path.resolve(p);
  const rest: string[] = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(cur), ...rest.reverse());
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return path.resolve(p);
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
};

export function stagedPathPolicy(o: StagedGuardOptions) {
  const fold = (o.platform ?? process.platform) === 'darwin' || (o.platform ?? process.platform) === 'win32';
  const norm = (p: string): string => (fold ? p.toLowerCase() : p);
  const within = (p: string, r: string): boolean => {
    const rel = path.relative(norm(r), norm(p));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  };
  const root = realLoose(o.root);
  const home = realLoose(o.home);
  const self = realLoose(o.selfDir);
  const hasGit = (p: string): boolean => p.split(/[\\/]/).some((c) => norm(c) === '.git');
  const canWrite = (target: string): string | null => {
    const lexical = path.resolve(target);
    const real = realLoose(lexical);
    if (hasGit(lexical) || hasGit(real)) return 'a .git path';
    try {
      if (fs.lstatSync(lexical).isSymbolicLink()) return 'a symlink';
    } catch {
      /* absent */
    }
    if (within(real, home)) return null;
    if (!within(real, root)) return 'outside the project root';
    const rel = path.relative(root, real).split(path.sep);
    if (norm(rel[0] ?? '') === '.paradigm') return null;
    const base = norm(path.basename(real));
    if (base === '.purpose' || (base === 'portal.yaml' && rel.length === 1)) return null;
    return 'not .paradigm/, a .purpose or portal.yaml';
  };
  const canRead = (target: string): string | null => {
    const real = realLoose(path.resolve(target));
    return within(real, root) || within(real, home) || within(real, self) ? null : 'outside the project root';
  };
  return { canWrite, canRead };
}

type AnyFn = (...a: unknown[]) => unknown;
let installed = false;
const originals: Array<[Record<string, unknown>, string, unknown]> = [];

/** TEST ONLY: put every original fs function back (a server never uninstalls). */
export function uninstallStagedGuard(): void {
  for (const [obj, name, fn] of originals.splice(0)) obj[name] = fn;
  installed = false;
  syncBuiltinESMExports();
}

/** Install the guard (idempotent). Returns the policy (tests use it directly). */
export function installStagedGuard(o: StagedGuardOptions): ReturnType<typeof stagedPathPolicy> {
  const pol = stagedPathPolicy(o);
  if (installed) return pol;
  installed = true;
  const asPath = (v: unknown): string | null => (typeof v === 'string' ? v : v instanceof URL ? v.pathname : Buffer.isBuffer(v) ? v.toString() : null);
  const writeFlag = (flags: unknown): boolean => {
    if (typeof flags === 'number') return (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND)) !== 0;
    return typeof flags === 'string' && /[wa+]/.test(flags);
  };
  const check = (op: string, p: unknown, kind: 'read' | 'write'): void => {
    const s = asPath(p);
    if (s === null) return; // an fd: opened (and checked) by open
    const why = kind === 'write' ? pol.canWrite(s) : pol.canRead(s);
    if (why) throw new StagedPathRefused(op, s, why);
  };
  const wrap = (obj: Record<string, unknown>, name: string, spec: (args: unknown[]) => Array<[unknown, 'read' | 'write']>, isPromise = false): void => {
    const orig = obj[name] as AnyFn | undefined;
    if (typeof orig !== 'function') return;
    const guarded = function (this: unknown, ...args: unknown[]): unknown {
      try {
        for (const [p, k] of spec(args)) check(name, p, k);
      } catch (e) {
        if (isPromise) return Promise.reject(e);
        const cb = args[args.length - 1];
        if (typeof cb === 'function' && !name.endsWith('Sync') && name !== 'createReadStream' && name !== 'createWriteStream') {
          queueMicrotask(() => (cb as AnyFn)(e));
          return undefined;
        }
        throw e;
      }
      return orig.apply(this, args);
    };
    Object.defineProperty(guarded, 'name', { value: name });
    originals.push([obj, name, orig]);
    obj[name] = guarded;
  };
  const W1 = (a: unknown[]): Array<[unknown, 'read' | 'write']> => [[a[0], 'write']];
  const W2 = (a: unknown[]): Array<[unknown, 'read' | 'write']> => [[a[0], 'write'], [a[1], 'write']];
  const R1 = (a: unknown[]): Array<[unknown, 'read' | 'write']> => [[a[0], 'read']];
  const CP = (a: unknown[]): Array<[unknown, 'read' | 'write']> => [[a[0], 'read'], [a[1], 'write']];
  const OPEN = (a: unknown[]): Array<[unknown, 'read' | 'write']> => [[a[0], writeFlag(a[1]) ? 'write' : 'read']];
  const STREAM_W = (a: unknown[]): Array<[unknown, 'read' | 'write']> => [[a[0], 'write']];
  const table: Array<[string, (a: unknown[]) => Array<[unknown, 'read' | 'write']>]> = [
    ['writeFile', W1], ['appendFile', W1], ['mkdir', W1], ['mkdtemp', W1], ['rm', W1], ['rmdir', W1], ['unlink', W1], ['truncate', W1],
    ['chmod', W1], ['lchmod', W1], ['chown', W1], ['lchown', W1], ['utimes', W1], ['lutimes', W1],
    ['rename', W2], ['symlink', (a) => [[a[1], 'write']]], ['link', W2], ['copyFile', CP], ['cp', CP],
    ['readFile', R1], ['readdir', R1], ['opendir', R1], ['open', OPEN],
  ];
  const f = fs as unknown as Record<string, unknown>;
  for (const [n, spec] of table) {
    wrap(f, n, spec);
    wrap(f, `${n}Sync`, spec);
    wrap(fs.promises as unknown as Record<string, unknown>, n, spec, true);
  }
  wrap(f, 'createWriteStream', STREAM_W);
  wrap(f, 'createReadStream', R1);
  syncBuiltinESMExports();
  return pol;
}
