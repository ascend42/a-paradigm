/**
 * Lore Data Model - Structured project history entries
 *
 * Lore unifies session records, decisions, reviews, and milestones
 * into a single, queryable, human-browsable timeline.
 */

export interface LoreDecision {
  id: string;
  decision: string;
  rationale: string;
  confidence?: number; // 0.0 to 1.0
}

export type AssessmentVerdict = 'correct' | 'partial' | 'incorrect';

export interface LoreAssessment {
  verdict: AssessmentVerdict;
  assessed_by: string;
  assessed_at: string; // ISO 8601
  notes?: string;
}

export interface LoreError {
  description: string;
  resolution: string;
  time_to_fix?: string; // "5 minutes"
}

export type LoreType = 'agent-session' | 'human-note' | 'decision' | 'review' | 'incident' | 'milestone' | 'retro' | 'insight';

export interface LoreEntry {
  id: string; // "L-2026-03-02-ascend-143025-001"
  type?: LoreType;
  timestamp: string; // ISO 8601

  duration_minutes?: number;

  // Who — always the human user
  author: string; // "ascend", "matt", etc.

  // AI assistance (optional)
  agent?: {
    provider: string; // "anthropic", "openai", etc.
    model: string; // "claude-opus-4-6"
  };

  // What
  title: string; // "Built Sentinel Phase 1"
  summary: string; // 2-3 sentence narrative

  // Symbols
  symbols_touched: string[]; // ["#sentinel-sdk", "^authenticated"]
  symbols_created?: string[]; // new symbols introduced

  // Artifacts
  files_created?: string[];
  files_modified?: string[];
  lines_added?: number;
  lines_removed?: number;
  commit?: string; // git hash

  // Decisions & Learnings
  decisions?: LoreDecision[];
  errors_encountered?: LoreError[];
  learnings?: string[];

  // Verification
  verification?: {
    status: 'pass' | 'fail' | 'partial' | 'untested';
    details?: Record<string, 'pass' | 'fail'>; // { cli: 'pass', build: 'pass' }
  };

  // Human review (filled in later)
  review?: {
    reviewer: string;
    completeness: 1 | 2 | 3 | 4 | 5;
    quality: 1 | 2 | 3 | 4 | 5;
    notes?: string;
    reviewed_at: string; // ISO 8601
  };

  // Habit compliance (auto-attached)
  habit_compliance?: {
    rate: number;
    followed: number;
    skipped: number;
    partial: number;
    weakAreas?: string[];
  };

  // Long-form content (from assessment body)
  body?: string;

  // Cross-references
  linked_lore?: string[];     // Other lore entry IDs
  linked_tasks?: string[];    // Paradigm task IDs
  linked_commits?: string[];  // Git commit SHAs

  // Confidence calibration
  confidence?: number; // 0.0 to 1.0 — agent's predicted confidence in correctness
  assessment?: LoreAssessment; // Human verdict on correctness
  assessment_delta?: number; // impliedScore - confidence (positive = under-confident, negative = over-confident)

  // Tags for filtering
  tags?: string[]; // ["phase-1", "sentinel", "sdk", "arc:lore-evolution"]

  // Project-defined metadata (open-ended key-value pairs)
  meta?: Record<string, unknown>;

  // Git snapshot at time of recording
  git_context?: {
    ref: string; // commit SHA
    branch: string;
    dirty: boolean; // uncommitted changes present
  };
}

export interface LoreFilter {
  author?: string;
  hasAgent?: boolean;
  /** @deprecated Use hasAgent instead */
  authorType?: 'human' | 'agent';
  symbol?: string;
  dateFrom?: string;
  dateTo?: string;
  type?: LoreType;
  tag?: string; // Filter by tag prefix (e.g., "arc:lore-evolution")
  hasBody?: boolean;
  tags?: string[];
  hasReview?: boolean;
  hasConfidence?: boolean;
  hasAssessment?: boolean;
  minCompleteness?: number;
  limit?: number;
  offset?: number;
}

export interface LoreTimeline {
  version: string; // "1.0"
  project: string;
  entries: number; // count
  last_updated: string;
  authors: string[]; // unique author IDs
}
