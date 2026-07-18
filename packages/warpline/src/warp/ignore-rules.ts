/**
 * #warp-store — SNAPSHOT IGNORE RULES (T-031 / HIGH-3, the dogfooding unblock).
 * The worktree snapshot path (snapshotDir, behind worktree pick/admit) previously
 * ingested EVERYTHING under the root except .git/.warpline — node_modules, .env,
 * build output — into the permanent no-gc object store. This module decides what a
 * worktree snapshot skips:
 *
 *   1. ALWAYS ignored, at any depth: .git, .warpline (restoreTree refuses those
 *      names anyway — snapshot/restore symmetry), .loom (the Loom-era engine's
 *      own session/state dir — tool state, never meaning; R1 hygiene
 *      T-2026-07-17-007: the tool never ingests its own state dirs) and
 *      node_modules (never meaning, never restorable intent — ratified by the
 *      Move-2 audit). Other session-state dirs (.claude/, .tmp/, build output)
 *      are the ignore FILES' job — on a normal repo the root .gitignore
 *      fallback already covers them.
 *   2. `.warplineignore` at the snapshot root, when present (gitignore syntax) —
 *      Warpline's own ignore file WINS over .gitignore.
 *   3. else `.gitignore` at the snapshot root, when present.
 *
 * Matching uses the `ignore` package (the gitignore matcher eslint uses): trailing-
 * slash dir patterns, `*` globs, negation `!`, anchored `/` patterns all behave per
 * the gitignore spec. Directories are PRUNED during the walk, so (per gitignore
 * semantics) a file inside an excluded directory cannot be re-included. v1 scope:
 * root-level ignore files only — nested per-directory .gitignore files are not
 * collected. The REF snapshot path (git ls-tree) is deliberately untouched: git
 * already governs what a ref contains.
 *
 * Library code: no console output.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import ignore from 'ignore';

/** Names skipped at ANY depth, regardless of ignore files. */
const ALWAYS_IGNORE = new Set(['.git', '.warpline', '.loom', 'node_modules']);

/** Decides whether a snapshot walk skips `relPath` (posix, relative to the root). */
export type IgnoreMatcher = (relPath: string, isDir: boolean) => boolean;

/** The precedence-ordered root ignore FILE names (.warplineignore WINS, never merges). */
export const IGNORE_FILE_NAMES = ['.warplineignore', '.gitignore'] as const;

/**
 * Build an ignore matcher from raw rule CONTENT (gitignore syntax) — the shared
 * core behind every walk that applies WORKTREE SEMANTICS (the disk walk, the
 * ref walk, and the store-tree projection — see snapshot.ts's tree-semantics
 * decision header). `null` content = always-ignores only.
 */
export function ignoreMatcherFrom(content: string | null): IgnoreMatcher {
  const ig = ignore();
  if (content !== null) ig.add(content);
  return (relPath: string, isDir: boolean): boolean => {
    const base = relPath.slice(relPath.lastIndexOf('/') + 1);
    if (ALWAYS_IGNORE.has(base)) return true;
    // gitignore dir patterns (`dist/`) match only when tested WITH the trailing slash.
    return ig.ignores(isDir ? `${relPath}/` : relPath);
  };
}

/**
 * Build the ignore matcher for a snapshot rooted at `root`: always-ignores plus
 * the root `.warplineignore` (preferred) or `.gitignore` (fallback), when present.
 */
export function loadIgnoreMatcher(root: string): IgnoreMatcher {
  for (const file of IGNORE_FILE_NAMES) {
    const p = path.join(root, file);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      return ignoreMatcherFrom(fs.readFileSync(p, 'utf8'));
    }
  }
  return ignoreMatcherFrom(null);
}
