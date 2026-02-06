/**
 * Browser-compatible types for the visualizer
 * These mirror the types from @a-company/premise-core but without Node.js dependencies
 */

export type SymbolType =
  | 'feature'
  | 'component'
  | 'flow'
  | 'state'
  | 'aspect'
  | 'portal'
  | 'signal'
  | 'idea';

export type SourceType = 'purpose' | 'portal' | 'premise';

export interface Position {
  x: number;
  y: number;
}

export interface SymbolEntry {
  id: string;
  symbol: string;
  type: SymbolType;
  /** For compound ideas (?@, ?#, etc.), the type this idea represents */
  ideaType?: SymbolType;
  source: SourceType;
  filePath: string;
  data: unknown;
  references: string[];
  referencedBy: string[];
  position?: Position;
  tags?: string[];
  description?: string;
  created?: string;
  modified?: string;
}

export interface SymbolIndex {
  entries: Map<string, SymbolEntry>;
  byType: Map<SymbolType, SymbolEntry[]>;
  bySource: Map<SourceType, SymbolEntry[]>;
  timestamp: number;
}

// Incident types for the UI
export interface IncidentSummary {
  id: string;
  timestamp: string;
  status: 'open' | 'investigating' | 'resolved' | 'wont-fix';
  error: {
    message: string;
    type?: string;
  };
  symbols: {
    feature?: string;
    component?: string;
    flow?: string;
    gate?: string;
    signal?: string;
  };
  environment: string;
  patternMatches?: {
    patternId: string;
    patternName: string;
    confidence: number;
  }[];
}

export interface PatternSummary {
  id: string;
  name: string;
  description: string;
  confidence: {
    score: number;
    timesMatched: number;
    timesResolved: number;
  };
  tags: string[];
}

export interface CommitInfo {
  hash: string;
  shortHash: string;
  date: string;
  author: string;
  message: string;
  symbolsModified: string[];
  filesChanged: string[];
}

// Symbol utilities
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
      '^': 'portal',
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
    '^': 'portal',
    '!': 'signal',
    '?': 'idea',
  };

  const type = prefixToType[prefix];
  if (!type) return null;

  return { type, name };
}

export function createSymbolIndex(): SymbolIndex {
  return {
    entries: new Map(),
    byType: new Map(),
    bySource: new Map(),
    timestamp: 0,
  };
}
