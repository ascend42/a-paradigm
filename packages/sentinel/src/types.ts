/**
 * Paradigm Sentinel - Type Definitions
 *
 * Comprehensive types for semantic incident recording, pattern matching,
 * and failure triage.
 */

// ═══════════════════════════════════════════════════════════════════
// INCIDENT TYPES
// ═══════════════════════════════════════════════════════════════════

export type IncidentStatus = 'open' | 'investigating' | 'resolved' | 'wont-fix';

export type Environment =
  | 'production'
  | 'staging'
  | 'development'
  | 'test'
  | string;

export interface ErrorDetails {
  message: string;
  stack?: string;
  code?: string;
  type?: string; // TypeError, NetworkError, etc.
}

/**
 * Symbolic context for incidents
 *
 * v2 Note: feature, state, and integration are now #component with tags.
 * These fields are kept for backward compatibility with existing incidents.
 * New incidents should use 'component' with appropriate tags.
 */
export interface SymbolicContext {
  /** @deprecated v2: Use component with tags: [feature] */
  feature?: string; // @checkout, @auth → #checkout [feature]
  component?: string; // #PaymentForm, #AuthService
  flow?: string; // $checkout-flow, $onboarding
  gate?: string; // ^authenticated, ^payment-validated
  signal?: string; // !payment-authorized, !login-success
  /** @deprecated v2: Use component with tags: [state] */
  state?: string; // %user.authenticated → #user.authenticated [state]
  /** @deprecated v2: Use component with tags: [integration] */
  integration?: string; // &stripe → #stripe [integration]
}

export interface FlowPosition {
  flowId: string; // $checkout-flow
  expected: string[]; // Signals/gates expected to fire
  actual: string[]; // What actually fired (in order)
  missing: string[]; // What didn't fire but should have
  failedAt?: string; // Which symbol failed
}

export interface IncidentNote {
  id: string;
  timestamp: string;
  author?: string;
  content: string;
}

export interface Resolution {
  patternId?: string;
  commitHash?: string;
  prUrl?: string;
  notes?: string;
}

export interface SymbolicIncidentRecord {
  id: string; // INC-001, INC-002, etc.
  timestamp: string; // ISO timestamp
  status: IncidentStatus;

  // Technical context
  error: ErrorDetails;

  // Symbolic context (the magic)
  symbols: SymbolicContext;

  // Flow context - where in the flow did it fail?
  flowPosition?: FlowPosition;

  // Environment context
  environment: Environment;
  service?: string; // Which service/app
  version?: string; // App version
  userId?: string; // Anonymized user ID (optional)
  requestId?: string; // Trace/request ID

  // Grouping
  groupId?: string; // Cluster ID for similar incidents

  // Notes and investigation
  notes: IncidentNote[];
  relatedIncidents: string[]; // INC-xxx references

  // Resolution tracking
  resolvedAt?: string;
  resolvedBy?: string; // Pattern ID or 'manual'
  resolution?: Resolution;
}

// Input type for creating incidents (without auto-generated fields)
export type CreateIncidentInput = Omit<
  SymbolicIncidentRecord,
  'id' | 'notes' | 'relatedIncidents' | 'timestamp' | 'status'
> & {
  timestamp?: string;
  status?: IncidentStatus;
};

// ═══════════════════════════════════════════════════════════════════
// PATTERN TYPES
// ═══════════════════════════════════════════════════════════════════

export type PatternSource = 'manual' | 'suggested' | 'imported' | 'community';
export type ResolutionStrategy =
  | 'retry'
  | 'fallback'
  | 'fix-data'
  | 'fix-code'
  | 'rollback'
  | 'config-change'
  | 'scale-up'
  | 'investigate'
  | 'ignore'
  | 'escalate';
export type PatternPriority = 'low' | 'medium' | 'high' | 'critical';

/**
 * Symbol criteria for pattern matching
 *
 * v2 Note: feature, state, and integration are now #component with tags.
 * These fields are kept for backward compatibility with existing patterns.
 */
