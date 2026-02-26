/**
 * Schema Registry — Application-Agnostic Event Schema Types
 *
 * Applications register their own event schemas, and Sentinel ingests,
 * stores, queries, and visualizes any structured event data.
 */

// ═══════════════════════════════════════════════════════════════════
// SCHEMA DECLARATION
// ═══════════════════════════════════════════════════════════════════

export interface EventSchemaDeclaration {
  /** Unique schema identifier, e.g. "pretend-engine", "paradigm-logger" */
  id: string;
  /** Schema version (semver) */
  version: string;
  /** Human-readable name */
  name: string;
  /** Optional description */
  description?: string;
  /** Temporal grouping primitive */
  scope: ScopeDeclaration;
  /** Event type definitions */
  eventTypes: EventTypeDeclaration[];
  /** Causality tracking configuration */
  causality?: CausalityDeclaration;
  /** Visualization hints for the UI */
  visualization?: VisualizationHints;
  /** Classification tags */
  tags?: string[];
}

export interface ScopeDeclaration {
  /** Field name for temporal grouping, e.g. "frame", "requestId", "tick" */
  field: string;
  /** Field type */
  type: 'number' | 'string';
  /** Human-readable label, e.g. "Frame", "Request" */
  label: string;
  /** Whether scopes are sequential (ordered) or independent */
  ordering: 'sequential' | 'independent';
  /** Optional session field for grouping scopes */
  sessionField?: string;
}

// ═══════════════════════════════════════════════════════════════════
// EVENT TYPE DECLARATIONS
// ═══════════════════════════════════════════════════════════════════

export interface EventTypeDeclaration {
  /** Event type identifier, e.g. "rule:fire", "state:set" */
  type: string;
  /** Category for grouping, e.g. "rules", "state" */
  category: string;
  /** Human-readable label */
  label?: string;
  /** Description of what this event type represents */
  description?: string;
  /** Field declarations for event data */
  fields?: EventFieldDeclaration[];
  /** Expected frequency */
  frequency?: 'high' | 'medium' | 'low';
  /** Default severity level */
  severity?: 'debug' | 'info' | 'warn' | 'error';
}

export interface EventFieldDeclaration {
  /** Field name */
  name: string;
  /** Field type */
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  /** Description */
  description?: string;
  /** Whether to create a database index on this field */
  indexed?: boolean;
  /** Whether to show this field in default table view */
  display?: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// CAUSALITY & VISUALIZATION
// ═══════════════════════════════════════════════════════════════════

export interface CausalityDeclaration {
  /** Field name for parent event reference */
  parentField?: string;
  /** Field for cascade depth, e.g. "pass" for cascade passes */
  depthField?: string;
  /** Event types that start a scope, e.g. ["tick:frame"] */
  scopeStart?: string[];
  /** Event types that end a scope, e.g. ["cascade:complete"] */
  scopeEnd?: string[];
}

export interface VisualizationHints {
  /** Default view mode */
  defaultView?: 'timeline' | 'table' | 'tree' | 'flame';
  /** Category → color mapping */
  categoryColors?: Record<string, string>;
  /** Fields to show in summary/header */
  summaryFields?: string[];
  /** High-frequency event types hidden by default */
  defaultExcluded?: string[];
}

// ═══════════════════════════════════════════════════════════════════
// GENERIC EVENTS
// ═══════════════════════════════════════════════════════════════════

export interface GenericEvent {
  /** Unique event ID */
  id: string;
  /** Schema this event belongs to */
  schemaId: string;
  /** Event type, e.g. "rule:fire" */
  eventType: string;
  /** Category, e.g. "rules" */
  category: string;
  /** ISO timestamp */
  timestamp: string;
  /** Scope value (frame number, request ID, etc.) */
  scopeValue?: string;
  /** Numeric ordinal for sequential scopes */
  scopeOrdinal?: number;
  /** Session identifier */
  sessionId?: string;
  /** Service/app that emitted the event */
  service: string;
  /** Event-specific data */
  data?: Record<string, unknown>;
  /** Severity level */
  severity?: 'debug' | 'info' | 'warn' | 'error';
  /** Parent event ID for causality tracking */
  parentEventId?: string;
  /** Depth in causality tree */
  depth?: number;
}

export interface GenericEventInput {
  /** Optional pre-assigned ID (auto-generated if omitted) */
  id?: string;
  /** Event type, e.g. "rule:fire" */
  type: string;
  /** ISO timestamp (auto-generated if omitted) */
  timestamp?: string;
  /** Scope value */
  scopeValue?: string | number;
  /** Session identifier */
  sessionId?: string;
  /** Event-specific data */
  data?: Record<string, unknown>;
  /** Severity override (resolved from schema defaults if omitted) */
  severity?: 'debug' | 'info' | 'warn' | 'error';
  /** Parent event ID */
  parentEventId?: string;
  /** Depth in causality tree */
  depth?: number;
}

// ═══════════════════════════════════════════════════════════════════
// QUERY TYPES
// ═══════════════════════════════════════════════════════════════════

export interface GenericEventQuery {
  schemaId?: string;
  eventType?: string;
  category?: string;
  service?: string;
  sessionId?: string;
  scopeValue?: string;
  scopeFrom?: string;
  scopeTo?: string;
  severity?: string;
  since?: string;
  until?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ScopeSummary {
  scopeValue: string;
  scopeOrdinal?: number;
  eventCount: number;
  categories: Record<string, number>;
  firstTimestamp: string;
  lastTimestamp: string;
}

export interface StoredSchema {
  id: string;
  version: string;
  name: string;
  description?: string;
  scope: ScopeDeclaration;
  eventTypes: EventTypeDeclaration[];
  causality?: CausalityDeclaration;
  visualization?: VisualizationHints;
  tags: string[];
  registeredAt: string;
  updatedAt: string;
}
