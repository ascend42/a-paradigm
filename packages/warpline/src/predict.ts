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
 *                 values ∨ bornDivergent). The `body` slot is RIPPLE-GATED
 *                 (TD-2026-08-12-831): a genuine conflict only when BOTH sides
 *                 contest it (`bodyContested`, consulting `SemDelta.localChanged`
 *                 and `rippleFromContract`) — a callee const/body ripple that
 *                 re-addresses the caller's inlined body but COMMUTES is not a
 *                 knot. See `bodyContested` / `conflictingSlots`.
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

/**
 * WHICH decision rule produced a knot/dangle — the five branches of the
 * procedure above, named. A LABEL on control flow that already existed: adding
 * it moved no verdict, no branch condition and no essence.
 *
 *   retire-vs-edit    one side retired the symbol, the other edited it.
 *   born-divergent    both sides BORN the same stableKey to different essences.
 *   both-retype       both sides changed the symbol's KIND, to different results.
 *   conflicting-slot  both sides wrote the SAME slot in diverging directions.
 *   dangle-retire     one side added an edge into a symbol the other retired.
 *
 * A machine-legible rule is what lets a cold agent (F4) branch on WHY without
 * parsing prose: 'retire-vs-edit' is a keep-or-drop decision, 'conflicting-slot'
 * is a merge-the-slot decision — different work, same verdict class.
 */
export type KnotRule =
  | 'retire-vs-edit'
  | 'born-divergent'
  | 'both-retype'
  | 'conflicting-slot'
  | 'dangle-retire';

export interface Knot {
  stableKey: string;
  symbol: string;
  essenceA?: string;
  essenceB?: string;
  conflictingSlots: string[];
  /**
   * DIRECT-CONTESTED vs RIPPLE-ONLY (additive ranking signal, T-2026-07-03-002).
   * TRUE iff at least one side changed the unit's OWN content (SemDelta.localChanged);
   * FALSE = both sides' essences shifted only via edge-target transitivity
   * (Merkle-by-target avalanche). Never feeds the knot decision itself —
   * verdict semantics are unchanged; this is presentation/ranking data.
   * Optional so hand-built Prediction fixtures stay valid; absent ⇒ treated direct.
   */
  direct?: boolean;
  /**
   * WHICH rule fired (see KnotRule). Populated by `predict` at every knot site;
   * OPTIONAL so hand-built Prediction fixtures and pre-`rule` persisted shapes
   * stay valid. Absent ⇒ unlabelled, never a guessed label.
   */
  rule?: KnotRule;
}

export interface Dangle {
  fromKey: string;
  fromSymbol: string;
  edgeKind: string;
  danglingTargetSymbol: string;
  retiredBy: 'A' | 'B';
  /**
   * Same ranking signal as Knot.direct. A dangle's referencing side added the
   * edge — an own-content change — so this is structurally true; carried for a
   * uniform consumer contract (and defensively computed, not assumed).
   */
  direct?: boolean;
  /**
   * Always 'dangle-retire' when populated by `predict` — a dangle has exactly one
   * rule. Carried for a uniform consumer contract with Knot.rule; optional for
   * the same fixture-compatibility reason.
   */
  rule?: KnotRule;
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
        // the edge-ADD is the referencing side's own content change
        direct: e.from.localChanged ?? true,
        rule: 'dangle-retire',
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
        direct: e.from.localChanged ?? true,
        rule: 'dangle-retire',
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

