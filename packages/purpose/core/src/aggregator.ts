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
  GateDefinition, 
  StateDefinition, 
  FlowDefinition,
  FlowWithSteps,
} from './types.js';
import { parsePurposeFile } from './parser.js';

/**
 * Parsed purpose file with its path
 */
export interface ParsedPurposeFile {
  filePath: string;
  data: PurposeFile;
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

    // Merge features and components
    basePurpose.features = { ...basePurpose.features, ...(data.features || {}) };
    basePurpose.components = { ...basePurpose.components, ...(data.components || {}) };
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
    if (data.features) {
      for (const [id, item] of Object.entries(data.features)) {
        features.set(id, { item, filePath });
      }
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
    if (data.components) {
      for (const [id, item] of Object.entries(data.components)) {
        components.set(id, { item, filePath });
      }
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
