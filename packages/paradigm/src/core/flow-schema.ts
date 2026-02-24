/**
 * Flow Schema
 *
 * Defines TypeScript interfaces for flow definitions.
 * Flows are composable sequences of gates, actions, and signals
 * that represent the "happy path" for a feature or operation.
 */

// ============================================================================
// Flow Step Types
// ============================================================================

/**
 * Type of step in a flow
 */
export type FlowStepType = 'gate' | 'action' | 'signal';

/**
 * A single step in a flow
 */
export interface FlowStep {
  /** Type of step: gate (authorization), action (business logic), or signal (event) */
  type: FlowStepType;

  /** Paradigm symbol for this step (e.g., "^authenticated", "@create-task", "!task-created") */
  symbol: string;

  /** Human-readable description of this step */
  description?: string;

  /** Whether this step can be skipped (default: false) */
  optional?: boolean;

  /** Signal to emit if this step fails */
  errorSignal?: string;

  /** Condition for when this step should execute */
  when?: string;
}

/**
 * A gate step (authorization check)
 */
export interface GateStep extends FlowStep {
  type: 'gate';
  /** Expected response if gate fails (e.g., "403 if not member") */
  failResponse?: string;
}

/**
 * An action step (business logic)
 */
export interface ActionStep extends FlowStep {
  type: 'action';
  /** Files/modules that implement this action */
  implementation?: string[];
}

/**
 * A signal step (event emission)
 */
export interface SignalStep extends FlowStep {
  type: 'signal';
  /** Payload schema for this signal */
  payload?: Record<string, unknown>;
}

// ============================================================================
// Flow Definition
// ============================================================================

/**
 * Complete flow definition
 */
export interface FlowDefinition {
  /** Unique flow identifier (e.g., "$task-creation") */
  id: string;

  /** Human-readable name */
  name: string;

  /** Description of what this flow accomplishes */
  description: string;

  /** What initiates this flow (e.g., "POST /api/tasks", "!user-action") */
  trigger: string;

  /** Ordered sequence of steps */
  steps: FlowStep[];

  /** Signal emitted on successful completion */
  successSignal: string;

  /** Signal emitted on failure (optional) */
  failureSignal?: string;

  /** Tags for categorization */
  tags?: string[];

  /** Related flows (other flows that might be triggered) */
  relatedFlows?: string[];

  /** Source file where this flow is defined */
  definedIn?: string;
}

// ============================================================================
// Flows Configuration
// ============================================================================

/**
 * Configuration for all flows in a project
 * Stored in .paradigm/flows.yaml
 */
export interface FlowsConfig {
  /** Schema version */
  version: string;

  /** Map of flow ID to flow definition */
  flows: Record<string, Omit<FlowDefinition, 'id'>>;
}

// ============================================================================
// Flow Validation Types
// ============================================================================

/**
 * Result of validating a single flow
 */
export interface FlowValidationResult {
  /** Flow ID being validated */
  flowId: string;

  /** Validation status */
  status: 'valid' | 'warnings' | 'invalid';

  /** Coverage analysis */
  coverage: {
    /** Gates referenced in flow */
    gatesReferenced: string[];

    /** Gates in flow but not in portal.yaml */
    gatesMissing: string[];

    /** Actions (@features) referenced in flow */
    actionsReferenced: string[];

    /** Actions not found in codebase */
    actionsMissing: string[];

    /** Signals referenced in flow */
    signalsEmitted: string[];

    /** Signals not documented */
    signalsMissing: string[];
  };

  /** Validation issues */
  issues: Array<{
    severity: 'error' | 'warning' | 'info';
    message: string;
    step?: number;
    symbol?: string;
  }>;

  /** Suggestions for improvement */
  suggestions: string[];
}

/**
 * Result of validating all flows
 */
export interface AllFlowsValidationResult {
  /** Overall status */
  status: 'valid' | 'warnings' | 'invalid';

  /** Total flows checked */
  totalFlows: number;

  /** Valid flows count */
  validFlows: number;

  /** Flows with warnings */
  warningFlows: number;

  /** Invalid flows count */
  invalidFlows: number;

  /** Individual flow results */
  results: FlowValidationResult[];

  /** Cross-flow issues (circular dependencies, etc.) */
  crossFlowIssues: Array<{
    severity: 'error' | 'warning';
    message: string;
    flows: string[];
  }>;

  /** Detected circular dependency chains */
  circularDependencies: Array<{
    /** The cycle path, e.g. ["$a", "$b", "$c", "$a"] */
    cycle: string[];
    /** Human-readable description */
    message: string;
  }>;
}

