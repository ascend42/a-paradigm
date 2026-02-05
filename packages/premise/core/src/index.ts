/**
 * @a-company/premise-core
 *
 * Dream aggregation, symbol index, and canvas state management
 */

// Types
export type {
  SymbolType,
  SourceType,
  Position,
  SymbolEntry,
  DreamSourceConfig,
  DreamNode,
  DreamConnection,
  DreamGroup,
  Viewport,
  DreamLayout,
  DreamSnapshot,
  DreamFile,
  AggregationResult,
  AggregationError,
  SymbolIndex,
  // Testable Flow types
  FlowStep,
  FlowValidation,
  TestableFlow,
  FlowIndex,
} from './types.js';

export { SYMBOL_PREFIXES, PREFIX_TO_TYPE } from './types.js';

// Parser
export {
  parseDreamFile,
  parseDreamContent,
  createEmptyDreamFile,
  serializeDreamFile,
  getDefaultDreamContent,
  addDreamNode,
  updateNodePosition,
  addConnection,
  createSnapshot,
} from './parser.js';

// Aggregator
export {
  aggregateFromDream,
  aggregateFromDirectory,
} from './aggregator.js';

// Symbol Index
export {
  createSymbolIndex,
  buildSymbolIndex,
  getSymbol,
  getSymbolById,
  getSymbolsByType,
  getSymbolsBySource,
  searchSymbols,
  getReferencesTo,
  getReferencesFrom,
  getSymbolsByTag,
  getAllTags,
  getSymbolCounts,
  getAllSymbols,
  parseSymbol,
  createSymbolString,
  isValidSymbol,
  getAutocompleteSuggestions,
} from './symbol-index.js';
