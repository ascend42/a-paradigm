/**
 * Orchestrator
 *
 * Coordinates multi-agent tasks using the Conductor pattern.
 * Supports both "faceted" (multi-agent) and "solo" (single agent) modes.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
  AgentModel,
  AgentMessage,
  AgentRelay,
  calculateCost,
  formatCost,
  formatTokens,
  TokenUsage,
} from './agent-provider.js';
import { AgentSpawner, SpawnResult, SpawnerOptions } from './agent-spawner.js';
import { loadFullContext, buildAgentContext, extractSymbols } from './context-builder.js';
import { BudgetTracker } from './budget-tracker.js';
import { AuditLogger, OrchestrationLog } from './audit-logger.js';
import { loadAgentsManifest } from '../commands/team/loader.js';

// ============================================================================
// Types
// ============================================================================

export type OrchestrationMode = 'faceted' | 'solo';

export interface OrchestrationOptions {
  /** Mode: 'faceted' (multi-agent) or 'solo' (single Claude) */
  mode?: OrchestrationMode;
  /** Orchestrator model (default: opus) */
  orchestratorModel?: AgentModel;
  /** Working directory */
  workingDirectory?: string;
  /** MCP server path */
  mcpServerPath?: string;
  /** Global budget for entire orchestration */
  budget?: {
    maxTokens?: number;
    maxCostUsd?: number;
    warnAtPercent?: number;
  };
  /** Per-agent budgets */
  agentBudgets?: Record<string, {
    maxTokens?: number;
    maxCostUsd?: number;
  }>;
  /** Human checkpoints */
  checkpoints?: {
    beforeAgentSpawn?: boolean;
    afterAgentComplete?: boolean;
    atStages?: string[];
  };
  /** Stream messages callback */
  onMessage?: (source: string, message: AgentMessage) => void;
  /** Checkpoint approval callback */
  onCheckpoint?: (description: string) => Promise<boolean>;
  /** Agent started callback */
  onAgentStart?: (agentName: string, task: string) => void;
  /** Agent completed callback */
  onAgentComplete?: (agentName: string, result: SpawnResult) => void;
}

export interface OrchestrationResult {
  success: boolean;
  mode: OrchestrationMode;
  orchestrationId: string;
  task: string;
  agentsSpawned: number;
  totalTokens: TokenUsage;
  totalCost: number;
  duration_ms: number;
  agentResults: SpawnResult[];
  log?: OrchestrationLog;
  error?: string;
}

// ============================================================================
// Default Agent Selection
// ============================================================================

const DEFAULT_AGENT_MODELS: Record<string, AgentModel> = {
  architect: 'opus',
  security: 'opus',
  reviewer: 'sonnet',
  builder: 'haiku',
  tester: 'haiku',
};

// ============================================================================
// Orchestrator
// ============================================================================

