/**
 * #absorb — `absorb(gitRef) -> WarpState`. Lift a git ref to MEANING.
 *
 * Mechanism (READ-ONLY): `materializeTree(ref)` lifts the ref's tree into a temp
 * dir via `git archive | tar` — NO `git worktree`, so it takes no `.git/worktrees`
 * lock and absorbs run concurrently against one repo (T-2026-06-23-003) →
 * `loadLiveGraph(tmp)` (the SAME live-parse pipeline `paradigm ripple` uses; it
 * reads files only, never shells git inside the tree, so a plain dir with no `.git`
 * is sufficient) → lift every SymbolEntry to a WarpObject → compute whole-state
 * essences → build the WarpState → `releaseTree(tmp)` in a `finally`. The user's
 * HEAD/index/worktree are NEVER touched.
 *
 * Special ref `"WORKTREE"` = `loadLiveGraph(process.cwd())` — absorbs the
 * current (possibly uncommitted) state without spinning a worktree.
 *
 * Library code: no console output.
 */

import { loadLiveGraph } from '@a-company/premise-core';
import { buildWarpState, type WarpState } from './warp/warp-state.js';
import { liftCodeUnits, injectCodeUnits } from './lens/lift-code-units.js';
import { assertNotStakeInput } from './fabric/stake-guard.js';
import {
  materializeTree,
  releaseTree,
  revParseTree,
  type GitOptions,
} from './git/git-exec.js';

export const WORKTREE_REF = 'WORKTREE';

export interface AbsorbOptions extends GitOptions {
  /** repo root the git commands run in; also the cwd for the WORKTREE pseudo-ref */
  cwd?: string;
}

/**
 * Absorb a git ref into a WarpState. For real refs this spins a throwaway
 * detached worktree; for the WORKTREE pseudo-ref it parses the live cwd.
 */
export async function absorb(ref: string, opts: AbsorbOptions = {}): Promise<WarpState> {
  const cwd = opts.cwd ?? process.cwd();

  // S1 (checkpoint valve, stake-guard.ts): a stake is a ONE-WAY export — a
  // worktree carrying the .warpline-stake marker, a ref in the stake namespace,
  // or a commit whose tree carries the marker is NEVER absorbed as input. One
  // choke point covers pick (and therefore the auto-seal hook) as well.
  await assertNotStakeInput(ref, cwd, ref === WORKTREE_REF);

  if (ref === WORKTREE_REF) {
    const graph = await loadLiveGraph(cwd);
    // Lift TS/TSX code-units (read-only) and inject them as synthetic nodes in
    // the SAME universe BEFORE essences are computed (spec §2). The lens only
    // reads `cwd`; the read-only invariant is preserved.
    injectCodeUnits(graph.index, await liftCodeUnits(cwd));
    // root = cwd: store WarpObject.filePath repo-relative so the rename-detector
    // in sem-delta never fires on a path-prefix difference between absorbs.
    return buildWarpState(graph.index, { ref: WORKTREE_REF, treeSha: null, rootDir: cwd });
  }

  const treeSha = await revParseTree(ref, { cwd }).catch(() => null);
  const tmp = await materializeTree(ref, { cwd });
  try {
    const graph = await loadLiveGraph(tmp);
    // Lift code-units from the throwaway tree (read-only) and inject them as
    // synthetic nodes BEFORE essence computation (spec §2). The lens only reads
    // `tmp`; the user's HEAD/index/worktree are never touched.
    injectCodeUnits(graph.index, await liftCodeUnits(tmp));
    // root = the temp tree: strip the (per-absorb, nondeterministic) temp-dir
    // prefix so two absorbs of the same ref yield byte-identical, repo-relative
    // filePaths. The temp-dir prefix is provenance noise, never a "move".
    return buildWarpState(graph.index, { ref, treeSha, rootDir: tmp });
  } finally {
    await releaseTree(tmp);
  }
}
