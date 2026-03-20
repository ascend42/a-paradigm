/**
 * Data Policy & Sovereignty Types — trust rings, data classification, enforcement
 *
 * Every piece of data produced during agent work falls into one of four concentric
 * trust rings. The user controls which ring each category of data can reach.
 *
 * Ring 1: Project-Locked — never leaves the project, ever
 * Ring 2: User-Scoped — travels across the user's own projects only
 * Ring 3: Creator-Upstream — anonymized feedback to agent creators
 * Ring 4: Network-Public — aggregated statistics only
 *
 * Configuration: .paradigm/data-policy.yaml
 */

// ────────────────────────────────────────────────────────
// Trust Rings
// ────────────────────────────────────────────────────────

export type TrustRing = 'project-locked' | 'user-scoped' | 'creator-upstream' | 'network-public';

export const TRUST_RING_ORDER: Record<TrustRing, number> = {
  'project-locked': 1,
  'user-scoped': 2,
  'creator-upstream': 3,
  'network-public': 4,
};

// ────────────────────────────────────────────────────────
// Observation Rules
// ────────────────────────────────────────────────────────

export interface ObservationRules {
  /** Glob patterns agents can observe */
  allow?: string[];
  /** Glob patterns agents must never observe */
  deny?: string[];
}

// ────────────────────────────────────────────────────────
// Stream Content Rules
// ────────────────────────────────────────────────────────

export type ContentCategory =
  | 'file_paths'
  | 'symbol_names'
  | 'symbol_names_with_context'
  | 'outcome'
  | 'pattern_descriptions'
  | 'confidence_adjustments'
  | 'approach_descriptions'
  | 'rationale'
  | 'alternatives'
  | 'symbol_references'
  | 'code_snippets'
  | 'file_contents'
  | 'diff_content'
  | 'implementation_details'
  | 'architectural_decisions';

export interface RedactionPattern {
  /** Regex pattern to match sensitive content */
  pattern: string;
  /** Optional replacement text */
  replacement?: string;
}

export interface StreamContentRules {
  /** Trust ring for this stream */
  ring: TrustRing;
  /** Content categories allowed in this stream */
  allow_content?: ContentCategory[];
  /** Content categories denied from this stream */
  deny_content?: ContentCategory[];
  /** Regex-based redaction patterns */
  redaction?: RedactionPattern[];
}

// ────────────────────────────────────────────────────────
// Upstream Rules
// ────────────────────────────────────────────────────────

export type UpstreamField =
  | 'task_type'
  | 'outcome'
  | 'helpfulness'
  | 'duration_bucket'
  | 'error_category';

export type UpstreamDenied =
  | 'code_of_any_kind'
  | 'file_paths'
  | 'symbol_names'
  | 'conversation_content'
  | 'user_identity';

export interface UpstreamRules {
  /** Trust ring for upstream data (must be creator-upstream or higher) */
  ring: TrustRing;
  /** Fields allowed to flow upstream */
  allowed?: UpstreamField[];
  /** Fields explicitly denied from flowing upstream */
  denied?: UpstreamDenied[];
}

// ────────────────────────────────────────────────────────
// Network Rules
// ────────────────────────────────────────────────────────

export type NetworkMetric =
  | 'aggregated_task_success_rates'
  | 'anonymized_pattern_frequency';

export interface NetworkRules {
  /** Trust ring (must be network-public) */
  ring: TrustRing;
  /** Whether user has opted in to network sharing */
  opt_in: boolean;
  /** Metrics shared if opted in */
  if_opted_in?: NetworkMetric[];
}

// ────────────────────────────────────────────────────────
// Agent-Specific Overrides
// ────────────────────────────────────────────────────────

export interface AgentPolicyOverride {
  /** Override observation rules for this agent */
  observation?: ObservationRules;
  /** Override learning journal rules for this agent */
  learning_journal?: StreamContentRules;
  /** Override upstream rules for this agent */
  upstream?: {
    opt_in?: boolean;
  };
}

// ────────────────────────────────────────────────────────
// Deployment Tiers
// ────────────────────────────────────────────────────────

export type DeploymentTier = 'individual' | 'team' | 'enterprise';

