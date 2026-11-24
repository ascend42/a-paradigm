/**
 * #project-files: one list of a project's files per run.
 *
 * Whole-tree directory walks were the main cost of the Stop hook's compliance
 * pass and of `paradigm doctor`: a repository's generated state (`.warpline/`
 * objects, Swift `.build/` trees, agent worktrees under `.claude/worktrees/`)
 * can hold tens of thousands of entries that no check wants to read.
 *
 * Inside a git work tree the list comes from `git ls-files` (tracked files that
 * still exist plus untracked files that are not ignored). That takes
 * milliseconds, never descends into a nested repository or worktree, and leaves
 * out gitignored files. Outside git, when git is missing, fails or takes too
 * long, or when the ignore rules hide gate files as such, it falls back to a
 * directory walk. Both modes leave out the same heavy trees by name
 * (PRUNE_DIRS) and agent worktrees, and the list records why the walk was used.
 *
 * Paths are relative to the root and use forward slashes on every OS.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

/** Why the directory walk was used instead of git. */
export type WalkReason =
  /** The root is not inside a git work tree: the normal case for a project without git. */
  | 'not-a-git-repo'
  /** git is not installed or not on PATH. */
  | 'git-missing'
  /** git did not answer within GIT_TIMEOUT_MS. */
  | 'git-timeout'
  /** git exited with an error other than "not a git repository". */
  | 'git-failed'
  /** git listed no files: the root is wholly ignored by an enclosing repository, or empty. */
  | 'no-files-listed'
  /**
   * The ignore rules match `.purpose` or `portal.yaml` by name at the root (a broad
   * pattern such as `.*` or `*.yaml`, a global excludes file, or an enclosing
   * repository that ignores the project). A new gate file would be invisible to
   * git, so the walk reads the tree instead.
   */
  | 'gate-files-ignored';

export interface ProjectFileList {
  /** Absolute root the list was taken from. */
  root: string;
  /** Where the list came from. */
  source: 'git' | 'walk';
  /** Root-relative file paths, forward slashes, no leading "./". Sorted. */
  files: string[];
  /** Set when source is 'walk': why git was not used. */
  fallbackReason?: WalkReason;
  /** git mode only: untracked, not-ignored entries git reported, counted before pruning. */
  untrackedCount?: number;
}

/**
 * Directory names left out of the list in BOTH modes: dependency trees, git
 * internals, and generated state that is large and never holds project files.
 * The walk does not descend into them; the git list drops entries under them
 * even when they are tracked or not ignored.
 */
export const PRUNE_DIRS: readonly string[] = Object.freeze([
  'node_modules',
  '.git',
  '.warpline', // Warpline ledger objects and states
  '.build', // Swift package build trees
  '.loom',
]);

/** @deprecated name kept for callers: the same list now applies to both modes. */
export const WALK_PRUNE_DIRS = PRUNE_DIRS;

const PRUNE_SET: ReadonlySet<string> = new Set(PRUNE_DIRS);

/** Agent worktrees: full copies of the repository, never the project's own files. */
const WORKTREES_PREFIX = '.claude/worktrees/';

/**
 * How long git may take. The Stop hook is killed at 30 s; git must give up well
 * before that so the walk still has time to run and the check still enforces.
 */
export const GIT_TIMEOUT_MS = 5_000;

/**
 * Paths probed with `git check-ignore`: the two gate file names at the root and
 * one level down. A match means the rules ignore gate files by name, not a
 * particular directory.
 */
const IGNORE_PROBE_DIR = 'paradigm-ignore-probe';
const IGNORE_PROBES: readonly string[] = Object.freeze([
  '.purpose',
  'portal.yaml',
  `${IGNORE_PROBE_DIR}/.purpose`,
  `${IGNORE_PROBE_DIR}/portal.yaml`,
]);

/** Convert an OS path to the forward-slash form used throughout this module. */
export function toPosixPath(p: string): string {
  return path.sep === '\\' ? p.split('\\').join('/') : p;
}

/**
 * True when any directory segment of a root-relative path is in `names`. The
 * file name itself is not a directory segment and is never matched.
 */
export function hasDirSegment(rel: string, names: ReadonlySet<string>): boolean {
  let start = 0;
  for (;;) {
    const slash = rel.indexOf('/', start);
    if (slash === -1) return false;
    if (names.has(rel.slice(start, slash))) return true;
    start = slash + 1;
  }
}

interface GitAnswer {
  files: string[] | null;
  reason?: WalkReason;
  untrackedCount?: number;
}

function gitEnv(): NodeJS.ProcessEnv {
  // An inherited GIT_DIR / GIT_WORK_TREE (set while a git hook runs) would point
  // git at the wrong repository; the list must describe rootDir.
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'GIT_DIR' || key === 'GIT_WORK_TREE' || key === 'GIT_INDEX_FILE' || key === 'GIT_PREFIX') delete env[key];
  }
  // Untranslated messages, so "not a git repository" can be told from a real failure
  env.LC_ALL = 'C';
  return env;
}

