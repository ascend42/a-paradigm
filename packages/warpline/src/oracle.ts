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
  worktreeAdd,
  worktreeRemove,
  type GitOptions,
} from './git/git-exec.js';

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
  convergence: {
    agreeClean: string[];
    agreeConflict: string[];
    divergeGitOnly: string[];
    divergeMeaningOnly: string[];
    score: number; // |agree| / |agree ∪ diverge|
    verdict: 'CONVERGENT' | 'DIVERGENT';
  };
  justifications: { A: Justification; B: Justification };
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
  const reality = await mergeTree(branchA, branchB, { cwd }).catch(() => ({
    conflicted: false,
    conflictPaths: [] as string[],
  }));

  // map conflict paths → symbols via dir of the .purpose. Use the union of
  // both branch states' objects so a symbol on either side is reachable.
  const conflictDirs = new Set(reality.conflictPaths.map((p) => normalizeDir(p)));
  const conflictSymbols = symbolsInDirs([aState, bState], conflictDirs, repo);

  // 6. score the confusion matrix
  const convergence = score(prediction, conflictSymbols, [aState, bState]);

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
    convergence,
    justifications: { A: justA, B: justB },
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

async function loadBranchIndex(ref: string, cwd: string) {
  if (ref === WORKTREE_REF) {
    const g = await loadLiveGraph(cwd);
    return g.index;
  }
  const tmp = await worktreeAdd(ref, { cwd });
  try {
    const g = await loadLiveGraph(tmp);
    return g.index;
  } finally {
    await worktreeRemove(tmp, { cwd });
  }
}

/** dir of a repo-relative file path (the `.purpose` dirname for symbol mapping). */
function normalizeDir(p: string): string {
  const dir = path.dirname(p);
  return dir === '.' ? '' : dir.replace(/\\/g, '/');
}

/**
 * Symbols whose defining `.purpose` lives in one of the conflicted dirs.
 * filePath in a WarpObject may be absolute (worktree tmp) — reduce to the dir
 * RELATIVE to the repo root if possible, else compare basenames of dirs.
 */
function symbolsInDirs(states: WarpState[], conflictDirs: Set<string>, repo: string): string[] {
  if (conflictDirs.size === 0) return [];
  const result = new Set<string>();
  for (const state of states) {
    for (const obj of state.objects.values()) {
      if (!obj.filePath) continue;
      const dir = relDir(obj.filePath, repo);
      for (const cd of conflictDirs) {
        // a symbol matches a conflict dir if its defining-file dir equals the
        // conflict dir or is nested beneath it (the .purpose covers that subtree).
        if (dir === cd || (cd !== '' && dir.startsWith(cd + '/'))) {
          result.add(obj.symbol);
          break;
        }
      }
    }
  }
  return Array.from(result).sort();
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
function score(
  prediction: Prediction,
  conflictSymbols: string[],
  states: WarpState[],
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

  const agree = agreeClean.length + agreeConflict.length;
  const diverge = divergeGitOnly.length + divergeMeaningOnly.length;
  const denom = agree + diverge;
  const scoreVal = denom === 0 ? 1 : agree / denom;
  const verdict: 'CONVERGENT' | 'DIVERGENT' = diverge === 0 ? 'CONVERGENT' : 'DIVERGENT';

  return {
    agreeClean,
    agreeConflict,
    divergeGitOnly,
    divergeMeaningOnly,
    score: Number(scoreVal.toFixed(4)),
    verdict,
  };
}
