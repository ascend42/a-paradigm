/**
 * Session Tracker - Track MCP session activity for cost estimation
 *
 * Provides:
 * - Resource read tracking (type, bytes, tokens)
 * - Tool call tracking (name, response bytes, tokens)
 * - Multi-model pricing support
 * - Handoff recommendations based on actual usage
 * - Session breadcrumbs for continuity across sessions
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Supported Claude models with pricing per 1M tokens
 */
export const MODEL_PRICING = {
  'claude-opus-4': { input: 15.00, output: 75.00, name: 'Claude Opus 4' },
  'claude-sonnet-4': { input: 3.00, output: 15.00, name: 'Claude Sonnet 4' },
  'claude-haiku-3.5': { input: 0.80, output: 4.00, name: 'Claude Haiku 3.5' },
} as const;

export type ModelId = keyof typeof MODEL_PRICING;

/**
 * Resource read record
 */
interface ResourceRead {
  timestamp: number;
  resourceType: string;
  uri: string;
  bytes: number;
  tokens: number;
}

/**
 * Tool call record
 */
interface ToolCall {
  timestamp: number;
  toolName: string;
  responseBytes: number;
  responseTokens: number;
}

/**
 * Session breadcrumb - a summarized action for recovery
 */
export interface SessionBreadcrumb {
  timestamp: number;
  action: string;
  tool?: string;
  symbol?: string;
  summary: string;
}

/**
 * Persisted session state for recovery
 */
export interface PersistedSession {
  sessionId: string;
  startTime: number;
  lastActivity: number;
  breadcrumbs: SessionBreadcrumb[];
  symbolsModified: string[];
  filesExplored: string[];
}

/**
 * Session statistics
 */
export interface SessionStats {
  sessionId: string;
  startTime: number;
  lastActivity: number;
  model: ModelId;
  resourceReads: ResourceRead[];
  toolCalls: ToolCall[];
  breadcrumbs: SessionBreadcrumb[];
  totals: {
    resourceReadCount: number;
    toolCallCount: number;
    totalBytes: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
}

/**
 * Cost breakdown by category
 */
export interface CostBreakdown {
  model: string;
  modelId: ModelId;
  pricing: typeof MODEL_PRICING[ModelId];
  resources: {
    count: number;
    bytes: number;
    tokens: number;
    costUsd: number;
    byType: Record<string, { count: number; bytes: number; tokens: number }>;
  };
  tools: {
    count: number;
    bytes: number;
    tokens: number;
    costUsd: number;
    byName: Record<string, { count: number; bytes: number; tokens: number }>;
  };
  total: {
    tokens: number;
    costUsd: number;
  };
}

/** Maximum number of breadcrumbs to keep */
const MAX_BREADCRUMBS = 50;

/** Path to breadcrumbs file (relative to project root) */
const BREADCRUMBS_FILE = '.paradigm/session-breadcrumbs.json';

/**
 * Session tracker singleton
 */
class SessionTracker {
  private session: SessionStats;
  private rootDir: string | null = null;

  constructor() {
    this.session = this.createNewSession();
  }

  /**
   * Set the project root directory (for persisting breadcrumbs)
   */
  setRootDir(rootDir: string): void {
    this.rootDir = rootDir;
  }

  private createNewSession(): SessionStats {
    return {
      sessionId: `s${Date.now().toString(36)}`,
      startTime: Date.now(),
      lastActivity: Date.now(),
      model: 'claude-sonnet-4',
      resourceReads: [],
      toolCalls: [],
      breadcrumbs: [],
      totals: {
        resourceReadCount: 0,
        toolCallCount: 0,
        totalBytes: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
      },
    };
  }

  /**
   * Add a breadcrumb (summarized action for session recovery)
   */
  addBreadcrumb(action: string, summary: string, options: { tool?: string; symbol?: string } = {}): void {
    this.session.breadcrumbs.push({
      timestamp: Date.now(),
      action,
      tool: options.tool,
      symbol: options.symbol,
      summary,
    });

    // Keep only the last N breadcrumbs
    if (this.session.breadcrumbs.length > MAX_BREADCRUMBS) {
      this.session.breadcrumbs = this.session.breadcrumbs.slice(-MAX_BREADCRUMBS);
    }

    // Persist breadcrumbs
    this.persistBreadcrumbs();
  }

  /**
   * Get recent breadcrumbs
   */
  getBreadcrumbs(limit: number = 20): SessionBreadcrumb[] {
    return this.session.breadcrumbs.slice(-limit);
  }