export interface PatternSymbolCriteria {
  /** @deprecated v2: Use component with tags filter */
  feature?: string | string[];
  component?: string | string[];
  flow?: string | string[];
  gate?: string | string[];
  signal?: string | string[];
  /** @deprecated v2: Use component with tags filter */
  state?: string | string[];
  /** @deprecated v2: Use component with tags filter */
  integration?: string | string[];
  /** v2: Filter by tags instead of legacy symbol types */
  tags?: string | string[];
}

export interface PatternCriteria {
  symbols: PatternSymbolCriteria;
  errorContains?: string[]; // Error message keywords (OR)
  errorMatches?: string; // Regex pattern
  errorType?: string[]; // TypeError, NetworkError, etc.
  missingSignals?: string[]; // Expected signals that didn't fire
  environment?: string[]; // Only match in these environments
}

export interface PatternResolution {
  description: string; // What to do
  strategy: ResolutionStrategy;
  priority: PatternPriority;

  // Code guidance
  codeHint?: string; // Code pattern that often fixes this
  codeSnippet?: string; // Actual code example

  // References
  symbolsToModify?: string[]; // Which symbols typically need changes
  filesLikelyInvolved?: string[]; // Glob patterns
  commitRef?: string; // Reference commit that fixed this
  prRef?: string; // Reference PR
  docsRef?: string; // Link to documentation
}

export interface PatternConfidence {
  score: number; // 0-100
  timesMatched: number;
  timesResolved: number;
  timesRecurred: number; // Incidents that came back after fix
  avgTimeToResolve?: number; // Minutes
  lastMatched?: string;
  lastResolved?: string;
}

export interface FailurePattern {
  id: string; // payment-declined-001
  name: string; // Human-readable name
  description: string; // What this pattern matches

  // Pattern matching criteria
  pattern: PatternCriteria;

  // Resolution information
  resolution: PatternResolution;

  // Confidence tracking
  confidence: PatternConfidence;

  // Metadata
  source: PatternSource;
  private: boolean; // Don't include in exports
  tags: string[]; // Categorization
  createdAt: string;
  updatedAt: string;
}

// Input type for creating patterns
export type CreatePatternInput = Omit<
  FailurePattern,
  'confidence' | 'createdAt' | 'updatedAt'
> & {
  confidence?: Partial<PatternConfidence>;
};

// ═══════════════════════════════════════════════════════════════════
// MATCHING TYPES
// ═══════════════════════════════════════════════════════════════════

export interface MatchedCriteria {
  symbols: string[]; // Which symbols matched
  errorKeywords: string[]; // Which keywords matched
  missingSignals: string[]; // Which missing signals matched
}

export interface PatternMatch {
  pattern: FailurePattern;
  score: number; // 0-100
  matchedCriteria: MatchedCriteria;
  confidence: number; // Pattern confidence × match score
}

export interface MatcherConfig {
  minScore: number; // Minimum score to consider (default: 30)
  maxResults: number; // Max patterns to return (default: 5)
  boostConfidence: boolean; // Factor in pattern confidence (default: true)
}

// ═══════════════════════════════════════════════════════════════════
// GROUPING TYPES
// ═══════════════════════════════════════════════════════════════════

export interface IncidentGroup {
  id: string;
  name?: string;
  incidents: string[]; // Incident IDs

  // What these incidents have in common
  commonSymbols: Partial<SymbolicContext>;
  commonErrorPatterns: string[];

  // Aggregated stats
  count: number;
  firstSeen: string;
  lastSeen: string;
  environments: string[];

  // If there's a pattern match for the group
  suggestedPattern?: FailurePattern;
}

// Input type for creating groups
export type CreateGroupInput = Omit<IncidentGroup, 'id' | 'count'>;

// ═══════════════════════════════════════════════════════════════════
// TIMELINE TYPES
// ═══════════════════════════════════════════════════════════════════

export type FlowEventType =
  | 'gate-passed'
  | 'gate-failed'
  | 'signal-emitted'
  | 'state-changed'
  | 'flow-started'
  | 'flow-ended'
  | 'error';

export interface FlowEvent {
  timestamp: string;
  symbol: string;
  type: FlowEventType;
  data?: Record<string, unknown>;
}

export interface FlowTimeline {
  incidentId: string;
  flowId: string;
  events: FlowEvent[];
  failure: {
    at: string; // Timestamp
    symbol: string;
    reason: string;
  };
}

