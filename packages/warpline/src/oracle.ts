/**
 * #oracle — `oracle(branchA, branchB)`. The Convergence/Divergence Oracle.
 *
 * Flow:
 *   1. mergeBase = git merge-base A B
 *   2. ABSORB base, A, B → three WarpStates
 *   3. ΔA = diff(base, A), ΔB = diff(base, B); synthesize justA/justB
 *   4. predict(ΔA, ΔB) → { autoClean, knots, dangling }
 *   5. GIT REALITY (read-only): git merge-tree --write-tree A B → conflict paths
 *      (fallback: throwaway worktree merge for git <2.38); map paths → symbols
 *      via the dir of the `.purpose`.
 *   6. SCORE the confusion matrix per touched symbol:
 *        knot   ∧ gitConflict → agreeConflict
 *        clean  ∧ gitClean    → agreeClean
 *        clean  ∧ gitConflict → divergeGitOnly      ★ (text noise)
 *        knot   ∧ gitClean    → divergeMeaningOnly   ★ (THE headline)
 *   7. append OracleRecord to .warpline/oracle.jsonl; return it.
 *
 * READ-ONLY forever in Phase 1. The two ★ cells are the experimental result.
 *
 * Library code: no console output (the CLI prints).
 */

import * as path from 'node:path';
import { loadLiveGraph } from '@a-company/premise-core';
import { absorb, WORKTREE_REF } from './absorb.js';
import { diff, type SemDeltaSet } from './sem-delta.js';
import { predict, type Prediction } from './predict.js';
import { justify, type Justification } from './justification.js';
import { type WarpState } from './warp/warp-state.js';
import { WarpStore } from './warp/store.js';
import {
  mergeBase,
  mergeTree,
  repoRoot,
  revParse,
  worktreeAdd,
  worktreeRemove,
  changedPaths,
  type GitOptions,
} from './git/git-exec.js';
import { withRepoLock } from './git/repo-lock.js';
import { classifyMergePaths, type MergeCoverage } from './honesty.js';
import { evaluateHazards, type CleanHazard } from './fabric/hazard.js';
import { readHazardConfig } from './fabric/config.js';

export interface OracleRecord {
  schemaVersion: 1;
  ts: string;
  repo: string;
  branchA: string;
  branchB: string;
  mergeBase: string;
  stateIds: { base: string; A: string; B: string };
  prediction: {
    autoClean: string[];
    knots: Prediction['knots'];
    dangling: Prediction['dangling'];
  };
  gitReality: {
    conflicted: boolean;
    conflictSymbols: string[];
    conflictPaths: string[];
  };
  /**
   * The ACTIONABLE answer — is this weave CLEAN? (no meaning knots, no dangling, AND
   * git merges clean). Kept SEPARATE from `convergence`, which measures meaning⟷git
   * AGREEMENT: a contested merge BOTH sides predict is "convergent agreement" (score
   * may be 1) but is NOT clean. Read mergeClean for "is it safe to weave?", read
   * convergence for "did meaning agree with bytes?" (the experiment). (T-2026-06-25-005)
   */
  mergeClean: boolean;
  convergence: {
    agreeClean: string[];
    agreeConflict: string[];
    divergeGitOnly: string[];
    divergeMeaningOnly: string[];
    /**
     * Git conflict PATHS that mapped to NO symbol — a git-only divergence the
     * meaning lens is blind to (GAP-1: a conflict in a non-symbol file like
     * README.md, or an unresolvable/pseudo-ref merge). These MUST count against
     * convergence, else a real git conflict reads green (T-2026-06-25-001).
     */
    gitConflictUnmapped: string[];
    /**
     * DIRECT-CONTESTED / KNOT-SIZE RANKING of the divergeMeaningOnly flag set
     * (T-2026-07-03-002, additive — verdict/score semantics untouched).
     * Ground truth (275 real merges, 18 flags): flag-sets ≤6 symbols were 50%
     * churn-validated; every ≥10-symbol set (incl. 48-176-symbol essence-
     * transitivity avalanches from ~2 contested units) was 0%. So the record
     * partitions the flags:
     *   directContested — the unit's OWN content changed on ≥1 side (the knot)
     *   rippleOnly      — flagged only because edge-target essences shifted
     *                     transitively (Merkle-by-target)
     * knotSize (= directContested.length) is the ranking/threshold key;
     * flagCount (= divergeMeaningOnly.length) is the raw pre-ranking volume.
     */
    directContested: string[];
    rippleOnly: string[];
    knotSize: number;
    flagCount: number;
    score: number; // |agree| / |agree ∪ diverge|
    verdict: 'CONVERGENT' | 'DIVERGENT';
  };
  justifications: { A: Justification; B: Justification };
  /**
   * P3 GAP-1 (G1-additive, schemaVersion unchanged): per-path HONESTY labels over
   * every path base→A or base→B touched — which tier GOVERNS each (meaning-decided
   * / byte-decided / derived) + the aggregate counts (#honesty). "What fraction of
   * this merge did meaning govern?" Present only when both refs are real git refs
   * (a WORKTREE pseudo-ref has no diffable path inventory). Never a verdict input.
   */
  coverage?: MergeCoverage;
  /**
   * T-2026-08-11-016 (G1-additive, schemaVersion unchanged): the CLEAN-hazard
   * ADVISORY (#hazard) for the FORECAST surface — LEXICAL couplings the symbol
   * graph did not model, present ONLY when the forecast is MEANING-CLEAN (no
   * knots, no dangling — the admit-CLEAN equivalent) and at least one fired.
   *
   * PARITY WITH ADMIT, NOT A NEW GATE. The oracle/weave preview was hazard-BLIND
   * while `admit` surfaced these, so a jointly-wrong (config × code) pair previewed
   * as an unqualified CLEAN and admitted with a warning — the preview was MORE
   * optimistic than the act. Same helper (`fabric/hazard.evaluateHazards`) as the
   * two admit paths, so they cannot diverge. ADVISORY-ONLY and it is load-bearing:
   * nothing here moves `mergeClean`, `convergence`, or the verdict — a forecast
   * with hazards is still whatever it was without them.
   */
  hazards?: CleanHazard[];
}

