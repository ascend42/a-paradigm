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
// M1a — the native content-addressed object store (byte authority).
export { blobId, gitBlobOid, objectFrame, stripFrame } from './warp/blob.js';
export {
  treeId,
  treeOrder,
  nativeTreeBytes,
  parseTree,
  gitTreeOid,
  gitTreeBytes,
  type TreeEntry,
  type TreeMode,
  type GitTreeEntry,
} from './warp/tree.js';
export { ObjectStore, type VerifyReport } from './warp/object-store.js';
export {
  snapshotDir,
  snapshotRef,
  snapshotState,
  writeMergedTree,
  captureMerge,
  restoreTree,
  type SnapshotResult,
  type PathChange,
} from './warp/snapshot.js';
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

// Fabric — the native write path (Phase 2): seal MEANING into this project's
// OWN history under .warpline/, never git.
export {
  computePickId,
  type Strand,
  type StrandBody,
  type StrandDelta,
  type StrandBinding,
  type MergeRecipe,
} from './fabric/strand.js';
export {
  warplineDirOf,
  readSelvage,
  writeSelvage,
  appendStrand,
  readFabric,
} from './fabric/fabric.js';
export { recordPick, type RecordPickOptions, type PickResult } from './fabric/pick.js';
export {
  installHook,
  uninstallHook,
  hookStatus,
  type HookState,
  type HookStatus,
} from './fabric/hook.js';

// Multi-writer (Phase C v1) — SCRATCH fork + the admission DECISION protocol.
export { forkScratch, readScratch, clearScratch } from './fabric/scratch.js';
// Phase C v2 — meaning→bytes: the token 3-way merge + tree materialization.
export { tokenize, merge3, mergeText, type Merge3Result } from './fabric/merge3.js';
export {
  computeMerge,
  materializeMergedState,
  type MergePlan,
  type MergedFile,
  type MergeConflict,
  type MaterializeResult,
} from './fabric/materialize.js';
export { sealState, summarizeDelta, type SealInput } from './fabric/seal.js';
// Phase C v3 — the KNOT council (human resolution of a genuine conflict).
export { resolveKnot, type ResolveOptions, type ResolveResult } from './fabric/resolve.js';
export type { KnotResolution } from './fabric/strand.js';
// Calibration — grade strand confidence against real survive/overturn outcome (the moat).
export {
  gradeFabric,
  applyGrades,
  type GradeReport,
  type StrandGrade,
  type GradeOutcome,
  type PriorClass,
  type MoatBucket,
} from './fabric/grade.js';
export {
  admit,
  admitDecision,
  type AdmitStatus,
  type AdmitConfidence,
  type AdmitDecision,
  type AdmitOptions,
  type AdmitResult,
} from './fabric/admit.js';

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
