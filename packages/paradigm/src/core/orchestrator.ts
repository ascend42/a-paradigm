/**
 * Orchestrator
 *
 * Coordinates multi-agent tasks using the Conductor pattern.
 * Supports both "faceted" (multi-agent) and "solo" (single agent) modes.
 */

import { minimatch } from 'minimatch';
import {
  AgentModel,
  AgentMessage,
  calculateCost,
  TokenUsage,
} from './agent-provider.js';
import { AgentSpawner, SpawnResult, SpawnerOptions } from './agent-spawner.js';
import { extractSymbols } from './context-builder.js';
import { AuditLogger, OrchestrationLog } from './audit-logger.js';
import { loadAgentsManifest } from '../commands/team/loader.js';
import {
  FilePlanGroup,
  FileAssignment,
} from './agent-prompts.js';
import {
  classifyTask,
  getRecommendedModel,
} from './task-classifier.js';
import { suggestAgentsForTask } from './agent-matcher.js';
import {
  runPreflight,
  runPostflight,
  type PreflightResult,
  type PostflightResult,
} from './pm-compliance.js';
import { buildSymbolIndex } from '@a-company/premise-core';
import {
  IterationDelta,
  IterationOptions,
  IterationLoopResult,
  IterationRoundResult,
} from './iteration-types.js';
import { appendIterationRevision, generateRevisionId } from './iteration-revision-log.js';
import {
  bridgeRunStart,
  bridgeStageProgress,
  bridgeStageComplete,
  type BridgeStage,
  type BridgeHandle,
} from './task-bridge.js';
import { recordEstimateActual } from './calibration.js';

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
  onAgentStart?: (agentName: string, task: string, model: AgentModel) => void;
  /** Agent completed callback */
  onAgentComplete?: (agentName: string, result: SpawnResult, model: AgentModel) => void;
  /** PM governance configuration */
  pmGovernance?: {
    enabled: boolean;
    blockOnViolations?: boolean;
  };
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
  /** PM compliance report (when PM governance is enabled) */
  complianceReport?: {
    preflight: PreflightResult;
    postflight?: PostflightResult;
  };
  /** Re-review iteration outcome (when the faceted pipeline escalated builder↔reviewer
   *  into an iteration loop). Surfaced, not blocking — an unconverged loop does not
   *  flip `success`, since the reviewer stage is itself non-required. */
  iterationOutcome?: {
    converged: boolean;
    roundsRun: number;
    openThreads: string[];
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
// Security Escalation Detection
// ============================================================================

/**
 * Keywords that trigger automatic security agent involvement
 * Language-agnostic - works across all codebases
 */
const SECURITY_ESCALATION_KEYWORDS = [
  'auth',
  'permission',
  'admin',
  'delete',
  'purge',
  'password',
  'credential',
  'token',
  'secret',
  'key',
  'encrypt',
  'decrypt',
  'hash',
  'session',
  'oauth',
  'jwt',
  'role',
  'access control',
  'vulnerability',
  'injection',
  'xss',
  'csrf',
];

/**
 * Directory patterns that contain security-sensitive code
 * Works across all languages - directory-based, not extension-based
 */
const SECURITY_ESCALATION_PATHS = [
  '**/auth/**',
  '**/middleware/**',
  '**/security/**',
  '**/gates/**',
  '**/guards/**',
  '**/policies/**',
  '**/permissions/**',
  '**/admin/**',
];

/**
 * Determine if security agent should be escalated to required status
 * @param task - Task description
 * @param affectedFiles - Files that might be affected by this task
 * @returns Whether security should be escalated
 */
function shouldEscalateSecurity(task: string, affectedFiles?: string[]): boolean {
  const taskLower = task.toLowerCase();

  // Check for security keywords in task
  const hasKeyword = SECURITY_ESCALATION_KEYWORDS.some(k =>
    taskLower.includes(k.toLowerCase())
  );

  // Check for gate symbols in task (Paradigm convention)
  const hasGateSymbol = task.includes('^');

  // Check for sensitive file paths
  let hasSensitivePath = false;
  if (affectedFiles) {
    hasSensitivePath = affectedFiles.some(file =>
      SECURITY_ESCALATION_PATHS.some(pattern => minimatch(file, pattern))
    );
  }

  return hasKeyword || hasGateSymbol || hasSensitivePath;
}

// ============================================================================
// Refactoring Detection
// ============================================================================

/**
 * Keywords that indicate a refactoring task
 */
const REFACTOR_KEYWORDS = ['rename', 'refactor', 'migrate', 'restructure', 'move', 'reorganize'];

/**
 * Check if task is a refactoring task that needs ripple analysis
 */
function isRefactoringTask(task: string): boolean {
  const taskLower = task.toLowerCase();
  return REFACTOR_KEYWORDS.some(k => taskLower.includes(k));
}

// ============================================================================
// Orchestrator
// ============================================================================

export class Orchestrator {
  private spawner: AgentSpawner;
  private auditLogger: AuditLogger;
  private rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.spawner = new AgentSpawner(rootDir);
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
      // PM Governance: Pre-flight
      let preflightResult: PreflightResult | undefined;
      if (options.pmGovernance?.enabled) {
        try {
          const { aggregateFromDirectory } = await import('@a-company/premise-core');
          const aggregation = await aggregateFromDirectory(this.rootDir);
          const index = buildSymbolIndex(aggregation);
          preflightResult = runPreflight(task, this.rootDir, index);
        } catch {
          // Pre-flight is best-effort — don't block orchestration
        }
      }

      if (mode === 'solo') {
        const soloResult = await this.runSoloMode(task, options, orchestrationId);
        result.agentsSpawned = 1;
        result.agentResults = [soloResult];
        result.success = soloResult.success;
        if (soloResult.relay) {
          result.totalTokens = soloResult.relay.metrics.tokens_used;
          result.totalCost = calculateCost(result.totalTokens, options.orchestratorModel || 'opus');
        }
      } else {
        const facetedResult = await this.runFacetedMode(task, options, orchestrationId);
        result.agentsSpawned = facetedResult.results.length;
        result.agentResults = facetedResult.results;
        result.totalTokens = facetedResult.totalTokens;
        result.totalCost = facetedResult.totalCost;
        result.success = facetedResult.success;
        result.parallelBuilderStats = facetedResult.parallelBuilderStats;
        result.iterationOutcome = facetedResult.iterationOutcome;
      }

      // PM Governance: Post-flight
      if (options.pmGovernance?.enabled && preflightResult) {
        try {
          const { aggregateFromDirectory } = await import('@a-company/premise-core');
          const aggregation = await aggregateFromDirectory(this.rootDir);
          const index = buildSymbolIndex(aggregation);

          // Collect files and symbols from agent results
          const filesModified: string[] = [];
          const symbolsTouched: string[] = [];
          for (const agentResult of result.agentResults) {
            if (agentResult.relay?.outputs?.artifacts) {
              filesModified.push(...agentResult.relay.outputs.artifacts.map(a => a.path));
            }
          }
          // Extract symbols from preflight
          for (const sym of preflightResult.affectedSymbols) {
            symbolsTouched.push(sym.symbol);
          }

          const postflightResult = runPostflight(filesModified, symbolsTouched, this.rootDir, index);

          result.complianceReport = {
            preflight: preflightResult,
            postflight: postflightResult,
          };

          // Block on violations if configured
          if (options.pmGovernance.blockOnViolations && postflightResult.blocksCompletion) {
            result.success = false;
          }
        } catch {
          // Post-flight is best-effort
          result.complianceReport = { preflight: preflightResult };
        }
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
    options: OrchestrationOptions,
    orchestrationId?: string
  ): Promise<SpawnResult> {
    // In solo mode, spawn a single "generalist" agent
    const manifest = loadAgentsManifest(this.rootDir);

    // Use architect as the solo agent, or fallback to first available
    const agentName = manifest?.team.default_agent || 'architect';
    const model = options.orchestratorModel || 'opus';

    // Task-bridge (#task-bridge): emit a one-stage epic so a solo CLI run still
    // settles + fires the learning chain. Best-effort — never breaks the run.
    let bridge: BridgeHandle | undefined;
    if (orchestrationId) {
      bridge = await bridgeRunStart(this.rootDir, orchestrationId, task, [
        { agent: agentName, stage: 0, subtask: task, dependsOn: [] },
      ]);
    }
    const soloTaskId = bridge?.stageTaskIds.get(agentName);

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
      options.onAgentStart('solo', task, model);
    }
    await bridgeStageProgress(this.rootDir, soloTaskId);

    const result = await this.spawner.spawn(agentName, task, spawnerOptions);

    if (options.onAgentComplete) {
      options.onAgentComplete('solo', result, model);
    }
    // Calibration capture (#calibration): record the solo agent's ACTUAL token
    // spend keyed by (archetype, taskType). Best-effort — never alters the run.
    if (result.relay) {
      recordEstimateActual(this.rootDir, {
        archetype: agentName,
        taskType: classifyTask(task).type,
        actualTokens: result.relay.metrics.tokens_used,
        parentTaskId: bridge?.epicTaskId,
      });
    }
    // Completing the only stage child settles the epic (→ learning chain).
    await bridgeStageComplete(this.rootDir, soloTaskId, result.success ? 'success' : 'failure');

    return result;
  }

  // ==========================================================================
  // Private: Faceted Mode
  // ==========================================================================

  private async runFacetedMode(
    task: string,
    options: OrchestrationOptions,
    orchestrationId?: string
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
    iterationOutcome?: {
      converged: boolean;
      roundsRun: number;
      openThreads: string[];
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

    // Task classification family — keys the calibration capture (#calibration)
    // alongside each agent's archetype.
    const facetedTaskType = classifyTask(task).type;

    // Auto-ripple for refactoring tasks
    let rippleContext = '';
    if (isRefactoringTask(task)) {
      const symbols = extractSymbols(task);
      if (symbols.length > 0) {
        // Build ripple analysis context for architect
        const rippleResults: string[] = [];
        rippleResults.push('## Auto-Ripple Analysis\n');
        rippleResults.push('The following symbols are affected by this refactoring:');
        rippleResults.push('');
        for (const symbol of symbols.slice(0, 5)) { // Limit to 5 symbols
          rippleResults.push(`- **${symbol}**: Check dependencies before renaming/moving`);
        }
        rippleResults.push('');
        rippleResults.push('**Recommendation:** Run `paradigm_ripple` for each symbol before making changes.');
        rippleContext = rippleResults.join('\n');
      }
    }

    // Analyze task to determine agent sequence with parallel stages
    const agentPlan = this.planAgentSequence(task, manifest.agents);
    const stages = this.groupByStage(agentPlan);

    // Task-bridge (#task-bridge): emit the orchestration task DAG (epic + one
    // child per stage-agent) so a faceted CLI run settles + fires the learning
    // chain when its last stage child completes. Best-effort — a bridge failure
    // returns an empty handle and never breaks orchestration.
    let bridge: BridgeHandle | undefined;
    if (orchestrationId) {
      const bridgeStages: BridgeStage[] = agentPlan.map(p => ({
        agent: p.agent,
        stage: p.stage,
        subtask: p.subtask,
        dependsOn: p.dependsOn,
      }));
      bridge = await bridgeRunStart(this.rootDir, orchestrationId, task, bridgeStages);
    }
    // Agents whose stage task we've already terminal-stamped — so the
    // finalizer can shelve any that never ran (early break on failure).
    const bridgeStamped = new Set<string>();

    const results: SpawnResult[] = [];
    let totalTokens: TokenUsage = { input: 0, output: 0, total: 0 };
    let totalCost = 0;
    let handoffContexts: Map<string, string> = new Map();
    let success = true;

    // Re-review iteration: when enabled and the plan has both builder + reviewer,
    // the reviewer is asked for a typed verdict; a `changes-requested` verdict
    // escalates into a builder↔reviewer iteration loop after the stage pass.
    const iterationCfg = manifest.orchestration?.iteration;
    const iterationEnabled = iterationCfg?.enabled === true;
    const builderSubtask = agentPlan.find(p => p.agent === 'builder')?.subtask;
    const hasReviewer = agentPlan.some(p => p.agent === 'reviewer');
    const hasTester = agentPlan.some(p => p.agent === 'tester');
    const reviewIterationActive = iterationEnabled && !!builderSubtask && hasReviewer;
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
        // Priority: budget constraints > plan-specified model > defaults
        const model: AgentModel =
          options.agentBudgets?.[step.agent]?.maxTokens
            ? 'haiku' // Use cheaper model if budget-constrained
            : (step as any).model || DEFAULT_AGENT_MODELS[step.agent] || 'sonnet';

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
        // Add ripple context for architect if this is a refactoring task
        let additionalContext = handoffContext;
        if (step.agent === 'architect' && rippleContext) {
          additionalContext = rippleContext + (handoffContext ? '\n\n---\n\n' + handoffContext : '');
        }

        let taskWithContext = additionalContext
          ? `${step.subtask}\n\n## Context from previous agents:\n${additionalContext}`
          : step.subtask;

        // When re-review iteration is active, the reviewer must emit a typed
        // verdict block so the post-stage escalation gate can read it.
        if (reviewIterationActive && step.agent === 'reviewer') {
          taskWithContext = `${taskWithContext}\n\n${ITERATION_VERDICT_INSTRUCTION}`;
        }

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
          options.onAgentStart(step.agent, step.subtask, model);
        }
        // Flip this stage's task → in-progress (best-effort).
        await bridgeStageProgress(this.rootDir, bridge?.stageTaskIds.get(step.agent));

        // Spawn agent
        const result = await this.spawner.spawn(step.agent, taskWithContext, spawnerOptions);

        if (options.onAgentComplete) {
          options.onAgentComplete(step.agent, result, model);
        }
        // Terminal-stamp this stage's task — when the last child settles, the
        // epic settles and the learning chain fires (best-effort).
        await bridgeStageComplete(
          this.rootDir,
          bridge?.stageTaskIds.get(step.agent),
          result.success ? 'success' : 'failure',
        );
        bridgeStamped.add(step.agent);

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

          // Calibration capture (#calibration): record this agent's ACTUAL token
          // spend keyed by (archetype, taskType) so `paradigm calibrate` can
          // learn the planner's estimate table. Best-effort — never alters the run.
          recordEstimateActual(this.rootDir, {
            archetype: step.agent,
            taskType: facetedTaskType,
            actualTokens: result.relay.metrics.tokens_used,
            parentTaskId: bridge?.epicTaskId,
          });

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
                // The single 'builder' stage task is replaced by the parallel
                // builders, so it will never spawn through the normal path.
                // Terminal-stamp it here so its epic can still settle.
                await bridgeStageComplete(
                  this.rootDir,
                  bridge?.stageTaskIds.get('builder'),
                  parallelResult.success ? 'success' : 'failure',
                );
                bridgeStamped.add('builder');
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

    // Re-review escalation: if the reviewer returned a `changes-requested`
    // verdict, run a bounded builder↔reviewer iteration loop to converge.
    let iterationOutcome: OrchestrationResult['iterationOutcome'];
    if (reviewIterationActive && success) {
      const reviewerResult = [...results].reverse().find(r => r.relay?.agent === 'reviewer');
      const reviewVerdict = reviewerResult ? this.parseIterationVerdict(reviewerResult) : null;
      if (reviewVerdict?.verdict === 'changes-requested') {
        const escalation = await this.runReviewIteration({
          builderSubtask: builderSubtask!,
          firstReview: reviewVerdict,
          hasTester,
          maxRoundsConfig: iterationCfg?.defaultMaxRounds ?? 3,
          options,
        });
        results.push(...escalation.extraResults);
        totalTokens.input += escalation.extraTokens.input;
        totalTokens.output += escalation.extraTokens.output;
        totalTokens.total += escalation.extraTokens.total;
        totalCost += escalation.extraCost;
        iterationOutcome = escalation.iterationOutcome;
      } else if (reviewerResult && !reviewVerdict && options.onMessage) {
        // Reviewer ran but emitted no parseable verdict — the loop can't fire.
        // Surface it so a missing/garbled verdict block is diagnosable.
        options.onMessage('orchestrator', {
          type: 'text',
          content: '[iteration] reviewer produced no parseable iteration-verdict — re-review loop not triggered.',
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Task-bridge finalizer (#task-bridge): any stage task that never ran (early
    // break on a failed required agent, or a declined checkpoint) is still
    // non-terminal and would block epic settlement. Shelve those leftovers so the
    // epic's sibling-set becomes wholly terminal and the learning chain fires
    // even on a partial/failed run. Best-effort — never throws.
    if (bridge) {
      for (const [agent, taskId] of bridge.stageTaskIds) {
        if (bridgeStamped.has(agent)) continue;
        await bridgeStageComplete(this.rootDir, taskId, 'failure');
      }
    }

    return { success, results, totalTokens, totalCost, parallelBuilderStats, iterationOutcome };
  }

  /**
   * Run the builder↔reviewer re-review loop after a `changes-requested` verdict,
   * folding rounds (and a single post-convergence tester re-run) into extras.
   */
  private async runReviewIteration(params: {
    builderSubtask: string;
    firstReview: IterationDelta;
    hasTester: boolean;
    maxRoundsConfig: number;
    options: OrchestrationOptions;
  }): Promise<{
    extraResults: SpawnResult[];
    extraTokens: TokenUsage;
    extraCost: number;
    iterationOutcome: { converged: boolean; roundsRun: number; openThreads: string[] };
  }> {
    const { builderSubtask, firstReview, hasTester, maxRoundsConfig, options } = params;

    // Ping-pong converges only on an even (reviewer) round — force even.
    const maxRounds = maxRoundsConfig % 2 === 0 ? maxRoundsConfig : maxRoundsConfig + 1;

    // Seed round 1 (builder) with the original work + the first review's asks.
    const seedParts = [builderSubtask];
    if (firstReview.openThreads.length) {
      seedParts.push('', '## Reviewer asked you to resolve:', ...firstReview.openThreads.map(s => `- ${s}`));
    }
    if (firstReview.whatChanged.length) {
      seedParts.push('', '## Reviewer notes:', ...firstReview.whatChanged.map(s => `- ${s}`));
    }

    // Mirror the main pass's model/budget policy so iteration honors the same
    // budget downgrade and cost is attributed to the model actually used.
    const resolveModel = (agent: string): AgentModel =>
      options.agentBudgets?.[agent]?.maxTokens ? 'haiku' : (DEFAULT_AGENT_MODELS[agent] || 'sonnet');
    const resolveBudget = (agent: string) => options.agentBudgets?.[agent] || options.budget;

    const loop = await this.runIterationLoop(seedParts.join('\n'), {
      maxRounds,
      mode: 'ping-pong',
      iterateAgent: 'builder',
      reviewAgent: 'reviewer',
      workingDirectory: options.workingDirectory || this.rootDir,
      mcpServerPath: options.mcpServerPath,
      resolveModel,
      resolveBudget,
      onRound: options.onAgentComplete
        ? (r) => options.onAgentComplete!(r.agent, r.spawnResult, resolveModel(r.agent))
        : undefined,
    });

    const extraResults: SpawnResult[] = loop.rounds.map(r => r.spawnResult);
    let extraCost = 0;
    for (const r of loop.rounds) {
      if (r.spawnResult.relay) {
        extraCost += calculateCost(r.spawnResult.relay.metrics.tokens_used, resolveModel(r.agent));
      }
    }

    // Re-run the tester once against the converged code (the parallel tester in
    // the main pass saw the pre-fix code).
    if (hasTester && loop.converged) {
      const testerResult = await this.spawner.spawn(
        'tester',
        `Re-test after re-review convergence:\n${builderSubtask}`,
        {
          model: 'haiku',
          workingDirectory: options.workingDirectory || this.rootDir,
          mcpServerPath: options.mcpServerPath,
        },
      );
      extraResults.push(testerResult);
      if (testerResult.relay) {
        extraCost += calculateCost(testerResult.relay.metrics.tokens_used, 'haiku');
        loop.totalTokens.input += testerResult.relay.metrics.tokens_used.input;
        loop.totalTokens.output += testerResult.relay.metrics.tokens_used.output;
        loop.totalTokens.total += testerResult.relay.metrics.tokens_used.total;
      }
    }

    return {
      extraResults,
      extraTokens: loop.totalTokens,
      extraCost,
      iterationOutcome: {
        converged: loop.converged,
        roundsRun: loop.rounds.length,
        openThreads: loop.unresolved?.openThreads ?? [],
      },
    };
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
   *
   * Uses task classification for intelligent agent selection:
   * - Analysis tasks: Architect only
   * - Documentation tasks: Architect only
   * - Bug fixes: Security + Builder
   * - Refactoring: Architect + Builder (with auto-ripple)
   * - Features: Full team as needed
   */
  private planAgentSequence(
    task: string,
    agents: Record<string, any>
  ): Array<{ agent: string; subtask: string; required: boolean; stage: number; dependsOn: string[]; model?: AgentModel }> {
    const symbols = extractSymbols(task);
    const taskLower = task.toLowerCase();

    // Classify the task for intelligent agent selection
    const classification = classifyTask(task);

    // Build plan with dependency information
    const plan: Array<{ agent: string; subtask: string; required: boolean; stage: number; dependsOn: string[]; model?: AgentModel }> = [];

    // Check for security escalation
    const securityEscalated = shouldEscalateSecurity(task);

    // Use classification-based agent selection for certain task types
    if (classification.type === 'analysis') {
      // Analysis tasks: Architect only
      if (agents['architect']) {
        plan.push({
          agent: 'architect',
          subtask: `Analyze and recommend: ${task}`,
          required: true,
          stage: 0,
          dependsOn: [],
          model: 'opus',
        });
      }
      return plan;
    }

    if (classification.type === 'documentation') {
      // Documentation tasks: Architect only (for consistency and quality)
      if (agents['architect']) {
        plan.push({
          agent: 'architect',
          subtask: `Document: ${task}`,
          required: true,
          stage: 0,
          dependsOn: [],
          model: 'sonnet', // Sonnet is sufficient for documentation
        });
      }
      return plan;
    }

    // Stage 0: Independent analysis agents (can run in parallel)
    const hasDesign = taskLower.includes('design') || taskLower.includes('architect') ||
                      taskLower.includes('plan') || taskLower.includes('spec');
    const hasSecurity = securityEscalated || taskLower.includes('auth') || taskLower.includes('security') ||
                        taskLower.includes('gate') || symbols.some((s) => s.startsWith('^'));

    if (hasDesign && agents['architect']) {
      plan.push({
        agent: 'architect',
        subtask: `Design and specify: ${task}`,
        required: true,
        stage: 0,
        dependsOn: [],
        model: 'opus',
      });
    }

    if (hasSecurity && agents['security']) {
      plan.push({
        agent: 'security',
        subtask: `Review security aspects of: ${task}`,
        // Security is REQUIRED when escalated, optional otherwise
        required: securityEscalated,
        stage: 0,  // Can run parallel with architect
        dependsOn: [],
        // Use opus for escalated security reviews
        model: securityEscalated ? 'opus' : 'opus',
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
        model: 'haiku',
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
        model: 'sonnet',
      });
    }

    if (hasTest && agents['tester']) {
      plan.push({
        agent: 'tester',
        subtask: `Test and validate: ${task}`,
        required: false,
        stage: reviewStage,  // Can run parallel with reviewer
        dependsOn: builderInPlan ? ['builder'] : [],
        model: 'haiku',
      });
    }

    // If no specific agents matched, use classification-guided defaults
    if (plan.length === 0) {
      // Use recommended agents from classification
      const recommendedAgents = classification.recommendedAgents;

      if (recommendedAgents.includes('architect') && agents['architect']) {
        plan.push({
          agent: 'architect',
          subtask: `Design: ${task}`,
          required: true,
          stage: 0,
          dependsOn: [],
          model: getRecommendedModel('architect', classification),
        });
      }

      // Add security if recommended or escalated
      if ((recommendedAgents.includes('security') || securityEscalated) && agents['security']) {
        plan.push({
          agent: 'security',
          subtask: `Security review: ${task}`,
          required: securityEscalated,
          stage: 0,
          dependsOn: [],
          model: 'opus',
        });
      }

      if (recommendedAgents.includes('builder') && agents['builder']) {
        const hasPreviousStage = plan.length > 0;
        plan.push({
          agent: 'builder',
          subtask: `Implement: ${task}`,
          required: true,
          stage: hasPreviousStage ? 1 : 0,
          dependsOn: plan.filter(p => p.stage === 0).map(p => p.agent),
          model: getRecommendedModel('builder', classification),
        });
      }

      if (recommendedAgents.includes('tester') && agents['tester']) {
        const builderStage = plan.find(p => p.agent === 'builder')?.stage ?? 0;
        plan.push({
          agent: 'tester',
          subtask: `Test: ${task}`,
          required: false,
          stage: builderStage + 1,
          dependsOn: agents['builder'] ? ['builder'] : [],
          model: getRecommendedModel('tester', classification),
        });
      }
    }

    // ── Matcher-primary roster reachability (T-003) ──
    // The static keyword/classification path above only ever reaches the core
    // five archetypes (architect/security/builder/reviewer/tester). Any other
    // INSTALLED agent (product/North, forge/Loid, researcher/Scout, dx/Helix,
    // …) was unreachable by the auto-router. Use agent-matcher as the primary
    // suggestion source against the full installed roster: append any matched
    // agent not already in the plan as an optional final-stage contributor so
    // auto-orchestration can assemble its best team without a hand-authored
    // brief. Non-breaking: this widens the plan, it never removes a core stage.
    try {
      const suggestions = suggestAgentsForTask(task, agents);
      const alreadyPlanned = new Set(plan.map(p => p.agent));
      // Reserve documentor for the dedicated post-pass; never auto-add here.
      const reserved = new Set(['documentor']);
      const maxStage = plan.length > 0 ? Math.max(...plan.map(p => p.stage)) : -1;
      const suggestionStage = maxStage + 1;
      const dependsOnPlan = plan.map(p => p.agent);

      for (const s of suggestions) {
        if (alreadyPlanned.has(s.name)) continue;
        if (reserved.has(s.name)) continue;
        if (!agents[s.name]) continue; // only route INSTALLED agents
        // Only route reasonably-confident matches so a single stray keyword
        // doesn't drag the whole roster in.
        if (s.confidence === 'low') continue;

        const def = agents[s.name] as { focus?: string; defaultModel?: AgentModel } | undefined;
        plan.push({
          agent: s.name,
          subtask: `Contribute (${def?.focus ?? 'specialist'}): ${task}`,
          required: false,
          stage: suggestionStage,
          dependsOn: dependsOnPlan,
          model: def?.defaultModel ?? 'sonnet',
        });
        alreadyPlanned.add(s.name);
      }
    } catch {
      // Matcher augmentation is non-fatal — the static plan still stands.
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
          options.onAgentStart(builder.agent, `Implement ${builder.group}`, 'haiku');
        }

        // Spawn using 'builder' agent definition
        const result = await this.spawner.spawn('builder', taskPrompt, spawnerOptions);

        if (options.onAgentComplete) {
          options.onAgentComplete(builder.agent, result, 'haiku');
        }

        return { builder, result };
      });

      // Wait for all builders in this sub-phase to complete
      const stageResults = await Promise.all(spawnPromises);

      // Process results
      for (const { result } of stageResults) {
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

  // ==========================================================================
  // Public: Stateless Iteration Loop (TD-2026-06-09-522)
  // ==========================================================================

  /**
   * Run the SAME specialist across multiple rounds (re-review / iterate-with-
   * same-role) WITHOUT warm/persistent subagents. Each round is a fresh spawn;
   * continuity is carried by a typed `IterationDelta` threaded into the task.
   *
   * Three guardrails:
   *  1. Convergence is read from the agent's TYPED `iteration-verdict` block —
   *     never inferred from free-text prose.
   *  2. `maxRounds` is required; exhausting it yields a structured `unresolved`
   *     result. The last attempt is NEVER returned as a pass.
   *  3. Belief revisions are promoted to the learning loop at each round
   *     boundary, gated on `corrections` (actual belief change), not progress.
   *
   * @param promoteRevision Test seam. Defaults to the durable iteration-revision
   *   writer (mandatory by default — guardrail #3). Injectable for unit tests.
   */
  async runIterationLoop(
    task: string,
    opts: IterationOptions,
    promoteRevision?: (record: { agent: string; corrections: string[]; symbols: string[]; round: number }) => void,
  ): Promise<IterationLoopResult> {
    // Fail fast — no silent infinite loop, no silently-missing review agent.
    if (!Number.isInteger(opts.maxRounds) || opts.maxRounds < 1) {
      throw new Error(`runIterationLoop: maxRounds must be an integer >= 1 (got ${opts.maxRounds})`);
    }
    if (opts.mode === 'ping-pong' && !opts.reviewAgent) {
      throw new Error('runIterationLoop: ping-pong mode requires reviewAgent');
    }

    const promote = promoteRevision ?? ((record: { agent: string; corrections: string[]; symbols: string[]; round: number }) =>
      appendIterationRevision(this.rootDir, {
        id: generateRevisionId(record.agent, record.round),
        agent: record.agent,
        corrections: record.corrections,
        symbols: record.symbols,
        round: record.round,
      }));

    const rounds: IterationRoundResult[] = [];
    const totalTokens: TokenUsage = { input: 0, output: 0, total: 0 };
    let prevDelta: IterationDelta | null = null;
    let finalDelta: IterationDelta | null = null;

    for (let round = 1; round <= opts.maxRounds; round++) {
      const agent = this.iterationAgentForRound(opts, round);
      const roundTask = this.buildIterationTask(task, prevDelta, round);

      const spawnerOptions: SpawnerOptions = {
        workingDirectory: opts.workingDirectory || this.rootDir,
        mcpServerPath: opts.mcpServerPath,
        model: opts.resolveModel?.(agent),
        budget: opts.resolveBudget?.(agent),
      };

      const spawnResult = await this.spawner.spawn(agent, roundTask, spawnerOptions);

      if (spawnResult.relay) {
        totalTokens.input += spawnResult.relay.metrics.tokens_used.input;
        totalTokens.output += spawnResult.relay.metrics.tokens_used.output;
        totalTokens.total += spawnResult.relay.metrics.tokens_used.total;
      }

      const delta = this.parseIterationVerdict(spawnResult);
      if (delta) finalDelta = delta;

      // Belief-revision promotion (guardrail #3) — fires BEFORE the stop check
      // so a converging round still externalizes what it learned.
      let promoted = false;
      if (this.beliefRevised(delta, prevDelta)) {
        const corrections = delta!.corrections.length > 0
          ? delta!.corrections
          : this.reopenedClaims(delta!, prevDelta);
        promote({
          agent,
          corrections,
          symbols: spawnResult.relay?.outputs.symbols ?? [],
          round,
        });
        promoted = true;
      }

      const roundResult: IterationRoundResult = { round, agent, spawnResult, delta, promoted };
      rounds.push(roundResult);
      opts.onRound?.(roundResult);

      // Stop conditions — every non-converged exit is structured `unresolved`.
      if (!spawnResult.success) {
        return this.unresolvedResult(rounds, finalDelta, totalTokens, 'spawn-failed', round);
      }
      if (delta === null) {
        return this.unresolvedResult(rounds, finalDelta, totalTokens, 'unparseable-verdict', round);
      }
      if (this.isConverged(delta, opts, agent)) {
        return { converged: true, rounds, finalDelta: delta, totalTokens };
      }

      prevDelta = delta;
    }

    // Cap reached without convergence.
    return this.unresolvedResult(rounds, finalDelta, totalTokens, 'max-rounds', opts.maxRounds);
  }

  private unresolvedResult(
    rounds: IterationRoundResult[],
    finalDelta: IterationDelta | null,
    totalTokens: TokenUsage,
    reason: 'max-rounds' | 'unparseable-verdict' | 'spawn-failed',
    roundsRun: number,
  ): IterationLoopResult {
    return {
      converged: false,
      rounds,
      finalDelta,
      totalTokens,
      unresolved: { reason, roundsRun, openThreads: finalDelta?.openThreads ?? [] },
    };
  }

  /** single-role → always iterateAgent; ping-pong → odd=fix, even=re-review. */
  private iterationAgentForRound(opts: IterationOptions, round: number): string {
    if (opts.mode === 'single-role') return opts.iterateAgent;
    return round % 2 === 1 ? opts.iterateAgent : (opts.reviewAgent as string);
  }

  /**
   * Converged iff the agent approved. In single-role mode self-approval is weak
   * signal, so additionally require no open threads remain. In ping-pong, only
   * the REVIEW agent's approval is authoritative — a fixer self-approving (e.g.
   * on an odd final round) must NOT end the loop without reviewer sign-off.
   */
  private isConverged(delta: IterationDelta, opts: IterationOptions, agent: string): boolean {
    if (delta.verdict !== 'approved') return false;
    if (opts.mode === 'single-role') return delta.openThreads.length === 0;
    return agent === opts.reviewAgent;
  }

  /** Settled (`alreadyVerified`) claims from `prev` that re-appear in this round's `whatChanged`. */
  private reopenedClaims(delta: IterationDelta, prev: IterationDelta | null): string[] {
    if (!prev) return [];
    return delta.whatChanged.filter(c => prev.alreadyVerified.includes(c));
  }

  /**
   * Belief changed iff the round reported explicit corrections, OR a previously
   * settled claim was re-opened. Progress alone (`whatChanged` non-empty) is
   * deliberately NOT the gate.
   */
  private beliefRevised(delta: IterationDelta | null, prev: IterationDelta | null): boolean {
    if (!delta) return false;
    if (delta.corrections.length > 0) return true;
    return this.reopenedClaims(delta, prev).length > 0;
  }

  /** Build the round task: original task + serialized prior delta + verdict-block instruction. */
  private buildIterationTask(task: string, prevDelta: IterationDelta | null, round: number): string {
    const parts: string[] = [task];

    if (prevDelta) {
      parts.push('', `## Iteration delta (entering round ${round})`);
      parts.push(`- Verdict so far: ${prevDelta.verdict}`);
      if (prevDelta.whatChanged.length) {
        parts.push('- Changed last round:', ...prevDelta.whatChanged.map(s => `  - ${s}`));
      }
      if (prevDelta.alreadyVerified.length) {
        parts.push('- Already verified (do NOT re-litigate):', ...prevDelta.alreadyVerified.map(s => `  - ${s}`));
      }
      if (prevDelta.openThreads.length) {
        parts.push('- Open threads to resolve:', ...prevDelta.openThreads.map(s => `  - ${s}`));
      }
    }

    parts.push('', ITERATION_VERDICT_INSTRUCTION);

    return parts.join('\n');
  }

  /**
   * Extract the typed iteration verdict from a spawn result. Deterministic parse
   * of a tagged fenced block — NOT prose scraping. Returns null when no valid
   * block is present (caller treats null as a non-converged failure).
   *
   * Scans `rawResponse` (the agent's final text, surfaced by the spawner) LAST,
   * after the structured handoff/decisions surfaces.
   */
  private parseIterationVerdict(result: SpawnResult): IterationDelta | null {
    if (!result.relay) return null;
    const haystacks: string[] = [];
    if (result.relay.handoff?.context) haystacks.push(result.relay.handoff.context);
    if (result.relay.outputs?.decisions?.length) haystacks.push(result.relay.outputs.decisions.join('\n'));
    if (result.relay.rawResponse) haystacks.push(result.relay.rawResponse);
    for (const text of haystacks) {
      const parsed = extractIterationVerdictBlock(text);
      if (parsed) return parsed;
    }
    return null;
  }
}

/**
 * Shared instruction telling an agent to emit the typed verdict block. Used by
 * `buildIterationTask` (loop rounds) AND the round-0 reviewer task in faceted
 * mode (so the escalation gate can read the reviewer's verdict). One source so
 * the contract can't drift between the two call sites.
 */
export const ITERATION_VERDICT_INSTRUCTION = [
  '## Required: end with an iteration-verdict block',
  'After your work, append a fenced block tagged `iteration-verdict` with JSON:',
  '```iteration-verdict',
  '{',
  '  "verdict": "approved" | "changes-requested",',
  '  "whatChanged": ["progress made this round"],',
  '  "alreadyVerified": ["settled claims; do not revisit"],',
  '  "openThreads": ["unresolved items for the next round"],',
  '  "corrections": ["only genuine belief revisions: was X, now Y"]',
  '}',
  '```',
  'Use "approved" only when no open threads remain. Leave "corrections" empty if nothing you previously believed changed.',
].join('\n');

/**
 * Parse a fenced ```iteration-verdict JSON block into an IterationDelta.
 * Returns null on a missing block, malformed JSON, or an invalid verdict value.
 *
 * Matches the LAST such block in the text: an agent typically echoes the
 * instruction's placeholder template (invalid JSON) before emitting its real
 * trailing block, so first-match would hit the echoed template and mask the
 * genuine verdict.
 */
function extractIterationVerdictBlock(text: string): IterationDelta | null {
  const matches = [...text.matchAll(/```iteration-verdict\s*\n([\s\S]*?)```/g)];
  if (matches.length === 0) return null;
  // Walk from the last block backward — return the last one that parses cleanly.
  for (let i = matches.length - 1; i >= 0; i--) {
    try {
      const raw = JSON.parse(matches[i][1].trim()) as Partial<IterationDelta>;
      if (raw.verdict !== 'approved' && raw.verdict !== 'changes-requested') continue;
      return {
        verdict: raw.verdict,
        whatChanged: Array.isArray(raw.whatChanged) ? raw.whatChanged : [],
        alreadyVerified: Array.isArray(raw.alreadyVerified) ? raw.alreadyVerified : [],
        openThreads: Array.isArray(raw.openThreads) ? raw.openThreads : [],
        corrections: Array.isArray(raw.corrections) ? raw.corrections : [],
      };
    } catch {
      continue;
    }
  }
  return null;
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
