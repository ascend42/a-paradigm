/**
 * Aggregator - pulls symbols from Purpose and Gate into a unified index
 */

import * as path from 'path';
import {
  getAllPurposeFiles,
  extractFeatures,
  extractComponents,
} from '@a-company/purpose-core';
import { parseGateConfig, findGateFiles, type ParsedGateConfig, type Gate, type Flow } from '@a-company/portal-core';
import { parseSymbol } from './symbol-index.js';
import type {
  DreamFile,
  SymbolEntry,
  SymbolType,
  SourceType,
  AggregationResult,
  AggregationError,
} from './types.js';

/**
 * Aggregate all symbols from a dream configuration
 */
export async function aggregateFromDream(
  dreamFile: DreamFile,
  rootDir: string
): Promise<AggregationResult> {
  const symbols: SymbolEntry[] = [];
  const errors: AggregationError[] = [];
  const purposeFiles: string[] = [];
  const gateFiles: string[] = [];

  // Aggregate from Purpose sources
  if (dreamFile.sources.purpose) {
    for (const source of dreamFile.sources.purpose) {
      const sourcePath = path.resolve(rootDir, source.path);
      try {
        const parsed = await getAllPurposeFiles(sourcePath);
        purposeFiles.push(...parsed.map((p) => p.filePath));

        // Extract features
        const features = extractFeatures(parsed);
        for (const [id, { item, filePath }] of features) {
          symbols.push(createSymbolEntry({
            id: `purpose-feature-${id}`,
            symbol: `@${id}`,
            type: 'feature',
            source: 'purpose',
            filePath,
            data: item,
            description: item.description,
          }));
        }

        // Extract components
        const components = extractComponents(parsed);
        for (const [id, { item, filePath }] of components) {
          symbols.push(createSymbolEntry({
            id: `purpose-component-${id}`,
            symbol: `#${id}`,
            type: 'component',
            source: 'purpose',
            filePath,
            data: item,
            description: item.description,
          }));
        }

        // Extract flows from purpose files
        for (const { filePath, data } of parsed) {
          if (data.flows) {
            for (const flow of data.flows) {
              symbols.push(createSymbolEntry({
                id: `purpose-flow-${flow.name}`,
                symbol: `$${flow.name}`,
                type: 'flow',
                source: 'purpose',
                filePath,
                data: flow,
                description: flow.description,
              }));
            }
          }
        }
      } catch (e: unknown) {
        errors.push({
          source: 'purpose',
          filePath: sourcePath,
          message: (e as Error).message,
        });
      }
    }
  }

  // Aggregate from Gate sources
  if (dreamFile.sources.gate) {
    for (const source of dreamFile.sources.gate) {
      const sourcePath = path.resolve(rootDir, source.path);
      try {
        // Check if it's a specific file or directory
        let gateConfig: ParsedGateConfig;
        if (sourcePath.endsWith('.yaml') || sourcePath.endsWith('.yml')) {
          gateConfig = await parseGateConfig(sourcePath);
          gateFiles.push(sourcePath);
        } else {
          const files = await findGateFiles(sourcePath);
          gateFiles.push(...files);
          if (files.length > 0) {
            gateConfig = await parseGateConfig(files[0]);
            // Merge additional files
            for (let i = 1; i < files.length; i++) {
              const additional = await parseGateConfig(files[i]);
              gateConfig.gates.push(...additional.gates);
              gateConfig.flows.push(...additional.flows);
            }
          } else {
            continue;
          }
        }

        // Extract gates
        for (const gate of gateConfig.gates) {
          symbols.push(createGateSymbol(gate, sourcePath));

          // Extract signals (prizes) from gates
          for (const prize of gate.prizes) {
            symbols.push(createSymbolEntry({
              id: `gate-signal-${gate.id}-${prize.id}`,
              symbol: `!${prize.id}`,
              type: 'signal',
              source: 'gate',
              filePath: sourcePath,
              data: prize,
              description: `Signal from gate ${gate.id}`,
            }));
          }
        }

        // Extract flows
        for (const flow of gateConfig.flows) {
          symbols.push(createFlowSymbol(flow, sourcePath));
        }
      } catch (e: unknown) {
        errors.push({
          source: 'gate',
          filePath: sourcePath,
          message: (e as Error).message,
        });
      }
    }
  }

  // Add dream-native nodes
  for (const node of dreamFile.nodes) {
    // Skip if this is a reference to an existing symbol (no content)
    if (!node.content && node.type !== 'idea') {
      // Find existing symbol and update position
      const existing = symbols.find((s) => s.symbol === node.symbol);
      if (existing) {
        existing.position = node.position;
        existing.tags = node.tags;
        continue;
      }
    }

    // Parse symbol to check for compound idea type
    const parsed = parseSymbol(node.symbol);
    const ideaType = parsed?.ideaType;

    symbols.push(createSymbolEntry({
      id: node.id,
      symbol: node.symbol,
      type: node.type,
      ideaType,
      source: 'dream',
      filePath: '.premise',
      data: node,
      description: node.content,
      position: node.position,
      tags: node.tags,
      created: node.created,
      modified: node.modified,
    }));
  }

  // Resolve cross-references
  resolveReferences(symbols);

  return {
    symbols,
    purposeFiles,
    gateFiles,
    errors,
    timestamp: Date.now(),
  };
}

