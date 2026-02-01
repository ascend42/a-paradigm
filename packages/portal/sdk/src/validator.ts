/**
 * Portal Validator
 *
 * Structured portal/gate logging with validation output for AI agents.
 * Emits parseable console logs that enable AI agents to validate
 * authorization flows by reading browser console output.
 *
 * @example
 * import { portal } from '@a-company/portal-sdk/validator';
 *
 * // In a route guard:
 * const gate = portal.check('^authenticated')
 *   .requires('user session exists')
 *   .context({ userId: user?.id, path: location.pathname });
 *
 * if (!user) {
 *   gate.deny('No active session');
 *   return redirect('/login');
 * }
 *
 * gate.allow('User authenticated');
 *
 * @see https://github.com/ascend42/a-paradigm/blob/main/packages/paradigm/templates/paradigm/specs/portal-validation.md
 */

// Environment detection
const isProduction =
  typeof process !== 'undefined'
    ? process.env.NODE_ENV === 'production'
    : typeof import.meta !== 'undefined' && (import.meta as any).env?.PROD;

const enableValidation =
  typeof process !== 'undefined'
    ? process.env.PORTAL_VALIDATION === 'true'
    : typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_ENABLE_PORTAL_VALIDATION === 'true';

const isTestMode =
  typeof process !== 'undefined'
    ? process.env.PORTAL_TEST_MODE === 'true'
    : typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_TEST_MODE === 'true';

// Only output in development or when explicitly enabled
function shouldLog(): boolean {
  if (isProduction && !enableValidation) return false;
  return true;
}

// Decision type
type GateDecision = 'allow' | 'deny' | 'pending';

/**
 * Result of a gate check - can be used for assertions in tests
 */
export interface GateResult {
  /** Gate identifier (e.g., "^subscription-required") */
  gate: string;
  /** List of documented requirements */
  requires: string[];
  /** Context data used in decision */
  context: Record<string, unknown>;
  /** The decision made */
  decision: GateDecision;
  /** Human-readable reason for the decision */
  reason: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Milliseconds to evaluate (optional) */
  duration?: number;
}

// Store for test assertions
const gateResults: GateResult[] = [];
const MAX_STORED_RESULTS = 100;

/**
 * Get all gate results (useful for testing)
 */
export function getGateResults(): GateResult[] {
  return [...gateResults];
}

/**
 * Clear stored gate results (useful for testing)
 */
export function clearGateResults(): void {
  gateResults.length = 0;
}

/**
 * Find a specific gate result by name
 */
export function findGateResult(gateName: string): GateResult | undefined {
  return gateResults.find((r) => r.gate === gateName);
}

/**
 * Find all results for a specific gate
 */
export function findGateResults(gateName: string): GateResult[] {
  return gateResults.filter((r) => r.gate === gateName);
}

/**
 * Assert that a gate was allowed
 */
export function assertGateAllowed(gateName: string): boolean {
  const result = findGateResult(gateName);
  if (!result) {
    console.error(`❌ ASSERTION FAILED: Gate "${gateName}" was never checked`);
    return false;
  }
  if (result.decision !== 'allow') {
    console.error(
      `❌ ASSERTION FAILED: Gate "${gateName}" was ${result.decision}, expected allow. Reason: ${result.reason}`
    );
    return false;
  }
  console.log(`✅ ASSERTION PASSED: Gate "${gateName}" allowed`);
  return true;
}

/**
 * Assert that a gate was denied
 */
export function assertGateDenied(gateName: string): boolean {
  const result = findGateResult(gateName);
  if (!result) {
    console.error(`❌ ASSERTION FAILED: Gate "${gateName}" was never checked`);
    return false;
  }
  if (result.decision !== 'deny') {
    console.error(
      `❌ ASSERTION FAILED: Gate "${gateName}" was ${result.decision}, expected deny. Reason: ${result.reason}`
    );
    return false;
  }
  console.log(`✅ ASSERTION PASSED: Gate "${gateName}" denied`);
  return true;
}