export interface OracleOptions extends GitOptions {
  /** suppress the .warpline/oracle.jsonl append (tests) */
  noWrite?: boolean;
}

export async function oracle(
  branchA: string,
  branchB: string,
  opts: OracleOptions = {},
): Promise<OracleRecord> {
  const cwd = opts.cwd ?? process.cwd();
  const repo = await repoRoot({ cwd }).catch(() => cwd);

  // 1. merge-base
  const base =
    branchA === WORKTREE_REF || branchB === WORKTREE_REF
      ? 'HEAD'
      : await mergeBase(branchA, branchB, { cwd });

  // 2. absorb
  const [baseState, aState, bState] = await Promise.all([
    absorb(base, { cwd }),
    absorb(branchA, { cwd }),
    absorb(branchB, { cwd }),
  ]);
  // tag the base state's ref for readability
  const baseTagged: WarpState = { ...baseState, ref: base };

  // 3. diffs
  const deltaA: SemDeltaSet = diff(baseTagged, aState);
  const deltaB: SemDeltaSet = diff(baseTagged, bState);

  // branch indices for justification blast-radius (re-parse cheaply via absorb's
  // path; we reload to get the SymbolIndex). For WORKTREE we use cwd.
  const [indexA, indexB] = await Promise.all([
    loadBranchIndex(branchA, cwd),
    loadBranchIndex(branchB, cwd),
  ]);

  const [justA, justB] = await Promise.all([
    justify(baseTagged, aState, deltaA, { cwd, branchIndex: indexA }),
    justify(baseTagged, bState, deltaB, { cwd, branchIndex: indexB }),
  ]);

  // 4. predict from meaning
  const prediction = predict(deltaA, deltaB);

  // 5. git reality (read-only)
  //
  // A FAILED MEASUREMENT IS NOT A CLEAN MERGE. This `catch` used to answer
  // `conflicted: false` for ANY failure — a bad ref, a broken repo, git absent —
  // and `conflicted: false` is not a neutral default here: `score()` gates the
  // confusion matrix on it, so an unmeasurable merge was scored as "git merged
  // clean", which is precisely the cell that FLATTERS the headline claim
  // ("meaning caught what bytes missed"). The instrument that measures our own
  // claim was failing toward the favourable answer. #git-counterfactual already
  // learned this one field over and says so in its header: "git said clean" and
  // "we never asked git" are opposite facts.
  //
  // PRE-FLIGHT, mirroring counterfactual.ts: a side git cannot resolve must
  // never reach merge-tree, because `git merge-tree --write-tree` exits 1 for
  // BOTH "conflicted" and "not something we can merge" — so git-exec reports an
  // unresolvable ref as a CONFLICT. Checking first keeps that conflation out of
  // the scored record without touching the shared merge semantics every other
  // caller (admit, weave, the counterfactual) depends on.
  //
  // The oracle FAILS LOUD rather than carrying an `unavailable` state: unlike a
  // shadow row, which is one observation among many and must survive a hole, an
  // OracleRecord IS the scored verdict. A record whose git side was never
  // measured has nothing to score, and emitting one would put a fabricated cell
  // into the only evidence base for the claim.
  for (const ref of [branchA, branchB]) {
    if (ref === WORKTREE_REF) continue; // uncommitted by construction; handled below
    try {
      await revParse(`${ref}^{commit}`, { cwd });
    } catch {
      throw new Error(
        `warpline: oracle cannot measure git reality — '${ref}' does not resolve to a commit. ` +
          `Refusing to score a confusion matrix against a merge that was never performed ` +
          `(an unmeasured merge is not a clean one).`,
      );
    }
  }
  const reality = await mergeTree(branchA, branchB, { cwd }).catch((err: unknown) => {
    throw new Error(
      `warpline: oracle cannot measure git reality — merging '${branchA}' and '${branchB}' failed: ` +
        `${err instanceof Error ? err.message : String(err)}. ` +
        `Refusing to score this as a clean merge.`,
    );
  });

  // map conflict paths → symbols via dir of the .purpose, AND keep the paths that
  // mapped to NO symbol (git-only divergences the meaning lens can't see).
  const { conflictSymbols, unmappedPaths } = mapConflicts(
    [aState, bState],
    reality.conflictPaths,
    repo,
  );

  // 6. score the confusion matrix — gitReality.conflicted MUST gate the verdict so
  // a git conflict in a non-symbol file (or an unresolvable merge) can't read green.
  const convergence = score(prediction, conflictSymbols, [aState, bState], {
    gitConflicted: reality.conflicted,
    unmappedConflictPaths: unmappedPaths,
    pathsEnumerated: reality.conflictPaths.length > 0,
  });

  // The actionable "is it safe to weave?" answer — independent of the agreement metric.
  const mergeClean =
    prediction.knots.length === 0 && prediction.dangling.length === 0 && !reality.conflicted;

  // P3 GAP-1 honesty labels (additive): classify every path either side touched.
  // Real refs only (WORKTREE has no diffable inventory); a coverage failure never
  // fails the oracle — the labels are presentation, not a verdict input.
  let coverage: MergeCoverage | undefined;
  if (branchA !== WORKTREE_REF && branchB !== WORKTREE_REF) {
    try {
      const touched = new Set<string>([
        ...(await changedPaths(base, branchA, { cwd })),
        ...(await changedPaths(base, branchB, { cwd })),
      ]);
      coverage = classifyMergePaths(touched, [aState, bState]);
    } catch {
      /* additive — the record stands without coverage */
    }
  }

  // #hazard (T-2026-08-11-016): the CLEAN-hazard advisory on the FORECAST, so the
  // preview is never MORE optimistic than the admit it forecasts. Computed for the
  // MEANING-CLEAN case only (the admit-CLEAN equivalent) via the same helper both
  // admit paths use. Advisory-only: it touches no field above.
  const hazards = forecastHazards(
    baseTagged,
    aState,
    bState,
    prediction.knots.length === 0 && prediction.dangling.length === 0,
    hazardMinScore(repo || cwd),
  );

  const record: OracleRecord = {
    schemaVersion: 1,
    ts: new Date().toISOString(),
    repo,
    branchA,
    branchB,
    mergeBase: base,
    stateIds: { base: baseTagged.stateId, A: aState.stateId, B: bState.stateId },
    prediction: {
      autoClean: prediction.autoClean,
      knots: prediction.knots,
      dangling: prediction.dangling,
    },
    gitReality: {
      conflicted: reality.conflicted,
      conflictSymbols,
      conflictPaths: reality.conflictPaths,
    },
    mergeClean,
    convergence,
    justifications: { A: justA, B: justB },
    ...(coverage ? { coverage } : {}),
    ...(hazards.length ? { hazards } : {}),
  };

  // 7. append to ledger
  if (!opts.noWrite) {
    const storeRoot = repo || cwd;
    const store = new WarpStore(storeRoot, { diskCache: true });
    store.putState(baseTagged);
    store.putState(aState);
    store.putState(bState);
    store.appendJsonl('oracle.jsonl', record);
  }

  return record;
}

