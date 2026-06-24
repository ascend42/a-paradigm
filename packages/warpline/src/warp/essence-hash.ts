/**
 * #essence-hash — `essence(symbol) -> contentId`. The load-bearing wall.
 *
 * RULE: the hash moves IFF the meaning moves.
 *   - rename / move (name + path only) → SAME contentId
 *   - change a contract slot or an edge → NEW contentId
 *
 * The hash is over the Canonical Normal Form ⟨kind, contract, edgeBag⟩:
 *   - kind                : SymbolEntry.type
 *   - contract            : componentType + the typed .purpose contract slots
 *                           (gates/signals/aspects/states/steps/category/
 *                            severity/appliesTo/enforcement), normalized
 *   - edgeBag             : outgoing edges only, each reduced to
 *                           ⟨edgeKind, essence(target)⟩ — Merkle by TARGET
 *                           ESSENCE, not target name (so rename frees the chain)
 *
 * EXCLUDED (labels, carried as metadata, never hashed): symbol/id (name),
 * filePath (path), description (prose), created/modified, position,
 * referencedBy (derived inverse), anchors (byte-level file:line), tags
 * (aliasing tiebreaker only).
 *
 * Normalization: strip name/path; sort+dedupe every set; absent ≡ empty; prose
 * dropped; strict canonical JSON (sorted keys, NFC). `contentId =
 * "essence:v0:" + sha256(canonical)`. The `v0` tag lets the scheme evolve.
 *
 * Hard cases:
 *   - CYCLES: Tarjan SCC. A singleton non-cyclic node hashes its CNF directly.
 *     An SCC of size>1 hashes AS A UNIT — intra-SCC edges become an
 *     `@scc-internal` placeholder, out-of-SCC edges carry the real target
 *     essence; members ordered by their name-stripped local CNF; each member's
 *     contentId = "essence:v0:scc:" + sccHash + ":" + ordinal.
 *   - ALIASING: a RICH contract hashes purely structurally (a true match is a
 *     feature). A GENERIC contract (empty gates∧signals∧aspects∧edges ∧ no
 *     componentType) folds a stable disambiguator = SymbolEntry.id (the uuid,
 *     NOT the name — renames still don't move it).
 *   - DETERMINISM: source is the LIVE parse only (never scan-index); every set
 *     sorted; canonical serialization; no timestamps/paths/positions in bytes.
 *
 * Library code: no console output.
 */

import { createHash } from 'node:crypto';
import {
  getSymbol,
  type SymbolEntry,
  type SymbolIndex,
} from '@a-company/premise-core';
import { canonicalSerialize, type CanonicalValue } from './canonical.js';
import { liftEdges, type WarpEdge } from './warp-object.js';

export const ESSENCE_VERSION = 'v0';
const SCC_INTERNAL = '@scc-internal';
const CODE_UNIT_TYPE = 'code-unit';

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/** Is this entry a synthetic code-unit (lifted by a code-lens, spec §2)? */
function isCodeUnit(entry: SymbolEntry): boolean {
  return entry.componentType === CODE_UNIT_TYPE;
}

/**
 * The essence VERSION-TAG for an entry. `.purpose` symbols stay `v0`; code-units
 * carry the compiler-pinned tag the lens stamped onto `entry.data.essenceTag`
 * (`v1:ts<exact>`, spec §5.2). The tag is read off `data` so `essence-hash.ts`
 * never imports the lens — the tag travels WITH the node. Mixed graphs work
 * because a Merkle edge substitutes the target's full TAGGED contentId string.
 */
function essenceTagOf(entry: SymbolEntry): string {
  if (isCodeUnit(entry)) {
    const data = (entry.data ?? {}) as Record<string, unknown>;
    const tag = data.essenceTag;
    if (typeof tag === 'string' && tag.length > 0) return tag;
  }
  return ESSENCE_VERSION;
}

// ────────────────────────────────────────────────────────
// The normalized contract (identity-bearing slots only)
// ────────────────────────────────────────────────────────

/**
 * Pull the typed contract slots out of a SymbolEntry's parsed `data` + the
 * promoted top-level fields. Everything here is identity-bearing; prose/labels
 * are excluded. Each list is sorted + deduped; absent ≡ empty.
 */
