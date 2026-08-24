/**
 * viewerState — the PURE data-binding layer for the Oracle Divergence Viewer.
 *
 * Every function here maps a real `OracleRecord` field onto a UI decision (the
 * hero state, the matrix cells, the verdict consequence line, the ledger row
 * label). It holds NO React — so it is unit-testable in a plain node env and the
 * "the number can't lie" falsifiability stays a pure, asserted function.
 */

import type { Convergence, Dangle, Knot, OracleRecord } from './types';

/**
 * The hero (MeaningVsBytesSplit) has four mutually-exclusive moods, chosen ONLY
 * from real fields:
 *   'divergence'  — DIVERGENT & divergeMeaningOnly.length>0  → seam PULSES (the hero)
 *   'both-caught' — DIVERGENT & divergeMeaningOnly==0 & agreeConflict>0 → seam static dim
 *   'git-noise'   — divergeGitOnly>0 & knots==0 → meaning CLEAN, git over-reported
 *   'convergent'  — CONVERGENT → calm
 */
export type HeroState = 'divergence' | 'both-caught' | 'git-noise' | 'convergent';

export function heroState(record: OracleRecord): HeroState {
  const c = record.convergence;
  const knotCount = record.prediction.knots.length;
  if (c.verdict === 'DIVERGENT' && c.divergeMeaningOnly.length > 0) return 'divergence';
  if (c.verdict === 'DIVERGENT' && c.divergeMeaningOnly.length === 0 && c.agreeConflict.length > 0)
    return 'both-caught';
  if (c.divergeGitOnly.length > 0 && knotCount === 0) return 'git-noise';
  return 'convergent';
}

/** The headline condition: the ONLY thing that lights the ★ cell + pulses the seam. */
export function isHeadlineDivergence(record: OracleRecord): boolean {
  return record.convergence.divergeMeaningOnly.length > 0;
}

/** Git's CLEAN-trap chip text. CLEAN ✓ when git saw no conflict (the unreliable narrator). */
export function gitChip(record: OracleRecord): { label: string; clean: boolean } {
  const conflicted = record.gitReality.conflicted;
  return { label: conflicted ? 'CONFLICT' : 'CLEAN ✓', clean: !conflicted };
}

/** Warpline's meaning chip — the verdict plus the knot/dangle tally. */
export function meaningChip(record: OracleRecord): {
  verdict: 'CONVERGENT' | 'DIVERGENT';
  knots: number;
  dangles: number;
} {
  return {
    verdict: record.convergence.verdict,
    knots: record.prediction.knots.length,
    dangles: record.prediction.dangling.length,
  };
}

/**
 * The literal 2×2 confusion matrix, axes git(clean→conflict) × meaning(clean→knot).
 * Each cell carries its real symbol keys (clickable → expand) so the count is
 * falsifiable. The divergeMeaningOnly cell (bottom-left) is the ★ — the only cell
 * that glows.
 */
export interface MatrixCell {
  id: 'agreeClean' | 'divergeGitOnly' | 'divergeMeaningOnly' | 'agreeConflict';
  label: string;
  /** axis position for the literal 2×2 layout */
  gitConflict: boolean;
  meaningKnot: boolean;
  symbols: string[];
  /** the ★ cell — git's false negative, the thesis. Only cell allowed to glow. */
  star: boolean;
}

export function matrixCells(c: Convergence): MatrixCell[] {
  return [
    // top-left: git clean, meaning clean → both agree it's clean
    {
      id: 'agreeClean',
      label: 'agree · clean',
      gitConflict: false,
      meaningKnot: false,
      symbols: c.agreeClean,
      star: false,
    },
    // top-right: git conflict, meaning clean → git false positive (amber noise)
    {
      id: 'divergeGitOnly',
      label: 'git only',
      gitConflict: true,
      meaningKnot: false,
      symbols: c.divergeGitOnly,
      star: false,
    },
    // bottom-left: git clean, meaning knot → git FALSE NEGATIVE ★ (the headline)
    {
      id: 'divergeMeaningOnly',
      label: 'meaning only ★',
      gitConflict: false,
      meaningKnot: true,
      symbols: c.divergeMeaningOnly,
      star: true,
    },
    // bottom-right: git conflict, meaning knot → both caught it
    {
      id: 'agreeConflict',
      label: 'agree · conflict',
      gitConflict: true,
      meaningKnot: true,
      symbols: c.agreeConflict,
      star: false,
    },
  ];
}

/** Raw counts that ALWAYS sit beside the score (never a lone vanity number). */
export function rawCounts(c: Convergence): {
  agree: number;
  divergeGitOnly: number;
  divergeMeaningOnly: number;
} {
  return {
    agree: c.agreeClean.length + c.agreeConflict.length,
    divergeGitOnly: c.divergeGitOnly.length,
    divergeMeaningOnly: c.divergeMeaningOnly.length,
  };
}

