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
    // Agent protocol FIRST - helps agents discover workflow instructions
    {
      uri: 'paradigm://context/agent-protocol',
      name: 'Agent Protocol',
      description: 'IMPORTANT: Read this first. Workflow instructions for using Paradigm MCP tools effectively.',
      mimeType: 'text/markdown',
    },
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

  // Agent Protocol - workflow instructions for MCP tool usage
  if (resourcePath === 'context/agent-protocol') {
    return {
      handled: true,
      text: `# Agent Protocol for Paradigm MCP Tools

## Query Before Modify

**Always query before making changes** - this ensures you understand impact and dependencies.

| Before doing this... | Call this MCP tool |
|---------------------|-------------------|
| Modifying a symbol | \`paradigm_ripple\` with the symbol |
| Starting a session | \`paradigm_status\` for project overview |
| Understanding code | \`paradigm_navigate\` with explore intent |
| Checking dependencies | \`paradigm_related\` for connections |

## Example Workflow

1. **Get oriented**: Call \`paradigm_status\` to see project symbols and health
2. **Find relevant code**: Call \`paradigm_navigate\` with intent "find" or "explore"
3. **Before editing**: Call \`paradigm_ripple\` on symbols you'll modify
4. **Check context**: Call \`paradigm_context_check\` every 10-15 tool calls

## Benefits

- **Fresh data**: Always current from live project index
- **Precise**: Only get the data you need
- **Token-efficient**: ~100 tokens per query vs ~2000 for reading files

## Context Monitoring

Call \`paradigm_context_check\` periodically to monitor session health:
- **<50%**: Continue working
- **50-70%**: Plan a stopping point
- **70-85%**: Prepare handoff soon
- **>85%**: Handoff after current task

## Available Tools Summary

| Tool | Purpose |
|------|---------|
| \`paradigm_status\` | Project overview and health |
| \`paradigm_search\` | Find symbols by name/description |
| \`paradigm_ripple\` | Impact analysis before changes |
| \`paradigm_related\` | Symbol dependencies |
| \`paradigm_navigate\` | Codebase exploration |
| \`paradigm_context_check\` | Session health monitoring |
| \`paradigm_handoff_prepare\` | Prepare context handoff |

---

*This protocol ensures efficient, safe modifications to the codebase.*
`,
    };
  }

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
