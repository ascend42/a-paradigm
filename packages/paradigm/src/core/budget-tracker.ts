/**
 * Budget Tracker
 *
 * Tracks token usage and costs across orchestrations.
 * Enforces budget limits and provides cost estimates.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { EventEmitter } from 'events';
import {
  AgentModel,
  TokenUsage,
  calculateCost,
  formatCost,
  formatTokens,
  MODEL_PRICING,
} from './agent-provider.js';

// ============================================================================
// Types
// ============================================================================

export interface BudgetConfig {
  /** Global token limit */
  maxTokens?: number;
  /** Global cost limit in USD */
  maxCostUsd?: number;
  /** Warn when this percentage of budget is reached */
  warnAtPercent?: number;
  /** Per-agent limits */
  agentLimits?: Record<string, {
    maxTokens?: number;
    maxCostUsd?: number;
  }>;
}

export interface BudgetResult {
  allowed: boolean;
  reason?: string;
  usage: BudgetUsage;
  warningLevel?: 'none' | 'approaching' | 'exceeded';
}

export interface BudgetUsage {
  tokens: TokenUsage;
  cost: number;
  percentage: number;
  byAgent: Record<string, {
    tokens: TokenUsage;
    cost: number;
  }>;
}

export interface UsageRecord {
  timestamp: string;
  agent: string;
  model: AgentModel;
  tokens: TokenUsage;
  cost: number;
  orchestrationId?: string;
}

// ============================================================================
// Budget Tracker
// ============================================================================

export class BudgetTracker extends EventEmitter {
  private config: BudgetConfig;
  private usage: BudgetUsage;
  private records: UsageRecord[] = [];
  private configPath: string;

