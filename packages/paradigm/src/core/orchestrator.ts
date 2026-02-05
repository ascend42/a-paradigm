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
import {
  parseRelayWithFilePlan,
  FilePlanGroup,
  FileAssignment,
} from './agent-prompts.js';

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
  /** Parallel builder execution details (if file plan was used) */
  parallelBuilderStats?: {
    usedFilePlan: boolean;
    totalSubPhases: number;
    totalParallelBuilders: number;
    filesCreated: number;
  };
}

// Types for parallel builder execution
interface BuilderStage {
  subPhase: number;
  builders: Array<{
    agent: string;
    group: string;
    files: FileAssignment[];
    availableFiles: string[];
  }>;
}

interface ParallelBuilderPlan {
  hasFilePlan: boolean;
  stages: BuilderStage[];
  totalFiles: number;
  totalBuilders: number;
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
        result.parallelBuilderStats = facetedResult.parallelBuilderStats;
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
    parallelBuilderStats?: {
      usedFilePlan: boolean;
      totalSubPhases: number;
      totalParallelBuilders: number;
      filesCreated: number;
    };
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
    let parallelBuilderStats: {
      usedFilePlan: boolean;
      totalSubPhases: number;
      totalParallelBuilders: number;
      filesCreated: number;
    } | undefined;

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

          // Check if architect provided a file plan for parallel builders
          if (step.agent === 'architect' && result.relay) {
            // Try to parse file plan from the relay output
            // The relay might contain the full response including YAML block
            const filePlan = this.extractFilePlanFromRelay(result);

            if (filePlan && filePlan.length > 0) {
              // Plan parallel builder execution
              const builderPlan = this.planBuilderStages(filePlan);

              if (builderPlan.hasFilePlan && builderPlan.totalBuilders > 1) {
                // Execute parallel builders instead of single builder
                const parallelResult = await this.runParallelBuilders(
                  builderPlan,
                  handoffContexts.get('architect') || '',
                  options
                );

                // Add parallel builder results
                results.push(...parallelResult.results);
                totalTokens.input += parallelResult.totalTokens.input;
                totalTokens.output += parallelResult.totalTokens.output;
                totalTokens.total += parallelResult.totalTokens.total;
                totalCost += parallelResult.totalCost;

                if (!parallelResult.success) {
                  success = false;
                }

                // Record stats
                parallelBuilderStats = {
                  usedFilePlan: true,
                  totalSubPhases: builderPlan.stages.length,
                  totalParallelBuilders: builderPlan.totalBuilders,
                  filesCreated: builderPlan.totalFiles,
                };

                // Skip the normal builder stage since we handled it with parallel builders
                // Remove builder from remaining stages
                for (const [stageKey, stageValue] of stages) {
                  const filtered = stageValue.filter(s => s.agent !== 'builder');
                  stages.set(stageKey, filtered);
                }
              }
            }
          }
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

