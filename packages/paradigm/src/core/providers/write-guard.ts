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
 * folded the way case-insensitive filesystems compare names (NFKC, full case
 * folding, NFC, trailing dots and spaces removed), so `.GIT`, `.git.`, `.git `
 * and `.v\u017Fcode` match. A segment containing `:` (NTFS streams), an
 * invisible default-ignorable character (HFS+ ignores them, CVE-2014-9390), a
 * missing segment shaped like an 8.3 short name (`GIT~1`), or one that is
 * empty after stripping, is refused. Editor, hook, env and Paradigm names
 * count at any depth; CI names only at the root. A write that would leave a
 * folder shaped like a bare repository is refused. An existing target that is
 * a symlink or has more than one hard link is refused, and the final open uses
 * O_NOFOLLOW.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { resolveContained } from '../../utils/path-containment.js';

/** Version-control state: refused at any depth. */
const VCS_DIRS = new Set(['.git', '.hg', '.svn']);

/** Folders refused, with everything under them, at any depth (editor, hook and Paradigm configuration). */
const ANY_DEPTH_DIRS = new Set([
  '.claude', '.cursor', '.vscode', '.idea', '.devcontainer',
  '.husky', '.githooks', '.lefthook',
  // Agents change Paradigm state through Paradigm tools, never raw writes.
  '.paradigm',
]);

/** Files refused at any depth (they run commands, or point tools at commands). */
const ANY_DEPTH_FILES = new Set([
  '.mcp.json', '.envrc', '.npmrc', '.yarnrc', '.yarnrc.yml', '.mise.toml', 'mise.toml',
  'lefthook.yml', 'lefthook.yaml', '.lefthook.yml', '.lefthook.yaml',
  '.pre-commit-config.yaml', '.pnpmfile.cjs', 'bunfig.toml',
]);

/** CI folders refused at the root of the working directory only. */
const ROOT_DIRS = new Set(['.github', '.circleci', '.buildkite']);

/** CI files refused at the root of the working directory only. */
const ROOT_FILES = new Set(['.gitlab-ci.yml', 'azure-pipelines.yml', 'jenkinsfile']);

/** Allowed at the root, but listed in the run summary for the user to review. */
const REVIEW_FILES = new Set(['portal.yaml', 'claude.md', '.gitmodules', '.gitattributes']);

/** Package manifests whose install-time scripts are checked. */
const MANIFESTS = new Set(['package.json', 'package.yaml', 'package.json5']);

/** Manifest scripts a package manager runs on install or pack; adding or changing one is refused. */
export const INSTALL_SCRIPTS = [
  'preinstall', 'install', 'postinstall',
  'preprepare', 'prepare', 'postprepare',
  'prepublish', 'prepublishOnly', 'prepack', 'postpack',
  'dependencies', 'pnpm:devPreinstall',
];

/** Names that make a folder look like a bare repository to git. */
const BARE_HEAD = 'head';

export type WriteVerdict =
  | { ok: true; real: string; review?: string }
  | { ok: false; reason: string };

export interface WriteGuardOptions {
  /** Absolute trees that are never written (e.g. ~/.paradigm, ~/.claude, the command log). */
  deniedAbsolute?: string[];
}

/**
 * Fold a name the way case-insensitive filesystems compare it: NFKC, full
 * case folding (upper then lower, so U+017F long s becomes s), NFC, then
 * trailing dots and spaces removed (Windows drops them).
 */
export function normaliseSegment(segment: string): string {
  return segment.normalize('NFKC').toUpperCase().toLowerCase().normalize('NFC').replace(/[. ]+$/, '');
}

/** HFS+ ignores these when comparing names (git CVE-2014-9390), so they are refused outright. */
const IGNORABLE = /\p{Default_Ignorable_Code_Point}/u;

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
    if (IGNORABLE.test(raw[i])) return 'a path segment contains an invisible (default-ignorable) character';
    const n = normaliseSegment(raw[i]);
    if (n === '') return 'a path segment is empty after removing trailing dots and spaces';
    if (/~\d+$/.test(n) && !lexists(path.join(base, ...raw.slice(0, i + 1)))) {
      return 'a new path segment looks like an 8.3 short name';
    }
    segs.push(n);
  }
  const vcs = segs.find((s) => VCS_DIRS.has(s));
  if (vcs) return `${vcs} is version-control state; writing it can run commands`;
  const dir = segs.find((s) => ANY_DEPTH_DIRS.has(s));
  if (dir) return `${dir} is protected at any depth (editor, hook or Paradigm configuration)`;
  const last = segs[segs.length - 1];
  if (ANY_DEPTH_FILES.has(last)) return `${last} is protected at any depth (it can run commands)`;
  if (ROOT_DIRS.has(segs[0])) return `${segs[0]} is protected (CI configuration)`;
  if (segs.length === 1 && ROOT_FILES.has(segs[0])) return `${segs[0]} is protected (CI configuration)`;
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

