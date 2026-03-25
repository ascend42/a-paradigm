/**
 * Ripple MCP Tool — Standalone impact analysis for Paradigm symbols
 *
 * Extracted from the inline handler in tools/index.ts and enhanced with:
 * - Configurable BFS depth (default 3, max 5)
 * - Affected flows ($) and gates (^) surfacing
 * - Impact severity classification
 * - Suggested review scope
 * - Aspect graph integration (when available)
 * - Workspace cross-project impact
 *
 * Registered as a core-tier tool (always available).
 */

import type { ProjectContext } from '../utils/index-loader.js';
import {
  getSymbol,
  getReferencesTo,
  getReferencesFrom,
  getSymbolsByType,
} from '@a-company/premise-core';
import { grepForReferences } from './fallback-grep.js';
import { loadFlowIndex, getFlowImpactSummary } from '../utils/flow-loader.js';
import { getAffectedPersonas } from '../utils/personas-loader.js';
import { getAffectedUniversityContent } from '../utils/university-loader.js';
import { rippleWorkspace } from '../utils/workspace-loader.js';
import { trackToolCall } from './context.js';
import type { ToolDefinition } from '../utils/tool-registry.js';

// ────────────────────────────────────────────────────────
// Tool Definition
// ────────────────────────────────────────────────────────

export function getRippleToolsList(): ToolDefinition[] {
  return [
    {
      name: 'paradigm_ripple',
      description:
        'IMPORTANT: Call BEFORE modifying any symbol to understand impact. Shows what depends on it directly and indirectly, helping you avoid breaking changes. Returns direct and indirect dependents with file paths and dependency depth. ~300 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            description: 'Symbol to analyze (e.g., "#checkout", "$payment-flow", "^authenticated")',
          },
          depth: {
            type: 'number',
            description: 'How many hops to traverse (default: 3, max: 5)',
          },
          includeWorkspace: {
            type: 'boolean',
            description:
              'Also check sibling workspace projects for cross-project impact (default: false). Requires workspace configured in config.yaml.',
          },
          response_format: {
            type: 'string',
            enum: ['concise', 'detailed'],
            description:
              'Response detail level. "concise" returns minimal fields to save tokens (default: "detailed")',
          },
        },
        required: ['symbol'],
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
  ];
}

// ────────────────────────────────────────────────────────
// Handler
// ────────────────────────────────────────────────────────

