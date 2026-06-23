#!/usr/bin/env node
/**
 * #loom-cli — the Loom command line. Thin output; no blockquotes.
 *
 *   loom oracle <branchA> <branchB> [--json]   run the Convergence/Divergence Oracle
 *   loom absorb <ref> [--json]                 lift a ref to a WarpState and dump it
 *
 * This is the ONLY file allowed to write to stdout — library code stays quiet.
 */

import { Command } from 'commander';
import { absorb, WORKTREE_REF } from './absorb.js';
import { oracle, type OracleRecord } from './oracle.js';
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
