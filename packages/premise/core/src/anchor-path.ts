/**
 * anchor-path — shared anchor path resolution helper.
 *
 * Background: Aspect anchors (`~aspect.path` strings stored in `.purpose`
 * YAML) historically had two valid resolution bases:
 *   - project-root-relative (e.g., `packages/foo/src/bar.ts`)
 *   - .purpose-dir-relative (e.g., `../../bar.ts` written by add_aspect's
 *     auto-rewrite path in v6.0.0–v6.0.4)
 *
 * The writer (`paradigm_purpose_add_aspect`) and reader
 * (`paradigm_aspect_check`) drifted: the writer normalized inputs to
 * purpose-dir-relative; the reader resolved against project-root only.
 * Anchors crossing directories (e.g., `../component.ts`) read as missing.
 *
 * Fix (v6.0.5, Option B from team analysis): centralize resolution in this
 * helper and have BOTH writer and reader call it. First-match-wins ordering:
 *   1. absolute (`path.isAbsolute`)
 *   2. project-root + path
 *   3. purpose-dir + path
 * Returns the first resolution that exists on disk; if none exist, returns
 * the project-root attempt with `exists: false`.
 *
 * `detectAnchorBaseMismatch` is a sibling diagnostic used by the Helix DX
 * hint in `paradigm_aspect_check`: when an anchor reports `exists: false`,
 * we check whether the path resolves under the *other* base. If so, the
 * caller surfaces a structured `resolution_hint` telling agents this is a
 * framework-bug class, not a project-state bug.
 */

import * as fs from 'fs';
import * as path from 'path';

export type AnchorBase = 'project-root' | 'purpose-dir' | 'absolute';

export interface ResolveAnchorPathResult {
  /** The full filesystem path produced by the chosen base. */
  resolvedPath: string;
  /** Which base produced the chosen path. */
  baseUsed: AnchorBase;
  /** Whether `resolvedPath` exists on disk. */
  exists: boolean;
}

/**
 * Resolve an anchor path string against the project root, the .purpose-file
 * directory, or as an absolute path. First base that produces an existing
 * file wins. If no base resolves to an existing file, returns the
 * project-root attempt with `exists: false` so callers have a stable
 * "expected location" string for diagnostics.
 *
 * @param anchorPathStr - The raw `path` portion of a code anchor (no `:LINE`).
 * @param purposeDir - Absolute path to the directory containing the
 *   `.purpose` file the aspect was defined in. Used to resolve
 *   purpose-dir-relative anchors (e.g., `../foo.ts`).
 * @param rootDir - Absolute path to the project root.
 */
export function resolveAnchorPath(
  anchorPathStr: string,
  purposeDir: string,
  rootDir: string,
): ResolveAnchorPathResult {
  // 1) Absolute paths bypass base selection entirely.
  if (path.isAbsolute(anchorPathStr)) {
    return {
      resolvedPath: anchorPathStr,
      baseUsed: 'absolute',
      exists: fs.existsSync(anchorPathStr),
    };
  }

  // 2) Try project-root first (the historical reader convention).
  const rootResolved = path.join(rootDir, anchorPathStr);
  if (fs.existsSync(rootResolved)) {
    return { resolvedPath: rootResolved, baseUsed: 'project-root', exists: true };
  }

  // 3) Fall back to purpose-dir (the writer-rewrite convention). Use
  //    path.resolve so leading `..` segments traverse correctly.
  const purposeResolved = path.resolve(purposeDir, anchorPathStr);
  if (fs.existsSync(purposeResolved)) {
    return { resolvedPath: purposeResolved, baseUsed: 'purpose-dir', exists: true };
  }

  // 4) Neither base resolved. Return the project-root attempt as the
  //    canonical "expected" path; callers may surface a Helix hint via
  //    detectAnchorBaseMismatch.
  return { resolvedPath: rootResolved, baseUsed: 'project-root', exists: false };
}

export interface AnchorBaseMismatch {
  /** Whether the path resolves when joined to project root. */
  rootResolves: boolean;
  /** Whether the path resolves when joined to .purpose-file directory. */
  purposeResolves: boolean;
  /**
   * True when the file resolves under exactly one base. This is the
   * signature of the writer/reader path-resolution drift: same string,
   * different semantics. Used by paradigm_aspect_check to distinguish a
   * framework-bug-class miss from a genuinely missing file.
   */
  mismatch: boolean;
}

/**
 * Check whether a path that fails to resolve under one base would resolve
 * under the other. Used purely for diagnostic hinting — this function
 * never affects the chosen resolution from `resolveAnchorPath`.
 */
export function detectAnchorBaseMismatch(
  anchorPathStr: string,
  purposeDir: string,
  rootDir: string,
): AnchorBaseMismatch {
  // Absolute paths can't suffer from base-selection drift.
  if (path.isAbsolute(anchorPathStr)) {
    const exists = fs.existsSync(anchorPathStr);
    return { rootResolves: exists, purposeResolves: exists, mismatch: false };
  }
  const rootResolves = fs.existsSync(path.join(rootDir, anchorPathStr));
  const purposeResolves = fs.existsSync(path.resolve(purposeDir, anchorPathStr));
  return {
    rootResolves,
    purposeResolves,
    mismatch: rootResolves !== purposeResolves,
  };
}
