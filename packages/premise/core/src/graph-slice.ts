/**
 * #graph-slice-projector — Render-by-projection over the REAL symbol graph.
 *
 * Takes a symbol, projects a BOUNDED slice of the LIVE symbol graph, and emits a
 * deterministic, renderable payload. Shared by BOTH the `paradigm graph slice`
 * CLI command and the `paradigm_graph_slice` MCP tool — single source of truth,
 * no duplicated traversal.
 *
 * SOURCE OF TRUTH (the fix): neighbor/edge derivation comes from a LIVE
 * `SymbolIndex` built via `aggregateFromDirectory(rootDir)` + `buildSymbolIndex` —
 * the SAME live-parse pipeline `paradigm ripple` uses (see analyzeRipple in
 * packages/paradigm/src/commands/ripple.ts). We NO LONGER read the stale
 * scan-index `related[]` array or .paradigm/flow-index.json: those are
 * incomplete/stale (flow-index didn't even contain the conductor flows, so
 * `#cockpit-view`'s `$$fleet-switch` membership rendered BARE). A live parse
 * always sees the real edges, exactly like ripple does.
 *
 * Edges come from the UNION of the real edge sources the live index already
 * computes (modelled on analyzeRipple's downstream/upstream/partOfFlows):
 *   (a) getReferencesFrom(index, sym) → what this symbol references → `uses`
 *       (or `gated-by` when the target is a gate, `in-flow` when a flow);
 *   (b) getReferencesTo(index, sym)   → what references this symbol → `used-by`
 *       (so a symbol with empty references is never bare when something upstream
 *       depends on it — the #cockpit-view ⟵ $$fleet-switch case);
 *   (c) flow membership (findFlowMembership) → an `in-flow` edge to each $flow the
 *       symbol is a step of (handles the repo's double-prefix `$$flow` form);
 *   (d) flow co-members → (flow mode only) `uses` edges to sibling members.
 * The output is sorted deterministically (nodes by id, edges by
 * source+target+kind) so identical graphs serialize byte-identically.
 *
 * FRESHNESS: a live parse is the source of truth, so freshness.generatedAt is the
 * parse timestamp and stale is always false — the projector sidesteps the
 * scan-index serialization/determinism wart entirely.
 *
 * Library code: no console output here. Callers (CLI / MCP) do their own logging.
 */

import {
  aggregateFromDirectory,
  buildSymbolIndex,
  getSymbol,
  getReferencesTo,
  getReferencesFrom,
  getSymbolsByType,
  getAllSymbols,
  type SymbolEntry,
  type SymbolIndex,
} from './index.js';

// ────────────────────────────────────────────────────────
// Public contract
// ────────────────────────────────────────────────────────

export type SliceNodeKind = 'component' | 'flow' | 'gate' | 'signal' | 'aspect';
export type SliceEdgeKind = 'uses' | 'used-by' | 'in-flow' | 'gated-by';
export type SliceMode = 'ego' | 'ripple' | 'flow';

export interface GraphSliceNode {
  id: string; // canonical symbol string incl. prefix, e.g. "#cockpit-view"
  kind: SliceNodeKind;
  label: string; // human label (id stripped of prefix, or the node's name)
  path?: string;
}

export interface GraphSliceEdge {
  source: string;
  target: string;
  kind: SliceEdgeKind;
}

export interface GraphSliceFreshness {
  generatedAt: string | null; // live-parse timestamp (ISO)
  stale: boolean; // always false — a live parse is the source of truth
}

export interface GraphSlice {
  root: string;
  freshness: GraphSliceFreshness;
  nodes: GraphSliceNode[];
  edges: GraphSliceEdge[];
  truncated: boolean;
  didYouMean?: string[]; // present ONLY when the root symbol failed to resolve
}

export interface ProjectGraphSliceOptions {
  symbol: string;
  radius?: number; // default 1, capped at 3
  mode?: SliceMode; // default "ego"
}

// ────────────────────────────────────────────────────────
// Tunables
// ────────────────────────────────────────────────────────

