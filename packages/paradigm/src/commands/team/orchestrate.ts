/**
 * paradigm team orchestrate - Orchestrate a multi-agent task
 *
 * Usage:
 *   paradigm team orchestrate "Build @payment-system with Stripe"
 *   paradigm team orchestrate "..." --solo       # Single Claude mode (for comparison)
 *   paradigm team orchestrate "..." --faceted    # Multi-agent mode (default)
 *   paradigm team orchestrate "..." --compare    # Run both and compare
 *   paradigm team orchestrate "..." --background # Run in background
 */

import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import {
  AgentModel,
  formatCost,
  formatTokens,
} from '../../core/agent-provider.js';
import {
  Orchestrator,
  OrchestrationMode,
  OrchestrationResult,
} from '../../core/orchestrator.js';
import {
  BackgroundOrchestrator,
  BackgroundOrchestration,
} from '../../core/background-orchestrator.js';
import { loadAgentsManifest } from './loader.js';

// ============================================================================
// Types
// ============================================================================

export interface OrchestrateCommandOptions {
  solo?: boolean;
  faceted?: boolean;
  compare?: boolean;
  model?: AgentModel;
  provider?: string;
  json?: boolean;
  quiet?: boolean;
  budget?: string;
  checkpoint?: boolean;
  live?: boolean;
  /** Run in background mode */
  background?: boolean;
  /** Notification methods for background mode */
  notify?: string;
  /** Enable PM governance */
  pm?: boolean;
}

// ============================================================================
// Command
// ============================================================================

