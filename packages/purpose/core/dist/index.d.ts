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
 * A flow representing a sequence of steps (array format)
 */
interface FlowWithSteps {
    name: string;
    description?: string;
    steps: FlowStep[];
}
/**
 * A flow defined as a record (flexible format)
 */
interface FlowDefinition {
    description?: string;
    gates?: string[];
    signals?: string[];
    components?: string[];
    steps?: FlowStep[];
}
/**
 * A gate defined in a purpose file
 */
interface GateDefinition {
    description?: string;
    requires?: string[];
    keys?: string[];
    signals?: string[];
}
/**
 * A state defined in a purpose file
 */
interface StateDefinition {
    description?: string;
    default?: unknown;
    type?: string;
}
/**
 * An aspect defined in a purpose file (cross-cutting concern with required code anchors)
 */
interface AspectDefinition {
    /** Human-readable description */
    description?: string;
    /** Classification tags */
    tags?: string[];
    /** Code anchors - REQUIRED for aspects (file paths to enforcement code) */
    anchors?: string[];
    /** Glob patterns for symbols this aspect applies to */
    'applies-to'?: string[];
    /** Description of how this aspect should be enforced */
    enforcement?: string;
    /** Concrete value for configuration aspects (e.g., "24 * 60 * 60 * 1000") */
    value?: string;
    /** Aspect category */
    category?: 'rule' | 'decision' | 'constraint' | 'configuration' | 'invariant';
    /** Severity level */
    severity?: 'low' | 'medium' | 'high' | 'critical';
    /** Explicit graph edges to other symbols */
    edges?: Array<{
        symbol: string;
        relation: 'enforced-by' | 'depends-on' | 'contradicts' | 'supersedes' | 'related-to';
    }>;
    /** Linked lore entry IDs */
    lore?: string[];
}
/**
 * A signal defined in a purpose file
 */
interface SignalDefinition {
    description?: string;
    /** Category for grouping: auth | billing | lead | conversion | sdk | integration | system */
    category?: string;
    /** Severity level: info | warn | error (default: info) */
    severity?: 'info' | 'warn' | 'error';
    /** Files that emit this signal */
    emitters?: string[];
    /** Related symbols (@features, ^gates, $flows, etc.) */
    related?: string[];
    /** Expected payload shape */
    data?: Record<string, unknown>;
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
    /** Component type — open string per project vocabulary (e.g., "view", "service", "model") */
    type?: string;
    /** Parent component reference (e.g., "#payment-page") */
    parent?: string;
    /** Code anchors (file:line format, same as aspects) */
    anchors?: string[];
    /** Classification tags */
    tags?: string[];
    /** API endpoints associated with this item */
    endpoints?: string[];
    /** Test files associated with this item */
    tests?: string[];
    /** Legacy rules (use aspects instead) */
    rules?: Record<string, unknown>;
    /** Aspect references (~aspect-name) */
    aspects?: string[];
    /** Flow references ($flow-name) */
    flows?: string[];
    /** Gate references (^gate-name) */
    gates?: string[];
    /** Signal references (!signal-name) */
    signals?: string[];
    /** State references (%state.name) */
    states?: string[];
    /** Component references (#component-name) */
    components?: string[];
}
/**
 * An item defined in array format (alternative to record format)
 */
interface PurposeItemArray extends PurposeItem {
    /** Unique identifier for this item */
    id: string;
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
    /** Features defined in this scope (record or array format) */
    features?: Record<string, PurposeItem> | PurposeItemArray[];
    /** Components defined in this scope (record or array format) */
    components?: Record<string, PurposeItem> | PurposeItemArray[];
    /** Gates (authorization points) defined in this scope */
    gates?: Record<string, GateDefinition>;
    /** States defined in this scope */
    states?: Record<string, StateDefinition>;
    /** Signals defined in this scope */
    signals?: Record<string, SignalDefinition>;
    /** Aspects (cross-cutting concerns) defined in this scope */
    aspects?: Record<string, AspectDefinition>;
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
 * Extract all gates from parsed purpose files
 */
declare function extractGates(parsedFiles: ParsedPurposeFile[]): Map<string, {
    item: GateDefinition;
    filePath: string;
}>;
/**
 * Extract all states from parsed purpose files
 */
declare function extractStates(parsedFiles: ParsedPurposeFile[]): Map<string, {
    item: StateDefinition;
    filePath: string;
}>;
/**
 * Normalized flow for extraction
 */
interface ExtractedFlow {
    id: string;
    description?: string;
    gates?: string[];
    signals?: string[];
    components?: string[];
    steps?: Array<{
        component: string;
        action: string;
        description?: string;
    }>;
}
/**
 * Extract all flows from parsed purpose files
 * Handles both array format [{name, steps}] and record format {flow-name: {description, gates}}
 */
declare function extractFlows(parsedFiles: ParsedPurposeFile[]): Map<string, {
    item: ExtractedFlow;
    filePath: string;
}>;
/**
 * Extract all signals from parsed purpose files
 */
declare function extractSignals(parsedFiles: ParsedPurposeFile[]): Map<string, {
    item: SignalDefinition;
    filePath: string;
}>;
/**
 * Extract all aspects from parsed purpose files
 */
declare function extractAspects(parsedFiles: ParsedPurposeFile[]): Map<string, {
    item: AspectDefinition;
    filePath: string;
}>;
/**
 * Extracted symbol reference from feature/component data (v2)
 *
 * v2 changes:
 * - 'state' is no longer a symbol type - states are now #components with [state] tag
 * - 'flow', 'gate', 'signal', 'component', 'aspect' are the valid reference types
 */
interface ExtractedSymbolRef {
    symbol: string;
    type: 'flow' | 'gate' | 'signal' | 'component' | 'aspect';
    sourceSymbol: string;
    filePath: string;
}
/**
 * Extract symbol references ($, ^, !, #, ~) from feature/component data (v2)
 * This captures references like flows: [$checkout-flow], gates: [^authenticated]
 *
 * v2 changes:
 * - Features are now #components with tags, not @features
 * - States are now #components with [state] tag, not %states
 */
declare function extractSymbolReferences(parsedFiles: ParsedPurposeFile[]): ExtractedSymbolRef[];

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

export { type AggregatedPurpose, type AspectDefinition, type ExtractedFlow, type ExtractedSymbolRef, type FlowDefinition, type FlowStep, type FlowWithSteps, type GateDefinition, type GraphData, type GraphEdge, type GraphNode, type ParseError, type ParseResult, type ParsedPurposeFile, type PurposeFile, type PurposeItem, type PurposeItemArray, type Reference, type Relationship, type SignalDefinition, type StateDefinition, type ValidationIssue, type ValidationResult, aggregateForPath, aggregatePurposes, collectPurposeChain, extractAspects, extractComponents, extractFeatures, extractFlows, extractGates, extractSignals, extractStates, extractSymbolReferences, findPurposeFiles, formatValidationResult, getAllPurposeFiles, getDefaultPurposeContent, parsePurposeContent, parsePurposeFile, parsePurposeFileDetailed, serializePurposeFile, validatePurposeFile };
