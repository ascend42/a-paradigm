/**
 * MCP Context Resources - Session usage information
 */

import type { ProjectContext } from '../utils/index-loader.js';

// Import session stats from tools (shared state)
// Note: This creates a circular dependency risk, but the state is simple enough
let sessionStats = {
  toolCalls: 0,
  resourceReads: 0,
  estimatedTokens: 0,
  startTime: Date.now(),
};

/**
 * Update session stats (called from tools/context.ts)
 */
export function updateSessionStats(stats: typeof sessionStats) {
  sessionStats = stats;
}

/**
 * Get context resources list
 */
export function getContextResourcesList() {
  return [
    {
      uri: 'paradigm://context/session',
      name: 'Session Info',
      description: 'Current MCP session statistics and context usage estimate',
      mimeType: 'application/json',
    },
    {
      uri: 'paradigm://context/handoff-guide',
      name: 'Handoff Guide',
      description: 'When and how to perform context handoffs',
      mimeType: 'text/markdown',
    },
  ];
}

/**
 * Handle context resource reads
 */
export async function handleContextResource(
  resourcePath: string,
  _ctx: ProjectContext
): Promise<{ handled: boolean; text: string }> {

  if (resourcePath === 'context/session') {
    const durationMin = Math.round((Date.now() - sessionStats.startTime) / 60000);

    return {
      handled: true,
      text: JSON.stringify({
        session: {
          durationMinutes: durationMin,
          startTime: new Date(sessionStats.startTime).toISOString(),
        },
        interactions: {
          toolCalls: sessionStats.toolCalls,
          resourceReads: sessionStats.resourceReads,
        },
        tokens: {
          estimatedMcpContribution: sessionStats.estimatedTokens,
          note: 'Use paradigm_context_check tool for full analysis',
        },
      }, null, 2),
    };
  }

  if (resourcePath === 'context/handoff-guide') {
    return {
      handled: true,
      text: `# Context Handoff Guide

## When to Handoff

Handoff is recommended when:
- **70%+ context usage** - Running low on context space
- **Complex multi-step task** - Natural breakpoint between phases
- **Session >30 minutes** - Long sessions benefit from fresh starts
- **Switching focus** - Moving to different part of codebase

## How to Check

Call the \`paradigm_context_check\` tool to get:
- Current estimated context usage
- Handoff recommendation
- Session statistics

## How to Handoff

1. **Prepare**: Call \`paradigm_handoff_prepare\` with:
   - Summary of work done
   - List of next steps
   - Target agent role

2. **CLI Command**: Run the provided command:
   \`\`\`bash
   paradigm team handoff --to <agent> --summary "..."
   \`\`\`

3. **New Session**: Start fresh chat

4. **Accept**: In new session, run:
   \`\`\`bash
   paradigm team accept <handoff-id>
   \`\`\`

## Context Window Sizes

| Model | Context Window |
|-------|----------------|
| Claude Opus 4.5 | 200,000 tokens |
| Claude Sonnet 4 | 200,000 tokens |

## Tips

- Summarize completed work before handoff
- List specific file paths modified
- Include any blockers or decisions needed
- Reference relevant symbols (@feature, #component, etc.)
`,
    };
  }

  return { handled: false, text: '' };
}
