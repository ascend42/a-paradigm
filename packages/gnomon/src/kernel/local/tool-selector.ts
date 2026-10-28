/**
 * @symbol #tool-selector
 *
 * #tool-selector (TD-2026-10-27-833 slice C3', design G2/G3): which narrow tools a local session is offered at a step.
 * It replaces the C2' fixed offer (kernel verbs, then narrow tools in index order while they fit). One PURE,
 * deterministic function: the same state gives the same selection (G-LCL-20). No embeddings, no clock, no randomness.
 *
 *   SCORE     BM25 (k1 1.2, b 0.75) over each candidate's document: its name (counted twice), its description and its
 *             narrow param names, tokenised the same way as the query (lower case, split on non-alphanumerics and
 *             camelCase, stop words dropped, a tiny suffix stemmer: recovery/recovered/recovering → recover).
 *   QUERY     the caller's: the working-memory Goal, the latest user or steer text, the last tool error, and a
 *             find_tool `need` (each bounded by the caller; at most QUERY_MAX_TERMS distinct terms are scored).
 *   ORDER     priority, then budget. Human pins first (always, while they fit), then STICKY tools (called in the
 *             last two steps), then FOUND tools (a find_tool need's top matches, ranked: they replace the bottom of
 *             the set), then every candidate with a positive score (score desc, ties by id), then the rest in index
 *             order. Walking that order, a candidate is taken while the set stays under K and its compact-surface
 *             tokens fit the ledger's tools slot after the fixed tools (kernel verbs and find_tool).
 *   OUTPUT    the taken entries in INDEX order (so an unchanged membership is an unchanged native tools array and
 *             llama.cpp's prompt cache holds), the found matches that were taken, and a hash of the selected ids.
 *
 * Candidates the selector never takes: human-only entries, reserved names (the child's natives, the memory tools,
 * find_tool), the gnomon_ prefix, a name already taken by a fixed tool or by an earlier candidate (first in index order
 * wins), a name `bound` to another server this session (no rebinding), and whatever `allow` refuses (a manual session
 * passes read-class only). Selection only decides what is OFFERED: a mutate or destructive tool it offers still raises
 * its card at call time (#local-tool-broker), and a tool it does not offer is refused by the child and the broker.
 */
import { createHash } from 'node:crypto';
import { compactSurfaceTokens, MAX_OFFERED, toolsSlotTokens, type CapabilityEntry } from './capability-index.js';

/** The fields of a capability entry the selector reads. */
export type SelectableEntry = Pick<CapabilityEntry, 'id' | 'name' | 'description' | 'parameters' | 'humanOnly' | 'server'>;
type Surface = Pick<CapabilityEntry, 'name' | 'description' | 'parameters'>;

/** At most this many narrow tools are selected (until C4' derives K from the tier; the tools slot binds first at ~8k). */
export const SELECT_K = 24;
/** A tool called in the last this-many steps stays selected. */
export const STICKY_STEPS = 2;
/** Re-select every this-many steps (and on a goal change, a steer, a find_tool); never every step (prompt caching). */
export const RESELECT_EVERY_STEPS = 4;
/** find_tool answers with at most this many tools. */
export const FIND_TOOL_MAX_RESULTS = 5;
/** find_tool calls per turn (a run of the model on one prompt). */
export const FIND_TOOL_PER_TURN = 3;
/** The longest find_tool need (chars, before cleaning). */
export const FIND_TOOL_NEED_MAX = 200;
/** The longest piece of query text the kernel takes from one source (goal, user/steer text, tool error). */
export const QUERY_PART_MAX = 600;
/** Distinct query terms scored (a long goal cannot make scoring expensive). */
export const QUERY_MAX_TERMS = 64;

export const FIND_TOOL_NAME = 'find_tool';
/**
 * The find_tool spec the child offers (gnomon-local find-tool.ts FIND_TOOL, kept in step by a test). Class read: its
 * effect is the next step's offer, never the workspace; the kernel answers it and no card is raised.
 */
export const FIND_TOOL_SPEC = Object.freeze({
  name: FIND_TOOL_NAME,
  description: 'Find a tool for a need none of your tools fits. Describe the need in a few words; up to 5 matching tools become callable from your next step.',
  parameters: Object.freeze({ type: 'object', properties: Object.freeze({ need: Object.freeze({ type: 'string', maxLength: FIND_TOOL_NEED_MAX, description: 'what you need a tool for, in a few words' }) }), required: Object.freeze(['need']), additionalProperties: false }),
  class: 'read' as const,
});

