/**
 * PM Compliance Engine
 *
 * Core compliance checks for the PM governance layer.
 * Used by both MCP tools (paradigm_pm_preflight/postflight) and
 * CLI orchestration (paradigm team orchestrate --pm).
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  searchSymbols,
  getReferencesTo,
  type SymbolIndex,
} from '@a-company/premise-core';
import {
  loadPortalConfig,
  extractDeclaredGates,
} from './portal-compliance.js';
import { suggestAgentsForTask } from './agent-matcher.js';
import { loadAgentsManifest } from '../commands/team/loader.js';

// ============================================================================
// Types
// ============================================================================

export interface PreflightResult {
  /** Symbols extracted from the task description */
  affectedSymbols: Array<{
    symbol: string;
    exists: boolean;
    type?: string;
    description?: string;
  }>;
  /** Ripple analysis for existing symbols */
  rippleAnalysis: Array<{
    symbol: string;
    directDependents: number;
    indirectDependents: number;
    impact: 'low' | 'medium' | 'high';
  }>;
  /** Current portal.yaml status */
  portalStatus: {
    exists: boolean;
    gateCount: number;
    gates: string[];
    routeCount: number;
  };
  /** Whether the task appears to add routes */
  taskAddsRoutes: boolean;
  /** Suggested agents for the task */
  suggestedAgents: Array<{
    name: string;
    confidence: 'high' | 'medium' | 'low';
    reason: string;
  }>;
  /** Required compliance checks based on task analysis */
  requiredChecks: string[];
}

export interface PostflightViolation {
  type: 'missing-purpose' | 'missing-portal-gate' | 'unregistered-symbol' | 'uncaptured-wisdom';
  severity: 'error' | 'warning';
  message: string;
  file?: string;
  suggestion: string;
}

export interface PostflightResult {
  /** Overall compliance status */
  status: 'pass' | 'violations' | 'warnings';
  /** List of violations found */
  violations: PostflightViolation[];
  /** Summary counts */
  summary: {
    totalChecks: number;
    passed: number;
    warnings: number;
    errors: number;
  };
  /** Whether violations should block completion */
  blocksCompletion: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const SYMBOL_PATTERN = /[@#$%^!?&~][a-zA-Z][a-zA-Z0-9_-]*/g;

/** Route patterns for common frameworks */
const ROUTE_PATTERNS = [
  // Express/Fastify
  /\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
  // SvelteKit
  /export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)/gi,
  // Next.js
  /export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)/gi,
  // Hono
  /\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
];

/** Keywords suggesting route addition */
const ROUTE_KEYWORDS = [
  'endpoint', 'route', 'api', 'handler',
  'get', 'post', 'put', 'patch', 'delete',
  'rest', 'crud', 'controller',
];

// ============================================================================
// Preflight
// ============================================================================

/**
 * Run preflight compliance checks before starting a task.
 *
 * Extracts symbols from task text, runs ripple analysis on existing symbols,
 * checks portal.yaml status, and suggests agents.
 */
export function runPreflight(
  task: string,
  rootDir: string,
  index: SymbolIndex
): PreflightResult {
  const taskLower = task.toLowerCase();

  // 1. Extract symbols from task description
  const symbolMatches = task.match(SYMBOL_PATTERN) || [];
  const uniqueSymbols = [...new Set(symbolMatches)];

  const affectedSymbols = uniqueSymbols.map(sym => {
    const results = searchSymbols(index, sym);
    const found = results.length > 0 ? results[0] : null;
    return {
      symbol: sym,
      exists: !!found,
      type: found?.type,
      description: found?.description,
    };
  });

  // 2. Ripple analysis for existing symbols
  const rippleAnalysis = affectedSymbols
    .filter(s => s.exists)
    .map(s => {
      const directDeps = getReferencesTo(index, s.symbol);
      // One level of indirect
      const indirectSet = new Set<string>();
      for (const dep of directDeps) {
        const indirect = getReferencesTo(index, dep.symbol);
        for (const ind of indirect) {
          if (ind.symbol !== s.symbol && !directDeps.find(d => d.symbol === ind.symbol)) {
            indirectSet.add(ind.symbol);
          }
        }
      }

      const total = directDeps.length + indirectSet.size;
      let impact: 'low' | 'medium' | 'high' = 'low';
      if (total > 10) impact = 'high';
      else if (total > 3) impact = 'medium';

      return {
        symbol: s.symbol,
        directDependents: directDeps.length,
        indirectDependents: indirectSet.size,
        impact,
      };
    });

  // 3. Portal status
  const portalLoad = loadPortalConfig(rootDir);
  const portalConfig = portalLoad.status === 'ok' ? portalLoad.data : null;
  const portalStatus = {
    exists: portalLoad.status !== 'missing',
    gateCount: portalConfig ? extractDeclaredGates(portalConfig).length : 0,
    gates: portalConfig ? extractDeclaredGates(portalConfig).map(g => `^${g}`) : [],
    routeCount: portalConfig?.routes ? Object.keys(portalConfig.routes).length : 0,
  };

  // 4. Does the task appear to add routes?
  const taskAddsRoutes = ROUTE_KEYWORDS.some(k => taskLower.includes(k));

  // 5. Suggest agents
  const manifest = loadAgentsManifest(rootDir);
  const suggestedAgents = manifest
    ? suggestAgentsForTask(task, manifest.agents).map(s => ({
        name: s.name,
        confidence: s.confidence,
        reason: s.reason,
      }))
    : [];

  // 6. Determine required checks
  const requiredChecks: string[] = [];
  if (affectedSymbols.some(s => s.exists)) {
    requiredChecks.push('ripple-analysis');
  }
  if (taskAddsRoutes) {
    requiredChecks.push('portal-compliance');
  }
  if (uniqueSymbols.some(s => s.startsWith('^'))) {
    requiredChecks.push('gate-validation');
  }
  if (uniqueSymbols.some(s => s.startsWith('!'))) {
    requiredChecks.push('signal-registration');
  }
  requiredChecks.push('purpose-coverage');

  return {
    affectedSymbols,
    rippleAnalysis,
    portalStatus,
    taskAddsRoutes,
    suggestedAgents,
    requiredChecks,
  };
}

