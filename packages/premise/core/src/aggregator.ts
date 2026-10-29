/**
 * Aggregator - pulls symbols from Purpose and Gate into a unified index
 */

import * as path from 'path';
import {
  getAllPurposeFiles,
  extractFeatures,
  extractComponents,
  extractGates,
  extractStates,
  extractFlows,
  extractSignals,
  extractAspects,
  extractSymbolReferences,
  type ParsedPurposeFile,
} from '@a-company/purpose-core';
import { parseGateConfig, findGateFiles, type ParsedGateConfig, type Gate, type Flow } from '@a-company/portal-core';
import type {
  PremiseFile,
  SymbolEntry,
  SymbolSource,
  SymbolType,
  SourceType,
  AggregationResult,
  AggregationError,
} from './types.js';
import { parseAnchorString } from './symbol-index.js';
import { findDuplicateDeclarations } from './integrity.js';

/**
 * Optional loader seams for aggregateFromPremise. Every hook defaults to the
 * historical cold implementation, so omitting `options` is byte-identical to
 * the pre-7.13 behavior. #live-index injects cached/pre-globbed loaders here so
 * a warm rebuild re-aggregates the FULL, identically-ordered file set without
 * re-reading unchanged files. Loaders must preserve discovery order.
 */
export interface AggregateOptions {
  /** Replaces getAllPurposeFiles(sourcePath). */
  loadPurposeFiles?: (sourcePath: string) => Promise<ParsedPurposeFile[]>;
  /** Replaces findGateFiles(sourcePath) for directory portal sources. */
  findPortalFiles?: (sourcePath: string) => Promise<string[]>;
}

/**
 * Discovery options for the symbol index (T-2026-10-27-003): gitignored build
 * and release output (e.g. a packages/gnomon/release/Gnomon.app copy of a
 * .purpose) is never indexed, so it can never win duplicate-symbol resolution.
 */
export const INDEX_DISCOVERY = Object.freeze({ respectGitignore: true });

/**
 * Aggregate all symbols from a premise configuration
 */
