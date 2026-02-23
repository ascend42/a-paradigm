/**
 * Lore MCP Tools - Query and record project lore entries
 *
 * Tools:
 * - paradigm_lore_search: Search entries by symbol, author, date, tags
 * - paradigm_lore_record: Record a new lore entry
 * - paradigm_lore_timeline: Timeline overview with recent entries and hot symbols
 */

import type { ProjectContext } from '../utils/index-loader.js';
import {
  loadLoreEntries,
  loadLoreEntry,
  loadLoreTimeline,
  recordLoreEntry,
  updateLoreEntry,
  deleteLoreEntry,
  type LoreEntry,
  type LoreFilter,
} from '../utils/lore-loader.js';
import { getComplianceRate, getComplianceByCategory } from '../utils/practice-store.js';
import { getSessionTracker } from '../utils/session-tracker.js';

/**
 * Get list of lore tools with safety annotations
 */
export function getLoreToolsList() {
  return [
    {
      name: 'paradigm_lore_search',
      description:
        'Search lore entries by symbol, author, date range, type, or tags. Returns project history records.',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            description: 'Filter by symbol (e.g., "#sentinel-sdk", "^authenticated")',
          },
          author: {
            type: 'string',
            description: 'Filter by author ID (e.g., "ascend", "claude-opus-4")',
          },
          authorType: {
            type: 'string',
            enum: ['human', 'agent'],
            description: 'Filter by author type',
          },
          type: {
            type: 'string',
            enum: ['agent-session', 'human-note', 'decision', 'review', 'incident', 'milestone'],
            description: 'Filter by entry type',
          },
          dateFrom: {
            type: 'string',
            description: 'Filter from date (ISO 8601, e.g., "2026-02-20")',
          },
          dateTo: {
            type: 'string',
            description: 'Filter to date (ISO 8601)',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Filter by tags (OR logic)',
          },
          hasReview: {
            type: 'boolean',
            description: 'Filter for entries with/without reviews',
          },
          limit: {
            type: 'number',
            description: 'Maximum results (default: 20)',
          },
          offset: {
            type: 'number',
            description: 'Offset for pagination',
          },
        },
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_lore_record',
      description:
        'Record a new lore entry (agent session, decision, milestone, etc.). Call after completing significant work.',
      inputSchema: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['agent-session', 'human-note', 'decision', 'review', 'incident', 'milestone'],
            description: 'Entry type',
          },
          title: {
            type: 'string',
            description: 'Short title (e.g., "Built Sentinel Phase 1")',
          },
          summary: {
            type: 'string',
            description: '2-3 sentence narrative summary',
          },
          symbols_touched: {
            type: 'array',
            items: { type: 'string' },
            description: 'Symbols affected (e.g., ["#sentinel-sdk", "^authenticated"])',
          },
          symbols_created: {
            type: 'array',
            items: { type: 'string' },
            description: 'New symbols introduced',
          },
          files_created: {
            type: 'array',
            items: { type: 'string' },
            description: 'Files created',
          },
          files_modified: {
            type: 'array',
            items: { type: 'string' },
            description: 'Files modified',
          },
          lines_added: { type: 'number', description: 'Lines of code added' },
          lines_removed: { type: 'number', description: 'Lines of code removed' },
          commit: { type: 'string', description: 'Git commit hash' },
          duration_minutes: { type: 'number', description: 'Duration in minutes' },
          decisions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                decision: { type: 'string' },
                rationale: { type: 'string' },
              },
              required: ['id', 'decision', 'rationale'],
            },
            description: 'Decisions made during this work',
          },
          errors_encountered: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                description: { type: 'string' },
                resolution: { type: 'string' },
                time_to_fix: { type: 'string' },
              },
              required: ['description', 'resolution'],
            },
          },
          learnings: {
            type: 'array',
            items: { type: 'string' },
            description: 'Key learnings from this work',
          },
          verification: {
            type: 'object',
            properties: {
              status: {
                type: 'string',
                enum: ['pass', 'fail', 'partial', 'untested'],
              },
              details: {
                type: 'object',
                description: 'Per-check results (e.g., { "build": "pass", "tests": "fail" })',
              },
            },
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tags for categorization',
          },
        },
        required: ['type', 'title', 'summary', 'symbols_touched'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_lore_timeline',
      description:
        'Get lore timeline overview: recent entries, active authors, hot symbols. Call for project history orientation.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Number of recent entries to include (default: 10)',
          },
        },
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_lore_get',
      description:
        'Fetch a single lore entry by ID. Returns the full entry with all fields.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Lore entry ID (e.g., "L-2026-02-23-001")',
          },
        },
        required: ['id'],
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_lore_update',
      description:
        'Update an existing lore entry. Merges provided fields into the existing entry.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Lore entry ID to update',
          },
          title: { type: 'string', description: 'New title' },
          summary: { type: 'string', description: 'New summary' },
          type: {
            type: 'string',
            enum: ['agent-session', 'human-note', 'decision', 'review', 'incident', 'milestone'],
            description: 'New entry type',
          },
          symbols_touched: {
            type: 'array',
            items: { type: 'string' },
            description: 'Updated symbols list',
          },
          symbols_created: {
            type: 'array',
            items: { type: 'string' },
            description: 'Updated created symbols',
          },
          files_created: {
            type: 'array',
            items: { type: 'string' },
          },
          files_modified: {
            type: 'array',
            items: { type: 'string' },
          },
          lines_added: { type: 'number' },
          lines_removed: { type: 'number' },
          commit: { type: 'string' },
          duration_minutes: { type: 'number' },
          learnings: {
            type: 'array',
            items: { type: 'string' },
            description: 'Updated learnings',
          },
          verification: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['pass', 'fail', 'partial', 'untested'] },
              details: { type: 'object' },
            },
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['id'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_lore_delete',
      description:
        'Delete a lore entry. Requires explicit confirmation to prevent accidental deletion.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Lore entry ID to delete',
          },
          confirm: {
            type: 'boolean',
            description: 'Must be true to proceed with deletion',
          },
        },
        required: ['id', 'confirm'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
      },
    },
  ];
}