export async function teamOrchestrateCommand(
  task: string,
  targetPath: string | undefined,
  options: OrchestrateCommandOptions
): Promise<void> {
  const rootDir = targetPath ? path.resolve(targetPath) : process.cwd();

  // Validate task
  if (!task) {
    if (options.json) {
      console.log(JSON.stringify({ error: 'Task is required' }));
    } else {
      console.log(chalk.red('\nTask is required.'));
      console.log(chalk.gray('Example: paradigm team orchestrate "Build @payment-system with Stripe"\n'));
    }
    return;
  }

  // Check team configuration
  const manifest = loadAgentsManifest(rootDir);
  if (!manifest) {
    if (options.json) {
      console.log(JSON.stringify({ error: 'Team not configured' }));
    } else {
      console.log(chalk.yellow('\nTeam not configured. Run `paradigm team init` first.\n'));
    }
    return;
  }

  // Determine mode
  let mode: OrchestrationMode = 'faceted';
  if (options.solo) mode = 'solo';
  if (options.faceted) mode = 'faceted';

  // Parse budget
  let budget: { maxTokens?: number; maxCostUsd?: number; warnAtPercent?: number } | undefined;
  if (options.budget) {
    const parts = options.budget.split(',');
    budget = {};
    for (const part of parts) {
      const [key, value] = part.split('=');
      if (key === 'tokens') budget.maxTokens = parseInt(value);
      if (key === 'cost') budget.maxCostUsd = parseFloat(value);
      if (key === 'warn') budget.warnAtPercent = parseInt(value);
    }
  }

  // Initialize orchestrator
  const spinner = ora({
    text: 'Initializing orchestrator...',
    isSilent: options.quiet || options.json,
  }).start();

  const orchestrator = new Orchestrator(rootDir);

  try {
    await orchestrator.initialize();
  } catch (error) {
    spinner.fail('Failed to initialize orchestrator');
    if (options.json) {
      console.log(JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }));
    } else {
      console.log(chalk.red(`\nError: ${error instanceof Error ? error.message : error}\n`));
    }
    return;
  }

  // Background mode
  if (options.background) {
    spinner.text = 'Starting background orchestration...';

    const bgOrchestrator = new BackgroundOrchestrator(rootDir);
    const notifyMethods: Array<'bell' | 'desktop' | 'file' | 'webhook'> = options.notify
      ? options.notify.split(',').filter((m): m is 'bell' | 'desktop' | 'file' | 'webhook' =>
          ['bell', 'desktop', 'file', 'webhook'].includes(m))
      : ['bell'];

    const bgOrch = await bgOrchestrator.startBackground(task, {
      mode,
      orchestratorModel: options.model,
      budget,
      notify: true,
      notifyMethods,
    });

    spinner.stop();

    if (options.json) {
      console.log(JSON.stringify({
        id: bgOrch.id,
        status: bgOrch.status,
        outputFile: bgOrch.outputFile,
        task: bgOrch.task,
      }, null, 2));
      return;
    }

    displayBackgroundStarted(bgOrch);
    return;
  }

  // Compare mode
  if (options.compare) {
    spinner.text = 'Running comparison (solo vs faceted)...';

    const comparison = await orchestrator.compare(task, {
      orchestratorModel: options.model,
      budget,
      checkpoints: options.checkpoint ? {
        beforeAgentSpawn: true,
        afterAgentComplete: true,
      } : undefined,
      onAgentStart: (agent, subtask, model) => {
        if (!options.quiet && !options.json) {
          const agentLabel = `${agent} (${model})`;
          spinner.text = `${agentLabel}: ${subtask.slice(0, 50)}...`;
        }
      },
    });

    spinner.stop();

    if (options.json) {
      console.log(JSON.stringify(comparison, null, 2));
      return;
    }

    // Display comparison results
    displayComparison(comparison);
    return;
  }

  // Single mode execution
  if (!options.quiet && !options.json) {
    const modeLabel = mode === 'solo' ? 'Solo' : 'Faceted';
    spinner.text = `Orchestrating (${modeLabel} mode)...`;
  }

  // Callbacks for live output
  const result = await orchestrator.orchestrate(task, {
    mode,
    orchestratorModel: options.model,
    budget,
    checkpoints: options.checkpoint ? {
      beforeAgentSpawn: true,
    } : undefined,
    pmGovernance: options.pm ? {
      enabled: true,
      blockOnViolations: true,
    } : undefined,
    onMessage: (source, message) => {
      if (options.json || options.quiet) return;

      if (options.live && message.type === 'text') {
        // Live streaming mode
        process.stdout.write(chalk.gray(`[${source}] `) + message.content);
      }
    },
    onAgentStart: (agent, subtask, model) => {
      if (options.json || options.quiet) return;

      const agentLabel = `${agent} (${model})`;
      if (options.live) {
        console.log(chalk.cyan(`\n▶ ${agentLabel}: ${subtask}`));
      } else {
        spinner.text = `${agentLabel}: ${subtask.slice(0, 50)}...`;
      }
    },
    onAgentComplete: (agent, agentResult, model) => {
      if (options.json || options.quiet) return;

      if (options.live) {
        const status = agentResult.success ? chalk.green('✓') : chalk.red('✗');
        const tokens = agentResult.relay ? formatTokens(agentResult.relay.metrics.tokens_used.total) : '0';
        const agentLabel = `${agent} (${model})`;
        console.log(`${status} ${agentLabel} completed (${tokens})`);
      }
    },
    onCheckpoint: async (description) => {
      if (!options.checkpoint) return true;

      spinner.stop();
      console.log(chalk.yellow(`\n⚠ Checkpoint: ${description}`));
      console.log(chalk.gray('Press Enter to continue, or Ctrl+C to abort...'));

      return new Promise((resolve) => {
        process.stdin.once('data', () => {
          spinner.start();
          resolve(true);
        });
      });
    },
  });

  spinner.stop();

  // Output results
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  displayResult(result);
}

// ============================================================================
// Display Functions
// ============================================================================