export async function aggregateFromPremise(
  premiseFile: PremiseFile,
  rootDir: string,
  options: AggregateOptions = {},
): Promise<AggregationResult> {
  const loadPurposeFiles =
    options.loadPurposeFiles ?? ((sourcePath: string) => getAllPurposeFiles(sourcePath, INDEX_DISCOVERY));
  const findPortalFiles = options.findPortalFiles ?? findGateFiles;
  const symbols: SymbolEntry[] = [];
  const errors: AggregationError[] = [];
  const purposeFiles: string[] = [];
  const portalFiles: string[] = [];
  // .purpose definitions a later file overwrote (last-wins) — they never become
  // entries, but canonicalization lists them in `sources` so duplicates surface.
  const shadowed: ShadowedSource[] = [];
  // Structural edges no entry's data spells out with a symbol prefix — a
  // portal gate awards its prizes by bare id (`prizes: [{ id: x }]`).
  const awardEdges: Array<{ from: string; to: string }> = [];

  // Aggregate from Purpose sources
  if (premiseFile.sources.purpose) {
    for (const source of premiseFile.sources.purpose) {
      const sourcePath = path.resolve(rootDir, source.path);
      try {
        const parsed = await loadPurposeFiles(sourcePath);
        purposeFiles.push(...parsed.map((p) => p.filePath));

        // Extract features (v2: now #components with [feature] tag)
        const features = extractFeatures(parsed, shadowCollector(shadowed, 'purpose-feature-', '#'));
        for (const [id, { item, filePath }] of features) {
          const featureTags = ['feature', ...(item.tags || [])];
          symbols.push(createSymbolEntry({
            id: `purpose-feature-${id}`,
            symbol: `#${id}`,
            type: 'component',
            source: 'purpose',
            filePath,
            data: item,
            description: item.description,
            tags: featureTags,
            componentType: item.type,
            parentSymbol: item.parent,
            anchors: item.anchors?.map((a: string) => parseAnchorString(a)),
          }));
        }

        // Extract components
        const components = extractComponents(parsed, shadowCollector(shadowed, 'purpose-component-', '#'));
        for (const [id, { item, filePath }] of components) {
          symbols.push(createSymbolEntry({
            id: `purpose-component-${id}`,
            symbol: `#${id}`,
            type: 'component',
            source: 'purpose',
            filePath,
            data: item,
            description: item.description,
            tags: item.tags,
            componentType: item.type,
            parentSymbol: item.parent,
            anchors: item.anchors?.map((a: string) => parseAnchorString(a)),
          }));
        }

        // Extract gates from purpose files
        const gates = extractGates(parsed, shadowCollector(shadowed, 'purpose-gate-', '^'));
        for (const [id, { item, filePath }] of gates) {
          symbols.push(createSymbolEntry({
            id: `purpose-gate-${id}`,
            symbol: `^${id}`,
            type: 'gate',
            source: 'purpose',
            filePath,
            data: item,
            description: item.description,
          }));
        }

        // Extract states from purpose files (v2: now #components with [state] tag)
        const states = extractStates(parsed, shadowCollector(shadowed, 'purpose-state-', '#'));
        for (const [id, { item, filePath }] of states) {
          symbols.push(createSymbolEntry({
            id: `purpose-state-${id}`,
            symbol: `#${id}`,
            type: 'component',
            source: 'purpose',
            filePath,
            data: item,
            description: item.description,
            tags: ['state'],
          }));
        }

        // Extract flows from purpose files (now supports both formats)
        const flows = extractFlows(parsed, shadowCollector(shadowed, 'purpose-flow-', '$'));
        for (const [id, { item, filePath }] of flows) {
          symbols.push(createSymbolEntry({
            id: `purpose-flow-${id}`,
            symbol: `$${id}`,
            type: 'flow',
            source: 'purpose',
            filePath,
            data: item,
            description: item.description,
          }));
        }

        // Extract signals from purpose files
        const signals = extractSignals(parsed, shadowCollector(shadowed, 'purpose-signal-', '!'));
        for (const [id, { item, filePath }] of signals) {
          symbols.push(createSymbolEntry({
            id: `purpose-signal-${id}`,
            symbol: `!${id}`,
            type: 'signal',
            source: 'purpose',
            filePath,
            data: item,
            description: item.description,
          }));
        }

        // Extract aspects from purpose files
        const aspects = extractAspects(parsed, shadowCollector(shadowed, 'purpose-aspect-', '~', true));
        for (const [rawId, { item, filePath }] of aspects) {
          // Aspect keys are canonically BARE ('determinism:'); some .purpose files
          // declare them '~'-prefixed. Strip any leading '~' so the symbol is
          // idempotently single-prefixed — '~~determinism' is unreachable by
          // aspect_check/aspect_get (which strip ONE '~'). (T-2026-06-24-002)
          const id = rawId.replace(/^~+/, '');
          symbols.push(createSymbolEntry({
            id: `purpose-aspect-${id}`,
            symbol: `~${id}`,
            type: 'aspect',
            source: 'purpose',
            filePath,
            data: item,
            description: item.description,
            anchors: item.anchors?.map(a => parseAnchorString(a)),
            appliesTo: item['applies-to'],
            tags: item.tags,
            enforcement: item.enforcement,
          }));
        }

        // Extract symbol references from feature/component data
        // (flows: [$checkout], gates: [^auth], etc.)
        const symbolRefs = extractSymbolReferences(parsed);
        const existingSymbols = new Set(symbols.map(s => s.symbol));
        
        for (const ref of symbolRefs) {
          // Only add if not already in the index
          if (!existingSymbols.has(ref.symbol)) {
            existingSymbols.add(ref.symbol);
            symbols.push(createSymbolEntry({
              id: `purpose-ref-${ref.type}-${ref.symbol.slice(1)}`,
              symbol: ref.symbol,
              type: ref.type,
              source: 'purpose',
              filePath: ref.filePath,
              data: { referencedFrom: ref.sourceSymbol },
              description: `Referenced from ${ref.sourceSymbol}`,
              declared: false,
            }));
          }
        }
      } catch (e: unknown) {
        errors.push({
          source: 'purpose',
          filePath: sourcePath,
          message: (e as Error).message,
        });
      }
    }
  }

  // Aggregate from Portal sources
  if (premiseFile.sources.portal) {
    for (const source of premiseFile.sources.portal) {
      const sourcePath = path.resolve(rootDir, source.path);
      try {
        // Check if it's a specific file or directory
        let gateConfig: ParsedGateConfig;
        if (sourcePath.endsWith('.yaml') || sourcePath.endsWith('.yml')) {
          gateConfig = await parseGateConfig(sourcePath);
          portalFiles.push(sourcePath);
        } else {
          const files = await findPortalFiles(sourcePath);
          portalFiles.push(...files);
          if (files.length > 0) {
            gateConfig = await parseGateConfig(files[0]);
            // Merge additional files
            for (let i = 1; i < files.length; i++) {
              const additional = await parseGateConfig(files[i]);
              gateConfig.gates.push(...additional.gates);
              gateConfig.flows.push(...additional.flows);
            }
          } else {
            continue;
          }
        }

        // Extract gates
        for (const gate of gateConfig.gates) {
          const gateEntry = createGateSymbol(gate, sourcePath);
          symbols.push(gateEntry);

          // Extract signals (prizes) from gates
          for (const prize of gate.prizes) {
            // Every awarding gate → its prize signal. Prize signals from
            // several gates collapse into one canonical `!x`, which must stay
            // connected to ALL of them.
            awardEdges.push({ from: gateEntry.symbol, to: `!${prize.id}` });
            symbols.push(createSymbolEntry({
              id: `gate-signal-${gate.id}-${prize.id}`,
              symbol: `!${prize.id}`,
              type: 'signal',
              source: 'portal',
              filePath: sourcePath,
              data: prize,
              description: `Signal from gate ${gate.id}`,
            }));
          }
        }

        // Extract flows
        for (const flow of gateConfig.flows) {
          symbols.push(createFlowSymbol(flow, sourcePath));
        }
      } catch (e: unknown) {
        errors.push({
          source: 'portal',
          filePath: sourcePath,
          message: (e as Error).message,
        });
      }
    }
  }

  // Add premise-native nodes
  for (const node of premiseFile.nodes) {
    // Skip if this is a reference to an existing symbol (no content)
    // v2: 'idea' is now a tag, not a type - check for symbols with [idea] tag
    const hasIdeaTag = node.tags?.includes('idea');
    if (!node.content && !hasIdeaTag) {
      // Find existing symbol and update position
      const existing = symbols.find((s) => s.symbol === node.symbol);
      if (existing) {
        existing.position = node.position;
        existing.tags = node.tags;
        continue;
      }
    }

    symbols.push(createSymbolEntry({
      id: node.id,
      symbol: node.symbol,
      type: node.type,
      source: 'premise',
      filePath: '.premise',
      data: node,
      description: node.content,
      position: node.position,
      tags: node.tags,
      created: node.created,
      modified: node.modified,
    }));
  }

  // One canonical entry per symbol string (Symbol Integrity Phase 1)
  // Losing contributors' data is kept on the side so their references survive.
  const donorData = new Map<SymbolEntry, unknown[]>();
  const canonical = canonicalizeSymbols(symbols, shadowed, donorData);

  // Resolve cross-references
  resolveReferences(canonical, donorData, awardEdges);

  // Detect duplicate declarations — the SAME rule integrity checks use
  // (findDuplicateDeclarations, incl. the portal + .purpose exemption), so
  // aggregation and `paradigm integrity` can never disagree.
  const duplicateSymbols = findDuplicateDeclarations(canonical);

  return {
    symbols: canonical,
    purposeFiles,
    portalFiles,
    errors,
    timestamp: Date.now(),
    ...(duplicateSymbols.length > 0 ? { duplicateSymbols } : {}),
  };
}

