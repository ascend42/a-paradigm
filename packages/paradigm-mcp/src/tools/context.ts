/**
 * MCP Context Tracking - Session-based context usage estimation
 *
 * Tracks MCP interactions and provides handoff recommendations.
 * The AI can periodically call paradigm_context_check to see if
 * a handoff is recommended.
 */

import type { ProjectContext } from '../utils/index-loader.js';
import {
  getSessionTracker,
  resetSessionTracker,
  type SessionCheckpoint,
  type PersistedSession,
} from '../utils/session-tracker.js';
import {
  writePendingHandoff,
  loadPendingHandoffs,
  markHandoffDelivered,
  type PendingHandoff,
} from '../utils/global-store.js';

/**
 * Track a tool call (convenience wrapper for the session tracker)
 */
export function trackToolCall(responseSize: number, toolName: string = 'unknown') {
  getSessionTracker().trackToolCall(toolName, responseSize);
}

/**
 * Track a resource read (convenience wrapper for the session tracker)
 */
export function trackResourceRead(responseSize: number, uri: string = 'paradigm://unknown') {
  getSessionTracker().trackResourceRead(uri, responseSize);
}

/**
 * Reset session (called on handoff or new session)
 */
export function resetSession() {
  resetSessionTracker();
}

/**
 * Extract breadcrumb info (summary + symbol) from a tool call's arguments.
 */
function extractBreadcrumbInfo(toolName: string, args: Record<string, unknown>): { summary: string; symbol?: string } {
  switch (toolName) {
    case 'paradigm_search':
      return {
        summary: `Searched for "${args.query}"${args.type ? ` (type: ${args.type})` : ''}`,
        symbol: args.query as string | undefined,
      };
    case 'paradigm_ripple':
      return {
        summary: `Ripple analysis on ${args.symbol}${args.depth ? ` (depth: ${args.depth})` : ''}`,
        symbol: args.symbol as string | undefined,
      };
    case 'paradigm_related':
      return {
        summary: `Checked relations for ${args.symbol}`,
        symbol: args.symbol as string | undefined,
      };
    case 'paradigm_status':
      return { summary: 'Checked project status' };
    case 'paradigm_navigate': {
      const intent = args.intent as string | undefined;
      const target = args.target as string | undefined;
      const task = args.task as string | undefined;
      if (intent === 'context' && task) return { summary: `Navigate context: "${task}"` };
      if (target) return { summary: `Navigate ${intent || 'find'}: ${target}`, symbol: target };
      return { summary: `Navigate (${intent || 'unknown'})` };
    }
    case 'paradigm_gates_for_route':
      return { summary: `Gate suggestions for ${args.method || 'GET'} ${args.route}` };
    case 'paradigm_wisdom_context':
      return {
        summary: `Checked wisdom for ${Array.isArray(args.symbols) ? (args.symbols as string[]).join(', ') : 'symbols'}`,
        symbol: Array.isArray(args.symbols) ? (args.symbols as string[])[0] : undefined,
      };
    case 'paradigm_history_context':
      return {
        summary: `Checked history for ${Array.isArray(args.symbols) ? (args.symbols as string[]).join(', ') : 'symbols'}`,
        symbol: Array.isArray(args.symbols) ? (args.symbols as string[])[0] : undefined,
      };
    case 'paradigm_history_record':
      return {
        summary: `Recorded ${args.type}: ${(args.description as string || '').slice(0, 60)}`,
        symbol: Array.isArray(args.symbols) ? (args.symbols as string[])[0] : undefined,
      };
    case 'paradigm_history_fragility':
      return {
        summary: `Checked fragility for ${Array.isArray(args.symbols) ? (args.symbols as string[]).join(', ') : 'symbols'}`,
        symbol: Array.isArray(args.symbols) ? (args.symbols as string[])[0] : undefined,
      };
    case 'paradigm_flows_affected':
      return {
        summary: `Checked flows affected by ${args.symbol}`,
        symbol: args.symbol as string | undefined,
      };
    case 'paradigm_reindex':
      return { summary: 'Rebuilt static index files' };
    case 'paradigm_session_checkpoint':
      return {
        summary: `Checkpoint: phase=${args.phase}, ${(args.context as string || '').slice(0, 60)}`,
      };
    case 'paradigm_task_create':
      return { summary: `Created task: "${(args.blurb as string || '').slice(0, 60)}"` };
    case 'paradigm_task_done':
      return { summary: `Completed task ${args.id}` };
    case 'paradigm_task_shelve':
      return { summary: `Shelved task ${args.id}` };
    case 'paradigm_task_list':
      return { summary: `Listed tasks (status: ${args.status || 'open'})` };
    case 'paradigm_task_update':
      return { summary: `Updated task ${args.id}` };
    case 'paradigm_assessment_record':
      return {
        summary: `Assessment: ${(args.title as string || '').slice(0, 60)} → ${args.arc_id}`,
        symbol: Array.isArray(args.symbols) ? (args.symbols as string[])[0] : undefined,
      };
    case 'paradigm_assessment_list':
      return { summary: args.arc_id ? `Listed entries in ${args.arc_id}` : 'Listed assessment arcs' };
    case 'paradigm_assessment_search':
      return {
        summary: `Searched assessments${args.symbol ? ` for ${args.symbol}` : ''}`,
        symbol: args.symbol as string | undefined,
      };
    case 'paradigm_assessment_arc_create':
      return { summary: `Created arc: ${args.id}` };
    case 'paradigm_assessment_arc_close':
      return { summary: `Closed arc: ${args.arc_id}` };
    default: {
      // Generic fallback: strip paradigm_ prefix, pick first meaningful arg
      const shortName = toolName.replace(/^paradigm_/, '');
      const firstArg = Object.values(args).find(v => typeof v === 'string' && v.length > 0) as string | undefined;
      return {
        summary: firstArg ? `${shortName}: ${firstArg.slice(0, 60)}` : shortName,
        symbol: (args.symbol as string) || undefined,
      };
    }
  }
}

