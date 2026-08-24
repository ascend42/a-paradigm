/**
 * #lens-walk — the SHARED source-enumeration walk behind every code lens.
 *
 * WHY THIS EXISTS. Each lens used to carry its own hardcoded `SKIP_DIRS`
 * denylist and its own copy of the walk. Three consequences, all measured on
 * this repo:
 *
 *   1. The denylists DIVERGED (`ts-lens` had six names, `cfg-lens` nine) — the
 *      same directory could be meaning to one lens and noise to the other.
 *   2. Neither lens ever consulted the repository's OWN ignore semantics. A
 *      denylist only knows the ecosystems someone thought of; `.gitignore`
 *      knows the project. `packages/conductor/.build` (Swift SPM output) was
 *      in nobody's list, so `cfg-lens` lifted every JSON key under it as a
 *      symbol: 14,168 of 25,341 absorbed symbols — 55.9% of the entire
 *      universe — from 936 build files, one `output-file-map.json` alone
 *      yielding 927 symbols.
 *   3. Those ids embedded ABSOLUTE machine paths
 *      (`#cfg:….build/…::/~1Users~1ascend~1…`), so the state's content-address
 *      became machine-dependent — the one property the WARP exists to hold.
 *
 * THE RULE. A lens sees a file when BOTH agree:
 *   - it is not under a `baseline` directory name (what is NEVER meaning in any
 *     project — dependency and build-output dirs, VCS/tool state), and
 *   - the root ignore matcher admits it (`.warplineignore` preferred, else
 *     `.gitignore`, plus the always-ignores — see `warp/ignore-rules.ts`).
 *
 * The ignore matcher is the SAME one the worktree snapshot path uses, so what a
 * lens lifts and what a snapshot seals no longer disagree by construction.
 *
 * SCOPE (v1, inherited from `ignore-rules.ts`): ROOT-level ignore files only.
 * A nested `packages/foo/.gitignore` is NOT collected — which is why `.build`
 * stays in the baseline below rather than relying on
 * `packages/conductor/.gitignore` to exclude it.
 *
 * Determinism (§5): directories are PRUNED during the walk (per gitignore
 * semantics a file inside an excluded directory cannot be re-included), and the
 * result is sorted by absolute path with the default codepoint compare —
 * locale-independent, stable across machines.
 *
 * Library code: no console output.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadIgnoreMatcher } from '../warp/ignore-rules.js';
import { loadWarpignore } from '../warp/warpignore.js';

/**
 * Directory names no lens descends into, in ANY project. Dependency trees and
 * build output only — never a place a human authors meaning. Project-specific
 * exclusions belong in `.gitignore`/`.warplineignore`, which the walk honours;
 * this set is the floor that holds when a project has no ignore file at all.
 *
 * `.build` (Swift SPM) is here rather than left to the repo's ignore files
 * because it is conventionally declared in a NESTED `.gitignore`, and v1
 * collects root-level ignore files only.
 */
export const BASELINE_SKIP_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  '.warpline',
  '.loom',
  'dist',
  'build',
  '.build',
  '.next',
  'coverage',
]);

/** Accepts a file BASENAME — the per-lens extension/derived-artifact filter. */
export type FileFilter = (fileName: string) => boolean;

/**
 * Enumerate the files under `rootDir` a lens should lift, SORTED by absolute
 * path. `extraSkipDirs` adds lens-specific directory names to the baseline
 * (e.g. `cfg-lens` also skips `.paradigm` — machine-managed index state that is
 * already lifted as symbols where it is meaning).
 */
export async function enumerateLensFiles(
  rootDir: string,
  accept: FileFilter,
  extraSkipDirs: ReadonlySet<string> = new Set(),
): Promise<string[]> {
  // Warpline's NATIVE `.warpignore` (TD-2026-08-12-218) composed with the legacy
  // `.warplineignore`/`.gitignore` matcher — the SAME superset the worktree
  // snapshot uses (snapshot.ts worktreeIgnoreMatcher), so what a lens lifts and
  // what a snapshot seals stay in agreement (and fork --into's nested-worktree
  // phantom-symbol footgun is skipped the moment it is listed in `.warpignore`).
  const warp = loadWarpignore(rootDir);
  const legacy = loadIgnoreMatcher(rootDir);
  const ignored = (rel: string, isDir: boolean): boolean => warp.isIgnored(rel, isDir) || legacy(rel, isDir);
  const out: string[] = [];

  const walk = async (dir: string): Promise<void> => {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      // An unreadable directory is not meaning we can lift — skip it rather
      // than fail the whole absorb (a lens is read-only and best-effort).
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      // Ignore rules are written against POSIX paths relative to the root.
      const rel = path.relative(rootDir, full).split(path.sep).join('/');
      if (e.isDirectory()) {
        if (BASELINE_SKIP_DIRS.has(e.name) || extraSkipDirs.has(e.name)) continue;
        if (ignored(rel, true)) continue;
        await walk(full);
      } else if (e.isFile()) {
        if (!accept(e.name)) continue;
        if (ignored(rel, false)) continue;
        out.push(full);
      }
    }
  };

  await walk(rootDir);
  out.sort();
  return out;
}