export async function handleRippleTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ProjectContext,
): Promise<{ handled: boolean; text: string }> {
  if (name !== 'paradigm_ripple') {
    return { handled: false, text: '' };
  }

  const {
    symbol,
    depth = 3,
    includeWorkspace = false,
    response_format: responseFormat,
  } = args as {
    symbol: string;
    depth?: number;
    includeWorkspace?: boolean;
    response_format?: 'concise' | 'detailed';
  };

  const entry = getSymbol(ctx.index, symbol);

  // ── Fallback: grep when symbol is not indexed ────────
  if (!entry) {
    const text = buildGrepFallback(ctx.rootDir, symbol);
    trackToolCall(text.length, name);
    return { handled: true, text };
  }

  // ── BFS traversal with depth limit ──────────────────
  const maxDepth = Math.min(Math.max(depth || 3, 1), 5);

  const directDeps = getReferencesTo(ctx.index, symbol);

  const visited = new Set<string>([symbol]);
  const indirectByLevel: Map<number, string[]> = new Map();

  function collectIndirect(symbols: string[], currentDepth: number) {
    if (currentDepth >= maxDepth) return;

    const nextLevel: string[] = [];
    for (const sym of symbols) {
      if (visited.has(sym)) continue;
      visited.add(sym);

      const refs = getReferencesTo(ctx.index, sym);
      for (const ref of refs) {
        if (!visited.has(ref.symbol)) {
          nextLevel.push(ref.symbol);
        }
      }
    }

    if (nextLevel.length > 0) {
      indirectByLevel.set(currentDepth + 1, nextLevel);
      collectIndirect(nextLevel, currentDepth + 1);
    }
  }

  collectIndirect(
    directDeps.map((d) => d.symbol),
    1,
  );

  // Flatten all indirect deps (excluding direct and self)
  const allIndirectDeps = new Set<string>();
  for (const [, syms] of indirectByLevel) {
    for (const s of syms) {
      if (s !== symbol && !directDeps.find((d) => d.symbol === s)) {
        allIndirectDeps.add(s);
      }
    }
  }

  // What this symbol depends on
  const dependsOn = getReferencesFrom(ctx.index, symbol);

  const totalAffected = directDeps.length + allIndirectDeps.size;
  let impact: 'low' | 'medium' | 'high' = 'low';
  if (totalAffected > 10) impact = 'high';
  else if (totalAffected > 3) impact = 'medium';

  // ── Affected flows ($) ──────────────────────────────
  const flowIndex = await loadFlowIndex(ctx.rootDir);
  let flowImpact: {
    totalFlows: number;
    affectedFlows: Array<{
      flowId: string;
      impactLevel: string;
      reason: string;
    }>;
    validationSuggestion?: string;
  } | null = null;

  if (flowIndex) {
    const flowSummary = getFlowImpactSummary(flowIndex, symbol);
    if (flowSummary.totalFlows > 0) {
      if (flowSummary.impactLevel === 'high' && impact === 'low') {
        impact = 'medium';
      } else if (flowSummary.impactLevel === 'high') {
        impact = 'high';
      }

      flowImpact = {
        totalFlows: flowSummary.totalFlows,
        affectedFlows: flowSummary.affectedFlows.map((f) => ({
          flowId: f.flowId,
          impactLevel: f.downstreamSteps.length > 2 ? 'high' : 'medium',
          reason: `Symbol is in step ${f.stepAffected.position}, affects ${f.downstreamSteps.length} downstream steps`,
        })),
        validationSuggestion:
          flowSummary.validationCommands.length > 0
            ? `Run: ${flowSummary.validationCommands[0]}`
            : undefined,
      };
    }
  }

  // ── Affected gates (^) ──────────────────────────────
  const allAffectedSymbols = new Set<string>([
    symbol,
    ...directDeps.map((d) => d.symbol),
    ...allIndirectDeps,
  ]);

  const affectedGates: Array<{ gate: string; description?: string }> = [];
  try {
    const gateSymbols = getSymbolsByType(ctx.index, 'gate');
    for (const gs of gateSymbols) {
      if (allAffectedSymbols.has(gs.symbol)) {
        affectedGates.push({
          gate: gs.symbol,
          description: gs.description,
        });
      }
    }
    // Also check if any direct/indirect dep references a gate
    for (const dep of directDeps) {
      if (dep.type === 'gate' && !affectedGates.find((g) => g.gate === dep.symbol)) {
        affectedGates.push({ gate: dep.symbol, description: dep.description });
      }
    }
  } catch {
    // Gate check is non-fatal
  }

  // ── Build response ──────────────────────────────────
  const response: Record<string, unknown> = {
    symbol: entry.symbol,
    type: entry.type,
    description: entry.description,
    depth: maxDepth,
    impact,
    analysis: {
      directlyAffected: directDeps.map((d) => ({
        symbol: d.symbol,
        type: d.type,
        description: d.description,
      })),
      indirectlyAffected: Array.from(allIndirectDeps),
      indirectByLevel: Object.fromEntries(indirectByLevel),
      dependsOn: dependsOn.map((d) => ({
        symbol: d.symbol,
        type: d.type,
      })),
    },
    summary: {
      directCount: directDeps.length,
      indirectCount: allIndirectDeps.size,
      totalAffected,
      dependsOnCount: dependsOn.length,
      levelsAnalyzed: maxDepth,
    },
    recommendation: buildRecommendation(impact),
  };

  // Add flow impact if present
  if (flowImpact) {
    response.affectedFlows = flowImpact;
  }

  // Add affected gates if present
  if (affectedGates.length > 0) {
    response.affectedGates = affectedGates;
  }

  // Suggested review scope
  response.suggestedReviewScope = buildReviewScope(
    impact,
    directDeps.length,
    allIndirectDeps.size,
    affectedGates.length,
    flowImpact?.totalFlows ?? 0,
  );

  // ── Affected personas (non-fatal) ───────────────────
  try {
    const personasAffected = await getAffectedPersonas(ctx.rootDir, symbol);
    if (personasAffected.length > 0) {
      response.personas_affected = personasAffected;
      if (personasAffected.length > 2 && impact === 'low') {
        response.impact = 'medium';
      }
    }
  } catch {
    // Persona check is non-fatal
  }

  // ── Affected university content (non-fatal) ─────────
  try {
    const universityAffected = getAffectedUniversityContent(ctx.rootDir, symbol);
    if (universityAffected.length > 0) {
      response.university_content_affected = universityAffected.map((c) => ({
        id: c.id,
        title: c.title,
        type: c.type,
        stale: c.stale,
      }));
    }
  } catch {
    // University content check is non-fatal
  }

  // ── Cross-project workspace impact ──────────────────
  if (includeWorkspace && ctx.workspace) {
    const wsRipple = rippleWorkspace(ctx.workspace, symbol);
    if (wsRipple.length > 0) {
      response.workspaceImpact = {
        siblings: wsRipple.map((r) => ({
          project: r.project,
          references: r.references.map((ref) => ({
            symbol: ref.symbol,
            type: ref.type,
            description: ref.description,
          })),
        })),
      };
      const totalWsRefs = wsRipple.reduce((sum, r) => sum + r.references.length, 0);
      if (totalWsRefs > 0 && impact === 'low') {
        response.impact = 'medium';
      }
      if (totalWsRefs > 5) {
        response.impact = 'high';
      }
    }
  }

  // ── Format output ───────────────────────────────────
  const output =
    responseFormat === 'concise'
      ? {
          symbol: response.symbol,
          impact: response.impact,
          summary: response.summary,
        }
      : response;

  const text = JSON.stringify(output, null, 2);
  trackToolCall(text.length, name);
  return { handled: true, text };
}

