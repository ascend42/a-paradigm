/**
 * Aspect Graph MCP Tools — Query, search, and inspect the aspect graph
 *
 * Provides 7 tools for interacting with the aspect graph SQLite database:
 * - paradigm_aspect_search: Three-tier learning search over aspects
 * - paradigm_aspect_get: Get full detail for a single aspect
 * - paradigm_aspect_graph: BFS traversal to visualize aspect neighborhoods
 * - paradigm_aspect_heatmap: View most-accessed aspects
 * - paradigm_aspect_suggest_scan: Auto-suggest aspects from source code
 * - paradigm_aspect_drift: Detect code anchor drift
 * - paradigm_aspect_confirm: Reinforce search learning from user selection
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ProjectContext } from '../utils/index-loader.js';
import {
  openAspectGraph,
  closeAspectGraph,
  getAspect,
  getAnchorsForAspect,
  getEdgesFrom,
  getEdgesTo,
  getAllEdgesFor,
  incrementHeatmap,
  getHeatmap,
  checkDrift,
  type Database,
} from '../utils/aspect-graph.js';
import { searchAspects, confirmSearch } from '../utils/aspect-search.js';
import { getLoreForAspect } from '../utils/aspect-lore-bridge.js';
import type {
  AspectRow,
  AnchorRow,
  HeatmapAccessType,
} from '../types/aspect-graph.js';
import { trackToolCall } from './context.js';

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Get the list of aspect graph tool definitions.
 */
export function getAspectGraphToolsList() {
  return [
    {
      name: 'paradigm_aspect_search',
      description:
        'Search aspects using three-tier learning search (learned mappings > FTS5 > fuzzy). Returns ranked results. Call paradigm_aspect_confirm after selecting a result to improve future searches. ~200 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query (natural language or keyword, e.g., "token expiry", "pricing rule")',
          },
          limit: {
            type: 'number',
            description: 'Maximum results to return (default: 10)',
          },
        },
        required: ['query'],
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_aspect_get',
      description:
        'Get full detail for a single aspect: description, category, severity, code anchors with snippets, edges, and linked lore entries. ~300 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          aspectId: {
            type: 'string',
            description: 'Aspect identifier without ~ prefix (e.g., "token-expiry-24h")',
          },
        },
        required: ['aspectId'],
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_aspect_graph',
      description:
        'Traverse the aspect graph from a symbol to visualize its neighborhood. Returns nodes and edges within N hops (BFS). Useful for understanding how aspects relate to each other. ~300 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            description: 'Starting symbol for graph traversal (e.g., "~token-expiry-24h", "#auth-service")',
          },
          hops: {
            type: 'number',
            description: 'Maximum number of hops to traverse (default: 2, max: 5)',
          },
        },
        required: ['symbol'],
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_aspect_heatmap',
      description:
        'View the most frequently accessed aspects, ranked by total access count. Shows which aspects are queried most often. ~150 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Maximum entries to return (default: 20)',
          },
          accessType: {
            type: 'string',
            enum: ['search', 'ripple', 'navigate', 'direct'],
            description: 'Optional: filter by access type',
          },
        },
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_aspect_suggest_scan',
      description:
        'Scan a source file for implicit aspects (magic numbers, hardcoded limits, configuration values) and suggest aspect definitions. ~200 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'Relative or absolute path to the source file to scan',
          },
        },
        required: ['filePath'],
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_aspect_drift',
      description:
        'Smart drift detection for code anchors. Layer 1: normalized hash (ignores formatting). Layer 2: git-aware line mapping (detects shifts, auto-heals .purpose files). ~200 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          aspectId: {
            type: 'string',
            description: 'Optional: check a specific aspect. If omitted, checks all aspects.',
          },
          autoHeal: {
            type: 'boolean',
            description: 'Auto-update anchors for high-confidence shifts (default: true)',
          },
        },
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_aspect_confirm',
      description:
        'Confirm a search result to improve future search accuracy. Call this after the user selects or uses a result from paradigm_aspect_search. Reinforces the query-to-aspect mapping. ~50 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The original search query used',
          },
          aspectId: {
            type: 'string',
            description: 'The aspect ID that was selected/confirmed',
          },
        },
        required: ['query', 'aspectId'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
  ];
}