// ═══════════════════════════════════════════════════════════════════
// STATISTICS TYPES
// ═══════════════════════════════════════════════════════════════════

export interface DayCount {
  date: string;
  count: number;
}

export interface PatternEffectiveness {
  patternId: string;
  resolvedCount: number;
}

export interface PatternRecurrence {
  patternId: string;
  recurrenceRate: number;
}

export interface SymbolIncidentCount {
  symbol: string;
  count: number;
}

export interface SymbolResolutionTime {
  symbol: string;
  avgTimeToResolve: number;
}

export interface SymbolHotspot {
  symbol: string;
  incidentRate: number;
}

export interface SentinelStats {
  period: { start: string; end: string };

  incidents: {
    total: number;
    open: number;
    resolved: number;
    byEnvironment: Record<string, number>;
    byDay: DayCount[];
  };

  patterns: {
    total: number;
    avgConfidence: number;
    mostEffective: PatternEffectiveness[];
    leastEffective: PatternRecurrence[];
  };

  symbols: {
    mostIncidents: SymbolIncidentCount[];
    mostResolved: SymbolResolutionTime[];
    hotspots: SymbolHotspot[];
  };

  resolution: {
    avgTimeToResolve: number; // Minutes
    resolvedWithPattern: number;
    resolvedManually: number;
    resolutionRate: number; // Percentage
  };
}

export interface SymbolHealth {
  incidentCount: number;
  avgTimeToResolve: number;
  topPatterns: { patternId: string; count: number }[];
}

// ═══════════════════════════════════════════════════════════════════
// IMPORT/EXPORT TYPES
// ═══════════════════════════════════════════════════════════════════

export interface PatternExport {
  version: string;
  exportedAt: string;
  patterns: FailurePattern[];
}

export interface BackupExport {
  version: string;
  exportedAt: string;
  incidents: SymbolicIncidentRecord[];
  patterns: FailurePattern[];
  groups: IncidentGroup[];
}

// ═══════════════════════════════════════════════════════════════════
// ENRICHMENT TYPES
// ═══════════════════════════════════════════════════════════════════

export interface SymbolEnrichment {
  description?: string;
  definedIn?: string;
  references?: string[];
  referencedBy?: string[];
}

export interface EnrichedIncident extends SymbolicIncidentRecord {
  enriched: {
    symbols: Record<string, SymbolEnrichment>;
    flowDescription?: string;
  };
}

// ═══════════════════════════════════════════════════════════════════
// STORAGE TYPES
// ═══════════════════════════════════════════════════════════════════

export interface IncidentQueryOptions {
  limit?: number;
  offset?: number;
  status?: IncidentStatus | 'all';
  environment?: string;
  symbol?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  groupId?: string;
}

export interface PatternQueryOptions {
  source?: PatternSource;
  minConfidence?: number;
  tags?: string[];
  includePrivate?: boolean;
}

export interface ResolutionRecord {
  id: string;
  incidentId: string;
  patternId?: string;
  commitHash?: string;
  prUrl?: string;
  notes?: string;
  resolvedAt: string;
  recurred: boolean;
}

export interface ResolutionQueryOptions {
  symbol?: string;
  patternId?: string;
  limit?: number;
}

// ═══════════════════════════════════════════════════════════════════
// SUGGESTION TYPES
// ═══════════════════════════════════════════════════════════════════

export interface PatternCandidate {
  incidents: SymbolicIncidentRecord[];
  suggestedPattern: Partial<FailurePattern>;
  occurrenceCount: number;
}

// ═══════════════════════════════════════════════════════════════════
// PATTERN TESTING TYPES
// ═══════════════════════════════════════════════════════════════════

export interface PatternTestResult {
  wouldMatch: SymbolicIncidentRecord[];
  matchCount: number;
  avgScore: number;
}

// ═══════════════════════════════════════════════════════════════════
// SDK TYPES
// ═══════════════════════════════════════════════════════════════════

