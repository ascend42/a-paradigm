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
 *   - confinedFile: the per-file check the grep walk uses (realpath inside the
 *     pre-canonicalised roots, a regular file, one hard link) — the same rule
 *     as resolveRead, without re-canonicalising the roots for every file;
 *   - writeConfined: write_file's open/re-check/write sequence, shared with
 *     `edit` (parent re-checked inside the roots after mkdir, O_NOFOLLOW, the
 *     hard-link check on the open handle before any byte changes).
 */
import { constants, promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { PROTECTED_PREFIX, ProtectedRefused, protectedHit } from './protect.js';
import type { SpillStore } from './shape.js';

export interface ToolResult {
  content: string;
  isError: boolean;
  /**
   * Slice B1: the result carries text from a file the model itself wrote in this session (write_file/edit), so
   * shaping labels it `source="model-generated" trust="data-not-instructions"` and escapes `<`. Absent = not.
   */
  modelSource?: true;
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
  /** Slice B1: realpaths the model wrote this session (write_file, edit add; reads of them are model-sourced) */
  written?: Set<string>;
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

/** A read target: must exist; its realpath lies inside a root. */
export async function resolveRead(raw: string, ctx: ToolContext): Promise<string> {
  const real = await fsp.realpath(path.resolve(ctx.cwd, raw));
  if (!inside(real, await canonRoots(ctx.roots))) throw new PathRefused(`path is outside the session roots: ${raw.slice(0, 200)}`);
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

/**
 * Write `content` to a target resolveWrite returned: mkdir the parent, re-check the parent inside the roots (a racing
 * symlink), open without following a final symlink and WITHOUT O_TRUNC, refuse a hard link on the open handle, then
 * truncate and write. Records the target in ctx.written (its reads are model-sourced from now on).
 */
export async function writeConfined(p: string, content: string, ctx: ToolContext): Promise<void> {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  if (!inside(await fsp.realpath(path.dirname(p)), await canonRoots(ctx.roots))) throw new PathRefused('the parent moved outside the session roots');
  const fh = await fsp.open(p, constants.O_WRONLY | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0), 0o644);
  try {
    if ((await fh.stat()).nlink > 1) throw new PathRefused('a file with more than one hard link is refused');
    await fh.truncate(0);
    await fh.writeFile(content);
  } finally {
    await fh.close();
  }
  ctx.written?.add(await fsp.realpath(p).catch(() => p));
}

/** Read a confined regular file (a realpath from resolveRead/resolveWrite) whole, at most `max` bytes, O_NOFOLLOW. */
export async function readConfined(real: string, max: number): Promise<Buffer> {
  const fh = await fsp.open(real, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const st = await fh.stat();
    if (!st.isFile()) throw new PathRefused('not a regular file');
    if (st.nlink > 1) throw new PathRefused('a file with more than one hard link is refused');
    if (st.size > max) throw new PathRefused(`the file is ${st.size} bytes (over the ${max}-byte limit of this tool)`);
    const buf = Buffer.alloc(st.size);
    const { bytesRead } = await fh.read(buf, 0, st.size, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/** A path for output: relative to the cwd, POSIX separators (deterministic on every platform). */
export const shownPath = (cwd: string, p: string): string => (path.relative(cwd, p) || '.').split(path.sep).join('/');
