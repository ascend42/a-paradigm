/**
 * Agent Identity Types — persistent, transferable agent profiles
 *
 * .agent files are YAML identity files stored in:
 *   ~/.paradigm/agents/       (global, travels across projects)
 *   .paradigm/agents/         (project-level overrides)
 *
 * Merge priority: project .agent > global .agent > agents.yaml
 */

// ────────────────────────────────────────────────────────
// Core Profile
// ────────────────────────────────────────────────────────

export interface AgentProfile {
  /** Agent identifier (e.g., "architect", "builder") */
  id: string;
  /** Human-readable role description */
  role: string;
  /** Extended description of capabilities */
  description: string;
  /** Profile schema version */
  version: string;
  /** Personality configuration for prompt enrichment */
  personality: AgentPersonality;
  /** Per-symbol expertise entries */
  expertise: AgentExpertiseEntry[];
  /** Cross-project reusable patterns */
  transferable: TransferablePattern[];
  /** Per-project adaptations keyed by project name */
  contexts: Record<string, AgentProjectContext>;
  /** ISO date of creation */
  created: string;
  /** ISO date of last update */
  updated: string;
  /** Optional permission scoping for controlled access */
  permissions?: AgentPermissions;
  /** SHA-256 hash of id+role+permissions for tamper detection */
  integrityHash?: string;

  // ── Renaissance Extensions (v5.0) ──

  /** Ambient attention patterns — what this agent notices */
  attention?: AgentAttention;
  /** Learning protocol — how this agent improves over time */
  learning?: AgentLearning;
  /** Context contributions — what this agent adds to shared context */
  context?: AgentContext;
  /** Work reporting — how this agent logs work and learnings */
  reporting?: AgentReporting;
  /** Collaboration stance — how this agent interacts with others */
  collaboration?: AgentCollaboration;
  /** Self-nomination — when this agent speaks up in ambient mode */
  nomination?: AgentNomination;
}

export interface AgentPersonality {
  style: 'deliberate' | 'rapid' | 'exploratory' | 'methodical';
  risk: 'conservative' | 'balanced' | 'aggressive';
  verbosity: 'minimal' | 'concise' | 'detailed';
}

// ────────────────────────────────────────────────────────
// Expertise
// ────────────────────────────────────────────────────────

export interface AgentExpertiseEntry {
  /** Symbol name (e.g., "#auth-middleware") */
  symbol: string;
  /** Confidence score 0.0-1.0, exponential moving average from lore */
  confidence: number;
  /** Count of lore entries touching this symbol */
  sessions: number;
  /** ISO date of last interaction */
  lastTouch: string;
}

// ────────────────────────────────────────────────────────
// Transferable Patterns
// ────────────────────────────────────────────────────────

export interface TransferablePattern {
  /** Pattern identifier (e.g., "portal-gate-pattern") */
  id: string;
  /** What this pattern does */
  description: string;
  /** Project where first encountered */
  learnedIn: string;
  /** Projects where successfully applied */
  appliedIn: string[];
  /** Success rate 0.0-1.0 */
  successRate: number;
  /** Optional linked protocol ID */
  linkedProtocol?: string;
  /** Optional linked lore entry IDs */
  linkedLore?: string[];
}

// ────────────────────────────────────────────────────────
// Per-Project Context
// ────────────────────────────────────────────────────────

export interface AgentProjectContext {
  /** Areas of focus in this project */
  focus: string[];
  /** Preferred model for this project */
  defaultModel?: 'opus' | 'sonnet' | 'haiku';
  /** Project-specific habits */
  habits?: string[];
  /** ISO date of last activity */
  lastActive?: string;
  /** Number of sessions in this project */
  sessionsInProject?: number;
}

// ────────────────────────────────────────────────────────
// Permissions
// ────────────────────────────────────────────────────────

export interface AgentPermissions {
  /** File path access control */
  paths?: {
    /** Glob patterns the agent can read */
    read?: string[];
    /** Glob patterns the agent can write */
    write?: string[];
    /** Glob patterns explicitly denied (overrides read/write) */
    deny?: string[];
  };
  /** Tool access control */
  tools?: {
    /** Tool name patterns allowed (e.g., ["paradigm_*", "Read"]) */
    allow?: string[];
    /** Tool name patterns denied (overrides allow) */
    deny?: string[];
  };
  /** Actions requiring explicit approval */
  dangerous_actions?: string[];
}

// ────────────────────────────────────────────────────────
// Attention Patterns (ambient relevance filtering)
// ────────────────────────────────────────────────────────

