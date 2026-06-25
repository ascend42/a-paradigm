/**
 * Knowledge Streams Types — Work Log, Learning Journal, Team Decisions
 *
 * Lore entries are split into three distinct streams with different audiences,
 * lifecycles, and storage locations:
 *
 * 1. Work Log — "What got done" (project-scoped, ephemeral)
 *    Storage: .paradigm/work-log/{date}/
 *
 * 2. Learning Journal — "What I learned" (agent-private, durable)
 *    Storage: ~/.paradigm/agents/{id}/journal/
 *
 * 3. Team Decisions — "What we decided" (project-scoped, institutional)
 *    Storage: .paradigm/decisions/
 */

// ────────────────────────────────────────────────────────
// Stream 1: Work Log
// ────────────────────────────────────────────────────────

export type WorkOutcome = 'pass' | 'fail' | 'partial' | 'blocked';

export interface WorkLogEntry {
  /** Unique ID (e.g., "WL-security-001") */
  id: string;
  /** Agent that did the work */
  agent: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Link to ticket/issue (e.g., "ENG-142") */
  task_ref?: string;
  /** What was done */
  summary: string;
  /** Files that were modified */
  files_modified?: string[];
  /** Paradigm symbols touched */
  symbols_touched?: string[];
  /** How it went */
  outcome: WorkOutcome;
  /** What's left to do */
  next_steps?: string[];
  /** What's blocking progress */
  blockers?: string[];
  /** How long it took */
  duration_minutes?: number;
  /** Git commit hash */
  commit?: string;
  /** Lines added/removed */
  lines_added?: number;
  lines_removed?: number;
  /** Linked lore entry ID (backward compat) */
  linked_lore?: string;
}

// ────────────────────────────────────────────────────────
// Stream 2: Learning Journal
// ────────────────────────────────────────────────────────

export type JournalTrigger =
  | 'correction_received'
  | 'confidence_miss'
  | 'pattern_discovered'
  | 'debate_loss'
  | 'failure_analysis'
  | 'human_feedback'
  | 'self_reflection';

export interface LearningPattern {
  /** Pattern identifier (e.g., "gate-ordering-jwt") */
  id: string;
  /** When this pattern applies */
  applies_when: string;
  /** The correct approach */
  correct_approach: string;
}

/**
 * External-provenance envelope for a journal entry.
 *
 * Mirrors the trust/source literals of `NotebookProvenance` (types/notebooks.ts).
 * Used by the Expeditions / `/paradigm:forage` flow to stage foraged web
 * candidates as study-hall journal entries at the floor trust tier
 * (source: 'external', trust: 'external'). Optional and additive — entries
 * recorded without it serialize exactly as before.
 */
export interface JournalProvenance {
  /** Source type (e.g., 'external' for a foraged web candidate). */
  source?: string;
  /** Trust tier — 'external' is the un-promoted, context-excluded floor. */
  trust?: 'certified' | 'provisional' | 'external';
  /** Source refs this entry was distilled from (e.g., foraged URLs). */
  sourceSet?: string[];
}

export interface JournalEntry {
  /** Unique ID (e.g., "LJ-2026-03-20-001") */
  id: string;
  /** Agent who learned this */
  agent: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** What triggered this learning moment */
  trigger: JournalTrigger;
  /** The insight itself */
  insight: string;
  /** Confidence before the learning event */
  confidence_before?: number;
  /** Confidence after adjustment */
  confidence_after?: number;
  /** Extracted pattern (if any) */
  pattern?: LearningPattern;
  /** Work log entry that prompted this learning */
  linked_work_log?: string;
  /** Project where this happened */
  project: string;
  /** Whether this applies to other projects */
  transferable: boolean;
  /** Tags for categorization */
  tags?: string[];
  /** Whether this has been promoted to a notebook entry */
  promoted_to_notebook?: string;
  /**
   * External-provenance envelope. Present only for entries staged with
   * provenance (e.g., foraged web candidates via `/paradigm:forage`).
   * Omitted entirely for ordinary learning-journal entries.
   */
  provenance?: JournalProvenance;
}