// Console styling colors
const COLORS = {
  gate: '#F97316', // orange
  allow: '#22C55E', // green
  deny: '#EF4444', // red
  pending: '#F59E0B', // amber
  context: '#6B7280', // gray
  border: '#374151', // dark gray
};

// Check if we're in a browser environment
const isBrowser = typeof window !== 'undefined';

/**
 * Format and output the gate check result
 */
function formatGateOutput(result: GateResult): void {
  if (!shouldLog()) return;

  const decisionIcon = result.decision === 'allow' ? '✅' : result.decision === 'deny' ? '❌' : '⏳';
  const decisionText = result.decision.toUpperCase();
  const decisionColor = COLORS[result.decision];

  if (isBrowser) {
    // Browser console with CSS styling
    console.log('%c┌─────────────────────────────────────────────────────────', `color: ${COLORS.border}`);

    console.log(
      '%c│ %c🚪 PORTAL CHECK: %c' + result.gate,
      `color: ${COLORS.border}`,
      'color: inherit; font-weight: normal',
      `color: ${COLORS.gate}; font-weight: bold`
    );

    if (result.requires.length > 0) {
      console.log(
        '%c│ %c├─ Requires: %c' + result.requires.join(', '),
        `color: ${COLORS.border}`,
        'color: #9CA3AF',
        'color: inherit'
      );
    }

    if (Object.keys(result.context).length > 0) {
      console.log(
        '%c│ %c├─ Context: %c' + JSON.stringify(result.context),
        `color: ${COLORS.border}`,
        'color: #9CA3AF',
        `color: ${COLORS.context}`
      );
    }

    console.log(
      '%c│ %c├─ Decision: %c' + decisionIcon + ' ' + decisionText,
      `color: ${COLORS.border}`,
      'color: #9CA3AF',
      `color: ${decisionColor}; font-weight: bold`
    );

    console.log(
      '%c│ %c└─ Reason: %c' + result.reason,
      `color: ${COLORS.border}`,
      'color: #9CA3AF',
      'color: inherit'
    );

    if (result.duration !== undefined) {
      console.log(
        '%c│ %c   Duration: %c' + result.duration + 'ms',
        `color: ${COLORS.border}`,
        'color: #9CA3AF',
        'color: #6B7280'
      );
    }

    console.log('%c└─────────────────────────────────────────────────────────', `color: ${COLORS.border}`);
  } else {
    // Node.js / non-browser environment - plain text with ANSI codes
    const reset = '\x1b[0m';
    const orange = '\x1b[33m';
    const green = '\x1b[32m';
    const red = '\x1b[31m';
    const gray = '\x1b[90m';

    const colorCode = result.decision === 'allow' ? green : result.decision === 'deny' ? red : orange;

    console.log(gray + '┌─────────────────────────────────────────────────────────' + reset);
    console.log(gray + '│ ' + reset + '🚪 PORTAL CHECK: ' + orange + result.gate + reset);
    if (result.requires.length > 0) {
      console.log(gray + '│ ├─ Requires: ' + reset + result.requires.join(', '));
    }
    if (Object.keys(result.context).length > 0) {
      console.log(gray + '│ ├─ Context: ' + reset + JSON.stringify(result.context));
    }
    console.log(gray + '│ ├─ Decision: ' + colorCode + decisionIcon + ' ' + decisionText + reset);
    console.log(gray + '│ └─ Reason: ' + reset + result.reason);
    if (result.duration !== undefined) {
      console.log(gray + '│    Duration: ' + result.duration + 'ms' + reset);
    }
    console.log(gray + '└─────────────────────────────────────────────────────────' + reset);
  }

  // In test mode, also output a parseable JSON line
  if (isTestMode) {
    console.log(`[GATE_RESULT] ${JSON.stringify(result)}`);
  }
}

/**
 * Gate check builder - fluent API for documenting and executing gate checks
 */
class GateCheck {
  private _gate: string;
  private _requires: string[] = [];
  private _context: Record<string, unknown> = {};
  private _startTime: number;