    return { success, results, totalTokens, totalCost, parallelBuilderStats };
  }

  /**
   * Extract file plan from architect's relay result
   */
  private extractFilePlanFromRelay(result: SpawnResult): FilePlanGroup[] | undefined {
    if (!result.relay) return undefined;

    // The relay might have the file plan in the handoff context or we need to parse from response
    // For now, we'll look for a structured filePlan in the relay outputs
    // This would typically come from parsing the full agent response

    // Check if there's additional context that might contain the file plan
    const handoffContext = result.relay.handoff?.context || '';

    // Try to parse file plan from handoff context
    if (handoffContext.includes('filePlan:')) {
      return this.parseFilePlanFromText(handoffContext);
    }

    return undefined;
  }

  /**
   * Parse file plan from text (simplified YAML parsing)
   */
  private parseFilePlanFromText(text: string): FilePlanGroup[] | undefined {
    const filePlan: FilePlanGroup[] = [];

    // Look for filePlan section
    const filePlanMatch = text.match(/filePlan:\s*\n([\s\S]*?)(?=\n[a-z_]+:|$)/);
    if (!filePlanMatch) {
      return undefined;
    }

    const filePlanContent = filePlanMatch[1];
    const lines = filePlanContent.split('\n');

    let currentGroup: FilePlanGroup | null = null;
    let inFiles = false;
    let currentFile: Partial<FileAssignment> = {};

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith('#')) continue;

      if (trimmed.startsWith('- group:')) {
        if (currentGroup) {
          if (currentFile.path) {
            currentGroup.files.push({
              path: currentFile.path,
              description: currentFile.description || '',
            });
            currentFile = {};
          }
          filePlan.push(currentGroup);
        }
        currentGroup = {
          group: trimmed.split(':')[1].trim(),
          subPhase: 0,
          files: [],
        };
        inFiles = false;
        continue;
      }

      if (!currentGroup) continue;

      if (trimmed.startsWith('subPhase:')) {
        currentGroup.subPhase = parseInt(trimmed.split(':')[1].trim(), 10) || 0;
        continue;
      }

      if (trimmed === 'files:') {
        inFiles = true;
        continue;
      }

      if (inFiles) {
        if (trimmed.startsWith('- path:')) {
          if (currentFile.path) {
            currentGroup.files.push({
              path: currentFile.path,
              description: currentFile.description || '',
            });
          }
          currentFile = {
            path: trimmed.split(':').slice(1).join(':').trim().replace(/^["']|["']$/g, ''),
          };
          continue;
        }

        if (trimmed.startsWith('description:')) {
          currentFile.description = trimmed.split(':').slice(1).join(':').trim().replace(/^["']|["']$/g, '');
          continue;
        }
      }
    }

    if (currentFile.path && currentGroup) {
      currentGroup.files.push({
        path: currentFile.path,
        description: currentFile.description || '',
      });
    }
    if (currentGroup) {
      filePlan.push(currentGroup);
    }

    return filePlan.length > 0 ? filePlan : undefined;
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

  // ==========================================================================
  // Private: Parallel Builder Planning
  // ==========================================================================

  /**
   * Plan parallel builder stages from architect's file plan
   */
  private planBuilderStages(filePlan: FilePlanGroup[] | undefined): ParallelBuilderPlan {
    // Fallback: single builder (current behavior)
    if (!filePlan || filePlan.length === 0) {
      return {
        hasFilePlan: false,
        stages: [{
          subPhase: 0,
          builders: [{
            agent: 'builder',
            group: 'all',
            files: [],
            availableFiles: [],
          }],
        }],
        totalFiles: 0,
        totalBuilders: 1,
      };
    }

    // Group by subPhase
    const subPhases = new Map<number, FilePlanGroup[]>();
    for (const group of filePlan) {
      const existing = subPhases.get(group.subPhase) || [];
      existing.push(group);
      subPhases.set(group.subPhase, existing);
    }

    // Create stages in order
    const stages: BuilderStage[] = [];
    const sortedPhases = [...subPhases.keys()].sort((a, b) => a - b);
    let availableFiles: string[] = [];
    let totalBuilders = 0;
    let totalFiles = 0;

    for (const phase of sortedPhases) {
      const groups = subPhases.get(phase)!;
      const builders: BuilderStage['builders'] = [];

      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        totalFiles += group.files.length;
        totalBuilders++;

        builders.push({
          agent: `builder-${phase}-${i}`,
          group: group.group,
          files: group.files,
          availableFiles: [...availableFiles],
        });
      }

      stages.push({
        subPhase: phase,
        builders,
      });

      // After this phase completes, its files become available to next phases
      for (const group of groups) {
        for (const file of group.files) {
          availableFiles.push(file.path);
        }
      }
    }

    return {
      hasFilePlan: true,
      stages,
      totalFiles,
      totalBuilders,
    };
  }

  /**
   * Build narrowed prompt for a parallel builder
   */
  private buildParallelBuilderPrompt(
    assignedFiles: FileAssignment[],
    availableFiles: string[],
    architectContext: string,
    groupName: string
  ): string {
    const parts: string[] = [];

    parts.push(`You are a BUILDER agent responsible for implementing the **${groupName}** group.`);
    parts.push('');
    parts.push('## Your Assignment');
    parts.push('');
    parts.push('### Files to Create:');
    for (const file of assignedFiles) {
      parts.push(`- \`${file.path}\`: ${file.description}`);
    }
    parts.push('');

    if (availableFiles.length > 0) {
      parts.push('### Available Files (already created):');
      parts.push('These files exist and you can import from them:');
      for (const file of availableFiles) {
        parts.push(`- \`${file}\``);
      }
      parts.push('');
    }

    if (architectContext) {
      parts.push('### Context from Architect:');
      parts.push(architectContext);
      parts.push('');
    }

    parts.push('### Instructions:');
    parts.push('1. Create ONLY the files assigned to you');
    parts.push('2. You can import from available files (already created)');
    parts.push('3. Follow existing patterns in the codebase');
    parts.push('4. Use the Paradigm logger (not console.log)');
    parts.push('5. End with the standard Agent Relay block');

    return parts.join('\n');
  }

  /**
   * Execute parallel builder stages
   * Sub-phases execute sequentially, builders within each sub-phase execute in parallel
   */
  private async runParallelBuilders(
    builderPlan: ParallelBuilderPlan,
    architectContext: string,
    options: OrchestrationOptions
  ): Promise<{
    success: boolean;
    results: SpawnResult[];
    totalTokens: TokenUsage;
    totalCost: number;
  }> {
    const results: SpawnResult[] = [];
    let totalTokens: TokenUsage = { input: 0, output: 0, total: 0 };
    let totalCost = 0;
    let success = true;

    for (const stage of builderPlan.stages) {
      // Check for checkpoint before sub-phase
      if (options.checkpoints?.beforeAgentSpawn && options.onCheckpoint) {
        const builderNames = stage.builders.map(b => b.group).join(', ');
        const approved = await options.onCheckpoint(
          `Builder Sub-phase ${stage.subPhase}: ${builderNames}${stage.builders.length > 1 ? ' (parallel)' : ''}`
        );
        if (!approved) {
          success = false;
          break;
        }
      }

      // Spawn all builders in this sub-phase in parallel
      const spawnPromises = stage.builders.map(async (builder) => {
        const taskPrompt = this.buildParallelBuilderPrompt(
          builder.files,
          builder.availableFiles,
          architectContext,
          builder.group
        );

        const spawnerOptions: SpawnerOptions = {
          model: 'haiku', // Builders always use haiku
          workingDirectory: options.workingDirectory || this.rootDir,
          mcpServerPath: options.mcpServerPath,
          budget: options.budget,
          onMessage: options.onMessage
            ? (msg) => options.onMessage!(builder.agent, msg)
            : undefined,
          onCheckpoint: options.onCheckpoint,
        };

        if (options.onAgentStart) {
          options.onAgentStart(builder.agent, `Implement ${builder.group}`);
        }

        // Spawn using 'builder' agent definition
        const result = await this.spawner.spawn('builder', taskPrompt, spawnerOptions);

        if (options.onAgentComplete) {
          options.onAgentComplete(builder.agent, result);
        }

        return { builder, result };
      });

      // Wait for all builders in this sub-phase to complete
      const stageResults = await Promise.all(spawnPromises);

      // Process results
      for (const { builder, result } of stageResults) {
        results.push(result);

        if (result.relay) {
          totalTokens.input += result.relay.metrics.tokens_used.input;
          totalTokens.output += result.relay.metrics.tokens_used.output;
          totalTokens.total += result.relay.metrics.tokens_used.total;
          totalCost += calculateCost(result.relay.metrics.tokens_used, 'haiku');
        }

        if (!result.success) {
          success = false;
        }
      }

      // If any builder in this sub-phase failed, stop
      if (!success) break;

      // Check for checkpoint after sub-phase completion
      if (options.checkpoints?.afterAgentComplete && options.onCheckpoint) {
        const approved = await options.onCheckpoint(
          `Sub-phase ${stage.subPhase} complete. Continue to next sub-phase?`
        );
        if (!approved) {
          break;
        }
      }
    }

    return { success, results, totalTokens, totalCost };
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
