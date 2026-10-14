/**
 * Unified Symbol Index
 *
 * Central registry of all symbols across Purpose, Gate, and Dream sources
 */

import {
  PREFIX_TO_TYPE,
  SYMBOL_PREFIXES,
  LEGACY_PREFIX_TO_TYPE,
  isValidPrefix,
  isLegacyPrefix,
  type SymbolEntry,
  type SymbolSource,
  type SymbolType,
  type LegacySymbolType,
  type SourceType,
  type SymbolIndex,
  type AggregationResult,
  type CodeAnchor,
} from './types.js';

/**
 * Create a new empty symbol index
 */
export function createSymbolIndex(): SymbolIndex {
  return {
    entries: new Map(),
    byType: new Map(),
    bySource: new Map(),
    bySymbol: new Map(),
    byNameLower: new Map(),
    timestamp: 0,
  };
}

/** Lower-cased bare name (prefix stripped) — the byNameLower key. */
function nameKey(symbol: string): string {
  return symbol.slice(1).toLowerCase();
}

/**
 * Wire one entry into bySymbol/byNameLower. bySymbol is first-wins so a
 * lookup returns the same entry the historical linear scan over `entries`
 * did; canonicalized aggregations have one entry per symbol anyway.
 */
function indexSymbolKeys(index: SymbolIndex, entry: SymbolEntry): void {
  if (!index.bySymbol.has(entry.symbol)) {
    index.bySymbol.set(entry.symbol, entry);
  }
  const key = nameKey(entry.symbol);
  const list = index.byNameLower.get(key);
  if (list) list.push(entry);
  else index.byNameLower.set(key, [entry]);
}

/** Replace `prev` with `next` in a list in place, or append `next`. */
function replaceOrPush(list: SymbolEntry[], prev: SymbolEntry | undefined, next: SymbolEntry): void {
  const i = prev ? list.indexOf(prev) : -1;
  if (i >= 0) list[i] = next;
  else list.push(next);
}

/** Remove `entry` from a list in place (no-op when absent). */
function removeFrom(list: SymbolEntry[] | undefined, entry: SymbolEntry): void {
  if (!list) return;
  const i = list.indexOf(entry);
  if (i >= 0) list.splice(i, 1);
}

/**
 * Add (or replace, keyed by id) one entry, keeping every secondary map —
 * byType, bySource, bySymbol, byNameLower — consistent. Use this instead of
 * `entries.set` when splicing synthetic entries into a built index.
 */
export function addSymbolEntry(index: SymbolIndex, entry: SymbolEntry): void {
  const prev = index.entries.get(entry.id);
  index.entries.set(entry.id, entry);

  if (prev && prev.type !== entry.type) removeFrom(index.byType.get(prev.type), prev);
  const byType = index.byType.get(entry.type);
  if (byType) replaceOrPush(byType, prev && prev.type === entry.type ? prev : undefined, entry);
  else index.byType.set(entry.type, [entry]);

  if (prev && prev.source !== entry.source) removeFrom(index.bySource.get(prev.source), prev);
  const bySource = index.bySource.get(entry.source);
  if (bySource) replaceOrPush(bySource, prev && prev.source === entry.source ? prev : undefined, entry);
  else index.bySource.set(entry.source, [entry]);

  if (prev) {
    removeFrom(index.byNameLower.get(nameKey(prev.symbol)), prev);
    if (index.bySymbol.get(prev.symbol) === prev) {
      index.bySymbol.delete(prev.symbol);
      if (prev.symbol === entry.symbol) {
        // Same slot: the replacement keeps the replaced entry's precedence.
        index.bySymbol.set(entry.symbol, entry);
      } else {
        // Fall back to the next entry still carrying the old symbol, if any.
        for (const e of index.entries.values()) {
          if (e.symbol === prev.symbol && e !== entry) {
            index.bySymbol.set(prev.symbol, e);
            break;
          }
        }
      }
    }
  }
  indexSymbolKeys(index, entry);
}

/**
 * Build a symbol index from aggregation results
 */
export function buildSymbolIndex(result: AggregationResult): SymbolIndex {
  const index = createSymbolIndex();
  index.timestamp = result.timestamp;

  for (const symbol of result.symbols) {
    // Add to main entries
    index.entries.set(symbol.id, symbol);

    // Add to byType
    if (!index.byType.has(symbol.type)) {
      index.byType.set(symbol.type, []);
    }
    index.byType.get(symbol.type)!.push(symbol);

    // Add to bySource
    if (!index.bySource.has(symbol.source)) {
      index.bySource.set(symbol.source, []);
    }
    index.bySource.get(symbol.source)!.push(symbol);

    // Add to bySymbol / byNameLower
    indexSymbolKeys(index, symbol);
  }

  return index;
}