const DEFAULT_RADIUS = 1;
const MAX_RADIUS = 3;
const DEGREE_CAP = 8; // visible neighbors per node before collapsing to "+N more"
const DID_YOU_MEAN_MAX = 5;

const PREFIX_TO_KIND: Record<string, SliceNodeKind> = {
  '#': 'component',
  $: 'flow',
  '^': 'gate',
  '!': 'signal',
  '~': 'aspect',
};

const TYPE_TO_KIND: Record<string, SliceNodeKind> = {
  component: 'component',
  flow: 'flow',
  gate: 'gate',
  signal: 'signal',
  aspect: 'aspect',
};

// ────────────────────────────────────────────────────────
// Live graph model (internal) — wraps a SymbolIndex
// ────────────────────────────────────────────────────────

/**
 * A LiveGraph is a thin, deterministic view over a live `SymbolIndex`. It exists
 * so the projector never touches the stale scan-index; resolution, neighbor
 * derivation, and did-you-mean all read the same in-memory index ripple reads.
 */
export interface LiveGraph {
  index: SymbolIndex;
  /** all known canonical symbol ids, for did-you-mean + resolution */
  allSymbols: string[];
  /** symbol -> set of $flow symbols it is a step of (from findFlowMembership) */
  symbolFlows: Map<string, Set<string>>;
  /** $flow symbol -> set of member symbols (its step symbols) */
  flowMembers: Map<string, Set<string>>;
  /** live-parse timestamp (ISO) */
  generatedAt: string;
}

/**
 * Build the LiveGraph from a project root via the SAME live-parse pipeline as
 * `paradigm ripple`: aggregateFromDirectory → buildSymbolIndex. Async because
 * aggregation reads the filesystem.
 *
 * Flow membership is precomputed exactly like ripple's findFlowMembership: a
 * flow's `data.sequence || data.gates || references` lists its member symbols.
 *
 * PERF: aggregateFromDirectory re-parses the whole project per call (the cost
 * ripple already pays). Acceptable for now. The MCP/cockpit-default path may want
 * a cached index later — don't build caching here.
 */
export async function loadLiveGraph(rootDir: string): Promise<LiveGraph> {
  const result = await aggregateFromDirectory(rootDir);
  const index = buildSymbolIndex(result);

  const allSymbols = getAllSymbols(index).map((e) => e.symbol);

  // Precompute flow membership in both directions so neighbor derivation is O(1).
  const symbolFlows = new Map<string, Set<string>>();
  const flowMembers = new Map<string, Set<string>>();
  for (const flow of getSymbolsByType(index, 'flow')) {
    const data = flow.data as { sequence?: string[]; gates?: string[] } | undefined;
    const sequence = data?.sequence || data?.gates || flow.references;
    if (!Array.isArray(sequence)) continue;
    for (const member of sequence) {
      if (typeof member !== 'string' || !member) continue;
      if (!symbolFlows.has(member)) symbolFlows.set(member, new Set());
      symbolFlows.get(member)!.add(flow.symbol);
      if (!flowMembers.has(flow.symbol)) flowMembers.set(flow.symbol, new Set());
      flowMembers.get(flow.symbol)!.add(member);
    }
  }

  return {
    index,
    allSymbols,
    symbolFlows,
    flowMembers,
    generatedAt: new Date().toISOString(),
  };
}

// ────────────────────────────────────────────────────────
// Projection
// ────────────────────────────────────────────────────────

/**
 * Project a bounded slice of the symbol graph centered on `symbol`.
 *
 * If the symbol does not resolve, returns a slice with `didYouMean` populated
 * and NO nodes/edges — callers must fail loud, never render a partial graph.
 */
