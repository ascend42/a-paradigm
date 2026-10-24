/**
 * MCP Tools - Actions AI can invoke on Paradigm data
 *
 * 7.13 surface cut: tools/list = 11 anchors + 21 op families (+ on-demand
 * families when enabled/activated). Every pre-7.13 name stays callable as a
 * hidden alias (see legacy-tool-map.ts); family calls resolve to the canonical
 * legacy name before dispatch, so handlers run unchanged.
 *
 * Uses ToolRegistry for tiered tool listing and Map-based dispatch.
 * Inline tools (search, related, status, gates_for_route, plugin_check,
 * workspace_reindex, tool_activate) are handled directly in the switch statement.
 * Ripple analysis is in tools/ripple.ts (core-tier registry module).
 * All other tools are dispatched through the registry.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  resolveSymbol,
  searchSymbols,
  getReferencesTo,
  getReferencesFrom,
  getSymbolsByType,
  getAllSymbols,
  getSymbolCounts,
} from '@a-company/premise-core';
import { refreshContextSafely, type ProjectContext, type ReloadContextFn } from '../utils/index-loader.js';
import { ToolRegistry, type ToolModule, type ToolDefinition, toListedTool, readMcpToolsConfig, FEATURE_DETECTORS } from '../utils/tool-registry.js';
import { defineFamily, familyOpsFromMap, isDeprecatedAlias, compactDefinition, ANCHOR_DESC_MAX, ANCHOR_PROP_DESC_MAX, type ToolFamily } from '../utils/tool-family.js';
import { LEGACY_TOOL_MAP } from './legacy-tool-map.js';
import { ANCHOR_TOOLS, DEFAULT_FAMILIES, FAMILY_META, ON_DEMAND, findOnDemand } from './families.js';
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
import { getPersonaToolsList, handlePersonaTool } from './personas.js';
import { getProtocolsToolsList, handleProtocolsTool } from './protocols.js';
import { getClassroomToolsList, handleClassroomTool } from './classroom.js';
import { getGraphToolsList, handleGraphTool } from './graph.js';
import { getPipelineToolsList, handlePipelineTool } from './pipeline.js';
import { getConductorToolsList, handleConductorTool } from './conductor.js';
import { getSymphonyToolsList, handleSymphonyTool } from './symphony.js';
import { getUniversityToolsList, handleUniversityTool } from './university.js';
import { getBrainToolsList, handleBrainTool, brainFamilyAvailable } from './brain.js';
import { getPlatformToolsList, handlePlatformTool } from './platform.js';
import { getAgentToolsList, handleAgentTool } from './agents.js';
import { getAuthorityToolsList, handleAuthorityTool } from './authority.js';
import { getProposeBlockToolsList, handleProposeBlockTool } from './propose-block.js';
import { getNotebookToolsList, handleNotebookTool } from './notebooks.js';
import { getDocsToolsList, handleDocsTool } from './docs.js';
import { getRippleToolsList, handleRippleTool } from './ripple.js';
import { getSpillToolsList, handleSpillTool } from './spill.js';
import { getCaptainToolsList, handleCaptainTool } from './captain.js';
import { getStreamsToolsList, handleStreamsTool } from './streams.js';
import { getAmbientToolsList, handleAmbientTool } from './ambient.js';
import { getEnforcementToolsList, handleEnforcementTool } from './enforcement.js';
import { getArchToolsList, handleArchTool } from './arch.js';
import { getAssessmentToolsList, handleAssessmentTool } from './assessment.js';
import { getLoopsToolsList, handleLoopsTool } from './loops.js';
import { ARCH_FILE } from '../utils/arch-loader.js';
import { grepForReferences } from './fallback-grep.js';
import { findFuzzyMatches } from './fuzzy-match.js';
import { toolCache } from '../utils/tool-cache.js';
import { searchWorkspace } from '../utils/workspace-loader.js';
import { loadProtocolIndex } from '../utils/protocol-loader.js';
import { emitAndProcess } from '../utils/nomination-engine.js';
import { portalRoutes, type PortalRoute } from '../utils/portal-routes.js';

// ────────────────────────────────────────────────────────
// Tool Registry Setup
// ────────────────────────────────────────────────────────

/**
 * Build and populate the ToolRegistry with all tool modules.
 *
 * Tiers:
 *   core     — always loaded (context, navigate, tags, purpose-portal, pm, reindex, docs)
 *   feature  — auto-detected (lore, agents, orchestration, habits, notebooks, etc.)
 *   advanced — on-demand (conductor, platform, pipeline, graduation)
 *
 * The registry provides tiered listing via getActiveTools() and
 * Map-based dispatch via dispatch().
 */
