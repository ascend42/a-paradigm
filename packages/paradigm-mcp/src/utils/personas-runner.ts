/**
 * Personas Runner — Template interpolation + HTTP execution engine
 *
 * Executes persona journeys against a running server:
 *   1. Interpolates {{fixtures.X}}, {{produces.X}}, {{context.X}}, {{env.X}}
 *   2. Sends HTTP requests step-by-step
 *   3. Extracts produces from responses
 *   4. Validates expect assertions
 *   5. Handles spawn chains (topological order)
 */

import type {
  Persona,
  PersonaStep,
  StepExpect,
} from '../types/personas.js';
import { loadPersona } from './personas-loader.js';

// ── Helpers ──────────────────────────────────────────────

let runCounter = 0;

function generateRunId(): string {
  const date = new Date().toISOString().slice(0, 10);
  runCounter++;
  return `run_${date}_${String(runCounter).padStart(3, '0')}`;
}

// ── Types ────────────────────────────────────────────────

export interface StepResult {
  id: string;
  status: 'pass' | 'fail' | 'skip';
  route: string;
  gates: string[];
  request?: {
    url: string;
    method: string;
    headers?: Record<string, string>;
    payload?: unknown;
  };
  response?: {
    status: number;
    body: unknown;
  };
  produced?: Record<string, unknown>;
  expected_status?: number;
  failure?: string;
  gate_that_blocked?: string;
  duration_ms: number;
}

export interface RunResult {
  persona: string;
  run_id: string;
  status: 'pass' | 'fail' | 'error';
  steps: StepResult[];
  spawns_triggered: string[];
  spawns_blocked: string[];
  summary: string;
  duration_ms: number;
}

export interface ChainRunResult {
  chain_id: string;
  status: 'pass' | 'fail' | 'error';
  persona_results: RunResult[];
  summary: string;
  duration_ms: number;
}

export interface RunOptions {
  baseUrl: string;
  dryRun?: boolean;
  stopOnFailure?: boolean;
  context?: Record<string, string>;   // from parent spawn
  permutationOverrides?: Record<string, unknown>;
}

// ── Template Interpolation ───────────────────────────────

const TEMPLATE_REGEX = /\{\{([^}]+)\}\}/g;

export function interpolate(
  value: unknown,
  scope: {
    fixtures: Record<string, string>;
    produces: Record<string, unknown>;
    context: Record<string, string>;
    env: Record<string, string | undefined>;
  },
): unknown {
  if (typeof value === 'string') {
    return value.replace(TEMPLATE_REGEX, (_match, path: string) => {
      const resolved = resolvePath(path.trim(), scope);
      return resolved !== undefined ? String(resolved) : _match;
    });
  }

  if (Array.isArray(value)) {
    return value.map(item => interpolate(item, scope));
  }

  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = interpolate(v, scope);
    }
    return result;
  }

  return value;
}

function resolvePath(
  dotPath: string,
  scope: {
    fixtures: Record<string, string>;
    produces: Record<string, unknown>;
    context: Record<string, string>;
    env: Record<string, string | undefined>;
  },
): unknown {
  const [namespace, ...rest] = dotPath.split('.');
  const key = rest.join('.');

  switch (namespace) {
    case 'fixtures':
      return scope.fixtures[key];
    case 'produces':
      return deepGet(scope.produces, key);
    case 'context':
    case 'parent':
      return scope.context[key];
    case 'env':
      return scope.env[key] ?? process.env[key];
    default:
      return undefined;
  }
}

function deepGet(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(/[.\[\]]+/).filter(Boolean);
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

// ── Response value extraction (for produces) ─────────────

function extractProduces(
  producesSpec: Record<string, string>,
  responseBody: unknown,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, pathSpec] of Object.entries(producesSpec)) {
    // pathSpec is like "{{response.body.id}}" or "{{response.token}}"
    const match = pathSpec.match(/\{\{response\.(.+)\}\}/);
    if (match) {
      const valuePath = match[1];
      const value = deepGet(responseBody as Record<string, unknown>, valuePath);
      if (value !== undefined) {
        result[key] = value;
      }
    }
  }

  return result;
}

// ── Expect assertions ────────────────────────────────────

