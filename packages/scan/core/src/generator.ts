/**
 * Scan Index Generator
 * Generates the scan index from aggregated horizon data
 */

import type {
  ScanIndex,
  ScanIndexMeta,
  ScanElement,
  ScanFlow,
  ScanFlowStep,
  ScanState,
  VisualTag,
} from './types.js';

// Re-export for convenience
export type { ScanIndex };

const HORIZON_VERSION = '0.1.0';
const SCHEMA_VERSION = '1.0.0';

/**
 * Input from dream aggregation
 */
export interface AggregationInput {
  symbols: Array<{
    id: string;
    symbol: string;
    type: string;
    source: string;
    filePath: string;
    data: unknown;
    description?: string;
    tags?: string[];
    references?: string[];
    referencedBy?: string[];
  }>;
  purposeFiles: string[];
  gateFiles: string[];
}

/**
 * Options for index generation
 */
export interface GeneratorOptions {
  projectName: string;
  /** Custom visual tag mappings from config */
  visualTagMappings?: Record<string, VisualTag[]>;
  /** Screen definitions from config */
  screenDefinitions?: Record<string, {
    route?: string;
    components?: string[];
    features?: string[];
  }>;
}

/**
 * Generate a scan index from aggregated horizon data
 */
export function generateScanIndex(
  input: AggregationInput,
  options: GeneratorOptions
): ScanIndex {
  const index: ScanIndex = {
    $meta: createMeta(options.projectName, input),
    components: {},
    features: {},
    flows: {},
    state: {},
    gates: {},
    signals: {},
    screens: {},
    symbolMap: {},
  };

  // Process each symbol
  for (const symbol of input.symbols) {
    processSymbol(symbol, index, options);
  }

  // Add screen definitions from config
  if (options.screenDefinitions) {
    for (const [screenId, def] of Object.entries(options.screenDefinitions)) {
      if (!index.screens[screenId]) {
        index.screens[screenId] = {
          id: screenId,
          name: formatName(screenId),
          route: def.route,
          path: '', // Will be resolved if found
          components: def.components,
          features: def.features,
        };
      }
    }
  }

  // Build reverse lookups for screens
  buildScreenReferences(index);

  return index;
}

/**
 * Create index metadata
 */
function createMeta(projectName: string, input: AggregationInput): ScanIndexMeta {
  return {
    version: SCHEMA_VERSION,
    project: projectName,
    generatedAt: new Date().toISOString(),
    horizonVersion: HORIZON_VERSION,
    sources: {
      purposeFiles: input.purposeFiles.length,
      gateFiles: input.gateFiles.length,
      dreamFiles: input.symbols.filter(s => s.source === 'dream').length > 0 ? 1 : 0,
    },
  };
}

/**
 * Process a single symbol into the index
 */
function processSymbol(
  symbol: AggregationInput['symbols'][0],
  index: ScanIndex,
  options: GeneratorOptions
): void {
  const { type } = symbol;

  switch (type) {
    case 'component':
      addComponent(symbol, index, options);
      break;
    case 'feature':
      addFeature(symbol, index, options);
      break;
    case 'flow':
      addFlow(symbol, index);
      break;
    case 'state':
      addState(symbol, index);
      break;
    case 'gate':
      addGate(symbol, index);
      break;
    case 'signal':
      addSignal(symbol, index);
      break;
    default:
      // Skip unknown types
      break;
  }
}

/**
 * Add a component to the index
 */
function addComponent(
  symbol: AggregationInput['symbols'][0],
  index: ScanIndex,
  options: GeneratorOptions
): void {
  const id = extractId(symbol.symbol);
  const visualTags = inferVisualTags(id, symbol.data, options.visualTagMappings);

  const element: ScanElement = {
    id,
    name: formatName(id),
    symbol: symbol.symbol,
    category: 'components',
    path: symbol.filePath,
    description: symbol.description,
    visualTags,
    related: symbol.references,
  };

  index.components[id] = element;
  index.symbolMap[symbol.symbol] = { category: 'components', id };
}

/**
 * Add a feature to the index
 */
function addFeature(
  symbol: AggregationInput['symbols'][0],
  index: ScanIndex,
  options: GeneratorOptions
): void {
  const id = extractId(symbol.symbol);
  const visualTags = inferVisualTags(id, symbol.data, options.visualTagMappings);

  const element: ScanElement = {
    id,
    name: formatName(id),
    symbol: symbol.symbol,
    category: 'features',
    path: symbol.filePath,
    description: symbol.description,
    visualTags,
    related: symbol.references,
  };

  index.features[id] = element;
  index.symbolMap[symbol.symbol] = { category: 'features', id };
}

/**
 * Add a flow to the index
 */