function buildRegistry(rootDir: string, reloadContext?: ReloadContextFn): ToolRegistry {
  const registry = new ToolRegistry(rootDir);

  const reload: ReloadContextFn = reloadContext || (async () => {});

  // Helper: wrap a standard (name, args, ctx) handler into the ToolModule.handleTool shape
  const wrap = (
    handler: (name: string, args: Record<string, unknown>, ctx: ProjectContext) => Promise<{ handled: boolean; text: string }>,
  ): ToolModule['handleTool'] =>
    async (name, args, ctx) => handler(name, args, ctx as ProjectContext);

  // Helper: wrap handlers that also need the reload callback
  const reloadVoid = async (): Promise<void> => { await reload(); };
  const wrapWithReload = (
    handler: (name: string, args: Record<string, unknown>, ctx: ProjectContext, reloadFn: () => Promise<void>) => Promise<{ handled: boolean; text: string }>,
  ): ToolModule['handleTool'] =>
    async (name, args, ctx) => handler(name, args, ctx as ProjectContext, reloadVoid);

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
      // reindex needs the full ReloadContextFn (opts + returned context)
      handleTool: async (name, args, ctx) => handleReindexTool(name, args, ctx as ProjectContext, reload),
    },
    {
      key: 'docs',
      tier: 'core',
      getToolsList: getDocsToolsList,
      handleTool: wrap(handleDocsTool),
    },
    {
      key: 'ripple',
      tier: 'core',
      getToolsList: getRippleToolsList,
      handleTool: wrap(handleRippleTool),
    },
    {
      key: 'captain',
      tier: 'core',
      getToolsList: getCaptainToolsList,
      handleTool: wrap(handleCaptainTool),
    },
    {
      key: 'spill',
      tier: 'core',
      getToolsList: getSpillToolsList,
      handleTool: wrap(handleSpillTool),
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
      key: 'classroom',
      tier: 'feature',
      getToolsList: getClassroomToolsList,
      handleTool: wrap(handleClassroomTool),
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
      // 7.14 Brain: detected only while some brain opted into agent metadata access.
      key: 'brain',
      tier: 'feature',
      getToolsList: getBrainToolsList,
      handleTool: wrap(handleBrainTool),
      detect: () => brainFamilyAvailable(),
    },
    {
      key: 'agents',
      tier: 'feature',
      getToolsList: getAgentToolsList,
      handleTool: wrap(handleAgentTool),
    },
    {
      key: 'authority',
      tier: 'feature',
      getToolsList: getAuthorityToolsList,
      handleTool: wrap(handleAuthorityTool),
    },
    {
      key: 'propose-block',
      tier: 'feature',
      getToolsList: getProposeBlockToolsList,
      handleTool: wrap(handleProposeBlockTool),
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
    {
      key: 'enforcement',
      tier: 'feature',
      getToolsList: getEnforcementToolsList,
      handleTool: wrap(handleEnforcementTool),
      detect: (rootDir: string) => fs.existsSync(path.join(rootDir, '.paradigm', 'config.yaml')),
    },
    {
      key: 'graph',
      tier: 'feature',
      getToolsList: getGraphToolsList,
      handleTool: wrap(handleGraphTool),
      // Active when EITHER the aspect-graph db (graph_generate) OR the scan-index
      // (graph_slice — the #graph-slice-projector seam) is present.
      detect: (rootDir: string) =>
        fs.existsSync(path.join(rootDir, '.paradigm', 'aspect-graph.db')) ||
        fs.existsSync(path.join(rootDir, '.paradigm', 'scan-index.json')),
    },
    {
      // 7.13: was never registered (dead since its introduction); now reachable
      // as the on-demand paradigm_assessment family / hidden aliases.
      key: 'assessment',
      tier: 'feature',
      getToolsList: getAssessmentToolsList as () => ToolDefinition[],
      handleTool: wrap(handleAssessmentTool),
    },
    {
      // Gnomon loops (LP1): file ops on .paradigm/loops/*.yaml; on-demand paradigm_loop family.
      key: 'loops',
      tier: 'feature',
      getToolsList: getLoopsToolsList,
      handleTool: wrap(handleLoopsTool),
    },
    {
      key: 'arch',
      tier: 'feature',
      getToolsList: getArchToolsList,
      handleTool: wrap(handleArchTool),
      detect: (rootDir: string) => fs.existsSync(path.join(rootDir, ARCH_FILE)),
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
 * They handle core Paradigm operations (search, related, status, gates)
 * plus infrastructure tools (plugin check, workspace reindex, tool activation).
 * Note: ripple is now in tools/ripple.ts as a registry module.
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
      aliases: ['find', 'lookup', 'locate', 'where is', 'which symbol', 'find symbol'],
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
      description: 'Get project overview — call this at session start for orientation. Shows symbol counts, project health, and a pointer to the full capability guide. ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          response_format: { type: 'string', enum: ['concise', 'detailed'], description: 'Response detail level. "concise" returns minimal fields to save tokens (default: "detailed")' },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
      aliases: ['health', 'overview', 'dashboard', 'project status', 'orientation'],
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
      aliases: ['auth', 'permissions', 'route security', 'what gates', 'protect route'],
    },
    {
      name: 'paradigm_plugin_check',
      description: 'Check for updates to installed Claude Code plugins. Returns JSON: notices[] ({kind:"plugin-update", plugin, marketplace, repo, from, to, reason, command}) and a host-aware summary.',
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
      description: 'List an on-demand tool for this session (sends tools/list_changed). Persist via config.yaml mcp.tools.enable. ~50 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          feature: { type: 'string', description: 'sentinel, symphony, classroom, habits, persona, university, assessment, conductor, platform, pipeline, graduation, test_fixtures, brain' },
        },
        required: ['feature'],
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
  ];
}

