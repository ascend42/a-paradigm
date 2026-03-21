/**
 * Ambient Coordination MCP Tools
 *
 * Tools:
 * - paradigm_ambient_nominations: Get pending nominations
 * - paradigm_ambient_events: Query event stream
 * - paradigm_ambient_engage: Accept/dismiss/defer a nomination
 * - paradigm_ambient_learn: Adjust agent attention from nomination feedback
 * - paradigm_context_compose: Compose agent session context
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ProjectContext } from '../utils/index-loader.js';
import { loadNominations, loadDebates, engageNomination, resolveDebate, adjustAttentionFromFeedback, getNominationStats, loadSurfacingConfig, applySurfacingRules, autoPromoteJournalEntries, processPendingEvents } from '../utils/nomination-engine.js';
import { queryEvents } from '../utils/event-stream.js';
import { buildProfileEnrichment, loadAgentProfile, loadAllAgentProfiles } from '../utils/agent-loader.js';
import { loadDecisions } from '../utils/decision-loader.js';
import { loadJournalEntries } from '../utils/journal-loader.js';
import type { NominationUrgencyLevel } from '../types/ambient.js';

export function getAmbientToolsList() {
  return [
    {
      name: 'paradigm_ambient_nominations',
      description: 'Get pending agent nominations — agents that self-nominated contributions based on recent events. Filters by urgency, agent, pending status. Marks returned nominations as surfaced. ~200 tokens.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          urgency: { type: 'string', enum: ['critical', 'high', 'medium', 'low'], description: 'Filter by urgency level' },
          agent: { type: 'string', description: 'Filter by agent ID' },
          pending_only: { type: 'boolean', description: 'Only show un-engaged nominations (default: true)' },
          include_debates: { type: 'boolean', description: 'Include debate groupings (default: false)' },
          limit: { type: 'number', description: 'Max nominations to return (default: 20)' },
        },
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_ambient_events',
      description: 'Query the ambient event stream — recent tool calls, file edits, gate checks, and other project activity. Filters by type, source, symbol, agent, time window. ~200 tokens.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          type: { type: 'string', description: 'Event type filter (e.g., "file-modified", "gate-checked", "decision-made")' },
          source: { type: 'string', description: 'Event source filter (e.g., "mcp-tool-call", "post-write-hook")' },
          symbol: { type: 'string', description: 'Filter events referencing this symbol' },
          agent: { type: 'string', description: 'Filter events from this agent' },
          since: { type: 'string', description: 'Relative time filter (e.g., "1h", "30m", "2d") or ISO timestamp' },
          limit: { type: 'number', description: 'Max events to return (default: 50)' },
        },
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_ambient_engage',
      description: 'Accept, dismiss, or defer a nomination. Optionally resolves a debate by choosing this nomination over others. ~50 tokens.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          nomination_id: { type: 'string', description: 'Nomination ID to engage with' },
          response: { type: 'string', enum: ['accepted', 'dismissed', 'deferred'], description: 'How to respond' },
          resolve_debate: { type: 'string', description: 'Optional debate ID to resolve by choosing this nomination' },
          reason: { type: 'string', description: 'Optional reason (used when resolving debates)' },
        },
        required: ['nomination_id', 'response'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_context_compose',
      description: 'Compose full agent session context: profile enrichment + recent decisions + transferable journal entries + pending nominations. Returns a markdown context block for prompt injection. ~300 tokens.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          agent: { type: 'string', description: 'Agent ID to compose context for' },
          symbols: { type: 'array', items: { type: 'string' }, description: 'Relevant symbols for expertise filtering' },
          include_nominations: { type: 'boolean', description: 'Include pending nominations (default: true)' },
          include_decisions: { type: 'boolean', description: 'Include recent team decisions (default: true)' },
          include_journal: { type: 'boolean', description: 'Include transferable journal entries (default: true)' },
          max_decisions: { type: 'number', description: 'Max decisions to include (default: 5)' },
          max_journal: { type: 'number', description: 'Max journal entries to include (default: 5)' },
        },
        required: ['agent'],
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_ambient_promote',
      description: 'Auto-promote high-confidence pattern discoveries from an agent\'s learning journal to its notebook. Promotes entries with trigger=pattern_discovered and confidence_after >= 0.8. ~100 tokens.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          agent: { type: 'string', description: 'Agent ID whose journal to scan' },
        },
        required: ['agent'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_ambient_learn',
      description: 'Analyze an agent\'s nomination acceptance/dismissal history and adjust its attention threshold. If >60% dismissed → raise threshold (less noise). If >80% accepted → lower threshold (contribute more). Also returns engagement stats. ~100 tokens.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          agent: { type: 'string', description: 'Agent ID to analyze and adjust' },
          dry_run: { type: 'boolean', description: 'If true, return stats without adjusting (default: false)' },
        },
        required: ['agent'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
  ];
}

/**
 * Parse a relative time string like "1h", "30m", "2d" into an ISO timestamp.
 */
