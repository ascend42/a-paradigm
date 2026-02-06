/**
 * Browser-compatible types for the visualizer
 * These mirror the types from @a-company/premise-core but without Node.js dependencies
 *
 * Symbol System v2:
 * - 5 operational symbols: # $ ^ ! ~
 * - Classification via tags instead of symbol prefixes
 */

/**
 * Symbol type identifiers (v2 - 5 operational symbols)
 */
export type SymbolType =
  | 'component'  // # - Any documented code unit
  | 'flow'       // $ - Multi-step process
  | 'gate'       // ^ - Authorization checkpoint
  | 'signal'     // ! - Event for side effects
  | 'aspect';    // ~ - Rule with required code anchor

/**
 * Legacy symbol types (v1) - kept for migration/backward compat
 * @deprecated Use tags instead: [feature], [state], [idea], [integration]
 */
export type LegacySymbolType = 'feature' | 'state' | 'idea' | 'integration' | 'portal';

export type SourceType = 'purpose' | 'gate' | 'premise';

export interface Position {
  x: number;
  y: number;
}

/**
 * Code anchor reference (v2)
 * Format: file.ts:15 (single line), file.ts:15-20 (range), file.ts:15,25,30 (multiple)
 */
export interface CodeAnchor {
  /** File path */
  path: string;
  /** Line number(s) - can be single, range, or array */
  lines: number | [number, number] | number[];
  /** Raw anchor string as defined */
  raw: string;
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
  /** User-assigned tags (v2 classification) */
  tags?: string[];
  /** Code anchors - REQUIRED for aspects (~) */
  anchors?: CodeAnchor[];
  description?: string;
  created?: string;
  modified?: string;
  /** For aspects: patterns this aspect applies to */
  appliesTo?: string[];
  /** For aspects: enforcement description */
  enforcement?: string;
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

// Symbol prefixes (v2)
const V2_PREFIX_TO_TYPE: Record<string, SymbolType> = {
  '#': 'component',
  '$': 'flow',
  '^': 'gate',
  '!': 'signal',
  '~': 'aspect',
};

// Legacy prefixes (v1) - for backward compatibility
const LEGACY_PREFIX_TO_TYPE: Record<string, LegacySymbolType> = {
  '@': 'feature',
  '%': 'state',
  '?': 'idea',
  '&': 'integration',
};

/**
 * Parse a symbol string (v2)
 * Only recognizes v2 prefixes: # $ ^ ! ~
 */
export function parseSymbol(symbol: string): { type: SymbolType; name: string } | null {
  if (symbol.length < 2) return null;

  const prefix = symbol[0];
  const name = symbol.slice(1);

  const type = V2_PREFIX_TO_TYPE[prefix];
  if (!type) return null;

  return { type, name };
}

/**
 * Parse a legacy v1 symbol (for migration support)
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

  const type = LEGACY_PREFIX_TO_TYPE[prefix];
  if (!type) return null;

  // Map legacy type to suggested tag
  const tagMap: Record<LegacySymbolType, string> = {
    feature: 'feature',
    state: 'state',
    idea: 'idea',
    integration: 'integration',
    portal: 'gate', // portal → gate tag
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

export function createSymbolIndex(): SymbolIndex {
  return {
    entries: new Map(),
    byType: new Map(),
    bySource: new Map(),
    timestamp: 0,
  };
}