export function projectGraphSlice(
  graph: LiveGraph,
  options: ProjectGraphSliceOptions,
): GraphSlice {
  const radius = clampRadius(options.radius);
  const mode: SliceMode = options.mode ?? 'ego';
  const rootSymbol = normalizeSymbol(options.symbol, graph);

  // A live parse is the source of truth: never stale, stamp the parse time.
  const freshness: GraphSliceFreshness = {
    generatedAt: graph.generatedAt,
    stale: false,
  };

  // ── Resolve or fail loud ────────────────────────────────
  if (!rootSymbol || !getSymbol(graph.index, rootSymbol)) {
    const didYouMean = nearestSymbols(options.symbol, graph.allSymbols);
    return {
      root: options.symbol,
      freshness,
      nodes: [],
      edges: [],
      truncated: false,
      didYouMean,
    };
  }

  // ── BFS over the UNIONED neighbor model to `radius` ─────
  const visited = new Set<string>([rootSymbol]);
  const includedNodes = new Set<string>([rootSymbol]);
  const edgeSet = new Map<string, GraphSliceEdge>(); // dedupe key -> edge
  const overflowCounts = new Map<string, number>();
  let truncated = false;

  let frontier: string[] = [rootSymbol];
  for (let depth = 0; depth < radius; depth++) {
    const nextFrontier: string[] = [];
    for (const sym of frontier) {
      // Unioned, deterministically-ordered, typed neighbor edges for this node.
      const neighbors = neighborsOf(sym, graph, mode);

      const visibleNeighbors = neighbors.slice(0, DEGREE_CAP);
      if (neighbors.length > DEGREE_CAP) {
        truncated = true;
        // Synthetic "+N more" collapse node — keeps the slice bounded but honest.
        const overflow = neighbors.length - DEGREE_CAP;
        const moreId = `${sym}::+more`;
        includedNodes.add(moreId);
        edgeSet.set(`${sym}|${moreId}|uses`, {
          source: sym,
          target: moreId,
          kind: 'uses',
        });
        overflowCounts.set(moreId, overflow);
      }

      for (const { target: neighbor, kind: edgeKind } of visibleNeighbors) {
        const dedupeKey = `${sym}|${neighbor}|${edgeKind}`;
        if (!edgeSet.has(dedupeKey)) {
          edgeSet.set(dedupeKey, { source: sym, target: neighbor, kind: edgeKind });
        }
        includedNodes.add(neighbor);
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          nextFrontier.push(neighbor);
        }
      }
    }
    frontier = nextFrontier;
    if (frontier.length === 0) break;
  }

  // ── Materialize nodes ───────────────────────────────────
  const nodes: GraphSliceNode[] = [];
  for (const sym of includedNodes) {
    if (overflowCounts.has(sym)) {
      nodes.push({
        id: sym,
        kind: 'component',
        label: `+${overflowCounts.get(sym)} more`,
      });
      continue;
    }
    const entry = getSymbol(graph.index, sym);
    const kind = symbolKind(sym, entry);
    nodes.push({
      id: sym,
      kind,
      label: nodeLabel(sym, entry),
      ...(entry?.filePath ? { path: entry.filePath } : {}),
    });
  }

  // ── Deterministic sort: nodes by id, edges by source+target+kind ────────
  nodes.sort((a, b) => a.id.localeCompare(b.id));
  const edges = Array.from(edgeSet.values()).sort((a, b) => {
    if (a.source !== b.source) return a.source.localeCompare(b.source);
    if (a.target !== b.target) return a.target.localeCompare(b.target);
    return a.kind.localeCompare(b.kind);
  });

  return {
    root: rootSymbol,
    freshness,
    nodes,
    edges,
    truncated,
  };
}

/**
 * Convenience: load + project in one call from a project root.
 * Async — performs a live parse, exactly like `paradigm ripple`.
 */
export async function graphSliceFromRoot(
  rootDir: string,
  options: ProjectGraphSliceOptions,
): Promise<GraphSlice> {
  const graph = await loadLiveGraph(rootDir);
  return projectGraphSlice(graph, options);
}

// ────────────────────────────────────────────────────────
// Mermaid projection (same slice → `graph LR`)
// ────────────────────────────────────────────────────────

/**
 * Render the SAME slice as a Mermaid `graph LR` block body (no fences).
 * Deterministic: nodes then edges, both already sorted by the projector.
 */
