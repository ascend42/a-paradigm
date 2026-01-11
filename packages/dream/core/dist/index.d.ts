/**
 * Core types for Dream - the aggregation and ideation layer
 */
/**
 * Symbol type identifiers
 */
type SymbolType = 'feature' | 'component' | 'flow' | 'state' | 'aspect' | 'gate' | 'signal' | 'idea';
/**
 * Source type identifiers
 */
type SourceType = 'purpose' | 'gate' | 'dream';
/**
 * Symbol prefix mapping
 */
declare const SYMBOL_PREFIXES: Record<SymbolType, string>;
/**
 * Reverse mapping: prefix to type
 */
declare const PREFIX_TO_TYPE: Record<string, SymbolType>;
/**
 * Position on the canvas
 */
interface Position {
    x: number;
    y: number;
}
/**
 * A symbol entry in the unified index
 */
interface SymbolEntry {
    /** Unique identifier (uuid for dream-native, derived for others) */
    id: string;
    /** Full symbol with prefix (e.g., "@checkout") */
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
    /** User-assigned tags */
    tags?: string[];
    /** Description text */
    description?: string;
    /** Creation timestamp (for dream-native) */
    created?: string;
    /** Last modified timestamp */
    modified?: string;
}
/**
 * Source configuration in a .dream file
 */
interface DreamSourceConfig {
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
interface DreamNode {
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
interface DreamConnection {
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
interface DreamGroup {
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
interface Viewport {
    x: number;
    y: number;
    zoom: number;
}
/**
 * Canvas layout state
 */
interface DreamLayout {
    /** Current viewport */
    viewport: Viewport;
    /** Node groups */
    groups?: DreamGroup[];
}
/**
 * A timeline snapshot
 */
interface DreamSnapshot {
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
 * The .dream file structure
 */
interface DreamFile {
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
/**
 * Result of aggregating all sources
 */
interface AggregationResult {
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
interface AggregationError {
    source: SourceType;
    filePath: string;
    message: string;
}
/**
 * The unified symbol index
 */
interface SymbolIndex {
    /** All entries by ID */
    entries: Map<string, SymbolEntry>;
    /** Entries by type */
    byType: Map<SymbolType, SymbolEntry[]>;
    /** Entries by source */
    bySource: Map<SourceType, SymbolEntry[]>;
    /** Last aggregation timestamp */
    timestamp: number;
}

/**
 * Parser for .dream files
 */

interface DreamParseResult {
    data: DreamFile | null;
    errors: string[];
    rawContent?: string;
}
/**
 * Parse a .dream file
 */
declare function parseDreamFile(filePath: string): DreamParseResult;
/**
 * Parse .dream content from a string
 */
declare function parseDreamContent(content: string): DreamParseResult;
/**
 * Create an empty dream file structure
 */
declare function createEmptyDreamFile(name?: string): DreamFile;
/**
 * Serialize a DreamFile back to YAML
 */
declare function serializeDreamFile(data: DreamFile): string;
/**
 * Get default .dream file content for initialization
 */
declare function getDefaultDreamContent(projectName?: string): string;
/**
 * Add a node to a dream file
 */
declare function addDreamNode(dreamFile: DreamFile, node: DreamNode): DreamFile;
/**
 * Update a node's position
 */
declare function updateNodePosition(dreamFile: DreamFile, nodeId: string, position: {
    x: number;
    y: number;
}): DreamFile;
/**
 * Add a connection between nodes
 */
declare function addConnection(dreamFile: DreamFile, connection: DreamConnection): DreamFile;
/**
 * Create a snapshot of the current state
 */
declare function createSnapshot(dreamFile: DreamFile, name: string, description?: string): DreamFile;

/**
 * Aggregator - pulls symbols from Purpose and Gate into a unified index
 */

/**
 * Aggregate all symbols from a dream configuration
 */
declare function aggregateFromDream(dreamFile: DreamFile, rootDir: string): Promise<AggregationResult>;
/**
 * Aggregate from a directory without a .dream file
 */
declare function aggregateFromDirectory(rootDir: string): Promise<AggregationResult>;

/**
 * Unified Symbol Index
 *
 * Central registry of all symbols across Purpose, Gate, and Dream sources
 */

/**
 * Create a new empty symbol index
 */
declare function createSymbolIndex(): SymbolIndex;
/**
 * Build a symbol index from aggregation results
 */
declare function buildSymbolIndex(result: AggregationResult): SymbolIndex;
/**
 * Get a symbol by its full symbol string (e.g., "@checkout")
 */
declare function getSymbol(index: SymbolIndex, symbol: string): SymbolEntry | undefined;
/**
 * Get a symbol by ID
 */
declare function getSymbolById(index: SymbolIndex, id: string): SymbolEntry | undefined;
/**
 * Get all symbols of a specific type
 */
declare function getSymbolsByType(index: SymbolIndex, type: SymbolType): SymbolEntry[];
/**
 * Get all symbols from a specific source
 */
declare function getSymbolsBySource(index: SymbolIndex, source: SourceType): SymbolEntry[];
/**
 * Search symbols by query string
 */
declare function searchSymbols(index: SymbolIndex, query: string): SymbolEntry[];
/**
 * Get symbols that reference a given symbol
 */
declare function getReferencesTo(index: SymbolIndex, symbol: string): SymbolEntry[];
/**
 * Get symbols that are referenced by a given symbol
 */
declare function getReferencesFrom(index: SymbolIndex, symbol: string): SymbolEntry[];
/**
 * Get symbols by tag
 */
declare function getSymbolsByTag(index: SymbolIndex, tag: string): SymbolEntry[];
/**
 * Get all unique tags in the index
 */
declare function getAllTags(index: SymbolIndex): string[];
/**
 * Get symbol counts by type
 */
declare function getSymbolCounts(index: SymbolIndex): Record<SymbolType, number>;
/**
 * Get all symbols as a flat array
 */
declare function getAllSymbols(index: SymbolIndex): SymbolEntry[];
/**
 * Parse a symbol string to extract type and name
 */
declare function parseSymbol(symbol: string): {
    type: SymbolType;
    name: string;
} | null;
/**
 * Create a symbol string from type and name
 */
declare function createSymbolString(type: SymbolType, name: string): string;
/**
 * Validate a symbol string format
 */
declare function isValidSymbol(symbol: string): boolean;
/**
 * Get autocomplete suggestions for partial symbol input
 */
declare function getAutocompleteSuggestions(index: SymbolIndex, partial: string, limit?: number): SymbolEntry[];

export { type AggregationError, type AggregationResult, type DreamConnection, type DreamFile, type DreamGroup, type DreamLayout, type DreamNode, type DreamSnapshot, type DreamSourceConfig, PREFIX_TO_TYPE, type Position, SYMBOL_PREFIXES, type SourceType, type SymbolEntry, type SymbolIndex, type SymbolType, type Viewport, addConnection, addDreamNode, aggregateFromDirectory, aggregateFromDream, buildSymbolIndex, createEmptyDreamFile, createSnapshot, createSymbolIndex, createSymbolString, getAllSymbols, getAllTags, getAutocompleteSuggestions, getDefaultDreamContent, getReferencesFrom, getReferencesTo, getSymbol, getSymbolById, getSymbolCounts, getSymbolsBySource, getSymbolsByTag, getSymbolsByType, isValidSymbol, parseDreamContent, parseDreamFile, parseSymbol, searchSymbols, serializeDreamFile, updateNodePosition };