export interface AttentionSignal {
  /** Event type to listen for (e.g., "gate-added", "route-created") */
  type: string;
}

export interface AgentAttention {
  /** Symbol patterns that fire attention (e.g., ["^*", "#*-middleware"]) */
  symbols?: string[];
  /** File path patterns (e.g., ["middleware/**", "auth/**"]) */
  paths?: string[];
  /** Semantic concept triggers (e.g., ["permission", "JWT", "RBAC"]) */
  concepts?: string[];
  /** Event signals from other agents */
  signals?: AttentionSignal[];
  /** Confidence threshold to self-nominate (0.0-1.0, default 0.6) */
  threshold?: number;
}

// ────────────────────────────────────────────────────────
// Learning Protocol (dual-layer)
// ────────────────────────────────────────────────────────

export interface IntrinsicLearning {
  feedback?: {
    /** Ask for assessment after completing work */
    after_work?: boolean;
    /** Ask if recommendation was followed */
    after_recommendation?: boolean;
    /** Which agents' feedback matters */
    from_agents?: string[];
    /** Accept human assessment */
    from_humans?: boolean;
  };
  adaptation?: {
    /** EMA alpha for confidence adjustment (default 0.3) */
    confidence_ema_alpha?: number;
    /** Auto-promote learnings to notebook */
    notebook_auto_promote?: boolean;
    /** Extract transferable patterns */
    pattern_extraction?: boolean;
  };
  reflection?: {
    /** Record what went wrong on failure */
    on_failure?: boolean;
    /** Record when human corrected approach */
    on_correction?: boolean;
    /** Record when another agent's approach was chosen */
    on_debate_loss?: boolean;
  };
  calibration?: {
    /** Target accuracy rate (default 0.85) */
    target_accuracy?: number;
    /** Alert threshold for overconfidence delta (default 0.15) */
    overconfidence_alert?: number;
  };
}

export interface PlatformLearning {
  /** Always true — cannot be disabled */
  feedback_required: true;
  /** Metrics collected for marketplace quality signal */
  collect?: Array<'work_outcome' | 'helpfulness' | 'would_use_again'>;
  /** Feedback flows to creator anonymized */
  anonymized_upstream?: boolean;
  /** Stats grouping strategy */
  aggregation?: 'per-offering' | 'per-session' | 'per-project';
}

export interface AgentLearning {
  /** Agent's own drive to improve (optional for downloaded agents) */
  intrinsic?: IntrinsicLearning;
  /** Marketplace quality signal (mandated for all agents) */
  platform?: PlatformLearning;
}

// ────────────────────────────────────────────────────────
// Context Contributions
// ────────────────────────────────────────────────────────

export interface ContextContribution {
  /** Section name in composed context */
  section: string;
  /** Inline content (mutually exclusive with content_ref) */
  content?: string;
  /** MCP resource URI for on-demand content */
  content_ref?: string;
  /** Priority for inclusion (high = always, low = on-demand) */
  priority: 'high' | 'medium' | 'low';
}

export interface ContextRequirement {
  /** File path or section name required */
  file?: string;
  section?: string;
}

export interface AgentContext {
  /** Sections this agent contributes when active */
  contributions?: ContextContribution[];
  /** Context this agent needs loaded */
  requires?: ContextRequirement[];
}

// ────────────────────────────────────────────────────────
// Work Reporting
// ────────────────────────────────────────────────────────

export interface WorkLogConfig {
  /** Automatically log completed work */
  auto_record?: boolean;
  /** Structured fields to include */
  structure?: Array<'task_ref' | 'files_modified' | 'symbols_touched' | 'next_steps' | 'blockers'>;
  /** Destination stream */
  destination?: 'work-log';
}

export interface LearningJournalConfig {
  /** Automatically record learning moments */
  auto_record?: boolean;
  /** Events that trigger journal entries */
  triggers?: Array<'correction_received' | 'confidence_miss' | 'pattern_discovered'>;
  /** Destination stream (agent-private) */
  destination?: 'journal';
}

export interface AgentReporting {
  /** How the agent logs its work */
  work_log?: WorkLogConfig;
  /** How the agent records learnings (personal journal) */
  learning_journal?: LearningJournalConfig;
}

// ────────────────────────────────────────────────────────
// Collaboration Stance
// ────────────────────────────────────────────────────────

export type CollaborationStance = 'lead' | 'advisory' | 'supportive' | 'observer' | 'peer';

