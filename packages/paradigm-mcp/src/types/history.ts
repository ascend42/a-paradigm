/**
 * History Types - Implementation log, validation, fragility tracking
 *
 * The History system captures the temporal/empirical dimension of development:
 * what was implemented, what worked, what was rolled back, and how stable
 * different symbols are over time.
 */

/**
 * Entry types for the history log
 */
export type HistoryEntryType = 'implement' | 'validate' | 'rollback' | 'refactor';

/**
 * Intent of an implementation
 */
export type HistoryIntent = 'feature' | 'fix' | 'refactor' | 'experimental' | 'confirmed';

/**
 * Author types
 */
export type AuthorType = 'human' | 'agent';

/**
 * Where an entry came from (history from git, T-2026-11-06-001):
 *   git      — derived from a commit on read (id `h-<sha12>`), cached per SHA in the machine home
 *   authored — written by `paradigm history record/validate` or the MCP tools into log.jsonl (id `h-<ms36><rand4>`)
 *   legacy   — a log.jsonl row from before derivation (the old post-commit hook, `h0001`-style ids)
 * On disk only authored rows carry it; readers fill it in.
 */
export type HistoryEntrySource = 'git' | 'authored' | 'legacy';

/**
 * Single entry in the history log (stored in log.jsonl)
 */
export interface HistoryEntry {
  /** Unique ID: `h-<sha12>` (git), `h-<ms36><rand4>` (authored), `h0001` (legacy; `h0001@<sha7>` when ambiguous) */
  id: string;
  /** Where the entry came from (see HistoryEntrySource). */
  source?: HistoryEntrySource;
  /** Timestamp */
  ts: string;
  /** Type of entry */
  type: HistoryEntryType;
  /** Related symbols */
  symbols: string[];
  /** Author information */
  author: {
    type: AuthorType;
    id: string;
  };
  /** Git commit hash (if applicable) */
  commit?: string;
  /** Intent of the change */
  intent?: HistoryIntent;
  /** Files affected */
  files?: string[];
  /** Description of what was done */
  description?: string;
  /** For validate entries: reference to the implementation being validated */
  ref?: string;
  /** For validate entries: result */
  result?: 'pass' | 'fail' | 'partial';
  /** Test results */
  tests?: {
    passed: number;
    failed: number;
    skipped?: number;
  };
  /** For rollback entries: reason for rollback */
  reason?: string;
}

/**
 * Fragility level for a symbol
 */
export type FragilityLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Summary of recent changes for a symbol
 */
export interface SymbolHistorySummary {
  symbol: string;
  total_changes: number;
  last_modified: string;
  stability_score: number; // 0.0 to 1.0
  fragility: FragilityLevel;
  recent: HistoryEntry[]; // Last 5 changes
  contributors: {
    human: string[];
    agent: string[];
  };
}

/**
 * Co-change pattern - symbols that tend to change together
 */
export interface CoChangePattern {
  symbols: string[];
  frequency: number;
  correlation: number; // 0.0 to 1.0
}

/**
 * Fragile symbol entry
 */
export interface FragileSymbol {
  symbol: string;
  fragility: FragilityLevel;
  reason: string;
  recent_rollbacks?: number;
  recent_failures?: number;
}

/**
 * What a generated index.yaml was built from. The index is rebuilt when any
 * field differs from the current repository state (ensureHistoryIndex).
 */
export interface HistoryStamp {
  /** Derivation format version; a code change that alters derived rows bumps it. */
  v: number;
  /** HEAD commit, or null outside git / before the first commit */
  head: string | null;
  logSize: number;
  logMtimeMs: number;
  /** Byte size of the machine-home commit cache (a proxy for its row count). */
  cacheCount: number;
  /** `<size>:<mtime>` of the shallow file ("" when not shallow): an unshallow invalidates the index. */
  shallow?: string;
}

/**
 * Generated history index: log.jsonl (authored + legacy rows) merged with rows
 * derived from git. Written to the git-ignored .paradigm/history/index.yaml.
 */
export interface HistoryIndex {
  version: string;
  generated: string;
  /** What the index was built from (absent on pre-derivation index files). */
  stamp?: HistoryStamp;
  /** True when built in a shallow clone: older commits are missing. */
  shallow?: boolean;

  /** History indexed by symbol */
  by_symbol: Record<string, SymbolHistorySummary>;

  /** Co-change patterns */
  co_changes: CoChangePattern[];

  /** Currently fragile symbols */
  fragile_symbols: FragileSymbol[];
}

/**
 * Validation configuration and summary
 */
export interface ValidationSummary {
  version: string;
  last_run?: string;
  total_validations: number;
  pass_rate: number;

  /** Recent validation results by symbol */
  by_symbol: Record<string, SymbolValidation>;
}

export interface SymbolValidation {
  symbol: string;
  last_validated?: string;
  last_result?: 'pass' | 'fail' | 'partial';
  pass_count: number;
  fail_count: number;
  coverage?: number;
}

/**
 * Complete history context for a project
 */
export interface HistoryContext {
  index: HistoryIndex | null;
  /** True when the repository is a shallow clone (derived history is partial). */
  shallow?: boolean;
  validation: ValidationSummary | null;
  /** Raw log entries (loaded on demand) */
  recentEntries?: HistoryEntry[];
}

/**
 * History for specific symbols (used in MCP responses)
 */
export interface SymbolHistory {
  symbol: string;
  summary: SymbolHistorySummary | null;
  recent: HistoryEntry[];
  co_changes: string[];
  validation: SymbolValidation | null;
}

/**
 * Fragility check result
 */
export interface FragilityCheck {
  symbols: string[];
  fragile: FragileSymbol[];
  warnings: string[];
  safe_to_modify: boolean;
  recommendations: string[];
}