/**
 * Record a breadcrumb for a tool call (called from the dispatch layer).
 */
export function addToolBreadcrumb(toolName: string, args: Record<string, unknown>): void {
  const tracker = getSessionTracker();
  const { summary, symbol } = extractBreadcrumbInfo(toolName, args);
  tracker.addBreadcrumb('tool-call', summary, { tool: toolName, symbol });
}

/**
 * Get context tools list
 */
export function getContextToolsList() {
  return [
    {
      name: 'paradigm_session_health',
      description: 'Check if context handoff is recommended based on session activity. Call this periodically during long sessions. Returns usage percentage and recommendation (continue, consider-handoff, handoff-recommended, handoff-urgent). ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          estimatedTotalTokens: {
            type: 'number',
            description: 'Optional: Your estimate of total conversation tokens (if available)',
          },
          contextWindowSize: {
            type: 'number',
            description: 'Context window size in tokens (default: 200000)',
          },
        },
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_context_check',
      description: 'DEPRECATED: renamed to paradigm_session_health. This alias will be removed in a future version.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_handoff_prepare',
      description: 'Prepare a handoff summary. Generates a structured handoff file with markdown summary and recovery instructions. Returns structured markdown with summary, modified files, and next steps. ~300 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: 'Brief summary of work done in this session',
          },
          nextSteps: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of next steps for the continuing session',
          },
          agent: {
            type: 'string',
            description: 'Target agent role (e.g., "builder", "architect")',
          },
          modifiedFiles: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of files modified in this session',
          },
          symbolsTouched: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of symbols (@feature, #component, etc.) touched',
          },
          openQuestions: {
            type: 'array',
            items: { type: 'string' },
            description: 'Unresolved questions or decisions needed',
          },
        },
        required: ['summary'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_session_stats',
      description: 'Get current session statistics (MCP interactions, estimated tokens). Returns tool call count, estimated tokens used, and cost breakdown. ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_session_recover',
      description: 'Load previous session breadcrumbs for continuity. Call this at the start of a new session to understand what was done before. Returns symbols modified, files explored, recent actions, and suggestions for continuity. ~200 tokens. NOTE: Recovery data is automatically surfaced as a preamble on the first tool call of each session — explicit calls are retained for direct inspection or forcing a second recovery pass.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
      aliases: ['resume', 'pick up', 'continue', 'what was I doing', 'last session', 'recover'],
    },
    {
      name: 'paradigm_session_checkpoint',
      description: 'Save a cognitive-transition checkpoint for crash recovery. Call when transitioning between phases (planning → implementing → validating → complete). ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          phase: {
            type: 'string',
            enum: ['planning', 'implementing', 'validating', 'complete'],
            description: 'Current workflow phase',
          },
          context: {
            type: 'string',
            description: 'What\'s top-of-mind right now (1-3 sentences)',
          },
          externalId: {
            type: 'string',
            description: 'Optional: deterministic ID from external source for automatic session recovery (e.g. "linear:PROJ-123", "github:owner/repo#42")',
          },
          plan: {
            type: 'string',
            description: 'Optional: the current plan or approach',
          },
          modifiedFiles: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional: files modified so far',
          },
          symbolsTouched: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional: symbols touched so far',
          },
          decisions: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional: key decisions made so far',
          },
        },
        required: ['phase', 'context'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
  ];
}

