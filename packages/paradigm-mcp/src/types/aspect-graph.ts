/**
 * Types for the Aspect Graph system (v3.5)
 *
 * These types are internal to the MCP server — the graph DB query/traversal layer.
 * Core aspect types (AspectRelation, AspectEdge, etc.) live in premise-core.
 */

import type { AspectRelation, AspectSeverity, AspectCategory } from '@a-company/premise-core';

// ============================================
// Graph Traversal
// ============================================

/** A node in the recursive ripple traversal */
export interface RippleNode {
  /** Symbol identifier */
  symbol: string;
  /** Depth from the start symbol */
  depth: number;
  /** Full path from root to this node */
  path: string[];
  /** Relation from parent node */
  relation: string;
  /** Accumulated weight (product of edge weights along path) */
  weight: number;
  /** Aspects attached to this symbol */
  aspects: string[];
  /** Anchors for this node's aspects */
  anchors?: Array<{ path: string; startLine: number; endLine: number; aspect: string }>;
}

/** Full ripple result with graph, aspects, and lore */
export interface RippleResult {
  /** The starting symbol */
  symbol: string;
  /** Maximum depth reached */
  depth: number;
  /** Overall impact level */
  impact: 'low' | 'medium' | 'high' | 'critical';
  /** Graph traversal nodes */
  graph: RippleNode[];
  /** All aspects found in the cascade */
  cascadeAspects: string[];
  /** Lore entries linked to affected aspects */
  lore: Array<{ id: string; title?: string; summary?: string }>;
  /** All anchors from affected aspects */
  anchors: Array<{ path: string; startLine: number; endLine: number; aspect: string }>;
}

// ============================================
// Search
// ============================================

/** A search result from the aspect search engine */
export interface AspectSearchResult {
  /** Aspect symbol (e.g., "~token-expiry-24h") */
  id: string;
  /** Description */
  description: string;
  /** Category */
  category?: AspectCategory;
  /** Severity */
  severity?: AspectSeverity;
  /** Search relevance score (higher = more relevant) */
  score: number;
  /** Which search tier matched (1=learned, 2=fts, 3=fuzzy) */
  tier: 1 | 2 | 3;
  /** Tags */
  tags?: string[];
  /** Anchor count */
  anchorCount: number;
}

// ============================================
// Auto-Suggestion
// ============================================

/** A suggested aspect from the auto-suggestion engine */
export interface AspectSuggestion {
  /** Line number in the source file */
  line: number;
  /** The code at that line */
  code: string;
  /** Suggested aspect name (without ~ prefix) */
  suggestedName: string;
  /** Suggested category */
  suggestedCategory: AspectCategory;
  /** Generated description */
  suggestedDescription: string;
  /** Confidence level */
  confidence: 'low' | 'medium' | 'high';
  /** Why this was flagged */
  reason: string;
}

// ============================================
// Heatmap
// ============================================

/** Access type for heatmap tracking */
export type HeatmapAccessType = 'search' | 'ripple' | 'navigate' | 'direct';

/** A heatmap entry showing aspect access frequency */
export interface HeatmapEntry {
  /** Aspect symbol */
  aspectId: string;
  /** Description */
  description?: string;
  /** Total access count across all types */
  totalCount: number;
  /** Breakdown by access type */
  byType: Partial<Record<HeatmapAccessType, number>>;
  /** Last accessed timestamp */
  lastAccessed: string;
}

// ============================================
// Drift Detection
// ============================================

/** Result of checking an anchor for content drift */
export interface DriftResult {
  /** Aspect symbol */
  aspectId: string;
  /** File path */
  path: string;
  /** Line range */
  startLine: number;
  endLine: number;
  /** Whether the content has drifted */
  drifted: boolean;
  /** Whether the file still exists */
  exists: boolean;
  /** Current content (if drifted) */
  currentContent?: string;
}

// ============================================
// Database Row Types (internal)
// ============================================

/** Raw aspect row from SQLite */
export interface AspectRow {
  id: string;
  description: string;
  category: string;
  severity: string;
  value: string | null;
  enforcement: string | null;
  defined_in: string;
  tags: string | null;
  created_at: string;
  updated_at: string;
}

/** Raw anchor row from SQLite */
export interface AnchorRow {
  id: number;
  aspect_id: string;
  file_path: string;
  start_line: number;
  end_line: number;
  content_hash: string | null;
  last_verified: string | null;
  drifted: number;
}

/** Raw edge row from SQLite */
export interface EdgeRow {
  id: number;
  source: string;
  target: string;
  relation: string;
  weight: number;
  origin: string;
  created_at: string;
}

/** Raw search weight row from SQLite */
export interface SearchWeightRow {
  query_normalized: string;
  aspect_id: string;
  weight: number;
  hit_count: number;
  last_hit: string;
}

/** Raw heatmap row from SQLite */
export interface HeatmapRow {
  aspect_id: string;
  access_type: string;
  count: number;
  last_accessed: string;
}