const K1 = 1.2;
const B = 0.75;
const STOP = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'for', 'from', 'i', 'in', 'into', 'is', 'it', 'its', 'me', 'my', 'of', 'on', 'or', 'please', 'should', 'so', 'that', 'the', 'then', 'this', 'to', 'use', 'we', 'with', 'you', 'your']);

/** A tiny, deterministic suffix stemmer (one rule, longest first). */
export function stem(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  if (w.length > 4 && w.endsWith('y')) return w.slice(0, -1);
  return w;
}

/** Text → terms: camelCase split, lower case, ASCII alphanumerics, stop words dropped, stemmed. */
export function tokenize(text: string): string[] {
  const spaced = text.normalize('NFKC').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  const out: string[] = [];
  for (const raw of spaced.split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || STOP.has(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

/** The document BM25 scores for one entry: its name twice, its description, its narrow param names. */
function docTerms(e: SelectableEntry): string[] {
  const props = e.parameters && typeof e.parameters.properties === 'object' && e.parameters.properties !== null ? Object.keys(e.parameters.properties) : [];
  const name = tokenize(e.name);
  return [...name, ...name, ...tokenize(e.description), ...tokenize(props.join(' '))];
}

/** BM25 scores of `docs` for `query` (distinct query terms, at most QUERY_MAX_TERMS, in first-seen order). */
export function bm25(docs: readonly string[][], query: readonly string[]): number[] {
  const terms = [...new Set(query)].slice(0, QUERY_MAX_TERMS);
  const n = docs.length;
  if (!n || !terms.length) return docs.map(() => 0);
  const avg = docs.reduce((a, d) => a + d.length, 0) / n || 1;
  const tf = docs.map((d) => {
    const m = new Map<string, number>();
    for (const t of d) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  });
  const idf = new Map<string, number>();
  for (const t of terms) {
    const df = tf.reduce((a, m) => a + (m.has(t) ? 1 : 0), 0);
    // a term every document holds (one server's shared name prefix, e.g. `paradigm`) tells nothing apart: not scored,
    // so the rest keeps index order instead of a length-driven order
    idf.set(t, n > 1 && df === n ? 0 : Math.log(1 + (n - df + 0.5) / (df + 0.5)));
  }
  return docs.map((d, i) => {
    let s = 0;
    for (const t of terms) {
      const f = tf[i]!.get(t) ?? 0;
      if (!f) continue;
      s += idf.get(t)! * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.length) / avg)));
    }
    // rounded so float noise can never reorder equal scores (ties then break by id)
    return Math.round(s * 1e9) / 1e9;
  });
}

export interface SelectInput<T extends SelectableEntry> {
  /** every narrow entry of the session's servers, in index order (servers in compose order, Paradigm first) */
  entries: readonly T[];
  /** the tools offered before any narrow tool (kernel verbs, find_tool): they take the slot first */
  fixed: readonly Surface[];
  /** the query text (goal + latest user/steer text + last tool error), already bounded by the caller */
  query: string;
  /** a find_tool need (bounded, cleaned) */
  need?: string;
  /** names to keep (called in the last STICKY_STEPS steps) */
  sticky?: readonly string[];
  /** names a find_tool found earlier and still in force */
  found?: readonly string[];
  /** human pins (names) */
  pins?: readonly string[];
  contextTarget: number;
  /** names the session already holds (the child's natives, memory tools, find_tool) */
  reserved?: readonly string[];
  /** name → server bound earlier in this session (a name never rebinds to another server) */
  bound?: ReadonlyMap<string, string>;
  /** a candidate filter (a manual session: read-class only) */
  allow?: (e: T) => boolean;
  /** at most this many narrow tools (default SELECT_K) */
  k?: number;
}

export interface Selection<T extends SelectableEntry> {
  /** the selected entries, in index order */
  selected: T[];
  /** the need's matches (score > 0, best first, at most FIND_TOOL_MAX_RESULTS) that were selected */
  found: T[];
  /** pins that did not fit the slot (or are not candidates) */
  unfit: string[];
  /** candidates with a positive query score, best first (ids and scores; diagnostics and tests) */
  ranked: Array<{ id: string; name: string; score: number }>;
  /** sha256 of the selected ids in order */
  hash: string;
}

