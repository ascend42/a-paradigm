// ═══════════════════════════════════════════════════════════════════
// @a-company/paradigm-runtime — main barrel export
// ═══════════════════════════════════════════════════════════════════

// Runtime API operation types
export type {
  RuntimeApiVersion,
  FilterOperator,
  FilterCondition,
  SortDirection,
  SortSpec,
  PaginationOptions,
  EntityResult,
  QueryInput,
  QueryResult,
  MemoryEntry,
  WriteAction,
  WriteInput,
  RelationshipWiring,
  WriteResult,
  TraverseInput,
  TraverseResult,
  TraversalEdge,
  ComputedInput,
  ComputedResult,
  RuntimeErrorCode,
} from './types.js';

export { RuntimeError } from './types.js';

// Version fingerprinting
export type {
  ChangeImpact,
  VersionFingerprint,
  CompatibilityCheck,
  OutdatedComponent,
  CurrentVersions,
  FingerprintOptions,
} from './version.js';

export { createFingerprint, checkCompatibility } from './version.js';
