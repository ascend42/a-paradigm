/**
 * MCP Tools - Actions AI can invoke on Paradigm data
 */

import * as os from 'os';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
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
import { getPluginUpdateNotice, schedulePluginUpdateCheck } from '../utils/plugin-update-checker.js';
import { grepForReferences, FallbackReference } from './fallback-grep.js';
import { findFuzzyMatches, isValidSymbolFormat } from './fuzzy-match.js';
import { loadFlowIndex, getFlowImpactSummary } from '../utils/flow-loader.js';

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

  // Split into segments
  const seg1 = r1.split('/').filter(Boolean);
  const seg2 = r2.split('/').filter(Boolean);

  // Compare segment by segment
  let matches = 0;
  let paramMatches = 0;
  const maxLen = Math.max(seg1.length, seg2.length);

  for (let i = 0; i < maxLen; i++) {
    const s1 = seg1[i] || '';
    const s2 = seg2[i] || '';

    if (s1 === s2) {
      // Exact segment match
      matches++;
    } else if (s1.startsWith(':') && s2.startsWith(':')) {
      // Both are parameters
      matches += 0.9;
      paramMatches++;
    } else if (s1.startsWith(':') || s2.startsWith(':')) {
      // One is a parameter - partial match
      matches += 0.7;
      paramMatches++;
    } else if (
      // Check for resource plural/singular match (e.g., notes vs note)
      s1.replace(/s$/, '') === s2.replace(/s$/, '') ||
      s2.replace(/s$/, '') === s1.replace(/s$/, '')
    ) {
      matches += 0.8;
    }
  }

  // Calculate base similarity
  const baseSimilarity = matches / maxLen;

  // Bonus for having the same structure (same number of segments)
  const structureBonus = seg1.length === seg2.length ? 0.1 : 0;

  return Math.min(1.0, baseSimilarity + structureBonus);
}

/**
 * Register all MCP tools
 */
