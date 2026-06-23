/**
 * #predict — `predict(ΔA, ΔB)`: the commute / knot / dangle decision procedure.
 *
 * Given two semantic deltas (both base→A and base→B), predict the MERGE from
 * MEANING, partitioning every touched symbol into exactly one of:
 *
 *   - autoClean : the merge commutes. Disjoint touch sets; one-side rename-only;
 *                 independent edge-adds; identical convergent change both sides;
 *                 same-key changes on DISJOINT slots.
 *   - knots[]   : same symbol, contradictory meaning. k ∈ keys(ΔA)∩keys(ΔB),
 *                 essenceAfterA ≠ essenceAfterB, AND (bothRetype-to-different ∨
 *                 conflictingSlot — both changed the SAME slot to different
 *                 values ∨ bornDivergent).
 *   - dangling[]: meaning-level broken ref git is blind to. One side adds an edge
 *                 to a target the OTHER side retired (or changed so the target
 *                 essence no longer exists).
 *
 * Precedence (so the score is a PARTITION, no double-count): a key that is both
 * retired-on-one-side and edge-targeted-on-the-other is a DANGLE, not a knot.
 * `autoClean := knots∅ ∧ dangling∅` for that key.
 *
 * Library code: no console output.
 */

import type { SemDelta, SemDeltaSet } from './sem-delta.js';

export interface Knot {
  stableKey: string;
  symbol: string;
  essenceA?: string;
  essenceB?: string;
  conflictingSlots: string[];
}

export interface Dangle {
  fromKey: string;
  fromSymbol: string;
  edgeKind: string;
  danglingTargetSymbol: string;
  retiredBy: 'A' | 'B';
}

export interface Prediction {
  /** stableKeys that merge cleanly */
  autoClean: string[];
  knots: Knot[];
  dangling: Dangle[];
}

/** Build a symbol→delta lookup AND a target-symbol→retiring-side lookup. */
function retiredTargets(delta: SemDeltaSet): Map<string, SemDelta> {
  // map by RETIRED symbol NAME (edges reference by symbol name).
  const map = new Map<string, SemDelta>();
  for (const d of delta.deltas.values()) {
    if (d.kind === 'symbol-retired') map.set(d.symbol, d);
    // A contract change can also remove a symbol's old essence; but the symbol
    // still exists, so an edge TO it is not dangling at the symbol level. v0
    // treats only retirement as a dangle source (honest + coarse).
  }
  return map;
}

/** Edges added by a delta (across all its contract-changed entries). */
function addedEdges(delta: SemDeltaSet): Array<{ from: SemDelta; kind: string; to: string }> {
  const out: Array<{ from: SemDelta; kind: string; to: string }> = [];
  for (const d of delta.deltas.values()) {
    for (const e of d.changeset?.edgesAdded ?? []) {
      out.push({ from: d, kind: e.kind, to: e.targetSymbol });
    }
  }
  return out;
}

export function predict(deltaA: SemDeltaSet, deltaB: SemDeltaSet): Prediction {
  const knots: Knot[] = [];
  const dangling: Dangle[] = [];
  const dangleKeys = new Set<string>(); // keys consumed by dangle (precedence)

  // ── DANGLE pass first (dangle wins precedence) ──
  const retiredByA = retiredTargets(deltaA);
  const retiredByB = retiredTargets(deltaB);

  // B adds an edge to a target A retired.
  for (const e of addedEdges(deltaB)) {
    const retired = retiredByA.get(e.to);
    if (retired) {
      dangling.push({
        fromKey: e.from.stableKey,
        fromSymbol: e.from.symbol,
        edgeKind: e.kind,
        danglingTargetSymbol: e.to,
        retiredBy: 'A',
      });
      dangleKeys.add(e.from.stableKey);
    }
  }
  // A adds an edge to a target B retired.
  for (const e of addedEdges(deltaA)) {
    const retired = retiredByB.get(e.to);
    if (retired) {
      dangling.push({
        fromKey: e.from.stableKey,
        fromSymbol: e.from.symbol,
        edgeKind: e.kind,
        danglingTargetSymbol: e.to,
        retiredBy: 'B',
      });
      dangleKeys.add(e.from.stableKey);
    }
  }

  // ── KNOT pass over the shared-key set (excluding dangle-consumed keys) ──
  const sharedKeys = new Set<string>();
  for (const k of deltaA.deltas.keys()) {
    if (deltaB.deltas.has(k)) sharedKeys.add(k);
  }

  for (const key of sharedKeys) {
    if (dangleKeys.has(key)) continue; // dangle wins
    const a = deltaA.deltas.get(key)!;
    const b = deltaB.deltas.get(key)!;

    // Identical convergent change (same resulting essence) ⇒ NOT a knot.
    const essA = essenceAfter(a);
    const essB = essenceAfter(b);
    if (essA && essB && essA === essB) continue; // convergent → autoClean

    if (isKnot(a, b)) {
      knots.push({
        stableKey: key,
        symbol: b.symbol || a.symbol,
        essenceA: essA,
        essenceB: essB,
        conflictingSlots: conflictingSlots(a, b),
      });
    }
    // else: same key, different essence, but DISJOINT slots ⇒ commutes (autoClean).
  }

  // ── AUTOCLEAN = every touched key NOT in knots ∪ dangling ──
  const conflicted = new Set<string>([
    ...knots.map((k) => k.stableKey),
    ...dangling.map((d) => d.fromKey),
  ]);
  const touched = new Set<string>([...deltaA.deltas.keys(), ...deltaB.deltas.keys()]);
  const autoClean = Array.from(touched)
    .filter((k) => !conflicted.has(k))
    .sort();

  return {
    autoClean,
    knots: knots.sort((x, y) => x.stableKey.localeCompare(y.stableKey)),
    dangling: dangling.sort((x, y) =>
      x.fromKey !== y.fromKey
        ? x.fromKey.localeCompare(y.fromKey)
        : x.danglingTargetSymbol.localeCompare(y.danglingTargetSymbol),
    ),
  };
}

