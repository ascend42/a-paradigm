import * as _horizon_gate_core from '@horizon/gate-core';
import { ParsedGateConfig, Gate, Prize, GateCheckResult } from '@horizon/gate-core';

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
declare class GateClient {
    private config;
    private prizeHandlers;
    private firedPrizes;
    private ws;
    private options;
    private entityIdResolver;
    constructor(config: ParsedGateConfig, options?: GateClientOptions);
    /**
     * Default entity ID resolver - looks for id, _id, userId, entityId
     */
    private defaultEntityIdResolver;
    /**
     * Connect to the Gate watcher server
     */
    private connectWatcher;
    /**
     * Send event to watcher
     */
    private sendWatcherEvent;
    /**
     * Register a handler for a prize
     */
    onPrize(prizeId: string, handler: PrizeHandler): () => void;
    /**
     * Check if an entity can pass through a gate
     */
    check(gateId: string, entity: Record<string, unknown>): Promise<GateCheckResult>;
    /**
     * Get a gate by ID
     */
    getGate(gateId: string): Gate | undefined;
    /**
     * Get all gates
     */
    getGates(): Gate[];
    /**
     * Get all flows
     */
    getFlows(): _horizon_gate_core.Flow[];
    /**
     * Reset fired prizes for an entity (useful for testing)
     */
    resetPrizes(entityId?: string): void;
    /**
     * Disconnect from watcher
     */
    disconnect(): void;
}
/**
 * Create a Gate client from a configuration file
 */
declare function createGate(configPath: string, options?: GateClientOptions): Promise<GateClient>;

/**
 * Gate decorators for TypeScript classes
 */

/**
 * Set the global gate client for decorators
 */
declare function setGateClient(client: GateClient): void;
/**
 * Get the global gate client
 */
declare function getGateClient(): GateClient | null;
/**
 * Entity resolver function type
 */
type EntityResolver = (target: unknown, args: unknown[]) => Record<string, unknown>;
/**
 * Options for the GateGuard decorator
 */
interface GateGuardOptions {
    /** Custom entity resolver function */
    entityResolver?: EntityResolver;
    /** What to do when gate check fails */
    onFail?: 'throw' | 'return-null' | 'return-false';
    /** Custom error message */
    errorMessage?: string;
}
/**
 * GateGuard decorator - ensures entity passes gate before method executes
 *
 * @example
 * class CheckoutService {
 *   @GateGuard('checkout')
 *   async processCheckout(entity: Entity) {
 *     // Only runs if entity passes checkout gate
 *   }
 * }
 */
declare function GateGuard(gateId: string, options?: GateGuardOptions): (_target: unknown, _propertyKey: string, descriptor: PropertyDescriptor) => PropertyDescriptor;
/**
 * GateCheck decorator - checks gate but doesn't block execution
 * Adds `_gateResult` to the method context
 *
 * @example
 * class UserService {
 *   @GateCheck('premium-features')
 *   async getFeatures(user: User) {
 *     // Always runs, but _gateResult is available
 *   }
 * }
 */
declare function GateCheck(gateId: string, options?: {
    entityResolver?: EntityResolver;
}): (_target: unknown, _propertyKey: string, descriptor: PropertyDescriptor) => PropertyDescriptor;

export { GateClient as G, GateGuard as a, GateCheck as b, createGate as c, getGateClient as g, setGateClient as s };
