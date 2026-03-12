/**
 * Unified Symbol Index
 *
 * Central registry of all symbols across Purpose, Gate, and Dream sources
 */

import {
  PREFIX_TO_TYPE,
  SYMBOL_PREFIXES,
  LEGACY_PREFIX_TO_TYPE,
  isValidPrefix,
  isLegacyPrefix,
  type SymbolEntry,
  type SymbolType,
  type LegacySymbolType,
  type SourceType,
  type SymbolIndex,
  type AggregationResult,
  type CodeAnchor,
} from './types.js';

/**
 * Create a new empty symbol index
 */
export function createSymbolIndex(): SymbolIndex {
  return {
    entries: new Map(),
    byType: new Map(),
    bySource: new Map(),
    timestamp: 0,
  };
}

/**
 * Build a symbol index from aggregation results
 */
export function buildSymbolIndex(result: AggregationResult): SymbolIndex {
  const index = createSymbolIndex();
  index.timestamp = result.timestamp;

  for (const symbol of result.symbols) {
    // Add to main entries
    index.entries.set(symbol.id, symbol);

    // Add to byType
    if (!index.byType.has(symbol.type)) {
      index.byType.set(symbol.type, []);
    }
    index.byType.get(symbol.type)!.push(symbol);

    // Add to bySource
    if (!index.bySource.has(symbol.source)) {
      index.bySource.set(symbol.source, []);
    }
    index.bySource.get(symbol.source)!.push(symbol);
  }

  return index;
}

/**
 * Get a symbol by its full symbol string (e.g., "@checkout")
 */
export function getSymbol(index: SymbolIndex, symbol: string): SymbolEntry | undefined {
  for (const entry of index.entries.values()) {
    if (entry.symbol === symbol) {
      return entry;
    }
  }
  return undefined;
}

/**
 * Get a symbol by ID
 */
export function getSymbolById(index: SymbolIndex, id: string): SymbolEntry | undefined {
  return index.entries.get(id);
}

/**
 * Get all symbols of a specific type
 */
export function getSymbolsByType(index: SymbolIndex, type: SymbolType): SymbolEntry[] {
  return index.byType.get(type) || [];
}

/**
 * Get all symbols from a specific source
 */
export function getSymbolsBySource(index: SymbolIndex, source: SourceType): SymbolEntry[] {
  return index.bySource.get(source) || [];
}

/**
 * Search symbols by query string
 */
export function searchSymbols(index: SymbolIndex, query: string): SymbolEntry[] {
  const lowerQuery = query.toLowerCase();
  const results: SymbolEntry[] = [];

  for (const entry of index.entries.values()) {
    // Match symbol name
    if (entry.symbol.toLowerCase().includes(lowerQuery)) {
      results.push(entry);
      continue;
    }

    // Match description
    if (entry.description?.toLowerCase().includes(lowerQuery)) {
      results.push(entry);
      continue;
    }

    // Match tags
    if (entry.tags?.some((tag) => tag.toLowerCase().includes(lowerQuery))) {
      results.push(entry);
      continue;
    }

    // Match component type
    if (entry.componentType?.toLowerCase().includes(lowerQuery)) {
      results.push(entry);
      continue;
    }
  }

  return results;
}

/**
 * Get components filtered by component type
 */
export function getComponentsByType(index: SymbolIndex, componentType: string): SymbolEntry[] {
  const components = getSymbolsByType(index, 'component');
  return components.filter(c => c.componentType === componentType);
}

/**
 * Get all unique component types in the index
 */
export function getAllComponentTypes(index: SymbolIndex): string[] {
  const types = new Set<string>();
  const components = getSymbolsByType(index, 'component');
  for (const comp of components) {
    if (comp.componentType) {
      types.add(comp.componentType);
    }
  }
  return Array.from(types).sort();
}

/**
 * Get child components of a parent symbol
 */
export function getChildComponents(index: SymbolIndex, parentSymbol: string): SymbolEntry[] {
  const components = getSymbolsByType(index, 'component');
  return components.filter(c => c.parentSymbol === parentSymbol);
}

/**
 * Get symbols that reference a given symbol
 */
export function getReferencesTo(index: SymbolIndex, symbol: string): SymbolEntry[] {
  const entry = getSymbol(index, symbol);
  if (!entry) return [];

  return entry.referencedBy
    .map((ref) => getSymbol(index, ref))
    .filter((e): e is SymbolEntry => e !== undefined);
}

/**
 * Get symbols that are referenced by a given symbol
 */
export function getReferencesFrom(index: SymbolIndex, symbol: string): SymbolEntry[] {
  const entry = getSymbol(index, symbol);
  if (!entry) return [];

  return entry.references
    .map((ref) => getSymbol(index, ref))
    .filter((e): e is SymbolEntry => e !== undefined);
}

/**
 * Get symbols by tag
 */
export function getSymbolsByTag(index: SymbolIndex, tag: string): SymbolEntry[] {
  const results: SymbolEntry[] = [];

  for (const entry of index.entries.values()) {
    if (entry.tags?.includes(tag)) {
      results.push(entry);
    }
  }

  return results;
}

/**
 * Get all unique tags in the index
 */
export function getAllTags(index: SymbolIndex): string[] {
  const tags = new Set<string>();

  for (const entry of index.entries.values()) {
    for (const tag of entry.tags || []) {
      tags.add(tag);
    }
  }

  return Array.from(tags).sort();
}

/**
 * Get symbol counts by type (v2)
 */