export interface DeploymentConfig {
  /** Deployment context */
  tier: DeploymentTier;
  /** Local brain configuration */
  local_brain: 'always';
  /** Team brain configuration (team/enterprise only) */
  team_brain?: 'shared' | 'isolated';
  /** Org brain configuration (enterprise only) */
  org_brain?: 'fully_open' | 'restricted';
  /** Upstream control */
  upstream: 'gated' | 'company_policy';
  /** Network sharing control */
  network: 'opt-in' | 'company_policy';
}

// ────────────────────────────────────────────────────────
// Complete Data Policy (maps to .paradigm/data-policy.yaml)
// ────────────────────────────────────────────────────────

export interface DataPolicy {
  /** Schema version */
  version: string;
  /** Default trust ring for all data */
  default_ring: TrustRing;
  /** What agents can observe */
  observation?: ObservationRules;
  /** Per-stream content rules */
  streams?: {
    work_log?: StreamContentRules;
    learning_journal?: StreamContentRules;
    team_decisions?: StreamContentRules;
  };
  /** What flows upstream to agent creators */
  upstream?: UpstreamRules;
  /** What flows to the network (aggregated) */
  network?: NetworkRules;
  /** Per-agent policy overrides */
  agent_overrides?: Record<string, AgentPolicyOverride>;
  /** Deployment configuration */
  deployment?: DeploymentConfig;
}

// ────────────────────────────────────────────────────────
// Enforcement Points
// ────────────────────────────────────────────────────────

export type EnforcementBoundary =
  | 'event-emission'
  | 'attention-filtering'
  | 'work-log-recording'
  | 'journal-recording'
  | 'cross-project-transfer'
  | 'upstream-feedback'
  | 'network-aggregation'
  | 'notebook-promotion';

export interface EnforcementResult {
  /** The boundary where enforcement occurred */
  boundary: EnforcementBoundary;
  /** Whether the data was allowed through */
  allowed: boolean;
  /** What was filtered or redacted */
  filtered?: string[];
  /** What was redacted by pattern matching */
  redacted?: string[];
  /** Ring that was checked */
  ring_checked: TrustRing;
  /** Timestamp of enforcement */
  timestamp: string;
}

// ────────────────────────────────────────────────────────
// Audit Trail
// ────────────────────────────────────────────────────────

export interface AuditEntry {
  /** Unique audit ID */
  id: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Agent involved */
  agent: string;
  /** Enforcement boundary */
  boundary: EnforcementBoundary;
  /** What data was involved (category, not content) */
  data_category: ContentCategory | UpstreamField | NetworkMetric;
  /** Action taken */
  action: 'allowed' | 'filtered' | 'redacted' | 'blocked';
  /** Ring the data was flowing to */
  destination_ring: TrustRing;
  /** Details (never includes actual data) */
  details?: string;
}

// ────────────────────────────────────────────────────────
// Defaults
// ────────────────────────────────────────────────────────

export const DEFAULT_DATA_POLICY: DataPolicy = {
  version: '1.0',
  default_ring: 'project-locked',
  observation: {
    allow: ['src/**', '.paradigm/**', 'portal.yaml'],
    deny: ['.env*', '**/*.key', '**/*.pem', '**/secrets/**'],
  },
  streams: {
    work_log: {
      ring: 'project-locked',
      allow_content: ['file_paths', 'symbol_names', 'outcome'],
      deny_content: ['code_snippets', 'file_contents', 'diff_content'],
    },
    learning_journal: {
      ring: 'user-scoped',
      allow_content: ['pattern_descriptions', 'confidence_adjustments', 'approach_descriptions'],
      deny_content: ['code_snippets', 'file_contents', 'symbol_names_with_context'],
      redaction: [
        { pattern: '\\b[A-Z_]{2,}_KEY\\b' },
        { pattern: 'password|secret|token' },
      ],
    },
    team_decisions: {
      ring: 'project-locked',
      allow_content: ['rationale', 'alternatives', 'symbol_references'],
      deny_content: ['implementation_details'],
    },
  },
  upstream: {
    ring: 'creator-upstream',
    allowed: ['task_type', 'outcome', 'helpfulness', 'duration_bucket', 'error_category'],
    denied: ['code_of_any_kind', 'file_paths', 'symbol_names', 'conversation_content', 'user_identity'],
  },
  network: {
    ring: 'network-public',
    opt_in: false,
    if_opted_in: ['aggregated_task_success_rates', 'anonymized_pattern_frequency'],
  },
};
