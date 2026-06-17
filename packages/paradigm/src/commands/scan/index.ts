/**
 * paradigm index - Generate scan index for visual discovery
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import * as yaml from 'js-yaml';
import { aggregateFromDirectory, type FlowIndex, type TestableFlow, type FlowStep } from '@a-company/premise-core';
import {
  generateScanIndex,
  serializeScanIndex,
  type ScanIndex
} from '@a-company/probe-core';
import { parseHorizonConfig } from '../../core/legacy-config.js';
import { generateNavigator } from './navigator.js';
import { cliBuildGraphState } from '../graph.js';

interface IndexOptions {
  output?: string;
  watch?: boolean;
  quiet?: boolean;
}

export async function indexCommand(targetPath: string | undefined, options: IndexOptions) {
  const rootDir = targetPath ? path.resolve(targetPath) : process.cwd();
  const projectName = path.basename(rootDir);
  const spinner = ora();

  // Determine output path
  // Handle both .paradigm as file (legacy) and .paradigm/ as directory
  const paradigmPath = path.join(rootDir, '.paradigm');
  const paradigmIsFile = fs.existsSync(paradigmPath) && fs.statSync(paradigmPath).isFile();

  let outputPath: string;
  if (options.output) {
    outputPath = path.resolve(options.output);
  } else if (paradigmIsFile) {
    // Legacy: .paradigm is a config file, put scan-index alongside it
    outputPath = path.join(rootDir, '.paradigm-scan-index.json');
  } else {
    // Modern: .paradigm is a directory
    outputPath = path.join(rootDir, '.paradigm', 'scan-index.json');
    // Ensure directory exists
    if (!fs.existsSync(path.dirname(outputPath))) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    }
  }

  if (!options.quiet) {
    console.log(chalk.blue('\n🔭 Generating Paradigm Scan Index\n'));
  }

  // Load paradigm config if exists (for custom settings)
  let scanConfig: { visualTagMappings?: Record<string, string[]>; screens?: Record<string, unknown> } | undefined;
  let graphConfig: { 'auto-generate'?: boolean } | undefined;
  let tierConfig: { 'hot-threshold'?: number; 'warm-threshold'?: number } | undefined;

  // Try both .paradigm (file) and .paradigm/config.yaml (directory)
  const configPaths = [
    path.join(rootDir, '.paradigm'),
    path.join(rootDir, '.paradigm', 'config.yaml'),
  ];

  for (const configPath of configPaths) {
    if (fs.existsSync(configPath) && fs.statSync(configPath).isFile()) {
      try {
        const content = fs.readFileSync(configPath, 'utf8');
        const config = parseHorizonConfig(content);
        const typedConfig = config as unknown as Record<string, unknown>;
        // Extract scan config if present
        scanConfig = typedConfig.scan as typeof scanConfig;
        graphConfig = typedConfig.graph as typeof graphConfig;
        const contextConfig = typedConfig.context as Record<string, unknown> | undefined;
        tierConfig = contextConfig?.tiers as typeof tierConfig;
        break;
      } catch {
        // Ignore config errors, use defaults
      }
    }
  }

  // Aggregate all symbols
  spinner.start('Aggregating symbols from purpose and portal files...');

  let aggregation;
  try {
    aggregation = await aggregateFromDirectory(rootDir);
  } catch (err) {
    spinner.fail(chalk.red('Failed to aggregate symbols'));
    console.error(chalk.gray((err as Error).message));
    process.exit(1);
  }

  spinner.succeed(`Found ${aggregation.symbols.length} symbols`);

  // Show breakdown
  if (!options.quiet) {
    const breakdown = {
      components: aggregation.symbols.filter(s => s.type === 'component').length,
      flows: aggregation.symbols.filter(s => s.type === 'flow').length,
      gates: aggregation.symbols.filter(s => s.type === 'gate').length,
      signals: aggregation.symbols.filter(s => s.type === 'signal').length,
      aspects: aggregation.symbols.filter(s => s.type === 'aspect').length,
    };

    console.log(chalk.gray('  Breakdown:'));
    for (const [type, count] of Object.entries(breakdown)) {
      if (count > 0) {
        console.log(chalk.gray(`    ${type}: ${count}`));
      }
    }
    console.log();
  }

  // Generate scan index
  spinner.start('Generating scan index...');

  const index = generateScanIndex(
    {
      symbols: aggregation.symbols,
      purposeFiles: aggregation.purposeFiles,
      portalFiles: aggregation.portalFiles,
    },
    {
      projectName,
      visualTagMappings: scanConfig?.visualTagMappings as Record<string, string[]> | undefined,
      screenDefinitions: scanConfig?.screens as Record<string, { route?: string; components?: string[]; features?: string[] }> | undefined,
    }
  );

  // Classify symbol tiers
  classifyTiers(index, { hot: tierConfig?.['hot-threshold'], warm: tierConfig?.['warm-threshold'] });

  // Write index
  try {
    fs.writeFileSync(outputPath, serializeScanIndex(index), 'utf8');
    spinner.succeed(chalk.green('Scan index generated'));
  } catch (err) {
    spinner.fail(chalk.red('Failed to write scan index'));
    console.error(chalk.gray((err as Error).message));
    process.exit(1);
  }

  // Generate navigator.yaml for AI exploration
  await generateNavigator(rootDir, aggregation, { quiet: options.quiet });

  // Generate flow index for testable flows
  const flowIndex = await generateFlowIndex(rootDir, aggregation.purposeFiles, { quiet: options.quiet });
  if (flowIndex && Object.keys(flowIndex.flows).length > 0) {
    const flowIndexPath = path.join(rootDir, '.paradigm', 'flow-index.json');
    fs.writeFileSync(flowIndexPath, JSON.stringify(flowIndex, null, 2), 'utf8');
    if (!options.quiet) {
      spinner.succeed(chalk.green(`Flow index generated (${Object.keys(flowIndex.flows).length} flows)`));
    }
  }

  // Auto-generate symbol graph (configurable via graph.auto-generate in config.yaml)
  const autoGenerate = graphConfig?.['auto-generate'] !== false; // default: true
  if (autoGenerate) {
    try {
      const graphState = cliBuildGraphState(rootDir);
      const graphsDir = path.join(rootDir, '.paradigm', 'graphs');
      if (!fs.existsSync(graphsDir)) fs.mkdirSync(graphsDir, { recursive: true });
      const graphPath = path.join(graphsDir, 'auto.graph.json');
      fs.writeFileSync(graphPath, JSON.stringify(graphState, null, 2), 'utf8');
      if (!options.quiet) {
        spinner.succeed(chalk.green(`Symbol graph updated (${graphState.nodes.length} nodes)`));
      }
    } catch {
      if (!options.quiet) {
        spinner.warn(chalk.yellow('Could not auto-generate symbol graph'));
      }
    }
  }

  // Summary
  if (!options.quiet) {
    console.log(chalk.gray(`\n  Output: ${outputPath}`));
    console.log(chalk.gray(`  Components: ${Object.keys(index.components).length}`));
    console.log(chalk.gray(`  Features: ${Object.keys(index.features).length}`));
    console.log(chalk.gray(`  Flows: ${Object.keys(index.flows).length}`));
    console.log(chalk.gray(`  State: ${Object.keys(index.state).length}`));
    console.log(chalk.gray(`  Gates: ${Object.keys(index.gates).length}`));
    console.log(chalk.gray(`  Signals: ${Object.keys(index.signals).length}`));
    console.log();
    console.log(chalk.blue('✨ Scan index ready for "paradigm probe" queries'));
    console.log(chalk.gray('   Attach an image and say "paradigm probe" to map UI to code\n'));
  }

  return index;
}

/**
 * Classify scan index entries into hot/warm/cold tiers based on cross-reference density.
 * Mutates the index entries in place, adding a `tier` property to each symbol.
 */
