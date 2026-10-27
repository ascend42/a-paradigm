/**
 * @symbol #gnomon-local
 * @symbol #local-retrieval-tools
 *
 * Path CONFINEMENT for every tool (moved verbatim out of tools.ts in slice B1
 * so the retrieval tools share it without an import cycle; one file for
 * Aegis to audit). A local model is an untrusted author of paths, and slice 1
 * has no per-tool approval card, so the tools CONFINE themselves (Aegis H1,
 * M1.8 round 2) — in addition to the `session` sandbox profile the kernel
 * runs the child under (§15.5, which deliberately does not confine the
 * worktree):
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
 *   - ONE canonicalisation everywhere (Windows CI, 8.3 short names): roots,
 *     targets and the nearest-ancestor walk all go through the NATIVE
 *     realpath (fs.promises.realpath = uv_fs_realpath, which expands
 *     RUNNER~1); roots are re-canonicalised per call, so a caller holding a
 *     JS-flavour realpath still compares like for like; the inside check
 *     compares case-insensitively only where the platform's paths are
 *     (PATH_CASE_INSENSITIVE: win32 — darwin's native realpath returns the
 *     on-disk case and APFS may be case-sensitive, so it compares exactly);
 *   - out-of-root writes are REFUSED in slice 1 (no card).
 * Slice B1 adds:
 *   - confinedFile/confinedDir: the per-file and per-directory checks the grep
 *     walk uses (realpath inside the pre-canonicalised roots, a regular file,
 *     one hard link) — resolveRead's rule without re-canonicalising the roots;
 *   - writeConfined (write_file) and updateConfined (edit) share one write.
 * Aegis review of B1 (M3, M4, L1, L4, L5):
 *   - a LEXICAL gate runs before any filesystem call (M4): lexicalRefusal
 *     refuses a raw path that starts with two separators (`\\host\share`,
 *     `//host`, `\\?\…`, `\\.\…`) or holds a NUL; on win32 also a
 *     drive-relative `X:name` and a `:` in any component after the drive (an
 *     alternate data stream, L5). Then path.resolve(cwd, raw), from the given
 *     cwd or its canonical form, must lie under a root in its given or
 *     canonical form BEFORE realpath runs: `/net/<host>` (autofs) or a UNC
 *     path never touches the network. Only the roots and the cwd (session
 *     config, never model text) are realpath'd by the gate;
 *   - every open is VERIFIED (L1): after open, the handle's dev/ino must equal
 *     stat(realpath(path)) and that realpath must lie inside the roots, before
 *     a byte is read, truncated or written; a file the open just created is
 *     unlinked when the check fails. On win32 (no O_NOFOLLOW) this is the only
 *     protection against a swapped final component;
 *   - reads check isFile BEFORE opening and open O_NONBLOCK (L4: a FIFO never
 *     hangs the child);
 *   - one LOCK per canonical target (realpath of the parent + the name) inside
 *     writeConfined/updateConfined (M3): write_file and edit of one file are
 *     serialised in the child; updateConfined reads, computes and writes under
 *     the lock and compares the read handle's dev/ino/size/mtimeMs with an
 *     fstat of the write handle before truncating — a file changed in between
 *     is refused "changed since it was read; re-read it".
 */
import { constants, promises as fsp } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import * as path from 'node:path';
import { PROTECTED_PREFIX, ProtectedRefused, protectedHit } from './protect.js';
import type { SpillStore } from './shape.js';

/** Aegis M5: where a result's file content came from (shape.ts labels it; see ToolResult.source). */
export type ResultSource = 'workspace' | 'model-generated';

export interface ToolResult {
  content: string;
  isError: boolean;
  /**
   * Aegis M5: the result carries file content. shape.ts labels it `trust="data-not-instructions"` with this source:
   * 'model-generated' (a file the model wrote this session: `&` and `<` escaped) or 'workspace' (any other file: only
   * the delimiter tokens neutralised, so edit's `old` still matches the literal text). Absent = no file content (a
   * write receipt, a list of names, an error).
   */
  source?: ResultSource;
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
  /** Slice B1: the shaping cap of this call's result (chars); read_section sizes its page under it */
  resultCap?: number;
  /** Slice B1: the session's spill store (read_section reads `@rN` handles from it) */
  spill?: SpillStore;
  /** Slice B1: realpaths the model wrote this session (write_file, edit add; reads of them are model-generated) */
  written?: Set<string>;
  /** Aegis M2: the run's abort signal; long tools (grep's walk) stop when it fires */
  signal?: AbortSignal;
}

export class PathRefused extends Error {}

/** git's dotgit test, re-derived: lower-case, strip trailing dots/spaces; `.git` or the 8.3 alias `git~1`. */
export function isDotGit(component: string): boolean {
  const c = component.toLowerCase().replace(/[. ]+$/, '');
  return c === '.git' || c === 'git~1';
}

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
export async function canonRoots(roots: readonly string[]): Promise<string[]> {
  return Promise.all(roots.map((r) => fsp.realpath(r).catch(() => r)));
}

