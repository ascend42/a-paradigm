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
   */
  lineageType?: 'fix' | 'derive' | 'capture' | 'promote';
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
  /** Source type */
  source: 'lore' | 'manual' | 'transfer';
  /** Linked lore entry ID if promoted from lore */
  loreEntryId?: string;
  /** Project where first created */
  originProject?: string;
  /** Agent who created it */
  createdBy?: string;
}