/**
 * The templated consequence line. Prefer the first dangle (the product's
 * emotional core — a real broken call); fall back to the first knot's
 * conflicting slots; else the calm clean line.
 */
export function consequenceLine(record: OracleRecord): string {
  const dangle = record.prediction.dangling[0];
  if (dangle) {
    return `a call into ${dangle.danglingTargetSymbol}, retired by ${dangle.retiredBy}`;
  }
  const knot = record.prediction.knots[0];
  if (knot && knot.conflictingSlots.length > 0) {
    return `contradictory edits to ${knot.symbol} · slots: ${knot.conflictingSlots.join(', ')}`;
  }
  if (record.convergence.verdict === 'CONVERGENT') {
    return 'No knots. No dangles. The weave is clean.';
  }
  return 'A scored disagreement git could not see.';
}

/** DivergencePanel empty/calm copy — restraint earns the loud UI elsewhere. */
export const CALM_DIVERGENCE_COPY = 'No knots. No dangles. The weave is clean.';

export function isCalm(record: OracleRecord): boolean {
  return (
    record.prediction.knots.length === 0 &&
    record.prediction.dangling.length === 0 &&
    record.convergence.verdict === 'CONVERGENT'
  );
}

/** A ledger rail row label: `branchA→branchB`. */
export function ledgerRowLabel(record: { branchA: string; branchB: string }): string {
  return `${record.branchA}→${record.branchB}`;
}

/** Does this ledger row carry the seam-violet dot? (DIVERGENT runs do.) */
export function isDivergentRow(record: { convergence?: { verdict?: string } }): boolean {
  return record.convergence?.verdict === 'DIVERGENT';
}

/** Stable identity for a ledger row (ts + branches) — used for selection + dedupe. */
export function rowKey(record: { ts: string; branchA: string; branchB: string }): string {
  return `${record.ts}·${record.branchA}·${record.branchB}`;
}

/** A knot's drill-down summary — essences + the conflicting slots (incl. the 'body' code-lens slot). */
export function knotDrill(knot: Knot): {
  symbol: string;
  essenceA: string;
  essenceB: string;
  slots: string[];
  hasBody: boolean;
} {
  return {
    symbol: knot.symbol,
    essenceA: knot.essenceA ?? '∅',
    essenceB: knot.essenceB ?? '∅',
    slots: knot.conflictingSlots,
    hasBody: knot.conflictingSlots.includes('body'),
  };
}

/**
 * Adapt a POST /forecast {vsGit:true} response into an EPHEMERAL OracleRecord so
 * the viewer renders a preview identically to a recorded run. Preview always
 * requests vsGit, so `forecast.vsGit` carries the full convergence + git-reality;
 * if it is somehow absent we synthesize a meaning-only convergence (no git side).
 */
export function forecastToRecord(
  f: {
    branchA: string;
    branchB: string;
    mergeBase: string;
    knots: Knot[];
    dangling: Dangle[];
    autoClean: string[];
    vsGit?: (Convergence & { gitConflicted?: boolean; conflictSymbols?: string[] }) | undefined;
  },
): OracleRecord {
  const v = f.vsGit;
  const convergence: Convergence = v
    ? {
        agreeClean: v.agreeClean,
        agreeConflict: v.agreeConflict,
        divergeGitOnly: v.divergeGitOnly,
        divergeMeaningOnly: v.divergeMeaningOnly,
        score: v.score,
        verdict: v.verdict,
      }
    : {
        // no git side available — treat every knot/dangle as meaning-only divergence
        agreeClean: f.autoClean,
        agreeConflict: [],
        divergeGitOnly: [],
        divergeMeaningOnly: [
          ...f.knots.map((k) => k.symbol),
          ...f.dangling.map((d) => d.fromSymbol),
        ],
        score: f.knots.length + f.dangling.length === 0 ? 1 : 0,
        verdict: f.knots.length + f.dangling.length === 0 ? 'CONVERGENT' : 'DIVERGENT',
      };
  return {
    ts: new Date().toISOString(),
    branchA: f.branchA,
    branchB: f.branchB,
    mergeBase: f.mergeBase,
    prediction: { autoClean: f.autoClean, knots: f.knots, dangling: f.dangling },
    gitReality: {
      conflicted: v?.gitConflicted ?? false,
      conflictSymbols: v?.conflictSymbols ?? [],
      conflictPaths: [],
    },
    convergence,
    justifications: {
      A: { actor: 'preview', intent: 'forecast (ephemeral)' },
      B: { actor: 'preview', intent: 'forecast (ephemeral)' },
    },
  };
}

/** A dangle's drill-down summary — from → severed target, who retired it. */
export function dangleDrill(dangle: Dangle): {
  from: string;
  target: string;
  edgeKind: string;
  retiredBy: 'A' | 'B';
} {
  return {
    from: dangle.fromSymbol,
    target: dangle.danglingTargetSymbol,
    edgeKind: dangle.edgeKind,
    retiredBy: dangle.retiredBy,
  };
}