// ============================================================================
// Tool Handler
// ============================================================================

/**
 * Handle aspect graph tool calls.
 *
 * @param name - Tool name
 * @param args - Tool arguments
 * @param ctx - Project context
 * @returns { handled: boolean; text: string }
 */
export async function handleAspectGraphTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ProjectContext,
): Promise<{ handled: boolean; text: string }> {
  switch (name) {
    case 'paradigm_aspect_search':
      return handleAspectSearch(args, ctx);

    case 'paradigm_aspect_get':
      return handleAspectGet(args, ctx);

    case 'paradigm_aspect_graph':
      return handleAspectGraphTraversal(args, ctx);

    case 'paradigm_aspect_heatmap':
      return handleAspectHeatmap(args, ctx);

    case 'paradigm_aspect_suggest_scan':
      return handleAspectSuggestScan(args, ctx);

    case 'paradigm_aspect_drift':
      return handleAspectDrift(args, ctx);

    case 'paradigm_aspect_confirm':
      return handleAspectConfirm(args, ctx);

    default:
      return { handled: false, text: '' };
  }
}

// ============================================================================
// Individual Tool Handlers
// ============================================================================

/**
 * paradigm_aspect_search — Three-tier learning search over aspects
 */
async function handleAspectSearch(
  args: Record<string, unknown>,
  ctx: ProjectContext,
): Promise<{ handled: boolean; text: string }> {
  const { query, limit = 10 } = args as { query: string; limit?: number };

  let db: Database | null = null;
  try {
    db = await openAspectGraph(ctx.rootDir);

    const results = searchAspects(db, query, { limit: limit as number });

    // Increment heatmap for each result returned
    for (const result of results) {
      try {
        incrementHeatmap(db, result.id, 'search');
      } catch {
        // Best-effort heatmap tracking
      }
    }

    const response = {
      query,
      count: results.length,
      results: results.map((r) => ({
        id: r.id,
        description: r.description,
        category: r.category,
        severity: r.severity,
        score: Math.round(r.score * 1000) / 1000,
        tier: r.tier,
        tags: r.tags,
        anchorCount: r.anchorCount,
      })),
      tip: results.length > 0
        ? 'Call paradigm_aspect_confirm with the query and selected aspectId to improve future searches.'
        : 'No results found. Try broader terms or check that aspects are defined in .purpose files.',
    };

    const text = JSON.stringify(response, null, 2);
    closeAspectGraph(db, ctx.rootDir);
    db = null;

    trackToolCall(text.length, 'paradigm_aspect_search');
    return { handled: true, text };
  } catch (err) {
    if (db) {
      try { closeAspectGraph(db); } catch { /* ignore close errors */ }
    }
    const text = JSON.stringify({
      error: 'Failed to search aspects',
      details: String(err),
      suggestion: 'Run `paradigm scan` to rebuild the aspect graph database.',
    }, null, 2);
    trackToolCall(text.length, 'paradigm_aspect_search');
    return { handled: true, text };
  }
}

/**
 * paradigm_aspect_get — Full detail for a single aspect
 */
