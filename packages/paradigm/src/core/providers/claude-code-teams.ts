/**
 * Claude Code Agent Teams Provider
 *
 * Uses Claude Code's experimental Agent Teams feature for native parallel
 * multi-agent orchestration. Multiple independent Claude Code sessions
 * coordinate via shared task lists and inter-agent messaging.
 *
 * Enable with: CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
 *
 * Key concepts:
 * - Team lead: Creates team, spawns teammates, coordinates
 * - Teammates: Independent sessions with own context windows
 * - Shared task list: TaskCreate/TaskUpdate/TaskList with file-locking
 * - Mailbox: SendMessage/broadcast for inter-agent communication
 * - Delegate mode: Lead restricted to coordination-only (no implementation)
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
// Constants
// ============================================================================

const DEFAULT_MODELS: Record<string, AgentModel> = {
  architect: 'opus',
  security: 'opus',
  reviewer: 'sonnet',
  builder: 'haiku',
  tester: 'haiku',
};

// ============================================================================
// Claude Code Agent Teams Provider
// ============================================================================

export class ClaudeCodeTeamsProvider implements AgentProvider {
  readonly name = 'claude-code-teams';

  private tasksDir: string;

  constructor(rootDir: string = process.cwd()) {
    this.tasksDir = path.join(rootDir, '.paradigm', 'tasks', 'teams');
  }

  listModels(): AgentModel[] {
    return ['opus', 'sonnet', 'haiku'];
  }

  supportsParallel(): boolean {
    // Agent Teams natively supports parallel teammates
    return true;
  }

  supportsMcp(): boolean {
    // Teammates have full MCP support
    return true;
  }

  getTokenCost(model: AgentModel): { input: number; output: number } {
    return MODEL_PRICING[model];
  }

  /**
   * Check if Agent Teams is available
   *
   * Requires:
   * 1. CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
   * 2. Running inside Claude Code
   */
  async isAvailable(): Promise<boolean> {
    const teamsEnabled = process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === '1';
    if (!teamsEnabled) {
      return false;
    }

    // Check if we're running inside Claude Code
    const claudeDir = path.join(process.env.HOME || '', '.claude');
    const inClaudeCode = fs.existsSync(claudeDir) ||
                         process.env.CLAUDE_CODE === '1' ||
                         process.env.TERM_PROGRAM === 'claude';
    return inClaudeCode;
  }

  /**
   * Spawn an agent as a Claude Code teammate
   *
   * Creates a task file with teammate spawn instructions and the
   * structured prompt for the teammate session.
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

    // Build the teammate prompt
    const teammatePrompt = this.buildTeammatePrompt(agent, options);
    const model = options.model || DEFAULT_MODELS[agent.name] || 'sonnet';

    // Create task file for the teammate
    const taskContent = {
      id: taskId,
      provider: 'claude-code-teams',
      agent: agent.name,
      model,
      status: 'pending',
      created: new Date().toISOString(),
      task: options.task,
      teammateConfig: {
        prompt: teammatePrompt,
        model,
        delegateMode: agent.name === 'architect' || agent.name === 'security',
        focus: agent.focus,
      },
      context: {
        symbols: options.context.symbols,
        handoffContext: options.context.handoffContext,
      },
    };

    fs.writeFileSync(taskFile, yaml.dump(taskContent));

    yield {
      type: 'text',
      content: `Agent Teams task created: ${taskId}\n`,
      timestamp: new Date().toISOString(),
    };

    // Output spawn instructions for the team lead
    const spawnInstruction = this.buildSpawnInstruction(agent, teammatePrompt, model);

    yield {
      type: 'text',
      content: spawnInstruction,
      timestamp: new Date().toISOString(),
    };

    // Add to shared task list
    const sharedTask = {
      subject: `${agent.name}: ${options.task.slice(0, 80)}`,
      description: teammatePrompt,
      activeForm: `Running ${agent.name} agent`,
    };

    yield {
      type: 'text',
      content: `\n**Shared task list entry:**\n\`\`\`json\n${JSON.stringify(sharedTask, null, 2)}\n\`\`\`\n`,
      timestamp: new Date().toISOString(),
    };

    yield {
      type: 'done',
      content: 'Teammate task created. Team lead should spawn teammate with the prompt above.',
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
    return `teams-${agentName}-${timestamp}-${random}`;
  }

  /**
   * Build the teammate prompt with role constraints
   */
  private buildTeammatePrompt(agent: AgentDefinition, options: SpawnOptions): string {
    const parts: string[] = [];

    // Role-specific constraints
    const constraints: Record<string, string> = {
      architect: 'Design and spec only — do NOT write implementation code.',
      security: 'Audit gates and security — do NOT make code changes.',
      builder: 'Implement from spec — follow the architect\'s design exactly.',
      reviewer: 'Review code and report issues — do NOT change implementation.',
      tester: 'Run tests and verify gates — do NOT change implementation.',
    };

    parts.push(`# ${agent.name.toUpperCase()} Agent (Teammate)`);
    parts.push('');
    parts.push('## Role');
    parts.push(agent.role);
    parts.push('');
    parts.push('## Constraint');
    parts.push(constraints[agent.name] || 'Complete the assigned task.');
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
    parts.push('');

    parts.push('## When Done');
    parts.push('Update your task status to completed and include a summary of what was accomplished.');
    parts.push('If you need another agent to continue, send a message to the team lead.');

    return parts.join('\n');
  }

  /**
   * Build spawn instruction for the team lead
   */
  private buildSpawnInstruction(
    agent: AgentDefinition,
    _prompt: string,
    model: AgentModel
  ): string {
    const isDesignOnly = agent.name === 'architect' || agent.name === 'security';

    return `
---
**To spawn this teammate, the team lead should:**

1. Create a task in the shared task list:
   \`\`\`
   TaskCreate({
     subject: "${agent.name}: ${agent.role.split('\n')[0].slice(0, 50)}",
     description: "(full prompt above)",
     activeForm: "Running ${agent.name} agent"
   })
   \`\`\`

2. The teammate will pick up the task and execute it${isDesignOnly ? ' (design/review only, no code changes)' : ''}.

3. When complete, the teammate updates the task status and sends results via the mailbox.

**Model:** ${model}
**Delegate mode:** ${isDesignOnly ? 'Yes (coordination only)' : 'No (implementation allowed)'}
---`;
  }
}
