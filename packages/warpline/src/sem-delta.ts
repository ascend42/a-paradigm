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
  /**
   * TRUE iff this side changed the symbol's OWN content — its own body text
   * (code-unit codeEssence / local-ref wiring), a contract slot, or an edge
   * (by target NAME). FALSE = a RIPPLE delta: the contentId moved only because
   * edge-TARGET essences shifted transitively (Merkle-by-target), with zero
   * local edit. This is the direct-contested vs ripple-only ranking signal
   * (T-2026-07-03-002): flag-set ground truth showed small direct knots are the
   * payoff and 48-176-symbol ripple avalanches are noise. ADDITIVE — never
   * consulted by knot/dangle/autoClean semantics (verdicts are unchanged).
   */
  localChanged?: boolean;
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
        localChanged: true, // existence itself is own content
      });
      continue;
    }
    if (b && !h) {
      deltas.set(key, {
        kind: 'symbol-retired',
        stableKey: key,
        symbol: b.symbol,
        essenceBefore: b.contentId,
        localChanged: true, // existence itself is own content
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
      localChanged: ownContentChanged(b, h, changeset),
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

/**
 * Did THIS side change the symbol's OWN content — as opposed to its contentId
 * shifting only because edge-TARGET essences moved transitively (ripple)?
 *
 * The essence is Merkle-by-target, so `classify` cannot answer this from the
 * contentId: for a code-unit it sets `bodyChanged` whenever the contentId moved
 * at all (incl. pure ripple). Here we compare the LOCAL Merkle inputs instead —
 * every essence input EXCEPT the transitive target essences:
 *   - the name-keyed slot/edge comparisons classify already made ('body' excluded);
 *   - the scalar contract fields the essence hashes but classify doesn't
 *     enumerate (category / severity / applies-to / enforcement);
 *   - a code-unit's own body: the raw tokenized `codeEssence` (pre-substitution)
 *     + the `codeLocalTargets` wiring (a call retargeted to a different local
 *     unit changes the wiring even though the positional token stream doesn't).
 *
 * Known coarseness (documented, matches the essence's own name-blindness
 * boundary): edges/codeLocalTargets compare by target NAME, so a target rename
 * combined WITH an independent ripple on the same referrer reads as local. A
 * pure target rename never gets here (contentId is unchanged — no delta).
 *
 * ADDITIVE ranking signal only — never feeds knot/dangle/autoClean semantics.
 */
function ownContentChanged(b: WarpObject, h: WarpObject, cs: ContractChangeset): boolean {
  // 1. Any name-keyed slot classify detected, EXCLUDING the essence-derived
  //    'body' bit (which fires on ripple too).
  if (changedSlotsOf(cs).some((s) => s !== 'body')) return true;

  // 2. Scalar identity-bearing contract fields not covered by classify.
  const scalar = (obj: WarpObject, k: string): string => {
    const v = (obj.contract as Record<string, unknown>)[k];
    return typeof v === 'string' ? v.normalize('NFC') : '';
  };
  for (const k of ['category', 'severity', 'enforcement']) {
    if (scalar(b, k) !== scalar(h, k)) return true;
  }
  if (JSON.stringify(listOf(b, 'applies-to')) !== JSON.stringify(listOf(h, 'applies-to'))) {
    return true;
  }

  // 3. A code-unit's own body + local-ref wiring.
  if (b.componentType === 'code-unit' || h.componentType === 'code-unit') {
    const body = (obj: WarpObject): string => {
      const v = (obj.contract as Record<string, unknown>).codeEssence;
      return typeof v === 'string' ? v : '';
    };
    if (body(b) !== body(h)) return true;
    if (JSON.stringify(listOf(b, 'codeLocalTargets')) !== JSON.stringify(listOf(h, 'codeLocalTargets'))) {
      return true;
    }
  }

  return false; // pure ripple — only transitive target essences moved
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
