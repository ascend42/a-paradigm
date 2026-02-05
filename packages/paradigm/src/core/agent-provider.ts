/**
 * Agent Provider Interface
 *
 * Provider-agnostic abstraction for spawning AI agents.
 * Allows Claude Agent SDK, Cursor SDK, Cline, etc. to plug in.
 */

import { AgentDefinition } from '../commands/team/types.js';

// ============================================================================
// Core Types
// ============================================================================

export type AgentModel = 'opus' | 'sonnet' | 'haiku';

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

export interface AgentMessage {
  type: 'text' | 'tool_use' | 'tool_result' | 'error' | 'done';
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: unknown;
  usage?: TokenUsage;
  timestamp: string;
}

export interface AgentRelay {
  agent: string;
  task: string;
  status: 'success' | 'partial' | 'failed' | 'blocked';
  outputs: {
    artifacts: Array<{ path: string; action: 'created' | 'modified' | 'deleted' }>;
    symbols: string[];           // Symbols touched: @payment, #stripe-client
    decisions: string[];         // Key decisions made
  };
  handoff?: {
    to: string;                  // Suggested next agent
    reason: string;
    context: string;             // What next agent needs to know
  };
  metrics: {
    tokens_used: TokenUsage;
    duration_ms: number;
    files_read: number;
    files_written: number;
  };
}

export interface SpawnOptions {
  model?: AgentModel;
  task: string;
  context: AgentContext;
  budget?: BudgetConfig;
  mcpServerPath?: string;
  workingDirectory?: string;
  /** Human checkpoint configuration */
  checkpoints?: CheckpointConfig;
  /** Timeout in milliseconds */
  timeout?: number;
}

export interface AgentContext {
  /** Role-specific system prompt (trimmed CLAUDE.md) */
  systemPrompt: string;
  /** Files relevant to this agent's role */
  files: string[];
  /** Symbols this agent is working with */
  symbols: string[];
  /** Additional context from handoffs */
  handoffContext?: string;
}

export interface BudgetConfig {
  maxTokens?: number;
  maxCostUsd?: number;
  warnAtPercent?: number;
}

export interface CheckpointConfig {
  /** Pause for human approval before these actions */
  beforeActions?: ('write' | 'delete' | 'execute' | 'external_api')[];
  /** Pause at these stages */
  atStages?: ('design_complete' | 'implementation_complete' | 'before_commit')[];
  /** Custom checkpoint conditions */
  conditions?: Array<{
    description: string;
    check: (message: AgentMessage) => boolean;
  }>;
}

// ============================================================================
// Facet Configuration (Agent Hats)
// ============================================================================

export interface FacetLimits {
  /** Maximum tokens this facet can use */
  maxTokens?: number;
  /** Maximum time in milliseconds */
  maxTimeMs?: number;
  /** Maximum retries on failure */
  maxRetries?: number;
  /** Timeout for individual operations */
  operationTimeoutMs?: number;
}

export interface FacetProtocol {
  /** What to do on failure */
  onFailure: 'retry' | 'fallback' | 'pause' | 'escalate' | 'abort';
  /** Fallback facet if this one fails */
  fallbackTo?: string;
  /** Number of retries before escalating */
  retriesBeforeEscalate?: number;
  /** Human approval required for these actions */
  requireApproval?: string[];
}

export interface FacetConfig {
  /** Default model for this facet */
  defaultModel: AgentModel;
  /** Provider override (default: project's agent-provider) */
  provider?: string;
  /** Resource limits */
  limits?: FacetLimits;
  /** Failure handling protocol */
  protocol?: FacetProtocol;
  /** Context patterns to include */
  contextInclude?: string[];
  /** Context patterns to exclude */
  contextExclude?: string[];
}

// ============================================================================
// Provider Interface
// ============================================================================

export interface AgentProvider {
  /** Provider name (e.g., 'claude', 'cursor', 'cline') */
  readonly name: string;

  /**
   * Spawn an agent and return a stream of messages
   */
  spawn(
    agent: AgentDefinition,
    options: SpawnOptions
  ): AsyncIterable<AgentMessage>;

  /**
   * List available models for this provider
   */
  listModels(): AgentModel[];

  /**
   * Check if provider supports parallel agent execution
   */
  supportsParallel(): boolean;

  /**
   * Check if provider supports MCP
   */
  supportsMcp(): boolean;

  /**
   * Get cost per token for a model (for local billing estimation)
   */
  getTokenCost(model: AgentModel): { input: number; output: number };

  /**
   * Check if provider is available (e.g., API key configured)
   */
  isAvailable(): Promise<boolean>;
}

// ============================================================================
// Model Pricing (for local billing estimation)
// ============================================================================

export const MODEL_PRICING: Record<AgentModel, { input: number; output: number }> = {
  // Prices per 1M tokens (as of 2025)
  opus: { input: 15.00, output: 75.00 },
  sonnet: { input: 3.00, output: 15.00 },
  haiku: { input: 0.25, output: 1.25 },
};

/**
 * Calculate cost from token usage
 */
export function calculateCost(usage: TokenUsage, model: AgentModel): number {
  const pricing = MODEL_PRICING[model];
  const inputCost = (usage.input / 1_000_000) * pricing.input;
  const outputCost = (usage.output / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

/**
 * Format cost for display
 */
export function formatCost(usd: number): string {
  if (usd < 0.01) {
    return `$${(usd * 100).toFixed(3)}¢`;
  }
  return `$${usd.toFixed(4)}`;
}

/**
 * Format token count for display
 */
export function formatTokens(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(2)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`;
  }
  return count.toString();
}
