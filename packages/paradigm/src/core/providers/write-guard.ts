/**
 * #write-guard — what an API-run agent's write_file may not touch.
 *
 * Part of ^command-execution-consent. Confining writes to the working
 * directory is not enough: a file such as .git/config (core.fsmonitor,
 * core.hooksPath), .git/hooks/*, .husky/*, .vscode/tasks.json or .envrc runs
 * a command the next time git, an editor, a hook or a shell touches the repo.
 * Without this list, write_file would give the model shell access while
 * run_command is OFF or before the user has been asked. Once the user turns
 * run_command ON, this list bounds nothing: a command can write these files
 * itself.
 *
 * A path is checked twice, as requested (lexically) and as resolved (realpath
 * of the longest existing prefix), and refused if either matches. Segments are
 * compared NFC-normalised, lowercased, with trailing dots and spaces removed,
 * so `.GIT`, `.git.` and `.git ` all match `.git`. A segment containing `:`
 * (NTFS streams, `.git::$INDEX_ALLOCATION`), a missing segment shaped like an
 * 8.3 short name (`GIT~1`), or one that is empty after stripping, is refused.
 * An existing target that is a symlink or has more than one hard link is
 * refused, and the final open uses O_NOFOLLOW.
 */

import * as fs from 'fs';
import * as path from 'path';
import { resolveContained } from '../../utils/path-containment.js';

/** Refused at any depth. */
const ANY_DEPTH = new Set(['.git', '.hg', '.svn']);

/** Refused, with everything under them, at the root of the working directory. */
const ROOT_DIRS = new Set([
  '.claude', '.cursor', '.vscode', '.idea', '.devcontainer',
  '.husky', '.githooks', '.lefthook',
  '.github', '.circleci', '.buildkite',
  // Agents change Paradigm state through Paradigm tools, never raw writes.
  '.paradigm',
]);

/** Refused as files at the root of the working directory. */
const ROOT_FILES = new Set([
  '.mcp.json',
  '.pre-commit-config.yaml', 'lefthook.yml', 'lefthook.yaml', '.lefthook.yml', '.lefthook.yaml',
  '.gitlab-ci.yml', 'azure-pipelines.yml', 'jenkinsfile',
  '.envrc', '.mise.toml', 'mise.toml', '.npmrc', '.yarnrc', '.yarnrc.yml',
]);

/** Allowed at the root, but listed in the run summary for the user to review. */
const REVIEW_FILES = new Set(['portal.yaml', 'claude.md', '.gitmodules', '.gitattributes']);

/** package.json scripts npm runs on install or pack; adding or changing one is refused. */
export const INSTALL_SCRIPTS = [
  'preinstall', 'install', 'postinstall', 'prepare',
  'prepublish', 'prepublishOnly', 'prepack', 'postpack',
];

export type WriteVerdict =
  | { ok: true; real: string; review?: string }
  | { ok: false; reason: string };

export interface WriteGuardOptions {
  /** Absolute trees that are never written (e.g. ~/.paradigm, ~/.claude, the command log). */
  deniedAbsolute?: string[];
}

export function normaliseSegment(segment: string): string {
  return segment.normalize('NFC').toLowerCase().replace(/[. ]+$/, '');
}

function refuse(requested: unknown, why: string): WriteVerdict {
  return { ok: false, reason: `write_file refused for ${JSON.stringify(requested)}: ${why}` };
}

function lexists(p: string): boolean {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

function realOrResolved(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

function within(parent: string, p: string): boolean {
  const rel = path.relative(parent, p);
  return rel === '' || !(rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel));
}

/** Checks one relative path's segments. Returns a reason, or null when allowed. */
function segmentProblem(base: string, rel: string): string | null {
  const raw = rel.split(/[\\/]+/).filter((s) => s !== '');
  if (raw.length === 0) return 'not a file path';
  const segs: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i].includes(':')) return 'a path segment contains ":"';
    const n = normaliseSegment(raw[i]);
    if (n === '') return 'a path segment is empty after removing trailing dots and spaces';
    if (/~\d+$/.test(n) && !lexists(path.join(base, ...raw.slice(0, i + 1)))) {
      return 'a new path segment looks like an 8.3 short name';
    }
    segs.push(n);
  }
  const hit = segs.find((s) => ANY_DEPTH.has(s));
  if (hit) return `${hit} is version-control state; writing it can run commands`;
  if (segs.length > 1 && ROOT_DIRS.has(segs[0])) return `${segs[0]}/ is protected (editor, hook, CI or Paradigm configuration)`;
  if (ROOT_DIRS.has(segs[0])) return `${segs[0]} is protected`;
  if (segs.length === 1 && ROOT_FILES.has(segs[0])) return `${segs[0]} is protected (it can run commands)`;
  return null;
}

