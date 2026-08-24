/**
 * #mergebase — the MERGE-BASE (lowest common ancestor) over the fabric DAG, M2.5
 * branching foundation (TD-2026-08-12-813, Arky's design). The one genuinely new
 * algorithm branching needs: given two heads, find the history position they last
 * shared, so a three-way merge (base × ours × theirs) has its base.
 *
 * ancestorSet(byPick, tip) is the inclusive BFS over the unified DAG parents
 * (#fabric-dag parentsOf — v3 parents[], v2 parentPickId+mergeParentPickId, v1
 * none). It is the same walk #native-write-path does over the selvage tip,
 * generalized and exported here so branching does not re-derive it.
 *
 * mergeBase(byPick, a, b):
 *   I = ancestors(a) ∩ ancestors(b)               — the common ancestors.
 *   base = the element of I that is a proper ancestor of NO other element of I
 *          — the LOWEST common ancestor (closest to a and b).
 *
 * CRISS-CROSS FAILS CLOSED. When two branches merge each other's work (a diamond
 * whose two merge strands cross), I has MORE THAN ONE minimal element and there
 * is no single merge base. This returns `{ ambiguous: [...] }` rather than
 * silently choosing one — the caller fails closed (Arky's v1 decision: a wrong
 * base is a silently-wrong merge, the exact class Warpline exists to refuse).
 *
 * DISJOINT ROOTS → null: two histories that share no ancestor at all (I empty)
 * have no merge base; the record itself is suspect and the caller escalates.
 *
 * DETERMINISTIC + CLOCK-FREE: the ambiguous list is ordered by the derived
 * topological position (#fabric-dag buildDag), pickId as the tiebreak — the same
 * clock-free order the rest of the fabric derives, so two machines with the same
 * strand set report the same base(s) in the same order.
 *
 * Library code: no console output.
 */

import type { Strand } from './strand.js';
import { parentsOf, buildDag } from './dag.js';

/**
 * All ancestors of `tip` (INCLUSIVE), BFS over the unified DAG parents. A pickId
 * absent from `byPick` (a closure hole) simply stops the walk on that branch —
 * the reachable remainder is still returned, exactly as #fabric-dag orders around
 * missing parents.
 */
export function ancestorSet(byPick: Map<string, Strand>, tip: string): Set<string> {
  const seen = new Set<string>();
  const queue = [tip];
  while (queue.length) {
    const id = queue.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const s = byPick.get(id);
    if (s) for (const p of parentsOf(s)) queue.push(p);
  }
  return seen;
}

/** The merge-base result: the single LCA, `null` (disjoint), or a criss-cross set. */
export type MergeBaseResult = string | null | { ambiguous: string[] };

/**
 * The lowest common ancestor of `a` and `b` over the fabric DAG. Returns the
 * single base pickId; `null` when the two share no ancestor; or
 * `{ ambiguous: [...] }` when the history criss-crosses and no single base exists
 * (the caller fails closed — never a silent pick).
 */
export function mergeBase(byPick: Map<string, Strand>, a: string, b: string): MergeBaseResult {
  const ancA = ancestorSet(byPick, a);
  const ancB = ancestorSet(byPick, b);

  // I = the common ancestors.
  const common: string[] = [];
  for (const id of ancA) if (ancB.has(id)) common.push(id);
  if (common.length === 0) return null; // disjoint roots — no merge base

  // A common ancestor is DOMINATED when it is a proper ancestor of another common
  // ancestor (an "older" position). What survives is the set of common ancestors
  // that dominate no other — the lowest common ancestors. In a finite DAG that
  // set is always non-empty; a single survivor is the normal case, more than one
  // is a criss-cross.
  const commonSet = new Set(common);
  const dominated = new Set<string>();
  for (const y of common) {
    const ancY = ancestorSet(byPick, y);
    for (const x of ancY) if (x !== y && commonSet.has(x)) dominated.add(x);
  }
  const bases = common.filter((id) => !dominated.has(id));

  if (bases.length === 1) return bases[0];

  // Deterministic, clock-free order for the criss-cross report: the derived
  // topological position, pickId ascending as the tiebreak.
  const { positionOf } = buildDag([...byPick.values()]);
  bases.sort(
    (x, y) => (positionOf.get(x) ?? -1) - (positionOf.get(y) ?? -1) || (x < y ? -1 : x > y ? 1 : 0),
  );
  return { ambiguous: bases };
}