// ────────────────────────────────────────────────────────
// 7.13 Surface: anchors + families (#tool-family)
// ────────────────────────────────────────────────────────

export interface ToolSurface {
  /** Every pre-7.13 definition by legacy name (inline + all registry tiers) */
  legacyDefs: Map<string, ToolDefinition>;
  /** Op families by tool name */
  families: Map<string, ToolFamily>;
  /** Anchor definitions (status/reindex augmented with folded legacy tools) */
  anchors: ToolDefinition[];
}

export function buildToolSurface(registry: ToolRegistry): ToolSurface {
  const legacyDefs = new Map<string, ToolDefinition>();
  for (const d of [...(getInlineToolDefinitions() as ToolDefinition[]), ...registry.getAllTools()]) {
    if (!legacyDefs.has(d.name)) legacyDefs.set(d.name, d);
  }
  const opsByFamily = familyOpsFromMap();
  const families = new Map<string, ToolFamily>();
  for (const meta of FAMILY_META) {
    if (meta.plain) continue;
    const ops = opsByFamily.get(meta.name);
    if (!ops) throw new Error(`Family ${meta.name} has no ops in LEGACY_TOOL_MAP`);
    families.set(meta.name, defineFamily({ name: meta.name, description: meta.description, ops, defaultOp: meta.defaultOp, signatures: meta.signatures ?? 'required' }, legacyDefs));
  }
  const anchors: ToolDefinition[] = [];
  for (const name of ANCHOR_TOOLS) {
    const base = legacyDefs.get(name);
    if (!base) throw new Error(`Anchor ${name} is not registered`);
    const def = compactDefinition(base, ANCHOR_DESC_MAX, ANCHOR_PROP_DESC_MAX);
    const schema = def.inputSchema as { properties?: Record<string, unknown> };
    if (name === 'paradigm_status') {
      def.inputSchema = { ...def.inputSchema, properties: { ...(schema.properties ?? {}), check: { type: 'string', enum: ['plugins'], description: 'plugins: check installed Claude Code plugins for updates' } } };
    } else if (name === 'paradigm_reindex') {
      def.inputSchema = { ...def.inputSchema, properties: { ...(schema.properties ?? {}), scope: { type: 'string', enum: ['project', 'workspace'], description: 'workspace: rebuild scan-index for every workspace member' } } };
    }
    anchors.push(def);
  }
  return { legacyDefs, families, anchors };
}

