/**
 * Sentinel SDK
 *
 * The developer-facing API for capturing errors with symbolic context.
 * Wraps the core storage and pattern matching engine.
 *
 * Usage:
 *   import { Sentinel } from '@a-company/sentinel';
 *   const sentinel = new Sentinel({ project: 'my-app' });
 *   sentinel.capture(new Error('Payment failed'), { component: '#checkout' });
 */

import { SentinelStorage } from './storage.js';
import { PatternMatcher } from './matcher.js';
import { loadAllSeedPatterns } from './seeds/loader.js';
import type {
  SentinelConfig,
  ComponentContext,
  SymbolicContext,
  CreateIncidentInput,
  PatternMatch,
  FlowPosition,
} from './types.js';

/**
 * Ensure a symbol has the correct prefix.
 * If it already starts with the prefix, return as-is.
 */
function ensurePrefix(id: string, prefix: string): string {
  return id.startsWith(prefix) ? id : `${prefix}${id}`;
}

/**
 * Flow tracker for monitoring multi-step flows.
 *
 * Usage:
 *   const flow = sentinel.flow('$checkout-flow');
 *   flow.expect('!payment-authorized', '!order-created');
 *   flow.gate('^authenticated', true);
 *   flow.signal('!payment-authorized');
 *   flow.complete();
 */
export class FlowTracker {
  private flowId: string;
  private sentinel: Sentinel;
  private actual: string[] = [];
  private expected: string[] = [];
  private completed = false;

  constructor(flowId: string, sentinel: Sentinel) {
    this.flowId = ensurePrefix(flowId, '$');
    this.sentinel = sentinel;
  }

  /** Declare which signals/gates are expected in this flow */
  expect(...symbols: string[]): this {
    this.expected.push(...symbols);
    return this;
  }

  /** Record a generic step in the flow */
  step(symbol: string): this {
    this.actual.push(symbol);
    return this;
  }

  /** Record a gate check result */
  gate(id: string, passed: boolean): this {
    const gateId = ensurePrefix(id, '^');
    this.actual.push(gateId);
    if (!passed) {
      this.fail(new Error(`Gate ${gateId} failed`));
    }
    return this;
  }

  /** Record a signal emission */
  signal(id: string, _data?: object): this {
    this.actual.push(ensurePrefix(id, '!'));
    return this;
  }

  /** Mark the flow as successfully completed */
  complete(): void {
    this.completed = true;
  }

  /** Capture an error with full flow position context */
  fail(error: Error): void {
    if (this.completed) return;
    this.completed = true;

    const missing = this.expected.filter((s) => !this.actual.includes(s));
    const failedAt = this.actual.length > 0 ? this.actual[this.actual.length - 1] : undefined;

    const flowPosition: FlowPosition = {
      flowId: this.flowId,
      expected: this.expected,
      actual: this.actual,
      missing,
      failedAt,
    };

    this.sentinel.capture(error, { flow: this.flowId }, flowPosition);
  }
}

/**
 * The main Sentinel SDK class.
 *
 * Usage:
 *   const sentinel = new Sentinel({ project: 'my-app', environment: 'production' });
 *
 *   // Capture errors with symbolic context
 *   sentinel.capture(error, { component: '#checkout', gate: '^payment-validated' });
 *
 *   // Component context for scoped captures
 *   const ctx = sentinel.component('#checkout');
 *   ctx.capture(error);
 *
 *   // Flow tracking
 *   const flow = sentinel.flow('$checkout-flow');
 *   flow.gate('^authenticated', true);
 *   flow.signal('!payment-authorized');
 *   flow.complete();
 */
export class Sentinel {
  private storage: SentinelStorage;
  private matcher: PatternMatcher;
  private config: SentinelConfig;
  private ready = false;
  private readyPromise: Promise<void> | null = null;
  private seeded = false;

  constructor(config: SentinelConfig) {
    this.config = config;
    this.storage = new SentinelStorage(config.dbPath);
    this.matcher = new PatternMatcher(this.storage);
  }

  /** Explicitly initialize storage. Optional — auto-called on first capture. */
  async init(): Promise<void> {
    if (this.ready) return;
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = this.doInit();
    return this.readyPromise;
  }

  private async doInit(): Promise<void> {
    await this.storage.ensureReady();

    // Load seed patterns on first init
    if (!this.seeded) {
      try {
        const { patterns } = loadAllSeedPatterns();
        for (const pattern of patterns) {
          try {
            this.storage.addPattern(pattern);
          } catch {
            // Pattern already exists
          }
        }
      } catch {
        // Seed patterns are optional
      }
      this.seeded = true;
    }

    this.ready = true;
  }

  private ensureReady(): void {
    if (!this.ready) {
      // Synchronous init path — start async init but don't wait
      // Storage operations will queue internally
      if (!this.readyPromise) {
        this.readyPromise = this.doInit();
      }
    }
  }