function normalizedContract(entry: SymbolEntry): CanonicalValue {
  const data = (entry.data ?? {}) as Record<string, unknown>;

  const contract: Record<string, CanonicalValue> = {
    // componentType is identity-bearing (a retype IS a meaning change).
    componentType: (entry.componentType ?? '').normalize('NFC'),
    gates: sortedStrings(data.gates),
    signals: sortedStrings(data.signals),
    aspects: sortedStrings(data.aspects),
    states: sortedStrings(data.states),
    // Flow steps: order is meaning for a flow, but we key on the component each
    // step touches + its action so a pure prose edit doesn't move the hash.
    steps: normalizedSteps(data.steps),
    category: str(data.category),
    severity: str(data.severity),
    // Aspect-specific structured slots.
    appliesTo: sortedStrings(data['applies-to'] ?? entry.appliesTo),
    enforcement: str(data.enforcement ?? entry.enforcement),
  };

  return contract;
}

/**
 * True when the contract is GENERIC — empty gates∧signals∧aspects, no
 * componentType, AND the node has no outgoing edges. Per spec, generic nodes
 * fold a stable disambiguator so two coincidentally-identical stubs don't
 * collide; rich nodes match structurally on purpose.
 */
function isGenericContract(entry: SymbolEntry, edges: WarpEdge[]): boolean {
  const data = (entry.data ?? {}) as Record<string, unknown>;
  const empty = (v: unknown) => !Array.isArray(v) || v.length === 0;
  return (
    empty(data.gates) &&
    empty(data.signals) &&
    empty(data.aspects) &&
    empty(data.states) &&
    empty(data.steps) &&
    !data.category &&
    !data.severity &&
    !data['applies-to'] &&
    !(entry.appliesTo && entry.appliesTo.length) &&
    !data.enforcement &&
    !entry.enforcement &&
    !entry.componentType &&
    edges.length === 0
  );
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.normalize('NFC') : '';
}

function sortedStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out = v
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.normalize('NFC'));
  return Array.from(new Set(out)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Normalize flow steps to ⟨component, action⟩ pairs, preserving step ORDER
 * (a flow's sequence is meaning) but dropping prose `description`.
 */
function normalizedSteps(v: unknown): CanonicalValue {
  if (!Array.isArray(v)) return [];
  const steps: CanonicalValue[] = [];
  for (const raw of v) {
    if (raw && typeof raw === 'object') {
      const s = raw as Record<string, unknown>;
      steps.push({
        component: str(s.component ?? s.symbol),
        action: str(s.action),
      });
    } else if (typeof raw === 'string') {
      steps.push({ component: raw.normalize('NFC'), action: '' });
    }
  }
  return steps;
}

// ────────────────────────────────────────────────────────
// Tarjan SCC over the outgoing-reference graph
// ────────────────────────────────────────────────────────

interface EssenceGraph {
  /** symbol → its SymbolEntry */
  entryOf: Map<string, SymbolEntry>;
  /** symbol → sorted outgoing WarpEdges (uses/used-by/in-flow/gated-by) */
  edgesOf: Map<string, WarpEdge[]>;
  /** symbol → sorted outgoing target symbols (uses for SCC: structural deps) */
  adj: Map<string, string[]>;
}

function buildEssenceGraph(index: SymbolIndex, symbols: string[]): EssenceGraph {
  const entryOf = new Map<string, SymbolEntry>();
  const edgesOf = new Map<string, WarpEdge[]>();
  const adj = new Map<string, string[]>();
  const known = new Set(symbols);

  for (const sym of symbols) {
    const entry = getSymbol(index, sym);
    if (!entry) continue;
    entryOf.set(sym, entry);
    const edges = liftEdges(index, sym);
    edgesOf.set(sym, edges);
    // SCC adjacency: only edges whose target is a known node in this state.
    const targets = edges
      .map((e) => e.to)
      .filter((t) => known.has(t) && t !== sym);
    adj.set(sym, Array.from(new Set(targets)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  }
  return { entryOf, edgesOf, adj };
}

/** Iterative Tarjan → array of SCCs (each a set of symbols). */
function tarjanSCCs(graph: EssenceGraph): string[][] {
  const indexMap = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];
  let counter = 0;

  // Deterministic node order so SCC discovery order is stable.
  const nodes = Array.from(graph.adj.keys()).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  for (const start of nodes) {
    if (indexMap.has(start)) continue;
    // Explicit stack frames: { node, childIdx }.
    const work: Array<{ node: string; childIdx: number }> = [{ node: start, childIdx: 0 }];
    while (work.length > 0) {
      const frame = work[work.length - 1];
      const v = frame.node;
      if (frame.childIdx === 0) {
        indexMap.set(v, counter);
        lowlink.set(v, counter);
        counter++;
        stack.push(v);
        onStack.add(v);
      }
      const children = graph.adj.get(v) ?? [];
      if (frame.childIdx < children.length) {
        const w = children[frame.childIdx];
        frame.childIdx++;
        if (!indexMap.has(w)) {
          work.push({ node: w, childIdx: 0 });
        } else if (onStack.has(w)) {
          lowlink.set(v, Math.min(lowlink.get(v)!, indexMap.get(w)!));
        }
      } else {
        // Done with v's children — fold child lowlinks, maybe pop an SCC.
        work.pop();
        if (work.length > 0) {
          const parent = work[work.length - 1].node;
          lowlink.set(parent, Math.min(lowlink.get(parent)!, lowlink.get(v)!));
        }
        if (lowlink.get(v) === indexMap.get(v)) {
          const scc: string[] = [];
          let w: string;
          do {
            w = stack.pop()!;
            onStack.delete(w);
            scc.push(w);
          } while (w !== v);
          sccs.push(scc.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
        }
      }
    }
  }
  return sccs;
}

// ────────────────────────────────────────────────────────
// The essence computation (whole-state, memoized)
// ────────────────────────────────────────────────────────

export interface EssenceResult {
  /** symbol → contentId */
  contentIds: Map<string, string>;
}

/**
 * Compute the contentId of every symbol in `symbols` (the WarpState's universe),
 * resolving Merkle-by-target-essence and SCC units. Single pass over the graph;
 * memoized; deterministic.
 */
export function computeEssences(index: SymbolIndex, symbols: string[]): EssenceResult {
  const graph = buildEssenceGraph(index, symbols);
  const sccs = tarjanSCCs(graph);

  // Map each symbol to its SCC representative + the member set.
  const sccOf = new Map<string, Set<string>>();
  for (const scc of sccs) {
    const set = new Set(scc);
    for (const m of scc) sccOf.set(m, set);
  }

  const contentIds = new Map<string, string>();
  const computing = new Set<string>(); // cycle guard for non-SCC recursion safety

  // Essence of a single node's CNF given a resolver for its (out-of-unit) edges.
  const localCNF = (
    sym: string,
    edgeEssence: (e: WarpEdge) => string,
  ): CanonicalValue => {
    const entry = graph.entryOf.get(sym)!;
    const edges = graph.edgesOf.get(sym) ?? [];

    // ── Code-unit branch (spec §4.1) ────────────────────────────────────────
    // A code-unit's identity is its BODY with local refs substituted INLINE,
    // positionally — NOT a sorted edge-set. The body's U+001F-anchored `f:N` token is the N-th
    // LOCAL reference (first-appearance order); we replace it with the essence
    // of `codeLocalTargets[N]`'s edge — which resolves via the SAME `edgeEssence`
    // resolver the rest of the algorithm passes in (so intra-SCC targets become
    // `@scc-internal` automatically, and cross-rename frees the chain). extern/
    // builtin/unresolved refs are already `free:name` tokens in the body string
    // and are left untouched. The edgeBag is empty (refs are inline in the body).
    if (isCodeUnit(entry)) {
      const data = (entry.data ?? {}) as Record<string, unknown>;
      const rawTargets = data.codeLocalTargets;
      const localTargets = Array.isArray(rawTargets)
        ? rawTargets.filter((t): t is string => typeof t === 'string')
        : [];
      // target symbol → its resolved edge essence (via the shared resolver).
      const targetEssence = new Map<string, string>();
      for (const e of edges) {
        if (!targetEssence.has(e.to)) targetEssence.set(e.to, edgeEssence(e));
      }
      // The slot token is U+001F-anchored (see ts-essence freeRefToken). The
      // sentinel makes it unforgeable by literal payload — str:/tmpl: text is
      // JSON.stringify'd, escaping all control chars — so a string literal that
      // reads "f:0" is NOT matched here. (T-2026-06-24-003)
      const body = String(data.codeEssence ?? '').replace(/\u001Ff:(\d+)/g, (_m, n: string) => {
        const idx = Number(n);
        const target = localTargets[idx];
        if (target === undefined) return `\u001Ff:${n}`; // alignment gap — leave as-is
        const ess = targetEssence.get(target);
        return ess !== undefined ? ess : `essence:${ESSENCE_VERSION}:extern:${sha256(target)}`;
      });
      return {
        kind: entry.type,
        contract: normalizedContract(entry),
        body,
        edgeBag: [],
      };
    }

    const edgeBag = edges
      .map((e) => ({ edgeKind: e.kind, targetEssence: edgeEssence(e) }))
      // sort+dedupe the bag by (edgeKind, targetEssence)
      .sort((a, b) =>
        a.edgeKind !== b.edgeKind
          ? a.edgeKind < b.edgeKind
            ? -1
            : 1
          : a.targetEssence < b.targetEssence
            ? -1
            : a.targetEssence > b.targetEssence
              ? 1
              : 0,
      );
    const dedupedBag: CanonicalValue[] = [];
    let prev = '';
    for (const e of edgeBag) {
      const key = `${e.edgeKind} ${e.targetEssence}`;
      if (key === prev) continue;
      prev = key;
      dedupedBag.push({ edgeKind: e.edgeKind, targetEssence: e.targetEssence });
    }
    const cnf: Record<string, CanonicalValue> = {
      kind: entry.type,
      contract: normalizedContract(entry),
      edgeBag: dedupedBag,
    };
    // Aliasing: generic contracts fold the stable id (uuid, not name).
    if (isGenericContract(entry, edges)) {
      cnf.generic = entry.id.normalize('NFC');
    }
    return cnf;
  };

  const essenceOf = (sym: string): string => {
    const cached = contentIds.get(sym);
    if (cached) return cached;

    const unit = sccOf.get(sym);
    if (unit && unit.size > 1) {
      hashSCC(unit);
      return contentIds.get(sym)!;
    }

    // Singleton (possibly a 1-node self-loop SCC — treat as singleton). Resolve
    // edges via target essence; a self/forward cycle that isn't an SCC>1 can't
    // exist, but guard recursion anyway.
    if (computing.has(sym)) {
      // Defensive: a cycle not caught as SCC>1 — fall back to placeholder so we
      // never infinite-loop. (Shouldn't happen given Tarjan.)
      return `${SCC_INTERNAL}`;
    }
    computing.add(sym);
    const cnf = localCNF(sym, (e) =>
      contentIds.has(e.to) || graph.entryOf.has(e.to)
        ? essenceOf(e.to)
        : `essence:${ESSENCE_VERSION}:extern:${sha256(e.to)}`,
    );
    computing.delete(sym);
    const tag = essenceTagOf(graph.entryOf.get(sym)!);
    const id = `essence:${tag}:${sha256(canonicalSerialize(cnf))}`;
    contentIds.set(sym, id);
    return id;
  };

  const hashSCC = (unit: Set<string>): void => {
    const members = Array.from(unit);
    // Resolver: intra-unit edges → placeholder; out-of-unit edges → real essence.
    const edgeEssence = (e: WarpEdge): string =>
      unit.has(e.to) ? SCC_INTERNAL : essenceOf(e.to);
    // Build each member's local CNF, then order members by their name-stripped
    // canonical CNF so the unit hash is independent of symbol naming.
    const memberCNFs = members.map((m) => ({
      sym: m,
      cnf: localCNF(m, edgeEssence),
      serialized: canonicalSerialize(localCNF(m, edgeEssence)),
    }));
    memberCNFs.sort((a, b) => (a.serialized < b.serialized ? -1 : a.serialized > b.serialized ? 1 : 0));
    const unitSerialized = canonicalSerialize(memberCNFs.map((m) => m.cnf as CanonicalValue));
    const sccHash = sha256(unitSerialized);
    memberCNFs.forEach((m, ordinal) => {
      // Per-member version tag: a code-level SCC carries `v1:ts...`, a `.purpose`
      // SCC stays `v0`. (A mixed SCC can't form — code→component edges are one-way.)
      const tag = essenceTagOf(graph.entryOf.get(m.sym)!);
      contentIds.set(m.sym, `essence:${tag}:scc:${sccHash}:${ordinal}`);
    });
  };

  for (const sym of symbols) essenceOf(sym);
  return { contentIds };
}

/**
 * Convenience: the contentId of a single symbol within `index`, computing the
 * whole reachable state. For repeated calls over the same state, prefer
 * `computeEssences` once and read the map.
 */
export function essenceOfSymbol(index: SymbolIndex, symbol: string, universe: string[]): string {
  const { contentIds } = computeEssences(index, universe);
  return contentIds.get(symbol) ?? `essence:${ESSENCE_VERSION}:missing:${sha256(symbol)}`;
}
