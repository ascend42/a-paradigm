/**
 * Gateway decorators and runtime check functions
 */

import type { GateClient } from '@horizon/gate-sdk';
import { getGateClient } from '@horizon/gate-sdk/decorators';
import type { GateCheckResult } from '@horizon/gate-core';
import type { GatewayOptions, GatewayTestCase, ValidationResult } from './types.js';

/**
 * Entity resolver function type
 */
type EntityResolver = (target: unknown, args: unknown[]) => Record<string, unknown>;

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
 * Gateway decorator - marks a method as a gate checkpoint
 * Similar to GateGuard but adds metadata for test generation
 *
 * @example
 * class CheckoutService {
 *   @Gateway('^premium-checkout')
 *   async processCheckout(entity: Entity) {
 *     // Gate checkpoint marked for testing
 *   }
 * }
 */
export function Gateway(gateId: string, options: GatewayOptions = {}) {
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
      const client = getGateClient();
      if (!client) {
        throw new Error(`[Gateway] No gate client configured. Call setGateClient() first.`);
      }

      const entity = entityResolver(this, args);
      const result = await client.check(gateId, entity);

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

    // Add metadata for test generation
    const metadata = {
      gateId,
      methodName: _propertyKey as string,
    };
    (descriptor.value as unknown as { __gatewayMetadata?: typeof metadata }).__gatewayMetadata = metadata;

    return descriptor;
  };
}

/**
 * Check a gateway at runtime
 *
 * @param gateId - Gate identifier (e.g., "^auth-required")
 * @param entity - Entity to check
 * @returns Gate check result
 */
export async function checkGateway(
  gateId: string,
  entity: Record<string, unknown>,
  client?: GateClient
): Promise<GateCheckResult> {
  const gateClient = client || getGateClient();
  if (!gateClient) {
    throw new Error('[checkGateway] No gate client configured. Call setGateClient() first.');
  }

  return gateClient.check(gateId, entity);
}

/**
 * Validate a gateway with test cases
 *
 * @param gateId - Gate identifier
 * @param testCases - Test cases to run
 * @param client - Optional gate client (uses global if not provided)
 * @returns Validation result
 */
export async function validateGateway(
  gateId: string,
  testCases: GatewayTestCase[],
  client?: GateClient
): Promise<ValidationResult> {
  const gateClient = client || getGateClient();
  if (!gateClient) {
    return {
      passed: false,
      results: [],
      errors: ['No gate client configured'],
    };
  }

  const results: ValidationResult['results'] = [];
  const errors: string[] = [];

  for (const testCase of testCases) {
    try {
      const result = await gateClient.check(gateId, testCase.entity);
      const passed = result.passed === testCase.expected;

      // Check prizes if expected
      if (testCase.expectedPrizes && result.passed) {
        const triggeredPrizeIds = result.triggeredPrizes.map((p) => p.id);
        const missingPrizes = testCase.expectedPrizes.filter(
          (id) => !triggeredPrizeIds.includes(id)
        );
        if (missingPrizes.length > 0) {
          errors.push(
            `Test "${testCase.name}": Expected prizes not triggered: ${missingPrizes.join(', ')}`
          );
        }
      }

      results.push({
        testCase,
        result,
        passed,
      });

      if (!passed) {
        errors.push(
          `Test "${testCase.name}": Expected ${testCase.expected ? 'pass' : 'fail'}, got ${result.passed ? 'pass' : 'fail'}`
        );
      }
    } catch (error) {
      errors.push(`Test "${testCase.name}": ${(error as Error).message}`);
      results.push({
        testCase,
        result: {
          gate: { id: gateId, locks: [], prizes: [] },
          passed: false,
          lockResults: [],
          triggeredPrizes: [],
          timestamp: Date.now(),
        },
        passed: false,
      });
    }
  }

  return {
    passed: errors.length === 0,
    results,
    errors,
  };
}
