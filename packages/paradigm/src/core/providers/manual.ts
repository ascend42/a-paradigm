/**
 * Manual Provider (File-Based Handoff)
 *
 * Fallback provider that creates task files for manual execution.
 * Uses the existing Paradigm handoff system.
 *
 * This is always available as the last resort.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
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
// Manual Provider
// ============================================================================

export class ManualProvider implements AgentProvider {
  readonly name = 'manual';

  private rootDir: string;

  constructor(rootDir: string = process.cwd()) {
    this.rootDir = rootDir;
  }

  listModels(): AgentModel[] {
    // Manual execution can use any model
    return ['opus', 'sonnet', 'haiku'];
  }

  supportsParallel(): boolean {
    // Manual execution is inherently sequential
    return false;
  }

  supportsMcp(): boolean {
    // Depends on how the user executes
    return true;
  }

  getTokenCost(model: AgentModel): { input: number; output: number } {
    return MODEL_PRICING[model];
  }

  async isAvailable(): Promise<boolean> {
    // Always available as fallback
    return true;
  }

  /**
   * Create a handoff file for manual execution
   */
  async *spawn(
    agent: AgentDefinition,
    options: SpawnOptions
  ): AsyncIterable<AgentMessage> {
    const handoffsDir = path.join(this.rootDir, '.paradigm', 'handoffs');
    const tasksDir = path.join(this.rootDir, '.paradigm', 'tasks');

    // Ensure directories exist
    for (const dir of [handoffsDir, tasksDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    // Generate handoff ID
    const handoffId = `${Date.now()}-manual-${agent.name}`;
    const handoffFile = path.join(handoffsDir, `${handoffId}.yaml`);
    const taskFile = path.join(tasksDir, `${handoffId}.md`);

    // Create handoff record
    const handoff = {
      id: handoffId,
      from: 'orchestrator',
      to: agent.name,
      timestamp: new Date().toISOString(),
      status: 'pending',
      completed: {
        symbols: options.context.symbols,
        artifacts: [],
      },
      context: {
        summary: options.task,
        key_symbols: options.context.symbols.map(s => ({ symbol: s, relevance: 'task-related' })),
        warnings: ['This is a manual handoff - execute the task file manually'],
        suggested_approach: `Read ${taskFile} and follow the instructions`,
      },
    };

    fs.writeFileSync(handoffFile, yaml.dump(handoff));

    // Create detailed task file (human-readable)
    const taskContent = this.buildTaskFile(agent, options, handoffId);
    fs.writeFileSync(taskFile, taskContent);

    yield {
      type: 'text',
      content: `\n📋 **Manual Handoff Created**\n\n`,
      timestamp: new Date().toISOString(),
    };

    yield {
      type: 'text',
      content: `Agent: **${agent.name}**\n`,
      timestamp: new Date().toISOString(),
    };

    yield {
      type: 'text',
      content: `Task: ${options.task}\n\n`,
      timestamp: new Date().toISOString(),
    };

    yield {
      type: 'text',
      content: `**To execute manually:**\n`,
      timestamp: new Date().toISOString(),
    };

    yield {
      type: 'text',
      content: `1. Open: ${taskFile}\n`,
      timestamp: new Date().toISOString(),
    };

    yield {
      type: 'text',
      content: `2. Follow the instructions in the file\n`,
      timestamp: new Date().toISOString(),
    };

    yield {
      type: 'text',
      content: `3. Run: \`paradigm team accept ${handoffId}\` when done\n\n`,
      timestamp: new Date().toISOString(),
    };

    yield {
      type: 'text',
      content: `Or paste this into a new Claude session:\n\`\`\`\n${this.buildPrompt(agent, options)}\n\`\`\`\n`,
      timestamp: new Date().toISOString(),
    };

    yield {
      type: 'done',
      content: 'Manual handoff created',
      usage: { input: 0, output: 0, total: 0 },
      timestamp: new Date().toISOString(),
    };
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private buildTaskFile(
    agent: AgentDefinition,
    options: SpawnOptions,
    handoffId: string
  ): string {
    const lines: string[] = [];

    lines.push(`# ${agent.name.toUpperCase()} Task`);
    lines.push('');
    lines.push(`> Handoff ID: ${handoffId}`);
    lines.push(`> Created: ${new Date().toISOString()}`);
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## Task');
    lines.push('');
    lines.push(options.task);
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## Agent Role');
    lines.push('');
    lines.push(agent.role);
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## Focus Areas');
    lines.push('');
    lines.push('**Read:** ' + agent.focus.reads.join(', '));
    lines.push('');
    lines.push('**Write:** ' + agent.focus.writes.join(', '));
    lines.push('');

    if (options.context.symbols.length > 0) {
      lines.push('---');
      lines.push('');
      lines.push('## Symbols in Scope');
      lines.push('');
      lines.push(options.context.symbols.map(s => `- \`${s}\``).join('\n'));
      lines.push('');
    }

    if (options.context.handoffContext) {
      lines.push('---');
      lines.push('');
      lines.push('## Context from Previous Agent');
      lines.push('');
      lines.push(options.context.handoffContext);
      lines.push('');
    }

    lines.push('---');
    lines.push('');
    lines.push('## When Complete');
    lines.push('');
    lines.push('Run:');
    lines.push('```bash');
    lines.push(`paradigm team accept ${handoffId}`);
    lines.push('```');
    lines.push('');

    return lines.join('\n');
  }

  private buildPrompt(agent: AgentDefinition, options: SpawnOptions): string {
    const parts: string[] = [];

    parts.push(`You are the ${agent.name.toUpperCase()} agent.`);
    parts.push('');
    parts.push('## Your Role');
    parts.push(agent.role);
    parts.push('');
    parts.push('## Task');
    parts.push(options.task);

    if (options.context.symbols.length > 0) {
      parts.push('');
      parts.push('## Symbols');
      parts.push(options.context.symbols.join(', '));
    }

    return parts.join('\n');
  }
}