/** Definition for an on-demand entry (family or plain tool). */
function onDemandDefinition(surface: ToolSurface, name: string): ToolDefinition | undefined {
  const fam = surface.families.get(name);
  if (fam) return fam.definition;
  const plain = surface.legacyDefs.get(name);
  return plain ? compactDefinition(plain, ANCHOR_DESC_MAX, ANCHOR_PROP_DESC_MAX) : undefined;
}

/**
 * tools/list for the 7.13 surface: anchors + default families + on-demand
 * entries that are config-enabled or session-activated. With
 * `mcp.tools.legacy_listing: true` the pre-7.13 per-op tools are relisted too.
 */
export function listSurfaceTools(
  surface: ToolSurface,
  registry: ToolRegistry,
  rootDir: string,
  activated: ReadonlySet<string> = new Set(),
): ToolDefinition[] {
  const cfg = readMcpToolsConfig(rootDir);
  const out: ToolDefinition[] = [...surface.anchors];
  for (const meta of DEFAULT_FAMILIES) out.push(surface.families.get(meta.name)!.definition);
  const enabled = new Set(cfg.enable.map(k => findOnDemand(k)?.name).filter((n): n is string => !!n));
  for (const meta of ON_DEMAND) {
    if (meta.requires === 'brain-agent-access') {
      if (!brainFamilyAvailable()) continue;
    } else if (!enabled.has(meta.name) && !activated.has(meta.name)) continue;
    const def = onDemandDefinition(surface, meta.name);
    if (def) out.push(def);
  }
  if (cfg.legacyListing) {
    const seen = new Set(out.map(t => t.name));
    for (const t of [...(getInlineToolDefinitions() as ToolDefinition[]), ...registry.getActiveTools()]) {
      if (seen.has(t.name)) continue;
      seen.add(t.name);
      out.push(toListedTool(t));
    }
  }
  return out;
}

export type ResolvedToolCall =
  | { canonical: string; args: Record<string, unknown>; deprecatedAlias?: string }
  | { error: string };

/**
 * Resolve a requested tool name to the CANONICAL LEGACY NAME the existing
 * handlers (and breadcrumbs / toolsCalled) key on.
 */
export function resolveToolCall(surface: ToolSurface, name: string, args: Record<string, unknown>): ResolvedToolCall {
  const fam = surface.families.get(name);
  if (fam) {
    const r = fam.resolve(args);
    if ('error' in r) return r;
    return { canonical: r.legacy, args: r.args };
  }
  // Anchors that absorbed a legacy tool via a fixed arg (status check:'plugins', reindex scope:'workspace')
  for (const [legacy, target] of Object.entries(LEGACY_TOOL_MAP)) {
    if (target.tool !== name || !target.args || legacy === name) continue;
    const entries = Object.entries(target.args);
    if (entries.every(([k, v]) => args[k] === v)) {
      const rest = { ...args };
      for (const [k] of entries) delete rest[k];
      return { canonical: legacy, args: rest };
    }
  }
  if (isDeprecatedAlias(name)) return { canonical: name, args, deprecatedAlias: name };
  return { canonical: name, args };
}

