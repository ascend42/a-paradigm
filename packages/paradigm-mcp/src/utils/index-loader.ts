/**
 * Index Loader - Loads Paradigm symbol index from a project directory
 * 
 * Technology agnostic: Only reads .purpose and portal.yaml files
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  aggregateFromDirectory,
  buildSymbolIndex,
  type SymbolIndex,
  type AggregationResult,
} from '@a-company/premise-core';
import { parseGateConfig, type ParsedGateConfig } from '@a-company/portal-core';

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
  
  return {
    rootDir: absoluteRoot,
    index,
    aggregation,
    gateConfig,
    projectName,
  };
}

/**
 * Reload the project context (for watching changes)
 */
export async function reloadProjectContext(ctx: ProjectContext): Promise<ProjectContext> {
  return loadProjectContext(ctx.rootDir);
}