// ────────────────────────────────────────────────────────
// Stream 3: Team Decisions
// ────────────────────────────────────────────────────────

export type DecisionStatus = 'active' | 'superseded' | 'deprecated' | 'proposed' | 'rejected';

export type ParticipantStance = 'proposed' | 'supported' | 'dissented' | 'abstained' | 'neutral';

export interface DecisionParticipant {
  /** Participant identifier (e.g., "human/matt", "a-paradigm/security") */
  id: string;
  /** Role in the decision */
  role: 'human' | 'agent';
  /** Their stance on the decision */
  stance: ParticipantStance;
}

export interface DecisionAlternative {
  /** The alternative option */
  option: string;
  /** Why it was not chosen */
  rejected_because: string;
}

export interface TeamDecision {
  /** Unique ID (e.g., "TD-2026-03-20-001") */
  id: string;
  /** Decision title */
  title: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Who participated in the decision */
  participants: DecisionParticipant[];
  /** The decision itself */
  decision: string;
  /** Why this was chosen */
  rationale: string;
  /** What else was considered */
  alternatives_considered?: DecisionAlternative[];
  /** Paradigm symbols affected */
  symbols_affected?: string[];
  /** Current lifecycle status */
  status: DecisionStatus;
  /** ID of the decision that supersedes this one */
  superseded_by?: string;
  /** Tags for categorization */
  tags?: string[];
  /** Linked lore entry ID (backward compat) */
  linked_lore?: string;

  // ── v6.0 additions (all optional) ─────────────────────
  // Absorbed from the legacy wisdom-decision ADR schema so the
  // TD-* store can be the single canonical decision location.

  /** ADR-style context (situation/forces motivating the decision) */
  context?: string;
  /** ADR-style consequences of the decision */
  consequences?: {
    positive?: string[];
    negative?: string[];
    mitigations?: string[];
  };
  /** ADR-style date field (alongside timestamp) */
  date?: string;
  /** Provenance flag for entries ported from the legacy stores */
  migrated_from?: 'wisdom-decision' | 'lore-decision';
  /**
   * Inverse of `superseded_by` — enables bidirectional graph traversal of
   * the decision chain without a separate index. D2 Loid addendum.
   */
  supersedes?: string[];
}

// ────────────────────────────────────────────────────────
// Stream Classification
// ────────────────────────────────────────────────────────

export type KnowledgeStream = 'work-log' | 'journal' | 'decision' | 'auto';

export interface StreamClassification {
  /** Determined stream */
  stream: Exclude<KnowledgeStream, 'auto'>;
  /** Confidence in the classification */
  confidence: number;
  /** Reason for classification */
  reason: string;
}

// ────────────────────────────────────────────────────────
// Lore Migration Mapping
// ────────────────────────────────────────────────────────

/**
 * Maps existing lore types to their target knowledge streams.
 *
 * Some lore types split into multiple streams:
 * - agent-session → Work Log (what I did) + Learning Journal (what I learned)
 * - incident → Work Log (what happened) + Learning Journal (what we learned) + Team Decision (prevention)
 */
export const LORE_TYPE_TO_STREAM: Record<string, KnowledgeStream[]> = {
  'agent-session': ['work-log', 'journal'],
  'decision': ['decision'],
  'insight': ['journal', 'decision'],
  'milestone': ['decision'],
  'review': ['work-log', 'journal'],
  'incident': ['work-log', 'journal', 'decision'],
  'retro': ['journal', 'decision'],
  'human-note': ['decision'],
};

// ────────────────────────────────────────────────────────
// Stream Filters
// ────────────────────────────────────────────────────────

export interface WorkLogFilter {
  agent?: string;
  outcome?: WorkOutcome;
  task_ref?: string;
  symbol?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export interface JournalFilter {
  agent?: string;
  trigger?: JournalTrigger;
  project?: string;
  transferable?: boolean;
  tag?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export interface DecisionFilter {
  status?: DecisionStatus;
  participant?: string;
  symbol?: string;
  tag?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}
