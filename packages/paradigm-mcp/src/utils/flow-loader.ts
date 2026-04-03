/**
 * Flow Loader - Loads testable flows from .paradigm/flow-index.json
 *
 * Features:
 * - Cached loading with TTL
 * - Symbol-to-flow mapping for quick lookups
 * - Downstream step analysis
 */

import * as fs from 'fs';
import * as path from 'path';
import { log } from './mcp-logger.js';
import type { FlowIndex, TestableFlow } from '@a-company/premise-core';

/** TTL for flow cache (30 seconds) */
const FLOW_CACHE_TTL_MS = 30 * 1000;

/** Flow cache entry */
interface FlowCacheEntry {
  index: FlowIndex;
  loadedAt: number;
}

/** In-memory cache for flow index by root directory */
const flowCache: Map<string, FlowCacheEntry> = new Map();

/**
 * Load flow index from a project directory (with caching)
 */
export async function loadFlowIndex(rootDir: string): Promise<FlowIndex | null> {
  const absoluteRoot = path.resolve(rootDir);

  // Check cache first
  const cached = flowCache.get(absoluteRoot);
  if (cached && Date.now() - cached.loadedAt < FLOW_CACHE_TTL_MS) {
    return cached.index;
  }

  // Load fresh flow index
  const index = await loadFlowIndexFresh(absoluteRoot);

  if (index) {
    // Cache it
    flowCache.set(absoluteRoot, {
      index,
      loadedAt: Date.now(),
    });
  }

  return index;
}

/**
 * Load flow index without caching (internal)
 */
async function loadFlowIndexFresh(rootDir: string): Promise<FlowIndex | null> {
  const flowIndexPath = path.join(rootDir, '.paradigm', 'flow-index.json');

  if (!fs.existsSync(flowIndexPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(flowIndexPath, 'utf8');
    return JSON.parse(content) as FlowIndex;
  } catch (error) {
    log.component('#flow-loader').error('Error parsing flow-index.json', { error });
    return null;
  }
}

/**
 * Invalidate flow cache for a project
 * Call this after paradigm scan regenerates the flow index
 */
export function invalidateFlowCache(rootDir: string): void {
  const absoluteRoot = path.resolve(rootDir);
  flowCache.delete(absoluteRoot);
}

/**
 * Clear all flow caches
 */
export function clearFlowCache(): void {
  flowCache.clear();
}

/**
 * Find flows affected by a symbol
 */
export function findFlowsAffectedBySymbol(
  flowIndex: FlowIndex,
  symbol: string
): AffectedFlowResult[] {
  const flowIds = flowIndex.symbolToFlows[symbol] || [];
  const results: AffectedFlowResult[] = [];

  for (const flowId of flowIds) {
    const flow = flowIndex.flows[flowId];
    if (!flow) continue;

    // Find the step(s) that use this symbol
    const affectedSteps = flow.steps
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => step.symbol === symbol);

    for (const { step, index } of affectedSteps) {
      // Find downstream steps (steps after this one)
      const downstreamSteps = flow.steps
        .slice(index + 1)
        .map(s => s.id);

      results.push({
        flowId: flow.id,
        definedIn: flow.definedIn,
        description: flow.description,
        trigger: flow.trigger,
        stepAffected: {
          id: step.id,
          action: step.action,
          position: index + 1, // 1-indexed for human readability
        },
        downstreamSteps,
        validation: flow.validation,
      });
    }
  }

  return results;
}

/**
 * Result of finding affected flows
 */
export interface AffectedFlowResult {
  flowId: string;
  definedIn: string;
  description: string;
  trigger?: string;
  stepAffected: {
    id: string;
    action: string;
    position: number;
  };
  downstreamSteps: string[];
  validation?: {
    command?: string;
    manual?: string;
  };
}

/**
 * Get a summary of flows affected by a symbol change
 */
export function getFlowImpactSummary(
  flowIndex: FlowIndex,
  symbol: string
): FlowImpactSummary {
  const affectedFlows = findFlowsAffectedBySymbol(flowIndex, symbol);

  // Collect unique validation commands
  const validationCommands = new Set<string>();
  for (const flow of affectedFlows) {
    if (flow.validation?.command) {
      validationCommands.add(flow.validation.command);
    }
  }

  // Determine impact level
  let impactLevel: 'low' | 'medium' | 'high' = 'low';
  const totalDownstreamSteps = affectedFlows.reduce(
    (sum, f) => sum + f.downstreamSteps.length,
    0
  );

  if (affectedFlows.length > 3 || totalDownstreamSteps > 10) {
    impactLevel = 'high';
  } else if (affectedFlows.length > 1 || totalDownstreamSteps > 3) {
    impactLevel = 'medium';
  }

  return {
    symbol,
    totalFlows: affectedFlows.length,
    impactLevel,
    affectedFlows,
    validationCommands: Array.from(validationCommands),
    suggestion:
      affectedFlows.length > 0
        ? `Changes to ${symbol} may affect ${affectedFlows.length} flow(s). ${
            validationCommands.size > 0
              ? 'Run validation commands to verify.'
              : 'Test manually.'
          }`
        : `No flows reference ${symbol} directly.`,
  };
}

/**
 * Summary of flow impact for a symbol
 */
export interface FlowImpactSummary {
  symbol: string;
  totalFlows: number;
  impactLevel: 'low' | 'medium' | 'high';
  affectedFlows: AffectedFlowResult[];
  validationCommands: string[];
  suggestion: string;
}

/**
 * Get all symbols used across all flows
 */
export function getAllFlowSymbols(flowIndex: FlowIndex): string[] {
  return Object.keys(flowIndex.symbolToFlows);
}

/**
 * Get a specific flow by ID
 */
export function getFlowById(
  flowIndex: FlowIndex,
  flowId: string
): TestableFlow | null {
  return flowIndex.flows[flowId] || null;
}
