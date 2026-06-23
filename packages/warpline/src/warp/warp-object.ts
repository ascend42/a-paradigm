/**
 * #warp-object — a WARP object: the content-addressed unit of MEANING.
 *
 * A WarpObject is a SymbolEntry stripped of its labels (name carried for
 * readability, but path/position/line/array-order DROPPED — that dropping IS
 * the thesis) and reduced to ⟨kind, contract, sorted edges, contentId⟩.
 *
 * Edges are derived from the LIVE SymbolIndex, modelled on the graph-slice
 * projector's `neighborsOf` but restricted to OUTGOING references (the essence
 * hashes edges once, from the source side). We reuse the SliceEdgeKind union
 * and the same edge-kind-by-target rule.
 *
 * Library code: no console output.
 */

import {
  getSymbol,
  getReferencesFrom,
  type SymbolEntry,
  type SymbolIndex,
  type SliceEdgeKind,
} from '@a-company/premise-core';

export type WarpEdgeKind = SliceEdgeKind; // 'uses' | 'used-by' | 'in-flow' | 'gated-by'

export interface WarpEdge {
  to: string; // target canonical symbol (incl. prefix)
  kind: WarpEdgeKind;
}

export interface WarpObject {
  symbol: string; // LABEL — the name, carried for readability, NOT hashed
  kind: SymbolEntry['type'];
  contract: Record<string, unknown>; // the raw parsed contract data (provenance)
  componentType?: string;
  parentSymbol?: string;
  description?: string; // LABEL — prose, carried not hashed
  tags: string[]; // sorted
  edges: WarpEdge[]; // sorted (to, kind), outgoing only
  /** stable cross-state key — SymbolEntry.id (survives rename) */
  stableKey: string;
  /** the essence content-address — set by the WarpState lifter */
  contentId: string;
  /** provenance: file the symbol was defined in (LABEL, not hashed) */
  filePath?: string;
}

/** Map a referenced (downstream) target to its edge kind. */
function edgeKindForTarget(target: SymbolEntry): WarpEdgeKind {
  if (target.type === 'gate') return 'gated-by';
  if (target.type === 'flow') return 'in-flow';
  return 'uses';
}

/**
 * Outgoing edges for a symbol, derived from the live index's `references`,
 * typed by target kind, deduped, and sorted (to, then kind). Outgoing only:
 * the essence hashes each edge once from the source side, and the inverse is
 * derivable. This is the single edge source both the WarpObject and the essence
 * hash agree on.
 */
export function liftEdges(index: SymbolIndex, symbol: string): WarpEdge[] {
  const byKey = new Map<string, WarpEdge>();
  for (const ref of getReferencesFrom(index, symbol)) {
    if (!ref.symbol || ref.symbol === symbol) continue;
    const edge: WarpEdge = { to: ref.symbol, kind: edgeKindForTarget(ref) };
    byKey.set(`${edge.to}|${edge.kind}`, edge);
  }
  return Array.from(byKey.values()).sort((a, b) =>
    a.to !== b.to ? (a.to < b.to ? -1 : 1) : a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0,
  );
}

/**
 * Lift a SymbolEntry to a WarpObject (without contentId — the WarpState lifter
 * fills contentId in after computing whole-state essences, since essence is
 * Merkle-by-target and needs the universe).
 */
export function liftToWarp(index: SymbolIndex, entry: SymbolEntry): WarpObject {
  const tags = Array.from(new Set(entry.tags ?? []))
    .map((t) => t.normalize('NFC'))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const obj: WarpObject = {
    symbol: entry.symbol,
    kind: entry.type,
    contract: (entry.data ?? {}) as Record<string, unknown>,
    tags,
    edges: liftEdges(index, entry.symbol),
    stableKey: entry.id,
    contentId: '', // filled by warp-state lift
  };
  if (entry.componentType) obj.componentType = entry.componentType;
  if (entry.parentSymbol) obj.parentSymbol = entry.parentSymbol;
  if (entry.description) obj.description = entry.description;
  if (entry.filePath) obj.filePath = entry.filePath;
  return obj;
}

/** Resolve a symbol to its entry, or undefined. (Re-export for callers.) */
export function entryOf(index: SymbolIndex, symbol: string): SymbolEntry | undefined {
  return getSymbol(index, symbol);
}
