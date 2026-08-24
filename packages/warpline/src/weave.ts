/**
 * #weave — the pre-merge MEANING forecast and the semantic-diff helpers.
 *
 * Phase 1 is READ-ONLY. `weave(...)` (the write verb) is RESERVED, not built.
 * What this module DOES build is the meaning-side of the Oracle, surfaced as
 * pre-merge UX:
 *
 *   - forecast(A, B)  — THE PRE-MERGE FORECAST. Reuses the Oracle pipeline up
 *                       through predict(): mergeBase(A,B) → absorb base/A/B →
 *                       ΔA=diff(base,A), ΔB=diff(base,B) → predict → a Forecast
 *                       {verdict, autoClean, knots, dangling}. NO git merge, NO
 *                       ledger write — a preview is ephemeral. An optional
 *                       `vsGit` flag also runs the full Oracle for the
 *                       git-reality divergence comparison.
 *
 *   - semanticDiff(refA, refB) — the SEMANTIC diff between two refs. absorb both
 *                       → diff() → a SemDiffReport grouping born / retired /
 *                       contract-changed / renamed-noop. Makes the
 *                       "rename is the empty delta" property VISIBLE on real refs.
 *
 * Both functions are READ-ONLY: absorb spins throwaway detached worktrees and
 * tears them down; HEAD/index/worktree are never touched, and unlike `oracle`
 * neither writes to .warpline/.
 *
 * Library code: no console output (the CLI prints).
 */

import { absorb, WORKTREE_REF } from './absorb.js';
import { diff, type SemDelta, type SemDeltaSet } from './sem-delta.js';
import { predict, type Knot, type Dangle } from './predict.js';
import { oracle, type OracleRecord } from './oracle.js';
import { type WarpState } from './warp/warp-state.js';
import { mergeBase, type GitOptions } from './git/git-exec.js';

// ── FORECAST ──────────────────────────────────────────────────────────────

export interface Forecast {
  branchA: string;
  branchB: string;
  mergeBase: string;
  stateIds: { base: string; A: string; B: string };
  /** 'CLEAN' = no knots, no dangling. 'DECISIONS' = N knots+dangling to resolve. */
  verdict: 'CLEAN' | 'DECISIONS';
  /** number of decisions needed (knots + dangling). */
  decisions: number;
  autoClean: string[];
  knots: Knot[];
  dangling: Dangle[];
  /** present only when forecast() was asked for the git-reality comparison. */
  vsGit?: OracleRecord['convergence'] & {
    gitConflicted: boolean;
    conflictSymbols: string[];
  };
}

export interface ForecastOptions extends GitOptions {
  /** also run the full Oracle (git merge-tree) for the divergence comparison. */
  vsGit?: boolean;
}

/**
 * THE PRE-MERGE FORECAST — the Oracle's meaning-side prediction as pre-merge UX.
 * Default is the pure meaning forecast (fast, no git merge). With `vsGit` it
 * additionally runs the full Oracle and surfaces the git-reality divergence.
 *
 * READ-ONLY and EPHEMERAL: never writes .warpline/oracle.jsonl (only `oracle` logs).
 */
export async function forecast(
  branchA: string,
  branchB: string,
  opts: ForecastOptions = {},
): Promise<Forecast> {
  const cwd = opts.cwd ?? process.cwd();

  // mergeBase, matching the Oracle's WORKTREE handling.
  const base =
    branchA === WORKTREE_REF || branchB === WORKTREE_REF
      ? 'HEAD'
      : await mergeBase(branchA, branchB, { cwd });

  const [baseState, aState, bState] = await Promise.all([
    absorb(base, { cwd }),
    absorb(branchA, { cwd }),
    absorb(branchB, { cwd }),
  ]);
  const baseTagged: WarpState = { ...baseState, ref: base };

  const deltaA: SemDeltaSet = diff(baseTagged, aState);
  const deltaB: SemDeltaSet = diff(baseTagged, bState);

  const prediction = predict(deltaA, deltaB);
  const decisions = prediction.knots.length + prediction.dangling.length;

  const result: Forecast = {
    branchA,
    branchB,
    mergeBase: base,
    stateIds: { base: baseTagged.stateId, A: aState.stateId, B: bState.stateId },
    verdict: decisions === 0 ? 'CLEAN' : 'DECISIONS',
    decisions,
    autoClean: prediction.autoClean,
    knots: prediction.knots,
    dangling: prediction.dangling,
  };

  if (opts.vsGit) {
    // Reuse the full Oracle for the git-reality + scoring comparison. noWrite so
    // a preview never pollutes the ledger.
    const record = await oracle(branchA, branchB, { cwd, noWrite: true });
    result.vsGit = {
      ...record.convergence,
      gitConflicted: record.gitReality.conflicted,
      conflictSymbols: record.gitReality.conflictSymbols,
    };
  }

  return result;
}

// ── SEMANTIC DIFF ───────────────────────────────────────────────────────────

export interface SemDiffReport {
  refA: string;
  refB: string;
  stateIds: { A: string; B: string };
  born: SemDelta[];
  retired: SemDelta[];
  contractChanged: SemDelta[];
  /** zero-semantic-weight renames (name/path changed, essence identical). */
  renamedNoop: SemDelta[];
  /** N = born+retired+contractChanged (the real semantic changes). */
  changedCount: number;
  /** M = renamed-noop count (the EMPTY deltas — visible proof). */
  renamedNoopCount: number;
}

/**
 * SEMANTIC diff between two refs. absorb both → diff() → group the SemDeltas.
 * READ-ONLY; never writes .warpline/. Defaults are resolved by the CLI:
 *   no args = WORKTREE vs HEAD; one arg = ref vs HEAD; two args = refA vs refB.
 */
export async function semanticDiff(
  refA: string,
  refB: string,
  opts: GitOptions = {},
): Promise<SemDiffReport> {
  const cwd = opts.cwd ?? process.cwd();
  const [aState, bState] = await Promise.all([
    absorb(refA, { cwd }),
    absorb(refB, { cwd }),
  ]);

  // diff(base, branch): A is the base, B is the branch — so born = present in B,
  // retired = present in A only, contract-changed = essence moved A→B.
  const set: SemDeltaSet = diff(aState, bState);

  const born: SemDelta[] = [];
  const retired: SemDelta[] = [];
  const contractChanged: SemDelta[] = [];
  for (const d of set.deltas.values()) {
    if (d.kind === 'symbol-born') born.push(d);
    else if (d.kind === 'symbol-retired') retired.push(d);
    else if (d.kind === 'contract-changed') contractChanged.push(d);
  }
  const bySym = (x: SemDelta, y: SemDelta) => x.symbol.localeCompare(y.symbol);
  born.sort(bySym);
  retired.sort(bySym);
  contractChanged.sort(bySym);
  const renamedNoop = [...set.renames].sort(bySym);

  const changedCount = born.length + retired.length + contractChanged.length;

  return {
    refA,
    refB,
    stateIds: { A: aState.stateId, B: bState.stateId },
    born,
    retired,
    contractChanged,
    renamedNoop,
    changedCount,
    renamedNoopCount: renamedNoop.length,
  };
}
