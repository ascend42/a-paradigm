/**
 * Personas Loader — CRUD for .paradigm/personas/
 *
 * Storage layout:
 *   .paradigm/personas/
 *     index.yaml                 (auto-generated)
 *     alice-admin.persona        (one per persona)
 *     bob-member.persona
 *     chains/
 *       onboarding.yaml
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type {
  Persona,
  PersonaFilter,
  PersonaIndex,
  PersonaIndexEntry,
  PersonaStep,
  PersonaValidationError,
  PersonaValidationWarning,
  PersonaValidationResult,
  StepAssertion,
  StepAssertionResult,
  SentinelAssertionResult,
} from '../types/personas.js';

const PERSONAS_ROOT = '.paradigm/personas';
const INDEX_FILE = 'index.yaml';

// ── Read operations ──────────────────────────────────────

export async function loadPersonas(rootDir: string, filter?: PersonaFilter): Promise<Persona[]> {
  const personasDir = path.join(rootDir, PERSONAS_ROOT);
  if (!fs.existsSync(personasDir)) return [];

  const files = fs.readdirSync(personasDir).filter(f => f.endsWith('.persona'));
  const personas: Persona[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(personasDir, file), 'utf8');
      const persona = yaml.load(content) as Persona;
      if (persona && persona.id) {
        personas.push(persona);
      }
    } catch {
      // Skip malformed files
    }
  }

  return applyFilter(personas, filter);
}

export async function loadPersona(rootDir: string, id: string): Promise<Persona | null> {
  const filePath = path.join(rootDir, PERSONAS_ROOT, `${id}.persona`);
  if (!fs.existsSync(filePath)) return null;

  try {
    return yaml.load(fs.readFileSync(filePath, 'utf8')) as Persona;
  } catch {
    return null;
  }
}

function applyFilter(personas: Persona[], filter?: PersonaFilter): Persona[] {
  if (!filter) return personas;
  let result = personas;

  if (filter.tag) {
    result = result.filter(p => p.tags?.includes(filter.tag!));
  }
  if (filter.trigger_type) {
    result = result.filter(p => p.trigger.type === filter.trigger_type);
  }
  if (filter.gate) {
    result = result.filter(p =>
      p.journey.some(s => s.gates.includes(filter.gate!))
    );
  }
  if (filter.flow) {
    result = result.filter(p =>
      p.journey.some(s => s.flow === filter.flow)
    );
  }
  if (filter.limit) {
    result = result.slice(0, filter.limit);
  }

  return result;
}

// ── Write operations ─────────────────────────────────────

export async function createPersona(
  rootDir: string,
  data: {
    id: string;
    name: string;
    description?: string;
    traits?: Record<string, unknown>;
    trigger: Persona['trigger'];
    fixtures?: Record<string, string>;
    tags?: string[];
    journey?: PersonaStep[];
  },
): Promise<string> {
  const personasDir = path.join(rootDir, PERSONAS_ROOT);
  fs.mkdirSync(personasDir, { recursive: true });

  const filePath = path.join(personasDir, `${data.id}.persona`);
  if (fs.existsSync(filePath)) {
    throw new Error(`Persona ${data.id} already exists`);
  }

  const now = new Date().toISOString();
  const persona: Persona = {
    version: '1.0',
    id: data.id,
    name: data.name,
    description: data.description,
    traits: data.traits,
    trigger: data.trigger,
    fixtures: data.fixtures,
    tags: data.tags || [],
    journey: data.journey || [],
    created: now,
    updated: now,
  };

  fs.writeFileSync(filePath, yaml.dump(persona, { indent: 2, lineWidth: 120, noRefs: true, sortKeys: false }));
  await rebuildPersonaIndex(rootDir);
  return data.id;
}

export async function updatePersona(
  rootDir: string,
  id: string,
  partial: Partial<Omit<Persona, 'id' | 'version' | 'created'>>,
): Promise<boolean> {
  const persona = await loadPersona(rootDir, id);
  if (!persona) return false;

  const filePath = path.join(rootDir, PERSONAS_ROOT, `${id}.persona`);
  const updated: Persona = {
    ...persona,
    ...partial,
    id: persona.id,          // immutable
    version: persona.version, // immutable
    created: persona.created, // immutable
    updated: new Date().toISOString(),
  };

  fs.writeFileSync(filePath, yaml.dump(updated, { indent: 2, lineWidth: 120, noRefs: true, sortKeys: false }));
  await rebuildPersonaIndex(rootDir);
  return true;
}

export async function deletePersona(rootDir: string, id: string): Promise<{ deleted: boolean; warnings: string[] }> {
  const filePath = path.join(rootDir, PERSONAS_ROOT, `${id}.persona`);
  if (!fs.existsSync(filePath)) {
    return { deleted: false, warnings: [] };
  }

  // Check if other personas spawn from this one
  const warnings: string[] = [];
  const all = await loadPersonas(rootDir);
  for (const p of all) {
    if (p.id === id) continue;
    if (p.trigger.spawned_by?.startsWith(id + '.')) {
      warnings.push(`Persona ${p.id} is spawned by ${id} — it will become orphaned`);
    }
    for (const step of p.journey) {
      if (step.spawns?.some(s => s.persona === id)) {
        warnings.push(`Persona ${p.id} step ${step.id} spawns ${id} — spawn will break`);
      }
    }
  }

  fs.unlinkSync(filePath);
  await rebuildPersonaIndex(rootDir);
  return { deleted: true, warnings };
}

// ── Journey step operations ──────────────────────────────

export async function addStep(
  rootDir: string,
  personaId: string,
  step: PersonaStep,
  afterStepId?: string,
): Promise<boolean> {
  const persona = await loadPersona(rootDir, personaId);
  if (!persona) return false;

  // Check for duplicate step ID
  if (persona.journey.some(s => s.id === step.id)) {
    throw new Error(`Step ${step.id} already exists in persona ${personaId}`);
  }

  if (afterStepId) {
    const idx = persona.journey.findIndex(s => s.id === afterStepId);
    if (idx === -1) throw new Error(`Step ${afterStepId} not found in persona ${personaId}`);
    persona.journey.splice(idx + 1, 0, step);
  } else {
    persona.journey.push(step);
  }

  return updatePersona(rootDir, personaId, { journey: persona.journey });
}

export async function removeStep(
  rootDir: string,
  personaId: string,
  stepId: string,
): Promise<{ removed: boolean; warnings: string[] }> {
  const persona = await loadPersona(rootDir, personaId);
  if (!persona) return { removed: false, warnings: [] };

  const idx = persona.journey.findIndex(s => s.id === stepId);
  if (idx === -1) return { removed: false, warnings: [] };

  const step = persona.journey[idx];
  const warnings: string[] = [];

  // Check if produces are consumed by later steps
  if (step.produces) {
    for (const key of Object.keys(step.produces)) {
      const pattern = `{{produces.${key}}}`;
      for (let i = idx + 1; i < persona.journey.length; i++) {
        const later = persona.journey[i];
        const serialized = JSON.stringify(later);
        if (serialized.includes(pattern)) {
          warnings.push(`Step ${later.id} consumes {{produces.${key}}} from this step`);
        }
      }
    }
  }

  // Check if step spawns other personas
  if (step.spawns && step.spawns.length > 0) {
    for (const spawn of step.spawns) {
      warnings.push(`Step spawns persona ${spawn.persona} — spawn chain will break`);
    }
  }

  persona.journey.splice(idx, 1);
  await updatePersona(rootDir, personaId, { journey: persona.journey });
  return { removed: true, warnings };
}

// ── Validation ───────────────────────────────────────────

const PERSONA_ID_REGEX = /^[a-z][a-z0-9-]*$/;
const STEP_ID_REGEX = /^[a-z][a-z0-9-]*$/;
const ROUTE_REGEX = /^(GET|POST|PUT|PATCH|DELETE)\s+\//;

export async function validatePersona(
  rootDir: string,
  persona: Persona,
  deep: boolean = false,
): Promise<PersonaValidationResult> {
  const errors: PersonaValidationError[] = [];
  const warnings: PersonaValidationWarning[] = [];

  // ── Schema validation ──────────────────────────────────

  if (!PERSONA_ID_REGEX.test(persona.id)) {
    errors.push({ type: 'invalid-id', detail: `ID "${persona.id}" must match /^[a-z][a-z0-9-]*$/` });
  }

  if (!persona.name || persona.name.trim() === '') {
    errors.push({ type: 'missing-name', detail: 'Name is required' });
  }

  if (!persona.trigger || !persona.trigger.type) {
    errors.push({ type: 'missing-trigger', detail: 'Trigger with type is required' });
  }

  if (persona.trigger.type !== 'root' && !persona.trigger.spawned_by) {
    errors.push({ type: 'missing-spawned-by', detail: `Non-root trigger type "${persona.trigger.type}" requires spawned_by` });
  }

  if (!persona.journey || persona.journey.length === 0) {
    errors.push({ type: 'empty-journey', detail: 'Journey must have at least one step' });
  }

  // Step validation
  const stepIds = new Set<string>();
  const producedKeys = new Set<string>();

  for (const step of persona.journey) {
    if (!STEP_ID_REGEX.test(step.id)) {
      errors.push({ type: 'invalid-step-id', step: step.id, detail: `Step ID must match /^[a-z][a-z0-9-]*$/` });
    }
    if (stepIds.has(step.id)) {
      errors.push({ type: 'duplicate-step-id', step: step.id, detail: `Duplicate step ID "${step.id}"` });
    }
    stepIds.add(step.id);

    if (!ROUTE_REGEX.test(step.route)) {
      errors.push({ type: 'invalid-route', step: step.id, route: step.route, detail: `Route must match "METHOD /path" (e.g., "POST /api/auth/signup")` });
    }

    if (!step.gates || step.gates.length === 0) {
      errors.push({ type: 'missing-gates', step: step.id, detail: 'Step must have at least one gate' });
    }

    if (!step.expect || step.expect.status === undefined) {
      errors.push({ type: 'missing-expect', step: step.id, detail: 'Step must have expect with status' });
    }

    // Check that {{produces.X}} references are satisfied
    const serialized = JSON.stringify(step);
    const producesRefs = serialized.match(/\{\{produces\.([^}]+)\}\}/g) || [];
    for (const ref of producesRefs) {
      const key = ref.replace('{{produces.', '').replace('}}', '');
      if (!producedKeys.has(key)) {
        errors.push({ type: 'unresolved-produces', step: step.id, key, detail: `{{produces.${key}}} used but not produced by a prior step` });
      }
    }

    // Track produces for later steps
    if (step.produces) {
      for (const key of Object.keys(step.produces)) {
        producedKeys.add(key);
      }
    }
  }

  // ── Cross-reference validation (deep mode) ─────────────

  if (deep) {
    // Load portal.yaml for gate/route cross-ref
    const portalPath = path.join(rootDir, 'portal.yaml');
    let portalGates: string[] = [];
    let portalRoutes: string[] = [];

    if (fs.existsSync(portalPath)) {
      try {
        const portal = yaml.load(fs.readFileSync(portalPath, 'utf8')) as Record<string, unknown>;
        if (portal.gates && typeof portal.gates === 'object') {
          portalGates = Object.keys(portal.gates as object);
        }
        if (portal.routes && typeof portal.routes === 'object') {
          portalRoutes = Object.keys(portal.routes as object);
        }
      } catch { /* skip */ }
    }

    // Check gates exist in portal
    for (const step of persona.journey) {
      for (const gate of step.gates) {
        if (portalGates.length > 0 && !portalGates.includes(gate)) {
          errors.push({ type: 'gate-not-found', step: step.id, gate, detail: `Gate ${gate} not defined in portal.yaml` });
        }
      }
    }

    // Check routes exist in portal
    for (const step of persona.journey) {
      if (portalRoutes.length > 0) {
        const stepRoute = step.route;
        const matchesAny = portalRoutes.some(pr => routeMatches(pr, stepRoute));
        if (!matchesAny) {
          warnings.push({ type: 'route-not-in-portal', detail: `Route "${stepRoute}" (step ${step.id}) not found in portal.yaml` });
        }
      }
    }

    // Check spawn targets exist
    for (const step of persona.journey) {
      if (step.spawns) {
        for (const spawn of step.spawns) {
          const target = await loadPersona(rootDir, spawn.persona);
          if (!target) {
            errors.push({ type: 'spawn-target-missing', step: step.id, detail: `Spawn target persona "${spawn.persona}" does not exist` });
          }
        }
      }
    }

    // Check for circular spawn dependencies
    const spawnCycle = await detectSpawnCycle(rootDir, persona.id);
    if (spawnCycle) {
      errors.push({ type: 'spawn-cycle', detail: `Circular spawn dependency: ${spawnCycle.join(' → ')}` });
    }

    // Coverage analysis
    if (portalRoutes.length > 0 || portalGates.length > 0) {
      const allPersonas = await loadPersonas(rootDir);
      const allGatesUsed = new Set<string>();
      const allRoutesUsed = new Set<string>();

      for (const p of allPersonas) {
        for (const step of p.journey) {
          for (const gate of step.gates) allGatesUsed.add(gate);
          allRoutesUsed.add(step.route);
        }
      }

      // Load flows
      let allFlows: string[] = [];
      const flowIndexPath = path.join(rootDir, '.paradigm', 'flow-index.json');
      if (fs.existsSync(flowIndexPath)) {
        try {
          const flowIndex = JSON.parse(fs.readFileSync(flowIndexPath, 'utf8'));
          allFlows = Object.keys(flowIndex.flows || {});
        } catch { /* skip */ }
      }

      const allFlowsUsed = new Set<string>();
      for (const p of allPersonas) {
        for (const step of p.journey) {
          if (step.flow) allFlowsUsed.add(step.flow);
        }
      }

      return {
        persona: persona.id,
        valid: errors.length === 0,
        errors,
        warnings,
        coverage: {
          routes: {
            covered: allRoutesUsed.size,
            total: portalRoutes.length,
            uncovered: portalRoutes.filter(r => !allRoutesUsed.has(r)),
          },
          gates: {
            covered: allGatesUsed.size,
            total: portalGates.length,
            uncovered: portalGates.filter(g => !allGatesUsed.has(g)),
          },
          flows: {
            covered: allFlowsUsed.size,
            total: allFlows.length,
            uncovered: allFlows.filter(f => !allFlowsUsed.has(f)),
          },
        },
      };
    }
  }

  return {
    persona: persona.id,
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function routeMatches(portalRoute: string, stepRoute: string): boolean {
  // portal: "GET /api/projects/:id"  step: "GET /api/projects/{{produces.id}}"
  // Normalize: replace :param and {{...}} with placeholder, then compare
  const normalize = (r: string) =>
    r.replace(/:[a-zA-Z_]+/g, ':param').replace(/\{\{[^}]+\}\}/g, ':param');
  return normalize(portalRoute) === normalize(stepRoute);
}

