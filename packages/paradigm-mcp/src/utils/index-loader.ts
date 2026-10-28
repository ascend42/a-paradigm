/**
 * Index Loader - Loads Paradigm symbol index from a project directory
 *
 * Technology agnostic: Only reads .purpose and portal.yaml files
 *
 * The index comes from premise-core's live index (#live-index), so a context
 * can be refreshed in place (ensureFreshContext) whenever the underlying
 * .purpose / portal files change — no TTL, no explicit reload.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { log } from './mcp-logger.js';
import {
  getLiveIndex,
  type SymbolIndex,
  type AggregationResult,
} from '@a-company/premise-core';
import { parseGateConfig, type ParsedGateConfig } from '@a-company/portal-core';
import type { WisdomContext, HistoryContext } from '../types/index.js';
import { loadWisdomContext } from './wisdom-loader.js';
import { loadHistoryContext } from './history-loader.js';
import { loadWorkspaceContext, type WorkspaceContext } from './workspace-loader.js';
import { gnomonStaged } from './gnomon-staged.js';

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
  /** Timestamp when the index was last (re)loaded into this context */
  _loadedAt?: number;
  /**
   * True when `index` comes from the live index (loadProjectContext).
   * ensureFreshContext only refreshes live contexts — hand-built ones
   * (tests) are left untouched.
   */
  _live?: boolean;
}

/**
 * Reload hook handed to tools that write .purpose / portal.yaml. Returns the
 * new context when the host replaces it (the server's reloadContext); test
 * harnesses pass a no-op. `rebuildStatic: false` skips the background static
 * file rebuild (paradigm_reindex rebuilds them itself, once).
 */
export type ReloadContextFn = (opts?: { rebuildStatic?: boolean }) => Promise<ProjectContext | void>;

/**
 * Load project context from a directory
 */
export async function loadProjectContext(rootDir: string): Promise<ProjectContext> {
  const absoluteRoot = path.resolve(rootDir);

  // Aggregate symbols from .purpose files (cached live index)
  const live = await getLiveIndex(absoluteRoot);
  const { index, result: aggregation } = live;
  lastFreshnessCheck.set(absoluteRoot, { at: Date.now(), index });

  const gateConfig = await loadGateConfig(absoluteRoot);

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

      // Lightweight config validation (full Zod schema runs in paradigm doctor)
      if (config && typeof config === 'object') {
        if (!config.version) {
          log.component('#index-loader').warn('config.yaml missing "version" field');
        }
        if (!config.project) {
          log.component('#index-loader').warn('config.yaml missing "project" field');
        }
      }

      if (config && typeof config.workspace === 'string') {
        workspace = loadWorkspaceContext(absoluteRoot, config.workspace);
      }
    } catch (e) {
      log.component('#index-loader').warn('Failed to load workspace config', { error: (e as Error).message });
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
    _live: true,
  };
}

/**
 * Parse <root>/portal.yaml, or null when absent/unparseable.
 *
 * v5.37.12: parseGateConfig runs its own yaml.load and may throw. We log
 * a redacted classifier (never the raw error message, which may include
 * YAML context lines — gate names, route paths) and leave gateConfig null.
 * Note: the stop hook's portal-compliance path does its own parse via
 * loadPortalConfig() which fails closed. This MCP path is advisory.
 */
async function loadGateConfig(absoluteRoot: string): Promise<ParsedGateConfig | null> {
  const portalPath = path.join(absoluteRoot, 'portal.yaml');
  if (!fs.existsSync(portalPath)) return null;
  try {
    return await parseGateConfig(portalPath);
  } catch (e) {
    // Classify by name only — do not echo the full error message.
    const name = (e as Error)?.name ?? 'Error';
    log.component('#index-loader').warn('Could not parse portal.yaml', { errorClass: name });
    return null;
  }
}

/**
 * Window (per rootDir) in which ensureFreshContext trusts the last check and
 * skips getLiveIndex — which globs + stats every .purpose/portal file. A burst
 * of tool calls costs one check; an edit is picked up once the window passes.
 */
export const FRESHNESS_DEBOUNCE_MS = 500;

/** rootDir → when the live index was last consulted, and what it returned. */
const lastFreshnessCheck = new Map<string, { at: number; index: SymbolIndex }>();

/** One refresh at a time per context — concurrent callers share it. */
const inflightRefresh = new WeakMap<ProjectContext, Promise<ProjectContext>>();

