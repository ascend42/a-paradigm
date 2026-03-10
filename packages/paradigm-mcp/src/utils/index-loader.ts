/**
 * Index Loader - Loads Paradigm symbol index from a project directory
 *
 * Technology agnostic: Only reads .purpose and portal.yaml files
 *
 * Features lazy re-aggregation when index is empty.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
  aggregateFromDirectory,
  buildSymbolIndex,
  type SymbolIndex,
  type AggregationResult,
} from '@a-company/premise-core';
import { parseGateConfig, type ParsedGateConfig } from '@a-company/portal-core';
import type { WisdomContext, HistoryContext } from '../types/index.js';
import { loadWisdomContext } from './wisdom-loader.js';
import { loadHistoryContext } from './history-loader.js';
import { loadWorkspaceContext, type WorkspaceContext } from './workspace-loader.js';

/** TTL for cached index (30 seconds) */
const INDEX_CACHE_TTL_MS = 30 * 1000;

export interface ProjectContext {
  /** Root directory of the project */
  rootDir: string;
  /** Symbol index */
  index: SymbolIndex;
  /** Aggregation result with raw data */
  aggregation: AggregationResult;
  /** Parsed gate configuration (if portal.yaml exists) */
  gateConfig: ParsedGateConfig | null;
  /** Project name (from .premise or directory name) */
  projectName: string;
  /** Wisdom context (team preferences, antipatterns, decisions, expertise) */
  wisdom: WisdomContext | null;
  /** History context (implementation log, validation, fragility) */
  history: HistoryContext | null;
  /** Workspace context for multi-project awareness (if workspace configured) */
  workspace?: WorkspaceContext | null;
  /** Timestamp when context was loaded (for cache invalidation) */
  _loadedAt?: number;
}

/**
 * Load project context from a directory
 */
export async function loadProjectContext(rootDir: string): Promise<ProjectContext> {
  const absoluteRoot = path.resolve(rootDir);

  // Aggregate symbols from .purpose files
  const aggregation = await aggregateFromDirectory(absoluteRoot);
  const index = buildSymbolIndex(aggregation);

  // Try to load portal.yaml
  let gateConfig: ParsedGateConfig | null = null;
  const portalPath = path.join(absoluteRoot, 'portal.yaml');
  if (fs.existsSync(portalPath)) {
    try {
      gateConfig = await parseGateConfig(portalPath);
    } catch (e) {
      // Gate config is optional
      console.error('Warning: Could not parse portal.yaml:', (e as Error).message);
    }
  }

  // Determine project name
  let projectName = path.basename(absoluteRoot);
  const premisePath = path.join(absoluteRoot, '.premise');
  if (fs.existsSync(premisePath)) {
    try {
      const content = fs.readFileSync(premisePath, 'utf8');
      // Try to extract name from YAML
      const match = content.match(/name:\s*["']?([^"'\n]+)["']?/);
      if (match) {
        projectName = match[1].trim();
      }
    } catch {
      // Use directory name as fallback
    }
  }

  // Try to load workspace config if present in .paradigm/config.yaml
  let workspace: WorkspaceContext | null = null;
  const configPath = path.join(absoluteRoot, '.paradigm', 'config.yaml');
  if (fs.existsSync(configPath)) {
    try {
      const configContent = fs.readFileSync(configPath, 'utf8');
      const config = yaml.load(configContent) as Record<string, unknown>;
      if (config && typeof config.workspace === 'string') {
        workspace = loadWorkspaceContext(absoluteRoot, config.workspace);
      }
    } catch (e) {
      console.error(`[paradigm] Warning: Failed to load workspace config: ${(e as Error).message}`);
    }
  }

  return {
    rootDir: absoluteRoot,
    index,
    aggregation,
    gateConfig,
    projectName,
    wisdom: null, // Loaded lazily by wisdom-loader
    history: null, // Loaded lazily by history-loader
    workspace,
    _loadedAt: Date.now(),
  };
}

/**
 * Check if the cached context is stale (older than TTL)
 */
export function isContextStale(ctx: ProjectContext): boolean {
  if (!ctx._loadedAt) return true;
  return Date.now() - ctx._loadedAt > INDEX_CACHE_TTL_MS;
}

/**
 * Check if the index is effectively empty (no symbols found)
 */
export function isIndexEmpty(ctx: ProjectContext): boolean {
  return ctx.aggregation.symbols.length === 0;
}

/**
 * Ensure the project context has a fresh index
 * Re-aggregates if index is empty and cache has expired
 */
export async function ensureFreshIndex(ctx: ProjectContext): Promise<ProjectContext> {
  // If index is not empty and cache is fresh, return as-is
  if (!isIndexEmpty(ctx) && !isContextStale(ctx)) {
    return ctx;
  }

  // If index is empty or cache is stale, re-aggregate
  if (isIndexEmpty(ctx) || isContextStale(ctx)) {
    return reloadProjectContext(ctx);
  }

  return ctx;
}

/**
 * Reload the project context (for watching changes)
 */
export async function reloadProjectContext(ctx: ProjectContext): Promise<ProjectContext> {
  return loadProjectContext(ctx.rootDir);
}

/**
 * Ensure wisdom context is loaded
 */
export async function ensureWisdom(ctx: ProjectContext): Promise<WisdomContext> {
  if (!ctx.wisdom) {
    ctx.wisdom = await loadWisdomContext(ctx.rootDir);
  }
  return ctx.wisdom;
}

/**
 * Ensure history context is loaded
 */
export async function ensureHistory(ctx: ProjectContext): Promise<HistoryContext> {
  if (!ctx.history) {
    ctx.history = await loadHistoryContext(ctx.rootDir);
  }
  return ctx.history;
}

/**
 * Load project context with wisdom and history eagerly loaded
 */
export async function loadFullProjectContext(rootDir: string): Promise<ProjectContext> {
  const ctx = await loadProjectContext(rootDir);
  ctx.wisdom = await loadWisdomContext(rootDir);
  ctx.history = await loadHistoryContext(rootDir);
  return ctx;
}
