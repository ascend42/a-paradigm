/**
 * Wisdom Loader - Loads team wisdom from .paradigm/wisdom/
 *
 * Parses:
 * - preferences.yaml: What TO do, indexed by symbol
 * - antipatterns.yaml: What NOT to do, with reasons
 * - expertise.yaml: Who knows what symbols
 * - decisions/*.yaml: ADR-style decision records
 *
 * Features:
 * - Cache invalidation after recording new wisdom
 * - TTL-based automatic refresh (30 seconds)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
  loadGlobalAntipatterns,
  loadGlobalDecisions,
  loadGlobalPreferences,
} from './global-store.js';
import { log } from './mcp-logger.js';

/** TTL for wisdom cache (30 seconds) */
const WISDOM_CACHE_TTL_MS = 30 * 1000;

/** Wisdom cache entry */
interface WisdomCacheEntry {
  context: WisdomContext;
  loadedAt: number;
}

/** In-memory cache for wisdom context by root directory */
const wisdomCache: Map<string, WisdomCacheEntry> = new Map();
import type {
  WisdomContext,
  WisdomPreferences,
  WisdomAntipatterns,
  WisdomExpertise,
  WisdomDecision,
  WisdomAntipattern,
  SymbolWisdom,
  SymbolPreference,
  ExpertEntry,
} from '../types/wisdom.js';

const WISDOM_DIR = '.paradigm/wisdom';

/**
 * Load all wisdom data from a project directory (with caching)
 */
export async function loadWisdomContext(rootDir: string): Promise<WisdomContext> {
  const absoluteRoot = path.resolve(rootDir);

  // Check cache first
  const cached = wisdomCache.get(absoluteRoot);
  if (cached && Date.now() - cached.loadedAt < WISDOM_CACHE_TTL_MS) {
    return cached.context;
  }

  // Load fresh wisdom
  const context = await loadWisdomContextFresh(absoluteRoot);

  // Cache it
  wisdomCache.set(absoluteRoot, {
    context,
    loadedAt: Date.now(),
  });

  return context;
}

/**
 * Load wisdom context without caching (internal).
 * Merges global wisdom (~/.paradigm/wisdom/) with local project wisdom.
 * Deduplicates by ID — local wins on conflict.
 */
async function loadWisdomContextFresh(rootDir: string): Promise<WisdomContext> {
  const wisdomPath = path.join(rootDir, WISDOM_DIR);
  const localExists = fs.existsSync(wisdomPath);

  // Load local wisdom
  const [localPrefs, localAntipatterns, expertise, localDecisions] = localExists
    ? await Promise.all([
        loadPreferences(wisdomPath),
        loadAntipatterns(wisdomPath),
        loadExpertise(wisdomPath),
        loadDecisions(wisdomPath),
      ])
    : [null, [] as WisdomAntipattern[], null, [] as WisdomDecision[]];

  // Load global wisdom (best-effort)
  let globalAntipatterns: WisdomAntipattern[] = [];
  let globalDecisions: WisdomDecision[] = [];
  let globalPrefs: WisdomPreferences | null = null;
  try {
    globalAntipatterns = loadGlobalAntipatterns();
    globalDecisions = loadGlobalDecisions();
    globalPrefs = loadGlobalPreferences();
  } catch {
    // Global wisdom is optional
  }

  // Merge antipatterns: local wins on duplicate ID, add scope tag
  const localApIds = new Set(localAntipatterns.map(a => a.id));
  const mergedAntipatterns: ScopedAntipattern[] = localAntipatterns.map(a => ({
    ...a,
    scope: 'project' as const,
  }));
  for (const ga of globalAntipatterns) {
    if (!localApIds.has(ga.id)) {
      mergedAntipatterns.push({ ...ga, scope: 'global' as const });
    }
  }

  // Merge decisions: local wins on duplicate ID, add scope tag
  const localDecIds = new Set(localDecisions.map(d => d.id));
  const mergedDecisions: ScopedDecision[] = localDecisions.map(d => ({
    ...d,
    scope: 'project' as const,
  }));
  for (const gd of globalDecisions) {
    if (!localDecIds.has(gd.id)) {
      mergedDecisions.push({ ...gd, scope: 'global' as const });
    }
  }

  // Merge preferences: global as base, local overrides per-symbol
  let mergedPrefs = localPrefs;
  if (globalPrefs && !localPrefs) {
    mergedPrefs = globalPrefs;
  } else if (globalPrefs && localPrefs) {
    // Local preferences take priority; merge global by_symbol entries that don't exist locally
    const mergedBySymbol = { ...localPrefs.by_symbol };
    if (globalPrefs.by_symbol) {
      for (const [sym, pref] of Object.entries(globalPrefs.by_symbol)) {
        if (!mergedBySymbol[sym]) {
          mergedBySymbol[sym] = pref;
        }
      }
    }
    mergedPrefs = {
      ...localPrefs,
      by_symbol: mergedBySymbol,
      global: {
        ...globalPrefs.global,
        ...localPrefs.global,
      },
    };
  }

  return {
    preferences: mergedPrefs,
    antipatterns: mergedAntipatterns,
    decisions: mergedDecisions,
    expertise,
  };
}

