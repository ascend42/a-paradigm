// ═══════════════════════════════════════════════════════════════════
// Graph Schema Types — the JSON schema generation pipeline produces
// ═══════════════════════════════════════════════════════════════════

/** Schema format version — changes only on structural format breaks */
export type SchemaFormatVersion = '1.0';

/** Property data types supported by the graph schema */
export type PropertyType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'json'
  | 'array'
  | 'enum';

/** Relationship cardinality between entities */
export type Cardinality = 'one-to-one' | 'one-to-many' | 'many-to-many';

/** Pattern engine evaluation frequency */
export type PatternFrequency = 'realtime' | 'periodic' | 'on-demand';

// ═══════════════════════════════════════════════════════════════════
// PROPERTY DEFINITIONS
// ═══════════════════════════════════════════════════════════════════

export interface PropertyDefinition {
  name: string;
  type: PropertyType;
  required: boolean;
  default?: unknown;
  indexed?: boolean;
  /** For enum type — allowed values */
  enumValues?: string[];
  /** For array type — element type */
  arrayItemType?: PropertyType;
}

// ═══════════════════════════════════════════════════════════════════
// MEMORY CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

export interface MemoryConfig {
  /** Enable session-scoped memory for this entity */
  sessionMemory: boolean;
  /** Enable persistent longitudinal memory */
  longitudinalMemory: boolean;
  /** Enable pattern detection across memory entries */
  patternDetection: boolean;
  /** Time-to-live for session memory entries (seconds) */
  sessionTtl?: number;
  /** Time-to-live for longitudinal memory entries (seconds) */
  longitudinalTtl?: number;
}

// ═══════════════════════════════════════════════════════════════════
// ENTITY DEFINITIONS
// ═══════════════════════════════════════════════════════════════════

export interface EntityDefinition {
  name: string;
  properties: PropertyDefinition[];
  memory?: MemoryConfig;
  tags?: string[];
  /** System entities are managed by the runtime, not user-editable */
  system?: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// RELATIONSHIP DEFINITIONS
// ═══════════════════════════════════════════════════════════════════

export interface RelationshipDefinition {
  /** Unique name for this relationship */
  name: string;
  /** Source entity name */
  from: string;
  /** Target entity name */
  to: string;
  /** Human-readable relationship type label */
  type: string;
  cardinality: Cardinality;
  /** Properties stored on the relationship edge */
  edgeProperties?: PropertyDefinition[];
}

// ═══════════════════════════════════════════════════════════════════
// PATTERN ENGINE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════

export interface PatternEngineDefinition {
  /** Unique name for this pattern engine */
  name: string;
  /** Entity names this engine watches for changes */
  watches: string[];
  /** Output entity or property names this engine produces */
  outputs: string[];
  frequency: PatternFrequency;
}

// ═══════════════════════════════════════════════════════════════════
// TOP-LEVEL GRAPH SCHEMA
// ═══════════════════════════════════════════════════════════════════

export interface GraphSchema {
  /** Schema format version — '1.0' */
  formatVersion: SchemaFormatVersion;
  /** Application-level schema version (increments on each migration) */
  schemaVersion: number;
  entities: EntityDefinition[];
  relationships: RelationshipDefinition[];
  patternEngines: PatternEngineDefinition[];
  memory: GraphMemoryConfig;
}

export interface GraphMemoryConfig {
  /** Global default session TTL (seconds) */
  defaultSessionTtl: number;
  /** Global default longitudinal TTL (seconds) */
  defaultLongitudinalTtl: number;
  /** Whether pattern detection is enabled globally */
  patternDetectionEnabled: boolean;
}
