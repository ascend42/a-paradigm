#!/usr/bin/env node
/**
 * #loom-cli — the Loom command line. Thin output; no blockquotes.
 *
 *   loom oracle <branchA> <branchB> [--json]   run the Convergence/Divergence Oracle
 *   loom absorb <ref> [--json]                 lift a ref to a WarpState and dump it
 *   loom weave --preview <A> <B> [--json]      THE PRE-MERGE FORECAST (meaning)
 *   loom diff [refA] [refB] [--json]           SEMANTIC diff between two refs
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
import type { ContractChangeset } from './sem-delta.js';
import { changedSlotsOf } from './sem-delta.js';
import { serializeState } from './warp/store.js';
import type { WarpState } from './warp/warp-state.js';

const program = new Command();

program
  .name('loom')
  .description('The Loom Engine — the Convergence/Divergence Oracle (read-only).')
  .version('0.1.0');

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
              'Use `loom weave --preview <A> <B>` to forecast the merge from meaning.\n',
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

function printForecast(f: Forecast): void {
  const lines: string[] = [];
  lines.push(`WEAVE FORECAST  ${f.branchA}  ⟶  ${f.branchB}`);
  lines.push(`mergeBase ${f.mergeBase}`);
  lines.push(`states    base=${short(f.stateIds.base)}  A=${short(f.stateIds.A)}  B=${short(f.stateIds.B)}`);
  lines.push('');
  // The verdict line — the founder's killer line.
  if (f.verdict === 'CLEAN') {
    lines.push('VERDICT  CLEAN TO WEAVE  (no knots, no dangling references)');
  } else {
    const n = f.decisions;
    lines.push(`VERDICT  ${n} decision${n === 1 ? '' : 's'} needed  (${f.knots.length} knot(s), ${f.dangling.length} dangling)`);
  }
  lines.push('');
  lines.push(`autoClean  ${f.autoClean.length}`);

  lines.push(`knots      ${f.knots.length}`);
  for (const k of f.knots) {
    lines.push(`  ⊗ ${k.symbol}`);
    if (k.conflictingSlots.length) {
      lines.push(`      conflicting slot(s): ${k.conflictingSlots.join(', ')}`);
    }
    lines.push(`      A → ${k.essenceA ?? '(retired)'}`);
    lines.push(`      B → ${k.essenceB ?? '(retired)'}`);
  }

  lines.push(`dangling   ${f.dangling.length}`);
  for (const d of f.dangling) {
    lines.push(`  ⤬ ${d.fromSymbol} --${d.edgeKind}--> ${d.danglingTargetSymbol}  (retired by ${d.retiredBy})`);
  }

  if (f.vsGit) {
    const g = f.vsGit;
    lines.push('');
    lines.push(`vs GIT REALITY: ${g.gitConflicted ? 'CONFLICT' : 'clean'}  (${g.conflictSymbols.length} symbol(s))`);
    lines.push(`  divergeGitOnly  ★   ${g.divergeGitOnly.length}${g.divergeGitOnly.length ? '  ' + g.divergeGitOnly.join(', ') : ''}`);
    lines.push(`  divergeMeaningOnly ★ ${g.divergeMeaningOnly.length}${g.divergeMeaningOnly.length ? '  ' + g.divergeMeaningOnly.join(', ') : ''}`);
    lines.push(`  score               ${g.score}`);
    lines.push(`  VERDICT             ${g.verdict}`);
  }

  lines.push('');
  lines.push('(preview is ephemeral — no oracle.jsonl row written)');
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

  lines.push(`contract-changed ${r.contractChanged.length}`);
  for (const d of r.contractChanged) {
    const slots = d.changedSlots ?? (d.changeset ? changedSlotsOf(d.changeset) : []);
    lines.push(`  ~ ${d.symbol}  [${slots.join(', ') || 'essence'}]`);
    if (d.changeset) appendSlotDetail(lines, d.changeset);
  }

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
  lines.push('PREDICTION (from meaning):');
  lines.push(`  autoClean ${record.prediction.autoClean.length}`);
  lines.push(`  knots     ${record.prediction.knots.length}${record.prediction.knots.length ? '  ' + record.prediction.knots.map((k) => k.symbol).join(', ') : ''}`);
  lines.push(`  dangling  ${record.prediction.dangling.length}${record.prediction.dangling.length ? '  ' + record.prediction.dangling.map((d) => `${d.fromSymbol}→${d.danglingTargetSymbol}`).join(', ') : ''}`);
  lines.push('');
  lines.push(`GIT REALITY: ${record.gitReality.conflicted ? 'CONFLICT' : 'clean'}  (${record.gitReality.conflictPaths.length} path(s), ${record.gitReality.conflictSymbols.length} symbol(s))`);
  if (record.gitReality.conflictPaths.length) {
    lines.push(`  paths: ${record.gitReality.conflictPaths.slice(0, 6).join(', ')}${record.gitReality.conflictPaths.length > 6 ? ' ...' : ''}`);
  }
  lines.push('');
  lines.push('CONVERGENCE (confusion matrix):');
  lines.push(`  agreeClean          ${c.agreeClean.length}`);
  lines.push(`  agreeConflict       ${c.agreeConflict.length}`);
  lines.push(`  divergeGitOnly  ★   ${c.divergeGitOnly.length}${c.divergeGitOnly.length ? '  ' + c.divergeGitOnly.join(', ') : ''}`);
  lines.push(`  divergeMeaningOnly ★ ${c.divergeMeaningOnly.length}${c.divergeMeaningOnly.length ? '  ' + c.divergeMeaningOnly.join(', ') : ''}`);
  lines.push(`  score               ${c.score}`);
  lines.push(`  VERDICT             ${c.verdict}`);
  lines.push('');
  lines.push('appended → .loom/oracle.jsonl');
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
  process.stderr.write(`loom: ${msg}\n`);
  process.exit(1);
}

program.parseAsync(process.argv).catch((err) => fail(err));

// referenced so WORKTREE_REF is part of the public CLI vocabulary surface
void WORKTREE_REF;