export function sliceToMermaid(slice: GraphSlice): string {
  const lines: string[] = ['graph LR'];
  const nodeAlias = new Map<string, string>();
  let counter = 0;
  for (const node of slice.nodes) {
    const alias = `n${counter++}`;
    nodeAlias.set(node.id, alias);
    const shape = mermaidShape(node.kind, node.id, node.label);
    lines.push(`  ${alias}${shape}`);
  }
  for (const edge of slice.edges) {
    const s = nodeAlias.get(edge.source);
    const t = nodeAlias.get(edge.target);
    if (!s || !t) continue;
    lines.push(`  ${s} -->|${edge.kind}| ${t}`);
  }
  return lines.join('\n');
}

// ────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────

function clampRadius(radius?: number): number {
  const r = typeof radius === 'number' && !Number.isNaN(radius) ? Math.floor(radius) : DEFAULT_RADIUS;
  return Math.min(Math.max(r, 1), MAX_RADIUS);
}

function stripPrefix(symbol: string): string {
  // Handle the repo's double-prefix flow form ("$$fleet-switch") as well as the
  // single-prefix forms; strip the whole prefix run so labels read cleanly.
  return symbol.replace(/^[#$^!~@%?&]{1,2}/, '');
}

function prefixOf(symbol: string): string {
  // The repo stores flow symbols double-prefixed ("$$fleet-switch"); collapse
  // the leading run to a single classifying prefix character.
  const m = /^[#$^!~]/.exec(symbol);
  return m ? m[0] : '';
}

/** Map a symbol + entry to its kind, preferring the live entry's type. */
function symbolKind(symbol: string, entry?: SymbolEntry): SliceNodeKind {
  if (entry?.type && TYPE_TO_KIND[entry.type]) return TYPE_TO_KIND[entry.type];
  const prefix = prefixOf(symbol);
  if (prefix && PREFIX_TO_KIND[prefix]) return PREFIX_TO_KIND[prefix];
  return 'component';
}

function nodeLabel(symbol: string, entry?: SymbolEntry): string {
  const data = entry?.data as { name?: string } | undefined;
  return data?.name || stripPrefix(symbol);
}

/**
 * Normalize an input symbol to a canonical key present in the live index.
 * Accepts: full symbol ("#foo"), bare id ("foo"), or differing-prefix guesses,
 * incl. the repo's double-prefix flow form ("$$foo").
 */
function normalizeSymbol(input: string, graph: LiveGraph): string | null {
  if (!input) return null;
  if (getSymbol(graph.index, input)) return input;

  const bare = stripPrefix(input);
  for (const prefix of ['#', '$', '$$', '^', '!', '~']) {
    const candidate = `${prefix}${bare}`;
    if (getSymbol(graph.index, candidate)) return candidate;
  }
  return null;
}

interface NeighborEdge {
  target: string;
  kind: SliceEdgeKind;
}

/**
 * The unioned neighbor model for a single node — the heart of the fix, sourced
 * entirely from the live `SymbolIndex` (the same edges ripple sees).
 *
 *   (a) getReferencesFrom → uses / gated-by / in-flow (what this references)
 *   (b) getReferencesTo   → used-by  (who references this; ripple's upstream)
 *   (c) flow membership   → in-flow edge to each $flow I'm a step of
 *   (d) flow co-members   → (flow mode only) uses edges to sibling members
 *
 * Modes change EMPHASIS, never honesty:
 *   - ego    (default): (a) ∪ (b) ∪ (c) — a rich, honest neighborhood.
 *   - ripple: (a) ∪ (b) ∪ (c) — dependency emphasis; the engine expands along
 *             these edges across the requested radius (flow nodes still surface).
 *   - flow:   (c) ∪ (d) — the symbol's flows and their other member symbols.
 *
 * Deduped to one edge per (target, kind), sorted (target, then kind) so the SAME
 * neighbors survive the degree cap and the serialization is byte-identical.
 */
function neighborsOf(sym: string, graph: LiveGraph, mode: SliceMode): NeighborEdge[] {
  const byKey = new Map<string, NeighborEdge>();
  const add = (target: string, kind: SliceEdgeKind) => {
    if (!target || target === sym) return;
    byKey.set(`${target}|${kind}`, { target, kind });
  };

  const wantDeps = mode === 'ego' || mode === 'ripple';

  if (wantDeps) {
    // (a) what this references → uses / gated-by / in-flow, typed by target kind.
    for (const ref of getReferencesFrom(graph.index, sym)) {
      add(ref.symbol, edgeKindForTarget(ref));
    }
    // (b) what references this → used-by (ripple's "Direct dependents").
    for (const ref of getReferencesTo(graph.index, sym)) {
      // A flow that lists this symbol as a step is an in-flow relationship, not
      // a plain dependent — keep it consistent with (c).
      if (kindOfEntry(ref) === 'flow' && (graph.symbolFlows.get(sym)?.has(ref.symbol) ?? false)) {
        add(ref.symbol, 'in-flow');
      } else {
        add(ref.symbol, 'used-by');
      }
    }
  } else {
    // flow mode: still surface flow targets reachable via references.
    for (const ref of getReferencesFrom(graph.index, sym)) {
      if (kindOfEntry(ref) === 'flow') add(ref.symbol, 'in-flow');
    }
  }

  // (c) flow membership — the #cockpit-view → $$fleet-switch edge. Surfaces in
  // every mode (a flow member must never render as if it had no flow).
  for (const flowSym of graph.symbolFlows.get(sym) || []) {
    add(flowSym, 'in-flow');
  }

  // (d) flow co-members — flow mode expands to sibling step symbols.
  if (mode === 'flow') {
    for (const flowSym of graph.symbolFlows.get(sym) || []) {
      for (const member of graph.flowMembers.get(flowSym) || []) {
        add(member, 'uses');
      }
    }
  }

  return Array.from(byKey.values()).sort((a, b) => {
    if (a.target !== b.target) return a.target.localeCompare(b.target);
    return a.kind.localeCompare(b.kind);
  });
}

function kindOfEntry(entry: SymbolEntry): SliceNodeKind {
  if (entry.type && TYPE_TO_KIND[entry.type]) return TYPE_TO_KIND[entry.type];
  return symbolKind(entry.symbol);
}

/**
 * Determine the edge kind for a referenced (downstream) target.
 * - target is a gate  → "gated-by"
 * - target is a flow  → "in-flow"
 * - default           → "uses"
 */
function edgeKindForTarget(target: SymbolEntry): SliceEdgeKind {
  const kind = kindOfEntry(target);
  if (kind === 'gate') return 'gated-by';
  if (kind === 'flow') return 'in-flow';
  return 'uses';
}

function nearestSymbols(query: string, candidates: string[]): string[] {
  const q = stripPrefix(query).toLowerCase();
  const scored: Array<{ sym: string; dist: number }> = [];
  for (const sym of candidates) {
    const bare = stripPrefix(sym).toLowerCase();
    if (bare === q) {
      scored.push({ sym, dist: 0 });
      continue;
    }
    if (bare.includes(q) || q.includes(bare)) {
      scored.push({ sym, dist: 1 });
      continue;
    }
    const dist = levenshtein(q, bare);
    if (dist <= 4) scored.push({ sym, dist });
  }
  scored.sort((a, b) => {
    if (a.dist !== b.dist) return a.dist - b.dist;
    return a.sym.localeCompare(b.sym);
  });
  return scored.slice(0, DID_YOU_MEAN_MAX).map((s) => s.sym);
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function mermaidShape(kind: SliceNodeKind, id: string, label: string): string {
  // Distinguish kinds visually: components rounded, flows stadium, gates hex,
  // signals trapezoid, aspects subroutine.
  const text = sanitizeLabel(`${prefixOf(id) || ''}${label}`);
  switch (kind) {
    case 'flow':
      return `([${text}])`;
    case 'gate':
      return `{{${text}}}`;
    case 'signal':
      return `[/${text}/]`;
    case 'aspect':
      return `[[${text}]]`;
    default:
      return `(${text})`;
  }
}

function sanitizeLabel(s: string): string {
  // Mermaid breaks on quotes/brackets inside node text; quote and escape.
  return `"${s.replace(/"/g, "'")}"`;
}