function classifyTiers(index: ScanIndex, config?: { hot?: number; warm?: number }): void {
  const hotThreshold = config?.hot ?? 15;
  const warmThreshold = config?.warm ?? 5;

  // Count cross-references for each symbol
  const refCounts = new Map<string, number>();
  const allSections = ['components', 'flows', 'gates', 'signals', 'aspects', 'features', 'state'] as const;

  // First pass: collect all references
  for (const section of allSections) {
    const entries = (index as unknown as Record<string, Record<string, Record<string, unknown>>>)[section];
    if (!entries) continue;
    for (const [, entry] of Object.entries(entries)) {
      const refs = entry.related as string[] | undefined;
      if (refs) {
        for (const ref of refs) {
          const stripped = ref.replace(/^[#$^!~]/, '');
          refCounts.set(stripped, (refCounts.get(stripped) || 0) + 1);
        }
      }
    }
  }

  // Second pass: assign tiers
  for (const section of allSections) {
    const entries = (index as unknown as Record<string, Record<string, Record<string, unknown>>>)[section];
    if (!entries) continue;
    for (const [id, entry] of Object.entries(entries)) {
      const refs = refCounts.get(id) || 0;
      const visualTags = (entry.visualTags as unknown[] | undefined) || [];
      const centrality = visualTags.length; // rough proxy
      const score = refs * 3 + centrality;

      entry.tier = score > hotThreshold ? 'hot' : score > warmThreshold ? 'warm' : 'cold';
    }
  }
}

/**
 * Get scan index path for a project (handles both .paradigm file and directory cases)
 */
export function getScanIndexPath(rootDir: string): string {
  const paradigmPath = path.join(rootDir, '.paradigm');
  const paradigmIsFile = fs.existsSync(paradigmPath) && fs.statSync(paradigmPath).isFile();

  return paradigmIsFile
    ? path.join(rootDir, '.paradigm-scan-index.json')
    : path.join(rootDir, '.paradigm', 'scan-index.json');
}

/**
 * Check if scan index exists
 */
export function scanIndexExists(rootDir: string): boolean {
  // Check both possible locations
  return (
    fs.existsSync(path.join(rootDir, '.paradigm', 'scan-index.json')) ||
    fs.existsSync(path.join(rootDir, '.paradigm-scan-index.json'))
  );
}

/**
 * Get scan index age in milliseconds
 */
export function getScanIndexAge(rootDir: string): number | null {
  // Try both possible locations
  const paths = [
    path.join(rootDir, '.paradigm', 'scan-index.json'),
    path.join(rootDir, '.paradigm-scan-index.json'),
  ];

  for (const indexPath of paths) {
    if (fs.existsSync(indexPath)) {
      try {
        const content = fs.readFileSync(indexPath, 'utf8');
        const index = JSON.parse(content) as ScanIndex;
        const generatedAt = new Date(index.$meta.generatedAt).getTime();
        return Date.now() - generatedAt;
      } catch {
        continue;
      }
    }
  }

  return null;
}

/**
 * Extended flow format in .purpose files that supports testable flows
 */
interface ExtendedFlowDefinition {
  description?: string;
  trigger?: string;
  steps?: Array<{
    id: string;
    action: string;
    symbol?: string;
    expect?: string;
  }>;
  validation?: {
    command?: string;
    manual?: string;
  };
  // Legacy fields
  gates?: string[];
  signals?: string[];
  components?: string[];
}

/**
 * Generate flow index from .purpose files
 * Parses extended flow definitions with steps and validation
 */
export async function generateFlowIndex(
  rootDir: string,
  purposeFiles: string[],
  options: { quiet?: boolean }
): Promise<FlowIndex | null> {
  const flows: Record<string, TestableFlow> = {};
  const symbolToFlows: Record<string, string[]> = {};

  for (const filePath of purposeFiles) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const data = yaml.load(content) as { flows?: Record<string, ExtendedFlowDefinition> | unknown[] };

      if (!data?.flows) continue;

      // Handle both record format and array format
      if (Array.isArray(data.flows)) {
        // Array format: [{ name, steps, description }]
        for (const flowItem of data.flows) {
          const flow = flowItem as { name: string; description?: string; steps?: unknown[] };
          if (!flow.name) continue;

          const flowId = `$${flow.name}`;
          const steps = parseFlowSteps(flow.steps);

          if (steps.length > 0) {
            const testableFlow: TestableFlow = {
              id: flowId,
              description: flow.description || '',
              steps,
              definedIn: path.relative(rootDir, filePath),
            };

            flows[flowId] = testableFlow;
            indexFlowSymbols(flowId, steps, symbolToFlows);
          }
        }
      } else {
        // Record format: { flow-name: { description, steps, trigger, validation } }
        for (const [name, flowDef] of Object.entries(data.flows as Record<string, ExtendedFlowDefinition>)) {
          const flowId = name.startsWith('$') ? name : `$${name}`;
          const steps = parseFlowSteps(flowDef.steps);

          // Only include flows with steps (testable flows)
          if (steps.length > 0) {
            const testableFlow: TestableFlow = {
              id: flowId,
              description: flowDef.description || '',
              trigger: flowDef.trigger,
              steps,
              validation: flowDef.validation,
              definedIn: path.relative(rootDir, filePath),
            };

            flows[flowId] = testableFlow;
            indexFlowSymbols(flowId, steps, symbolToFlows);
          }
        }
      }
    } catch (err) {
      if (!options.quiet) {
        console.warn(chalk.yellow(`  Warning: Could not parse flows from ${filePath}: ${(err as Error).message}`));
      }
    }
  }

  if (Object.keys(flows).length === 0) {
    return null;
  }

  return {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    flows,
    symbolToFlows,
  };
}

