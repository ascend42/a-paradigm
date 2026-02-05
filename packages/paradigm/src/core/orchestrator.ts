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

    // Analyze task to determine agent sequence with parallel stages
    const agentPlan = this.planAgentSequence(task, manifest.agents);
    const stages = this.groupByStage(agentPlan);
    const results: SpawnResult[] = [];
    let totalTokens: TokenUsage = { input: 0, output: 0, total: 0 };
    let totalCost = 0;
    let handoffContexts: Map<string, string> = new Map();
    let success = true;

    // Execute stages sequentially, agents within each stage in parallel
    const sortedStages = Array.from(stages.keys()).sort((a, b) => a - b);

    for (const stageNum of sortedStages) {
      const stageAgents = stages.get(stageNum) || [];

      if (stageAgents.length === 0) continue;

      // Check for checkpoint before stage
      if (options.checkpoints?.beforeAgentSpawn && options.onCheckpoint) {
        const agentNames = stageAgents.map(s => s.agent).join(', ');
        const approved = await options.onCheckpoint(
          `Stage ${stageNum}: Spawn ${agentNames}${stageAgents.length > 1 ? ' (parallel)' : ''}`
        );
        if (!approved) {
          success = false;
          break;
        }
      }

      // Build spawn promises for all agents in this stage
      const spawnPromises = stageAgents.map(async (step) => {
        // Determine model for this agent
        const model =
          options.agentBudgets?.[step.agent]?.maxTokens
            ? 'haiku' // Use cheaper model if budget-constrained
            : DEFAULT_AGENT_MODELS[step.agent] || 'sonnet';

        // Build handoff context from dependencies
        let handoffContext = '';
        if (step.dependsOn.length > 0) {
          const contexts = step.dependsOn
            .map(dep => handoffContexts.get(dep))
            .filter(Boolean);
          if (contexts.length > 0) {
            handoffContext = contexts.join('\n\n---\n\n');
          }
        }

        // Build task with handoff context
        const taskWithContext = handoffContext
          ? `${step.subtask}\n\n## Context from previous agents:\n${handoffContext}`
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

        // Spawn agent
        const result = await this.spawner.spawn(step.agent, taskWithContext, spawnerOptions);

        if (options.onAgentComplete) {
          options.onAgentComplete(step.agent, result);
        }

        return { step, result, model };
      });

      // Execute all agents in this stage in parallel
      const stageResults = await Promise.all(spawnPromises);

      // Process results
      for (const { step, result, model } of stageResults) {
        results.push(result);

        // Update totals
        if (result.relay) {
          totalTokens.input += result.relay.metrics.tokens_used.input;
          totalTokens.output += result.relay.metrics.tokens_used.output;
          totalTokens.total += result.relay.metrics.tokens_used.total;
          totalCost += calculateCost(result.relay.metrics.tokens_used, model);

          // Store handoff context for dependent agents
          const context = result.relay.handoff?.context ||
            `${step.agent} completed: ${result.relay.outputs.decisions.join(', ') || 'task done'}`;
          handoffContexts.set(step.agent, context);
        }

        // Check for failure
        if (!result.success && step.required) {
          success = false;
        }
      }

      // If any required agent failed, stop
      if (!success) break;

      // Check for checkpoint after stage completion
      if (options.checkpoints?.afterAgentComplete && options.onCheckpoint) {
        const approved = await options.onCheckpoint(
          `Stage ${stageNum} completed. Continue to next stage?`
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

  /**
   * Plan agent sequence with parallel execution support
   *
   * Returns execution stages where agents within a stage can run in parallel,
   * but stages execute sequentially (stage N+1 waits for stage N to complete).
   */
  private planAgentSequence(
    task: string,
    agents: Record<string, any>
  ): Array<{ agent: string; subtask: string; required: boolean; stage: number; dependsOn: string[] }> {
    const symbols = extractSymbols(task);
    const taskLower = task.toLowerCase();

    // Build plan with dependency information
    const plan: Array<{ agent: string; subtask: string; required: boolean; stage: number; dependsOn: string[] }> = [];

    // Stage 0: Independent analysis agents (can run in parallel)
    const hasDesign = taskLower.includes('design') || taskLower.includes('architect') ||
                      taskLower.includes('plan') || taskLower.includes('spec');
    const hasSecurity = taskLower.includes('auth') || taskLower.includes('security') ||
                        taskLower.includes('gate') || symbols.some((s) => s.startsWith('^'));

    if (hasDesign && agents['architect']) {
      plan.push({
        agent: 'architect',
        subtask: `Design and specify: ${task}`,
        required: true,
        stage: 0,
        dependsOn: [],
      });
    }

    if (hasSecurity && agents['security']) {
      plan.push({
        agent: 'security',
        subtask: `Review security aspects of: ${task}`,
        required: false,
        stage: 0,  // Can run parallel with architect
        dependsOn: [],
      });
    }

    // Stage 1: Implementation (depends on design if present)
    const hasImplementation = taskLower.includes('build') || taskLower.includes('implement') ||
                              taskLower.includes('create') || taskLower.includes('add') ||
                              taskLower.includes('fix');

    if (hasImplementation && agents['builder']) {
      const dependsOn = hasDesign && agents['architect'] ? ['architect'] : [];
      plan.push({
        agent: 'builder',
        subtask: `Implement: ${task}`,
        required: true,
        stage: dependsOn.length > 0 ? 1 : 0,
        dependsOn,
      });
    }

    // Stage 2: Review and Test (can run in parallel after implementation)
    const hasReview = taskLower.includes('review') || taskLower.includes('check');
    const hasTest = taskLower.includes('test') || taskLower.includes('verify') || taskLower.includes('validate');
    const builderInPlan = plan.some(p => p.agent === 'builder');
    const reviewStage = builderInPlan ? 2 : (hasDesign ? 1 : 0);

    if (hasReview && agents['reviewer']) {
      plan.push({
        agent: 'reviewer',
        subtask: `Review: ${task}`,
        required: false,
        stage: reviewStage,
        dependsOn: builderInPlan ? ['builder'] : [],
      });
    }

    if (hasTest && agents['tester']) {
      plan.push({
        agent: 'tester',
        subtask: `Test and validate: ${task}`,
        required: false,
        stage: reviewStage,  // Can run parallel with reviewer
        dependsOn: builderInPlan ? ['builder'] : [],
      });
    }

    // If no specific agents matched, use default flow with proper stages
    if (plan.length === 0) {
      if (agents['architect']) {
        plan.push({ agent: 'architect', subtask: `Design: ${task}`, required: true, stage: 0, dependsOn: [] });
      }
      if (agents['builder']) {
        plan.push({ agent: 'builder', subtask: `Implement: ${task}`, required: true, stage: 1, dependsOn: agents['architect'] ? ['architect'] : [] });
      }
      if (agents['tester']) {
        plan.push({ agent: 'tester', subtask: `Test: ${task}`, required: false, stage: 2, dependsOn: agents['builder'] ? ['builder'] : [] });
      }
    }

    // Sort by stage for sequential stage execution
    return plan.sort((a, b) => a.stage - b.stage);
  }

  /**
   * Group plan steps by stage for parallel execution
   */
  private groupByStage(
    plan: Array<{ agent: string; subtask: string; required: boolean; stage: number; dependsOn: string[] }>
  ): Map<number, Array<{ agent: string; subtask: string; required: boolean; dependsOn: string[] }>> {
    const stages = new Map<number, Array<{ agent: string; subtask: string; required: boolean; dependsOn: string[] }>>();

    for (const step of plan) {
      const existing = stages.get(step.stage) || [];
      existing.push({ agent: step.agent, subtask: step.subtask, required: step.required, dependsOn: step.dependsOn });
      stages.set(step.stage, existing);
    }

    return stages;
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