/** The source label of content read from canonical `real`: a file the model wrote this session is model-generated. */
export const sourceOf = (real: string, ctx: ToolContext): ResultSource => (ctx.written?.has(real) ? 'model-generated' : 'workspace');

/**
 * Aegis M4/L5: why a model-written path is refused before ANY filesystem call, or null. Two leading separators (UNC,
 * `\\?\`, `\\.\`, `//host`) or a NUL anywhere; on win32 a drive-relative `X:name` and a `:` after the drive (an ADS).
 */
export function lexicalRefusal(raw: string, platform: string = process.platform): string | null {
  if (raw.includes('\0')) return 'a NUL in a path is refused';
  if (/^[\\/]{2}/.test(raw)) return 'a UNC or device path (two leading separators) is refused';
  if (platform === 'win32') {
    if (/^[A-Za-z]:(?![\\/])/.test(raw)) return 'a drive-relative path (X:name) is refused';
    if (raw.replace(/^[A-Za-z]:/, '').includes(':')) return 'a ":" in a path component (an alternate data stream) is refused';
  }
  return null;
}

/**
 * Aegis M4: the lexical gate. lexicalRefusal, then path.resolve(cwd, raw) (from the given cwd or its canonical form)
 * must lie under a root in its given or canonical form. Returns the canonical roots.
 */
async function lexicalGate(raw: string, ctx: ToolContext): Promise<string[]> {
  const why = lexicalRefusal(raw);
  if (why) throw new PathRefused(why);
  const croots = await canonRoots(ctx.roots);
  const ccwd = await fsp.realpath(ctx.cwd).catch(() => ctx.cwd);
  const all = [...ctx.roots, ...croots];
  if (inside(path.resolve(ctx.cwd, raw), all) || inside(path.resolve(ccwd, raw), all)) return croots;
  throw new PathRefused(`path is outside the session roots: ${raw.slice(0, 200)}`);
}

/** A read target: passes the lexical gate; exists; its realpath lies inside a root. */
export async function resolveRead(raw: string, ctx: ToolContext): Promise<string> {
  const croots = await lexicalGate(raw, ctx);
  const real = await fsp.realpath(path.resolve(ctx.cwd, raw));
  if (!inside(real, croots)) throw new PathRefused(`path is outside the session roots: ${raw.slice(0, 200)}`);
  const st = await fsp.stat(real);
  if (st.isFile() && st.nlink > 1) throw new PathRefused('a file with more than one hard link is refused');
  return real;
}

/**
 * Slice B1 (grep's walk): the per-file form of resolveRead against roots ALREADY canonicalised (canonRoots). Returns
 * the realpath of a regular, singly-linked file inside a root, or null (skipped, never an error mid-walk).
 */
export async function confinedFile(p: string, croots: readonly string[]): Promise<string | null> {
  try {
    const real = await fsp.realpath(p);
    if (!inside(real, croots)) return null;
    const st = await fsp.stat(real);
    return st.isFile() && st.nlink === 1 ? real : null;
  } catch {
    return null;
  }
}

/** Slice B1 (grep's walk): may the walk descend into directory `p`? Its realpath must still lie inside a root. */
export async function confinedDir(p: string, croots: readonly string[]): Promise<boolean> {
  try {
    const real = await fsp.realpath(p);
    return inside(real, croots) !== null && (await fsp.stat(real)).isDirectory();
  } catch {
    return false;
  }
}

/** The root `real` lies in, relative, as POSIX components (for the .git check of a read start path). */
export function relComponents(real: string, croots: readonly string[]): string[] | null {
  const root = inside(real, croots);
  return root === null ? null : real.slice(root.length).split(/[\\/]/).filter(Boolean);
}