  /**
   * Persist breadcrumbs to file
   */
  private persistBreadcrumbs(): void {
    if (!this.rootDir) return;

    try {
      const filePath = path.join(this.rootDir, BREADCRUMBS_FILE);
      const dir = path.dirname(filePath);

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data: PersistedSession = {
        sessionId: this.session.sessionId,
        startTime: this.session.startTime,
        lastActivity: this.session.lastActivity,
        breadcrumbs: this.session.breadcrumbs,
        symbolsModified: this.extractSymbolsFromBreadcrumbs(),
        filesExplored: this.extractFilesFromBreadcrumbs(),
      };

      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch {
      // Silently fail - breadcrumbs are optional
    }
  }

  /**
   * Load previous session breadcrumbs from file
   */
  loadPreviousSession(): PersistedSession | null {
    if (!this.rootDir) return null;

    try {
      const filePath = path.join(this.rootDir, BREADCRUMBS_FILE);
      if (!fs.existsSync(filePath)) return null;

      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content) as PersistedSession;
    } catch {
      return null;
    }
  }

  /**
   * Extract symbols from breadcrumbs
   */
  private extractSymbolsFromBreadcrumbs(): string[] {
    const symbols = new Set<string>();
    for (const bc of this.session.breadcrumbs) {
      if (bc.symbol) symbols.add(bc.symbol);
    }
    return Array.from(symbols);
  }

  /**
   * Extract files from breadcrumbs
   */
  private extractFilesFromBreadcrumbs(): string[] {
    const files = new Set<string>();
    for (const bc of this.session.breadcrumbs) {
      // Extract file paths from summaries (simple heuristic)
      const matches = bc.summary.match(/\b[\w./]+\.(ts|js|tsx|jsx|py|go|rs|yaml|json|md)\b/g);
      if (matches) {
        for (const m of matches) {
          files.add(m);
        }
      }
    }
    return Array.from(files);
  }

  /**
   * Estimate tokens from text (approx 3.5 chars per token)
   */
  private estimateTokens(text: string | number): number {
    const len = typeof text === 'number' ? text : text.length;
    return Math.ceil(len / 3.5);
  }

  /**
   * Calculate cost for tokens using current model pricing
   */
  private calculateCost(tokens: number, isOutput: boolean = true): number {
    const pricing = MODEL_PRICING[this.session.model];
    const rate = isOutput ? pricing.output : pricing.input;
    return (tokens / 1_000_000) * rate;
  }

  /**
   * Set the model for cost calculations
   */
  setModel(model: ModelId): void {
    this.session.model = model;
    this.recalculateTotals();
  }

  /**
   * Get current model
   */
  getModel(): ModelId {
    return this.session.model;
  }

  /**
   * Track a resource read
   */
  trackResourceRead(uri: string, bytes: number): void {
    const resourceType = this.extractResourceType(uri);
    const tokens = this.estimateTokens(bytes);

    this.session.resourceReads.push({
      timestamp: Date.now(),
      resourceType,
      uri,
      bytes,
      tokens,
    });

    this.session.lastActivity = Date.now();
    this.updateTotals(bytes, tokens);
  }

  /**
   * Track a tool call
   */
  trackToolCall(toolName: string, responseBytes: number): void {
    const tokens = this.estimateTokens(responseBytes);

    this.session.toolCalls.push({
      timestamp: Date.now(),
      toolName,
      responseBytes,
      responseTokens: tokens,
    });

    this.session.lastActivity = Date.now();
    this.updateTotals(responseBytes, tokens);
  }

  /**
   * Update running totals
   */
  private updateTotals(bytes: number, tokens: number): void {
    this.session.totals.resourceReadCount = this.session.resourceReads.length;
    this.session.totals.toolCallCount = this.session.toolCalls.length;
    this.session.totals.totalBytes += bytes;
    this.session.totals.totalTokens += tokens;
    this.session.totals.estimatedCostUsd = this.calculateCost(this.session.totals.totalTokens);
  }

  /**
   * Recalculate totals (used when model changes)
   */
  private recalculateTotals(): void {
    this.session.totals.estimatedCostUsd = this.calculateCost(this.session.totals.totalTokens);
  }

  /**
   * Extract resource type from URI
   */
  private extractResourceType(uri: string): string {
    const path = uri.replace('paradigm://', '');
    const firstPart = path.split('/')[0];
    return firstPart || 'unknown';
  }

  /**
   * Get session statistics
   */
  getStats(): SessionStats {
    return { ...this.session };
  }

