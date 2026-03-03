/**
 * Task Management MCP Tools — paradigm_task_*
 */

import type { ProjectContext } from '../utils/index-loader.js';
import { loadTasks, loadTask, createTask, updateTask, completeTask, shelveTask } from '../utils/task-loader.js';

// ── Tool definitions ──────────────────────────────────────

export function getTasksToolsList() {
  return [
    {
      name: 'paradigm_task_create',
      description: 'Create a task (persistent scratch-pad item that survives context windows). Returns the created task ID. ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          blurb: { type: 'string', description: 'One-line task description' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Priority level (default: medium)' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags — symbols (#component), freeform labels, etc.' },
          related_lore: { type: 'array', items: { type: 'string' }, description: 'Linked lore entry IDs' },
        },
        required: ['blurb'],
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: 'paradigm_task_list',
      description: 'List/filter tasks by status, priority, tags, or symbols. Returns task list sorted by priority then date. ~200 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['open', 'done', 'shelved', 'all'], description: 'Filter by status (default: open)' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Filter by priority' },
          tag: { type: 'string', description: 'Filter by tag (symbol or freeform)' },
          limit: { type: 'number', description: 'Maximum results (default: 20)' },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: 'paradigm_task_update',
      description: 'Update a task (blurb, priority, status, tags). Returns updated task. ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Task ID (e.g., "T-2026-02-26-001")' },
          blurb: { type: 'string', description: 'New description' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          status: { type: 'string', enum: ['open', 'done', 'shelved'] },
          tags: { type: 'array', items: { type: 'string' }, description: 'Replace tags' },
          related_lore: { type: 'array', items: { type: 'string' }, description: 'Related lore entry IDs (includes former assessment entries)' },
          related_assessments: { type: 'array', items: { type: 'string' }, description: '(Deprecated — use related_lore) Alias for related_lore' },
        },
        required: ['id'],
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: 'paradigm_task_done',
      description: 'Mark a task as done. Shorthand for update with status=done. Returns confirmation. ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Task ID' },
        },
        required: ['id'],
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: 'paradigm_task_shelve',
      description: 'Shelve a task (not now, not never). Shorthand for update with status=shelved. Returns confirmation. ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Task ID' },
        },
        required: ['id'],
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
  ];
}

// ── Handler ───────────────────────────────────────────────

export async function handleTasksTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ProjectContext,
): Promise<{ text: string; handled: boolean }> {
  switch (name) {
    case 'paradigm_task_create': {
      const id = await createTask(ctx.rootDir, {
        blurb: args.blurb as string,
        priority: args.priority as string | undefined,
        tags: args.tags as string[] | undefined,
        related_lore: args.related_lore as string[] | undefined,
      });

      const task = await loadTask(ctx.rootDir, id);
      return {
        handled: true,
        text: JSON.stringify({ created: id, task }, null, 2),
      };
    }

    case 'paradigm_task_list': {
      const tasks = await loadTasks(ctx.rootDir, {
        status: (args.status as string) || 'open',
        priority: args.priority as string | undefined,
        tag: args.tag as string | undefined,
        limit: (args.limit as number) || 20,
      });

      const statusLabel = (args.status as string) || 'open';
      const lines = [`${tasks.length} ${statusLabel} task(s):`];
      for (const t of tasks) {
        const tags = t.tags.length > 0 ? ` [${t.tags.join(', ')}]` : '';
        lines.push(`  [${t.priority}] ${t.id}: ${t.blurb}${tags}`);
      }

      return { handled: true, text: lines.join('\n') };
    }

    case 'paradigm_task_update': {
      const id = args.id as string;
      const partial: Record<string, unknown> = {};
      if (args.blurb !== undefined) partial.blurb = args.blurb;
      if (args.priority !== undefined) partial.priority = args.priority;
      if (args.status !== undefined) partial.status = args.status;
      if (args.tags !== undefined) partial.tags = args.tags;
      if (args.related_lore !== undefined) partial.related_lore = args.related_lore;
      if (args.related_assessments !== undefined) partial.related_assessments = args.related_assessments;

      const ok = await updateTask(ctx.rootDir, id, partial as Partial<import('../utils/task-loader.js').Task>);
      if (!ok) {
        return { handled: true, text: JSON.stringify({ error: `Task ${id} not found` }) };
      }

      const updated = await loadTask(ctx.rootDir, id);
      return { handled: true, text: JSON.stringify({ updated: id, task: updated }, null, 2) };
    }

    case 'paradigm_task_done': {
      const id = args.id as string;
      const ok = await completeTask(ctx.rootDir, id);
      if (!ok) {
        return { handled: true, text: JSON.stringify({ error: `Task ${id} not found` }) };
      }

      const task = await loadTask(ctx.rootDir, id);
      return {
        handled: true,
        text: JSON.stringify({
          completed: id,
          task,
          hint: 'Consider recording a lore entry with arc:* tags if this was a significant milestone.',
        }, null, 2),
      };
    }

    case 'paradigm_task_shelve': {
      const id = args.id as string;
      const ok = await shelveTask(ctx.rootDir, id);
      if (!ok) {
        return { handled: true, text: JSON.stringify({ error: `Task ${id} not found` }) };
      }

      const task = await loadTask(ctx.rootDir, id);
      return { handled: true, text: JSON.stringify({ shelved: id, task }, null, 2) };
    }

    default:
      return { handled: false, text: '' };
  }
}
