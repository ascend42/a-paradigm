// ═══════════════════════════════════════════════════════════════════
// Runtime API v1 — operation types that binding layers call into
// ═══════════════════════════════════════════════════════════════════

/** Runtime API version identifier */
export type RuntimeApiVersion = 'v1';

// ═══════════════════════════════════════════════════════════════════
// COMMON TYPES
// ═══════════════════════════════════════════════════════════════════

export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'nin'
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'exists';

export interface FilterCondition {
  field: string;
  operator: FilterOperator;
  value: unknown;
}

export type SortDirection = 'asc' | 'desc';

export interface SortSpec {
  field: string;
  direction: SortDirection;
}

export interface PaginationOptions {
  offset: number;
  limit: number;
}

export interface EntityResult {
  id: string;
  entity: string;
  properties: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// ═══════════════════════════════════════════════════════════════════
// QUERY OPERATIONS
// ═══════════════════════════════════════════════════════════════════

export interface QueryInput {
  entity: string;
  filters?: FilterCondition[];
  sort?: SortSpec[];
  pagination?: PaginationOptions;
  /** Include memory entries alongside results */
  includeMemory?: boolean;
}

export interface QueryResult {
  entities: EntityResult[];
  total: number;
  hasMore: boolean;
  memory?: MemoryEntry[];
}

export interface MemoryEntry {
  id: string;
  entityId: string;
  type: 'session' | 'longitudinal';
  content: Record<string, unknown>;
  createdAt: string;
  expiresAt?: string;
}

// ═══════════════════════════════════════════════════════════════════
// WRITE OPERATIONS
// ═══════════════════════════════════════════════════════════════════

export type WriteAction = 'create' | 'update' | 'delete';

export interface WriteInput {
  entity: string;
  action: WriteAction;
  /** Entity ID — required for update/delete */
  id?: string;
  properties?: Record<string, unknown>;
  /** Relationships to wire on create/update */
  relationships?: RelationshipWiring[];
}

export interface RelationshipWiring {
  relationship: string;
  targetId: string;
}

export interface WriteResult {
  entity: EntityResult;
  action: WriteAction;
  relationshipsWired: number;
}

// ═══════════════════════════════════════════════════════════════════
// TRAVERSE OPERATIONS
// ═══════════════════════════════════════════════════════════════════

export interface TraverseInput {
  /** Starting entity ID */
  startId: string;
  /** Relationship names to follow */
  relationships: string[];
  /** Maximum traversal depth */
  depth: number;
  filters?: FilterCondition[];
}

export interface TraverseResult {
  nodes: EntityResult[];
  edges: TraversalEdge[];
}

export interface TraversalEdge {
  from: string;
  to: string;
  relationship: string;
  edgeProperties?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════
// COMPUTED OPERATIONS (pattern engine results)
// ═══════════════════════════════════════════════════════════════════

export interface ComputedInput {
  engine: string;
  parameters?: Record<string, unknown>;
}

export interface ComputedResult {
  engine: string;
  results: Record<string, unknown>[];
  computedAt: string;
}

// ═══════════════════════════════════════════════════════════════════
// ERRORS
// ═══════════════════════════════════════════════════════════════════

export type RuntimeErrorCode =
  | 'ENTITY_NOT_FOUND'
  | 'ENTITY_TYPE_UNKNOWN'
  | 'RELATIONSHIP_NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'MIGRATION_REQUIRED'
  | 'ENGINE_NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'INTERNAL_ERROR';

export class RuntimeError extends Error {
  readonly code: RuntimeErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: RuntimeErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'RuntimeError';
    this.code = code;
    this.details = details;
  }
}
