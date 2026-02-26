/**
 * Reindex MCP Tool - Rebuilds scan-index.json, navigator.yaml, and flow-index.json
 *
 * Reuses aggregation from premise-core and scan generation from probe-core,
 * then ports navigator and flow-index generation inline (no CLI deps).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { aggregateFromDirectory, type AggregationResult, type FlowIndex, type TestableFlow, type FlowStep } from '@a-company/premise-core';
import { generateScanIndex, serializeScanIndex } from '@a-company/probe-core';
import type { ProjectContext } from '../utils/index-loader.js';
import { trackToolCall } from './context.js';
import { toolCache } from '../utils/tool-cache.js';
import { openAspectGraph, materializeAspects, closeAspectGraph } from '../utils/aspect-graph.js';
import { materializeLoreLinks, inferLoreEdges } from '../utils/aspect-lore-bridge.js';

// ============================================================================
// Navigator constants (ported from packages/paradigm/src/commands/scan/navigator.ts)
// ============================================================================

const SYMBOL_CATEGORIES: Record<string, { category: string; prefix: string }> = {
  '@': { category: 'features', prefix: '@' },
  '#': { category: 'components', prefix: '#' },
  '^': { category: 'gates', prefix: '^' },
  '$': { category: 'flows', prefix: '$' },
  '&': { category: 'integrations', prefix: '&' },
  '!': { category: 'signals', prefix: '!' },
  '%': { category: 'state', prefix: '%' },
};

const DIRECTORY_PATTERNS: Record<string, string[]> = {
  features: ['src/features/', 'features/', 'app/', 'src/app/', 'src/modules/', 'modules/'],
  components: ['src/components/', 'components/', 'src/lib/', 'lib/', 'src/ui/', 'ui/'],
  gates: ['middleware/', 'src/middleware/', 'auth/', 'src/auth/', 'guards/', 'src/guards/'],
  flows: ['flows/', 'src/flows/', 'workflows/', 'src/workflows/', 'sagas/', 'src/sagas/'],
  integrations: ['integrations/', 'src/integrations/', 'external/', 'src/external/', 'vendors/'],
  signals: ['events/', 'src/events/', 'handlers/', 'src/handlers/'],
  state: ['stores/', 'src/stores/', 'state/', 'src/state/', 'reducers/', 'src/reducers/'],
};

const KEY_FILE_PATTERNS: Record<string, string[]> = {
  config: ['.paradigm/config.yaml', 'package.json', 'tsconfig.json', '.env.example'],
  entry: ['src/index.ts', 'src/index.tsx', 'src/main.ts', 'src/main.tsx', 'index.ts', 'main.ts', 'src/app.ts', 'src/app.tsx'],
  types: ['src/types/', 'types/', 'src/types.ts', 'types.ts'],
};

const DEFAULT_SKIP_PATTERNS = {
  always: [
    'node_modules/', 'dist/', 'build/', '.git/', '.next/', '.nuxt/', '.cache/', '*.lock', '*.log',
  ],
  unless_testing: [
    '**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx', '__tests__/', 'test/', 'tests/',
  ],
  unless_docs: ['docs/', '*.md', 'README*', 'CHANGELOG*'],
};

// ============================================================================
// Tool Definition
// ============================================================================

export function getReindexToolsList() {
  return [
    {
      name: 'paradigm_reindex',
      description:
        'Rebuild scan-index.json, navigator.yaml, and flow-index.json from .purpose files. Call after modifying paradigm files or at the end of a work session to ensure static index files are fresh. Returns counts of indexed symbols, files processed, and any errors. ~150 tokens.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
      },
    },
  ];
}

// ============================================================================
// Tool Handler
// ============================================================================

export async function handleReindexTool(
  name: string,
  _args: Record<string, unknown>,
  ctx: ProjectContext,
  reloadContext: () => Promise<void>,
): Promise<{ handled: boolean; text: string }> {
  if (name !== 'paradigm_reindex') {
    return { handled: false, text: '' };
  }

  try {
    const result = await rebuildStaticFiles(ctx.rootDir, ctx);
    await reloadContext();
    toolCache.clear();

    const text = JSON.stringify(result, null, 2);
    trackToolCall(text.length, name);
    return { handled: true, text };
  } catch (err) {
    const text = JSON.stringify({ error: (err as Error).message }, null, 2);
    trackToolCall(text.length, name);
    return { handled: true, text };
  }
}

// ============================================================================
// Shared Rebuild Logic (used by both reindex tool and auto-reindex)
// ============================================================================

export interface RebuildResult {
  action: 'reindex';
  filesWritten: string[];
  symbolCount: number;
  breakdown: Record<string, number>;
  flowCount: number;
  aspectGraphStats?: {
    aspects: number;
    anchors: number;
    edges: number;
    loreLinks: number;
  };
}

export async function rebuildStaticFiles(
  rootDir: string,
  ctx?: ProjectContext,
): Promise<RebuildResult> {
  const filesWritten: string[] = [];

  // 1. Aggregate symbols (reuse context if available, otherwise re-aggregate)
  let aggregation: AggregationResult;
  if (ctx) {
    aggregation = ctx.aggregation;
  } else {
    aggregation = await aggregateFromDirectory(rootDir);
  }

  const projectName = ctx?.projectName || path.basename(rootDir);

  // Ensure .paradigm directory exists
  const paradigmDir = path.join(rootDir, '.paradigm');
  if (!fs.existsSync(paradigmDir)) {
    fs.mkdirSync(paradigmDir, { recursive: true });
  }

  // 2. Generate and write scan-index.json
  const scanIndex = generateScanIndex(
    {
      symbols: aggregation.symbols,
      purposeFiles: aggregation.purposeFiles,
      portalFiles: aggregation.portalFiles,
    },
    { projectName },
  );
  const scanIndexPath = path.join(paradigmDir, 'scan-index.json');
  fs.writeFileSync(scanIndexPath, serializeScanIndex(scanIndex), 'utf8');
  filesWritten.push('.paradigm/scan-index.json');

  // 3. Generate and write navigator.yaml
  const navigatorData = buildNavigatorData(rootDir, aggregation);
  const navigatorPath = path.join(paradigmDir, 'navigator.yaml');
  fs.writeFileSync(
    navigatorPath,
    yaml.dump(navigatorData, { indent: 2, lineWidth: 120, noRefs: true, sortKeys: false }),
    'utf8',
  );
  filesWritten.push('.paradigm/navigator.yaml');

  // 4. Generate and write flow-index.json
  const flowIndex = generateFlowIndex(rootDir, aggregation.purposeFiles);
  let flowCount = 0;
  if (flowIndex && Object.keys(flowIndex.flows).length > 0) {
    const flowIndexPath = path.join(paradigmDir, 'flow-index.json');
    fs.writeFileSync(flowIndexPath, JSON.stringify(flowIndex, null, 2), 'utf8');
    filesWritten.push('.paradigm/flow-index.json');
    flowCount = Object.keys(flowIndex.flows).length;
  }

  // 5. Build aspect-graph.db (SQLite graph of aspects, anchors, edges, lore)
  let aspectGraphStats: RebuildResult['aspectGraphStats'];
  try {
    const db = await openAspectGraph(rootDir);
    materializeAspects(db, aggregation.symbols);
    const loreLinks = await materializeLoreLinks(db, rootDir);
    const inferredEdges = await inferLoreEdges(db, rootDir);

    // Query counts from the materialized tables
    const aspectCount = db.exec('SELECT COUNT(*) FROM aspects')[0]?.values[0]?.[0] as number ?? 0;
    const anchorCount = db.exec('SELECT COUNT(*) FROM anchors')[0]?.values[0]?.[0] as number ?? 0;
    const edgeCount = db.exec('SELECT COUNT(*) FROM edges')[0]?.values[0]?.[0] as number ?? 0;

    closeAspectGraph(db, rootDir);
    filesWritten.push('.paradigm/aspect-graph.db');
    aspectGraphStats = {
      aspects: aspectCount,
      anchors: anchorCount,
      edges: edgeCount,
      loreLinks,
    };
  } catch {
    // Aspect graph build is non-fatal — log but don't block reindex
  }

  // Build breakdown
  const breakdown: Record<string, number> = {};
  for (const sym of aggregation.symbols) {
    breakdown[sym.type] = (breakdown[sym.type] || 0) + 1;
  }

  return {
    action: 'reindex',
    filesWritten,
    symbolCount: aggregation.symbols.length,
    breakdown,
    flowCount,
    aspectGraphStats,
  };
}

// ============================================================================
// Navigator Generation (ported from packages/paradigm/src/commands/scan/navigator.ts)
// ============================================================================

interface SymbolInfo {
  id: string;
  type: string;
  filePath?: string;
  data?: unknown;
}

function buildNavigatorData(
  rootDir: string,
  aggregation: { symbols: SymbolInfo[]; purposeFiles: string[] },
): Record<string, unknown> {
  return {
    version: '1.0',
    generated: new Date().toISOString(),
    structure: buildStructure(rootDir),
    key_files: buildKeyFiles(rootDir),
    skip_patterns: buildSkipPatterns(rootDir),
    symbols: buildSymbolMap(aggregation.symbols, aggregation.purposeFiles, rootDir),
  };
}

function buildStructure(rootDir: string): Record<string, { paths: string[]; symbol: string }> {
  const structure: Record<string, { paths: string[]; symbol: string }> = {};

  for (const [category, patterns] of Object.entries(DIRECTORY_PATTERNS)) {
    const existingPaths = patterns.filter((p) => fs.existsSync(path.join(rootDir, p)));
    if (existingPaths.length > 0) {
      const symbolInfo = Object.values(SYMBOL_CATEGORIES).find((s) => s.category === category);
      structure[category] = { paths: existingPaths, symbol: symbolInfo?.prefix || '@' };
    }
  }

  return structure;
}

function buildKeyFiles(rootDir: string): Record<string, string[]> {
  const keyFiles: Record<string, string[]> = {};

  for (const [category, patterns] of Object.entries(KEY_FILE_PATTERNS)) {
    const existingPaths = patterns.filter((p) => fs.existsSync(path.join(rootDir, p)));
    if (existingPaths.length > 0) {
      keyFiles[category] = existingPaths;
    }
  }

  if (!keyFiles.config) keyFiles.config = [];
  if (!keyFiles.entry) keyFiles.entry = [];
  if (!keyFiles.types) keyFiles.types = [];

  return keyFiles;
}

function buildSkipPatterns(rootDir: string): {
  always: string[];
  unless_testing: string[];
  unless_docs: string[];
} {
  const patterns = {
    always: [...DEFAULT_SKIP_PATTERNS.always],
    unless_testing: [...DEFAULT_SKIP_PATTERNS.unless_testing],
    unless_docs: [...DEFAULT_SKIP_PATTERNS.unless_docs],
  };

  const gitignorePath = path.join(rootDir, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    try {
      const content = fs.readFileSync(gitignorePath, 'utf8');
      const gitignorePatterns = content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .filter(
          (line) =>
            line.endsWith('/') ||
            line.includes('*') ||
            ['node_modules', 'dist', 'build', '.cache'].some((p) => line.includes(p)),
        )
        .slice(0, 20);

      for (const pattern of gitignorePatterns) {
        if (!patterns.always.includes(pattern)) {
          patterns.always.push(pattern);
        }
      }
    } catch {
      // Ignore errors reading .gitignore
    }
  }

  return patterns;
}

function getSymbolPrefix(type: string): string {
  switch (type) {
    case 'feature': return '@';
    case 'component': return '#';
    case 'gate': return '^';
    case 'flow': return '$';
    case 'integration': return '&';
    case 'signal': return '!';
    case 'state': return '%';
    case 'idea': return '?';
    case 'deprecated': return '~';
    case 'aspect': return '~';
    default: return '@';
  }
}

function buildSymbolMap(
  symbols: SymbolInfo[],
  purposeFiles: string[],
  _rootDir: string,
): Record<string, string> {
  const symbolMap: Record<string, string> = {};

  for (const symbol of symbols) {
    const prefix = getSymbolPrefix(symbol.type);
    const symbolId = `${prefix}${symbol.id}`;

    if (symbol.filePath) {
      symbolMap[symbolId] = symbol.filePath;
    } else {
      const matchingPurpose = purposeFiles.find((pf) => {
        const dir = path.dirname(pf);
        return dir.toLowerCase().includes(symbol.id.toLowerCase());
      });
      if (matchingPurpose) {
        symbolMap[symbolId] = path.dirname(matchingPurpose) + '/';
      }
    }
  }

  return symbolMap;
}

// ============================================================================
// Flow Index Generation (ported from packages/paradigm/src/commands/scan/index.ts)
// ============================================================================

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
  gates?: string[];
  signals?: string[];
  components?: string[];
}

function generateFlowIndex(
  rootDir: string,
  purposeFiles: string[],
): FlowIndex | null {
  const flows: Record<string, TestableFlow> = {};
  const symbolToFlows: Record<string, string[]> = {};

  for (const filePath of purposeFiles) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const data = yaml.load(content) as { flows?: Record<string, ExtendedFlowDefinition> | unknown[] };

      if (!data?.flows) continue;

      if (Array.isArray(data.flows)) {
        for (const flowItem of data.flows) {
          const flow = flowItem as { name: string; description?: string; steps?: unknown[] };
          if (!flow.name) continue;

          const flowId = `$${flow.name}`;
          const steps = parseFlowSteps(flow.steps);

          if (steps.length > 0) {
            flows[flowId] = {
              id: flowId,
              description: flow.description || '',
              steps,
              definedIn: path.relative(rootDir, filePath),
            };
            indexFlowSymbols(flowId, steps, symbolToFlows);
          }
        }
      } else {
        for (const [name, flowDef] of Object.entries(data.flows as Record<string, ExtendedFlowDefinition>)) {
          const flowId = name.startsWith('$') ? name : `$${name}`;
          const steps = parseFlowSteps(flowDef.steps);

          if (steps.length > 0) {
            flows[flowId] = {
              id: flowId,
              description: flowDef.description || '',
              trigger: flowDef.trigger,
              steps,
              validation: flowDef.validation,
              definedIn: path.relative(rootDir, filePath),
            };
            indexFlowSymbols(flowId, steps, symbolToFlows);
          }
        }
      }
    } catch {
      // Skip files that can't be parsed
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

function parseFlowSteps(steps: unknown[] | undefined): FlowStep[] {
  if (!steps || !Array.isArray(steps)) return [];

  const result: FlowStep[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (typeof step === 'object' && step !== null) {
      const s = step as Record<string, unknown>;
      const action = (s.action as string) || (s.description as string) || (s.component as string) || '';
      if (action) {
        result.push({
          id: (s.id as string) || `step-${i + 1}`,
          action,
          symbol: s.symbol as string | undefined,
          expect: s.expect as string | undefined,
        });
      }
    }
  }
  return result;
}

function indexFlowSymbols(
  flowId: string,
  steps: FlowStep[],
  symbolToFlows: Record<string, string[]>,
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
