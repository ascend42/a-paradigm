/**
 * Workspace Loader - Multi-project workspace support for Paradigm
 *
 * Loads .paradigm-workspace files that define sibling projects sharing symbols.
 * Enables cross-project ripple, search, navigate, and gate awareness.
 *
 * Design principles:
 * - Read-only sibling access (only reads scan-index.json + portal.yaml)
 * - Graceful degradation (missing files → warn, continue)
 * - Namespace prefixing ({memberName}/ on cross-project symbols)
 * - Export filtering (members control visibility via exports globs)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { log } from './mcp-logger.js';
import {
  buildSymbolIndex,
  searchSymbols,
  getAllSymbols,
  type SymbolIndex,
} from '@a-company/premise-core';
import type { ParsedGateConfig } from '@a-company/portal-core';

// ============================================================================
// Types
// ============================================================================

export interface WorkspaceMember {
  name: string;
  path: string;
  role?: 'api' | 'client' | 'shared' | 'service' | 'lib';
  exports?: string[];  // glob patterns for visible symbols
}

export interface WorkspaceConfig {
  version: string;
  name: string;
  members: WorkspaceMember[];
}

export interface SiblingIndex {
  index: SymbolIndex;
  gateConfig: ParsedGateConfig | null;
}

export interface WorkspaceContext {
  config: WorkspaceConfig;
  workspacePath: string;        // absolute path to .paradigm-workspace
  currentMember: string;        // which member we are (matched by rootDir)
  siblingIndices: Map<string, SiblingIndex>;
}

export interface WorkspaceSearchResult {
  project: string;
  symbol: string;
  type: string;
  description?: string;
  filePath?: string;
}

export interface WorkspaceRippleResult {
  project: string;
  references: Array<{
    symbol: string;
    type: string;
    description?: string;
  }>;
}

// ============================================================================
// Workspace Config Loader
// ============================================================================

/**
 * Parse a .paradigm-workspace YAML file
 */
export function loadWorkspaceConfig(workspacePath: string): WorkspaceConfig {
  const absolutePath = path.resolve(workspacePath);
  const content = fs.readFileSync(absolutePath, 'utf8');
  const data = yaml.load(content) as Record<string, unknown>;

  if (!data || typeof data !== 'object') {
    throw new Error(`Invalid workspace file: ${workspacePath}`);
  }

  const config: WorkspaceConfig = {
    version: String(data.version || '1.0'),
    name: String(data.name || 'unnamed-workspace'),
    members: [],
  };

  if (Array.isArray(data.members)) {
    for (const member of data.members) {
      if (typeof member === 'object' && member !== null) {
        const m = member as Record<string, unknown>;
        config.members.push({
          name: String(m.name || ''),
          path: String(m.path || ''),
          role: m.role as WorkspaceMember['role'],
          exports: Array.isArray(m.exports) ? m.exports.map(String) : undefined,
        });
      }
    }
  }

  return config;
}

/**
 * Load full workspace context: resolve workspace, load sibling scan-index.json files
 *
 * @param rootDir - Current project root directory
 * @param configWorkspacePath - Relative path to .paradigm-workspace from config.yaml
 * @returns WorkspaceContext or null if workspace can't be loaded
 */