/** A shadowed .purpose definition, keyed by the symbol it would have produced. */
interface ShadowedSource extends SymbolSource {
  symbol: string;
}

/**
 * Build the onShadow callback for one extract* call. `stripTilde` mirrors the
 * aspect id normalization (bare vs '~'-prefixed keys).
 */
function shadowCollector(
  out: ShadowedSource[],
  idPrefix: string,
  symbolPrefix: string,
  stripTilde = false,
): (id: string, shadowedFilePath: string) => void {
  return (rawId, shadowedFilePath) => {
    const id = stripTilde ? rawId.replace(/^~+/, '') : rawId;
    out.push({
      symbol: `${symbolPrefix}${id}`,
      id: `${idPrefix}${id}`,
      source: 'purpose',
      filePath: shadowedFilePath,
      declared: true,
      shadowed: true,
    });
  };
}

/**
 * Winner rank for canonicalization (higher wins). Gates are authored in
 * portal.yaml; every other type is authored in .purpose. Stubs never win
 * over a declaration.
 */
function canonicalRank(entry: SymbolEntry): number {
  if (entry.declared === false) return 0;
  const order: Record<string, number> = entry.type === 'gate'
    ? { purpose: 1, premise: 2, portal: 3 }
    : { portal: 1, premise: 2, purpose: 3 };
  return order[entry.source] ?? 1;
}

