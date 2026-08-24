/**
 * #consolidate — the N-way fold FORECAST (read-only). The N-branch generalization
 * of #weave's forecast(): absorb a common base + N refs, diff each against the base,
 * and predict the fold from MEANING — which symbols auto-fold vs which KNOT across
 * branches, and where an edge dangles into a symbol another branch retired.
 *
 * Reuses the proven 2-way #predict PAIRWISE across every (i<j) and aggregates by
 * symbol, so there is no new conflict logic to get wrong — the N-way knot on a
 * symbol is exactly the union of the pairwise knots that touch it. NO git merge,
 * NO ledger write (a forecast is ephemeral). Concurrency-safe absorb (the parallel
 * fan-out) rests on T-2026-06-23-003's git-archive materialization.
 *
 * This is the engine behind `warpline consolidate b1 b2 …` and the falsifiable
 * multi-agent claim (T-2026-06-24-012): N agents on one feature fold with human
 * labor proportional to GENUINE meaning-collisions (knots + dangles), not branch
 * count — a meaning-preserving edit (reorder, local rename) carries ZERO delta and
 * auto-folds where git reports a textual conflict.
 *
 * Library code: no console output (the CLI prints).
 */

import { absorb } from './absorb.js';
import { diff, type SemDeltaSet } from './sem-delta.js';
import { predict } from './predict.js';
import { type WarpState } from './warp/warp-state.js';
import { mergeBaseN, type GitOptions } from './git/git-exec.js';

/** One ref's stance on a knotted symbol. */
export interface ConsolidateKnotSide {
  ref: string;
  essence?: string;
}

/** A symbol ≥2 branches changed to contradictory meaning — a human decision. */
export interface ConsolidateKnot {
  stableKey: string;
  symbol: string;
  /** the ≥2 refs whose meaning on this symbol is in tension. */
  sides: ConsolidateKnotSide[];
  conflictingSlots: string[];
}

/** An edge one branch added into a symbol another branch retired — git-blind. */
export interface ConsolidateDangle {
  fromSymbol: string;
  edgeKind: string;
  danglingTargetSymbol: string;
  /** the ref that added the edge. */
  addedBy: string;
  /** the ref that retired the target. */
  retiredBy: string;
}

export interface ConsolidateForecast {
  refs: string[];
  base: string;
  /** ref (and base) → stateId. */
  stateIds: Record<string, string>;
  /** stableKeys touched by ≥1 ref that fold with NO human decision. */
  autoFolded: string[];
  knots: ConsolidateKnot[];
  dangling: ConsolidateDangle[];
  verdict: 'CLEAN' | 'DECISIONS';
  /** K_human — symbols needing a human decision (knots + dangles). The labor metric. */
  decisions: number;
}

export interface ConsolidateOptions extends GitOptions {
  /** the common base; default = octopus merge-base of all refs. */
  base?: string;
}

/** Dedupe knot sides by ref (keep the first essence seen for a ref), sorted by ref. */
function dedupeSides(sides: ConsolidateKnotSide[]): ConsolidateKnotSide[] {
  const byRef = new Map<string, ConsolidateKnotSide>();
  for (const s of sides) if (!byRef.has(s.ref)) byRef.set(s.ref, s);
  return Array.from(byRef.values()).sort((a, b) => a.ref.localeCompare(b.ref));
}

/**
 * Forecast the fold of N refs from MEANING. Read-only; never writes .warpline/.
 */
export async function consolidate(
  refs: string[],
  opts: ConsolidateOptions = {},
): Promise<ConsolidateForecast> {
  const cwd = opts.cwd ?? process.cwd();
  if (refs.length < 2) {
    throw new Error('consolidate needs at least 2 refs');
  }
  const base = opts.base ?? (await mergeBaseN(refs, { cwd }));

  // absorb base + every ref IN PARALLEL — concurrency-safe via git-archive
  // materialization (T-2026-06-23-003). This fan-out is the whole point.
  const [baseState, ...refStates] = await Promise.all([
    absorb(base, { cwd }),
    ...refs.map((r) => absorb(r, { cwd })),
  ]);
  const baseTagged: WarpState = { ...baseState, ref: base };

  const deltas = new Map<string, SemDeltaSet>();
  const stateIds: Record<string, string> = { [base]: baseTagged.stateId };
  refs.forEach((r, i) => {
    deltas.set(r, diff(baseTagged, refStates[i]));
    stateIds[r] = refStates[i].stateId;
  });

  // Pairwise predict across all (i<j); aggregate knots by stableKey, dangles by
  // their (from, edge, target, added-by, retired-by) signature.
  const knotsByKey = new Map<string, ConsolidateKnot>();
  const dangleKeys = new Set<string>(); // stableKeys consumed by a dangle (autoFold exclusion)
  const dangleSeen = new Set<string>();
  const dangling: ConsolidateDangle[] = [];

  for (let i = 0; i < refs.length; i++) {
    for (let j = i + 1; j < refs.length; j++) {
      const ri = refs[i];
      const rj = refs[j];
      const p = predict(deltas.get(ri)!, deltas.get(rj)!);

      for (const k of p.knots) {
        const sideI: ConsolidateKnotSide = { ref: ri, essence: k.essenceA };
        const sideJ: ConsolidateKnotSide = { ref: rj, essence: k.essenceB };
        const existing = knotsByKey.get(k.stableKey);
        if (!existing) {
          knotsByKey.set(k.stableKey, {
            stableKey: k.stableKey,
            symbol: k.symbol,
            sides: dedupeSides([sideI, sideJ]),
            conflictingSlots: [...k.conflictingSlots],
          });
        } else {
          existing.sides = dedupeSides([...existing.sides, sideI, sideJ]);
          existing.conflictingSlots = Array.from(
            new Set([...existing.conflictingSlots, ...k.conflictingSlots]),
          ).sort();
        }
      }

      for (const d of p.dangling) {
        // predict labels the RETIRING side 'A'|'B' relative to (ri, rj): A=ri, B=rj.
        const retiredRef = d.retiredBy === 'A' ? ri : rj;
        const addedByRef = d.retiredBy === 'A' ? rj : ri;
        dangleKeys.add(d.fromKey);
        const sig = `${d.fromKey}|${d.edgeKind}|${d.danglingTargetSymbol}|${addedByRef}|${retiredRef}`;
        if (!dangleSeen.has(sig)) {
          dangleSeen.add(sig);
          dangling.push({
            fromSymbol: d.fromSymbol,
            edgeKind: d.edgeKind,
            danglingTargetSymbol: d.danglingTargetSymbol,
            addedBy: addedByRef,
            retiredBy: retiredRef,
          });
        }
      }
    }
  }

  const knots = Array.from(knotsByKey.values()).sort((a, b) =>
    a.stableKey.localeCompare(b.stableKey),
  );

  // autoFolded = every touched key NOT in a knot or a dangle.
  const conflicted = new Set<string>([...knots.map((k) => k.stableKey), ...dangleKeys]);
  const touched = new Set<string>();
  for (const set of deltas.values()) {
    for (const key of set.deltas.keys()) touched.add(key);
  }
  const autoFolded = Array.from(touched)
    .filter((k) => !conflicted.has(k))
    .sort();

  const decisions = knots.length + dangling.length;

  return {
    refs: [...refs],
    base,
    stateIds,
    autoFolded,
    knots,
    dangling,
    verdict: decisions === 0 ? 'CLEAN' : 'DECISIONS',
    decisions,
  };
}
