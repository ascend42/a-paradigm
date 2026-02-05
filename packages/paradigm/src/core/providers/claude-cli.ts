/**
 * Claude CLI Provider
 *
 * Spawns agents by invoking the `claude` CLI command.
 * Works if claude CLI is installed, regardless of API key.
 *
 * This is a fallback when:
 * 1. No API key is available
 * 2. Not running inside Claude Code
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
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
   * Spawn an agent by invoking claude CLI
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

    // Create a temporary file for the prompt (for complex prompts)
    const promptFile = path.join(
      options.workingDirectory || process.cwd(),
      '.paradigm',
      'tasks',
      `prompt-${Date.now()}.md`
    );

    // Ensure directory exists
    const promptDir = path.dirname(promptFile);
    if (!fs.existsSync(promptDir)) {
      fs.mkdirSync(promptDir, { recursive: true });
    }

    fs.writeFileSync(promptFile, prompt);

    yield {
      type: 'text',
      content: `Starting ${agent.name} agent via CLI...\n`,
      timestamp: new Date().toISOString(),
    };

    // Spawn claude CLI process
    const args = [
      '--print',  // Print output instead of interactive
      '-p', prompt.slice(0, 4000),  // Truncate for CLI arg limit
    ];

    // Add model if specified
    if (options.model) {
      args.push('--model', options.model);
    }

    try {
      const output = await this.runClaude(args, options.workingDirectory);

      yield {
        type: 'text',
        content: output,
        timestamp: new Date().toISOString(),
      };

      yield {
        type: 'done',
        content: 'Agent completed',
        usage: this.estimateUsage(prompt, output),
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      yield {
        type: 'error',
        content: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      };
    } finally {
      // Clean up prompt file
      if (fs.existsSync(promptFile)) {
        fs.unlinkSync(promptFile);
      }
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
      parts.push(options.context.systemPrompt.slice(0, 2000)); // Truncate for CLI
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
    parts.push('Complete the task above. Be concise and focused.');

    return parts.join('\n');
  }

  private runClaude(args: string[], cwd?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.claudePath!, args, {
        cwd: cwd || process.cwd(),
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(stderr || `Claude CLI exited with code ${code}`));
        }
      });

      proc.on('error', (err) => {
        reject(err);
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        proc.kill();
        reject(new Error('Claude CLI timed out'));
      }, 5 * 60 * 1000);
    });
  }

  private estimateUsage(prompt: string, output: string): TokenUsage {
    // Rough estimate: ~4 chars per token
    const input = Math.ceil(prompt.length / 4);
    const outputTokens = Math.ceil(output.length / 4);
    return {
      input,
      output: outputTokens,
      total: input + outputTokens,
    };
  }
}