// ============================================================================
// Helper Functions
// ============================================================================

/** Valid v2 symbol prefixes */
export const V2_PREFIXES = ['#', '$', '^', '!', '~'] as const;

/** Deprecated v1 prefixes — use v2 equivalents instead */
export const LEGACY_PREFIXES = ['@', '%', '?', '&'] as const;

/**
 * Extract symbol prefix and name from a symbol string.
 * Only accepts v2 prefixes (#, $, ^, !, ~). Returns null for legacy v1 prefixes.
 */
export function parseSymbol(symbol: string): { prefix: string; name: string } | null {
  const match = symbol.match(/^([#$^!~])(.+)$/);
  if (!match) return null;
  return { prefix: match[1], name: match[2] };
}

/**
 * Check if a symbol uses a deprecated v1 prefix (@, %, ?, &).
 * Returns migration guidance if so, null otherwise.
 */
export function checkLegacySymbol(symbol: string): { prefix: string; name: string; migration: string } | null {
  const match = symbol.match(/^([@%?&])(.+)$/);
  if (!match) return null;

  const migrations: Record<string, string> = {
    '@': 'Use #component with tags: [feature]',
    '%': 'Use #component with tags: [state]',
    '?': 'Use [idea] tag on any symbol',
    '&': 'Use #component with tags: [integration]',
  };

  return { prefix: match[1], name: match[2], migration: migrations[match[1]] };
}

/**
 * Get the step type expected for a symbol prefix
 */
export function getExpectedStepType(prefix: string): FlowStepType | null {
  const mapping: Record<string, FlowStepType> = {
    '^': 'gate',
    '#': 'action',
    '!': 'signal',
    '$': 'action', // Flows can reference other flows as actions
  };
  return mapping[prefix] || null;
}

/**
 * Check if a step type matches the symbol prefix
 */
export function isStepTypeValid(step: FlowStep): boolean {
  const parsed = parseSymbol(step.symbol);
  if (!parsed) return false;

  const expected = getExpectedStepType(parsed.prefix);
  return expected === step.type;
}

/**
 * Convert flows config to array of flow definitions
 */
export function configToFlowDefinitions(config: FlowsConfig): FlowDefinition[] {
  return Object.entries(config.flows).map(([id, flow]) => ({
    id,
    ...flow,
  }));
}

/**
 * Convert flow definitions array to config format
 */
export function flowDefinitionsToConfig(flows: FlowDefinition[]): FlowsConfig {
  const flowsMap: Record<string, Omit<FlowDefinition, 'id'>> = {};

  for (const flow of flows) {
    const { id, ...rest } = flow;
    flowsMap[id] = rest;
  }

  return {
    version: '1.0',
    flows: flowsMap,
  };
}

/**
 * Create an empty flow template
 */
export function createFlowTemplate(id: string, trigger: string): FlowDefinition {
  return {
    id,
    name: id.replace(/^\$/, '').replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    description: '',
    trigger,
    steps: [],
    successSignal: `!${id.replace(/^\$/, '')}-completed`,
  };
}

/**
 * Validate basic flow structure
 */
export function validateFlowStructure(flow: FlowDefinition): string[] {
  const errors: string[] = [];

  if (!flow.id) {
    errors.push('Flow must have an id');
  } else if (!flow.id.startsWith('$')) {
    errors.push(`Flow id should start with $ (got: ${flow.id})`);
  }

  if (!flow.trigger) {
    errors.push('Flow must have a trigger');
  }

  if (!flow.steps || flow.steps.length === 0) {
    errors.push('Flow must have at least one step');
  }

  if (!flow.successSignal) {
    errors.push('Flow must have a successSignal');
  } else if (!flow.successSignal.startsWith('!')) {
    errors.push(`successSignal should start with ! (got: ${flow.successSignal})`);
  }

  for (let i = 0; i < (flow.steps || []).length; i++) {
    const step = flow.steps[i];

    if (!step.symbol) {
      errors.push(`Step ${i + 1} must have a symbol`);
      continue;
    }

    if (!isStepTypeValid(step)) {
      const parsed = parseSymbol(step.symbol);
      if (parsed) {
        const expected = getExpectedStepType(parsed.prefix);
        errors.push(`Step ${i + 1}: Symbol ${step.symbol} should have type '${expected}', got '${step.type}'`);
      }
    }
  }

  return errors;
}
