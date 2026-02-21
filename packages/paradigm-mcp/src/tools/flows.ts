/**
 * Flow Tools - MCP tools for querying and validating flows
 *
 * Provides:
 * - paradigm_flows_affected: Find flows affected by symbol changes
 * - paradigm_flow_validate: Validate flow definitions against codebase
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
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
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_flow_validate',
      description:
        'Validate flow definitions against the codebase. Checks that gates exist in portal.yaml, actions are implemented, and signals are emitted.',
      inputSchema: {
        type: 'object',
        properties: {
          flowId: {
            type: 'string',
            description: 'Specific flow ID to validate (e.g., $task-creation). If not provided, validates all flows.',
          },
          checkImplementation: {
            type: 'boolean',
            description: 'Deep check: verify actions and signals exist in codebase (default: false)',
          },
        },
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
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

    case 'paradigm_flow_validate': {
      const { flowId, checkImplementation = false } = args as {
        flowId?: string;
        checkImplementation?: boolean;
      };

      // Load flows from .paradigm/flows.yaml
      const flowsPath = path.join(ctx.rootDir, '.paradigm', 'flows.yaml');
      let flowsConfig: FlowsConfig | null = null;

      if (fs.existsSync(flowsPath)) {
        try {
          const content = fs.readFileSync(flowsPath, 'utf-8');
          flowsConfig = yaml.load(content) as FlowsConfig;
        } catch (e) {
          const text = JSON.stringify({
            error: 'Failed to parse flows.yaml',
            details: String(e),
          }, null, 2);
          return { handled: true, text };
        }
      }

      if (!flowsConfig || !flowsConfig.flows || Object.keys(flowsConfig.flows).length === 0) {
        const text = JSON.stringify({
          error: 'No flows found',
          suggestion: 'Create .paradigm/flows.yaml with flow definitions',
          example: `
version: "1.0"
flows:
  $task-creation:
    name: Task Creation Flow
    description: Complete flow for creating a new task
    trigger: "POST /api/tasks"
    steps:
      - type: gate
        symbol: ^authenticated
        description: User must be logged in
      - type: action
        symbol: @create-task
        description: Create task in database
      - type: signal
        symbol: "!task-created"
        description: Emit success event
    successSignal: "!task-created"
`,
        }, null, 2);
        return { handled: true, text };
      }

      // Load portal.yaml for gate validation
      const portalPath = path.join(ctx.rootDir, 'portal.yaml');
      let declaredGates: string[] = [];
      if (fs.existsSync(portalPath)) {
        try {
          const portalContent = fs.readFileSync(portalPath, 'utf-8');
          const portalConfig = yaml.load(portalContent) as { gates?: Record<string, unknown> };
          if (portalConfig?.gates) {
            declaredGates = Object.keys(portalConfig.gates).map(g =>
              g.startsWith('^') ? g.slice(1) : g
            );
          }
        } catch {
          // Ignore portal parse errors
        }
      }

      const declaredGatesSet = new Set(declaredGates);

      // Validate flows
      const results: FlowValidationResult[] = [];
      const flowsToValidate = flowId
        ? [[flowId, flowsConfig.flows[flowId]]]
        : Object.entries(flowsConfig.flows);

      for (const [id, flow] of flowsToValidate as Array<[string, FlowDefinitionSimple]>) {
        if (!flow) {
          if (flowId) {
            const text = JSON.stringify({
              error: `Flow not found: ${flowId}`,
              availableFlows: Object.keys(flowsConfig.flows),
            }, null, 2);
            return { handled: true, text };
          }
          continue;
        }

        const result: FlowValidationResult = {
          flowId: id,
          status: 'valid',
          coverage: {
            gatesReferenced: [],
            gatesMissing: [],
            actionsReferenced: [],
            actionsMissing: [],
            signalsEmitted: [],
            signalsMissing: [],
          },
          suggestions: [],
        };

        // Validate steps
        const steps = flow.steps || [];
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          const symbol = step.symbol || '';
          const parsed = parseSymbolSimple(symbol);

          if (!parsed) continue;

          switch (step.type) {
            case 'gate':
              result.coverage.gatesReferenced.push(symbol);
              if (!declaredGatesSet.has(parsed.name)) {
                result.coverage.gatesMissing.push(symbol);
                result.status = 'invalid';
              }
              break;
            case 'action':
              result.coverage.actionsReferenced.push(symbol);
              break;
            case 'signal':
              result.coverage.signalsEmitted.push(symbol);
              break;
          }
        }

        // Check success signal
        if (flow.successSignal) {
          result.coverage.signalsEmitted.push(flow.successSignal);
        }

        // Generate suggestions
        if (result.coverage.gatesMissing.length > 0) {
          result.suggestions.push(
            `Add missing gates to portal.yaml: ${result.coverage.gatesMissing.join(', ')}`
          );
        }

        if (result.status === 'valid' && result.coverage.gatesMissing.length === 0) {
          result.status = 'valid';
        }

        results.push(result);
      }

      // Build response
      const validCount = results.filter(r => r.status === 'valid').length;
      const invalidCount = results.filter(r => r.status === 'invalid').length;

      const response = {
        status: invalidCount > 0 ? 'invalid' : 'valid',
        totalFlows: results.length,
        validFlows: validCount,
        invalidFlows: invalidCount,
        results: results.map(r => ({
          flowId: r.flowId,
          status: r.status,
          gatesReferenced: r.coverage.gatesReferenced,
          gatesMissing: r.coverage.gatesMissing,
          actionsReferenced: r.coverage.actionsReferenced,
          signalsEmitted: r.coverage.signalsEmitted,
          suggestions: r.suggestions,
        })),
      };

      const text = JSON.stringify(response, null, 2);
      return { handled: true, text };
    }

    default:
      return { handled: false, text: '' };
  }
}

// ============================================================================
// Local Types and Helpers
// ============================================================================

interface FlowsConfig {
  version?: string;
  flows: Record<string, FlowDefinitionSimple>;
}

interface FlowDefinitionSimple {
  name?: string;
  description?: string;
  trigger?: string;
  steps?: Array<{
    type: 'gate' | 'action' | 'signal';
    symbol: string;
    description?: string;
  }>;
  successSignal?: string;
}

interface FlowValidationResult {
  flowId: string;
  status: 'valid' | 'warnings' | 'invalid';
  coverage: {
    gatesReferenced: string[];
    gatesMissing: string[];
    actionsReferenced: string[];
    actionsMissing: string[];
    signalsEmitted: string[];
    signalsMissing: string[];
  };
  suggestions: string[];
}

function parseSymbolSimple(symbol: string): { prefix: string; name: string } | null {
  const match = symbol.match(/^([@#$%^!?&~])(.+)$/);
  if (!match) return null;
  return { prefix: match[1], name: match[2] };
}