function displayResult(result: OrchestrationResult): void {
  console.log();
  console.log(chalk.blue('━'.repeat(60)));
  console.log(chalk.blue(`  Orchestration ${result.success ? 'Complete' : 'Failed'}`));
  console.log(chalk.blue('━'.repeat(60)));
  console.log();

  // Summary
  console.log(chalk.white(`  Task: ${result.task.slice(0, 50)}${result.task.length > 50 ? '...' : ''}`));
  console.log(chalk.gray(`  Mode: ${result.mode}`));
  console.log(chalk.gray(`  ID: ${result.orchestrationId}`));
  console.log();

  // Status
  if (result.success) {
    console.log(chalk.green('  ✓ Success'));
  } else {
    console.log(chalk.red(`  ✗ Failed: ${result.error || 'Unknown error'}`));
  }
  console.log();

  // Metrics
  console.log(chalk.cyan('  Metrics:'));
  console.log(chalk.gray(`    Agents spawned: ${result.agentsSpawned}`));
  console.log(chalk.gray(`    Total tokens: ${formatTokens(result.totalTokens.total)}`));
  console.log(chalk.gray(`    Total cost: ${formatCost(result.totalCost)}`));
  console.log(chalk.gray(`    Duration: ${(result.duration_ms / 1000).toFixed(1)}s`));
  console.log();

  // Agent results
  if (result.agentResults.length > 0) {
    console.log(chalk.cyan('  Agents:'));
    for (const agentResult of result.agentResults) {
      const status = agentResult.success ? chalk.green('✓') : chalk.red('✗');
      const tokens = agentResult.relay ? formatTokens(agentResult.relay.metrics.tokens_used.total) : '0';
      const duration = agentResult.relay ? `${(agentResult.relay.metrics.duration_ms / 1000).toFixed(1)}s` : '0s';
      console.log(chalk.gray(`    ${status} ${agentResult.relay?.agent || 'unknown'}: ${tokens} (${duration})`));
    }
    console.log();
  }

  // PM Compliance Report
  if (result.complianceReport) {
    console.log(chalk.cyan('  PM Compliance:'));
    const postflight = result.complianceReport.postflight;
    if (postflight) {
      const statusIcon = postflight.status === 'pass' ? chalk.green('✓') :
        postflight.status === 'warnings' ? chalk.yellow('⚠') : chalk.red('✗');
      console.log(chalk.gray(`    Status: ${statusIcon} ${postflight.status}`));
      console.log(chalk.gray(`    Checks: ${postflight.summary.passed}/${postflight.summary.totalChecks} passed`));
      if (postflight.summary.errors > 0) {
        console.log(chalk.red(`    Errors: ${postflight.summary.errors}`));
      }
      if (postflight.summary.warnings > 0) {
        console.log(chalk.yellow(`    Warnings: ${postflight.summary.warnings}`));
      }
      if (postflight.violations.length > 0) {
        for (const v of postflight.violations.slice(0, 5)) {
          const icon = v.severity === 'error' ? chalk.red('✗') : chalk.yellow('⚠');
          console.log(chalk.gray(`    ${icon} ${v.message}`));
        }
      }
    }
    console.log();
  }

  // Log location
  if (result.log) {
    console.log(chalk.gray(`  Log: .paradigm/orchestrations/${result.log.started.slice(0, 10)}-*.yaml`));
  }
  console.log();
}