async function handleAspectGet(
  args: Record<string, unknown>,
  ctx: ProjectContext,
): Promise<{ handled: boolean; text: string }> {
  const { aspectId } = args as { aspectId: string };

  // Normalize: strip ~ prefix if provided
  const normalizedId = aspectId.startsWith('~') ? aspectId.slice(1) : aspectId;

  let db: Database | null = null;
  try {
    db = await openAspectGraph(ctx.rootDir);

    // Try both with and without the ~ prefix
    let aspect: AspectRow | null = getAspect(db, normalizedId);
    if (!aspect) {
      aspect = getAspect(db, `~${normalizedId}`);
    }

    if (!aspect) {
      closeAspectGraph(db);
      db = null;
      const text = JSON.stringify({
        error: 'Aspect not found',
        aspectId: normalizedId,
        suggestion: 'Use paradigm_aspect_search to find aspects by keyword.',
      }, null, 2);
      trackToolCall(text.length, 'paradigm_aspect_get');
      return { handled: true, text };
    }

    const effectiveId = aspect.id;

    // Get anchors with code snippets
    const anchors = getAnchorsForAspect(db, effectiveId);
    const anchorDetails = anchors.map((anchor) => {
      const snippet = readAnchorSnippet(ctx.rootDir, anchor);
      return {
        filePath: anchor.file_path,
        startLine: anchor.start_line,
        endLine: anchor.end_line,
        drifted: anchor.drifted === 1,
        snippet,
      };
    });

    // Get edges
    const edgesFrom = getEdgesFrom(db, effectiveId);
    const edgesTo = getEdgesTo(db, effectiveId);
    const edges = [
      ...edgesFrom.map((e) => ({
        direction: 'outgoing' as const,
        source: e.source,
        target: e.target,
        relation: e.relation,
        weight: e.weight,
        origin: e.origin,
      })),
      ...edgesTo.map((e) => ({
        direction: 'incoming' as const,
        source: e.source,
        target: e.target,
        relation: e.relation,
        weight: e.weight,
        origin: e.origin,
      })),
    ];

    // Get lore summaries
    let lore: Array<{ id: string; title?: string; summary?: string; timestamp?: string; symbolsTouched?: string[] }> = [];
    try {
      lore = await getLoreForAspect(db, ctx.rootDir, effectiveId);
    } catch {
      // Lore loading is best-effort
    }

    // Increment heatmap
    try {
      incrementHeatmap(db, effectiveId, 'direct');
    } catch {
      // Best-effort
    }

    // Parse tags
    let tags: string[] | undefined;
    if (aspect.tags) {
      try {
        const parsed = JSON.parse(aspect.tags);
        if (Array.isArray(parsed)) tags = parsed;
      } catch {
        tags = aspect.tags.split(',').map((t) => t.trim()).filter((t) => t.length > 0);
      }
    }

    const response = {
      id: effectiveId,
      description: aspect.description,
      category: aspect.category,
      severity: aspect.severity,
      value: aspect.value,
      enforcement: aspect.enforcement,
      definedIn: aspect.defined_in,
      tags,
      createdAt: aspect.created_at,
      updatedAt: aspect.updated_at,
      anchors: anchorDetails,
      edges,
      lore,
    };

    const text = JSON.stringify(response, null, 2);
    closeAspectGraph(db, ctx.rootDir);
    db = null;

    trackToolCall(text.length, 'paradigm_aspect_get');
    return { handled: true, text };
  } catch (err) {
    if (db) {
      try { closeAspectGraph(db); } catch { /* ignore */ }
    }
    const text = JSON.stringify({
      error: 'Failed to get aspect',
      details: String(err),
      suggestion: 'Run `paradigm scan` to rebuild the aspect graph database.',
    }, null, 2);
    trackToolCall(text.length, 'paradigm_aspect_get');
    return { handled: true, text };
  }
}

/**
 * paradigm_aspect_graph — BFS traversal from a symbol
 */
