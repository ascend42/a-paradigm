/**
 * Core types for Paradigm - the aggregation and ideation layer
 *
 * Symbol System v2:
 * - 5 operational symbols: # $ ^ ! ~
 * - Classification via tags instead of symbol prefixes
 * - Aspects (~) require code anchors
 */

// ============================================
// Symbol Types (v2)
// ============================================

/**
 * Symbol type identifiers (v2 - 5 operational symbols)
 *
 * Removed in v2 (now tags):
 * - 'feature' (@) -> use #component with tags: [feature]
 * - 'state' (%) -> use #component with tags: [state]
 * - 'idea' (?) -> use any symbol with tags: [idea]
 * - 'integration' (&) -> use #component with tags: [integration]
 */
export type SymbolType =
  | 'component'  // # - Any documented code unit
  | 'flow'       // $ - Multi-step process
  | 'gate'       // ^ - Authorization checkpoint
  | 'signal'     // ! - Event for side effects
  | 'aspect';    // ~ - Rule with required code anchor

/**
 * Legacy symbol types (v1) - kept for migration support
 * @deprecated Use tags instead: [feature], [state], [idea], [integration]
 */
export type LegacySymbolType = 'feature' | 'state' | 'idea' | 'integration';

/**
 * All symbol types including legacy (for migration)
 */
export type AnySymbolType = SymbolType | LegacySymbolType;

/**
 * Source type identifiers
 */
export type SourceType = 'purpose' | 'portal' | 'premise';

/**
 * Symbol prefix mapping (v2)
 */
export const SYMBOL_PREFIXES: Record<SymbolType, string> = {
  component: '#',
  flow: '$',
  gate: '^',
  signal: '!',
  aspect: '~',
};

/**
 * Reverse mapping: prefix to type (v2)
 */
export const PREFIX_TO_TYPE: Record<string, SymbolType> = {
  '#': 'component',
  '$': 'flow',
  '^': 'gate',
  '!': 'signal',
  '~': 'aspect',
};

/**
 * Legacy prefix mapping (v1) - for migration support
 * @deprecated These prefixes are no longer valid in v2
 */
export const LEGACY_PREFIX_TO_TYPE: Record<string, LegacySymbolType> = {
  '@': 'feature',
  '%': 'state',
  '?': 'idea',
  '&': 'integration',
};

/**
 * All valid symbol prefixes (v2)
 */
export const VALID_PREFIXES = ['#', '$', '^', '!', '~'] as const;

/**
 * Check if a prefix is valid in v2
 */
export function isValidPrefix(prefix: string): prefix is typeof VALID_PREFIXES[number] {
  return VALID_PREFIXES.includes(prefix as typeof VALID_PREFIXES[number]);
}

/**
 * Check if a prefix is a legacy v1 prefix
 */
export function isLegacyPrefix(prefix: string): boolean {
  return ['@', '%', '?', '&'].includes(prefix);
}

/**
 * Position on the canvas
 */
export interface Position {
  x: number;
  y: number;
}

/**
 * Code anchor reference (v2)
 * Format: file.ts:15 (single line), file.ts:15-20 (range), file.ts:15,25,30 (multiple)
 */
export interface CodeAnchor {
  /** File path */
  path: string;
  /** Line number(s) - can be single, range, or array */
  lines: number | [number, number] | number[];
  /** Raw anchor string as defined */
  raw: string;
}

/**
 * A symbol entry in the unified index
 */
export interface SymbolEntry {
  /** Unique identifier (uuid for premise-native, derived for others) */
  id: string;
  /** Full symbol with prefix (e.g., "#checkout") */
  symbol: string;
  /** Symbol type */
  type: SymbolType;
  /** Where this symbol comes from */
  source: SourceType;
  /** File path where it's defined */
  filePath: string;
  /** Full data from source */
  data: unknown;
  /** Symbols this references */
  references: string[];
  /** Symbols that reference this */
  referencedBy: string[];
  /** Canvas position (if placed) */
  position?: Position;
  /** User-assigned tags (v2 classification) */
  tags?: string[];
  /** Code anchors - REQUIRED for aspects (~) */
  anchors?: CodeAnchor[];
  /** Description text */
  description?: string;
  /** Creation timestamp (for premise-native) */
  created?: string;
  /** Last modified timestamp */
  modified?: string;
  /** For aspects: patterns this aspect applies to */
  appliesTo?: string[];
  /** For aspects: enforcement description */
  enforcement?: string;
}

// ============================================
// Aspect Graph Types (v3.5)
// ============================================

/**
 * Edge relation types between aspect graph nodes
 */
export type AspectRelation =
  | 'enforced-by'   // this aspect is enforced by the target
  | 'depends-on'    // this aspect depends on the target being true
  | 'contradicts'   // this aspect conflicts with the target
  | 'supersedes'    // this aspect replaces the target
  | 'related-to';   // general association

/**
 * Aspect severity levels
 */
export type AspectSeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * Aspect category
 */
export type AspectCategory =
  | 'rule'          // must always be true
  | 'decision'      // a choice that was made
  | 'constraint'    // a limitation from external factors
  | 'configuration' // a tunable value
  | 'invariant';    // something that must never change

/**
 * An explicit edge in the aspect graph
 */
export interface AspectEdge {
  /** Source aspect or symbol */
  source: string;
  /** Target aspect or symbol */
  target: string;
  /** Relationship type */
  relation: AspectRelation;
  /** Traversal priority (0.0-1.0) */
  weight?: number;
  /** How this edge was created */
  origin: 'explicit' | 'inferred' | 'learned';
}