/**
 * Handle context tools
 */
export async function handleContextTool(
  name: string,
  args: Record<string, unknown>,
  _ctx: ProjectContext
): Promise<{ handled: boolean; text: string }> {
  const tracker = getSessionTracker();

  if (name === 'paradigm_session_health' || name === 'paradigm_context_check') {
    const contextWindowSize = (args.contextWindowSize as number) || 200000;
    const estimatedTotal = args.estimatedTotalTokens as number | undefined;

    const stats = tracker.getStats();
    const { recommendation, message, usagePercent, signals } = tracker.getHandoffRecommendation(
      contextWindowSize,
      estimatedTotal
    );

    const durationMin = tracker.getDurationMinutes();

    return {
      handled: true,
      text: JSON.stringify({
        recommendation,
        message,
        stats: {
          sessionDurationMinutes: durationMin,
          mcpToolCalls: stats.totals.toolCallCount,
          mcpResourceReads: stats.totals.resourceReadCount,
          estimatedMcpTokens: stats.totals.totalTokens,
          estimatedTotalTokens: estimatedTotal || Math.round(stats.totals.totalTokens * 5),
          contextWindowSize,
          usagePercent,
        },
        signals,
        action: recommendation === 'continue'
          ? null
          : 'Call paradigm_handoff_prepare to create handoff file',
      }, null, 2),
    };
  }

  if (name === 'paradigm_handoff_prepare') {
    const summary = args.summary as string;
    const nextSteps = (args.nextSteps as string[]) || [];
    const agent = (args.agent as string) || 'builder';
    const modifiedFiles = (args.modifiedFiles as string[]) || [];
    const symbolsTouched = (args.symbolsTouched as string[]) || [];
    const openQuestions = (args.openQuestions as string[]) || [];

    const stats = tracker.getStats();
    const breakdown = tracker.getCostBreakdown();

    // Generate handoff ID
    const handoffId = `h${Date.now().toString(36)}`;
    const timestamp = new Date().toISOString();

    // Create structured handoff content
    const handoffPayload: PendingHandoff = {
      id: handoffId,
      timestamp,
      from: 'current-session',
      to: agent,
      summary,
      nextSteps,
      modifiedFiles,
      symbolsTouched,
      openQuestions,
      sessionStats: {
        duration: tracker.getDurationMinutes(),
        mcpCalls: stats.totals.toolCallCount + stats.totals.resourceReadCount,
        estimatedTokens: stats.totals.totalTokens,
        estimatedCostUsd: breakdown.total.costUsd,
        model: breakdown.model,
      },
      status: 'pending',
    };

    // Persist handoff to global store (~/.paradigm/sessions/{hash}/pending-handoffs/)
    let persisted = false;
    try {
      writePendingHandoff(_ctx.rootDir, handoffPayload);
      persisted = true;
    } catch {
      // Best-effort persistence — caller receives persisted: false
    }

    // Generate markdown handoff summary for display
    const markdownSummary = `# Handoff: ${timestamp}

## Session Summary
${summary}

## Next Steps
${nextSteps.map((step, i) => `${i + 1}. ${step}`).join('\n') || '(none specified)'}

## Key Context
- Modified files: ${modifiedFiles.length > 0 ? modifiedFiles.join(', ') : '(not specified)'}
- Symbols touched: ${symbolsTouched.length > 0 ? symbolsTouched.join(', ') : '(not specified)'}
- Open questions: ${openQuestions.length > 0 ? openQuestions.join(', ') : '(none)'}
`;

    // Reset session stats after handoff
    resetSession();

    return {
      handled: true,
      text: JSON.stringify({
        handoff: handoffPayload,
        markdownSummary,
        persisted,
        recovery: 'The next session will automatically receive this handoff via paradigm_session_recover.',
      }, null, 2),
    };
  }

  if (name === 'paradigm_session_stats') {
    const stats = tracker.getStats();
    const breakdown = tracker.getCostBreakdown();
    const durationMin = tracker.getDurationMinutes();

    return {
      handled: true,
      text: JSON.stringify({
        session: {
          startTime: new Date(stats.startTime).toISOString(),
          durationMinutes: durationMin,
          lastActivity: new Date(stats.lastActivity).toISOString(),
        },
        model: {
          name: breakdown.model,
          id: breakdown.modelId,
          pricing: {
            inputPerMillion: `$${breakdown.pricing.input.toFixed(2)}`,
            outputPerMillion: `$${breakdown.pricing.output.toFixed(2)}`,
          },
        },
        interactions: {
          toolCalls: stats.totals.toolCallCount,
          resourceReads: stats.totals.resourceReadCount,
          totalInteractions: stats.totals.toolCallCount + stats.totals.resourceReadCount,
        },
        tokens: {
          total: stats.totals.totalTokens,
          byCategory: {
            resources: breakdown.resources.tokens,
            tools: breakdown.tools.tokens,
          },
        },
        cost: {
          totalUsd: `$${breakdown.total.costUsd.toFixed(4)}`,
          breakdown: {
            resources: `$${breakdown.resources.costUsd.toFixed(4)}`,
            tools: `$${breakdown.tools.costUsd.toFixed(4)}`,
          },
          note: 'Cost is for MCP output tokens only (responses sent to model)',
        },
        details: {
          resourcesByType: breakdown.resources.byType,
          toolsByName: breakdown.tools.byName,
        },
      }, null, 2),
    };
  }

  if (name === 'paradigm_session_recover') {
    const { checkpoint, pendingHandoffs, previousSession } = loadRecoveryData(_ctx.rootDir);

    if (!previousSession && pendingHandoffs.length === 0 && !checkpoint) {
      return {
        handled: true,
        text: JSON.stringify({
          found: false,
          message: 'No previous session breadcrumbs, checkpoints, or pending handoffs found.',
          tip: 'Breadcrumbs persist to ~/.paradigm/sessions/ and handoffs persist via paradigm_handoff_prepare. Checkpoints persist via paradigm_session_checkpoint.',
        }, null, 2),
      };
    }

    const result: Record<string, unknown> = { found: true };

    // Include checkpoint if available (highest-priority recovery data)
    if (checkpoint) {
      const ageMs = Date.now() - checkpoint.timestamp;
      const ageMinutes = Math.round(ageMs / 60000);
      const ageHours = Math.round(ageMs / 3600000);

      result.checkpoint = {
        phase: checkpoint.phase,
        context: checkpoint.context,
        age: ageHours > 1 ? `${ageHours} hours ago` : `${ageMinutes} minutes ago`,
        timestamp: new Date(checkpoint.timestamp).toISOString(),
        sessionId: checkpoint.sessionId,
        plan: checkpoint.plan,
        modifiedFiles: checkpoint.modifiedFiles,
        symbolsTouched: checkpoint.symbolsTouched,
        decisions: checkpoint.decisions,
        recentBreadcrumbs: checkpoint.recentBreadcrumbs?.map(bc => ({
          time: new Date(bc.timestamp).toISOString(),
          action: bc.action,
          tool: bc.tool,
          symbol: bc.symbol,
          summary: bc.summary,
        })),
      };
    }

    // Include previous session breadcrumbs if available
    if (previousSession) {
      const ageMs = Date.now() - previousSession.lastActivity;
      const ageMinutes = Math.round(ageMs / 60000);
      const ageHours = Math.round(ageMs / 3600000);

      const recentActions = previousSession.breadcrumbs.slice(-10);
      const actionSummary = recentActions.map(bc => ({
        time: new Date(bc.timestamp).toISOString(),
        action: bc.action,
        tool: bc.tool,
        symbol: bc.symbol,
        summary: bc.summary,
      }));

      result.previousSession = {
        sessionId: previousSession.sessionId,
        startTime: new Date(previousSession.startTime).toISOString(),
        lastActivity: new Date(previousSession.lastActivity).toISOString(),
        age: ageHours > 1 ? `${ageHours} hours ago` : `${ageMinutes} minutes ago`,
      };
      result.context = {
        symbolsModified: previousSession.symbolsModified,
        filesExplored: previousSession.filesExplored,
      };
      result.recentActions = actionSummary;
    }

    // Include pending handoffs if available
    if (pendingHandoffs.length > 0) {
      result.pendingHandoffs = pendingHandoffs.map(h => ({
        id: h.id,
        timestamp: h.timestamp,
        from: h.from,
        to: h.to,
        summary: h.summary,
        nextSteps: h.nextSteps,
        modifiedFiles: h.modifiedFiles,
        symbolsTouched: h.symbolsTouched,
        openQuestions: h.openQuestions,
      }));

      // Mark each handoff as delivered
      for (const h of pendingHandoffs) {
        try {
          markHandoffDelivered(_ctx.rootDir, h.id);
        } catch {
          // Best-effort
        }
      }
    }

    // Build suggestion — prioritize checkpoint, then handoff, then breadcrumbs
    let suggestion = 'Continue where the previous session left off.';
    if (checkpoint) {
      suggestion = `Previous session was in "${checkpoint.phase}" phase: ${checkpoint.context}`;
      if (checkpoint.decisions?.length) {
        suggestion += ` Key decisions: ${checkpoint.decisions.slice(0, 2).join('; ')}`;
      }
    } else if (pendingHandoffs.length > 0) {
      const latest = pendingHandoffs[pendingHandoffs.length - 1];
      suggestion = `Handoff received: "${latest.summary}". `;
      if (latest.nextSteps.length > 0) {
        suggestion += `Start with: ${latest.nextSteps[0]}`;
      }
    } else if (previousSession) {
      const recentActions = previousSession.breadcrumbs.slice(-10);
      if (recentActions.length > 0) {
        const lastAction = recentActions[recentActions.length - 1];
        if (lastAction.symbol) {
          suggestion = `Last work involved ${lastAction.symbol}. Consider checking its current state with paradigm_ripple.`;
        }
      }
    }
    result.suggestion = suggestion;

    // Instruct the agent to ask the user before proceeding
    result.agentInstruction = 'Present a brief summary of the previous session, then ask the user what they would like to do: (1) Continue — pick up where the last session left off, (2) Discard — ignore the previous session and start fresh, or (3) let them describe what they want to work on instead. Do NOT automatically continue without asking.';

    // Mark recovery as done so auto-recovery doesn't duplicate
    tracker.markRecovered();

    return {
      handled: true,
      text: JSON.stringify(result, null, 2),
    };
  }

  if (name === 'paradigm_session_checkpoint') {
    tracker.setRootDir(_ctx.rootDir);

    const phase = args.phase as SessionCheckpoint['phase'];
    const context = args.context as string;
    const externalId = args.externalId as string | undefined;
    const plan = args.plan as string | undefined;
    const modifiedFiles = args.modifiedFiles as string[] | undefined;
    const symbolsTouched = args.symbolsTouched as string[] | undefined;
    const decisions = args.decisions as string[] | undefined;

    const { checkpoint, persisted } = tracker.saveCheckpoint({
      phase,
      context,
      externalId,
      plan,
      modifiedFiles,
      symbolsTouched,
      decisions,
    });

    const anyPersisted = persisted.local || persisted.global;

    return {
      handled: true,
      text: JSON.stringify({
        saved: anyPersisted,
        persisted,
        checkpoint: {
          phase: checkpoint.phase,
          context: checkpoint.context,
          sessionId: checkpoint.sessionId,
          ...(checkpoint.externalId ? { externalId: checkpoint.externalId } : {}),
          timestamp: new Date(checkpoint.timestamp).toISOString(),
          modifiedFiles: checkpoint.modifiedFiles?.length || 0,
          symbolsTouched: checkpoint.symbolsTouched?.length || 0,
          decisions: checkpoint.decisions?.length || 0,
          recentBreadcrumbs: checkpoint.recentBreadcrumbs?.length || 0,
        },
        ...(anyPersisted
          ? { note: 'Checkpoint saved. Recovery data will be auto-surfaced on the first tool call of the next session.' }
          : { warning: 'Checkpoint was NOT persisted to disk. Both local and global writes failed. Check MCP server stderr for details.' }
        ),
      }, null, 2),
    };
  }

  return { handled: false, text: '' };
}

