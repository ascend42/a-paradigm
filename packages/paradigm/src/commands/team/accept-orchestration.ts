/**
 * paradigm team accept - Accept orchestration changes
 *
 * Usage:
 *   paradigm team accept <orchestration-id>
 *   paradigm team accept <orchestration-id> --note "Looks good"
 */

import * as path from 'path';
import chalk from 'chalk';
import { BackgroundOrchestrator } from '../../core/background-orchestrator.js';

// ============================================================================
// Types
// ============================================================================

export interface AcceptOrchestrationOptions {
  json?: boolean;
  /** Note for acceptance */
  note?: string;
}

// ============================================================================
// Command
// ============================================================================

export async function teamAcceptOrchestrationCommand(
  orchestrationId: string | undefined,
  targetPath: string | undefined,
  options: AcceptOrchestrationOptions
): Promise<void> {
  const rootDir = targetPath ? path.resolve(targetPath) : process.cwd();

  if (!orchestrationId) {
    if (options.json) {
      console.log(JSON.stringify({ error: 'Orchestration ID required' }));
    } else {
      console.log(chalk.red('\nOrchestration ID required.'));
      console.log(chalk.gray('Usage: paradigm team accept <orchestration-id>\n'));
    }
    return;
  }

  const bgOrchestrator = new BackgroundOrchestrator(rootDir);
  const orch = bgOrchestrator.getOrchestration(orchestrationId);

  if (!orch) {
    if (options.json) {
      console.log(JSON.stringify({ error: 'Orchestration not found', id: orchestrationId }));
    } else {
      console.log(chalk.red(`\nOrchestration not found: ${orchestrationId}\n`));
    }
    return;
  }

  if (orch.status !== 'completed') {
    if (options.json) {
      console.log(JSON.stringify({
        error: 'Cannot accept orchestration',
        reason: `Status is '${orch.status}', expected 'completed'`,
      }));
    } else {
      console.log(chalk.red(`\nCannot accept orchestration in '${orch.status}' status.`));
      console.log(chalk.gray('Only completed orchestrations can be accepted.\n'));
    }
    return;
  }

  try {
    await bgOrchestrator.accept(orchestrationId, { note: options.note });

    if (options.json) {
      console.log(JSON.stringify({
        success: true,
        id: orchestrationId,
        status: 'accepted',
        artifacts: orch.artifacts.length,
      }));
      return;
    }

    console.log();
    console.log(chalk.green('━'.repeat(60)));
    console.log(chalk.green(`  ✓ Orchestration Accepted`));
    console.log(chalk.green('━'.repeat(60)));
    console.log();
    console.log(chalk.white(`  ID: ${orchestrationId}`));
    console.log(chalk.gray(`  Task: ${orch.task.slice(0, 50)}${orch.task.length > 50 ? '...' : ''}`));
    if (options.note) {
      console.log(chalk.gray(`  Note: ${options.note}`));
    }
    console.log();

    if (orch.artifacts.length > 0) {
      console.log(chalk.cyan('  Artifacts accepted:'));
      for (const artifact of orch.artifacts) {
        const icon = artifact.action === 'created' ? chalk.green('+') :
                     artifact.action === 'modified' ? chalk.yellow('~') :
                     chalk.red('-');
        console.log(`    ${icon} ${artifact.path}`);
      }
      console.log();
    }

    if (orch.parallelBuilderStats) {
      console.log(chalk.cyan('  Parallel builder stats:'));
      console.log(chalk.gray(`    Sub-phases: ${orch.parallelBuilderStats.totalSubPhases}`));
      console.log(chalk.gray(`    Parallel builders: ${orch.parallelBuilderStats.totalParallelBuilders}`));
      console.log(chalk.gray(`    Files created: ${orch.parallelBuilderStats.filesCreated}`));
      console.log();
    }
  } catch (error) {
    if (options.json) {
      console.log(JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }));
    } else {
      console.log(chalk.red(`\nError: ${error instanceof Error ? error.message : error}\n`));
    }
  }
}

// ============================================================================
// Reject Command
// ============================================================================

export interface RejectOrchestrationOptions {
  json?: boolean;
  /** Reason for rejection */
  reason?: string;
  /** Cleanup created files */
  cleanup?: boolean;
}

export async function teamRejectOrchestrationCommand(
  orchestrationId: string | undefined,
  targetPath: string | undefined,
  options: RejectOrchestrationOptions
): Promise<void> {
  const rootDir = targetPath ? path.resolve(targetPath) : process.cwd();

  if (!orchestrationId) {
    if (options.json) {
      console.log(JSON.stringify({ error: 'Orchestration ID required' }));
    } else {
      console.log(chalk.red('\nOrchestration ID required.'));
      console.log(chalk.gray('Usage: paradigm team reject <orchestration-id>\n'));
    }
    return;
  }

  const bgOrchestrator = new BackgroundOrchestrator(rootDir);
  const orch = bgOrchestrator.getOrchestration(orchestrationId);

  if (!orch) {
    if (options.json) {
      console.log(JSON.stringify({ error: 'Orchestration not found', id: orchestrationId }));
    } else {
      console.log(chalk.red(`\nOrchestration not found: ${orchestrationId}\n`));
    }
    return;
  }

  if (orch.status !== 'completed') {
    if (options.json) {
      console.log(JSON.stringify({
        error: 'Cannot reject orchestration',
        reason: `Status is '${orch.status}', expected 'completed'`,
      }));
    } else {
      console.log(chalk.red(`\nCannot reject orchestration in '${orch.status}' status.`));
      console.log(chalk.gray('Only completed orchestrations can be rejected.\n'));
    }
    return;
  }

  try {
    await bgOrchestrator.reject(orchestrationId, {
      reason: options.reason,
      cleanup: options.cleanup,
    });

    if (options.json) {
      console.log(JSON.stringify({
        success: true,
        id: orchestrationId,
        status: 'rejected',
        cleanup: options.cleanup || false,
      }));
      return;
    }

    console.log();
    console.log(chalk.red('━'.repeat(60)));
    console.log(chalk.red(`  ✗ Orchestration Rejected`));
    console.log(chalk.red('━'.repeat(60)));
    console.log();
    console.log(chalk.white(`  ID: ${orchestrationId}`));
    console.log(chalk.gray(`  Task: ${orch.task.slice(0, 50)}${orch.task.length > 50 ? '...' : ''}`));
    if (options.reason) {
      console.log(chalk.gray(`  Reason: ${options.reason}`));
    }
    console.log();

    if (options.cleanup && orch.artifacts.length > 0) {
      console.log(chalk.yellow('  Files cleaned up:'));
      const created = orch.artifacts.filter(a => a.action === 'created');
      for (const artifact of created) {
        console.log(chalk.gray(`    - ${artifact.path}`));
      }
      console.log();
    }
  } catch (error) {
    if (options.json) {
      console.log(JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }));
    } else {
      console.log(chalk.red(`\nError: ${error instanceof Error ? error.message : error}\n`));
    }
  }
}