export function loadWorkspaceContext(
  rootDir: string,
  configWorkspacePath: string,
): WorkspaceContext | null {
  const absoluteRoot = path.resolve(rootDir);

  // Resolve workspace file path relative to rootDir
  const workspacePath = path.resolve(absoluteRoot, configWorkspacePath);

  if (!fs.existsSync(workspacePath)) {
    log.component('#workspace-loader').warn('Workspace file not found', { workspacePath });
    return null;
  }

  let config: WorkspaceConfig;
  try {
    config = loadWorkspaceConfig(workspacePath);
  } catch (e) {
    log.component('#workspace-loader').warn('Could not parse workspace file', { error: (e as Error).message });
    return null;
  }

  const workspaceDir = path.dirname(workspacePath);

  // Identify current member by matching rootDir
  let currentMember = '';
  for (const member of config.members) {
    const memberAbsPath = path.resolve(workspaceDir, member.path);
    if (normalizePath(memberAbsPath) === normalizePath(absoluteRoot)) {
      currentMember = member.name;
      break;
    }
  }

  if (!currentMember) {
    log.component('#workspace-loader').warn('Current directory is not a member of workspace', { workspace: config.name });
    return null;
  }

  // Load sibling indices (skip current member)
  const siblingIndices = new Map<string, SiblingIndex>();

  for (const member of config.members) {
    if (member.name === currentMember) continue;

    const memberAbsPath = path.resolve(workspaceDir, member.path);
    const scanIndexPath = path.join(memberAbsPath, '.paradigm', 'scan-index.json');

    if (!fs.existsSync(scanIndexPath)) {
      log.component('#workspace-loader').warn('No scan-index.json for workspace member', { member: member.name, scanIndexPath });
      continue;
    }

    try {
      const scanData = JSON.parse(fs.readFileSync(scanIndexPath, 'utf8'));
      let index = buildIndexFromScanData(scanData);

      // Apply export filtering if member defines exports
      if (member.exports && member.exports.length > 0) {
        index = filterByExports(index, member.exports);
      }

      // Load sibling's portal.yaml if it exists
      let gateConfig: ParsedGateConfig | null = null;
      const portalPath = path.join(memberAbsPath, 'portal.yaml');
      if (fs.existsSync(portalPath)) {
        try {
          // parseGateConfig is async but we need sync here — read raw YAML instead
          const portalContent = fs.readFileSync(portalPath, 'utf8');
          const portalData = yaml.load(portalContent) as ParsedGateConfig & { routes?: Record<string, unknown> };
          if (portalData) {
            gateConfig = portalData as ParsedGateConfig;
          }
        } catch {
          // Gate config is optional for siblings
        }
      }

      siblingIndices.set(member.name, { index, gateConfig });
    } catch (e) {
      log.component('#workspace-loader').warn('Could not load index for workspace member', { member: member.name, error: (e as Error).message });
    }
  }

  return {
    config,
    workspacePath,
    currentMember,
    siblingIndices,
  };
}

// ============================================================================
// Export Filtering
// ============================================================================

/**
 * Filter a symbol index to only include symbols matching export patterns.
 * Supports simple glob patterns: * matches any sequence, ? matches single char.
 */
export function filterByExports(index: SymbolIndex, exports: string[]): SymbolIndex {
  const allSymbols = getAllSymbols(index);
  const filtered = allSymbols.filter(entry => {
    const symbolId = entry.symbol;
    return exports.some(pattern => simpleGlobMatch(pattern, symbolId));
  });

  // Rebuild a minimal index from filtered symbols
  return rebuildIndexFromEntries(filtered);
}

/**
 * Simple glob matcher for symbol IDs.
 * Supports * (any sequence) and ? (single char).
 */
function simpleGlobMatch(pattern: string, str: string): boolean {
  // Convert glob to regex
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  const re = new RegExp(`^${escaped}$`, 'i');
  return re.test(str);
}

// ============================================================================
// Namespace Prefixing
// ============================================================================

/**
 * Prefix all symbols in an index with a member namespace.
 * E.g., #user-api becomes {memberName}/#user-api
 */
export function prefixSymbols(index: SymbolIndex, memberName: string): SymbolIndex {
  const allSymbols = getAllSymbols(index);
  const prefixed = allSymbols.map(entry => ({
    ...entry,
    symbol: `${memberName}/${entry.symbol}`,
  }));

  return rebuildIndexFromEntries(prefixed);
}

// ============================================================================
// Workspace Search + Ripple Helpers
// ============================================================================

/**
 * Search all sibling indices for matching symbols.
 * Returns results with project namespace prefix.
 */
export function searchWorkspace(
  workspace: WorkspaceContext,
  query: string,
): WorkspaceSearchResult[] {
  const results: WorkspaceSearchResult[] = [];

  for (const [memberName, sibling] of workspace.siblingIndices) {
    const matches = searchSymbols(sibling.index, query);
    for (const match of matches) {
      results.push({
        project: memberName,
        symbol: `${memberName}/${match.symbol}`,
        type: match.type,
        description: match.description,
        filePath: match.filePath,
      });
    }
  }

  return results;
}

