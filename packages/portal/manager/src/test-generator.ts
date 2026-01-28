/**
 * Test file generator from portal.yaml configurations
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Gate, Flow } from '@a-company/portal-core';
import { parseGateConfig } from '@a-company/portal-core';

/**
 * Options for test generation
 */
export interface TestGeneratorOptions {
  /** Output directory for test files */
  outputDir?: string;
  /** Test framework to use */
  framework?: 'jest' | 'vitest' | 'mocha';
  /** Whether to generate flow tests */
  includeFlows?: boolean;
}

/**
 * Generate test files from a portal.yaml configuration
 *
 * @param gateConfigPath - Path to portal.yaml file
 * @param options - Generation options
 * @returns Array of generated test file paths
 */
export async function generateTests(
  gateConfigPath: string,
  options: TestGeneratorOptions = {}
): Promise<string[]> {
  const {
    outputDir = 'tests/gates',
    framework = 'jest',
    includeFlows = true,
  } = options;

  // Parse gate configuration
  const gateConfig = await parseGateConfig(gateConfigPath);
  const generatedFiles: string[] = [];

  // Ensure output directory exists
  const absOutputDir = path.resolve(outputDir);
  if (!fs.existsSync(absOutputDir)) {
    fs.mkdirSync(absOutputDir, { recursive: true });
  }

  // Generate tests for each gate
  for (const gate of gateConfig.gates) {
    const testFile = generateGateTest(gate, framework);
    const fileName = `${gate.id.replace(/[^a-z0-9]/gi, '-')}.test.ts`;
    const filePath = path.join(absOutputDir, fileName);

    fs.writeFileSync(filePath, testFile, 'utf8');
    generatedFiles.push(filePath);
  }

  // Generate flow tests if requested
  if (includeFlows && gateConfig.flows.length > 0) {
    const flowsDir = path.join(absOutputDir, '..', 'flows');
    if (!fs.existsSync(flowsDir)) {
      fs.mkdirSync(flowsDir, { recursive: true });
    }

    for (const flow of gateConfig.flows) {
      const testFile = generateFlowTest(flow, gateConfig.gates, framework);
      const fileName = `${flow.id.replace(/[^a-z0-9]/gi, '-')}.test.ts`;
      const filePath = path.join(flowsDir, fileName);

      fs.writeFileSync(filePath, testFile, 'utf8');
      generatedFiles.push(filePath);
    }
  }

  return generatedFiles;
}

/**
 * Generate test file content for a single gate
 */
function generateGateTest(gate: Gate, framework: 'jest' | 'vitest' | 'mocha'): string {
  const testFn = framework === 'mocha' ? 'it' : framework === 'vitest' ? 'it' : 'test';

  const gateId = gate.id;
  const gateName = gate.description || gateId;

  // Generate test cases for each lock
  const lockTests = gate.locks.map((lock) => {
    const lockTests = lock.keys.map((key, idx) => {
      return `    ${testFn}('should check key: ${key.description || `Key ${idx + 1}`}', async () => {
      const entity = {
        // TODO: Add entity properties needed for this key
        // Key expression: ${key.expression}
      };

      const result = await checkGateway('${gateId}', entity);
      // TODO: Assert expected result
      expect(result.passed).toBeDefined();
    });`;
    });

    return `  describe('Lock: ${lock.description || lock.id}', () => {
${lockTests.join('\n\n')}
  });`;
  });

  return `/**
 * Generated test file for gate: ${gateName}
 * Gate ID: ${gateId}
 * 
 * TODO: Fill in entity mock data and expected results
 */

import { checkGateway, validateGateway } from '@a-company/portal-manager';
import { createGate, setGateClient } from '@a-company/portal-sdk';
import { parseGateConfig } from '@a-company/portal-core';

${framework === 'vitest' ? "import { describe, it, expect, beforeAll } from 'vitest';" : framework === 'mocha' ? "import { describe, it } from 'mocha';" : "import { describe, test as it, expect, beforeAll } from '@jest/globals';"}

describe('Gate: ${gateName}', () => {
  beforeAll(async () => {
    // Load gate configuration
    const config = await parseGateConfig('./portal.yaml');
    const client = createGate(config);
    setGateClient(client);
  });

${lockTests.join('\n\n')}

  ${testFn}('should trigger prizes when gate passes', async () => {
    const entity = {
      // TODO: Add entity that passes all locks
    };

    const result = await checkGateway('${gateId}', entity);
    
    if (result.passed) {
      expect(result.triggeredPrizes.length).toBeGreaterThan(0);
      // TODO: Assert specific prizes
      ${gate.prizes.map((p) => `// expect(result.triggeredPrizes).toContainEqual(expect.objectContaining({ id: '${p.id}' }));`).join('\n      ')}
    }
  });
});
`;
}

/**
 * Generate test file content for a flow
 */
function generateFlowTest(
  flow: Flow,
  _gates: Gate[],
  framework: 'jest' | 'vitest' | 'mocha'
): string {
  const testFn = framework === 'mocha' ? 'it' : framework === 'vitest' ? 'it' : 'test';

  const flowName = flow.description || flow.id;

  const gateTests = flow.gates.map((gateId, idx) => {
    return `    ${testFn}('should pass gate ${idx + 1}: ${gateId}', async () => {
      const entity = {
        // TODO: Add entity properties
      };

      const result = await checkGateway('${gateId}', entity);
      expect(result.passed).toBe(true);
    });`;
  });

  return `/**
 * Generated test file for flow: ${flowName}
 * Flow ID: ${flow.id}
 * 
 * TODO: Fill in entity mock data for each gate in the flow
 */

import { checkGateway } from '@a-company/portal-manager';
import { createGate, setGateClient } from '@a-company/portal-sdk';
import { parseGateConfig } from '@a-company/portal-core';

${framework === 'vitest' ? "import { describe, it, expect, beforeAll } from 'vitest';" : framework === 'mocha' ? "import { describe, it } from 'mocha';" : "import { describe, test as it, expect, beforeAll } from '@jest/globals';"}

describe('Flow: ${flowName}', () => {
  beforeAll(async () => {
    const config = await parseGateConfig('./portal.yaml');
    const client = createGate(config);
    setGateClient(client);
  });

  ${testFn}('should complete entire flow', async () => {
    const entity = {
      // TODO: Add entity that passes all gates in flow
    };

${gateTests.join('\n\n')}
  });
});
`;
}
