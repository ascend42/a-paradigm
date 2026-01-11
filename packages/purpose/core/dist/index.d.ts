/**
 * Core types for Purpose - the context management tool
 */
/**
 * A relationship between two symbols
 */
interface Relationship {
    from: string;
    to: string;
    type: string;
    description?: string;
}
/**
 * A step in a flow
 */
interface FlowStep {
    component: string;
    action: string;
    description?: string;
}
/**
 * A flow representing a sequence of steps
 */
interface Flow {
    name: string;
    description?: string;
    steps: FlowStep[];
}
/**
 * A reference to an external resource
 */
interface Reference {
    target: string;
    type: string;
    path: string;
}
/**
 * An item (feature or component) defined in a purpose file
 */
interface PurposeItem {
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
interface PurposeFile {
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
    /** Relationships between symbols */
    relationships?: Relationship[];
    /** Flows defined in this scope */
    flows?: Flow[];
    /** External references */
    references?: Reference[];
}
/**
 * Aggregated purpose from multiple files
 */
interface AggregatedPurpose {
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
interface ParseError {
    message: string;
    path?: string;
    line?: number;
    type: 'yaml' | 'schema' | 'file';
}
interface ParseResult {
    data: PurposeFile | null;
    errors: string[];
    detailedErrors: ParseError[];
    rawContent?: string;
    isYamlValid: boolean;
}
interface ValidationIssue {
    type: 'error' | 'warning';
    message: string;
    path?: string;
    line?: number;
}
interface ValidationResult {
    valid: boolean;
    issues: ValidationIssue[];
}
interface GraphNode {
    id: string;
    label: string;
    type: 'purpose-file' | 'component' | 'feature' | 'flow';
    filePath?: string;
    data?: unknown;
    level?: number;
}
interface GraphEdge {
    id: string;
    from: string;
    to: string;
    label?: string;
    type: 'hierarchical' | 'relationship' | 'flow' | 'reference';
    arrows?: string;
}
interface GraphData {
    nodes: GraphNode[];
    edges: GraphEdge[];
}

/**
 * YAML parser for Purpose files
 */

/**
 * Parse a .purpose file with basic error reporting
 */
declare function parsePurposeFile(filePath: string): {
    data: PurposeFile | null;
    errors: string[];
};
/**
 * Parse a .purpose file with detailed error information
 */
declare function parsePurposeFileDetailed(filePath: string): ParseResult;
/**
 * Parse purpose file content from a string
 */
declare function parsePurposeContent(content: string): ParseResult;
/**
 * Serialize a PurposeFile back to YAML
 */
declare function serializePurposeFile(data: PurposeFile): string;
/**
 * Get default .purpose file content for initialization
 */
declare function getDefaultPurposeContent(): string;

/**
 * Aggregator for combining multiple .purpose files
 */

/**
 * Parsed purpose file with its path
 */
interface ParsedPurposeFile {
    filePath: string;
    data: PurposeFile;
}
/**
 * Aggregate multiple purpose files into a single context
 */
declare function aggregatePurposes(parsedFiles: ParsedPurposeFile[]): AggregatedPurpose;
/**
 * Find all .purpose files in a directory tree, sorted by depth
 */
declare function findPurposeFiles(rootDir: string): Promise<string[]>;
/**
 * Find and parse all .purpose files up to and including a target path
 */
declare function collectPurposeChain(targetPath: string): Promise<ParsedPurposeFile[]>;
/**
 * Aggregate all purpose files for a given path
 */
declare function aggregateForPath(targetPath: string): Promise<AggregatedPurpose>;
/**
 * Get all parsed purpose files from a root directory
 */
declare function getAllPurposeFiles(rootDir: string): Promise<ParsedPurposeFile[]>;
/**
 * Extract all features from parsed purpose files
 */
declare function extractFeatures(parsedFiles: ParsedPurposeFile[]): Map<string, {
    item: PurposeItem;
    filePath: string;
}>;
/**
 * Extract all components from parsed purpose files
 */
declare function extractComponents(parsedFiles: ParsedPurposeFile[]): Map<string, {
    item: PurposeItem;
    filePath: string;
}>;

/**
 * Validator for Purpose files
 */

/**
 * Validate a parsed purpose file
 */
declare function validatePurposeFile(data: PurposeFile, filePath?: string): ValidationResult;
/**
 * Format validation result for console output
 */
declare function formatValidationResult(result: ValidationResult): string;

export { type AggregatedPurpose, type Flow, type FlowStep, type GraphData, type GraphEdge, type GraphNode, type ParseError, type ParseResult, type ParsedPurposeFile, type PurposeFile, type PurposeItem, type Reference, type Relationship, type ValidationIssue, type ValidationResult, aggregateForPath, aggregatePurposes, collectPurposeChain, extractComponents, extractFeatures, findPurposeFiles, formatValidationResult, getAllPurposeFiles, getDefaultPurposeContent, parsePurposeContent, parsePurposeFile, parsePurposeFileDetailed, serializePurposeFile, validatePurposeFile };