export interface SentinelConfig {
  /** Project name */
  project: string;
  /** Default environment for captured incidents */
  environment?: Environment;
  /** Service/app name */
  service?: string;
  /** App version */
  version?: string;
  /** Custom SQLite database path */
  dbPath?: string;
  /** Hook called after each incident capture */
  onCapture?: (incident: SymbolicIncidentRecord) => void;
}

export interface ComponentContext {
  /** Component symbol ID (e.g. '#checkout') */
  id: string;
  /** Capture an error in this component's context */
  capture(error: Error, extra?: Record<string, unknown>): string;
  /** Wrap a function to auto-capture errors in this component's context */
  wrap<T extends (...args: any[]) => any>(fn: T): T;
}

// ═══════════════════════════════════════════════════════════════════
// PRACTICE EVENT TYPES (Habits System)
// ═══════════════════════════════════════════════════════════════════

export type PracticeResult = 'followed' | 'skipped' | 'partial';

export type PracticeCategory =
  | 'discovery'
  | 'verification'
  | 'testing'
  | 'documentation'
  | 'collaboration'
  | 'security';

export interface PracticeEvent {
  id: string;
  timestamp: string;
  habitId: string;
  habitCategory: PracticeCategory;
  result: PracticeResult;
  engineer: string;
  sessionId: string;
  loreEntryId?: string;
  taskDescription?: string;
  symbolsTouched: string[];
  filesModified: string[];
  relatedIncidentId?: string;
  notes?: string;
}

export interface PracticeEventInput {
  habitId: string;
  habitCategory: PracticeCategory;
  result: PracticeResult;
  engineer: string;
  sessionId: string;
  loreEntryId?: string;
  taskDescription?: string;
  symbolsTouched?: string[];
  filesModified?: string[];
  relatedIncidentId?: string;
  notes?: string;
}

export interface PracticeEventQuery {
  habitId?: string;
  habitCategory?: PracticeCategory;
  result?: PracticeResult;
  engineer?: string;
  sessionId?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

// ═══════════════════════════════════════════════════════════════════
// STRUCTURED LOGGING TYPES
// ═══════════════════════════════════════════════════════════════════

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogSymbolType = 'component' | 'gate' | 'signal' | 'flow' | 'aspect' | 'raw';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  symbol: string;
  symbolType: LogSymbolType;
  message: string;
  data?: Record<string, unknown>;
  service: string;
  sessionId?: string;
  correlationId?: string;
  durationMs?: number;
  environment?: string;
}

export interface LogEntryInput {
  id?: string;
  timestamp?: string;
  level: LogLevel;
  symbol: string;
  symbolType?: LogSymbolType;
  message: string;
  data?: Record<string, unknown>;
  service: string;
  sessionId?: string;
  correlationId?: string;
  durationMs?: number;
  environment?: string;
}