  /**
   * Get detailed cost breakdown
   */
  getCostBreakdown(): CostBreakdown {
    const resourcesByType: Record<string, { count: number; bytes: number; tokens: number }> = {};
    let resourceBytes = 0;
    let resourceTokens = 0;

    for (const read of this.session.resourceReads) {
      if (!resourcesByType[read.resourceType]) {
        resourcesByType[read.resourceType] = { count: 0, bytes: 0, tokens: 0 };
      }
      resourcesByType[read.resourceType].count++;
      resourcesByType[read.resourceType].bytes += read.bytes;
      resourcesByType[read.resourceType].tokens += read.tokens;
      resourceBytes += read.bytes;
      resourceTokens += read.tokens;
    }

    const toolsByName: Record<string, { count: number; bytes: number; tokens: number }> = {};
    let toolBytes = 0;
    let toolTokens = 0;

    for (const call of this.session.toolCalls) {
      if (!toolsByName[call.toolName]) {
        toolsByName[call.toolName] = { count: 0, bytes: 0, tokens: 0 };
      }
      toolsByName[call.toolName].count++;
      toolsByName[call.toolName].bytes += call.responseBytes;
      toolsByName[call.toolName].tokens += call.responseTokens;
      toolBytes += call.responseBytes;
      toolTokens += call.responseTokens;
    }

    const totalTokens = resourceTokens + toolTokens;
    const totalCost = this.calculateCost(totalTokens);

    return {
      model: MODEL_PRICING[this.session.model].name,
      modelId: this.session.model,
      pricing: MODEL_PRICING[this.session.model],
      resources: {
        count: this.session.resourceReads.length,
        bytes: resourceBytes,
        tokens: resourceTokens,
        costUsd: this.calculateCost(resourceTokens),
        byType: resourcesByType,
      },
      tools: {
        count: this.session.toolCalls.length,
        bytes: toolBytes,
        tokens: toolTokens,
        costUsd: this.calculateCost(toolTokens),
        byName: toolsByName,
      },
      total: {
        tokens: totalTokens,
        costUsd: totalCost,
      },
    };
  }

  /**
   * Get handoff recommendation based on context usage
   */
  getHandoffRecommendation(contextWindowSize: number = 200000, estimatedTotalTokens?: number): {
    recommendation: 'continue' | 'consider-handoff' | 'handoff-recommended' | 'handoff-urgent';
    message: string;
    usagePercent: number;
    signals: string[];
  } {
    // MCP tokens are only part of the context
    // Estimate total context as MCP tokens * multiplier for conversation overhead
    const mcpTokens = this.session.totals.totalTokens;
    const estimatedConversationOverhead = mcpTokens * 4;
    const totalEstimate = estimatedTotalTokens || (mcpTokens + estimatedConversationOverhead);

    const usagePercent = Math.round((totalEstimate / contextWindowSize) * 100);

    let recommendation: 'continue' | 'consider-handoff' | 'handoff-recommended' | 'handoff-urgent';
    let message: string;

    if (usagePercent >= 85) {
      recommendation = 'handoff-urgent';
      message = 'Context is nearly full. Initiate handoff immediately to preserve session continuity.';
    } else if (usagePercent >= 70) {
      recommendation = 'handoff-recommended';
      message = 'Context usage is high. Consider initiating handoff soon to ensure smooth transition.';
    } else if (usagePercent >= 50) {
      recommendation = 'consider-handoff';
      message = 'Context usage is moderate. Plan a good stopping point for potential handoff.';
    } else {
      recommendation = 'continue';
      message = 'Context usage is healthy. Continue working.';
    }

    // Additional signals
    const signals: string[] = [];
    const durationMin = Math.round((Date.now() - this.session.startTime) / 60000);
    const totalCalls = this.session.toolCalls.length + this.session.resourceReads.length;

    if (totalCalls > 50) {
      signals.push(`High number of MCP interactions (${totalCalls})`);
    }
    if (durationMin > 30) {
      signals.push(`Session duration >30 min (${durationMin} min)`);
    }
    if (this.session.totals.totalBytes > 500000) {
      signals.push(`Large data volume (${Math.round(this.session.totals.totalBytes / 1024)}KB)`);
    }

    return { recommendation, message, usagePercent, signals };
  }

  /**
   * Get session duration in minutes
   */
  getDurationMinutes(): number {
    return Math.round((Date.now() - this.session.startTime) / 60000);
  }

  /**
   * Reset session (for handoff or new session)
   */
  reset(): void {
    this.session = this.createNewSession();
  }
}

// Singleton instance
let tracker: SessionTracker | null = null;

/**
 * Get the session tracker singleton
 */
export function getSessionTracker(): SessionTracker {
  if (!tracker) {
    tracker = new SessionTracker();
  }
  return tracker;
}

/**
 * Reset the session tracker (for testing or handoff)
 */
export function resetSessionTracker(): void {
  if (tracker) {
    tracker.reset();
  }
}
