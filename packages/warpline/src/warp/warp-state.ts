/**
 * #warp-state — a WarpState: the whole symbol graph of one ref, lifted to
 * content-addressed MEANING.
 *
 *   stateId  = sha256 over the SORTED contentIds (identity)
 *   treeSha / absorbedAt = provenance, NOT identity
 *
 * Building a WarpState computes whole-state essences (Merkle-by-target needs the
 * universe) and stamps each WarpObject's contentId.
 *
 * Library code: no console output.
 */

import { createHash } from 'node:crypto';
import {
  getAllSymbols,
  type SymbolIndex,
} from '@a-company/premise-core';
import { liftToWarp, type WarpObject } from './warp-object.js';
import { computeEssences } from './essence-hash.js';

export interface WarpState {
  ref: string;
  treeSha: string | null; // provenance (null for the WORKTREE pseudo-ref)
  objects: Map<string, WarpObject>; // keyed by symbol (the readable name)
  stateId: string;
  absorbedAt: string; // ISO provenance
}

export interface BuildWarpStateOptions {
  ref: string;
  treeSha?: string | null;
  /**
   * Absolute path of the (temp) worktree the index was parsed from. WarpObject
   * filePaths are normalized to be RELATIVE to this root so two absorbs of the
   * same ref (in different temp dirs) produce byte-identical filePaths — the
   * temp-dir prefix is provenance noise, never a "move".
   */
  rootDir?: string;
}

/**
 * Build a WarpState from a live SymbolIndex. Computes whole-state essences,
 * fills each object's contentId, and derives the stateId from the sorted set of
 * contentIds.
 */
export function buildWarpState(index: SymbolIndex, opts: BuildWarpStateOptions): WarpState {
  const entries = getAllSymbols(index);
  const symbols = entries.map((e) => e.symbol);

  // Compute essences for the whole universe, then stamp each object.
  const { contentIds } = computeEssences(index, symbols);

  const objects = new Map<string, WarpObject>();
  for (const entry of entries) {
    const obj = liftToWarp(index, entry);
    obj.contentId = contentIds.get(entry.symbol) ?? '';
    if (obj.filePath) obj.filePath = relativizePath(obj.filePath, opts.rootDir);
    // Last-writer-wins on duplicate symbol names; the symbol map is keyed by the
    // readable name, but the stableKey (uuid) preserves cross-state identity.
    objects.set(entry.symbol, obj);
  }

  const stateId = computeStateId(Array.from(objects.values()).map((o) => o.contentId));

  return {
    ref: opts.ref,
    treeSha: opts.treeSha ?? null,
    objects,
    stateId,
    absorbedAt: new Date().toISOString(),
  };
}

/**
 * Reduce a filePath to be relative to rootDir (so temp-worktree prefixes don't
 * masquerade as moves). Falls back to stripping a `warpline-wt-XXXX/tree/` segment
 * for absorbs whose rootDir wasn't supplied.
 */
function relativizePath(filePath: string, rootDir?: string): string {
  const p = filePath.replace(/\\/g, '/');
  if (rootDir) {
    const root = rootDir.replace(/\\/g, '/').replace(/\/$/, '');
    // Try the supplied root, plus the macOS /private↔/var symlink aliases, so a
    // tmpdir reported as /var/folders/... still strips a /private/var/folders/...
    // filePath (and vice-versa). Whichever alias matches, the result is identical
    // repo-relative text — the whole point of the determinism fix.
    for (const candidate of rootAliases(root)) {
      if (p === candidate) return '';
      if (p.startsWith(candidate + '/')) return p.slice(candidate.length + 1);
    }
  }
  const m = p.match(/warpline-wt-[^/]+\/tree\/(.*)$/);
  if (m) return m[1];
  return p;
}

/** macOS reports the temp dir as both /var/... and /private/var/... (a symlink). */
function rootAliases(root: string): string[] {
  const aliases = [root];
  if (root.startsWith('/private/')) aliases.push(root.slice('/private'.length));
  else if (root.startsWith('/var/') || root.startsWith('/tmp/')) aliases.push('/private' + root);
  return aliases;
}

/** stateId = sha256 over the SORTED, deduped contentIds. */
export function computeStateId(contentIds: string[]): string {
  const sorted = Array.from(new Set(contentIds.filter(Boolean))).sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return 'state:v0:' + createHash('sha256').update(sorted.join('\n'), 'utf8').digest('hex');
}
