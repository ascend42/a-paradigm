/**
 * Aggregator for combining multiple .purpose files
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import type {
  AggregatedPurpose,
  PurposeFile,
  PurposeItem,
  PurposeItemArray,
  AspectDefinition,
  GateDefinition,
  StateDefinition,
  SignalDefinition,
  FlowDefinition,
  FlowWithSteps,
} from './types.js';

/**
 * Helper to normalize features/components to entries regardless of format
 */
function normalizeItemsToEntries(
  items: Record<string, PurposeItem> | PurposeItemArray[] | undefined
): Array<[string, PurposeItem]> {
  if (!items) return [];
  
  if (Array.isArray(items)) {
    // Array format: [{ id, description, ... }]
    return items.map((item) => [item.id, item]);
  } else {
    // Record format: { id: { description, ... } }
    return Object.entries(items);
  }
}
import { parsePurposeFile } from './parser.js';

/**
 * Parsed purpose file with its path
 */
export interface ParsedPurposeFile {
  filePath: string;
  data: PurposeFile;
}

/**
 * Normalize top-level symbol-prefixed keys into standard dict format.
 * Converts #Component: → components.Component, $flow: → flows.flow, etc.
 * This allows .purpose files using the #Component: shorthand to be indexed.
 */
export function normalizeSymbolKeys(data: PurposeFile): PurposeFile {
  const prefixMap: Record<string, string> = {
    '#': 'components',
    '$': 'flows',
    '^': 'gates',
    '!': 'signals',
    '~': 'aspects',
  };

  for (const key of Object.keys(data)) {
    const prefix = key[0];
    const target = prefixMap[prefix];
    if (!target || key.length < 2) continue;

    const id = key.slice(1); // strip prefix
    const value = (data as Record<string, unknown>)[key];
    if (typeof value !== 'object' || value === null) continue;

    // Initialize target dict if needed
    const dict = ((data as Record<string, unknown>)[target] as Record<string, unknown>) || {};
    if (!(target in data)) {
      (data as Record<string, unknown>)[target] = dict;
    }
    // Don't overwrite existing entries
    if (!(id in dict)) {
      dict[id] = value;
    }
    // Remove the top-level prefixed key
    delete (data as Record<string, unknown>)[key];
  }

  return data;
}

/**
 * Aggregate multiple purpose files into a single context
 */
export function aggregatePurposes(parsedFiles: ParsedPurposeFile[]): AggregatedPurpose {
  const basePurpose: AggregatedPurpose = {
    description: '',
    context: [],
    rules: {},
    features: {},
    components: {},
    referencedItems: {},
    ruleConflicts: [],
  };

  if (!parsedFiles || parsedFiles.length === 0) {
    return basePurpose;
  }

  // Aggregate from parent to child (files are expected to be sorted by depth)
  parsedFiles.forEach(({ data }) => {
    // Merge context arrays (union, no duplicates)
    const existingContext = new Set(basePurpose.context);
    for (const ctx of data.context || []) {
      if (!existingContext.has(ctx)) {
        basePurpose.context.push(ctx);
        existingContext.add(ctx);
      }
    }

    // Deep merge rules, tracking conflicts
    if (data.rules) {
      for (const [key, value] of Object.entries(data.rules)) {
        if (basePurpose.rules[key] !== undefined && basePurpose.rules[key] !== value) {
          basePurpose.ruleConflicts.push(
            `Conflict on rule "${key}": existing value "${basePurpose.rules[key]}" overwritten with "${value}"`
          );
        }
        basePurpose.rules[key] = value;
      }
    }

    // Merge features and components (normalize to record format)
    const featureEntries = normalizeItemsToEntries(data.features);
    for (const [id, item] of featureEntries) {
      basePurpose.features[id] = item;
    }
    
    const componentEntries = normalizeItemsToEntries(data.components);
    for (const [id, item] of componentEntries) {
      basePurpose.components[id] = item;
    }
  });

  // The last file in the list is the most specific one
  const lastFile = parsedFiles[parsedFiles.length - 1];
  basePurpose.description = lastFile.data.description || basePurpose.description;
  basePurpose.apiSpec = lastFile.data.apiSpec || basePurpose.apiSpec;

  return basePurpose;
}

