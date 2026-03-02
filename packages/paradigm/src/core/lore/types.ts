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
}

export interface LoreError {
  description: string;
  resolution: string;
  time_to_fix?: string; // "5 minutes"
}

export interface LoreEntry {
  id: string; // "L-2026-03-02-ascend-143025-001"
  type: 'agent-session' | 'human-note' | 'decision' | 'review' | 'incident' | 'milestone';
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

  // Tags for filtering
  tags?: string[]; // ["phase-1", "sentinel", "sdk"]
}

export interface LoreFilter {
  author?: string;
  hasAgent?: boolean;
  /** @deprecated Use hasAgent instead */
  authorType?: 'human' | 'agent';
  symbol?: string;
  dateFrom?: string;
  dateTo?: string;
  type?: LoreEntry['type'];
  tags?: string[];
  hasReview?: boolean;
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