function displayComparison(comparison: {
  solo: OrchestrationResult;
  faceted: OrchestrationResult;
  comparison: {
    winner: 'solo' | 'faceted' | 'tie';
    tokensSaved: number;
    costDiff: number;
    timeDiff: number;
    soloSucceeded: boolean;
    facetedSucceeded: boolean;
  };
}): void {
  console.log();
  console.log(chalk.blue('━'.repeat(60)));
  console.log(chalk.blue('  A/B Comparison: Solo vs Faceted'));
  console.log(chalk.blue('━'.repeat(60)));
  console.log();

  // Results table
  console.log(chalk.cyan('  Results:'));
  console.log(chalk.gray('  ┌─────────────┬──────────────┬──────────────┐'));
  console.log(chalk.gray('  │             │    Solo      │   Faceted    │'));
  console.log(chalk.gray('  ├─────────────┼──────────────┼──────────────┤'));

  // Success
  const soloStatus = comparison.solo.success ? chalk.green('✓ Success') : chalk.red('✗ Failed');
  const facetedStatus = comparison.faceted.success ? chalk.green('✓ Success') : chalk.red('✗ Failed');
  console.log(chalk.gray(`  │ Status      │ ${soloStatus.padEnd(21)} │ ${facetedStatus.padEnd(21)} │`));

  // Tokens
  const soloTokens = formatTokens(comparison.solo.totalTokens.total).padStart(10);
  const facetedTokens = formatTokens(comparison.faceted.totalTokens.total).padStart(10);
  console.log(chalk.gray(`  │ Tokens      │ ${soloTokens}   │ ${facetedTokens}   │`));

  // Cost
  const soloCost = formatCost(comparison.solo.totalCost).padStart(10);
  const facetedCost = formatCost(comparison.faceted.totalCost).padStart(10);
  console.log(chalk.gray(`  │ Cost        │ ${soloCost}   │ ${facetedCost}   │`));

  // Duration
  const soloTime = `${(comparison.solo.duration_ms / 1000).toFixed(1)}s`.padStart(10);
  const facetedTime = `${(comparison.faceted.duration_ms / 1000).toFixed(1)}s`.padStart(10);
  console.log(chalk.gray(`  │ Duration    │ ${soloTime}   │ ${facetedTime}   │`));

  // Agents
  const soloAgents = `${comparison.solo.agentsSpawned}`.padStart(10);
  const facetedAgents = `${comparison.faceted.agentsSpawned}`.padStart(10);
  console.log(chalk.gray(`  │ Agents      │ ${soloAgents}   │ ${facetedAgents}   │`));

  console.log(chalk.gray('  └─────────────┴──────────────┴──────────────┘'));
  console.log();

  // Winner
  const { winner, tokensSaved, costDiff } = comparison.comparison;

  if (winner === 'tie') {
    console.log(chalk.yellow('  ⚖ Result: Tie'));
  } else if (winner === 'faceted') {
    console.log(chalk.green('  🏆 Winner: Faceted'));
    if (costDiff > 0) {
      console.log(chalk.gray(`     Saved ${formatCost(costDiff)} (${formatTokens(Math.abs(tokensSaved))} tokens)`));
    }
  } else {
    console.log(chalk.green('  🏆 Winner: Solo'));
    if (costDiff < 0) {
      console.log(chalk.gray(`     Saved ${formatCost(Math.abs(costDiff))} (${formatTokens(Math.abs(tokensSaved))} tokens)`));
    }
  }

  console.log();

  // Recommendations
  console.log(chalk.cyan('  Recommendation:'));
  if (winner === 'faceted') {
    console.log(chalk.gray('    Use --faceted (default) for this type of task.'));
    console.log(chalk.gray('    Multi-agent orchestration is more cost-effective.'));
  } else if (winner === 'solo') {
    console.log(chalk.gray('    Use --solo for this type of task.'));
    console.log(chalk.gray('    Single agent is simpler and cheaper here.'));
  } else {
    console.log(chalk.gray('    Both approaches work similarly for this task.'));
    console.log(chalk.gray('    Default to --faceted for complex tasks, --solo for simple ones.'));
  }

  console.log();
}

function displayBackgroundStarted(orch: BackgroundOrchestration): void {
  console.log();
  console.log(chalk.blue('━'.repeat(60)));
  console.log(chalk.blue('  Orchestration started in background'));
  console.log(chalk.blue('━'.repeat(60)));
  console.log();
  console.log(chalk.white(`  ID: ${orch.id}`));
  console.log(chalk.gray(`  Task: ${orch.task.slice(0, 50)}${orch.task.length > 50 ? '...' : ''}`));
  console.log(chalk.gray(`  Mode: ${orch.mode}`));
  console.log(chalk.gray(`  Status: ${orch.status}`));
  console.log();
  console.log(chalk.cyan('  Commands:'));
  console.log(chalk.gray(`    Monitor:  paradigm team status ${orch.id}`));
  console.log(chalk.gray(`    Logs:     tail -f ${orch.outputFile}`));
  console.log(chalk.gray(`    Diff:     paradigm team diff ${orch.id}`));
  console.log(chalk.gray(`    Accept:   paradigm team accept ${orch.id}`));
  console.log();
}
