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
  loadLoreTimeline,
  recordLoreEntry,
  type LoreEntry,
  type LoreFilter,
} from '../utils/lore-loader.js';

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
      };

      const id = await recordLoreEntry(ctx.rootDir, entry);

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
