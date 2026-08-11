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
  /**
   * TRUE iff at least one of this symbol's edge TARGETS moved its CONTRACT
   * (signature), as opposed to only its body (T-2026-07-15-008 stage 1).
   *
   * The defect this answers: the essence inlines a callee's whole essence into
   * its caller, and `codeEssence` is one monolithic `(fn:… [params] ret body)`
   * string with no separable signature slot. So a callee BODY byte re-addresses
   * every caller, and `bodyChanged` fires on the caller identically whether the
   * ripple was contract-bearing (a real silent-mismerge risk) or body-internal
   * (semantically commuting). The engine never computed "did the callee's
   * SIGNATURE move?", so it could not tell the two apart.
   *
   * `codeSignature` (carried on `contract`, never hashed) supplies it. Per
   * changed target, FAIL CLOSED — `true` unless we can PROVE the signature held:
   *   - target's contentId identical on both sides → it did not move at all;
   *     contributes nothing.
   *   - both sides carry a non-empty `codeSignature` and they are EQUAL → a
   *     body-internal ripple; contributes `false`.
   *   - anything else (target born / retired / renamed away, or a target with no
   *     signature projection such as a `.purpose` symbol) → `true`.
   * OR over all targets; the empty OR is `false`, so a purely LOCAL edit with no
   * moved targets reads `false` — this bit says nothing about local changes.
   * Consult `localChanged` for those.
   *
   * Signatures are compared RAW (never Merkle-substituted): the projection's
   * free-ref slots are serialized BEFORE the body and so hold the lowest
   * first-appearance indices, which a body-only edit cannot renumber. A callee's
   * own callee changing body therefore leaves the callee's signature byte-equal —
   * correctly, since that is still a commuting change.
   *
   * ADDITIVE at stage 1 — NOT consulted by predict/oracle. Flipping the `body`
   * scalar-conflict rule on it is stage 2, gated on re-scoring the evidence
   * corpora for new false-CLEANs first.
   */
  rippleFromContract?: boolean;
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

  // Edges key on the target's readable SYMBOL name (`WarpEdge.to`), so the
  // signature lookup for `rippleFromContract` goes through the name-keyed maps
  // the WarpState already carries. A target renamed between the two states
  // simply misses on one side → fail closed (see `contractBearingRipple`).
  const baseByName = base.objects;
  const branchByName = branch.objects;

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
      rippleFromContract: contractBearingRipple(b, h, baseByName, branchByName),
    });
  }

  reconcileMovedCodeUnits(deltas, renames);
  return { deltas, renames };
}

/**
 * MOVE RECONCILIATION — pair a retired symbol with a born one that carries the
 * IDENTICAL essence, and re-classify the pair as a zero-weight rename.
 *
 * WHY THIS IS NOT A NEW RULE. This module's contract is stated at the top: a
 * pure move/rename produces ZERO deltas, keyed by a stableKey that "survives
 * rename". That holds for `.purpose` symbols, whose ids are path-independent.
 * It is STRUCTURALLY IMPOSSIBLE for code-units, because `codeStableKey` is
 * `relPath + '::' + structuralPath` (lens/code-symbol.ts) — moving a file
 * changes the key itself, so both sides land in the born/retired branches above
 * and the contentId-equal rename branch can never be reached. The delta was
 * reporting a refactor as destruction.
 *
 * WHAT IT COST, measured on a 40-seal run: 12 of 42 strands (29%) were graded
 * `overturned` with calibratedConfidence 0.8 → 0.35, every one of them a file
 * move whose function body never changed. `grade` overturns a strand when a
 * later strand RETIRES its symbols, so routine reorganisation was silently
 * corrupting the calibration signal — the per-codebase moat.
 *
 * CONSERVATIVE BY CONSTRUCTION, because the failure it could introduce (calling
 * two distinct symbols one move) is worse than the one it fixes:
 *   - `#code:` units ONLY. `#cfg:` renames stay retire+born — that is a RATIFIED
 *     trade (cfg folds the file path into the body because for structured data
 *     the location IS meaning); this pass must not quietly revisit it.
 *   - Identical contentId AND identical structural path (the `::` suffix), so a
 *     move is only ever paired with the same declaration under the same name.
 *   - STRICTLY 1:1. If a contentId+suffix maps to more than one born or more
 *     than one retired, every candidate is left alone — an ambiguous pairing is
 *     a guess, and a wrong `rename` erases a real retirement.
 */