/**
 * Bring a live context up to date with the files on disk, IN PLACE.
 *
 * Runs on every tool call / resource read. Within FRESHNESS_DEBOUNCE_MS of the
 * last check for this root (and while the context still holds the index that
 * check saw) it returns immediately. Otherwise it consults getLiveIndex (cheap
 * when nothing changed: stat-only, same index object). When the live index
 * was rebuilt, index, aggregation and gateConfig are computed first and then
 * swapped on the SAME object in one synchronous block — every holder of the
 * context sees either the old triple or the new one, never a mix. Concurrent
 * calls on one context share a single in-flight refresh. Hand-built contexts
 * (`_live` unset) are returned unchanged.
 */
export function ensureFreshContext(ctx: ProjectContext): Promise<ProjectContext> {
  if (!ctx._live) return Promise.resolve(ctx);

  const pending = inflightRefresh.get(ctx);
  if (pending) return pending;

  const last = lastFreshnessCheck.get(ctx.rootDir);
  if (last && last.index === ctx.index && Date.now() - last.at < FRESHNESS_DEBOUNCE_MS) {
    return Promise.resolve(ctx);
  }

  const refresh = (async () => {
    const live = await getLiveIndex(ctx.rootDir);
    lastFreshnessCheck.set(ctx.rootDir, { at: Date.now(), index: live.index });
    if (live.index === ctx.index) return ctx;

    const gateConfig = await loadGateConfig(ctx.rootDir);
    // Atomic swap: no await between these assignments.
    ctx.index = live.index;
    ctx.aggregation = live.result;
    ctx.gateConfig = gateConfig;
    ctx._loadedAt = Date.now();
    log.component('#index-loader').debug('Context refreshed from live index', {
      symbols: live.result.symbols.length,
      parsedFiles: live.stats.parsedFiles,
    });
    // Keep flow-index.json / navigator.yaml / scan-index.json in step with
    // the index tools now see (fire-and-forget, coalesced per root).
    scheduleStaticRebuild(ctx);
    return ctx;
  })();
  inflightRefresh.set(ctx, refresh);
  const clear = () => {
    if (inflightRefresh.get(ctx) === refresh) inflightRefresh.delete(ctx);
  };
  refresh.then(clear, clear);
  return refresh;
}

/**
 * ensureFreshContext for choke points (tool calls, resource reads): a refresh
 * failure is logged and the existing context is used — it never fails the call.
 */
export async function refreshContextSafely(ctx: ProjectContext): Promise<ProjectContext> {
  try {
    return await ensureFreshContext(ctx);
  } catch (e) {
    log.component('#index-loader').warn('Context refresh failed; using the existing index', {
      error: (e as Error)?.message ?? String(e),
    });
    return ctx;
  }
}

/** Per-root background static-file rebuild: the one running + the latest pending ctx. */
const staticRebuilds = new Map<string, { running: Promise<void>; next: ProjectContext | null }>();

/**
 * Rebuild the static index files (scan-index.json, navigator.yaml,
 * flow-index.json) in the background after a refresh. Coalesced: while one
 * rebuild runs for a root, further requests collapse into ONE follow-up run
 * with the latest context. Failures are logged, never thrown.
 */
function scheduleStaticRebuild(ctx: ProjectContext): void {
  // TD-2026-10-27-833 (Aegis H2): staged for a Gnomon local session, a tool call never writes the generated index
  // files in the background (a read-class op must not write .paradigm/); the in-memory context is still refreshed and
  // paradigm_reindex (a carded op) writes them on request
  if (gnomonStaged()) return;
  const root = ctx.rootDir;
  const existing = staticRebuilds.get(root);
  if (existing) {
    existing.next = ctx;
    return;
  }
  const state: { running: Promise<void>; next: ProjectContext | null } = { running: Promise.resolve(), next: null };
  staticRebuilds.set(root, state);
  state.running = (async () => {
    let current: ProjectContext | null = ctx;
    while (current) {
      try {
        // Dynamic import: reindex.ts imports this module.
        const { rebuildStaticFiles } = await import('../tools/reindex.js');
        await rebuildStaticFiles(root, current);
      } catch (e) {
        log.component('#index-loader').warn('Background static rebuild failed', {
          error: (e as Error)?.message ?? String(e),
        });
      }
      current = state.next;
      state.next = null;
    }
    staticRebuilds.delete(root);
  })();
}

/** Resolve once every scheduled background static rebuild has finished (tests, shutdown). */
export async function flushStaticRebuilds(): Promise<void> {
  while (staticRebuilds.size > 0) {
    await Promise.all([...staticRebuilds.values()].map((s) => s.running));
  }
}

/**
 * Forget the debounce state (one root, or all) so the next ensureFreshContext
 * re-checks the disk. Pair with invalidateLiveIndex when forcing a re-parse.
 */
export function resetFreshnessDebounce(rootDir?: string): void {
  if (rootDir === undefined) lastFreshnessCheck.clear();
  else lastFreshnessCheck.delete(path.resolve(rootDir));
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
