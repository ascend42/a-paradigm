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
  MODEL_PRICING,
  type ModelId,
} from '../utils/session-tracker.js';

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
      name: 'paradigm_context_check',
      description: 'Check if context handoff is recommended based on session activity. Call this periodically during long sessions.',
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
    },
    {
      name: 'paradigm_handoff_prepare',
      description: 'Prepare a handoff summary. Generates a structured handoff file with markdown summary and recovery instructions.',
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
    },
    {
      name: 'paradigm_session_stats',
      description: 'Get current session statistics (MCP interactions, estimated tokens)',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'paradigm_session_recover',
      description: 'Load previous session breadcrumbs for continuity. Call this at the start of a new session to understand what was done before.',
      inputSchema: {
        type: 'object',
        properties: {},
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

  if (name === 'paradigm_context_check') {
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
    const handoffContent = {
      id: handoffId,
      timestamp,
      from: 'current-session',
      to: agent,
      summary,
      workCompleted: summary, // Alias for clarity
      inProgress: nextSteps.length > 0 ? nextSteps[0] : null,
      nextSteps,
      context: {
        modifiedFiles: modifiedFiles.length > 0 ? modifiedFiles : undefined,
        symbolsTouched: symbolsTouched.length > 0 ? symbolsTouched : undefined,
        openQuestions: openQuestions.length > 0 ? openQuestions : undefined,
      },
      sessionStats: {
        duration: tracker.getDurationMinutes(),
        mcpCalls: stats.totals.toolCallCount + stats.totals.resourceReadCount,
        estimatedTokens: stats.totals.totalTokens,
        estimatedCostUsd: breakdown.total.costUsd,
        model: breakdown.model,
      },
      status: 'pending',
    };

    // Generate markdown handoff summary for easy copying
    const markdownSummary = `# Handoff: ${timestamp}

## Session Summary
${summary}

## Work Completed
- ${summary}

## Next Steps
${nextSteps.map((step, i) => `${i + 1}. ${step}`).join('\n') || '(none specified)'}

## Key Context
- Modified files: ${modifiedFiles.length > 0 ? modifiedFiles.join(', ') : '(not specified)'}
- Symbols touched: ${symbolsTouched.length > 0 ? symbolsTouched.join(', ') : '(not specified)'}
- Open questions: ${openQuestions.length > 0 ? openQuestions.join(', ') : '(none)'}

## Recovery Command
\`\`\`bash
paradigm team accept ${handoffId}
\`\`\`
`;

    // Reset session stats after handoff
    resetSession();

    return {
      handled: true,
      text: JSON.stringify({
        handoff: handoffContent,
        markdownSummary,
        instructions: [
          '1. Share the handoff summary with the user',
          '2. Run: paradigm team handoff --to ' + agent + ' --summary "' + summary.slice(0, 50) + '..."',
          '3. Start a new chat session',
          '4. In new session: paradigm team accept ' + handoffId,
        ],
        cliCommand: `paradigm team handoff --to ${agent} --summary "${summary.replace(/"/g, '\\"')}"`,
        recoveryCommand: `paradigm team accept ${handoffId}`,
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
    // Set root dir for the tracker so it can load breadcrumbs
    tracker.setRootDir(_ctx.rootDir);

    const previousSession = tracker.loadPreviousSession();

    if (!previousSession) {
      return {
        handled: true,
        text: JSON.stringify({
          found: false,
          message: 'No previous session breadcrumbs found.',
          tip: 'Session breadcrumbs are saved to .paradigm/session-breadcrumbs.json during active sessions.',
        }, null, 2),
      };
    }

    const ageMs = Date.now() - previousSession.lastActivity;
    const ageMinutes = Math.round(ageMs / 60000);
    const ageHours = Math.round(ageMs / 3600000);

    // Summarize the last few actions
    const recentActions = previousSession.breadcrumbs.slice(-10);
    const actionSummary = recentActions.map(bc => ({
      time: new Date(bc.timestamp).toISOString(),
      action: bc.action,
      tool: bc.tool,
      symbol: bc.symbol,
      summary: bc.summary,
    }));

    // Suggest what to do next based on recent activity
    let suggestion = 'Continue where the previous session left off.';
    if (recentActions.length > 0) {
      const lastAction = recentActions[recentActions.length - 1];
      if (lastAction.symbol) {
        suggestion = `Last work involved ${lastAction.symbol}. Consider checking its current state with paradigm_ripple.`;
      }
    }

    return {
      handled: true,
      text: JSON.stringify({
        found: true,
        previousSession: {
          sessionId: previousSession.sessionId,
          startTime: new Date(previousSession.startTime).toISOString(),
          lastActivity: new Date(previousSession.lastActivity).toISOString(),
          age: ageHours > 1 ? `${ageHours} hours ago` : `${ageMinutes} minutes ago`,
        },
        context: {
          symbolsModified: previousSession.symbolsModified,
          filesExplored: previousSession.filesExplored,
        },
        recentActions: actionSummary,
        suggestion,
      }, null, 2),
    };
  }

  return { handled: false, text: '' };
}
