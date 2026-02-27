/**
 * Persona MCP Tools — paradigm_persona_*
 *
 * Phase 1: CRUD + Validation + Coverage
 * Phase 2: Ripple integration + affected analysis
 */

import type { ProjectContext } from '../utils/index-loader.js';
import {
  loadPersonas,
  loadPersona,
  createPersona,
  updatePersona,
  deletePersona,
  addStep,
  removeStep,
  validatePersona,
  getPersonaCoverage,
  getAffectedPersonas,
} from '../utils/personas-loader.js';

// ── Tool definitions ─────────────────────────────────────

export function getPersonaToolsList() {
  return [
    {
      name: 'paradigm_persona_create',
      description: 'Create a persona — named test actor with traits, trigger, fixtures, and journey steps. Writes a .persona file. ~150 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Persona ID (kebab-case, e.g., "alice-admin")' },
          name: { type: 'string', description: 'Human-readable name (e.g., "Agency Owner (Annual Billing)")' },
          description: { type: 'string', description: 'What this persona represents' },
          traits: { type: 'object', description: 'Key-value actor attributes (tier, billing, role, etc.)' },
          trigger: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['root', 'invitation', 'signup', 'api'], description: 'How this persona enters the system' },
              spawned_by: { type: 'string', description: 'persona-id.step-id (required if type != root)' },
              context: { type: 'object', description: 'Data passed from parent spawn' },
            },
            required: ['type'],
          },
          fixtures: { type: 'object', description: 'Test data for this persona (email, password, API keys, etc.)' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags for filtering' },
          journey: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Step ID (kebab-case)' },
                description: { type: 'string' },
                route: { type: 'string', description: 'METHOD /path (e.g., "POST /api/auth/signup")' },
                flow: { type: 'string', description: '$flow reference' },
                gates: { type: 'array', items: { type: 'string' }, description: '^gate references' },
                headers: { type: 'object' },
                payload: { type: 'object', description: 'Request body. Supports {{produces.X}} and {{fixtures.X}} interpolation.' },
                expect: {
                  type: 'object',
                  properties: {
                    status: { type: 'number' },
                    body: {
                      type: 'object',
                      properties: {
                        has: { type: 'array', items: { type: 'string' } },
                        match: { type: 'object' },
                      },
                    },
                  },
                  required: ['status'],
                },
                produces: { type: 'object', description: 'Values to extract from response for later steps' },
                spawns: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      persona: { type: 'string' },
                      via: { type: 'string' },
                      context: { type: 'object' },
                    },
                    required: ['persona', 'via'],
                  },
                },
                signals: { type: 'array', items: { type: 'string' }, description: '!signal references expected to fire' },
              },
              required: ['id', 'route', 'gates', 'expect'],
            },
          },
        },
        required: ['id', 'name', 'trigger'],
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: 'paradigm_persona_get',
      description: 'Get full persona detail — journey, traits, spawn chain, validation status. ~300 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Persona ID' },
        },
        required: ['id'],
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: 'paradigm_persona_list',
      description: 'List personas with optional filters — tag, trigger type, gate, flow. ~200 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          tag: { type: 'string', description: 'Filter by tag' },
          trigger_type: { type: 'string', enum: ['root', 'invitation', 'signup', 'api'], description: 'Filter by trigger type' },
          gate: { type: 'string', description: 'Filter by gate (show personas that traverse this gate)' },
          flow: { type: 'string', description: 'Filter by flow (show personas that exercise this flow)' },
          limit: { type: 'number', description: 'Maximum results (default: 50)' },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: 'paradigm_persona_update',
      description: 'Update persona fields — traits, fixtures, journey steps, tags. ~150 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Persona ID' },
          name: { type: 'string' },
          description: { type: 'string' },
          traits: { type: 'object' },
          trigger: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['root', 'invitation', 'signup', 'api'] },
              spawned_by: { type: 'string' },
              context: { type: 'object' },
            },
          },
          fixtures: { type: 'object' },
          tags: { type: 'array', items: { type: 'string' } },
          journey: { type: 'array', description: 'Replace entire journey. Use paradigm_persona_add_step for surgical edits.' },
        },
        required: ['id'],
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: 'paradigm_persona_delete',
      description: 'Delete a persona. Warns if other personas spawn from it. ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Persona ID' },
        },
        required: ['id'],
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    {
      name: 'paradigm_persona_add_step',
      description: 'Add a journey step to a persona. Validates gates, route format, and produce/consume chains. ~150 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          persona_id: { type: 'string', description: 'Persona ID' },
          step: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Step ID (kebab-case, unique within persona)' },
              description: { type: 'string' },
              route: { type: 'string', description: 'METHOD /path' },
              flow: { type: 'string', description: '$flow reference' },
              gates: { type: 'array', items: { type: 'string' }, description: '^gate references' },
              headers: { type: 'object' },
              payload: { type: 'object' },
              expect: {
                type: 'object',
                properties: {
                  status: { type: 'number' },
                  body: { type: 'object' },
                },
                required: ['status'],
              },
              produces: { type: 'object' },
              spawns: { type: 'array' },
              signals: { type: 'array', items: { type: 'string' } },
            },
            required: ['id', 'route', 'gates', 'expect'],
          },
          after: { type: 'string', description: 'Insert after this step ID. Omit to append.' },
        },
        required: ['persona_id', 'step'],
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: 'paradigm_persona_remove_step',
      description: 'Remove a journey step. Warns if it produces data consumed by later steps or spawns other personas. ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          persona_id: { type: 'string', description: 'Persona ID' },
          step_id: { type: 'string', description: 'Step ID to remove' },
        },
        required: ['persona_id', 'step_id'],
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    {
      name: 'paradigm_persona_validate',
      description: 'Full persona validation — schema, cross-refs (gates in portal.yaml, flows defined, routes match), coverage gaps. ~300 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          persona_id: { type: 'string', description: 'Validate one persona. Omit for all.' },
          deep: { type: 'boolean', description: 'Include cross-reference and coverage analysis (default: false)' },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: 'paradigm_persona_coverage',
      description: 'Coverage report — which routes/gates/flows have persona coverage, which don\'t. Compares against portal.yaml. ~250 tokens.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: 'paradigm_persona_affected',
      description: 'Given a symbol (^gate, $flow, route), return affected personas and their steps. Used by ripple. ~200 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Symbol to check (e.g., "^authenticated", "$checkout-flow", "POST /api/orders")' },
        },
        required: ['symbol'],
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
  ];
}

