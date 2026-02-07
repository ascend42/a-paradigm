/**
 * Audit Logger
 *
 * Logs orchestration events for tracking, debugging, and cost analysis.
 * Stores logs in .paradigm/orchestrations/
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
  AgentModel,
  TokenUsage,
} from './agent-provider.js';
import { OrchestrationMode } from './orchestrator.js';

// ============================================================================
// Types
// ============================================================================

export interface AgentLog {
  name: string;
  model: AgentModel;
  started: string;
  completed: string;
  duration_ms: number;
  tokens: TokenUsage;
  cost_usd: number;
  status: 'success' | 'partial' | 'failed' | 'blocked';
  artifacts: Array<{ path: string; action: 'created' | 'modified' | 'deleted' }>;
  symbols: string[];
  error?: string;
}

export interface OrchestrationLog {
  id: string;
  task: string;
  mode: OrchestrationMode;
  started: string;
  completed?: string;
  status: 'running' | 'success' | 'failed' | 'cancelled';
  orchestrator?: {
    model: AgentModel;
    tokens: number;
    cost_usd: number;
  };
  agents: AgentLog[];
  totals: {
    duration_ms: number;
    tokens: number;
    cost_usd: number;
    agents_spawned: number;
    files_created: number;
    files_modified: number;
  };
  metadata?: Record<string, unknown>;
}

export interface OrchestrationSummary {
  id: string;
  task: string;
  mode: OrchestrationMode;
  started: string;
  status: string;
  agents_spawned: number;
  tokens: number;
  cost_usd: number;
  duration_ms: number;
}

// ============================================================================
// Audit Logger
// ============================================================================

export class AuditLogger {
  private logsDir: string;
  private currentLog: OrchestrationLog | null = null;

  constructor(_rootDir: string) {
    this.logsDir = path.join(_rootDir, '.paradigm', 'orchestrations');
  }

  // ==========================================================================
  // Orchestration Lifecycle
  // ==========================================================================

  /**
   * Start logging a new orchestration
   */
  startOrchestration(
    id: string,
    task: string,
    mode: OrchestrationMode
  ): OrchestrationLog {
    this.ensureLogsDir();

    this.currentLog = {
      id,
      task,
      mode,
      started: new Date().toISOString(),
      status: 'running',
      agents: [],
      totals: {
        duration_ms: 0,
        tokens: 0,
        cost_usd: 0,
        agents_spawned: 0,
        files_created: 0,
        files_modified: 0,
      },
    };

    return this.currentLog;
  }

  /**
   * Log an agent completion
   */
  logAgentCompletion(orchestrationId: string, agent: AgentLog): void {
    if (this.currentLog && this.currentLog.id === orchestrationId) {
      this.currentLog.agents.push(agent);
      this.currentLog.totals.agents_spawned++;
      this.currentLog.totals.tokens += agent.tokens.total;
      this.currentLog.totals.cost_usd += agent.cost_usd;

      // Count file operations
      for (const artifact of agent.artifacts) {
        if (artifact.action === 'created') {
          this.currentLog.totals.files_created++;
        } else if (artifact.action === 'modified') {
          this.currentLog.totals.files_modified++;
        }
      }
    }
  }

  /**
   * Complete and save the orchestration log
   */
  completeOrchestration(
    status: 'success' | 'failed' | 'cancelled',
    duration_ms: number
  ): OrchestrationLog | null {
    if (!this.currentLog) return null;

    this.currentLog.completed = new Date().toISOString();
    this.currentLog.status = status;
    this.currentLog.totals.duration_ms = duration_ms;

    this.saveOrchestration(this.currentLog);

    const log = this.currentLog;
    this.currentLog = null;
    return log;
  }

  /**
   * Save an orchestration log
   */
  saveOrchestration(log: OrchestrationLog): void {
    this.ensureLogsDir();

    const filename = `${log.started.slice(0, 10)}-${this.sanitizeFilename(log.task)}.yaml`;
    const filepath = path.join(this.logsDir, filename);

    const content = yaml.dump(log, {
      lineWidth: -1,
      noRefs: true,
      quotingType: '"',
    });

    fs.writeFileSync(filepath, content);
  }

  // ==========================================================================
  // Reading Logs
  // ==========================================================================

  /**
   * Load an orchestration log by ID
   */
  loadOrchestration(id: string): OrchestrationLog | null {
    const files = this.listLogFiles();

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const log = yaml.load(content) as OrchestrationLog;
        if (log.id === id) {
          return log;
        }
      } catch {
        // Ignore invalid files
      }
    }

    return null;
  }

  /**
   * List all orchestrations
   */
  listOrchestrations(options?: {
    limit?: number;
    from?: Date;
    to?: Date;
    status?: string;
  }): OrchestrationSummary[] {
    const files = this.listLogFiles();
    const summaries: OrchestrationSummary[] = [];

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const log = yaml.load(content) as OrchestrationLog;

        // Apply filters
        if (options?.from && new Date(log.started) < options.from) continue;
        if (options?.to && new Date(log.started) > options.to) continue;
        if (options?.status && log.status !== options.status) continue;

        summaries.push({
          id: log.id,
          task: log.task,
          mode: log.mode,
          started: log.started,
          status: log.status,
          agents_spawned: log.totals.agents_spawned,
          tokens: log.totals.tokens,
          cost_usd: log.totals.cost_usd,
          duration_ms: log.totals.duration_ms,
        });
      } catch {
        // Ignore invalid files
      }
    }

    // Sort by date (newest first)
    summaries.sort((a, b) => new Date(b.started).getTime() - new Date(a.started).getTime());

    // Apply limit
    if (options?.limit) {
      return summaries.slice(0, options.limit);
    }

    return summaries;
  }

  /**
   * Get cost summary for a date range
   */
  getCostSummary(from?: Date, to?: Date): {
    totalCost: number;
    totalTokens: number;
    orchestrationCount: number;
    byAgent: Record<string, { tokens: number; cost: number; count: number }>;
    byModel: Record<string, { tokens: number; cost: number; count: number }>;
    byDay: Array<{ date: string; cost: number; tokens: number }>;
  } {
    const summaries = this.listOrchestrations({ from, to });
    const files = this.listLogFiles();

    let totalCost = 0;
    let totalTokens = 0;
    const byAgent: Record<string, { tokens: number; cost: number; count: number }> = {};
    const byModel: Record<string, { tokens: number; cost: number; count: number }> = {};
    const byDayMap: Record<string, { cost: number; tokens: number }> = {};

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const log = yaml.load(content) as OrchestrationLog;

        // Apply date filters
        const logDate = new Date(log.started);
        if (from && logDate < from) continue;
        if (to && logDate > to) continue;

        totalCost += log.totals.cost_usd;
        totalTokens += log.totals.tokens;

        // By day
        const day = log.started.slice(0, 10);
        if (!byDayMap[day]) {
          byDayMap[day] = { cost: 0, tokens: 0 };
        }
        byDayMap[day].cost += log.totals.cost_usd;
        byDayMap[day].tokens += log.totals.tokens;

        // By agent and model
        for (const agent of log.agents) {
          if (!byAgent[agent.name]) {
            byAgent[agent.name] = { tokens: 0, cost: 0, count: 0 };
          }
          byAgent[agent.name].tokens += agent.tokens.total;
          byAgent[agent.name].cost += agent.cost_usd;
          byAgent[agent.name].count++;

          if (!byModel[agent.model]) {
            byModel[agent.model] = { tokens: 0, cost: 0, count: 0 };
          }
          byModel[agent.model].tokens += agent.tokens.total;
          byModel[agent.model].cost += agent.cost_usd;
          byModel[agent.model].count++;
        }
      } catch {
        // Ignore invalid files
      }
    }

    // Convert byDayMap to sorted array
    const byDay = Object.entries(byDayMap)
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      totalCost,
      totalTokens,
      orchestrationCount: summaries.length,
      byAgent,
      byModel,
      byDay,
    };
  }

  /**
   * Export orchestrations to JSON
   */
  exportToJson(options?: { from?: Date; to?: Date }): string {
    const files = this.listLogFiles();
    const logs: OrchestrationLog[] = [];

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const log = yaml.load(content) as OrchestrationLog;

        // Apply date filters
        const logDate = new Date(log.started);
        if (options?.from && logDate < options.from) continue;
        if (options?.to && logDate > options.to) continue;

        logs.push(log);
      } catch {
        // Ignore invalid files
      }
    }

    return JSON.stringify(logs, null, 2);
  }

  /**
   * Export to CSV for analysis
   */
  exportToCsv(options?: { from?: Date; to?: Date }): string {
    const summaries = this.listOrchestrations(options);

    const headers = [
      'id',
      'task',
      'mode',
      'started',
      'status',
      'agents_spawned',
      'tokens',
      'cost_usd',
      'duration_ms',
    ];

    const rows = summaries.map((s) => [
      s.id,
      `"${s.task.replace(/"/g, '""')}"`,
      s.mode,
      s.started,
      s.status,
      s.agents_spawned,
      s.tokens,
      s.cost_usd.toFixed(4),
      s.duration_ms,
    ]);

    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private ensureLogsDir(): void {
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  private listLogFiles(): string[] {
    if (!fs.existsSync(this.logsDir)) {
      return [];
    }

    return fs
      .readdirSync(this.logsDir)
      .filter((f) => f.endsWith('.yaml'))
      .map((f) => path.join(this.logsDir, f));
  }

  private sanitizeFilename(task: string): string {
    return task
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50);
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

let defaultLogger: AuditLogger | null = null;

/**
 * Get or create the default audit logger
 */
export function getAuditLogger(rootDir?: string): AuditLogger {
  const dir = rootDir || process.cwd();

  if (!defaultLogger) {
    defaultLogger = new AuditLogger(dir);
  }

  return defaultLogger;
}
