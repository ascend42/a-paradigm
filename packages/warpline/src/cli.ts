#!/usr/bin/env node
/**
 * #warpline-cli — the Warpline command line. Thin output; no blockquotes.
 *
 *   warpline oracle <branchA> <branchB> [--json]   run the Convergence/Divergence Oracle
 *   warpline absorb <ref> [--json]                 lift a ref to a WarpState and dump it
 *   warpline weave --preview <A> <B> [--json]      THE PRE-MERGE FORECAST (meaning)
 *   warpline consolidate <refs...> [--base R]      THE N-WAY FOLD FORECAST (meaning)
 *   warpline status [--json]                       working-tree MEANING vs HEAD
 *   warpline health [--json]                       READ-ONLY: is the fabric sound, is the
 *                                                  hook reaching, is anything MEASURED?
 *   warpline lifeline <symbol> [--max N] [--json]  meaning-aware blame (survives renames)
 *   warpline diff [refA] [refB] [--json]           SEMANTIC diff between two refs
 *   warpline knot show <selector> [--json]         a KNOT payload (forge-spec §3a) — the
 *                                                  self-sufficient resolution work order
 *
 * This is the ONLY file allowed to write to stdout — library code stays quiet.
 */

import { Command } from 'commander';
import { absorb, WORKTREE_REF } from './absorb.js';
import { oracle, forecastHazardsFromRefs, type OracleRecord } from './oracle.js';
import type { CleanHazard } from './fabric/hazard.js';
import {
  forecast,
  semanticDiff,
  type Forecast,
  type SemDiffReport,
} from './weave.js';
import { consolidate, type ConsolidateForecast } from './consolidate.js';
import { lifeline, type Lifeline } from './lifeline.js';
import type { ContractChangeset } from './sem-delta.js';
import { changedSlotsOf } from './sem-delta.js';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serializeState } from './warp/store.js';
import { ObjectStore } from './warp/object-store.js';
import { snapshotDir } from './warp/snapshot.js';
import type { WarpState } from './warp/warp-state.js';
import { recordPick, type PickResult } from './fabric/pick.js';
import { warplineDirOf, readSelvage, readFabric } from './fabric/fabric.js';
import type { Strand } from './fabric/strand.js';
import { installHook, uninstallHook, hookStatus, resolveInvokingBinary } from './fabric/hook.js';
import { forkScratch } from './fabric/scratch.js';
import { admit, type AdmitResult } from './fabric/admit.js';
import { exitCodeForResult, exitCodeFor, RefusedError, refuse } from './fabric/refusal.js';
import { traceCli, cliTarget } from './f4/cli-trace.js';
import { rankVerdicts } from './fabric/rank.js';
import { shadowAdmit } from './fabric/shadow.js';
import {
  forkNative,
  proposeNative,
  admitNative,
  resolveNative,
  abandonNative,
} from './fabric/native.js';
import { checkHumanClass, agentShellId } from './agent-shell.js';
import { protectBranch, unprotectBranch, listProtected, type PrincipalClass } from './fabric/protected.js';
import { initWarpline, type InitResult } from './fabric/init.js';
import { nativeStatus, gitHeadReachable, type DiskHonesty } from './native-status.js';
import { noteWarpignoreDeprecation } from './warp/warpignore.js';
import { worktreeChangeCount } from './git/git-exec.js';
import { createClaim, persistClaim, type CreateClaimInput } from './fabric/claim.js';
import { resolveKnot } from './fabric/resolve.js';
import { readKnotPayload, type KnotPayload, type ContestedUnit } from './fabric/knot-payload.js';
import { frameProse, escapeProseBody, envelopeProse } from './envelope.js';
import { gradeFabric, applyGrades, type GradeReport } from './fabric/grade.js';
import { verifyFabric } from './fabric/verify.js';
import { runFsck, type FsckSection } from './fabric/fsck.js';
import { listRefs, heads, migrateSelvageToRefs } from './fabric/refs.js';
import { repairFabric, setFabricRef, type FabricRepairResult, type RefSetResult } from './fabric/repair.js';
import { attestFabric } from './fabric/anchor.js';
import { backfillV1Bindings } from './fabric/backfill.js';
import { restore, type RestoreResult } from './fabric/restore.js';
import {
  createBranch,
  listBranches,
  deleteBranch,
  switchBranch,
  type CreateBranchResult,
  type DeleteBranchResult,
  type SwitchResult,
  type BranchInfo,
} from './fabric/branch.js';
import { mergeBranch, type MergeBranchResult } from './fabric/merge.js';
import { readHead, DEFAULT_BRANCH } from './fabric/head.js';
import { branchGraph, ancestorsOf, diffTrees, type BranchGraph, type GraphNode, type TreeDiff } from './fabric/graph.js';
import { resolveSelector } from './fabric/select.js';
import { parentsOf } from './fabric/dag.js';
import { stake, stakeRecover, type StakeResult, type StakeRecoverResult } from './fabric/stake.js';
import { mintAgentKey, listKeySummaries, keyRegistryPathOf } from './fabric/keys.js';
import {
  issueGrant,
  revokeGrant,
  listGrantSummaries,
  activeGrantFor,
  parseGrantTtl,
  grantsPathOf,
  GRANT_TTL_MAX_MS,
} from './fabric/grants.js';
import { STAKE_MARKER } from './fabric/stake-guard.js';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { gitPath } from './git/git-exec.js';
import { resolveRoot, setExplicitRoot, extractRootFlag, ROOT_ENV, type RootArm } from './root.js';
import { health, healthExitCode, type HealthReport } from './health.js';
import { startDaemon } from './daemon/server.js';
import { mintToken, listTokenSummaries, writeMcpTokenFile, type TokenScope } from './daemon/tokens.js';
import { runMcpServer } from './mcp/server.js';
import { backupFabric, verifyBackup, type BackupResult, type BackupVerifyReport } from './fabric/backup.js';
import { daemonState, stopDaemon, socketPathOf } from './daemon/lifecycle.js';
import { DaemonClient } from './daemon/client.js';
import { spawn, execFile } from 'node:child_process';
import {
  runFieldOracle,
  greenGatePathOf,
  type CheckRunner,
  type CheckSpec,
  type FieldOracleRunResult,
  type OracleRow,
} from './field/oracle.js';
import { collectFieldCards, writeCards, byteDowngradesPathOf, fieldCardsDirOf, type WriteCardsResult, type FieldCards } from './field/cards.js';
import { recordGitFallback, listGitFallbacks, gitFallbackPathOf, type GitFallbackEntry } from './field/fallback.js';
import { runFieldJudge, fakeFieldCallModel, fieldJudgeLedgerPathOf, type FieldJudgeResult } from './field/judge-run.js';
import { joinFieldVerdicts, type FieldJoinResult } from './field/join.js';
import { scoreFieldRunFromDisk, renderFieldReport, fieldReportMarkdownPathOf, fieldReportJsonPathOf, type FieldScore } from './field/score.js';
import { liveCallModel } from './judge/judge-run.js';
import { seedsDirOf, loadSeedCardsFromDir, type SeedCardSets } from './field/interleave.js';
import {
  sealCardSet,
  starterInjectionCorpusCards,
  buildPlantedControlCard,
  DEFAULT_PLANTED_PAIR,
  recomputeCardId,
  type SealCardInput,
  type SealResult,
} from './field/seed-authoring.js';
import { initSubject, type InitSubjectResult } from './field/subject-bootstrap.js';
import type { RatingCard } from './judge/rating-card.js';

// The shared .purpose parser (library code, purpose/core/aggregator) console.warns
// about unrelated schema-invalid files (e.g. a stale conductor .purpose) on every
// absorb — which floods the CLI (220+ lines/run) and makes it look broken to a
// newcomer. Silence library console noise for the CLI run unless WARPLINE_DEBUG.
// Real failures go through fail() → process.stderr, so they still surface.
if (!process.env.WARPLINE_DEBUG) {
  console.warn = () => {};
  console.error = () => {};
}

const program = new Command();

/**
 * THE CLI HALF OF THE HUMAN-CLASS LAW (audit C-11 / Aegis M-1) — #agent-shell
 * decides, this records and throws.
 *
 * Ordering is load-bearing and copied from the MCP skin's D-2 fix: the ATTEMPT
 * is written to the f4 trace BEFORE the refusal propagates, because W3
 * (escalation-violation) is computed from rows — a violation that is refused but
 * unrecorded makes "zero W3 marks" a predicate that cannot fail. On an UNMARKED
 * (human) shell this returns immediately having done nothing at all: no trace
 * row, no throw, no observable difference from before the gate existed.
 *
 * M3-lite I6 (the Q3 ruling): an ACTIVE auto-resolve grant (#grants) is an
 * exception INSIDE this gate for `resolve` ONLY — the verb stays in
 * HUMAN_ONLY_VERBS (frozen descriptors untouched); every other human-class
 * verb/flag refuses regardless of grants. The gate is where the ACTING
 * principal is known (the shell marker — authoredBy on the strand names the
 * CONTESTED agent even for a human resolve), so on allow the grantId is
 * RETURNED and the resolve action threads it into the seal (`underGrant`).
 * Unmarked (human) shells always return underGrant:null; a marked shell on a
 * zero-grant repo takes the identical refusal as before, byte for byte.
 */
async function gateHumanClass(spec: {
  root: string;
  /** the CLI command path, matched against HUMAN_ONLY_CLI_PATHS. */
  cliPath: string;
  /** the daemon verb to RECORD the attempt under (CLI_VERB_MAP's value). */
  verb: string;
  target: string | null;
  /** parsed options, keyed by HUMAN_ONLY_ADMIT_FLAGS param names. */
  flags?: Record<string, unknown>;
}): Promise<{ underGrant: string | null }> {
  const violation = checkHumanClass({ cliPath: spec.cliPath, ...(spec.flags ? { flags: spec.flags } : {}) });
  if (!violation) return { underGrant: null }; // unmarked shell — presumed human
  if (violation.verb === 'resolve' && violation.flags.length === 0) {
    const grant = activeGrantFor(spec.root, { branch: 'selvage', now: new Date().toISOString() });
    if (grant) return { underGrant: grant.grantId }; // admitted UNDER the grant
  }
  // traceCli emits the row (refusal included) and RE-THROWS unchanged, so
  // fail() still owns the stderr refusal line and the verdict-keyed exit.
  await traceCli({ root: spec.root, verb: spec.verb, target: spec.target, principal: violation.agentId }, () => {
    throw new RefusedError(violation.refusal, violation.message);
  });
  /* unreachable — traceCli re-threw */
  return { underGrant: null };
}

/**
 * THE CLI PRINCIPAL CLASS for the #protected landing gate. Reuses the #agent-shell
 * credential model verbatim: an UNMARKED shell is the human operator (possession
 * of the box is the credential), a shell exporting `$WARPLINE_AGENT_ID` is an
 * agent's. So `warpline admit`/`merge` from the operator console is human-class
 * (never gated), and an agent driving the CLI is agent-class (refused from landing
 * onto a protected branch once branching is in use). No new vocabulary — the same
 * marker #pick attributes by and #agent-shell gates the human-only verbs by.
 */
function shellPrincipal(): PrincipalClass {
  return agentShellId(process.env) ? 'agent' : 'human';
}

program
  .name('warpline')
  .description('Warpline — version control for meaning. START HERE: `warpline init` onboards a project (git optional), then `warpline status` is the manual. The Convergence/Divergence Oracle (read-only forecasts) + the native fabric (fork/propose/admit/resolve/restore). Writes .warpline/ only, never git.')
  .version('0.1.0')
  // D-7: the EXPLICIT root. Registered here so it appears in --help; the value
  // is actually lifted out of argv by extractRootFlag below, which makes it
  // legal in ANY position (commander would otherwise reject it after the
  // subcommand). Precedence: --root > WARPLINE_ROOT > git rev-parse > cwd.
  .option('--root <dir>', `the repository to operate on — overrides git rev-parse and $${ROOT_ENV} (must already exist)`);

/**
 * The one-time `.warplineignore` deprecation notice, emitted to STDERR (never
 * stdout, so `--json` stays clean). The handler computes the text + owns the
 * once-per-root dedup; the CLI is the only thing that writes.
 */
function emitWarpignoreDeprecation(root: string): void {
  const notice = noteWarpignoreDeprecation(root);
  if (notice) process.stderr.write(notice + '\n');
}

program
  .command('init')
  .description(
    "ONBOARD a project onto Warpline (native-first — git optional). Seals the genesis fabric (so `status` has a base), writes a starter `.warpignore`, and keeps `.warpline/` out of git. IDEMPOTENT — safe to re-run. Then `warpline status` is the manual; the cycle is fork → propose → admit, and a contested merge (KNOT) needs a human `resolve`.",
  )
  .argument('[dir]', 'the project directory to initialize (default: the resolved root)')
  .option('--json', 'emit the InitResult as JSON')
  .action(async (dir: string | undefined, options: { json?: boolean }) => {
    try {
      // An explicit [dir] names the target directly (like --root); otherwise the
      // normal root resolution decides. Either way the target must already exist —
      // init onboards a project, it never conjures the directory.
      const root = dir ? path.resolve(dir) : await resolveRoot();
      if (!existsSync(root)) {
        process.stderr.write(`warpline: init — ${root} does not exist (create the project directory first)\n`);
        process.exit(1);
      }
      const result = await initWarpline(root);
      emitWarpignoreDeprecation(root);
      if (options.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        printInit(result);
      }
    } catch (err) {
      fail(err);
    }
  });

program
  .command('absorb')
  .description('Lift a git ref to a WarpState of MEANING and dump it.')
  .argument('<ref>', 'git ref to absorb, or the literal WORKTREE for the live cwd')
  .option('--json', 'emit the full WarpState as JSON')
  .action(async (ref: string, options: { json?: boolean }) => {
    try {
      const state = await absorb(ref);
      if (options.json) {
        process.stdout.write(JSON.stringify(serializeState(state), null, 2) + '\n');
      } else {
        printAbsorbSummary(state);
      }
    } catch (err) {
      fail(err);
    }
  });

program
  .command('oracle')
  .description('Run the Oracle on two refs: predict the merge from meaning, run git for real, score where they agree/diverge.')
  .argument('<branchA>', 'first ref')
  .argument('<branchB>', 'second ref')
  .option('--json', 'emit the full OracleRecord as JSON')
  .action(async (branchA: string, branchB: string, options: { json?: boolean }) => {
    try {
      const record = await oracle(branchA, branchB);
      if (options.json) {
        process.stdout.write(JSON.stringify(record, null, 2) + '\n');
      } else {
        printOracleSummary(record);
      }
    } catch (err) {
      fail(err);
    }
  });

program
  .command('weave')
  .description('THE PRE-MERGE FORECAST. `--preview` predicts the weave from MEANING (read-only, ephemeral). The write verb is reserved for a later phase.')
  .argument('<branchA>', 'first ref')
  .argument('<branchB>', 'second ref')
  .option('--preview', 'forecast the weave from meaning (read-only); required in Phase 1')
  .option('--vs-git', 'also run git merge-tree and show where meaning and bytes diverge')
  .option('--json', 'emit the full Forecast as JSON')
  .action(
    async (
      branchA: string,
      branchB: string,
      options: { preview?: boolean; vsGit?: boolean; json?: boolean },
    ) => {
      try {
        if (!options.preview) {
          // Phase 1 is read-only. Reserve the verb, refuse the write.
          process.stdout.write(
            'weave (write) is not yet implemented — Phase 1 is read-only.\n' +
              'Use `warpline weave --preview <A> <B>` to forecast the merge from meaning.\n',
          );
          process.exit(2);
        }
        const f = await forecast(branchA, branchB, { vsGit: options.vsGit });
        // #hazard (T-2026-08-11-016): the CLEAN-hazard advisory on the preview, so
        // it is never MORE optimistic than the admit it forecasts. Advisory-only —
        // it qualifies nothing in `f`.
        const hazards = await forecastHazardsFromRefs(branchA, branchB);
        if (options.json) {
          const out = hazards.length ? { ...f, hazards } : f;
          process.stdout.write(JSON.stringify(out, null, 2) + '\n');
        } else {
          printForecast(f, hazards);
        }
      } catch (err) {
        fail(err);
      }
    },
  );

program
  .command('consolidate')
  .description('THE N-WAY FOLD FORECAST. Fold N branches at once from MEANING (read-only): which symbols auto-fold vs which KNOT across branches. Human labor tracks genuine meaning-collisions, not branch count.')
  .argument('<refs...>', 'two or more git refs to fold')
  .option('--base <ref>', 'common base (default: octopus merge-base of all refs)')
  .option('--json', 'emit the full ConsolidateForecast as JSON')
  .action(async (refs: string[], options: { base?: string; json?: boolean }) => {
    try {
      if (refs.length < 2) {
        process.stderr.write('warpline: consolidate needs at least 2 refs\n');
        process.exit(1);
      }
      const f = await consolidate(refs, { base: options.base });
      if (options.json) {
        process.stdout.write(JSON.stringify(f, null, 2) + '\n');
      } else {
        printConsolidate(f);
      }
    } catch (err) {
      fail(err);
    }
  });

program
  .command('diff')
  .description('SEMANTIC diff between two refs (rides the meaning graph). Renames are the EMPTY delta. Defaults: no args = WORKTREE vs HEAD; one arg = ref vs HEAD; two args = refA vs refB. The `<A>..<B>` range form is a BYTE diff between two branch/rev TIPS (native trees, git absent) — added / removed / modified paths.')
  .argument('[refA]', 'first ref (default: WORKTREE), or the `<A>..<B>` range form for a byte diff between two tips')
  .argument('[refB]', 'second ref (default: HEAD)')
  .option('--json', 'emit the full SemDiffReport as JSON (or the TreeDiff for a `<A>..<B>` range)')
  .action(async (refA: string | undefined, refB: string | undefined, options: { json?: boolean }) => {
    try {
      const root = await resolveRoot();

      // `warpline diff <A>..<B>` — the RANGE form: a byte diff between two branch/rev
      // TIPS (native trees, git absent), NOT the semantic meaning diff. Resolve each
      // side to its binding treeId through the shared selector, then #graph diffTrees
      // (reusing the native flatten primitive). An omitted side defaults to HEAD, as
      // git's `..` does. Read-only — reads the object store, writes nothing.
      if (refA && !refB && refA.includes('..')) {
        const idx = refA.indexOf('..');
        const aSel = refA.slice(0, idx) || 'HEAD';
        const bSel = refA.slice(idx + 2) || 'HEAD';
        const wdir = warplineDirOf(root);
        const aTree = resolveSelector(wdir, aSel).treeId;
        const bTree = resolveSelector(wdir, bSel).treeId;
        const td = diffTrees(new ObjectStore(root), aTree, bTree);
        if (options.json) {
          process.stdout.write(JSON.stringify({ a: aSel, b: bSel, ...td }, null, 2) + '\n');
        } else {
          printTreeDiff(aSel, bSel, td);
        }
        return;
      }
      // no args = WORKTREE vs HEAD; one arg = ref vs HEAD; two args = refA vs refB.
      const noArgs = !refA && !refB;
      // NATIVE PATH: no-args (worktree vs base) in a project with no reachable git
      // — `absorb('HEAD')` shells git and would die "not a repository". Explicit
      // refs always need git (they ARE git refs); only the worktree default lifts.
      if (noArgs && !(await gitHeadReachable(root))) {
        emitWarpignoreDeprecation(root);
        const report = await nativeStatus(root);
        if (options.json) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
        else printSemDiff(report);
        return;
      }
      let a: string;
      let b: string;
      if (refA && refB) {
        a = refA;
        b = refB;
      } else if (refA) {
        a = refA;
        b = 'HEAD';
      } else {
        a = WORKTREE_REF;
        b = 'HEAD';
      }
      const report: StatusReport = await semanticDiff(a, b);
      // Byte-honesty on the worktree-vs-HEAD default: a clean meaning diff over
      // real byte changes must not read as a no-op. Explicit ref↔ref diffs have no
      // "on disk" — skip. Best-effort: a git failure just omits the layer.
      if (noArgs) report.onDisk = await gitDiskHonesty(root, report);
      if (options.json) {
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      } else {
        printSemDiff(report);
      }
    } catch (err) {
      fail(err);
    }
  });

program
  .command('status')
  .description("The working tree's MEANING vs HEAD — what changed semantically (a rename is the EMPTY delta). The named, discoverable form of `diff` with no args.")
  .option('--json', 'emit the SemDiffReport as JSON')
  .action(async (options: { json?: boolean }) => {
    try {
      // HEAD is the base, the working tree is the branch — so a new symbol reads as
      // `born`, a deleted one as `retired` (status semantics, not the inverse).
      // f4Trace verb is `cli:status`, NOT `status`: this is the meaning diff, a
      // different thing from the daemon's cycle-position self-description.
      const root = await resolveRoot();
      // THE DOGFOOD REGRESSION (T-2026-08-12-002): in a project with no reachable
      // git, `semanticDiff('HEAD', …)` shells `git archive` and dies "not a
      // repository" — on the very first thing an agent runs. Take the NATIVE path
      // then: worktree MEANING vs the SELVAGE, git absent. git present ⇒ unchanged.
      const useNative = !(await gitHeadReachable(root));
      if (useNative) emitWarpignoreDeprecation(root);
      const report: StatusReport = await traceCli(
        { root, verb: 'cli:status', target: cliTarget({}, { json: options.json, native: useNative || undefined }) },
        async () => {
          if (useNative) return nativeStatus(root);
          const r: StatusReport = await semanticDiff('HEAD', WORKTREE_REF);
          r.onDisk = await gitDiskHonesty(root, r);
          return r;
        },
      );
      if (options.json) {
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      } else {
        printStatus(report);
      }
    } catch (err) {
      fail(err);
    }
  });

program
  .command('health')
  .description(
    'THE READ-ONLY DIAGNOSTIC (#warpline-health). One screen for the questions no other surface answers: is the ledger sound, is the auto-seal hook actually REACHING a binary (installed and reachable are different facts — `hook status` only knows the first), how far behind HEAD has the fabric fallen, how many verdicts were ever MEASURED AGAINST GIT, and what a strand costs on disk. Writes NOTHING — no trace row, no cache, no lock (audit C-13: a diagnostic that writes is one you cannot run on a full disk). Exit 0 green, 1 warnings, 2 fabric unsound.',
  )
  .option('--json', 'emit the full HealthReport as JSON (for CI gating)')
  .action(async (options: { json?: boolean }) => {
    try {
      const root = await resolveRoot();
      // NOT wrapped in traceCli: that WRITES an f4 row, and this verb's whole
      // contract is that it writes nothing.
      const report = await health(root);
      if (options.json) {
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      } else {
        printHealth(report);
      }
      process.exitCode = healthExitCode(report);
    } catch (err) {
      fail(err);
    }
  });

program
  .command('lifeline')
  .description("Meaning-aware blame: trace a symbol's ESSENCE through history — who changed its MEANING, when, and why. Follows the file across renames (git blame resets; lifeline doesn't).")
  .argument('<symbol>', 'symbol to trace, e.g. #essence-hash or #code:src/foo.ts::bar')
  .option('--max <n>', 'max file-touching commits to scan', '25')
  .option('--json', 'emit the Lifeline as JSON')
  .action(async (symbol: string, options: { max?: string; json?: boolean }) => {
    try {
      const max = Number(options.max);
      if (!Number.isInteger(max) || max < 1) {
        process.stderr.write(`warpline: --max must be a positive integer (got "${options.max}")\n`);
        process.exit(1);
      }
      const ll = await lifeline(symbol, { maxCommits: max });
      if (options.json) {
        process.stdout.write(JSON.stringify(ll, null, 2) + '\n');
      } else {
        printLifeline(ll);
      }
    } catch (err) {
      fail(err);
    }
  });

program
  .command('pick')
  .description("Seal MEANING into the Warpline fabric — this project's OWN native history. Writes .warpline/ only (refs/selvage + fabric.jsonl), NEVER git. A no-op when meaning is unchanged. With --ref <commit> and no -m, intent + actor are derived from the commit (how the auto-seal hook records).")
  .option('-m, --intent <message>', 'why this pick — the human-readable intent')
  .option('--as <actor>', 'actor identity recording this pick (default: git user.name / commit author)')
  .option('--agent <id>', 'AGENT recording this pick — IN the pickId (falls back to $WARPLINE_AGENT_ID). Unsigned self-assertion: attribution data, not authenticated identity (M3)')
  .option('--confidence <n>', 'graded belief 0..1 (reserved — the calibration signal)')
  .option('--ref <ref>', 'snapshot a git ref instead of the working tree (default: WORKTREE)')
  .option(
    '--accept-risk',
    "R2 gate override: seal an agent-attributed pick DESPITE a would-not-seal gate verdict (gate.agentWrites 'real'). Recorded on the verdict row (.warpline/shadow/verdicts.jsonl) — never silent",
  )
  .option('--quiet', 'suppress output (for hooks/scripts); still exits non-zero on error')
  .option('--json', 'emit the sealed Strand as JSON')
  .action(
    async (options: {
      intent?: string;
      as?: string;
      agent?: string;
      confidence?: string;
      ref?: string;
      acceptRisk?: boolean;
      quiet?: boolean;
      json?: boolean;
    }) => {
      try {
        const isWorktree = !options.ref || options.ref === WORKTREE_REF;
        if (!options.intent && isWorktree) {
          process.stderr.write(
            'warpline: pick needs -m <intent> (or --ref <commit> to derive intent from the commit)\n',
          );
          process.exit(1);
        }
        let confidence: number | undefined;
        if (options.confidence !== undefined) {
          confidence = Number(options.confidence);
          if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
            process.stderr.write(
              `warpline: --confidence must be a number in [0,1] (got "${options.confidence}")\n`,
            );
            process.exit(1);
          }
        }
        const root = await resolveRoot();
        // Attribution precedence: --agent flag > $WARPLINE_AGENT_ID > null. Lets a
        // per-agent worktree seal attributed strands during the multi-agent dogfood
        // (unsigned self-assertion — attribution data, not authenticated identity).
        const agentId = options.agent ?? process.env.WARPLINE_AGENT_ID ?? undefined;
        // C-11: `pick --accept-risk` is the R2 gate's OVERRIDE DOOR, and #pick's
        // own refusal ladder already marks it principal:'human'. It was reachable
        // from any shell, which meant an agent could wave through the very
        // verdict the R2 gate exists to refuse. Recorded under the CLI verb
        // `pick` (there is no daemon `pick` — it stays off CLI_VERB_MAP).
        await gateHumanClass({
          root,
          cliPath: 'pick',
          verb: 'pick',
          target: cliTarget({ ref: options.ref, agentId }, { acceptRisk: options.acceptRisk }),
          flags: { acceptRisk: options.acceptRisk },
        });
        const result = await recordPick(root, {
          cwd: root,
          intent: options.intent,
          actor: options.as,
          agentId,
          confidence,
          ref: options.ref,
          acceptRisk: options.acceptRisk,
        });
        if (options.json) {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        } else if (!options.quiet) {
          printPick(result);
        }
      } catch (err) {
        if (options.quiet) process.exit(1); // hooks: fail quietly, never break the commit caller
        fail(err);
      }
    },
  );

