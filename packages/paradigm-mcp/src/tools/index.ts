/**
 * MCP Tools - Actions AI can invoke on Paradigm data
 *
 * Uses ToolRegistry for tiered tool listing and Map-based dispatch.
 * Inline tools (search, ripple, related, status, gates_for_route, plugin_check,
 * workspace_reindex, tool_activate) are handled directly in the switch statement.
 * All other tools are dispatched through the registry.
 */

import * as os from 'os';
import * as path from 'path';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  getSymbol,
  searchSymbols,
  getReferencesTo,
  getReferencesFrom,
  getSymbolsByType,
  getAllSymbols,
  getSymbolCounts,
} from '@a-company/premise-core';
import type { ProjectContext } from '../utils/index-loader.js';
import { ToolRegistry, type ToolModule, type ToolDefinition } from '../utils/tool-registry.js';
import { getWisdomToolsList, handleWisdomTool } from './wisdom.js';
import { getHistoryToolsList, handleHistoryTool } from './history.js';
import { getNavigateToolsList, handleNavigateTool } from './navigate.js';
import { getContextToolsList, handleContextTool, trackToolCall, addToolBreadcrumb, buildRecoveryPreamble } from './context.js';
import { getSessionTracker } from '../utils/session-tracker.js';
import { getSentinelToolsList, handleSentinelTool } from './sentinel.js';
import { getFlowsToolsList, handleFlowTool } from './flows.js';
import { getFixturesToolsList, handleFixturesTool } from './fixtures.js';
import { getOrchestrationToolsList, handleOrchestrationTool } from './orchestration.js';
import { getTagsToolsList, handleTagsTool } from './tags.js';
import { getPurposePortalToolsList, handlePurposePortalTool } from './purpose-portal.js';
import { getPmToolsList, handlePmTool } from './pm.js';
import { getReindexToolsList, handleReindexTool } from './reindex.js';
import { getLoreToolsList, handleLoreTool } from './lore.js';
import { getHabitsToolsList, handleHabitsTool } from './habits.js';
import { getGraduationToolsList, handleGraduationTool } from './graduation.js';
import { getAspectGraphToolsList, handleAspectGraphTool } from './aspect-graph.js';
import { getTasksToolsList, handleTasksTool } from './tasks.js';
import { getAssessmentToolsList, handleAssessmentTool } from './assessment.js';
import { getPersonaToolsList, handlePersonaTool } from './personas.js';
import { getProtocolsToolsList, handleProtocolsTool } from './protocols.js';
import { getGraphToolsList, handleGraphTool } from './graph.js';
import { getHeatmapToolsList, handleHeatmapTool } from './heatmap.js';
import { getPipelineToolsList, handlePipelineTool } from './pipeline.js';
import { getConductorToolsList, handleConductorTool } from './conductor.js';
import { getSymphonyToolsList, handleSymphonyTool } from './symphony.js';
import { getUniversityToolsList, handleUniversityTool } from './university.js';
import { getPlatformToolsList, handlePlatformTool } from './platform.js';
import { getAgentToolsList, handleAgentTool } from './agents.js';
import { getNotebookToolsList, handleNotebookTool } from './notebooks.js';
import { getDocsToolsList, handleDocsTool } from './docs.js';
import { getStreamsToolsList, handleStreamsTool } from './streams.js';
import { getAmbientToolsList, handleAmbientTool } from './ambient.js';
import { getPluginUpdateNotice, schedulePluginUpdateCheck } from '../utils/plugin-update-checker.js';
import { grepForReferences } from './fallback-grep.js';
import { findFuzzyMatches } from './fuzzy-match.js';
import { loadFlowIndex, getFlowImpactSummary } from '../utils/flow-loader.js';
import { getAffectedPersonas } from '../utils/personas-loader.js';
import { getAffectedUniversityContent } from '../utils/university-loader.js';
import { toolCache } from '../utils/tool-cache.js';
import { searchWorkspace, rippleWorkspace } from '../utils/workspace-loader.js';
import { loadProtocolIndex } from '../utils/protocol-loader.js';
import { emitAndProcess } from '../utils/nomination-engine.js';

// ────────────────────────────────────────────────────────
// Tool Registry Setup
// ────────────────────────────────────────────────────────

/**
 * Build and populate the ToolRegistry with all tool modules.
 *
 * Tiers:
 *   core     — always loaded (context, navigate, tags, purpose-portal, pm, reindex, docs)
 *   feature  — auto-detected (lore, agents, orchestration, habits, notebooks, etc.)
 *   advanced — on-demand (conductor, platform, pipeline, graduation, assessment, graph, heatmap)
 *
 * The registry provides tiered listing via getActiveTools() and
 * Map-based dispatch via dispatch().
 */
