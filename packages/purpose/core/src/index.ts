/**
 * @a-company/purpose-core
 *
 * Purpose file parsing, validation, and aggregation
 */

// Types
export type {
  PurposeFile,
  PurposeItem,
  PurposeItemArray,
  AggregatedPurpose,
  Relationship,
  FlowWithSteps,
  FlowDefinition,
  FlowStep,
  GateDefinition,
  StateDefinition,
  SignalDefinition,
  AspectDefinition,
  Reference,
  ParseResult,
  ParseError,
  ValidationResult,
  ValidationIssue,
  GraphNode,
  GraphEdge,
  GraphData,
} from './types.js';

// Parser
export {
  parsePurposeFile,
  parsePurposeFileDetailed,
  parsePurposeContent,
  serializePurposeFile,
  getDefaultPurposeContent,
} from './parser.js';

// Aggregator
export type { ParsedPurposeFile, ExtractedFlow, ExtractedSymbolRef } from './aggregator.js';
export {
  aggregatePurposes,
  findPurposeFiles,
  collectPurposeChain,
  aggregateForPath,
  getAllPurposeFiles,
  extractFeatures,
  extractComponents,
  extractGates,
  extractStates,
  extractFlows,
  extractSignals,
  extractAspects,
  extractSymbolReferences,
} from './aggregator.js';

// Validator
export {
  validatePurposeFile,
  validateCrossFile,
  formatValidationResult,
} from './validator.js';