// ────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────

function buildGrepFallback(rootDir: string, symbol: string): string {
  const references = grepForReferences(rootDir, symbol, { maxResults: 20 });

  if (references.length === 0) {
    return JSON.stringify(
      {
        error: 'Symbol not found in index',
        symbol,
        fallback: 'searched',
        referencesFound: 0,
        suggestion:
          'Run `paradigm scan` to build the index, or check that .purpose files contain this symbol',
      },
      null,
      2,
    );
  }

  const filesAffected = [...new Set(references.map((r) => r.filePath))];
  const contextBreakdown: Record<string, number> = {};
  for (const ref of references) {
    contextBreakdown[ref.context] = (contextBreakdown[ref.context] || 0) + 1;
  }

  let estimatedImpact: 'low' | 'medium' | 'high' = 'low';
  if (filesAffected.length > 10 || references.length > 20) {
    estimatedImpact = 'high';
  } else if (filesAffected.length > 3 || references.length > 5) {
    estimatedImpact = 'medium';
  }

  return JSON.stringify(
    {
      symbol,
      status: 'not-indexed',
      fallback: 'grep-search',
      estimatedImpact,
      analysis: {
        filesAffected: filesAffected.slice(0, 10),
        totalFilesAffected: filesAffected.length,
        totalReferences: references.length,
        contextBreakdown,
        sampleReferences: references.slice(0, 5).map((r) => ({
          file: r.filePath,
          line: r.line,
          preview: r.content.slice(0, 100),
        })),
      },
      note: 'This is a fallback grep search. For accurate dependency analysis, run `paradigm scan` to index your project.',
      suggestion: 'Run `paradigm scan` to enable full ripple analysis with dependency tracking',
    },
    null,
    2,
  );
}

function buildRecommendation(impact: 'low' | 'medium' | 'high'): string {
  switch (impact) {
    case 'high':
      return 'High impact change - review all affected symbols carefully before modifying';
    case 'medium':
      return 'Moderate impact - check direct dependencies for breaking changes';
    case 'low':
      return 'Low impact - safe to modify with standard review';
  }
}

function buildReviewScope(
  impact: 'low' | 'medium' | 'high',
  directCount: number,
  indirectCount: number,
  gateCount: number,
  flowCount: number,
): string[] {
  const scope: string[] = [];

  if (directCount > 0) {
    scope.push(`Review ${directCount} direct dependent(s) for breaking changes`);
  }

  if (indirectCount > 0) {
    scope.push(`Scan ${indirectCount} indirect dependent(s) for cascading effects`);
  }

  if (gateCount > 0) {
    scope.push(`Verify ${gateCount} affected gate(s) still enforce correct auth/access`);
  }

  if (flowCount > 0) {
    scope.push(`Validate ${flowCount} affected flow(s) end-to-end`);
  }

  if (impact === 'high') {
    scope.push('Consider running full test suite before merging');
  } else if (impact === 'medium') {
    scope.push('Run targeted tests for affected components');
  }

  if (scope.length === 0) {
    scope.push('No downstream dependents detected - safe to proceed');
  }

  return scope;
}
