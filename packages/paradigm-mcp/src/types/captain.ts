/**
 * Captain (Cid) Types
 *
 * Types for the Context Brief and Debrief Report produced by
 * paradigm_captain_brief and paradigm_captain_debrief.
 */

// ────────────────────────────────────────────────────────
// Context Brief
// ────────────────────────────────────────────────────────

export interface ContextBriefSymbol {
  id: string;
  type: 'component' | 'flow' | 'gate' | 'signal' | 'aspect';
  description: string;
  file?: string;
}

export interface ContextBriefBlastRadius {
  affectedFiles: string[];
  affectedSymbols: string[];
  affectedFlows: string[];
  affectedGates: string[];
  fragileSymbols: string[];
}

export interface ContextBriefGate {
  route: string;
  gate: string;
  declared: boolean;
}

export interface ContextBriefProtocol {
  matched: boolean;
  id?: string;
  name?: string;
  steps?: string[];
}

export interface ContextBriefCoverage {
  score: number;
  label: 'sparse' | 'partial' | 'reliable' | 'comprehensive';
  note: string;
}

export interface ContextBriefLoreRef {
  id: string;
  summary: string;
  relevance: string;
}

export interface ContextBrief {
  territory: {
    directories: string[];
    files: string[];
    estimatedScope: 'tiny' | 'small' | 'medium' | 'large';
  };
  symbols: ContextBriefSymbol[];
  blastRadius: ContextBriefBlastRadius;
  gates: ContextBriefGate[];
  protocol: ContextBriefProtocol;
  warnings: string[];
  coverage: ContextBriefCoverage;
  loreRefs: ContextBriefLoreRef[];
  /** Arch map loaded from .paradigm/arch.yaml; undefined if no arch.yaml present */
  archMap?: import('../utils/arch-loader.js').ArchMap | null;
  /** Rendered text block for injection into agent prompts */
  renderedBrief: string;
}

// ────────────────────────────────────────────────────────
// Debrief Report
// ────────────────────────────────────────────────────────

export interface SessionInsightsAgentContribution {
  agentId: string;
  contribution: string;
  symbolsTouched: string[];
  patternsObserved: string[];
}

export interface SessionInsights {
  taskDescription: string;
  orchestrationId: string;
  agentContributions: SessionInsightsAgentContribution[];
  coverageDelta: {
    before: number;
    after: number;
  };
  newSymbols: string[];
  touchedFiles: string[];
  notes: string;
}

export interface DebriefReport {
  coverageAdded: string[];
  delegatedToDocumentor: string[];
  loreEntryId: string;
  coverageScore: {
    before: number;
    after: number;
    delta: number;
  };
  stopHookCleared: boolean;
  /**
   * v7 §3 postflight liveness check + self-heal outcome. `ranThisSession` reads
   * the settlement-liveness probe; if false, Cid self-heals (runs postflight)
   * and on failure proposes an ADVISE block (never guard).
   */
  postflight?: {
    ranThisSession: boolean;
    selfHealed: boolean;
    selfHealError?: string;
    blockProposed: boolean;
  };
  sessionInsights: SessionInsights;
}

// ────────────────────────────────────────────────────────
// Cid Session Marker
// ────────────────────────────────────────────────────────

export interface CidSessionMarker {
  timestamp: string;
  taskDescription: string;
  depth: string;
  coverageScore?: number;
}

export interface CidBriefedMarker {
  timestamp: string;
  sessionId: string;
  touchedFiles: string[];
  coverageScore: number;
}

// ────────────────────────────────────────────────────────
// Captain Board (#captain-board — v7 §3, Cid's owned artifact)
// ────────────────────────────────────────────────────────

import type { Claimant, TaskStatus } from '../utils/task-loader.js';

/** Derived live-status of an orchestration run (epic + its children). */
export type RunStatus = 'pending' | 'in-progress' | 'settled' | 'crashed';

/** A single node (stage-task) in a run's live DAG. */
export interface BoardNode {
  taskId: string;
  blurb: string;
  stage?: number;
  status: TaskStatus;
  claimant?: Claimant;
  dependsOn: string[];
  /**
   * Fragile / high-ripple symbols touched by this node, merged INLINE (adversarial
   * cut: not a separate block). Empty when no ripple risk detected.
   */
  fragileSymbols: string[];
}

/** One orchestration run: its epic + ordered stage-children. */
export interface BoardRun {
  epicTaskId: string;
  blurb: string;
  runStatus: RunStatus;
  settledAt?: string;
  nodes: BoardNode[];
}

/** An unclaimed open task, ripple-ranked, with a proposed claimant. */
export interface BoardUnclaimed {
  taskId: string;
  blurb: string;
  priority: 'high' | 'medium' | 'low';
  tags: string[];
  /** Higher = more downstream blast-radius (ranked descending). */
  rippleScore: number;
  fragileSymbols: string[];
  /** Cid's proposed archetype owner (session-open writes this back as claimant). */
  proposedClaimant?: Claimant;
}

export interface CaptainBoard {
  runs: BoardRun[];
  unclaimed: BoardUnclaimed[];
  /**
   * Full-forest tail (TD-2026-06-14-467, Cid's "see the whole forest" protocol):
   * non-terminal root tasks that are NOT orchestration epics and NOT in the
   * ripple-ranked `unclaimed` pile — i.e. CLAIMED standalone tasks (and
   * in-progress unclaimed standalone tasks). Before this, a human/CLI-claimed
   * task with no orchestration parent was invisible on the board. Rendered as
   * claimant lanes by the Tasks board.
   */
  loose: BoardNode[];
  summary: {
    runs: number;
    open: number;
    inFlight: number;
    unclaimed: number;
    loose: number;
  };
  /**
   * DAG integrity violations (Cid-owned, advise-only — TD-2026-06-14-467). Empty
   * when the graph is sound. Surfaced as a board warning; never blocks.
   */
  integrity?: import('../utils/task-loader.js').DagViolation[];
  /**
   * Settlement-debt (Loid-owned, detect-only — TD-2026-06-14-467): runs whose
   * children are ALL terminal but the epic never stamped `settledAt` — the
   * learning loop never closed on them. Loid detects; Cid owns any graph fix.
   */
  settlementDebt?: Array<{ epicTaskId: string; blurb: string; reason: string }>;
  /**
   * Stale archetype claims (Cid-owned, advise-only — TD-2026-06-14-467):
   * archetype-claimed tasks still `open` (never started) past the staleness
   * window. Candidates to release back to unclaimed. Human/peer claims are
   * sticky and never appear here. Cid surfaces; release is a deliberate act.
   */
  staleClaims?: Array<{ taskId: string; blurb: string; claimant: Claimant; ageDays: number }>;
}
