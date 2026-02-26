/**
 * Assessment Loop MCP Tools — paradigm_assessment_*
 */

import type { ProjectContext } from '../utils/index-loader.js';
import {
  loadArcs,
  loadArc,
  createArc,
  closeArc,
  loadEntries,
  loadEntry,
  recordEntry,
  searchEntries,
} from '../utils/assessment-loader.js';

// ── Tool definitions ──────────────────────────────────────

export function getAssessmentToolsList() {
  return [
    {
      name: 'paradigm_assessment_record',
      description: 'Add a reflection entry to an assessment arc. Creates the arc if it does not exist (provide arc_name). Returns entry ID. ~150 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          arc_id: { type: 'string', description: 'Arc ID (e.g., "arc-telemetry"). Created automatically if new.' },
          arc_name: { type: 'string', description: 'Human-readable arc name (required when creating a new arc)' },
          arc_description: { type: 'string', description: 'Arc description (used when creating a new arc)' },
          title: { type: 'string', description: 'Entry title' },
          summary: { type: 'string', description: 'Short summary (1-2 sentences)' },
          body: { type: 'string', description: 'Full reflection — what happened, what was learned, what changed' },
          symbols: { type: 'array', items: { type: 'string' }, description: 'Symbols touched in this entry' },
          tags: { type: 'array', items: { type: 'string' } },
          type: { type: 'string', enum: ['retro', 'insight', 'decision', 'milestone'], description: 'Entry type (default: retro)' },
          linked_lore: { type: 'array', items: { type: 'string' }, description: 'Lore entry IDs' },
          linked_tasks: { type: 'array', items: { type: 'string' }, description: 'Task IDs completed as part of this' },
          linked_commits: { type: 'array', items: { type: 'string' }, description: 'Commit hashes' },
        },
        required: ['arc_id', 'title', 'summary'],
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: 'paradigm_assessment_list',
      description: 'List assessment arcs, or entries within a specific arc. Returns arc summaries or entry summaries. ~200 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          arc_id: { type: 'string', description: 'If provided, list entries in this arc. Otherwise, list all arcs.' },
          status: { type: 'string', enum: ['active', 'complete', 'archived', 'all'], description: 'Filter arcs by status (default: active). Ignored when arc_id is provided.' },
          limit: { type: 'number', description: 'Maximum results (default: 20)' },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: 'paradigm_assessment_get',
      description: 'Get a specific assessment entry or arc detail. Pass an entry ID (A-*) or arc ID (arc-*). Returns full entry or arc with entry list. ~200 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Entry ID (e.g., "A-2026-02-26-001") or arc ID (e.g., "arc-telemetry")' },
        },
        required: ['id'],
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: 'paradigm_assessment_search',
      description: 'Search across all assessment arcs by symbol, tag, date range, or type. Returns matching entries with arc context. ~200 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Filter by symbol' },
          tag: { type: 'string', description: 'Filter by tag' },
          type: { type: 'string', enum: ['retro', 'insight', 'decision', 'milestone'] },
          dateFrom: { type: 'string', description: 'ISO date string (inclusive)' },
          dateTo: { type: 'string', description: 'ISO date string (inclusive)' },
          limit: { type: 'number', description: 'Max results (default: 20)' },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: 'paradigm_assessment_arc_create',
      description: 'Explicitly create an assessment arc (without adding an entry). Returns arc ID. ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Arc ID (e.g., "arc-telemetry"). Kebab-case, prefixed with "arc-".' },
          name: { type: 'string', description: 'Human-readable arc name' },
          description: { type: 'string', description: 'What this arc tracks' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'name'],
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: 'paradigm_assessment_arc_close',
      description: 'Mark an assessment arc as complete or archived. Returns confirmation. ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          arc_id: { type: 'string', description: 'Arc ID to close' },
          status: { type: 'string', enum: ['complete', 'archived'], description: 'New status (default: complete)' },
        },
        required: ['arc_id'],
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
  ];
}

// ── Handler ───────────────────────────────────────────────