// ── Handler ──────────────────────────────────────────────

export async function handlePersonaTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ProjectContext,
): Promise<{ text: string; handled: boolean }> {
  switch (name) {
    case 'paradigm_persona_create': {
      try {
        const id = await createPersona(ctx.rootDir, {
          id: args.id as string,
          name: args.name as string,
          description: args.description as string | undefined,
          traits: args.traits as Record<string, unknown> | undefined,
          trigger: args.trigger as { type: 'root' | 'invitation' | 'signup' | 'api'; spawned_by?: string; context?: Record<string, string> },
          fixtures: args.fixtures as Record<string, string> | undefined,
          tags: args.tags as string[] | undefined,
          journey: args.journey as import('../types/personas.js').PersonaStep[] | undefined,
        });

        const persona = await loadPersona(ctx.rootDir, id);
        return {
          handled: true,
          text: JSON.stringify({ created: id, persona }, null, 2),
        };
      } catch (err: unknown) {
        return {
          handled: true,
          text: JSON.stringify({ error: (err as Error).message }),
        };
      }
    }

    case 'paradigm_persona_get': {
      const id = args.id as string;
      const persona = await loadPersona(ctx.rootDir, id);
      if (!persona) {
        return { handled: true, text: JSON.stringify({ error: `Persona ${id} not found` }) };
      }

      // Include quick validation
      const validation = await validatePersona(ctx.rootDir, persona);
      return {
        handled: true,
        text: JSON.stringify({ persona, validation }, null, 2),
      };
    }

    case 'paradigm_persona_list': {
      const personas = await loadPersonas(ctx.rootDir, {
        tag: args.tag as string | undefined,
        trigger_type: args.trigger_type as 'root' | 'invitation' | 'signup' | 'api' | undefined,
        gate: args.gate as string | undefined,
        flow: args.flow as string | undefined,
        limit: (args.limit as number) || 50,
      });

      const summary = personas.map(p => ({
        id: p.id,
        name: p.name,
        trigger: p.trigger.type,
        steps: p.journey.length,
        gates: [...new Set(p.journey.flatMap(s => s.gates))],
        tags: p.tags || [],
      }));

      return {
        handled: true,
        text: JSON.stringify({ count: personas.length, personas: summary }, null, 2),
      };
    }

    case 'paradigm_persona_update': {
      const id = args.id as string;
      const partial: Record<string, unknown> = {};
      if (args.name !== undefined) partial.name = args.name;
      if (args.description !== undefined) partial.description = args.description;
      if (args.traits !== undefined) partial.traits = args.traits;
      if (args.trigger !== undefined) partial.trigger = args.trigger;
      if (args.fixtures !== undefined) partial.fixtures = args.fixtures;
      if (args.tags !== undefined) partial.tags = args.tags;
      if (args.journey !== undefined) partial.journey = args.journey;

      const ok = await updatePersona(ctx.rootDir, id, partial as Parameters<typeof updatePersona>[2]);
      if (!ok) {
        return { handled: true, text: JSON.stringify({ error: `Persona ${id} not found` }) };
      }

      const updated = await loadPersona(ctx.rootDir, id);
      return { handled: true, text: JSON.stringify({ updated: id, persona: updated }, null, 2) };
    }

    case 'paradigm_persona_delete': {
      const id = args.id as string;
      const result = await deletePersona(ctx.rootDir, id);
      if (!result.deleted) {
        return { handled: true, text: JSON.stringify({ error: `Persona ${id} not found` }) };
      }

      return {
        handled: true,
        text: JSON.stringify({
          deleted: id,
          warnings: result.warnings,
          hint: result.warnings.length > 0
            ? 'Other personas reference this one. Update or delete them to avoid broken spawn chains.'
            : undefined,
        }, null, 2),
      };
    }

    case 'paradigm_persona_add_step': {
      try {
        const ok = await addStep(
          ctx.rootDir,
          args.persona_id as string,
          args.step as import('../types/personas.js').PersonaStep,
          args.after as string | undefined,
        );

        if (!ok) {
          return { handled: true, text: JSON.stringify({ error: `Persona ${args.persona_id} not found` }) };
        }

        const persona = await loadPersona(ctx.rootDir, args.persona_id as string);
        return {
          handled: true,
          text: JSON.stringify({ added: (args.step as { id: string }).id, persona_id: args.persona_id, total_steps: persona?.journey.length }, null, 2),
        };
      } catch (err: unknown) {
        return {
          handled: true,
          text: JSON.stringify({ error: (err as Error).message }),
        };
      }
    }

    case 'paradigm_persona_remove_step': {
      const result = await removeStep(
        ctx.rootDir,
        args.persona_id as string,
        args.step_id as string,
      );

      if (!result.removed) {
        return { handled: true, text: JSON.stringify({ error: `Step ${args.step_id} not found in persona ${args.persona_id}` }) };
      }

      return {
        handled: true,
        text: JSON.stringify({
          removed: args.step_id,
          persona_id: args.persona_id,
          warnings: result.warnings,
        }, null, 2),
      };
    }

    case 'paradigm_persona_validate': {
      const deep = (args.deep as boolean) ?? false;

      if (args.persona_id) {
        const persona = await loadPersona(ctx.rootDir, args.persona_id as string);
        if (!persona) {
          return { handled: true, text: JSON.stringify({ error: `Persona ${args.persona_id} not found` }) };
        }

        const result = await validatePersona(ctx.rootDir, persona, deep);
        return { handled: true, text: JSON.stringify(result, null, 2) };
      }

      // Validate all
      const personas = await loadPersonas(ctx.rootDir);
      const results = await Promise.all(
        personas.map(p => validatePersona(ctx.rootDir, p, deep))
      );

      const valid = results.filter(r => r.valid).length;
      const invalid = results.filter(r => !r.valid).length;

      return {
        handled: true,
        text: JSON.stringify({
          total: results.length,
          valid,
          invalid,
          results: results.filter(r => !r.valid || r.warnings.length > 0),
        }, null, 2),
      };
    }

    case 'paradigm_persona_coverage': {
      const coverage = await getPersonaCoverage(ctx.rootDir);
      return { handled: true, text: JSON.stringify(coverage, null, 2) };
    }

    case 'paradigm_persona_affected': {
      const symbol = args.symbol as string;
      const affected = await getAffectedPersonas(ctx.rootDir, symbol);

      if (affected.length === 0) {
        return {
          handled: true,
          text: JSON.stringify({ symbol, affected: [], note: 'No personas reference this symbol.' }),
        };
      }

      return {
        handled: true,
        text: JSON.stringify({ symbol, affected }, null, 2),
      };
    }

    default:
      return { handled: false, text: '' };
  }
}