/* ── #hazard on the FORECAST surface (T-2026-08-11-016) ──────────────────────────
 *
 * The CLEAN-hazard advisory (#hazard) was wired ONLY into `fabric/admit.ts`, so
 * the oracle and `weave --preview` forecasts were hazard-BLIND for the very case
 * the advisory CAN catch: a jointly-wrong (config × code) pair previewed as an
 * unqualified CLEAN, while the SAME merge through admit surfaced the coupling. A
 * preview must never be MORE optimistic than the act it forecasts.
 *
 * The advisory is ADVISORY-ONLY on both surfaces — `evaluateHazards` returns [] for
 * any status but CLEAN and only ever ADDS a `hazards` key; it moves no verdict, no
 * `mergeClean`, no `convergence`. These wrappers own the forecast plumbing (the
 * meaning-clean gate + the config read); the SIGNAL is `fabric/hazard`'s, unchanged,
 * so the preview and the two admit paths cannot diverge on what fires. */

/** The forecast's config gate: 'off' skips the advisory; `minScore` tightens it. */
interface HazardForecastCfg {
  off: boolean;
  minScore?: number;
}

/** Read the project's `hazard` config the way admit does (default: mode 'advise'). */
function hazardMinScore(root: string): HazardForecastCfg {
  try {
    const cfg = readHazardConfig(root);
    return { off: cfg.mode === 'off', ...(cfg.minScore !== undefined ? { minScore: cfg.minScore } : {}) };
  } catch {
    return { off: false };
  }
}