  constructor(_rootDir: string) {
    super();
    this.configPath = path.join(_rootDir, '.paradigm', 'config.yaml');
    this.config = this.loadConfig();
    this.usage = this.initializeUsage();
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Check if a request is within budget
   */
  checkBudget(agent: string, requestedTokens: number): BudgetResult {
    const estimatedCost = this.estimateCost(requestedTokens, 'sonnet');

    // Check global token limit
    if (this.config.maxTokens) {
      const projectedTokens = this.usage.tokens.total + requestedTokens;
      if (projectedTokens > this.config.maxTokens) {
        return {
          allowed: false,
          reason: `Global token limit exceeded: ${formatTokens(projectedTokens)} > ${formatTokens(this.config.maxTokens)}`,
          usage: this.usage,
          warningLevel: 'exceeded',
        };
      }
    }

    // Check global cost limit
    if (this.config.maxCostUsd) {
      const projectedCost = this.usage.cost + estimatedCost;
      if (projectedCost > this.config.maxCostUsd) {
        return {
          allowed: false,
          reason: `Cost ceiling exceeded: ${formatCost(projectedCost)} > ${formatCost(this.config.maxCostUsd)}`,
          usage: this.usage,
          warningLevel: 'exceeded',
        };
      }
    }

    // Check per-agent limits
    const agentLimit = this.config.agentLimits?.[agent];
    if (agentLimit) {
      const agentUsage = this.usage.byAgent[agent] || { tokens: { input: 0, output: 0, total: 0 }, cost: 0 };

      if (agentLimit.maxTokens) {
        const projectedAgentTokens = agentUsage.tokens.total + requestedTokens;
        if (projectedAgentTokens > agentLimit.maxTokens) {
          return {
            allowed: false,
            reason: `Agent '${agent}' token limit exceeded: ${formatTokens(projectedAgentTokens)} > ${formatTokens(agentLimit.maxTokens)}`,
            usage: this.usage,
            warningLevel: 'exceeded',
          };
        }
      }

      if (agentLimit.maxCostUsd) {
        const projectedAgentCost = agentUsage.cost + estimatedCost;
        if (projectedAgentCost > agentLimit.maxCostUsd) {
          return {
            allowed: false,
            reason: `Agent '${agent}' cost limit exceeded: ${formatCost(projectedAgentCost)} > ${formatCost(agentLimit.maxCostUsd)}`,
            usage: this.usage,
            warningLevel: 'exceeded',
          };
        }
      }
    }

    // Check warning threshold
    let warningLevel: 'none' | 'approaching' | 'exceeded' = 'none';
    if (this.config.warnAtPercent && this.config.maxTokens) {
      const projectedTokens = this.usage.tokens.total + requestedTokens;
      const percentage = (projectedTokens / this.config.maxTokens) * 100;
      if (percentage >= this.config.warnAtPercent) {
        warningLevel = 'approaching';
      }
    }

    return {
      allowed: true,
      usage: this.usage,
      warningLevel,
    };
  }

  /**
   * Record usage after an agent completes
   */
  recordUsage(
    agent: string,
    tokens: TokenUsage,
    model: AgentModel,
    orchestrationId?: string
  ): void {
    const cost = calculateCost(tokens, model);

    // Update totals
    this.usage.tokens.input += tokens.input;
    this.usage.tokens.output += tokens.output;
    this.usage.tokens.total += tokens.total;
    this.usage.cost += cost;

    // Update percentage
    if (this.config.maxTokens) {
      this.usage.percentage = (this.usage.tokens.total / this.config.maxTokens) * 100;
    }

    // Update per-agent usage
    if (!this.usage.byAgent[agent]) {
      this.usage.byAgent[agent] = {
        tokens: { input: 0, output: 0, total: 0 },
        cost: 0,
      };
    }
    this.usage.byAgent[agent].tokens.input += tokens.input;
    this.usage.byAgent[agent].tokens.output += tokens.output;
    this.usage.byAgent[agent].tokens.total += tokens.total;
    this.usage.byAgent[agent].cost += cost;

    // Add record
    const record: UsageRecord = {
      timestamp: new Date().toISOString(),
      agent,
      model,
      tokens,
      cost,
      orchestrationId,
    };
    this.records.push(record);

    // Emit events
    this.emit('usage', { agent, tokens, cost, total: this.usage });

    // Check for warnings
    if (this.config.warnAtPercent && this.usage.percentage >= this.config.warnAtPercent) {
      this.emit('warning', {
        type: 'budget_approaching',
        percentage: this.usage.percentage,
        usage: this.usage,
      });
    }
  }

  /**
   * Get current usage
   */
  getUsage(): BudgetUsage {
    return { ...this.usage };
  }

  /**
   * Get usage records
   */
  getRecords(): UsageRecord[] {
    return [...this.records];
  }

  /**
   * Get remaining budget
   */
  getRemaining(): { tokens: number | null; cost: number | null } {
    return {
      tokens: this.config.maxTokens
        ? this.config.maxTokens - this.usage.tokens.total
        : null,
      cost: this.config.maxCostUsd
        ? this.config.maxCostUsd - this.usage.cost
        : null,
    };
  }

  /**
   * Reset usage (for new orchestration)
   */
  reset(): void {
    this.usage = this.initializeUsage();
    this.records = [];
  }

  /**
   * Estimate cost for tokens
   */
  estimateCost(tokens: number, model: AgentModel): number {
    // Assume 50/50 input/output split for estimation
    const usage: TokenUsage = {
      input: Math.floor(tokens / 2),
      output: Math.ceil(tokens / 2),
      total: tokens,
    };
    return calculateCost(usage, model);
  }

  /**
   * Estimate time for tokens (rough approximation)
   */
  estimateTime(tokens: number, model: AgentModel): number {
    // Rough estimates: tokens per second by model
    const tps: Record<AgentModel, number> = {
      opus: 50,
      sonnet: 100,
      haiku: 200,
    };
    return Math.ceil(tokens / tps[model]) * 1000; // milliseconds
  }

  /**
   * Get summary for display
   */
  getSummary(): string {
    const lines: string[] = [];

    lines.push('Budget Summary:');
    lines.push(`  Tokens: ${formatTokens(this.usage.tokens.total)}`);
    lines.push(`  Cost: ${formatCost(this.usage.cost)}`);

    if (this.config.maxTokens) {
      lines.push(`  Token limit: ${formatTokens(this.config.maxTokens)} (${this.usage.percentage.toFixed(1)}% used)`);
    }

    if (this.config.maxCostUsd) {
      const costPercent = (this.usage.cost / this.config.maxCostUsd) * 100;
      lines.push(`  Cost limit: ${formatCost(this.config.maxCostUsd)} (${costPercent.toFixed(1)}% used)`);
    }

    if (Object.keys(this.usage.byAgent).length > 0) {
      lines.push('  By agent:');
      for (const [agent, agentUsage] of Object.entries(this.usage.byAgent)) {
        lines.push(`    ${agent}: ${formatTokens(agentUsage.tokens.total)} (${formatCost(agentUsage.cost)})`);
      }
    }

    return lines.join('\n');
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private loadConfig(): BudgetConfig {
    const defaultConfig: BudgetConfig = {
      maxTokens: 500000,
      maxCostUsd: 5.0,
      warnAtPercent: 80,
    };

    if (!fs.existsSync(this.configPath)) {
      return defaultConfig;
    }

    try {
      const content = fs.readFileSync(this.configPath, 'utf-8');
      const config = yaml.load(content) as Record<string, unknown>;
      const orchestration = config.orchestration as Record<string, unknown> | undefined;

      if (orchestration?.budget) {
        const budget = orchestration.budget as Record<string, unknown>;
        return {
          maxTokens: budget.max_tokens as number | undefined,
          maxCostUsd: budget.max_cost_usd as number | undefined,
          warnAtPercent: budget.warn_at_percent as number | undefined,
          agentLimits: orchestration.agent_limits as Record<string, { maxTokens?: number; maxCostUsd?: number }> | undefined,
        };
      }

      return defaultConfig;
    } catch {
      return defaultConfig;
    }
  }

  private initializeUsage(): BudgetUsage {
    return {
      tokens: { input: 0, output: 0, total: 0 },
      cost: 0,
      percentage: 0,
      byAgent: {},
    };
  }
}

// ============================================================================
// Cost Calculator Utilities
// ============================================================================

/**
 * Calculate cost for a task given expected tokens
 */
export function estimateTaskCost(
  agents: Array<{ agent: string; model: AgentModel; tokens: number }>
): number {
  let total = 0;
  for (const { model, tokens } of agents) {
    const usage: TokenUsage = {
      input: Math.floor(tokens * 0.3),
      output: Math.ceil(tokens * 0.7),
      total: tokens,
    };
    total += calculateCost(usage, model);
  }
  return total;
}

/**
 * Get pricing summary
 */
export function getPricingSummary(): string {
  const lines = ['Model Pricing (per 1M tokens):'];
  for (const [model, pricing] of Object.entries(MODEL_PRICING)) {
    lines.push(`  ${model}: $${pricing.input} input / $${pricing.output} output`);
  }
  return lines.join('\n');
}