/**
 * Resolve a user-supplied symbol to its canonical entry:
 *  1. exact full-symbol hit ("^authenticated");
 *  2. prefixed, case-insensitive ("^Authenticated") — unique hit with that prefix;
 *  3. bare name ("authenticated") — unique hit across all prefixes.
 * Anything else returns `entry: undefined` with the matches as `candidates`
 * (several → ambiguous, none → unknown).
 */
export function resolveSymbol(
  index: SymbolIndex,
  q: string,
): { entry?: SymbolEntry; candidates: SymbolEntry[] } {
  const exact = index.bySymbol.get(q);
  if (exact) return { entry: exact, candidates: [exact] };
  if (!q) return { candidates: [] };

  const prefixed = isValidPrefix(q[0]) || isLegacyPrefix(q[0]);
  const matches = prefixed
    ? (index.byNameLower.get(nameKey(q)) ?? []).filter((e) => e.symbol[0] === q[0])
    : index.byNameLower.get(q.toLowerCase()) ?? [];
  // Distinct symbols only — duplicate entries for one symbol are not ambiguity.
  const distinct = new Map<string, SymbolEntry>();
  for (const e of matches) {
    const first = index.bySymbol.get(e.symbol) ?? e;
    if (!distinct.has(e.symbol)) distinct.set(e.symbol, first);
  }
  const candidates = [...distinct.values()];
  return candidates.length === 1 ? { entry: candidates[0], candidates } : { candidates };
}

/**
 * Every contributor behind an entry — `entry.sources` when canonicalization
 * merged 2+ contributors, otherwise the entry itself.
 */
export function sourcesOf(entry: SymbolEntry): SymbolSource[] {
  return entry.sources ?? [{
    id: entry.id,
    source: entry.source,
    filePath: entry.filePath,
    declared: entry.declared !== false,
  }];
}

/**
 * Get a symbol by its full symbol string (e.g., "#checkout"). Tolerates case
 * differences and unambiguous bare names via resolveSymbol.
 */
export function getSymbol(index: SymbolIndex, symbol: string): SymbolEntry | undefined {
  return resolveSymbol(index, symbol).entry;
}

/**
 * Get a symbol by ID
 */
export function getSymbolById(index: SymbolIndex, id: string): SymbolEntry | undefined {
  return index.entries.get(id);
}

/**
 * Get all symbols of a specific type
 */
export function getSymbolsByType(index: SymbolIndex, type: SymbolType): SymbolEntry[] {
  return index.byType.get(type) || [];
}

/**
 * Get all symbols from a specific source
 */
export function getSymbolsBySource(index: SymbolIndex, source: SourceType): SymbolEntry[] {
  return index.bySource.get(source) || [];
}

/**
 * Precomputed lowercased search fields for one entry. The source references are
 * kept so a cached haystack is reused ONLY while the entry's searchable fields
 * are unchanged (entries are occasionally mutated in place, e.g. tags).
 */
interface SearchHaystack {
  srcSymbol: string;
  srcDescription: string | undefined;
  srcTags: string[] | undefined;
  srcTagCount: number;
  srcComponentType: string | undefined;
  symbol: string;
  description: string | undefined;
  tags: string[] | undefined;
  componentType: string | undefined;
  /** multi-token haystack — the exact string the uncached path built */
  joined: string;
}

/** Per-index memo of per-entry haystacks (#search-engine). GC'd with the index. */
const haystackCache = new WeakMap<SymbolIndex, Map<SymbolEntry, SearchHaystack>>();