async function detectSpawnCycle(rootDir: string, startId: string): Promise<string[] | null> {
  const visited = new Set<string>();
  const stack: string[] = [];

  async function visit(id: string): Promise<string[] | null> {
    if (visited.has(id)) {
      const cycleStart = stack.indexOf(id);
      if (cycleStart !== -1) {
        return [...stack.slice(cycleStart), id];
      }
      return null;
    }

    visited.add(id);
    stack.push(id);

    const persona = await loadPersona(rootDir, id);
    if (persona) {
      for (const step of persona.journey) {
        if (step.spawns) {
          for (const spawn of step.spawns) {
            const cycle = await visit(spawn.persona);
            if (cycle) return cycle;
          }
        }
      }
    }

    stack.pop();
    return null;
  }

  return visit(startId);
}

// ── Index ────────────────────────────────────────────────

export async function rebuildPersonaIndex(rootDir: string): Promise<PersonaIndex> {
  const personasDir = path.join(rootDir, PERSONAS_ROOT);
  fs.mkdirSync(personasDir, { recursive: true });

  const personas = await loadPersonas(rootDir);

  const entries: Record<string, PersonaIndexEntry> = {};
  const gateCoverage: Record<string, string[]> = {};
  const routeCoverage: Record<string, string[]> = {};

  for (const p of personas) {
    const gates = new Set<string>();
    const flows = new Set<string>();
    const routes: string[] = [];
    const spawns = new Set<string>();

    for (const step of p.journey) {
      for (const g of step.gates) gates.add(g);
      if (step.flow) flows.add(step.flow);
      routes.push(step.route);
      if (step.spawns) {
        for (const s of step.spawns) spawns.add(s.persona);
      }
    }

    entries[p.id] = {
      name: p.name,
      trigger: p.trigger.type,
      spawned_by: p.trigger.spawned_by,
      steps: p.journey.length,
      gates: [...gates],
      flows: [...flows],
      routes,
      spawns: [...spawns],
      tags: p.tags || [],
    };

    // Build cross-reference maps
    for (const gate of gates) {
      if (!gateCoverage[gate]) gateCoverage[gate] = [];
      gateCoverage[gate].push(p.id);
    }
    for (const route of routes) {
      if (!routeCoverage[route]) routeCoverage[route] = [];
      routeCoverage[route].push(p.id);
    }
  }

  // Find uncovered routes from portal.yaml
  let uncoveredRoutes: string[] = [];
  const portalPath = path.join(rootDir, 'portal.yaml');
  if (fs.existsSync(portalPath)) {
    try {
      const portal = yaml.load(fs.readFileSync(portalPath, 'utf8')) as Record<string, unknown>;
      if (portal.routes && typeof portal.routes === 'object') {
        const portalRoutes = Object.keys(portal.routes as object);
        uncoveredRoutes = portalRoutes.filter(pr => {
          return !Object.keys(routeCoverage).some(sr => routeMatches(pr, sr));
        });
      }
    } catch { /* skip */ }
  }

  // Load chains
  const chains: PersonaIndex['chains'] = {};
  const chainsDir = path.join(personasDir, 'chains');
  if (fs.existsSync(chainsDir)) {
    const chainFiles = fs.readdirSync(chainsDir).filter(f => f.endsWith('.yaml'));
    for (const file of chainFiles) {
      try {
        const content = fs.readFileSync(path.join(chainsDir, file), 'utf8');
        const chain = yaml.load(content) as { id: string; description: string; order: Array<{ persona: string }> };
        if (chain && chain.id) {
          const orderIds = chain.order.map(o => o.persona);
          let totalSteps = 0;
          const totalGates = new Set<string>();
          for (const pid of orderIds) {
            const entry = entries[pid];
            if (entry) {
              totalSteps += entry.steps;
              for (const g of entry.gates) totalGates.add(g);
            }
          }
          chains[chain.id] = {
            description: chain.description || '',
            order: orderIds,
            total_steps: totalSteps,
            total_gates: totalGates.size,
          };
        }
      } catch { /* skip */ }
    }
  }

  const index: PersonaIndex = {
    version: '1.0',
    generated: new Date().toISOString(),
    personas: entries,
    chains,
    gate_coverage: gateCoverage,
    route_coverage: routeCoverage,
    uncovered_routes: uncoveredRoutes,
  };

  fs.writeFileSync(
    path.join(personasDir, INDEX_FILE),
    yaml.dump(index, { indent: 2, lineWidth: 120, noRefs: true, sortKeys: false }),
  );
  return index;
}