/**
 * The CLEAN-hazard advisory for a pre-merge FORECAST, from already-absorbed states.
 * `meaningClean` is the admit-CLEAN equivalent (no knots, no dangling); the advisory
 * rides ONLY a meaning-clean forecast, exactly as `evaluateHazards` rides only a
 * CLEAN admit. PURE + fail-safe: a throw yields no advisory, never a failed forecast.
 */
export function forecastHazards(
  base: WarpState,
  ours: WarpState,
  theirs: WarpState,
  meaningClean: boolean,
  cfg: HazardForecastCfg = { off: false },
): CleanHazard[] {
  if (!meaningClean || cfg.off) return [];
  try {
    return evaluateHazards(
      base,
      ours,
      theirs,
      { status: 'CLEAN' },
      cfg.minScore !== undefined ? { minScore: cfg.minScore } : {},
    );
  } catch {
    return []; // an advisory must never break a read-only preview
  }
}

/**
 * The CLEAN-hazard advisory for `weave --preview` from two refs. `weave.forecast`
 * (another worker's file, and outside this change's edit scope) does not expose its
 * absorbed states, so the preview surface recomputes the meaning side here — the
 * same base/absorb/diff/predict the forecast runs, read-only and ephemeral. A
 * throw anywhere degrades to "no advisory", never a failed preview.
 */
export async function forecastHazardsFromRefs(
  branchA: string,
  branchB: string,
  opts: GitOptions = {},
): Promise<CleanHazard[]> {
  const cwd = opts.cwd ?? process.cwd();
  try {
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
    const prediction = predict(diff(baseTagged, aState), diff(baseTagged, bState));
    const meaningClean = prediction.knots.length === 0 && prediction.dangling.length === 0;
    const repo = await repoRoot({ cwd }).catch(() => cwd);
    return forecastHazards(baseTagged, aState, bState, meaningClean, hazardMinScore(repo));
  } catch {
    return [];
  }
}