function haystackFor(index: SymbolIndex, entry: SymbolEntry): SearchHaystack {
  let perIndex = haystackCache.get(index);
  if (!perIndex) {
    perIndex = new Map();
    haystackCache.set(index, perIndex);
  }
  const hit = perIndex.get(entry);
  if (
    hit &&
    hit.srcSymbol === entry.symbol &&
    hit.srcDescription === entry.description &&
    hit.srcTags === entry.tags &&
    hit.srcTagCount === (entry.tags?.length ?? 0) &&
    hit.srcComponentType === entry.componentType
  ) {
    return hit;
  }
  const symbol = entry.symbol.toLowerCase();
  const description = entry.description?.toLowerCase();
  const tags = entry.tags?.map((tag) => tag.toLowerCase());
  const componentType = entry.componentType?.toLowerCase();
  const hay: SearchHaystack = {
    srcSymbol: entry.symbol,
    srcDescription: entry.description,
    srcTags: entry.tags,
    srcTagCount: entry.tags?.length ?? 0,
    srcComponentType: entry.componentType,
    symbol,
    description,
    tags,
    componentType,
    joined: [
      symbol,
      description ?? '',
      (entry.tags ?? []).join(' ').toLowerCase(),
      componentType ?? '',
    ].join(' '),
  };
  perIndex.set(entry, hay);
  return hay;
}

/**
 * Search symbols by query string.
 *
 * Lowercased per-entry haystacks are memoized per index (WeakMap), so repeated
 * searches over the same (cached, #live-index) index skip re-lowercasing every
 * description. Matching semantics are unchanged: plain substring tests over the
 * same fields in the same order.
 */
export function searchSymbols(index: SymbolIndex, query: string): SymbolEntry[] {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);

  // Empty query → no results.
  if (tokens.length === 0) {
    return [];
  }

  // Single-token query keeps the original behavior: a literal substring match
  // across symbol / description / tags / componentType. No regression for
  // hyphenated single-word queries like "session-tracker".
  if (tokens.length === 1) {
    const lowerQuery = tokens[0];
    const results: SymbolEntry[] = [];

    for (const entry of index.entries.values()) {
      const hay = haystackFor(index, entry);
      if (
        hay.symbol.includes(lowerQuery) ||
        hay.description?.includes(lowerQuery) ||
        hay.tags?.some((tag) => tag.includes(lowerQuery)) ||
        hay.componentType?.includes(lowerQuery)
      ) {
        results.push(entry);
      }
    }

    return results;
  }

  // Multi-token query: use the per-entry haystack and count how many of the
  // query tokens appear in it. An entry matches when at least one token is present.
  const scored: Array<{ entry: SymbolEntry; matchedTokens: number; nameMatch: boolean }> = [];

  for (const entry of index.entries.values()) {
    const hay = haystackFor(index, entry);
    const symbolLower = hay.symbol;
    const haystack = hay.joined;

    let matchedTokens = 0;
    let nameMatch = false;
    for (const token of tokens) {
      if (haystack.includes(token)) {
        matchedTokens++;
        if (symbolLower.includes(token)) {
          nameMatch = true;
        }
      }
    }

    if (matchedTokens >= 1) {
      scored.push({ entry, matchedTokens, nameMatch });
    }
  }

  // Sort by matchedTokens desc; tie-break: symbol-name match first, then shorter
  // symbol name.
  scored.sort((a, b) => {
    if (b.matchedTokens !== a.matchedTokens) return b.matchedTokens - a.matchedTokens;
    if (a.nameMatch !== b.nameMatch) return a.nameMatch ? -1 : 1;
    return a.entry.symbol.length - b.entry.symbol.length;
  });

  return scored.map((s) => s.entry);
}

/**
 * Get components filtered by component type
 */
export function getComponentsByType(index: SymbolIndex, componentType: string): SymbolEntry[] {
  const components = getSymbolsByType(index, 'component');
  return components.filter(c => c.componentType === componentType);
}

/**
 * Get all unique component types in the index
 */
export function getAllComponentTypes(index: SymbolIndex): string[] {
  const types = new Set<string>();
  const components = getSymbolsByType(index, 'component');
  for (const comp of components) {
    if (comp.componentType) {
      types.add(comp.componentType);
    }
  }
  return Array.from(types).sort();
}

/**
 * Get child components of a parent symbol
 */
export function getChildComponents(index: SymbolIndex, parentSymbol: string): SymbolEntry[] {
  const components = getSymbolsByType(index, 'component');
  return components.filter(c => c.parentSymbol === parentSymbol);
}

/**
 * Get symbols that reference a given symbol
 */
export function getReferencesTo(index: SymbolIndex, symbol: string): SymbolEntry[] {
  const entry = getSymbol(index, symbol);
  if (!entry) return [];

  return entry.referencedBy
    .map((ref) => getSymbol(index, ref))
    .filter((e): e is SymbolEntry => e !== undefined);
}

/**
 * Get symbols that are referenced by a given symbol
 */
