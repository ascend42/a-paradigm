/**
 * Persona MCP Tools — paradigm_persona_*
 *
 * Phase 1: CRUD + Validation + Coverage
 * Phase 2: Ripple integration + affected analysis
 * Phase 3: Execution engine (run journeys + chains)
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
import {
  runPersona,
  runChain,
  validateInterpolation,
  type RunResult,
  type ChainRunResult,
} from '../utils/personas-runner.js';

// ── Sentinel integration ─────────────────────────────────

const PERSONA_SCHEMA_ID = 'paradigm-personas';

const PERSONA_SCHEMA = {
  id: PERSONA_SCHEMA_ID,
  version: '1.0',
  name: 'Paradigm Personas',
  description: 'Events from persona journey and chain execution',
  scope: { key: 'persona_id', label: 'Persona' },
  eventTypes: {
    'persona.run.start': { category: 'lifecycle', severity: 'info' },
    'persona.step.pass': { category: 'assertion', severity: 'info' },
    'persona.step.fail': { category: 'assertion', severity: 'warning' },
    'persona.step.skip': { category: 'lifecycle', severity: 'info' },
    'persona.run.complete': { category: 'lifecycle', severity: 'info' },
    'persona.chain.complete': { category: 'lifecycle', severity: 'info' },
    'persona.coverage.report': { category: 'analysis', severity: 'info' },
  },
};

let sentinelSchemaRegistered = false;

async function emitPersonaEvents(result: RunResult | ChainRunResult): Promise<void> {
  try {
    const { SentinelStorage } = await import('@a-company/sentinel');
    const storage = new SentinelStorage();

    // Register schema once
    if (!sentinelSchemaRegistered) {
      try {
        storage.registerSchema(PERSONA_SCHEMA as Parameters<typeof storage.registerSchema>[0]);
        sentinelSchemaRegistered = true;
      } catch {
        // Schema may already exist
        sentinelSchemaRegistered = true;
      }
    }

    const events: Array<{
      type: string;
      timestamp: string;
      scopeValue?: string;
      data: Record<string, unknown>;
    }> = [];

    if ('persona' in result) {
      // Single persona result
      const r = result as RunResult;
      events.push({
        type: 'persona.run.start',
        timestamp: new Date().toISOString(),
        scopeValue: r.persona,
        data: { persona_id: r.persona, total_steps: r.steps.length },
      });

      for (const step of r.steps) {
        events.push({
          type: `persona.step.${step.status}`,
          timestamp: new Date().toISOString(),
          scopeValue: r.persona,
          data: {
            persona_id: r.persona,
            step_id: step.id,
            route: step.route,
            gates: step.gates,
            status: step.response?.status,
            duration_ms: step.duration_ms,
            failure: step.failure,
            gate_that_blocked: step.gate_that_blocked,
          },
        });
      }

      events.push({
        type: 'persona.run.complete',
        timestamp: new Date().toISOString(),
        scopeValue: r.persona,
        data: {
          persona_id: r.persona,
          status: r.status,
          total_steps: r.steps.length,
          passed: r.steps.filter(s => s.status === 'pass').length,
          failed: r.steps.filter(s => s.status === 'fail').length,
          skipped: r.steps.filter(s => s.status === 'skip').length,
          duration_ms: r.duration_ms,
          spawns_triggered: r.spawns_triggered,
          spawns_blocked: r.spawns_blocked,
        },
      });
    } else {
      // Chain result
      const r = result as ChainRunResult;
      for (const pr of r.persona_results) {
        events.push({
          type: 'persona.run.complete',
          timestamp: new Date().toISOString(),
          scopeValue: pr.persona,
          data: {
            persona_id: pr.persona,
            chain_id: r.chain_id,
            status: pr.status,
            total_steps: pr.steps.length,
            passed: pr.steps.filter(s => s.status === 'pass').length,
            failed: pr.steps.filter(s => s.status === 'fail').length,
            duration_ms: pr.duration_ms,
          },
        });
      }

      events.push({
        type: 'persona.chain.complete',
        timestamp: new Date().toISOString(),
        data: {
          chain_id: r.chain_id,
          status: r.status,
          personas_run: r.persona_results.length,
          personas_passed: r.persona_results.filter(p => p.status === 'pass').length,
          duration_ms: r.duration_ms,
        },
      });
    }

    if (events.length > 0) {
      storage.insertEventBatch(PERSONA_SCHEMA_ID, 'paradigm-personas', events);
    }
  } catch {
    // Sentinel emission is non-fatal — silent fail
  }
}

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
    {
      name: 'paradigm_persona_run',
      description: 'Execute a persona journey or chain against a running server. Interpolates templates, sends requests step-by-step, validates responses. Supports dry-run mode. ~500 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          persona_id: { type: 'string', description: 'Run a single persona journey' },
          chain_id: { type: 'string', description: 'Run a named chain (overrides persona_id)' },
          base_url: { type: 'string', description: 'Server base URL (e.g., "http://localhost:3000")' },
          dry_run: { type: 'boolean', description: 'Validate and interpolate without making requests (default: false)' },
          stop_on_failure: { type: 'boolean', description: 'Stop on first failing step (default: true)' },
          permutation: { type: 'string', description: 'Permutation ID from chain definition' },
        },
        required: ['base_url'],
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

    case 'paradigm_persona_run': {
      const baseUrl = args.base_url as string;
      const dryRun = (args.dry_run as boolean) ?? false;
      const stopOnFailure = (args.stop_on_failure as boolean) ?? true;

      if (args.chain_id) {
        // Chain execution
        const result = await runChain(ctx.rootDir, args.chain_id as string, {
          baseUrl,
          dryRun,
          stopOnFailure,
          permutation: args.permutation as string | undefined,
        });

        if (!dryRun) await emitPersonaEvents(result);
        return { handled: true, text: JSON.stringify(result, null, 2) };
      }

      if (args.persona_id) {
        // Single persona execution
        // Validate interpolation first
        const persona = await loadPersona(ctx.rootDir, args.persona_id as string);
        if (!persona) {
          return { handled: true, text: JSON.stringify({ error: `Persona ${args.persona_id} not found` }) };
        }

        const interpCheck = validateInterpolation(persona);
        if (!interpCheck.valid && !dryRun) {
          return {
            handled: true,
            text: JSON.stringify({
              error: 'Template interpolation errors — fix before running',
              errors: interpCheck.errors,
              hint: 'Use dry_run: true to see interpolated values without executing requests',
            }, null, 2),
          };
        }

        const result = await runPersona(ctx.rootDir, args.persona_id as string, {
          baseUrl,
          dryRun,
          stopOnFailure,
        });

        if (!dryRun) await emitPersonaEvents(result);
        return { handled: true, text: JSON.stringify(result, null, 2) };
      }

      return {
        handled: true,
        text: JSON.stringify({ error: 'Either persona_id or chain_id is required' }),
      };
    }

    default:
      return { handled: false, text: '' };
  }
}
