/**
 * Agent Notebook Types — curated snippet libraries distilled from lore
 *
 * Storage:
 *   ~/.paradigm/notebooks/{agent-id}/nb-{concept}.yaml   (global)
 *   .paradigm/notebooks/{agent-id}/nb-{concept}.yaml     (project)
 *
 * Schema is co-owned with @a-company/agent-format (source of truth for publish contract).
 * Keep these fields in sync with packages/agent-format/src/notebook.ts in a-neverland.
 */

/**
 * Publishing scope — controls which audiences can receive this entry.
 * Matches the enum in @a-company/agent-format.
 */
export type NotebookScope = 'generalizable' | 'project-specific' | 'platform-specific';

export interface NotebookEntry {
  /** Unique entry ID — stable deterministic format: nb-{agentId}-{conceptSlug} */
  id: string;
  /** Context description — when to apply this snippet */
  context: string;
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
   * - 'platform-specific': only relevant to Paradigm/nevr.land platform agents; published under @a-company only
   * Auto-classified at creation time. Owner can override via `nevr notebook audit`.
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