// ============================================================================
// Postflight
// ============================================================================

/**
 * Run postflight compliance checks after completing a task.
 *
 * Scans modified files for route patterns, cross-references against
 * portal.yaml, checks purpose file coverage, and flags unregistered symbols.
 */
export function runPostflight(
  filesModified: string[],
  symbolsTouched: string[],
  rootDir: string,
  index: SymbolIndex
): PostflightResult {
  const violations: PostflightViolation[] = [];

  // 1. Check for new routes without portal.yaml entries
  const portalLoad = loadPortalConfig(rootDir);
  const portalConfig = portalLoad.status === 'ok' ? portalLoad.data : null;
  const declaredGates = portalConfig ? extractDeclaredGates(portalConfig) : [];
  const declaredRoutes = portalConfig?.routes ? Object.keys(portalConfig.routes) : [];

  for (const file of filesModified) {
    const absPath = path.isAbsolute(file) ? file : path.join(rootDir, file);
    if (!fs.existsSync(absPath)) continue;

    let content: string;
    try {
      content = fs.readFileSync(absPath, 'utf-8');
    } catch {
      continue;
    }

    // Scan for route definitions
    for (const pattern of ROUTE_PATTERNS) {
      // Reset regex state
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        const routePath = match[2] || match[0];

        // Check if this route is declared in portal.yaml
        if (routePath && routePath.startsWith('/')) {
          const isKnown = declaredRoutes.some(r => {
            // Normalize for comparison
            const normalizedDeclared = r.replace(/\s+(GET|POST|PUT|PATCH|DELETE)\s*$/, '').trim();
            return normalizedDeclared === routePath;
          });

          if (!isKnown && portalConfig) {
            violations.push({
              type: 'missing-portal-gate',
              severity: 'warning',
              message: `Route "${routePath}" found in ${path.relative(rootDir, absPath)} but not declared in portal.yaml`,
              file: path.relative(rootDir, absPath),
              suggestion: `Add this route to portal.yaml with appropriate ^gates. Run paradigm_gates_for_route to get suggestions.`,
            });
          } else if (!portalConfig && routePath.startsWith('/api/')) {
            violations.push({
              type: 'missing-portal-gate',
              severity: 'warning',
              message: `API route "${routePath}" found but no portal.yaml exists`,
              file: path.relative(rootDir, absPath),
              suggestion: `Create portal.yaml to declare gates for API routes. Run: paradigm portal init`,
            });
          }
        }
      }
    }
  }

  // 2. Check purpose file coverage for touched symbols
  for (const symbol of symbolsTouched) {
    const results = searchSymbols(index, symbol);
    if (results.length === 0) {
      violations.push({
        type: 'unregistered-symbol',
        severity: 'error',
        message: `Symbol "${symbol}" was touched but is not registered in any .purpose file`,
        suggestion: `Add "${symbol}" to the nearest .purpose file. Use paradigm_purpose_add_component or paradigm_purpose_add_signal.`,
      });
    }
  }

  // 3. Check for new gate symbols used but not in portal.yaml
  for (const symbol of symbolsTouched) {
    if (symbol.startsWith('^')) {
      const gateName = symbol.slice(1);
      if (!declaredGates.includes(gateName)) {
        violations.push({
          type: 'missing-portal-gate',
          severity: 'error',
          message: `Gate "${symbol}" is referenced but not declared in portal.yaml`,
          suggestion: `Add ${symbol} to portal.yaml with description and check expression.`,
        });
      }
    }
  }

  // 4. Flag potential uncaptured wisdom (heuristic: large changes without wisdom capture)
  if (filesModified.length >= 5 && symbolsTouched.length >= 3) {
    violations.push({
      type: 'uncaptured-wisdom',
      severity: 'warning',
      message: `Large change (${filesModified.length} files, ${symbolsTouched.length} symbols) — consider recording architectural decisions`,
      suggestion: `Use paradigm_wisdom_record to capture any decisions or antipatterns discovered during this task.`,
    });
  }

  // Compute summary
  const errors = violations.filter(v => v.severity === 'error').length;
  const warnings = violations.filter(v => v.severity === 'warning').length;
  const totalChecks = 4; // routes, purpose, gates, wisdom

  let status: PostflightResult['status'] = 'pass';
  if (errors > 0) status = 'violations';
  else if (warnings > 0) status = 'warnings';

  return {
    status,
    violations,
    summary: {
      totalChecks,
      passed: totalChecks - (errors > 0 ? 1 : 0) - (warnings > 0 ? 1 : 0),
      warnings,
      errors,
    },
    blocksCompletion: errors > 0,
  };
}
