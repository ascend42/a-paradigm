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
  type SnapshotDirOptions,
  type SnapshotAnchor,
  type PathChange,
} from './warp/snapshot.js';
export {
  loadWorktreeIndex,
  saveWorktreeIndex,
  pruneWorktreeIndex,
  worktreeIndexPathOf,
  worktreeIndexDirOf,
  worktreeShardPathOf,
  WORKTREE_INDEX_SCHEMA,
  LEGACY_WORKTREE_INDEX_SCHEMA,
  RACY_WINDOW_MS,
  type WorktreeIndexEntry,
  type LoadedWorktreeIndex,
} from './warp/worktree-index.js';
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
export { predict, type Prediction, type Knot, type Dangle, type KnotRule } from './predict.js';

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
export { recordPick, PickGateRefusal, type RecordPickOptions, type PickResult } from './fabric/pick.js';
export {
  installHook,
  uninstallHook,
  hookStatus,
  hookRemedy,
  hookInstallAdvice,
  resolveInvokingBinary,
  parseBakedBinary,
  type HookState,
  type HookStatus,
  type BakedBinary,
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
export { sealState, summarizeDelta, signStrandForSeal, type SealInput } from './fabric/seal.js';
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
// P3 Lane A2: grades keyed by agentId + symbol, the sidecar survival index, and the
// trust-floor escalation rule (admit's HELD consumer; forge-spec §1d).
export {
  gradeFabric,
  applyGrades,
  readGradeSidecar,
  symbolSurvivalIndex,
  evaluateEscalation,
  recordGradeEscalation,
  listGradeEscalations,
  gradesPathOf,
  escalationsPathOf,
  K_MIN_GRADED,
  SURVIVAL_FLOOR,
  type GradeReport,
  type StrandGrade,
  type GradeOutcome,
  type PriorClass,
  type MoatBucket,
  type GradeSidecarRow,
  type SymbolSurvival,
  type GradeEscalation,
  type GradeEscalationRow,
} from './fabric/grade.js';
export {
  evaluateHazards,
  hazardAdvisory,
  rarityIndex,
  rarityOf,
  extractCodeTokens,
  extractCfgTokens,
  tokensOf,
  recordHazards,
  listHazards,
  hazardsPathOf,
  HAZARD_SCHEMA,
  HAZARD_MIN_SCORE,
  type CleanHazard,
  type CleanHazardRow,
  type HazardKind,
  type HazardDangerFlag,
  type HazardAdvisory,
  type HazardAdvisoryInput,
  type RarityIndex,
} from './fabric/hazard.js';
export {
  admit,
  admitDecision,
  ADMIT_RESULT_SCHEMA,
  type AdmitStatus,
  type AdmitConfidence,
  type AdmitDecision,
  type AdmitOptions,
  type AdmitResult,
  type AdmitResultBody,
  type AdmitClaimReport,
  type AdmitEscalationReport,
} from './fabric/admit.js';
// `refusal:v1` (TD-2026-07-21-766 / falsifier F4) — the MACHINE-READABLE refusal
// every gate hands back, plus the direct-vs-ripple ranking rule it shares with
// the CLI. `refuse` is the SINGLE constructor: no consumer builds the literal;
// `refusalOf` is the SINGLE accessor: no consumer re-derives where one can live.
export {
  refuse,
  refusalOf,
  contestedOf,
  exitCodeFor,
  exitCodeForResult,
  gateFor,
  retriabilityFor,
  REFUSAL_SCHEMA,
  MAX_CONTESTED,
  type Refusal,
  type RefusalCode,
  type RefusalGate,
  type Retriability,
  type RefusalContested,
  type RefusalNextStep,
  type RefusalPointers,
  type RefusalOverride,
  type RefuseInput,
} from './fabric/refusal.js';
export { rankVerdicts, rankOf, type RankedVerdicts } from './fabric/rank.js';
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
// fsck — the M3-lite I5 integrity umbrella: fabric + objects + refs + registry +
// stakes in one read-only pass (reuses the verify functions verbatim).
export {
  runFsck,
  type FsckReport,
  type FsckSection,
  type FsckSections,
  type FsckFinding,
  type FsckLevel,
  type FsckOptions,
} from './fabric/fsck.js';
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
// THE REPAIR PATH (audit C-13 + P1) — detection without repair is a dead end a
// real crash will find: torn-tail salvage + the actionable half of verify's
// abandoned-head report.
export {
  repairFabric,
  setFabricRef,
  RepairRefusal,
  type FabricRepairResult,
  type RepairOptions,
  type DroppedLine,
  type RefSetResult,
} from './fabric/repair.js';
export { readLegacyManifest, scanFabric, type FabricScan, type MalformedLedgerLine } from './fabric/fabric.js';
export type { EpochAnchor } from './fabric/strand.js';
// Restore (M1c) — reconstruct a working tree from the native store with git ABSENT.
export { resolveSelector, type SelectorResolution } from './fabric/select.js';
export {
  restore,
  // C-5 — the per-path dirty-destination guard EVERY byte write-back goes through.
  guardedRestoreTree,
  assertDirtyFree,
  collectDirtyCollisions,
  dirtyDestError,
  type RestoreOptions,
  type RestoreResult,
  type DirtyCollision,
  type DirtyGuardOptions,
} from './fabric/restore.js';
// NATIVE-FIRST R1 (#shadow-gate + #warpline-config) — observe-only admit verdicts
// (the organic evidence clock) + the per-repo config toggle that opts them in.
export { readWarplineConfig, configPathOf, type WarplineConfig, type StakeConfig, type GateConfig } from './fabric/config.js';
// NATIVE-FIRST phase 1 (#stake, T-2026-07-17-001) — the CHECKPOINT VALVE: one-way
// warpline→git stake export (first-parent checkpoints, S1–S5 safeguarded, D5
// constitution-grade deny-list) + the S5 recovery re-entry verb.
export {
  stake,
  stakeRecover,
  stakeMessage,
  parseStakeTrailers,
  stakesDirOf,
  stakeAuditPathOf,
  maybeAutoStakeOnSeal,
  StakeRefusal,
  STAKE_AUDIT_SCHEMA,
  type StakeOptions,
  type StakeResult,
  type StakeRecoverResult,
  type StakeAuditRow,
  type StakeTrailers,
  type AutoStakeOptions,
} from './fabric/stake.js';
export {
  STAKE_MARKER,
  STAKE_MARKER_CONTENT,
  STAKE_SCHEMA,
  STAKE_DEFAULT_BRANCH,
  STAKE_DENYLIST_SCHEMA,
  STAKE_DENY_NAMES,
  STAKE_DENY_PATHS,
  STAKE_DENY_ENVELOPE_KINDS,
  STAKE_DENY_ROW_SCHEMAS,
  STAKE_DENY_ROW_SHAPES,
  stakeDeniedName,
  stakeDeniedPath,
  stakeContentViolation,
  isStakeNamespaceRef,
  assertNotStakeInput,
} from './fabric/stake-guard.js';
export {
  shadowAdmit,
  appendShadowVerdict,
  readShadowVerdicts,
  shadowDirOf,
  shadowVerdictsPathOf,
  SHADOW_VERDICT_SCHEMA,
  SHADOW_ROW_CAP,
  type ShadowVerdictRow,
  type ShadowAdmitResult,
  type ShadowGateMeta,
} from './fabric/shadow.js';
// NATIVE-FIRST phase 0 (#native-write-path, arky-architecture.md §2.1 keystone) —
// fork → propose-seals-a-scratch-strand → admit-weaves → restore, git absent.
export { writeScratchRef } from './fabric/scratch.js';
export {
  forkNative,
  proposeNative,
  admitNative,
  resolveNative,
  // C-10: the agent-class exit, on the public surface beside the verbs it
  // un-wedges (a withdrawal verb a library consumer cannot reach is no exit).
  abandonNative,
  absorbTree,
  scratchRefName,
  type ForkNativeOptions,
  type ForkNativeResult,
  type ProposeNativeOptions,
  type ProposeNativeResult,
  type AdmitNativeOptions,
  type AdmitNativeResult,
  type ResolveNativeOptions,
  type ResolveNativeResult,
  type AbandonNativeResult,
} from './fabric/native.js';
// C-11 (#agent-shell): the CLI half of the human-class law — HUMAN_ONLY_VERBS
// and HUMAN_ONLY_ADMIT_FLAGS enforced on a shell marked by $WARPLINE_AGENT_ID.
export {
  AGENT_ID_ENV,
  HUMAN_ONLY_CLI_PATHS,
  HUMAN_ONLY_CLI_FLAGS,
  agentShellId,
  agentShellRefusal,
  checkHumanClass,
  assertHumanClass,
  cliPathOf,
  type AgentShellViolation,
  type HumanClassCheck,
} from './agent-shell.js';
export {
  computeMergeNative,
  materializeMergedStateNative,
  type MaterializeNativeResult,
} from './fabric/materialize.js';

// NATIVE-FIRST phase 1 (#warplined) — the solo daemon: the fabric with a
// NETWORK FACE (NDJSON over a 0600 unix socket; engine shapes verbatim, G3;
// stage-1 server-stamped identity per aegis-security.md §1.2).
export {
  RPC_SCHEMA,
  DAEMON_VERBS,
  HUMAN_ONLY_VERBS,
  HUMAN_ONLY_ADMIT_FLAGS,
  READ_ONLY_VERBS,
  type DaemonVerb,
  type RpcRequest,
  type RpcResponse,
  type RpcOk,
  type RpcErr,
  type RpcErrorCode,
} from './daemon/protocol.js';
export {
  mintToken,
  readTokens,
  resolveToken,
  listTokenSummaries,
  consoleReadToken,
  tokensPathOf,
  DAEMON_TOKEN_SCHEMA,
  CONSOLE_PRINCIPAL,
  type DaemonToken,
  type Principal,
  type PrincipalKind,
  type TokenScope,
} from './daemon/tokens.js';
// M3-lite I1 (#keys): Ed25519 agent signing keys + the append-only public
// registry with the pin-once signed-from epoch boundary (TD-2026-08-23-136 —
// no passphrase, no root key; the human boundary stays procedural).
export {
  AGENT_KEY_SCHEMA,
  KEY_REGISTRY_SCHEMA,
  KEY_ID_PREFIX,
  STRAND_SIG_DOMAIN,
  isPrincipalName,
  keysDirOf,
  agentKeysDirOf,
  agentKeyPathOf,
  keyRegistryPathOf,
  computeKeyId,
  generateAgentKey,
  signPickId,
  verifyPickIdSig,
  loadAgentKey,
  loadAgentKeyStrict,
  readKeyRegistry,
  registryKeyFor,
  signedFromOf,
  hasSignedFrom,
  mintAgentKey,
  listKeySummaries,
  type GeneratedAgentKey,
  type AgentKeyFile,
  type AgentKeyRegistryRow,
  type SignedFromRegistryRow,
  type KeyRegistryRow,
  type KeyRegistryReadResult,
  type MintAgentKeyResult,
  type KeySummary,
  type KeyListResult,
} from './fabric/keys.js';
// M3-lite I6 (#grants): human-issued auto-resolve grants — a scoped, expiring,
// revocable exception INSIDE the resolve gate (resolve stays HUMAN_ONLY;
// TD-2026-08-23-136 item 4 / §6 Q3). Zero grants = byte-identical to pre-M3.
export {
  GRANT_SCHEMA,
  GRANT_ID_PREFIX,
  GRANT_TTL_MAX_MS,
  GRANT_TTL_DEFAULT_MS,
  grantsDirOf,
  grantsPathOf,
  computeGrantId,
  readGrantStore,
  issueGrant,
  revokeGrant,
  activeGrantFor,
  grantActiveAt,
  listGrantSummaries,
  parseGrantTtl,
  type GrantScope,
  type GrantRow,
  type RevokeRow,
  type GrantStoreRow,
  type GrantStoreReadResult,
  type IssueGrantOptions,
  type IssueGrantResult,
  type RevokeGrantResult,
  type ActiveGrantQuery,
  type GrantAtCheck,
  type GrantSummary,
  type GrantListResult,
} from './fabric/grants.js';
export {
  socketPathOf,
  pidPathOf,
  readPidfile,
  daemonState,
  stopDaemon,
  DAEMON_PIDFILE_SCHEMA,
  type DaemonPidfile,
  type DaemonState,
} from './daemon/lifecycle.js';
export {
  startDaemon,
  readDaemonAudit,
  daemonAuditPathOf,
  DAEMON_AUDIT_SCHEMA,
  type DaemonHandle,
  type StartDaemonOptions,
  type DaemonAuditRow,
} from './daemon/server.js';
export {
  DaemonClient,
  DaemonRpcError,
  daemonAvailable,
  type DaemonStatus,
  type ConnectOptions,
  type ShadowAdmitOverDaemon,
} from './daemon/client.js';

// PHASE 1 close-out (#warpline-backup) — custodianship: atomic fabric
// snapshots (clone-copy, never hardlinks; digest manifest; verify = digest
// recompute + full fabric authentication). A backup IS a home-fabric root —
// opening it with the engine is the restore.
export {
  backupFabric,
  verifyBackup,
  BACKUP_MANIFEST_SCHEMA,
  BACKUP_MANIFEST_BASENAME,
  type BackupResult,
  type BackupManifest,
  type BackupCounts,
  type BackupFileEntry,
  type BackupVerifyReport,
  type BackupVerifyProblem,
  type BackupProblemKind,
} from './fabric/backup.js';

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

// #warpline-root — the root chokepoint (D-7): --root > WARPLINE_ROOT > git > cwd
export {
  resolveRoot,
  setExplicitRoot,
  explicitRootOf,
  extractRootFlag,
  ROOT_ENV,
} from './root.js';

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
