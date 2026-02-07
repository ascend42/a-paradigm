/**
 * Background Orchestrator
 *
 * Enables orchestrations to run in background mode with:
 * - Status tracking
 * - Output file streaming
 * - Completion notifications
 * - Accept/reject workflow
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { spawn } from 'child_process';
import { Orchestrator, OrchestrationOptions, OrchestrationResult } from './orchestrator.js';

// ============================================================================
// Types
// ============================================================================

export type OrchestrationStatus = 'pending' | 'running' | 'completed' | 'failed' | 'accepted' | 'rejected';

export interface BackgroundOrchestration {
  id: string;
  task: string;
  status: OrchestrationStatus;
  mode: 'faceted' | 'solo';
  created: string;
  started?: string;
  completed?: string;
  outputFile: string;
  logFile: string;
  result?: OrchestrationResult;
  error?: string;
  /** Files created/modified by this orchestration */
  artifacts: Array<{
    path: string;
    action: 'created' | 'modified' | 'deleted';
  }>;
  /** Parallel builder stats if used */
  parallelBuilderStats?: {
    usedFilePlan: boolean;
    totalSubPhases: number;
    totalParallelBuilders: number;
    filesCreated: number;
  };
}

export interface BackgroundOptions extends OrchestrationOptions {
  /** Run in background (returns immediately) */
  background?: boolean;
  /** Notify on completion */
  notify?: boolean;
  /** Notification methods */
  notifyMethods?: Array<'bell' | 'desktop' | 'file' | 'webhook'>;
  /** Webhook URL for notifications */
  webhookUrl?: string;
}

// ============================================================================
// Background Orchestrator
// ============================================================================

