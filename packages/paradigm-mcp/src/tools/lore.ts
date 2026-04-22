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
  addLoreAssessment,
  type LoreEntry,
  type LoreFilter,
  type LoreAssessment,
} from '../utils/lore-loader.js';
import { getComplianceRate, getComplianceByCategory } from '../utils/practice-store.js';
import { getSessionTracker } from '../utils/session-tracker.js';
import { detectProtocolSuggestion } from '../utils/protocol-loader.js';
import { log } from '../utils/mcp-logger.js';
import { rejectionErr, DECISION_REMOVED_ENVELOPE } from '../utils/lore-rejection.js';
import { execSync } from 'child_process';
import * as os from 'os';

/** Resolve the human author for MCP-recorded entries */
function resolveAuthorForMcp(): string {
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

/**
 * Get list of lore tools with safety annotations
 */
export function getLoreToolsList() {
  return [
    {
      name: 'paradigm_lore_search',
      description:
        'Search lore entries by symbol, author, date range, type, or tags. Returns project history records. Returns matching entries with titles, dates, and symbol references. ~200 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            description: 'Filter by symbol (e.g., "#sentinel-sdk", "^authenticated")',
          },
          author: {
            type: 'string',
            description: 'Filter by author (human user name, e.g., "ascend")',
          },
          hasAgent: {
            type: 'boolean',
            description: 'Filter by AI assistance: true = AI-assisted entries, false = human-only',
          },
          authorType: {
            type: 'string',
            enum: ['human', 'agent'],
            description: '(Deprecated, use hasAgent) Filter by old author type',
          },
          type: {
            type: 'string',
            enum: ['agent-session', 'human-note', 'review', 'incident', 'milestone', 'retro', 'insight'],
            description: 'Filter by entry type',
          },
          tag: {
            type: 'string',
            description: 'Filter by tag prefix (e.g., "arc:lore-evolution" for arc entries)',
          },
          hasBody: {
            type: 'boolean',
            description: 'Filter for entries with/without long-form body content',
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
          hasConfidence: {
            type: 'boolean',
            description: 'Filter for entries with/without confidence scores',
          },
          hasAssessment: {
            type: 'boolean',
            description: 'Filter for entries with/without assessment verdicts',
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
      aliases: ['history', 'what happened', 'past work', 'project history', 'previous sessions', 'lore'],
    },
    {
      name: 'paradigm_lore_record',
      description:
        'Record a new lore entry (agent session, milestone, retro, insight, etc.). Call after completing significant work. Returns the created entry ID and file path. For decisions, use paradigm_decision_record (a companion lore insight is auto-written). ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['agent-session', 'human-note', 'review', 'incident', 'milestone', 'retro', 'insight'],
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
          meta: {
            type: 'object',
            description: 'Project-defined metadata (open-ended key-value pairs, e.g., { meeting_type: "design-review", sprint: 12 })',
          },
          body: {
            type: 'string',
            description: 'Long-form content (detailed retrospective notes, decision rationale, etc.)',
          },
          linked_lore: {
            type: 'array',
            items: { type: 'string' },
            description: 'Cross-references to other lore entry IDs',
          },
          linked_tasks: {
            type: 'array',
            items: { type: 'string' },
            description: 'References to paradigm task IDs',
          },
          linked_commits: {
            type: 'array',
            items: { type: 'string' },
            description: 'Git commit SHAs related to this entry',
          },
          confidence: {
            type: 'number',
            description: 'Agent confidence in correctness of this work (0.0 to 1.0)',
          },
          stream: {
            type: 'string',
            enum: ['work-log', 'journal', 'decision', 'auto'],
            description: 'Knowledge stream classification. "auto" classifies based on content. Default: stores in lore (backward compatible).',
          },
        },
        required: ['title', 'summary', 'symbols_touched'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_lore_timeline',
      description:
        'Get lore timeline overview: recent entries, active authors, hot symbols. Call for project history orientation. ~200 tokens.',
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
        'Fetch a single lore entry by ID. Returns the full entry with all fields. ~150 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Lore entry ID (e.g., "L-2026-02-23-001" or "L-2026-03-02-ascend-143025-001")',
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
        'Update an existing lore entry. Merges provided fields into the existing entry. Returns updated entry confirmation. ~100 tokens.',
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
            enum: ['agent-session', 'human-note', 'review', 'incident', 'milestone', 'retro', 'insight'],
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
          confidence: {
            type: 'number',
            description: 'Agent confidence in correctness (0.0 to 1.0)',
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
      name: 'paradigm_lore_assess',
      description:
        'Record a human assessment verdict on a lore entry (correct/partial/incorrect). Computes calibration delta if confidence was recorded. ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Lore entry ID to assess',
          },
          verdict: {
            type: 'string',
            enum: ['correct', 'partial', 'incorrect'],
            description: 'Assessment verdict on the decisions/changes made',
          },
          notes: {
            type: 'string',
            description: 'Optional assessment notes',
          },
        },
        required: ['id', 'verdict'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_lore_calibration',
      description:
        'Query calibration statistics across assessed lore entries. Returns accuracy rate, average confidence, calibration score, and verdict breakdown. Supports groupBy for domain-specific reliability maps. ~200 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            description: 'Filter by symbol (e.g., "#auth-middleware")',
          },
          tag: {
            type: 'string',
            description: 'Filter by tag prefix',
          },
          author: {
            type: 'string',
            description: 'Filter by author',
          },
          dateFrom: {
            type: 'string',
            description: 'Filter from date (ISO 8601)',
          },
          dateTo: {
            type: 'string',
            description: 'Filter to date (ISO 8601)',
          },
          groupBy: {
            type: 'string',
            enum: ['symbol', 'tag', 'type'],
            description: 'Group calibration stats by dimension',
          },
        },
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_lore_delete',
      description:
        'Delete a lore entry. Requires explicit confirmation to prevent accidental deletion. ~100 tokens.',
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
        hasAgent: args.hasAgent as boolean | undefined,
        authorType: args.authorType as LoreFilter['authorType'],
        symbol: args.symbol as string | undefined,
        dateFrom: args.dateFrom as string | undefined,
        dateTo: args.dateTo as string | undefined,
        type: args.type as LoreFilter['type'],
        tag: args.tag as string | undefined,
        hasBody: args.hasBody as boolean | undefined,
        tags: args.tags as string[] | undefined,
        hasReview: args.hasReview as boolean | undefined,
        hasConfidence: args.hasConfidence as boolean | undefined,
        hasAssessment: args.hasAssessment as boolean | undefined,
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
        verification, tags, meta,
        body, linked_lore, linked_tasks, linked_commits,
        confidence,
      } = args as Partial<LoreEntry> & { meta?: Record<string, unknown> } & {
        title: string;
        summary: string;
        symbols_touched: string[];
      };

      // v6.0 (D3 locked): hard-remove type:'decision' on paradigm_lore_record.
      // Returns a structured rejection envelope (Jinx premortem mitigation #2)
      // so downstream agents can auto-retry against paradigm_decision_record.
      // The companion lore insight entry is written automatically by
      // recordDecision (.paradigm/decisions/...), preserving the timeline.
      if (type === 'decision') {
        log.component('#lore').warn(
          "rejected paradigm_lore_record({type:'decision'}) — removed in v6.0",
          {
            removed_in: DECISION_REMOVED_ENVELOPE.removed_in,
            successor_tool: DECISION_REMOVED_ENVELOPE.successor_tool,
          },
        );
        return rejectionErr(DECISION_REMOVED_ENVELOPE);
      }

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
        type: type || 'agent-session',
        timestamp: new Date().toISOString(),
        duration_minutes,
        author: resolveAuthorForMcp(),
        agent: { provider: 'anthropic', model: 'claude-opus-4-6' },
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
        meta: meta || undefined,
        habit_compliance,
        body,
        linked_lore,
        linked_tasks,
        linked_commits,
        confidence: confidence != null && confidence >= 0 && confidence <= 1 ? confidence : undefined,
      };

      const id = await recordLoreEntry(ctx.rootDir, entry);
      getSessionTracker().setLastLoreEntryId(id);

      // Auto-update agent expertise from lore
      try {
        const agentId = process.env.PARADIGM_AGENT_ID;
        if (agentId && symbols_touched && symbols_touched.length > 0) {
          const { updateExpertiseFromLore } = await import('../utils/agent-loader.js');
          updateExpertiseFromLore(ctx.rootDir, agentId, {
            symbols_touched,
            confidence: confidence != null && confidence >= 0 && confidence <= 1 ? confidence : undefined,
          });
        }
      } catch {
        // Agent expertise update is optional
      }

      // Detect protocol-worthy session
      let protocol_suggestion: ReturnType<typeof detectProtocolSuggestion> = null;
      try {
        if (files_created && files_created.length >= 2) {
          protocol_suggestion = detectProtocolSuggestion(
            ctx.rootDir,
            files_created,
            files_modified || [],
          );
        }
      } catch {
        // Protocol suggestion is optional
      }

      // Stream routing — if stream is specified, also record in the appropriate knowledge stream
      let streamRouted: string | undefined;
      if (args.stream) {
        const stream = args.stream as string;
        const resolvedStream = stream === 'auto' ? classifyStream(args) : stream;

        try {
          if (resolvedStream === 'work-log') {
            const { recordWorkLog } = await import('../utils/work-log-loader.js');
            recordWorkLog(ctx.rootDir, {
              agent: entry.agent?.model || 'unknown',
              summary: entry.summary,
              outcome: entry.verification?.status === 'pass' ? 'pass' : entry.verification?.status === 'fail' ? 'fail' : 'partial',
              files_modified: entry.files_modified,
              symbols_touched: entry.symbols_touched,
              commit: entry.commit,
              linked_lore: entry.id || id,
            });
            streamRouted = 'work-log';
          } else if (resolvedStream === 'journal' && entry.learnings?.length) {
            const { recordJournalEntry } = await import('../utils/journal-loader.js');
            for (const learning of entry.learnings) {
              recordJournalEntry(entry.agent?.model || 'unknown', {
                trigger: 'self_reflection',
                insight: learning,
                project: ctx.projectName || 'unknown',
                transferable: false,
                linked_work_log: entry.id || id,
              });
            }
            streamRouted = 'journal';
          } else if (resolvedStream === 'decision' && entry.decisions?.length) {
            const { recordDecision } = await import('../utils/decision-loader.js');
            for (const decision of entry.decisions) {
              recordDecision(ctx.rootDir, {
                title: decision.decision.slice(0, 100),
                decision: decision.decision,
                rationale: decision.rationale,
                participants: [{ id: `agent/${entry.agent?.model || 'unknown'}`, role: 'agent' as const, stance: 'proposed' as const }],
                symbols_affected: entry.symbols_touched,
                status: 'active',
                linked_lore: entry.id || id,
              });
            }
            streamRouted = 'decision';
          }
        } catch {
          // Stream routing failure is non-fatal — lore entry already saved
        }
      }

      return {
        handled: true,
        text: JSON.stringify({
          success: true,
          id,
          type,
          title,
          message: 'Lore entry recorded successfully',
          ...(streamRouted ? { stream: streamRouted } : {}),
          ...(protocol_suggestion ? { protocol_suggestion } : {}),
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
      const authorActivity: Record<string, { count: number; lastActive: string; hasAgent: boolean }> = {};
      for (const entry of entries) {
        const aid = entry.author;
        if (!authorActivity[aid]) {
          authorActivity[aid] = { count: 0, lastActive: entry.timestamp, hasAgent: entry.agent != null };
        }
        authorActivity[aid].count++;
        if (entry.agent) authorActivity[aid].hasAgent = true;
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
            hasAgent: info.hasAgent,
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

    case 'paradigm_lore_assess': {
      const id = args.id as string;
      const verdict = args.verdict as LoreAssessment['verdict'];
      const notes = args.notes as string | undefined;

      // Load entry first to get confidence for delta
      const entryToAssess = await loadLoreEntry(ctx.rootDir, id);
      if (!entryToAssess) {
        return {
          handled: true,
          text: JSON.stringify({ error: `Lore entry not found: ${id}` }),
        };
      }

      const assessment: LoreAssessment = {
        verdict,
        assessed_by: resolveAuthorForMcp(),
        assessed_at: new Date().toISOString(),
        notes,
      };

      const success = await addLoreAssessment(ctx.rootDir, id, assessment);

      // Auto-update agent expertise from assessment
      try {
        const agentId = process.env.PARADIGM_AGENT_ID;
        if (agentId && success && entryToAssess.symbols_touched?.length) {
          const { updateExpertiseFromAssessment } = await import('../utils/agent-loader.js');
          updateExpertiseFromAssessment(ctx.rootDir, agentId, {
            symbols_touched: entryToAssess.symbols_touched,
            verdict,
          });
        }
      } catch {
        // Agent expertise update is optional
      }

      // Compute delta for response
      const impliedScore = verdict === 'correct' ? 1.0 : verdict === 'partial' ? 0.5 : 0.0;
      const delta = entryToAssess.confidence != null
        ? impliedScore - entryToAssess.confidence
        : null;

      const deltaDescription = delta != null
        ? delta > 0.1 ? 'Under-confident (actual outcome better than predicted)'
          : delta < -0.1 ? 'Over-confident (actual outcome worse than predicted)'
          : 'Well-calibrated'
        : 'No confidence recorded — delta not computed';

      return {
        handled: true,
        text: JSON.stringify({
          success,
          id,
          verdict,
          confidence: entryToAssess.confidence ?? null,
          delta,
          deltaDescription,
          message: success
            ? `Assessment recorded: ${verdict}${delta != null ? ` (delta: ${delta > 0 ? '+' : ''}${delta.toFixed(2)})` : ''}`
            : `Failed to assess: ${id}`,
        }),
      };
    }

    case 'paradigm_lore_calibration': {
      const filter: LoreFilter = {
        symbol: args.symbol as string | undefined,
        tag: args.tag as string | undefined,
        author: args.author as string | undefined,
        dateFrom: args.dateFrom as string | undefined,
        dateTo: args.dateTo as string | undefined,
        hasAssessment: true,
      };

      const entries = await loadLoreEntries(ctx.rootDir, filter);
      const withConfidence = entries.filter(e => e.confidence != null);

      const totalAssessed = entries.length;
      const totalWithConfidence = withConfidence.length;

      // Compute verdict breakdown
      const verdictBreakdown = { correct: 0, partial: 0, incorrect: 0 };
      let totalImpliedScore = 0;
      let totalConfidence = 0;
      let totalAbsDelta = 0;

      for (const e of entries) {
        const v = e.assessment!.verdict;
        verdictBreakdown[v]++;
        const implied = v === 'correct' ? 1.0 : v === 'partial' ? 0.5 : 0.0;
        totalImpliedScore += implied;
        if (e.confidence != null) {
          totalConfidence += e.confidence;
          totalAbsDelta += Math.abs(implied - e.confidence);
        }
      }

      const accuracyRate = totalAssessed > 0 ? totalImpliedScore / totalAssessed : 0;
      const avgConfidence = totalWithConfidence > 0 ? totalConfidence / totalWithConfidence : null;
      const avgDelta = totalWithConfidence > 0
        ? (totalImpliedScore / totalAssessed - totalConfidence / totalWithConfidence)
        : null;
      const calibrationScore = totalWithConfidence > 0
        ? 1 - (totalAbsDelta / totalWithConfidence)
        : null;

      // Grouping
      const groupBy = args.groupBy as string | undefined;
      let groups: Array<Record<string, unknown>> | undefined;

      if (groupBy && totalAssessed > 0) {
        const groupMap = new Map<string, typeof entries>();

        for (const e of entries) {
          let keys: string[] = [];
          if (groupBy === 'symbol') {
            keys = e.symbols_touched || [];
          } else if (groupBy === 'tag') {
            keys = e.tags || [];
          } else if (groupBy === 'type') {
            keys = [e.type || 'agent-session'];
          }

          for (const key of keys) {
            if (!groupMap.has(key)) groupMap.set(key, []);
            groupMap.get(key)!.push(e);
          }
        }

        groups = Array.from(groupMap.entries())
          .map(([key, gEntries]) => {
            const gWithConf = gEntries.filter(e => e.confidence != null);
            const gBreakdown = { correct: 0, partial: 0, incorrect: 0 };
            let gImplied = 0;
            let gConf = 0;
            let gAbsDelta = 0;

            for (const e of gEntries) {
              const v = e.assessment!.verdict;
              gBreakdown[v]++;
              const implied = v === 'correct' ? 1.0 : v === 'partial' ? 0.5 : 0.0;
              gImplied += implied;
              if (e.confidence != null) {
                gConf += e.confidence;
                gAbsDelta += Math.abs(implied - e.confidence);
              }
            }

            return {
              key,
              total: gEntries.length,
              accuracyRate: gImplied / gEntries.length,
              avgConfidence: gWithConf.length > 0 ? gConf / gWithConf.length : null,
              calibrationScore: gWithConf.length > 0 ? 1 - gAbsDelta / gWithConf.length : null,
              verdictBreakdown: gBreakdown,
            };
          })
          .sort((a, b) => b.total - a.total);
      }

      // Generate insights
      const insights: string[] = [];
      const caveat = totalAssessed < 5
        ? `Low sample size (N=${totalAssessed}). Stats may not be representative.`
        : totalAssessed < 15
          ? `Moderate sample (N=${totalAssessed}). Trends are directional, not conclusive.`
          : null;

      if (caveat) insights.push(caveat);

      if (calibrationScore != null) {
        if (calibrationScore >= 0.9) {
          insights.push('Excellent calibration — confidence predictions closely match outcomes.');
        } else if (calibrationScore >= 0.7) {
          insights.push('Good calibration — some room for improvement in confidence estimates.');
        } else if (calibrationScore >= 0.5) {
          insights.push('Fair calibration — significant gap between predicted confidence and outcomes.');
        } else {
          insights.push('Poor calibration — confidence predictions diverge substantially from outcomes.');
        }
      }

      if (avgDelta != null) {
        if (avgDelta > 0.15) {
          insights.push('Tendency toward under-confidence — outcomes are better than predicted.');
        } else if (avgDelta < -0.15) {
          insights.push('Tendency toward over-confidence — outcomes are worse than predicted.');
        }
      }

      if (verdictBreakdown.incorrect > totalAssessed * 0.3 && totalAssessed >= 5) {
        insights.push(`High error rate: ${verdictBreakdown.incorrect}/${totalAssessed} entries assessed as incorrect.`);
      }

      return {
        handled: true,
        text: JSON.stringify({
          totalAssessed,
          totalWithConfidence,
          accuracyRate: Math.round(accuracyRate * 1000) / 1000,
          avgConfidence: avgConfidence != null ? Math.round(avgConfidence * 1000) / 1000 : null,
          avgDelta: avgDelta != null ? Math.round(avgDelta * 1000) / 1000 : null,
          calibrationScore: calibrationScore != null ? Math.round(calibrationScore * 1000) / 1000 : null,
          verdictBreakdown,
          ...(groups ? { groups } : {}),
          insights,
        }, null, 2),
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
 * Classify which knowledge stream a lore entry belongs to based on its content.
 * Used when stream is set to 'auto'.
 */
function classifyStream(args: Record<string, unknown>): string {
  // Has task_ref or is primarily about work done → work-log
  if (args.task_ref || args.files_modified || args.commit) return 'work-log';

  // Has learnings or confidence data → journal
  if (args.learnings || args.confidence !== undefined) return 'journal';

  // Has decisions with rationale → decision
  const decisions = args.decisions as Array<{ rationale?: string }> | undefined;
  if (decisions?.some(d => d.rationale)) return 'decision';

  // Default: work-log (most common)
  return 'work-log';
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
    agent: entry.agent,
    timestamp: entry.timestamp,
    duration_minutes: entry.duration_minutes,
    symbols_touched: entry.symbols_touched,
    verification: entry.verification?.status,
    review: entry.review ? {
      completeness: entry.review.completeness,
      quality: entry.review.quality,
    } : null,
    confidence: entry.confidence ?? null,
    assessment: entry.assessment ? entry.assessment.verdict : null,
    assessment_delta: entry.assessment_delta ?? null,
    tags: entry.tags,
  };
}