/** Human-readable 7.13 form of a legacy name, e.g. "paradigm_lore({op:'record'})". */
function modernForm(legacy: string): string {
  const t = LEGACY_TOOL_MAP[legacy];
  if (!t) return legacy;
  const parts = [
    ...(t.op ? [`op:'${t.op}'`] : []),
    ...Object.entries(t.args ?? {}).map(([k, v]) => `${k}:'${v}'`),
  ];
  return parts.length ? `${t.tool}({${parts.join(', ')}})` : t.tool;
}

/**
 * Register all MCP tools
 */
/**
 * Every tool definition this server can register — inline tools plus every
 * registry module across all tiers (not just the active ones). Used by
 * #skill-loader checkPins (`paradigm skill check`) to hash each paradigm_*
 * tool's canonical inputSchema. Pure listing: no handlers run.
 */
export function listToolDefinitions(rootDir: string = process.cwd()): ToolDefinition[] {
  const registry = buildRegistry(rootDir);
  const surface = buildToolSurface(registry);
  const seen = new Set<string>();
  const out: ToolDefinition[] = [];
  const onDemand = ON_DEMAND.map(m => onDemandDefinition(surface, m.name)).filter((d): d is ToolDefinition => !!d);
  // 7.13 surface first (anchors, families, on-demand), then every legacy definition.
  for (const t of [
    ...surface.anchors,
    ...DEFAULT_FAMILIES.map(m => surface.families.get(m.name)!.definition),
    ...onDemand,
    ...(getInlineToolDefinitions() as ToolDefinition[]).map(toListedTool),
    ...registry.getAllTools(),
  ]) {
    if (seen.has(t.name)) continue;
    seen.add(t.name);
    out.push(t);
  }
  return out;
}

