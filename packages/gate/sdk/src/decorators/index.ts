/**
 * Gate decorators for TypeScript classes
 */

import type { GateClient } from '../client.js';

// Store for the global gate client
let globalGateClient: GateClient | null = null;

/**
 * Set the global gate client for decorators
 */
export function setGateClient(client: GateClient): void {
  globalGateClient = client;
}

/**
 * Get the global gate client
 */
export function getGateClient(): GateClient | null {
  return globalGateClient;
}

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
 * Default entity resolver - uses first argument as entity
 */
const defaultEntityResolver: EntityResolver = (_target, args) => {
  const firstArg = args[0];
  if (firstArg && typeof firstArg === 'object') {
    return firstArg as Record<string, unknown>;
  }
  return {};
};

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
export function GateGuard(gateId: string, options: GateGuardOptions = {}) {
  const {
    entityResolver = defaultEntityResolver,
    onFail = 'throw',
    errorMessage = `Access denied: failed to pass gate "${gateId}"`,
  } = options;

  return function (
    _target: unknown,
    _propertyKey: string,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: unknown[]) {
      if (!globalGateClient) {
        throw new Error('[GateGuard] No gate client configured. Call setGateClient() first.');
      }

      const entity = entityResolver(this, args);
      const result = await globalGateClient.check(gateId, entity);

      if (!result.passed) {
        switch (onFail) {
          case 'return-null':
            return null;
          case 'return-false':
            return false;
          case 'throw':
          default:
            throw new Error(errorMessage);
        }
      }

      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}

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
export function GateCheck(gateId: string, options: { entityResolver?: EntityResolver } = {}) {
  const { entityResolver = defaultEntityResolver } = options;

  return function (
    _target: unknown,
    _propertyKey: string,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: unknown[]) {
      if (!globalGateClient) {
        console.warn('[GateCheck] No gate client configured');
        return originalMethod.apply(this, args);
      }

      const entity = entityResolver(this, args);
      const gateResult = await globalGateClient.check(gateId, entity);

      // Add gate result to context
      const context = this as Record<string, unknown>;
      context._gateResult = gateResult;

      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}