function essenceAfter(d: SemDelta): string | undefined {
  return d.essenceAfter;
}

/**
 * A KNOT iff the two same-key deltas reach DIFFERENT essences AND contradict:
 *   - both born to different essences (bornDivergent), or
 *   - both retype to different kinds (bothRetype), or
 *   - they changed the SAME slot to different values (conflictingSlot).
 * A retire on one side + contract-change on the other = a structural conflict
 * (retire-vs-edit) → knot.
 */
function isKnot(a: SemDelta, b: SemDelta): boolean {
  // retire vs change (and vice versa) on the same key = contradiction.
  const aRetire = a.kind === 'symbol-retired';
  const bRetire = b.kind === 'symbol-retired';
  if (aRetire !== bRetire) return true; // one deletes, one edits the same symbol
  if (aRetire && bRetire) return false; // both delete the same thing → convergent

  const aBorn = a.kind === 'symbol-born';
  const bBorn = b.kind === 'symbol-born';
  if (aBorn && bBorn) {
    // bornDivergent: same stableKey born on both sides to different essence.
    return a.essenceAfter !== b.essenceAfter;
  }

  // both contract-changed: conflict iff they touch the SAME slot AND diverge,
  // or retype to different kinds.
  const csA = a.changeset;
  const csB = b.changeset;
  if (csA?.kindChanged && csB?.kindChanged) {
    // bothRetype to different kinds is detected via differing essences already;
    // if both retyped and essences differ → knot.
    return a.essenceAfter !== b.essenceAfter;
  }
  return conflictingSlots(a, b).length > 0;
}

/**
 * The slots both sides changed in CONFLICTING directions. v0 heuristic: a slot
 * is conflicting if both sides changed it (same top-level slot in changedSlots)
 * AND the resulting essences differ. Disjoint slots commute.
 */
function conflictingSlots(a: SemDelta, b: SemDelta): string[] {
  const sa = new Set(a.changedSlots ?? []);
  const sb = new Set(b.changedSlots ?? []);
  const shared: string[] = [];
  for (const s of sa) if (sb.has(s)) shared.push(s);

  // For set-valued slots (gates/signals/aspects/states/edges) an ADD on both
  // sides of DIFFERENT members is independent (commutes); only conflicting if
  // the same member is added/removed in opposite directions OR a scalar slot
  // (componentType/kind/steps) differs.
  const conflicting: string[] = [];
  for (const slot of shared) {
    if (slot === 'componentType' || slot === 'kind' || slot === 'steps') {
      conflicting.push(slot);
      continue;
    }
    if (slotMembersConflict(a, b, slot)) conflicting.push(slot);
  }
  return conflicting.sort();
}

/** True if both sides touch overlapping members of a set-valued slot divergently. */
function slotMembersConflict(a: SemDelta, b: SemDelta, slot: string): boolean {
  const csA = a.changeset;
  const csB = b.changeset;
  if (!csA || !csB) return false;
  const added = (cs: typeof csA, s: string): string[] =>
    (cs as unknown as Record<string, string[]>)[`${s}Added`] ?? [];
  const removed = (cs: typeof csA, s: string): string[] =>
    (cs as unknown as Record<string, string[]>)[`${s}Removed`] ?? [];

  if (slot === 'edges') {
    // edges conflict if one side adds an edge the other removes (same target).
    const aAdd = new Set(csA.edgesAdded.map((e) => `${e.kind}|${e.targetSymbol}`));
    const bRem = new Set(csB.edgesRemoved.map((e) => `${e.kind}|${e.targetSymbol}`));
    const bAdd = new Set(csB.edgesAdded.map((e) => `${e.kind}|${e.targetSymbol}`));
    const aRem = new Set(csA.edgesRemoved.map((e) => `${e.kind}|${e.targetSymbol}`));
    for (const x of aAdd) if (bRem.has(x)) return true;
    for (const x of bAdd) if (aRem.has(x)) return true;
    return false;
  }

  const aAdded = new Set(added(csA, slot));
  const aRemoved = new Set(removed(csA, slot));
  const bAdded = new Set(added(csB, slot));
  const bRemoved = new Set(removed(csB, slot));
  // Conflict: A adds a member B removes (or vice versa) → contradictory.
  for (const m of aAdded) if (bRemoved.has(m)) return true;
  for (const m of bAdded) if (aRemoved.has(m)) return true;
  return false;
}