/**
 * Find all .purpose files in a directory tree, sorted by depth
 */
export async function findPurposeFiles(rootDir: string): Promise<string[]> {
  const absoluteRoot = path.resolve(rootDir);

  const files = await glob('**/.purpose', {
    cwd: absoluteRoot,
    absolute: true,
    ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
  });

  // Sort by depth (shallowest first for proper aggregation)
  return files.sort((a, b) => {
    const depthA = a.split(path.sep).length;
    const depthB = b.split(path.sep).length;
    return depthA - depthB;
  });
}

/**
 * Find and parse all .purpose files up to and including a target path
 */
export async function collectPurposeChain(targetPath: string): Promise<ParsedPurposeFile[]> {
  const absoluteTarget = path.resolve(targetPath);
  const targetDir = fs.statSync(absoluteTarget).isDirectory()
    ? absoluteTarget
    : path.dirname(absoluteTarget);

  const chain: ParsedPurposeFile[] = [];
  let currentDir = targetDir;
  const root = path.parse(currentDir).root;

  // Walk up the directory tree
  while (currentDir !== root) {
    const purposePath = path.join(currentDir, '.purpose');
    if (fs.existsSync(purposePath)) {
      const { data, errors } = parsePurposeFile(purposePath);
      if (data && errors.length === 0) {
        chain.unshift({ filePath: purposePath, data });
      }
    }
    currentDir = path.dirname(currentDir);
  }

  return chain;
}

/**
 * Aggregate all purpose files for a given path
 */
export async function aggregateForPath(targetPath: string): Promise<AggregatedPurpose> {
  const chain = await collectPurposeChain(targetPath);
  return aggregatePurposes(chain);
}

/**
 * Get all parsed purpose files from a root directory
 */
export async function getAllPurposeFiles(rootDir: string): Promise<ParsedPurposeFile[]> {
  const files = await findPurposeFiles(rootDir);
  const parsed: ParsedPurposeFile[] = [];

  for (const filePath of files) {
    const { data, errors } = parsePurposeFile(filePath);
    if (data) {
      parsed.push({ filePath, data });
      if (errors.length > 0) {
        console.warn(`Warnings parsing ${filePath}:`, errors);
      }
    }
  }

  return parsed;
}

/**
 * Extract all features from parsed purpose files
 */
export function extractFeatures(parsedFiles: ParsedPurposeFile[]): Map<string, { item: PurposeItem; filePath: string }> {
  const features = new Map<string, { item: PurposeItem; filePath: string }>();

  for (const { filePath, data } of parsedFiles) {
    // Handle both array and record formats
    const entries = normalizeItemsToEntries(data.features);
    for (const [id, item] of entries) {
      features.set(id, { item, filePath });
    }
  }

  return features;
}

/**
 * Extract all components from parsed purpose files
 */
export function extractComponents(parsedFiles: ParsedPurposeFile[]): Map<string, { item: PurposeItem; filePath: string }> {
  const components = new Map<string, { item: PurposeItem; filePath: string }>();

  for (const { filePath, data } of parsedFiles) {
    // Handle both array and record formats
    const entries = normalizeItemsToEntries(data.components);
    for (const [id, item] of entries) {
      components.set(id, { item, filePath });
    }
  }

  return components;
}

/**
 * Extract all gates from parsed purpose files
 */
export function extractGates(parsedFiles: ParsedPurposeFile[]): Map<string, { item: GateDefinition; filePath: string }> {
  const gates = new Map<string, { item: GateDefinition; filePath: string }>();

  for (const { filePath, data } of parsedFiles) {
    if (data.gates) {
      for (const [id, item] of Object.entries(data.gates)) {
        gates.set(id, { item, filePath });
      }
    }
  }

  return gates;
}

/**
 * Extract all states from parsed purpose files
 */
export function extractStates(parsedFiles: ParsedPurposeFile[]): Map<string, { item: StateDefinition; filePath: string }> {
  const states = new Map<string, { item: StateDefinition; filePath: string }>();

  for (const { filePath, data } of parsedFiles) {
    if (data.states) {
      for (const [id, item] of Object.entries(data.states)) {
        states.set(id, { item, filePath });
      }
    }
  }

  return states;
}

