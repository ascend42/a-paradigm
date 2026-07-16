/**
 * #fabric-dag — the derived DAG index over the fabric ledger (V3.1,
 * docs/specs/warpline-v3-identity.md §1.2 + §4).
 *
 * fabric.jsonl is an ARRIVAL LOG (a local receipt of when this machine learned of
 * each strand), not the authority on order — the DAG in the strands is. This
 * module derives everything positional:
 *
 *   - byPickId / children — the index.
 *   - order               — the deterministic topological sort: ties (concurrent
 *                           strands, no ancestry between them) broken by
 *                           (recordedAt, pickId) ascending. Deterministic across
 *                           machines GIVEN THE SAME STRAND SET — which is the
 *                           correct promise (arrival order is not shared state).
 *   - heads / roots       — tips with no children; strands with no parents.
 *   - missingParents      — closure violations (verify treats these as HARD;
 *                           the index still orders what it can so display works).
 *   - cycle               — strands that cannot be topologically ordered
 *                           (impossible under honest hashing — a v3 pickId embeds
 *                           its parents — so a cycle is forgery evidence).
 *
 * parentsOf() unifies the three epochs: v3 `parents[]`; v2's two scalar links
 * (parentPickId + mergeParentPickId); v1 has none (unlinked — OQ-A). A derived
 * position may be SHOWN in CLI output but is never persisted, never accepted as
 * a durable selector across exchange (spec §1.2).
 *
 * Library code: no console output.
 */

import type { Strand } from './strand.js';

/** The DAG parents of a strand, unified across schema epochs (ordered). */
export function parentsOf(s: Strand): string[] {
  if (s.schemaVersion >= 3) return s.parents ?? [];
  if (s.schemaVersion === 2) {
    const out: string[] = [];
    if (s.parentPickId) out.push(s.parentPickId); // primary (chain) parent
    if (s.mergeParentPickId) out.push(s.mergeParentPickId); // merge second parent
    return out;
  }
  return []; // v1 — self-hashed, unlinked (ordering unauthenticatable, OQ-A)
}

export interface FabricDag {
  /** every strand by its pickId (a duplicated pickId dedups — content-addressed). */
  byPickId: Map<string, Strand>;
  /** parent pickId → child pickIds, in arrival (file) order. */
  children: Map<string, string[]>;
  /** the DERIVED deterministic topological order (spec §1.2). */
  order: Strand[];
  /** pickId → index into `order` (the derived display position — never persisted). */
  positionOf: Map<string, number>;
  /** tips: strands with no children (candidates for refs / abandoned heads). */
  heads: Strand[];
  /** strands with no parents at all (v3 genesis; every v1 strand — unlinked). */
  roots: Strand[];
  /** child pickId → parent pickIds not present in the strand set (closure holes). */
  missingParents: Map<string, string[]>;
  /** pickIds that could not be ordered — cycle members/descendants (forgery evidence). */
  cycle: string[];
}

/**
 * Build the DAG index over a strand set. Missing parents do NOT block ordering
 * (they count as satisfied so the reachable remainder still displays); verify is
 * the authority that makes closure violations HARD (§3.2).
 */
export function buildDag(strands: Strand[]): FabricDag {
  const byPickId = new Map<string, Strand>();
  for (const s of strands) if (!byPickId.has(s.pickId)) byPickId.set(s.pickId, s); // first arrival wins (dedup)
  const nodes = [...byPickId.values()];

  const children = new Map<string, string[]>();
  const missingParents = new Map<string, string[]>();
  const indegree = new Map<string, number>(); // over RESOLVED parents only
  for (const s of nodes) {
    let resolved = 0;
    for (const p of parentsOf(s)) {
      if (byPickId.has(p)) {
        resolved++;
        const kids = children.get(p);
        if (kids) kids.push(s.pickId);
        else children.set(p, [s.pickId]);
      } else {
        const miss = missingParents.get(s.pickId);
        if (miss) miss.push(p);
        else missingParents.set(s.pickId, [p]);
      }
    }
    indegree.set(s.pickId, resolved);
  }

  // Kahn's algorithm with a DETERMINISTIC tie-break: among ready strands, emit the
  // least by (recordedAt, pickId) ascending — ISO timestamps compare lexically.
  // O(n²) min-scan; fabrics are small (revisit with a heap when bundles demand it).
  const before = (a: Strand, b: Strand): boolean =>
    a.recordedAt < b.recordedAt || (a.recordedAt === b.recordedAt && a.pickId < b.pickId);
  const ready: Strand[] = nodes.filter((s) => indegree.get(s.pickId) === 0);
  const order: Strand[] = [];
  const positionOf = new Map<string, number>();
  while (ready.length > 0) {
    let minI = 0;
    for (let i = 1; i < ready.length; i++) if (before(ready[i], ready[minI])) minI = i;
    const next = ready.splice(minI, 1)[0];
    positionOf.set(next.pickId, order.length);
    order.push(next);
    for (const childId of children.get(next.pickId) ?? []) {
      const d = (indegree.get(childId) ?? 0) - 1;
      indegree.set(childId, d);
      if (d === 0) ready.push(byPickId.get(childId)!);
    }
  }

  const cycle = nodes.filter((s) => !positionOf.has(s.pickId)).map((s) => s.pickId);
  const heads = nodes.filter((s) => (children.get(s.pickId) ?? []).length === 0);
  const roots = nodes.filter((s) => parentsOf(s).length === 0);
  return { byPickId, children, order, positionOf, heads, roots, missingParents, cycle };
}
