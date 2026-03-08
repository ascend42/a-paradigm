/**
 * Heatmap MCP Tools - Adaptive heat map for keyword-to-symbol associations.
 *
 * Provides 3 tools:
 *   paradigm_heatmap_query  — query for symbols matching keywords
 *   paradigm_heatmap_record — record or correct an association
 *   paradigm_heatmap_stats  — show heat map statistics
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ProjectContext } from '../utils/index-loader.js';
import { trackToolCall } from './context.js';

// ============================================================================
// Types
// ============================================================================

interface HeatMapAssociation {
  keywords: string[];
  symbols: string[];
  aspects?: string[];
  confidence: number;
  hitCount: number;
  lastHit: string;
}

interface HeatMap {
  version: string;
  lastUpdated: string;
  sessionCount: number;
  associations: HeatMapAssociation[];
}

// ============================================================================
// Constants
// ============================================================================

const HEAT_MAP_FILE = '.paradigm/heat-map.json';
const CONFIDENCE_DECAY_RATE = 0.05; // 5% per 30 days

// ============================================================================
// Tool Definition
// ============================================================================

export function getHeatmapToolsList() {
  return [
    {
      name: 'paradigm_heatmap_query',
      description:
        'Query the adaptive heat map for historically relevant symbols given keywords. Returns associations sorted by confidence.',
      inputSchema: {
        type: 'object',
        properties: {
          keywords: {
            type: 'array',
            items: { type: 'string' },
            description: 'Keywords to search for in the heat map',
          },
        },
        required: ['keywords'],
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_heatmap_record',
      description:
        'Record a query-to-symbol association in the adaptive heat map. Use positive signal to reinforce, negative to correct.',
      inputSchema: {
        type: 'object',
        properties: {
          keywords: {
            type: 'array',
            items: { type: 'string' },
            description: 'Keywords that relate to the symbols',
          },
          symbols: {
            type: 'array',
            items: { type: 'string' },
            description: 'Symbol IDs (with prefix) that are relevant',
          },
          aspects: {
            type: 'array',
            items: { type: 'string' },
            description: 'Aspect IDs that are relevant (optional)',
          },
          context: {
            type: 'string',
            description: 'Why this association exists',
          },
          signal: {
            type: 'string',
            enum: ['positive', 'negative'],
            description: 'Positive reinforces, negative reduces confidence',
          },
          correction: {
            type: 'string',
            description: 'Explanation if correcting a wrong association',
          },
        },
        required: ['keywords', 'symbols', 'signal'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_heatmap_stats',
      description:
        'Show heat map statistics — total associations, hot/cold keywords, top symbols, session count.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
  ];
}

// ============================================================================
// Storage helpers
// ============================================================================

function loadHeatMap(projectDir: string): HeatMap {
  const filePath = path.join(projectDir, HEAT_MAP_FILE);
  if (!fs.existsSync(filePath)) {
    return {
      version: '1.0',
      lastUpdated: new Date().toISOString(),
      sessionCount: 0,
      associations: [],
    };
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveHeatMap(projectDir: string, heatMap: HeatMap): void {
  const filePath = path.join(projectDir, HEAT_MAP_FILE);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  heatMap.lastUpdated = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(heatMap, null, 2), 'utf8');
}

// ============================================================================
// Tool Handlers
// ============================================================================

export async function handleHeatmapQuery(
  args: { keywords: string[] },
  projectDir: string,
): Promise<string> {
  const heatMap = loadHeatMap(projectDir);

  // Apply decay
  const now = Date.now();
  for (const assoc of heatMap.associations) {
    const daysSinceHit =
      (now - new Date(assoc.lastHit).getTime()) / (1000 * 60 * 60 * 24);
    const decayPeriods = Math.floor(daysSinceHit / 30);
    if (decayPeriods > 0) {
      assoc.confidence = Math.max(
        0.01,
        assoc.confidence * Math.pow(1 - CONFIDENCE_DECAY_RATE, decayPeriods),
      );
    }
  }

  // Find matching associations
  const queryKeywords = args.keywords.map((k) => k.toLowerCase());
  const matches = heatMap.associations
    .filter((a) =>
      a.keywords.some((k) =>
        queryKeywords.some((qk) => k.includes(qk) || qk.includes(k)),
      ),
    )
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 10);

  return JSON.stringify({
    matches,
    totalAssociations: heatMap.associations.length,
  });
}

export async function handleHeatmapRecord(
  args: {
    keywords: string[];
    symbols: string[];
    aspects?: string[];
    context?: string;
    signal: 'positive' | 'negative';
    correction?: string;
  },
  projectDir: string,
): Promise<string> {
  const heatMap = loadHeatMap(projectDir);
  const queryKeywords = args.keywords.map((k) => k.toLowerCase());

  // Find existing association with overlapping keywords
  const existing = heatMap.associations.find((a) =>
    a.keywords.some((k) => queryKeywords.includes(k)),
  );

  if (args.signal === 'positive') {
    if (existing) {
      // Reinforce
      existing.confidence = Math.min(1.0, existing.confidence + 0.05);
      existing.hitCount += 1;
      existing.lastHit = new Date().toISOString();
      // Merge new symbols/aspects
      for (const s of args.symbols) {
        if (!existing.symbols.includes(s)) existing.symbols.push(s);
      }
      if (args.aspects) {
        if (!existing.aspects) existing.aspects = [];
        for (const a of args.aspects) {
          if (!existing.aspects.includes(a)) existing.aspects.push(a);
        }
      }
      // Merge keywords
      for (const k of queryKeywords) {
        if (!existing.keywords.includes(k)) existing.keywords.push(k);
      }
    } else {
      // Create new
      heatMap.associations.push({
        keywords: queryKeywords,
        symbols: args.symbols,
        aspects: args.aspects,
        confidence: 0.5,
        hitCount: 1,
        lastHit: new Date().toISOString(),
      });
    }
  } else {
    // Negative signal
    if (existing) {
      existing.confidence = Math.max(0.01, existing.confidence - 0.15);
      // Remove specific symbols if correction provided
      if (args.correction) {
        for (const s of args.symbols) {
          const idx = existing.symbols.indexOf(s);
          if (idx >= 0) existing.symbols.splice(idx, 1);
        }
      }
    }
  }

  saveHeatMap(projectDir, heatMap);
  return JSON.stringify({
    recorded: true,
    totalAssociations: heatMap.associations.length,
  });
}

export async function handleHeatmapStats(
  projectDir: string,
): Promise<string> {
  const heatMap = loadHeatMap(projectDir);

  const sorted = [...heatMap.associations].sort(
    (a, b) => b.confidence - a.confidence,
  );
  const hot = sorted.filter((a) => a.confidence > 0.7);
  const cold = sorted.filter((a) => a.confidence < 0.3);

  return JSON.stringify({
    totalAssociations: heatMap.associations.length,
    sessionCount: heatMap.sessionCount,
    lastUpdated: heatMap.lastUpdated,
    hotAssociations: hot
      .slice(0, 5)
      .map((a) => ({
        keywords: a.keywords,
        confidence: a.confidence,
        hitCount: a.hitCount,
      })),
    coldAssociations: cold
      .slice(0, 5)
      .map((a) => ({
        keywords: a.keywords,
        confidence: a.confidence,
        hitCount: a.hitCount,
      })),
    topSymbols: getTopSymbols(heatMap),
  });
}

function getTopSymbols(
  heatMap: HeatMap,
): Array<{ symbol: string; mentions: number }> {
  const counts = new Map<string, number>();
  for (const a of heatMap.associations) {
    for (const s of a.symbols) {
      counts.set(s, (counts.get(s) || 0) + a.hitCount);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([symbol, mentions]) => ({ symbol, mentions }));
}

// ============================================================================
// Dispatcher (matches pattern from other tool modules)
// ============================================================================

export async function handleHeatmapTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ProjectContext,
): Promise<{ handled: boolean; text: string }> {
  switch (name) {
    case 'paradigm_heatmap_query': {
      const text = await handleHeatmapQuery(
        args as { keywords: string[] },
        ctx.rootDir,
      );
      trackToolCall(text.length, name);
      return { handled: true, text };
    }
    case 'paradigm_heatmap_record': {
      const text = await handleHeatmapRecord(
        args as {
          keywords: string[];
          symbols: string[];
          aspects?: string[];
          context?: string;
          signal: 'positive' | 'negative';
          correction?: string;
        },
        ctx.rootDir,
      );
      trackToolCall(text.length, name);
      return { handled: true, text };
    }
    case 'paradigm_heatmap_stats': {
      const text = await handleHeatmapStats(ctx.rootDir);
      trackToolCall(text.length, name);
      return { handled: true, text };
    }
    default:
      return { handled: false, text: '' };
  }
}