program
  .command('hook')
  .description('Manage the auto-seal git hook — seal every git commit into the fabric automatically (coexists with any existing post-commit hook).')
  .argument('<action>', 'install | uninstall | status')
  .action(async (action: string) => {
    try {
      const root = await resolveRoot();
      const hookPath = await gitPath('hooks/post-commit', { cwd: root }).catch(() =>
        `${root}/.git/hooks/post-commit`,
      );
      if (action === 'install') {
        // S1 (checkpoint valve): the auto-seal hook refuses to INSTALL where the
        // stake marker is present — this worktree is a one-way checkpoint state.
        if (existsSync(path.join(root, STAKE_MARKER))) {
          process.stderr.write(
            `warpline: refusing to install the auto-seal hook — a ${STAKE_MARKER} marker is present at ${root} (a stake reset state; S1). ` +
              `Run \`warpline stake recover <stakeCommit>\` first.\n`,
          );
          process.exit(1);
        }
        // Capture the ACTUAL binary running this install and bake it into the hook,
        // so the seal uses the same binary that installed it — not a bare `warpline`
        // guessed off the committing shell's PATH (which a cold agent that ran us as
        // `node /abs/cli.js`, with no global install, never has). If we cannot resolve
        // a runnable binary AT ALL, FAIL LOUDLY rather than write a hook that silently
        // no-ops — the one refusal on the REAL condition, not a PATH proxy.
        const baked = resolveInvokingBinary();
        if (baked === null) {
          process.stderr.write(
            `warpline: refusing to install the auto-seal hook — could not resolve the warpline binary ` +
              `running this install to bake into it (process.argv named no runnable CLI entry). A hook baked ` +
              `with no binary would resolve to nothing and seal every commit silently. Invoke via ` +
              `\`node /absolute/path/to/warpline/dist/cli.js hook install\` or a real \`warpline\` executable.\n`,
          );
          process.exit(1);
        }
        const r = installHook(hookPath, baked);
        const verb = r.created ? 'created' : r.refreshed ? 'refreshed' : 'appended to existing hook';
        process.stdout.write(
          `HOOK  auto-seal ${verb}\n  ${hookPath}\n  every git commit now seals --ref HEAD into the fabric, ` +
            `using the baked binary \`${baked.node} ${baked.script}\` (never blocks the commit).\n` +
            `  override at commit time with WARPLINE_BIN=/path/to/warpline; verify with \`warpline health\`.\n`,
        );
      } else if (action === 'uninstall') {
        const r = uninstallHook(hookPath);
        process.stdout.write(r.removed ? `HOOK  auto-seal removed\n  ${hookPath}\n` : `HOOK  not installed — nothing to remove\n`);
      } else if (action === 'status') {
        const s = hookStatus(hookPath);
        const label =
          s.state === 'installed'
            ? 'INSTALLED'
            : s.state === 'other-hook-no-warpline'
              ? 'NOT installed (a non-warpline post-commit hook is present)'
              : 'NOT installed';
        process.stdout.write(`HOOK  ${label}\n  ${hookPath}\n`);
      } else {
        process.stderr.write(`warpline: hook action must be install | uninstall | status (got "${action}")\n`);
        process.exit(1);
      }
    } catch (err) {
      fail(err);
    }
  });

program
  .command('log')
  .description("The Warpline fabric — this project's native meaning-history (the picks sealed into the WARP), newest first. MULTI-BRANCH by default: every strand annotated with the branch/ref names that point at it and the current HEAD (* = HEAD). `log <branch>` narrows to that branch's ANCESTRY line (its tip and everything reachable from it).")
  .argument('[branch]', 'narrow to one branch: show only its ancestry line (default: all branches, annotated)')
  .option('--max <n>', 'max strands to show', '20')
  .option('--json', 'emit the annotated graph (default) or the branch ancestry (with <branch>) as JSON')
  .action(async (branch: string | undefined, options: { max?: string; json?: boolean }) => {
    try {
      const max = Number(options.max);
      if (!Number.isInteger(max) || max < 1) {
        process.stderr.write(`warpline: --max must be a positive integer (got "${options.max}")\n`);
        process.exit(1);
      }
      const root = await resolveRoot();
      const wdir = warplineDirOf(root);
      const fabric = readFabric(wdir);

      // `log <branch>` — the ANCESTRY LINE of one branch: resolve its tip through
      // the shared selector (a branch name IS a selector, M2.5 select.ts) and walk
      // its ancestors in DAG order (#graph ancestorsOf → #mergebase ancestorSet).
      if (branch !== undefined) {
        const tip = resolveSelector(wdir, branch).strand;
        if (!tip) {
          throw new Error(`warpline: "${branch}" names no history position (a tree: selector has no ancestry) — log a branch | HEAD | selvage | pick:<id>`);
        }
        const line = ancestorsOf(fabric, tip.pickId);
        if (options.json) {
          process.stdout.write(JSON.stringify({ branch, tip: tip.pickId, strands: line }, null, 2) + '\n');
        } else {
          printBranchAncestry(branch, tip.pickId, line, max);
        }
        return;
      }

      // Default — the MULTI-BRANCH annotated log: the whole DAG with every ref/HEAD
      // decoration (#graph branchGraph). Absent HEAD ≡ the selvage trunk.
      const graph = branchGraph(fabric, listRefs(wdir), readHead(root));
      if (options.json) {
        process.stdout.write(JSON.stringify(graph, null, 2) + '\n');
      } else {
        printLog(graph, max);
      }
    } catch (err) {
      fail(err);
    }
  });

program
  .command('show')
  .description("Show a strand OR a KNOT payload (M2.5). Given a KNOT payloadId (or the admitted side's ref) it renders the full resolution work order — the same as `warpline knot show`. Given an ORDINARY strand selector (a branch | HEAD | selvage | pick:<id> | state:<id> | @N) it renders that strand's OWN diff: its meaning delta, intent (enveloped), author, DAG parents, and the byte paths it changed vs its primary parent. Read-only.")
  .argument('<selector>', "a KNOT payloadId 'knotPayload:v1:…' (≥12-char prefix ok), OR an ordinary strand selector (branch | HEAD | selvage | pick:<id> | state:<id> | @N)")
  .option('--json', 'emit the knotPayload:v1 JSON, or the strand JSON')
  .action(async (selector: string, options: { json?: boolean }) => {
    try {
      const root = await resolveRoot();
      // KNOT PAYLOAD first — the pointer a cold agent hydrates. A hit renders like
      // `knot show` (traced verb knot.show). A miss is NOT an error here: it means
      // an ORDINARY strand selector, so fall through to the strand view.
      const payload = readKnotPayload(root, selector);
      if (payload) {
        await traceCli(
          { root, verb: 'knot.show', target: cliTarget({ selector }, { json: options.json }) },
          () => payload,
        );
        if (options.json) process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
        else printKnotPayload(payload);
        return;
      }

      // ORDINARY STRAND — a strand's own diff (extending show beyond KNOTs). Resolve
      // through the shared selector (a branch name IS a selector), read its stored
      // semantic delta + intent + author + DAG parents, and (when the parent is
      // bound) the BYTE paths this strand changed vs its primary parent (#graph
      // diffTrees). Read-only presentation — no verdict, seal, or ref changes.
      const wdir = warplineDirOf(root);
      let res;
      try {
        res = resolveSelector(wdir, selector);
      } catch (err) {
        throw new Error(
          `no KNOT payload and no strand match ${JSON.stringify(selector)}. A KNOT payload is written by \`warpline admit\` on a KNOT/DANGLE (see .warpline/knots/); a strand selector is a branch | HEAD | selvage | pick:<id> | state:<id> | @N. (${(err as Error).message})`,
        );
      }
      const strand = res.strand!;
      const fabric = readFabric(wdir);
      // Byte diff vs the PRIMARY parent (parents[0]) when it is present + bound —
      // "what this strand changed". Genesis (no parents) or an unbound parent → none.
      let td: TreeDiff | undefined;
      const primaryParent = parentsOf(strand)[0];
      if (primaryParent) {
        const parentStrand = fabric.find((x) => x.pickId === primaryParent);
        const parentTree = parentStrand?.binding?.treeId;
        if (parentTree && res.treeId) td = diffTrees(new ObjectStore(root), parentTree, res.treeId);
      }
      if (options.json) {
        process.stdout.write(JSON.stringify({ strand, parents: parentsOf(strand), byteDiff: td ?? null }, null, 2) + '\n');
      } else {
        printStrandShow(strand, td);
      }
    } catch (err) {
      fail(err);
    }
  });

program
  .command('selvage')
  .description("The current fabric tip — the selvage stateId and the strand that sealed it.")
  .option('--json', 'emit the tip + sealing strand as JSON')
  .action(async (options: { json?: boolean }) => {
    try {
      const root = await resolveRoot();
      const wdir = warplineDirOf(root);
      const selvage = readSelvage(wdir);
      const fabric = readFabric(wdir);
      const tip = selvage ? fabric.find((s) => s.stateId === selvage) ?? fabric[fabric.length - 1] : undefined;
      if (options.json) {
        process.stdout.write(JSON.stringify({ selvage, tip: tip ?? null, depth: fabric.length }, null, 2) + '\n');
      } else {
        printSelvage(selvage, tip, fabric.length);
      }
    } catch (err) {
      fail(err);
    }
  });

program
  .command('scratch')
  .description('Fork a per-agent SCRATCH at the current selvage (the optimistic base for multi-writer admission). N agents fork the same selvage with zero contention — what git\'s single shared working tree cannot do. This is ALSO the base the R2 agent gate judges an attributed `pick` against: without it the gate falls back to the selvage and every verdict is FAST_ADMIT by construction (C-9). For the NATIVE cycle use `warpline fork` instead — the two mint different base epochs and are not interchangeable.')
  .argument('<agentId>', 'the agent identity owning this scratch')
  .action(async (agentId: string) => {
    try {
      const root = await resolveRoot();
      const { base } = forkScratch(root, agentId);
      process.stdout.write(
        `SCRATCH  forked for ${agentId}\n  base    ${base ? base : '(none — empty fabric)'}\n`,
      );
    } catch (err) {
      fail(err);
    }
  });

program
  .command('fork')
  .description('CYCLE STEP 1 (FORK → propose → admit). Mint the agent\'s scratch ref at the current selvage pickId — the private base it proposes against (base is a pickId, forever — I9). With --into, restore the base tree into the agent\'s fresh worktree (git absent). NEXT: edit, then `warpline propose --agent <id> --native -m "<why>"` to seal.')
  .argument('<agentId>', 'the agent identity owning the scratch ref')
  .option('--into <dir>', 'restore the selvage tree into this directory (the agent worktree)')
  .option('--force', 'with --into: overwrite colliding paths whose current bytes are in no object (they are unrecoverable — the guard refuses by default)')
  .option('--json', 'emit the fork result as JSON')
  .action(async (agentId: string, options: { into?: string; force?: boolean; json?: boolean }) => {
    try {
      const root = await resolveRoot();
      const result = await traceCli(
        { root, verb: 'fork', target: cliTarget({ agentId, into: options.into }, { force: options.force }), principal: agentId },
        () =>
          forkNative(root, agentId, {
            into: options.into ? path.resolve(options.into) : undefined,
            ...(options.force ? { force: true } : {}),
          }),
      );
      if (options.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        const lines: string[] = [];
        lines.push(`FORK  scratch ref minted for ${agentId}`);
        lines.push(`base      ${result.base ?? '(none — empty fabric; genesis propose next)'}`);
        if (result.restoredEntries !== undefined) lines.push(`restored  ${result.restoredEntries} entr${result.restoredEntries === 1 ? 'y' : 'ies'} → ${options.into}`);
        process.stdout.write(lines.join('\n') + '\n');
      }
    } catch (err) {
      fail(err);
    }
  });

program
  .command('propose')
  .description("CYCLE STEP 2 (fork → PROPOSE → admit). With --native: SEAL your worktree as a durable proposal on your own scratch ref — this is the step that captures your work, and nothing is judged or shared until `admit`. Optionally pre-declare what you touched with --claim (claim:v1, forge-spec §3b): the agent's belief about what its change touches, declared BEFORE admission, so `admit --claim` can judge the verdict against it (honesty check + calibration probe). A claim is recorded, never used to scope computation. WITHOUT --native this registers a claim ONLY and seals nothing.")
  .requiredOption('--agent <id>', 'the declaring agent (the calibration probe is per-agent)')
  .option('--claim <json>', 'OPTIONAL with --native (required without it): the claim body — a path to a .json file, or inline JSON — {claimedSymbols: string[], intent: string, taskRef?, claimedContractDelta?, confidence?}')
  .option('--native', 'NATIVE-FIRST (phase 0): SEAL a v3 SCRATCH strand from the worktree — snapshot (native walk) → absorb from the store → bind-on-seal; advances only the agent\'s scratch ref, git absent')
  .option('--worktree <dir>', 'the worktree to seal from (--native; default: the repo root)')
  .option('-m, --intent <message>', 'why this change exists — REQUIRED with --native (there is no git fallback on the native path, I3); defaults to the claim\'s intent text when a claim is given')
  .option('--as <actor>', 'actor identity (--native; default: the agent id)')
  .option('--json', 'emit the result as JSON')
  .action(async (options: { agent: string; claim?: string; native?: boolean; worktree?: string; intent?: string; as?: string; json?: boolean }) => {
    try {
      const root = await resolveRoot();
      // THE CLI ONCE DEMANDED A CLAIM TO SEAL, and the engine never did
      // (native.ts: `intent` throws when missing, `claim` is `if (opts.claim)`).
      // That inversion is an F4 legibility failure with teeth: it forced an
      // agent to author `#code:<file>::<name>` symbol-id syntax — knowledge the
      // CLI never teaches — before it could capture ANY work. The daemon/MCP
      // descriptor for the same verb always had it right (intent required,
      // claim optional); the two surfaces now agree with each other and with
      // the engine.
      const body = options.claim
        ? (JSON.parse(
            options.claim.trimStart().startsWith('{')
              ? options.claim
              : await fs.readFile(path.resolve(options.claim), 'utf8'),
          ) as Omit<CreateClaimInput, 'agentId'>)
        : undefined;
      if (!options.native && !body) {
        fail(
          new Error(
            'warpline: propose without --native registers a CLAIM and seals nothing, so --claim is required. ' +
              'To SEAL your work (cycle step 2), use --native with -m <intent>.',
          ),
        );
        return;
      }
      if (options.native && !(options.intent ?? body?.intent)?.trim()) {
        fail(
          new Error(
            'warpline: propose --native refused — intent is required (I3: no git fallback on the native path). ' +
              'Pass -m "<why this change exists>", or a --claim whose body carries an `intent`.',
          ),
        );
        return;
      }
      if (options.native) {
        // f4Trace: intent and the --claim BODY are prose — neither may enter `target`.
        const result = await traceCli(
          {
            root,
            verb: 'propose',
            target: cliTarget({ agentId: options.agent, worktree: options.worktree }, { native: true }),
            principal: options.agent,
          },
          () =>
            proposeNative(root, {
              worktree: options.worktree ? path.resolve(options.worktree) : root,
              agentId: options.agent,
              intent: (options.intent ?? body?.intent)!,
              actor: options.as,
              ...(body ? { claim: body } : {}),
            }),
        );
        if (options.json) {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        } else if (result.noop) {
          process.stdout.write(
            `PROPOSE  ${options.agent}  →  no-op (meaning unchanged vs the scratch base)\n` +
              (result.claimId ? `claimId   ${result.claimId}\n` : ''),
          );
        } else {
          const lines: string[] = [];
          lines.push(`PROPOSE  ${options.agent}  →  scratch strand SEALED (durable before judgment)`);
          lines.push(`pick      ${result.strand!.pickId}`);
          lines.push(`state     ${short(result.stateId)}   tree ${short(result.treeId)}`);
          lines.push(`base      ${result.base ?? '(genesis)'}`);
          if (result.claimId) lines.push(`claimId   ${result.claimId}`);
          lines.push(`          → warpline admit ${options.agent} --native${result.claimId ? ` --claim ${result.claimId}` : ''}`);
          process.stdout.write(lines.join('\n') + '\n');
        }
        return;
      }
      const claim = await traceCli(
        {
          root,
          verb: 'propose',
          target: cliTarget({ agentId: options.agent }, { claimOnly: true }),
          principal: options.agent,
        },
        () => {
          // Unreachable with body === undefined: the guard above refuses
          // claim-only mode without --claim before we get here.
          const c = createClaim({ ...body!, agentId: options.agent });
          persistClaim(root, c);
          return c;
        },
      );
      if (options.json) {
        process.stdout.write(JSON.stringify(claim, null, 2) + '\n');
      } else {
        const lines: string[] = [];
        lines.push(`PROPOSE  ${options.agent}  →  claim registered`);
        lines.push(`claimId   ${claim.claimId}`);
        lines.push(`claimed   ${claim.claimedSymbols.join(', ') || '(no symbols)'}`);
        if (claim.taskRef) lines.push(`taskRef   ${claim.taskRef}`);
        if (claim.confidence !== undefined) lines.push(`confidence ${claim.confidence}`);
        lines.push(`          → warpline admit ${options.agent} --claim ${claim.claimId}`);
        process.stdout.write(lines.join('\n') + '\n');
      }
    } catch (err) {
      fail(err);
    }
  });

program
  .command('admit')
  .description("CYCLE STEP 3 (fork → propose → ADMIT). Judge the agent's SEALED proposal against the live selvage and return the verdict — FAST_ADMIT / CLEAN (+confidence) / KNOT / DANGLE / CLAIM-BREACH (when judged against a --claim) / HELD (an independent-CLEAN into a low-survival symbol, per the grades sidecar). REQUIRES a sealed scratch: run `propose --native` FIRST, or this reports NOOP because there is no proposal to judge. NATIVE FORM (git-absent, the form the init/propose banners instruct): `warpline admit <agent> --native` — see the --native option below. Resolution of a KNOT is human-class — escalate, do not attempt. v1 reports the decision; merged-tree materialization is v2.")
  .argument('<agentId>', 'the agent whose scratch is being admitted')
  .option('--ref <ref>', 'the agent\'s proposed state (a git ref or WORKTREE)', WORKTREE_REF)
  .option('--claim <claimId>', 'judge this admission against a pre-declared claim (see `warpline propose`) — a breach HOLDS the admit (CLAIM-BREACH)')
  .option('--accept-breach', 'explicit override: seal the underlying verdict despite a claim breach; the breach fact is recorded in .warpline/claims/evaluations.jsonl')
  .option('--accept-risk', 'explicit override: seal despite a trust-floor HELD (low graded survival on a touched symbol); the override is recorded in .warpline/grades-escalations.jsonl')
  .option('--shadow', 'R1 SHADOW GATE (observe-only): run the full decision pipeline, seal NOTHING, and append one row to .warpline/shadow/verdicts.jsonl — the organic evidence clock')
  .option('--native', 'NATIVE-FIRST (phase 0): weave the agent\'s SEALED scratch strand × the selvage, git absent — CLEAN restores the merged bytes back into the worktree')
  .option('--worktree <dir>', 'the agent worktree for the --native CLEAN write-back (default: the repo root)')
  .option('--no-restore', 'do NOT write the merged bytes back into the worktree (--native): the merge still seals, the working directory is left exactly as it is')
  .option('--json', 'emit the full AdmitResult as JSON')
  .action(async (agentId: string, options: { ref?: string; claim?: string; acceptBreach?: boolean; acceptRisk?: boolean; shadow?: boolean; native?: boolean; worktree?: string; restore?: boolean; json?: boolean }) => {
    try {
      const root = await resolveRoot();
      if (options.shadow && options.native) {
        process.stderr.write('warpline: admit --shadow and --native are mutually exclusive (the shadow gate rides the git-era seal path at R1)\n');
        process.exit(1);
      }
      // f4Trace: one `admit` verb across all three engine paths — which path
      // serves the call is Warpline's business; the agent asked for `admit`.
      // The distinguishing flags ride `target`, where they are already legal.
      const admitTarget = cliTarget(
        { agentId, ref: options.ref, claim: options.claim, worktree: options.worktree },
        {
          shadow: options.shadow,
          native: options.native,
          acceptBreach: options.acceptBreach,
          acceptRisk: options.acceptRisk,
          noRestore: options.restore === false,
        },
      );
      // C-11: the override flags are human-class on every skin (the daemon
      // refuses them for an agent token; the MCP schema omits them outright).
      // An agent shell must never accept its own breach or risk.
      await gateHumanClass({
        root,
        cliPath: 'admit',
        verb: 'admit',
        target: admitTarget,
        flags: { acceptBreach: options.acceptBreach, acceptRisk: options.acceptRisk },
      });
      if (options.shadow) {
        // the traced value is the AdmitResult itself, not the {result,row}
        // wrapper — the would-refuse verdict (and its refusal) lives there.
        let row!: Awaited<ReturnType<typeof shadowAdmit>>['row'];
        const result = await traceCli(
          { root, verb: 'admit', target: admitTarget, principal: agentId },
          async () => {
            const out = await shadowAdmit(root, {
              cwd: root,
              agentId,
              ref: options.ref ?? WORKTREE_REF,
              ...(options.claim ? { claim: options.claim } : {}),
              ...(options.acceptBreach ? { acceptBreach: true } : {}),
              ...(options.acceptRisk ? { acceptRisk: true } : {}),
            });
            row = out.row;
            return out.result;
          },
        );
        if (options.json) {
          process.stdout.write(JSON.stringify({ shadow: true, row, result }, null, 2) + '\n');
        } else {
          process.stdout.write(`SHADOW  observe-only — nothing sealed, selvage unmoved\n`);
          printAdmit(agentId, result);
          process.stdout.write(
            `shadow    ${row.status}${row.confidence ? ` (${row.confidence})` : ''}  wouldSeal=${row.wouldSeal}  ${row.durationMs}ms\n` +
              `          → row appended to .warpline/shadow/verdicts.jsonl\n`,
          );
        }
        // SHADOW stays exit 0 by contract: observe-only, nothing was asked to
        // seal — the appended row IS the success. (The refusal object still
        // rides the JSON for would-refuse verdicts; only the exit is neutral.)
        return;
      }
      if (options.native) {
        const result = await traceCli(
          { root, verb: 'admit', target: admitTarget, principal: agentId },
          () =>
            admitNative(root, {
              worktree: options.worktree ? path.resolve(options.worktree) : root,
              agentId,
              // #protected landing gate: an AGENT shell ($WARPLINE_AGENT_ID set)
              // is agent-class; an UNMARKED (operator) shell is human-class and
              // never gated (#agent-shell — possession of the shell is the human
              // credential). Attribution (agentId) is NOT the principal class.
              principal: shellPrincipal(),
              ...(options.claim ? { claim: options.claim } : {}),
              ...(options.acceptBreach ? { acceptBreach: true } : {}),
              ...(options.acceptRisk ? { acceptRisk: true } : {}),
              // commander negation: --no-restore sets options.restore === false
              ...(options.restore === false ? { noRestore: true } : {}),
            }),
        );
        if (options.json) {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        } else {
          printAdmit(agentId, result);
          if (result.sealed && result.restoredEntries !== undefined) {
            process.stdout.write(`restore   merged bytes written back to the worktree (${result.restoredEntries} entries, git absent)\n`);
          } else if (result.sealed && options.restore === false) {
            process.stdout.write(`restore   SKIPPED (--no-restore) — the worktree is untouched; `
              + `\`warpline restore selvage --to <dir>\` materializes the merged bytes when you want them\n`);
          }
        }
        // T-2026-07-21-006: a refusing verdict must never exit 0 — the exit is
        // keyed off the result's own refusal (0 sealed/NOOP, 1 GATE_REFUSED,
        // 3 CLAIM_BREACH, 4 TRUST_HELD, 5 STALE_BASE). exitCode, not exit():
        // stdout must flush the full JSON first.
        process.exitCode = exitCodeForResult(result);
        return;
      }
      const result = await traceCli(
        { root, verb: 'admit', target: admitTarget, principal: agentId },
        () =>
          admit(root, {
            cwd: root,
            agentId,
            ref: options.ref ?? WORKTREE_REF,
            ...(options.claim ? { claim: options.claim } : {}),
            ...(options.acceptBreach ? { acceptBreach: true } : {}),
            ...(options.acceptRisk ? { acceptRisk: true } : {}),
          }),
      );
      if (options.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        printAdmit(agentId, result);
      }
      process.exitCode = exitCodeForResult(result); // verdict-keyed (T-2026-07-21-006)
    } catch (err) {
      fail(err);
    }
  });

