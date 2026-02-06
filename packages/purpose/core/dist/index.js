/**
 * @a-company/purpose-core
 *
 * Purpose file parsing, validation, and aggregation
 */
// Parser
export { parsePurposeFile, parsePurposeFileDetailed, parsePurposeContent, serializePurposeFile, getDefaultPurposeContent, } from './parser.js';
export { aggregatePurposes, findPurposeFiles, collectPurposeChain, aggregateForPath, getAllPurposeFiles, extractFeatures, extractComponents, extractGates, extractStates, extractFlows, extractSignals, extractAspects, extractSymbolReferences, } from './aggregator.js';
// Validator
export { validatePurposeFile, formatValidationResult, } from './validator.js';
//# sourceMappingURL=index.js.map