function buildRegistry(rootDir: string, reloadContext?: () => Promise<void>): ToolRegistry {
  const registry = new ToolRegistry(rootDir);

  const reload = reloadContext || (async () => {});

  // Helper: wrap a standard (name, args, ctx) handler into the ToolModule.handleTool shape
  const wrap = (
    handler: (name: string, args: Record<string, unknown>, ctx: ProjectContext) => Promise<{ handled: boolean; text: string }>,
  ): ToolModule['handleTool'] =>
    async (name, args, ctx) => handler(name, args, ctx as ProjectContext);

  // Helper: wrap handlers that also need the reload callback
  const wrapWithReload = (
    handler: (name: string, args: Record<string, unknown>, ctx: ProjectContext, reloadFn: () => Promise<void>) => Promise<{ handled: boolean; text: string }>,
  ): ToolModule['handleTool'] =>
    async (name, args, ctx) => handler(name, args, ctx as ProjectContext, reload);

  // ── Core tier (always loaded) ─────────────────────────

  registry.registerAll([
    {
      key: 'context',
      tier: 'core',
      getToolsList: getContextToolsList,
      handleTool: wrap(handleContextTool),
    },
    {
      key: 'navigate',
      tier: 'core',
      getToolsList: getNavigateToolsList as () => ToolDefinition[],
      handleTool: wrap(handleNavigateTool),
    },
    {
      key: 'tags',
      tier: 'core',
      getToolsList: getTagsToolsList,
      handleTool: wrap(handleTagsTool),
    },
    {
      key: 'purpose-portal',
      tier: 'core',
      getToolsList: getPurposePortalToolsList as () => ToolDefinition[],
      handleTool: wrapWithReload(handlePurposePortalTool),
    },
    {
      key: 'pm',
      tier: 'core',
      getToolsList: getPmToolsList,
      handleTool: wrap(handlePmTool),
    },
    {
      key: 'reindex',
      tier: 'core',
      getToolsList: getReindexToolsList,
      handleTool: wrapWithReload(handleReindexTool),
    },
    {
      key: 'docs',
      tier: 'core',
      getToolsList: getDocsToolsList,
      handleTool: wrap(handleDocsTool),
    },
  ]);

  // ── Feature tier (auto-detected) ─────────────────────

  registry.registerAll([
    {
      key: 'wisdom',
      tier: 'feature',
      getToolsList: getWisdomToolsList,
      handleTool: wrap(handleWisdomTool),
    },
    {
      key: 'history',
      tier: 'feature',
      getToolsList: getHistoryToolsList,
      handleTool: wrap(handleHistoryTool),
    },
    {
      key: 'lore',
      tier: 'feature',
      getToolsList: getLoreToolsList,
      handleTool: wrap(handleLoreTool),
    },
    {
      key: 'streams',
      tier: 'feature',
      getToolsList: getStreamsToolsList,
      handleTool: wrap(handleStreamsTool),
    },
    {
      key: 'ambient',
      tier: 'feature',
      getToolsList: getAmbientToolsList,
      handleTool: wrap(handleAmbientTool),
    },
    {
      key: 'sentinel',
      tier: 'feature',
      getToolsList: getSentinelToolsList,
      handleTool: wrap(handleSentinelTool),
    },
    {
      key: 'flows',
      tier: 'feature',
      getToolsList: getFlowsToolsList,
      handleTool: wrap(handleFlowTool),
    },
    {
      key: 'fixtures',
      tier: 'feature',
      getToolsList: getFixturesToolsList,
      handleTool: wrap(handleFixturesTool),
    },
    {
      key: 'orchestration',
      tier: 'feature',
      getToolsList: getOrchestrationToolsList,
      handleTool: wrap(handleOrchestrationTool),
    },
    {
      key: 'habits',
      tier: 'feature',
      getToolsList: getHabitsToolsList,
      handleTool: wrap(handleHabitsTool),
    },
    {
      key: 'tasks',
      tier: 'feature',
      getToolsList: getTasksToolsList,
      handleTool: wrap(handleTasksTool),
    },
    {
      key: 'personas',
      tier: 'feature',
      getToolsList: getPersonaToolsList,
      handleTool: wrap(handlePersonaTool),
    },
    {
      key: 'protocols',
      tier: 'feature',
      getToolsList: getProtocolsToolsList,
      handleTool: wrap(handleProtocolsTool),
    },
    {
      key: 'symphony',
      tier: 'feature',
      getToolsList: getSymphonyToolsList,
      handleTool: wrap(handleSymphonyTool),
    },
    {
      key: 'university',
      tier: 'feature',
      getToolsList: getUniversityToolsList,
      handleTool: wrap(handleUniversityTool),
    },
    {
      key: 'agents',
      tier: 'feature',
      getToolsList: getAgentToolsList,
      handleTool: wrap(handleAgentTool),
    },
    {
      key: 'notebooks',
      tier: 'feature',
      getToolsList: getNotebookToolsList,
      handleTool: wrap(handleNotebookTool),
    },
    {
      key: 'aspect-graph',
      tier: 'feature',
      getToolsList: getAspectGraphToolsList,
      handleTool: wrap(handleAspectGraphTool),
    },
  ]);

  // ── Advanced tier (on-demand) ─────────────────────────

  registry.registerAll([
    {
      key: 'conductor',
      tier: 'advanced',
      getToolsList: getConductorToolsList,
      handleTool: wrap(handleConductorTool),
    },
    {
      key: 'platform',
      tier: 'advanced',
      getToolsList: getPlatformToolsList,
      handleTool: wrap(handlePlatformTool),
    },
    {
      key: 'pipeline',
      tier: 'advanced',
      getToolsList: getPipelineToolsList,
      handleTool: wrap(handlePipelineTool),
    },
    {
      key: 'graduation',
      tier: 'advanced',
      getToolsList: getGraduationToolsList,
      handleTool: wrap(handleGraduationTool),
    },
    {
      key: 'assessment',
      tier: 'advanced',
      getToolsList: getAssessmentToolsList,
      handleTool: wrap(handleAssessmentTool),
    },
    {
      key: 'graph',
      tier: 'advanced',
      getToolsList: getGraphToolsList,
      handleTool: wrap(handleGraphTool),
    },
    {
      key: 'heatmap',
      tier: 'advanced',
      getToolsList: getHeatmapToolsList,
      handleTool: wrap(handleHeatmapTool),
    },
  ]);

  return registry;
}

/**
 * Calculate similarity between two routes for gate suggestions
 * Returns a value between 0 and 1
 */
function calculateRouteSimilarity(route1: string, route2: string): number {
  // Normalize routes: lowercase, remove trailing slashes
  const normalize = (r: string) => r.toLowerCase().replace(/\/+$/, '');
  const r1 = normalize(route1);
  const r2 = normalize(route2);

  // Exact match
  if (r1 === r2) return 1.0;

  // Detect tRPC-style dot notation (e.g., "servers.transferOwnership")
  const isDotNotation = (r: string) => !r.includes('/') && r.includes('.');

  // Split into segments — handle both REST (/) and tRPC (.) routes
  const splitRoute = (r: string): string[] => {
    if (isDotNotation(r)) return r.split('.');
    return r.split('/').filter(Boolean);
  };

  const seg1 = splitRoute(r1);
  const seg2 = splitRoute(r2);

  // For dot-notation: prefix match gives high similarity
  // e.g., "servers.transferOwnership" vs "servers.update" share "servers" prefix
  if (isDotNotation(r1) || isDotNotation(r2)) {
    const s1 = isDotNotation(r1) ? r1.split('.') : r1.split('/').filter(Boolean);
    const s2 = isDotNotation(r2) ? r2.split('.') : r2.split('/').filter(Boolean);

    // Count shared prefix segments
    let shared = 0;
    for (let i = 0; i < Math.min(s1.length, s2.length); i++) {
      if (s1[i] === s2[i]) shared++;
      else break;
    }

    if (shared > 0) {
      // Shared prefix → high similarity (e.g., "servers.*" routes share "servers")
      return Math.min(1.0, 0.5 + (shared / Math.max(s1.length, s2.length)) * 0.5);
    }
    return 0;
  }

  // REST route comparison: segment by segment
  let matches = 0;
  const maxLen = Math.max(seg1.length, seg2.length);

  for (let i = 0; i < maxLen; i++) {
    const s1 = seg1[i] || '';
    const s2 = seg2[i] || '';

    if (s1 === s2) {
      matches++;
    } else if (s1.startsWith(':') && s2.startsWith(':')) {
      matches += 0.9;
    } else if (s1.startsWith(':') || s2.startsWith(':')) {
      matches += 0.7;
    } else if (
      s1.replace(/s$/, '') === s2.replace(/s$/, '') ||
      s2.replace(/s$/, '') === s1.replace(/s$/, '')
    ) {
      matches += 0.8;
    }
  }

  const baseSimilarity = matches / maxLen;
  const structureBonus = seg1.length === seg2.length ? 0.1 : 0;

  return Math.min(1.0, baseSimilarity + structureBonus);
}