// ── Coverage report ──────────────────────────────────────

export async function getPersonaCoverage(rootDir: string): Promise<{
  routes: { covered: number; total: number; uncovered: string[] };
  gates: { covered: number; total: number; uncovered: string[] };
  flows: { covered: number; total: number; uncovered: string[] };
  personas: number;
}> {
  const personas = await loadPersonas(rootDir);

  const allGatesUsed = new Set<string>();
  const allRoutesUsed = new Set<string>();
  const allFlowsUsed = new Set<string>();

  for (const p of personas) {
    for (const step of p.journey) {
      for (const gate of step.gates) allGatesUsed.add(gate);
      allRoutesUsed.add(step.route);
      if (step.flow) allFlowsUsed.add(step.flow);
    }
  }

  // Load portal
  let portalGates: string[] = [];
  let portalRoutes: string[] = [];
  const portalPath = path.join(rootDir, 'portal.yaml');
  if (fs.existsSync(portalPath)) {
    try {
      const portal = yaml.load(fs.readFileSync(portalPath, 'utf8')) as Record<string, unknown>;
      if (portal.gates && typeof portal.gates === 'object') portalGates = Object.keys(portal.gates as object);
      if (portal.routes && typeof portal.routes === 'object') portalRoutes = Object.keys(portal.routes as object);
    } catch { /* skip */ }
  }

  // Load flows
  let allFlows: string[] = [];
  const flowIndexPath = path.join(rootDir, '.paradigm', 'flow-index.json');
  if (fs.existsSync(flowIndexPath)) {
    try {
      const flowIndex = JSON.parse(fs.readFileSync(flowIndexPath, 'utf8'));
      allFlows = Object.keys(flowIndex.flows || {});
    } catch { /* skip */ }
  }

  return {
    routes: {
      covered: allRoutesUsed.size,
      total: portalRoutes.length,
      uncovered: portalRoutes.filter(r =>
        !Array.from(allRoutesUsed).some(sr => routeMatches(r, sr))
      ),
    },
    gates: {
      covered: allGatesUsed.size,
      total: portalGates.length,
      uncovered: portalGates.filter(g => !allGatesUsed.has(g)),
    },
    flows: {
      covered: allFlowsUsed.size,
      total: allFlows.length,
      uncovered: allFlows.filter(f => !allFlowsUsed.has(f)),
    },
    personas: personas.length,
  };
}