/**
 * Antipattern with scope provenance
 */
export interface ScopedAntipattern extends WisdomAntipattern {
  scope: 'project' | 'global';
}

/**
 * Decision with scope provenance
 */
export interface ScopedDecision extends WisdomDecision {
  scope: 'project' | 'global';
}

/**
 * Invalidate wisdom cache for a project
 * Call this after recording new wisdom (antipattern, decision)
 */
export function invalidateWisdomCache(rootDir: string): void {
  const absoluteRoot = path.resolve(rootDir);
  wisdomCache.delete(absoluteRoot);
}

/**
 * Clear all wisdom caches
 */
export function clearWisdomCache(): void {
  wisdomCache.clear();
}

/**
 * Load preferences.yaml
 */
async function loadPreferences(wisdomPath: string): Promise<WisdomPreferences | null> {
  const filePath = path.join(wisdomPath, 'preferences.yaml');

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const data = yaml.load(content) as WisdomPreferences;
    return data;
  } catch (error) {
    log.component('#wisdom-loader').error('Error parsing preferences.yaml', { error });
    return null;
  }
}

/**
 * Load antipatterns.yaml
 */
async function loadAntipatterns(wisdomPath: string): Promise<WisdomAntipattern[]> {
  const filePath = path.join(wisdomPath, 'antipatterns.yaml');

  if (!fs.existsSync(filePath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const data = yaml.load(content) as WisdomAntipatterns;
    return data.antipatterns || [];
  } catch (error) {
    log.component('#wisdom-loader').error('Error parsing antipatterns.yaml', { error });
    return [];
  }
}

/**
 * Load expertise.yaml
 */
async function loadExpertise(wisdomPath: string): Promise<WisdomExpertise | null> {
  const filePath = path.join(wisdomPath, 'expertise.yaml');

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const data = yaml.load(content) as WisdomExpertise;
    return data;
  } catch (error) {
    log.component('#wisdom-loader').error('Error parsing expertise.yaml', { error });
    return null;
  }
}

/**
 * Track whether the wisdom-decisions deprecation warning has already been
 * emitted for a given path in this process. Keeps log spam bounded to one
 * warning per wisdom dir per process lifetime.
 */
const DEPRECATION_WARNED_PATHS = new Set<string>();

/**
 * Load all decision files from decisions/
 *
 * v5.39.0 (sub-phase 1): emits a one-time deprecation warning when the
 * legacy `.paradigm/wisdom/decisions/` dir is still populated. The dir
 * content is still read so v5.x consumers continue working — the actual
 * migration to TD-streams ships in v6.0 via `paradigm migrate decisions`.
 */
async function loadDecisions(wisdomPath: string): Promise<WisdomDecision[]> {
  const decisionsPath = path.join(wisdomPath, 'decisions');

  if (!fs.existsSync(decisionsPath)) {
    return [];
  }

  const decisions: WisdomDecision[] = [];

  try {
    const files = fs.readdirSync(decisionsPath);

    // Emit deprecation warning once per process per path, but only if the
    // dir actually contains at least one .yaml file (empty dir is a no-op)
    const hasDecisionFiles = files.some(f => f.endsWith('.yaml') || f.endsWith('.yml'));
    if (hasDecisionFiles && !DEPRECATION_WARNED_PATHS.has(decisionsPath)) {
      DEPRECATION_WARNED_PATHS.add(decisionsPath);
      log.component('#wisdom-loader').warn(
        'wisdom-decisions found; run `paradigm migrate decisions` in v6.0. In v5.39.0 wisdom-decisions are still read but will be migrated to TD-streams in v6.0.',
      );
    }

    for (const file of files) {
      if (!file.endsWith('.yaml') && !file.endsWith('.yml')) {
        continue;
      }

      const filePath = path.join(decisionsPath, file);
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const decision = yaml.load(content) as WisdomDecision;
        decisions.push(decision);
      } catch (error) {
        log.component('#wisdom-loader').error(`Error parsing ${file}`, { error });
      }
    }
  } catch (error) {
    log.component('#wisdom-loader').error('Error reading decisions directory', { error });
  }

  // Sort by ID
  decisions.sort((a, b) => a.id.localeCompare(b.id));

  return decisions;
}