export function registerTools(server: Server, getContext: () => ProjectContext, reloadContext?: ReloadContextFn) {
  // Build the tool registry with all modules organized by tier
  const ctx0 = getContext();
  const registry = buildRegistry(ctx0.rootDir, reloadContext);
  const surface = buildToolSurface(registry);
  /** On-demand tools activated this session via paradigm_tool_activate */
  const activatedOnDemand = new Set<string>();

  // List available tools — 7.13 surface (anchors + families + enabled on-demand)
  server.setRequestHandler(
    ListToolsRequestSchema,
    async () => {
      return { tools: listSurfaceTools(surface, registry, getContext().rootDir, activatedOnDemand) };
    }
  );

  // Handle tool calls
  server.setRequestHandler(
    CallToolRequestSchema,
    async (request) => {
      const { name: requestedName, arguments: rawArgs } = request.params;
      // 7.13: resolve family/anchor/alias → canonical legacy name. Breadcrumbs,
      // toolsCalled and post-dispatch events all key on the canonical name.
      const resolved = resolveToolCall(surface, requestedName, (rawArgs ?? {}) as Record<string, unknown>);
      const resolveError = 'error' in resolved ? resolved.error : null;
      const name = 'error' in resolved ? requestedName : resolved.canonical;
      const args = ('error' in resolved ? (rawArgs ?? {}) : resolved.args) as Record<string, any>;
      addToolBreadcrumb(name, args);
      if (!('error' in resolved) && resolved.deprecatedAlias) {
        getSessionTracker().addBreadcrumb(
          'tool-deprecated-alias',
          `Deprecated alias ${requestedName} → ${modernForm(requestedName)} (removed in 7.15)`,
          { tool: name },
        );
      }
      const ctx = getContext();
      // Symbol Integrity Phase 1: pick up .purpose/portal edits made outside
      // the MCP write tools (in place — same ctx object), and drop cached tool
      // results computed against a superseded index.
      await refreshContextSafely(ctx);
      toolCache.bindIndex(ctx.index);

      // Auto-recovery: on the first tool call of a new session, surface checkpoint/handoff data
      const tracker = getSessionTracker();
      tracker.setRootDir(ctx.rootDir);
      // Plugin-update facts are NOT surfaced here: third-party plugin state
      // belongs to paradigm_status check:'plugins', not every first tool call.
      let recoveryPreamble: string | null = null;
      if (!tracker.hasRecoveredThisSession()) {
        recoveryPreamble = await buildRecoveryPreamble(ctx.rootDir);
        tracker.markRecovered();
      }

      // Dispatch to tool handler; we'll prepend recovery preamble afterward
      const toolResult = await (async (): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> => {

      if (resolveError) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: resolveError }, null, 2) }], isError: true };
      }

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
          let fuzzyMatches: Array<{ match: string; distance: number }> = [];
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

        // paradigm_ripple is now handled by the ripple registry module (tools/ripple.ts)
        // and will be dispatched via the default registry.dispatch() path below.

        case 'paradigm_related': {
          const { symbol } = args;
          // User-typed name: fuzzy (case / bare-name tolerant) resolution.
          const { entry, candidates } = resolveSymbol(ctx.index, symbol as string);

          if (!entry && candidates.length > 1) {
            const text = JSON.stringify({
              error: 'Ambiguous symbol',
              symbol,
              candidates: candidates.map(c => c.symbol),
            }, null, 2);
            trackToolCall(text.length, name);
            return { content: [{ type: 'text', text }] };
          }

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
                  'The symbol may not be indexed yet - call paradigm_reindex',
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
              note: 'Approximate relationships from grep — call paradigm_reindex for accurate graph data.',
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
              suggestion: 'Call paradigm_reindex to enable full relationship tracking',
            }, null, 2);
            trackToolCall(text.length, name);
            return {
              content: [{
                type: 'text',
                text,
              }],
            };
          }

          // Canonical form — case / bare-name inputs resolve to the indexed symbol.
          const referencesTo = getReferencesTo(ctx.index, entry.symbol);
          const referencesFrom = getReferencesFrom(ctx.index, entry.symbol);

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

            // Count notebook references this session (non-fatal)
            let notebookReferences: number | undefined;
            try {
              const { countNotebookReferences } = await import('../utils/session-work-log.js');
              const count = countNotebookReferences(ctx.rootDir);
              if (count > 0) notebookReferences = count;
            } catch {
              // Non-fatal
            }

            // Load compliance trend (non-fatal)
            let complianceHealth: { trend: string; dot: string } | undefined;
            try {
              const { getComplianceTrend, getHealthDot } = await import('../utils/compliance-health.js');
              const trend = getComplianceTrend(ctx.rootDir);
              if (trend) {
                complianceHealth = { trend, dot: getHealthDot(trend, ctx.rootDir) };
              }
            } catch {
              // Non-fatal
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
              ...(notebookReferences !== undefined ? { notebookReferences } : {}),
              ...(complianceHealth ? { complianceHealth } : {}),
              capabilities: 'paradigm://context/agent-protocol',
              ...(await (async () => {
                try {
                  const { loadArchMap } = await import('../utils/arch-loader.js');
                  const archMap = loadArchMap(ctx.rootDir);
                  if (archMap) {
                    return { arch: { present: true, tiers: archMap.tiers.length, links: archMap.links.length } };
                  }
                } catch { /* non-fatal */ }
                return {};
              })()),
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
          // 7.13: detected on-demand features are HINTS, never auto-listed.
          const listedNow = new Set(listSurfaceTools(surface, registry, ctx.rootDir, activatedOnDemand).map(t => t.name));
          const hints = ON_DEMAND
            .filter(m => m.detector && !listedNow.has(m.name))
            .filter(m => { try { return FEATURE_DETECTORS[m.detector!]?.(ctx.rootDir) === true; } catch { return false; } })
            .map(m => `${m.keys![0]} detected; enable via paradigm_tool_activate({feature:'${m.keys![0]}'}) or config.yaml mcp.tools.enable`);
          if (hints.length > 0 && statusResponseFormat !== 'concise') {
            try {
              statusText = JSON.stringify({ ...JSON.parse(text), hints }, null, 2);
            } catch { /* keep text */ }
          }
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
          // Local routes come through portalRoutes(), empty until T-2026-10-22-002.
          const learnedPatterns: Array<PortalRoute & { source?: string }> = [...portalRoutes(ctx.gateConfig)];

          // Learn from workspace sibling portal.yaml files
          if (ctx.workspace) {
            for (const [memberName, sibling] of ctx.workspace.siblingIndices) {
              for (const r of sibling.portalRoutes) learnedPatterns.push({ ...r, source: memberName });
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
          const { runPluginUpdateCheck, buildPluginCheckReport, detectPluginHost } = await import('../utils/plugin-update-checker.js');
          const results = await runPluginUpdateCheck();
          const pluginText = JSON.stringify(buildPluginCheckReport(results, detectPluginHost()), null, 2);
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
          const feature = String((args as { feature?: unknown }).feature ?? '');
          const meta = findOnDemand(feature);
          if (meta && meta.requires === 'brain-agent-access') {
            const available = brainFamilyAvailable();
            const text = JSON.stringify({
              action: 'tool_activate',
              feature,
              status: available ? 'already_active' : 'unavailable',
              note: available
                ? `${meta.name} is listed while a brain is shared with agents.`
                : 'No brain is shared with agents. The owner can allow it with `paradigm brain access metadata`.',
            }, null, 2);
            trackToolCall(text.length, name);
            return { content: [{ type: 'text', text }] };
          }
          if (meta) {
            const enabledByConfig = readMcpToolsConfig(ctx.rootDir).enable.some(k => findOnDemand(k)?.name === meta.name);
            const already = activatedOnDemand.has(meta.name) || enabledByConfig;
            activatedOnDemand.add(meta.name);
            // Keep the legacy advanced-tier bookkeeping in sync (conductor/platform/pipeline/graduation).
            for (const k of meta.keys ?? []) registry.activateAdvanced(k);
            if (!already) {
              // Tell the host to re-fetch tools/list (Claude Code honours list_changed).
              try { await server.sendToolListChanged(); } catch { /* not connected (tests) */ }
            }
            const fam = surface.families.get(meta.name);
            const text = JSON.stringify({
              action: 'tool_activate',
              feature,
              status: already ? 'already_active' : 'activated',
              toolsAdded: already ? [] : [meta.name],
              ...(fam ? { ops: Object.keys(fam.spec.ops) } : {}),
              note: already
                ? `${meta.name} is already listed.`
                : `${meta.name} activated for this session; tools/list_changed sent. Persist via config.yaml mcp.tools.enable: [${meta.keys![0]}].`,
            }, null, 2);
            trackToolCall(text.length, name);
            return { content: [{ type: 'text', text }] };
          }
          const isListed = surface.families.has(feature) || surface.families.has(`paradigm_${feature}`) ||
            (ANCHOR_TOOLS as readonly string[]).includes(feature) || (ANCHOR_TOOLS as readonly string[]).includes(`paradigm_${feature}`);
          const available = ON_DEMAND.filter(m => !activatedOnDemand.has(m.name)).map(m => m.keys![0]);
          const text = JSON.stringify({
            action: 'tool_activate',
            feature,
            status: isListed ? 'already_active' : 'not_found',
            note: isListed
              ? `"${feature}" is a default-tier tool and is always listed.`
              : `"${feature}" not found. Available on-demand: ${available.join(', ') || '(none)'}`,
            availableOnDemand: available,
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

      // Prepend the recovery preamble to the first tool response
      if (recoveryPreamble) {
        const first = toolResult.content?.[0];
        if (first && typeof first === 'object' && 'text' in first && typeof first.text === 'string') {
          first.text = recoveryPreamble + '\n\n' + first.text;
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
const STREAM_SEVERITIES = ['info', 'warning', 'error', 'critical'] as const;
type StreamSeverity = (typeof STREAM_SEVERITIES)[number];

/** Narrow a caller-supplied severity to the event-stream vocabulary (default `warning`). */
function toStreamSeverity(value: unknown): StreamSeverity {
  return STREAM_SEVERITIES.find((s) => s === value) ?? 'warning';
}

function emitPostDispatchEvents(name: string, args: Record<string, unknown>, rootDir: string): void {
  try {
    switch (name) {
      case 'paradigm_sentinel_record':
        emitAndProcess(rootDir, {
          type: 'error-encountered', source: 'mcp-tool-call', tool: name,
          severity: toStreamSeverity(args.severity),
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