export class BackgroundOrchestrator {
  private rootDir: string;
  private orchestrationsDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.orchestrationsDir = path.join(rootDir, '.paradigm', 'orchestrations');
    this.ensureOrchestrationDir();
  }

  /**
   * Start an orchestration in background mode
   */
  async startBackground(
    task: string,
    options: BackgroundOptions = {}
  ): Promise<BackgroundOrchestration> {
    const id = this.generateId();
    const outputFile = path.join(this.orchestrationsDir, `${id}.output`);
    const logFile = path.join(this.orchestrationsDir, `${id}.log`);

    // Create initial metadata
    const orchestration: BackgroundOrchestration = {
      id,
      task,
      status: 'pending',
      mode: options.mode || 'faceted',
      created: new Date().toISOString(),
      outputFile,
      logFile,
      artifacts: [],
    };

    // Save initial state
    this.saveOrchestration(orchestration);

    // Start orchestration in a subprocess
    this.spawnOrchestration(id, task, options);

    return orchestration;
  }

  /**
   * Get orchestration by ID
   */
  getOrchestration(id: string): BackgroundOrchestration | null {
    const metaFile = path.join(this.orchestrationsDir, `${id}.yaml`);
    if (!fs.existsSync(metaFile)) {
      return null;
    }

    try {
      const content = fs.readFileSync(metaFile, 'utf-8');
      return yaml.load(content) as BackgroundOrchestration;
    } catch {
      return null;
    }
  }

  /**
   * List all orchestrations
   */
  listOrchestrations(options: {
    status?: OrchestrationStatus | OrchestrationStatus[];
    limit?: number;
  } = {}): BackgroundOrchestration[] {
    const files = fs.readdirSync(this.orchestrationsDir)
      .filter(f => f.endsWith('.yaml') && !f.includes('output') && !f.includes('log'))
      .sort()
      .reverse();

    const orchestrations: BackgroundOrchestration[] = [];

    for (const file of files) {
      if (options.limit && orchestrations.length >= options.limit) break;

      const metaFile = path.join(this.orchestrationsDir, file);
      try {
        const content = fs.readFileSync(metaFile, 'utf-8');
        const orch = yaml.load(content) as BackgroundOrchestration;

        if (options.status) {
          const statuses = Array.isArray(options.status) ? options.status : [options.status];
          if (!statuses.includes(orch.status)) continue;
        }

        orchestrations.push(orch);
      } catch {
        // Skip invalid files
      }
    }

    return orchestrations;
  }

  /**
   * Get running orchestrations
   */
  getRunning(): BackgroundOrchestration[] {
    return this.listOrchestrations({ status: 'running' });
  }

  /**
   * Get orchestration output (streaming)
   */
  getOutput(id: string, options: { follow?: boolean; lines?: number } = {}): string {
    const orch = this.getOrchestration(id);
    if (!orch) return '';

    if (!fs.existsSync(orch.outputFile)) {
      return '';
    }

    const content = fs.readFileSync(orch.outputFile, 'utf-8');

    if (options.lines) {
      const lines = content.split('\n');
      return lines.slice(-options.lines).join('\n');
    }

    return content;
  }

  /**
   * Accept orchestration changes
   */
  async accept(id: string, _options: { note?: string } = {}): Promise<boolean> {
    const orch = this.getOrchestration(id);
    if (!orch) return false;

    if (orch.status !== 'completed') {
      throw new Error(`Cannot accept orchestration in '${orch.status}' status`);
    }

    orch.status = 'accepted';
    this.saveOrchestration(orch);

    return true;
  }

  /**
   * Reject orchestration changes
   */
  async reject(id: string, options: { reason?: string; cleanup?: boolean } = {}): Promise<boolean> {
    const orch = this.getOrchestration(id);
    if (!orch) return false;

    if (orch.status !== 'completed') {
      throw new Error(`Cannot reject orchestration in '${orch.status}' status`);
    }

    orch.status = 'rejected';
    orch.error = options.reason;
    this.saveOrchestration(orch);

    // Optionally cleanup created files
    if (options.cleanup && orch.artifacts.length > 0) {
      for (const artifact of orch.artifacts) {
        if (artifact.action === 'created') {
          const filePath = path.join(this.rootDir, artifact.path);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        }
        // For modified files, would need git to revert
      }
    }

    return true;
  }

  /**
   * Get diff of orchestration changes
   */
  async getDiff(id: string): Promise<string> {
    const orch = this.getOrchestration(id);
    if (!orch) return '';

    if (orch.artifacts.length === 0) {
      return 'No file changes in this orchestration.';
    }

    const diffParts: string[] = [];
    diffParts.push(`Orchestration: ${id}`);
    diffParts.push(`Task: ${orch.task}`);
    diffParts.push(`Status: ${orch.status}`);
    diffParts.push('');
    diffParts.push('Files:');

    for (const artifact of orch.artifacts) {
      const icon = artifact.action === 'created' ? '+' :
                   artifact.action === 'modified' ? '~' : '-';
      diffParts.push(`  ${icon} ${artifact.path}`);
    }

    return diffParts.join('\n');
  }

  /**
   * Mark orchestration as complete
   */
  markComplete(id: string, result: OrchestrationResult): void {
    const orch = this.getOrchestration(id);
    if (!orch) return;

    orch.status = result.success ? 'completed' : 'failed';
    orch.completed = new Date().toISOString();
    orch.result = result;
    orch.parallelBuilderStats = result.parallelBuilderStats;

    // Extract artifacts from agent results
    for (const agentResult of result.agentResults) {
      if (agentResult.relay?.outputs.artifacts) {
        for (const artifact of agentResult.relay.outputs.artifacts) {
          orch.artifacts.push(artifact);
        }
      }
    }

    this.saveOrchestration(orch);
  }

  /**
   * Send completion notification
   */
  async notify(id: string, methods: Array<'bell' | 'desktop' | 'file' | 'webhook'> = ['bell']): Promise<void> {
    const orch = this.getOrchestration(id);
    if (!orch) return;

    for (const method of methods) {
      switch (method) {
        case 'bell':
          // Terminal bell
          process.stdout.write('\x07');
          break;

        case 'desktop':
          // Desktop notification (macOS/Linux)
          try {
            if (process.platform === 'darwin') {
              spawn('osascript', [
                '-e',
                `display notification "Orchestration ${orch.status}: ${orch.task.slice(0, 50)}" with title "Paradigm"`,
              ]);
            } else {
              spawn('notify-send', [
                'Paradigm',
                `Orchestration ${orch.status}: ${orch.task.slice(0, 50)}`,
              ]);
            }
          } catch {
            // Notification failed, ignore
          }
          break;

        case 'file':
          // Write to status file
          const statusFile = path.join(this.orchestrationsDir, `${id}.status`);
          fs.writeFileSync(statusFile, JSON.stringify({
            id,
            status: orch.status,
            completed: orch.completed,
            task: orch.task,
          }));
          break;

        case 'webhook':
          // Webhook notification would be implemented here
          break;
      }
    }
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private ensureOrchestrationDir(): void {
    if (!fs.existsSync(this.orchestrationsDir)) {
      fs.mkdirSync(this.orchestrationsDir, { recursive: true });
    }
  }

  private generateId(): string {
    const date = new Date().toISOString().slice(0, 10);
    const time = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 6);
    return `orch-${date}-${time}-${random}`;
  }

  private saveOrchestration(orch: BackgroundOrchestration): void {
    const metaFile = path.join(this.orchestrationsDir, `${orch.id}.yaml`);
    fs.writeFileSync(metaFile, yaml.dump(orch));
  }

  private spawnOrchestration(
    id: string,
    task: string,
    options: BackgroundOptions
  ): void {
    // Update status to running
    const orch = this.getOrchestration(id);
    if (orch) {
      orch.status = 'running';
      orch.started = new Date().toISOString();
      this.saveOrchestration(orch);
    }

    // Run orchestration in current process (synchronous for now)
    // In a production environment, this would spawn a separate process
    (async () => {
      try {
        const orchestrator = new Orchestrator(this.rootDir);
        await orchestrator.initialize();

        // Write output to file
        const outputStream = fs.createWriteStream(orch!.outputFile, { flags: 'a' });

        const result = await orchestrator.orchestrate(task, {
          ...options,
          onMessage: (source, message) => {
            if (message.type === 'text') {
              outputStream.write(`[${source}] ${message.content}\n`);
            }
            options.onMessage?.(source, message);
          },
          onAgentStart: (agent, agentTask, model) => {
            outputStream.write(`\n▶ ${agent}: ${agentTask}\n`);
            options.onAgentStart?.(agent, agentTask, model);
          },
          onAgentComplete: (agent, agentResult, model) => {
            const status = agentResult.success ? '✓' : '✗';
            outputStream.write(`${status} ${agent} completed\n`);
            options.onAgentComplete?.(agent, agentResult, model);
          },
        });

        outputStream.end();

        // Mark complete
        this.markComplete(id, result);

        // Notify
        if (options.notify) {
          await this.notify(id, options.notifyMethods || ['bell']);
        }
      } catch (error) {
        // Mark failed
        const failedOrch = this.getOrchestration(id);
        if (failedOrch) {
          failedOrch.status = 'failed';
          failedOrch.error = error instanceof Error ? error.message : String(error);
          failedOrch.completed = new Date().toISOString();
          this.saveOrchestration(failedOrch);
        }
      }
    })();
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

let defaultBackgroundOrchestrator: BackgroundOrchestrator | null = null;

/**
 * Get or create the default background orchestrator
 */
export function getBackgroundOrchestrator(rootDir?: string): BackgroundOrchestrator {
  const dir = rootDir || process.cwd();

  if (!defaultBackgroundOrchestrator) {
    defaultBackgroundOrchestrator = new BackgroundOrchestrator(dir);
  }

  return defaultBackgroundOrchestrator;
}

/**
 * Start a background orchestration (convenience function)
 */
export async function orchestrateBackground(
  task: string,
  options?: BackgroundOptions
): Promise<BackgroundOrchestration> {
  const orchestrator = getBackgroundOrchestrator(options?.workingDirectory);
  return orchestrator.startBackground(task, options);
}
