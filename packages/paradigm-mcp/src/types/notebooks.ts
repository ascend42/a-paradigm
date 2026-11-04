/**
 * Agent Notebook Types — curated snippet libraries distilled from lore
 *
 * Storage:
 *   ~/.paradigm/notebooks/{agent-id}/nb-{concept}.yaml   (global)
 *   .paradigm/notebooks/{agent-id}/nb-{concept}.yaml     (project)
 */

import type { HomeSource, LearningHome } from './knowledge-streams.js';

/** Publishing scope — controls which audiences can receive this entry. */
export type NotebookScope = 'generalizable' | 'project-specific' | 'platform-specific';

/** What kind of ledger row a piece of lesson evidence points at. */
export type LessonEvidenceKind = 'scenario-outcome' | 'probe-run' | 'field-failure' | 'source';

/** What the referenced row says the lesson did. */
export type LessonEvidenceVerdict = 'helped' | 'hurt' | 'no-effect' | 'confounded';

/**
 * One piece of evidence behind a lesson (checkable lesson schema, advisory).
 * Loid's rule: the verdict must be DERIVABLE from the ledger row `ref` points
 * at, never an author-asserted confidence. Readers re-derive it where the ledger
 * can (see utils/lesson-evidence.ts) and ignore the stored verdict there.
 */
export interface LessonEvidence {
  /** Ledger reference: a scenario id, an exercise receipt id, a field-failure id, or a source path/decision id. */
  ref: string;
  kind: LessonEvidenceKind;
  verdict: LessonEvidenceVerdict;
}

/**
 * How well a lesson's evidence holds up (ruling 5): see evidenceStrength in
 * utils/lesson-evidence.ts.
 *   none            no row resolves
 *   cited           only source citations resolve (no outcome)
 *   confounded-only derived outcomes exist, but every one is confounded
 *   contradicted    derived outcomes exist, but only hurt / no-effect (no helped)
 *   supported       at least one DERIVED `helped`
 */
export type EvidenceStrength = 'none' | 'cited' | 'confounded-only' | 'contradicted' | 'supported';

/**
 * Lesson evidence as stored on a NOTEBOOK entry (F6). Only the ref and kind are
 * carried from the journal; `verdict` is the verdict the LEDGER derived at
 * promotion, never the author's. Absent = a source citation (no outcome).
 * Rows that did not resolve at promotion are not stored.
 */
export interface StoredLessonEvidence {
  ref: string;
  kind: LessonEvidenceKind;
  verdict?: LessonEvidenceVerdict;
}