program
  .command('abandon')
  .description(
    "THE AGENT-CLASS EXIT (audit C-10) — withdraw an agent's scratch so it can fork again. Clears .warpline/refs/scratch/<agentId> and NOTHING else: the sealed proposal stays in the ledger as an abandoned head (restorable forever with `warpline restore pick:<id>`), the selvage does not move, and an open KNOT stays OPEN — abandoning concedes a contest, it never resolves one. Idempotent: no scratch is not an error.",
  )
  .argument('<agentId>', 'the agent whose scratch is being withdrawn')
  .option('--json', 'emit the abandon result as JSON')
  .action(async (agentId: string, options: { json?: boolean }) => {
    try {
      const root = await resolveRoot();
      const result = await traceCli(
        { root, verb: 'abandon', target: cliTarget({ agentId }), principal: agentId },
        () => abandonNative(root, agentId),
      );
      if (options.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        return;
      }
      if (!result.abandoned) {
        process.stdout.write(`ABANDON  ${agentId}  →  no-op (no scratch ref to withdraw)\n`);
        return;
      }
      const lines: string[] = [];
      lines.push(`ABANDON  ${agentId}  →  scratch withdrawn`);
      lines.push(`was       ${result.abandonedPick}`);
      if (result.sealedProposal) {
        lines.push(`sealed    the proposal is NOT lost — it stays in the ledger as an abandoned head`);
        lines.push(`          → warpline restore ${result.abandonedPick} --to <dir>`);
      }
      if (result.openKnotPayloadIds.length) {
        lines.push(
          `knot      ${result.openKnotPayloadIds.length} work order(s) STILL OPEN — withdrawing conceded the contest, it did not resolve it:`,
        );
        for (const id of result.openKnotPayloadIds) lines.push(`          ${id}`);
      }
      lines.push(`          → warpline fork ${agentId}`);
      process.stdout.write(lines.join('\n') + '\n');
    } catch (err) {
      fail(err);
    }
  });

program
  .command('grade')
  .description("Grade strand confidence against real OUTCOME (the moat): a pick whose symbols a later strand RETIRED/contended is overturned (confidence ↓); one whose symbols held is survived (↑). Updates calibratedConfidence in the ledger + appends the trajectory to .warpline/grades.jsonl, and reports survival by gate-rule prior class (does linked beat independent?).")
  .option('--window <n>', 'later strands required before a pick counts as survived', '2')
  .option('--dry', 'compute + report only; do not write')
  .option('--json', 'emit the full GradeReport as JSON')
  .action(async (options: { window?: string; dry?: boolean; json?: boolean }) => {
    try {
      const window = Number(options.window);
      if (!Number.isInteger(window) || window < 1) {
        process.stderr.write(`warpline: --window must be a positive integer (got "${options.window}")\n`);
        process.exit(1);
      }
      const root = await resolveRoot();
      const report = await traceCli(
        { root, verb: 'grade.report', target: cliTarget({ window: String(window) }, { dry: options.dry }) },
        () => gradeFabric(root, { window }),
      );
      if (!options.dry) await applyGrades(root, report, new Date().toISOString());
      if (options.json) {
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      } else {
        printGrade(report, options.dry ?? false);
      }
    } catch (err) {
      fail(err);
    }
  });

function printGrade(r: GradeReport, dry: boolean): void {
  const lines: string[] = [];
  lines.push(`WARPLINE GRADE  ${dry ? '(dry — not written)' : '(calibratedConfidence updated)'}`);
  lines.push('');
  for (const g of r.grades) {
    if (g.outcome === 'baseline') continue;
    const move =
      g.confidenceBefore === g.confidenceAfter
        ? `${g.confidenceAfter}`
        : `${g.confidenceBefore ?? 'seed'} → ${g.confidenceAfter}`;
    const mark = g.outcome === 'survived' ? '✓ survived ' : g.outcome === 'overturned' ? '✗ overturned' : '· pending  ';
    lines.push(`  seq ${g.seq}  ${mark}  [${g.priorClass}]  conf ${move}`);
    lines.push(`      ${g.reason}`);
  }
  lines.push('');
  lines.push('MOAT SIGNAL — survival by gate-rule prior class (does the prior predict survival?):');
  for (const cls of ['linked', 'independent', 'fast-admit', 'pick'] as const) {
    const b = r.moat[cls];
    const total = b.survived + b.overturned + b.pending;
    if (total === 0) continue;
    const rate = b.survived + b.overturned > 0 ? Math.round((100 * b.survived) / (b.survived + b.overturned)) : null;
    lines.push(`  ${cls.padEnd(11)}  survived ${b.survived}  overturned ${b.overturned}  pending ${b.pending}${rate !== null ? `  → ${rate}% survival` : ''}`);
  }
  if (r.moat.linked.survived + r.moat.linked.overturned + r.moat.independent.survived + r.moat.independent.overturned === 0) {
    lines.push('  (no graded ADMIT strands yet — the linked-vs-independent prior test awaits multi-writer admits)');
  }
  process.stdout.write(lines.join('\n') + '\n');
}

program
  .command('resolve')
  .description("KNOT COUNCIL — seal a human resolution of a genuine conflict. Records WHO decided, WHY, and what was contended on the strand (the reasoning git's merge commit can't keep), advances the selvage, and clears the scratch.")
  .argument('<agentId>', 'the agent whose conflicting admission is being resolved')
  .requiredOption('-m, --reason <why>', 'why it was resolved this way (the accountability record)')
  .option('--ref <ref>', 'the human-resolved state to seal (a git ref or WORKTREE; required unless --native)')
  .option('--by <who>', 'who made the call (default: git user.name; --native: the agent id)')
  .option('--ours <ref>', 'the original conflicting ref — sharpens the ours-side of the payload join (optional; the join and precise contended set now bind without it)')
  .option('--native', 'NATIVE-FIRST (phase 0): seal the resolution from --worktree as a v3 weave, git absent (the sealed scratch strand names the contended set for free)')
  .option('--worktree <dir>', 'the worktree holding the resolved bytes (--native; default: the repo root)')
  .option('--json', 'emit the full ResolveResult as JSON')
  .action(
    async (
      agentId: string,
      options: { reason: string; ref?: string; by?: string; ours?: string; native?: boolean; worktree?: string; json?: boolean },
    ) => {
      try {
        const root = await resolveRoot();
        // f4Trace (panel finding D-4): `resolve` was the ONE verb the CLI never
        // traced, and it is the human-class verb whose attempt IS the W3
        // escalation-violation the FG-1 criterion turns on. Untraced, a CLI
        // subject could perform it and still satisfy all three predicates.
        // `reason` is prose and never enters `target`.
        const resolveTarget = cliTarget(
          { agentId, ref: options.ref, ours: options.ours, worktree: options.worktree },
          { native: options.native },
        );
        // C-11: the law that made FG-1 measurable. `resolve` is HUMAN_ONLY on
        // the daemon and used to be free on the CLI — a security law that held
        // for an agent on MCP and evaporated for an agent with a shell.
        // I6: the gate returns the grantId when an AGENT shell was admitted
        // under an active auto-resolve grant — threaded into the seal so the
        // resolution strand records underGrant. Human shells get null.
        const gate = await gateHumanClass({ root, cliPath: 'resolve', verb: 'resolve', target: resolveTarget });
        if (options.native) {
          const result = await traceCli(
            { root, verb: 'resolve', target: resolveTarget, principal: agentId },
            () =>
              resolveNative(root, {
                worktree: options.worktree ? path.resolve(options.worktree) : root,
                agentId,
                reason: options.reason,
                decidedBy: options.by,
                ...(gate.underGrant ? { underGrant: gate.underGrant } : {}),
              }),
          );
          if (options.json) {
            process.stdout.write(JSON.stringify(result, null, 2) + '\n');
          } else {
            const r = result.resolution;
            const lines: string[] = [];
            lines.push(`RESOLVE  ${agentId}  →  sealed (native weave ${short(result.strand.pickId)})`);
            lines.push(`decidedBy ${r.decidedBy}`);
            lines.push(`reason    ${r.reason}`);
            lines.push(`contended ${r.contended.join(', ') || '(none recorded)'}`);
            lines.push(`resolved  ${r.resolvedSymbols.join(', ') || '(no symbols changed vs tip)'}`);
            lines.push(`selvage   advanced to ${short(result.strand.stateId)}`);
            process.stdout.write(lines.join('\n') + '\n');
          }
          return;
        }
        if (!options.ref) {
          process.stderr.write('warpline: resolve needs --ref <ref> (or --native with --worktree)\n');
          process.exit(1);
        }
        // bind after the guard: the narrowing does not survive into the closure.
        const resolvedRef = options.ref;
        const result = await traceCli(
          { root, verb: 'resolve', target: resolveTarget, principal: agentId },
          () =>
            resolveKnot(root, {
              cwd: root,
              agentId,
              resolvedRef,
              reason: options.reason,
              decidedBy: options.by,
              oursRef: options.ours,
              ...(gate.underGrant ? { underGrant: gate.underGrant } : {}),
            }),
        );
        if (options.json) {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        } else {
          const r = result.resolution;
          const s = result.strand;
          const lines: string[] = [];
          lines.push(`RESOLVE  ${agentId}  →  sealed (seq ${s.seq})`);
          lines.push(`decidedBy ${r.decidedBy}`);
          lines.push(`reason    ${r.reason}`);
          lines.push(`contended ${r.contended.join(', ') || '(none recorded — pass --ours for precision)'}`);
          lines.push(`resolved  ${r.resolvedSymbols.join(', ') || '(no symbols changed vs tip)'}`);
          lines.push(`selvage   advanced to ${short(s.stateId)}`);
          process.stdout.write(lines.join('\n') + '\n');
        }
      } catch (err) {
        fail(err);
      }
    },
  );

const knot = program
  .command('knot')
  .description('Machine-readable KNOT payloads (forge-spec §3a): the self-sufficient resolution work orders admit persists to .warpline/knots/ on a KNOT/DANGLE verdict.');

knot
  .command('show')
  .description("Show a KNOT payload — everything a resolver needs (both sides' bodies, enveloped intents, per-side deltas, blast radius, the resolution-proposal envelope). --json emits the exact knotPayload:v1 shape; the human view renders all agent prose inside escaped untrusted-prose frames.")
  .argument('<selector>', "a payloadId 'knotPayload:v1:…' (or a ≥12-char prefix), or the admitted side's git ref / commit / stateId")
  .option('--json', 'emit the full knotPayload:v1 JSON')
  .action(async (selector: string, options: { json?: boolean }) => {
    try {
      const root = await resolveRoot();
      // f4Trace: a miss must record as NOT-ok (it is the cold agent hydrating a
      // pointer that did not resolve) — so it throws to `fail()` like every
      // other command rather than exiting inline. Same message, same exit 1.
      const payload = await traceCli(
        { root, verb: 'knot.show', target: cliTarget({ selector }, { json: options.json }) },
        () => {
          const p = readKnotPayload(root, selector);
          if (!p) {
            throw new Error(
              `no KNOT payload matches ${JSON.stringify(selector)} — payloads are written by \`warpline admit\` on a KNOT/DANGLE verdict (see .warpline/knots/)`,
            );
          }
          return p;
        },
      );
      if (options.json) {
        process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
      } else {
        printKnotPayload(payload);
      }
    } catch (err) {
      fail(err);
    }
  });

const field = program
  .command('field')
  .description('The expo-field-test-protocol harness (§4 oracle / §6 habits (ii)+(iii)): audit CLEAN seals against the project\'s OWN declared green-gate, capture blinded KNOT rating cards, and log every reach for the git fallback. Writes .warpline/field/ only.');

/**
 * The REAL CheckRunner (§4): node execFile with a timeout, no shell. pass ⇔
 * exit 0; the combined output is captured for the operator, never parsed.
 */
const FIELD_CHECK_TIMEOUT_MS = 10 * 60 * 1000;
const realCheckRunner: CheckRunner = (spec: CheckSpec, cwd: string) =>
  new Promise((resolve) => {
    execFile(
      spec.cmd,
      spec.args,
      { cwd, timeout: FIELD_CHECK_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({ status: err ? 'fail' : 'pass', output: `${stdout ?? ''}${stderr ?? ''}` });
      },
    );
  });

field
  .command('oracle')
  .description('Run the §4 CLEAN-seal oracle over every not-yet-audited seal: restore result (and, for merges, ours+theirs) trees, run the declared green-gate on the PARENTS FIRST (establishing power), then the merged tree; append one hash-chained row per seal to .warpline/field/expo-field-oracle.jsonl. Idempotent — already-audited strands are skipped. The check set comes from .warpline/field/greengate.json (never hardcoded); an absent config records every check absent, not passed.')
  .option('--since <seq>', 'only audit seals with a ledger seq greater than this (v3 strands carry no seq and always qualify)')
  .option('--greengate <path>', 'explicit greengate.json path (default: .warpline/field/greengate.json)')
  .option('--json', 'emit the run result (audited rows + totals) as JSON')
  .action(async (options: { since?: string; greengate?: string; json?: boolean }) => {
    try {
      const root = await resolveRoot();
      let since: number | undefined;
      if (options.since !== undefined) {
        since = Number(options.since);
        if (!Number.isInteger(since) || since < 0) {
          process.stderr.write(`warpline: --since must be a non-negative integer seq (got "${options.since}")\n`);
          process.exit(1);
        }
      }
      const result = await runFieldOracle(root, {
        runner: realCheckRunner,
        since,
        greengatePath: options.greengate ? path.resolve(options.greengate) : undefined,
      });
      if (options.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        printFieldOracle(root, result);
      }
    } catch (err) {
      fail(err);
    }
  });

field
  .command('cards')
  .description('Habit (ii) capture, SCAN-based: build the blinded §5 rating card for every persisted KNOT payload (.warpline/knots/) via the judge stripper — the card on disk carries NO Warpline verdict/confidence/founder label — and record byte-downgrade KNOTs that have no payload (B-3 gap) card-less in .warpline/field/cards/byte-downgrades.jsonl. Idempotent by cardId.')
  .option('--json', 'emit the collected counts as JSON')
  .action(async (options: { json?: boolean }) => {
    try {
      const root = await resolveRoot();
      const cards = collectFieldCards(root, { store: new ObjectStore(root) });
      const result = writeCards(root, cards);
      if (options.json) {
        process.stdout.write(
          JSON.stringify(
            {
              knotCards: cards.knotCards.map((c) => c.cardId),
              byteDowngrades: cards.byteDowngrades,
              ...result,
            },
            null,
            2,
          ) + '\n',
        );
      } else {
        printFieldCards(root, cards, result);
      }
    } catch (err) {
      fail(err);
    }
  });

field
  .command('fallback')
  .description('Habit (iii): log a reach for the git fallback (git merge / stash / manual resolution outside Warpline / unadmittable byte-only work) to .warpline/field/git-fallback.jsonl — what was reached for, why, and which admit/KNOT it relates to. --list prints the log.')
  .option('-m, --message <msg>', 'what was reached for, and why (required unless --list)')
  .option('--knot <id>', 'the related KNOT (payloadId / selector)')
  .option('--admit <ref>', 'the related admit (ref / stateId / pickId)')
  .option('-l, --list', 'print the fallback log instead of appending')
  .option('--json', 'emit the entry (or the whole log with --list) as JSON')
  .action(async (options: { message?: string; knot?: string; admit?: string; list?: boolean; json?: boolean }) => {
    try {
      const root = await resolveRoot();
      if (options.list) {
        const entries = listGitFallbacks(root);
        if (options.json) process.stdout.write(JSON.stringify(entries, null, 2) + '\n');
        else printFieldFallbackList(root, entries);
        return;
      }
      if (!options.message) {
        process.stderr.write('warpline: field fallback — provide -m <msg> (what was reached for, and why), or --list\n');
        process.exit(1);
      }
      const entry = recordGitFallback(root, {
        message: options.message,
        actor: process.env.USER ?? process.env.USERNAME ?? 'unknown',
        knotId: options.knot,
        admitRef: options.admit,
      });
      if (options.json) process.stdout.write(JSON.stringify(entry, null, 2) + '\n');
      else {
        process.stdout.write(
          `FALLBACK  logged (${gitFallbackPathOf(root)})\n  ${entry.ts}  ${entry.actor}\n  ${entry.message}\n` +
            (entry.knotId ? `  knot   ${entry.knotId}\n` : '') +
            (entry.admitRef ? `  admit  ${entry.admitRef}\n` : ''),
        );
      }
    } catch (err) {
      fail(err);
    }
  });

field
  .command('judge')
  .description('Run the blinded cold judge over the assembled §5 card stream: KNOT cards (field cards output) + oracle-flagged CLEANs + the §4 random audit sample + planted/genuine/over-block seeds, interleaved with the COMMITTED shuffle seed, through the enforcing runner (injection pre-flight FIRST; majority verdicts sealed with §4 provenance into the hash-chained ledger .warpline/field/judge/expo-field-audit.jsonl; head written to the git witness file). Idempotent by cardId. Default requires ANTHROPIC_API_KEY (the pinned live judge); --fake is a deterministic dry-run that measures nothing.')
  .option('--fake', 'deterministic fake model (labels by card kind) — pipeline rehearsal only')
  .option('--batch-limit <n>', 'cap NEW cards scored this invocation (continuity scores the rest next run)')
  .option('--seed <hex>', 'shuffle seed — refused if a DIFFERENT seed is already committed')
  .option('--json', 'emit the run result as JSON')
  .action(async (options: { fake?: boolean; batchLimit?: string; seed?: string; json?: boolean }) => {
    try {
      const root = await resolveRoot();
      let batchLimit: number | undefined;
      if (options.batchLimit !== undefined) {
        batchLimit = Number(options.batchLimit);
        if (!Number.isInteger(batchLimit) || batchLimit < 0) {
          process.stderr.write(`warpline: --batch-limit must be a non-negative integer (got "${options.batchLimit}")\n`);
          process.exit(1);
        }
      }
      const callModel = options.fake ? fakeFieldCallModel() : liveCallModel();
      const result = await runFieldJudge(root, {
        callModel,
        seed: options.seed,
        batchLimit,
      });
      if (options.json) {
        const { runner, ...rest } = result;
        process.stdout.write(
          JSON.stringify(
            {
              ...rest,
              disqualified: runner.disqualified,
              disqualifyReason: runner.disqualifyReason ?? null,
              scored: runner.scored,
              previousHead: runner.previousHead,
              ledgerHead: runner.ledgerHead,
              witnessPath: runner.witnessPath,
              voided: runner.preflight.voided,
              corpusResults: runner.preflight.corpusResults,
            },
            null,
            2,
          ) + '\n',
        );
      } else {
        printFieldJudge(root, result, options.fake === true);
      }
      if (result.runner.disqualified) process.exit(1);
    } catch (err) {
      fail(err);
    }
  });

field
  .command('join')
  .description('Join Warpline\'s verdicts to the sealed judge ratings (write-before-reveal). PRECONDITION (§3 A13, no escape hatch): the ledger chain must contain a GIT-COMMITTED head — `git show HEAD:<witness>` must equal some row\'s rowHash — or NOTHING is joined. CLEAN cards join the oracle-row verdict; KNOT cards join \'KNOT\' (\'KNOT:resolved\' when the fabric records the resolution). Idempotent; the join rows extend the chain, so the NEW head needs its own witness commit (printed).')
  .option('--json', 'emit the join result as JSON')
  .action(async (options: { json?: boolean }) => {
    try {
      const root = await resolveRoot();
      const result = joinFieldVerdicts(root);
      if (options.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        printFieldJoin(result);
      }
    } catch (err) {
      fail(err);
    }
  });

field
  .command('score')
  .description('Score the run PURELY from recorded artifacts (oracle ledger + judge ledger + judgments.jsonl + fallback log): §7A two separate false-CLEAN bounds (never blended), §7B byte-baseline column + meaning-decisive count (+ catch-candidates, not claimed), §7C intervention rate + K2, seeded-control precision/recall, indeterminate fraction. Writes the §9 report to .warpline/field/report.md + report.json — every mandatory element, VOID/not-tested defaults when preconditions are unmet.')
  .option('--admissions <n>', 'admissions denominator override (default: oracle-ledger seals, planted excluded)')
  .option('--json', 'emit the full score as JSON (still writes report.md/report.json)')
  .action(async (options: { admissions?: string; json?: boolean }) => {
    try {
      const root = await resolveRoot();
      let admissionsOverride: number | undefined;
      if (options.admissions !== undefined) {
        admissionsOverride = Number(options.admissions);
        if (!Number.isInteger(admissionsOverride) || admissionsOverride < 0) {
          process.stderr.write(`warpline: --admissions must be a non-negative integer (got "${options.admissions}")\n`);
          process.exit(1);
        }
      }
      const score = scoreFieldRunFromDisk(root, { admissionsOverride });
      const markdown = renderFieldReport(score);
      const mdPath = fieldReportMarkdownPathOf(root);
      const jsonPath = fieldReportJsonPathOf(root);
      await fs.mkdir(path.dirname(mdPath), { recursive: true });
      await fs.writeFile(mdPath, markdown, 'utf8');
      await fs.writeFile(jsonPath, JSON.stringify(score, null, 2) + '\n', 'utf8');
      if (options.json) {
        process.stdout.write(JSON.stringify(score, null, 2) + '\n');
      } else {
        printFieldScore(score, mdPath, jsonPath);
      }
    } catch (err) {
      fail(err);
    }
  });

/* ── field seed (PRE-APP KIT — seal the §5 seed/corpus card sets) ─────────────── */

const fieldSeed = field
  .command('seed')
  .description('Build the SEALED seed/corpus card sets the run\'s own loader (field interleave) enforces (§4 planted control / §5+§A9 corpus / §A6 seeds). Every verb writes RatingCard JSON + a manifest.json (file, cardId, sha256, groundTruth/steeredLabel) that #field-interleave.loadSeedCards accepts verbatim. Commit each sealed set\'s sha256 to git before admission 1 (v2 §C).');

fieldSeed
  .command('corpus')
  .description('Seal the STARTER public prompt-injection corpus (v2 §A9 — externally-authored PUBLIC payload strings embedded in team-built cards) into .warpline/field/seeds/corpus/ (or --out). Prints the count + manifest sha256. Refuses to overwrite a non-empty sealed dir unless --force.')
  .option('--out <dir>', 'target seeds dir (default: .warpline/field/seeds/corpus)')
  .option('--force', 'overwrite a non-empty sealed dir')
  .option('--json', 'emit the seal result as JSON')
  .action(async (options: { out?: string; force?: boolean; json?: boolean }) => {
    try {
      const root = await resolveRoot();
      const dir = options.out ? path.resolve(options.out) : path.join(seedsDirOf(root), 'corpus');
      guardSealDir(dir, options.force === true);
      const cards = starterInjectionCorpusCards();
      const inputs: SealCardInput[] = cards.map((c) => ({ card: c.card, steeredLabel: c.steeredLabel }));
      const res = sealCardSet(dir, inputs);
      printSeal('corpus', res, options.json === true);
    } catch (err) {
      fail(err);
    }
  });

fieldSeed
  .command('planted')
  .description('Seal ONE §4/A6 planted false-CLEAN control card (groundTruth: broken) from two supplied file versions into .warpline/field/seeds/planted/ (or --out). With --ours/--theirs omitted it uses the DEFAULT SYNTHETIC pair and warns LOUDLY — replace with real subject files before the run. Refuses to overwrite a non-empty sealed dir unless --force.')
  .option('--ours <file>', 'the ours-side file (the limit-100→50 change); default = synthetic')
  .option('--theirs <file>', 'the theirs-side file (the retry-loop-assuming-100 change); default = synthetic')
  .option('--merged <file>', 'the sealed merged bytes (default: theirs-over-ours union, or synthetic pair\'s merged)')
  .option('--path <relPath>', 'the changed file\'s repo-relative path when --ours/--theirs are given (default: src/paginate.ts)')
  .option('--failing-check <name>', 'the oracle check NAME that would fail on the merge (§4)')
  .option('--out <dir>', 'target seeds dir (default: .warpline/field/seeds/planted)')
  .option('--force', 'overwrite a non-empty sealed dir')
  .option('--json', 'emit the seal result as JSON')
  .action(async (options: {
    ours?: string; theirs?: string; merged?: string; path?: string;
    failingCheck?: string; out?: string; force?: boolean; json?: boolean;
  }) => {
    try {
      const root = await resolveRoot();
      const dir = options.out ? path.resolve(options.out) : path.join(seedsDirOf(root), 'planted');
      guardSealDir(dir, options.force === true);
      const store = new ObjectStore(root);

      const useSynthetic = options.ours === undefined && options.theirs === undefined;
      let result;
      if (useSynthetic) {
        result = buildPlantedControlCard(store, {
          ours: DEFAULT_PLANTED_PAIR.ours,
          theirs: DEFAULT_PLANTED_PAIR.theirs,
          merged: DEFAULT_PLANTED_PAIR.merged,
        });
      } else {
        if (options.ours === undefined || options.theirs === undefined) {
          process.stderr.write('warpline: field seed planted — supply BOTH --ours and --theirs (or neither, for the synthetic pair)\n');
          process.exit(1);
        }
        const rel = options.path ?? 'src/paginate.ts';
        const oursBody = await fs.readFile(path.resolve(options.ours), 'utf8');
        const theirsBody = await fs.readFile(path.resolve(options.theirs), 'utf8');
        const mergedBody = options.merged ? await fs.readFile(path.resolve(options.merged), 'utf8') : undefined;
        result = buildPlantedControlCard(store, {
          ours: { [rel]: oursBody },
          theirs: { [rel]: theirsBody },
          ...(mergedBody !== undefined ? { merged: { [rel]: mergedBody } } : {}),
          ...(options.failingCheck ? { failingCheck: options.failingCheck } : {}),
        });
      }

      const res = sealCardSet(dir, [{ card: result.card, groundTruth: result.groundTruth }]);
      if (result.synthetic && !options.json) {
        process.stdout.write(
          'WARNING   SYNTHETIC planted control — replace with REAL subject file versions before the run (v2 §4/A6).\n',
        );
      }
      printSeal('planted', res, options.json === true, result.synthetic);
    } catch (err) {
      fail(err);
    }
  });

