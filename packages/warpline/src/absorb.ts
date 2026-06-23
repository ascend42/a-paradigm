/**
 * #absorb — `absorb(gitRef) -> WarpState`. Lift a git ref to MEANING.
 *
 * Mechanism (READ-ONLY): `git worktree add --detach` the ref into a temp dir →
 * `loadLiveGraph(tmp)` (the SAME live-parse pipeline `paradigm ripple` uses) →
 * lift every SymbolEntry to a WarpObject → compute whole-state essences → build
 * the WarpState → `git worktree remove --force` the temp dir in a `finally`.
 * The user's HEAD/index/worktree are NEVER touched.
 *
 * Special ref `"WORKTREE"` = `loadLiveGraph(process.cwd())` — absorbs the
 * current (possibly uncommitted) state without spinning a worktree.
 *
 * Library code: no console output.
 */

import { loadLiveGraph } from '@a-company/premise-core';
import { buildWarpState, type WarpState } from './warp/warp-state.js';
import {
  worktreeAdd,
  worktreeRemove,
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

  if (ref === WORKTREE_REF) {
    const graph = await loadLiveGraph(cwd);
    // root = cwd: store WarpObject.filePath repo-relative so the rename-detector
    // in sem-delta never fires on a path-prefix difference between absorbs.
    return buildWarpState(graph.index, { ref: WORKTREE_REF, treeSha: null, rootDir: cwd });
  }

  const treeSha = await revParseTree(ref, { cwd }).catch(() => null);
  const tmp = await worktreeAdd(ref, { cwd });
  try {
    const graph = await loadLiveGraph(tmp);
    // root = the temp worktree: strip the (per-absorb, nondeterministic) temp-dir
    // prefix so two absorbs of the same ref yield byte-identical, repo-relative
    // filePaths. The temp-dir prefix is provenance noise, never a "move".
    return buildWarpState(graph.index, { ref, treeSha, rootDir: tmp });
  } finally {
    await worktreeRemove(tmp, { cwd });
  }
}