    // knotRuleOf is the former `isKnot` predicate returning WHICH branch fired
    // instead of a bare boolean — non-null is exactly the old `true`, so the
    // partition is byte-identical; the rule is pure labelling.
    const rule = knotRuleOf(a, b);
    if (rule) {
      knots.push({
        stableKey: key,
        symbol: b.symbol || a.symbol,
        essenceA: essA,
        essenceB: essB,
        conflictingSlots: conflictingSlots(a, b),
        // DIRECT iff either side edited the unit's own content; ripple-only
        // knots exist because BOTH essences shifted transitively to different
        // values (each side's ripple avalanche). Absent flags default to true
        // (conservative: unknown ⇒ surfaced, never silently collapsed).
        direct: (a.localChanged ?? true) || (b.localChanged ?? true),
        rule,
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
 *
 * Returns WHICH rule fired, or null for "not a knot" — the same predicate the
 * `isKnot` boolean expressed (non-null ⟺ the old `true`), carrying the branch
 * identity the caller could otherwise only guess at. Every branch, condition and
 * ordering below is UNCHANGED: this labels control flow, it does not steer it.
 */
function knotRuleOf(a: SemDelta, b: SemDelta): KnotRule | null {
  // retire vs change (and vice versa) on the same key = contradiction.
  const aRetire = a.kind === 'symbol-retired';
  const bRetire = b.kind === 'symbol-retired';
  if (aRetire !== bRetire) return 'retire-vs-edit'; // one deletes, one edits the same symbol
  if (aRetire && bRetire) return null; // both delete the same thing → convergent

  const aBorn = a.kind === 'symbol-born';
  const bBorn = b.kind === 'symbol-born';
  if (aBorn && bBorn) {
    // bornDivergent: same stableKey born on both sides to different essence.
    return a.essenceAfter !== b.essenceAfter ? 'born-divergent' : null;
  }

  // both contract-changed: conflict iff they touch the SAME slot AND diverge,
  // or retype to different kinds.
  const csA = a.changeset;
  const csB = b.changeset;
  if (csA?.kindChanged && csB?.kindChanged) {
    // bothRetype to different kinds is detected via differing essences already;
    // if both retyped and essences differ → knot.
    return a.essenceAfter !== b.essenceAfter ? 'both-retype' : null;
  }
  return conflictingSlots(a, b).length > 0 ? 'conflicting-slot' : null;
}

/**
 * bodyContested — did THIS side GENUINELY contest the code-unit's body?
 *
 * TRUE iff the side edited the unit's OWN body (`localChanged`) OR re-addressed
 * through a callee whose CONTRACT moved (`rippleFromContract`) — a signature-
 * bearing ripple that can silently mismerge. FALSE = a pure body-INTERNAL ripple
 * (a callee const/body edit whose signature held): the essence inlines the
 * callee, so the caller's `body` re-addresses, but the change COMMUTES.
 *
 * Absent flags default TRUE (fail-closed, matching the delta-side defaults): an
 * unknown side stays contested rather than silently collapsing a real conflict.
 * The `body` slot consults this in `conflictingSlots` — the RIPPLE-GATE (stage 2,
 * TD-2026-08-12-831). See `SemDelta.rippleFromContract`.
 */
function bodyContested(d: SemDelta): boolean {
  return (d.localChanged ?? true) || (d.rippleFromContract ?? true);
}

/**
 * The slots both sides changed in CONFLICTING directions. v0 heuristic: a slot
 * is conflicting if both sides changed it (same top-level slot in changedSlots)
 * AND the resulting essences differ. Disjoint slots commute.
 *
 * `body` is RIPPLE-GATED (TD-2026-08-12-831): see `bodyContested`. This function
 * feeds BOTH the verdict (via `knotRuleOf`) and the reported `conflictingSlots`,
 * so gating here flips exactly the verdict AND keeps the displayed slots honest.
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
    // Scalar slots: a single value, so both sides reaching here (different
    // essences, same slot) means they wrote DIFFERENT values → conflict.
    if (slot === 'componentType' || slot === 'kind' || slot === 'steps') {
      conflicting.push(slot);
      continue;
    }
    // `body` is scalar (a code-unit's whole inlined body essence), but the
    // essence inlines callees, so a callee const/body edit re-addresses the
    // caller's `body` even when the change COMMUTES. RIPPLE-GATE: it is a genuine
    // conflict only when BOTH sides contest the body — a direct edit or a
    // signature-bearing ripple. Two commuting edits (callee-const ripple ×
    // caller-const edit) leave the ripple side uncontested → CLEAN, killing the
    // measured false KNOTs; direct×direct and signature-ripple×edit both stay
    // contested → the KNOT is preserved. See `bodyContested`, TD-2026-08-12-831.
    if (slot === 'body') {
      if (bodyContested(a) && bodyContested(b)) conflicting.push('body');
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