  constructor(gateName: string) {
    this._gate = gateName;
    this._startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  /**
   * Document what this gate requires
   * @param requirements - Human-readable requirement descriptions
   */
  requires(...requirements: string[]): this {
    this._requires.push(...requirements);
    return this;
  }

  /**
   * Add context data for debugging
   * @param ctx - Key-value pairs of context data
   */
  context(ctx: Record<string, unknown>): this {
    this._context = { ...this._context, ...ctx };
    return this;
  }

  /**
   * Gate check passed - access allowed
   * @param reason - Human-readable reason for allowing
   */
  allow(reason: string): GateResult {
    const result = this._finalize('allow', reason);
    formatGateOutput(result);
    return result;
  }

  /**
   * Gate check failed - access denied
   * @param reason - Human-readable reason for denying
   */
  deny(reason: string): GateResult {
    const result = this._finalize('deny', reason);
    formatGateOutput(result);
    return result;
  }

  /**
   * Gate check is pending (async operation in progress)
   * @param reason - Human-readable reason for pending state
   */
  pending(reason: string): GateResult {
    const result = this._finalize('pending', reason);
    formatGateOutput(result);
    return result;
  }

  private _finalize(decision: GateDecision, reason: string): GateResult {
    const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

    const result: GateResult = {
      gate: this._gate,
      requires: this._requires,
      context: this._context,
      decision,
      reason,
      timestamp: new Date().toISOString(),
      duration: Math.round(endTime - this._startTime),
    };

    // Store for test assertions
    gateResults.push(result);

    // Keep only the most recent results to prevent memory issues
    if (gateResults.length > MAX_STORED_RESULTS) {
      gateResults.shift();
    }

    return result;
  }
}

/**
 * Portal Validation API
 *
 * @example
 * // Full fluent API
 * const gate = portal.check('^subscription-required')
 *   .requires('active subscription', 'trial not exceeded')
 *   .context({ userId: user.id, plan: subscription?.plan });
 *
 * if (!subscription || subscription.status !== 'active') {
 *   gate.deny('No active subscription');
 *   return redirect('/pricing');
 * }
 *
 * gate.allow('Subscription valid');
 *
 * @example
 * // Quick methods for simple cases
 * portal.allow('^public-access', 'Route is public');
 * portal.deny('^authenticated', 'No session');
 */
export const portal = {
  /**
   * Start a new gate check with the fluent builder
   * @param gateName - Gate identifier (e.g., "^subscription-required")
   */
  check(gateName: string): GateCheck {
    return new GateCheck(gateName);
  },

  /**
   * Quick allow - for simple cases without detailed requirements
   * @param gateName - Gate identifier
   * @param reason - Human-readable reason
   * @param context - Optional context data
   */
  allow(gateName: string, reason: string, context?: Record<string, unknown>): GateResult {
    const check = new GateCheck(gateName);
    if (context) check.context(context);
    return check.allow(reason);
  },

  /**
   * Quick deny - for simple cases without detailed requirements
   * @param gateName - Gate identifier
   * @param reason - Human-readable reason
   * @param context - Optional context data
   */
  deny(gateName: string, reason: string, context?: Record<string, unknown>): GateResult {
    const check = new GateCheck(gateName);
    if (context) check.context(context);
    return check.deny(reason);
  },

  /**
   * Quick pending - for async operations
   * @param gateName - Gate identifier
   * @param reason - Human-readable reason
   * @param context - Optional context data
   */
  pending(gateName: string, reason: string, context?: Record<string, unknown>): GateResult {
    const check = new GateCheck(gateName);
    if (context) check.context(context);
    return check.pending(reason);
  },

  /**
   * Get all stored gate results (for testing)
   */
  getResults: getGateResults,

  /**
   * Clear stored gate results (for testing)
   */
  clearResults: clearGateResults,

  /**
   * Find a specific gate result (for testing)
   */
  findResult: findGateResult,

  /**
   * Find all results for a gate (for testing)
   */
  findResults: findGateResults,

  /**
   * Assertion helpers (for testing)
   */
  assert: {
    allowed: assertGateAllowed,
    denied: assertGateDenied,
  },
};

// Export types
export type { GateDecision };

// Default export
export default portal;
