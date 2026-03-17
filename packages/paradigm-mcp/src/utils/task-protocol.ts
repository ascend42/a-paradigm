/**
 * Task Protocol — Agent-side structured task handling
 *
 * Generates protocol instructions for agents that receive task assignments.
 * Prepended to agent context when Conductor spawns with a task, or when
 * an agent reads a task note from its inbox.
 */

import type { TaskPayload } from './symphony-loader.js';

/**
 * Generate task protocol instructions for an agent that received a task.
 * This text is prepended to the agent's prompt context.
 */
export function buildTaskProtocolPrompt(task: TaskPayload): string {
  const lines = [
    '## Active Task Assignment',
    '',
    'You have been assigned a task by the maestro/orchestrator.',
    '',
    `**Task ID:** ${task.taskId}`,
    `**Scope:** ${task.scope}`,
    `**Acceptance Criteria:** ${task.acceptance}`,
    `**Priority:** ${task.priority}`,
  ];

  if (task.externalRef) {
    lines.push(`**Reference:** ${task.externalRef}`);
  }
  if (task.deadline) {
    lines.push(`**Deadline:** ${task.deadline}`);
  }
  if (task.tags && task.tags.length > 0) {
    lines.push(`**Tags:** ${task.tags.join(', ')}`);
  }

  lines.push('');
  lines.push('## Protocol');
  lines.push('');
  lines.push('1. **Acknowledge** — Call `paradigm_symphony_send` with intent "task-ack" immediately');
  lines.push('2. **Work** — Execute the task scope. Use paradigm tools normally.');
  lines.push('3. **Report progress** — Every significant milestone, call `paradigm_symphony_send` with intent "progress" including percent complete and summary');
  lines.push('4. **Request approval** — Before committing/pushing, send intent "approval-request" with your summary and wait for response');
  lines.push('5. **Complete** — After approval, send intent "task-complete" with final summary');
  lines.push('');
  lines.push('If you hit a blocker, send intent "progress" with blockers array. The maestro will respond.');
  lines.push('Do NOT proceed past approval gates without receiving "approval-response" with decision "approved".');

  return lines.join('\n');
}

/**
 * Generate a unique task ID.
 */
export function generateTaskId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `task-${timestamp}-${random}`;
}

/**
 * Extract task payload from a message's metadata, if present.
 */
export function extractTaskPayload(metadata?: { task?: TaskPayload }): TaskPayload | null {
  return metadata?.task ?? null;
}