/**
 * Handle lore tool calls
 */
export async function handleLoreTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ProjectContext
): Promise<{ text: string; handled: boolean }> {
  switch (name) {
    case 'paradigm_lore_search': {
      const filter: LoreFilter = {
        author: args.author as string | undefined,
        authorType: args.authorType as LoreFilter['authorType'],
        symbol: args.symbol as string | undefined,
        dateFrom: args.dateFrom as string | undefined,
        dateTo: args.dateTo as string | undefined,
        type: args.type as LoreFilter['type'],
        tags: args.tags as string[] | undefined,
        hasReview: args.hasReview as boolean | undefined,
        limit: (args.limit as number) || 20,
        offset: args.offset as number | undefined,
      };

      const entries = await loadLoreEntries(ctx.rootDir, filter);

      return {
        handled: true,
        text: JSON.stringify({
          count: entries.length,
          filter: Object.fromEntries(
            Object.entries(filter).filter(([, v]) => v !== undefined)
          ),
          entries: entries.map(summarizeEntry),
        }, null, 2),
      };
    }

    case 'paradigm_lore_record': {
      const {
        type, title, summary, symbols_touched,
        symbols_created, files_created, files_modified,
        lines_added, lines_removed, commit, duration_minutes,
        decisions, errors_encountered, learnings,
        verification, tags,
      } = args as Partial<LoreEntry> & {
        type: LoreEntry['type'];
        title: string;
        summary: string;
        symbols_touched: string[];
      };

      // Auto-attach habit compliance data
      let habit_compliance: LoreEntry['habit_compliance'];
      try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const compliance = await getComplianceRate(ctx.rootDir, { dateFrom: thirtyDaysAgo });
        if (compliance.total > 0) {
          const byCategory = await getComplianceByCategory(ctx.rootDir, { dateFrom: thirtyDaysAgo });
          const weakAreas = byCategory.filter(c => c.rate < 60).map(c => c.category);
          habit_compliance = {
            rate: compliance.rate,
            followed: compliance.followed,
            skipped: compliance.skipped,
            partial: compliance.partial,
            weakAreas: weakAreas.length > 0 ? weakAreas : undefined,
          };
        }
      } catch {
        // Habit compliance is optional
      }

      const entry: LoreEntry = {
        id: '', // Will be generated
        type,
        timestamp: new Date().toISOString(),
        duration_minutes,
        author: { type: 'agent', id: 'claude', model: 'claude-opus-4-6' },
        title,
        summary,
        symbols_touched,
        symbols_created,
        files_created,
        files_modified,
        lines_added,
        lines_removed,
        commit,
        decisions,
        errors_encountered,
        learnings,
        verification,
        tags,
        habit_compliance,
      };

      const id = await recordLoreEntry(ctx.rootDir, entry);
      getSessionTracker().setLastLoreEntryId(id);

      return {
        handled: true,
        text: JSON.stringify({
          success: true,
          id,
          type,
          title,
          message: 'Lore entry recorded successfully',
        }),
      };
    }

    case 'paradigm_lore_timeline': {
      const limit = (args.limit as number) || 10;

      const timeline = await loadLoreTimeline(ctx.rootDir);
      const entries = await loadLoreEntries(ctx.rootDir, { limit });

      // Compute hot symbols
      const symbolCounts: Record<string, number> = {};
      for (const entry of entries) {
        for (const sym of entry.symbols_touched) {
          symbolCounts[sym] = (symbolCounts[sym] || 0) + 1;
        }
      }
      const hotSymbols = Object.entries(symbolCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([symbol, count]) => ({ symbol, count }));

      // Compute author activity
      const authorActivity: Record<string, { count: number; lastActive: string; type: string }> = {};
      for (const entry of entries) {
        const aid = entry.author.id;
        if (!authorActivity[aid]) {
          authorActivity[aid] = { count: 0, lastActive: entry.timestamp, type: entry.author.type };
        }
        authorActivity[aid].count++;
        if (entry.timestamp > authorActivity[aid].lastActive) {
          authorActivity[aid].lastActive = entry.timestamp;
        }
      }

      return {
        handled: true,
        text: JSON.stringify({
          timeline: timeline || { version: '1.0', project: 'unknown', entries: 0, last_updated: '', authors: [] },
          recentEntries: entries.map(summarizeEntry),
          hotSymbols,
          authors: Object.entries(authorActivity).map(([id, info]) => ({
            id,
            type: info.type,
            entries: info.count,
            lastActive: info.lastActive,
          })),
        }, null, 2),
      };
    }

    case 'paradigm_lore_get': {
      const id = args.id as string;
      const entry = await loadLoreEntry(ctx.rootDir, id);

      if (!entry) {
        return {
          handled: true,
          text: JSON.stringify({ error: `Lore entry not found: ${id}` }),
        };
      }

      return {
        handled: true,
        text: JSON.stringify(entry, null, 2),
      };
    }

    case 'paradigm_lore_update': {
      const id = args.id as string;
      const { id: _, ...rest } = args;
      const partial: Record<string, unknown> = {};

      // Copy all provided fields except 'id'
      for (const [key, value] of Object.entries(rest)) {
        if (value !== undefined) {
          partial[key] = value;
        }
      }

      const success = await updateLoreEntry(ctx.rootDir, id, partial as Partial<LoreEntry>);

      return {
        handled: true,
        text: JSON.stringify({
          success,
          id,
          message: success ? 'Lore entry updated' : `Lore entry not found: ${id}`,
        }),
      };
    }

    case 'paradigm_lore_delete': {
      const id = args.id as string;
      const confirm = args.confirm as boolean;

      if (!confirm) {
        return {
          handled: true,
          text: JSON.stringify({
            success: false,
            message: 'Deletion requires confirm: true',
          }),
        };
      }

      const success = await deleteLoreEntry(ctx.rootDir, id);

      return {
        handled: true,
        text: JSON.stringify({
          success,
          id,
          message: success ? 'Lore entry deleted' : `Lore entry not found: ${id}`,
        }),
      };
    }

    default:
      return { handled: false, text: '' };
  }
}

/**
 * Summarize a lore entry for compact output
 */
function summarizeEntry(entry: LoreEntry) {
  return {
    id: entry.id,
    type: entry.type,
    title: entry.title,
    summary: entry.summary,
    author: entry.author,
    timestamp: entry.timestamp,
    duration_minutes: entry.duration_minutes,
    symbols_touched: entry.symbols_touched,
    verification: entry.verification?.status,
    review: entry.review ? {
      completeness: entry.review.completeness,
      quality: entry.review.quality,
    } : null,
    tags: entry.tags,
  };
}
