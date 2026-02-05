/**
 * Cost Estimator
 *
 * Provides cost preview for orchestration tasks before agent spawn.
 * Estimates token usage and costs based on task complexity and agent selection.
 */

import { AgentModel, MODEL_PRICING, TokenUsage } from './agent-provider.js';
import { TaskClassification } from './task-classifier.js';

// ============================================================================
// Types
// ============================================================================

export interface AgentCostEstimate {
  /** Agent name */
  name: string;
  /** Model to be used */
  model: AgentModel;
  /** Estimated token usage */
  estimatedTokens: {
    input: number;
    output: number;
    total: number;
  };
  /** Estimated cost in USD */
  estimatedCost: number;
}

export interface CostPreview {
  /** Individual agent cost estimates */
  agents: AgentCostEstimate[];
  /** Total estimated cost */
  totalEstimatedCost: number;
  /** Total estimated tokens */
  totalEstimatedTokens: TokenUsage;
  /** Comparison to full team baseline (e.g., "0.48x") */
  comparisonToBaseline: string;
  /** Cost savings vs full team */
  estimatedSavings: number;
  /** Confidence level of estimate */
  confidence: 'low' | 'medium' | 'high';
}

export interface EstimationContext {
  /** Task classification */
  classification?: TaskClassification;
  /** Planned agents */
  plannedAgents?: Array<{ name: string; model: AgentModel }>;
  /** Number of files likely affected */
  fileCount?: number;
  /** Task complexity override */
  complexity?: 'low' | 'medium' | 'high';
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Base token estimates per agent based on typical operations
 * These are conservative estimates for planning purposes
 */
const AGENT_BASE_TOKENS: Record<string, { input: number; output: number }> = {
  architect: { input: 8000, output: 4000 },
  security: { input: 6000, output: 3000 },
  reviewer: { input: 5000, output: 2000 },
  builder: { input: 15000, output: 10000 },
  tester: { input: 8000, output: 5000 },
};

/**
 * Complexity multipliers for token estimation
 */
const COMPLEXITY_MULTIPLIERS: Record<string, number> = {
  low: 0.6,
  medium: 1.0,
  high: 1.5,
};

/**
 * Full team baseline cost for comparison
 * This is the estimated cost of running all agents for a medium-complexity task
 */
const FULL_TEAM_BASELINE_COST = calculateFullTeamBaseline();

function calculateFullTeamBaseline(): number {
  let total = 0;
  const agents = ['architect', 'security', 'builder', 'tester'];
  const models: Record<string, AgentModel> = {
    architect: 'opus',
    security: 'opus',
    builder: 'haiku',
    tester: 'haiku',
  };

  for (const agent of agents) {
    const base = AGENT_BASE_TOKENS[agent];
    const model = models[agent];
    const pricing = MODEL_PRICING[model];

    const inputCost = (base.input / 1_000_000) * pricing.input;
    const outputCost = (base.output / 1_000_000) * pricing.output;
    total += inputCost + outputCost;
  }

  return total;
}

// ============================================================================
// Estimation Functions
// ============================================================================

/**
 * Estimate tokens for a single agent
 */
export function estimateAgentTokens(
  agentName: string,
  complexity: 'low' | 'medium' | 'high' = 'medium',
  fileCount?: number
): TokenUsage {
  const base = AGENT_BASE_TOKENS[agentName] || { input: 5000, output: 3000 };
  const multiplier = COMPLEXITY_MULTIPLIERS[complexity];

  // Additional multiplier based on file count
  let fileMultiplier = 1.0;
  if (fileCount) {
    if (fileCount > 20) fileMultiplier = 1.5;
    else if (fileCount > 10) fileMultiplier = 1.25;
    else if (fileCount > 5) fileMultiplier = 1.1;
  }

  const input = Math.round(base.input * multiplier * fileMultiplier);
  const output = Math.round(base.output * multiplier * fileMultiplier);

  return {
    input,
    output,
    total: input + output,
  };
}

/**
 * Calculate cost from token estimate
 */
export function calculateEstimatedCost(tokens: TokenUsage, model: AgentModel): number {
  const pricing = MODEL_PRICING[model];
  const inputCost = (tokens.input / 1_000_000) * pricing.input;
  const outputCost = (tokens.output / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

/**
 * Generate a full cost preview for an orchestration
 */
export function generateCostPreview(
  agents: Array<{ name: string; model: AgentModel }>,
  context?: EstimationContext
): CostPreview {
  const complexity = context?.complexity || context?.classification?.complexity || 'medium';
  const fileCount = context?.fileCount;

  const agentEstimates: AgentCostEstimate[] = [];
  let totalTokens: TokenUsage = { input: 0, output: 0, total: 0 };
  let totalCost = 0;

  for (const agent of agents) {
    const tokens = estimateAgentTokens(agent.name, complexity, fileCount);
    const cost = calculateEstimatedCost(tokens, agent.model);

    agentEstimates.push({
      name: agent.name,
      model: agent.model,
      estimatedTokens: tokens,
      estimatedCost: cost,
    });

    totalTokens.input += tokens.input;
    totalTokens.output += tokens.output;
    totalTokens.total += tokens.total;
    totalCost += cost;
  }

  // Calculate comparison to baseline
  const ratio = totalCost / FULL_TEAM_BASELINE_COST;
  const comparisonToBaseline = `${ratio.toFixed(2)}x`;
  const estimatedSavings = Math.max(0, FULL_TEAM_BASELINE_COST - totalCost);

  // Determine confidence level
  let confidence: 'low' | 'medium' | 'high' = 'medium';
  if (context?.classification) {
    // Higher confidence when we have classification data
    confidence = 'high';
  } else if (!fileCount && !context?.complexity) {
    // Lower confidence when we have minimal context
    confidence = 'low';
  }

  return {
    agents: agentEstimates,
    totalEstimatedCost: totalCost,
    totalEstimatedTokens: totalTokens,
    comparisonToBaseline,
    estimatedSavings,
    confidence,
  };
}

/**
 * Format cost preview for display
 */
export function formatCostPreview(preview: CostPreview): string {
  const lines: string[] = [];

  lines.push('## Cost Preview');
  lines.push('');
  lines.push(`Confidence: ${preview.confidence}`);
  lines.push('');
  lines.push('### Agents:');

  for (const agent of preview.agents) {
    lines.push(`- **${agent.name}** (${agent.model}): ~${formatCost(agent.estimatedCost)} (${formatTokens(agent.estimatedTokens.total)} tokens)`);
  }

  lines.push('');
  lines.push(`### Total Estimated Cost: ${formatCost(preview.totalEstimatedCost)}`);
  lines.push(`Total Tokens: ~${formatTokens(preview.totalEstimatedTokens.total)}`);
  lines.push(`Comparison to Full Team: ${preview.comparisonToBaseline}`);

  if (preview.estimatedSavings > 0) {
    lines.push(`Estimated Savings: ${formatCost(preview.estimatedSavings)}`);
  }

  return lines.join('\n');
}

/**
 * Format cost value for display
 */
function formatCost(usd: number): string {
  if (usd < 0.01) {
    return `$${(usd * 100).toFixed(3)}¢`;
  }
  return `$${usd.toFixed(4)}`;
}

/**
 * Format token count for display
 */
function formatTokens(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(2)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`;
  }
  return count.toString();
}

/**
 * Get the full team baseline cost for reference
 */
export function getBaselineCost(): number {
  return FULL_TEAM_BASELINE_COST;
}

/**
 * Quick estimate for a task based on classification
 */
export function quickEstimate(classification: TaskClassification): CostPreview {
  const agents = classification.recommendedAgents.map(name => ({
    name,
    // Map to default models based on agent type
    model: getDefaultModel(name, classification.securityRequired),
  }));

  return generateCostPreview(agents, { classification });
}

function getDefaultModel(agentName: string, securityEscalated: boolean): AgentModel {
  if (agentName === 'security' && securityEscalated) {
    return 'opus';
  }

  const defaults: Record<string, AgentModel> = {
    architect: 'opus',
    security: 'opus',
    reviewer: 'sonnet',
    builder: 'haiku',
    tester: 'haiku',
  };

  return defaults[agentName] || 'sonnet';
}