export function getSymbolCounts(index: SymbolIndex): Record<SymbolType, number> {
  const counts: Record<SymbolType, number> = {
    component: 0,
    flow: 0,
    gate: 0,
    signal: 0,
    aspect: 0,
  };

  for (const [type, symbols] of index.byType) {
    if (type in counts) {
      counts[type as SymbolType] = symbols.length;
    }
  }

  return counts;
}

/**
 * Get all symbols as a flat array
 */
export function getAllSymbols(index: SymbolIndex): SymbolEntry[] {
  return Array.from(index.entries.values());
}

/**
 * Parse a symbol string to extract type and name (v2)
 *
 * Valid prefixes: # $ ^ ! ~
 * Legacy prefixes (@ % ? &) return null - use parseLegacySymbol for migration
 */
export function parseSymbol(symbol: string): { type: SymbolType; name: string } | null {
  if (symbol.length < 2) return null;

  const prefix = symbol[0];
  const name = symbol.slice(1);

  // Only accept v2 prefixes
  if (!isValidPrefix(prefix)) {
    return null;
  }

  const type = PREFIX_TO_TYPE[prefix];
  return { type, name };
}

/**
 * Parse a legacy v1 symbol (for migration support)
 *
 * @deprecated Use tags instead of @ % ? & prefixes
 */
export function parseLegacySymbol(symbol: string): {
  type: LegacySymbolType;
  name: string;
  suggestedTag: string;
  migratedSymbol: string;
} | null {
  if (symbol.length < 2) return null;

  const prefix = symbol[0];
  const name = symbol.slice(1);

  if (!isLegacyPrefix(prefix)) {
    return null;
  }

  const type = LEGACY_PREFIX_TO_TYPE[prefix];

  // Map legacy type to suggested tag
  const tagMap: Record<LegacySymbolType, string> = {
    feature: 'feature',
    state: 'state',
    idea: 'idea',
    integration: 'integration',
  };

  return {
    type,
    name,
    suggestedTag: tagMap[type],
    migratedSymbol: `#${name}`, // All legacy symbols become #component
  };
}

/**
 * Parse any symbol (v2 or legacy) - useful for migration
 */
export function parseAnySymbol(symbol: string): {
  type: SymbolType | LegacySymbolType;
  name: string;
  isLegacy: boolean;
  suggestedTag?: string;
} | null {
  // Try v2 first
  const v2Result = parseSymbol(symbol);
  if (v2Result) {
    return { ...v2Result, isLegacy: false };
  }

  // Try legacy
  const legacyResult = parseLegacySymbol(symbol);
  if (legacyResult) {
    return {
      type: legacyResult.type,
      name: legacyResult.name,
      isLegacy: true,
      suggestedTag: legacyResult.suggestedTag,
    };
  }

  return null;
}

/**
 * Create a symbol string from type and name (v2)
 */
export function createSymbolString(type: SymbolType, name: string): string {
  return `${SYMBOL_PREFIXES[type]}${name}`;
}

/**
 * Validate a symbol string format (v2 only)
 */
export function isValidSymbol(symbol: string): boolean {
  return parseSymbol(symbol) !== null;
}

/**
 * Check if a symbol uses legacy v1 format
 */
export function isLegacySymbol(symbol: string): boolean {
  if (symbol.length < 2) return false;
  return isLegacyPrefix(symbol[0]);
}

/**
 * Parse an anchor string into a CodeAnchor object
 *
 * Formats:
 * - file.ts:15 (single line)
 * - file.ts:15-20 (range)
 * - file.ts:15,25,30 (multiple lines)
 */
export function parseAnchor(anchor: string): CodeAnchor | null {
  const colonIndex = anchor.lastIndexOf(':');
  if (colonIndex === -1) {
    // No line reference, just file path
    return {
      path: anchor,
      lines: 1,
      raw: anchor,
    };
  }

  const path = anchor.slice(0, colonIndex);
  const lineSpec = anchor.slice(colonIndex + 1);

  // Check for range (15-20)
  if (lineSpec.includes('-')) {
    const [start, end] = lineSpec.split('-').map(Number);
    if (isNaN(start) || isNaN(end)) return null;
    return {
      path,
      lines: [start, end],
      raw: anchor,
    };
  }

  // Check for multiple lines (15,25,30)
  if (lineSpec.includes(',')) {
    const lines = lineSpec.split(',').map(Number);
    if (lines.some(isNaN)) return null;
    return {
      path,
      lines,
      raw: anchor,
    };
  }

  // Single line
  const line = Number(lineSpec);
  if (isNaN(line)) return null;
  return {
    path,
    lines: line,
    raw: anchor,
  };
}

/**
 * Validate that an aspect has required anchors
 */
export function validateAspectAnchors(entry: SymbolEntry): {
  valid: boolean;
  errors: string[];
} {
  if (entry.type !== 'aspect') {
    return { valid: true, errors: [] };
  }

  const errors: string[] = [];

  if (!entry.anchors || entry.anchors.length === 0) {
    errors.push(`Aspect ${entry.symbol} requires at least one code anchor`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get autocomplete suggestions for partial symbol input
 */
export function getAutocompleteSuggestions(
  index: SymbolIndex,
  partial: string,
  limit = 10
): SymbolEntry[] {
  const lowerPartial = partial.toLowerCase();

  // If starts with a symbol prefix, filter by type
  const parsed = parseSymbol(partial);
  if (parsed) {
    const typeSymbols = getSymbolsByType(index, parsed.type);
    return typeSymbols
      .filter((s) => s.symbol.toLowerCase().includes(lowerPartial))
      .slice(0, limit);
  }

  // Otherwise, search all symbols
  return searchSymbols(index, partial).slice(0, limit);
}