export async function handleAssessmentTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ProjectContext,
): Promise<{ text: string; handled: boolean }> {
  switch (name) {
    case 'paradigm_assessment_record': {
      try {
        const id = await recordEntry(
          ctx.rootDir,
          {
            arc_id: args.arc_id as string,
            title: args.title as string,
            summary: args.summary as string,
            body: args.body as string | undefined,
            symbols: args.symbols as string[] | undefined,
            tags: args.tags as string[] | undefined,
            type: args.type as string | undefined,
            linked_lore: args.linked_lore as string[] | undefined,
            linked_tasks: args.linked_tasks as string[] | undefined,
            linked_commits: args.linked_commits as string[] | undefined,
          },
          args.arc_name as string | undefined,
          args.arc_description as string | undefined,
        );

        return {
          handled: true,
          text: JSON.stringify({ recorded: id, arc_id: args.arc_id }, null, 2),
        };
      } catch (err) {
        return {
          handled: true,
          text: JSON.stringify({ error: (err as Error).message }),
        };
      }
    }

    case 'paradigm_assessment_list': {
      const arcId = args.arc_id as string | undefined;

      if (arcId) {
        // List entries in a specific arc
        const entries = await loadEntries(ctx.rootDir, arcId);
        const limited = entries.slice(0, (args.limit as number) || 20);
        const arc = await loadArc(ctx.rootDir, arcId);
        const arcName = arc ? arc.name : arcId;

        const lines = [`${limited.length} entries in "${arcName}" (${arcId}):`];
        for (const e of limited) {
          lines.push(`  [${e.type}] ${e.id}: ${e.title} (${e.date.slice(0, 10)})`);
        }

        return { handled: true, text: lines.join('\n') };
      }

      // List all arcs
      const status = (args.status as string) || 'active';
      const arcs = await loadArcs(ctx.rootDir, status);
      const limited = arcs.slice(0, (args.limit as number) || 20);

      const lines = [`${limited.length} ${status} arc(s):`];
      for (const a of limited) {
        const symbols = a.symbols.length > 0 ? ` [${a.symbols.slice(0, 3).join(', ')}]` : '';
        lines.push(`  ${a.id}: ${a.name} (${a.entry_count} entries)${symbols}`);
      }

      return { handled: true, text: lines.join('\n') };
    }

    case 'paradigm_assessment_get': {
      const id = args.id as string;

      if (id.startsWith('arc-')) {
        // Get arc detail
        const arc = await loadArc(ctx.rootDir, id);
        if (!arc) {
          return { handled: true, text: JSON.stringify({ error: `Arc ${id} not found` }) };
        }

        const entries = await loadEntries(ctx.rootDir, id);
        return {
          handled: true,
          text: JSON.stringify({
            arc,
            entries: entries.map(e => ({ id: e.id, type: e.type, title: e.title, date: e.date.slice(0, 10), summary: e.summary })),
          }, null, 2),
        };
      }

      // Get entry detail
      const result = await loadEntry(ctx.rootDir, id);
      if (!result) {
        return { handled: true, text: JSON.stringify({ error: `Entry ${id} not found` }) };
      }

      return {
        handled: true,
        text: JSON.stringify({ entry: result.entry, arc: { id: result.arc.id, name: result.arc.name, status: result.arc.status } }, null, 2),
      };
    }

    case 'paradigm_assessment_search': {
      const entries = await searchEntries(ctx.rootDir, {
        symbol: args.symbol as string | undefined,
        tag: args.tag as string | undefined,
        type: args.type as 'retro' | 'insight' | 'decision' | 'milestone' | undefined,
        dateFrom: args.dateFrom as string | undefined,
        dateTo: args.dateTo as string | undefined,
        limit: (args.limit as number) || 20,
      });

      const lines = [`${entries.length} matching entries:`];
      for (const e of entries) {
        const symbols = (e.symbols || []).slice(0, 3).join(', ');
        lines.push(`  [${e.type}] ${e.id} (${e.arc_id}): ${e.title} — ${symbols}`);
      }

      return { handled: true, text: lines.join('\n') };
    }

    case 'paradigm_assessment_arc_create': {
      try {
        const arcId = await createArc(ctx.rootDir, {
          id: args.id as string,
          name: args.name as string,
          description: args.description as string | undefined,
          tags: args.tags as string[] | undefined,
        });

        return { handled: true, text: JSON.stringify({ created: arcId }, null, 2) };
      } catch (err) {
        return { handled: true, text: JSON.stringify({ error: (err as Error).message }) };
      }
    }

    case 'paradigm_assessment_arc_close': {
      const arcId = args.arc_id as string;
      const status = (args.status as 'complete' | 'archived') || 'complete';

      const ok = await closeArc(ctx.rootDir, arcId, status);
      if (!ok) {
        return { handled: true, text: JSON.stringify({ error: `Arc ${arcId} not found` }) };
      }

      return { handled: true, text: JSON.stringify({ closed: arcId, status }, null, 2) };
    }

    default:
      return { handled: false, text: '' };
  }
}
