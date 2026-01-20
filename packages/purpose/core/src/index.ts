/**
 * @a-company/purpose-core
 *
 * Purpose file parsing, validation, and aggregation
 */

// Types
export type {
  PurposeFile,
  PurposeItem,
  AggregatedPurpose,
  Relationship,
  Flow,
  FlowStep,
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
export type { ParsedPurposeFile } from './aggregator.js';
export {
  aggregatePurposes,
  findPurposeFiles,
  collectPurposeChain,
  aggregateForPath,
  getAllPurposeFiles,
  extractFeatures,
  extractComponents,
} from './aggregator.js';

// Validator
export {
  validatePurposeFile,
  formatValidationResult,
} from './validator.js';
