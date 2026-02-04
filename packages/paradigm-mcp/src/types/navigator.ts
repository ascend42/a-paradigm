/**
 * Navigator Types - Project structure index for AI navigation
 *
 * The Navigator system provides a pre-indexed project structure to reduce
 * token waste during AI exploration. It maps symbols to paths, defines
 * key files, and specifies skip patterns.
 */

/**
 * Symbol type prefix mapping
 */
export type SymbolPrefix = '@' | '#' | '^' | '$' | '&' | '!' | '%' | '?' | '~';

/**
 * Structure entry - paths for a category of code
 */
export interface StructureEntry {
  /** Directories containing this type of code */
  paths: string[];
  /** Symbol prefix used for this type */
  symbol: SymbolPrefix;
  /** Optional description */
  description?: string;
}

/**
 * Key files in the project
 */
export interface KeyFiles {
  /** Configuration files */
  config: string[];
  /** Entry point files */
  entry: string[];
  /** Type definition locations */
  types: string[];
  /** Custom categories */
  [key: string]: string[];
}

/**
 * Skip patterns for exploration
 */
export interface SkipPatterns {
  /** Always skip these patterns */
  always: string[];
  /** Skip unless working on tests */
  unless_testing: string[];
  /** Skip unless working on documentation */
  unless_docs: string[];
}

/**
 * Navigator configuration (navigator.yaml schema)
 */
export interface NavigatorConfig {
  /** Schema version */
  version: string;
  /** When this was generated */
  generated: string;
  /** True if auto-generated from .purpose files (not from paradigm scan) */
  auto_generated?: boolean;

  /**
   * Project structure map
   * Maps code categories to their locations
   */
  structure: {
    features?: StructureEntry;
    components?: StructureEntry;
    gates?: StructureEntry;
    flows?: StructureEntry;
    integrations?: StructureEntry;
    signals?: StructureEntry;
    state?: StructureEntry;
    [key: string]: StructureEntry | undefined;
  };

  /**
   * Key files to know about
   */
  key_files: KeyFiles;

  /**
   * Patterns to skip during exploration
   */
  skip_patterns: SkipPatterns;

  /**
   * Symbol to path mapping
   * Direct lookup from symbol to its location
   */
  symbols: Record<string, string>;
}

/**
 * Intent for navigation query
 */
export type NavigateIntent = 'find' | 'explore' | 'context';

/**
 * Input for paradigm_navigate tool
 */
export interface NavigateInput {
  /** What kind of navigation */
  intent: NavigateIntent;
  /** Symbol or area name to find/explore */
  target?: string;
  /** Free-form task description for context intent */
  task?: string;
}

/**
 * Result from paradigm_navigate tool
 */
export interface NavigateResult {
  /** Files/directories to read */
  paths: string[];
  /** Related symbols found */
  symbols: string[];
  /** Patterns to avoid */
  skip: string[];
  /** Recommended reading order */
  suggested_order: string[];
  /** Explanation of the navigation result */
  explanation?: string;
}

/**
 * Context for loading navigator data
 */
export interface NavigatorContext {
  config: NavigatorConfig | null;
  /** Path to navigator.yaml */
  configPath: string | null;
}
