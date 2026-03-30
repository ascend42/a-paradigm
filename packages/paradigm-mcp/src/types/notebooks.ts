/**
 * Agent Notebook Types — curated snippet libraries distilled from lore
 *
 * Storage:
 *   ~/.paradigm/notebooks/{agent-id}/nb-{concept}.yaml   (global)
 *   .paradigm/notebooks/{agent-id}/nb-{concept}.yaml     (project)
 */

export interface NotebookEntry {
  /** Unique entry ID (e.g., "nb-auth-pattern-001") */
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
   * Shareability scope — controls what publish boundaries this entry can cross.
   * - 'public': safe for external sharing (sensitive fields stripped before export)
   * - 'team': shared within the team's projects (default)
   * - 'private': only for the agent that created it
   */
  shareability?: 'public' | 'team' | 'private';
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
 *
 * Strips sensitive fields before any external sharing:
 * - For 'public' shareability: removes parentId and lineageType
 * - For 'team' or 'private' shareability: returns null (must not publish)
 */
export function prepareForPublish(entry: NotebookEntry): Omit<NotebookEntry, 'parentId' | 'lineageType'> | null {
  if (entry.shareability === 'private') return null;
  if (entry.shareability !== 'public') return null; // 'team' and undefined default to non-publishable externally

  // Strip provenance-tracking fields from public exports
  const { parentId: _parentId, lineageType: _lineageType, ...publishable } = entry;
  return publishable;
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
