/**
 * Agent Spawner
 *
 * Spawns AI agents using the registered provider.
 * Handles context injection, budget tracking, and session management.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
  AgentProvider,
  AgentModel,
  AgentMessage,
  AgentRelay,
  SpawnOptions,
  FacetConfig,
  CheckpointConfig,
  calculateCost,
  TokenUsage,
} from './agent-provider.js';
import { getProvider, initializeProviders } from './provider-registry.js';
import { buildAgentContext, loadFullContext } from './context-builder.js';
import { AgentDefinition } from '../commands/team/types.js';
import { loadAgentsManifest } from '../commands/team/loader.js';
import { BudgetTracker } from './budget-tracker.js';
import { AuditLogger, AgentLog } from './audit-logger.js';

// ============================================================================
// Types
// ============================================================================

export interface SpawnResult {
  success: boolean;
  relay?: AgentRelay;
  error?: string;
  sessionId: string;
}

export interface SpawnerOptions {
  /** Provider name override */
  provider?: string;
  /** Model override */
  model?: AgentModel;
  /** Working directory */
  workingDirectory?: string;
  /** MCP server path */
  mcpServerPath?: string;
  /** Budget configuration */
  budget?: {
    maxTokens?: number;
    maxCostUsd?: number;
    warnAtPercent?: number;
  };
  /** Human checkpoint configuration */
  checkpoints?: CheckpointConfig;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Callback for streaming messages */
  onMessage?: (message: AgentMessage) => void;
  /** Callback for checkpoint approval */
  onCheckpoint?: (description: string) => Promise<boolean>;
}

// ============================================================================
// Agent Spawner
// ============================================================================

export class AgentSpawner {
  private provider: AgentProvider | null = null;
  private budgetTracker: BudgetTracker | null = null;
  private auditLogger: AuditLogger | null = null;
  private rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  /**
   * Initialize the spawner
   */
  async initialize(): Promise<void> {
    await initializeProviders();
    this.provider = getProvider();
    this.budgetTracker = new BudgetTracker(this.rootDir);
    this.auditLogger = new AuditLogger(this.rootDir);
  }

  /**
   * Check if spawner is ready
   */
  isReady(): boolean {
    return this.provider !== null;
  }

  /**
   * Get the current provider
   */
  getProvider(): AgentProvider | null {
    return this.provider;
  }

  /**
   * Spawn a single agent
   */
  async spawn(
    agentName: string,
    task: string,
    options: SpawnerOptions = {}
  ): Promise<SpawnResult> {
    if (!this.provider) {
      return {
        success: false,
        error: 'Spawner not initialized',
        sessionId: '',
      };
    }

    // Load agent definition
    const manifest = loadAgentsManifest(this.rootDir);
    if (!manifest) {
      return {
        success: false,
        error: 'Team not configured. Run `paradigm team init` first.',
        sessionId: '',
      };
    }

    const agent = manifest.agents[agentName];
    if (!agent) {
      return {
        success: false,
        error: `Unknown agent: ${agentName}. Available: ${Object.keys(manifest.agents).join(', ')}`,
        sessionId: '',
      };
    }

    // Check provider availability
    const providerName = options.provider || this.provider.name;
    const provider = getProvider(providerName);
    if (!provider) {
      return {
        success: false,
        error: `Provider '${providerName}' not available`,
        sessionId: '',
      };
    }

    const isAvailable = await provider.isAvailable();
    if (!isAvailable) {
      return {
        success: false,
        error: `Provider '${providerName}' not configured (missing API key?)`,
        sessionId: '',
      };
    }

    // Generate session ID
    const sessionId = this.generateSessionId(agentName);

    // Load facet configuration
    const facetConfig = this.loadFacetConfig(agentName);

    // Build context
    const context = await buildAgentContext(agent, task, this.rootDir, facetConfig);

    // Determine model
    const model = options.model || facetConfig?.defaultModel || 'sonnet';

    // Build spawn options
    const spawnOptions: SpawnOptions = {
      model,
      task,
      context,
      budget: options.budget,
      mcpServerPath: options.mcpServerPath,
      workingDirectory: options.workingDirectory || this.rootDir,
      checkpoints: options.checkpoints,
      timeout: options.timeout,
    };

    // Track start time
    const startTime = Date.now();
    const startTimestamp = new Date().toISOString();

    // Initialize relay
    const relay: AgentRelay = {
      agent: agentName,
      task,
      status: 'success',
      outputs: {
        artifacts: [],
        symbols: context.symbols,
        decisions: [],
      },
      metrics: {
        tokens_used: { input: 0, output: 0, total: 0 },
        duration_ms: 0,
        files_read: 0,
        files_written: 0,
      },
    };

    // Spawn agent
    try {
      for await (const message of provider.spawn(agent, spawnOptions)) {
        // Update metrics
        if (message.usage) {
          relay.metrics.tokens_used = message.usage;
        }

        // Track file operations
        if (message.type === 'tool_use') {
          if (message.toolName === 'read_file') {
            relay.metrics.files_read++;
          } else if (message.toolName === 'write_file') {
            relay.metrics.files_written++;
            const filePath = (message.toolInput as { path?: string })?.path;
            if (filePath) {
              relay.outputs.artifacts.push({
                path: filePath,
                action: 'modified',
              });
            }
          }
        }

        // Handle checkpoints
        if (options.checkpoints && message.type === 'tool_use') {
          const shouldPause = this.shouldPauseForCheckpoint(
            message,
            options.checkpoints
          );
          if (shouldPause && options.onCheckpoint) {
            const approved = await options.onCheckpoint(
              `Agent wants to ${message.toolName}: ${JSON.stringify(message.toolInput)}`
            );
            if (!approved) {
              relay.status = 'blocked';
              break;
            }
          }
        }

        // Stream message callback
        if (options.onMessage) {
          options.onMessage(message);
        }

        // Handle errors
        if (message.type === 'error') {
          relay.status = 'failed';
        }

        // Check budget
        if (this.budgetTracker && message.usage) {
          const budgetResult = this.budgetTracker.checkBudget(
            agentName,
            message.usage.total
          );
          if (!budgetResult.allowed) {
            relay.status = 'failed';
            break;
          }
        }
      }

      // Calculate duration
      relay.metrics.duration_ms = Date.now() - startTime;

      // Record budget usage
      if (this.budgetTracker) {
        this.budgetTracker.recordUsage(agentName, relay.metrics.tokens_used, model);
      }

      // Log to audit
      if (this.auditLogger) {
        const agentLog: AgentLog = {
          name: agentName,
          model,
          started: startTimestamp,
          completed: new Date().toISOString(),
          duration_ms: relay.metrics.duration_ms,
          tokens: relay.metrics.tokens_used,
          cost_usd: calculateCost(relay.metrics.tokens_used, model),
          status: relay.status,
          artifacts: relay.outputs.artifacts,
          symbols: relay.outputs.symbols,
        };
        this.auditLogger.logAgentCompletion(sessionId, agentLog);
      }

      return {
        success: relay.status === 'success' || relay.status === 'partial',
        relay,
        sessionId,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        sessionId,
        relay: {
          ...relay,
          status: 'failed',
          metrics: {
            ...relay.metrics,
            duration_ms: Date.now() - startTime,
          },
        },
      };
    }
  }