export class Orchestrator {
  private spawner: AgentSpawner;
  private budgetTracker: BudgetTracker;
  private auditLogger: AuditLogger;
  private rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.spawner = new AgentSpawner(rootDir);
    this.budgetTracker = new BudgetTracker(rootDir);
    this.auditLogger = new AuditLogger(rootDir);
  }

  /**
   * Initialize the orchestrator
   */
  async initialize(): Promise<void> {
    await this.spawner.initialize();
  }

  /**
   * Orchestrate a task
   */
  async orchestrate(
    task: string,
    options: OrchestrationOptions = {}
  ): Promise<OrchestrationResult> {
    const mode = options.mode || 'faceted';
    const startTime = Date.now();
    const orchestrationId = this.generateOrchestrationId();

    // Initialize result
    const result: OrchestrationResult = {
      success: false,
      mode,
      orchestrationId,
      task,
      agentsSpawned: 0,
      totalTokens: { input: 0, output: 0, total: 0 },
      totalCost: 0,
      duration_ms: 0,
      agentResults: [],
    };

    try {
      if (mode === 'solo') {
        const soloResult = await this.runSoloMode(task, options);
        result.agentsSpawned = 1;
        result.agentResults = [soloResult];
        result.success = soloResult.success;
        if (soloResult.relay) {
          result.totalTokens = soloResult.relay.metrics.tokens_used;
          result.totalCost = calculateCost(result.totalTokens, options.orchestratorModel || 'opus');
        }
      } else {
        const facetedResult = await this.runFacetedMode(task, options);
        result.agentsSpawned = facetedResult.results.length;
        result.agentResults = facetedResult.results;
        result.totalTokens = facetedResult.totalTokens;
        result.totalCost = facetedResult.totalCost;
        result.success = facetedResult.success;
      }

      result.duration_ms = Date.now() - startTime;

      // Log orchestration
      const log = this.auditLogger.startOrchestration(orchestrationId, task, mode);
      log.completed = new Date().toISOString();
      log.status = result.success ? 'success' : 'failed';
      log.totals = {
        duration_ms: result.duration_ms,
        tokens: result.totalTokens.total,
        cost_usd: result.totalCost,
        agents_spawned: result.agentsSpawned,
        files_created: 0,
        files_modified: 0,
      };
      this.auditLogger.saveOrchestration(log);
      result.log = log;

      return result;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      result.duration_ms = Date.now() - startTime;
      return result;
    }
  }

  /**
   * Compare solo vs faceted mode for A/B testing
   */
  async compare(
    task: string,
    options: Omit<OrchestrationOptions, 'mode'> = {}
  ): Promise<{
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
  }> {
    // Run solo mode
    const soloResult = await this.orchestrate(task, { ...options, mode: 'solo' });

    // Run faceted mode
    const facetedResult = await this.orchestrate(task, { ...options, mode: 'faceted' });

    // Compare results
    const tokensSaved = soloResult.totalTokens.total - facetedResult.totalTokens.total;
    const costDiff = soloResult.totalCost - facetedResult.totalCost;
    const timeDiff = soloResult.duration_ms - facetedResult.duration_ms;

    let winner: 'solo' | 'faceted' | 'tie' = 'tie';

    if (facetedResult.success && !soloResult.success) {
      winner = 'faceted';
    } else if (soloResult.success && !facetedResult.success) {
      winner = 'solo';
    } else if (facetedResult.totalCost < soloResult.totalCost * 0.8) {
      // Faceted is at least 20% cheaper
      winner = 'faceted';
    } else if (soloResult.totalCost < facetedResult.totalCost * 0.8) {
      // Solo is at least 20% cheaper
      winner = 'solo';
    }

    return {
      solo: soloResult,
      faceted: facetedResult,
      comparison: {
        winner,
        tokensSaved,
        costDiff,
        timeDiff,
        soloSucceeded: soloResult.success,
        facetedSucceeded: facetedResult.success,
      },
    };
  }

  // ==========================================================================
  // Private: Solo Mode
  // ==========================================================================

  private async runSoloMode(
    task: string,
    options: OrchestrationOptions
  ): Promise<SpawnResult> {
    // In solo mode, spawn a single "generalist" agent
    const manifest = loadAgentsManifest(this.rootDir);

    // Use architect as the solo agent, or fallback to first available
    const agentName = manifest?.team.default_agent || 'architect';
    const model = options.orchestratorModel || 'opus';

    // Load full context for solo mode
    const context = await loadFullContext(this.rootDir);

    const spawnerOptions: SpawnerOptions = {
      model,
      workingDirectory: options.workingDirectory || this.rootDir,
      mcpServerPath: options.mcpServerPath,
      budget: options.budget,
      onMessage: options.onMessage
        ? (msg) => options.onMessage!('solo', msg)
        : undefined,
      onCheckpoint: options.onCheckpoint,
    };

    if (options.onAgentStart) {
      options.onAgentStart('solo', task);
    }

    const result = await this.spawner.spawn(agentName, task, spawnerOptions);

    if (options.onAgentComplete) {
      options.onAgentComplete('solo', result);
    }

    return result;
  }

  // ==========================================================================
  // Private: Faceted Mode
  // ==========================================================================

  private async runFacetedMode(
    task: string,
    options: OrchestrationOptions
  ): Promise<{
    success: boolean;
    results: SpawnResult[];
    totalTokens: TokenUsage;
    totalCost: number;
  }> {
    const manifest = loadAgentsManifest(this.rootDir);
    if (!manifest) {
      return {
        success: false,
        results: [],
        totalTokens: { input: 0, output: 0, total: 0 },
        totalCost: 0,
      };
    }

    // Analyze task to determine agent sequence
    const agentPlan = this.planAgentSequence(task, manifest.agents);
    const results: SpawnResult[] = [];
    let totalTokens: TokenUsage = { input: 0, output: 0, total: 0 };
    let totalCost = 0;
    let handoffContext = '';
    let success = true;

    // Execute agents according to plan
    for (const step of agentPlan) {
      // Check for checkpoint before spawn
      if (options.checkpoints?.beforeAgentSpawn && options.onCheckpoint) {
        const approved = await options.onCheckpoint(
          `Spawn ${step.agent} for: ${step.subtask}`
        );
        if (!approved) {
          success = false;
          break;
        }
      }

      // Determine model for this agent
      const model =
        options.agentBudgets?.[step.agent]?.maxTokens
          ? 'haiku' // Use cheaper model if budget-constrained
          : DEFAULT_AGENT_MODELS[step.agent] || 'sonnet';

      // Build task with handoff context
      const taskWithContext = handoffContext
        ? `${step.subtask}\n\n## Context from previous agent:\n${handoffContext}`
        : step.subtask;

      const spawnerOptions: SpawnerOptions = {
        model,
        workingDirectory: options.workingDirectory || this.rootDir,
        mcpServerPath: options.mcpServerPath,
        budget: options.agentBudgets?.[step.agent] || options.budget,
        onMessage: options.onMessage
          ? (msg) => options.onMessage!(step.agent, msg)
          : undefined,
        onCheckpoint: options.onCheckpoint,
      };

      if (options.onAgentStart) {
        options.onAgentStart(step.agent, step.subtask);
      }

      // Spawn agent (parallel if possible)
      const result = await this.spawner.spawn(step.agent, taskWithContext, spawnerOptions);
      results.push(result);

      if (options.onAgentComplete) {
        options.onAgentComplete(step.agent, result);
      }

      // Update totals
      if (result.relay) {
        totalTokens.input += result.relay.metrics.tokens_used.input;
        totalTokens.output += result.relay.metrics.tokens_used.output;
        totalTokens.total += result.relay.metrics.tokens_used.total;
        totalCost += calculateCost(result.relay.metrics.tokens_used, model);

        // Build handoff context for next agent
        if (result.relay.handoff) {
          handoffContext = result.relay.handoff.context;
        } else {
          handoffContext = `${step.agent} completed: ${result.relay.outputs.decisions.join(', ')}`;
        }
      }

      // Check for failure
      if (!result.success && step.required) {
        success = false;
        break;
      }

      // Check for checkpoint after completion
      if (options.checkpoints?.afterAgentComplete && options.onCheckpoint) {
        const approved = await options.onCheckpoint(
          `${step.agent} completed. Continue to next agent?`
        );
        if (!approved) {
          break;
        }
      }
    }

    return { success, results, totalTokens, totalCost };
  }

  // ==========================================================================
  // Private: Agent Planning
  // ==========================================================================

  private planAgentSequence(
    task: string,
    agents: Record<string, any>
  ): Array<{ agent: string; subtask: string; required: boolean; parallel?: string[] }> {
    const symbols = extractSymbols(task);
    const taskLower = task.toLowerCase();

    // Simple heuristic-based planning
    const plan: Array<{ agent: string; subtask: string; required: boolean }> = [];

    // Check for design/architecture keywords
    if (
      taskLower.includes('design') ||
      taskLower.includes('architect') ||
      taskLower.includes('plan') ||
      taskLower.includes('spec')
    ) {
      plan.push({
        agent: 'architect',
        subtask: `Design and specify: ${task}`,
        required: true,
      });
    }

    // Check for security keywords
    if (
      taskLower.includes('auth') ||
      taskLower.includes('security') ||
      taskLower.includes('gate') ||
      symbols.some((s) => s.startsWith('^'))
    ) {
      plan.push({
        agent: 'security',
        subtask: `Review security aspects of: ${task}`,
        required: false,
      });
    }

    // Default: always include builder for implementation
    if (
      taskLower.includes('build') ||
      taskLower.includes('implement') ||
      taskLower.includes('create') ||
      taskLower.includes('add') ||
      taskLower.includes('fix')
    ) {
      plan.push({
        agent: 'builder',
        subtask: `Implement: ${task}`,
        required: true,
      });
    }

    // Check for review keywords
    if (taskLower.includes('review') || taskLower.includes('check')) {
      plan.push({
        agent: 'reviewer',
        subtask: `Review: ${task}`,
        required: false,
      });
    }

    // Check for test keywords
    if (
      taskLower.includes('test') ||
      taskLower.includes('verify') ||
      taskLower.includes('validate')
    ) {
      plan.push({
        agent: 'tester',
        subtask: `Test and validate: ${task}`,
        required: false,
      });
    }

    // If no specific agents matched, use default flow
    if (plan.length === 0) {
      plan.push(
        { agent: 'architect', subtask: `Design: ${task}`, required: true },
        { agent: 'builder', subtask: `Implement: ${task}`, required: true },
        { agent: 'tester', subtask: `Test: ${task}`, required: false }
      );
    }

    // Filter to only available agents
    return plan.filter((step) => agents[step.agent]);
  }

  // ==========================================================================
  // Private: Utilities
  // ==========================================================================

  private generateOrchestrationId(): string {
    const date = new Date().toISOString().slice(0, 10);
    const random = Math.random().toString(36).substring(2, 8);
    return `orch-${date}-${random}`;
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

let defaultOrchestrator: Orchestrator | null = null;

/**
 * Get or create the default orchestrator
 */
export async function getOrchestrator(rootDir?: string): Promise<Orchestrator> {
  const dir = rootDir || process.cwd();

  if (!defaultOrchestrator) {
    defaultOrchestrator = new Orchestrator(dir);
    await defaultOrchestrator.initialize();
  }

  return defaultOrchestrator;
}

/**
 * Orchestrate a task (convenience function)
 */
export async function orchestrate(
  task: string,
  options?: OrchestrationOptions
): Promise<OrchestrationResult> {
  const orchestrator = await getOrchestrator(options?.workingDirectory);
  return orchestrator.orchestrate(task, options);
}