export interface NotebookEntry {
  /** Unique entry ID — stable deterministic format: nb-{agentId}-{conceptSlug} */
  id: string;
  /** Context description — when to apply this snippet */
  context: string;
  /**
   * Optional checkable cue: the SHAPE of situation the lesson applies to
   * (advisory). `context` stays the required, working field; `cue` sharpens it.
   */
  cue?: string;
  /**
   * Optional ledger-backed evidence for the lesson (advisory, never asserted
   * confidence): {ref, kind} plus the LEDGER-derived verdict at promotion.
   */
  evidence?: StoredLessonEvidence[];
  /** The reusable code/knowledge snippet */
  snippet: string;
  /** Where this entry came from */
  provenance: NotebookProvenance;
  /** Number of times this entry has been applied in orchestration */
  appliedCount: number;
  /**
   * The Classroom (TD-2026-06-19-007): number of times this entry was applied
   * AND the work it informed subsequently broke in the field (a `dismissed`/
   * `revised` verdict joined back by orchestrationId). Mirror of {@link appliedCount}
   * on the fail side. The repeat-failure-rate metric reads this. Default 0.
   */
  appliedAndBrokeCount?: number;
  /**
   * The Classroom: ISO timestamp of the most recent application receipt
   * (notebook-refs join). Drives the future decay pass — silence is signal.
   */
  lastAppliedAt?: string;
  /**
   * The Classroom: a field break is recorded as a REFINEMENT ("X except Y"),
   * not a raw decrement. The base claim survives; an exception is appended,
   * each traced to the failure that generated it. Phase 2 grows the engine;
   * MVP only seeds the structure when reviseDown fires.
   */
  refinement?: {
    /** The original claim, preserved verbatim. */
    base: string;
    /** Exceptions accrued from field breaks: "base EXCEPT when→then". */
    exceptions: { when: string; then: string; sourceFailureId: string }[];
    /** ISO timestamp of the latest revision. */
    revisedAt: string;
  };
  /** Confidence score 0.0-1.0 */
  confidence: number;
  /** Concept tags for retrieval (e.g., ["auth", "middleware", "jwt"]) */
  concepts: string[];
  /** Classification tags */
  tags: string[];
  /** ISO date of creation */
  created: string;
  /** ISO date of last update */
  updated: string;
  /**
   * Publishing scope — who this entry is safe to share with.
   * - 'generalizable': safe for any agent that installs this agent (default)
   * - 'project-specific': only relevant to the project where the entry was created; never published
   * - 'platform-specific': only relevant to Paradigm platform agents; published under @a-company only
   * Auto-classified at creation time.
   */
  scope?: NotebookScope;
  /**
   * Binary publish kill switch. Owner can set false to permanently exclude
   * an entry from publishing regardless of scope. Default: true.
   */
  publishable?: boolean;
  /**
   * Soft provenance: parent entry this was derived from.
   * No DAG validation is enforced — informational only.
   */
  parentId?: string;
  /**
   * How this entry relates to its parent.
   * - 'fix': corrects or supersedes the parent
   * - 'derive': derived from the parent with modifications
   * - 'capture': captures a new observation related to the parent
   * - 'promote': promoted from a lower-confidence form of the parent
   * - 'refine': revised as "X except Y" after a field break (The Classroom)
   */
  lineageType?: 'fix' | 'derive' | 'capture' | 'promote' | 'refine';
  /**
   * Where this entry lives (scoped learning): 'repo' = .paradigm/notebooks
   * (project), 'user' = ~/.paradigm/notebooks (global). Not the same axis as
   * `scope` (content class). Loaders tag it from the directory when absent.
   */
  home?: LearningHome;
  /**
   * S3: `explicit` when the human chose or confirmed `home`, `inferred`
   * otherwise. The commit guard refuses an inferred `human-taught` entry in a
   * public repository.
   */
  home_source?: HomeSource;
}

/**
 * Prepare a notebook entry for external publishing.
 * Uses scope + publishable fields (replaces old shareability logic).
 * Returns null if entry should not be published.
 */
export function prepareForPublish(entry: NotebookEntry): Omit<NotebookEntry, 'parentId' | 'lineageType'> | null {
  // Explicit kill switch
  if (entry.publishable === false) return null;
  // Project-specific entries never leave the project
  if (entry.scope === 'project-specific') return null;
  // Unscoped entries are assumed generalizable — safe to publish
  const { parentId: _parentId, lineageType: _lineageType, ...pub } = entry;
  return pub;
}

export interface NotebookProvenance {
  /**
   * Source type.
   * - 'external': The Classroom — a study-hall candidate staged from drilling the
   *   curriculum. NOT promoted; must be hard-excluded from prompt context until a
   *   gated class certifies it.
   */
  source: 'lore' | 'manual' | 'transfer' | 'external';
  /** Linked lore entry ID if promoted from lore */
  loreEntryId?: string;
  /** Project where first created */
  originProject?: string;
  /** Agent who created it */
  createdBy?: string;
  /**
   * The Classroom: trust tier of this entry.
   * - 'certified': promoted through the gated class.
   * - 'provisional': staged/in-loop, the default for live entries.
   * - 'external': un-promoted study-hall candidate (context-excluded).
   */
  trust?: 'certified' | 'provisional' | 'external';
  /**
   * The Classroom: the set of source refs (notebook ids, scenario ids, external
   * refs) this entry was distilled from. Informational; feeds syllabus lineage.
   */
  sourceSet?: string[];
}
