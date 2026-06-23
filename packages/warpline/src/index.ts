/**
 * @a-company/warpline — the Warpline Engine.
 *
 * Phase 1: the Convergence/Divergence Oracle. A READ-ONLY tool that lifts two
 * git branches to a content-addressed store of MEANING (the symbol graph),
 * predicts the merge from meaning (clean / knot / dangling), runs git's actual
 * merge read-only, and scores where meaning and bytes agreed or diverged.
 */

// WARP — essence + objects + state + store
export {
  computeEssences,
  essenceOfSymbol,
  ESSENCE_VERSION,
  type EssenceResult,
} from './warp/essence-hash.js';
export {
  liftToWarp,
  liftEdges,
  entryOf,
  type WarpObject,
  type WarpEdge,
  type WarpEdgeKind,
} from './warp/warp-object.js';
export {
  buildWarpState,
  computeStateId,
  type WarpState,
  type BuildWarpStateOptions,
} from './warp/warp-state.js';
export { WarpStore, serializeState } from './warp/store.js';
export { canonicalSerialize, type CanonicalValue } from './warp/canonical.js';

// ABSORB
export { absorb, WORKTREE_REF, type AbsorbOptions } from './absorb.js';

// SemDelta + algebra
export {
  diff,
  changedSlotsOf,
  type SemDelta,
  type SemDeltaKind,
  type SemDeltaSet,
  type ContractChangeset,
} from './sem-delta.js';
export { predict, type Prediction, type Knot, type Dangle } from './predict.js';

// Justification
export { justify, type Justification, type JustifyOptions } from './justification.js';

// Oracle
export { oracle, type OracleRecord, type OracleOptions } from './oracle.js';

// Weave — the pre-merge MEANING forecast + the semantic-diff report (read-only)
export {
  forecast,
  semanticDiff,
  type Forecast,
  type ForecastOptions,
  type SemDiffReport,
} from './weave.js';

// Code-lens — AST-level code meaning (the TS/TSX lens, stage 2)
export {
  codeCNF,
  codeCNFDetailed,
  type CodeCNFOptions,
  type CodeCNFDetailed,
  type FreeRef,
} from './lens/ts-essence.js';
export {
  type CodeLens,
  type CodeUnit,
  type CodeRef,
  type CodeEdgeKind,
} from './lens/code-lens.js';
export { codeSymbol, codeStableKey } from './lens/code-symbol.js';
export { TsLens, TS_LENS_VERSION } from './lens/ts-lens.js';
export { lensFor, allLenses } from './lens/registry.js';

// git-exec (read-only primitives)
export {
  mergeBase,
  mergeTree,
  revParse,
  revParseTree,
  repoRoot,
  worktreeAdd,
  worktreeRemove,
  type MergeTreeResult,
  type GitOptions,
} from './git/git-exec.js';