/**
 * Line-level anchor with resolved content
 */
export interface ResolvedAnchor {
  /** File path relative to project root */
  path: string;
  /** Start line */
  startLine: number;
  /** End line (same as startLine for single-line anchors) */
  endLine: number;
  /** The actual code at this anchor */
  content?: string;
  /** Content hash for drift detection */
  contentHash?: string;
  /** Whether the file exists */
  exists: boolean;
  /** Whether content has drifted from last scan */
  drifted?: boolean;
}

// ============================================
// Premise File Types
// ============================================

/**
 * Source configuration in a .premise file
 */
export interface PremiseSourceConfig {
  /** Path to scan for files */
  path: string;
  /** Include patterns */
  include?: string[];
  /** Exclude patterns */
  exclude?: string[];
}

/**
 * A premise-native node on the canvas
 */
export interface PremiseNode {
  /** Unique identifier */
  id: string;
  /** Symbol with prefix */
  symbol: string;
  /** Node type */
  type: SymbolType;
  /** Content (for premise-native nodes) */
  content?: string;
  /** Canvas position */
  position: Position;
  /** User tags */
  tags?: string[];
  /** Creation timestamp */
  created: string;
  /** Last modified timestamp */
  modified?: string;
}

/**
 * A connection between nodes
 */
export interface PremiseConnection {
  /** Source symbol */
  from: string;
  /** Target symbol */
  to: string;
  /** Connection label */
  label?: string;
  /** Connection type */
  type?: string;
}

/**
 * A group of nodes
 */
export interface PremiseGroup {
  /** Group identifier */
  id: string;
  /** Group name */
  name: string;
  /** Node IDs in this group */
  nodes: string[];
  /** Group color */
  color?: string;
}

/**
 * Canvas viewport state
 */
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/**
 * Canvas layout state
 */
export interface PremiseLayout {
  /** Current viewport */
  viewport: Viewport;
  /** Node groups */
  groups?: PremiseGroup[];
}

/**
 * A timeline snapshot
 */
export interface PremiseSnapshot {
  /** Snapshot identifier */
  id: string;
  /** Snapshot name */
  name: string;
  /** When it was created */
  timestamp: string;
  /** Description */
  description?: string;
  /** Frozen state */
  state: {
    nodes: PremiseNode[];
    connections: PremiseConnection[];
    layout: PremiseLayout;
  };
}

/**
 * The .premise file structure
 */
export interface PremiseFile {
  /** Schema version */
  version: string;
  /** Project metadata */
  metadata: {
    name: string;
    created: string;
    modified: string;
  };
  /** External sources to aggregate */
  sources: {
    purpose?: PremiseSourceConfig[];
    portal?: PremiseSourceConfig[];
  };
  /** Premise-native nodes */
  nodes: PremiseNode[];
  /** Manual connections */
  connections: PremiseConnection[];
  /** Canvas layout */
  layout: PremiseLayout;
  /** Timeline snapshots */
  snapshots?: PremiseSnapshot[];
}

// ============================================
// Aggregation Result Types
// ============================================

/**
 * Result of aggregating all sources
 */
export interface AggregationResult {
  /** All symbol entries */
  symbols: SymbolEntry[];
  /** Purpose files found */
  purposeFiles: string[];
  /** Portal files found */
  portalFiles: string[];
  /** Errors encountered */
  errors: AggregationError[];
  /** Timestamp of aggregation */
  timestamp: number;
}

/**
 * An error during aggregation
 */
export interface AggregationError {
  source: SourceType;
  filePath: string;
  message: string;
}

// ============================================
// Symbol Index Types
// ============================================

/**
 * The unified symbol index
 */
export interface SymbolIndex {
  /** All entries by ID */
  entries: Map<string, SymbolEntry>;
  /** Entries by type */
  byType: Map<SymbolType, SymbolEntry[]>;
  /** Entries by source */
  bySource: Map<SourceType, SymbolEntry[]>;
  /** Last aggregation timestamp */
  timestamp: number;
}

// ============================================
// Testable Flow Types
// ============================================

/**
 * A single step in a testable flow
 */
export interface FlowStep {
  /** Unique step identifier within the flow */
  id: string;
  /** Human-readable description of what this step does */
  action: string;
  /** Symbol involved in this step (e.g., @tasks, ^auth, !event) */
  symbol?: string;
  /** Expected outcome or assertion */
  expect?: string;
}

/**
 * Validation configuration for a flow
 */
export interface FlowValidation {
  /** Test command to run (e.g., "npm test -- --grep 'task creation'") */
  command?: string;
  /** Manual testing instructions */
  manual?: string;
}

/**
 * A testable flow defined in a .purpose file
 */
export interface TestableFlow {
  /** Flow identifier (e.g., $task-creation) */
  id: string;
  /** Human-readable description */
  description: string;
  /** What triggers this flow (e.g., "POST /api/projects/:id/tasks") */
  trigger?: string;
  /** Ordered steps in the flow */
  steps: FlowStep[];
  /** Validation configuration */
  validation?: FlowValidation;
  /** File path where the flow is defined */
  definedIn: string;
}

/**
 * Index of all flows in the project
 */
export interface FlowIndex {
  /** Schema version */
  version: string;
  /** When the index was generated */
  generatedAt: string;
  /** All flows indexed by ID */
  flows: Record<string, TestableFlow>;
  /** Mapping from symbol to flow IDs that use it */
  symbolToFlows: Record<string, string[]>;
}
