/**
 * Type definitions for Gate Manager
 */

import type { GateCheckResult } from '@horizon/gate-core';

/**
 * Options for Gateway decorator
 */
export interface GatewayOptions {
  /** Custom entity resolver function */
  entityResolver?: (target: unknown, args: unknown[]) => Record<string, unknown>;
  /** What to do when gate check fails */
  onFail?: 'throw' | 'return-null' | 'return-false';
  /** Custom error message */
  errorMessage?: string;
}

/**
 * Test case for gateway validation
 */
export interface GatewayTestCase {
  /** Test case name */
  name: string;
  /** Entity to test with */
  entity: Record<string, unknown>;
  /** Expected result */
  expected: boolean;
  /** Expected prizes to be triggered */
  expectedPrizes?: string[];
}

/**
 * Validation result for gateway tests
 */
export interface ValidationResult {
  /** Whether all tests passed */
  passed: boolean;
  /** Test results */
  results: Array<{
    testCase: GatewayTestCase;
    result: GateCheckResult;
    passed: boolean;
  }>;
  /** Errors encountered */
  errors: string[];
}

/**
 * Component access information
 */
export interface ComponentAccessInfo {
  /** Component file path */
  filePath: string;
  /** Component name */
  componentName: string;
  /** Required gates */
  requiredGates: string[];
  /** Missing gate checks */
  missingChecks: string[];
}

/**
 * Flow test configuration
 */
export interface FlowTestConfig {
  /** Flow ID */
  flowId: string;
  /** Test scenarios */
  scenarios: Array<{
    name: string;
    entity: Record<string, unknown>;
    expectedPath: string[];
  }>;
}
