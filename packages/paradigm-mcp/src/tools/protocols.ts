/**
 * Protocol MCP Tools - Repeatable implementation patterns with exact references
 *
 * Tools:
 * - paradigm_protocol_search: Fuzzy search for protocols matching a task
 * - paradigm_protocol_get: Get a specific protocol by ID
 * - paradigm_protocol_record: Record a new protocol after completing repeatable work
 * - paradigm_protocol_update: Update an existing protocol (refresh, fix steps)
 * - paradigm_protocol_validate: Validate protocol references and freshness
 */

import type { ProjectContext } from '../utils/index-loader.js';
import {
  searchProtocols,
  loadProtocol,
  recordProtocol,
  updateProtocol,
  validateProtocol,
  loadProtocols,
  type Protocol,
  type ProtocolStep,
} from '../utils/protocol-loader.js';

/**
 * Get list of protocol tools with safety annotations
 */
export function getProtocolsToolsList() {
  return [
    {
      name: 'paradigm_protocol_search',
      description:
        'Search for protocols matching a task description. Call BEFORE exploring the codebase — if a matching protocol exists, follow its steps instead of discovering the pattern from scratch. Returns top matches with steps, exemplar, and freshness info. ~200 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: 'Task description to search for (e.g., "add a new page", "add API route")',
          },
          limit: {
            type: 'number',
            description: 'Maximum results (default: 3)',
          },
        },
        required: ['task'],
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_protocol_get',
      description:
        'Get a specific protocol by ID with full details and freshness check. ~300 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Protocol ID (e.g., "P-add-view")',
          },
        },
        required: ['id'],
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_protocol_record',
      description:
        'Record a new protocol after completing repeatable work. Captures the steps you followed so future agents can skip exploration. ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Protocol name (e.g., "Add a new view")',
          },
          description: {
            type: 'string',
            description: 'What this protocol accomplishes',
          },
          trigger: {
            type: 'array',
            items: { type: 'string' },
            description: 'Phrases that should match this protocol (e.g., ["add view", "new page"])',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Classification tags (e.g., ["ui", "frontend"])',
          },
          symbols: {
            type: 'array',
            items: { type: 'string' },
            description: 'Paradigm symbols involved (e.g., ["#logs-view"])',
          },
          exemplar: {
            type: 'string',
            description: 'Canonical file to study for this pattern (e.g., "ui/src/views/LogsView.tsx")',
          },
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                action: {
                  type: 'string',
                  enum: ['create', 'modify', 'run', 'verify'],
                  description: 'Step action type',
                },
                target: {
                  type: 'string',
                  description: 'File path (supports {Name}/{name} placeholders)',
                },
                template_from: {
                  type: 'string',
                  description: 'File to use as template (for create actions)',
                },
                reference: {
                  type: 'string',
                  description: 'Where in the file to make changes (for modify actions)',
                },
                command: {
                  type: 'string',
                  description: 'Command to execute (for run actions)',
                },
                notes: {
                  type: 'string',
                  description: 'Additional guidance for this step',
                },
              },
              required: ['action'],
            },
            description: 'Ordered steps to follow',
          },
          recorded_from: {
            type: 'string',
            description: 'Lore entry ID this protocol was learned from (e.g., "L-2026-03-01-001")',
          },
        },
        required: ['name', 'description', 'trigger', 'tags', 'steps'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_protocol_update',
      description:
        'Update an existing protocol. Use refresh:true after successfully following a protocol to bump last_verified. ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Protocol ID to update (e.g., "P-add-view")',
          },
          refresh: {
            type: 'boolean',
            description: 'Set true to bump last_verified to now (use after successfully following the protocol)',
          },
          name: { type: 'string', description: 'Updated name' },
          description: { type: 'string', description: 'Updated description' },
          trigger: {
            type: 'array',
            items: { type: 'string' },
            description: 'Updated trigger phrases',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Updated tags',
          },
          symbols: {
            type: 'array',
            items: { type: 'string' },
            description: 'Updated symbols',
          },
          exemplar: { type: 'string', description: 'Updated exemplar path' },
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                action: { type: 'string', enum: ['create', 'modify', 'run', 'verify'] },
                target: { type: 'string' },
                template_from: { type: 'string' },
                reference: { type: 'string' },
                command: { type: 'string' },
                notes: { type: 'string' },
              },
              required: ['action'],
            },
            description: 'Updated steps',
          },
        },
        required: ['id'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_protocol_validate',
      description:
        'Validate protocol references — check that referenced files exist, exemplars haven\'t drifted. Validates all protocols if no ID given. ~200 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Protocol ID to validate (omit to validate all)',
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
 * Handle protocol tool calls
 */
export async function handleProtocolsTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ProjectContext,
): Promise<{ text: string; handled: boolean }> {
  switch (name) {
    case 'paradigm_protocol_search': {
      const task = args.task as string;
      const limit = (args.limit as number) || 3;

      const results = await searchProtocols(ctx.rootDir, task, limit);

      if (results.length === 0) {
        return {
          handled: true,
          text: JSON.stringify({
            count: 0,
            task,
            message: 'No matching protocol found. Consider recording one after completing this task.',
          }),
        };
      }

      return {
        handled: true,
        text: JSON.stringify({
          count: results.length,
          task,
          matches: results.map(r => ({
            id: r.protocol.id,
            name: r.protocol.name,
            description: r.protocol.description,
            score: r.score,
            status: r.protocol.status,
            exemplar: r.protocol.exemplar,
            last_verified: r.protocol.last_verified,
            steps: r.protocol.steps.map(summarizeStep),
          })),
        }, null, 2),
      };
    }

    case 'paradigm_protocol_get': {
      const id = args.id as string;
      const protocol = await loadProtocol(ctx.rootDir, id);

      if (!protocol) {
        return {
          handled: true,
          text: JSON.stringify({ error: `Protocol not found: ${id}` }),
        };
      }

      // Run freshness check
      const validation = validateProtocol(ctx.rootDir, protocol);

      return {
        handled: true,
        text: JSON.stringify({
          ...protocol,
          freshness: {
            status: validation.status,
            issues: validation.issues,
          },
        }, null, 2),
      };
    }

    case 'paradigm_protocol_record': {
      const steps = (args.steps as ProtocolStep[]) || [];

      const id = await recordProtocol(ctx.rootDir, {
        name: args.name as string,
        description: args.description as string,
        trigger: (args.trigger as string[]) || [],
        tags: (args.tags as string[]) || [],
        symbols: (args.symbols as string[]) || [],
        exemplar: args.exemplar as string | undefined,
        steps,
        recorded_from: args.recorded_from as string | undefined,
        verified_by: 'claude-opus-4-6',
      });

      return {
        handled: true,
        text: JSON.stringify({
          success: true,
          id,
          name: args.name,
          message: 'Protocol recorded successfully',
        }),
      };
    }

    case 'paradigm_protocol_update': {
      const id = args.id as string;
      const refresh = args.refresh as boolean | undefined;

      const partial: Partial<Omit<Protocol, 'id'>> = {};
      if (args.name !== undefined) partial.name = args.name as string;
      if (args.description !== undefined) partial.description = args.description as string;
      if (args.trigger !== undefined) partial.trigger = args.trigger as string[];
      if (args.tags !== undefined) partial.tags = args.tags as string[];
      if (args.symbols !== undefined) partial.symbols = args.symbols as string[];
      if (args.exemplar !== undefined) partial.exemplar = args.exemplar as string;
      if (args.steps !== undefined) partial.steps = args.steps as ProtocolStep[];

      const success = await updateProtocol(ctx.rootDir, id, partial, refresh === true);

      return {
        handled: true,
        text: JSON.stringify({
          success,
          id,
          refreshed: refresh === true,
          message: success
            ? (refresh ? 'Protocol updated and verified' : 'Protocol updated')
            : `Protocol not found: ${id}`,
        }),
      };
    }

    case 'paradigm_protocol_validate': {
      const id = args.id as string | undefined;

      if (id) {
        const protocol = await loadProtocol(ctx.rootDir, id);
        if (!protocol) {
          return {
            handled: true,
            text: JSON.stringify({ error: `Protocol not found: ${id}` }),
          };
        }

        const result = validateProtocol(ctx.rootDir, protocol);
        return {
          handled: true,
          text: JSON.stringify({
            id: protocol.id,
            name: protocol.name,
            status: result.status,
            issues: result.issues,
            last_verified: protocol.last_verified,
          }, null, 2),
        };
      }

      // Validate all
      const protocols = await loadProtocols(ctx.rootDir);
      const results = protocols.map(p => {
        const v = validateProtocol(ctx.rootDir, p);
        return {
          id: p.id,
          name: p.name,
          status: v.status,
          issues: v.issues,
          last_verified: p.last_verified,
        };
      });

      const health = {
        total: results.length,
        current: results.filter(r => r.status === 'current').length,
        stale: results.filter(r => r.status === 'stale').length,
        broken: results.filter(r => r.status === 'broken').length,
      };

      return {
        handled: true,
        text: JSON.stringify({ protocols: results, health }, null, 2),
      };
    }

    default:
      return { handled: false, text: '' };
  }
}

/**
 * Summarize a step for compact output
 */
function summarizeStep(step: ProtocolStep) {
  const result: Record<string, string | undefined> = {
    action: step.action,
  };
  if (step.target) result.target = step.target;
  if (step.template_from) result.template_from = step.template_from;
  if (step.reference) result.reference = step.reference;
  if (step.command) result.command = step.command;
  if (step.notes) result.notes = step.notes;
  return result;
}