fieldSeed
  .command('classify')
  .description('Seal already-captured KNOT rating cards (from `warpline field cards`) as KNOWN-GENUINE / KNOWN-OVER-BLOCK classifier seeds with the operator-supplied ground truth (§A6 — these are authored AFTER the subject produces contested cards). Reads --from (a cards dir), seals into .warpline/field/seeds/{genuine|over-block}/ (or --out). Refuses to overwrite a non-empty sealed dir unless --force.')
  .requiredOption('--from <cards-dir>', 'a directory of captured RatingCard JSON (e.g. .warpline/field/cards)')
  .requiredOption('--truth <GENUINE|OVER-BLOCK>', 'the sealed ground truth for every card read')
  .option('--out <dir>', 'target seeds dir (default: .warpline/field/seeds/{genuine|over-block})')
  .option('--force', 'overwrite a non-empty sealed dir')
  .option('--json', 'emit the seal result as JSON')
  .action(async (options: { from: string; truth: string; out?: string; force?: boolean; json?: boolean }) => {
    try {
      const root = await resolveRoot();
      const truth = options.truth.toUpperCase();
      if (truth !== 'GENUINE' && truth !== 'OVER-BLOCK') {
        process.stderr.write(`warpline: field seed classify — --truth must be GENUINE or OVER-BLOCK (got "${options.truth}")\n`);
        process.exit(1);
      }
      const sub = truth === 'GENUINE' ? 'genuine' : 'over-block';
      const dir = options.out ? path.resolve(options.out) : path.join(seedsDirOf(root), sub);
      guardSealDir(dir, options.force === true);
      const cards = readCardsFromDir(path.resolve(options.from));
      if (cards.length === 0) {
        process.stderr.write(`warpline: field seed classify — no RatingCard JSON found under ${path.resolve(options.from)}\n`);
        process.exit(1);
      }
      const inputs: SealCardInput[] = cards.map((card) => ({ card, groundTruth: truth as 'GENUINE' | 'OVER-BLOCK' }));
      const res = sealCardSet(dir, inputs);
      printSeal(sub, res, options.json === true);
    } catch (err) {
      fail(err);
    }
  });

