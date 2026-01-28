/**
 * Core types for Gate - the authorization topology tool
 */

// ============================================
// Gate Definition Types
// ============================================

/**
 * A Key represents criteria that, if met by an entity, grants passage through a Lock.
 * Keys are the inverse of traditional credentials - they define requirements, not tokens.
 */
export interface Key {
  /** JavaScript expression that evaluates against entity context */
  expression: string;
  /** Human-readable description of this requirement */
  description?: string;
}

/**
 * A Lock represents a condition/requirement that must be satisfied to pass through a Gate.
 */
export interface Lock {
  /** Unique identifier for this lock within its gate */
  id: string;
  /** Human-readable description */
  description?: string;
  /** Keys (requirements) for this lock - by default ALL must match */
  keys: Key[];
  /** Whether all keys must match ('all') or any key ('any'). Default: 'all' */
  mode?: 'all' | 'any';
}

/**
 * A Prize is a side effect triggered when an entity passes through a Gate.
 * Like treasure in a game dungeon - some are one-time, others repeatable.
 */
export interface Prize {
  /** Unique identifier used by app to register handler */
  id: string;
  /** If true, prize only fires once per entity. Default: false */
  oneTime: boolean;
  /** Optional metadata passed to handler (e.g., analytics event data) */
  metadata?: Record<string, unknown>;
}

/**
 * A Gate is a control point in the application.
 * Entities must satisfy all locks to pass through and receive prizes.
 */
export interface Gate {
  /** Unique identifier */
  id: string;
  /** Human-readable description */
  description?: string;
  /** Locks that must be satisfied to pass */
  locks: Lock[];
  /** Prizes awarded when gate is passed */
  prizes: Prize[];
  /** Position on canvas (for visualization) */
  position?: { x: number; y: number };
}

/**
 * A Flow is a sequence of gates representing a user journey.
 */
export interface Flow {
  /** Unique identifier */
  id: string;
  /** Human-readable description */
  description?: string;
  /** Ordered list of gate IDs in this flow */
  gates: string[];
  /** If true, this flow can be cloned/forked */
  forkable?: boolean;
}

// ============================================
// Configuration Types
// ============================================

/**
 * Dev mode settings for runtime watcher
 */
export interface DevSettings {
  /** Port for the visualizer server. Default: 3100 */
  visualizerPort?: number;
  /** Port for the watcher WebSocket server. Default: 3101 */
  watcherPort?: number;
  /** Auto-connect SDK to watcher in dev mode. Default: true */
  autoConnect?: boolean;
}

/**
 * Main Gate configuration file structure (portal.yaml)
 */
export interface GateConfig {
  /** Schema version */
  version: string;
  /** Glob patterns for additional gate files to include */
  include?: string[];
  /** All gate definitions */
  gates: Record<string, Omit<Gate, 'id'>>;
  /** All flow definitions */
  flows?: Record<string, Omit<Flow, 'id'>>;
  /** Development settings */
  settings?: {
    dev?: DevSettings;
  };
}

/**
 * Parsed and normalized gate configuration with IDs injected
 */
export interface ParsedGateConfig {
  version: string;
  gates: Gate[];
  flows: Flow[];
  settings: {
    dev: Required<DevSettings>;
  };
}

// ============================================
// Runtime Types
// ============================================

/**
 * Result of evaluating a single key against entity context
 */
export interface KeyResult {
  key: Key;
  passed: boolean;
  error?: string;
}

/**
 * Result of evaluating a lock
 */
export interface LockResult {
  lock: Lock;
  passed: boolean;
  keyResults: KeyResult[];
}

/**
 * Result of checking a gate
 */
export interface GateCheckResult {
  /** The gate that was checked */
  gate: Gate;
  /** Whether the entity passed through */
  passed: boolean;
  /** Results for each lock */
  lockResults: LockResult[];
  /** Prizes that were triggered (if passed) */
  triggeredPrizes: Prize[];
  /** Timestamp of the check */
  timestamp: number;
  /** Entity snapshot at time of check */
  entitySnapshot?: Record<string, unknown>;
}

// ============================================
// Watcher Event Types
// ============================================

export type WatcherEventType =
  | 'gate:check'
  | 'gate:pass'
  | 'gate:fail'
  | 'prize:fire'
  | 'flow:start'
  | 'flow:progress'
  | 'flow:complete';

export interface WatcherEvent {
  type: WatcherEventType;
  timestamp: number;
  entityId: string;
  data: unknown;
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
  type: 'gate' | 'lock' | 'prize' | 'flow';
  label: string;
  data: Gate | Lock | Prize | Flow;
  position?: { x: number; y: number };
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: 'flow' | 'contains' | 'triggers';
  label?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
