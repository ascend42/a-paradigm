/**
 * Knowledge Streams MCP Tools — Work Log, Journal, Decisions
 *
 * Tools:
 * - paradigm_work_log_record: Record a work log entry
 * - paradigm_work_log_search: Search work log entries
 * - paradigm_journal_record: Record a learning journal entry
 * - paradigm_journal_search: Search journal entries
 * - paradigm_decision_record: Record a team decision
 * - paradigm_decision_search: Search team decisions
 */

import type { ProjectContext } from '../utils/index-loader.js';
import { recordWorkLog, loadWorkLogEntries, getWorkLogSummary } from '../utils/work-log-loader.js';
import { recordJournalEntry, loadJournalEntries, getJournalStats, loadAllJournalEntries } from '../utils/journal-loader.js';
import { recordDecision, loadDecisions, getDecisionSummary, writeCompanionLoreEntry } from '../utils/decision-loader.js';
import { loadDataPolicy, filterContent } from '../utils/data-policy-loader.js';

export function getStreamsToolsList() {
  return [
    {
      name: 'paradigm_work_log_record',
      description: 'Record a work log entry — what got done. Auto-attached to sprint boards and standup summaries. ~100 tokens.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          agent: { type: 'string', description: 'Agent that did the work (e.g., "builder")' },
          summary: { type: 'string', description: 'What was done' },
          outcome: { type: 'string', enum: ['pass', 'fail', 'partial', 'blocked'], description: 'How it went' },
          task_ref: { type: 'string', description: 'Ticket/issue reference (e.g., "ENG-142")' },
          files_modified: { type: 'array', items: { type: 'string' }, description: 'Files that were modified' },
          symbols_touched: { type: 'array', items: { type: 'string' }, description: 'Paradigm symbols touched' },
          next_steps: { type: 'array', items: { type: 'string' }, description: 'What\'s left to do' },
          blockers: { type: 'array', items: { type: 'string' }, description: 'What\'s blocking progress' },
          duration_minutes: { type: 'number', description: 'How long it took' },
          commit: { type: 'string', description: 'Git commit hash' },
        },
        required: ['agent', 'summary', 'outcome'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_work_log_search',
      description: 'Search work log entries — what got done. Returns recent work, filterable by agent, outcome, symbol, date. ~200 tokens.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          agent: { type: 'string', description: 'Filter by agent' },
          outcome: { type: 'string', enum: ['pass', 'fail', 'partial', 'blocked'] },
          task_ref: { type: 'string', description: 'Filter by ticket reference' },
          symbol: { type: 'string', description: 'Filter by symbol touched' },
          dateFrom: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
          dateTo: { type: 'string', description: 'End date (YYYY-MM-DD)' },
          limit: { type: 'number', description: 'Max entries to return (default 20)' },
          summary: { type: 'boolean', description: 'Return aggregate summary instead of entries' },
        },
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_journal_record',
      description: 'Record a learning journal entry — what an agent learned. Agent-private, travels across projects. ~100 tokens.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          agent: { type: 'string', description: 'Agent who learned this (e.g., "security")' },
          trigger: {
            type: 'string',
            enum: ['correction_received', 'confidence_miss', 'pattern_discovered', 'debate_loss', 'failure_analysis', 'human_feedback', 'self_reflection'],
            description: 'What triggered this learning moment',
          },
          insight: { type: 'string', description: 'The insight itself' },
          project: { type: 'string', description: 'Project where this happened' },
          transferable: { type: 'boolean', description: 'Whether this applies to other projects' },
          confidence_before: { type: 'number', description: 'Confidence before (0.0-1.0)' },
          confidence_after: { type: 'number', description: 'Confidence after (0.0-1.0)' },
          pattern: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              applies_when: { type: 'string' },
              correct_approach: { type: 'string' },
            },
          },
          linked_work_log: { type: 'string', description: 'Work log entry that prompted this' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['agent', 'trigger', 'insight', 'project', 'transferable'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_journal_search',
      description: 'Search learning journal entries — what agents learned. Can search across all agents or a specific one. ~200 tokens.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          agent: { type: 'string', description: 'Filter by agent (omit for all agents)' },
          trigger: { type: 'string', description: 'Filter by trigger type' },
          project: { type: 'string', description: 'Filter by project' },
          transferable: { type: 'boolean', description: 'Only show transferable insights' },
          tag: { type: 'string', description: 'Filter by tag prefix' },
          dateFrom: { type: 'string' },
          dateTo: { type: 'string' },
          limit: { type: 'number', description: 'Max entries (default 20)' },
          stats: { type: 'boolean', description: 'Return stats instead of entries (requires agent)' },
        },
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_decision_record',
      description: 'Record a team decision — what we decided and why. Institutional memory with rationale and alternatives. ~100 tokens.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          title: { type: 'string', description: 'Decision title' },
          decision: { type: 'string', description: 'The decision itself' },
          rationale: { type: 'string', description: 'Why this was chosen' },
          participants: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                role: { type: 'string', enum: ['human', 'agent'] },
                stance: { type: 'string', enum: ['proposed', 'supported', 'dissented', 'abstained', 'neutral'] },
              },
              required: ['id', 'role', 'stance'],
            },
          },
          alternatives_considered: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                option: { type: 'string' },
                rejected_because: { type: 'string' },
              },
            },
          },
          symbols_affected: { type: 'array', items: { type: 'string' } },
          status: { type: 'string', enum: ['active', 'proposed'], description: 'Decision status (default: active)' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'decision', 'rationale', 'participants'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_decision_search',
      description: 'Search team decisions — what we decided. Find active decisions by symbol, participant, status. ~200 tokens.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          status: { type: 'string', enum: ['active', 'superseded', 'deprecated', 'proposed', 'rejected'] },
          participant: { type: 'string', description: 'Filter by participant ID' },
          symbol: { type: 'string', description: 'Filter by affected symbol' },
          tag: { type: 'string', description: 'Filter by tag prefix' },
          dateFrom: { type: 'string' },
          dateTo: { type: 'string' },
          limit: { type: 'number', description: 'Max entries (default 20)' },
          summary: { type: 'boolean', description: 'Return aggregate summary' },
        },
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
  ];
}