// ────────────────────────────────────────────────────────
// Inline Tool Definitions
// ────────────────────────────────────────────────────────

/**
 * Inline tools are defined directly in this file rather than in separate modules.
 * They handle core Paradigm operations (search, ripple, related, status, gates)
 * plus infrastructure tools (plugin check, workspace reindex, tool activation).
 */
function getInlineToolDefinitions() {
  return [
    {
      name: 'paradigm_search',
      description: 'Search for Paradigm symbols by name, description, or tags. Includes fuzzy matching for typo tolerance. Returns matching symbols with names, paths, types, and descriptions. ~150 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (matches symbol names, descriptions, tags)' },
          type: { type: 'string', enum: ['component', 'flow', 'gate', 'signal', 'aspect'], description: 'Optional: filter by symbol type (v2: #component, $flow, ^gate, !signal, ~aspect)' },
          limit: { type: 'number', description: 'Maximum results to return (default: 10)' },
          fuzzy: { type: 'boolean', description: 'Enable fuzzy matching for typos (default: true)' },
          includeWorkspace: { type: 'boolean', description: 'Also search sibling workspace projects (default: false). Requires workspace configured in config.yaml.' },
          componentType: { type: 'string', description: 'Filter components by type (e.g., "view", "service", "tool"). Only applies to #component symbols.' },
          response_format: { type: 'string', enum: ['concise', 'detailed'], description: 'Response detail level. "concise" returns minimal fields to save tokens (default: "detailed")' },
        },
        required: ['query'],
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: 'paradigm_ripple',
      description: 'IMPORTANT: Call BEFORE modifying any symbol to understand impact. Shows what depends on it directly and indirectly, helping you avoid breaking changes. Returns direct and indirect dependents with file paths and dependency depth. ~300 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Symbol to analyze (e.g., @checkout, ^authenticated, $onboarding)' },
          depth: { type: 'number', description: 'How many levels of dependencies to analyze (default: 2, max: 5)' },
          includeWorkspace: { type: 'boolean', description: 'Also check sibling workspace projects for cross-project impact (default: false). Requires workspace configured in config.yaml.' },
          response_format: { type: 'string', enum: ['concise', 'detailed'], description: 'Response detail level. "concise" returns minimal fields to save tokens (default: "detailed")' },
        },
        required: ['symbol'],
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: 'paradigm_related',
      description: 'Get all symbols related to a given symbol. Call before modifying code to understand what uses this symbol and what it depends on. Returns uses/used-by lists with symbol types. ~150 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Symbol to find relations for' },
        },
        required: ['symbol'],
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: 'paradigm_status',
      description: 'Get project overview - call this at session start for orientation. Shows symbol counts, project health, and available features. Returns symbol counts by type, project health score, and feature flags. ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          response_format: { type: 'string', enum: ['concise', 'detailed'], description: 'Response detail level. "concise" returns minimal fields to save tokens (default: "detailed")' },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: 'paradigm_gates_for_route',
      description: 'Suggest which gates should be applied to a route based on patterns in the project. Returns suggested gates with confidence scores and existing patterns. ~150 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          route: { type: 'string', description: 'Route path (e.g., /api/users, /admin/settings)' },
          method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], description: 'HTTP method' },
          response_format: { type: 'string', enum: ['concise', 'detailed'], description: 'Response detail level. "concise" returns minimal fields to save tokens (default: "detailed")' },
        },
        required: ['route'],
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: 'paradigm_plugin_check',
      description: 'Check for updates to installed Claude Code plugins. Reports which marketplace clones have newer remote commits and which cached versions are stale.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: 'paradigm_workspace_reindex',
      description: 'Rebuild scan-index.json for all workspace members. Requires workspace configured in config.yaml. Returns per-member symbol counts. ~200 tokens.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    {
      name: 'paradigm_tool_activate',
      description: 'Activate an advanced-tier tool module for this session. Advanced tools are not loaded by default to reduce tool count. Call with a feature key to make its tools available. ~50 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          feature: { type: 'string', description: 'Feature key to activate (e.g., "graph", "heatmap", "pipeline", "conductor", "platform")' },
        },
        required: ['feature'],
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
  ];
}

/**
 * Register all MCP tools
 */