/** Optional descriptive fields a winner inherits from lower-ranked declarations. */
const FILLABLE_FIELDS = ['description', 'anchors', 'tags', 'position', 'componentType', 'parentSymbol'] as const;

/**
 * Collapse every group of entries sharing a symbol string into ONE canonical
 * entry. The winner is the highest-ranked contributor (ties → last pushed,
 * matching the historical Map last-wins); undefined descriptive fields are
 * filled from the next-ranked declarations. `sources` lists every contributor
 * (shadowed .purpose definitions included) when there are 2+. Each canonical
 * entry is emitted at its group's first-occurrence index, so order stays
 * deterministic. When `donorData` is given, it receives each merged winner's
 * losing contributors' data (in rank order) for resolveReferences.
 */
export function canonicalizeSymbols(
  symbols: SymbolEntry[],
  shadowed: ShadowedSource[] = [],
  donorData?: Map<SymbolEntry, unknown[]>,
): SymbolEntry[] {
  const groups = new Map<string, SymbolEntry[]>();
  for (const sym of symbols) {
    const group = groups.get(sym.symbol);
    if (group) group.push(sym);
    else groups.set(sym.symbol, [sym]);
  }
  const shadowedBySymbol = new Map<string, ShadowedSource[]>();
  for (const sh of shadowed) {
    const list = shadowedBySymbol.get(sh.symbol);
    if (list) list.push(sh);
    else shadowedBySymbol.set(sh.symbol, [sh]);
  }

  const out: SymbolEntry[] = [];
  for (const [symbol, group] of groups) {
    const extra = shadowedBySymbol.get(symbol) ?? [];
    if (group.length === 1 && extra.length === 0) {
      out.push(group[0]);
      continue;
    }

    // Stable rank sort, descending; ties keep the LAST pushed entry first.
    const ranked = group
      .map((entry, i) => ({ entry, i, rank: canonicalRank(entry) }))
      .sort((a, b) => b.rank - a.rank || b.i - a.i)
      .map((r) => r.entry);
    const winner = ranked[0];

    // The losers' data is dropped from the entry but handed to
    // resolveReferences, so references only a loser declared (a .purpose gate
    // block when portal wins, portal flow steps when .purpose wins) survive.
    // Stub data is only `referencedFrom`, which resolveReferences ignores.
    if (donorData) {
      const data = ranked.slice(1).filter((d) => d.declared !== false && d.data != null).map((d) => d.data);
      if (data.length > 0) donorData.set(winner, data);
    }

    for (const donor of ranked.slice(1)) {
      if (donor.declared === false) continue;
      for (const field of FILLABLE_FIELDS) {
        if (winner[field] === undefined && donor[field] !== undefined) {
          (winner as unknown as Record<string, unknown>)[field] = donor[field];
        }
      }
    }

    // The canonical entry is undeclared only when every contributor is a stub.
    if (group.every((e) => e.declared === false)) winner.declared = false;
    else delete winner.declared;

    const sources: SymbolSource[] = [
      ...extra.map(({ symbol: _s, ...src }) => src),
      ...group.map((e) => ({
        id: e.id,
        source: e.source,
        filePath: e.filePath,
        declared: e.declared !== false,
      })),
    ];
    if (sources.length >= 2) winner.sources = sources;
    out.push(winner);
  }
  return out;
}

/**
 * Create a symbol entry with defaults
 */
function createSymbolEntry(partial: Partial<SymbolEntry> & {
  id: string;
  symbol: string;
  type: SymbolType;
  source: SourceType;
  filePath: string;
}): SymbolEntry {
  return {
    ...partial,
    data: partial.data ?? null,
    references: partial.references ?? [],
    referencedBy: partial.referencedBy ?? [],
  };
}

