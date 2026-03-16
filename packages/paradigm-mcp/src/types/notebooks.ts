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