function checkExpect(
  expect: StepExpect,
  response: { status: number; body: unknown },
): { pass: boolean; failure?: string } {
  // Status check
  if (response.status !== expect.status) {
    return {
      pass: false,
      failure: `Status mismatch: expected ${expect.status}, got ${response.status}`,
    };
  }

  if (expect.body) {
    const body = response.body as Record<string, unknown>;

    // has: check keys exist
    if (expect.body.has) {
      for (const key of expect.body.has) {
        if (body === null || typeof body !== 'object' || !(key in body)) {
          return {
            pass: false,
            failure: `Expected body to have key "${key}"`,
          };
        }
      }
    }

    // match: check exact values
    if (expect.body.match) {
      for (const [key, expected] of Object.entries(expect.body.match)) {
        const actual = deepGet(body as Record<string, unknown>, key);
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          return {
            pass: false,
            failure: `Body mismatch at "${key}": expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
          };
        }
      }
    }
  }

  return { pass: true };
}

// ── HTTP Execution ───────────────────────────────────────

async function executeStep(
  step: PersonaStep,
  options: RunOptions,
  scope: {
    fixtures: Record<string, string>;
    produces: Record<string, unknown>;
    context: Record<string, string>;
    env: Record<string, string | undefined>;
  },
): Promise<StepResult> {
  const start = Date.now();

  // Parse route → method + path
  const routeParts = step.route.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(.*)/);
  if (!routeParts) {
    return {
      id: step.id,
      status: 'fail',
      route: step.route,
      gates: step.gates,
      failure: `Invalid route format: ${step.route}`,
      duration_ms: Date.now() - start,
    };
  }

  const method = routeParts[1];
  const pathTemplate = routeParts[2];

  // Interpolate path, headers, payload
  const interpolatedPath = interpolate(pathTemplate, scope) as string;
  const url = `${options.baseUrl.replace(/\/$/, '')}${interpolatedPath}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(step.headers ? interpolate(step.headers, scope) as Record<string, string> : {}),
  };
  const payload = step.payload ? interpolate(step.payload, scope) : undefined;

  // Build request info for result
  const requestInfo = {
    url,
    method,
    headers: step.headers ? headers : undefined,
    payload,
  };

  // Dry run — return interpolated request without executing
  if (options.dryRun) {
    return {
      id: step.id,
      status: 'pass',
      route: step.route,
      gates: step.gates,
      request: requestInfo,
      produced: step.produces ? Object.fromEntries(
        Object.keys(step.produces).map(k => [k, `<dry-run:${k}>`])
      ) : undefined,
      duration_ms: Date.now() - start,
    };
  }

  // Execute HTTP request
  try {
    const fetchOptions: RequestInit = {
      method,
      headers,
    };

    if (payload && ['POST', 'PUT', 'PATCH'].includes(method)) {
      fetchOptions.body = JSON.stringify(payload);
    }

    const response = await fetch(url, fetchOptions);
    let body: unknown;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      body = await response.json();
    } else {
      body = await response.text();
    }

    const responseInfo = { status: response.status, body };

    // Check expect assertions
    const expectResult = checkExpect(step.expect, responseInfo);

    // Extract produces
    let produced: Record<string, unknown> | undefined;
    if (step.produces && expectResult.pass) {
      produced = extractProduces(step.produces, body);
    }

    // Detect gate-blocked responses
    let gateBlocked: string | undefined;
    if (response.status === 401 || response.status === 403) {
      gateBlocked = step.gates[step.gates.length - 1]; // most specific gate
    }

    return {
      id: step.id,
      status: expectResult.pass ? 'pass' : 'fail',
      route: step.route,
      gates: step.gates,
      request: requestInfo,
      response: responseInfo,
      produced,
      expected_status: expectResult.pass ? undefined : step.expect.status,
      failure: expectResult.failure,
      gate_that_blocked: gateBlocked,
      duration_ms: Date.now() - start,
    };
  } catch (err: unknown) {
    return {
      id: step.id,
      status: 'fail',
      route: step.route,
      gates: step.gates,
      request: requestInfo,
      failure: `Request failed: ${(err as Error).message}`,
      duration_ms: Date.now() - start,
    };
  }
}

// ── Persona Runner ───────────────────────────────────────

export async function runPersona(
  rootDir: string,
  personaId: string,
  options: RunOptions,
): Promise<RunResult> {
  const start = Date.now();
  const persona = await loadPersona(rootDir, personaId);

  if (!persona) {
    return {
      persona: personaId,
      run_id: generateRunId(),
      status: 'error',
      steps: [],
      spawns_triggered: [],
      spawns_blocked: [],
      summary: `Persona ${personaId} not found`,
      duration_ms: Date.now() - start,
    };
  }

  return runPersonaObject(rootDir, persona, options);
}

export async function runPersonaObject(
  rootDir: string,
  persona: Persona,
  options: RunOptions,
): Promise<RunResult> {
  const start = Date.now();
  const stopOnFailure = options.stopOnFailure !== false; // default true

  const scope = {
    fixtures: persona.fixtures || {},
    produces: {} as Record<string, unknown>,
    context: options.context || {},
    env: process.env as Record<string, string | undefined>,
  };

  const steps: StepResult[] = [];
  const spawnsTriggered: string[] = [];
  const spawnsBlocked: string[] = [];
  let failed = false;

  for (const step of persona.journey) {
    if (failed && stopOnFailure) {
      // Skip remaining steps
      steps.push({
        id: step.id,
        status: 'skip',
        route: step.route,
        gates: step.gates,
        duration_ms: 0,
      });

      // Track blocked spawns
      if (step.spawns) {
        for (const spawn of step.spawns) {
          spawnsBlocked.push(spawn.persona);
        }
      }
      continue;
    }

    const result = await executeStep(step, options, scope);
    steps.push(result);

    if (result.status === 'pass') {
      // Merge produces into scope
      if (result.produced) {
        Object.assign(scope.produces, result.produced);
      }

      // Track spawns
      if (step.spawns) {
        for (const spawn of step.spawns) {
          spawnsTriggered.push(spawn.persona);
        }
      }
    } else {
      failed = true;
      // Track blocked spawns from this and remaining steps
      if (step.spawns) {
        for (const spawn of step.spawns) {
          spawnsBlocked.push(spawn.persona);
        }
      }
    }
  }

  const passed = steps.filter(s => s.status === 'pass').length;
  const failedCount = steps.filter(s => s.status === 'fail').length;
  const total = persona.journey.length;
  const firstFailure = steps.find(s => s.status === 'fail');

  let summary: string;
  if (failedCount === 0) {
    summary = `${passed}/${total} passed. All steps succeeded.`;
  } else {
    summary = `${passed}/${total} passed. Failed at step ${steps.indexOf(firstFailure!) + 1} (${firstFailure!.id}): ${firstFailure!.failure}`;
  }

  return {
    persona: persona.id,
    run_id: generateRunId(),
    status: failedCount > 0 ? 'fail' : 'pass',
    steps,
    spawns_triggered: spawnsTriggered,
    spawns_blocked: spawnsBlocked,
    summary,
    duration_ms: Date.now() - start,
  };
}

// ── Chain Runner ─────────────────────────────────────────

interface ChainDefinition {
  id: string;
  description?: string;
  order: Array<{ persona: string; wait_for: string | null }>;
  permutations?: Array<{
    id: string;
    description?: string;
    overrides: Record<string, {
      traits?: Record<string, unknown>;
      journey?: Record<string, {
        payload?: Record<string, unknown>;
        expect?: Partial<StepExpect>;
      }>;
    }>;
  }>;
}

export async function runChain(
  rootDir: string,
  chainId: string,
  options: RunOptions & { permutation?: string },
): Promise<ChainRunResult> {
  const start = Date.now();
  const fs = await import('fs');
  const path = await import('path');
  const yaml = await import('js-yaml');

  const chainPath = path.join(rootDir, '.paradigm', 'personas', 'chains', `${chainId}.yaml`);
  if (!fs.existsSync(chainPath)) {
    return {
      chain_id: chainId,
      status: 'error',
      persona_results: [],
      summary: `Chain ${chainId} not found`,
      duration_ms: Date.now() - start,
    };
  }

  const chain = yaml.load(fs.readFileSync(chainPath, 'utf8')) as ChainDefinition;

  // Apply permutation overrides if specified
  let permutation: ChainDefinition['permutations'] extends Array<infer T> ? T : never | undefined;
  if (options.permutation && chain.permutations) {
    permutation = chain.permutations.find(p => p.id === options.permutation);
    if (!permutation) {
      return {
        chain_id: chainId,
        status: 'error',
        persona_results: [],
        summary: `Permutation ${options.permutation} not found in chain ${chainId}`,
        duration_ms: Date.now() - start,
      };
    }
  }

  const personaResults: RunResult[] = [];
  const producedByPersona: Record<string, Record<string, unknown>> = {};
  const stopOnFailure = options.stopOnFailure !== false;

  for (const entry of chain.order) {
    const persona = await loadPersona(rootDir, entry.persona);
    if (!persona) {
      personaResults.push({
        persona: entry.persona,
        status: 'error',
        steps: [],
        spawns_triggered: [],
        spawns_blocked: [],
        summary: `Persona ${entry.persona} not found`,
        duration_ms: 0,
      });
      if (stopOnFailure) break;
      continue;
    }

    // Apply permutation overrides to persona
    if (permutation && permutation.overrides[entry.persona]) {
      const overrides = permutation.overrides[entry.persona];
      if (overrides.traits) {
        persona.traits = { ...persona.traits, ...overrides.traits };
      }
      if (overrides.journey) {
        for (const [stepId, stepOverrides] of Object.entries(overrides.journey)) {
          const step = persona.journey.find(s => s.id === stepId);
          if (step) {
            if (stepOverrides.payload) step.payload = { ...step.payload, ...stepOverrides.payload };
            if (stepOverrides.expect) step.expect = { ...step.expect, ...stepOverrides.expect };
          }
        }
      }
    }

    // Build context from spawn relationship
    let context: Record<string, string> = {};
    if (entry.wait_for) {
      const [parentId, stepId] = entry.wait_for.split('.');
      const parentResult = personaResults.find(r => r.persona === parentId);
      if (parentResult) {
        const stepResult = parentResult.steps.find(s => s.id === stepId);
        if (stepResult?.produced) {
          context = Object.fromEntries(
            Object.entries(stepResult.produced).map(([k, v]) => [k, String(v)])
          );
        }
      }

      // Also pass spawn context from the parent persona's step
      const parentPersona = await loadPersona(rootDir, parentId);
      if (parentPersona) {
        const parentStep = parentPersona.journey.find(s => s.id === stepId);
        if (parentStep?.spawns) {
          const spawnDef = parentStep.spawns.find(s => s.persona === entry.persona);
          if (spawnDef?.context) {
            // Interpolate spawn context with parent's produces
            const parentProduces = producedByPersona[parentId] || {};
            for (const [k, v] of Object.entries(spawnDef.context)) {
              context[k] = String(interpolate(v, {
                fixtures: {},
                produces: parentProduces,
                context: {},
                env: process.env as Record<string, string | undefined>,
              }));
            }
          }
        }
      }
    }

    const result = await runPersonaObject(rootDir, persona, { ...options, context });
    personaResults.push(result);

    // Track all produces from this persona for downstream use
    const allProduced: Record<string, unknown> = {};
    for (const step of result.steps) {
      if (step.produced) Object.assign(allProduced, step.produced);
    }
    producedByPersona[entry.persona] = allProduced;

    if (result.status === 'fail' && stopOnFailure) break;
  }

  const passed = personaResults.filter(r => r.status === 'pass').length;
  const total = chain.order.length;

  return {
    chain_id: chainId,
    status: personaResults.some(r => r.status !== 'pass') ? 'fail' : 'pass',
    persona_results: personaResults,
    summary: `${passed}/${total} personas passed.`,
    duration_ms: Date.now() - start,
  };
}

// ── Dry-run validation ───────────────────────────────────

export function validateInterpolation(persona: Persona): {
  valid: boolean;
  errors: Array<{ step: string; template: string; error: string }>;
} {
  const errors: Array<{ step: string; template: string; error: string }> = [];
  const producedKeys = new Set<string>();

  for (const step of persona.journey) {
    const serialized = JSON.stringify(step);
    const templates = serialized.match(TEMPLATE_REGEX) || [];

    for (const template of templates) {
      const path = template.replace('{{', '').replace('}}', '').trim();
      const [namespace, ...rest] = path.split('.');
      const key = rest.join('.');

      switch (namespace) {
        case 'fixtures':
          if (!persona.fixtures || !(key in persona.fixtures)) {
            // Check if it's a global fixture reference — defer to runtime
          }
          break;
        case 'produces':
          if (!producedKeys.has(key)) {
            errors.push({
              step: step.id,
              template,
              error: `{{produces.${key}}} used but not produced by a prior step`,
            });
          }
          break;
        case 'context':
        case 'parent':
          // Can only validate at runtime with spawn context
          break;
        case 'env':
          // Environment variables — validate at runtime
          break;
        case 'response':
          // Only valid inside produces — skip validation here
          break;
        default:
          errors.push({
            step: step.id,
            template,
            error: `Unknown namespace "${namespace}" in ${template}`,
          });
      }
    }

    // Track produces
    if (step.produces) {
      for (const key of Object.keys(step.produces)) {
        producedKeys.add(key);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