async function loadBranchIndex(ref: string, cwd: string) {
  if (ref === WORKTREE_REF) {
    const g = await loadLiveGraph(cwd);
    return g.index;
  }
  // SERIALIZED PER REPO (#repo-lock). `git worktree add` VALIDATES the whole
  // `.git/worktrees/` registry as it runs, so a sibling that is mid-create — its
  // directory present but `commondir` not yet written — fails the add outright
  // ("failed to read .git/worktrees/<other>/commondir"). Unique leaf names do not
  // help: the collision is not on the name, it is on the shared registry.
  //
  // This raced with ITSELF on every oracle run, not merely under test load: the
  // caller resolves both branches through `Promise.all`, so two concurrent adds
  // against one repo are the DESIGNED path. It surfaced as unrelated red across
  // divergence-proof/oracle/absorb whenever the machine was busy.
  //
  // git-exec's merge-tree fallback already takes this lock and its comment called
  // itself "the one remaining .git/worktrees user" — which was untrue while these
  // two calls existed. Taking the same lock makes that statement true again, and
  // costs only the serialization of two short reads on ONE repo (distinct repos
  // still run free, since the mutex is keyed by repo root).
  const root = await repoRoot({ cwd }).catch(() => cwd);
  return withRepoLock(root, async () => {
    const tmp = await worktreeAdd(ref, { cwd });
    try {
      const g = await loadLiveGraph(tmp);
      return g.index;
    } finally {
      await worktreeRemove(tmp, { cwd });
    }
  });
}

/** dir of a repo-relative file path (the `.purpose` dirname for symbol mapping). */
function normalizeDir(p: string): string {
  const dir = path.dirname(p);
  return dir === '.' ? '' : dir.replace(/\\/g, '/');
}

/**
 * Map git conflict PATHS to symbols (a symbol whose defining-file dir equals or is
 * nested beneath a conflict dir). Returns BOTH the mapped symbols AND the conflict
 * paths that mapped to NO symbol. The latter are git-only divergences the meaning
 * lens is blind to (GAP-1: a conflict in a non-symbol file like README.md) and MUST
 * still count against convergence — else the oracle lies green (T-2026-06-25-001).
 * filePath in a WarpObject may be absolute (worktree tmp) — reduce to the dir
 * RELATIVE to the repo root if possible.
 */
function mapConflicts(
  states: WarpState[],
  conflictPaths: string[],
  repo: string,
): { conflictSymbols: string[]; unmappedPaths: string[] } {
  if (conflictPaths.length === 0) return { conflictSymbols: [], unmappedPaths: [] };
  const conflictDirs = new Set(conflictPaths.map((p) => normalizeDir(p)));
  const symbols = new Set<string>();
  const mappedDirs = new Set<string>();
  for (const state of states) {
    for (const obj of state.objects.values()) {
      if (!obj.filePath) continue;
      const dir = relDir(obj.filePath, repo);
      for (const cd of conflictDirs) {
        // a symbol matches a conflict dir if its defining-file dir equals the
        // conflict dir or is nested beneath it (the .purpose covers that subtree).
        if (dir === cd || (cd !== '' && dir.startsWith(cd + '/'))) {
          symbols.add(obj.symbol);
          mappedDirs.add(cd);
        }
      }
    }
  }
  const unmappedPaths = conflictPaths.filter((p) => !mappedDirs.has(normalizeDir(p)));
  return { conflictSymbols: Array.from(symbols).sort(), unmappedPaths };
}

/**
 * Reduce a (possibly absolute, possibly tmp-worktree) filePath to a dir path
 * relative to the repo. The worktree tmp path won't share repo's prefix, so we
 * fall back to the path AFTER the worktree root by stripping everything up to
 * and including a `tree/` segment if present; otherwise use the dir as-is.
 */
function relDir(filePath: string, repo: string): string {
  let p = filePath.replace(/\\/g, '/');
  // strip a leading worktree tmp prefix: .../warpline-wt-XXXX/tree/<rel>
  const m = p.match(/warpline-wt-[^/]+\/tree\/(.*)$/);
  if (m) {
    p = m[1];
  } else if (repo && p.startsWith(repo + '/')) {
    p = p.slice(repo.length + 1);
  }
  const dir = path.posix.dirname(p);
  return dir === '.' ? '' : dir;
}

/**
 * Partition every touched/conflicted symbol into the confusion matrix.
 * Meaning-conflict = a symbol that is a knot OR dangle target/source.
 * The partition is over the UNION of meaning-touched symbols and git-conflict
 * symbols, keyed by readable symbol name.
 */
