/**
 * @horizon/scan-core
 * Visual discovery layer for AI agents
 */

// Types
export type {
  ScanCategory,
  VisualTag,
  ScanElement,
  ScanFlow,
  ScanFlowStep,
  ScanState,
  ScanScreen,
  ScanIndexMeta,
  ScanIndex,
  ScanMode,
  ConfidenceLevel,
  ScanMatch,
  ScanResult,
  ScanConfig,
} from './types.js';

// Generator
export {
  generateScanIndex,
  serializeScanIndex,
  parseScanIndex,
  type AggregationInput,
  type GeneratorOptions,
} from './generator.js';

// Protocol template
export { getScanProtocol, type ScanProtocolOptions } from './protocol.js';