/**
 * Get wisdom for specific symbols
 */
export function getWisdomForSymbols(
  wisdom: WisdomContext,
  symbols: string[]
): SymbolWisdom[] {
  return symbols.map((symbol) => getSymbolWisdom(wisdom, symbol));
}

/**
 * Get wisdom for a single symbol
 */
export function getSymbolWisdom(
  wisdom: WisdomContext,
  symbol: string
): SymbolWisdom {
  const preferences = wisdom.preferences?.by_symbol?.[symbol] || null;

  const antipatterns = wisdom.antipatterns.filter((a) =>
    a.symbols.some((s) => s === symbol || matchesSymbolPattern(symbol, s))
  );

  const decisions = wisdom.decisions.filter((d) =>
    d.symbols.some((s) => s === symbol || matchesSymbolPattern(symbol, s))
  );

  const experts = wisdom.expertise?.experts.filter((e) =>
    e.symbols?.some((s) => s === symbol || matchesSymbolPattern(symbol, s))
  ) || [];

  return {
    symbol,
    preferences,
    antipatterns,
    decisions,
    experts,
  };
}

/**
 * Find experts for a symbol or area
 */
export function findExperts(
  wisdom: WisdomContext,
  query: { symbol?: string; area?: string }
): ExpertEntry[] {
  if (!wisdom.expertise) {
    return [];
  }

  return wisdom.expertise.experts.filter((expert) => {
    if (query.symbol && expert.symbols) {
      if (expert.symbols.some((s) => s === query.symbol || matchesSymbolPattern(query.symbol!, s))) {
        return true;
      }
    }
    if (query.area && expert.areas) {
      if (expert.areas.some((a) => a.toLowerCase().includes(query.area!.toLowerCase()))) {
        return true;
      }
    }
    return false;
  });
}

/**
 * Check if a symbol matches a pattern (supports wildcards like @checkout*)
 */
function matchesSymbolPattern(symbol: string, pattern: string): boolean {
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    return symbol.startsWith(prefix);
  }
  return symbol === pattern;
}

/**
 * Record a new antipattern
 */
export async function recordAntipattern(
  rootDir: string,
  antipattern: Omit<WisdomAntipattern, 'added'>
): Promise<void> {
  const wisdomPath = path.join(rootDir, WISDOM_DIR);
  const filePath = path.join(wisdomPath, 'antipatterns.yaml');

  // Ensure directory exists
  if (!fs.existsSync(wisdomPath)) {
    fs.mkdirSync(wisdomPath, { recursive: true });
  }

  let data: WisdomAntipatterns = { version: '1.0', antipatterns: [] };

  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    data = yaml.load(content) as WisdomAntipatterns;
  }

  data.antipatterns.push({
    ...antipattern,
    added: new Date().toISOString(),
  });

  fs.writeFileSync(filePath, yaml.dump(data, { lineWidth: -1 }));

  // Invalidate cache so next query gets fresh data
  invalidateWisdomCache(rootDir);
}

/**
 * Record a new decision
 */
export async function recordDecision(
  rootDir: string,
  decision: WisdomDecision
): Promise<void> {
  const decisionsPath = path.join(rootDir, WISDOM_DIR, 'decisions');

  // Ensure directory exists
  if (!fs.existsSync(decisionsPath)) {
    fs.mkdirSync(decisionsPath, { recursive: true });
  }

  const fileName = `${decision.id}-${slugify(decision.title)}.yaml`;
  const filePath = path.join(decisionsPath, fileName);

  fs.writeFileSync(filePath, yaml.dump(decision, { lineWidth: -1 }));

  // Invalidate cache so next query gets fresh data
  invalidateWisdomCache(rootDir);
}

/**
 * Convert a string to a URL-friendly slug
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
