/**
 * Persona Types — Actor-driven journey testing
 */

// ── Trigger ──────────────────────────────────────────────

export type TriggerType = 'root' | 'invitation' | 'signup' | 'api';

export interface PersonaTrigger {
  type: TriggerType;
  spawned_by?: string;          // persona-id.step-id
  spawned_at?: string;          // step ID in parent journey
  context?: Record<string, string>;
}

// ── Journey Step ─────────────────────────────────────────

export interface StepExpect {
  status: number;
  body?: {
    has?: string[];
    match?: Record<string, unknown>;
  };
}

export interface StepSpawn {
  persona: string;
  via: string;
  context?: Record<string, string>;
}

export interface PersonaStep {
  id: string;
  description?: string;
  route: string;                // "METHOD /path"
  flow?: string;                // $flow reference
  gates: string[];              // ^gate references
  headers?: Record<string, string>;
  payload?: Record<string, unknown>;
  expect: StepExpect;
  produces?: Record<string, string>;
  spawns?: StepSpawn[];
  signals?: string[];           // !signal references
}

// ── Persona ──────────────────────────────────────────────

export interface Persona {
  version: string;
  id: string;
  name: string;
  description?: string;
  traits?: Record<string, unknown>;
  trigger: PersonaTrigger;
  fixtures?: Record<string, string>;
  tags?: string[];
  journey: PersonaStep[];
  created?: string;
  updated?: string;
}

// ── Filter ───────────────────────────────────────────────

export interface PersonaFilter {
  tag?: string;
  trigger_type?: TriggerType;
  gate?: string;
  flow?: string;
  limit?: number;
}

// ── Index ────────────────────────────────────────────────

export interface PersonaIndexEntry {
  name: string;
  trigger: TriggerType;
  spawned_by?: string;
  steps: number;
  gates: string[];
  flows: string[];
  routes: string[];
  spawns: string[];
  tags: string[];
}

export interface PersonaIndex {
  version: string;
  generated: string;
  personas: Record<string, PersonaIndexEntry>;
  chains: Record<string, {
    description: string;
    order: string[];
    total_steps: number;
    total_gates: number;
  }>;
  gate_coverage: Record<string, string[]>;
  route_coverage: Record<string, string[]>;
  uncovered_routes: string[];
}

// ── Validation ───────────────────────────────────────────

export interface PersonaValidationError {
  type: string;
  step?: string;
  gate?: string;
  flow?: string;
  route?: string;
  key?: string;
  detail: string;
}

export interface PersonaValidationWarning {
  type: string;
  gate?: string;
  detail: string;
}

export interface PersonaValidationResult {
  persona: string;
  valid: boolean;
  errors: PersonaValidationError[];
  warnings: PersonaValidationWarning[];
  coverage?: {
    routes: { covered: number; total: number; uncovered: string[] };
    gates: { covered: number; total: number; uncovered: string[] };
    flows: { covered: number; total: number; uncovered: string[] };
  };
  sentinel_assertions?: SentinelAssertionResult;
}

// ── Sentinel Assertions ──────────────────────────────────

export interface StepAssertion {
  type: 'status' | 'body.has' | 'body.match' | 'signal' | 'gate';
  field: string;
  expected: unknown;
  actual: unknown;
  message: string;
}

export interface StepAssertionResult {
  step_id: string;
  matched: boolean;
  passed?: boolean;
  assertions: StepAssertion[];
  message?: string;
}

export interface SentinelAssertionResult {
  run_id?: string;
  environment?: string;
  steps: StepAssertionResult[];
  summary: {
    total_steps: number;
    matched: number;
    unmatched: number;
    passed: number;
    failed: number;
    assertion_failures: number;
  };
}
