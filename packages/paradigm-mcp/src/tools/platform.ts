/**
 * Platform MCP Tools — Agent-driven UI commands
 *
 * Tools:
 * - paradigm_platform_navigate: Navigate sections, select symbols, open lore
 * - paradigm_platform_highlight: Temporary visual emphasis on symbols
 * - paradigm_platform_annotate: Toasts, callouts, badges
 * - paradigm_platform_observe: Read current UI state
 * - paradigm_platform_clear: Remove all agent effects
 */

import type { ProjectContext } from '../utils/index-loader.js';
import { sendAgentCommand } from '../utils/platform-bridge.js';

/**
 * Get list of platform tools with safety annotations
 */
export function getPlatformToolsList() {
  return [
    {
      name: 'paradigm_platform_navigate',
      description:
        'Navigate the Platform UI to a section, select a symbol, or open a lore entry. The browser updates in real-time. If the user is actively interacting, shows a prompt instead of auto-navigating. ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          section: {
            type: 'string',
            enum: ['overview', 'lore', 'graph', 'sentinel', 'university', 'symphony'],
            description: 'Section to navigate to',
          },
          symbol: {
            type: 'string',
            description: 'Symbol to select (e.g., "#payment-service")',
          },
          loreId: {
            type: 'string',
            description: 'Lore entry ID to open in lore section',
          },
        },
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_platform_highlight',
      description:
        'Temporarily highlight symbols in the Platform UI with a pulsing glow. Auto-expires after duration. Use to draw attention to specific components during explanations. ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          symbols: {
            type: 'array',
            items: { type: 'string' },
            description: 'Symbol IDs to highlight (e.g., ["#payment-service", "#api-gateway"])',
          },
          color: {
            type: 'string',
            description: 'Highlight color (CSS color, defaults to agent color)',
          },
          duration: {
            type: 'number',
            description: 'Duration in milliseconds (default: 5000)',
          },
          pulse: {
            type: 'boolean',
            description: 'Whether to pulse the highlight (default: true)',
          },
          label: {
            type: 'string',
            description: 'Optional label shown near highlighted symbols',
          },
        },
        required: ['symbols'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_platform_annotate',
      description:
        'Show a toast notification, callout on a graph node, or badge in the Platform UI. Use for communicating decisions, warnings, or context to the user visually. ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['toast', 'callout', 'badge'],
            description: 'Annotation type: toast (notification), callout (floating note on graph node), badge (icon on symbol)',
          },
          message: {
            type: 'string',
            description: 'Annotation message text',
          },
          symbol: {
            type: 'string',
            description: 'Symbol to attach callout/badge to (required for callout/badge)',
          },
          severity: {
            type: 'string',
            enum: ['info', 'warning', 'error', 'success'],
            description: 'Visual severity (default: info)',
          },
          duration: {
            type: 'number',
            description: 'Auto-dismiss duration in milliseconds (default: 6000, 0 = persistent)',
          },
        },
        required: ['type', 'message'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_platform_observe',
      description:
        'Read the current Platform UI state: what section the user is viewing, what symbol is selected, theme, connected agents, and active highlights/annotations. ~150 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          detail: {
            type: 'string',
            enum: ['summary', 'full'],
            description: 'Level of detail (default: summary)',
          },
        },
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_platform_clear',
      description:
        'Remove agent highlights, annotations, or all agent effects from the Platform UI. ~50 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            enum: ['highlights', 'annotations', 'all'],
            description: 'What to clear (default: all)',
          },
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
 * Handle platform tool calls
 */
export async function handlePlatformTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ProjectContext,
): Promise<{ handled: boolean; text: string }> {
  switch (name) {
    case 'paradigm_platform_navigate': {
      const result = await sendAgentCommand(ctx.projectDir, 'navigate', {
        section: args.section,
        symbol: args.symbol,
        loreId: args.loreId,
      });

      if (!result.ok) {
        return { handled: true, text: `**Navigate failed:** ${result.error}` };
      }

      const d = result.data!;
      if (d.navigated) {
        const parts: string[] = [];
        if (d.section) parts.push(`section: **${d.section}**`);
        if (d.symbol) parts.push(`symbol: **${d.symbol}**`);
        const activeNote = d.userActive ? ' (user was active — shown as prompt)' : '';
        return { handled: true, text: `Navigated to ${parts.join(', ')}${activeNote}` };
      }
      return { handled: true, text: `Navigation skipped: ${d.reason}` };
    }

    case 'paradigm_platform_highlight': {
      const result = await sendAgentCommand(ctx.projectDir, 'highlight', {
        symbols: args.symbols,
        color: args.color,
        duration: args.duration,
        pulse: args.pulse,
        label: args.label,
      });

      if (!result.ok) {
        return { handled: true, text: `**Highlight failed:** ${result.error}` };
      }

      const d = result.data!;
      if (d.highlighted) {
        return { handled: true, text: `Highlighted **${d.count}** symbol(s)${args.label ? ` with label "${args.label}"` : ''}` };
      }
      return { handled: true, text: `Highlight skipped: ${d.reason}` };
    }

    case 'paradigm_platform_annotate': {
      const result = await sendAgentCommand(ctx.projectDir, 'annotate', {
        type: args.type,
        message: args.message,
        symbol: args.symbol,
        severity: args.severity,
        duration: args.duration,
      });

      if (!result.ok) {
        return { handled: true, text: `**Annotate failed:** ${result.error}` };
      }

      const d = result.data!;
      if (d.annotated) {
        return { handled: true, text: `Created ${args.type} annotation: "${args.message}"` };
      }
      return { handled: true, text: `Annotation skipped: ${d.reason}` };
    }

    case 'paradigm_platform_observe': {
      const result = await sendAgentCommand(ctx.projectDir, 'observe', {
        detail: args.detail,
      });

      if (!result.ok) {
        return { handled: true, text: `**Observe failed:** ${result.error}` };
      }

      const d = result.data!;
      const state = d.state as Record<string, unknown>;
      const lines: string[] = ['## Platform UI State\n'];

      lines.push(`- **Connected:** ${d.connected ? 'Yes' : 'No'} (${d.users} browser client(s))`);
      lines.push(`- **Section:** ${state.section}`);
      lines.push(`- **Selected symbol:** ${state.selectedSymbol || 'none'}`);
      lines.push(`- **Theme:** ${state.theme}`);
      lines.push(`- **Muted:** ${state.muted ? 'Yes — agent actions silently discarded' : 'No'}`);

      const agents = d.agents as Array<Record<string, unknown>>;
      if (agents?.length) {
        lines.push(`\n### Connected Agents (${agents.length})`);
        for (const a of agents) {
          lines.push(`- \`${a.agentId}\` (since ${a.connectedAt})`);
        }
      }

      if (args.detail === 'full') {
        const highlights = d.highlights as unknown[];
        const annotations = d.annotations as unknown[];
        if (highlights?.length) {
          lines.push(`\n### Active Highlights: ${highlights.length}`);
        }
        if (annotations?.length) {
          lines.push(`\n### Active Annotations: ${annotations.length}`);
        }
      }

      return { handled: true, text: lines.join('\n') };
    }

    case 'paradigm_platform_clear': {
      const result = await sendAgentCommand(ctx.projectDir, 'clear', {
        target: args.target,
      });

      if (!result.ok) {
        return { handled: true, text: `**Clear failed:** ${result.error}` };
      }

      const d = result.data!;
      return { handled: true, text: `Cleared ${d.target} agent effects` };
    }

    default:
      return { handled: false, text: '' };
  }
}