/**
 * Normalized flow for extraction
 */
export interface ExtractedFlow {
  id: string;
  description?: string;
  gates?: string[];
  signals?: string[];
  components?: string[];
  steps?: Array<{ component: string; action: string; description?: string }>;
}

/**
 * Extract all flows from parsed purpose files
 * Handles both array format [{name, steps}] and record format {flow-name: {description, gates}}
 */
export function extractFlows(parsedFiles: ParsedPurposeFile[]): Map<string, { item: ExtractedFlow; filePath: string }> {
  const flows = new Map<string, { item: ExtractedFlow; filePath: string }>();

  for (const { filePath, data } of parsedFiles) {
    if (data.flows) {
      if (Array.isArray(data.flows)) {
        // Array format: [{ name, steps, description }]
        for (const flow of data.flows as FlowWithSteps[]) {
          flows.set(flow.name, {
            item: {
              id: flow.name,
              description: flow.description,
              steps: flow.steps,
            },
            filePath,
          });
        }
      } else {
        // Record format: { flow-name: { description, gates, signals } }
        for (const [id, flowDef] of Object.entries(data.flows as Record<string, FlowDefinition>)) {
          flows.set(id, {
            item: {
              id,
              description: flowDef.description,
              gates: flowDef.gates,
              signals: flowDef.signals,
              components: flowDef.components,
              steps: flowDef.steps,
            },
            filePath,
          });
        }
      }
    }
  }

  return flows;
}

/**
 * Extract all signals from parsed purpose files
 */
export function extractSignals(parsedFiles: ParsedPurposeFile[]): Map<string, { item: SignalDefinition; filePath: string }> {
  const signals = new Map<string, { item: SignalDefinition; filePath: string }>();

  for (const { filePath, data } of parsedFiles) {
    if (data.signals) {
      for (const [id, item] of Object.entries(data.signals)) {
        signals.set(id, { item, filePath });
      }
    }
  }

  return signals;
}

/**
 * Extract all aspects from parsed purpose files
 */
export function extractAspects(parsedFiles: ParsedPurposeFile[]): Map<string, { item: AspectDefinition; filePath: string }> {
  const aspects = new Map<string, { item: AspectDefinition; filePath: string }>();

  for (const { filePath, data } of parsedFiles) {
    if (data.aspects) {
      for (const [id, item] of Object.entries(data.aspects)) {
        aspects.set(id, { item, filePath });
      }
    }
  }

  return aspects;
}

/**
 * Extracted symbol reference from feature/component data (v2)
 *
 * v2 changes:
 * - 'state' is no longer a symbol type - states are now #components with [state] tag
 * - 'flow', 'gate', 'signal', 'component', 'aspect' are the valid reference types
 */
export interface ExtractedSymbolRef {
  symbol: string;
  type: 'flow' | 'gate' | 'signal' | 'component' | 'aspect';
  sourceSymbol: string;
  filePath: string;
}

/**
 * Extract symbol references ($, ^, !, #, ~) from feature/component data (v2)
 * This captures references like flows: [$checkout-flow], gates: [^authenticated]
 *
 * v2 changes:
 * - Features are now #components with tags, not @features
 * - States are now #components with [state] tag, not %states
 */
export function extractSymbolReferences(parsedFiles: ParsedPurposeFile[]): ExtractedSymbolRef[] {
  const refs: ExtractedSymbolRef[] = [];
  const seen = new Set<string>();

  for (const { filePath, data } of parsedFiles) {
    // Process features (v2: these are components with [feature] tag)
    const featureEntries = normalizeItemsToEntries(data.features);
    for (const [id, item] of featureEntries) {
      // v2: use # prefix instead of @ for features
      extractRefsFromItem(`#${id}`, item, filePath, refs, seen);
    }

    // Process components
    const componentEntries = normalizeItemsToEntries(data.components);
    for (const [id, item] of componentEntries) {
      extractRefsFromItem(`#${id}`, item, filePath, refs, seen);
    }
  }

  return refs;
}

/**
 * Extract symbol references from a single item
 */
