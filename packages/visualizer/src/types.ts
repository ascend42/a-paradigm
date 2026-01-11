/**
 * Browser-compatible types for the visualizer
 * These mirror the types from @horizon/dream-core but without Node.js dependencies
 */

export type SymbolType =
  | 'feature'
  | 'component'
  | 'flow'
  | 'state'
  | 'aspect'
  | 'gate'
  | 'signal'
  | 'idea';

export type SourceType = 'purpose' | 'gate' | 'dream';

export interface Position {
  x: number;
  y: number;
}

export interface SymbolEntry {
  id: string;
  symbol: string;
  type: SymbolType;
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

// Symbol utilities
export function parseSymbol(symbol: string): { type: SymbolType; name: string } | null {
  if (symbol.length < 2) return null;

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

export function createSymbolIndex(): SymbolIndex {
  return {
    entries: new Map(),
    byType: new Map(),
    bySource: new Map(),
    timestamp: 0,
  };
}
