/**
 * #sem-delta — the SemDelta and `diff(base, branch)`. The semantic diff.
 *
 * Keyed by `stableKey` = SymbolEntry.id (survives rename). Payloads carry
 * essences (contentIds). The payoff: a pure move/rename produces ZERO deltas
 * where git shows a diff, because the essence excludes name/path and edges key
 * on target essence.
 *
 * Delta kinds:
 *   - symbol-born      : present in branch, absent in base
 *   - symbol-retired   : present in base, absent in branch
 *   - contract-changed : same key, different contentId; classify which slots
 *                        moved (gates/signals/aspects/states/steps ±,
 *                        componentTypeChanged, kindChanged) + edge add/remove
 *   - rename           : same key, same contentId, only name/path differ — the
 *                        EMPTY delta (provably zero semantic weight). Not emitted
 *                        into the changed set; surfaced separately for reporting.
 *
 * Library code: no console output.
 */

import type { WarpObject } from './warp/warp-object.js';
import type { WarpState } from './warp/warp-state.js';

export type SemDeltaKind =
  | 'symbol-born'
  | 'symbol-retired'
  | 'contract-changed'
  | 'rename';

export interface ContractChangeset {
  gatesAdded: string[];
  gatesRemoved: string[];
  signalsAdded: string[];
  signalsRemoved: string[];
  aspectsAdded: string[];
  aspectsRemoved: string[];
  statesAdded: string[];
  statesRemoved: string[];
  componentTypeChanged: boolean;
  kindChanged: boolean; // a retype: gate→component etc.
  edgesAdded: Array<{ kind: string; targetSymbol: string }>;
  edgesRemoved: Array<{ kind: string; targetSymbol: string }>;
  stepsChanged: boolean;
  /**
   * A code-unit's BODY moved (incl. inline-substituted local refs). `classify`
   * runs ONLY when contentIds already differ, and for a code-unit the identity
   * IS its body, so a differing contentId on a code-unit means the body moved.
   * This is the body-INTERNAL analog of `steps` (a literal/operator change with
   * no CALL change fires `'body'` but not `'edges'`; a call add/remove fires
   * `'edges'` via the existing path — both firing is correct).
   */
  bodyChanged: boolean;
}

export interface SemDelta {
  kind: SemDeltaKind;
  stableKey: string;
  /** readable symbol name(s) for reporting */
  symbol: string;
  baseSymbol?: string; // for rename: the old name
  essenceBefore?: string; // base contentId
  essenceAfter?: string; // branch contentId
  /** the changed slots, present for contract-changed */
  changeset?: ContractChangeset;
  /** which top-level slots changed (for quick conflict detection) */
  changedSlots?: string[];
}

export interface SemDeltaSet {
  /** stableKey → delta (the semantic changes; renames excluded) */
  deltas: Map<string, SemDelta>;
  /** renames surfaced for reporting (zero semantic weight) */
  renames: SemDelta[];
}

function byStableKey(state: WarpState): Map<string, WarpObject> {
  const map = new Map<string, WarpObject>();
  for (const obj of state.objects.values()) {
    map.set(obj.stableKey, obj);
  }
  return map;
}

/**
 * Semantic diff base → branch. Walks the union of stable keys.
 */
export function diff(base: WarpState, branch: WarpState): SemDeltaSet {
  const baseByKey = byStableKey(base);
  const branchByKey = byStableKey(branch);
  const keys = new Set<string>([...baseByKey.keys(), ...branchByKey.keys()]);

  const deltas = new Map<string, SemDelta>();
  const renames: SemDelta[] = [];

  for (const key of keys) {
    const b = baseByKey.get(key);
    const h = branchByKey.get(key);

    if (!b && h) {
      // A born symbol's OUTGOING edges must be visible to the dangle pass the
      // same way a gained edge is. We attach an edgesAdded-only changeset (all
      // of the born object's edges, in the same {kind, targetSymbol} shape the
      // contract-changed path uses) so predict.addedEdges() can harvest them.
      // Only edgesAdded is populated — born symbols don't gain/lose other slots
      // relative to a (non-existent) base, and the knot pass treats born-vs-born
      // via essence, never via this changeset, so no phantom knots are created.
      deltas.set(key, {
        kind: 'symbol-born',
        stableKey: key,
        symbol: h.symbol,
        essenceAfter: h.contentId,
        changeset: bornChangeset(h),
      });
      continue;
    }
    if (b && !h) {
      deltas.set(key, {
        kind: 'symbol-retired',
        stableKey: key,
        symbol: b.symbol,
        essenceBefore: b.contentId,
      });
      continue;
    }
    if (!b || !h) continue;

    // contentId-equal short-circuit: identical meaning ⇒ no delta. If the name
    // or path differs, it's a (zero-weight) rename surfaced for reporting only.
    if (b.contentId === h.contentId) {
      if (b.symbol !== h.symbol || b.filePath !== h.filePath) {
        renames.push({
          kind: 'rename',
          stableKey: key,
          symbol: h.symbol,
          baseSymbol: b.symbol,
          essenceBefore: b.contentId,
          essenceAfter: h.contentId,
        });
      }
      continue; // NO semantic delta
    }

    // Meaning moved — classify which slots.
    const changeset = classify(b, h);
    deltas.set(key, {
      kind: 'contract-changed',
      stableKey: key,
      symbol: h.symbol,
      baseSymbol: b.symbol !== h.symbol ? b.symbol : undefined,
      essenceBefore: b.contentId,
      essenceAfter: h.contentId,
      changeset,
      changedSlots: changedSlotsOf(changeset),
    });
  }

  return { deltas, renames };
}

