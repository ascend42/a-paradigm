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
import { loadNominations, loadDebates, engageNomination, resolveDebate, adjustAttentionFromFeedback, getNominationStats, getNeverlandMetrics, loadSurfacingConfig, applySurfacingRules, autoPromoteJournalEntries, processPendingEvents } from '../utils/nomination-engine.js';
import { queryEvents } from '../utils/event-stream.js';
import { buildProfileEnrichment, loadAgentProfile, loadAllAgentProfiles } from '../utils/agent-loader.js';
import { loadDecisions } from '../utils/decision-loader.js';
import { loadJournalEntries, recordJournalEntry } from '../utils/journal-loader.js';
import {
  readSessionWorkLog,
  readPendingVerdicts,
  markVerdictsConsumed,
  readPendingIterationRevisions,
  markIterationRevisionsConsumed,
} from '../utils/session-work-log.js';
import type { NominationUrgencyLevel } from '../types/ambient.js';
import type { JournalTrigger } from '../types/knowledge-streams.js';

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
          reason: { type: 'string', description: 'Reason for response — stored on nomination for learning feedback. Especially valuable for dismissals.' },
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
    {
      name: 'paradigm_ambient_health',
      description: 'Agent learning health metrics — aggregate learning quality across all agents: nomination acceptance rates, threshold drift, notebook counts, expertise growth, and overall health status (cold-start → accumulating → calibrating → mature).',
      inputSchema: {
        type: 'object' as const,
        properties: {},
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_ambient_learn_postflight',
      description: 'Postflight learning pass — converts session work log verdicts into agent journal entries. Reads accepted/dismissed/revised verdicts from the session log, creates journal entries for each agent, then auto-promotes high-confidence entries to notebooks. Typically called at session end by the stop hook. ~200 tokens.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session_id: { type: 'string', description: 'Session ID (default: current session)' },
          dry_run: { type: 'boolean', description: 'If true, show what would be written without writing (default: false)' },
        },
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

      const reason = args.reason as string | undefined;
      const engaged = engageNomination(ctx.rootDir, nominationId, response, reason);

      // Log verdict to session work log + durable verdicts store
      if (engaged) {
        try {
          const { appendSessionWorkEntry, appendVerdictEntry } = await import('../utils/session-work-log.js');
          const noms = loadNominations(ctx.rootDir, { limit: 500 });
          const nom = noms.find(n => n.id === nominationId);
          const verdictEntry = {
            timestamp: new Date().toISOString(),
            type: 'user-verdict' as const,
            agent: nom?.agent,
            nominationId,
            verdict: response,
            reason,
          };
          // Ephemeral: for current-session context enrichment
          appendSessionWorkEntry(ctx.rootDir, verdictEntry);
          // Durable: survives session restart so postflight can consume in any session
          appendVerdictEntry(ctx.rootDir, verdictEntry);
        } catch { /* non-fatal */ }
      }

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

    case 'paradigm_ambient_health':
    // backward-compat alias — old callers using paradigm_ambient_neverland still work
    case 'paradigm_ambient_neverland': {
      const metrics = getNeverlandMetrics(ctx.rootDir);
      return {
        text: json(metrics),
        handled: true,
      };
    }

    case 'paradigm_ambient_learn_postflight': {
      return {
        text: json(await runPostflightLearning(ctx.rootDir, args)),
        handled: true,
      };
    }

    default:
      return { text: `Unknown ambient tool: ${name}`, handled: false };
  }
}

// ────────────────────────────────────────────────────────────────────
// Postflight Learning Pass
// ────────────────────────────────────────────────────────────────────

/**
 * Maps session work log verdicts to journal triggers.
 */
const VERDICT_TRIGGERS: Record<string, JournalTrigger> = {
  accepted: 'human_feedback',
  dismissed: 'confidence_miss',
  revised: 'correction_received',
};

/**
 * Derive project name from rootDir — checks .paradigm/config.yaml first,
 * then falls back to directory basename.
 */
function resolveProjectName(rootDir: string): string {
  try {
    const configPath = path.join(rootDir, '.paradigm', 'config.yaml');
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf8');
      const match = content.match(/project:\s*["']?([^"'\n]+)["']?/);
      if (match) return match[1].trim();
    }
  } catch { /* fall through */ }
  return path.basename(rootDir);
}

interface PostflightResult {
  sessionEntries: number;
  agentsProcessed: string[];
  journalsWritten: number;
  journalsByAgent: Record<string, number>;
  promoted: number;
  promotedByAgent: Record<string, number>;
  dryRun: boolean;
  details: Array<{
    agent: string;
    verdict: string;
    trigger: JournalTrigger;
    insight: string;
    symbols?: string[];
  }>;
}

