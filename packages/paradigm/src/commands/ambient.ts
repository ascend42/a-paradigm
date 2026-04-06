/**
 * paradigm ambient — Ambient coordination commands
 *
 * Commands:
 *   paradigm ambient postflight  — Run postflight learning pass (verdicts → journals → notebooks)
 */

import * as path from 'path';
import chalk from 'chalk';

export async function ambientPostflightCommand(options: {
  dryRun?: boolean;
  project?: string;
}): Promise<void> {
  const rootDir = options.project
    ? path.resolve(options.project)
    : process.cwd();

  const dryRun = options.dryRun === true;

  // Check for pending verdicts before running heavy postflight logic
  const { readPendingVerdicts } = await import('../../../paradigm-mcp/src/utils/session-work-log.js');
  const pending = readPendingVerdicts(rootDir);

  if (pending.length === 0) {
    console.log(chalk.dim('[paradigm] No pending verdicts — postflight skipped.'));
    return;
  }

  console.log(chalk.cyan(`[paradigm] Running postflight — ${pending.length} pending verdict(s)${dryRun ? ' (dry run)' : ''}...`));

  const { runPostflightLearning } = await import('../../../paradigm-mcp/src/tools/ambient.js');
  const result = await runPostflightLearning(rootDir, { dry_run: dryRun });

  if (result.journalsWritten === 0 && result.promoted === 0) {
    console.log(chalk.dim('[paradigm] Postflight complete — no new journals written.'));
    return;
  }

  console.log(chalk.green('[paradigm] Postflight complete:'));
  if (result.journalsWritten > 0) {
    console.log(`  ${chalk.bold(result.journalsWritten)} journal entries written across ${result.agentsProcessed.length} agent(s)`);
  }
  if (result.promoted > 0) {
    console.log(`  ${chalk.bold(result.promoted)} entries auto-promoted to notebooks`);
  }
}