export interface AgentRelationship {
  /** Stance with this specific agent */
  stance?: CollaborationStance;
  /** Can contradict this agent */
  can_contradict?: boolean;
  /** Review this agent's output */
  review_output?: boolean;
  /** Debate style (evidence-based, authority, etc.) */
  debate_style?: 'evidence' | 'authority' | 'consensus';
}

export interface DebateConfig {
  /** Will push back on other agents */
  will_challenge?: boolean;
  /** Must cite specific code/patterns */
  evidence_required?: boolean;
  /** If debate doesn't resolve, ask human */
  escalate_to_human?: boolean;
}

export interface AgentCollaboration {
  /** Default stance */
  stance?: CollaborationStance;
  /** Per-agent relationship overrides */
  with?: Record<string, AgentRelationship>;
  /** Multi-agent debate dynamics */
  debate?: DebateConfig;
}

// ────────────────────────────────────────────────────────
// Self-Nomination
// ────────────────────────────────────────────────────────

export type NominationUrgency = 'security_risk' | 'breaking_change' | 'gate_missing' | 'test_failure' | 'performance_risk';

export interface AgentNomination {
  speak_when?: {
    /** Attention score threshold (default 0.6) */
    relevance_above?: number;
    /** Always speak for these urgency types */
    urgency?: NominationUrgency[];
    /** Always respond to direct questions */
    asked_directly?: boolean;
  };
  quiet_when?: {
    /** Don't speak below this relevance */
    relevance_below?: number;
    /** Stay quiet if another agent is handling it */
    another_agent_handling?: boolean;
    /** Stay quiet if human explicitly excluded this agent */
    human_explicitly_excluded?: boolean;
  };
  contribution_style?: {
    /** Start with a short take, elaborate if asked */
    brief_first?: boolean;
    /** Reference specific code/patterns */
    cite_sources?: boolean;
    /** Offer concrete actions, not just observations */
    offer_action?: boolean;
  };
}

// ────────────────────────────────────────────────────────
// Defaults
// ────────────────────────────────────────────────────────

export const DEFAULT_PERSONALITIES: Record<string, AgentPersonality> = {
  architect: { style: 'deliberate', risk: 'conservative', verbosity: 'detailed' },
  builder: { style: 'rapid', risk: 'balanced', verbosity: 'concise' },
  tester: { style: 'methodical', risk: 'conservative', verbosity: 'concise' },
  reviewer: { style: 'deliberate', risk: 'conservative', verbosity: 'detailed' },
  security: { style: 'methodical', risk: 'conservative', verbosity: 'detailed' },
};

export const DEFAULT_ATTENTION: Record<string, AgentAttention> = {
  architect: { symbols: ['$*', '#*'], concepts: ['architecture', 'design', 'pattern', 'refactor'], signals: [{ type: 'flow-modified' }, { type: 'compliance-violation' }], threshold: 0.5 },
  builder: { paths: ['src/**', 'lib/**', 'packages/**'], signals: [{ type: 'file-modified' }, { type: 'error-encountered' }], threshold: 0.7 },
  reviewer: { concepts: ['code quality', 'bug', 'smell', 'convention'], signals: [{ type: 'compliance-violation' }], threshold: 0.6 },
  tester: { paths: ['**/*.test.*', '**/*.spec.*'], concepts: ['test', 'coverage', 'assertion'], signals: [{ type: 'error-encountered' }, { type: 'test-result' }], threshold: 0.5 },
  security: { symbols: ['^*', '#*-auth', '#*-middleware'], paths: ['auth/**', 'middleware/**', 'guards/**'], concepts: ['permission', 'JWT', 'session', 'RBAC', 'XSS', 'injection'], signals: [{ type: 'gate-added' }, { type: 'route-created' }, { type: 'gate-checked' }, { type: 'compliance-violation' }], threshold: 0.4 },
};

export const DEFAULT_COLLABORATION: Record<string, AgentCollaboration> = {
  architect: { stance: 'lead', debate: { will_challenge: true, evidence_required: true, escalate_to_human: true } },
  builder: { stance: 'supportive', with: { architect: { stance: 'supportive', can_contradict: false } } },
  reviewer: { stance: 'advisory', debate: { will_challenge: true, evidence_required: true, escalate_to_human: true } },
  tester: { stance: 'supportive', debate: { will_challenge: false, evidence_required: true, escalate_to_human: false } },
  security: { stance: 'advisory', with: { architect: { stance: 'peer', can_contradict: true }, builder: { stance: 'advisory', review_output: true } }, debate: { will_challenge: true, evidence_required: true, escalate_to_human: true } },
};