/** A write target: realpath of the nearest existing ancestor + the rest; inside a root; not under .git; final component not a symlink. */
export async function resolveWrite(raw: string, ctx: ToolContext): Promise<string> {
  await lexicalGate(raw, ctx);
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

export interface FileIdentity {
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
}

const identity = (st: FileIdentity): FileIdentity => ({ dev: st.dev, ino: st.ino, size: st.size, mtimeMs: st.mtimeMs });

/**
 * Aegis L1: the open handle IS the file at `p` — its dev/ino equal stat(realpath(p)) and that realpath lies inside the
 * canonical roots — else PathRefused (a final component swapped between the checks and the open).
 */
async function verifyHandle(fh: FileHandle, p: string, croots: readonly string[]): Promise<void> {
  const hs = await fh.stat();
  const real = await fsp.realpath(p).catch(() => null);
  const ps = real ? await fsp.stat(real).catch(() => null) : null;
  if (!real || !ps || !inside(real, croots) || ps.dev !== hs.dev || ps.ino !== hs.ino) throw new PathRefused('the file changed while it was opened (refused)');
}

/** Read opens: no final symlink, never blocking on a FIFO (L4). Flags a platform lacks are 0. */
const O_READ = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

/**
 * Open a confined file for reading (a realpath from resolveRead/resolveWrite/confinedFile): a regular, singly-linked
 * file, checked BEFORE the open (L4), opened O_NOFOLLOW|O_NONBLOCK and verified (L1). The caller closes it.
 */
export async function openRead(real: string, croots: readonly string[]): Promise<FileHandle> {
  const st = await fsp.stat(real);
  if (!st.isFile()) throw new PathRefused('not a regular file');
  if (st.nlink > 1) throw new PathRefused('a file with more than one hard link is refused');
  const fh = await fsp.open(real, O_READ);
  try {
    await verifyHandle(fh, real, croots);
    const hs = await fh.stat();
    if (!hs.isFile()) throw new PathRefused('not a regular file');
    if (hs.nlink > 1) throw new PathRefused('a file with more than one hard link is refused');
    return fh;
  } catch (err) {
    await fh.close();
    throw err;
  }
}

/** Read a confined regular file whole, at most `max` bytes (openRead's checks), with the read handle's identity. */
export async function readConfined(real: string, max: number, croots: readonly string[]): Promise<{ buf: Buffer; id: FileIdentity }> {
  const fh = await openRead(real, croots);
  try {
    const st = await fh.stat();
    if (st.size > max) throw new PathRefused(`the file is ${st.size} bytes (over the ${max}-byte limit of this tool)`);
    const buf = Buffer.alloc(st.size);
    const { bytesRead } = await fh.read(buf, 0, st.size, 0);
    return { buf: buf.subarray(0, bytesRead), id: identity(st) };
  } finally {
    await fh.close();
  }
}

/** Aegis M3: one in-flight write per canonical target inside the child. */
const pathLocks = new Map<string, Promise<unknown>>();

async function withPathLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = pathLocks.get(key) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  pathLocks.set(key, run);
  try {
    return await run;
  } finally {
    if (pathLocks.get(key) === run) pathLocks.delete(key);
  }
}

/** mkdir the parent and re-check it inside the roots (a racing symlink); the canonical target is the lock key. */
async function prepareTarget(p: string, ctx: ToolContext, mkdir: boolean): Promise<{ key: string; croots: string[] }> {
  if (mkdir) await fsp.mkdir(path.dirname(p), { recursive: true });
  const croots = await canonRoots(ctx.roots);
  const dir = await fsp.realpath(path.dirname(p));
  if (!inside(dir, croots)) throw new PathRefused('the parent moved outside the session roots');
  return { key: path.join(dir, path.basename(p)), croots };
}

/**
 * The write (the caller holds the target's lock): open without following a final symlink and WITHOUT O_TRUNC, verify
 * the handle (L1; a file this open created is unlinked on failure), refuse a hard link, compare with the identity the
 * caller read (`expect`, M3), then truncate and write. Records the target in ctx.written.
 */
async function writeLocked(p: string, content: string, ctx: ToolContext, croots: readonly string[], expect?: FileIdentity): Promise<void> {
  const existed = await fsp.lstat(p).then(
    () => true,
    () => false,
  );
  const fh = await fsp.open(p, constants.O_WRONLY | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0), 0o644);
  try {
    try {
      await verifyHandle(fh, p, croots);
    } catch (err) {
      if (!existed) await fsp.unlink(p).catch(() => undefined);
      throw err;
    }
    const st = await fh.stat();
    if (!st.isFile()) throw new PathRefused('not a regular file');
    if (st.nlink > 1) throw new PathRefused('a file with more than one hard link is refused');
    if (expect && (st.dev !== expect.dev || st.ino !== expect.ino || st.size !== expect.size || st.mtimeMs !== expect.mtimeMs)) throw new PathRefused('the file changed since it was read; re-read it');
    await fh.truncate(0);
    await fh.writeFile(content);
  } finally {
    await fh.close();
  }
  ctx.written?.add(await fsp.realpath(p).catch(() => p));
}

/** write_file: `content` to a target resolveWrite returned, under the target's lock. */
export async function writeConfined(p: string, content: string, ctx: ToolContext): Promise<void> {
  const { key, croots } = await prepareTarget(p, ctx, true);
  await withPathLock(key, () => writeLocked(p, content, ctx, croots));
}

/**
 * edit: read-modify-write under the target's lock — read the existing file (openRead's checks, at most `max` bytes),
 * `produce` the new text (it throws to refuse), then write only if the file is still the one that was read.
 */
export async function updateConfined<T>(p: string, ctx: ToolContext, max: number, produce: (current: Buffer) => Promise<{ text: string; result: T }> | { text: string; result: T }): Promise<T> {
  // no mkdir: an edit never creates directories (a missing parent is ENOENT, "does not exist")
  const { key, croots } = await prepareTarget(p, ctx, false);
  return withPathLock(key, async () => {
    const { buf, id } = await readConfined(p, max, croots);
    const { text, result } = await produce(buf);
    await writeLocked(p, text, ctx, croots, id);
    return result;
  });
}

/** A path for output: relative to the cwd, POSIX separators (deterministic on every platform). */
export const shownPath = (cwd: string, p: string): string => (path.relative(cwd, p) || '.').split(path.sep).join('/');