type Manifest = { scripts?: Record<string, unknown> } | null | undefined;

/** Parse a manifest. package.json5 must be plain JSON so its scripts can be checked. */
function parseManifest(kind: string, text: string): Manifest {
  if (kind === 'package.yaml') return yaml.load(text) as Manifest;
  return JSON.parse(text) as Manifest;
}

function manifestProblem(kind: string, real: string, content: string): { reason?: string; review: string } {
  let next: Manifest;
  try {
    next = parseManifest(kind, content);
  } catch {
    if (kind === 'package.json') return { review: 'package.json (written, not valid JSON)' };
    return { reason: `its install-time scripts can't be checked (${kind} must parse as ${kind === 'package.yaml' ? 'YAML' : 'plain JSON'})`, review: '' };
  }
  let prev: Manifest = {};
  try {
    prev = parseManifest(kind, fs.readFileSync(real, 'utf-8'));
  } catch {
    // New file, or unreadable: every install script counts as added.
  }
  const scriptsOf = (m: Manifest): Record<string, unknown> =>
    m && typeof m === 'object' && m.scripts && typeof m.scripts === 'object' ? m.scripts : {};
  const changed = INSTALL_SCRIPTS.filter(
    (k) => JSON.stringify(scriptsOf(next)[k]) !== JSON.stringify(scriptsOf(prev)[k]),
  );
  if (changed.length > 0) {
    return { reason: `it adds or changes install-time scripts (${changed.join(', ')})`, review: '' };
  }
  return { review: `${kind} (edited; install scripts unchanged)` };
}

/**
 * Would this write leave some folder looking like a bare repository (a HEAD
 * file plus objects/ and refs/, or a HEAD file plus a commondir or gitdir
 * file)? git treats such a folder as a repository, and its config can run
 * commands. Checks the folder the first new entry is created in, every folder
 * mkdir -p would create, and the target's parent, as they would be after the
 * write. Names are compared folded.
 */
function bareRepoProblem(real: string): string | null {
  // Folders from the deepest existing ancestor down to the target's parent.
  const chain: string[] = [];
  let dir = path.dirname(real);
  const missing: string[] = [];
  while (!lexists(dir)) {
    missing.unshift(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  chain.push(dir, ...missing);

  for (let i = 0; i < chain.length; i++) {
    const folder = chain[i];
    const files = new Set<string>();
    const dirs = new Set<string>();
    try {
      for (const e of fs.readdirSync(folder, { withFileTypes: true })) {
        const n = normaliseSegment(e.name);
        if (e.isDirectory()) dirs.add(n);
        else files.add(n);
      }
    } catch {
      // Created by this write: starts empty.
    }
    // The entry this write adds here: the next folder down, or the file itself.
    const child = i + 1 < chain.length ? chain[i + 1] : real;
    const childName = normaliseSegment(path.basename(child));
    if (child === real) files.add(childName);
    else dirs.add(childName);

    if (files.has(BARE_HEAD) && ((dirs.has('objects') && dirs.has('refs')) || files.has('commondir') || files.has('gitdir'))) {
      return `it would make ${folder} look like a bare repository (HEAD with objects/ and refs/, or with commondir/gitdir)`;
    }
  }
  return null;
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

  const bare = bareRepoProblem(real);
  if (bare) return refuse(requested, bare);

  const relSegs = path.relative(rootReal, real).split(/[\\/]+/).map(normaliseSegment);
  const last = relSegs[relSegs.length - 1];
  if (MANIFESTS.has(last)) {
    const pj = manifestProblem(last, real, content);
    if (pj.reason) return refuse(requested, pj.reason);
    const rel = path.relative(rootReal, real);
    return { ok: true, real, review: relSegs.length === 1 ? pj.review : `${rel}: ${pj.review}` };
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
