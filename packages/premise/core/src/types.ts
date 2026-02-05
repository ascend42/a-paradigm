/**
 * Core types for Dream - the aggregation and ideation layer
 */

// ============================================
// Symbol Types
// ============================================

/**
 * Symbol type identifiers
 */
export type SymbolType =
  | 'feature'    // @ - from Purpose
  | 'component'  // # - from Purpose
  | 'flow'       // $ - shared
  | 'state'      // % - from Purpose
  | 'aspect'     // ~ - from Purpose
  | 'gate'       // ^ - from Gate
  | 'signal'     // ! - from Gate
  | 'idea';      // ? - Dream-native

/**
 * Source type identifiers
 */
export type SourceType = 'purpose' | 'gate' | 'dream';

/**
 * Symbol prefix mapping
 */
export const SYMBOL_PREFIXES: Record<SymbolType, string> = {
  feature: '@',
  component: '#',
  flow: '$',
  state: '%',
  aspect: '~',
  gate: '^',
  signal: '!',
  idea: '?',
};

/**
 * Reverse mapping: prefix to type
 */
export const PREFIX_TO_TYPE: Record<string, SymbolType> = {
  '@': 'feature',
  '#': 'component',
  '$': 'flow',
  '%': 'state',
  '~': 'aspect',
  '^': 'gate',
  '!': 'signal',
  '?': 'idea',
};

/**
 * Position on the canvas
 */
export interface Position {
  x: number;
  y: number;
}

/**
 * A symbol entry in the unified index
 */
export interface SymbolEntry {
  /** Unique identifier (uuid for dream-native, derived for others) */
  id: string;
  /** Full symbol with prefix (e.g., "@checkout") */
  symbol: string;
  /** Symbol type */
  type: SymbolType;
  /** For compound ideas (?@, ?#, etc.), the type this idea represents */
  ideaType?: SymbolType;
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
  /** User-assigned tags */
  tags?: string[];
  /** Description text */
  description?: string;
  /** Creation timestamp (for dream-native) */
  created?: string;
  /** Last modified timestamp */
  modified?: string;
}

// ============================================
// Dream File Types
// ============================================

/**
 * Source configuration in a .premise file
 */
export interface DreamSourceConfig {
  /** Path to scan for files */
  path: string;
  /** Include patterns */
  include?: string[];
  /** Exclude patterns */
  exclude?: string[];
}

/**
 * A dream-native node
 */
export interface DreamNode {
  /** Unique identifier */
  id: string;
  /** Symbol with prefix */
  symbol: string;
  /** Node type */
  type: SymbolType;
  /** Content (for dream-native nodes) */
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
export interface DreamConnection {
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
export interface DreamGroup {
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
export interface DreamLayout {
  /** Current viewport */
  viewport: Viewport;
  /** Node groups */
  groups?: DreamGroup[];
}

/**
 * A timeline snapshot
 */
export interface DreamSnapshot {
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
    nodes: DreamNode[];
    connections: DreamConnection[];
    layout: DreamLayout;
  };
}

/**
 * The .premise file structure
 */
export interface DreamFile {
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
    purpose?: DreamSourceConfig[];
    gate?: DreamSourceConfig[];
  };
  /** Dream-native nodes */
  nodes: DreamNode[];
  /** Manual connections */
  connections: DreamConnection[];
  /** Canvas layout */
  layout: DreamLayout;
  /** Timeline snapshots */
  snapshots?: DreamSnapshot[];
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
  /** Gate files found */
  gateFiles: string[];
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