/**
 * Run the postflight learning pass — core logic shared by MCP tool and CLI.
 *
 * 1. Read session work log for verdicts
 * 2. Group by agent
 * 3. Generate journal entries per verdict
 * 4. Auto-promote high-confidence entries
 * 5. Return summary
 */
export async function runPostflightLearning(
  rootDir: string,
  args: Record<string, unknown> = {},
): Promise<PostflightResult> {
  const dryRun = args.dry_run === true;
  const projectName = resolveProjectName(rootDir);

  // 1. Read verdicts from durable store (survives session restart)
  const verdictEntries = readPendingVerdicts(rootDir).filter(
    e => e.verdict && e.agent
  );
  // Agent belief-revisions from iteration loops — a SEPARATE durable channel
  // (self_reflection provenance, never the human-verdict path).
  const revisionEntries = readPendingIterationRevisions(rootDir).filter(
    e => e.agent && e.corrections.length > 0
  );
  // Also read session log for contribution context (ephemeral, enrichment only)
  const allEntries = readSessionWorkLog(rootDir);

  if (verdictEntries.length === 0 && revisionEntries.length === 0) {
    return {
      sessionEntries: allEntries.length,
      agentsProcessed: [],
      journalsWritten: 0,
      journalsByAgent: {},
      promoted: 0,
      promotedByAgent: {},
      dryRun,
      details: [],
    };
  }

  // 2. Group verdicts by agent
  const agentVerdicts = new Map<string, typeof verdictEntries>();
  for (const entry of verdictEntries) {
    const agentId = entry.agent!;
    if (!agentVerdicts.has(agentId)) {
      agentVerdicts.set(agentId, []);
    }
    agentVerdicts.get(agentId)!.push(entry);
  }

  // Also gather contribution context (to enrich journal insights)
  const contributionEntries = allEntries.filter(e => e.type === 'agent-contribution');
  const contributionsByAgent = new Map<string, typeof contributionEntries>();
  for (const entry of contributionEntries) {
    if (!entry.agent) continue;
    if (!contributionsByAgent.has(entry.agent)) {
      contributionsByAgent.set(entry.agent, []);
    }
    contributionsByAgent.get(entry.agent)!.push(entry);
  }

  const details: PostflightResult['details'] = [];
  const journalsByAgent: Record<string, number> = {};
  let totalJournals = 0;

  // 3. Generate journal entries for each agent
  for (const [agentId, verdicts] of agentVerdicts) {
    journalsByAgent[agentId] = 0;

    // Compute agent-level stats for context
    const accepted = verdicts.filter(v => v.verdict === 'accepted').length;
    const dismissed = verdicts.filter(v => v.verdict === 'dismissed').length;
    const revised = verdicts.filter(v => v.verdict === 'revised').length;
    const total = verdicts.length;
    const acceptRate = total > 0 ? accepted / total : 0;

    for (const verdict of verdicts) {
      const trigger = VERDICT_TRIGGERS[verdict.verdict!];
      if (!trigger) continue;

      // Build a meaningful insight based on verdict type
      const contribution = contributionsByAgent.get(agentId)?.shift();
      const insight = buildVerdictInsight(verdict, contribution, {
        acceptRate,
        total,
        accepted,
        dismissed,
        revised,
      });

      // v7 §2.0: prefer the agent's REAL post-task confidence; fall back to the
      // branch literal only when no measured value is present. This is the input
      // to the (still-absolute ≥0.8) promotion gate — see nomination-engine:944.
      const confidenceAfter = typeof verdict.confidence === 'number'
        ? verdict.confidence
        : verdict.verdict === 'accepted' ? 0.85
        : verdict.verdict === 'revised' ? 0.6
        : 0.4; // dismissed

      const detail = {
        agent: agentId,
        verdict: verdict.verdict!,
        trigger,
        insight,
        symbols: verdict.symbols,
      };
      details.push(detail);

      if (!dryRun) {
        try {
          recordJournalEntry(agentId, {
            trigger,
            insight,
            // fabricated; not gated on — see v7.x
            confidence_before: verdict.verdict === 'accepted' ? 0.7 : 0.8,
            confidence_after: confidenceAfter,
            project: projectName,
            transferable: verdict.verdict === 'dismissed', // dismissals are transferable lessons
            tags: [
              'postflight',
              `verdict:${verdict.verdict}`,
              ...(verdict.symbols || []).map(s => `symbol:${s}`),
            ],
          });
          journalsByAgent[agentId]++;
          totalJournals++;
        } catch {
          // Non-fatal — continue with other entries
        }
      } else {
        journalsByAgent[agentId]++;
        totalJournals++;
      }
    }
  }

  // 3b. Generate self_reflection journal entries for agent belief-revisions.
  //     Agent-provenance — NOT routed through buildVerdictInsight (which assumes
  //     a human verdict). Belief revisions are transferable lessons.
  const revisionAgents = new Set<string>();
  for (const rev of revisionEntries) {
    const agentId = rev.agent;
    revisionAgents.add(agentId);
    if (journalsByAgent[agentId] === undefined) journalsByAgent[agentId] = 0;

    const insight = `Self-revision during iteration round ${rev.round}: ${rev.corrections.join('; ')}`;

    details.push({
      agent: agentId,
      verdict: 'iteration-revision',
      trigger: 'self_reflection',
      insight,
      symbols: rev.symbols,
    });

    if (!dryRun) {
      try {
        recordJournalEntry(agentId, {
          trigger: 'self_reflection',
          insight,
          // fabricated; not gated on — see v7.x
          confidence_before: 0.6,
          // v7 §2.0: prefer the agent's REAL post-revision confidence.
          confidence_after: typeof rev.confidence === 'number' ? rev.confidence : 0.75,
          project: projectName,
          // Default project-scoped: a self-revision is often a local fact ("this
          // repo's auth uses X"). Don't blanket-leak into cross-project notebooks.
          transferable: false,
          tags: [
            'postflight',
            'iteration-revision',
            `round:${rev.round}`,
            ...(rev.symbols || []).map(s => `symbol:${s}`),
          ],
        });
        journalsByAgent[agentId]++;
        totalJournals++;
      } catch {
        // Non-fatal — continue with other entries
      }
    } else {
      journalsByAgent[agentId]++;
      totalJournals++;
    }
  }

  // 4. Auto-promote high-confidence entries to notebooks (verdict + revision agents)
  const promotedByAgent: Record<string, number> = {};
  let totalPromoted = 0;
  const promoteAgents = new Set<string>([...agentVerdicts.keys(), ...revisionAgents]);

  if (!dryRun) {
    for (const agentId of promoteAgents) {
      try {
        const result = autoPromoteJournalEntries(rootDir, agentId);
        if (result.promoted > 0) {
          promotedByAgent[agentId] = result.promoted;
          totalPromoted += result.promoted;
        }
      } catch {
        // Non-fatal
      }
    }
  }

  // Mark processed verdicts + revisions as consumed so they don't re-run.
  if (!dryRun && verdictEntries.length > 0) {
    markVerdictsConsumed(
      rootDir,
      verdictEntries.map(v => v.nominationId).filter(Boolean) as string[]
    );
  }
  if (!dryRun && revisionEntries.length > 0) {
    markIterationRevisionsConsumed(rootDir, revisionEntries.map(r => r.id));
  }

  return {
    sessionEntries: allEntries.length,
    agentsProcessed: Array.from(promoteAgents),
    journalsWritten: totalJournals,
    journalsByAgent,
    promoted: totalPromoted,
    promotedByAgent,
    dryRun,
    details,
  };
}

