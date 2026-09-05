/**
 * Task Management MCP Tools — paradigm_task_*
 */

import type { ProjectContext } from '../utils/index-loader.js';
import { loadTasks, loadTask, createTask, updateTask, completeTask, shelveTask, legalTransitionsFrom } from '../utils/task-loader.js';
import type { Claimant, ExternalRef, TaskStatus } from '../utils/task-loader.js';

/**
 * `updateTask`/`completeTask`/`shelveTask` collapse "task not found" and
 * "illegal status transition" into the same falsy result (task-loader.ts's
 * `updateTask`, by design — it does not throw). Left alone, every one of these
 * MCP handlers reported an illegal transition as "Task X not found", which is
 * actively misleading: the task exists, and the real reason (e.g. a `shelved`
 * task can only legally move back to `open`, never straight to `done`) was
 * invisible to the caller. This re-derives the real reason for the caller.
 */
async function explainTaskUpdateFailure(
  rootDir: string,
  id: string,
  targetStatus?: TaskStatus,
): Promise<string> {
  const existing = await loadTask(rootDir, id);
  if (!existing) {
    return JSON.stringify({ error: `Task ${id} not found` });
  }
  if (targetStatus !== undefined && targetStatus !== existing.status) {
    return JSON.stringify({
      error: `Task ${id} is '${existing.status}' — cannot transition to '${targetStatus}'.`,
      legalTransitions: legalTransitionsFrom(existing.status),
    });
  }
  return JSON.stringify({ error: `Task ${id} not found` });
}

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
          claimant: {
            type: 'object',
            description: 'Owner of this task (v7 DAG). kind: archetype|human|peer; ref: role id / git user / agentId',
            properties: {
              kind: { type: 'string', enum: ['archetype', 'human', 'peer'] },
              ref: { type: 'string' },
            },
          },
          parentTaskId: { type: 'string', description: 'Parent task id (v7 DAG edge)' },
          dependsOn: { type: 'array', items: { type: 'string' }, description: 'Task ids this task depends on (v7 DAG edges)' },
          stage: { type: 'number', description: 'Orchestration stage index (v7 DAG)' },
          external_ref: {
            type: 'object',
            description: 'External anchor (provider-agnostic). provider: a free string — known: github (synced), session|symphony|orchestration|url (inert anchors). url/syncedAt populated by a provider push/link.',
            properties: {
              provider: { type: 'string', description: 'Provider/anchor id. Known: github (the only synced provider), session, symphony, orchestration, url.' },
              ref: { type: 'string' },
              url: { type: 'string' },
              syncedAt: { type: 'string' },
            },
          },
          session_link: { type: 'string', description: '(Deprecated — use external_ref) Legacy external anchor; aliased to external_ref' },
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
          status: { type: 'string', enum: ['open', 'in-progress', 'done', 'shelved', 'active', 'all'], description: "Filter by status (default: open). 'active' = open ∪ in-progress" },
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
          status: { type: 'string', enum: ['open', 'in-progress', 'done', 'shelved'] },
          tags: { type: 'array', items: { type: 'string' }, description: 'Replace tags' },
          related_lore: { type: 'array', items: { type: 'string' }, description: 'Related lore entry IDs (includes former assessment entries)' },
          related_assessments: { type: 'array', items: { type: 'string' }, description: '(Deprecated — use related_lore) Alias for related_lore' },
          claimant: {
            type: 'object',
            description: 'Owner of this task (v7 DAG). kind: archetype|human|peer; ref: role id / git user / agentId',
            properties: {
              kind: { type: 'string', enum: ['archetype', 'human', 'peer'] },
              ref: { type: 'string' },
            },
          },
          parentTaskId: { type: 'string', description: 'Parent task id (v7 DAG edge)' },
          dependsOn: { type: 'array', items: { type: 'string' }, description: 'Task ids this task depends on (v7 DAG edges)' },
          stage: { type: 'number', description: 'Orchestration stage index (v7 DAG)' },
          external_ref: {
            type: 'object',
            description: 'External anchor (provider-agnostic). provider: a free string — known: github (synced), session|symphony|orchestration|url (inert anchors). url/syncedAt populated by a provider push/link.',
            properties: {
              provider: { type: 'string', description: 'Provider/anchor id. Known: github (the only synced provider), session, symphony, orchestration, url.' },
              ref: { type: 'string' },
              url: { type: 'string' },
              syncedAt: { type: 'string' },
            },
          },
          session_link: { type: 'string', description: '(Deprecated — use external_ref) Legacy external anchor; aliased to external_ref' },
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
        claimant: args.claimant as Claimant | undefined,
        parentTaskId: args.parentTaskId as string | undefined,
        dependsOn: args.dependsOn as string[] | undefined,
        stage: args.stage as number | undefined,
        // Accept legacy session_link; createTask/normalizeTask alias it to external_ref.
        external_ref: args.external_ref as ExternalRef | undefined,
        session_link: args.session_link as string | undefined,
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
      if (args.claimant !== undefined) partial.claimant = args.claimant;
      if (args.parentTaskId !== undefined) partial.parentTaskId = args.parentTaskId;
      if (args.dependsOn !== undefined) partial.dependsOn = args.dependsOn;
      if (args.stage !== undefined) partial.stage = args.stage;
      if (args.external_ref !== undefined) partial.external_ref = args.external_ref;
      // Legacy session_link → external_ref alias (infer provider, parity with normalizeTask).
      if (args.session_link !== undefined && args.external_ref === undefined) {
        const ref = args.session_link as string;
        const lower = ref.toLowerCase();
        const provider = lower.includes('github') ? 'github' : lower.includes('session') ? 'session' : 'url';
        partial.external_ref = { provider, ref };
      }

      const ok = await updateTask(ctx.rootDir, id, partial as Partial<import('../utils/task-loader.js').Task>);
      if (!ok) {
        return { handled: true, text: await explainTaskUpdateFailure(ctx.rootDir, id, partial.status as TaskStatus | undefined) };
      }

      const updated = await loadTask(ctx.rootDir, id);
      return { handled: true, text: JSON.stringify({ updated: id, task: updated }, null, 2) };
    }

    case 'paradigm_task_done': {
      const id = args.id as string;
      const ok = await completeTask(ctx.rootDir, id);
      if (!ok) {
        return { handled: true, text: await explainTaskUpdateFailure(ctx.rootDir, id, 'done') };
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
        return { handled: true, text: await explainTaskUpdateFailure(ctx.rootDir, id, 'shelved') };
      }

      const task = await loadTask(ctx.rootDir, id);
      return { handled: true, text: JSON.stringify({ shelved: id, task }, null, 2) };
    }

    default:
      return { handled: false, text: '' };
  }
}
