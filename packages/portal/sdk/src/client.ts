/**
 * Gate SDK Client
 *
 * Main entry point for checking gates and registering prize handlers.
 */

import type {
  ParsedGateConfig,
  Gate,
  Prize,
  GateCheckResult,
  LockResult,
  KeyResult,
  WatcherEvent,
} from '@a-company/portal-core';
import { parseGateConfig } from '@a-company/portal-core';
import { evaluateExpression } from './evaluator.js';

interface PrizeHandler {
  (entity: Record<string, unknown>, context: PrizeContext): void | Promise<void>;
}

interface PrizeContext {
  gate: Gate;
  prize: Prize;
  timestamp: number;
}

interface GateClientOptions {
  /** Connect to watcher in development mode */
  devMode?: boolean;
  /** Watcher WebSocket URL */
  watcherUrl?: string;
  /** Entity ID resolver for watcher events */
  entityIdResolver?: (entity: Record<string, unknown>) => string;
}

interface FiredPrize {
  entityId: string;
  prizeId: string;
  timestamp: number;
}

export class GateClient {
  private config: ParsedGateConfig;
  private prizeHandlers: Map<string, PrizeHandler[]> = new Map();
  private firedPrizes: FiredPrize[] = [];
  private ws: WebSocket | null = null;
  private options: GateClientOptions;
  private entityIdResolver: (entity: Record<string, unknown>) => string;

  constructor(config: ParsedGateConfig, options: GateClientOptions = {}) {
    this.config = config;
    this.options = options;
    this.entityIdResolver = options.entityIdResolver || this.defaultEntityIdResolver;

    // Connect to watcher in dev mode
    if (options.devMode) {
      this.connectWatcher();
    }
  }

  /**
   * Default entity ID resolver - looks for id, _id, userId, entityId
   */
  private defaultEntityIdResolver(entity: Record<string, unknown>): string {
    return (entity.id || entity._id || entity.userId || entity.entityId || 'anonymous') as string;
  }

  /**
   * Connect to the Gate watcher server
   */
  private connectWatcher(): void {
    const url = this.options.watcherUrl || `ws://localhost:${this.config.settings.dev.watcherPort}`;

    try {
      // Check if we're in a browser environment
      if (typeof WebSocket !== 'undefined') {
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          console.log('[Gate SDK] Connected to watcher');
        };

        this.ws.onerror = () => {
          console.warn('[Gate SDK] Failed to connect to watcher');
        };

        this.ws.onclose = () => {
          // Attempt to reconnect after 5 seconds
          setTimeout(() => this.connectWatcher(), 5000);
        };
      }
    } catch {
      // WebSocket not available (e.g., Node.js without ws package)
      console.warn('[Gate SDK] WebSocket not available for watcher connection');
    }
  }

  /**
   * Send event to watcher
   */
  private sendWatcherEvent(event: WatcherEvent): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
    }
  }

  /**
   * Register a handler for a prize
   */
  onPrize(prizeId: string, handler: PrizeHandler): () => void {
    if (!this.prizeHandlers.has(prizeId)) {
      this.prizeHandlers.set(prizeId, []);
    }
    this.prizeHandlers.get(prizeId)!.push(handler);

    // Return unsubscribe function
    return () => {
      const handlers = this.prizeHandlers.get(prizeId);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index >= 0) {
          handlers.splice(index, 1);
        }
      }
    };
  }

  /**
   * Check if an entity can pass through a gate
   */
  async check(gateId: string, entity: Record<string, unknown>): Promise<GateCheckResult> {
    const gate = this.config.gates.find((g) => g.id === gateId);

    if (!gate) {
      throw new Error(`Gate not found: ${gateId}`);
    }

    const entityId = this.entityIdResolver(entity);
    const timestamp = Date.now();

    // Send check event
    this.sendWatcherEvent({
      type: 'gate:check',
      timestamp,
      entityId,
      data: { gate, entitySnapshot: entity },
    });

    // Evaluate all locks
    const lockResults: LockResult[] = [];
    let allLocksPassed = true;

    for (const lock of gate.locks) {
      const keyResults: KeyResult[] = [];
      let lockPassed: boolean;

      // Evaluate keys based on mode
      if (lock.mode === 'any') {
        // ANY mode: at least one key must match
        lockPassed = false;
        for (const key of lock.keys) {
          const { passed, error } = evaluateExpression(key.expression, entity);
          keyResults.push({ key, passed, error });
          if (passed) {
            lockPassed = true;
          }
        }
      } else {
        // ALL mode (default): all keys must match
        lockPassed = true;
        for (const key of lock.keys) {
          const { passed, error } = evaluateExpression(key.expression, entity);
          keyResults.push({ key, passed, error });
          if (!passed) {
            lockPassed = false;
          }
        }
      }

      lockResults.push({
        lock,
        passed: lockPassed,
        keyResults,
      });

      if (!lockPassed) {
        allLocksPassed = false;
      }
    }

    // Determine triggered prizes
    const triggeredPrizes: Prize[] = [];

    if (allLocksPassed) {
      for (const prize of gate.prizes) {
        // Check if one-time prize was already fired
        if (prize.oneTime) {
          const alreadyFired = this.firedPrizes.some(
            (fp) => fp.entityId === entityId && fp.prizeId === prize.id
          );
          if (alreadyFired) {
            continue;
          }
        }

        triggeredPrizes.push(prize);

        // Record one-time prizes
        if (prize.oneTime) {
          this.firedPrizes.push({
            entityId,
            prizeId: prize.id,
            timestamp,
          });
        }

        // Fire prize handlers
        const handlers = this.prizeHandlers.get(prize.id) || [];
        for (const handler of handlers) {
          try {
            await handler(entity, {
              gate,
              prize,
              timestamp,
            });
          } catch (error) {
            console.error(`[Gate SDK] Prize handler error for ${prize.id}:`, error);
          }
        }

        // Send prize event
        this.sendWatcherEvent({
          type: 'prize:fire',
          timestamp: Date.now(),
          entityId,
          data: { prizeId: prize.id, metadata: prize.metadata },
        });
      }
    }

    const result: GateCheckResult = {
      gate,
      passed: allLocksPassed,
      lockResults,
      triggeredPrizes,
      timestamp,
      entitySnapshot: entity,
    };

    // Send pass/fail event
    this.sendWatcherEvent({
      type: allLocksPassed ? 'gate:pass' : 'gate:fail',
      timestamp: Date.now(),
      entityId,
      data: result,
    });

    return result;
  }

  /**
   * Get a gate by ID
   */
  getGate(gateId: string): Gate | undefined {
    return this.config.gates.find((g) => g.id === gateId);
  }

  /**
   * Get all gates
   */
  getGates(): Gate[] {
    return this.config.gates;
  }

  /**
   * Get all flows
   */
  getFlows() {
    return this.config.flows;
  }

  /**
   * Reset fired prizes for an entity (useful for testing)
   */
  resetPrizes(entityId?: string): void {
    if (entityId) {
      this.firedPrizes = this.firedPrizes.filter((fp) => fp.entityId !== entityId);
    } else {
      this.firedPrizes = [];
    }
  }

  /**
   * Disconnect from watcher
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

/**
 * Create a Gate client from a configuration file
 */
export async function createGate(configPath: string, options: GateClientOptions = {}): Promise<GateClient> {
  const config = await parseGateConfig(configPath);

  // Default to dev mode in non-production environments
  const devMode = options.devMode ?? process.env.NODE_ENV !== 'production';

  return new GateClient(config, {
    ...options,
    devMode,
  });
}
