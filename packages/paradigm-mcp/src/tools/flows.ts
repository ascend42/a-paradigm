/**
 * Flow Tools - MCP tools for querying testable flows
 *
 * Provides:
 * - paradigm_flows_affected: Find flows affected by symbol changes
 */

import type { ProjectContext } from '../utils/index-loader.js';
import {
  loadFlowIndex,
  getFlowImpactSummary,
} from '../utils/flow-loader.js';

/**
 * Tool result type
 */
export interface ToolResult {
  handled: boolean;
  text: string;
}

/**
 * Get the list of flow tools
 */
export function getFlowsToolsList() {
  return [
    {
      name: 'paradigm_flows_affected',
      description:
        'Find flows affected by changes to a symbol. Returns flows that include the symbol in their steps, with downstream impact analysis and validation commands.',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            description:
              'Symbol being modified (e.g., @tasks, ^project-member, !task-created)',
          },
          includeValidation: {
            type: 'boolean',
            description: 'Include validation commands in response (default: true)',
          },
        },
        required: ['symbol'],
      },
    },
  ];
}

/**
 * Handle flow tool calls
 */
export async function handleFlowTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ProjectContext
): Promise<ToolResult> {
  switch (name) {
    case 'paradigm_flows_affected': {
      const { symbol, includeValidation = true } = args as {
        symbol: string;
        includeValidation?: boolean;
      };

      // Load flow index
      const flowIndex = await loadFlowIndex(ctx.rootDir);

      if (!flowIndex) {
        const text = JSON.stringify(
          {
            error: 'Flow index not found',
            symbol,
            suggestion:
              'Run `paradigm scan` to generate the flow index. Ensure .purpose files contain flows definitions.',
            example: `
flows:
  $task-creation:
    description: "Full task creation flow"
    trigger: "POST /api/projects/:id/tasks"
    steps:
      - id: validate
        action: "Check project membership"
        symbol: "^project-member"
        expect: "403 if not member"
      - id: create
        action: "Create task record"
        symbol: "@tasks"
`,
          },
          null,
          2
        );
        return { handled: true, text };
      }

      // Get impact summary
      const impact = getFlowImpactSummary(flowIndex, symbol);

      // Build response
      const response: Record<string, unknown> = {
        symbol: impact.symbol,
        totalFlows: impact.totalFlows,
        impactLevel: impact.impactLevel,
        affectedFlows: impact.affectedFlows.map((flow) => {
          const result: Record<string, unknown> = {
            flowId: flow.flowId,
            definedIn: flow.definedIn,
            description: flow.description,
            stepAffected: flow.stepAffected,
            downstreamSteps: flow.downstreamSteps,
          };

          if (flow.trigger) {
            result.trigger = flow.trigger;
          }

          if (includeValidation && flow.validation) {
            result.validation = flow.validation;
          }

          return result;
        }),
        suggestion: impact.suggestion,
      };

      // Add validation commands if requested
      if (includeValidation && impact.validationCommands.length > 0) {
        response.validationCommands = impact.validationCommands;
      }

      const text = JSON.stringify(response, null, 2);
      return { handled: true, text };
    }

    default:
      return { handled: false, text: '' };
  }
}