export function registerTools(server: Server, getContext: () => ProjectContext, reloadContext?: () => Promise<void>) {
  // Build the tool registry with all modules organized by tier
  const ctx0 = getContext();
  const registry = buildRegistry(ctx0.rootDir, reloadContext);

  // List available tools — inline tools + registry-managed tools (tiered)
  server.setRequestHandler(
    ListToolsRequestSchema,
    async () => {
      return {
        tools: [
          ...getInlineToolDefinitions(),
          ...registry.getActiveTools(),
        ],
      };
    }
  );

  // Handle tool calls
  server.setRequestHandler(
    CallToolRequestSchema,
    async (request) => {
      const { name, arguments: args } = request.params;
      addToolBreadcrumb(name, (args ?? {}) as Record<string, unknown>);
      const ctx = getContext();

      // Auto-recovery: on the first tool call of a new session, surface checkpoint/handoff data
      const tracker = getSessionTracker();
      tracker.setRootDir(ctx.rootDir);
      let recoveryPreamble: string | null = null;
      let updateNotice: string | null = null;
      if (!tracker.hasRecoveredThisSession()) {
        recoveryPreamble = await buildRecoveryPreamble(ctx.rootDir);
        updateNotice = getPluginUpdateNotice();
        schedulePluginUpdateCheck();
        tracker.markRecovered();
      }

      // Dispatch to tool handler; we'll prepend recovery preamble afterward
      const toolResult = await (async () => {

      switch (name) {
        case 'paradigm_search': {
          const { query, type, limit = 10, fuzzy = true, includeWorkspace = false, componentType, response_format: searchResponseFormat } = args as {
            query: string;
            type?: string;
            limit?: number;
            fuzzy?: boolean;
            includeWorkspace?: boolean;
            componentType?: string;
            response_format?: 'concise' | 'detailed';
          };

          const cacheKey = `search:${query}:${type || ''}:${limit}:${fuzzy}:${includeWorkspace}:${componentType || ''}`;
          let results = await toolCache.getOrCompute(cacheKey, () => {
            let r = searchSymbols(ctx.index, query);
            if (type) {
              r = r.filter(s => s.type === type);
            }
            if (componentType) {
              r = r.filter(s => s.componentType === componentType);
            }
            return r;
          });

          // If no exact results and fuzzy is enabled, try fuzzy matching
          let fuzzyMatches: Array<{ symbol: string; distance: number }> = [];
          if (results.length === 0 && fuzzy) {
            const allSymbols = getAllSymbols(ctx.index);
            const symbolNames = allSymbols.map(s => s.symbol);
            fuzzyMatches = findFuzzyMatches(query, symbolNames, { maxDistance: 3, maxResults: 5 });

            // If we found fuzzy matches, get the full symbol entries
            if (fuzzyMatches.length > 0) {
              results = fuzzyMatches
                .map(fm => allSymbols.find(s => s.symbol === fm.match))
                .filter((s): s is NonNullable<typeof s> => s != null);

              if (type) {
                results = results.filter(s => s.type === type);
              }
            }
          }

          results = results.slice(0, limit);

          const response: Record<string, unknown> = {
            query,
            count: results.length,
            results: results.map(s => ({
              symbol: s.symbol,
              type: s.type,
              description: s.description,
              filePath: s.filePath,
              ...(s.componentType ? { componentType: s.componentType } : {}),
              ...(s.parentSymbol ? { parentSymbol: s.parentSymbol } : {}),
            })),
          };

          // Include fuzzy match info if relevant
          if (fuzzyMatches.length > 0) {
            response.fuzzyMatched = true;
            response.fuzzyNote = `No exact matches for "${query}". Showing similar symbols.`;
            response.suggestions = fuzzyMatches.map(fm => ({
              symbol: fm.match,
              distance: fm.distance,
            }));
          }

          // Include workspace results if requested
          if (includeWorkspace && ctx.workspace) {
            const workspaceResults = searchWorkspace(ctx.workspace, query);
            const filtered = type
              ? workspaceResults.filter(r => r.type === type)
              : workspaceResults;

            if (filtered.length > 0) {
              response.workspaceResults = filtered.slice(0, limit).map(r => ({
                symbol: r.symbol,
                type: r.type,
                description: r.description,
                filePath: r.filePath,
                project: r.project,
              }));
              response.workspaceCount = filtered.length;
            }
          }

          // Trim response for concise mode
          if (searchResponseFormat === 'concise') {
            response.results = results.map(s => ({ symbol: s.symbol, type: s.type }));
            delete response.fuzzyMatched;
            delete response.fuzzyNote;
            delete response.suggestions;
            delete response.workspaceResults;
            delete response.workspaceCount;
          }

          const text = JSON.stringify(response, null, 2);

          trackToolCall(text.length, name);
          return {
            content: [{
              type: 'text',
              text,
            }],
          };
        }

        case 'paradigm_ripple': {
          const { symbol, depth = 2, includeWorkspace = false, response_format: rippleResponseFormat } = args as { symbol: string; depth?: number; includeWorkspace?: boolean; response_format?: 'concise' | 'detailed' };
          const entry = getSymbol(ctx.index, symbol);

          if (!entry) {
            // Fallback: grep for references when symbol isn't indexed
            const references = grepForReferences(ctx.rootDir, symbol, { maxResults: 20 });

            if (references.length === 0) {
              const text = JSON.stringify({
                error: 'Symbol not found in index',
                symbol,
                fallback: 'searched',
                referencesFound: 0,
                suggestion: 'Run `paradigm scan` to build the index, or check that .purpose files contain this symbol',
              }, null, 2);
              trackToolCall(text.length, name);
              return {
                content: [{
                  type: 'text',
                  text,
                }],
              };
            }

            // Analyze the grep results
            const filesAffected = [...new Set(references.map(r => r.filePath))];
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

            const text = JSON.stringify({
              symbol,
              status: 'not-indexed',
              fallback: 'grep-search',
              estimatedImpact,
              analysis: {
                filesAffected: filesAffected.slice(0, 10),
                totalFilesAffected: filesAffected.length,
                totalReferences: references.length,
                contextBreakdown,
                sampleReferences: references.slice(0, 5).map(r => ({
                  file: r.filePath,
                  line: r.line,
                  preview: r.content.slice(0, 100),
                })),
              },
              note: 'This is a fallback grep search. For accurate dependency analysis, run `paradigm scan` to index your project.',
              suggestion: 'Run `paradigm scan` to enable full ripple analysis with dependency tracking',
            }, null, 2);
            trackToolCall(text.length, name);
            return {
              content: [{
                type: 'text',
                text,
              }],
            };
          }

          // Clamp depth to valid range (1-5)
          const maxDepth = Math.min(Math.max(depth || 2, 1), 5);

          // Get direct dependencies
          const directDeps = getReferencesTo(ctx.index, symbol);

          // Get indirect dependencies with cycle detection (configurable depth)
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

          // Start collecting from direct deps
          collectIndirect(directDeps.map(d => d.symbol), 1);

          // Flatten all indirect deps
          const allIndirectDeps = new Set<string>();
          for (const [, syms] of indirectByLevel) {
            for (const s of syms) {
              if (s !== symbol && !directDeps.find(d => d.symbol === s)) {
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

          // Check for affected flows
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
              // Upgrade impact if flows are affected
              if (flowSummary.impactLevel === 'high' && impact === 'low') {
                impact = 'medium';
              } else if (flowSummary.impactLevel === 'high') {
                impact = 'high';
              }

              flowImpact = {
                totalFlows: flowSummary.totalFlows,
                affectedFlows: flowSummary.affectedFlows.map(f => ({
                  flowId: f.flowId,
                  impactLevel: f.downstreamSteps.length > 2 ? 'high' : 'medium',
                  reason: `Symbol is in step ${f.stepAffected.position}, affects ${f.downstreamSteps.length} downstream steps`,
                })),
                validationSuggestion: flowSummary.validationCommands.length > 0
                  ? `Run: ${flowSummary.validationCommands[0]}`
                  : undefined,
              };
            }
          }

          const response: Record<string, unknown> = {
            symbol: entry.symbol,
            type: entry.type,
            description: entry.description,
            depth: maxDepth,
            impact,
            analysis: {
              directlyAffected: directDeps.map(d => ({
                symbol: d.symbol,
                type: d.type,
                description: d.description,
              })),
              indirectlyAffected: Array.from(allIndirectDeps),
              indirectByLevel: Object.fromEntries(indirectByLevel),
              dependsOn: dependsOn.map(d => ({
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
            recommendation: impact === 'high'
              ? 'High impact change - review all affected symbols carefully before modifying'
              : impact === 'medium'
              ? 'Moderate impact - check direct dependencies for breaking changes'
              : 'Low impact - safe to modify with standard review',
          };

          // Add flow impact if present
          if (flowImpact) {
            response.affectedFlows = flowImpact;
          }

          // Check for affected personas
          try {
            const personasAffected = await getAffectedPersonas(ctx.rootDir, symbol);
            if (personasAffected.length > 0) {
              response.personas_affected = personasAffected;
              // Upgrade impact if personas are affected
              if (personasAffected.length > 2 && impact === 'low') {
                response.impact = 'medium';
              }
            }
          } catch {
            // Persona check is non-fatal
          }

          // Check for affected university content
          try {
            const universityAffected = getAffectedUniversityContent(ctx.rootDir, symbol);
            if (universityAffected.length > 0) {
              response.university_content_affected = universityAffected.map(c => ({
                id: c.id,
                title: c.title,
                type: c.type,
                stale: c.stale,
              }));
            }
          } catch {
            // University content check is non-fatal
          }

          // Check for cross-project workspace impact
          if (includeWorkspace && ctx.workspace) {
            const wsRipple = rippleWorkspace(ctx.workspace, symbol);
            if (wsRipple.length > 0) {
              response.workspaceImpact = {
                siblings: wsRipple.map(r => ({
                  project: r.project,
                  references: r.references.map(ref => ({
                    symbol: ref.symbol,
                    type: ref.type,
                    description: ref.description,
                  })),
                })),
              };
              // Upgrade impact if cross-project references exist
              const totalWsRefs = wsRipple.reduce((sum, r) => sum + r.references.length, 0);
              if (totalWsRefs > 0 && impact === 'low') {
                response.impact = 'medium';
              }
              if (totalWsRefs > 5) {
                response.impact = 'high';
              }
            }
          }

          // Trim response for concise mode
          const rippleOutput = rippleResponseFormat === 'concise'
            ? {
                symbol: response.symbol,
                impact: response.impact,
                summary: response.summary,
              }
            : response;

          const text = JSON.stringify(rippleOutput, null, 2);

          trackToolCall(text.length, name);
          return {
            content: [{
              type: 'text',
              text,
            }],
          };
        }

        case 'paradigm_related': {
          const { symbol } = args;
          const entry = getSymbol(ctx.index, symbol as string);

          if (!entry) {
            // Fallback: grep for references when symbol isn't indexed
            const references = grepForReferences(ctx.rootDir, symbol as string, { maxResults: 20 });

            if (references.length === 0) {
              const text = JSON.stringify({
                error: 'Symbol not found',
                symbol,
                fallback: 'searched',
                referencesFound: 0,
                recovery: [
                  'Run `paradigm_search` with a partial name to find similar symbols',
                  'Check `.purpose` files for symbol definitions',
                  'Use `paradigm_status` to see available symbols by type',
                  'The symbol may not be indexed yet - run `paradigm scan`',
                ],
              }, null, 2);
              trackToolCall(text.length, name);
              return {
                content: [{
                  type: 'text',
                  text,
                }],
              };
            }

            // Analyze grep results into uses/usedBy approximation
            const filesAffected = [...new Set(references.map(r => r.filePath))];
            const purposeRefs = references.filter(r => r.context === 'purpose');
            const codeRefs = references.filter(r => r.context === 'code');

            const text = JSON.stringify({
              symbol,
              status: 'not-indexed',
              fallback: 'grep-search',
              note: 'Approximate relationships from grep — run `paradigm scan` for accurate graph data.',
              usedBy: filesAffected.slice(0, 10).map(f => ({
                file: f,
                references: references.filter(r => r.filePath === f).length,
              })),
              uses: [],
              summary: {
                totalFiles: filesAffected.length,
                totalReferences: references.length,
                purposeFileRefs: purposeRefs.length,
                codeRefs: codeRefs.length,
              },
              suggestion: 'Run `paradigm scan` to enable full relationship tracking',
            }, null, 2);
            trackToolCall(text.length, name);
            return {
              content: [{
                type: 'text',
                text,
              }],
            };
          }

          const referencesTo = getReferencesTo(ctx.index, symbol);
          const referencesFrom = getReferencesFrom(ctx.index, symbol);

          const text = JSON.stringify({
            symbol: entry.symbol,
            type: entry.type,
            description: entry.description,
            usedBy: referencesTo.map(s => ({
              symbol: s.symbol,
              type: s.type,
              description: s.description,
            })),
            uses: referencesFrom.map(s => ({
              symbol: s.symbol,
              type: s.type,
              description: s.description,
            })),
          }, null, 2);

          trackToolCall(text.length, name);
          return {
            content: [{
              type: 'text',
              text,
            }],
          };
        }

        case 'paradigm_status': {
          const statusResponseFormat = (args as { response_format?: 'concise' | 'detailed' }).response_format;
          const text = await toolCache.getOrCompute('status', async () => {
            const counts = getSymbolCounts(ctx.index);
            const total = Object.values(counts).reduce((a, b) => a + b, 0);

            // Get some example symbols for each type
            const examples: Record<string, string[]> = {};
            for (const type of Object.keys(counts) as Array<keyof typeof counts>) {
              const symbols = getSymbolsByType(ctx.index, type);
              examples[type] = symbols.slice(0, 3).map(s => s.symbol);
            }

            // Detect OS for terminal command guidance
            const platform = os.platform();
            const isWindows = platform === 'win32';
            const shell = isWindows ? 'PowerShell/CMD' : (platform === 'darwin' ? 'zsh/bash' : 'bash');

            // Load protocol health (non-fatal)
            let protocols: { total: number; current: number; stale: number; broken: number } | undefined;
            try {
              const protocolIndex = await loadProtocolIndex(ctx.rootDir);
              if (protocolIndex && protocolIndex.health.total > 0) {
                protocols = protocolIndex.health;
              }
            } catch {
              // Protocol health is optional
            }

            // Build component type breakdown
            const allComponents = getSymbolsByType(ctx.index, 'component');
            const componentTypeBreakdown: Record<string, number> = {};
            for (const comp of allComponents) {
              if (comp.componentType) {
                componentTypeBreakdown[comp.componentType] = (componentTypeBreakdown[comp.componentType] || 0) + 1;
              }
            }
            const untypedCount = allComponents.filter(c => !c.componentType).length;

            // Compute purpose health score (non-fatal)
            let purposeHealthScore: number | undefined;
            try {
              const { checkPurposeHealth } = await import('../utils/integrity-checker.js');
              const healthReport = checkPurposeHealth(ctx.aggregation.purposeFiles, ctx.rootDir);
              purposeHealthScore = healthReport.healthScore;
            } catch {
              // Health check is optional
            }

            return JSON.stringify({
              project: ctx.projectName,
              symbolSystem: 'v2',
              counts: {
                '# components': counts.component,
                '$ flows': counts.flow,
                '^ gates': counts.gate,
                '! signals': counts.signal,
                '~ aspects': counts.aspect,
              },
              total,
              ...(Object.keys(componentTypeBreakdown).length > 0 ? {
                componentTypes: {
                  ...componentTypeBreakdown,
                  ...(untypedCount > 0 ? { '(untyped)': untypedCount } : {}),
                },
              } : {}),
              examples,
              hasPortalYaml: ctx.gateConfig !== null,
              purposeFiles: ctx.aggregation.purposeFiles.length,
              ...(purposeHealthScore !== undefined ? { purposeHealthScore } : {}),
              ...(protocols ? { protocols } : {}),
              note: 'Symbol System v2: Use tags [feature], [state], [integration], [idea] for classification. Use type field for structural role (view, service, tool, etc.)',
              environment: {
                os: platform,
                shell,
                terminalNote: isWindows
                  ? 'Use PowerShell syntax: semicolons for command chaining, backslashes for paths, $env:VAR for env vars'
                  : 'Use Unix syntax: && for command chaining, forward slashes for paths, $VAR for env vars',
              },
            }, null, 2);
          });

          // Trim for concise mode (post-cache to avoid cache key complexity)
          let statusText = text;
          if (statusResponseFormat === 'concise') {
            try {
              const parsed = JSON.parse(text);
              statusText = JSON.stringify({
                project: parsed.project,
                counts: parsed.counts,
                total: parsed.total,
              }, null, 2);
            } catch {
              // Fall through with full text if parse fails
            }
          }

          trackToolCall(statusText.length, name);
          return {
            content: [{
              type: 'text',
              text: statusText,
            }],
          };
        }

        case 'paradigm_gates_for_route': {
          const { route, response_format: gatesResponseFormat } = args as { route: string; method?: string; response_format?: 'concise' | 'detailed' };
          // For tRPC-style routes (dot notation), method is meaningless — all are POST
          const isTrpc = typeof route === 'string' && !route.includes('/') && route.includes('.');
          const method = isTrpc ? 'POST' : ((args as any).method || 'GET');

          // Get all gates
          const gates = getSymbolsByType(ctx.index, 'gate');

          // Enhanced heuristic-based suggestions with ownership detection
          const suggestions: Array<{ gate: string; reason: string; confidence: 'high' | 'medium' | 'low'; source?: string }> = [];

          // Learn from portal.yaml if available
          const learnedPatterns: Array<{ route: string; gates: string[]; method?: string; source?: string }> = [];
          if (ctx.gateConfig?.routes) {
            for (const [routePattern, routeConfig] of Object.entries(ctx.gateConfig.routes)) {
              if (routeConfig.gates) {
                learnedPatterns.push({
                  route: routePattern,
                  gates: routeConfig.gates,
                  method: routeConfig.method,
                });
              }
            }
          }

          // Learn from workspace sibling portal.yaml files
          if (ctx.workspace) {
            for (const [memberName, sibling] of ctx.workspace.siblingIndices) {
              const siblingGateConfig = sibling.gateConfig as Record<string, unknown> | null;
              if (siblingGateConfig?.routes) {
                for (const [routePattern, routeConfig] of Object.entries(siblingGateConfig.routes as Record<string, unknown>)) {
                  const rc = routeConfig as { gates?: string[]; method?: string } | string[];
                  const gatesList = Array.isArray(rc) ? rc : rc?.gates;
                  if (gatesList) {
                    learnedPatterns.push({
                      route: routePattern,
                      gates: gatesList as string[],
                      method: Array.isArray(rc) ? undefined : rc?.method,
                      source: memberName,
                    });
                  }
                }
              }
            }
          }

          // Find similar routes from portal.yaml (local + workspace siblings) and suggest their gates
          for (const pattern of learnedPatterns) {
            const similarity = calculateRouteSimilarity(route as string, pattern.route);
            if (similarity >= 0.6) {
              // Method matches or not specified
              if (!pattern.method || pattern.method === method) {
                for (const gateName of pattern.gates) {
                  const gate = gates.find(g => g.symbol === gateName || g.symbol === `^${gateName}`);
                  if (gate && !suggestions.find(s => s.gate === gate.symbol)) {
                    const patternSource = pattern.source
                      ? `${pattern.source}/portal.yaml`
                      : 'portal.yaml';
                    suggestions.push({
                      gate: gate.symbol,
                      reason: `Similar route "${pattern.route}" uses this gate`,
                      confidence: similarity >= 0.8 ? 'high' : 'medium',
                      source: patternSource,
                    });
                  }
                }
              }
            }
          }

          // Extract resource name from route (e.g., /api/notes/:id -> note)
          const routeParts = (route as string).split('/').filter(Boolean);
          const resourceMatch = routeParts.find(p => !p.startsWith(':') && p !== 'api');
          const resourceName = resourceMatch?.replace(/s$/, '') || ''; // notes -> note

          // Check for resource ID routes (e.g., /api/notes/:id) - suggest ownership gate
          const hasResourceId = (route as string).match(/\/:(id|[a-z]+Id)($|\/)/i);
          if (hasResourceId && resourceName) {
            // Look for ownership gates: ^{resource}-owner, ^owner, ^resource-access
            const ownerGate = gates.find(g => {
              const sym = g.symbol.toLowerCase();
              const desc = (g.description || '').toLowerCase();
              return (
                sym.includes(`${resourceName}-owner`) ||
                sym.includes('owner') ||
                sym.includes('ownership') ||
                desc.includes('owner') ||
                desc.includes('ownership') ||
                desc.includes('belongs to')
              );
            });
            if (ownerGate) {
              suggestions.push({
                gate: ownerGate.symbol,
                reason: `Resource ID route (${resourceName}) typically needs ownership verification`,
                confidence: 'high',
              });
            } else {
              // No ownership gate exists, suggest creating one
              suggestions.push({
                gate: `^${resourceName}-owner`,
                reason: `Consider adding ownership gate for ${resourceName} resource`,
                confidence: 'medium',
              });
            }
          }

          // Check for admin routes
          if ((route as string).includes('/admin') || (route as string).includes('/settings')) {
            const adminGate = gates.find(g =>
              g.symbol.includes('admin') || g.description?.toLowerCase().includes('admin')
            );
            if (adminGate) {
              suggestions.push({
                gate: adminGate.symbol,
                reason: 'Route appears to be admin-related',
                confidence: 'high',
              });
            }
          }

          // Check for authenticated routes (most API routes)
          if ((route as string).startsWith('/api/') || (route as string).includes('/user') || (route as string).includes('/account')) {
            const authGate = gates.find(g =>
              g.symbol.includes('authenticated') || g.symbol.includes('auth')
            );
            if (authGate) {
              suggestions.push({
                gate: authGate.symbol,
                reason: 'API/user routes typically require authentication',
                confidence: 'high',
              });
            }
          }

          // Suggest subscription gate for premium-looking routes
          if ((route as string).includes('/premium') || (route as string).includes('/pro') || (route as string).includes('/export')) {
            const subGate = gates.find(g =>
              g.symbol.includes('subscription') || g.symbol.includes('premium')
            );
            if (subGate) {
              suggestions.push({
                gate: subGate.symbol,
                reason: 'Route appears to be a premium feature',
                confidence: 'medium',
              });
            }
          }

          // DELETE operations need extra care - ownership + auth
          if (method === 'DELETE') {
            // Ownership already handled above for :id routes
            const authGate = gates.find(g => g.symbol.includes('authenticated'));
            if (authGate && !suggestions.find(s => s.gate === authGate.symbol)) {
              suggestions.push({
                gate: authGate.symbol,
                reason: 'DELETE operations require authentication',
                confidence: 'high',
              });
            }
          }

          // Other write operations should have auth
          if (['POST', 'PUT', 'PATCH'].includes(method as string)) {
            const authGate = gates.find(g => g.symbol.includes('authenticated'));
            if (authGate && !suggestions.find(s => s.gate === authGate.symbol)) {
              suggestions.push({
                gate: authGate.symbol,
                reason: 'Write operations typically require authentication',
                confidence: 'high',
              });
            }
          }

          // Deduplicate suggestions by gate
          const seenGates = new Set<string>();
          const dedupedSuggestions = suggestions.filter(s => {
            if (seenGates.has(s.gate)) return false;
            seenGates.add(s.gate);
            return true;
          });

          // Build response based on format
          const gatesOutput = gatesResponseFormat === 'concise'
            ? {
                suggestions: dedupedSuggestions.map(s => ({
                  gate: s.gate,
                  confidence: s.confidence,
                })),
              }
            : {
                route,
                method,
                suggestions: dedupedSuggestions,
                availableGates: gates.map(g => ({
                  symbol: g.symbol,
                  description: g.description,
                })),
                note: hasResourceId
                  ? 'Resource ID routes should verify the user owns/has access to the specific resource.'
                  : 'These are suggestions based on route patterns. Review your portal.yaml for exact requirements.',
              };

          const text = JSON.stringify(gatesOutput, null, 2);

          trackToolCall(text.length, name);
          try { emitAndProcess(ctx.rootDir, { type: 'gate-checked', source: 'mcp-tool-call', tool: 'paradigm_gates_for_route', symbols: dedupedSuggestions.map(s => s.gate), context: `Gate check for ${method} ${route}` }); } catch {}
          return {
            content: [{
              type: 'text',
              text,
            }],
          };
        }

        case 'paradigm_plugin_check': {
          const { runPluginUpdateCheck } = await import('../utils/plugin-update-checker.js');
          const results = await runPluginUpdateCheck();
          const updatable = results.filter(r => r.hasRemoteUpdate || r.hasCacheStale);

          if (updatable.length === 0) {
            const msg = results.length === 0
              ? 'No Claude Code plugins found in ~/.claude/plugins/marketplaces/.'
              : 'All installed plugins are up to date.';
            trackToolCall(msg.length, name);
            return { content: [{ type: 'text', text: msg }] };
          }

          const lines = ['Plugin updates available:\n'];
          const pullCmds: string[] = [];
          for (const r of updatable) {
            if (r.hasRemoteUpdate) {
              lines.push(`  ${r.plugin} (${r.repo}): remote has newer commits`);
              pullCmds.push(`git -C ${r.marketplacePath} pull origin main`);
            } else if (r.hasCacheStale) {
              lines.push(`  ${r.plugin} (${r.repo}): ${r.installedVersion} → ${r.localVersion} (restart needed)`);
            }
          }
          if (pullCmds.length > 0) {
            lines.push(`\nUpdate command:\n  ${pullCmds.join(' && \\\n  ')}`);
            lines.push('\nAfter running, restart the session to apply updates.');
          } else {
            lines.push('\nRestart the session to apply cached updates.');
          }
          const pluginText = lines.join('\n');
          trackToolCall(pluginText.length, name);
          return { content: [{ type: 'text', text: pluginText }] };
        }

        case 'paradigm_workspace_reindex': {
          if (!ctx.workspace) {
            const noWsText = JSON.stringify({
              error: 'No workspace configured',
              suggestion: 'Add a "workspace" field to .paradigm/config.yaml pointing to your .paradigm-workspace file, then run `paradigm workspace init` to create one.',
            }, null, 2);
            trackToolCall(noWsText.length, name);
            return { content: [{ type: 'text', text: noWsText }] };
          }

          const { rebuildStaticFiles } = await import('./reindex.js');
          const memberResults: Array<{ name: string; symbolCount: number; status: string }> = [];

          for (const member of ctx.workspace.config.members) {
            const memberAbsPath = path.resolve(path.dirname(ctx.workspace.workspacePath), member.path);
            try {
              const result = await rebuildStaticFiles(memberAbsPath);
              memberResults.push({
                name: member.name,
                symbolCount: result.symbolCount,
                status: 'ok',
              });
            } catch (e) {
              memberResults.push({
                name: member.name,
                symbolCount: 0,
                status: `error: ${(e as Error).message}`,
              });
            }
          }

          const wsReindexText = JSON.stringify({
            action: 'workspace_reindex',
            workspace: ctx.workspace.config.name,
            members: memberResults,
            totalSymbols: memberResults.reduce((s, m) => s + m.symbolCount, 0),
          }, null, 2);

          trackToolCall(wsReindexText.length, name);
          toolCache.clear();
          return { content: [{ type: 'text', text: wsReindexText }] };
        }

        case 'paradigm_tool_activate': {
          const feature = (args as { feature: string }).feature;
          // Try activating an advanced-tier module via the registry
          const activated = registry.activateAdvanced(feature);
          if (activated) {
            const text = JSON.stringify({
              action: 'tool_activate',
              feature,
              status: 'activated',
              toolsAdded: activated.map(t => t.name),
              note: `Advanced module "${feature}" activated for this session. ${activated.length} tool(s) now available.`,
            }, null, 2);
            trackToolCall(text.length, name);
            return { content: [{ type: 'text', text }] };
          }
          // Feature not found or not advanced tier — check if it's already loaded
          const info = registry.getRegistryInfo();
          const isActive = info.activeFeatures.includes(feature);
          const text = JSON.stringify({
            action: 'tool_activate',
            feature,
            status: isActive ? 'already_active' : 'not_found',
            note: isActive
              ? `Module "${feature}" is already active (auto-detected or core tier).`
              : `Module "${feature}" not found. Available advanced modules: ${info.availableAdvanced.join(', ') || '(none)'}`,
            availableAdvanced: info.availableAdvanced,
          }, null, 2);
          trackToolCall(text.length, name);
          return { content: [{ type: 'text', text }] };
        }

        default: {
          // ── Registry-based dispatch ────────────────────────
          // All non-inline tools are dispatched through the ToolRegistry.
          // This replaces the previous O(n) if-chain with Map-based lookup.
          const result = await registry.dispatch(name, args as Record<string, unknown>, ctx);

          if (result && result.handled) {
            // Track tool call (skip context tools to avoid recursion)
            const isContextTool = name.startsWith('paradigm_context_') || name.startsWith('paradigm_session_') || name === 'paradigm_handoff_prepare';
            if (!isContextTool) {
              trackToolCall(result.text.length, name);
            }

            // Post-dispatch event emission for tools that generate events
            emitPostDispatchEvents(name, args as Record<string, unknown>, ctx.rootDir);

            return {
              content: [{ type: 'text', text: result.text }],
            };
          }

          throw new Error(`Unknown tool: ${name}`);
        }
      }

      })(); // end IIFE for tool dispatch

      // Prepend recovery preamble and/or plugin update notice to the first tool response
      if (recoveryPreamble || updateNotice) {
        const first = toolResult.content?.[0];
        if (first && typeof first === 'object' && 'text' in first && typeof first.text === 'string') {
          const preamble = [updateNotice, recoveryPreamble].filter(Boolean).join('\n\n');
          first.text = preamble + '\n\n' + first.text;
        }
      }

      return toolResult;
    }
  );
}

// ────────────────────────────────────────────────────────
// Post-Dispatch Event Emission
// ────────────────────────────────────────────────────────

/**
 * Emit nomination/event-stream events after certain tool calls succeed.
 * These were previously inline in each if-branch; now centralized.
 * All emissions are fire-and-forget (non-fatal).
 */
function emitPostDispatchEvents(name: string, args: Record<string, unknown>, rootDir: string): void {
  try {
    switch (name) {
      case 'paradigm_sentinel_record':
        emitAndProcess(rootDir, {
          type: 'error-encountered', source: 'mcp-tool-call', tool: name,
          severity: (args.severity as string) || 'warning',
          context: `Sentinel: ${args.title || args.summary || 'incident recorded'}`,
        });
        break;

      case 'paradigm_lore_record':
        emitAndProcess(rootDir, {
          type: 'work-completed', source: 'mcp-tool-call', tool: name,
          symbols: Array.isArray(args.symbols_touched) ? args.symbols_touched.map(String) : [],
          context: `Lore recorded: ${args.title || 'untitled'}`,
        });
        break;

      case 'paradigm_work_log_record':
      case 'paradigm_journal_record':
        emitAndProcess(rootDir, {
          type: 'work-completed', source: 'mcp-tool-call', tool: name,
          symbols: Array.isArray(args.symbols) ? args.symbols.map(String) : [],
          context: `Work logged: ${args.summary || args.title || 'entry'}`,
        });
        break;

      case 'paradigm_decision_record':
        emitAndProcess(rootDir, {
          type: 'decision-made', source: 'mcp-tool-call', tool: name,
          symbols: Array.isArray(args.symbols) ? args.symbols.map(String) : [],
          context: `Decision: ${args.title || args.summary || 'recorded'}`,
        });
        break;

      case 'paradigm_persona_run':
        emitAndProcess(rootDir, {
          type: 'work-completed', source: 'mcp-tool-call', tool: name,
          context: `Persona run: ${args.persona || 'unknown'}`,
        });
        break;

      case 'paradigm_protocol_record':
        emitAndProcess(rootDir, {
          type: 'work-completed', source: 'mcp-tool-call', tool: name,
          context: `Protocol recorded: ${args.name || args.id || 'unknown'}`,
        });
        break;

      case 'paradigm_reindex':
        emitAndProcess(rootDir, {
          type: 'work-completed', source: 'mcp-tool-call', tool: name,
          context: 'Index rebuilt',
        }, { skipNominations: true });
        break;

      default:
        // Purpose/portal file modification events
        if ((name.startsWith('paradigm_purpose_') || name.startsWith('paradigm_portal_')) &&
            (name.includes('_add_') || name.includes('_update_') || name.includes('_remove_'))) {
          emitAndProcess(rootDir, {
            type: 'file-modified', source: 'mcp-tool-call', tool: name,
            symbols: args.id ? [`#${args.id}`] : args.symbol ? [String(args.symbol)] : [],
            context: `Purpose/portal update via ${name}`,
          });
        }
        break;
    }
  } catch {
    // Event emission is non-fatal — never block the tool response
  }
}
