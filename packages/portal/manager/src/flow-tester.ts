/**
 * Flow validation and testing
 */

import type { Flow, Gate, ParsedGateConfig } from '@a-company/portal-core';
import { checkGateway } from './gateway.js';
import type { FlowTestConfig } from './types.js';

/**
 * Test a flow with a given entity
 *
 * @param flow - Flow to test
 * @param gates - All gates in the configuration
 * @param entity - Entity to test with
 * @returns Results for each gate in the flow
 */
export async function testFlow(
  flow: Flow,
  _gates: Gate[],
  entity: Record<string, unknown>
): Promise<Array<{ gateId: string; passed: boolean; error?: string }>> {
  const results: Array<{ gateId: string; passed: boolean; error?: string }> = [];

  for (const gateId of flow.gates) {
    try {
      const result = await checkGateway(gateId, entity);
      results.push({
        gateId,
        passed: result.passed,
      });
    } catch (error) {
      results.push({
        gateId,
        passed: false,
        error: (error as Error).message,
      });
    }
  }

  return results;
}

/**
 * Validate a flow configuration
 *
 * @param flow - Flow to validate
 * @param gates - All gates in the configuration
 * @returns Validation errors (empty if valid)
 */
export function validateFlowConfig(flow: Flow, gates: Gate[]): string[] {
  const errors: string[] = [];

  // Check that all gates in flow exist
  for (const gateId of flow.gates) {
    const gate = gates.find((g) => g.id === gateId);
    if (!gate) {
      errors.push(`Flow "${flow.id}" references non-existent gate: ${gateId}`);
    }
  }

  // Check for circular dependencies (simplified)
  const visited = new Set<string>();
  for (const gateId of flow.gates) {
    if (visited.has(gateId)) {
      errors.push(`Flow "${flow.id}" has duplicate gate: ${gateId}`);
    }
    visited.add(gateId);
  }

  return errors;
}

/**
 * Run flow test scenarios
 *
 * @param config - Flow test configuration
 * @param gateConfig - Parsed gate configuration
 * @returns Test results
 */
export async function runFlowTests(
  config: FlowTestConfig,
  gateConfig: ParsedGateConfig
): Promise<{
  passed: boolean;
  results: Array<{
    scenario: string;
    passed: boolean;
    gateResults: Array<{ gateId: string; passed: boolean }>;
    errors: string[];
  }>;
}> {
  const flow = gateConfig.flows.find((f) => f.id === config.flowId);
  if (!flow) {
    return {
      passed: false,
      results: [
        {
          scenario: 'Flow not found',
          passed: false,
          gateResults: [],
          errors: [`Flow "${config.flowId}" not found in configuration`],
        },
      ],
    };
  }

  const results: Array<{
    scenario: string;
    passed: boolean;
    gateResults: Array<{ gateId: string; passed: boolean }>;
    errors: string[];
  }> = [];

  for (const scenario of config.scenarios) {
    const gateResults: Array<{ gateId: string; passed: boolean }> = [];
    const errors: string[] = [];

    // Test each gate in expected path
    for (const gateId of scenario.expectedPath) {
      try {
        const result = await checkGateway(gateId, scenario.entity);
        gateResults.push({
          gateId,
          passed: result.passed,
        });

        if (!result.passed) {
          errors.push(`Gate ${gateId} failed for scenario "${scenario.name}"`);
        }
      } catch (error) {
        gateResults.push({
          gateId,
          passed: false,
        });
        errors.push(`Gate ${gateId} error: ${(error as Error).message}`);
      }
    }

    // Check if path matches expected
    const passed = gateResults.every((r) => r.passed) && errors.length === 0;
    results.push({
      scenario: scenario.name,
      passed,
      gateResults,
      errors,
    });
  }

  return {
    passed: results.every((r) => r.passed),
    results,
  };
}
