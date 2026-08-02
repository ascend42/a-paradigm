#!/usr/bin/env node
/**
 * #warpline-cli — the Warpline command line. Thin output; no blockquotes.
 *
 *   warpline oracle <branchA> <branchB> [--json]   run the Convergence/Divergence Oracle
 *   warpline absorb <ref> [--json]                 lift a ref to a WarpState and dump it
 *   warpline weave --preview <A> <B> [--json]      THE PRE-MERGE FORECAST (meaning)
 *   warpline consolidate <refs...> [--base R]      THE N-WAY FOLD FORECAST (meaning)
 *   warpline status [--json]                       working-tree MEANING vs HEAD
 *   warpline lifeline <symbol> [--max N] [--json]  meaning-aware blame (survives renames)
 *   warpline diff [refA] [refB] [--json]           SEMANTIC diff between two refs
 *   warpline knot show <selector> [--json]         a KNOT payload (forge-spec §3a) — the
 *                                                  self-sufficient resolution work order
 *
 * This is the ONLY file allowed to write to stdout — library code stays quiet.
 */

import { Command } from 'commander';
import { absorb, WORKTREE_REF } from './absorb.js';
import { oracle, type OracleRecord } from './oracle.js';
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
import { serializeState } from './warp/store.js';
import { ObjectStore } from './warp/object-store.js';
import { snapshotDir } from './warp/snapshot.js';
import type { WarpState } from './warp/warp-state.js';
import { recordPick, type PickResult } from './fabric/pick.js';
import { warplineDirOf, readSelvage, readFabric } from './fabric/fabric.js';
import type { Strand } from './fabric/strand.js';
import { installHook, uninstallHook, hookStatus } from './fabric/hook.js';
import { forkScratch } from './fabric/scratch.js';
import { admit, type AdmitResult } from './fabric/admit.js';
import { exitCodeForResult, exitCodeFor, RefusedError } from './fabric/refusal.js';
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
import { checkHumanClass } from './agent-shell.js';
import { createClaim, persistClaim, type CreateClaimInput } from './fabric/claim.js';
import { resolveKnot } from './fabric/resolve.js';
import { readKnotPayload, type KnotPayload, type ContestedUnit } from './fabric/knot-payload.js';
import { frameProse } from './envelope.js';
import { gradeFabric, applyGrades, type GradeReport } from './fabric/grade.js';
import { verifyFabric } from './fabric/verify.js';
import { listRefs, heads, migrateSelvageToRefs } from './fabric/refs.js';
import { repairFabric, setFabricRef, type FabricRepairResult, type RefSetResult } from './fabric/repair.js';
import { attestFabric } from './fabric/anchor.js';
import { backfillV1Bindings } from './fabric/backfill.js';
import { restore, type RestoreResult } from './fabric/restore.js';
import { stake, stakeRecover, type StakeResult, type StakeRecoverResult } from './fabric/stake.js';
import { STAKE_MARKER } from './fabric/stake-guard.js';
import { existsSync } from 'node:fs';
import { gitPath } from './git/git-exec.js';
import { resolveRoot, setExplicitRoot, extractRootFlag, ROOT_ENV } from './root.js';
import { startDaemon } from './daemon/server.js';
import { mintToken, listTokenSummaries, writeMcpTokenFile, type TokenScope } from './daemon/tokens.js';
import { runMcpServer } from './mcp/server.js';
import { backupFabric, verifyBackup, type BackupResult, type BackupVerifyReport } from './fabric/backup.js';
import { daemonState, stopDaemon, socketPathOf } from './daemon/lifecycle.js';
import { DaemonClient } from './daemon/client.js';
import { spawn } from 'node:child_process';

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
}): Promise<void> {
  const violation = checkHumanClass({ cliPath: spec.cliPath, ...(spec.flags ? { flags: spec.flags } : {}) });
  if (!violation) return;
  // traceCli emits the row (refusal included) and RE-THROWS unchanged, so
  // fail() still owns the stderr refusal line and the verdict-keyed exit.
  await traceCli({ root: spec.root, verb: spec.verb, target: spec.target, principal: violation.agentId }, () => {
    throw new RefusedError(violation.refusal, violation.message);
  });
}

