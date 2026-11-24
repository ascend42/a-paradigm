/**
 * #project-files: one list of a project's files per run.
 *
 * Whole-tree directory walks were the main cost of the Stop hook's compliance
 * pass and of `paradigm doctor`: a repository's generated state (`.warpline/`
 * objects, Swift `.build/` trees, agent worktrees under `.claude/worktrees/`)
 * can hold tens of thousands of entries that no check wants to read.
 *
 * Inside a git work tree the list comes from `git ls-files -co --exclude-standard`
 * (tracked files that still exist plus untracked files that are not ignored). That takes
 * milliseconds, never descends into a nested repository or worktree, and leaves
 * out gitignored files. Outside git (or when git is missing or fails) it falls
 * back to a directory walk that prunes the heavy trees by name.
 *
 * Paths are relative to the root and use forward slashes on every OS.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

export interface ProjectFileList {
  /** Absolute root the list was taken from. */
  root: string;
  /** Where the list came from. */
  source: 'git' | 'walk';
  /** Root-relative file paths, forward slashes, no leading "./". */
  files: string[];
}

/**
 * Directory names the non-git walk never descends into: dependency trees, git
 * internals, and generated state that is large and never holds project files.
 */
export const WALK_PRUNE_DIRS: readonly string[] = Object.freeze([
  'node_modules',
  '.git',
  '.warpline', // Warpline ledger objects and states
  '.build', // Swift package build trees
  '.loom',
]);

/** Agent worktrees: full copies of the repository, never the project's own files. */
const WORKTREES_PREFIX = '.claude/worktrees/';

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

function gitList(rootDir: string): string[] | null {
  // An inherited GIT_DIR / GIT_WORK_TREE (set while a git hook runs) would point
  // git at the wrong repository; the list must describe rootDir.
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'GIT_DIR' || key === 'GIT_WORK_TREE' || key === 'GIT_INDEX_FILE' || key === 'GIT_PREFIX') delete env[key];
  }
  try {
    // -t tags each entry ("H " tracked, "? " untracked, "R " tracked but deleted from disk);
    // -d adds the deleted ones, so the list holds only files that exist. One spawn.
    const stdout = execFileSync('git', ['ls-files', '-c', '-o', '-d', '-t', '--exclude-standard', '-z'], {
      cwd: rootDir,
      encoding: 'utf-8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 30_000,
      env,
    });
    const seen = new Set<string>();
    const deleted: string[] = [];
    for (const tagged of stdout.split('\0')) {
      if (tagged.length < 3) continue;
      const entry = tagged.slice(2);
      if (tagged[0] === 'R') {
        deleted.push(entry);
        continue;
      }
      // "dir/" is an untracked nested repository: git does not list its files
      if (entry.endsWith('/')) continue;
      if (entry.startsWith(WORKTREES_PREFIX)) continue;
      seen.add(entry);
    }
    for (const entry of deleted) seen.delete(entry);
    return [...seen].sort();
  } catch {
    // Not a git work tree, git missing, or git failed
    return null;
  }
}

function walkList(rootDir: string): string[] {
  const prune = new Set(WALK_PRUNE_DIRS);
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
        if (prune.has(entry.name)) continue;
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
 * from disk is left out), and the list is sorted.
 */
export function listProjectFiles(rootDir: string): ProjectFileList {
  const root = path.resolve(rootDir);
  const fromGit = gitList(root);
  // An empty answer is what git gives for a directory that is wholly ignored by
  // an enclosing repository; walk it so such a project still sees its own files.
  if (fromGit && fromGit.length > 0) return { root, source: 'git', files: fromGit };
  return { root, source: 'walk', files: walkList(root) };
}