async function handleAspectGraphTraversal(
  args: Record<string, unknown>,
  ctx: ProjectContext,
): Promise<{ handled: boolean; text: string }> {
  const { symbol, hops = 2 } = args as { symbol: string; hops?: number };
  const maxHops = Math.min(Math.max(hops, 1), 5);

  let db: Database | null = null;
  try {
    db = await openAspectGraph(ctx.rootDir);

    // BFS traversal collecting nodes and edges
    const visited = new Set<string>();
    const nodeMap = new Map<string, { aspectId: string; category?: string; severity?: string; depth: number }>();
    const collectedEdges: Array<{ source: string; target: string; relation: string; weight: number }> = [];

    interface QueueItem {
      symbol: string;
      depth: number;
    }

    const queue: QueueItem[] = [{ symbol, depth: 0 }];
    visited.add(symbol);

    // Add the starting node
    const startAspect = getAspect(db, symbol);
    nodeMap.set(symbol, {
      aspectId: symbol,
      category: startAspect?.category,
      severity: startAspect?.severity,
      depth: 0,
    });

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.depth >= maxHops) continue;

      const edges = getAllEdgesFor(db, current.symbol);

      for (const edge of edges) {
        const neighbor = edge.source === current.symbol ? edge.target : edge.source;

        // Collect the edge regardless of whether we visited the neighbor
        const alreadyHasEdge = collectedEdges.some(
          (e) => e.source === edge.source && e.target === edge.target && e.relation === edge.relation,
        );
        if (!alreadyHasEdge) {
          collectedEdges.push({
            source: edge.source,
            target: edge.target,
            relation: edge.relation,
            weight: edge.weight,
          });
        }

        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          const neighborAspect = getAspect(db, neighbor);
          nodeMap.set(neighbor, {
            aspectId: neighbor,
            category: neighborAspect?.category,
            severity: neighborAspect?.severity,
            depth: current.depth + 1,
          });
          queue.push({ symbol: neighbor, depth: current.depth + 1 });
        }
      }
    }

    const nodes = Array.from(nodeMap.values());

    const response = {
      startSymbol: symbol,
      maxHops,
      nodeCount: nodes.length,
      edgeCount: collectedEdges.length,
      nodes,
      edges: collectedEdges,
    };

    const text = JSON.stringify(response, null, 2);
    closeAspectGraph(db);
    db = null;

    trackToolCall(text.length, 'paradigm_aspect_graph');
    return { handled: true, text };
  } catch (err) {
    if (db) {
      try { closeAspectGraph(db); } catch { /* ignore */ }
    }
    const text = JSON.stringify({
      error: 'Failed to traverse aspect graph',
      details: String(err),
      suggestion: 'Run `paradigm scan` to rebuild the aspect graph database.',
    }, null, 2);
    trackToolCall(text.length, 'paradigm_aspect_graph');
    return { handled: true, text };
  }
}

/**
 * paradigm_aspect_heatmap — View most-accessed aspects
 */
async function handleAspectHeatmap(
  args: Record<string, unknown>,
  ctx: ProjectContext,
): Promise<{ handled: boolean; text: string }> {
  const { limit = 20, accessType } = args as { limit?: number; accessType?: string };

  let db: Database | null = null;
  try {
    db = await openAspectGraph(ctx.rootDir);

    const rawRows = getHeatmap(db, (limit as number) * 4, accessType);

    // Aggregate rows by aspect_id since getHeatmap returns per access_type
    const aggregated = new Map<string, {
      aspectId: string;
      description?: string;
      totalCount: number;
      byType: Partial<Record<HeatmapAccessType, number>>;
      lastAccessed: string;
    }>();

    for (const row of rawRows) {
      let entry = aggregated.get(row.aspect_id);
      if (!entry) {
        // Look up the aspect for its description
        const aspect = getAspect(db, row.aspect_id);
        entry = {
          aspectId: row.aspect_id,
          description: aspect?.description,
          totalCount: 0,
          byType: {},
          lastAccessed: row.last_accessed,
        };
        aggregated.set(row.aspect_id, entry);
      }

      entry.totalCount += row.count;
      entry.byType[row.access_type as HeatmapAccessType] = row.count;

      // Track the most recent access
      if (row.last_accessed > entry.lastAccessed) {
        entry.lastAccessed = row.last_accessed;
      }
    }

    // Sort by totalCount descending and apply limit
    const sorted = Array.from(aggregated.values())
      .sort((a, b) => b.totalCount - a.totalCount)
      .slice(0, limit as number);

    const response = {
      count: sorted.length,
      ...(accessType ? { filteredBy: accessType } : {}),
      entries: sorted,
    };

    const text = JSON.stringify(response, null, 2);
    closeAspectGraph(db);
    db = null;

    trackToolCall(text.length, 'paradigm_aspect_heatmap');
    return { handled: true, text };
  } catch (err) {
    if (db) {
      try { closeAspectGraph(db); } catch { /* ignore */ }
    }
    const text = JSON.stringify({
      error: 'Failed to get aspect heatmap',
      details: String(err),
      suggestion: 'Run `paradigm scan` to rebuild the aspect graph database.',
    }, null, 2);
    trackToolCall(text.length, 'paradigm_aspect_heatmap');
    return { handled: true, text };
  }
}

/**
 * paradigm_aspect_suggest_scan — Auto-suggest aspects from source code
 */
