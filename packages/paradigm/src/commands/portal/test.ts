/**
 * paradigm gate test command
 */

import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import { generateTests } from '@a-company/portal-manager';
import { scanComponents, generateComponentReport } from '@a-company/portal-manager';
import { checkGateway, validateGateway } from '@a-company/portal-manager';
import { parseGateConfig, createGate } from '@a-company/portal-core';
import { setGateClient } from '@a-company/portal-sdk';
import type { GatewayTestCase } from '@a-company/portal-manager';

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
      const client = createGate(config);
      setGateClient(client);

      const gate = config.gates.find((g) => g.id === options.gate);
      if (!gate) {
        console.error(chalk.red(`❌ Gate "${options.gate}" not found`));
        process.exit(1);
      }

      // Create basic test cases
      const testCases: GatewayTestCase[] = [
        {
          name: 'Empty entity (should fail)',
          entity: {},
          expected: false,
        },
        {
          name: 'Entity with required properties',
          entity: {
            // TODO: Add properties based on gate locks
            user: { id: 'test-user' },
          },
          expected: true,
        },
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
