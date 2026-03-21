/**
 * Ambient Coordination Types — event stream, attention filtering, nominations
 *
 * The ambient model replaces explicit agent-to-agent messaging with a shared
 * event stream. Agents observe events, filter by attention patterns, and
 * self-nominate contributions when relevant.
 *
 * Event flow: Tool calls / file edits → Event Stream → Attention Filters → Nominations → Surfacing
 */

// ────────────────────────────────────────────────────────
// Event Stream
// ────────────────────────────────────────────────────────

export type EventSource =
  | 'post-write-hook'
  | 'mcp-tool-call'
  | 'stop-hook'
  | 'conversation'
  | 'agent-action'
  | 'error';

export type EventType =
  | 'file-modified'
  | 'symbol-queried'
  | 'gate-checked'
  | 'compliance-violation'
  | 'concept-mentioned'
  | 'work-completed'
  | 'decision-made'
  | 'error-encountered'
  | 'route-created'
  | 'gate-added'
  | 'flow-modified'
  | 'test-result';

export interface StreamEvent {
  /** Unique event ID */
  id: string;
  /** Event classification */
  type: EventType;
  /** Where this event originated */
  source: EventSource;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** File path (if applicable) */
  path?: string;
  /** Paradigm symbols referenced */
  symbols?: string[];
  /** Semantic keywords extracted */
  keywords?: string[];
  /** Brief context snippet */
  context?: string;
  /** Agent that produced this event (if from agent action) */
  agent?: string;
  /** Tool name (if from MCP tool call) */
  tool?: string;
  /** Severity for compliance/error events */
  severity?: 'info' | 'warning' | 'error' | 'critical';
  /** Structured metadata */
  data?: Record<string, unknown>;
}

// ────────────────────────────────────────────────────────
// Attention Scoring
// ────────────────────────────────────────────────────────

export interface AttentionScore {
  /** Agent that evaluated this event */
  agentId: string;
  /** Overall relevance score (0.0-1.0) */
  score: number;
  /** Breakdown of what matched */
  breakdown: {
    /** Symbol pattern match score */
    symbolMatch: number;
    /** File path match score */
    pathMatch: number;
    /** Semantic concept match score */
    conceptMatch: number;
    /** Signal type match (0 or 1) */
    signalMatch: number;
  };
  /** Whether the agent exceeded its speak threshold */
  shouldNominate: boolean;
  /** Reason the agent stayed quiet (if shouldNominate is false) */
  quietReason?: 'below-threshold' | 'another-agent-handling' | 'human-excluded' | 'no-match';
}

// ────────────────────────────────────────────────────────
// Nominations
// ────────────────────────────────────────────────────────

export type NominationType = 'warning' | 'suggestion' | 'question' | 'offer' | 'observation';

export type NominationUrgencyLevel = 'critical' | 'high' | 'medium' | 'low';

export interface Nomination {
  /** Unique nomination ID */
  id: string;
  /** Agent making the nomination */
  agent: string;
  /** Relevance score from attention filtering */
  relevance: number;
  /** How urgently this should be surfaced */
  urgency: NominationUrgencyLevel;
  /** Kind of contribution */
  type: NominationType;
  /** 1-line summary */
  brief: string;
  /** Full contribution (shown if human engages) */
  detail?: string;
  /** Optional action the agent offers to take */
  action_offered?: string;
  /** Evidence supporting the nomination */
  evidence?: NominationEvidence[];
  /** The event(s) that triggered this nomination */
  triggered_by: string[];
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Whether this nomination has been surfaced to the human */
  surfaced: boolean;
  /** Whether the human engaged with this nomination */
  engaged?: boolean;
  /** Human's response (if any) */
  response?: 'accepted' | 'dismissed' | 'deferred';
  /** Reason for the response — stored for learning feedback, especially valuable for dismissals */
  reason?: string;
}

export interface NominationEvidence {
  /** File path */
  file?: string;
  /** Paradigm symbol */
  symbol?: string;
  /** Pattern from agent's notebook */
  pattern?: string;
  /** Specific line numbers */
  lines?: { start: number; end: number };
  /** Description of the evidence */
  description?: string;
}

// ────────────────────────────────────────────────────────
// Surfacing Rules
// ────────────────────────────────────────────────────────

export interface SurfacingPreference {
  /** Agent whose nominations to configure */
  agent?: string;
  /** Show all nominations from this agent */
  always_show?: boolean;
  /** Batch nominations from this agent */
  batch?: boolean;
  /** Mute unless specific conditions met */
  mute_unless?: string[];
  /** Minimum urgency to surface */
  min_urgency?: NominationUrgencyLevel;
}

export interface SurfacingConfig {
  /** Per-agent surfacing preferences */
  preferences?: SurfacingPreference[];
  /** Default minimum urgency for unseen agents */
  default_min_urgency?: NominationUrgencyLevel;
  /** Whether to group conflicting nominations as debates */
  enable_debates?: boolean;
}

// ────────────────────────────────────────────────────────
// Debates (conflicting nominations)
// ────────────────────────────────────────────────────────

export interface Debate {
  /** Unique debate ID */
  id: string;
  /** Topic of the debate (derived from overlapping symbols/events) */
  topic: string;
  /** Nominations that form this debate */
  nominations: string[];
  /** Whether the nominations conflict or complement each other */
  type: 'conflicting' | 'complementary';
  /** Overlapping symbols that triggered grouping */
  overlap_symbols?: string[];
  /** Overlapping events that triggered grouping */
  overlap_events?: string[];
  /** Resolution (if resolved) */
  resolution?: {
    chosen: string;
    reason?: string;
    resolved_by: 'human' | 'consensus';
    resolved_at: string;
  };
}

// ────────────────────────────────────────────────────────
// Event Stream Configuration
// ────────────────────────────────────────────────────────

export interface EventStreamConfig {
  /** Whether ambient coordination is enabled */
  enabled: boolean;
  /** Maximum events to retain in the stream */
  max_events?: number;
  /** Event TTL in seconds (default: 3600 = 1 hour) */
  event_ttl_seconds?: number;
  /** Event types to emit */
  emit?: EventType[];
  /** Event types to suppress */
  suppress?: EventType[];
  /** Storage location for event stream */
  storage?: 'memory' | 'file';
  /** File path for file-based storage */
  storage_path?: string;
}