/** gitdir named by a `.git` file at the root (`gitdir: <path>`), if any. */
function rootGitdirRedirect(rootReal: string): string | null {
  try {
    const dotGit = path.join(rootReal, '.git');
    if (!fs.lstatSync(dotGit).isFile()) return null;
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(dotGit, 'utf-8'));
    return m ? realOrResolved(path.resolve(rootReal, m[1])) : null;
  } catch {
    return null;
  }
}

function packageJsonProblem(real: string, content: string): { reason?: string; review: string } {
  let next: { scripts?: Record<string, unknown> };
  try {
    next = JSON.parse(content);
  } catch {
    return { review: 'package.json (written, not valid JSON)' };
  }
  let prev: { scripts?: Record<string, unknown> } = {};
  try {
    prev = JSON.parse(fs.readFileSync(real, 'utf-8'));
  } catch {
    // New file, or unreadable: every install script counts as added.
  }
  const changed = INSTALL_SCRIPTS.filter(
    (k) => JSON.stringify(next?.scripts?.[k]) !== JSON.stringify(prev?.scripts?.[k]),
  );
  if (changed.length > 0) {
    return { reason: `it adds or changes install-time scripts (${changed.join(', ')})`, review: '' };
  }
  return { review: 'package.json (edited; install scripts unchanged)' };
}

/** Decide whether write_file may write `requested` with `content`. Never writes. */
export function checkWrite(
  root: string,
  requested: unknown,
  content: string,
  opts: WriteGuardOptions = {},
): WriteVerdict {
  if (typeof requested !== 'string') return refuse(requested, 'path must be a string');
  const real = resolveContained(root, requested, { allowMissing: true });
  if (!real) return refuse(requested, 'it is outside the working directory (or a symlink leads out)');

  const lexRoot = path.resolve(root);
  const lexical = path.resolve(lexRoot, requested);
  const rootReal = fs.realpathSync.native(root);

  for (const [base, target] of [[lexRoot, lexical], [rootReal, real]] as const) {
    const problem = segmentProblem(base, path.relative(base, target));
    if (problem) return refuse(requested, problem);
  }

  for (const target of [lexical, real]) {
    try {
      const st = fs.lstatSync(target);
      if (st.isSymbolicLink()) return refuse(requested, 'the existing file is a symlink');
      if (st.nlink > 1) return refuse(requested, 'the existing file has more than one hard link');
      if (!st.isFile()) return refuse(requested, 'the existing path is not a regular file');
    } catch {
      // Does not exist yet.
    }
  }

  const denied = [...(opts.deniedAbsolute ?? [])];
  const redirect = rootGitdirRedirect(rootReal);
  if (redirect) denied.push(redirect);
  for (const d of denied) {
    const dReal = realOrResolved(d);
    if (within(dReal, real) || within(path.resolve(d), lexical)) {
      return refuse(requested, 'it is in a protected location');
    }
  }

  const relSegs = path.relative(rootReal, real).split(/[\\/]+/).map(normaliseSegment);
  const last = relSegs[relSegs.length - 1];
  if (last === 'package.json') {
    const pj = packageJsonProblem(real, content);
    if (pj.reason) return refuse(requested, pj.reason);
    return { ok: true, real, review: path.relative(rootReal, real) === 'package.json' ? pj.review : `${path.relative(rootReal, real)}: ${pj.review}` };
  }
  if (relSegs.length === 1 && REVIEW_FILES.has(last)) {
    return { ok: true, real, review: path.relative(rootReal, real) };
  }
  return { ok: true, real };
}

/**
 * Write a file checkWrite allowed: create parents, open with O_NOFOLLOW (no
 * truncation until the file is confirmed to be a regular file with one link),
 * then replace its content.
 */
export function writeChecked(real: string, content: string): void {
  fs.mkdirSync(path.dirname(real), { recursive: true });
  const { O_WRONLY, O_CREAT } = fs.constants;
  const O_NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;
  const fd = fs.openSync(real, O_WRONLY | O_CREAT | O_NOFOLLOW, 0o644);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.nlink > 1) {
      throw new Error('write_file refused: the target is not a regular file with a single link');
    }
    fs.ftruncateSync(fd, 0);
    fs.writeSync(fd, content);
  } finally {
    fs.closeSync(fd);
  }
}
