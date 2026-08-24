/**
 * #honesty — per-path merge honesty labels (roadmap P3 Lane A, GAP-1): "what
 * fraction of this merge did MEANING govern?"
 *
 * Every path a merge touched is classified into exactly one tier:
 *   - `meaning-decided` : a lens lifted REAL units from this file (TS code-units,
 *                         cfg key-tree units, `.purpose` symbols) — the meaning
 *                         layer's verdict governed the path. cfg MARKER units
 *                         (`file`/`seq`/`unliftable` — content-independent bodies)
 *                         do NOT count: a file with only markers is byte-decided.
 *   - `derived`         : a lockfile (#derived-artifacts) — machine-generated,
 *                         never lifted, never knotted; take-either + stale.
 *   - `byte-decided`    : everything else — the token byte-merge governed
 *                         (README.md, unparseable configs, sequence-valued keys).
 *
 * This is the COVERAGE HONESTY METRIC the census demanded: additive fields only
 * (G1) on AdmitResult / OracleRecord — presentation data, never a verdict input.
 * The per-path granularity is deliberately coarse (v1): a file with one real
 * unit and three seq markers reads meaning-decided wholesale; the aggregate
 * counts stay honest because seq-heavy files (CI yaml) typically lift NO real
 * key units and read byte-decided.
 *
 * Library code: no console output.
 */

import type { WarpState } from './warp/warp-state.js';
import { isDerivedArtifact } from './lens/derived-artifacts.js';

export type PathDecision = 'meaning-decided' | 'byte-decided' | 'derived';

export interface CoverageCounts {
  meaningDecided: number;
  byteDecided: number;
  derived: number;
}

export interface MergeCoverage {
  /** every classified path, sorted, each with the tier that GOVERNED it. */
  perPath: Array<{ path: string; decidedBy: PathDecision }>;
  /** the aggregate — the renderable "how much did meaning govern?" numbers. */
  counts: CoverageCounts;
}

/**
 * The set of file paths that carry REAL meaning units across `states` (repo-
 * relative, as WarpObject.filePath stores them). Marker-only and unparseable
 * files are excluded — their presence markers exist to be VISIBLE, not to claim
 * coverage they don't have.
 */
function meaningPathsOf(states: WarpState[]): Set<string> {
  const out = new Set<string>();
  for (const state of states) {
    for (const obj of state.objects.values()) {
      if (!obj.filePath) continue;
      const data = obj.contract as Record<string, unknown>;
      if (data.cfgMarker) continue; // marker units never claim coverage
      out.add(obj.filePath);
    }
  }
  return out;
}

/**
 * Classify every path in `paths` against the union of `states` (typically the
 * merge inputs + the merged result, so a path deleted in the merge still
 * classifies by the side it existed on). Deterministic: sorted output.
 */
export function classifyMergePaths(
  paths: Iterable<string>,
  states: WarpState[],
): MergeCoverage {
  const meaningPaths = meaningPathsOf(states);
  const perPath: Array<{ path: string; decidedBy: PathDecision }> = [];
  const counts: CoverageCounts = { meaningDecided: 0, byteDecided: 0, derived: 0 };

  const sorted = Array.from(new Set(paths)).sort();
  for (const p of sorted) {
    let decidedBy: PathDecision;
    if (isDerivedArtifact(p)) decidedBy = 'derived';
    else if (meaningPaths.has(p)) decidedBy = 'meaning-decided';
    else decidedBy = 'byte-decided';
    perPath.push({ path: p, decidedBy });
    if (decidedBy === 'derived') counts.derived++;
    else if (decidedBy === 'meaning-decided') counts.meaningDecided++;
    else counts.byteDecided++;
  }
  return { perPath, counts };
}
