/**
 * Configure Models
 *
 * Interactive prompts for configuring agent model assignments.
 * Supports model discovery from different environments (Cursor, Claude Code, API providers).
 */

import * as readline from 'readline';
import chalk from 'chalk';
import { ModelDiscovery } from '../../core/model-discovery.js';
import {
  ModelInfo,
  ModelConfig,
  ModelDiscoveryResult,
  AGENT_MODEL_RECOMMENDATIONS,
} from './types.js';
import { loadAgentsManifest, saveAgentsManifest, getParadigmDir } from './loader.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Create a readline interface for interactive prompts
 */
function createPrompt(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

/**
 * Ask a question and wait for answer
 */
function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

/**
 * Display a numbered menu and get selection
 */
async function askSelect(
  rl: readline.Interface,
  prompt: string,
  choices: Array<{ name: string; value: string }>
): Promise<string> {
  console.log(prompt);
  choices.forEach((choice, i) => {
    console.log(chalk.gray(`    ${i + 1}. ${choice.name}`));
  });

  const answer = await ask(rl, chalk.cyan('    > '));
  const index = parseInt(answer, 10) - 1;

  if (index >= 0 && index < choices.length) {
    return choices[index].value;
  }

  // If they entered a model ID directly
  if (answer && !answer.match(/^\d+$/)) {
    return answer;
  }

  // Default to first choice
  return choices[0].value;
}

/**
 * Check if we should prompt for model configuration
 */
export function shouldPromptForModels(): boolean {
  // In Claude Code - skip prompts (models are fixed)
  if (process.env.CLAUDE_CODE === '1' || process.env.TERM_PROGRAM === 'claude') {
    return false;
  }

  // In Cursor - prompt for models
  if (process.env.TERM_PROGRAM === 'cursor' || process.env.CURSOR_SESSION) {
    return true;
  }

  // In interactive terminal - prompt
  if (process.stdin.isTTY) {
    return true;
  }

  // Non-interactive - skip
  return false;
}

/**
 * Prompt user to select models for each agent
 */
export async function promptForAgentModels(
  rootDir: string,
  rl?: readline.Interface
): Promise<Record<string, ModelConfig>> {
  const shouldCloseRl = !rl;
  if (!rl) {
    rl = createPrompt();
  }

  const discovery = new ModelDiscovery(rootDir);
  const result = await discovery.discover();

  console.log(chalk.cyan('\n  Configure Agent Models\n'));
  console.log(chalk.gray(`    Detected environment: ${result.source}`));
  console.log(chalk.gray(`    Found ${result.models.length} available models\n`));

  const models: Record<string, ModelConfig> = {};
  const tiers = discovery.groupByTier(result.models);

  for (const agent of ['architect', 'builder', 'tester', 'reviewer', 'security']) {
    const rec = AGENT_MODEL_RECOMMENDATIONS[agent];

    // Get tier-appropriate models
    const recommended = rec.tier === 'high' ? tiers.high :
                        rec.tier === 'medium' ? tiers.medium : tiers.low;

    // Build choices with recommended first
    const choices: Array<{ name: string; value: string }> = [];

    if (recommended.length > 0) {
      choices.push({
        name: `${recommended[0].name} (recommended)`,
        value: recommended[0].id,
      });

      for (let i = 1; i < Math.min(recommended.length, 3); i++) {
        choices.push({
          name: recommended[i].name,
          value: recommended[i].id,
        });
      }
    }

    // Add option to show all models
    choices.push({ name: 'Show all models...', value: '__all__' });
    choices.push({ name: 'Enter custom model ID...', value: '__custom__' });

    const label = agent.charAt(0).toUpperCase() + agent.slice(1);
    console.log(chalk.white(`  ${label}`), chalk.gray(`(${rec.description}):`));

    const selected = await askSelect(rl, '', choices);

    if (selected === '__all__') {
      // Show full list
      const allChoices = result.models.map(m => ({
        name: `${m.name} (${m.provider})`,
        value: m.id,
      }));
      console.log(chalk.gray('\n    All available models:'));
      const fullSelected = await askSelect(rl, '', allChoices);
      models[agent] = { id: fullSelected };
    } else if (selected === '__custom__') {
      const customModel = await ask(rl, chalk.cyan('    Enter model ID: '));
      models[agent] = { id: customModel };
    } else {
      models[agent] = { id: selected };
    }

    console.log(chalk.green(`    ✓ ${label}: ${models[agent].id}\n`));
  }

  if (shouldCloseRl) {
    rl.close();
  }

  return models;
}

/**
 * Options for the team models command
 */
export interface ModelsOptions {
  refresh?: boolean;
  json?: boolean;
}

/**
 * Team models command - configure or view agent model assignments
 */
export async function teamModelsCommand(
  targetPath: string | undefined,
  options: ModelsOptions
): Promise<void> {
  const rootDir = targetPath ? path.resolve(targetPath) : process.cwd();
  const manifest = loadAgentsManifest(rootDir);
  const discovery = new ModelDiscovery(rootDir);

  if (options.refresh) {
    discovery.clearCache();
  }

  const available = await discovery.discover();

  if (options.json) {
    const agentModels: Record<string, string> = {};
    if (manifest?.agents) {
      for (const [name, agent] of Object.entries(manifest.agents)) {
        agentModels[name] = agent.defaultModel || 'default';
      }
    }

    console.log(JSON.stringify({
      environment: available.source,
      cached: available.cached,
      agents: agentModels,
      available: available.models,
    }, null, 2));
    return;
  }

  // Display current configuration
  console.log(chalk.cyan('\n  Agent Model Configuration\n'));
  console.log(chalk.gray(`    Environment: ${available.source}${available.cached ? ' (cached)' : ''}`));
  console.log(chalk.gray(`    Available models: ${available.models.length}\n`));

  console.log('    Current assignments:');
  console.log(chalk.gray('    ┌─────────────┬───────────────────────┐'));
  console.log(chalk.gray('    │ Agent       │ Model                 │'));
  console.log(chalk.gray('    ├─────────────┼───────────────────────┤'));

  if (manifest?.agents) {
    for (const [name, agent] of Object.entries(manifest.agents)) {
      const model = agent.defaultModel || 'default';
      const paddedName = name.padEnd(11);
      const paddedModel = model.padEnd(21);
      console.log(chalk.gray('    │ ') + chalk.white(paddedName) + chalk.gray(' │ ') + chalk.yellow(paddedModel) + chalk.gray(' │'));
    }
  } else {
    console.log(chalk.gray('    │ (no agents configured)             │'));
  }

  console.log(chalk.gray('    └─────────────┴───────────────────────┘\n'));

  // Show available models grouped by tier
  const tiers = discovery.groupByTier(available.models);

  console.log(chalk.cyan('    Available models by tier:\n'));

  if (tiers.high.length > 0) {
    console.log(chalk.yellow('    High (complex reasoning):'));
    for (const m of tiers.high.slice(0, 5)) {
      console.log(chalk.gray(`      - ${m.name} (${m.provider})`));
    }
    if (tiers.high.length > 5) {
      console.log(chalk.gray(`      ... and ${tiers.high.length - 5} more`));
    }
    console.log();
  }

  if (tiers.medium.length > 0) {
    console.log(chalk.blue('    Medium (balanced):'));
    for (const m of tiers.medium.slice(0, 5)) {
      console.log(chalk.gray(`      - ${m.name} (${m.provider})`));
    }
    if (tiers.medium.length > 5) {
      console.log(chalk.gray(`      ... and ${tiers.medium.length - 5} more`));
    }
    console.log();
  }

  if (tiers.low.length > 0) {
    console.log(chalk.green('    Low (fast & cheap):'));
    for (const m of tiers.low.slice(0, 5)) {
      console.log(chalk.gray(`      - ${m.name} (${m.provider})`));
    }
    if (tiers.low.length > 5) {
      console.log(chalk.gray(`      ... and ${tiers.low.length - 5} more`));
    }
    console.log();
  }

  // If interactive, offer to reconfigure
  if (process.stdin.isTTY && !options.json) {
    const rl = createPrompt();

    console.log(chalk.gray('    ─────────────────────────────────────────'));
    const action = await askSelect(rl, chalk.cyan('\n    What would you like to do?'), [
      { name: 'Reconfigure all models', value: 'all' },
      { name: 'Exit', value: 'exit' },
    ]);

    if (action === 'all' && manifest) {
      const models = await promptForAgentModels(rootDir, rl);

      // Update manifest with new models
      for (const [agentName, config] of Object.entries(models)) {
        if (manifest.agents[agentName]) {
          // Map full model IDs to simple names for agents.yaml compatibility
          manifest.agents[agentName].defaultModel = mapToSimpleModel(config.id);
        }
      }

      saveAgentsManifest(rootDir, manifest);
      console.log(chalk.green('\n    ✓ Model configuration updated.\n'));
    }

    rl.close();
  }
}

/**
 * Map a full model ID to a simple model name (opus/sonnet/haiku)
 * This maintains compatibility with the existing agent-provider system
 */
function mapToSimpleModel(modelId: string): 'opus' | 'sonnet' | 'haiku' {
  const id = modelId.toLowerCase();

  // High tier -> opus
  if (
    id.includes('opus') ||
    id.includes('gpt-4o') && !id.includes('mini') ||
    id.includes('o1') && !id.includes('mini') ||
    id.includes('pro') && !id.includes('mini') ||
    id.includes('large') ||
    id.includes('grok-2') && !id.includes('mini')
  ) {
    return 'opus';
  }

  // Low tier -> haiku
  if (
    id.includes('haiku') ||
    id.includes('mini') ||
    id.includes('flash') ||
    id.includes('small')
  ) {
    return 'haiku';
  }

  // Medium tier -> sonnet (default)
  return 'sonnet';
}

/**
 * Apply model overrides to a manifest's agents
 */
export function applyModelOverrides(
  agents: Record<string, { defaultModel?: 'opus' | 'sonnet' | 'haiku' }>,
  overrides: Record<string, ModelConfig>
): void {
  for (const [agentName, config] of Object.entries(overrides)) {
    if (agents[agentName]) {
      agents[agentName].defaultModel = mapToSimpleModel(config.id);
    }
  }
}