// ── Affected personas (for ripple) ───────────────────────

export async function getAffectedPersonas(
  rootDir: string,
  symbol: string,
): Promise<Array<{ persona: string; steps: string[]; spawns_blocked: string[] }>> {
  const personas = await loadPersonas(rootDir);
  const results: Array<{ persona: string; steps: string[]; spawns_blocked: string[] }> = [];

  for (const p of personas) {
    const affectedSteps: string[] = [];
    const spawnsBlocked: string[] = [];

    for (const step of p.journey) {
      const matches = step.gates.includes(symbol)
        || step.flow === symbol
        || step.route === symbol
        || step.signals?.includes(symbol);

      if (matches) {
        affectedSteps.push(step.id);
        // If this step spawns other personas, they're blocked
        if (step.spawns) {
          for (const spawn of step.spawns) {
            spawnsBlocked.push(spawn.persona);
          }
        }
      }
    }

    if (affectedSteps.length > 0) {
      results.push({ persona: p.id, steps: affectedSteps, spawns_blocked: spawnsBlocked });
    }
  }

  return results;
}

// ── Sentinel Assertion Engine ────────────────────────────

interface SentinelEvent {
  id: string;
  event_type: string;
  timestamp: string;
  scope_value?: string;
  data_json: string;
}

function deepGet(obj: unknown, path: string): unknown {
  const parts = path.split(/[.\[\]]+/).filter(Boolean);
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function assertStep(
  step: PersonaStep,
  event: { status: number; body: unknown; gates_traversed?: string[]; signals_fired?: string[] },
): StepAssertion[] {
  const assertions: StepAssertion[] = [];

  // Status assertion
  if (event.status !== step.expect.status) {
    assertions.push({
      type: 'status',
      field: 'status',
      expected: step.expect.status,
      actual: event.status,
      message: `Step ${step.id}: status is ${event.status}, expected ${step.expect.status}`,
    });
  }

  // body.has assertions
  if (step.expect.body?.has) {
    const body = event.body as Record<string, unknown> | null;
    for (const key of step.expect.body.has) {
      if (!body || typeof body !== 'object' || !(key in body)) {
        assertions.push({
          type: 'body.has',
          field: key,
          expected: true,
          actual: false,
          message: `Step ${step.id}: body missing key '${key}'`,
        });
      }
    }
  }

  // body.match assertions
  if (step.expect.body?.match) {
    const body = event.body as Record<string, unknown> | null;
    for (const [field, expected] of Object.entries(step.expect.body.match)) {
      const actual = body ? deepGet(body, field) : undefined;
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        assertions.push({
          type: 'body.match',
          field,
          expected,
          actual: actual ?? null,
          message: `Step ${step.id}: '${field}' is ${JSON.stringify(actual ?? null)}, expected ${JSON.stringify(expected)}`,
        });
      }
    }
  }

  // Signal assertions
  if (step.signals && step.signals.length > 0) {
    const firedSignals = event.signals_fired || [];
    for (const signal of step.signals) {
      if (!firedSignals.includes(signal)) {
        assertions.push({
          type: 'signal',
          field: 'signals_fired',
          expected: signal,
          actual: firedSignals,
          message: `Step ${step.id}: signal '${signal}' was not fired`,
        });
      }
    }
  }

  // Gate assertions
  if (step.gates.length > 0 && event.gates_traversed) {
    for (const gate of step.gates) {
      if (!event.gates_traversed.includes(gate)) {
        assertions.push({
          type: 'gate',
          field: 'gates_traversed',
          expected: gate,
          actual: event.gates_traversed,
          message: `Step ${step.id}: gate '${gate}' was not traversed`,
        });
      }
    }
  }

  return assertions;
}