function listOf(obj: WarpObject, slot: string): string[] {
  const v = (obj.contract as Record<string, unknown>)[slot];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function setDiff(before: string[], after: string[]): { added: string[]; removed: string[] } {
  const bs = new Set(before);
  const as = new Set(after);
  return {
    added: after.filter((x) => !bs.has(x)).sort(),
    removed: before.filter((x) => !as.has(x)).sort(),
  };
}

/**
 * Changeset for a born symbol: every outgoing edge counts as edgesAdded (there
 * is no base, so all edges are new). Same {kind, targetSymbol} shape the
 * contract-changed path emits. All other slots are empty — born symbols are
 * surfaced for the dangle pass only, not for slot-level knot detection (which
 * compares born-vs-born by essence, never by this changeset).
 */
function bornChangeset(h: WarpObject): ContractChangeset {
  return {
    gatesAdded: [],
    gatesRemoved: [],
    signalsAdded: [],
    signalsRemoved: [],
    aspectsAdded: [],
    aspectsRemoved: [],
    statesAdded: [],
    statesRemoved: [],
    componentTypeChanged: false,
    kindChanged: false,
    edgesAdded: h.edges.map((e) => ({ kind: e.kind, targetSymbol: e.to })),
    edgesRemoved: [],
    stepsChanged: false,
    // Born is handled via essence/edgesAdded (the dangle pass harvests edges),
    // never via slots — keep consistent with the other false slots.
    bodyChanged: false,
  };
}

function classify(b: WarpObject, h: WarpObject): ContractChangeset {
  const gates = setDiff(listOf(b, 'gates'), listOf(h, 'gates'));
  const signals = setDiff(listOf(b, 'signals'), listOf(h, 'signals'));
  const aspects = setDiff(listOf(b, 'aspects'), listOf(h, 'aspects'));
  const states = setDiff(listOf(b, 'states'), listOf(h, 'states'));

  // Edge add/remove keyed by (kind, targetSymbol).
  const edgeKey = (e: { kind: string; to: string }) => `${e.kind}|${e.to}`;
  const bEdges = new Map(b.edges.map((e) => [edgeKey(e), e]));
  const hEdges = new Map(h.edges.map((e) => [edgeKey(e), e]));
  const edgesAdded = h.edges
    .filter((e) => !bEdges.has(edgeKey(e)))
    .map((e) => ({ kind: e.kind, targetSymbol: e.to }));
  const edgesRemoved = b.edges
    .filter((e) => !hEdges.has(edgeKey(e)))
    .map((e) => ({ kind: e.kind, targetSymbol: e.to }));

  const stepsBefore = JSON.stringify((b.contract as Record<string, unknown>).steps ?? null);
  const stepsAfter = JSON.stringify((h.contract as Record<string, unknown>).steps ?? null);

  return {
    gatesAdded: gates.added,
    gatesRemoved: gates.removed,
    signalsAdded: signals.added,
    signalsRemoved: signals.removed,
    aspectsAdded: aspects.added,
    aspectsRemoved: aspects.removed,
    statesAdded: states.added,
    statesRemoved: states.removed,
    componentTypeChanged: (b.componentType ?? '') !== (h.componentType ?? ''),
    kindChanged: b.kind !== h.kind,
    edgesAdded,
    edgesRemoved,
    stepsChanged: stepsBefore !== stepsAfter,
    // `classify` runs only when contentIds already differ (see `diff`). For a
    // code-unit the identity IS its body (incl. inline-substituted local refs),
    // so a differing contentId on either side that is a code-unit means the
    // body/inline-refs moved.
    bodyChanged: b.componentType === 'code-unit' || h.componentType === 'code-unit',
  };
}

/** The top-level slot names that changed (for fast conflict detection). */
export function changedSlotsOf(cs: ContractChangeset): string[] {
  const slots: string[] = [];
  if (cs.gatesAdded.length || cs.gatesRemoved.length) slots.push('gates');
  if (cs.signalsAdded.length || cs.signalsRemoved.length) slots.push('signals');
  if (cs.aspectsAdded.length || cs.aspectsRemoved.length) slots.push('aspects');
  if (cs.statesAdded.length || cs.statesRemoved.length) slots.push('states');
  if (cs.componentTypeChanged) slots.push('componentType');
  if (cs.kindChanged) slots.push('kind');
  if (cs.edgesAdded.length || cs.edgesRemoved.length) slots.push('edges');
  if (cs.stepsChanged) slots.push('steps');
  if (cs.bodyChanged) slots.push('body');
  return slots.sort();
}
