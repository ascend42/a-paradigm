/**
 * @a-company/purpose-core
 *
 * Purpose file parsing, validation, and aggregation
 */
export type { PurposeFile, PurposeItem, PurposeItemArray, AggregatedPurpose, Relationship, FlowWithSteps, FlowDefinition, FlowStep, GateDefinition, StateDefinition, SignalDefinition, AspectDefinition, Reference, ParseResult, ParseError, ValidationResult, ValidationIssue, GraphNode, GraphEdge, GraphData, } from './types.js';
export { parsePurposeFile, parsePurposeFileDetailed, parsePurposeContent, serializePurposeFile, getDefaultPurposeContent, } from './parser.js';
export type { ParsedPurposeFile, ExtractedFlow, ExtractedSymbolRef } from './aggregator.js';
export { aggregatePurposes, findPurposeFiles, collectPurposeChain, aggregateForPath, getAllPurposeFiles, extractFeatures, extractComponents, extractGates, extractStates, extractFlows, extractSignals, extractAspects, extractSymbolReferences, } from './aggregator.js';
export { validatePurposeFile, formatValidationResult, } from './validator.js';
//# sourceMappingURL=index.d.ts.map