/**
 * Find cross-project references to a symbol.
 * Searches sibling indices for symbols that reference the given symbol.
 */
export function rippleWorkspace(
  workspace: WorkspaceContext,
  symbol: string,
): WorkspaceRippleResult[] {
  const results: WorkspaceRippleResult[] = [];

  // Strip namespace prefix if present (e.g., "backend/#user-api" → "#user-api")
  const bareSymbol = symbol.includes('/') ? symbol.split('/').pop()! : symbol;

  for (const [memberName, sibling] of workspace.siblingIndices) {
    const references: WorkspaceRippleResult['references'] = [];

    // Search for symbols that reference the target symbol
    const allSymbols = getAllSymbols(sibling.index);
    for (const entry of allSymbols) {
      // Check if this symbol's references mention our target
      const refs = entry.references || [];
      const desc = entry.description || '';

      // Check direct references array
      const hasRef = refs.some(ref =>
        ref === bareSymbol ||
        ref === symbol ||
        ref.endsWith(`/${bareSymbol}`)
      );

      // Also check description for symbol mentions
      const mentionsInDesc = desc.includes(bareSymbol);

      if (hasRef || mentionsInDesc) {
        references.push({
          symbol: entry.symbol,
          type: entry.type,
          description: entry.description,
        });
      }
    }

    if (references.length > 0) {
      results.push({
        project: memberName,
        references,
      });
    }
  }

  return results;
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Normalize path for comparison (resolve + lowercase on case-insensitive systems)
 */
function normalizePath(p: string): string {
  return path.resolve(p).replace(/\/+$/, '');
}

/**
 * Build a SymbolIndex from scan-index.json data.
 * scan-index.json has a flat structure with categories as top-level keys.
 */
function buildIndexFromScanData(scanData: Record<string, unknown>): SymbolIndex {
  const categoryMap: Record<string, string> = {
    components: 'component',
    flows: 'flow',
    gates: 'gate',
    signals: 'signal',
    aspects: 'aspect',
  };

  const symbols = [];

  for (const [category, type] of Object.entries(categoryMap)) {
    const items = scanData[category] as Record<string, Record<string, unknown>> | undefined;
    if (!items || typeof items !== 'object') continue;

    for (const [id, item] of Object.entries(items)) {
      const prefix = { component: '#', flow: '$', gate: '^', signal: '!', aspect: '~' }[type] || '#';
      symbols.push({
        id,
        symbol: item.symbol as string || `${prefix}${id}`,
        type: type as 'component' | 'flow' | 'gate' | 'signal' | 'aspect',
        source: 'purpose' as const,
        filePath: (item.path as string) || '',
        data: {},
        references: (item.related as string[]) || [],
        referencedBy: [] as string[],
        description: item.description as string | undefined,
        tags: (item.visualTags as string[]) || [],
      });
    }
  }

  return buildSymbolIndex({
    symbols,
    purposeFiles: [],
    portalFiles: [],
    errors: [],
    timestamp: Date.now(),
  });
}

/**
 * Rebuild a SymbolIndex from a filtered list of symbol entries.
 */
function rebuildIndexFromEntries(entries: Array<{
  id?: string;
  symbol: string;
  type: string;
  filePath?: string;
  data?: unknown;
  references?: string[];
  referencedBy?: string[];
  description?: string;
  tags?: string[];
}>): SymbolIndex {
  return buildSymbolIndex({
    symbols: entries.map(e => ({
      id: e.id || e.symbol.replace(/^[#$^!~]/, ''),
      symbol: e.symbol,
      type: e.type as 'component' | 'flow' | 'gate' | 'signal' | 'aspect',
      source: 'purpose' as const,
      filePath: e.filePath || '',
      data: e.data || {},
      references: e.references || [],
      referencedBy: e.referencedBy || [],
      description: e.description,
      tags: e.tags,
    })),
    purposeFiles: [],
    portalFiles: [],
    errors: [],
    timestamp: Date.now(),
  });
}
