/**
 * paradigm team diff - Show diff from completed orchestration
 *
 * Usage:
 *   paradigm team diff <orchestration-id>
 *   paradigm team diff <orchestration-id> --json
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { BackgroundOrchestrator } from '../../core/background-orchestrator.js';

// ============================================================================
// Types
// ============================================================================

export interface DiffCommandOptions {
  json?: boolean;
  /** Show full file contents */
  full?: boolean;
}

// ============================================================================
// Command
// ============================================================================

export async function teamDiffCommand(
  orchestrationId: string | undefined,
  targetPath: string | undefined,
  options: DiffCommandOptions
): Promise<void> {
  const rootDir = targetPath ? path.resolve(targetPath) : process.cwd();

  if (!orchestrationId) {
    if (options.json) {
      console.log(JSON.stringify({ error: 'Orchestration ID required' }));
    } else {
      console.log(chalk.red('\nOrchestration ID required.'));
      console.log(chalk.gray('Usage: paradigm team diff <orchestration-id>\n'));
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

  if (options.json) {
    console.log(JSON.stringify({
      id: orch.id,
      task: orch.task,
      status: orch.status,
      artifacts: orch.artifacts,
    }, null, 2));
    return;
  }

  // Display diff
  console.log();
  console.log(chalk.blue('━'.repeat(60)));
  console.log(chalk.blue(`  Diff: ${orch.id}`));
  console.log(chalk.blue('━'.repeat(60)));
  console.log();
  console.log(chalk.gray(`  Task: ${orch.task.slice(0, 50)}${orch.task.length > 50 ? '...' : ''}`));
  console.log(chalk.gray(`  Status: ${orch.status}`));
  console.log();

  if (orch.artifacts.length === 0) {
    console.log(chalk.gray('  No file changes in this orchestration.'));
    console.log();
    return;
  }

  console.log(chalk.cyan('  Files Changed:'));
  console.log();

  const created: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  for (const artifact of orch.artifacts) {
    if (artifact.action === 'created') {
      created.push(artifact.path);
    } else if (artifact.action === 'modified') {
      modified.push(artifact.path);
    } else if (artifact.action === 'deleted') {
      deleted.push(artifact.path);
    }
  }

  // Created files
  if (created.length > 0) {
    console.log(chalk.green('  Created:'));
    for (const filePath of created) {
      console.log(chalk.green(`    + ${filePath}`));
      if (options.full) {
        const fullPath = path.join(rootDir, filePath);
        if (fs.existsSync(fullPath)) {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const lines = content.split('\n').slice(0, 20);
          for (const line of lines) {
            console.log(chalk.gray(`      │ ${line}`));
          }
          if (content.split('\n').length > 20) {
            console.log(chalk.gray(`      │ ... (${content.split('\n').length - 20} more lines)`));
          }
        }
      }
    }
    console.log();
  }

  // Modified files
  if (modified.length > 0) {
    console.log(chalk.yellow('  Modified:'));
    for (const filePath of modified) {
      console.log(chalk.yellow(`    ~ ${filePath}`));
    }
    console.log();
  }

  // Deleted files
  if (deleted.length > 0) {
    console.log(chalk.red('  Deleted:'));
    for (const filePath of deleted) {
      console.log(chalk.red(`    - ${filePath}`));
    }
    console.log();
  }

  // Summary
  console.log(chalk.gray('─'.repeat(60)));
  console.log(chalk.gray(`  Summary: ${created.length} created, ${modified.length} modified, ${deleted.length} deleted`));
  console.log();

  // Actions
  if (orch.status === 'completed') {
    console.log(chalk.cyan('  Actions:'));
    console.log(chalk.gray(`    paradigm team accept ${orch.id}  # Accept these changes`));
    console.log(chalk.gray(`    paradigm team reject ${orch.id}  # Reject and cleanup`));
    console.log();
  }
}