  /**
   * Spawn multiple agents in parallel
   */
  async spawnParallel(
    agents: Array<{ name: string; task: string; options?: SpawnerOptions }>
  ): Promise<SpawnResult[]> {
    const promises = agents.map(({ name, task, options }) =>
      this.spawn(name, task, options)
    );
    return Promise.all(promises);
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private generateSessionId(agentName: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `${agentName}-${timestamp}-${random}`;
  }

  private loadFacetConfig(agentName: string): FacetConfig | undefined {
    const facetsPath = path.join(this.rootDir, '.paradigm', 'facets.yaml');

    if (!fs.existsSync(facetsPath)) {
      // Return default config based on agent name
      const defaults: Record<string, FacetConfig> = {
        architect: { defaultModel: 'opus' },
        security: { defaultModel: 'opus' },
        reviewer: { defaultModel: 'sonnet' },
        builder: { defaultModel: 'haiku' },
        tester: { defaultModel: 'haiku' },
      };
      return defaults[agentName];
    }

    try {
      const content = fs.readFileSync(facetsPath, 'utf-8');
      const facets = yaml.load(content) as Record<string, FacetConfig>;
      return facets[agentName];
    } catch {
      return undefined;
    }
  }

  private shouldPauseForCheckpoint(
    message: AgentMessage,
    config: CheckpointConfig
  ): boolean {
    if (!config.beforeActions || message.type !== 'tool_use') {
      return false;
    }

    const actionMap: Record<string, string[]> = {
      write: ['write_file', 'edit_file'],
      delete: ['delete_file', 'rm'],
      execute: ['run_command', 'bash'],
      external_api: ['mcp_call', 'http_request'],
    };

    for (const action of config.beforeActions) {
      const tools = actionMap[action] || [];
      if (message.toolName && tools.includes(message.toolName)) {
        return true;
      }
    }

    return false;
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

let defaultSpawner: AgentSpawner | null = null;

/**
 * Get or create the default spawner
 */
export async function getSpawner(rootDir?: string): Promise<AgentSpawner> {
  const dir = rootDir || process.cwd();

  if (!defaultSpawner || defaultSpawner['rootDir'] !== dir) {
    defaultSpawner = new AgentSpawner(dir);
    await defaultSpawner.initialize();
  }

  return defaultSpawner;
}

/**
 * Spawn a single agent (convenience function)
 */
export async function spawnAgent(
  agentName: string,
  task: string,
  options?: SpawnerOptions
): Promise<SpawnResult> {
  const spawner = await getSpawner(options?.workingDirectory);
  return spawner.spawn(agentName, task, options);
}