export async function validateAgainstSentinel(
  persona: Persona,
  options: {
    run_id?: string;
    chain_id?: string;
    environment?: string;
  } = {},
): Promise<SentinelAssertionResult> {
  const steps: StepAssertionResult[] = [];

  try {
    const { SentinelStorage } = await import('@a-company/sentinel');
    const storage = new SentinelStorage();

    // Query Sentinel for step completion events for this persona
    const events = (storage as { queryEvents?: (opts: Record<string, unknown>) => SentinelEvent[] }).queryEvents?.({
      schemaId: 'paradigm-personas',
      eventType: 'persona.step.complete',
      scopeValue: persona.id,
      limit: 500,
    }) || [];

    // Filter by run_id/chain_id/environment if specified
    const filtered = events.filter((e: SentinelEvent) => {
      const data = JSON.parse(e.data_json || '{}');
      if (options.run_id && data.run_id !== options.run_id) return false;
      if (options.chain_id && data.chain_id !== options.chain_id) return false;
      if (options.environment && data.environment !== options.environment) return false;
      return true;
    });

    // Also get failed events
    const failEvents = (storage as { queryEvents?: (opts: Record<string, unknown>) => SentinelEvent[] }).queryEvents?.({
      schemaId: 'paradigm-personas',
      eventType: 'persona.step.fail',
      scopeValue: persona.id,
      limit: 500,
    }) || [];

    const filteredFails = failEvents.filter((e: SentinelEvent) => {
      const data = JSON.parse(e.data_json || '{}');
      if (options.run_id && data.run_id !== options.run_id) return false;
      if (options.chain_id && data.chain_id !== options.chain_id) return false;
      if (options.environment && data.environment !== options.environment) return false;
      return true;
    });

    // Build event map by step_id (latest event per step wins)
    const eventMap = new Map<string, Record<string, unknown>>();

    for (const e of [...filtered, ...filteredFails]) {
      const data = JSON.parse(e.data_json || '{}');
      if (data.step_id) {
        eventMap.set(data.step_id as string, data);
      }
    }

    // Match each persona step to its Sentinel event
    for (const step of persona.journey) {
      const eventData = eventMap.get(step.id);

      if (!eventData) {
        steps.push({
          step_id: step.id,
          matched: false,
          assertions: [],
          message: `No Sentinel event found for step '${step.id}' — step was never exercised`,
        });
        continue;
      }

      const assertions = assertStep(step, {
        status: eventData.status as number,
        body: eventData.body,
        gates_traversed: eventData.gates_traversed as string[] | undefined,
        signals_fired: eventData.signals_fired as string[] | undefined,
      });

      steps.push({
        step_id: step.id,
        matched: true,
        passed: assertions.length === 0,
        assertions,
      });
    }
  } catch {
    // Sentinel unavailable — return empty results
    for (const step of persona.journey) {
      steps.push({
        step_id: step.id,
        matched: false,
        assertions: [],
        message: 'Sentinel unavailable — cannot validate events',
      });
    }
  }

  const matched = steps.filter(s => s.matched).length;
  const passed = steps.filter(s => s.passed).length;
  const failed = steps.filter(s => s.matched && !s.passed).length;
  const totalAssertionFailures = steps.reduce((sum, s) => sum + s.assertions.length, 0);

  return {
    run_id: options.run_id,
    environment: options.environment,
    steps,
    summary: {
      total_steps: persona.journey.length,
      matched,
      unmatched: persona.journey.length - matched,
      passed,
      failed,
      assertion_failures: totalAssertionFailures,
    },
  };
}
