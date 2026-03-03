/**
 * Assessment Loop MCP Tools — paradigm_assessment_*
 *
 * [DEPRECATED] These tools are thin wrappers that forward to lore tools.
 * Assessments are now unified with lore — arcs become `arc:*` tags,
 * assessment types become regular lore types.
 *
 * Use lore tools directly:
 * - paradigm_lore_record (with arc:* tags for arc grouping)
 * - paradigm_lore_search (with tag filter for arc:* queries)
 * - paradigm_lore_get
 */

import type { ProjectContext } from '../utils/index-loader.js';
import {
  loadLoreEntries,
  loadLoreEntry,
  recordLoreEntry,
  updateLoreEntry,
  type LoreEntry,
} from '../utils/lore-loader.js';
// Keep old imports for backward-compatible arc_create/arc_close
import {
  loadArcs,
  loadArc,
  createArc,
  closeArc,
  loadEntries,
  loadEntry,
  searchEntries,
} from '../utils/assessment-loader.js';
import { execSync } from 'child_process';
import * as os from 'os';

function resolveAuthor(): string {
  const envAuthor = process.env.PARADIGM_AUTHOR;
  if (envAuthor) return sanitize(envAuthor);
  try {
    const gitName = execSync('git config user.name', { encoding: 'utf-8', timeout: 3000 }).trim();
    if (gitName) return sanitize(gitName);
  } catch {}
  try {
    const username = os.userInfo().username;
    if (username) return sanitize(username);
  } catch {}
  return 'unknown';
}

function sanitize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'unknown';
}

// ── Tool definitions ──────────────────────────────────────