  // ── Symbol Context ──────────────────────────────────────────────

  /**
   * Create a component context for scoped error capture.
   *
   * @param id - Component symbol (e.g. '#checkout' or 'checkout')
   * @returns ComponentContext with capture() and wrap() methods
   */
  component(id: string): ComponentContext {
    const componentId = ensurePrefix(id, '#');
    const self = this;

    return {
      id: componentId,

      capture(error: Error, extra?: Record<string, unknown>): string {
        return self.capture(error, { component: componentId, ...extra as any });
      },

      wrap<T extends (...args: any[]) => any>(fn: T): T {
        const wrapped = ((...args: any[]) => {
          try {
            const result = fn(...args);
            // Handle async functions
            if (result && typeof result.catch === 'function') {
              return result.catch((err: Error) => {
                self.capture(err, { component: componentId });
                throw err;
              });
            }
            return result;
          } catch (err) {
            if (err instanceof Error) {
              self.capture(err, { component: componentId });
            }
            throw err;
          }
        }) as T;
        return wrapped;
      },
    };
  }

  /**
   * Record a gate check result.
   * If the gate fails, auto-captures an incident.
   *
   * @param id - Gate symbol (e.g. '^authenticated' or 'authenticated')
   * @param passed - Whether the gate passed
   */
  gate(id: string, passed: boolean): void {
    if (!passed) {
      const gateId = ensurePrefix(id, '^');
      this.capture(new Error(`Gate ${gateId} failed`), { gate: gateId });
    }
  }

  /**
   * Record a signal emission. Primarily for flow tracking context.
   *
   * @param id - Signal symbol (e.g. '!payment-authorized' or 'payment-authorized')
   */
  signal(id: string, _data?: object): void {
    // Signals are tracked through flow context.
    // Standalone signal recording is a no-op for now —
    // future: could log to a signal timeline.
    void ensurePrefix(id, '!');
  }

  // ── Flow Tracking ───────────────────────────────────────────────

  /**
   * Create a flow tracker for monitoring multi-step operations.
   *
   * @param id - Flow symbol (e.g. '$checkout-flow' or 'checkout-flow')
   * @returns FlowTracker instance
   */
  flow(id: string): FlowTracker {
    return new FlowTracker(id, this);
  }

  // ── Error Capture ───────────────────────────────────────────────

  /**
   * Capture an error with symbolic context.
   *
   * @param error - The error to capture
   * @param context - Symbolic context (component, gate, flow, signal)
   * @param flowPosition - Optional flow position data
   * @returns Incident ID (e.g. 'INC-001')
   */
  capture(
    error: Error,
    context?: Partial<SymbolicContext>,
    flowPosition?: FlowPosition,
  ): string {
    this.ensureReady();

    const input: CreateIncidentInput = {
      error: {
        message: error.message,
        stack: error.stack,
        type: error.constructor.name !== 'Error' ? error.constructor.name : undefined,
      },
      symbols: context || {},
      environment: this.config.environment || 'development',
      service: this.config.service,
      version: this.config.version,
      flowPosition,
    };

    const incidentId = this.storage.recordIncident(input);

    // Try to match patterns
    const incident = this.storage.getIncident(incidentId);
    if (incident && this.config.onCapture) {
      this.config.onCapture(incident);
    }

    return incidentId;
  }

  /**
   * Get pattern matches for a captured incident.
   *
   * @param incidentId - The incident ID to match
   * @returns Array of pattern matches sorted by confidence
   */
  match(incidentId: string): PatternMatch[] {
    const incident = this.storage.getIncident(incidentId);
    if (!incident) return [];
    return this.matcher.match(incident);
  }

  // ── Framework Integration ───────────────────────────────────────

  /**
   * Create Express error-handling middleware.
   *
   * Usage:
   *   app.use(sentinel.express());
   */
  express(): any {
    // Dynamic import to avoid requiring express as a dependency
    const self = this;
    return (err: Error, req: any, res: any, next: any) => {
      const context: Partial<SymbolicContext> = {};

      // Auto-detect component from route path
      const routeParts = (req.path || req.url || '').split('/').filter(Boolean);
      if (routeParts.length >= 2) {
        context.component = `#${routeParts[1]}`;
      }

      const incidentId = self.capture(err, context);

      // Attach incident ID to response for debugging
      if (res.setHeader) {
        res.setHeader('X-Sentinel-Incident', incidentId);
      }

      next(err);
    };
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  /** Close the database connection. Call when shutting down. */
  close(): void {
    this.storage.close();
    this.ready = false;
    this.readyPromise = null;
  }

  /** Get the underlying storage instance (for advanced usage). */
  getStorage(): SentinelStorage {
    return this.storage;
  }

  /** Get the underlying pattern matcher (for advanced usage). */
  getMatcher(): PatternMatcher {
    return this.matcher;
  }
}
