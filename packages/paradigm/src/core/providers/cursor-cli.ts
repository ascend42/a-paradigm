/**
 * Cursor CLI Provider
 *
 * Spawns agents by invoking the Cursor `agent` CLI command.
 * Works when running inside Cursor IDE or when Cursor CLI is installed.
 *
 * Cursor CLI features:
 * - `agent "prompt"` - Start agent with prompt
 * - `-p "prompt"` - Non-interactive mode (print only)
 * - `--model` - Select model
 * - `--mode=plan|ask` - Set mode
 *
 * @see https://cursor.com/docs/cli/overview
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn, execSync } from 'child_process';
import { EventEmitter } from 'events';
import {
  AgentProvider,
  AgentModel,
  AgentMessage,
  SpawnOptions,
  TokenUsage,
  MODEL_PRICING,
} from '../agent-provider.js';
import { AgentDefinition } from '../../commands/team/types.js';

// ============================================================================
// Cursor CLI Provider
// ============================================================================

export class CursorCliProvider implements AgentProvider {
  readonly name = 'cursor-cli';

  private agentPath: string | null = null;

  constructor() {
    // Will be resolved in isAvailable()
  }

  listModels(): AgentModel[] {
    // Cursor supports multiple models but we map to Claude tiers
    return ['opus', 'sonnet', 'haiku'];
  }

  supportsParallel(): boolean {
    // Can spawn multiple CLI processes
    return true;
  }

  supportsMcp(): boolean {
    // Cursor has MCP support
    return true;
  }

  getTokenCost(model: AgentModel): { input: number; output: number } {
    return MODEL_PRICING[model];
  }

  /**
   * Check if Cursor CLI is available
   */
  async isAvailable(): Promise<boolean> {
    // First check if we're in Cursor environment
    if (!this.isCursorEnvironment()) {
      return false;
    }

    // Check if agent CLI is installed
    try {
      const result = execSync('which agent', { encoding: 'utf-8' }).trim();
      if (result) {
        this.agentPath = result;
        return true;
      }
    } catch {
      // Try common paths
      const paths = [
        '/usr/local/bin/agent',
        path.join(process.env.HOME || '', '.local/bin/agent'),
        path.join(process.env.HOME || '', '.cursor/bin/agent'),
        // macOS application paths
        '/Applications/Cursor.app/Contents/Resources/app/bin/agent',
      ];

      for (const p of paths) {
        if (fs.existsSync(p)) {
          this.agentPath = p;
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Detect if running in Cursor environment
   */
  private isCursorEnvironment(): boolean {
    return (
      process.env.TERM_PROGRAM === 'cursor' ||
      !!process.env.CURSOR_SESSION ||
      !!process.env.CURSOR_TRACE_ID ||
      (process.env.VSCODE_CWD?.toLowerCase().includes('cursor') ?? false) ||
      (process.env.VSCODE_NLS_CONFIG?.toLowerCase().includes('cursor') ?? false) ||
      (process.env.TERM_PROGRAM === 'vscode' &&
        (process.env.VSCODE_GIT_ASKPASS_NODE?.toLowerCase().includes('cursor') ?? false))
    );
  }

  /**
   * Spawn an agent by invoking Cursor CLI
   */
  async *spawn(
    agent: AgentDefinition,
    options: SpawnOptions
  ): AsyncIterable<AgentMessage> {
    if (!this.agentPath) {
      yield {
        type: 'error',
        content: 'Cursor agent CLI not found',
        timestamp: new Date().toISOString(),
      };
      return;
    }

    // Build the prompt
    const prompt = this.buildPrompt(agent, options);

    yield {
      type: 'text',
      content: `Starting ${agent.name} agent via Cursor CLI...\n`,
      timestamp: new Date().toISOString(),
    };

    // Spawn Cursor agent CLI process
    // Note: Cursor CLI doesn't have stream-json like Claude CLI
    // We'll capture stdout and parse it as text
    const args = [
      '-p', prompt.slice(0, 8000),  // Non-interactive mode with prompt
    ];

    // Add model if specified (map opus/sonnet/haiku to Cursor model names)
    if (options.model) {
      const cursorModel = this.mapToCursorModel(options.model);
      if (cursorModel) {
        args.push('--model', cursorModel);
      }
    }

    // Stream messages from the CLI
    const messageEmitter = new EventEmitter();
    let outputBuffer = '';
    let totalUsage: TokenUsage = { input: 0, output: 0, total: 0 };
    let lastError: string | null = null;
    let completed = false;

    // Start the process
    const proc = spawn(this.agentPath, args, {
      cwd: options.workingDirectory || process.cwd(),
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      outputBuffer += text;

      // Emit text chunks as messages
      messageEmitter.emit('text', text);
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      // Check for errors
      if (text.toLowerCase().includes('error')) {
        lastError = text;
        messageEmitter.emit('error', new Error(text));
      } else {
        // Progress output
        messageEmitter.emit('progress', text);
      }
    });

    proc.on('close', (code) => {
      completed = true;
      // Estimate tokens from output (rough approximation)
      const outputTokens = Math.ceil(outputBuffer.length / 4);
      const inputTokens = Math.ceil(prompt.length / 4);
      totalUsage = {
        input: inputTokens,
        output: outputTokens,
        total: inputTokens + outputTokens,
      };
      messageEmitter.emit('done', code);
    });

    proc.on('error', (err) => {
      lastError = err.message;
      messageEmitter.emit('error', err);
    });

    // Set up timeout
    const timeoutMs = options.timeout || 5 * 60 * 1000;  // 5 minutes default
    const timeoutHandle = setTimeout(() => {
      proc.kill();
      lastError = `Cursor agent timed out after ${timeoutMs / 1000}s`;
      messageEmitter.emit('timeout');
    }, timeoutMs);

    // Create async iterator for messages
    const messageQueue: AgentMessage[] = [];
    let resolveNext: ((value: AgentMessage | null) => void) | null = null;

    const pushMessage = (msg: AgentMessage) => {
      if (resolveNext) {
        resolveNext(msg);
        resolveNext = null;
      } else {
        messageQueue.push(msg);
      }
    };

    // Handle text output
    messageEmitter.on('text', (text: string) => {
      pushMessage({
        type: 'text',
        content: text,
        timestamp: new Date().toISOString(),
      });
    });

    messageEmitter.on('progress', (_text: string) => {
      // Show progress indicator
      pushMessage({
        type: 'text',
        content: '.',
        timestamp: new Date().toISOString(),
      });
    });

    messageEmitter.on('done', () => {
      clearTimeout(timeoutHandle);
      pushMessage({
        type: 'done',
        content: 'Agent completed',
        usage: totalUsage,
        timestamp: new Date().toISOString(),
      });
    });

    messageEmitter.on('timeout', () => {
      pushMessage({
        type: 'error',
        content: lastError || 'Timeout',
        timestamp: new Date().toISOString(),
      });
    });

    messageEmitter.on('error', (err: Error) => {
      clearTimeout(timeoutHandle);
      pushMessage({
        type: 'error',
        content: err.message,
        timestamp: new Date().toISOString(),
      });
    });

    // Yield messages as they arrive
    while (!completed || messageQueue.length > 0) {
      if (messageQueue.length > 0) {
        const msg = messageQueue.shift()!;
        yield msg;
        if (msg.type === 'done' || msg.type === 'error') {
          break;
        }
      } else {
        // Wait for next message
        const msg = await new Promise<AgentMessage | null>((resolve) => {
          resolveNext = resolve;
          // Safety timeout to prevent infinite wait
          setTimeout(() => resolve(null), 100);
        });
        if (msg) {
          yield msg;
          if (msg.type === 'done' || msg.type === 'error') {
            break;
          }
        }
      }
    }

    // Handle any error
    if (lastError && !completed) {
      yield {
        type: 'error',
        content: lastError,
        timestamp: new Date().toISOString(),
      };
    }
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Build prompt for the agent
   */
  private buildPrompt(agent: AgentDefinition, options: SpawnOptions): string {
    const parts: string[] = [];

    parts.push(`# ${agent.name.toUpperCase()} Agent`);
    parts.push('');
    parts.push('## Role');
    parts.push(agent.role);
    parts.push('');
    parts.push('## Task');
    parts.push(options.task);
    parts.push('');

    if (options.context.systemPrompt) {
      parts.push('## Context');
      parts.push(options.context.systemPrompt.slice(0, 3000)); // Truncate for CLI
      parts.push('');
    }

    if (options.context.symbols.length > 0) {
      parts.push('## Symbols');
      parts.push(options.context.symbols.join(', '));
      parts.push('');
    }

    if (options.context.handoffContext) {
      parts.push('## From Previous Agent');
      parts.push(options.context.handoffContext);
      parts.push('');
    }

    parts.push('## Instructions');
    parts.push('Complete the task above. Be concise and focused. Keep response under 500 words.');

    return parts.join('\n');
  }

  /**
   * Map Paradigm model tiers to Cursor model names
   */
  private mapToCursorModel(model: AgentModel): string | null {
    // Cursor supports various models, map our tiers to current Claude model IDs
    switch (model) {
      case 'opus':
        return 'claude-opus-4-6';
      case 'sonnet':
        return 'claude-sonnet-4-5-20250929';
      case 'haiku':
        return 'claude-haiku-4-5-20251001';
      default:
        return null;
    }
  }
}
