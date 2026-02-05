/**
 * paradigm team spawn - Spawn an individual AI agent
 *
 * Usage:
 *   paradigm team spawn <agent> --task "..."
 *   paradigm team spawn architect --model opus --task "Design the API"
 */

import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import {
  AgentModel,
  AgentMessage,
  formatTokens,
} from '../../core/agent-provider.js';
import { AgentSpawner } from '../../core/agent-spawner.js';
import { getBestProvider } from '../../core/provider-registry.js';
import { loadAgentsManifest } from './loader.js';

// ============================================================================
// Types
// ============================================================================

export interface SpawnCommandOptions {
  task: string;
  model?: AgentModel;
  provider?: string;
  json?: boolean;
  quiet?: boolean;
  budget?: string;
  timeout?: string;
  checkpoint?: boolean;
}

// ============================================================================
// Command
// ============================================================================

export async function teamSpawnCommand(
  agentName: string,
  targetPath: string | undefined,
  options: SpawnCommandOptions
): Promise<void> {
  const rootDir = targetPath ? path.resolve(targetPath) : process.cwd();

  // Validate task
  if (!options.task) {
    if (options.json) {
      console.log(JSON.stringify({ error: 'Task is required. Use --task "..."' }));
    } else {
      console.log(chalk.red('\nTask is required. Use --task "..."'));
      console.log(chalk.gray('Example: paradigm team spawn architect --task "Design the payment API"\n'));
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

  // Validate agent
  if (!manifest.agents[agentName]) {
    if (options.json) {
      console.log(JSON.stringify({
        error: `Unknown agent: ${agentName}`,
        available: Object.keys(manifest.agents),
      }));
    } else {
      console.log(chalk.red(`\nUnknown agent: ${agentName}`));
      console.log(chalk.gray(`Available agents: ${Object.keys(manifest.agents).join(', ')}\n`));
    }
    return;
  }

  // Parse budget
  let budget: { maxTokens?: number; maxCostUsd?: number } | undefined;
  if (options.budget) {
    const parts = options.budget.split(',');
    budget = {};
    for (const part of parts) {
      const [key, value] = part.split('=');
      if (key === 'tokens') budget.maxTokens = parseInt(value);
      if (key === 'cost') budget.maxCostUsd = parseFloat(value);
    }
  }

  // Initialize spawner
  const spinner = ora({
    text: `Initializing ${agentName} agent...`,
    isSilent: options.quiet || options.json,
  }).start();

  const spawner = new AgentSpawner(rootDir);

  try {
    await spawner.initialize();
  } catch (error) {
    spinner.fail('Failed to initialize spawner');
    if (options.json) {
      console.log(JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }));
    } else {
      console.log(chalk.red(`\nError: ${error instanceof Error ? error.message : error}\n`));
    }
    return;
  }

  // Get best available provider (respect explicit --provider flag)
  let bestProvider;
  try {
    bestProvider = await getBestProvider(rootDir, options.provider);
  } catch (error) {
    spinner.fail('No agent provider available');
    if (options.json) {
      console.log(JSON.stringify({ error: 'No agent provider available' }));
    } else {
      console.log(chalk.red('\nNo agent provider available.'));
      console.log(chalk.gray('Run `paradigm team providers` to see options.\n'));
    }
    return;
  }

  // Show provider info
  if (!options.quiet && !options.json) {
    spinner.text = `Using provider: ${bestProvider.name}`;
  }

  // Show agent info
  if (!options.quiet && !options.json) {
    spinner.text = `Spawning ${chalk.cyan(agentName)} (${options.model || 'default model'})...`;
  }

  // Stream output
  const messages: AgentMessage[] = [];
  let outputText = '';

  const onMessage = (message: AgentMessage): void => {
    messages.push(message);

    if (options.json) {
      // In JSON mode, collect for final output
      return;
    }

    if (options.quiet) {
      return;
    }

    // Stream text output
    if (message.type === 'text') {
      if (spinner.isSpinning) {
        spinner.stop();
      }
      process.stdout.write(message.content);
      outputText += message.content;
    } else if (message.type === 'tool_use') {
      if (!spinner.isSpinning) {
        spinner.start();
      }
      spinner.text = `${agentName}: ${message.content}`;
    } else if (message.type === 'tool_result') {
      // Show brief tool result
      const preview = typeof message.toolResult === 'string'
        ? message.toolResult.slice(0, 100)
        : JSON.stringify(message.toolResult).slice(0, 100);
      spinner.text = `${agentName}: Tool result (${preview}...)`;
    } else if (message.type === 'error') {
      spinner.fail(message.content);
    }
  };

  // Checkpoint handler
  const onCheckpoint = async (description: string): Promise<boolean> => {
    if (!options.checkpoint) return true;

    console.log(chalk.yellow(`\n⚠ Checkpoint: ${description}`));
    console.log(chalk.gray('Press Enter to continue, or Ctrl+C to abort...'));

    // Simple blocking wait for Enter
    return new Promise((resolve) => {
      process.stdin.once('data', () => resolve(true));
    });
  };

  // Spawn the agent
  const result = await spawner.spawn(agentName, options.task, {
    model: options.model,
    budget,
    timeout: options.timeout ? parseInt(options.timeout) : undefined,
    checkpoints: options.checkpoint ? { beforeActions: ['write', 'delete', 'execute'] } : undefined,
    onMessage,
    onCheckpoint,
  });

  // Ensure newline after streamed output
  if (outputText && !outputText.endsWith('\n')) {
    console.log();
  }

  // Output result
  if (options.json) {
    console.log(JSON.stringify({
      success: result.success,
      sessionId: result.sessionId,
      agent: agentName,
      provider: bestProvider.name,
      model: options.model || 'default',
      task: options.task,
      relay: result.relay,
      error: result.error,
    }, null, 2));
    return;
  }

  // Summary
  console.log();
  console.log(chalk.gray('─'.repeat(50)));
  console.log(chalk.gray(`  Provider: ${bestProvider.name}`));

  if (result.success) {
    console.log(chalk.green(`✓ ${agentName} completed successfully`));
  } else {
    console.log(chalk.red(`✗ ${agentName} failed: ${result.error || 'Unknown error'}`));
  }

  if (result.relay) {
    const { metrics, outputs } = result.relay;

    console.log(chalk.gray(`  Tokens: ${formatTokens(metrics.tokens_used.total)}`));
    console.log(chalk.gray(`  Duration: ${(metrics.duration_ms / 1000).toFixed(1)}s`));
    console.log(chalk.gray(`  Files read: ${metrics.files_read}, written: ${metrics.files_written}`));

    if (outputs.symbols.length > 0) {
      console.log(chalk.gray(`  Symbols: ${outputs.symbols.join(', ')}`));
    }

    if (outputs.artifacts.length > 0) {
      console.log(chalk.cyan('\n  Artifacts:'));
      for (const artifact of outputs.artifacts) {
        const icon = artifact.action === 'created' ? '+' : artifact.action === 'deleted' ? '-' : '~';
        console.log(chalk.gray(`    ${icon} ${artifact.path}`));
      }
    }
  }

  console.log(chalk.gray(`  Session: ${result.sessionId}`));
  console.log();
}