export function getReferencesFrom(index: SymbolIndex, symbol: string): SymbolEntry[] {
  const entry = getSymbol(index, symbol);
  if (!entry) return [];

  return entry.references
    .map((ref) => getSymbol(index, ref))
    .filter((e): e is SymbolEntry => e !== undefined);
}

/**
 * Get symbols by tag
 */
export function getSymbolsByTag(index: SymbolIndex, tag: string): SymbolEntry[] {
  const results: SymbolEntry[] = [];

  for (const entry of index.entries.values()) {
    if (entry.tags?.includes(tag)) {
      results.push(entry);
    }
  }

  return results;
}

/**
 * Get all unique tags in the index
 */
export function getAllTags(index: SymbolIndex): string[] {
  const tags = new Set<string>();

  for (const entry of index.entries.values()) {
    for (const tag of entry.tags || []) {
      tags.add(tag);
    }
  }

  return Array.from(tags).sort();
}

/**
 * Get symbol counts by type (v2)
 */
export function getSymbolCounts(index: SymbolIndex): Record<SymbolType, number> {
  const counts: Record<SymbolType, number> = {
    component: 0,
    flow: 0,
    gate: 0,
    signal: 0,
    aspect: 0,
  };

  for (const [type, symbols] of index.byType) {
    if (type in counts) {
      counts[type as SymbolType] = symbols.length;
    }
  }

  return counts;
}

/**
 * Get all symbols as a flat array
 */
export function getAllSymbols(index: SymbolIndex): SymbolEntry[] {
  return Array.from(index.entries.values());
}

/**
 * Parse a symbol string to extract type and name (v2)
 *
 * Valid prefixes: # $ ^ ! ~
 * Legacy prefixes (@ % ? &) return null - use parseLegacySymbol for migration
 */
export function parseSymbol(symbol: string): { type: SymbolType; name: string } | null {
  if (symbol.length < 2) return null;

  const prefix = symbol[0];
  const name = symbol.slice(1);

  // Only accept v2 prefixes
  if (!isValidPrefix(prefix)) {
    return null;
  }

  const type = PREFIX_TO_TYPE[prefix];
  return { type, name };
}

/**
 * Parse a legacy v1 symbol (for migration support)
 *
 * @deprecated Use tags instead of @ % ? & prefixes
 */
export function parseLegacySymbol(symbol: string): {
  type: LegacySymbolType;
  name: string;
  suggestedTag: string;
  migratedSymbol: string;
} | null {
  if (symbol.length < 2) return null;

  const prefix = symbol[0];
  const name = symbol.slice(1);

  if (!isLegacyPrefix(prefix)) {
    return null;
  }

  const type = LEGACY_PREFIX_TO_TYPE[prefix];

  // Map legacy type to suggested tag
  const tagMap: Record<LegacySymbolType, string> = {
    feature: 'feature',
    state: 'state',
    idea: 'idea',
    integration: 'integration',
  };

  return {
    type,
    name,
    suggestedTag: tagMap[type],
    migratedSymbol: `#${name}`, // All legacy symbols become #component
  };
}

/**
 * Parse any symbol (v2 or legacy) - useful for migration
 */
export function parseAnySymbol(symbol: string): {
  type: SymbolType | LegacySymbolType;
  name: string;
  isLegacy: boolean;
  suggestedTag?: string;
} | null {
  // Try v2 first
  const v2Result = parseSymbol(symbol);
  if (v2Result) {
    return { ...v2Result, isLegacy: false };
  }

  // Try legacy
  const legacyResult = parseLegacySymbol(symbol);
  if (legacyResult) {
    return {
      type: legacyResult.type,
      name: legacyResult.name,
      isLegacy: true,
      suggestedTag: legacyResult.suggestedTag,
    };
  }

  return null;
}

/**
 * Create a symbol string from type and name (v2)
 */
export function createSymbolString(type: SymbolType, name: string): string {
  return `${SYMBOL_PREFIXES[type]}${name}`;
}

/**
 * Validate a symbol string format (v2 only)
 */
export function isValidSymbol(symbol: string): boolean {
  return parseSymbol(symbol) !== null;
}

/**
 * Check if a symbol uses legacy v1 format
 */
export function isLegacySymbol(symbol: string): boolean {
  if (symbol.length < 2) return false;
  return isLegacyPrefix(symbol[0]);
}

// ─── Section anchors (heading / block) — shared by aggregator + parseAnchor ───