program
  .name('warpline')
  .description('Warpline — version control for meaning. The Convergence/Divergence Oracle (read-only forecasts) + the native fabric (pick/admit/resolve/restore). Writes .warpline/ only, never git.')
  .version('0.1.0')
  // D-7: the EXPLICIT root. Registered here so it appears in --help; the value
  // is actually lifted out of argv by extractRootFlag below, which makes it
  // legal in ANY position (commander would otherwise reject it after the
  // subcommand). Precedence: --root > WARPLINE_ROOT > git rev-parse > cwd.
  .option('--root <dir>', `the repository to operate on — overrides git rev-parse and $${ROOT_ENV} (must already exist)`);

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
        if (options.json) {
          process.stdout.write(JSON.stringify(f, null, 2) + '\n');
        } else {
          printForecast(f);
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
  .description('SEMANTIC diff between two refs (rides the meaning graph). Renames are the EMPTY delta. Defaults: no args = WORKTREE vs HEAD; one arg = ref vs HEAD; two args = refA vs refB.')
  .argument('[refA]', 'first ref (default: WORKTREE)')
  .argument('[refB]', 'second ref (default: HEAD)')
  .option('--json', 'emit the full SemDiffReport as JSON')
  .action(async (refA: string | undefined, refB: string | undefined, options: { json?: boolean }) => {
    try {
      // no args = WORKTREE vs HEAD; one arg = ref vs HEAD; two args = refA vs refB.
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
      const report = await semanticDiff(a, b);
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
      const report = await traceCli(
        { root, verb: 'cli:status', target: cliTarget({}, { json: options.json }) },
        () => semanticDiff('HEAD', WORKTREE_REF),
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
        const r = installHook(hookPath);
        const verb = r.created ? 'created' : r.refreshed ? 'refreshed' : 'appended to existing hook';
        process.stdout.write(
          `HOOK  auto-seal ${verb}\n  ${hookPath}\n  every git commit now seals --ref HEAD into the fabric (never blocks the commit).\n`,
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
  .description("The Warpline fabric — this project's native meaning-history (the picks sealed into the WARP). Newest first.")
  .option('--max <n>', 'max strands to show', '20')
  .option('--json', 'emit the full fabric as JSON')
  .action(async (options: { max?: string; json?: boolean }) => {
    try {
      const max = Number(options.max);
      if (!Number.isInteger(max) || max < 1) {
        process.stderr.write(`warpline: --max must be a positive integer (got "${options.max}")\n`);
        process.exit(1);
      }
      const root = await resolveRoot();
      const wdir = warplineDirOf(root);
      const fabric = readFabric(wdir);
      const selvage = readSelvage(wdir);
      if (options.json) {
        process.stdout.write(JSON.stringify({ selvage, strands: fabric }, null, 2) + '\n');
      } else {
        printFabric(fabric, selvage, max);
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
  .description('NATIVE-FIRST (phase 0): mint the agent\'s scratch ref at the current selvage pickId (base is a pickId, forever — I9). With --into, restore the base tree into the agent\'s fresh worktree (git absent).')
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
  .description("Register a pre-declared CLAIM (claim:v1, forge-spec §3b) — the agent's belief about what its change touches, declared BEFORE admission. Persists to .warpline/claims/ and prints the claimId; pass it to `admit --claim` so the verdict is judged against the claim (honesty check + calibration probe). The claim is recorded, never used to scope computation.")
  .requiredOption('--agent <id>', 'the declaring agent (the calibration probe is per-agent)')
  .requiredOption('--claim <json>', 'the claim body: a path to a .json file, or inline JSON — {claimedSymbols: string[], intent: string, taskRef?, claimedContractDelta?, confidence?}')
  .option('--native', 'NATIVE-FIRST (phase 0): ALSO seal a v3 SCRATCH strand from the worktree — snapshot (native walk) → absorb from the store → bind-on-seal; advances only the agent\'s scratch ref, git absent')
  .option('--worktree <dir>', 'the worktree to seal from (--native; default: the repo root)')
  .option('-m, --intent <message>', 'the proposal intent (--native; default: the claim\'s intent text)')
  .option('--as <actor>', 'actor identity (--native; default: the agent id)')
  .option('--json', 'emit the result as JSON')
  .action(async (options: { agent: string; claim: string; native?: boolean; worktree?: string; intent?: string; as?: string; json?: boolean }) => {
    try {
      const root = await resolveRoot();
      const raw = options.claim.trimStart().startsWith('{')
        ? options.claim
        : await fs.readFile(path.resolve(options.claim), 'utf8');
      const body = JSON.parse(raw) as Omit<CreateClaimInput, 'agentId'>;
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
              intent: options.intent ?? body.intent,
              actor: options.as,
              claim: body,
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
          const c = createClaim({ ...body, agentId: options.agent });
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
  .description("Run the multi-writer ADMISSION protocol for an agent's scratch: re-base against the live selvage and return the verdict — FAST_ADMIT / CLEAN (+confidence) / KNOT / DANGLE / CLAIM-BREACH (when judged against a --claim) / HELD (an independent-CLEAN into a low-survival symbol, per the grades sidecar). v1 reports the decision; merged-tree materialization is v2.")
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
  .option('--ours <ref>', 'the original conflicting ref, to record the precise contended set')
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
        await gateHumanClass({ root, cliPath: 'resolve', verb: 'resolve', target: resolveTarget });
        if (options.native) {
          const result = await traceCli(
            { root, verb: 'resolve', target: resolveTarget, principal: agentId },
            () =>
              resolveNative(root, {
                worktree: options.worktree ? path.resolve(options.worktree) : root,
                agentId,
                reason: options.reason,
                decidedBy: options.by,
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
  .description('Mint a bearer token for a principal. kind:agent principals CANNOT resolve knots, cut/recover stakes, or accept-breach/accept-risk (human-class-only overrides). --scope read caps the token at the read-only verbs (status, refs.list, knot.show, grade.report, shadow.tail) — the CONSOLE class: `warpline daemon token mint console --kind human --scope read` is what the platform Warpline section auto-discovers. --mcp additionally writes the bare token to .warpline/daemon/mcp.token (0600) — the MCP skin\'s only file source; agent-kind only. The token prints ONCE — hand it to the agent worktree via env, never commit it. Note: no revocation ceremony exists at stage 1 — rotating means minting anew; old rows stay valid.')
  .requiredOption('--kind <kind>', "principal class: 'human' or 'agent'")
  .option('--scope <scope>', "'read' = read-only verb ceiling (console class); omit for the full surface")
  .option('--mcp', 'also write the token to .warpline/daemon/mcp.token (0600) for the MCP skin — requires --kind agent')
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
      const mcpPath = options.mcp ? writeMcpTokenFile(root, row.token) : null;
      if (options.json) {
        process.stdout.write(JSON.stringify({ ...row, ...(mcpPath ? { mcpTokenFile: mcpPath } : {}) }, null, 2) + '\n');
      } else {
        process.stdout.write(
          `TOKEN MINTED  ${row.principal}  (kind:${row.kind}${row.scope ? `, scope:${row.scope}` : ''})\n` +
            `  token   ${row.token}\n` +
            (mcpPath ? `  mcp     written to ${mcpPath} (0600) — the MCP skin reads env WARPLINE_MCP_TOKEN, then this file\n` : '') +
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

function printAdmit(agentId: string, r: AdmitResult): void {
  const d = r.decision;
  const lines: string[] = [];
  lines.push(`ADMIT  ${agentId}  →  ${d.status}`);
  if (d.rebasedOnto) lines.push(`re-based onto selvage ${short(d.rebasedOnto)}`);
  if (d.status === 'CLEAN') {
    lines.push(`verdict   CLEAN to admit (concurrent edits commute in meaning — git may conflict on bytes)`);
    lines.push(`confidence ${d.confidence}${d.confidence === 'independent' ? '  (⚠ disjoint sets — autoClean may hide a cross-symbol semantic conflict; false-AUTOFOLD gate)' : '  (dependency-adjacent — trustworthy)'}`);
    if (r.sealed && r.strand) lines.push(`  → MERGED + sealed (${strandTag(r.strand)}); selvage advanced to ${short(r.strand.stateId)}`);
    else lines.push('  (not sealed — needs git refs to materialize; commit then admit)');
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
  process.stdout.write(lines.join('\n') + '\n');
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

function oneLine(s: string, max: number): string {
  const flat = s.replace(/\s+/g, ' ').trim();
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
    lines.push(`sealed by ${tip.seq === 0 ? '◆ genesis' : `seq ${tip.seq}`}  ${short(tip.pickId)}  ${tip.recordedAt.slice(0, 10)}  ${tip.actor}`);
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
  lines.push(`PICK  sealed into the fabric  ${r.isGenesis ? '◆ GENESIS' : `seq ${s.seq}`}`);
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

function printFabric(fabric: Strand[], selvage: string | null, max: number): void {
  const lines: string[] = [];
  lines.push('WARPLINE FABRIC  (this project\'s native meaning-history)');
  lines.push(`selvage   ${selvage ? short(selvage) : '(none — no picks sealed yet)'}`);
  lines.push('');
  if (fabric.length === 0) {
    lines.push('(empty — run `warpline pick -m "..."` to seal the first strand)');
    process.stdout.write(lines.join('\n') + '\n');
    return;
  }
  const shown = fabric.slice(-max).reverse();
  for (const s of shown) {
    const date = s.recordedAt.slice(0, 10);
    const tag = s.seq === 0 ? '◆ genesis' : `~ seq ${s.seq}`;
    lines.push(`${tag}  ${short(s.pickId)}  ${date}  ${s.actor}`);
    lines.push(`     intent:  ${s.intent}`);
    if (s.seq === 0) {
      lines.push(`     objects: ${s.objectCount}`);
    } else {
      lines.push(
        `     delta:   +${s.delta.born.length} born  ~${s.delta.contractChanged.length} changed  -${s.delta.retired.length} retired  ↻${s.delta.renamedNoop} renamed-noop`,
      );
    }
    if (s.provenance?.gitCommit) lines.push(`     git:     ${s.provenance.gitCommit.slice(0, 12)}`);
    if (s.calibratedConfidence != null) lines.push(`     confidence: ${s.calibratedConfidence}`);
  }
  if (fabric.length > shown.length) {
    lines.push('');
    lines.push(`(${fabric.length - shown.length} older strand(s) — raise --max)`);
  }
  process.stdout.write(lines.join('\n') + '\n');
}

function printStatus(r: SemDiffReport): void {
  const lines: string[] = [];
  lines.push('WARPLINE STATUS  (working tree vs HEAD, by MEANING)');
  lines.push('');
  if (r.changedCount === 0 && r.renamedNoopCount === 0) {
    lines.push('clean — no semantic change (HEAD and the working tree agree in meaning)');
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
    lines.push(`summary  ${r.changedCount} changed, ${r.renamedNoopCount} renamed-noop`);
  }
  process.stdout.write(lines.join('\n') + '\n');
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

function printForecast(f: Forecast): void {
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

function printSemDiff(r: SemDiffReport): void {
  const lines: string[] = [];
  lines.push(`SEMANTIC DIFF  ${r.refA}  ⟶  ${r.refB}`);
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
  lines.push(`summary  ${r.changedCount} changed, ${r.renamedNoopCount} renamed-noop`);
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
  process.stderr.write(`warpline: ${msg}\n`);
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

program.parseAsync(userArgv, { from: 'user' }).catch((err) => fail(err));

// referenced so WORKTREE_REF is part of the public CLI vocabulary surface
void WORKTREE_REF;
