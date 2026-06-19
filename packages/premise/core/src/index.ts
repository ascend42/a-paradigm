/**
 * @a-company/premise-core
 *
 * Premise aggregation, symbol index, and canvas state management
 */

// Types
export type {
  SymbolType,
  SourceType,
  Position,
  SymbolEntry,
  PremiseSourceConfig,
  PremiseNode,
  PremiseConnection,
  PremiseGroup,
  Viewport,
  PremiseLayout,
  PremiseSnapshot,
  PremiseFile,
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
  parsePremiseFile,
  parsePremiseContent,
  createEmptyPremiseFile,
  serializePremiseFile,
  getDefaultPremiseContent,
  addPremiseNode,
  updateNodePosition,
  addConnection,
  createSnapshot,
} from './parser.js';

// Aggregator
export {
  aggregateFromPremise,
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
  getComponentsByType,
  getAllComponentTypes,
  getChildComponents,
} from './symbol-index.js';

// Anchor path resolution
export {
  resolveAnchorPath,
  detectAnchorBaseMismatch,
} from './anchor-path.js';
export type {
  AnchorBase,
  ResolveAnchorPathResult,
  AnchorBaseMismatch,
} from './anchor-path.js';

// Aspect-anchor existence check
export { checkAspectAnchors } from './aspect-anchors.js';
export type { AspectAnchorIssue } from './aspect-anchors.js';

// Graph-slice projector — #graph-slice-projector
export {
  loadLiveGraph,
  projectGraphSlice,
  graphSliceFromRoot,
  sliceToMermaid,
} from './graph-slice.js';
export type {
  GraphSlice,
  GraphSliceNode,
  GraphSliceEdge,
  GraphSliceFreshness,
  ProjectGraphSliceOptions,
  LiveGraph,
  SliceNodeKind,
  SliceEdgeKind,
  SliceMode,
} from './graph-slice.js';
