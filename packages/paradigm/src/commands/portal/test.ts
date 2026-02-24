/**
 * paradigm gate test command
 */

import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import { generateTests } from '@a-company/portal-manager';
import { scanComponents, generateComponentReport } from '@a-company/portal-manager';
import { validateGateway } from '@a-company/portal-manager';
import { parseGateConfig } from '@a-company/portal-core';
import { setGateClient, createGate } from '@a-company/portal-sdk';
import type { GatewayTestCase } from '@a-company/portal-manager';
import type { Gate } from '@a-company/portal-core';

/**
 * Options for gate test command
 */
interface GateTestOptions {
  /** Generate test files */
  generate?: boolean;
  /** Test specific gate */
  gate?: string;
  /** Validate component access */
  component?: boolean;
  /** Test framework */
  framework?: 'jest' | 'vitest' | 'mocha';
  /** Output directory */
  output?: string;
}

/**
 * Extract property paths from a JavaScript expression.
 * Parses patterns like `req.user`, `entity.roles.includes(...)`, `obj.id !== null`
 * and returns the root property paths referenced.
 */
function extractPropertiesFromExpression(expr: string): string[] {
  // Match property access patterns: word.word, word.word.word, etc.
  const propPattern = /\b([a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)+)/g;
  const matches = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = propPattern.exec(expr)) !== null) {
    matches.add(match[1]);
  }

  return [...matches];
}

/**
 * Build a minimal test entity that satisfies a property path.
 * e.g., "req.user.id" → { req: { user: { id: "test-value" } } }
 */
function buildEntityFromPath(path: string): Record<string, unknown> {
  const parts = path.split('.');
  const root: Record<string, unknown> = {};
  let current: Record<string, unknown> = root;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i === parts.length - 1) {
      // Leaf — assign a plausible test value
      current[part] = 'test-value';
    } else {
      const next: Record<string, unknown> = {};
      current[part] = next;
      current = next;
    }
  }

  return root;
}

/**
 * Deep merge two objects (second wins on conflict).
 */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      result[key] &&
      typeof result[key] === 'object' &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Auto-generate test cases by introspecting gate lock key expressions.
 * Parses each lock's key expressions to discover required entity properties
 * and produces a passing fixture and per-lock failure fixtures.
 */
function generateTestCasesFromLocks(gate: Gate): GatewayTestCase[] {
  const cases: GatewayTestCase[] = [];

  if (!gate.locks || gate.locks.length === 0) {
    // No locks — gate always passes
    cases.push({
      name: `${gate.id}: no locks (should pass)`,
      entity: { user: { id: 'test-user' } },
      expected: true,
    });
    return cases;
  }

  // Build a "full" entity that satisfies all locks
  let fullEntity: Record<string, unknown> = {};

  for (const lock of gate.locks) {
    for (const key of lock.keys) {
      const paths = extractPropertiesFromExpression(key.expression);
      for (const p of paths) {
        const partial = buildEntityFromPath(p);
        fullEntity = deepMerge(fullEntity, partial);
      }
    }
  }

  // Passing case with all properties present
  cases.push({
    name: `${gate.id}: entity satisfying all locks (should pass)`,
    entity: fullEntity,
    expected: true,
  });

  // Per-lock failure cases: omit properties for each lock
  for (const lock of gate.locks) {
    const lockPaths: string[] = [];
    for (const key of lock.keys) {
      lockPaths.push(...extractPropertiesFromExpression(key.expression));
    }

    if (lockPaths.length > 0) {
      // Build entity missing this lock's required properties
      const missingEntity: Record<string, unknown> = {};
      for (const otherLock of gate.locks) {
        if (otherLock.id === lock.id) continue;
        for (const key of otherLock.keys) {
          const paths = extractPropertiesFromExpression(key.expression);
          for (const p of paths) {
            const partial = buildEntityFromPath(p);
            Object.assign(missingEntity, deepMerge(missingEntity, partial));
          }
        }
      }

      cases.push({
        name: `${gate.id}: missing lock "${lock.id}" properties (should fail)`,
        entity: gate.locks.length === 1 ? {} : missingEntity,
        expected: false,
      });
    }
  }

  return cases;
}

/**
 * Gate test command handler
 */
export async function gateTestCommand(
  targetPath: string | undefined,
  options: GateTestOptions
): Promise<void> {
  const rootDir = targetPath ? path.resolve(targetPath) : process.cwd();
  const gateConfigPath = path.join(rootDir, 'portal.yaml');

  if (!fs.existsSync(gateConfigPath)) {
    console.error(chalk.red(`❌ portal.yaml not found at ${gateConfigPath}`));
    console.error(chalk.gray('   Run `paradigm init` or create portal.yaml manually'));
    process.exit(1);
  }

  // Generate test files
  if (options.generate) {
    console.log(chalk.blue('\n🔧 Generating test files...\n'));

    try {
      const generatedFiles = await generateTests(gateConfigPath, {
        outputDir: options.output || 'tests/gates',
        framework: options.framework || 'jest',
        includeFlows: true,
      });

      console.log(chalk.green(`✅ Generated ${generatedFiles.length} test files:`));
      for (const file of generatedFiles) {
        console.log(chalk.gray(`   ${path.relative(rootDir, file)}`));
      }
      console.log('');
    } catch (error) {
      console.error(chalk.red(`❌ Error generating tests: ${(error as Error).message}`));
      process.exit(1);
    }
    return;
  }

  // Validate component access
  if (options.component) {
    console.log(chalk.blue('\n🔍 Scanning components for gate checks...\n'));

    try {
      const components = await scanComponents({
        rootDir,
        gateConfigPath,
      });

      const report = generateComponentReport(components);
      console.log(report);

      const withMissing = components.filter((c) => c.missingChecks.length > 0);
      if (withMissing.length > 0) {
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red(`❌ Error scanning components: ${(error as Error).message}`));
      process.exit(1);
    }
    return;
  }

  // Test specific gate
  if (options.gate) {
    console.log(chalk.blue(`\n🧪 Testing gate: ${options.gate}\n`));

    try {
      const config = await parseGateConfig(gateConfigPath);
      const client = await createGate(gateConfigPath);
      setGateClient(client);

      const gate = config.gates.find((g) => g.id === options.gate);
      if (!gate) {
        console.error(chalk.red(`❌ Gate "${options.gate}" not found`));
        process.exit(1);
      }

      // Auto-generate test cases from gate lock expressions
      const testCases: GatewayTestCase[] = [
        {
          name: 'Empty entity (should fail)',
          entity: {},
          expected: false,
        },
        ...generateTestCasesFromLocks(gate),
      ];

      const result = await validateGateway(options.gate, testCases, client);

      if (result.passed) {
        console.log(chalk.green('✅ All tests passed\n'));
      } else {
        console.log(chalk.red('❌ Some tests failed\n'));
        for (const error of result.errors) {
          console.log(chalk.red(`   ${error}`));
        }
        console.log('');
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red(`❌ Error testing gate: ${(error as Error).message}`));
      process.exit(1);
    }
    return;
  }

  // Default: show help
  console.log(chalk.blue('\n🧪 Portal Testing\n'));
  console.log('Usage:');
  console.log('  paradigm portal test --generate             Generate test files');
  console.log('  paradigm portal test --portal ^auth-required  Test specific portal');
  console.log('  paradigm portal test --component             Validate component access');
  console.log('');
}