/**
 * Create a symbol entry from a Gate.
 *
 * v5.38.0: defensive strip of any residual `^` prefix on `gate.id`. The portal
 * parser now strips the prefix at parse time, but legacy consumers that feed
 * pre-parsed gates into the aggregator get the same back-compat courtesy so
 * the emitted symbol is always `^<bare>`, never `^^<bare>`.
 */
function createGateSymbol(gate: Gate, filePath: string): SymbolEntry {
  const bareId = gate.id.startsWith('^') ? gate.id.slice(1) : gate.id;
  return createSymbolEntry({
    id: `gate-${bareId}`,
    symbol: `^${bareId}`,
    type: 'gate',
    source: 'portal',
    filePath,
    data: gate,
    description: gate.description,
    position: gate.position,
  });
}

/**
 * Create a symbol entry from a Flow
 */
function createFlowSymbol(flow: Flow, filePath: string): SymbolEntry {
  return createSymbolEntry({
    id: `gate-flow-${flow.id}`,
    symbol: `$${flow.id}`,
    type: 'flow',
    source: 'portal',
    filePath,
    data: flow,
    description: flow.description,
  });
}

// Common framework aliases that look like symbols but aren't
// SvelteKit: $lib, $env, $app, $service-worker
// Vite: $virtual
// Other: $schema (JSON schema), $ref (JSON reference)
const SYMBOL_BLOCKLIST = new Set([
  '$lib', '$env', '$app', '$service-worker',
  '$virtual', '$schema', '$ref', '$id', '$type',
]);

/**
 * Resolve cross-references between symbols.
 *
 * Each entry's references come from its own data plus, for a canonical entry,
 * the data of every contributor it absorbed (`donorData`, winner first so
 * unmerged entries keep their historical order). `extraEdges` adds structural
 * edges no data spells out with a prefix (gate → awarded prize signal).
 */
function resolveReferences(
  symbols: SymbolEntry[],
  donorData: Map<SymbolEntry, unknown[]> = new Map(),
  extraEdges: Array<{ from: string; to: string }> = [],
): void {
  const symbolMap = new Map(symbols.map((s) => [s.symbol, s]));

  const link = (source: SymbolEntry, match: string): void => {
    if (match === source.symbol || !symbolMap.has(match)) return;
    // Add to references
    if (!source.references.includes(match)) {
      source.references.push(match);
    }
    // Add to referencedBy on target
    const target = symbolMap.get(match);
    if (target && !target.referencedBy.includes(source.symbol)) {
      target.referencedBy.push(source.symbol);
    }
  };

  for (const symbol of symbols) {
    for (const data of [symbol.data, ...(donorData.get(symbol) ?? [])]) {
      // Find references in the data
      // `anchors` are code LOCATIONS, never symbol references — a section anchor
      // like `docs/x.md#setup` must not register a reference to `#setup`.
      // `referencedFrom` (on reference stubs) points BACK at the referrer — the
      // referrer's own data already yields the forward edge, so scanning it
      // would invent an inverted stub → referrer edge.
      const dataStr = JSON.stringify(data, (key, value) =>
        key === 'anchors' || key === 'referencedFrom' ? undefined : value,
      );
      // Match compound ideas (?@, ?#, etc.) OR single prefixes
      // This ensures ?@subscription matches as one symbol, not split into ? and @subscription
      // IMPORTANT: First char after prefix must be a letter to avoid false positives
      // like $420 (prices), $0 (variables)
      const refPattern = /(?:\?[@#$%~^!]|[@#$%~^!?])[a-zA-Z][\w-]*/g;
      const matches = ((dataStr ?? '').match(refPattern) || []).filter(m => !SYMBOL_BLOCKLIST.has(m));

      for (const match of matches) link(symbol, match);
    }
  }

  for (const edge of extraEdges) {
    const source = symbolMap.get(edge.from);
    if (source) link(source, edge.to);
  }
}

/**
 * Aggregate symbols from a directory without a .premise file
 */
export async function aggregateFromDirectory(
  rootDir: string,
  options: AggregateOptions = {},
): Promise<AggregationResult> {
  // Create a default premise file configuration
  const premiseFile: PremiseFile = {
    version: '1.0.0',
    metadata: {
      name: path.basename(rootDir),
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    },
    sources: {
      purpose: [{ path: './' }],
      portal: [{ path: './' }],
    },
    nodes: [],
    connections: [],
    layout: {
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  };

  return aggregateFromPremise(premiseFile, rootDir, options);
}
