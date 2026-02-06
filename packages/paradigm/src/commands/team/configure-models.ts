/**
 * Configure Models
 *
 * Interactive prompts for configuring agent model assignments.
 * Supports model discovery from different environments (Cursor, Claude Code, API providers).
 */

import prompts from 'prompts';
import chalk from 'chalk';
import { ModelDiscovery } from '../../core/model-discovery.js';
import {
  ModelInfo,
  ModelConfig,
  AGENT_MODEL_RECOMMENDATIONS,
} from './types.js';
import { loadAgentsManifest, saveAgentsManifest } from './loader.js';
import * as path from 'path';

/**
 * Check if we should prompt for model configuration
 */
export function shouldPromptForModels(): boolean {
  // In Claude Code - skip prompts (models are fixed)
  if (process.env.CLAUDE_CODE === '1' || process.env.TERM_PROGRAM === 'claude') {
    return false;
  }

  // In Cursor - prompt for models (Cursor is VSCode-based)
  if (
    process.env.TERM_PROGRAM === 'cursor' ||
    process.env.CURSOR_SESSION ||
    process.env.CURSOR_TRACE_ID ||
    (process.env.VSCODE_CWD && process.env.VSCODE_CWD.toLowerCase().includes('cursor')) ||
    (process.env.VSCODE_NLS_CONFIG && process.env.VSCODE_NLS_CONFIG.toLowerCase().includes('cursor')) ||
    (process.env.TERM_PROGRAM === 'vscode' && process.env.VSCODE_GIT_ASKPASS_NODE?.toLowerCase().includes('cursor'))
  ) {
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
  rootDir: string
): Promise<Record<string, ModelConfig>> {
  const discovery = new ModelDiscovery(rootDir);
  const result = await discovery.discover();

  console.log(chalk.cyan('\n  Configure Agent Models\n'));
  console.log(chalk.gray(`    Environment: ${result.source}`));
  console.log(chalk.gray(`    Available: ${result.models.length} models\n`));

  const models: Record<string, ModelConfig> = {};
  const tiers = discovery.groupByTier(result.models);

  // Build choices with tier indicators
  const buildChoices = (agent: string) => {
    const rec = AGENT_MODEL_RECOMMENDATIONS[agent];
    const recommended = rec.tier === 'high' ? tiers.high :
                        rec.tier === 'medium' ? tiers.medium : tiers.low;

    // Get all models with tier labels, recommended first
    const choices: Array<{ title: string; value: string; description?: string }> = [];

    // Add recommended models first
    for (const model of recommended) {
      const isFirst = choices.length === 0;
      choices.push({
        title: isFirst ? `${model.name} (recommended)` : model.name,
        value: model.id,
        description: `${model.provider} - ${rec.tier} tier`,
      });
    }

    // Add other models grouped by tier
    const otherHigh = tiers.high.filter(m => !recommended.includes(m));
    const otherMedium = tiers.medium.filter(m => !recommended.includes(m));
    const otherLow = tiers.low.filter(m => !recommended.includes(m));

    for (const model of otherHigh) {
      choices.push({
        title: model.name,
        value: model.id,
        description: `${model.provider} - high tier`,
      });
    }

    for (const model of otherMedium) {
      choices.push({
        title: model.name,
        value: model.id,
        description: `${model.provider} - medium tier`,
      });
    }

    for (const model of otherLow) {
      choices.push({
        title: model.name,
        value: model.id,
        description: `${model.provider} - low tier`,
      });
    }

    return choices;
  };

  for (const agent of ['architect', 'builder', 'tester', 'reviewer', 'security']) {
    const rec = AGENT_MODEL_RECOMMENDATIONS[agent];
    const label = agent.charAt(0).toUpperCase() + agent.slice(1);
    const choices = buildChoices(agent);

    const response = await prompts({
      type: 'select',
      name: 'model',
      message: `${label} (${rec.description})`,
      choices,
      initial: 0,
    }, {
      onCancel: () => {
        console.log(chalk.yellow('\n  Cancelled. Using defaults.\n'));
        process.exit(0);
      }
    });

    models[agent] = { id: response.model };
    console.log(chalk.green(`    ✓ ${label}: ${response.model}\n`));
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
    console.log(chalk.gray('    ─────────────────────────────────────────'));

    const { action } = await prompts({
      type: 'select',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { title: 'Reconfigure all models', value: 'all' },
        { title: 'Exit', value: 'exit' },
      ],
      initial: 1,
    });

    if (action === 'all' && manifest) {
      const models = await promptForAgentModels(rootDir);

      // Update manifest with new models
      for (const [agentName, config] of Object.entries(models)) {
        if (manifest.agents[agentName]) {
          manifest.agents[agentName].defaultModel = mapToSimpleModel(config.id);
        }
      }

      saveAgentsManifest(rootDir, manifest);
      console.log(chalk.green('\n    ✓ Model configuration updated.\n'));
    }
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
    (id.includes('gpt-4') && !id.includes('mini') && !id.includes('nano')) ||
    (id === 'o3' || (id.includes('o3') && !id.includes('mini'))) ||
    (id.includes('o1') && !id.includes('mini')) ||
    (id.includes('-pro') && !id.includes('mini')) ||
    id.includes('large') ||
    id.includes('maverick') ||
    id.includes('deepseek-r1') ||
    (id.includes('grok-3') && !id.includes('mini')) ||
    (id.includes('grok-2') && !id.includes('mini'))
  ) {
    return 'opus';
  }

  // Low tier -> haiku
  if (
    id.includes('haiku') ||
    id.includes('mini') ||
    id.includes('nano') ||
    id.includes('flash') ||
    id.includes('scout') ||
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
