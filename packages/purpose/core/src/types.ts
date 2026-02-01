/**
 * Core types for Purpose - the context management tool
 */

// ============================================
// Purpose File Types
// ============================================

/**
 * A relationship between two symbols
 */
export interface Relationship {
  from: string;
  to: string;
  type: string;
  description?: string;
}

/**
 * A step in a flow
 */
export interface FlowStep {
  component: string;
  action: string;
  description?: string;
}

/**
 * A flow representing a sequence of steps (array format)
 */
export interface FlowWithSteps {
  name: string;
  description?: string;
  steps: FlowStep[];
}

/**
 * A flow defined as a record (flexible format)
 */
export interface FlowDefinition {
  description?: string;
  gates?: string[];
  signals?: string[];
  components?: string[];
  steps?: FlowStep[];
}

/**
 * A gate defined in a purpose file
 */
export interface GateDefinition {
  description?: string;
  requires?: string[];
  keys?: string[];
  signals?: string[];
}

/**
 * A state defined in a purpose file
 */
export interface StateDefinition {
  description?: string;
  default?: unknown;
  type?: string;
}

/**
 * A reference to an external resource
 */
export interface Reference {
  target: string;
  type: string;
  path: string;
}

/**
 * An item (feature or component) defined in a purpose file
 */
export interface PurposeItem {
  /** Human-readable description */
  description: string;
  /** API endpoints associated with this item */
  endpoints?: string[];
  /** Test files associated with this item */
  tests?: string[];
  /** Legacy rules (use aspects instead) */
  rules?: Record<string, unknown>;
  /** Cross-cutting concerns and metadata */
  aspects?: Record<string, unknown>;
}

/**
 * The structure of a .purpose file
 */
export interface PurposeFile {
  /** Schema version */
  version?: string;
  /** Human-readable description of this scope */
  description?: string;
  /** Path to OpenAPI/Swagger spec */
  apiSpec?: string;
  /** Contextual notes for AI agents */
  context?: string[];
  /** Rules that apply to this scope */
  rules?: Record<string, unknown>;
  /** Features defined in this scope */
  features?: Record<string, PurposeItem>;
  /** Components defined in this scope */
  components?: Record<string, PurposeItem>;
  /** Gates (authorization points) defined in this scope */
  gates?: Record<string, GateDefinition>;
  /** States defined in this scope */
  states?: Record<string, StateDefinition>;
  /** Relationships between symbols */
  relationships?: Relationship[];
  /** Flows defined in this scope (array format with steps) */
  flows?: FlowWithSteps[] | Record<string, FlowDefinition>;
  /** External references */
  references?: Reference[];
}

/**
 * Aggregated purpose from multiple files
 */
export interface AggregatedPurpose {
  /** Combined description (most specific takes precedence) */
  description: string;
  /** Path to API spec (most specific takes precedence) */
  apiSpec?: string;
  /** Combined context from all files */
  context: string[];
  /** Merged rules */
  rules: Record<string, unknown>;
  /** All features across files */
  features: Record<string, PurposeItem>;
  /** All components across files */
  components: Record<string, PurposeItem>;
  /** Referenced items resolved from other files */
  referencedItems: Record<string, PurposeItem>;
  /** Warnings about rule conflicts */
  ruleConflicts: string[];
}

// ============================================
// Parse Result Types
// ============================================

export interface ParseError {
  message: string;
  path?: string;
  line?: number;
  type: 'yaml' | 'schema' | 'file';
}

export interface ParseResult {
  data: PurposeFile | null;
  errors: string[];
  detailedErrors: ParseError[];
  rawContent?: string;
  isYamlValid: boolean;
}

// ============================================
// Validation Types
// ============================================

export interface ValidationIssue {
  type: 'error' | 'warning';
  message: string;
  path?: string;
  line?: number;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

// ============================================
// Graph Types (for visualization)
// ============================================

export interface GraphNode {
  id: string;
  label: string;
  type: 'purpose-file' | 'component' | 'feature' | 'flow';
  filePath?: string;
  data?: unknown;
  level?: number;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  type: 'hierarchical' | 'relationship' | 'flow' | 'reference';
  arrows?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