function parseRelativeTime(since: string): string {
  const now = Date.now();
  const match = since.match(/^(\d+)(m|h|d)$/);
  if (match) {
    const value = parseInt(match[1], 10);
    const unit = match[2];
    const ms = unit === 'm' ? value * 60000 : unit === 'h' ? value * 3600000 : value * 86400000;
    return new Date(now - ms).toISOString();
  }
  // Assume it's already an ISO timestamp
  return since;
}

export async function handleAmbientTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ProjectContext
): Promise<{ text: string; handled: boolean }> {
  const json = (data: unknown) => JSON.stringify(data, null, 2);

  switch (name) {
    case 'paradigm_ambient_nominations': {
      // Catch-up: process any un-scored events from hooks before returning nominations
      const catchUp = processPendingEvents(ctx.rootDir);

      const pendingOnly = args.pending_only !== false; // default true
      const limit = (args.limit as number) || 20;

      let nominations = loadNominations(ctx.rootDir, {
        agent: args.agent as string | undefined,
        urgency: args.urgency as NominationUrgencyLevel | undefined,
        pending_only: pendingOnly,
        limit: limit + 20, // fetch extra before filtering
      });

      // Apply surfacing rules from .paradigm/surfacing.yaml
      const surfacingConfig = loadSurfacingConfig(ctx.rootDir);
      nominations = applySurfacingRules(nominations, surfacingConfig).slice(0, limit);

      // Mark returned nominations as surfaced (write back)
      const nominationsPath = path.join(ctx.rootDir, '.paradigm/events/nominations.jsonl');
      if (fs.existsSync(nominationsPath)) {
        try {
          const content = fs.readFileSync(nominationsPath, 'utf8');
          const surfacedIds = new Set(nominations.map(n => n.id));
          const lines = content.trim().split('\n').map((line: string) => {
            try {
              const n = JSON.parse(line);
              if (surfacedIds.has(n.id)) {
                n.surfaced = true;
                return JSON.stringify(n);
              }
              return line;
            } catch { return line; }
          });
          fs.writeFileSync(nominationsPath, lines.join('\n') + '\n', 'utf8');
        } catch { /* non-fatal */ }
      }

      const result: Record<string, unknown> = {
        count: nominations.length,
        nominations: nominations.map(n => ({
          id: n.id,
          agent: n.agent,
          urgency: n.urgency,
          type: n.type,
          brief: n.brief,
          relevance: n.relevance,
          timestamp: n.timestamp,
          engaged: n.engaged,
          response: n.response,
        })),
      };

      if (args.include_debates) {
        const debates = loadDebates(ctx.rootDir);
        const activeDebates = debates.filter(d => !d.resolution);
        result.debates = activeDebates.map(d => ({
          id: d.id,
          topic: d.topic,
          type: d.type,
          nominations: d.nominations,
        }));
        result.debate_count = activeDebates.length;
      }

      return { text: json(result), handled: true };
    }

    case 'paradigm_ambient_events': {
      const since = args.since ? parseRelativeTime(args.since as string) : undefined;
      const limit = (args.limit as number) || 50;

      const events = queryEvents(ctx.rootDir, {
        type: args.type as string | undefined,
        source: args.source as string | undefined,
        symbol: args.symbol as string | undefined,
        agent: args.agent as string | undefined,
        since,
        limit,
      });

      return {
        text: json({
          count: events.length,
          events: events.map(e => ({
            id: e.id,
            type: e.type,
            source: e.source,
            timestamp: e.timestamp,
            path: e.path,
            symbols: e.symbols,
            context: e.context,
            agent: e.agent,
            tool: e.tool,
            severity: e.severity,
          })),
        }),
        handled: true,
      };
    }

    case 'paradigm_ambient_engage': {
      const nominationId = args.nomination_id as string;
      const response = args.response as 'accepted' | 'dismissed' | 'deferred';

      const engaged = engageNomination(ctx.rootDir, nominationId, response);

      let debateResolved = false;
      if (args.resolve_debate && engaged) {
        debateResolved = resolveDebate(
          ctx.rootDir,
          args.resolve_debate as string,
          nominationId,
          args.reason as string | undefined
        );
      }

      return {
        text: json({
          engaged,
          nomination_id: nominationId,
          response,
          debate_resolved: debateResolved || undefined,
        }),
        handled: true,
      };
    }

    case 'paradigm_context_compose': {
      const agentId = args.agent as string;
      const symbols = (args.symbols as string[]) || [];
      const includeNominations = args.include_nominations !== false;
      const includeDecisions = args.include_decisions !== false;
      const includeJournal = args.include_journal !== false;
      const maxDecisions = (args.max_decisions as number) || 5;
      const maxJournal = (args.max_journal as number) || 5;

      const profile = loadAgentProfile(ctx.rootDir, agentId);
      if (!profile) {
        return {
          text: json({ error: `Agent profile not found: ${agentId}` }),
          handled: true,
        };
      }

      const parts: string[] = [];

      // 1. Profile enrichment
      const enrichment = buildProfileEnrichment(profile, symbols);
      if (enrichment.trim()) {
        parts.push(enrichment);
      }

      // 2. Recent team decisions
      if (includeDecisions) {
        const decisions = loadDecisions(ctx.rootDir, {
          status: 'active',
          limit: maxDecisions,
        });
        if (decisions.length > 0) {
          parts.push('## Recent Team Decisions');
          for (const d of decisions) {
            parts.push(`- **${d.title}**: ${d.decision.slice(0, 150)}${d.decision.length > 150 ? '...' : ''}`);
          }
          parts.push('');
        }
      }

      // 3. Transferable journal entries
      if (includeJournal) {
        const journalEntries = loadJournalEntries(agentId, {
          transferable: true,
          limit: maxJournal,
        });
        if (journalEntries.length > 0) {
          parts.push('## Transferable Insights');
          for (const j of journalEntries) {
            parts.push(`- [${j.trigger}] ${j.insight.slice(0, 150)}${j.insight.length > 150 ? '...' : ''}`);
          }
          parts.push('');
        }
      }

      // 4. Pending nominations
      if (includeNominations) {
        const nominations = loadNominations(ctx.rootDir, {
          pending_only: true,
          limit: 10,
        });
        if (nominations.length > 0) {
          parts.push('## Pending Nominations');
          for (const n of nominations) {
            parts.push(`- [${n.urgency}] ${n.brief}`);
          }
          parts.push('');
        }
      }

      return {
        text: json({
          agent: agentId,
          context: parts.join('\n'),
          sections_included: {
            profile: true,
            decisions: includeDecisions,
            journal: includeJournal,
            nominations: includeNominations,
          },
        }),
        handled: true,
      };
    }

    case 'paradigm_ambient_promote': {
      const agentId = args.agent as string;
      const result = autoPromoteJournalEntries(ctx.rootDir, agentId);
      return {
        text: json({
          agent: agentId,
          promoted: result.promoted,
          entries: result.entries,
        }),
        handled: true,
      };
    }

    case 'paradigm_ambient_learn': {
      const agentId = args.agent as string;
      const dryRun = args.dry_run === true;

      const stats = getNominationStats(ctx.rootDir, agentId);

      if (dryRun) {
        return {
          text: json({
            agent: agentId,
            dry_run: true,
            stats,
            note: stats.total < 5
              ? 'Insufficient data for threshold adjustment (need 5+ engaged nominations)'
              : `Accept rate: ${(stats.acceptRate * 100).toFixed(0)}% — ${stats.acceptRate > 0.8 ? 'would lower threshold' : stats.acceptRate < 0.4 ? 'would raise threshold' : 'no adjustment needed'}`,
          }),
          handled: true,
        };
      }

      const result = adjustAttentionFromFeedback(ctx.rootDir, agentId);

      return {
        text: json({
          agent: agentId,
          ...result,
          stats,
        }),
        handled: true,
      };
    }

    default:
      return { text: `Unknown ambient tool: ${name}`, handled: false };
  }
}