/**
 * Build a human-readable insight string from a verdict + its contribution context.
 */
function buildVerdictInsight(
  verdict: { verdict?: string; reason?: string; revisionDelta?: string; nominationId?: string; symbols?: string[] },
  contribution: { contribution?: string; attribution?: string } | undefined,
  stats: { acceptRate: number; total: number; accepted: number; dismissed: number; revised: number },
): string {
  const symbolsNote = verdict.symbols?.length
    ? ` (symbols: ${verdict.symbols.join(', ')})`
    : '';
  const reasonNote = verdict.reason ? ` Reason: ${verdict.reason}.` : '';

  switch (verdict.verdict) {
    case 'accepted':
      return `Contribution accepted by user${symbolsNote}.${reasonNote}` +
        (contribution?.contribution ? ` Original: "${contribution.contribution.slice(0, 120)}".` : '') +
        ` Session accept rate: ${(stats.acceptRate * 100).toFixed(0)}% (${stats.accepted}/${stats.total}).`;

    case 'dismissed':
      return `Contribution dismissed by user${symbolsNote}.${reasonNote}` +
        (contribution?.contribution ? ` Rejected contribution: "${contribution.contribution.slice(0, 120)}".` : '') +
        ` Learn from this dismissal to improve future nominations.` +
        ` Session accept rate: ${(stats.acceptRate * 100).toFixed(0)}% (${stats.accepted}/${stats.total}).`;

    case 'revised':
      return `Contribution revised by user${symbolsNote}.${reasonNote}` +
        (verdict.revisionDelta ? ` Delta: "${verdict.revisionDelta.slice(0, 120)}".` : '') +
        (contribution?.contribution ? ` Original: "${contribution.contribution.slice(0, 120)}".` : '') +
        ` Partial credit — close but not accurate enough.` +
        ` Session accept rate: ${(stats.acceptRate * 100).toFixed(0)}% (${stats.accepted}/${stats.total}).`;

    default:
      return `Unknown verdict "${verdict.verdict}"${symbolsNote}.${reasonNote}`;
  }
}
