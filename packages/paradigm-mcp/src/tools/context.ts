/**
 * MCP Context Tracking - Session-based context usage estimation
 *
 * Tracks MCP interactions and provides handoff recommendations.
 * The AI can periodically call paradigm_context_check to see if
 * a handoff is recommended.
 */

import type { ProjectContext } from '../utils/index-loader.js';

interface SessionStats {
  startTime: number;
  toolCalls: number;
  resourceReads: number;
  estimatedMcpTokens: number;
  lastActivity: number;
}

// Session state (resets when MCP server restarts)
let session: SessionStats = {
  startTime: Date.now(),
  toolCalls: 0,
  resourceReads: 0,
  estimatedMcpTokens: 0,
  lastActivity: Date.now(),
};

/**
 * Estimate tokens from text (same algorithm as cost.ts)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/**
 * Track a tool call
 */
export function trackToolCall(responseSize: number) {
  session.toolCalls++;
  session.estimatedMcpTokens += estimateTokens(responseSize.toString()) + responseSize / 4;
  session.lastActivity = Date.now();
}

/**
 * Track a resource read
 */
export function trackResourceRead(responseSize: number) {
  session.resourceReads++;
  session.estimatedMcpTokens += responseSize / 4; // Approximate token count
  session.lastActivity = Date.now();
}

/**
 * Reset session (called on handoff or new session)
 */
export function resetSession() {
  session = {
    startTime: Date.now(),
    toolCalls: 0,
    resourceReads: 0,
    estimatedMcpTokens: 0,
    lastActivity: Date.now(),
  };
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
      description: 'Prepare a handoff summary. Generates a handoff file and returns instructions.',
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
  ];
}

/**
 * Handle context tools
 */
export async function handleContextTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ProjectContext
): Promise<{ handled: boolean; text: string }> {

  if (name === 'paradigm_context_check') {
    const contextWindowSize = (args.contextWindowSize as number) || 200000;
    const estimatedTotal = args.estimatedTotalTokens as number | undefined;

    // Calculate session duration
    const durationMs = Date.now() - session.startTime;
    const durationMin = Math.round(durationMs / 60000);

    // Estimate context usage
    // Heuristic: Each MCP call adds ~100-300 tokens of actual content
    // Plus the AI's analysis, user prompts, etc. multiply by ~3-5x
    const mcpContribution = session.estimatedMcpTokens;
    const estimatedConversationOverhead = mcpContribution * 4; // Rough multiplier
    const totalEstimate = estimatedTotal || (mcpContribution + estimatedConversationOverhead);

    // Calculate percentage
    const usagePercent = Math.round((totalEstimate / contextWindowSize) * 100);

    // Determine recommendation
    let recommendation: 'continue' | 'consider-handoff' | 'handoff-recommended' | 'handoff-urgent';
    let message: string;

    if (usagePercent >= 85) {
      recommendation = 'handoff-urgent';
      message = 'Context is nearly full. Initiate handoff immediately to preserve session continuity.';
    } else if (usagePercent >= 70) {
      recommendation = 'handoff-recommended';
      message = 'Context usage is high. Consider initiating handoff soon to ensure smooth transition.';
    } else if (usagePercent >= 50) {
      recommendation = 'consider-handoff';
      message = 'Context usage is moderate. Plan a good stopping point for potential handoff.';
    } else {
      recommendation = 'continue';
      message = 'Context usage is healthy. Continue working.';
    }

    // Additional signals
    const signals: string[] = [];
    if (session.toolCalls > 50) {
      signals.push('High number of tool calls (>50) suggests complex session');
    }
    if (durationMin > 30) {
      signals.push('Session duration >30 min - check user fatigue');
    }

    return {
      handled: true,
      text: JSON.stringify({
        recommendation,
        message,
        stats: {
          sessionDurationMinutes: durationMin,
          mcpToolCalls: session.toolCalls,
          mcpResourceReads: session.resourceReads,
          estimatedMcpTokens: Math.round(mcpContribution),
          estimatedTotalTokens: Math.round(totalEstimate),
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

    // Generate handoff ID
    const handoffId = `h${Date.now().toString(36)}`;

    // Create handoff content
    const handoffContent = {
      id: handoffId,
      timestamp: new Date().toISOString(),
      from: 'current-session',
      to: agent,
      summary,
      nextSteps,
      sessionStats: {
        duration: Math.round((Date.now() - session.startTime) / 60000),
        mcpCalls: session.toolCalls + session.resourceReads,
        estimatedTokens: Math.round(session.estimatedMcpTokens),
      },
      status: 'pending',
    };

    // Reset session stats after handoff
    resetSession();

    return {
      handled: true,
      text: JSON.stringify({
        handoff: handoffContent,
        instructions: [
          '1. Save the handoff summary above',
          '2. Run: paradigm team handoff --to ' + agent + ' --summary "' + summary.slice(0, 50) + '..."',
          '3. Start a new chat session',
          '4. In new session: paradigm team accept ' + handoffId,
        ],
        cliCommand: `paradigm team handoff --to ${agent} --summary "${summary.replace(/"/g, '\\"')}"`,
      }, null, 2),
    };
  }

  if (name === 'paradigm_session_stats') {
    const durationMs = Date.now() - session.startTime;
    const durationMin = Math.round(durationMs / 60000);

    return {
      handled: true,
      text: JSON.stringify({
        session: {
          startTime: new Date(session.startTime).toISOString(),
          durationMinutes: durationMin,
          lastActivity: new Date(session.lastActivity).toISOString(),
        },
        interactions: {
          toolCalls: session.toolCalls,
          resourceReads: session.resourceReads,
          totalInteractions: session.toolCalls + session.resourceReads,
        },
        tokens: {
          estimatedMcpTokens: Math.round(session.estimatedMcpTokens),
          note: 'This tracks MCP responses only, not full conversation context',
        },
      }, null, 2),
    };
  }

  return { handled: false, text: '' };
}