export function getAssessmentToolsList() {
  return [
    {
      name: 'paradigm_assessment_record',
      description: '[DEPRECATED — use paradigm_lore_record with arc:* tags] Add a reflection entry. Forwards to lore with arc:{arc_id} and assessment:{type} tags. ~150 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          arc_id: { type: 'string', description: 'Arc ID (becomes arc:{id} tag on the lore entry)' },
          arc_name: { type: 'string', description: 'Human-readable arc name (ignored — arcs are now just tags)' },
          arc_description: { type: 'string', description: 'Arc description (ignored — arcs are now just tags)' },
          title: { type: 'string', description: 'Entry title' },
          summary: { type: 'string', description: 'Short summary (1-2 sentences)' },
          body: { type: 'string', description: 'Full reflection — what happened, what was learned, what changed' },
          symbols: { type: 'array', items: { type: 'string' }, description: 'Symbols touched in this entry' },
          tags: { type: 'array', items: { type: 'string' } },
          type: { type: 'string', enum: ['retro', 'insight', 'decision', 'milestone'], description: 'Entry type (default: retro)' },
          linked_lore: { type: 'array', items: { type: 'string' }, description: 'Lore entry IDs' },
          linked_tasks: { type: 'array', items: { type: 'string' }, description: 'Task IDs' },
          linked_commits: { type: 'array', items: { type: 'string' }, description: 'Commit hashes' },
        },
        required: ['arc_id', 'title', 'summary'],
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: 'paradigm_assessment_list',
      description: '[DEPRECATED — use paradigm_lore_search with tag:"arc:{id}"] List assessment arcs or entries within a specific arc. ~200 tokens.',
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
      description: '[DEPRECATED — use paradigm_lore_get] Get a specific assessment entry or arc detail. ~200 tokens.',
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
      description: '[DEPRECATED — use paradigm_lore_search with tag/type filters] Search across assessment entries by symbol, tag, type, or date. ~200 tokens.',
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
      description: '[DEPRECATED — arcs are now tag prefixes] No-op. Arcs are just arc:* tags on lore entries. No explicit creation needed. ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Arc ID (no longer needed — just use arc:{id} tag on lore entries)' },
          name: { type: 'string', description: 'Arc name (ignored)' },
          description: { type: 'string', description: 'Arc description (ignored)' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'name'],
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: 'paradigm_assessment_arc_close',
      description: '[DEPRECATED — use paradigm_lore_search + paradigm_lore_update] Adds arc-closed tag to all entries in the arc. ~100 tokens.',
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
      // Forward to lore with arc tags
      const arcId = args.arc_id as string;
      const entryType = (args.type as string) || 'retro';
      const userTags = (args.tags as string[]) || [];
      const tags = [
        `arc:${arcId}`,
        `assessment:${entryType}`,
        ...userTags,
      ];

      const entry: LoreEntry = {
        id: '',
        type: entryType as LoreEntry['type'],
        timestamp: new Date().toISOString(),
        author: resolveAuthor(),
        agent: { provider: 'anthropic', model: 'claude-opus-4-6' },
        title: args.title as string,
        summary: args.summary as string,
        body: args.body as string | undefined,
        symbols_touched: (args.symbols as string[]) || [],
        tags,
        linked_lore: args.linked_lore as string[] | undefined,
        linked_tasks: args.linked_tasks as string[] | undefined,
        linked_commits: args.linked_commits as string[] | undefined,
      };

      try {
        const id = await recordLoreEntry(ctx.rootDir, entry);
        return {
          handled: true,
          text: JSON.stringify({
            recorded: id,
            arc_id: arcId,
            deprecated: 'Use paradigm_lore_record with tags: ["arc:' + arcId + '"] instead',
          }, null, 2),
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
        // Search lore for entries with this arc tag
        const entries = await loadLoreEntries(ctx.rootDir, {
          tag: `arc:${arcId}`,
          limit: (args.limit as number) || 20,
        });

        const lines = [`${entries.length} entries with arc:${arcId} tag:`];
        for (const e of entries) {
          lines.push(`  [${e.type || 'unknown'}] ${e.id}: ${e.title} (${e.timestamp.slice(0, 10)})`);
        }
        lines.push('', 'Deprecated: Use paradigm_lore_search with tag: "arc:' + arcId + '"');

        return { handled: true, text: lines.join('\n') };
      }

      // Fall back to old arc listing (for unmigrated data)
      try {
        const status = (args.status as string) || 'active';
        const arcs = await loadArcs(ctx.rootDir, status);
        const limited = arcs.slice(0, (args.limit as number) || 20);

        const lines = [`${limited.length} ${status} arc(s):`];
        for (const a of limited) {
          const symbols = a.symbols.length > 0 ? ` [${a.symbols.slice(0, 3).join(', ')}]` : '';
          lines.push(`  ${a.id}: ${a.name} (${a.entry_count} entries)${symbols}`);
        }
        lines.push('', 'Deprecated: Run "paradigm lore migrate-assessments" then use paradigm_lore_search');

        return { handled: true, text: lines.join('\n') };
      } catch {
        return { handled: true, text: 'No assessment arcs found. Assessments are now unified with lore.' };
      }
    }

    case 'paradigm_assessment_get': {
      const id = args.id as string;

      // Try lore first (for migrated entries or new entries)
      if (id.startsWith('L-')) {
        const entry = await loadLoreEntry(ctx.rootDir, id);
        if (entry) {
          return {
            handled: true,
            text: JSON.stringify({
              entry,
              deprecated: 'Use paradigm_lore_get instead',
            }, null, 2),
          };
        }
      }

      // Fall back to old assessment system
      if (id.startsWith('arc-')) {
        try {
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
              deprecated: 'Run "paradigm lore migrate-assessments" then use paradigm_lore_search with tag: "arc:' + id + '"',
            }, null, 2),
          };
        } catch {
          return { handled: true, text: JSON.stringify({ error: `Arc ${id} not found` }) };
        }
      }

      // Old A-* IDs
      try {
        const result = await loadEntry(ctx.rootDir, id);
        if (!result) {
          return { handled: true, text: JSON.stringify({ error: `Entry ${id} not found` }) };
        }
        return {
          handled: true,
          text: JSON.stringify({
            entry: result.entry,
            arc: { id: result.arc.id, name: result.arc.name, status: result.arc.status },
            deprecated: 'Run "paradigm lore migrate-assessments" then use paradigm_lore_get',
          }, null, 2),
        };
      } catch {
        return { handled: true, text: JSON.stringify({ error: `Entry ${id} not found` }) };
      }
    }

    case 'paradigm_assessment_search': {
      // Try lore search first with tag/type filters
      const filter: Record<string, unknown> = {
        limit: (args.limit as number) || 20,
      };
      if (args.symbol) filter.symbol = args.symbol;
      if (args.tag) filter.tag = args.tag;
      if (args.type) filter.tag = `assessment:${args.type}`;
      if (args.dateFrom) filter.dateFrom = args.dateFrom;
      if (args.dateTo) filter.dateTo = args.dateTo;

      // Search lore entries that have arc:* tags
      const loreEntries = await loadLoreEntries(ctx.rootDir, filter as any);
      const arcEntries = loreEntries.filter(e => e.tags?.some(t => t.startsWith('arc:')));

      if (arcEntries.length > 0) {
        const lines = [`${arcEntries.length} matching lore entries (with arc tags):`];
        for (const e of arcEntries) {
          const arcTag = e.tags?.find(t => t.startsWith('arc:')) || '';
          const symbols = (e.symbols_touched || []).slice(0, 3).join(', ');
          lines.push(`  [${e.type || 'unknown'}] ${e.id} (${arcTag}): ${e.title} — ${symbols}`);
        }
        lines.push('', 'Deprecated: Use paradigm_lore_search with tag filter');
        return { handled: true, text: lines.join('\n') };
      }

      // Fall back to old assessment search
      try {
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
        lines.push('', 'Deprecated: Run "paradigm lore migrate-assessments" then use paradigm_lore_search');
        return { handled: true, text: lines.join('\n') };
      } catch {
        return { handled: true, text: '0 matching entries.' };
      }
    }

    case 'paradigm_assessment_arc_create': {
      // No-op — arcs are just tag prefixes now
      return {
        handled: true,
        text: JSON.stringify({
          message: 'Arcs are now tag prefixes on lore entries. No explicit creation needed.',
          guidance: `To create entries in this arc, use paradigm_lore_record with tags: ["arc:${args.id}"]`,
          deprecated: true,
        }, null, 2),
      };
    }

    case 'paradigm_assessment_arc_close': {
      const arcId = args.arc_id as string;
      const status = (args.status as string) || 'complete';

      // Find all lore entries with this arc tag and add arc-closed tag
      const entries = await loadLoreEntries(ctx.rootDir, { tag: `arc:${arcId}` });
      let updated = 0;

      for (const entry of entries) {
        const currentTags = entry.tags || [];
        if (!currentTags.includes('arc-closed')) {
          await updateLoreEntry(ctx.rootDir, entry.id, {
            tags: [...currentTags, 'arc-closed', `arc-status:${status}`],
          });
          updated++;
        }
      }

      // Also try closing the old arc if it exists
      try {
        await closeArc(ctx.rootDir, arcId, status as 'complete' | 'archived');
      } catch {
        // Old arc may not exist if already migrated
      }

      return {
        handled: true,
        text: JSON.stringify({
          closed: arcId,
          status,
          lore_entries_tagged: updated,
          deprecated: 'Use paradigm_lore_search + paradigm_lore_update to manage arc lifecycle via tags',
        }, null, 2),
      };
    }

    default:
      return { handled: false, text: '' };
  }
}