/** The candidates in index order: offerable, unreserved, unbound elsewhere, allowed, first name wins. */
export function candidatesOf<T extends SelectableEntry>(i: Pick<SelectInput<T>, 'entries' | 'fixed' | 'reserved' | 'bound' | 'allow'>): T[] {
  const taken = new Set([...(i.reserved ?? []), ...i.fixed.map((f) => f.name)]);
  const seen = new Set<string>();
  const out: T[] = [];
  for (const e of i.entries) {
    // Aegis L3 (C2'): a server tool never takes a kernel verb's name or the gnomon_ prefix
    if (e.humanOnly || taken.has(e.name) || /^gnomon_/i.test(e.name) || seen.has(e.name)) continue;
    const b = i.bound?.get(e.name);
    if (b !== undefined && b !== e.server) continue;
    if (i.allow && !i.allow(e)) continue;
    seen.add(e.name);
    out.push(e);
  }
  return out;
}

const byScore = (a: { score: number; id: string }, b: { score: number; id: string }): number => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The selection for one state (the module comment). Pure: the same input gives the same output. */
export function selectTools<T extends SelectableEntry>(i: SelectInput<T>): Selection<T> {
  const cands = candidatesOf(i);
  const index = new Map(cands.map((e, n) => [e, n]));
  const byName = new Map(cands.map((e) => [e.name, e]));
  const docs = cands.map(docTerms);
  const scores = bm25(docs, tokenize(i.query));
  const ranked = cands.map((e, n) => ({ e, id: e.id, score: scores[n]! })).filter((x) => x.score > 0).sort(byScore);
  const needRanked = i.need ? bm25(docs, tokenize(i.need)).map((score, n) => ({ e: cands[n]!, id: cands[n]!.id, score })).filter((x) => x.score > 0).sort(byScore).slice(0, FIND_TOOL_MAX_RESULTS) : [];
  const inIndex = (names: readonly string[] | undefined): T[] => [...new Set(names ?? [])].map((n) => byName.get(n)).filter((e): e is T => e !== undefined).sort((a, b) => index.get(a)! - index.get(b)!);
  const pins = inIndex(i.pins);
  const order: T[] = [...pins, ...inIndex(i.sticky), ...needRanked.map((x) => x.e), ...inIndex(i.found), ...ranked.map((x) => x.e), ...cands];
  const k = Math.max(0, Math.min(i.k ?? SELECT_K, MAX_OFFERED - i.fixed.length));
  const slot = toolsSlotTokens(i.contextTarget);
  let used = compactSurfaceTokens(i.fixed);
  const chosen = new Set<T>();
  for (const e of order) {
    if (chosen.has(e) || chosen.size >= k) continue;
    const cost = compactSurfaceTokens([e]);
    if (used + cost > slot) continue;
    used += cost;
    chosen.add(e);
  }
  const selected = cands.filter((e) => chosen.has(e));
  const unfit = [...new Set(i.pins ?? [])].filter((n) => { const e = byName.get(n); return e === undefined || !chosen.has(e); });
  return {
    selected,
    found: needRanked.map((x) => x.e).filter((e) => chosen.has(e)),
    unfit,
    ranked: ranked.map((x) => ({ id: x.id, name: x.e.name, score: x.score })),
    hash: createHash('sha256').update(selected.map((e) => e.id).join('\n')).digest('hex'),
  };
}

/** The find_tool answer: one line per found tool (name, class, description), or a hint when nothing matched. */
export function findToolAnswer(found: ReadonlyArray<Pick<CapabilityEntry, 'name' | 'description' | 'class'>>): string {
  if (!found.length) return 'No tool matched that need. Try other words, or do it with the tools you have.';
  const lines = found.slice(0, FIND_TOOL_MAX_RESULTS).map((e) => `- ${e.name}: ${e.description.split('\n')[0]!.slice(0, 120)}${e.class === 'read' ? '' : ` (${e.class}: asks the human first)`}`);
  return ['Callable from your next step:', ...lines].join('\n');
}
