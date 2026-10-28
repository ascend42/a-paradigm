/**
 * repoIdOf — the stable id a repository's user-home and machine-home learning
 * stores are keyed by (scoped learning S0/S2, TD-2026-10-28-820).
 *
 *   1. `.gnomon/project.yaml` `repoId:` when present (gnomon's regex), read
 *      from the root, else from the same folder of the main checkout;
 *   2. else `path:` + the first 16 hex chars of sha256 of the realpath of the
 *      MAIN CHECKOUT (S2): `git rev-parse --path-format=absolute
 *      --git-common-dir`, whose parent is the main checkout; git older than
 *      2.31 prints the relative form. A project in a subfolder keeps its
 *      prefix (`<main>/<show-prefix>`), so two projects in one repository
 *      never share an id. Every linked worktree therefore shares its main
 *      checkout's id. Outside git (or a bare / submodule layout) the realpath
 *      of the root itself is hashed.
 *
 * NEVER the root commit: template repositories and forks share one, so two
 * unrelated clones would pool their learning.
 *
 * PARITY with gnomon's `repoIdOf` (packages/gnomon/src/kernel/supervisor/
 * local-session.ts): for a plain checkout (not a linked worktree) the two give
 * the same id, because realpath(main checkout)/prefix is realpath(root).
 * Gnomon does not resolve worktrees yet and plans a root-commit fallback
 * (local-session.ts:536); paradigm deliberately does not follow it (see the
 * S2 PR note for the Gnomon owner). paradigm and paradigm-mcp pin a published
 * @a-company/gnomon that does not export it, so the algorithm is copied and
 * the parity test fails if the plain-checkout behaviour drifts.
 */

import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const GNOMON_REPO_ID = /^repoId:\s*['"]?([A-Za-z0-9._:/-]{1,128})['"]?\s*$/m;

/** The project a repository's learning is recorded under. Never throws. */
export function repoIdOf(root: string): string {
  return resolveRepoId(root).id;
}

function realOr(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/** Main-checkout lookups, per resolved root, for the life of the process. */
const _mainCheckoutCache = new Map<string, string | null>();

/** Test hook: forget cached git lookups (a test that moves or re-inits a repo). */
export function resetRepoIdCache(): void {
  _mainCheckoutCache.clear();
}

/** git rev-parse in `cwd`, with any inherited GIT_DIR / GIT_WORK_TREE dropped (git hooks set them). */
function revParse(cwd: string, args: string[]): string | null {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_PREFIX;
  try {
    return execFileSync('git', ['rev-parse', ...args], {
      cwd,
      env,
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: false,
    });
  } catch {
    return null;
  }
}

/**
 * The folder in the MAIN checkout that corresponds to `root`: realpath of the
 * main checkout plus the root's prefix inside its repository. Null outside
 * git, or when the common dir is not `<main>/.git` (bare repo, submodule).
 */
export function mainCheckoutPathOf(root: string): string | null {
  const r = path.resolve(root);
  if (_mainCheckoutCache.has(r)) return _mainCheckoutCache.get(r)!;
  let out = revParse(r, ['--path-format=absolute', '--git-common-dir', '--show-prefix']);
  if (out === null) out = revParse(r, ['--git-common-dir', '--show-prefix']);
  let result: string | null = null;
  if (out !== null) {
    let lines = out.split(/\r?\n/);
    // git < 2.31 echoes the unknown --path-format=absolute back as its first line.
    if (lines[0]?.startsWith('--')) lines = lines.slice(1);
    const commonRaw = (lines[0] ?? '').trim();
    const prefix = (lines[1] ?? '').trim().replace(/\/+$/, '');
    if (commonRaw) {
      const common = path.resolve(r, commonRaw);
      if (path.basename(common) === '.git') {
        const main = realOr(path.dirname(common));
        result = prefix ? path.join(main, ...prefix.split('/')) : main;
      }
    }
  }
  _mainCheckoutCache.set(r, result);
  return result;
}

function readGnomonRepoId(dir: string): string | null {
  try {
    const m = GNOMON_REPO_ID.exec(fs.readFileSync(path.join(dir, '.gnomon', 'project.yaml'), 'utf8'));
    return m ? m[1]! : null;
  } catch {
    return null;
  }
}

/** repoIdOf plus where the id came from (gnomon project.yaml, or the path hash). */
function resolveRepoId(root: string): { id: string; source: 'gnomon' | 'hash' } {
  const own = readGnomonRepoId(root);
  if (own) return { id: own, source: 'gnomon' };
  const main = mainCheckoutPathOf(root);
  if (main) {
    const fromMain = readGnomonRepoId(main);
    if (fromMain) return { id: fromMain, source: 'gnomon' };
  }
  const real = main ?? realOr(root);
  return { id: `path:${createHash('sha256').update(real).digest('hex').slice(0, 16)}`, source: 'hash' };
}

/**
 * The repo id as one filesystem-safe path segment, prefixed by its source so
 * two sources can never collide (review F7):
 *   `h-<16 hex>`  — the path-hash fallback
 *   `g-<id>`      — a gnomon project.yaml repoId; when sanitising changed it
 *                   (Windows forbids `:`, ids may hold `/`), `-<8 hex>` of the
 *                   raw id is appended so `a/b` and `a-b` stay distinct.
 */
export function repoIdSegment(root: string): string {
  const { id, source } = resolveRepoId(root);
  if (source === 'hash') return `h-${id.slice('path:'.length)}`;
  const safe = id.replace(/[^A-Za-z0-9._-]/g, '-');
  return safe === id ? `g-${id}` : `g-${safe}-${createHash('sha256').update(id).digest('hex').slice(0, 8)}`;
}