interface RecoveryData {
  checkpoint: SessionCheckpoint | null;
  pendingHandoffs: PendingHandoff[];
  previousSession: PersistedSession | null;
}

function loadRecoveryData(rootDir: string): RecoveryData {
  const tracker = getSessionTracker();
  tracker.setRootDir(rootDir);

  const checkpoint = tracker.loadCheckpoint();
  const previousSession = tracker.loadPreviousSession();

  let pendingHandoffs: PendingHandoff[] = [];
  try {
    pendingHandoffs = loadPendingHandoffs(rootDir);
  } catch {
    // Best-effort
  }

  return { checkpoint, pendingHandoffs, previousSession };
}

/**
 * Build a recovery preamble from checkpoint + handoff data.
 * Returns null if no recovery data is available.
 * Used by both auto-recovery (index.ts) and explicit paradigm_session_recover.
 */
export async function buildRecoveryPreamble(rootDir: string): Promise<string | null> {
  const { checkpoint, pendingHandoffs } = loadRecoveryData(rootDir);

  if (!checkpoint && pendingHandoffs.length === 0) {
    return null;
  }

  const lines: string[] = [];
  lines.push('--- SESSION RECOVERY ---');

  if (checkpoint) {
    const ageMs = Date.now() - checkpoint.timestamp;
    const ageMinutes = Math.round(ageMs / 60000);
    const ageHours = Math.round(ageMs / 3600000);
    const ageStr = ageHours > 1 ? `${ageHours}h ago` : `${ageMinutes}m ago`;

    lines.push(`Previous session was in "${checkpoint.phase}" phase (${ageStr}): ${checkpoint.context}`);

    if (checkpoint.modifiedFiles?.length) {
      lines.push(`Modified files: ${checkpoint.modifiedFiles.join(', ')}`);
    }
    if (checkpoint.symbolsTouched?.length) {
      lines.push(`Symbols: ${checkpoint.symbolsTouched.join(', ')}`);
    }
    if (checkpoint.decisions?.length) {
      lines.push(`Decisions: ${checkpoint.decisions.join('; ')}`);
    }
    if (checkpoint.plan) {
      lines.push(`Plan: ${checkpoint.plan.slice(0, 200)}`);
    }
  }

  if (pendingHandoffs.length > 0) {
    const latest = pendingHandoffs[pendingHandoffs.length - 1];
    lines.push(`Pending handoff: "${latest.summary}"`);
    if (latest.nextSteps.length > 0) {
      lines.push(`Next steps: ${latest.nextSteps.slice(0, 3).join(', ')}`);
    }
  }

  // Surface open tasks
  try {
    const { loadTasks } = await import('../utils/task-loader.js');
    const openTasks = await loadTasks(rootDir, { status: 'open', limit: 5 });
    if (openTasks.length > 0) {
      lines.push('');
      lines.push('Open tasks:');
      for (const task of openTasks) {
        const tags = task.tags.length > 0 ? ` [${task.tags.join(', ')}]` : '';
        lines.push(`  [${task.priority}] ${task.id}: ${task.blurb}${tags}`);
      }
    }
  } catch {
    // Tasks not initialized yet — skip
  }

  // Surface recent lore entries with arc tags (assessment arcs unified into lore)
  try {
    const { loadLoreEntries } = await import('../utils/lore-loader.js');
    const arcEntries = await loadLoreEntries(rootDir, { limit: 10 });
    const entriesWithArcs = arcEntries.filter(e => e.tags?.some(t => t.startsWith('arc:')));

    if (entriesWithArcs.length > 0) {
      // Group by arc tag
      const arcGroups = new Map<string, number>();
      for (const e of entriesWithArcs) {
        const arcTag = e.tags?.find(t => t.startsWith('arc:')) || '';
        arcGroups.set(arcTag, (arcGroups.get(arcTag) || 0) + 1);
      }

      const checkpointSymbols = checkpoint?.symbolsTouched || [];
      const relevantArcs = checkpointSymbols.length > 0
        ? entriesWithArcs.filter(e => e.symbols_touched?.some(s => checkpointSymbols.includes(s)))
        : entriesWithArcs.slice(0, 3);

      if (relevantArcs.length > 0 || arcGroups.size > 0) {
        lines.push('');
        lines.push('Active lore arcs:');
        for (const [arcTag, count] of arcGroups) {
          lines.push(`  ${arcTag} (${count} entries)`);
        }
      }
    }
  } catch {
    // Lore not initialized yet — skip
  }

  // Surface critical/high nominations from the ambient system
  try {
    const { loadNominations } = await import('../utils/nomination-engine.js');
    const urgent = loadNominations(rootDir, { pending_only: true })
      .filter(n => n.urgency === 'critical' || n.urgency === 'high');

    if (urgent.length > 0) {
      lines.push('');
      lines.push('Ambient nominations (urgent):');
      for (const n of urgent.slice(0, 5)) {
        lines.push(`  [${n.urgency}] ${n.brief}`);
      }
      if (urgent.length > 5) {
        lines.push(`  ... and ${urgent.length - 5} more. Use paradigm_ambient_nominations to see all.`);
      }
    }
  } catch {
    // Nomination engine not initialized — skip
  }

  lines.push('');
  lines.push('IMPORTANT: Present a brief summary of this recovery data to the user, then ask what they would like to do: (1) Continue — pick up where the last session left off, (2) Discard — ignore the previous session and start fresh, or (3) let them describe what they want to work on instead. Do NOT automatically continue without asking.');
  lines.push('---');

  return lines.join('\n');
}