export async function handleStreamsTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ProjectContext
): Promise<{ text: string; handled: boolean }> {
  const json = (data: unknown) => JSON.stringify(data, null, 2);

  switch (name) {
    case 'paradigm_work_log_record': {
      const policy = loadDataPolicy(ctx.rootDir);
      const { filtered: filteredSummary } = filterContent(args.summary as string, policy, 'work_log');
      const entry = recordWorkLog(ctx.rootDir, {
        agent: args.agent as string,
        summary: filteredSummary,
        outcome: args.outcome as 'pass' | 'fail' | 'partial' | 'blocked',
        task_ref: args.task_ref as string | undefined,
        files_modified: args.files_modified as string[] | undefined,
        symbols_touched: args.symbols_touched as string[] | undefined,
        next_steps: args.next_steps as string[] | undefined,
        blockers: args.blockers as string[] | undefined,
        duration_minutes: args.duration_minutes as number | undefined,
        commit: args.commit as string | undefined,
      });
      return {
        text: json({ recorded: true, id: entry.id, timestamp: entry.timestamp }),
        handled: true,
      };
    }

    case 'paradigm_work_log_search': {
      if (args.summary) {
        const summary = getWorkLogSummary(ctx.rootDir, 7);
        return { text: json(summary), handled: true };
      }
      const entries = loadWorkLogEntries(ctx.rootDir, {
        agent: args.agent as string | undefined,
        outcome: args.outcome as 'pass' | 'fail' | 'partial' | 'blocked' | undefined,
        task_ref: args.task_ref as string | undefined,
        symbol: args.symbol as string | undefined,
        dateFrom: args.dateFrom as string | undefined,
        dateTo: args.dateTo as string | undefined,
        limit: (args.limit as number) || 20,
      });
      return {
        text: json({
          count: entries.length,
          entries: entries.map(e => ({
            id: e.id,
            agent: e.agent,
            summary: e.summary,
            outcome: e.outcome,
            timestamp: e.timestamp,
            symbols_touched: e.symbols_touched,
            task_ref: e.task_ref,
          })),
        }),
        handled: true,
      };
    }

    case 'paradigm_journal_record': {
      const journalPolicy = loadDataPolicy(ctx.rootDir);
      const { filtered: filteredInsight } = filterContent(args.insight as string, journalPolicy, 'learning_journal');
      const entry = recordJournalEntry(args.agent as string, {
        trigger: args.trigger as 'correction_received' | 'confidence_miss' | 'pattern_discovered' | 'debate_loss' | 'failure_analysis' | 'human_feedback' | 'self_reflection',
        insight: filteredInsight,
        project: args.project as string,
        transferable: args.transferable as boolean,
        confidence_before: args.confidence_before as number | undefined,
        confidence_after: args.confidence_after as number | undefined,
        pattern: args.pattern as { id: string; applies_when: string; correct_approach: string } | undefined,
        linked_work_log: args.linked_work_log as string | undefined,
        tags: args.tags as string[] | undefined,
      });
      return {
        text: json({ recorded: true, id: entry.id, agent: entry.agent, timestamp: entry.timestamp }),
        handled: true,
      };
    }

    case 'paradigm_journal_search': {
      if (args.stats && args.agent) {
        const stats = getJournalStats(args.agent as string);
        return { text: json(stats), handled: true };
      }

      const entries = args.agent
        ? loadJournalEntries(args.agent as string, {
            trigger: args.trigger as 'correction_received' | 'confidence_miss' | 'pattern_discovered' | 'debate_loss' | 'failure_analysis' | 'human_feedback' | 'self_reflection' | undefined,
            project: args.project as string | undefined,
            transferable: args.transferable as boolean | undefined,
            tag: args.tag as string | undefined,
            dateFrom: args.dateFrom as string | undefined,
            dateTo: args.dateTo as string | undefined,
            limit: (args.limit as number) || 20,
          })
        : loadAllJournalEntries({
            trigger: args.trigger as 'correction_received' | 'confidence_miss' | 'pattern_discovered' | 'debate_loss' | 'failure_analysis' | 'human_feedback' | 'self_reflection' | undefined,
            project: args.project as string | undefined,
            transferable: args.transferable as boolean | undefined,
            tag: args.tag as string | undefined,
            dateFrom: args.dateFrom as string | undefined,
            dateTo: args.dateTo as string | undefined,
            limit: (args.limit as number) || 20,
          });
      return {
        text: json({
          count: entries.length,
          entries: entries.map(e => ({
            id: e.id,
            agent: e.agent,
            trigger: e.trigger,
            insight: e.insight.slice(0, 200),
            project: e.project,
            transferable: e.transferable,
            timestamp: e.timestamp,
          })),
        }),
        handled: true,
      };
    }

    case 'paradigm_decision_record': {
      const decisionPolicy = loadDataPolicy(ctx.rootDir);
      const { filtered: filteredDecision } = filterContent(args.decision as string, decisionPolicy, 'team_decisions');
      const { filtered: filteredRationale } = filterContent(args.rationale as string, decisionPolicy, 'team_decisions');
      const entry = recordDecision(ctx.rootDir, {
        title: args.title as string,
        decision: filteredDecision,
        rationale: filteredRationale,
        participants: args.participants as Array<{ id: string; role: 'human' | 'agent'; stance: 'proposed' | 'supported' | 'dissented' | 'abstained' | 'neutral' }>,
        alternatives_considered: args.alternatives_considered as Array<{ option: string; rejected_because: string }> | undefined,
        symbols_affected: args.symbols_affected as string[] | undefined,
        status: (args.status as 'active' | 'proposed') || 'active',
        tags: args.tags as string[] | undefined,
      });

      // v6.0 (D3 locked): write a companion lore insight entry that references
      // the canonical decision. Best-effort — a companion-write failure must
      // not prevent the decision from being recorded.
      const companionLoreId = writeCompanionLoreEntry(ctx.rootDir, entry.id);

      return {
        text: json({
          recorded: true,
          id: entry.id,
          title: entry.title,
          timestamp: entry.timestamp,
          ...(companionLoreId ? { companion_lore_id: companionLoreId } : {}),
        }),
        handled: true,
      };
    }

    case 'paradigm_decision_search': {
      if (args.summary) {
        const summary = getDecisionSummary(ctx.rootDir);
        return { text: json(summary), handled: true };
      }
      const entries = loadDecisions(ctx.rootDir, {
        status: args.status as 'active' | 'superseded' | 'deprecated' | 'proposed' | 'rejected' | undefined,
        participant: args.participant as string | undefined,
        symbol: args.symbol as string | undefined,
        tag: args.tag as string | undefined,
        dateFrom: args.dateFrom as string | undefined,
        dateTo: args.dateTo as string | undefined,
        limit: (args.limit as number) || 20,
      });
      return {
        text: json({
          count: entries.length,
          entries: entries.map(e => ({
            id: e.id,
            title: e.title,
            status: e.status,
            decision: e.decision.slice(0, 200),
            participants: e.participants.map(p => `${p.id} (${p.stance})`),
            symbols_affected: e.symbols_affected,
            timestamp: e.timestamp,
          })),
        }),
        handled: true,
      };
    }

    default:
      return { text: `Unknown streams tool: ${name}`, handled: false };
  }
}