function classifyGitError(err: unknown): WalkReason {
  const e = err as { code?: string; signal?: string | null; killed?: boolean; stderr?: unknown };
  if (e.code === 'ENOENT') return 'git-missing';
  if (e.code === 'ETIMEDOUT' || e.killed || e.signal === 'SIGTERM') return 'git-timeout';
  if (/not a git repository/i.test(String(e.stderr ?? ''))) return 'not-a-git-repo';
  return 'git-failed';
}

function gitList(rootDir: string): GitAnswer {
  const options = {
    cwd: rootDir,
    encoding: 'utf-8' as const,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'],
    timeout: GIT_TIMEOUT_MS,
    env: gitEnv(),
  };

  // 1. Would git hide a gate file by name? check-ignore exits 0 when any probe is
  //    ignored, 1 when none is. --no-index asks about the patterns alone, so a
  //    tracked root .purpose does not mask a pattern that hides new ones.
  try {
    execFileSync('git', ['check-ignore', '--no-index', '--', ...IGNORE_PROBES], options);
    return { files: null, reason: 'gate-files-ignored' };
  } catch (err) {
    if ((err as { status?: number | null }).status !== 1) return { files: null, reason: classifyGitError(err) };
  }

  // 2. The list. -t tags each entry ("H" tracked, "S" tracked with skip-worktree,
  //    "?" untracked, "R" tracked but deleted from disk); -d adds the deleted ones;
  //    -s adds the mode, which tells a gitlink (160000: a submodule directory, not a
  //    file) from a file. One spawn.
  let stdout: string;
  try {
    stdout = execFileSync('git', ['ls-files', '-c', '-o', '-d', '-t', '-s', '--exclude-standard', '-z'], options);
  } catch (err) {
    return { files: null, reason: classifyGitError(err) };
  }
  const seen = new Set<string>();
  // Every untracked, not-ignored entry git lists, before any pruning: what a plain
  // `git ls-files -o --exclude-standard` prints (doctor's untracked-tree trait).
  let untrackedCount = 0;
  const deleted: string[] = [];
  for (const tagged of stdout.split('\0')) {
    if (tagged.length < 3) continue;
    const tag = tagged[0];
    let entry = tagged.slice(2);
    if (tag === '?') untrackedCount++;
    if (tag !== '?') {
      // "<mode> <object> <stage>\t<path>"
      const tab = entry.indexOf('\t');
      if (tab === -1) continue;
      const mode = entry.slice(0, 6);
      entry = entry.slice(tab + 1);
      if (mode === '160000') continue;
    }
    if (tag === 'R') {
      deleted.push(entry);
      continue;
    }
    // "dir/" is an untracked nested repository: git does not list its files
    if (entry.endsWith('/')) continue;
    if (entry.startsWith(WORKTREES_PREFIX)) continue;
    if (hasDirSegment(entry, PRUNE_SET)) continue;
    // skip-worktree (sparse checkout): listed whether or not the file is on disk
    if (tag === 'S' && !fs.existsSync(path.join(rootDir, ...entry.split('/')))) continue;
    seen.add(entry);
  }
  for (const entry of deleted) seen.delete(entry);
  return { files: [...seen].sort(), untrackedCount };
}

function walkList(rootDir: string): string[] {
  const files: string[] = [];
  const walk = (dir: string, rel: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (PRUNE_SET.has(entry.name)) continue;
        if (`${childRel}/` === WORKTREES_PREFIX) continue;
        walk(path.join(dir, entry.name), childRel);
      } else {
        files.push(childRel);
      }
    }
  };
  walk(rootDir, '');
  return files.sort();
}

/**
 * List the project's files once. Callers filter the result (by name, extension
 * or their own skip list) instead of walking the tree again.
 *
 * Every listed file existed when the list was taken (a tracked file deleted
 * from disk, a sparse-checkout entry that is not on disk and a submodule link
 * are left out), and the list is sorted. When the walk was used, fallbackReason
 * says why.
 */
export function listProjectFiles(rootDir: string): ProjectFileList {
  const root = path.resolve(rootDir);
  const answer = gitList(root);
  if (answer.files && answer.files.length > 0) {
    return { root, source: 'git', files: answer.files, untrackedCount: answer.untrackedCount ?? 0 };
  }
  // An empty answer is what git gives for a directory that is wholly ignored by
  // an enclosing repository; walk it so such a project still sees its own files.
  return { root, source: 'walk', files: walkList(root), fallbackReason: answer.reason ?? 'no-files-listed' };
}

/** One line for people: where a list came from, and why when it was the walk. */
export function describeFileListSource(list: ProjectFileList): string {
  if (list.source === 'git') return `git (${list.files.length} files)`;
  const why: Record<WalkReason, string> = {
    'not-a-git-repo': 'not a git repository',
    'git-missing': 'git was not found',
    'git-timeout': `git did not answer within ${GIT_TIMEOUT_MS / 1000} s`,
    'git-failed': 'git failed',
    'no-files-listed': 'git listed no files (the project may be ignored by an enclosing repository)',
    'gate-files-ignored': 'the git ignore rules match .purpose or portal.yaml by name, so git would hide new gate files',
  };
  return `directory walk (${list.files.length} files): ${why[list.fallbackReason ?? 'no-files-listed']}`;
}