async function handleAspectSuggestScan(
  args: Record<string, unknown>,
  ctx: ProjectContext,
): Promise<{ handled: boolean; text: string }> {
  const { filePath } = args as { filePath: string };

  // Resolve the file path
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(ctx.rootDir, filePath);

  if (!fs.existsSync(absolutePath)) {
    const text = JSON.stringify({
      error: 'File not found',
      filePath: absolutePath,
      suggestion: 'Provide a valid relative or absolute file path.',
    }, null, 2);
    trackToolCall(text.length, 'paradigm_aspect_suggest_scan');
    return { handled: true, text };
  }

  try {
    // Dynamic import of the suggest module (may not exist yet)
    // Use a variable to prevent TypeScript from statically resolving the module
    const modulePath = '../utils/aspect-suggest.js';
    const suggestModule = await import(/* webpackIgnore: true */ modulePath);
    const suggestions = suggestModule.suggestAspects(absolutePath);

    const response = {
      filePath: absolutePath,
      count: suggestions.length,
      suggestions: suggestions.map((s: {
        line: number;
        code: string;
        suggestedName: string;
        suggestedCategory: string;
        suggestedDescription?: string;
        confidence: string;
        reason: string;
      }) => ({
        line: s.line,
        code: s.code,
        suggestedName: s.suggestedName,
        category: s.suggestedCategory,
        description: s.suggestedDescription,
        confidence: s.confidence,
        reason: s.reason,
      })),
      tip: suggestions.length > 0
        ? 'Review suggestions and add confirmed aspects to your .purpose files with ~ prefix and code anchors.'
        : 'No implicit aspects detected in this file.',
    };

    const text = JSON.stringify(response, null, 2);
    trackToolCall(text.length, 'paradigm_aspect_suggest_scan');
    return { handled: true, text };
  } catch (err) {
    const errMsg = String(err);

    // If the module does not exist yet, return a clear message
    if (errMsg.includes('Cannot find module') || errMsg.includes('MODULE_NOT_FOUND')) {
      const text = JSON.stringify({
        error: 'Aspect suggestion engine not available',
        details: 'The aspect-suggest utility has not been implemented yet.',
        suggestion: 'This feature will be available in a future release. For now, manually identify implicit aspects in your code.',
      }, null, 2);
      trackToolCall(text.length, 'paradigm_aspect_suggest_scan');
      return { handled: true, text };
    }

    const text = JSON.stringify({
      error: 'Failed to scan for aspect suggestions',
      details: errMsg,
    }, null, 2);
    trackToolCall(text.length, 'paradigm_aspect_suggest_scan');
    return { handled: true, text };
  }
}

/**
 * paradigm_aspect_drift — Detect code anchor drift
 */