function addFlow(
  symbol: AggregationInput['symbols'][0],
  index: ScanIndex
): void {
  const id = extractId(symbol.symbol);
  const data = symbol.data as { steps?: Array<{ component?: string; action?: string; description?: string }> } | undefined;

  const steps: ScanFlowStep[] = [];
  if (data?.steps) {
    for (let i = 0; i < data.steps.length; i++) {
      const step = data.steps[i];
      steps.push({
        id: `${id}-step-${i}`,
        name: step.action || `Step ${i + 1}`,
        target: step.component,
        description: step.description,
        order: i,
      });
    }
  }

  const flow: ScanFlow = {
    id,
    name: formatName(id),
    symbol: symbol.symbol,
    path: symbol.filePath,
    description: symbol.description,
    steps,
  };

  index.flows[id] = flow;
  index.symbolMap[symbol.symbol] = { category: 'flows', id };
}

/**
 * Add state to the index
 */
function addState(
  symbol: AggregationInput['symbols'][0],
  index: ScanIndex
): void {
  const id = extractId(symbol.symbol);

  const state: ScanState = {
    id,
    name: formatName(id),
    symbol: symbol.symbol,
    path: symbol.filePath,
    description: symbol.description,
    consumers: symbol.referencedBy,
  };

  index.state[id] = state;
  index.symbolMap[symbol.symbol] = { category: 'state', id };
}

/**
 * Add a gate to the index
 */
function addGate(
  symbol: AggregationInput['symbols'][0],
  index: ScanIndex
): void {
  const id = extractId(symbol.symbol);

  const element: ScanElement = {
    id,
    name: formatName(id),
    symbol: symbol.symbol,
    category: 'gates',
    path: symbol.filePath,
    description: symbol.description,
    related: symbol.references,
  };

  index.gates[id] = element;
  index.symbolMap[symbol.symbol] = { category: 'gates', id };
}

/**
 * Add a signal to the index
 */
function addSignal(
  symbol: AggregationInput['symbols'][0],
  index: ScanIndex
): void {
  const id = extractId(symbol.symbol);

  const element: ScanElement = {
    id,
    name: formatName(id),
    symbol: symbol.symbol,
    category: 'signals',
    path: symbol.filePath,
    description: symbol.description,
    related: symbol.references,
  };

  index.signals[id] = element;
  index.symbolMap[symbol.symbol] = { category: 'signals', id };
}

/**
 * Build screen references from component/feature relationships
 */
function buildScreenReferences(index: ScanIndex): void {
  // Link components to screens they appear in
  for (const screen of Object.values(index.screens)) {
    if (screen.components) {
      for (const compId of screen.components) {
        const comp = index.components[compId];
        if (comp) {
          comp.screens = comp.screens || [];
          if (!comp.screens.includes(screen.id)) {
            comp.screens.push(screen.id);
          }
        }
      }
    }
  }
}

/**
 * Extract ID from symbol (remove prefix)
 */
function extractId(symbol: string): string {
  return symbol.slice(1); // Remove @ # $ etc prefix
}

/**
 * Format ID as human-readable name
 */
function formatName(id: string): string {
  return id
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Infer visual tags from component name and data
 */
function inferVisualTags(
  id: string,
  _data: unknown,
  customMappings?: Record<string, VisualTag[]>
): VisualTag[] {
  const tags: VisualTag[] = [];

  // Check custom mappings first
  if (customMappings?.[id]) {
    return customMappings[id];
  }

  // Infer from name patterns (case-insensitive)
  const patterns: [RegExp, VisualTag][] = [
    [/button/i, 'button'],
    [/btn/i, 'button'],
    [/form/i, 'form'],
    [/input/i, 'input'],
    [/field/i, 'input'],
    [/select/i, 'input'],
    [/card/i, 'card'],
    [/list/i, 'list'],
    [/table/i, 'list'],
    [/modal/i, 'modal'],
    [/dialog/i, 'modal'],
    [/drawer/i, 'modal'],
    [/nav/i, 'nav'],
    [/menu/i, 'menu'],
    [/dropdown/i, 'menu'],
    [/header/i, 'header'],
    [/footer/i, 'footer'],
    [/sidebar/i, 'sidebar'],
    [/hero/i, 'hero'],
    [/grid/i, 'grid'],
    [/chart/i, 'chart'],
    [/graph/i, 'chart'],
    [/icon/i, 'icon'],
    [/image/i, 'image'],
    [/avatar/i, 'avatar'],
    [/badge/i, 'badge'],
    [/tag/i, 'badge'],
    [/tab/i, 'tab'],
    [/accordion/i, 'accordion'],
    [/toast/i, 'toast'],
    [/notification/i, 'toast'],
    [/alert/i, 'toast'],
    [/spinner/i, 'spinner'],
    [/loader/i, 'spinner'],
    [/loading/i, 'spinner'],
    [/skeleton/i, 'skeleton'],
  ];

  for (const [pattern, tag] of patterns) {
    if (pattern.test(id)) {
      tags.push(tag);
    }
  }

  return tags;
}

/**
 * Serialize scan index to JSON
 */
export function serializeScanIndex(index: ScanIndex): string {
  return JSON.stringify(index, null, 2);
}

/**
 * Parse scan index from JSON
 */
export function parseScanIndex(json: string): ScanIndex {
  return JSON.parse(json) as ScanIndex;
}