export function registerTools(server: Server, getContext: () => ProjectContext, reloadContext?: () => Promise<void>) {
  // List available tools
  server.setRequestHandler(
    ListToolsRequestSchema,
    async () => {
      return {
        tools: [
          {
            name: 'paradigm_search',
            description: 'Search for Paradigm symbols by name, description, or tags. Includes fuzzy matching for typo tolerance.',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query (matches symbol names, descriptions, tags)',
                },
                type: {
                  type: 'string',
                  enum: ['component', 'flow', 'gate', 'signal', 'aspect'],
                  description: 'Optional: filter by symbol type (v2: #component, $flow, ^gate, !signal, ~aspect)',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum results to return (default: 10)',
                },
                fuzzy: {
                  type: 'boolean',
                  description: 'Enable fuzzy matching for typos (default: true)',
                },
              },
              required: ['query'],
            },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
            },
          },
          {
            name: 'paradigm_ripple',
            description: 'IMPORTANT: Call BEFORE modifying any symbol to understand impact. Shows what depends on it directly and indirectly, helping you avoid breaking changes.',
            inputSchema: {
              type: 'object',
              properties: {
                symbol: {
                  type: 'string',
                  description: 'Symbol to analyze (e.g., @checkout, ^authenticated, $onboarding)',
                },
                depth: {
                  type: 'number',
                  description: 'How many levels of dependencies to analyze (default: 2, max: 5)',
                },
              },
              required: ['symbol'],
            },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
            },
          },
          {
            name: 'paradigm_related',
            description: 'Get all symbols related to a given symbol. Call before modifying code to understand what uses this symbol and what it depends on.',
            inputSchema: {
              type: 'object',
              properties: {
                symbol: {
                  type: 'string',
                  description: 'Symbol to find relations for',
                },
              },
              required: ['symbol'],
            },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
            },
          },
          {
            name: 'paradigm_status',
            description: 'Get project overview - call this at session start for orientation. Shows symbol counts, project health, and available features.',
            inputSchema: {
              type: 'object',
              properties: {},
            },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
            },
          },
          {
            name: 'paradigm_gates_for_route',
            description: 'Suggest which gates should be applied to a route based on patterns in the project',
            inputSchema: {
              type: 'object',
              properties: {
                route: {
                  type: 'string',
                  description: 'Route path (e.g., /api/users, /admin/settings)',
                },
                method: {
                  type: 'string',
                  enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
                  description: 'HTTP method',
                },
              },
              required: ['route'],
            },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
            },
          },
          // Wisdom tools
          ...getWisdomToolsList(),
          // History tools
          ...getHistoryToolsList(),
          // Navigate tools
          ...getNavigateToolsList(),
          // Context tracking tools
          ...getContextToolsList(),
          // Sentinel tools
          ...getSentinelToolsList(),
          // Flow tools
          ...getFlowsToolsList(),
          // Fixtures tools
          ...getFixturesToolsList(),
          // Orchestration tools
          ...getOrchestrationToolsList(),
          // Tags tools (v2 symbol system)
          ...getTagsToolsList(),
          // Purpose & Portal file management tools
          ...getPurposePortalToolsList(),
          // PM governance tools
          ...getPmToolsList(),
          // Reindex tool
          ...getReindexToolsList(),
          // Lore tools
          ...getLoreToolsList(),
          // Habits tools
          ...getHabitsToolsList(),
          // Plugin update check
          {
            name: 'paradigm_plugin_check',
            description: 'Check for updates to installed Claude Code plugins. Reports which marketplace clones have newer remote commits and which cached versions are stale.',
            inputSchema: {
              type: 'object',
              properties: {},
            },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
            },
          },
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
        recoveryPreamble = buildRecoveryPreamble(ctx.rootDir);
        updateNotice = getPluginUpdateNotice();
        schedulePluginUpdateCheck();
        tracker.markRecovered();
      }

      // Dispatch to tool handler; we'll prepend recovery preamble afterward
      const toolResult = await (async () => {

      switch (name) {
        case 'paradigm_search': {
          const { query, type, limit = 10, fuzzy = true } = args as {
            query: string;
            type?: string;
            limit?: number;
            fuzzy?: boolean;
          };

          let results = searchSymbols(ctx.index, query);

          if (type) {
            results = results.filter(s => s.type === type);
          }

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
          const { symbol, depth = 2 } = args as { symbol: string; depth?: number };
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

          const text = JSON.stringify(response, null, 2);

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
            const text = JSON.stringify({
              error: 'Symbol not found',
              symbol,
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

          const text = JSON.stringify({
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
            examples,
            hasPortalYaml: ctx.gateConfig !== null,
            purposeFiles: ctx.aggregation.purposeFiles.length,
            note: 'Symbol System v2: Use tags [feature], [state], [integration], [idea] for classification',
            environment: {
              os: platform,
              shell,
              terminalNote: isWindows
                ? 'Use PowerShell syntax: semicolons for command chaining, backslashes for paths, $env:VAR for env vars'
                : 'Use Unix syntax: && for command chaining, forward slashes for paths, $VAR for env vars',
            },
          }, null, 2);

          trackToolCall(text.length, name);
          return {
            content: [{
              type: 'text',
              text,
            }],
          };
        }

        case 'paradigm_gates_for_route': {
          const { route, method = 'GET' } = args;

          // Get all gates
          const gates = getSymbolsByType(ctx.index, 'gate');

          // Enhanced heuristic-based suggestions with ownership detection
          const suggestions: Array<{ gate: string; reason: string; confidence: 'high' | 'medium' | 'low'; source?: string }> = [];

          // Learn from portal.yaml if available
          const learnedPatterns: Array<{ route: string; gates: string[]; method?: string }> = [];
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

          // Find similar routes from portal.yaml and suggest their gates
          for (const pattern of learnedPatterns) {
            const similarity = calculateRouteSimilarity(route as string, pattern.route);
            if (similarity >= 0.6) {
              // Method matches or not specified
              if (!pattern.method || pattern.method === method) {
                for (const gateName of pattern.gates) {
                  const gate = gates.find(g => g.symbol === gateName || g.symbol === `^${gateName}`);
                  if (gate && !suggestions.find(s => s.gate === gate.symbol)) {
                    suggestions.push({
                      gate: gate.symbol,
                      reason: `Similar route "${pattern.route}" uses this gate`,
                      confidence: similarity >= 0.8 ? 'high' : 'medium',
                      source: 'portal.yaml',
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

          const text = JSON.stringify({
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
          }, null, 2);

          trackToolCall(text.length, name);
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

        default: {
          // Try navigate tool
          if (name === 'paradigm_navigate') {
            const result = await handleNavigateTool(name, args as Record<string, unknown>, ctx);
            if (result.handled) {
              trackToolCall(result.text.length, name);
              return {
                content: [{ type: 'text', text: result.text }],
              };
            }
          }

          // Try wisdom tools
          if (name.startsWith('paradigm_wisdom_')) {
            const result = await handleWisdomTool(name, args as Record<string, unknown>, ctx);
            if (result.handled) {
              trackToolCall(result.text.length, name);
              return {
                content: [{ type: 'text', text: result.text }],
              };
            }
          }

          // Try history tools
          if (name.startsWith('paradigm_history_')) {
            const result = await handleHistoryTool(name, args as Record<string, unknown>, ctx);
            if (result.handled) {
              trackToolCall(result.text.length, name);
              return {
                content: [{ type: 'text', text: result.text }],
              };
            }
          }

          // Try context tools
          if (name.startsWith('paradigm_context_') || name.startsWith('paradigm_session_') || name === 'paradigm_handoff_prepare') {
            const result = await handleContextTool(name, args as Record<string, unknown>, ctx);
            if (result.handled) {
              // Don't track context tools to avoid recursion
              return {
                content: [{ type: 'text', text: result.text }],
              };
            }
          }

          // Try sentinel tools
          if (name.startsWith('paradigm_sentinel_')) {
            const result = await handleSentinelTool(name, args as Record<string, unknown>, ctx);
            if (result.handled) {
              trackToolCall(result.text.length, name);
              return {
                content: [{ type: 'text', text: result.text }],
              };
            }
          }

          // Try flow tools
          if (name === 'paradigm_flows_affected' || name === 'paradigm_flow_validate') {
            const result = await handleFlowTool(name, args as Record<string, unknown>, ctx);
            if (result.handled) {
              trackToolCall(result.text.length, name);
              return {
                content: [{ type: 'text', text: result.text }],
              };
            }
          }

          // Try fixtures tools
          if (name === 'paradigm_test_fixtures') {
            const result = await handleFixturesTool(name, args as Record<string, unknown>, ctx);
            if (result.handled) {
              trackToolCall(result.text.length, name);
              return {
                content: [{ type: 'text', text: result.text }],
              };
            }
          }

          // Try orchestration tools
          if (name.startsWith('paradigm_orchestrate') || name === 'paradigm_agent_prompt') {
            const result = await handleOrchestrationTool(name, args as Record<string, unknown>, ctx);
            if (result.handled) {
              // trackToolCall is handled inside the orchestration tool handlers
              return {
                content: [{ type: 'text', text: result.text }],
              };
            }
          }

          // Try tags tools (v2 symbol system)
          if (name.startsWith('paradigm_tags') || name === 'paradigm_aspect_check') {
            const result = await handleTagsTool(name, args as Record<string, unknown>, ctx);
            if (result.handled) {
              trackToolCall(result.text.length, name);
              return {
                content: [{ type: 'text', text: result.text }],
              };
            }
          }

          // Try PM governance tools
          if (name.startsWith('paradigm_pm_')) {
            const result = await handlePmTool(name, args as Record<string, unknown>, ctx);
            if (result.handled) {
              trackToolCall(result.text.length, name);
              return {
                content: [{ type: 'text', text: result.text }],
              };
            }
          }

          // Try purpose & portal file management tools
          if (name.startsWith('paradigm_purpose_') || name.startsWith('paradigm_portal_')) {
            const reload = reloadContext || (async () => {});
            const result = await handlePurposePortalTool(name, args as Record<string, unknown>, ctx, reload);
            if (result.handled) {
              trackToolCall(result.text.length, name);
              return {
                content: [{ type: 'text', text: result.text }],
              };
            }
          }

          // Try lore tools
          if (name.startsWith('paradigm_lore_')) {
            const result = await handleLoreTool(name, args as Record<string, unknown>, ctx);
            if (result.handled) {
              trackToolCall(result.text.length, name);
              return {
                content: [{ type: 'text', text: result.text }],
              };
            }
          }

          // Try habits tools
          if (name.startsWith('paradigm_habits_') || name === 'paradigm_practice_context') {
            const result = await handleHabitsTool(name, args as Record<string, unknown>, ctx);
            if (result.handled) {
              trackToolCall(result.text.length, name);
              return {
                content: [{ type: 'text', text: result.text }],
              };
            }
          }

          // Try reindex tool
          if (name === 'paradigm_reindex') {
            const reload = reloadContext || (async () => {});
            const result = await handleReindexTool(name, args as Record<string, unknown>, ctx, reload);
            if (result.handled) {
              return {
                content: [{ type: 'text', text: result.text }],
              };
            }
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
