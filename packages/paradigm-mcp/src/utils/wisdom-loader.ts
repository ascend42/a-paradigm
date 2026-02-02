/**
 * Wisdom Loader - Loads team wisdom from .paradigm/wisdom/
 *
 * Parses:
 * - preferences.yaml: What TO do, indexed by symbol
 * - antipatterns.yaml: What NOT to do, with reasons
 * - expertise.yaml: Who knows what symbols
 * - decisions/*.yaml: ADR-style decision records
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
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
 * Load all wisdom data from a project directory
 */
export async function loadWisdomContext(rootDir: string): Promise<WisdomContext> {
  const wisdomPath = path.join(rootDir, WISDOM_DIR);

  if (!fs.existsSync(wisdomPath)) {
    return {
      preferences: null,
      antipatterns: [],
      decisions: [],
      expertise: null,
    };
  }

  const [preferences, antipatterns, expertise, decisions] = await Promise.all([
    loadPreferences(wisdomPath),
    loadAntipatterns(wisdomPath),
    loadExpertise(wisdomPath),
    loadDecisions(wisdomPath),
  ]);

  return {
    preferences,
    antipatterns,
    decisions,
    expertise,
  };
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
    console.error('[wisdom-loader] Error parsing preferences.yaml:', error);
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
    console.error('[wisdom-loader] Error parsing antipatterns.yaml:', error);
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
    console.error('[wisdom-loader] Error parsing expertise.yaml:', error);
    return null;
  }
}

/**
 * Load all decision files from decisions/
 */
async function loadDecisions(wisdomPath: string): Promise<WisdomDecision[]> {
  const decisionsPath = path.join(wisdomPath, 'decisions');

  if (!fs.existsSync(decisionsPath)) {
    return [];
  }

  const decisions: WisdomDecision[] = [];

  try {
    const files = fs.readdirSync(decisionsPath);

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
        console.error(`[wisdom-loader] Error parsing ${file}:`, error);
      }
    }
  } catch (error) {
    console.error('[wisdom-loader] Error reading decisions directory:', error);
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