function reconcileMovedCodeUnits(deltas: Map<string, SemDelta>, renames: SemDelta[]): void {
  /** contentId + ' ' + structural suffix — the move identity. */
  const moveKey = (essence: string, symbol: string): string =>
    essence + ' ' + symbol.slice(symbol.indexOf('::') + 2);

  const isCodeUnit = (d: SemDelta): boolean => d.symbol.startsWith('#code:');
  const born = new Map<string, SemDelta[]>();
  const retired = new Map<string, SemDelta[]>();

  for (const d of deltas.values()) {
    if (!isCodeUnit(d)) continue;
    if (d.kind === 'symbol-born' && d.essenceAfter) {
      const k = moveKey(d.essenceAfter, d.symbol);
      (born.get(k) ?? born.set(k, []).get(k)!).push(d);
    } else if (d.kind === 'symbol-retired' && d.essenceBefore) {
      const k = moveKey(d.essenceBefore, d.symbol);
      (retired.get(k) ?? retired.set(k, []).get(k)!).push(d);
    }
  }

  for (const [k, bs] of born) {
    const rs = retired.get(k);
    if (!rs || bs.length !== 1 || rs.length !== 1) continue; // ambiguous → leave both
    const b = bs[0]!;
    const r = rs[0]!;
    deltas.delete(b.stableKey);
    deltas.delete(r.stableKey);
    renames.push({
      kind: 'rename',
      stableKey: b.stableKey,
      symbol: b.symbol,
      baseSymbol: r.symbol,
      essenceBefore: r.essenceBefore,
      essenceAfter: b.essenceAfter,
    });
  }
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

/**
 * The unit's SIGNATURE projection — `codeEssence` minus the body, produced by
 * the lens and carried on `data`/`contract` WITHOUT being hashed (see
 * `normalizedContract` in essence-hash.ts: it enumerates the hashed slots and
 * this is not one of them). Empty string when the object carries none.
 */
function codeSignatureOf(obj: WarpObject): string {
  const v = (obj.contract as Record<string, unknown>).codeSignature;
  return typeof v === 'string' ? v : '';
}

/**
 * Did any edge TARGET of this symbol move its CONTRACT (as opposed to only its
 * body)? See `SemDelta.rippleFromContract` for the full rationale.
 *
 * FAIL CLOSED throughout: a target contributes `false` only when we can PROVE
 * its signature held (both sides present, both projections non-empty, byte-
 * equal). Every other shape — born/retired/renamed target, missing projection —
 * contributes `true`. A false "contract moved" costs a review; a false "body
 * only" would license a silent mismerge. That asymmetry decides every branch.
 *
 * Targets absent from BOTH states are extern references: they never carry an
 * essence in this universe (the code-unit branch substitutes a name-derived
 * `extern:` address), so they cannot ripple and contribute nothing. A rename of
 * such a target moves the referrer's OWN wiring and surfaces via `localChanged`.
 */
function contractBearingRipple(
  b: WarpObject,
  h: WarpObject,
  baseByName: Map<string, WarpObject>,
  branchByName: Map<string, WarpObject>,
): boolean {
  const targets = new Set<string>([...b.edges.map((e) => e.to), ...h.edges.map((e) => e.to)]);
  for (const to of targets) {
    const bt = baseByName.get(to);
    const ht = branchByName.get(to);
    if (!bt && !ht) continue; // extern — not a node in this universe
    if (!bt || !ht) return true; // born/retired/renamed target — fail closed
    if (bt.contentId === ht.contentId) continue; // target did not move at all
    const bSig = codeSignatureOf(bt);
    const hSig = codeSignatureOf(ht);
    // Proven body-internal: both projections present AND byte-equal.
    if (bSig !== '' && hSig !== '' && bSig === hSig) continue;
    return true;
  }
  return false;
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