/**
 * Create a symbol entry with defaults
 */
function createSymbolEntry(partial: Partial<SymbolEntry> & {
  id: string;
  symbol: string;
  type: SymbolType;
  source: SourceType;
  filePath: string;
}): SymbolEntry {
  return {
    ...partial,
    data: partial.data ?? null,
    references: partial.references ?? [],
    referencedBy: partial.referencedBy ?? [],
  };
}

/**
 * Create a symbol entry from a Gate
 */
function createGateSymbol(gate: Gate, filePath: string): SymbolEntry {
  return createSymbolEntry({
    id: `gate-${gate.id}`,
    symbol: `^${gate.id}`,
    type: 'gate',
    source: 'gate',
    filePath,
    data: gate,
    description: gate.description,
    position: gate.position,
  });
}

/**
 * Create a symbol entry from a Flow
 */
function createFlowSymbol(flow: Flow, filePath: string): SymbolEntry {
  return createSymbolEntry({
    id: `gate-flow-${flow.id}`,
    symbol: `$${flow.id}`,
    type: 'flow',
    source: 'gate',
    filePath,
    data: flow,
    description: flow.description,
  });
}

/**
 * Resolve cross-references between symbols
 */
function resolveReferences(symbols: SymbolEntry[]): void {
  const symbolMap = new Map(symbols.map((s) => [s.symbol, s]));

  for (const symbol of symbols) {
    // Find references in the data
    const dataStr = JSON.stringify(symbol.data);
    // Match compound ideas (?@, ?#, etc.) OR single prefixes
    // This ensures ?@subscription matches as one symbol, not split into ? and @subscription
    const refPattern = /(?:\?[@#$%~^!]|[@#$%~^!?])[\w-]+/g;
    const matches = dataStr.match(refPattern) || [];

    for (const match of matches) {
      if (match !== symbol.symbol && symbolMap.has(match)) {
        // Add to references
        if (!symbol.references.includes(match)) {
          symbol.references.push(match);
        }

        // Add to referencedBy on target
        const target = symbolMap.get(match);
        if (target && !target.referencedBy.includes(symbol.symbol)) {
          target.referencedBy.push(symbol.symbol);
        }
      }
    }
  }
}

/**
 * Aggregate from a directory without a .premise file
 */
export async function aggregateFromDirectory(rootDir: string): Promise<AggregationResult> {
  // Create a default dream file configuration
  const dreamFile: DreamFile = {
    version: '1.0.0',
    metadata: {
      name: path.basename(rootDir),
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    },
    sources: {
      purpose: [{ path: './' }],
      gate: [{ path: './' }],
    },
    nodes: [],
    connections: [],
    layout: {
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  };

  return aggregateFromDream(dreamFile, rootDir);
}