export interface LogQueryOptions {
  level?: LogLevel;
  symbol?: string;
  service?: string;
  sessionId?: string;
  correlationId?: string;
  search?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

// ═══════════════════════════════════════════════════════════════════
// SERVICE REGISTRY TYPES
// ═══════════════════════════════════════════════════════════════════

export interface ServiceInfo {
  name: string;
  version?: string;
  pid?: number;
  startedAt: string;
  lastSeenAt: string;
  environment?: string;
  metadata?: Record<string, unknown>;
}

export interface ServiceRegistration {
  name: string;
  version?: string;
  pid?: number;
  environment?: string;
  metadata?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════
// LIVE STATE TRACKING
// ═══════════════════════════════════════════════════════════════════

export interface AppState {
  service: string;
  sessionId: string;
  timestamp: string;
  state: Record<string, unknown>;
  activeFlows?: string[];
  activeGates?: string[];
}

// ═══════════════════════════════════════════════════════════════════
// SYMBOL VALIDATION
// ═══════════════════════════════════════════════════════════════════

export interface SymbolValidationResult {
  symbol: string;
  known: boolean;
  type?: string;
  definedIn?: string;
  suggestion?: string;
}

// ═══════════════════════════════════════════════════════════════════
// SERVER CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

export interface SentinelServerConfig {
  port: number;
  maxLogs: number;
  maxBatchSize: number;
  wsMaxSubscribers: number;
  pruneIntervalInserts: number;
  logRetentionDays: number;
  auth: AuthConfig;
  rateLimit: RateLimitConfig;
  tls?: { cert: string; key: string };
}

// ═══════════════════════════════════════════════════════════════════
// AUTHENTICATION
// ═══════════════════════════════════════════════════════════════════

export interface AuthConfig {
  enabled: boolean;
  tokens: AuthToken[];
}

export interface AuthToken {
  id: string;
  name: string;
  token: string;           // Bearer token value
  permissions: AuthPermission[];
  createdAt: string;
  expiresAt?: string;
}

export type AuthPermission = 'read' | 'write' | 'admin';

export const DEFAULT_AUTH_CONFIG: AuthConfig = {
  enabled: false,
  tokens: [],
};

// ═══════════════════════════════════════════════════════════════════
// METRICS / TIME-SERIES
// ═══════════════════════════════════════════════════════════════════

export type MetricType = 'counter' | 'gauge' | 'histogram';

export interface MetricEntry {
  id: string;
  timestamp: string;
  name: string;              // e.g. "http.request.duration", "checkout.attempts"
  type: MetricType;
  value: number;
  tags: Record<string, string>; // e.g. {service: "star", method: "POST", status: "200"}
  service: string;
  environment?: string;
}

export interface MetricInput {
  name: string;
  type: MetricType;
  value: number;
  tags?: Record<string, string>;
  service: string;
  timestamp?: string;
  environment?: string;
}

export interface MetricQueryOptions {
  name?: string;
  type?: MetricType;
  service?: string;
  tag?: string;              // "key=value" filter
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

export interface MetricAggregation {
  name: string;
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
  p50?: number;
  p95?: number;
  p99?: number;
}

export interface HistogramBucket {
  le: number;                // Less-than-or-equal boundary
  count: number;
}

// ═══════════════════════════════════════════════════════════════════
// RATE LIMITING
// ═══════════════════════════════════════════════════════════════════

export interface RateLimitConfig {
  enabled: boolean;
  global: RateLimitRule;
  perService: Record<string, RateLimitRule>;
}

export interface RateLimitRule {
  maxRequestsPerMinute: number;
  maxEntriesPerBatch: number;
  samplingRate: number;      // 0.0 to 1.0 — 1.0 means accept all
}

export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  enabled: false,
  global: {
    maxRequestsPerMinute: 600,
    maxEntriesPerBatch: 500,
    samplingRate: 1.0,
  },
  perService: {},
};

// ═══════════════════════════════════════════════════════════════════
// SERVER CONFIG DEFAULTS (must be after auth + rate limit defaults)
// ═══════════════════════════════════════════════════════════════════

export const DEFAULT_SERVER_CONFIG: SentinelServerConfig = {
  port: 3838,
  maxLogs: 10000,
  maxBatchSize: 500,
  wsMaxSubscribers: 256,
  pruneIntervalInserts: 100,
  logRetentionDays: 0,
  auth: DEFAULT_AUTH_CONFIG,
  rateLimit: DEFAULT_RATE_LIMIT_CONFIG,
};

// ═══════════════════════════════════════════════════════════════════
// CROSS-APP TRACING
// ═══════════════════════════════════════════════════════════════════

export interface TraceSpan {
  traceId: string;           // Shared across all services in a trace
  spanId: string;            // Unique to this span
  parentSpanId?: string;     // Parent span (for nesting)
  service: string;
  symbol: string;
  operation: string;         // e.g. "POST /api/checkout", "process-payment"
  startTime: string;
  endTime?: string;
  durationMs?: number;
  status: 'ok' | 'error';
  tags: Record<string, string>;
  logs: string[];            // Log entry IDs associated with this span
}

export interface TraceSpanInput {
  traceId: string;
  spanId?: string;
  parentSpanId?: string;
  service: string;
  symbol: string;
  operation: string;
  startTime?: string;
  endTime?: string;
  durationMs?: number;
  status?: 'ok' | 'error';
  tags?: Record<string, string>;
  logIds?: string[];
}

export interface TraceView {
  traceId: string;
  spans: TraceSpan[];
  services: string[];
  totalDurationMs: number;
  startTime: string;
  endTime: string;
}
