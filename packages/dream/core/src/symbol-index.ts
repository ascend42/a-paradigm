/**
 * Unified Symbol Index
 *
 * Central registry of all symbols across Purpose, Gate, and Dream sources
 */

import type {
  SymbolEntry,
  SymbolType,
  SourceType,
  SymbolIndex,
  AggregationResult,
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
    }
  }

  return results;
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
 * Get symbol counts by type
 */
export function getSymbolCounts(index: SymbolIndex): Record<SymbolType, number> {
  const counts: Record<SymbolType, number> = {
    feature: 0,
    component: 0,
    flow: 0,
    state: 0,
    aspect: 0,
    gate: 0,
    signal: 0,
    idea: 0,
  };

  for (const [type, symbols] of index.byType) {
    counts[type] = symbols.length;
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
 * Parse a symbol string to extract type and name
 */
export function parseSymbol(symbol: string): { type: SymbolType; name: string; ideaType?: SymbolType } | null {
  if (symbol.length < 2) return null;

  // CRITICAL: Check compound idea prefixes FIRST (?@, ?#, ?!, etc.)
  // This must come before single prefix check to avoid mis-parsing
  if (symbol.startsWith('?') && symbol.length >= 3) {
    const secondChar = symbol[1];
    const prefixToType: Record<string, SymbolType> = {
      '@': 'feature',
      '#': 'component',
      '$': 'flow',
      '%': 'state',
      '~': 'aspect',
      '^': 'gate',
      '!': 'signal',
    };
    
    if (secondChar in prefixToType) {
      // Compound idea: ?@subscription -> idea for a feature
      return {
        type: 'idea',
        name: symbol.slice(2), // Remove "?@"
        ideaType: prefixToType[secondChar],
      };
    }
    // Simple idea: ?subscription
    return { type: 'idea', name: symbol.slice(1) };
  }

  // Standard single-prefix parsing
  const prefix = symbol[0];
  const name = symbol.slice(1);

  const prefixToType: Record<string, SymbolType> = {
    '@': 'feature',
    '#': 'component',
    '$': 'flow',
    '%': 'state',
    '~': 'aspect',
    '^': 'gate',
    '!': 'signal',
    '?': 'idea',
  };

  const type = prefixToType[prefix];
  if (!type) return null;

  return { type, name };
}

/**
 * Create a symbol string from type and name
 */
export function createSymbolString(type: SymbolType, name: string): string {
  const prefixes: Record<SymbolType, string> = {
    feature: '@',
    component: '#',
    flow: '$',
    state: '%',
    aspect: '~',
    gate: '^',
    signal: '!',
    idea: '?',
  };

  return `${prefixes[type]}${name}`;
}

/**
 * Validate a symbol string format
 */
export function isValidSymbol(symbol: string): boolean {
  return parseSymbol(symbol) !== null;
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