function extractRefsFromItem(
  sourceSymbol: string,
  item: PurposeItem,
  filePath: string,
  refs: ExtractedSymbolRef[],
  seen: Set<string>
): void {
  // Extract from explicit arrays
  if (item.flows) {
    for (const flow of item.flows) {
      const symbol = flow.startsWith('$') ? flow : `$${flow}`;
      if (!seen.has(symbol)) {
        seen.add(symbol);
        refs.push({ symbol, type: 'flow', sourceSymbol, filePath });
      }
    }
  }

  if (item.gates) {
    for (const gate of item.gates) {
      const symbol = gate.startsWith('^') ? gate : `^${gate}`;
      if (!seen.has(symbol)) {
        seen.add(symbol);
        refs.push({ symbol, type: 'gate', sourceSymbol, filePath });
      }
    }
  }

  if (item.signals) {
    for (const signal of item.signals) {
      const symbol = signal.startsWith('!') ? signal : `!${signal}`;
      if (!seen.has(symbol)) {
        seen.add(symbol);
        refs.push({ symbol, type: 'signal', sourceSymbol, filePath });
      }
    }
  }

  // v2: states are now #components with [state] tag
  if (item.states) {
    for (const state of item.states) {
      // Convert legacy %state to #component
      const symbol = state.startsWith('#') ? state :
                     state.startsWith('%') ? `#${state.slice(1)}` : `#${state}`;
      if (!seen.has(symbol)) {
        seen.add(symbol);
        refs.push({ symbol, type: 'component', sourceSymbol, filePath });
      }
    }
  }

  if (item.components) {
    for (const comp of item.components) {
      const symbol = comp.startsWith('#') ? comp : `#${comp}`;
      if (!seen.has(symbol)) {
        seen.add(symbol);
        refs.push({ symbol, type: 'component', sourceSymbol, filePath });
      }
    }
  }

  if (item.aspects) {
    for (const aspect of item.aspects) {
      const symbol = aspect.startsWith('~') ? aspect : `~${aspect}`;
      if (!seen.has(symbol)) {
        seen.add(symbol);
        refs.push({ symbol, type: 'aspect', sourceSymbol, filePath });
      }
    }
  }

  // Also extract from description using regex
  if (item.description) {
    const descRefs = extractSymbolsFromText(item.description);
    for (const { symbol, type } of descRefs) {
      if (!seen.has(symbol)) {
        seen.add(symbol);
        refs.push({ symbol, type, sourceSymbol, filePath });
      }
    }
  }
}

// Common framework aliases that look like symbols but aren't
// SvelteKit: $lib, $env, $app, $service-worker
// Vite: $virtual
// Other: $schema (JSON schema), $ref (JSON reference)
const SYMBOL_BLOCKLIST = new Set([
  '$lib', '$env', '$app', '$service-worker',
  '$virtual', '$schema', '$ref', '$id', '$type',
]);

/**
 * Extract symbol references from text using regex (v2)
 *
 * v2 symbols: # $ ^ ! ~
 * Legacy % is converted to # for backward compatibility
 */
function extractSymbolsFromText(text: string): Array<{ symbol: string; type: ExtractedSymbolRef['type'] }> {
  const results: Array<{ symbol: string; type: ExtractedSymbolRef['type'] }> = [];

  // Match v2 symbols: #component, $flow, ^gate, !signal, ~aspect
  // Also match legacy %state for backward compatibility (converts to #component)
  const pattern = /([$^!#~%])([a-zA-Z][a-zA-Z0-9._-]*)/g;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const prefix = match[1];
    const id = match[2];

    let symbol: string;
    let type: ExtractedSymbolRef['type'];

    switch (prefix) {
      case '#': type = 'component'; symbol = `#${id}`; break;
      case '$': type = 'flow'; symbol = `$${id}`; break;
      case '^': type = 'gate'; symbol = `^${id}`; break;
      case '!': type = 'signal'; symbol = `!${id}`; break;
      case '~': type = 'aspect'; symbol = `~${id}`; break;
      // Legacy: %state → #component
      case '%': type = 'component'; symbol = `#${id}`; break;
      default: continue;
    }

    // Skip common framework aliases
    if (SYMBOL_BLOCKLIST.has(symbol)) continue;

    results.push({ symbol, type });
  }

  return results;
}