/** Path part of a section anchor must end in a file extension (guards `src/c#/x.cs:10`). */
const SECTION_PATH_RE = /\.[A-Za-z0-9]+$/;
/** A fragment ending in a line spec (`:10`, `:10-20`) belongs to a line anchor. */
const SECTION_LINE_SUFFIX_RE = /:\d+(-\d+)?$/;
/** Obsidian block ids: letters, digits, dashes. */
const BLOCK_ID_RE = /^[A-Za-z0-9-]+$/;

/**
 * Parse an Obsidian-compatible SECTION anchor, or return null when `raw` is not
 * one (callers then fall through to their line-anchor logic, unchanged):
 *   docs/x.md#Heading Text  → { kind:'heading', heading:'Heading Text', lines:0 }
 *   docs/x.md#^block-id     → { kind:'block',   block:'block-id',       lines:0 }
 * `lines: 0` = unresolved; the aspect graph resolves the live range at
 * materialize time. The '#' split happens on the FIRST '#', so a heading may
 * itself contain ':' — but a fragment containing '/' or ENDING in `:N`/`:N-M`
 * is rejected (it is a line anchor under a '#'-bearing directory).
 */
export function parseSectionAnchor(raw: string): CodeAnchor | null {
  const hashIndex = raw.indexOf('#');
  if (hashIndex <= 0) return null;
  const filePath = raw.slice(0, hashIndex).trim();
  const fragment = raw.slice(hashIndex + 1).trim();
  if (!filePath || !fragment || !SECTION_PATH_RE.test(filePath)) return null;
  // `dir.name#x/Foo.ts:10` is a LINE anchor whose directory contains '#':
  // a fragment with a '/' or a trailing `:N` / `:N-M` is never a section.
  if (fragment.includes('/') || SECTION_LINE_SUFFIX_RE.test(fragment)) return null;

  if (fragment.startsWith('^')) {
    const block = fragment.slice(1).trim();
    if (!block || !BLOCK_ID_RE.test(block)) return null;
    return { path: filePath, lines: 0, raw, kind: 'block', block };
  }
  const heading = fragment.replace(/^#+/, '').trim();
  if (!heading) return null;
  return { path: filePath, lines: 0, raw, kind: 'heading', heading };
}

/**
 * THE shared anchor-string parser (aggregator path). Section anchors first,
 * then the historical line semantics, byte-identical to pre-7.12:
 * "file.ts" → lines 0, "file.ts:15", "file.ts:15-20", "file.ts:15,25,30";
 * a non-numeric suffix keeps the whole string as the path.
 */
export function parseAnchorString(raw: string): CodeAnchor {
  const section = parseSectionAnchor(raw);
  if (section) return section;

  const colonIndex = raw.lastIndexOf(':');
  if (colonIndex === -1 || colonIndex === raw.length - 1) {
    return { path: raw, lines: 0, raw };
  }

  const afterColon = raw.slice(colonIndex + 1);
  const filePath = raw.slice(0, colonIndex);

  // Check if it's a line reference (digits, dashes, commas)
  if (!/^[\d,\- ]+$/.test(afterColon)) {
    return { path: raw, lines: 0, raw };
  }

  if (afterColon.includes('-')) {
    const [start, end] = afterColon.split('-').map(Number);
    return { path: filePath, lines: [start, end], raw };
  } else if (afterColon.includes(',')) {
    const lines = afterColon.split(',').map(Number);
    return { path: filePath, lines, raw };
  } else {
    return { path: filePath, lines: Number(afterColon), raw };
  }
}

const ATX_HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const FENCE_RE = /^ {0,3}(```|~~~)/;

/** A line that can continue a block upward: non-blank, not a heading, not a fence. */
function isParagraphLine(line: string): boolean {
  return line.trim() !== '' && !ATX_HEADING_RE.test(line) && !FENCE_RE.test(line);
}

/**
 * Resolve a section anchor against file content to its CURRENT 1-based,
 * inclusive line range, or null when the heading / block no longer exists.
 *
 * - heading: from the heading line to the line before the next heading of the
 *   same or higher level (or EOF), trailing blank lines trimmed. Exact text
 *   match first, then case-insensitive. Headings inside code fences are ignored.
 * - block: the contiguous non-blank run ending at the line carrying `^id`
 *   (inline suffix) — or, for a standalone `^id` line, the run just above it.
 */
export function resolveSectionAnchorLines(
  content: string,
  anchor: Pick<CodeAnchor, 'kind' | 'heading' | 'block'>,
): { startLine: number; endLine: number } | null {
  const lines = content.split(/\r?\n/);

  if (anchor.kind === 'heading' && anchor.heading) {
    const headings: Array<{ idx: number; level: number; text: string }> = [];
    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
      if (FENCE_RE.test(lines[i])) { inFence = !inFence; continue; }
      if (inFence) continue;
      const m = ATX_HEADING_RE.exec(lines[i]);
      if (m) headings.push({ idx: i, level: m[1].length, text: m[2].trim() });
    }
    const want = anchor.heading.trim();
    const hit = headings.find((h) => h.text === want)
      ?? headings.find((h) => h.text.toLowerCase() === want.toLowerCase());
    if (!hit) return null;
    const next = headings.find((h) => h.idx > hit.idx && h.level <= hit.level);
    let end = next ? next.idx - 1 : lines.length - 1;
    while (end > hit.idx && lines[end].trim() === '') end--;
    return { startLine: hit.idx + 1, endLine: end + 1 };
  }

  if (anchor.kind === 'block' && anchor.block) {
    const id = anchor.block;
    const standalone = new RegExp(`^\\s*\\^${id}\\s*$`);
    const inline = new RegExp(`\\s\\^${id}\\s*$`);
    for (let i = 0; i < lines.length; i++) {
      if (standalone.test(lines[i])) {
        let end = i - 1;
        while (end >= 0 && lines[end].trim() === '') end--;
        if (end < 0) return { startLine: i + 1, endLine: i + 1 };
        let start = end;
        while (start > 0 && isParagraphLine(lines[start - 1])) start--;
        return { startLine: start + 1, endLine: i + 1 };
      }
      if (inline.test(lines[i])) {
        let start = i;
        while (start > 0 && isParagraphLine(lines[start - 1])) start--;
        return { startLine: start + 1, endLine: i + 1 };
      }
    }
    return null;
  }

  return null;
}

/**
 * Parse an anchor string into a CodeAnchor object
 *
 * Formats:
 * - file.ts:15 (single line)
 * - file.ts:15-20 (range)
 * - file.ts:15,25,30 (multiple lines)
 */
export function parseAnchor(anchor: string): CodeAnchor | null {
  const section = parseSectionAnchor(anchor);
  if (section) return section;

  const colonIndex = anchor.lastIndexOf(':');
  if (colonIndex === -1) {
    // No line reference, just file path
    return {
      path: anchor,
      lines: 1,
      raw: anchor,
    };
  }

  const path = anchor.slice(0, colonIndex);
  const lineSpec = anchor.slice(colonIndex + 1);

  // Check for range (15-20)
  if (lineSpec.includes('-')) {
    const [start, end] = lineSpec.split('-').map(Number);
    if (isNaN(start) || isNaN(end)) return null;
    return {
      path,
      lines: [start, end],
      raw: anchor,
    };
  }

  // Check for multiple lines (15,25,30)
  if (lineSpec.includes(',')) {
    const lines = lineSpec.split(',').map(Number);
    if (lines.some(isNaN)) return null;
    return {
      path,
      lines,
      raw: anchor,
    };
  }

  // Single line
  const line = Number(lineSpec);
  if (isNaN(line)) return null;
  return {
    path,
    lines: line,
    raw: anchor,
  };
}

/**
 * Validate that an aspect has required anchors
 */
export function validateAspectAnchors(entry: SymbolEntry): {
  valid: boolean;
  errors: string[];
} {
  if (entry.type !== 'aspect') {
    return { valid: true, errors: [] };
  }

  const errors: string[] = [];

  if (!entry.anchors || entry.anchors.length === 0) {
    errors.push(`Aspect ${entry.symbol} requires at least one code anchor`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get autocomplete suggestions for partial symbol input
 */
export function getAutocompleteSuggestions(
  index: SymbolIndex,
  partial: string,
  limit = 10
): SymbolEntry[] {
  const lowerPartial = partial.toLowerCase();

  // If starts with a symbol prefix, filter by type
  const parsed = parseSymbol(partial);
  if (parsed) {
    const typeSymbols = getSymbolsByType(index, parsed.type);
    return typeSymbols
      .filter((s) => s.symbol.toLowerCase().includes(lowerPartial))
      .slice(0, limit);
  }

  // Otherwise, search all symbols
  return searchSymbols(index, partial).slice(0, limit);
}
