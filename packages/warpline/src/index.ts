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
  strandSnapshotAnchor,
  writeMergedTree,
  captureMerge,
  restoreTree,
  type SnapshotResult,
  type SnapshotAnchor,
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
  computePickIdWholeBody,
  computeLegacyBodyHash,
  reproducesUnderKnownRule,
  buildStrandV3,
  type Strand,
  type StrandBody,
  type StrandDelta,
  type StrandBinding,
  type MergeRecipe,
  type StrandV3Input,
} from './fabric/strand.js';
// v3 PICK-DAG (V3.1, docs/specs/warpline-v3-identity.md) — the derived DAG index:
// position-free identity, deterministic topo order, heads/roots/closure.
export { parentsOf, buildDag, type FabricDag } from './fabric/dag.js';
// pickId refs (V3.2, spec §2) — per-ref tip CAS + the one-time selvage migration.
export {
  readRef,
  writeRef,
  listRefs,
  heads,
  migrateSelvageToRefs,
  type RefsMigrationResult,
} from './fabric/refs.js';
export {
  warplineDirOf,
  readSelvage,
  writeSelvage,
  appendStrand,
  readFabric,
  readLegacyGrandfathered,
  type FabricLegacy,
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
// P2.4 — the injection-safety envelope (forge-spec §3d, T-2026-06-24-013):
// typed untrusted prose, born content-addressed; frame-on-render.
export {
  envelopeProse,
  verifyProse,
  proseAddress,
  frameProse,
  escapeProseBody,
  UNTRUSTED_PROSE_KIND,
  type UntrustedProse,
  type FrameOptions,
} from './envelope.js';
// P2.2 — the machine-readable KNOT payload (forge-spec §3a): the self-sufficient
// resolution work order + the resolution-proposal envelope resolve accepts.
export {
  buildKnotPayload,
  proposalToResolveOptions,
  persistKnotPayload,
  readKnotPayload,
  listKnotPayloads,
  readFileFromTree,
  knotsDirOf,
  KNOT_PAYLOAD_SCHEMA,
  KNOT_PROPOSAL_SCHEMA,
  type KnotPayload,
  type KnotPayloadSide,
  type ContestedUnit,
  type ContestedSideView,
  type RippleSlice,
  type KnotResolutionProposal,
  type BuildKnotPayloadInput,
} from './fabric/knot-payload.js';
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
  type AdmitClaimReport,
} from './fabric/admit.js';
// P2.3 — the claim-scoped propose API (forge-spec §3b): the author's pre-declared
// claim:v1 (the future OFFER metadata), the honesty-check evaluation, and the
// calibration-probe sidecar stream (.warpline/claims/).
export {
  createClaim,
  verifyClaim,
  evaluateClaim,
  persistClaim,
  readClaim,
  claimsDirOf,
  recordClaimEvaluation,
  listClaimEvaluations,
  evaluationsPathOf,
  CLAIM_SCHEMA,
  type Claim,
  type CreateClaimInput,
  type ClaimEvaluation,
  type EvaluateClaimOptions,
  type ClaimEvaluationRow,
} from './fabric/claim.js';
// Fabric verify — authenticate the whole PICK-DAG (integrity + chain + binding + anchor).
export {
  verifyFabric,
  type FabricVerifyReport,
  type FabricVerifyFailure,
  type FabricVerifyKind,
  type VerifyOptions,
} from './fabric/verify.js';
// v1-prefix epoch anchor (docs/specs/warpline-v1-anchor.md) — freeze + attest-once.
export {
  strandDigest,
  computePrefixDigest,
  computeManifestDigest,
  findAnchor,
  assertV1Covered,
  attestFabric,
  type AttestOptions,
  type AttestResult,
} from './fabric/anchor.js';
export { backfillV1Bindings, type BackfillResult } from './fabric/backfill.js';
export { readLegacyManifest } from './fabric/fabric.js';
export type { EpochAnchor } from './fabric/strand.js';
// Restore (M1c) — reconstruct a working tree from the native store with git ABSENT.
export { resolveSelector, type SelectorResolution } from './fabric/select.js';
export { restore, type RestoreOptions, type RestoreResult } from './fabric/restore.js';

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
// Structured-data lens (P3 GAP-1) — JSON/YAML key-trees as meaning.
export { CfgLens, CFG_ESSENCE_TAG } from './lens/cfg-lens.js';
export { isDerivedArtifact, DERIVED_ARTIFACT_BASENAMES } from './lens/derived-artifacts.js';
// Per-path merge honesty labels (P3 GAP-1) — "what did meaning govern?"
export {
  classifyMergePaths,
  type MergeCoverage,
  type CoverageCounts,
  type PathDecision,
} from './honesty.js';

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
