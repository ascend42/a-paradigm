/**
 * Claude Code Task Provider
 *
 * Uses Claude Code's built-in Task tool for agent spawning.
 * Works with Claude Max subscription - no separate API key needed.
 *
 * This provider spawns agents by writing task files that Claude Code
 * can pick up and execute within the same session context.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
  AgentProvider,
  AgentModel,
  AgentMessage,
  SpawnOptions,
  MODEL_PRICING,
} from '../agent-provider.js';
import { AgentDefinition } from '../../commands/team/types.js';

// ============================================================================
// Claude Code Task Provider
// ============================================================================

export class ClaudeCodeTaskProvider implements AgentProvider {
  readonly name = 'claude-code';

  private tasksDir: string;

  constructor(rootDir: string = process.cwd()) {
    this.tasksDir = path.join(rootDir, '.paradigm', 'tasks');
  }

  listModels(): AgentModel[] {
    // Claude Code uses whatever model the session is using
    return ['opus', 'sonnet', 'haiku'];
  }

  supportsParallel(): boolean {
    // Claude Code Task tool can run agents in parallel
    return true;
  }

  supportsMcp(): boolean {
    // Claude Code has full MCP support
    return true;
  }

  getTokenCost(model: AgentModel): { input: number; output: number } {
    return MODEL_PRICING[model];
  }

  async isAvailable(): Promise<boolean> {
    // Check if we're running inside Claude Code by looking for indicators
    // Claude Code sets certain environment variables or we can check for .claude directory
    const claudeDir = path.join(process.env.HOME || '', '.claude');
    const inClaudeCode = fs.existsSync(claudeDir) ||
                         process.env.CLAUDE_CODE === '1' ||
                         process.env.TERM_PROGRAM === 'claude';
    return inClaudeCode;
  }

  /**
   * Spawn an agent by creating a task file
   *
   * This creates a structured task that can be picked up by:
   * 1. The orchestrating Claude Code session (via Task tool)
   * 2. A background Claude Code process
   * 3. Manual execution
   */
  async *spawn(
    agent: AgentDefinition,
    options: SpawnOptions
  ): AsyncIterable<AgentMessage> {
    const taskId = this.generateTaskId(agent.name);
    const taskFile = path.join(this.tasksDir, `${taskId}.yaml`);
    // Ensure tasks directory exists
    if (!fs.existsSync(this.tasksDir)) {
      fs.mkdirSync(this.tasksDir, { recursive: true });
    }

    // Create task file
    const taskContent = {
      id: taskId,
      agent: agent.name,
      model: options.model || 'sonnet',
      status: 'pending',
      created: new Date().toISOString(),
      task: options.task,
      context: {
        systemPrompt: options.context.systemPrompt,
        symbols: options.context.symbols,
        handoffContext: options.context.handoffContext,
      },
      role: agent.role,
      focus: agent.focus,
    };

    fs.writeFileSync(taskFile, yaml.dump(taskContent));

    yield {
      type: 'text',
      content: `Task created: ${taskId}\n`,
      timestamp: new Date().toISOString(),
    };

    // Generate the prompt for Claude Code Task tool
    const taskPrompt = this.buildTaskPrompt(agent, options);

    yield {
      type: 'text',
      content: `\n---\n**To execute this agent, use the Task tool with:**\n\`\`\`\n${taskPrompt}\n\`\`\`\n---\n`,
      timestamp: new Date().toISOString(),
    };

    // If running interactively, we can watch for the output file
    // For now, yield the task info and let the orchestrator handle execution
    yield {
      type: 'done',
      content: 'Task file created. Execute via Claude Code Task tool.',
      usage: { input: 0, output: 0, total: 0 },
      timestamp: new Date().toISOString(),
    };
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private generateTaskId(agentName: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 6);
    return `${agentName}-${timestamp}-${random}`;
  }

  private buildTaskPrompt(agent: AgentDefinition, options: SpawnOptions): string {
    const parts: string[] = [];

    parts.push(`You are the ${agent.name.toUpperCase()} agent.`);
    parts.push('');
    parts.push('## Your Role');
    parts.push(agent.role);
    parts.push('');
    parts.push('## Task');
    parts.push(options.task);
    parts.push('');

    if (options.context.symbols.length > 0) {
      parts.push('## Symbols in Scope');
      parts.push(options.context.symbols.join(', '));
      parts.push('');
    }

    if (options.context.handoffContext) {
      parts.push('## Context from Previous Agent');
      parts.push(options.context.handoffContext);
      parts.push('');
    }

    parts.push('## Focus Areas');
    parts.push(`Read: ${agent.focus.reads.join(', ')}`);
    parts.push(`Write: ${agent.focus.writes.join(', ')}`);

    return parts.join('\n');
  }
}