/**
 * Parse flow steps from various formats
 */
export function parseFlowSteps(steps: unknown[] | undefined): FlowStep[] {
  if (!steps || !Array.isArray(steps)) return [];

  const result: FlowStep[] = [];

  // A symbol token: prefix (#$^!~) + bare name, optionally double-prefixed ($$).
  const SYMBOL_TOKEN = /^[#$^!~]{1,2}[A-Za-z0-9][\w-]*$/;

  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];

    // Bare-string step form: `- "#cockpit-view"` (the form Swift/conductor
    // .purpose files use). Without this branch these steps are silently dropped
    // and the whole flow never reaches flow-index.json — which is precisely why
    // $$fleet-switch (steps: [#session-row, #fleet-store, #cockpit-view]) and
    // every other string-step flow went missing from the graph slice.
    if (typeof step === 'string') {
      const token = step.trim();
      if (!token) continue;
      const isSymbol = SYMBOL_TOKEN.test(token);
      result.push({
        id: `step-${index + 1}`,
        action: token,
        symbol: isSymbol ? token : undefined,
      });
      continue;
    }

    if (typeof step === 'object' && step !== null) {
      const s = step as Record<string, unknown>;
      const action = (s.action as string) || (s.description as string) || (s.component as string) || '';
      if (action) {
        result.push({
          id: (s.id as string) || `step-${index + 1}`,
          action,
          symbol: (s.symbol as string | undefined) || (s.component as string | undefined),
          expect: s.expect as string | undefined,
        });
      }
    }
  }

  return result;
}

/**
 * Index symbols used in flow steps
 */
export function indexFlowSymbols(
  flowId: string,
  steps: FlowStep[],
  symbolToFlows: Record<string, string[]>
): void {
  for (const step of steps) {
    if (step.symbol) {
      if (!symbolToFlows[step.symbol]) {
        symbolToFlows[step.symbol] = [];
      }
      if (!symbolToFlows[step.symbol].includes(flowId)) {
        symbolToFlows[step.symbol].push(flowId);
      }
    }
  }
}