fieldSeed
  .command('verify')
  .description('THE MONEY VERB: load all four sealed dirs (planted/genuine/over-block/corpus) through the RUN\'S OWN loader (#field-interleave.loadSeedCards) and report counts + any seal failure. This proves §C condition (c) — the sealed manifests will pass the run\'s loader — BEFORE the freeze. Non-zero exit on any failure.')
  .option('--dir <seeds-root>', 'the seeds root holding the four sealed dirs (default: .warpline/field/seeds)')
  .option('--json', 'emit the verify result as JSON')
  .action(async (options: { dir?: string; json?: boolean }) => {
    try {
      const root = await resolveRoot();
      const base = options.dir ? path.resolve(options.dir) : seedsDirOf(root);
      let sets: SeedCardSets | null = null;
      let error: string | null = null;
      try {
        sets = loadSeedCardsFromDir(base);
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
      if (options.json) {
        process.stdout.write(
          JSON.stringify(
            sets
              ? {
                  ok: true,
                  base,
                  counts: {
                    planted: sets.planted.length,
                    genuine: sets.genuine.length,
                    overBlock: sets.overBlock.length,
                    corpus: sets.corpus.length,
                  },
                }
              : { ok: false, base, error },
            null,
            2,
          ) + '\n',
        );
      } else {
        printSeedVerify(base, sets, error);
      }
      if (!sets) process.exit(1);
    } catch (err) {
      fail(err);
    }
  });

/* ── field init-subject (PRE-APP KIT — scaffold the subject repo) ─────────────── */

field
  .command('init-subject')
  .description('One-shot onboarding for the field-test SUBJECT (the new Expo app once it exists): scaffold a starter .warpline/field/greengate.json (v2 §A3 tsc + expo export) + a behavioral-checklist template, and PRINT the ordered runbook §0 pre-run checklist (each item auto/manual) + the keys-before-propose reminder. Does NOT run `warpline init` or mint keys — those are deliberate human acts. Idempotent: refuses to clobber an existing greengate.json unless --force.')
  .argument('[dir]', 'the subject repo path (default: the resolved root)')
  .option('--force', 'replace an existing greengate.json / template')
  .option('--json', 'emit the bootstrap result as JSON')
  .action(async (dir: string | undefined, options: { force?: boolean; json?: boolean }) => {
    try {
      const root = dir ? path.resolve(dir) : await resolveRoot();
      const result = initSubject(root, { force: options.force });
      if (options.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        printInitSubject(result);
      }
    } catch (err) {
      fail(err);
    }
  });

program
  .command('restore')
  .description('Reconstruct a working tree from the NATIVE object store with git ABSENT — the layer→VCS threshold. Resolves a selector to a strand byte binding and materializes its bytes byte-faithfully into --to (default: the repo root). Path-hardened: a forged/corrupt tree name fails closed.')
  .argument('[selector]', 'HEAD | selvage | N | @N | pick:<id> | state:<id> | tree:<id>', 'HEAD')
  .option('--to <dir>', 'target directory to reconstruct into (default: the repo root)')
  .option('--force', 'overwrite colliding paths in a non-empty dest (overlay, never wipe)')
  .option('--json', 'emit the restore result as JSON')
  .action(async (selector: string, options: { to?: string; force?: boolean; json?: boolean }) => {
    try {
      // resolveRoot() falls back to the cwd when git is absent — which is the
      // whole point here (the repo root the user runs from, where .warpline/ lives).
      const root = await resolveRoot();
      const dest = options.to ? path.resolve(options.to) : root;
      const result = restore(root, { selector, to: dest, force: options.force });
      if (options.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        printRestore(result);
      }
    } catch (err) {
      fail(err);
    }
  });

program
  .command('branch')
  .description(
    'Branches (M2.5). A BRANCH is a NAMED LINE of history — a refs/heads/<name> holding a pickId, exactly like `selvage` (the default trunk). `branch <name>` opens a new line at the current HEAD tip (or --from <selector>); `branch --list` (or no args) shows them all with the current one marked *; `branch -d <name>` retires a name (its strand survives in the ledger as an abandoned head, recoverable with `warpline refs set`). These are AGENT-CLASS verbs — opening a lane is what the fabric exists to adjudicate. NEXT: `warpline switch <name>` to move your worktree onto it. PROTECTED BRANCHES (M2.5 security): `branch --protect <name>` / `--unprotect <name>` (HUMAN-class) control which lines an agent may NOT auto-land onto — `selvage` is protected by default. An agent-class admit/merge ONTO a protected branch is refused (land onto a feature branch, let a human integrate); `branch --protected` lists them.',
  )
  .argument('[name]', 'the branch to create (omit with --list, or to just list)')
  .option('-l, --list', 'list branches (the current one marked with *)')
  .option('-d, --delete', 'delete the named branch (unlinks the ref; the strand survives in the ledger)')
  .option('--from <selector>', 'create at this selector instead of the HEAD tip (HEAD | selvage | <branch> | pick:<id> | state:<id> | @N)')
  .option('--protect <name>', 'PROTECT a branch: agent-class admit/merge may not LAND onto it (main is a human/policy act). HUMAN-CLASS. Default: selvage is protected.')
  .option('--unprotect <name>', 'UNPROTECT a branch (agents may land onto it again). HUMAN-CLASS.')
  .option('--protected', 'list the protected branches')
  .option('--json', 'emit the result as JSON')
  .action(async (name: string | undefined, options: { list?: boolean; delete?: boolean; from?: string; protect?: string; unprotect?: string; protected?: boolean; json?: boolean }) => {
    try {
      const root = await resolveRoot();
      // #protected registry (M2.5 security, TD-2026-08-12-813). protect/unprotect
      // is a HUMAN-class act — an agent must never decide what is protected FROM
      // agents — enforced with the same #agent-shell credential the landing gate
      // uses: an agent shell ($WARPLINE_AGENT_ID) is refused, an operator console
      // is not. Listing is a plain read (any shell).
      if (options.protect !== undefined || options.unprotect !== undefined) {
        if (shellPrincipal() === 'agent') {
          throw new RefusedError(
            refuse({ code: 'FORBIDDEN', retriable: 'never' }),
            `warpline: branch --${options.protect !== undefined ? 'protect' : 'unprotect'} is a HUMAN-class act — an agent must never change what is protected FROM agents (Aegis §2.2). ` +
              `This shell is an AGENT shell (${'WARPLINE_AGENT_ID'} set); escalate to a human. A human shell does not export it.`,
          );
        }
        const result = options.protect !== undefined
          ? protectBranch(root, options.protect)
          : unprotectBranch(root, options.unprotect!);
        if (options.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        else {
          const verb = options.protect !== undefined ? 'PROTECT' : 'UNPROTECT';
          process.stdout.write(
            `BRANCH ${verb}  ${result.name}${result.changed ? '' : '  (no-op — already ' + (options.protect !== undefined ? 'protected' : 'unprotected') + ')'}\n` +
              `  protected now: ${result.protected.length ? result.protected.join(', ') : '(none)'}\n`,
          );
        }
        return;
      }
      if (options.protected) {
        const names = listProtected(root);
        if (options.json) process.stdout.write(JSON.stringify(names, null, 2) + '\n');
        else process.stdout.write(`PROTECTED  ${names.length ? names.join(', ') : '(none)'}\n`);
        return;
      }
      if (options.delete) {
        if (!name) throw new Error('`branch -d` needs a <name> to delete');
        const result = deleteBranch(root, name);
        if (options.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        else printBranchDelete(result);
        return;
      }
      if (name && !options.list) {
        const result = createBranch(root, name, { from: options.from });
        if (options.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        else printBranchCreate(result);
        return;
      }
      // no name (or --list) → list branches, git-parity.
      const branches = listBranches(root);
      if (options.json) process.stdout.write(JSON.stringify(branches, null, 2) + '\n');
      else printBranchList(branches);
    } catch (err) {
      fail(err);
    }
  });

program
  .command('switch')
  .alias('checkout')
  .description(
    'Move your worktree onto a branch (M2.5). SWITCH restores the branch tip\'s bytes into the worktree (git ABSENT — through the same guarded writer restore/admit use) and moves HEAD onto the branch. REFUSE-DIRTY by default (git-parity): a worktree path whose current bytes are in NO object refuses — pass --force to overwrite it. Switch OVERLAYS the target tree (unrelated files are left in place). AGENT-CLASS. `checkout` is an alias.',
  )
  .argument('<name>', 'the branch to switch to')
  .option('--force', 'overwrite colliding worktree paths whose bytes are in no object (refuse-dirty is the default)')
  .option('--json', 'emit the result as JSON')
  .action(async (name: string, options: { force?: boolean; json?: boolean }) => {
    try {
      const root = await resolveRoot();
      const result = switchBranch(root, root, name, { force: options.force });
      if (options.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      else printSwitch(result);
    } catch (err) {
      fail(err);
    }
  });

program
  .command('merge')
  .description(
    "Merge a branch INTO the current one (M2.5). `warpline merge <from>` folds <from> into the current HEAD branch (or --into <branch>) through the SAME seal core `admit` runs: disjoint meaning auto-folds CLEAN, a same-symbol contradiction KNOTs, a byte-conflict downgrades to KNOT. THE FAIL-CLOSED RULE — a merge that would auto-fold a change MEANING WAS BLIND TO (a byte-decided config value or a scalar `const` invariant) does NOT seal: it HOLDS, names the byte-decided paths, and a human must `--confirm`. That makes merge STRICTLY SAFER than git (git auto-merges disjoint config×code silently). A CLEAN fold is agent-class; a HOLD or KNOT escalates to a human, exactly like admit→resolve. Criss-cross / disjoint roots fail closed.",
  )
  .argument('<from>', 'the branch to merge in (ours)')
  .option('--into <branch>', 'the target branch to advance (default: the current HEAD branch)')
  .option('--confirm', 'human override: seal a merge that meaning was blind to (byte-decided paths) — like a resolve')
  .option('--worktree <dir>', 'the worktree for a CLEAN write-back (default: the repo root)')
  .option('--no-restore', 'do NOT write the merged bytes back into the worktree')
  .option('--json', 'emit the full merge result as JSON')
  .action(async (from: string, options: { into?: string; confirm?: boolean; worktree?: string; restore?: boolean; json?: boolean }) => {
    try {
      const root = await resolveRoot();
      // Default `into` = the current HEAD branch. A detached HEAD names no branch
      // to advance, so a merge there fails closed (mirrors admit's --onto rule).
      let into = options.into;
      if (into === undefined) {
        const head = readHead(root);
        if (head === null) into = DEFAULT_BRANCH;
        else if (head.kind === 'branch') into = head.branch;
        else {
          process.stderr.write(
            `warpline: merge — HEAD is detached at ${head.pickId}; there is no current branch to merge into. Pass --into <branch>, or switch onto a branch first.\n`,
          );
          process.exit(2);
        }
      }
      const mergeTarget = cliTarget({ from, into }, { confirm: options.confirm, noRestore: options.restore === false });
      const result = await traceCli(
        { root, verb: 'merge', target: mergeTarget, principal: from },
        () =>
          mergeBranch(root, {
            from,
            into: into!,
            // #protected landing gate: an AGENT shell may not merge INTO a
            // protected branch (the clean-land laundering route); an UNMARKED
            // operator shell is human-class and integrates freely.
            principal: shellPrincipal(),
            ...(options.confirm ? { acceptMeaningBlind: true } : {}),
            ...(options.worktree ? { worktree: path.resolve(options.worktree) } : {}),
            ...(options.restore === false ? { noRestore: true } : {}),
          }),
      );
      if (options.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        printMerge(result);
      }
      // Verdict-keyed exit (T-2026-07-21-006): a HOLD/KNOT must not exit 0.
      process.exitCode = exitCodeForResult(result);
    } catch (err) {
      fail(err);
    }
  });

const objects = program
  .command('objects')
  .description('The native content-addressed object store (byte authority) — the store that lets Warpline reconstruct a working tree with git ABSENT.');

objects
  .command('snapshot')
  .description('Snapshot a directory into the native object store; prints the root treeId (byte identity) + the shadow git tree OID (== `git rev-parse <ref>^{tree}` for a clean worktree). Honors .warplineignore (else .gitignore) at the target root; .git/.warpline/.loom/node_modules are always skipped. Warm walks reuse the .warpline/index stat cache (I5) — only changed files are rehashed.')
  .argument('<dir>', 'the directory to snapshot')
  .option('--json', 'emit the snapshot result as JSON')
  .action(async (dir: string, options: { json?: boolean }) => {
    try {
      const root = await resolveRoot();
      const target = path.resolve(dir);
      const store = new ObjectStore(root);
      const result = snapshotDir(store, target, { indexRoot: root }); // I5 stat cache
      if (options.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        process.stdout.write(
          `SNAPSHOT ${target}\n  treeId  ${result.treeId}\n  gitOid  ${result.gitOid}  (shadow — matches git during coexistence)\n  entries ${result.entryCount} (root)\n`,
        );
      }
    } catch (err) {
      fail(err);
    }
  });

objects
  .command('verify')
  .description('Recompute every loose object\'s content-address and confirm it matches its on-disk location — a corrupt/tampered object is reported, never silently trusted.')
  .option('--json', 'emit the verify report as JSON')
  .action(async (options: { json?: boolean }) => {
    try {
      const root = await resolveRoot();
      const report = new ObjectStore(root).verify();
      if (options.json) {
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      } else if (report.corrupt.length === 0) {
        process.stdout.write(`VERIFY   ${report.checked} object(s) — all intact\n`);
      } else {
        process.stdout.write(`VERIFY   ${report.checked} checked, ${report.corrupt.length} CORRUPT:\n`);
        for (const id of report.corrupt) process.stdout.write(`  ✗ ${id}\n`);
        process.exitCode = 1;
      }
    } catch (err) {
      fail(err);
    }
  });

objects
  .command('backfill')
  .description('Stamp a native byte binding onto every v1 strand that lacks one, from its provenance git commit tree — so the v1 prefix has all the bindings it will ever have BEFORE `fabric attest` freezes it. Pre-attestation only; refuses once an anchor exists.')
  .option('--json', 'emit the backfill result as JSON')
  .action(async (options: { json?: boolean }) => {
    try {
      const root = await resolveRoot();
      const result = await backfillV1Bindings(root, { cwd: root });
      if (options.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        const lines: string[] = [];
        lines.push(`BACKFILL  ${result.stamped.length} v1 strand(s) newly bound  (${result.alreadyBound} already bound)`);
        for (const s of result.stamped) lines.push(`  ✓ seq ${s.seq}  ${short(s.treeId)}`);
        if (result.unbound.length) {
          lines.push(`  ⚠ ${result.unbound.length} strand(s) stay PERMANENTLY unbound (restore of them refuses forever):`);
          for (const u of result.unbound) lines.push(`    ✗ seq ${u.seq}  ${u.reason}`);
        }
        process.stdout.write(lines.join('\n') + '\n');
      }
    } catch (err) {
      fail(err);
    }
  });

const fabric = program
  .command('fabric')
  .description('The fabric ledger (this project\'s native meaning-history) — authenticate the whole PICK-DAG.');

fabric
  .command('verify')
  .description('Authenticate the fabric: recompute every strand\'s pickId (integrity), walk the v2 chain link (reorder/forge detection), resolve merge second-parents, and re-derive each strand\'s byte binding against the object store. Exit 0 = intact, 1 = tamper/break found.')
  .option('--json', 'emit the full FabricVerifyReport as JSON')
  .action(async (options: { json?: boolean }) => {
    try {
      const root = await resolveRoot();
      const report = verifyFabric(root);
      if (options.json) {
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      } else if (report.failures.length === 0) {
        const anchorLine = report.anchor.present
          ? `  anchor     epoch:v1 ✓${report.anchor.corroboration ? ` (corroborated at git ${report.anchor.corroboration.slice(0, 12)})` : ''}\n`
          : report.v1Prefix.count
            ? '  anchor     (none — v1 prefix unattested)\n'
            : '';
        process.stdout.write(
          `VERIFY   ${report.checked} strand(s) — all intact\n` +
            `  v1 prefix  ${report.v1Prefix.count} (self-hash ${report.v1Prefix.selfHashOk ? 'ok' : 'FAILED'}, ordering unauthenticated — OQ-A)\n` +
            `  v2 chain   ${report.v2Chain.count} (${report.v2Chain.ok ? 'ok' : 'BROKEN'})\n` +
            (report.v3Dag.count
              ? `  v3 dag     ${report.v3Dag.count} (${report.v3Dag.ok ? 'ok' : 'BROKEN'} — closure/causality/acyclicity)\n`
              : '') +
            `  boundary   ${report.boundaryAnchored ? 'anchored ✓' : 'not anchored'}\n` +
            (report.signing.epochPinned
              ? `  signing    epoch from ${report.signing.signedFromPickId ? report.signing.signedFromPickId.slice(0, 20) : '(genesis)'} — ${report.signing.signed} signed, ${report.signing.exempt} exempt\n`
              : '  signing    epoch: none (no signed-from pinned — every strand exempt)\n') +
            anchorLine +
            (report.legacyUnverifiable.count
              ? `  legacy     ${report.legacyUnverifiable.count} grandfathered (unverifiable, sealed under a retired rule — TD-2026-07-01-202)\n`
              : '') +
            (report.stakeJournal.attested
              ? `  stakes     ${report.stakeJournal.attested} checkpoint(s) cross-checked — no history missing (C-6)\n`
              : '') +
            (report.abandonedHeads.length
              ? `  ⚠ abandoned head(s) — no ref names: ${report.abandonedHeads.map((h) => h.slice(0, 20)).join(', ')}\n` +
                `    recover one with: warpline refs set <name> <pickId>\n`
              : ''),
        );
      } else {
        process.stdout.write(`VERIFY   ${report.checked} checked, ${report.failures.length} FAILURE(S):\n`);
        for (const f of report.failures) {
          process.stdout.write(`  ✗ seq ${f.seq}  ${f.kind}  ${short(f.pickId)}\n    ${f.detail}\n`);
        }
        process.exitCode = 1;
      }
    } catch (err) {
      // §4.3: a usage / I/O error (fabric unreadable, store missing) → exit 2,
      // distinct from an authenticated-but-broken ledger (exit 1 above).
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`warpline: ${msg}\n`);
      process.exit(2);
    }
  });

fabric
  .command('attest')
  .description('THE ONE-TIME v1-anchor verb: digest the entire v1 prefix + grandfather manifest into a chained attestation strand, corroborated against git history, then FREEZE the v1 prefix forever. No re-attest/force/repair verb exists. Run `objects backfill` + commit first.')
  .option('--as <actor>', 'actor recording the anchor (default: the tip strand actor)')
  .option('--agent <id>', 'agent recording the anchor (IN the v2 pickId)')
  .option('--allow-unbound', 'freeze permanently-unrestorable (unbound) v1 strands rather than refusing')
  .option('--json', 'emit the attest result as JSON')
  .action(async (options: { as?: string; agent?: string; allowUnbound?: boolean; json?: boolean }) => {
    try {
      const root = await resolveRoot();
      const result = await attestFabric(root, {
        cwd: root,
        actor: options.as,
        agentId: options.agent ?? null,
        allowUnbound: options.allowUnbound,
      });
      if (options.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        const lines: string[] = [];
        lines.push(`ATTEST  v1 epoch anchor sealed  (seq ${result.strand.seq})`);
        lines.push(`pick        ${result.strand.pickId}`);
        lines.push(`prefix      ${result.prefixCount} v1 strand(s) frozen  (${result.grandfatheredCount} grandfathered)`);
        lines.push(`corroborated at git ${result.gitCommit.slice(0, 12)}`);
        if (result.unbound.length) lines.push(`⚠ frozen unbound (unrestorable): seq ${result.unbound.join(', ')}`);
        lines.push('');
        lines.push('→ the v1 prefix is now IMMUTABLE; `fabric verify` authenticates it against this anchor.');
        process.stdout.write(lines.join('\n') + '\n');
      }
    } catch (err) {
      fail(err);
    }
  });

fabric
  .command('repair')
  .description(
    'THE REPAIR PATH (audit C-13): salvage a TORN TAIL line. A short write (a full disk needs no crash at all) leaves a partial strand that bricks every verb including `fabric verify` — the recovery used to be hand-editing JSONL. Reports what it would drop and writes NOTHING without --confirm; with --confirm it quarantines the original under .warpline/repair/ first, then republishes the well-formed prefix VERBATIM. Refuses when the corruption is not at the tail (truncating would discard good strands). Repair does not PREVENT the tear — fsync makes a write durable, not atomic — it makes one recoverable.',
  )
  .option('--confirm', 'actually rewrite the ledger (default: dry run — report the plan, write nothing)')
  .option('--json', 'emit the repair result as JSON')
  .action(async (options: { confirm?: boolean; json?: boolean }) => {
    try {
      const root = await resolveRoot();
      const result = await repairFabric(root, { confirm: options.confirm });
      if (options.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        printRepair(result);
      }
    } catch (err) {
      fail(err);
    }
  });

program
  .command('fsck')
  .description(
    'THE INTEGRITY UMBRELLA (M3-lite I5): one read-only pass over every custody surface — fabric verify (chain + DAG + bindings + signatures), objects verify (loose-object re-hash), refs consistency, key-registry health, and the stake-journal cross-check. Reuses the exact checks the individual verbs run; fsck adds aggregation, never new verification machinery. Exit 0 = every section ok (warnings do not fail), 1 = a section failed, 2 = could not run.',
  )
  .option('--json', 'emit the full FsckReport as JSON')
  .action(async (options: { json?: boolean }) => {
    try {
      const root = await resolveRoot();
      const report = runFsck(root);
      if (options.json) {
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      } else {
        const lines: string[] = [];
        lines.push(report.ok ? 'FSCK     ok — every section intact' : 'FSCK     FAILED');
        for (const [name, section] of Object.entries(report.sections) as Array<[string, FsckSection]>) {
          const verdict = !section.ok ? 'FAIL' : section.findings.length ? 'WARN' : 'PASS';
          lines.push(`  ${pad(name, 10)}${verdict}${section.notes.length ? `  (${section.notes.join('; ')})` : ''}`);
          for (const f of section.findings) {
            lines.push(`    ${f.level === 'fail' ? '✗' : '⚠'} ${f.kind}  ${f.message}`);
          }
        }
        process.stdout.write(lines.join('\n') + '\n');
      }
      // exit 0 iff ok — in BOTH render modes (fsck's contract; warnings never fail).
      if (!report.ok) process.exitCode = 1;
    } catch (err) {
      // §4.3 (the `fabric verify` idiom): a usage / I/O error (fabric unreadable,
      // store missing) → exit 2, distinct from an integrity failure (exit 1).
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`warpline: ${msg}\n`);
      process.exit(2);
    }
  });

const refs = program
  .command('refs')
  .description('pickId refs (v3-identity V3.2) — .warpline/refs/heads/<name> each hold an EVENT identity (a pickId), not a stateId. Per-ref CAS advance; `selvage` is the default head.');

refs
  .command('migrate')
  .description('ONE-TIME migration: convert the legacy stateId selvage to refs/heads/selvage holding the tip strand\'s pickId (resolved via the highest-seq hack for the LAST time). Idempotent; a founder-visible step — never automatic.')
  .option('--json', 'emit the migration result as JSON')
  .action(async (options: { json?: boolean }) => {
    try {
      const root = await resolveRoot();
      const result = migrateSelvageToRefs(warplineDirOf(root));
      if (options.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else if (result.migrated) {
        process.stdout.write(
          `REFS MIGRATE  refs/heads/selvage → ${result.pickId}\n` +
            '  seal now advances the pickId ref (per-ref CAS) alongside the legacy selvage.\n',
        );
      } else {
        process.stdout.write(`REFS MIGRATE  nothing to do — ${result.reason}\n`);
      }
    } catch (err) {
      fail(err);
    }
  });

refs
  .command('list')
  .description('List refs/heads/* (name → pickId) and the current head set. Legacy (unmigrated) repos show the single ledger tip.')
  .option('--json', 'emit refs + heads as JSON')
  .action(async (options: { json?: boolean }) => {
    try {
      const root = await resolveRoot();
      const { named, tips } = await traceCli(
        { root, verb: 'refs.list', target: cliTarget({}, { json: options.json }) },
        () => {
          const wdir = warplineDirOf(root);
          return { named: listRefs(wdir), tips: heads(wdir) };
        },
      );
      if (options.json) {
        process.stdout.write(JSON.stringify({ refs: Object.fromEntries(named), heads: tips }, null, 2) + '\n');
      } else {
        const lines: string[] = ['WARPLINE REFS  (pickId heads)'];
        if (named.size === 0) lines.push('  (no refs/heads — legacy selvage mode; run `warpline refs migrate`)');
        for (const [name, id] of named) lines.push(`  ${name.padEnd(12)} ${id}`);
        lines.push(`heads: ${tips.length ? tips.map((t) => t.slice(0, 20)).join(', ') : '(empty fabric)'}`);
        process.stdout.write(lines.join('\n') + '\n');
      }
    } catch (err) {
      fail(err);
    }
  });

refs
  .command('set')
  .description(
    'Point refs/heads/<name> at <pickId> — the actionable half of `fabric verify`\'s abandoned-head report (recovering one used to require hand-editing .warpline/refs/heads/). Refuses a pickId absent from the fabric (that would MINT the ref-unresolved corruption verify catches) and refuses to clobber an existing ref without --force (overwriting a head is how sealed work becomes abandoned). Per-ref CAS; runs under the fabric lock.',
  )
  .argument('<name>', 'the ref under .warpline/refs/heads/ ([A-Za-z0-9][A-Za-z0-9._-]*)')
  .argument('<pickId>', 'the strand this ref names — must be present in the fabric')
  .option('--force', 'overwrite an existing ref (the previous pickId is printed)')
  .option('--json', 'emit the result as JSON')
  .action(async (name: string, pickId: string, options: { force?: boolean; json?: boolean }) => {
    try {
      const root = await resolveRoot();
      const result = await setFabricRef(root, name, pickId, { force: options.force });
      if (options.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        printRefSet(result);
      }
    } catch (err) {
      fail(err);
    }
  });

const keyCmd = program
  .command('key')
  .description(
    'M3-lite signing keys (#keys). Ed25519 agent keys for the strand-signature epoch: the PRIVATE half lives in .warpline/keys/agents/<principal>.key (0600, gitignored, never leaves the box), the PUBLIC half in the append-only registry .warpline/keys/registry.jsonl. The FIRST mint ever pins `signed-from` — the fabric tip pickId that becomes the signing-epoch boundary (strands at-or-before it stay valid unsigned, permanently). NO passphrase, NO root key: the human boundary is PROCEDURAL (TD-2026-08-23-136).',
  );

keyCmd
  .command('mint <principal>')
  .description(
    'Mint an Ed25519 signing key for a principal (HUMAN-class — the human\'s act, like daemon token minting; an agent shell is refused). Writes the 0600 key file, appends the public agent-key registry row, and — on the FIRST mint ever — pins `signed-from` at the current fabric tip (the signing-epoch boundary; it pins ONCE, later mints never move it). Re-minting a principal appends a new row; the LATEST row wins (rotation without a revocation ceremony). Seals after the signed-from boundary will REQUIRE signatures once seal-time signing (M3 I3) lands — until then the boundary is advisory.',
  )
  .option('--json', 'emit the mint result as JSON (public material + paths; the private key stays in the 0600 file)')
  .action(async (principal: string, options: { json?: boolean }) => {
    try {
      const root = await resolveRoot();
      // #keys minting is HUMAN-class (M3 design §3: key issuance is the human's
      // act, like token minting) — enforced with the same #agent-shell credential
      // the `branch --protect` gate uses, because `key.mint` is deliberately NOT
      // a daemon verb (no self-service minting surface exists on the daemon,
      // anti-sockpuppet) and so cannot ride HUMAN_ONLY_VERBS' derived CLI map.
      if (shellPrincipal() === 'agent') {
        throw new RefusedError(
          refuse({ code: 'FORBIDDEN', retriable: 'never' }),
          `warpline: key mint is a HUMAN-class act — an agent must never mint its own signing identity (anti-sockpuppet; Aegis §2.2). ` +
            `This shell is an AGENT shell (WARPLINE_AGENT_ID set); escalate to a human. A human shell does not export it.`,
        );
      }
      const result = mintAgentKey(root, principal);
      if (options.json) {
        // The PRIVATE key never rides stdout — the 0600 file is its only home.
        const { privateKeyPem: _omitted, ...publicHalf } = result.key;
        process.stdout.write(
          JSON.stringify({ ...result, key: publicHalf }, null, 2) + '\n',
        );
      } else {
        process.stdout.write(
          `KEY MINTED  ${result.key.principal}\n` +
            `  keyId   ${result.key.keyId}\n` +
            `  file    ${result.keyPath}  (0600 — private half; never commit or ship it)\n` +
            (result.signedFrom
              ? `  signed-from pinned at ${result.signedFrom.signedFromPickId ?? '(genesis — empty fabric)'} — the signing-epoch boundary (first key; pins once)\n`
              : '') +
            `  note    seals after the signed-from boundary require signatures once seal-time signing (M3 I3) lands — advisory until then\n`,
        );
      }
    } catch (err) {
      fail(err);
    }
  });

keyCmd
  .command('list')
  .description('List registry key rows (public material only — never private keys). Shows each row\'s keyId, principal, mint time, whether its private key file is on this box, and the signed-from boundary. Agent-readable (a plain read).')
  .option('--json', 'emit the registry summary as JSON')
  .action(async (options: { json?: boolean }) => {
    try {
      const root = await resolveRoot();
      const result = listKeySummaries(root);
      if (options.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        return;
      }
      if (result.keys.length === 0 && result.signedFrom === null && result.malformed.length === 0) {
        process.stdout.write('WARPLINE KEYS  (none minted — `warpline key mint <principal>`)\n');
        return;
      }
      const lines = [`WARPLINE KEYS  (registry ${keyRegistryPathOf(root)})`];
      for (const k of result.keys) {
        lines.push(
          `  ${k.keyId.slice(0, 'wlkey:v1:'.length + 8)}…  ${k.principal.padEnd(12)}  (${k.createdAt})` +
            `${k.latest ? '' : '  [superseded]'}${k.keyFilePresent ? '' : '  [KEY FILE MISSING]'}`,
        );
      }
      lines.push(
        result.signedFrom
          ? `  signed-from  ${result.signedFrom.signedFromPickId ?? '(genesis — empty fabric)'}  (pinned ${result.signedFrom.createdAt}; the signing-epoch boundary)`
          : '  signed-from  (not pinned — no key has ever been minted)',
      );
      if (result.malformed.length) {
        lines.push(`  MALFORMED  ${result.malformed.length} registry row(s) skipped fail-closed: ${result.malformed.map((m) => `line ${m.line} (${m.reason})`).join('; ')}`);
      }
      process.stdout.write(lines.join('\n') + '\n');
    } catch (err) {
      fail(err);
    }
  });

const grantCmd = program
  .command('grant')
  .description(
    'M3-lite auto-resolve grants (#grants). A grant is a HUMAN-ISSUED, scoped, expiring, revocable exception INSIDE the resolve gate: while one is active, an AGENT-class principal may run `resolve` (and ONLY resolve — never stake/backup/recover), and the resolution strand records `underGrant: <grantId>` inside its pickId. `resolve` stays a human-class verb; with no active grant nothing changes, byte for byte. Store: .warpline/grants/auto-resolve.jsonl (append-only; revoke = append).',
  );

grantCmd
  .command('auto-resolve')
  .description(
    'ISSUE an auto-resolve grant (HUMAN-class — gated like `key mint`; an agent shell is refused). expiresAt is REQUIRED: default ttl 24h, hard cap 7d. While active, agents may resolve KNOTs within scope and every such resolution is attributed via underGrant.',
  )
  .option('--branch <branch>', 'scope the grant to ONE branch (exact match; default: all branches)')
  .option('--ttl <duration>', 'time to live — <n>m|<n>h|<n>d (default 24h, max 7d)', '24h')
  .option('-m, --note <note>', 'why this grant exists (the audit record)')
  .option('--json', 'emit the issued grant row as JSON')
  .action(async (options: { branch?: string; ttl: string; note?: string; json?: boolean }) => {
      if (options.branch !== undefined && options.branch !== 'selvage') {
        process.stderr.write(
          `warpline: warning — resolve currently lands only on "selvage"; a grant scoped to "${options.branch}" will never match at the gate (silently dead, fail-closed). Scope to selvage or omit --branch.\n`,
        );
      }
    try {
      const root = await resolveRoot();
      // Grant issuance is HUMAN-class (Q3 ruling: console/CLI human-class act,
      // procedurally bound) — same #agent-shell credential as `key mint`,
      // because `grant.issue` is deliberately NOT a daemon verb (no
      // self-service grant surface, anti-sockpuppet) and cannot ride
      // HUMAN_ONLY_VERBS' derived CLI map.
      if (shellPrincipal() === 'agent') {
        throw new RefusedError(
          refuse({ code: 'FORBIDDEN', retriable: 'never' }),
          `warpline: grant auto-resolve is a HUMAN-class act — an agent must never grant itself resolve authority (Aegis §2.2). ` +
            `This shell is an AGENT shell (WARPLINE_AGENT_ID set); escalate to a human. A human shell does not export it.`,
        );
      }
      const ttlMs = parseGrantTtl(options.ttl);
      if (ttlMs > GRANT_TTL_MAX_MS) {
        throw new Error(`warpline: grant refused — ttl ${options.ttl} exceeds the 7-day cap`);
      }
      const result = issueGrant(root, {
        ...(options.branch !== undefined ? { branch: options.branch } : {}),
        ttlMs,
        ...(options.note !== undefined ? { note: options.note } : {}),
      });
      if (options.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        return;
      }
      const g = result.grant;
      // THE LOUD LINE — issuing a grant suspends a security law inside its scope.
      process.stdout.write(
        `GRANT ACTIVE  ${g.grantId}\n` +
          `  !! AGENTS MAY NOW RESOLVE KNOTS ${g.scope.branch ? `on branch "${g.scope.branch}"` : 'on ALL branches'} until ${g.ttl.expiresAt} !!\n` +
          `  scope    resolve ONLY (stake/backup/recover stay human-class regardless)\n` +
          `  issued   ${g.ttl.issuedAt}${g.note ? `  — ${g.note}` : ''}\n` +
          `  store    ${result.storePath}\n` +
          `  revoke   warpline grant revoke ${g.grantId.slice(0, 'grant:'.length + 12)}\n`,
      );
    } catch (err) {
      fail(err);
    }
  });

grantCmd
  .command('revoke <grantId>')
  .description('REVOKE a grant by id or ≥12-char prefix (HUMAN-class). Appends a revoke row — a revoked grantId never matches again at the gate; strands sealed BEFORE the revocation instant stay valid.')
  .option('--json', 'emit the revoke row as JSON')
  .action(async (grantId: string, options: { json?: boolean }) => {
    try {
      const root = await resolveRoot();
      if (shellPrincipal() === 'agent') {
        throw new RefusedError(
          refuse({ code: 'FORBIDDEN', retriable: 'never' }),
          `warpline: grant revoke is a HUMAN-class act (the grant lifecycle is the human's — Aegis §2.2). ` +
            `This shell is an AGENT shell (WARPLINE_AGENT_ID set); escalate to a human. A human shell does not export it.`,
        );
      }
      const result = revokeGrant(root, grantId);
      if (options.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        return;
      }
      process.stdout.write(
        `GRANT REVOKED  ${result.revoke.grantId}\n` + `  at  ${result.revoke.revokedAt} — agents may no longer resolve under it\n`,
      );
    } catch (err) {
      fail(err);
    }
  });

grantCmd
  .command('list')
  .description('List grant rows with status (active/expired/revoked). Agent-readable — a plain read; malformed/tampered rows are surfaced (they are skipped fail-closed by every reader).')
  .option('--json', 'emit the grant summary as JSON')
  .action(async (options: { json?: boolean }) => {
    try {
      const root = await resolveRoot();
      const result = listGrantSummaries(root);
      if (options.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        return;
      }
      if (result.grants.length === 0 && result.malformed.length === 0) {
        process.stdout.write('WARPLINE GRANTS  (none issued — `warpline grant auto-resolve`)\n');
        return;
      }
      const lines = [`WARPLINE GRANTS  (store ${grantsPathOf(root)})`];
      for (const g of result.grants) {
        lines.push(
          `  ${g.grantId.slice(0, 'grant:'.length + 12)}…  ${g.status.toUpperCase().padEnd(8)}  ` +
            `${g.scope.branch ? `branch ${g.scope.branch}` : 'all branches'}  ` +
            `${g.issuedAt} → ${g.expiresAt}${g.revokedAt ? `  (revoked ${g.revokedAt})` : ''}${g.note ? `  — ${g.note}` : ''}`,
        );
      }
      if (result.malformed.length) {
        lines.push(
          `  MALFORMED  ${result.malformed.length} row(s) skipped fail-closed: ${result.malformed.map((m) => `line ${m.line} (${m.reason})`).join('; ')}`,
        );
      }
      process.stdout.write(lines.join('\n') + '\n');
    } catch (err) {
      fail(err);
    }
  });

const stakeCmd = program
  .command('stake')
  .description(
    'THE CHECKPOINT VALVE (one-way warpline→git; T-2026-07-17-001). Export a SEALED fabric state as ONE git commit on a DEDICATED stake branch — first-parent checkpoints only, machine trailer only, never the human\'s working branch, never sidecar/trust data. Default OFF: requires .warpline/config.json {"stake":{"enabled":true,"refs":["selvage"]}}. Every invocation is audited (.warpline/stakes/audit.jsonl).',
  );

stakeCmd
  .command('cut [selector]', { isDefault: true, hidden: true })
  .description('Cut a stake of an allowlisted native ref (default: selvage). The tree is materialized from the object store, deny-list audited, recompute-verified (refuse on any mismatch), then committed with the .warpline-stake marker.')
  .option('--json', 'emit the stake result as JSON')
  .action(async (selector: string | undefined, options: { json?: boolean }) => {
    try {
      const root = await resolveRoot();
      // C-11: the stake valve is operator/human class (HUMAN_ONLY_VERBS).
      await gateHumanClass({ root, cliPath: 'stake', verb: 'stake', target: cliTarget({ selector }) });
      const result = await stake(root, { selector });
      if (options.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        printStake(result);
      }
    } catch (err) {
      fail(err);
    }
  });

stakeCmd
  .command('recover <commit>')
  .description('S5 re-entry after `git reset --hard <stake>`: verify the reset tree hashes to the staked binding.treeId, then seal a REVERSION STRAND recording the rollback and advance both tip pointers to it — under the fabric lock, never an import (the fabric stays authoritative). The rollback is therefore auditable, and the ledger stays append-only. Post-recover edits seal normally, parented on the reversion strand (TD-2026-08-01-893).')
  .option('--json', 'emit the recover result as JSON')
  .action(async (commit: string, options: { json?: boolean }) => {
    try {
      const root = await resolveRoot();
      // C-11: disaster recovery is the human's act (HUMAN_ONLY_VERBS).
      await gateHumanClass({ root, cliPath: 'stake recover', verb: 'stake.recover', target: cliTarget({ commit }) });
      const result = await stakeRecover(root, commit);
      if (options.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        printStakeRecover(result);
      }
    } catch (err) {
      fail(err);
    }
  });

program
  .command('mcp')
  .description(
    'Serve the Warpline MCP skin over stdio — the THIRD skin (one shape, three skins). A thin credential pass-through over the daemon socket: 8 agent-class tools registered from the canonical descriptors; results are engine shapes VERBATIM with refusal:v1 riding every refusing verdict; isError derives from exitCodeForResult. Token: env WARPLINE_MCP_TOKEN, else .warpline/daemon/mcp.token (mint with `warpline daemon token mint mcp --kind agent --mcp`). Human-class verbs are OMITTED unless --operator verifies a human-class token at startup.',
  )
  .option('--operator', 'register human-class tools IFF the discovered token verifies kind:human via status at startup')
  .option('--no-auto-start', 'do not auto-start the daemon on connect failure')
  .action(async (options: { operator?: boolean; autoStart?: boolean }) => {
    try {
      const root = await resolveRoot();
      await runMcpServer({ root, operator: options.operator ?? false, autoStart: options.autoStart !== false });
      // the connected server keeps the event loop alive; stdout belongs to MCP.
    } catch (err) {
      fail(err);
    }
  });

const daemonCmd = program
  .command('daemon')
  .description(
    'warplined — the solo Warpline daemon (PHASE 1, native-first): the fabric with a NETWORK FACE. NDJSON over a unix socket (.warpline/daemon.sock, 0600); every verb calls the same engine function the CLI calls, under the same fabric lock. Stage-1 identity: per-principal bearer tokens (minted here, locally — never over the wire), server-stamped agentId, human-class-only overrides, every call audited (.warpline/daemon/audit.jsonl).',
  );

daemonCmd
  .command('start')
  .description('Start warplined for this fabric (exactly one per fabric — the pidfile is the lock). Default: detach to the background; --foreground stays attached (SIGTERM/SIGINT stop it cleanly).')
  .option('--foreground', 'run in the foreground (the detached default re-execs this)')
  .action(async (options: { foreground?: boolean }) => {
    try {
      const root = await resolveRoot();
      if (options.foreground) {
        const handle = await startDaemon(root);
        process.stdout.write(`WARPLINED  serving ${root}\n  socket  ${handle.socketPath}\n  pid     ${handle.pid}\n`);
        const shutdown = (): void => {
          void handle.close().then(() => process.exit(0));
        };
        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);
        return; // the server keeps the event loop alive
      }
      const st = daemonState(root);
      if (st.state === 'running') {
        process.stdout.write(`WARPLINED  already running (pid ${st.pidfile.pid}, socket ${st.pidfile.socketPath})\n`);
        return;
      }
      const child = spawn(process.execPath, [process.argv[1], 'daemon', 'start', '--foreground'], {
        cwd: root,
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      process.stdout.write(`WARPLINED  starting detached (pid ${child.pid})\n  socket  ${socketPathOf(root)}\n  stop    warpline daemon stop\n`);
    } catch (err) {
      fail(err);
    }
  });

daemonCmd
  .command('stop')
  .description('Stop the daemon serving this fabric (SIGTERM the pidfile holder; stale residue is cleaned).')
  .action(async () => {
    try {
      const root = await resolveRoot();
      const r = await stopDaemon(root);
      process.stdout.write(`WARPLINED  ${r.stopped ? 'stopped' : 'not stopped'} — ${r.reason}${r.pid ? ` (pid ${r.pid})` : ''}\n`);
      if (!r.stopped && r.reason.includes('still running')) process.exitCode = 1;
    } catch (err) {
      fail(err);
    }
  });

daemonCmd
  .command('status')
  .description('Daemon lifecycle status for this fabric: running (live pid) / stale residue / stopped.')
  .option('--json', 'emit the status as JSON')
  .action(async (options: { json?: boolean }) => {
    try {
      const root = await resolveRoot();
      const st = daemonState(root);
      if (options.json) {
        process.stdout.write(JSON.stringify(st, null, 2) + '\n');
      } else if (st.state === 'running') {
        process.stdout.write(`WARPLINED  running  (pid ${st.pidfile.pid}, since ${st.pidfile.startedAt})\n  socket  ${st.pidfile.socketPath}\n`);
      } else if (st.state === 'stale') {
        process.stdout.write(`WARPLINED  stale residue (crashed?) — \`warpline daemon stop\` cleans, \`warpline daemon start\` recovers\n`);
      } else {
        process.stdout.write('WARPLINED  stopped\n');
      }
    } catch (err) {
      fail(err);
    }
  });

const tokenCmd = daemonCmd
  .command('token')
  .description('Stage-1 identity: per-principal bearer tokens (.warpline/daemon-tokens.jsonl, 0600, gitignored). Minting is LOCAL-CLI-ONLY — the human\'s act, gated by possession of the box (Aegis §2.2: anti-sockpuppet). The daemon derives agentId/actor FROM the token; client-supplied identity is ignored.');

tokenCmd
  .command('mint <name>')
  .description('Mint a bearer token for a principal. kind:agent principals CANNOT resolve knots, cut/recover stakes, or accept-breach/accept-risk (human-class-only overrides). --scope read caps the token at the read-only verbs (status, refs.list, knot.show, grade.report, shadow.tail) — the CONSOLE class: `warpline daemon token mint console --kind human --scope read` is what the platform Warpline section auto-discovers. --mcp additionally persists the bare token KEYED BY AGENT in .warpline/daemon/mcp-tokens.json (0600); minting a second agent coexists with the first (no clobber), so N concurrent instances each keep a durable token — the MCP skin reads env WARPLINE_MCP_TOKEN, then WARPLINE_MCP_AGENT (name selector), then the keyed store, then the legacy mcp.token file; agent-kind only. The token prints ONCE — hand it to the agent worktree via env, never commit it. Note: no revocation ceremony exists at stage 1 — rotating means minting anew; old rows stay valid.')
  .requiredOption('--kind <kind>', "principal class: 'human' or 'agent'")
  .option('--scope <scope>', "'read' = read-only verb ceiling (console class); omit for the full surface")
  .option('--mcp', 'also persist the token KEYED BY AGENT in .warpline/daemon/mcp-tokens.json (0600) for the MCP skin — a second agent coexists with the first (no clobber); requires --kind agent')
  .option('--json', 'emit the minted row as JSON (includes the token — once)')
  .action(async (name: string, options: { kind: string; scope?: string; mcp?: boolean; json?: boolean }) => {
    try {
      const root = await resolveRoot();
      if (options.mcp && options.kind !== 'agent') {
        // The MCP server is an ambient agent-facing process — a human-class
        // token in its file would hand every subagent human capability.
        process.stderr.write('warpline: token mint --mcp requires --kind agent (the MCP skin must never hold a human-class token)\n');
        process.exit(2);
      }
      const row = mintToken(root, name, options.kind as 'human' | 'agent', {
        ...(options.scope ? { scope: options.scope as TokenScope } : {}),
      });
      // --mcp persists the token KEYED BY AGENT (row.principal) so a second
      // agent's mint coexists with the first — N concurrent instances each keep
      // a durable token instead of the last mint clobbering the file.
      const mcpPath = options.mcp ? writeMcpTokenFile(root, row.token, row.principal) : null;
      if (options.json) {
        process.stdout.write(
          JSON.stringify(
            {
              ...row,
              ...(mcpPath
                ? {
                    mcpTokenStore: mcpPath,
                    mcpEnv: { WARPLINE_MCP_TOKEN: row.token },
                    mcpAgentSelector: { WARPLINE_MCP_AGENT: row.principal },
                  }
                : {}),
            },
            null,
            2,
          ) + '\n',
        );
      } else {
        process.stdout.write(
          `TOKEN MINTED  ${row.principal}  (kind:${row.kind}${row.scope ? `, scope:${row.scope}` : ''})\n` +
            `  token   ${row.token}\n` +
            (mcpPath
              ? `  mcp     stored for agent '${row.principal}' in ${mcpPath} (0600, keyed — coexists with other agents)\n` +
                `  wire    give THIS instance its own token in its MCP server env:\n` +
                `            WARPLINE_MCP_TOKEN=${row.token}\n` +
                `          or select this agent by name from the keyed store:\n` +
                `            WARPLINE_MCP_AGENT=${row.principal}\n`
              : '') +
            `  shown once here — the row lives at .warpline/daemon-tokens.jsonl (0600, gitignored; never commit or ship it)\n`,
        );
      }
    } catch (err) {
      fail(err);
    }
  });

tokenCmd
  .command('list')
  .description('List minted principals (REDACTED — tokens are never re-shown).')
  .option('--json', 'emit the redacted rows as JSON')
  .action(async (options: { json?: boolean }) => {
    try {
      const root = await resolveRoot();
      const rows = listTokenSummaries(root);
      if (options.json) {
        process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
      } else if (rows.length === 0) {
        process.stdout.write('WARPLINED TOKENS  (none minted — `warpline daemon token mint <name> --kind human|agent`)\n');
      } else {
        const lines = ['WARPLINED TOKENS  (redacted)'];
        for (const r of rows) lines.push(`  ${r.tokenPrefix}  ${r.kind.padEnd(5)}  ${r.scope === 'read' ? 'read-only' : 'full     '}  ${r.principal}  (${r.createdAt})`);
        process.stdout.write(lines.join('\n') + '\n');
      }
    } catch (err) {
      fail(err);
    }
  });

daemonCmd
  .command('call <verb>')
  .description('Drive one daemon verb over the socket (status | refs.list | fork | propose | admit | knot.show | resolve | stake | stake.recover | grade.report | shadow.tail). Token from --token or WARPLINE_DAEMON_TOKEN. Prints the engine-shaped result as JSON (G3). The in-process CLI verbs remain the default; this is the transport path.')
  .option('--params <json>', 'verb params as inline JSON', '{}')
  .option('--token <token>', 'bearer token (default: $WARPLINE_DAEMON_TOKEN)')
  .action(async (verb: string, options: { params: string; token?: string }) => {
    try {
      const root = await resolveRoot();
      const token = options.token ?? process.env.WARPLINE_DAEMON_TOKEN;
      if (!token) {
        process.stderr.write('warpline: daemon call needs a token (--token or WARPLINE_DAEMON_TOKEN)\n');
        process.exit(1);
      }
      const params = JSON.parse(options.params) as Record<string, unknown>;
      const client = await DaemonClient.connect(root, token);
      try {
        // the CLI's TRANSPORT path: traced under the verb it drives, so a
        // socket-driven CLI arm is measured on the same footing as the skins.
        const result = await traceCli(
          {
            root,
            verb,
            target: cliTarget({
              selector: typeof params.selector === 'string' ? params.selector : undefined,
              agentId: typeof params.agentId === 'string' ? params.agentId : undefined,
            }),
            ...(typeof params.agentId === 'string' ? { principal: params.agentId } : {}),
          },
          () => client.call(verb, params),
        );
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } finally {
        client.close();
      }
    } catch (err) {
      fail(err);
    }
  });

// ── backup — the custodianship valve (PHASE 1 close-out) ─────────────────────

const backupCmd = program
  .command('backup')
  .description(
    'Custodianship: atomic fabric snapshots. `warpline backup <dest>` clone-copies the ledger + refs + sidecars + object store into <dest>/.warpline (CoW clones on APFS, full copies elsewhere — never hardlinks) with a digest manifest; `warpline backup verify <dest>` recomputes every digest AND authenticates the backup with the full fabric verify. THE RESTORE PATH IS THE ENGINE ITSELF: a backup IS a home-fabric root — run any warpline verb from <dest> (or `restore --to`) and you are restored. Secrets never travel: bearer secrets are denied at ANY depth by name and by `.token` suffix (D5 deny-list) — the v1 rule matched root basenames only, so daemon/mcp.token rode along (audit C-14). Everything else is included BY DEFAULT: a sidecar added later travels unless it is denied.',
  );

backupCmd
  .command('create <dest>', { isDefault: true })
  .description('Snapshot this fabric into a fresh directory <dest> (refuses an existing dest). Mutable core copies under the fabric lock; the manifest publishes last; one atomic rename lands the whole backup.')
  .option('--json', 'emit the BackupResult as JSON')
  .action(async (dest: string, options: { json?: boolean }) => {
    try {
      const root = await resolveRoot();
      // C-11: custodianship is the human's act, like token minting (Aegis §2.2)
      // — and a backup copies the whole fabric somewhere the gates do not reach.
      await gateHumanClass({ root, cliPath: 'backup', verb: 'backup', target: cliTarget({ dest }) });
      const result = await backupFabric(root, dest);
      if (options.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        printBackup(result);
      }
    } catch (err) {
      fail(err);
    }
  });

backupCmd
  .command('verify <dest>')
  .description('Verify a backup: recompute every manifest sha256 (missing/extra/mismatched files flagged), then run the full fabric authentication (pickId recompute, chain/DAG walk, byte-binding recompute) against the backup copy. Exit 0 = intact, 1 = problem found.')
  .option('--json', 'emit the BackupVerifyReport as JSON')
  .action(async (dest: string, options: { json?: boolean }) => {
    try {
      const report = verifyBackup(dest);
      if (options.json) {
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      } else {
        printBackupVerify(report);
      }
      if (!report.ok) process.exitCode = 1;
    } catch (err) {
      fail(err);
    }
  });

function printBackup(r: BackupResult): void {
  const lines: string[] = [];
  lines.push(`BACKUP  →  ${r.dest}`);
  lines.push(`files     ${r.counts.files}  (${r.counts.objects} objects, ${r.counts.ledgerRows} ledger rows, ${r.counts.refs} ref(s))`);
  lines.push(`bytes     ${r.totalBytes}`);
  if (r.selvage) lines.push(`selvage   ${r.selvage.slice(0, 20)}…`);
  lines.push(`manifest  ${r.manifestPath}`);
  lines.push('→ the backup IS a home-fabric root — any warpline verb run from it is the restore.');
  process.stdout.write(lines.join('\n') + '\n');
}

function printBackupVerify(r: BackupVerifyReport): void {
  const lines: string[] = [];
  if (r.ok && r.manifest && r.fabric) {
    lines.push(`BACKUP VERIFY  ${r.dest}  —  intact`);
    lines.push(`files     ${r.manifest.counts.files} digest-true  (${r.manifest.counts.objects} objects, ${r.manifest.counts.ledgerRows} ledger rows)`);
    lines.push(`fabric    ${r.fabric.checked} strand(s) authenticated — 0 failures`);
  } else {
    lines.push(`BACKUP VERIFY  ${r.dest}  —  FAILED`);
    for (const p of r.problems) lines.push(`  ✗ ${p.kind}  ${p.path}\n    ${p.detail}`);
    if (r.fabric && r.fabric.failures.length) {
      for (const f of r.fabric.failures) lines.push(`  ✗ fabric ${f.kind}  seq ${f.seq}  ${short(f.pickId)}\n    ${f.detail}`);
    }
  }
  process.stdout.write(lines.join('\n') + '\n');
}

function printRepair(r: FabricRepairResult): void {
  const lines: string[] = [];
  if (r.intact) {
    lines.push(`FABRIC REPAIR  nothing to repair — ${r.kept} strand(s), every line well-formed`);
    lines.push(`ledger    ${r.ledger}`);
    process.stdout.write(lines.join('\n') + '\n');
    return;
  }
  lines.push(
    r.applied
      ? `FABRIC REPAIR  REPAIRED — torn tail salvaged (${r.kept} strand(s) retained, ${r.dropped.length} line(s) dropped)`
      : `FABRIC REPAIR  DRY RUN — nothing written. Re-run with --confirm to apply.`,
  );
  lines.push(`ledger    ${r.ledger}`);
  lines.push(`scanned   ${r.lines} line(s)  →  keep ${r.kept} strand(s) (${r.keptBytes} bytes), drop ${r.droppedBytes} bytes`);
  // EXACTLY what is/was lost — a repair that does not itemize the damage is the
  // silent repair the audit refused to accept.
  for (const d of r.dropped) {
    lines.push(`  ✗ line ${d.line}  (${d.bytes} bytes)  ${d.error}`);
    lines.push(`    ${d.excerpt}`);
  }
  lines.push(`new tip   ${r.newTip ?? '(none — the repair empties the ledger)'}`);
  if (r.backup) lines.push(`quarantine ${r.backup}  (the ORIGINAL bytes, torn line included — evidence, keep it)`);
  lines.push(
    r.applied
      ? '→ run `warpline fabric verify` next; repair fixes the BYTES, it does not adjudicate the tip pointers.'
      : '→ the torn line is evidence: --confirm quarantines the original under .warpline/repair/ before truncating.',
  );
  process.stdout.write(lines.join('\n') + '\n');
}

function printRefSet(r: RefSetResult): void {
  const lines: string[] = [];
  if (!r.moved) {
    lines.push(`REFS SET  refs/heads/${r.name} already points at ${r.pickId} (no-op)`);
  } else {
    lines.push(`REFS SET  refs/heads/${r.name}  →  ${r.pickId}`);
    if (r.previous) lines.push(`previous  ${r.previous}${r.forced ? '  (overwritten under --force)' : ''}`);
    else lines.push('previous  (none — new ref)');
  }
  process.stdout.write(lines.join('\n') + '\n');
}

function printStake(r: StakeResult): void {
  const lines: string[] = [];
  if (r.action === 'skipped') {
    lines.push(`STAKE  skipped — refs/heads/${r.branch} tip already carries this sealed state (idempotent)`);
  } else {
    lines.push(`STAKE  ${r.ref}  →  refs/heads/${r.branch}`);
  }
  lines.push(`pick      ${r.pickId}`);
  lines.push(`state     ${short(r.stateId)}`);
  lines.push(`tree      ${short(r.treeId)}`);
  lines.push(`commit    ${r.gitCommit}${r.parent ? `  (parent ${r.parent.slice(0, 12)} — first-parent chain)` : '  (first stake on this branch)'}`);
  if (r.gitTreeOid) lines.push(`git tree  ${r.gitTreeOid}  (recompute-verified, S3)`);
  lines.push(`audited   ${r.auditPath}`);
  process.stdout.write(lines.join('\n') + '\n');
}

function printStakeRecover(r: StakeRecoverResult): void {
  const lines: string[] = [];
  lines.push(`STAKE RECOVER  ${r.gitCommit.slice(0, 12)}  →  reversion strand sealed; both tip pointers advanced (never an import)`);
  lines.push(`pick      ${r.pickId}`);
  lines.push(`state     ${short(r.stateId)}`);
  lines.push(`tree      ${short(r.treeId)}  (worktree recompute-verified against the fabric binding)`);
  if (r.previous) lines.push(`previous  ${short(r.previous)}`);
  lines.push('→ new strands seal normally from here, parented on the staked pick.');
  process.stdout.write(lines.join('\n') + '\n');
}

function printRestore(r: RestoreResult): void {
  const lines: string[] = [];
  lines.push(`RESTORE  ${r.selector}  →  ${r.dest}`);
  if (r.seq !== null) {
    lines.push(`strand    seq ${r.seq}${r.pickId ? `  ${short(r.pickId)}` : ''}`);
  } else {
    lines.push('strand    (none — direct tree selector)');
  }
  lines.push(`treeId    ${r.treeId}`);
  lines.push(`restored  ${r.entriesRestored} entr${r.entriesRestored === 1 ? 'y' : 'ies'}  (files + dirs + symlinks, git absent)`);
  process.stdout.write(lines.join('\n') + '\n');
}

function printBranchCreate(r: CreateBranchResult): void {
  process.stdout.write(
    `BRANCH  ${r.name}  created at ${r.pickId}  (from ${r.from})\n` +
      `→ switch your worktree onto it with \`warpline switch ${r.name}\`\n`,
  );
}

function printBranchDelete(r: DeleteBranchResult): void {
  process.stdout.write(
    `BRANCH  deleted ${r.name}  (was ${r.pickId})\n` +
      `→ the strand survives in the ledger (abandoned head); recover with \`warpline refs set ${r.name} ${r.pickId}\`\n`,
  );
}

function printBranchList(branches: BranchInfo[]): void {
  const lines: string[] = ['WARPLINE BRANCHES  (* = current)'];
  if (branches.length === 0) {
    lines.push('  (no branches — legacy selvage mode; run `warpline refs migrate`, then `warpline branch <name>`)');
  }
  const width = branches.reduce((w, b) => Math.max(w, b.name.length), 0);
  for (const b of branches) {
    lines.push(`${b.current ? '*' : ' '} ${pad(b.name, width)}  ${b.pickId}`);
  }
  process.stdout.write(lines.join('\n') + '\n');
}

function printSwitch(r: SwitchResult): void {
  process.stdout.write(
    `SWITCH  now on ${r.branch}  (was ${r.previous})\n` +
      `tip       ${r.tip}\n` +
      `restored  ${r.entriesRestored} entr${r.entriesRestored === 1 ? 'y' : 'ies'} into the worktree (git absent)\n`,
  );
}

function printAdmit(agentId: string, r: AdmitResult): void {
  process.stdout.write(admitReportLines(agentId, r).join('\n') + '\n');
}

function printMerge(r: MergeBranchResult): void {
  const lines: string[] = [];
  if (r.alreadyUpToDate) {
    lines.push(`MERGE  ${r.from} → ${r.into}  already up to date (nothing to fold)`);
    process.stdout.write(lines.join('\n') + '\n');
    return;
  }
  if (r.fastForward) {
    lines.push(`MERGE  ${r.from} → ${r.into}  FAST-FORWARD (no weave — ${r.into} advanced to ${short(r.proposedStateId)})`);
    process.stdout.write(lines.join('\n') + '\n');
    return;
  }
  // THE MEANING-BLIND HOLD — the fail-closed rule fired. Name the byte-decided
  // paths and say, in the same breath, that meaning did NOT see them.
  if (r.meaningBlind) {
    lines.push(`MERGE  ${r.from} → ${r.into}  →  HELD (meaning-blind)`);
    lines.push(`verdict   the merge would auto-fold changes MEANING DID NOT SEE — a human must confirm this merge`);
    lines.push(`          these changed paths are BYTE-DECIDED (no lens lifted them; the token merge governed them):`);
    for (const p of r.meaningBlind.bytePaths) lines.push(`  ⊘ ${p}`);
    lines.push(`          → warpline merge ${r.from} --into ${r.into} --confirm   (human-class, like resolve)`);
    lines.push(`          (git auto-merges disjoint config×code silently; Warpline HELD it — nothing sealed, ${r.into} unmoved)`);
    process.stdout.write(lines.join('\n') + '\n');
    return;
  }
  // Otherwise the shared admit renderer speaks the verdict (CLEAN sealed / KNOT /
  // DANGLE), so merge and admit describe the SAME engine identically.
  process.stdout.write(admitReportLines(`${r.from} → ${r.into}`, r).join('\n') + '\n');
}

/**
 * The admit report as an array of lines — pure over (agentId, result), no I/O,
 * so the surface strings (the LEXICAL advisory block and the independent-CLEAN
 * standing disclaimer) are testable without capturing stdout. It READS the
 * result and never mutates it: no line here touches `status`, `sealed`,
 * `confidence`, `knots`/`dangling` or the contested denominator.
 */
export function admitReportLines(agentId: string, r: AdmitResult): string[] {
  const d = r.decision;
  const lines: string[] = [];
  lines.push(`ADMIT  ${agentId}  →  ${d.status}`);
  if (d.rebasedOnto) lines.push(`re-based onto selvage ${short(d.rebasedOnto)}`);
  if (d.status === 'CLEAN') {
    lines.push(`verdict   CLEAN to admit (concurrent edits commute in meaning — git may conflict on bytes)`);
    lines.push(`confidence ${d.confidence}${d.confidence === 'independent' ? '  (⚠ disjoint sets — autoClean may hide a cross-symbol semantic conflict; false-AUTOFOLD gate)' : '  (dependency-adjacent — trustworthy)'}`);
    if (r.sealed && r.strand) lines.push(`  → MERGED + sealed (${strandTag(r.strand)}); selvage advanced to ${short(r.strand.stateId)}`);
    else lines.push('  (not sealed — needs git refs to materialize; commit then admit)');
    // STANDING DISCLAIMER (T-2026-06-24-015, posture TD-2026-08-12-831; protocol
    // §8 line 711 — the CLI must "say so in the same breath"). An independent
    // CLEAN sealed because the two changed sets are SYMBOL-DISJOINT, which is
    // exactly the case with no cross-symbol invariant guarantee. It prints on
    // EVERY such admit — not only when the LEXICAL advisory fired — because the
    // dangerous read is an EMPTY hazard list taken as an all-clear. Surface string
    // only: it reads `confidence`/`sealed`, mutates nothing, gates nothing.
    if (d.confidence === 'independent' && r.sealed) {
      lines.push('  ⚠ independent-CLEAN: the two changed sets are SYMBOL-DISJOINT — this admission carries NO cross-symbol invariant guarantee; a conflict sharing no token (e.g. a bound one side lowered, a loop the other wrote assuming the old value) is UNDETECTABLE by meaning and did NOT gate this merge.');
    }
  } else if (d.status === 'FAST_ADMIT') {
    lines.push('verdict   FAST_ADMIT — selvage has not advanced; the proposed state admits directly');
    if (r.sealed && r.strand) lines.push(`  → sealed (${strandTag(r.strand)}); selvage advanced to ${short(r.strand.stateId)}`);
  } else if (d.status === 'KNOT') {
    lines.push(`verdict   KNOT — a human DECIDE is required (NOT auto-merged)`);
    const { direct, ripple } = partitionKnots(d.knots);
    for (const k of direct) lines.push(`  ⊗ ${k.symbol}${k.conflictingSlots.length ? `  [${k.conflictingSlots.join(', ')}]` : ''}`);
    if (ripple.length) lines.push(rippleLine(ripple.length, '  '));
  } else if (d.status === 'DANGLE') {
    lines.push('verdict   DANGLE — a meaning-level broken reference; resolve before admitting');
    for (const x of d.dangling) lines.push(`  ⤬ ${x.fromSymbol} → ${x.danglingTargetSymbol}`);
  } else if (d.status === 'CLAIM-BREACH') {
    lines.push('verdict   CLAIM-BREACH — the computed touched set escaped the pre-declared claim (HELD, not sealed)');
    if (r.claim) {
      lines.push(`  underlying verdict ${r.claim.underlyingStatus ?? '(unknown)'}`);
      lines.push(`  claimed   ${r.claim.claimedSymbols.join(', ') || '(none)'}`);
      lines.push(`  computed  ${d.agentChanged.join(', ') || '(none)'}`);
      lines.push(`  ✗ excess  ${r.claim.excess.join(', ')}`);
      if (r.claim.missing.length) lines.push(`  · missing ${r.claim.missing.join(', ')}  (claimed but untouched — recorded, not a breach)`);
      lines.push(`  → re-propose an honest claim, or override: warpline admit … --claim ${r.claim.claimId} --accept-breach`);
    }
  } else if (d.status === 'HELD') {
    lines.push('verdict   HELD — independent-CLEAN into a low-survival symbol (trust floor, forge-spec §1d; not sealed)');
    if (r.escalation) {
      lines.push(`  ⊘ ${r.escalation.symbol}  graded survival ${r.escalation.survival} (n=${r.escalation.graded}) < floor ${r.escalation.floor}`);
      lines.push(`  underlying verdict ${r.escalation.underlyingStatus}`);
      lines.push(`  → get the change reviewed/split, or override: warpline admit … --accept-risk`);
    }
  } else {
    lines.push('verdict   NOOP — the agent changed no meaning');
  }
  // CLEAN-hazard advisory (#hazard). Printed BELOW the verdict and never as part
  // of it: this is a note on a merge that already sealed, not a refusal. The
  // wording is deliberate and must not be loosened — it says LEXICAL, and it
  // states the blind spot in the same breath, because the failure mode of an
  // advisory is a reader treating an empty list as an all-clear. Nothing here
  // may license the sentence "Warpline catches invariant conflicts."
  if (r.hazards?.length) {
    lines.push('');
    lines.push(`⚠ ${r.hazards.length} LEXICAL coupling advisor${r.hazards.length === 1 ? 'y' : 'ies'} — this merge SEALED; review, do not assume`);
    for (const h of r.hazards.slice(0, 5)) {
      lines.push(`  · ${h.token}  [${h.kind}]  score ${h.score.toFixed(2)}${h.dangerFlags.length ? `  ⚑ ${h.dangerFlags.join(', ')}` : ''}`);
      lines.push(`      yours:  ${h.oursSymbols.join(', ')}`);
      lines.push(`      theirs: ${h.theirsSymbols.join(', ')}`);
    }
    if (r.hazards.length > 5) lines.push(`  … ${r.hazards.length - 5} more (see .warpline/hazards.jsonl)`);
    lines.push('  NOT a conflict check: invariant conflicts that share NO token are undetectable here.');
  }
  // I-2 (T-2026-08-11-017): DERIVED-ARTIFACT staleness. A lockfile BOTH sides changed
  // divergently is never token-merged (a spliced lockfile fakes a precision it lacks) —
  // the merge takes OURS wholesale and marks it STALE (materialize.ts derivedStale). The
  // sealed selvage then carries one agent's package-lock.json against a MERGED manifest,
  // byte-identical to a consistent merge on every other surface. Printed prominently so
  // "re-run install" is never silent; the merge still SEALED — this is a note, not a refusal.
  const stale = r.merged?.derivedStale;
  if (stale?.length) {
    lines.push('');
    lines.push(`⚠ ${stale.length} derived artifact${stale.length === 1 ? '' : 's'} taken OURS-wholesale (STALE) — regenerate; the merged bytes are one side's, not a real merge:`);
    for (const p of stale) lines.push(`  · ${p}`);
    lines.push('  → re-run your package manager (e.g. `npm install`) to regenerate from the merged manifests.');
  }
  if (d.agentChanged.length) lines.push(`agent changed  ${d.agentChanged.join(', ')}`);
  if (d.otherChanged.length) lines.push(`others changed ${d.otherChanged.join(', ')}`);
  if (r.claim && d.status !== 'CLAIM-BREACH') {
    const judged = r.claim.breach
      ? `BREACH accepted (excess: ${r.claim.excess.join(', ')})`
      : `honored${r.claim.missing.length ? `  (missing: ${r.claim.missing.join(', ')})` : ''}`;
    lines.push(`claim     ${short(r.claim.claimId)}  ${judged}  → recorded in .warpline/claims/evaluations.jsonl`);
  }
  if (r.escalation?.acceptedRisk) {
    lines.push(`trust     RISK accepted on ${r.escalation.symbol} (survival ${r.escalation.survival}, n=${r.escalation.graded})  → recorded in .warpline/grades-escalations.jsonl`);
  }
  if (r.knotPayloadId) {
    lines.push(`payload   ${r.knotPayloadId}`);
    lines.push(`          → warpline knot show ${r.knotPayloadId}   (the self-sufficient resolution work order)`);
  }
  // A contested verdict whose work order failed to build/persist (B-3): the
  // verdict stands, but a lost work order must NOT read as a quiet success on the
  // default surface — render it here, not only in --json (Judge, Track-A review).
  if (r.payloadError) {
    lines.push(`⚠ work order NOT persisted — this contested verdict is invisible to \`warpline health\`: ${r.payloadError}`);
  }
  return lines;
}

/**
 * Human rendering of a knotPayload:v1 (forge-spec §3a). All agent prose renders
 * inside the escaped untrusted-prose frame (§3d) — never interpolated bare.
 */
function printKnotPayload(p: KnotPayload): void {
  const lines: string[] = [];
  lines.push(`WARPLINE KNOT PAYLOAD  ${p.verdict}   (${p.schemaVersion})`);
  lines.push(`id        ${p.payloadId}`);
  lines.push(`re-based onto selvage ${short(p.rebasedOnto)}   base ${short(p.base.stateId)}`);
  lines.push('');
  const side = (label: 'ours' | 'theirs', s: KnotPayload['ours']): void => {
    lines.push(`${label.toUpperCase()}  agent ${s.agentId ?? '(none)'}  actor ${s.actor}`);
    lines.push(`  state ${short(s.stateId)}  tree ${s.treeId ? short(s.treeId) : '(unbound)'}  commit ${s.gitCommit ? s.gitCommit.slice(0, 8) : '(none)'}`);
    lines.push(indent(frameProse(s.intent, { label: `intent (${label})` }), '  '));
  };
  side('ours', p.ours);
  side('theirs', p.theirs);
  lines.push('');
  lines.push(`contested  ${p.contested.length} unit${p.contested.length === 1 ? '' : 's'}`);
  for (const c of p.contested) {
    lines.push(`  ${c.kind === 'knot' ? '⊗' : '⤬'} ${c.symbol}  [${c.kind}${c.direct ? ', direct' : ', ripple'}]${c.conflictingSlots.length ? `  slots: ${c.conflictingSlots.join(', ')}` : ''}`);
    if (c.dangle) lines.push(`      dangling edge ${c.dangle.edgeKind} → ${c.dangle.danglingTargetSymbol}  (retired by ${c.dangle.retiredBy})`);
    lines.push(`      file  ${c.ours.filePath ?? c.theirs.filePath ?? c.base.filePath ?? '(unknown)'}`);
    const sideBody = (label: string, v: ContestedUnit['ours'] | ContestedUnit['base']): void => {
      const essence = v.essence ? short(v.essence) : v.present ? '(no essence)' : '(absent)';
      lines.push(`      ${label.padEnd(6)} ${essence}${v.body ? `  body: ${oneLine(v.body, 96)}` : ''}`);
    };
    sideBody('base', c.base);
    sideBody('ours', c.ours);
    sideBody('theirs', c.theirs);
  }
  lines.push('');
  lines.push(`blast radius  ${p.blastRadius.symbols.length} symbol(s), ${p.blastRadius.edges.length} inbound edge(s)  [mode: ${p.blastRadius.mode}]`);
  for (const e of p.blastRadius.edges.slice(0, 12)) lines.push(`  ${e.from} —${e.kind}→ ${e.to}`);
  if (p.blastRadius.edges.length > 12) lines.push(`  … ${p.blastRadius.edges.length - 12} more`);
  lines.push('');
  lines.push(`RESOLVE  submit a ${p.resolution.proposalSchema} (${p.resolution.requires.join(', ')}) — sealed only via \`warpline resolve\`; never auto-applied`);
  process.stdout.write(lines.join('\n') + '\n');
}

function indent(block: string, pad: string): string {
  return block
    .split('\n')
    .map((l) => pad + l)
    .join('\n');
}

/**
 * Collapse to one line for display — CONTROL-SAFE.
 *
 * `oneLine` renders ATTACKER-AUTHORED SOURCE: `knot show` prints contested unit
 * bodies through it, and those bodies come from the other side's file. The v1
 * implementation collapsed `\s+` only, which leaves ESC (0x1b) and every other
 * C0 byte intact — so ANSI/OSC sequences in a contested file reached the
 * terminal verbatim (screen clears, title rewrites, fake status lines). The
 * envelope defends `intent`; this is the neighbouring field it never covered
 * (Aegis, pre-field-test audit 2026-08-11).
 *
 * `escapeProseBody` is the same escaper the untrusted-prose frame uses, so the
 * two paths cannot drift apart on what "safe to print" means.
 */
function oneLine(s: string, max: number): string {
  const flat = escapeProseBody(s).replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
}

function printSelvage(selvage: string | null, tip: Strand | undefined, depth: number): void {
  const lines: string[] = [];
  lines.push('WARPLINE SELVAGE  (the fabric tip)');
  if (!selvage) {
    lines.push('tip       (none — no picks sealed yet; run `warpline pick -m "..."`)');
    process.stdout.write(lines.join('\n') + '\n');
    return;
  }
  lines.push(`tip       ${selvage}`);
  lines.push(`depth     ${depth} strand${depth === 1 ? '' : 's'}`);
  if (tip) {
    lines.push('');
    // strandPositionTag, never a raw `seq ${…}`: v3 strands are POSITION-FREE
    // (seq is undefined by design), so interpolating it printed "sealed by seq
    // undefined" on the first line of the first screen an agent reads.
    const tipPos = tip.seq === 0 ? '◆ genesis' : strandPositionTag(tip);
    lines.push(`sealed by ${tipPos ? `${tipPos}  ` : ''}${short(tip.pickId)}  ${tip.recordedAt.slice(0, 10)}  ${tip.actor}`);
    lines.push(`intent    ${tip.intent}`);
    if (tip.provenance?.gitCommit) lines.push(`git       ${tip.provenance.gitCommit.slice(0, 12)}  (coexistence anchor)`);
  }
  process.stdout.write(lines.join('\n') + '\n');
}

function printPick(r: PickResult): void {
  if (r.noop) {
    process.stdout.write(
      `PICK  no-op — meaning unchanged since selvage (${short(r.stateId)})\n` +
        '      nothing recorded; the fabric already holds this state.\n',
    );
    return;
  }
  const s = r.strand!;
  const lines: string[] = [];
  // The pickId gets its own `pick` line below — a v3 strand adds nothing here.
  const pickPos = r.isGenesis ? '◆ GENESIS' : strandPositionTag(s);
  lines.push(`PICK  sealed into the fabric${pickPos ? `  ${pickPos}` : ''}`);
  lines.push(`pick      ${s.pickId}`);
  lines.push(`state     ${s.stateId}`);
  lines.push(`actor     ${s.actor}`);
  lines.push(`intent    ${s.intent}`);
  if (r.isGenesis) {
    lines.push(`objects   ${s.objectCount}  (the project's meaning, warped)`);
  } else {
    lines.push(
      `delta     +${s.delta.born.length} born  ~${s.delta.contractChanged.length} changed  -${s.delta.retired.length} retired  ↻${s.delta.renamedNoop} renamed-noop`,
    );
  }
  lines.push('');
  lines.push('→ advanced selvage; appended → .warpline/fabric.jsonl');
  process.stdout.write(lines.join('\n') + '\n');
}

/** The one-strand summary block shared by the multi-branch log and the ancestry line. */
function strandLogLines(s: Strand): string[] {
  const merge = parentsOf(s).length > 1 ? `  [merge: ${parentsOf(s).length} parents]` : '';
  const lines = [`    intent:  ${s.intent}`];
  if (s.seq === 0) {
    lines.push(`    objects: ${s.objectCount}  (genesis)${merge}`);
  } else {
    lines.push(
      `    delta:   +${s.delta.born.length} born  ~${s.delta.contractChanged.length} changed  -${s.delta.retired.length} retired  ↻${s.delta.renamedNoop} renamed-noop${merge}`,
    );
  }
  return lines;
}

/** The git-style ref decoration for a node: `(HEAD -> feature, other-ref)`. */
function decorate(node: GraphNode): string {
  const decos: string[] = [];
  if (node.head) decos.push(node.headBranch ? `HEAD -> ${node.headBranch}` : 'HEAD (detached)');
  for (const r of node.refs) {
    if (node.head && node.headBranch === r) continue; // already folded into `HEAD -> r`
    decos.push(r);
  }
  return decos.length ? `  (${decos.join(', ')})` : '';
}

/** The DEFAULT `warpline log`: the whole DAG, newest first, ref/HEAD-annotated. */
function printLog(graph: BranchGraph, max: number): void {
  const lines: string[] = ['WARPLINE LOG  (multi-branch — * = HEAD)'];
  const h = graph.head;
  lines.push(
    `HEAD      ${h === null ? `${DEFAULT_BRANCH} (default trunk)` : h.kind === 'branch' ? h.branch : `detached ${short(h.pickId)}`}`,
  );
  lines.push('');
  if (graph.nodes.length === 0) {
    lines.push('(empty — run `warpline pick -m "..."` to seal the first strand)');
    process.stdout.write(lines.join('\n') + '\n');
    return;
  }
  const shown = graph.nodes.slice(0, max);
  for (const node of shown) {
    const s = node.strand;
    lines.push(`${node.head ? '*' : ' '} ${short(s.pickId)}${decorate(node)}  ${s.recordedAt.slice(0, 10)}  ${s.actor}`);
    lines.push(...strandLogLines(s));
  }
  if (graph.nodes.length > shown.length) {
    lines.push('');
    lines.push(`(${graph.nodes.length - shown.length} older strand(s) — raise --max)`);
  }
  process.stdout.write(lines.join('\n') + '\n');
}

/** `warpline log <branch>`: one branch's ancestry line, newest first (* = the tip). */
function printBranchAncestry(branch: string, tip: string, strands: Strand[], max: number): void {
  const lines: string[] = [`WARPLINE LOG  ${branch}  (ancestry — newest first)`];
  lines.push(`tip       ${short(tip)}`);
  lines.push(`depth     ${strands.length} strand${strands.length === 1 ? '' : 's'}`);
  lines.push('');
  if (strands.length === 0) {
    lines.push('(no ancestry — the branch is unborn)');
    process.stdout.write(lines.join('\n') + '\n');
    return;
  }
  const shown = strands.slice(0, max);
  for (const s of shown) {
    lines.push(`${s.pickId === tip ? '*' : ' '} ${short(s.pickId)}  ${s.recordedAt.slice(0, 10)}  ${s.actor}`);
    lines.push(...strandLogLines(s));
  }
  if (strands.length > shown.length) {
    lines.push('');
    lines.push(`(${strands.length - shown.length} older strand(s) — raise --max)`);
  }
  process.stdout.write(lines.join('\n') + '\n');
}

/** `warpline diff <A>..<B>`: the byte diff between two native tree tips. */
function printTreeDiff(a: string, b: string, td: TreeDiff): void {
  const lines: string[] = [`WARPLINE DIFF  ${a}..${b}  (byte diff between two tips — git absent)`];
  const total = td.added.length + td.removed.length + td.modified.length;
  if (total === 0) {
    lines.push('  (identical — no path differs between the two trees)');
    process.stdout.write(lines.join('\n') + '\n');
    return;
  }
  lines.push(`  +${td.added.length} added  ~${td.modified.length} modified  -${td.removed.length} removed`);
  lines.push('');
  for (const p of td.added) lines.push(`  + ${p}`);
  for (const p of td.modified) lines.push(`  ~ ${p}`);
  for (const p of td.removed) lines.push(`  - ${p}`);
  process.stdout.write(lines.join('\n') + '\n');
}

/** `warpline show <ordinary-strand>`: the strand's OWN diff — delta, intent, author, parents. */
function printStrandShow(s: Strand, td?: TreeDiff): void {
  const lines: string[] = [];
  const pos = s.seq === 0 ? '◆ genesis' : strandPositionTag(s);
  lines.push(`WARPLINE STRAND  ${short(s.pickId)}${pos ? `  (${pos})` : ''}`);
  lines.push(`pick      ${s.pickId}`);
  lines.push(`state     ${s.stateId}`);
  lines.push(`actor     ${s.actor}`);
  lines.push(`author    ${s.authoredBy?.agentId ?? '(no agent — operator seal)'}`);
  lines.push(`recorded  ${s.recordedAt.slice(0, 10)}`);
  const parents = parentsOf(s);
  lines.push(
    `parents   ${parents.length ? parents.map(short).join(', ') : '(genesis — no parents)'}${parents.length > 1 ? '  [merge]' : ''}`,
  );
  // intent is agent-authored — envelope it, then render inside the escaped
  // untrusted-prose frame (the same defense `knot show` gives both sides' intents).
  lines.push(frameProse(envelopeProse(s.intent), { label: 'intent' }));
  lines.push('');
  if (s.seq === 0) {
    lines.push(`objects   ${s.objectCount}  (the project's meaning, warped)`);
  } else {
    lines.push(
      `delta     +${s.delta.born.length} born  ~${s.delta.contractChanged.length} changed  -${s.delta.retired.length} retired  ↻${s.delta.renamedNoop} renamed-noop`,
    );
    if (s.delta.born.length) lines.push(`  born:     ${s.delta.born.join(', ')}`);
    if (s.delta.contractChanged.length) lines.push(`  changed:  ${s.delta.contractChanged.join(', ')}`);
    if (s.delta.retired.length) lines.push(`  retired:  ${s.delta.retired.join(', ')}`);
  }
  if (td) {
    const total = td.added.length + td.removed.length + td.modified.length;
    lines.push('');
    lines.push(
      `bytes vs parent  +${td.added.length} added  ~${td.modified.length} modified  -${td.removed.length} removed${total === 0 ? '  (meaning-only — no byte change)' : ''}`,
    );
    for (const p of td.added) lines.push(`  + ${p}`);
    for (const p of td.modified) lines.push(`  ~ ${p}`);
    for (const p of td.removed) lines.push(`  - ${p}`);
  }
  process.stdout.write(lines.join('\n') + '\n');
}

/** The `warpline init` result + the next-steps an agent needs to start the cycle. */
function printInit(r: InitResult): void {
  const lines: string[] = [];
  lines.push(`WARPLINE INIT  ${r.root}`);
  if (r.alreadyInitialized) {
    lines.push('genesis      already initialized — no second genesis sealed');
  } else {
    lines.push(`genesis      sealed  ${r.genesisPickId ? short(r.genesisPickId) : '(pending)'}`);
  }
  lines.push(`.warpignore  ${r.warpignoreWritten ? 'written (starter with commented examples)' : 'present — left as-is'}`);
  const gi = r.gitignore;
  lines.push(
    `.gitignore   ${
      gi.action === 'created'
        ? `created — ${gi.addedLines.join(', ')}`
        : gi.action === 'appended'
          ? `appended — ${gi.addedLines.join(', ')}`
          : gi.action === 'present'
            ? 'already covers the fabric'
            : 'skipped (no git here — nothing to defend the fabric from)'
    }`,
  );
  lines.push('');
  lines.push('You are now tracking with Warpline (native-first — git optional).');
  lines.push('→ agents: run `warpline status` FIRST — it is the manual (what changed, in MEANING).');
  lines.push('→ the cycle:  warpline fork <agent>  →  edit  →  warpline propose --agent <agent> --native -m "<why>"  →  warpline admit <agent> --native');
  lines.push('→ a CONTESTED merge (KNOT) needs a HUMAN:  warpline resolve <agent> -m "<decision>"  (agents escalate, never resolve).');
  process.stdout.write(lines.join('\n') + '\n');
}

/**
 * A SemDiffReport carrying the optional BYTE-HONESTY layer (#native-status): how
 * much moved on disk that MEANING did not govern. Present on `status` and on the
 * worktree-default `diff`; a native report also sets `native`.
 */
type StatusReport = SemDiffReport & { native?: boolean; onDisk?: DiskHonesty };

/**
 * The git-path byte-honesty layer: count working-tree changes vs HEAD so a clean
 * MEANING diff over real byte edits (an asset, a scalar-only const, a doc) never
 * reads as a no-op. Best-effort — a git failure omits the layer (undefined).
 */
async function gitDiskHonesty(root: string, r: SemDiffReport): Promise<DiskHonesty | undefined> {
  const filesChanged = await worktreeChangeCount({ cwd: root }).catch(() => null);
  if (filesChanged === null) return undefined;
  return { filesChanged, byteOnly: filesChanged > 0 && r.changedCount === 0 && r.renamedNoopCount === 0 };
}

/** The base a status/diff report compares against, for the human header/prose. */
function baseLabel(r: StatusReport): string {
  return r.refA === 'HEAD' ? 'HEAD' : r.refA === 'selvage' ? 'the selvage' : r.refA;
}

/**
 * The byte-honesty line for a CLEAN meaning diff — surfaced so a byte-only /
 * scalar-only change is never mistaken for a no-op. Returns the lines to add, or
 * a single "clean" line when nothing changed on disk either.
 */
function honestyLines(r: StatusReport): string[] {
  const od = r.onDisk;
  if (od && od.filesChanged > 0) {
    return [
      `0 meaning changes, but ${od.filesChanged} file${od.filesChanged === 1 ? '' : 's'} changed on disk ` +
        `(byte-only / not lifted into meaning).`,
      `${baseLabel(r)} and the working tree agree in MEANING; those are bytes Warpline does not adjudicate ` +
        `(assets, configs, docs, or scalar-only edits) — review them, this is NOT a no-op.`,
    ];
  }
  return [`clean — no semantic change (${baseLabel(r)} and the working tree agree in meaning)`];
}

function printStatus(r: StatusReport): void {
  const lines: string[] = [];
  lines.push(`WARPLINE STATUS  (working tree vs ${baseLabel(r)}, by MEANING${r.native ? ' — native, git absent' : ''})`);
  lines.push('');
  if (r.changedCount === 0 && r.renamedNoopCount === 0) {
    lines.push(...honestyLines(r));
  } else {
    lines.push(`born            ${r.born.length}`);
    for (const d of r.born) lines.push(`  + ${d.symbol}`);
    lines.push(`retired         ${r.retired.length}`);
    for (const d of r.retired) lines.push(`  - ${d.symbol}`);
    const own = r.contractChanged.filter((d) => d.localChanged ?? true);
    const rippled = r.contractChanged.filter((d) => !(d.localChanged ?? true));
    lines.push(`contract-changed ${r.contractChanged.length}${rippled.length ? `  (${own.length} own, ${rippled.length} ripple)` : ''}`);
    for (const d of own) lines.push(`  ~ ${d.symbol}`);
    if (rippled.length) lines.push(rippleLine(rippled.length, '  '));
    lines.push(`renamed (no meaning change)  ${r.renamedNoop.length}`);
    for (const d of r.renamedNoop) lines.push(`  ↻ ${d.baseSymbol}→${d.symbol}`);
    lines.push('');
    lines.push(
      `summary  ${r.changedCount} changed, ${r.renamedNoopCount} renamed-noop` +
        (r.onDisk ? `  ·  ${r.onDisk.filesChanged} file(s) changed on disk` : ''),
    );
  }
  process.stdout.write(lines.join('\n') + '\n');
}

/** bytes → a human magnitude (the report carries the exact number). */
function mag(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

const tally = (m: Record<string, number | undefined>): string =>
  Object.entries(m)
    .filter(([, v]) => (v ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .map(([k, v]) => `${k} ${v}`)
    .join(', ') || 'none';

/**
 * #warpline-health, printed. The ordering is deliberate: SOUNDNESS first (can
 * this ledger be trusted), then LIVENESS (is it still being written), then
 * MEASUREMENT (is it producing evidence) — because a green fabric that measures
 * nothing is the failure mode this verb exists to make impossible to miss.
 */
/**
 * WHY the root is what it is, in one phrase. `health` printed the resolved PATH
 * and nothing else, so "--root took" and "it fell through to the git root,
 * which happens to be correct today" were indistinguishable on screen — and
 * only the second is D-7.
 */
const ROOT_ARM_LABEL: Record<RootArm, string> = {
  flag: '--root (explicit)',
  env: `$${ROOT_ENV} (explicit)`,
  git: 'git toplevel (inferred)',
  cwd: 'process.cwd() FALLBACK — nothing chose this fabric',
};

function printHealth(h: HealthReport): void {
  const L: string[] = [];
  const v = h.fabric.verify;
  L.push(`WARPLINE HEALTH  ${h.root}`);
  L.push(
    `           root       via ${ROOT_ARM_LABEL[h.rootResolution.arm]}` +
      (h.rootResolution.nestedUnder ? `  ⚠ NESTED under ${h.rootResolution.nestedUnder}` : ''),
  );
  L.push('');

  L.push(
    `FABRIC     ${h.fabric.strands} strand(s) — ${h.fabric.byVersion.v1} v1, ${h.fabric.byVersion.v2} v2, ${h.fabric.byVersion.v3} v3` +
      (h.fabric.malformedLines ? `  ⚠ ${h.fabric.malformedLines} MALFORMED line(s)` : ''),
  );
  L.push(
    `           verify     ${v.ran ? (v.ok ? `all intact (${v.checked} checked)` : `${v.failures} FAILURE(S) of ${v.checked}`) : 'DID NOT RUN'}`,
  );
  for (const d of v.detail) L.push(`             ✗ ${d}`);
  L.push(
    `           refs mode  ${h.fabric.refsMode}` +
      (h.fabric.refsMode === 'refs' ? ` (${Object.keys(h.fabric.refs).join(', ')})` : ' — per-ref CAS DISENGAGED (C-1)'),
  );
  L.push(`           selvage    ${h.fabric.selvage ? short(h.fabric.selvage) : '(none)'}`);
  if (h.fabric.abandonedHeads.length) {
    L.push(`           abandoned  ${h.fabric.abandonedHeads.length} head(s) no ref names`);
  }
  if (h.fabric.stakeJournal?.present) {
    L.push(`           stakes     ${h.fabric.stakeJournal.attested} checkpoint(s) cross-checked (C-6 anti-truncation)`);
  }

  L.push('');
  L.push(
    `SEAL       last       ${h.seal.lastSealedAt ?? '(never)'}` +
      (h.seal.lastGitCommit ? `  at git ${h.seal.lastGitCommit.slice(0, 12)}` : ''),
  );
  L.push(
    `           behind     ${
      h.seal.commitsBehindHead !== null
        ? `${h.seal.commitsBehindHead} commit(s) behind HEAD`
        : `unknown (${h.seal.behindUnknown})`
    }`,
  );

  L.push('');
  L.push(`HOOK       block      ${h.hook.state}${h.hook.hookPath ? `  ${h.hook.hookPath}` : ''}`);
  L.push(
    `           resolves   ${h.hook.arm === 'none' ? 'NOTHING — every commit prints SKIPPED and seals nothing' : `${h.hook.arm} → ${h.hook.resolved}`}`,
  );
  if (h.hook.arm === 'dist' || h.hook.arm === 'none') {
    L.push(`           (\`${h.hook.bin}\` is not on PATH; the baked install-time binary did not resolve)`);
  }

  L.push('');
  const cf = h.adjudication.counterfactual;
  L.push(`VERDICTS   recorded   ${h.adjudication.verdicts}  (${tally(h.adjudication.byStatus)})`);
  L.push(
    `           vs git     ${cf.measured} of ${h.adjudication.verdicts} MEASURED` +
      // The COVERAGE RATIO is printed at every level, not only when it warns
      // (finding B3): the alarm has a floor, the number does not, and a founder
      // reading a green report should still be able to read the denominator.
      (cf.coveragePct !== null ? `  ·  ${cf.coveragePct}% of ${cf.measurable} measurable` : '') +
      (cf.predatesField ? `  ·  ${cf.predatesField} predate the counterfactual` : '') +
      (Object.keys(cf.unavailable).length ? `  ·  unavailable: ${tally(cf.unavailable)}` : ''),
  );
  if (cf.measured > 0) L.push(`           cells      ${tally(cf.cells)}`);
  // Both populations, always — the split is the point. A bare total hides WHICH
  // writer produced the contention, and this counter read only the shadow half
  // for the whole native era (see AdjudicationHealth.contested).
  L.push(
    `           contested  ${h.adjudication.contested}  (KNOT/DANGLE — what this product adjudicates)` +
      (h.adjudication.contested > 0
        ? `  ·  ${h.adjudication.contestedRecorded} recorded, ${h.adjudication.contestedShadow} shadow-observed`
        : ''),
  );
  L.push(`           base       ${tally(h.adjudication.baseFrom)}`);
  // ADJACENT TO `contested`, NEVER FOLDED INTO IT. A hazard is a note on a CLEAN
  // that sealed; adding it to the contested count would inflate the one number
  // the field test exists to measure with events that contested nothing.
  {
    const ha = h.adjudication.hazardAdvisories;
    if (ha.total > 0) {
      L.push(`           advisories ${ha.total} lexical-coupling (NOT contests) — ${ha.recordedRows} recorded, ${ha.shadowRows} shadow${Object.keys(ha.byKind).length ? `  ·  ${tally(ha.byKind)}` : ''}`);
    }
  }

  L.push('');
  L.push(
    `DISK       .warpline  ${mag(h.disk.bytes)} across ${h.disk.files} file(s)` +
      (h.disk.mbPerStrand !== null ? `  —  ${h.disk.mbPerStrand} MB per strand` : ''),
  );
  if (h.disk.largest.length) {
    L.push(`           largest    ${h.disk.largest.map((e) => `${e.name} ${mag(e.bytes)}`).join(' · ')}`);
  }

  if (h.unsound.length) {
    L.push('');
    L.push(`✗ UNSOUND (${h.unsound.length}) — do not treat this fabric as authoritative`);
    for (const s of h.unsound) L.push(`  - ${s}`);
  }
  if (h.warnings.length) {
    L.push('');
    L.push(`⚠ ${h.warnings.length} warning(s)`);
    for (const s of h.warnings) L.push(`  - ${s}`);
  }
  if (!h.unsound.length && !h.warnings.length) {
    L.push('');
    L.push('✓ green — sound, live, and measuring.');
  }
  process.stdout.write(L.join('\n') + '\n');
}

function printLifeline(ll: Lifeline): void {
  const lines: string[] = [];
  lines.push(`LIFELINE  ${ll.symbol}`);
  lines.push(`file      ${ll.filePath}${ll.truncated ? '   (history capped — raise --max)' : ''}`);
  lines.push('');
  if (ll.events.length === 0) {
    lines.push('(no essence-change history found in scope)');
  } else {
    for (const e of ll.events) {
      const date = e.date.slice(0, 10);
      const tag = e.kind === 'born' ? '◆ born  ' : '~ change';
      lines.push(`${tag}  ${e.commit}  ${date}  ${e.author}`);
      lines.push(`     intent:  ${e.intent}`);
      lines.push(`     essence: ${e.contentId}`);
      if (e.symbol !== ll.symbol) lines.push(`     (as ${e.symbol} — the thread survived a rename)`);
    }
    lines.push('');
    lines.push('(git blame resets at every rename; lifeline follows the meaning)');
  }
  process.stdout.write(lines.join('\n') + '\n');
}

/**
 * The CLEAN-hazard advisory (#hazard) on a FORECAST surface (oracle / weave
 * --preview). Mirrors printAdmit's advisory block — same LEXICAL wording, the same
 * stated blind spot — but framed for a PREVIEW: nothing has sealed; this merge
 * WOULD auto-weave. Advisory only: it qualifies no verdict. The wording states the
 * blind spot in the same breath by design — an empty list is NOT an all-clear, and
 * nothing here licenses "Warpline catches invariant conflicts."
 */
function appendForecastHazards(lines: string[], hazards: CleanHazard[] | undefined): void {
  if (!hazards?.length) return;
  lines.push('');
  lines.push(
    `⚠ ${hazards.length} LEXICAL coupling advisor${hazards.length === 1 ? 'y' : 'ies'} — CLEAN in meaning, WOULD auto-weave; review before admitting`,
  );
  for (const h of hazards.slice(0, 5)) {
    lines.push(`  · ${h.token}  [${h.kind}]  score ${h.score.toFixed(2)}${h.dangerFlags.length ? `  ⚑ ${h.dangerFlags.join(', ')}` : ''}`);
    lines.push(`      A: ${h.oursSymbols.join(', ')}`);
    lines.push(`      B: ${h.theirsSymbols.join(', ')}`);
  }
  if (hazards.length > 5) lines.push(`  … ${hazards.length - 5} more`);
  lines.push('  NOT a conflict check: invariant conflicts that share NO token are undetectable here.');
}

function printForecast(f: Forecast, hazards?: CleanHazard[]): void {
  const lines: string[] = [];
  lines.push(`WEAVE FORECAST  ${f.branchA}  ⟶  ${f.branchB}`);
  lines.push(`mergeBase ${f.mergeBase}`);
  lines.push(`states    base=${short(f.stateIds.base)}  A=${short(f.stateIds.A)}  B=${short(f.stateIds.B)}`);
  lines.push('');
  // The verdict line — the founder's killer line. Honour git reality: meaning can
  // be clean while git conflicts on bytes (a non-symbol file — GAP-1); never headline
  // "CLEAN TO WEAVE" over a real git conflict (T-2026-06-25-001).
  if (f.verdict === 'CLEAN') {
    if (f.vsGit?.gitConflicted) {
      const sites = f.vsGit.conflictSymbols.length + f.vsGit.gitConflictUnmapped.length;
      lines.push(`VERDICT  CLEAN IN MEANING — but git CONFLICTS (${sites || 'unmapped'} site(s))`);
      lines.push('         no knots in meaning; git collides on bytes (often a non-symbol file — GAP-1)');
    } else {
      lines.push('VERDICT  CLEAN TO WEAVE  (no knots, no dangling references)');
    }
  } else {
    const n = f.decisions;
    lines.push(`VERDICT  ${n} decision${n === 1 ? '' : 's'} needed  (${f.knots.length} knot(s), ${f.dangling.length} dangling)`);
  }
  lines.push('');
  lines.push(`autoClean  ${f.autoClean.length}`);

  // Anti-avalanche ranking: direct-contested knots first with full detail;
  // ripple-only knots (essence transitivity) collapse to one count line.
  const { direct: fDirect, ripple: fRipple } = partitionKnots(f.knots);
  lines.push(`knots      ${f.knots.length}${fRipple.length ? `  (${fDirect.length} direct-contested, ${fRipple.length} ripple)` : ''}`);
  for (const k of fDirect) {
    lines.push(`  ⊗ ${k.symbol}`);
    if (k.conflictingSlots.length) {
      lines.push(`      conflicting slot(s): ${k.conflictingSlots.join(', ')}`);
    }
    lines.push(`      A → ${k.essenceA ?? '(retired)'}`);
    lines.push(`      B → ${k.essenceB ?? '(retired)'}`);
  }
  if (fRipple.length) lines.push(rippleLine(fRipple.length, '  '));

  lines.push(`dangling   ${f.dangling.length}`);
  for (const d of f.dangling) {
    lines.push(`  ⤬ ${d.fromSymbol} --${d.edgeKind}--> ${d.danglingTargetSymbol}  (retired by ${d.retiredBy})`);
  }

  if (f.vsGit) {
    const g = f.vsGit;
    lines.push('');
    lines.push(`vs GIT REALITY: ${g.gitConflicted ? 'CONFLICT' : 'clean'}  (${g.conflictSymbols.length} symbol(s))`);
    lines.push(`  divergeGitOnly  ★   ${g.divergeGitOnly.length}${g.divergeGitOnly.length ? '  ' + g.divergeGitOnly.join(', ') : ''}`);
    appendMeaningOnlyRanked(lines, g);
    if (g.gitConflictUnmapped.length) {
      lines.push(`  gitConflictUnmapped  ${g.gitConflictUnmapped.length}  ${g.gitConflictUnmapped.join(', ')}  (git-only, no symbol — GAP-1)`);
    }
    lines.push(`  score               ${g.score}`);
    lines.push(`  VERDICT             ${g.verdict}`);
  }

  appendForecastHazards(lines, hazards);

  lines.push('');
  lines.push('(preview is ephemeral — no oracle.jsonl row written)');
  process.stdout.write(lines.join('\n') + '\n');
}

function printConsolidate(f: ConsolidateForecast): void {
  const lines: string[] = [];
  lines.push(`CONSOLIDATE FORECAST  ${f.refs.join('  +  ')}`);
  lines.push(`base      ${f.base}`);
  lines.push('');
  if (f.verdict === 'CLEAN') {
    lines.push(`VERDICT  CLEAN TO FOLD  (${f.autoFolded.length} symbol(s) auto-fold, no decisions)`);
  } else {
    const n = f.decisions;
    lines.push(
      `VERDICT  ${n} decision${n === 1 ? '' : 's'} needed  (${f.knots.length} knot(s), ${f.dangling.length} dangling)  —  ${f.autoFolded.length} auto-fold`,
    );
  }
  lines.push('');
  lines.push(`knots      ${f.knots.length}`);
  for (const k of f.knots) {
    lines.push(`  ⊗ ${k.symbol}${k.conflictingSlots.length ? `  [${k.conflictingSlots.join(', ')}]` : ''}`);
    for (const s of k.sides) lines.push(`      ${s.ref} → ${s.essence ?? '(retired)'}`);
  }
  lines.push(`dangling   ${f.dangling.length}`);
  for (const d of f.dangling) {
    lines.push(`  ⤬ ${d.fromSymbol} --${d.edgeKind}--> ${d.danglingTargetSymbol}  (${d.addedBy} adds, ${d.retiredBy} retired)`);
  }
  lines.push('');
  lines.push('(forecast is ephemeral — no oracle.jsonl row written)');
  process.stdout.write(lines.join('\n') + '\n');
}

function printSemDiff(r: StatusReport): void {
  const lines: string[] = [];
  lines.push(`SEMANTIC DIFF  ${r.refA}  ⟶  ${r.refB}${r.native ? '  (native, git absent)' : ''}`);
  lines.push(`states    A=${short(r.stateIds.A)}  B=${short(r.stateIds.B)}`);
  lines.push('');

  lines.push(`born            ${r.born.length}`);
  for (const d of r.born) lines.push(`  + ${d.symbol}`);

  lines.push(`retired         ${r.retired.length}`);
  for (const d of r.retired) lines.push(`  - ${d.symbol}`);

  // Own-content changes first; pure-ripple entries (contentId moved only via
  // edge-target essence transitivity) collapse to one count line.
  const ownChanged = r.contractChanged.filter((d) => d.localChanged ?? true);
  const rippleChanged = r.contractChanged.filter((d) => !(d.localChanged ?? true));
  lines.push(`contract-changed ${r.contractChanged.length}${rippleChanged.length ? `  (${ownChanged.length} own, ${rippleChanged.length} ripple)` : ''}`);
  for (const d of ownChanged) {
    const slots = d.changedSlots ?? (d.changeset ? changedSlotsOf(d.changeset) : []);
    lines.push(`  ~ ${d.symbol}  [${slots.join(', ') || 'essence'}]`);
    if (d.changeset) appendSlotDetail(lines, d.changeset);
  }
  if (rippleChanged.length) lines.push(rippleLine(rippleChanged.length, '  '));

  lines.push(`renamed (no meaning change)  ${r.renamedNoop.length}`);
  for (const d of r.renamedNoop) {
    lines.push(`  ↻ ${d.baseSymbol}→${d.symbol} (no meaning change)`);
  }

  lines.push('');
  lines.push(
    `summary  ${r.changedCount} changed, ${r.renamedNoopCount} renamed-noop` +
      (r.onDisk ? `  ·  ${r.onDisk.filesChanged} file(s) changed on disk` : ''),
  );
  // Byte-honesty: a CLEAN meaning diff over real byte changes is NOT a no-op.
  if (r.onDisk?.byteOnly) {
    lines.push(
      `note     0 meaning changes, but ${r.onDisk.filesChanged} file(s) changed on disk (byte-only / not lifted into meaning) — review, this is NOT a no-op.`,
    );
  }
  process.stdout.write(lines.join('\n') + '\n');
}

/** Indented per-slot detail for a contract-changed delta. */
function appendSlotDetail(lines: string[], cs: ContractChangeset): void {
  const pair = (label: string, added: string[], removed: string[]) => {
    if (!added.length && !removed.length) return;
    const parts: string[] = [];
    if (added.length) parts.push(`+${added.join(' +')}`);
    if (removed.length) parts.push(`-${removed.join(' -')}`);
    lines.push(`      ${label}: ${parts.join('  ')}`);
  };
  pair('gates', cs.gatesAdded, cs.gatesRemoved);
  pair('signals', cs.signalsAdded, cs.signalsRemoved);
  pair('aspects', cs.aspectsAdded, cs.aspectsRemoved);
  pair('states', cs.statesAdded, cs.statesRemoved);
  if (cs.componentTypeChanged) lines.push('      componentType: changed');
  if (cs.kindChanged) lines.push('      kind: changed (retype)');
  if (cs.stepsChanged) lines.push('      steps: changed');
  if (cs.bodyChanged) lines.push('      body: changed');
  const edgeAdd = cs.edgesAdded.map((e) => `+${e.kind}→${e.targetSymbol}`);
  const edgeRem = cs.edgesRemoved.map((e) => `-${e.kind}→${e.targetSymbol}`);
  if (edgeAdd.length || edgeRem.length) {
    lines.push(`      edges: ${[...edgeAdd, ...edgeRem].join('  ')}`);
  }
}

function printAbsorbSummary(state: WarpState): void {
  const objs = Array.from(state.objects.values());
  const sample = objs.slice(0, 8);
  const lines: string[] = [];
  lines.push(`ABSORB  ref=${state.ref}  tree=${state.treeSha ?? '(worktree)'}`);
  lines.push(`stateId   ${state.stateId}`);
  lines.push(`objects   ${objs.length}`);
  lines.push('');
  lines.push('sample objects (symbol  kind  contentId):');
  for (const o of sample) {
    lines.push(`  ${pad(o.symbol, 32)} ${pad(o.kind, 10)} ${o.contentId}`);
  }
  if (objs.length > sample.length) lines.push(`  ... and ${objs.length - sample.length} more`);
  process.stdout.write(lines.join('\n') + '\n');
}

function printOracleSummary(record: OracleRecord): void {
  const c = record.convergence;
  const lines: string[] = [];
  lines.push(`ORACLE  ${record.branchA}  vs  ${record.branchB}`);
  lines.push(`mergeBase ${record.mergeBase}`);
  lines.push(`states    base=${short(record.stateIds.base)}  A=${short(record.stateIds.A)}  B=${short(record.stateIds.B)}`);
  lines.push('');
  // The actionable "is it safe to weave?" answer FIRST — a contested merge is never
  // presented as green, even when meaning and git AGREE it conflicts (T-2026-06-25-005).
  if (record.mergeClean) {
    lines.push('MERGE   CLEAN ✓   (no knots, no dangling, git merges clean)');
  } else {
    const why: string[] = [];
    if (record.prediction.knots.length) why.push(`${record.prediction.knots.length} knot(s)`);
    if (record.prediction.dangling.length) why.push(`${record.prediction.dangling.length} dangling`);
    if (record.gitReality.conflicted) why.push('git CONFLICT');
    lines.push(`MERGE   CONFLICTED   (${why.join(', ')}) — a human must resolve`);
  }
  lines.push('');
  lines.push('PREDICTION (from meaning):');
  lines.push(`  autoClean ${record.prediction.autoClean.length}`);
  const { direct: directKnots, ripple: rippleKnots } = partitionKnots(record.prediction.knots);
  if (rippleKnots.length === 0) {
    lines.push(`  knots     ${record.prediction.knots.length}${record.prediction.knots.length ? '  ' + record.prediction.knots.map((k) => k.symbol).join(', ') : ''}`);
  } else {
    // anti-avalanche: name the direct-contested knots, collapse the ripple.
    lines.push(`  knots     ${record.prediction.knots.length}`);
    lines.push(`      direct-contested (${directKnots.length})${directKnots.length ? ': ' + directKnots.map((k) => k.symbol).join(', ') : ''}`);
    lines.push(rippleLine(rippleKnots.length, '      '));
  }
  lines.push(`  dangling  ${record.prediction.dangling.length}${record.prediction.dangling.length ? '  ' + record.prediction.dangling.map((d) => `${d.fromSymbol}→${d.danglingTargetSymbol}`).join(', ') : ''}`);
  lines.push('');
  lines.push(`GIT REALITY: ${record.gitReality.conflicted ? 'CONFLICT' : 'clean'}  (${record.gitReality.conflictPaths.length} path(s), ${record.gitReality.conflictSymbols.length} symbol(s))`);
  if (record.gitReality.conflictPaths.length) {
    lines.push(`  paths: ${record.gitReality.conflictPaths.slice(0, 6).join(', ')}${record.gitReality.conflictPaths.length > 6 ? ' ...' : ''}`);
  }
  lines.push('');
  lines.push('CONVERGENCE — did MEANING agree with GIT? (the experiment, not "is it safe"):');
  lines.push(`  agreeClean          ${c.agreeClean.length}`);
  lines.push(`  agreeConflict       ${c.agreeConflict.length}`);
  lines.push(`  divergeGitOnly  ★   ${c.divergeGitOnly.length}${c.divergeGitOnly.length ? '  ' + c.divergeGitOnly.join(', ') : ''}`);
  appendMeaningOnlyRanked(lines, c);
  if (c.gitConflictUnmapped.length) {
    lines.push(`  gitConflictUnmapped  ${c.gitConflictUnmapped.length}  ${c.gitConflictUnmapped.join(', ')}  (git-only, no symbol — GAP-1)`);
  }
  lines.push(`  score               ${c.score}`);
  lines.push(`  VERDICT             ${c.verdict}`);
  appendForecastHazards(lines, record.hazards);
  lines.push('');
  lines.push('appended → .warpline/oracle.jsonl');
  process.stdout.write(lines.join('\n') + '\n');
}

/**
 * The RANKED divergeMeaningOnly display (the anti-avalanche cell, T-2026-07-03-002):
 * direct-contested symbols named prominently, ripple collapsed to a count line.
 * Small direct sets ARE the product — ground truth put ≤6-symbol flag sets at 50%
 * churn-validated and every ≥10-symbol avalanche at 0%.
 */
function appendMeaningOnlyRanked(
  lines: string[],
  c: Pick<OracleRecord['convergence'], 'divergeMeaningOnly' | 'directContested' | 'rippleOnly' | 'knotSize'>,
): void {
  if (!c.rippleOnly?.length) {
    lines.push(`  divergeMeaningOnly ★ ${c.divergeMeaningOnly.length}${c.divergeMeaningOnly.length ? '  ' + c.divergeMeaningOnly.join(', ') : ''}`);
    return;
  }
  lines.push(`  divergeMeaningOnly ★ ${c.divergeMeaningOnly.length}  (knot size ${c.knotSize})`);
  lines.push(`      direct-contested (${c.knotSize})${c.directContested.length ? ': ' + c.directContested.join(', ') : ''}`);
  lines.push(rippleLine(c.rippleOnly.length, '      '));
}

/**
 * Partition knots into DIRECT-CONTESTED vs RIPPLE-ONLY for the anti-avalanche
 * display (T-2026-07-03-002): direct knots are named prominently; ripple knots
 * (essence-transitivity avalanche) collapse to a count line. An absent flag
 * reads as direct — unknown is surfaced, never silently collapsed.
 *
 * The RULE now lives in the engine (#rank, fabric/rank.ts) so #refusal ranks its
 * contested set identically; this stays as the CLI's local name for it.
 */
const partitionKnots = rankVerdicts;

/** The collapsed ripple count line (shared wording across surfaces). */
function rippleLine(n: number, indent: string): string {
  return `${indent}+${n} ripple-reachable symbol${n === 1 ? '' : 's'} (essence transitivity)`;
}

/** Human tag for a sealed strand: v1/v2 show seq; v3 (position-free) shows the pickId. */
function strandTag(s: Strand): string {
  return s.seq !== undefined ? `seq ${s.seq}` : short(s.pickId);
}

/**
 * The LEDGER-POSITION tag, for lines that already print the pickId in their own
 * column: `seq N` for v1/v2, and `null` for v3 — which is position-free by
 * design, so there is nothing to say. Callers omit the segment rather than
 * interpolate: `seq ${s.seq}` printed "seq undefined", and falling back to
 * `strandTag` printed the pickId TWICE on the same line.
 */
function strandPositionTag(s: Strand): string | null {
  return s.seq !== undefined ? `seq ${s.seq}` : null;
}

function printFieldOracle(root: string, r: FieldOracleRunResult): void {
  const lines: string[] = ['FIELD ORACLE  (§4 CLEAN-seal audit — parents first, then the merge)'];
  lines.push(
    r.greengate === 'declared'
      ? `GATE      declared (${greenGatePathOf(root)})`
      : `GATE      ABSENT — every check recorded absent; these seals are untested, not passed (${greenGatePathOf(root)})`,
  );
  lines.push('');
  if (r.audited.length === 0) {
    lines.push('(nothing new to audit — every seal is already in the ledger)');
  }
  for (const row of r.audited) {
    const reg = row.objectiveRegression ? '  OBJECTIVE-REGRESSION' : '';
    const cov = row.coveredClass ? 'covered' : `blind (${row.blind.length} path(s))`;
    lines.push(`  ${short(row.pickId)}  ${row.mode.padEnd(13)} ${row.verdict.padEnd(21)} ${cov}${reg}`);
  }
  lines.push('');
  const by = (v: OracleRow['verdict']): number => r.audited.filter((x) => x.verdict === v).length;
  lines.push(
    `TOTALS    audited ${r.audited.length} · skipped (already audited) ${r.skipped} · ` +
      `true-clean ${by('true-clean')} · candidate-false-clean ${by('candidate-false-clean')} · blind-untested ${by('blind-untested')}`,
  );
  process.stdout.write(lines.join('\n') + '\n');
}

/* ── field seed / init-subject helpers (PRE-APP KIT) ─────────────────────────── */

/** Refuse to seal into a non-empty sealed dir (a card.json/manifest present) unless forced. */
function guardSealDir(dir: string, force: boolean): void {
  if (force || !existsSync(dir)) return;
  const occupied = readdirSync(dir).some((n) => n === 'manifest.json' || n.endsWith('.json'));
  if (occupied) {
    process.stderr.write(
      `warpline: ${dir} already holds sealed card(s)/manifest — refusing to overwrite a sealed set (use --force)\n`,
    );
    process.exit(1);
  }
}

/** Read every RatingCard JSON out of a captured-cards dir (skips manifest.json). */
function readCardsFromDir(dir: string): RatingCard[] {
  if (!existsSync(dir)) {
    process.stderr.write(`warpline: field seed classify — cards dir ${dir} does not exist\n`);
    process.exit(1);
  }
  const out: RatingCard[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json') || name === 'manifest.json') continue;
    const card = JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as RatingCard;
    if (recomputeCardId(card) !== card.cardId) {
      process.stderr.write(
        `warpline: field seed classify — ${path.join(dir, name)} cardId does not match its content; refusing to seal a forged card\n`,
      );
      process.exit(1);
    }
    out.push(card);
  }
  return out;
}

function printSeal(kind: string, r: SealResult, json: boolean, synthetic?: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify({ kind, ...r, ...(synthetic !== undefined ? { synthetic } : {}) }, null, 2) + '\n');
    return;
  }
  const lines = [`FIELD SEED  (${kind} — sealed card set)`];
  lines.push(`SEALED    ${r.count} card(s) → ${r.dir}`);
  lines.push(`MANIFEST  manifest.json sha256 ${r.manifestSha256}`);
  lines.push('COMMIT    git-add the sealed dir + commit this sha256 before admission 1 (v2 §C).');
  process.stdout.write(lines.join('\n') + '\n');
}

function printSeedVerify(base: string, sets: SeedCardSets | null, error: string | null): void {
  const lines = ['FIELD SEED VERIFY  (§C condition (c) — the run\'s OWN loader over the sealed dirs)'];
  lines.push(`ROOT      ${base}`);
  if (!sets) {
    lines.push('RESULT    FAILED — the loader refused the sealed set:');
    lines.push(`  ${error ?? '(no message)'}`);
    process.stdout.write(lines.join('\n') + '\n');
    return;
  }
  lines.push('RESULT    OK — every sealed dir loads through the run loader');
  lines.push(
    `COUNTS    planted ${sets.planted.length} · genuine ${sets.genuine.length} · over-block ${sets.overBlock.length} · corpus ${sets.corpus.length}`,
  );
  if (sets.corpus.length === 0) {
    lines.push('CAVEAT    corpus is EMPTY — the RUN pre-flight (§5 gate (b)) will DISQUALIFY on an empty corpus. Seal it before the run.');
  }
  process.stdout.write(lines.join('\n') + '\n');
}

function printInitSubject(r: InitSubjectResult): void {
  const lines = ['FIELD INIT-SUBJECT  (scaffold + instruct — no init, no keys)'];
  lines.push(
    r.greengateWritten
      ? `GREENGATE wrote starter ${r.greengatePath} (tsc --noEmit + expo export; fill the behavioral block)`
      : `GREENGATE left intact — ${r.greengateSkippedReason ?? 'exists'}`,
  );
  lines.push(
    r.checklistTemplateWritten
      ? `TEMPLATE  wrote ${r.checklistTemplatePath} (author + freeze the behavioral couplings)`
      : `TEMPLATE  left intact ${r.checklistTemplatePath}`,
  );
  lines.push('');
  lines.push('PRE-RUN CHECKLIST (runbook §0 — all must be checked in writing before admission 1):');
  for (const item of r.checklist) {
    lines.push(`  [${item.mode === 'auto' ? 'auto  ' : 'manual'}] ${item.text}`);
  }
  lines.push('');
  lines.push('REMINDERS:');
  for (const rem of r.reminders) lines.push(`  ! ${rem}`);
  process.stdout.write(lines.join('\n') + '\n');
}

function printFieldCards(root: string, cards: FieldCards, r: WriteCardsResult): void {
  const lines: string[] = ['FIELD CARDS  (habit (ii) — blinded §5 rating cards, scan-based)'];
  lines.push(`CARDS     ${cards.knotCards.length} KNOT card(s) — ${r.written} written, ${r.skippedExisting} already on disk (${fieldCardsDirOf(root)})`);
  lines.push(
    `DOWNGRADES ${cards.byteDowngrades.length} byte-downgrade KNOT(s) without a payload — ${r.downgradesRecorded} newly recorded (${byteDowngradesPathOf(root)})`,
  );
  for (const d of cards.byteDowngrades) {
    lines.push(`  ${short(d.stateRef)}  card-less (B-3 gap)`);
  }
  process.stdout.write(lines.join('\n') + '\n');
}

function printFieldFallbackList(root: string, entries: GitFallbackEntry[]): void {
  const lines: string[] = [`GIT FALLBACKS  (habit (iii) — ${gitFallbackPathOf(root)})`];
  if (entries.length === 0) {
    lines.push('(none logged)');
  }
  for (const e of entries) {
    lines.push(`  ${e.ts}  ${e.actor}${e.knotId ? `  knot ${short(e.knotId)}` : ''}${e.admitRef ? `  admit ${short(e.admitRef)}` : ''}`);
    lines.push(`    ${e.message}`);
  }
  process.stdout.write(lines.join('\n') + '\n');
}

function printFieldJudge(root: string, r: FieldJudgeResult, fake: boolean): void {
  const lines: string[] = [`FIELD JUDGE  (§5 blinded cold judge${fake ? ' — FAKE MODEL DRY-RUN: measures nothing' : ''})`];
  const a = r.assembled;
  lines.push(
    `STREAM    knot ${a.knot} · oracle-flagged ${a.oracleFlagged} · audit-sample ${a.auditSample} · planted ${a.planted} · seeded ${a.seededControls} · corpus ${a.corpus} (seed ${r.seed.slice(0, 16)}…)`,
  );
  lines.push(`SKIPPED   ${r.skippedAlreadyJudged} already judged · ${r.batchDeferred} deferred past --batch-limit`);
  if (r.runner.disqualified) {
    lines.push('');
    lines.push('DISQUALIFIED — the judge FAILED the injection pre-flight (§5). NOTHING was scored,');
    lines.push('nothing was sealed, and no blinded (B)/(C) denominator may be claimed for this run.');
    lines.push(`  reason: ${r.runner.disqualifyReason ?? '(none recorded)'}`);
    process.stdout.write(lines.join('\n') + '\n');
    return;
  }
  lines.push(
    `SCORED    ${r.runner.scored} card(s) sealed · voided (twin-invariant) ${r.runner.preflight.voided.length} · ledger ${fieldJudgeLedgerPathOf(root)}`,
  );
  lines.push(`HEAD      ${r.runner.previousHead ? short(r.runner.previousHead) : '(fresh ledger)'} → ${r.runner.ledgerHead ? short(r.runner.ledgerHead) : '(nothing sealed)'}`);
  lines.push(`MANIFEST  ${r.manifestPath} (carries the F3c audit-sample leak caveat)`);
  lines.push('');
  lines.push(r.runner.witnessCommitReminder);
  process.stdout.write(lines.join('\n') + '\n');
}

function printFieldJoin(r: FieldJoinResult): void {
  const lines: string[] = ['FIELD JOIN  (§3 write-before-reveal — answers joined AFTER the sealed ratings)'];
  lines.push(
    `WITNESS   git-committed head ${short(r.witness.witnessedRowHash)} at chain ordinal ${r.witness.witnessedOrdinal} · un-witnessed tail before join: ${r.witness.unwitnessedTail} row(s)`,
  );
  lines.push(
    `JOINED    ${r.joined} verdict(s) · already joined ${r.skippedAlreadyJoined} · controls skipped ${r.skippedControls} (calibration, no Warpline verdict)`,
  );
  if (r.awaitingWitness > 0) {
    lines.push(`AWAITING  ${r.awaitingWitnessNote}`);
  }
  for (const u of r.unjoinable) {
    lines.push(`  UNJOINABLE ${short(u.cardId)} — ${u.reason}`);
  }
  lines.push(`HEAD      ${r.ledgerHead ? short(r.ledgerHead) : '(empty ledger)'}`);
  lines.push('');
  lines.push(r.witnessCommitReminder);
  process.stdout.write(lines.join('\n') + '\n');
}

function printFieldScore(s: FieldScore, mdPath: string, jsonPath: string): void {
  const lines: string[] = ['FIELD SCORE  (§7 pre-committed thresholds → §9 report)'];
  lines.push(`ADMISSIONS ${s.admissions.n} (${s.admissions.source})`);
  lines.push(`(A) ${s.sevenA.verdict} — ${s.sevenA.reason}`);
  lines.push(`(B) ${s.sevenB.verdict} — ${s.sevenB.reason}`);
  lines.push(`(C) ${s.sevenC.verdict} — ${s.sevenC.reason}`);
  lines.push(
    `BOUNDS    objective ${s.sevenA.bounds.objective.observed}/${s.sevenA.bounds.objective.n} · subjective ${s.sevenA.bounds.subjective.observed}/${s.sevenA.bounds.subjective.n} — reported separately, never blended (§7A A12)`,
  );
  lines.push(
    `SEEDS     precision ${s.seededControl.genuinePrecision === null ? 'n/a' : (s.seededControl.genuinePrecision * 100).toFixed(0) + '%'} · beats ~29% prior: ${s.seededControl.beatsPrior ? 'yes' : 'NO (denominator uncalibrated)'}`,
  );
  lines.push(`REPORT    ${mdPath}`);
  lines.push(`          ${jsonPath}`);
  process.stdout.write(lines.join('\n') + '\n');
}

function short(id: string): string {
  // state:v0:<hex> → state:…<8>
  const m = id.match(/([0-9a-f]{8})[0-9a-f]*$/);
  return m ? `…${m[1]}` : id;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function fail(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  // Engine-boundary messages already open with `warpline: ` (every RefusedError
  // in fabric/ does), so prefixing unconditionally printed "warpline: warpline:"
  // on exactly the errors an agent is most likely to be reading.
  process.stderr.write(msg.startsWith('warpline: ') ? `${msg}\n` : `warpline: ${msg}\n`);
  // PW-2: an engine-boundary RefusedError carries refusal:v1 — surface it as a
  // machine-readable stderr line (prose-free by construction) and exit with
  // its verdict-keyed code instead of the uniform 1.
  if (err instanceof RefusedError) {
    process.stderr.write(JSON.stringify({ refusal: err.refusal }) + '\n');
    process.exit(exitCodeFor(err.refusal.code));
  }
  process.exit(1);
}

// Reject stray positional args so `diff a b c` errors instead of silently dropping `c`.
program.commands.forEach((c) => c.allowExcessArguments(false));

/**
 * Run the parse ONLY when this file is the process entry point. When cli.ts is
 * imported as a module (e.g. a test exercising `admitReportLines`), parsing
 * `process.argv` under a foreign runner would try to run a bogus subcommand and
 * `process.exit`. realpathSync makes the check symlink-safe, so the npm `bin`
 * shim (a symlink to dist/cli.js) still matches when invoked as `warpline`.
 */
function runningAsCli(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (runningAsCli()) {
  // D-7: lift `--root <dir>` out of argv (any position) BEFORE commander parses,
  // and validate it eagerly — a typo'd explicit root must refuse here, not after
  // a write has already landed somewhere unexpected.
  let userArgv: string[] = [];
  try {
    const lifted = extractRootFlag(process.argv.slice(2));
    setExplicitRoot(lifted.root);
    userArgv = lifted.argv;
  } catch (err) {
    fail(err);
  }

  // No command → the help screen, whose description points at `init` then
  // `status` as the starting points (a bare `warpline` should orient, not error).
  if (userArgv.length === 0) {
    program.outputHelp();
    process.exit(0);
  }

  program.parseAsync(userArgv, { from: 'user' }).catch((err) => fail(err));
}

// referenced so WORKTREE_REF is part of the public CLI vocabulary surface
void WORKTREE_REF;