async function handleAspectDrift(
  args: Record<string, unknown>,
  ctx: ProjectContext,
): Promise<{ handled: boolean; text: string }> {
  const { aspectId, autoHeal: autoHealArg } = args as { aspectId?: string; autoHeal?: boolean };
  const autoHeal = autoHealArg !== false; // default true

  // Normalize: strip ~ prefix if provided
  const normalizedId = aspectId
    ? (aspectId.startsWith('~') ? aspectId.slice(1) : aspectId)
    : undefined;

  let db: Database | null = null;
  try {
    db = await openAspectGraph(ctx.rootDir);

    const results = checkDrift(db, ctx.rootDir, normalizedId, autoHeal);

    const cleanCount = results.filter((r) => r.status === 'clean').length;
    const cosmeticCount = results.filter((r) => r.status === 'cosmetic').length;
    const shiftedCount = results.filter((r) => r.status === 'shifted').length;
    const modifiedCount = results.filter((r) => r.status === 'modified').length;
    const missingCount = results.filter((r) => r.status === 'missing').length;

    const hasIssues = modifiedCount > 0 || missingCount > 0;
    const hasHeals = cosmeticCount > 0 || shiftedCount > 0;
    const overallStatus = hasIssues
      ? 'drift-detected'
      : (hasHeals ? 'clean-with-heals' : 'clean');

    const response = {
      ...(normalizedId ? { aspectId: normalizedId } : { scope: 'all' }),
      totalAnchors: results.length,
      clean: cleanCount,
      cosmetic: cosmeticCount,
      shifted: shiftedCount,
      modified: modifiedCount,
      missing: missingCount,
      status: overallStatus,
      results: results.map((r) => ({
        aspectId: r.aspectId,
        path: r.path,
        startLine: r.startLine,
        endLine: r.endLine,
        status: r.status,
        resolvedBy: r.resolvedBy,
        exists: r.exists,
        // Include shift details for shifted anchors
        ...(r.status === 'shifted'
          ? { suggestedStart: r.suggestedStart, suggestedEnd: r.suggestedEnd, autoHealed: r.autoHealed }
          : {}),
        // Include current content only for modified anchors (truncated)
        ...(r.status === 'modified' && r.currentContent
          ? { currentContent: r.currentContent.slice(0, 500) }
          : {}),
      })),
      ...(cosmeticCount > 0 || shiftedCount > 0
        ? {
            healed: [
              cosmeticCount > 0 ? `${cosmeticCount} cosmetic (whitespace/formatting — hashes updated)` : '',
              shiftedCount > 0 ? `${shiftedCount} shifted (line numbers updated via git diff${autoHeal ? ' — .purpose files patched' : ''})` : '',
            ].filter(Boolean).join(', '),
          }
        : {}),
      ...(hasIssues
        ? {
            suggestion: 'Review drifted anchors to ensure aspects still apply. Run `paradigm scan` to re-materialize after fixing.',
          }
        : {}),
    };

    const text = JSON.stringify(response, null, 2);
    closeAspectGraph(db, ctx.rootDir);
    db = null;

    trackToolCall(text.length, 'paradigm_aspect_drift');
    return { handled: true, text };
  } catch (err) {
    if (db) {
      try { closeAspectGraph(db); } catch { /* ignore */ }
    }
    const text = JSON.stringify({
      error: 'Failed to check aspect drift',
      details: String(err),
      suggestion: 'Run `paradigm scan` to rebuild the aspect graph database.',
    }, null, 2);
    trackToolCall(text.length, 'paradigm_aspect_drift');
    return { handled: true, text };
  }
}

/**
 * paradigm_aspect_confirm — Reinforce search learning
 */
async function handleAspectConfirm(
  args: Record<string, unknown>,
  ctx: ProjectContext,
): Promise<{ handled: boolean; text: string }> {
  const { query, aspectId } = args as { query: string; aspectId: string };

  let db: Database | null = null;
  try {
    db = await openAspectGraph(ctx.rootDir);

    confirmSearch(db, query, aspectId);

    const response = {
      confirmed: true,
      query,
      aspectId,
      message: `Search mapping reinforced: "${query}" -> ${aspectId}. Future searches for similar queries will rank this aspect higher.`,
    };

    const text = JSON.stringify(response, null, 2);
    closeAspectGraph(db, ctx.rootDir);
    db = null;

    trackToolCall(text.length, 'paradigm_aspect_confirm');
    return { handled: true, text };
  } catch (err) {
    if (db) {
      try { closeAspectGraph(db); } catch { /* ignore */ }
    }
    const text = JSON.stringify({
      error: 'Failed to confirm search',
      details: String(err),
    }, null, 2);
    trackToolCall(text.length, 'paradigm_aspect_confirm');
    return { handled: true, text };
  }
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Read a code snippet from a file at the anchor's line range.
 * Returns the content lines or a placeholder if the file cannot be read.
 */
function readAnchorSnippet(rootDir: string, anchor: AnchorRow): string | null {
  const absolutePath = path.isAbsolute(anchor.file_path)
    ? anchor.file_path
    : path.join(rootDir, anchor.file_path);

  if (!fs.existsSync(absolutePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(absolutePath, 'utf8');
    const lines = content.split('\n');
    const startIdx = Math.max(0, anchor.start_line - 1);
    const endIdx = Math.min(lines.length, anchor.end_line);
    const snippet = lines.slice(startIdx, endIdx).join('\n');

    // Truncate very long snippets to avoid bloating responses
    if (snippet.length > 1000) {
      return snippet.slice(0, 1000) + '\n... (truncated)';
    }

    return snippet;
  } catch {
    return null;
  }
}
