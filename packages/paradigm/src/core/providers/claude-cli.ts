/**
 * Claude CLI Provider
 *
 * Spawns agents by invoking the `claude` CLI command with streaming output.
 * Works if claude CLI is installed, regardless of API key.
 *
 * This is a fallback when:
 * 1. No API key is available
 * 2. Not running inside Claude Code
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
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
// Types for Claude CLI stream-json output
// ============================================================================

interface StreamMessage {
  type: 'assistant' | 'user' | 'system' | 'result';
  message?: {
    content?: Array<{
      type: 'text' | 'tool_use' | 'tool_result';
      text?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
  };
  subtype?: string;
  duration_ms?: number;
  duration_api_ms?: number;
  num_turns?: number;
  result?: string;
  session_id?: string;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

// ============================================================================
// Claude CLI Provider
// ============================================================================

export class ClaudeCliProvider implements AgentProvider {
  readonly name = 'claude-cli';

  private claudePath: string | null = null;

  constructor() {
    // Will be resolved in isAvailable()
  }

  listModels(): AgentModel[] {
    return ['opus', 'sonnet', 'haiku'];
  }

  supportsParallel(): boolean {
    // Can spawn multiple CLI processes
    return true;
  }

  supportsMcp(): boolean {
    // Claude CLI has MCP support
    return true;
  }

  getTokenCost(model: AgentModel): { input: number; output: number } {
    return MODEL_PRICING[model];
  }

  async isAvailable(): Promise<boolean> {
    // Check if claude CLI is installed
    try {
      const { execSync } = await import('child_process');
      const result = execSync('which claude', { encoding: 'utf-8' }).trim();
      if (result) {
        this.claudePath = result;
        return true;
      }
    } catch {
      // Try common paths
      const paths = [
        '/usr/local/bin/claude',
        path.join(process.env.HOME || '', '.local/bin/claude'),
        path.join(process.env.HOME || '', '.claude/bin/claude'),
      ];

      for (const p of paths) {
        if (fs.existsSync(p)) {
          this.claudePath = p;
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Spawn an agent by invoking claude CLI with streaming output
   */
  async *spawn(
    agent: AgentDefinition,
    options: SpawnOptions
  ): AsyncIterable<AgentMessage> {
    if (!this.claudePath) {
      yield {
        type: 'error',
        content: 'Claude CLI not found',
        timestamp: new Date().toISOString(),
      };
      return;
    }

    // Build the prompt
    const prompt = this.buildPrompt(agent, options);

    yield {
      type: 'text',
      content: `Starting ${agent.name} agent via CLI (streaming)...\n`,
      timestamp: new Date().toISOString(),
    };

    // Spawn claude CLI process with streaming JSON output
    const args = [
      '--print',                          // Non-interactive mode
      '--permission-mode', 'acceptEdits', // Auto-accept to avoid prompts
      '--output-format', 'stream-json',   // Streaming JSON for real-time output
      '--no-session-persistence',         // Don't persist session (faster startup)
    ];

    // Add model if specified
    if (options.model) {
      args.push('--model', options.model);
    }

    // Add working directory
    if (options.workingDirectory) {
      args.push('--add-dir', options.workingDirectory);
    }

    // Add the prompt last (after all flags)
    args.push('-p', prompt.slice(0, 8000));  // Truncate for CLI arg limit

    // Stream messages from the CLI
    const messageEmitter = new EventEmitter();
    let totalUsage: TokenUsage = { input: 0, output: 0, total: 0 };
    let lastError: string | null = null;
    let completed = false;

    // Start the process
    const proc = spawn(this.claudePath, args, {
      cwd: options.workingDirectory || process.cwd(),
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Buffer for incomplete JSON lines
    let buffer = '';

    proc.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString();

      // Process complete lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';  // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const msg: StreamMessage = JSON.parse(line);
          messageEmitter.emit('message', msg);
        } catch {
          // Non-JSON output, emit as text
          messageEmitter.emit('text', line);
        }
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      // Claude CLI writes progress to stderr
      if (!text.includes('Error')) {
        messageEmitter.emit('progress', text);
      } else {
        lastError = text;
      }
    });

    proc.on('close', (code) => {
      completed = true;
      messageEmitter.emit('done', code);
    });

    proc.on('error', (err) => {
      lastError = err.message;
      messageEmitter.emit('error', err);
    });

    // Set up timeout
    const timeoutMs = options.timeout || 3 * 60 * 1000;  // 3 minutes default
    const timeoutHandle = setTimeout(() => {
      proc.kill();
      lastError = `Claude CLI timed out after ${timeoutMs / 1000}s`;
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

    // Handle stream messages
    messageEmitter.on('message', (msg: StreamMessage) => {
      if (msg.type === 'assistant' && msg.message?.content) {
        for (const content of msg.message.content) {
          if (content.type === 'text' && content.text) {
            pushMessage({
              type: 'text',
              content: content.text,
              timestamp: new Date().toISOString(),
            });
          } else if (content.type === 'tool_use' && content.name) {
            pushMessage({
              type: 'tool_use',
              content: `Using tool: ${content.name}`,
              toolName: content.name,
              toolInput: content.input,
              timestamp: new Date().toISOString(),
            });
          }
        }
      } else if (msg.type === 'result') {
        // Final result with usage stats
        if (msg.usage) {
          totalUsage = {
            input: msg.usage.input_tokens || 0,
            output: msg.usage.output_tokens || 0,
            total: (msg.usage.input_tokens || 0) + (msg.usage.output_tokens || 0),
          };
        }
      }
    });

    messageEmitter.on('text', (text: string) => {
      pushMessage({
        type: 'text',
        content: text + '\n',
        timestamp: new Date().toISOString(),
      });
    });

    messageEmitter.on('progress', (_text: string) => {
      // Show progress dots or spinner text
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
}
