/**
 * @horizon/gate-core
 *
 * Gate configuration parsing and validation
 */

// Types
export type {
  Key,
  Lock,
  Prize,
  Gate,
  Flow,
  DevSettings,
  GateConfig,
  ParsedGateConfig,
  KeyResult,
  LockResult,
  GateCheckResult,
  WatcherEventType,
  WatcherEvent,
  ValidationIssue,
  ValidationResult,
  GraphNode,
  GraphEdge,
  GraphData,
} from './types.js';

// Parser
export {
  parseGateConfig,
  parseGateFile,
  serializeGateConfig,
  getDefaultGateConfig,
  findGateFiles,
} from './parser.js';

// Validator
export {
  validateGateConfig,
  formatValidationResult,
} from './validator.js';