// Exported for unit testing the confusion-matrix partition directly (the git×meaning
// 2×2). Every cell — incl. agreeConflict and divergeGitOnly — must be positively
// exercised, not just asserted empty. (T-2026-06-24-006)
export function score(
  prediction: Prediction,
  conflictSymbols: string[],
  states: WarpState[],
  gitReality?: {
    /** did git's real merge conflict? */
    gitConflicted: boolean;
    /** conflict paths that mapped to NO symbol (git-only divergence; GAP-1). */
    unmappedConflictPaths: string[];
    /** did git enumerate any conflict paths at all? (false ⇒ indeterminate) */
    pathsEnumerated: boolean;
  },
): OracleRecord['convergence'] {
  // meaning-conflicted symbol NAMES (knots by symbol; dangles by fromSymbol).
  const meaningConflict = new Set<string>();
  for (const k of prediction.knots) meaningConflict.add(k.symbol);
  for (const d of prediction.dangling) meaningConflict.add(d.fromSymbol);

  const gitConflict = new Set(conflictSymbols);

  // The universe to classify: meaning-conflicted ∪ git-conflicted ∪ autoClean
  // symbols. autoClean is keyed by stableKey; resolve to names via the states.
  const keyToName = new Map<string, string>();
  for (const state of states) {
    for (const obj of state.objects.values()) keyToName.set(obj.stableKey, obj.symbol);
  }
  const autoCleanNames = new Set<string>();
  for (const key of prediction.autoClean) {
    const name = keyToName.get(key);
    if (name) autoCleanNames.add(name);
  }

  const universe = new Set<string>([
    ...meaningConflict,
    ...gitConflict,
    ...autoCleanNames,
  ]);

  const agreeClean: string[] = [];
  const agreeConflict: string[] = [];
  const divergeGitOnly: string[] = [];
  const divergeMeaningOnly: string[] = [];

  for (const sym of universe) {
    const m = meaningConflict.has(sym);
    const g = gitConflict.has(sym);
    if (m && g) agreeConflict.push(sym);
    else if (!m && !g) agreeClean.push(sym);
    else if (!m && g) divergeGitOnly.push(sym);
    else divergeMeaningOnly.push(sym); // m && !g
  }

  agreeClean.sort();
  agreeConflict.sort();
  divergeGitOnly.sort();
  divergeMeaningOnly.sort();

  // ── DIRECT-CONTESTED / KNOT-SIZE RANKING (additive; T-2026-07-03-002) ──
  // Partition the divergeMeaningOnly flag set by the prediction's per-unit
  // direct flags. A symbol is DIRECT if ANY knot/dangle carrying its name is
  // direct; absent flags (hand-built fixtures, older callers) default to
  // direct — unknown is surfaced, never silently collapsed into ripple.
  const directByName = new Map<string, boolean>();
  for (const k of prediction.knots) {
    directByName.set(k.symbol, (directByName.get(k.symbol) ?? false) || (k.direct ?? true));
  }
  for (const d of prediction.dangling) {
    directByName.set(
      d.fromSymbol,
      (directByName.get(d.fromSymbol) ?? false) || (d.direct ?? true),
    );
  }
  const directContested = divergeMeaningOnly.filter((s) => directByName.get(s) ?? true);
  const rippleOnly = divergeMeaningOnly.filter((s) => !(directByName.get(s) ?? true));

  // Git-only divergences with NO symbol home (a conflict in a non-symbol file).
  const gitConflictUnmapped = (gitReality?.unmappedConflictPaths ?? []).slice().sort();

  // INDETERMINATE: git said conflicted but produced zero matrix evidence — no
  // conflicted symbol, no unmapped path (e.g. a pseudo-ref or a merge git couldn't
  // resolve to paths). It must NOT read CONVERGENT.
  const gitUnaccounted =
    !!gitReality?.gitConflicted &&
    agreeConflict.length === 0 &&
    divergeGitOnly.length === 0 &&
    gitConflictUnmapped.length === 0;

  const agree = agreeClean.length + agreeConflict.length;
  // diverge = symbol-level (git/meaning) + path-level (unmapped) + the indeterminate unit.
  const diverge =
    divergeGitOnly.length +
    divergeMeaningOnly.length +
    gitConflictUnmapped.length +
    (gitUnaccounted ? 1 : 0);
  const denom = agree + diverge;
  const scoreVal = denom === 0 ? 1 : agree / denom;
  const verdict: 'CONVERGENT' | 'DIVERGENT' = diverge === 0 ? 'CONVERGENT' : 'DIVERGENT';

  return {
    agreeClean,
    agreeConflict,
    divergeGitOnly,
    divergeMeaningOnly,
    gitConflictUnmapped,
    directContested,
    rippleOnly,
    knotSize: directContested.length,
    flagCount: divergeMeaningOnly.length,
    score: Number(scoreVal.toFixed(4)),
    verdict,
  };
}
