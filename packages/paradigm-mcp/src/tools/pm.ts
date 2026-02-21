/**
 * PM Governance MCP Tools
 *
 * Two tools for automated compliance enforcement:
 * - paradigm_pm_preflight: Run before starting a task
 * - paradigm_pm_postflight: Run after completing a task
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  searchSymbols,
  getReferencesTo,
  getAllSymbols,
  getSymbolsByType,
} from '@a-company/premise-core';
import type { ProjectContext } from '../utils/index-loader.js';
import { trackToolCall } from './context.js';

// ============================================================================
// Constants
// ============================================================================

const SYMBOL_PATTERN = /[@#$%^!?&~][a-zA-Z][a-zA-Z0-9_-]*/g;

const ROUTE_KEYWORDS = [
  'endpoint', 'route', 'api', 'handler',
  'get', 'post', 'put', 'patch', 'delete',
  'rest', 'crud', 'controller',
];

const ROUTE_FILE_PATTERNS = [
  // Express/Fastify
  /\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
  // SvelteKit/Next.js export functions
  /export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)/gi,
];

// ============================================================================
// Tool Definitions
// ============================================================================

export function getPmToolsList() {
  return [
    {
      name: 'paradigm_pm_preflight',
      description:
        'REQUIRED before implementing features. Call with mode="plan" to get the right agents and cost estimate. Skipping this for complex tasks leads to missed security reviews and wasted tokens.\n\nRuns pre-flight compliance checks: extracts affected symbols, runs ripple analysis, checks portal.yaml status, and suggests required agents.',
      inputSchema: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: 'The task description to analyze for compliance requirements',
          },
        },
        required: ['task'],
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_pm_postflight',
      description:
        'Run after completing a task to check compliance. Verifies that new components, routes, and events are properly registered in .purpose files and portal.yaml. Flags unregistered symbols and uncaptured wisdom.',
      inputSchema: {
        type: 'object',
        properties: {
          filesModified: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of files modified during the task',
          },
          symbolsTouched: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of symbols (e.g., ["#auth-handler", "^authenticated"]) touched during the task',
          },
        },
        required: ['filesModified', 'symbolsTouched'],
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
  ];
}

// ============================================================================
// Tool Handler
// ============================================================================

export async function handlePmTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ProjectContext
): Promise<{ text: string; handled: boolean }> {
  switch (name) {
    case 'paradigm_pm_preflight': {
      const { task } = args as { task: string };
      const result = runPreflightCheck(task, ctx);
      const text = JSON.stringify(result, null, 2);
      trackToolCall(text.length, name);
      return { text, handled: true };
    }

    case 'paradigm_pm_postflight': {
      const { filesModified, symbolsTouched } = args as {
        filesModified: string[];
        symbolsTouched: string[];
      };
      const result = runPostflightCheck(filesModified, symbolsTouched, ctx);
      const text = JSON.stringify(result, null, 2);
      trackToolCall(text.length, name);
      return { text, handled: true };
    }

    default:
      return { text: '', handled: false };
  }
}

// ============================================================================
// Preflight Implementation
// ============================================================================

function runPreflightCheck(task: string, ctx: ProjectContext) {
  const taskLower = task.toLowerCase();

  // 1. Extract symbols from task
  const symbolMatches = task.match(SYMBOL_PATTERN) || [];
  const uniqueSymbols = [...new Set(symbolMatches)];

  const affectedSymbols = uniqueSymbols.map(sym => {
    const results = searchSymbols(ctx.index, sym);
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
      const directDeps = getReferencesTo(ctx.index, s.symbol);
      const indirectSet = new Set<string>();
      for (const dep of directDeps) {
        const indirect = getReferencesTo(ctx.index, dep.symbol);
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
  const portalStatus = {
    exists: ctx.gateConfig !== null,
    gateCount: 0 as number,
    gates: [] as string[],
    routeCount: 0,
  };

  if (ctx.gateConfig) {
    const gates = Object.keys(ctx.gateConfig.gates || {});
    portalStatus.gateCount = gates.length;
    portalStatus.gates = gates.map(g => g.startsWith('^') ? g : `^${g}`);
    portalStatus.routeCount = Object.keys(ctx.gateConfig.routes || {}).length;
  }

  // 4. Task adds routes?
  const taskAddsRoutes = ROUTE_KEYWORDS.some(k => taskLower.includes(k));

  // 5. Required checks
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
    task: task.slice(0, 100) + (task.length > 100 ? '...' : ''),
    affectedSymbols,
    rippleAnalysis,
    portalStatus,
    taskAddsRoutes,
    requiredChecks,
    recommendations: buildPreflightRecommendations(affectedSymbols, rippleAnalysis, portalStatus, taskAddsRoutes),
  };
}

function buildPreflightRecommendations(
  symbols: Array<{ symbol: string; exists: boolean }>,
  ripple: Array<{ symbol: string; impact: string }>,
  portal: { exists: boolean; gateCount: number },
  addsRoutes: boolean
): string[] {
  const recs: string[] = [];

  const newSymbols = symbols.filter(s => !s.exists);
  if (newSymbols.length > 0) {
    recs.push(`New symbols detected: ${newSymbols.map(s => s.symbol).join(', ')}. Register in .purpose files after implementation.`);
  }

  const highImpact = ripple.filter(r => r.impact === 'high');
  if (highImpact.length > 0) {
    recs.push(`HIGH IMPACT: ${highImpact.map(r => r.symbol).join(', ')} — review all dependents before modifying.`);
  }

  if (addsRoutes && !portal.exists) {
    recs.push('Task adds routes but no portal.yaml exists. Create one with appropriate ^gates.');
  } else if (addsRoutes) {
    recs.push('Task adds routes. Update portal.yaml with gate entries after implementation.');
  }

  const gateSymbols = symbols.filter(s => s.symbol.startsWith('^') && !s.exists);
  if (gateSymbols.length > 0) {
    recs.push(`New gates referenced: ${gateSymbols.map(s => s.symbol).join(', ')}. Add to portal.yaml.`);
  }

  return recs;
}

// ============================================================================
// Postflight Implementation
// ============================================================================

interface PostflightViolation {
  type: 'missing-purpose' | 'missing-portal-gate' | 'unregistered-symbol' | 'uncaptured-wisdom' | 'stale-aspect';
  severity: 'error' | 'warning';
  message: string;
  file?: string;
  suggestion: string;
}

function runPostflightCheck(
  filesModified: string[],
  symbolsTouched: string[],
  ctx: ProjectContext
) {
  const violations: PostflightViolation[] = [];

  // 1. Check for new routes without portal.yaml entries
  const declaredRoutes = ctx.gateConfig?.routes ? Object.keys(ctx.gateConfig.routes) : [];

  for (const file of filesModified) {
    const absPath = path.isAbsolute(file) ? file : path.join(ctx.rootDir, file);
    if (!fs.existsSync(absPath)) continue;

    let content: string;
    try {
      content = fs.readFileSync(absPath, 'utf-8');
    } catch {
      continue;
    }

    for (const pattern of ROUTE_FILE_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        const routePath = match[2] || match[0];
        if (routePath && routePath.startsWith('/')) {
          const isKnown = declaredRoutes.some(r => {
            const normalized = r.replace(/\s+(GET|POST|PUT|PATCH|DELETE)\s*$/, '').trim();
            return normalized === routePath;
          });

          if (!isKnown && ctx.gateConfig) {
            violations.push({
              type: 'missing-portal-gate',
              severity: 'warning',
              message: `Route "${routePath}" in ${path.relative(ctx.rootDir, absPath)} not in portal.yaml`,
              file: path.relative(ctx.rootDir, absPath),
              suggestion: 'Add route to portal.yaml with ^gates. Use paradigm_gates_for_route for suggestions.',
            });
          } else if (!ctx.gateConfig && routePath.startsWith('/api/')) {
            violations.push({
              type: 'missing-portal-gate',
              severity: 'warning',
              message: `API route "${routePath}" found but no portal.yaml exists`,
              file: path.relative(ctx.rootDir, absPath),
              suggestion: 'Create portal.yaml to declare gates for API routes.',
            });
          }
        }
      }
    }
  }

  // 2. Check purpose file coverage
  for (const symbol of symbolsTouched) {
    const results = searchSymbols(ctx.index, symbol);
    if (results.length === 0) {
      violations.push({
        type: 'unregistered-symbol',
        severity: 'error',
        message: `Symbol "${symbol}" is not registered in any .purpose file`,
        suggestion: 'Add to nearest .purpose file using paradigm_purpose_add_component or paradigm_purpose_add_signal.',
      });
    }
  }

  // 3. Check gate symbols against portal.yaml
  const declaredGateNames = ctx.gateConfig
    ? Object.keys(ctx.gateConfig.gates || {}).map(g => g.startsWith('^') ? g.slice(1) : g)
    : [];

  for (const symbol of symbolsTouched) {
    if (symbol.startsWith('^')) {
      const gateName = symbol.slice(1);
      if (!declaredGateNames.includes(gateName)) {
        violations.push({
          type: 'missing-portal-gate',
          severity: 'error',
          message: `Gate "${symbol}" referenced but not declared in portal.yaml`,
          suggestion: `Add ${symbol} to portal.yaml with description and check expression.`,
        });
      }
    }
  }

  // 4. Aspect coverage check
  // For every aspect in the index, check if touched symbols should be in applies-to
  // and if anchor files still exist
  const aspects = getSymbolsByType(ctx.index, 'aspect');
  for (const aspect of aspects) {
    const appliesTo = aspect.appliesTo || [];
    if (appliesTo.length === 0) continue;

    // Check if any touched symbol matches an applies-to pattern
    for (const pattern of appliesTo) {
      const isGlob = pattern.includes('*');
      for (const symbol of symbolsTouched) {
        let matches = false;
        if (isGlob) {
          const regex = new RegExp('^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*') + '$');
          matches = regex.test(symbol);
        } else {
          matches = symbol === pattern;
        }

        if (matches) {
          // Symbol matches an aspect's applies-to — check the aspect's anchors are valid
          const anchors = aspect.anchors || [];
          if (anchors.length === 0) {
            violations.push({
              type: 'stale-aspect',
              severity: 'warning',
              message: `Aspect "${aspect.symbol}" applies to "${symbol}" but has no code anchors`,
              suggestion: `Add anchors to ${aspect.symbol} in .purpose file. Run paradigm_aspect_check for details.`,
            });
          } else {
            for (const anchor of anchors) {
              const filePath = path.isAbsolute(anchor.path)
                ? anchor.path
                : path.join(ctx.rootDir, anchor.path);
              if (!fs.existsSync(filePath)) {
                violations.push({
                  type: 'stale-aspect',
                  severity: 'warning',
                  message: `Aspect "${aspect.symbol}" anchor "${anchor.raw}" points to missing file`,
                  suggestion: `Update anchors for ${aspect.symbol} in .purpose file.`,
                });
              }
            }
          }
        }
      }
    }

    // Check if touched symbols should be in applies-to but aren't
    for (const symbol of symbolsTouched) {
      if (!symbol.startsWith('#')) continue; // aspects mostly apply to components

      // Check if any sibling components are in applies-to but this one isn't
      const data = (aspect.data || {}) as Record<string, unknown>;
      const aspectRefs = (data.aspects || []) as string[];
      // We only flag if the aspect uses glob patterns that might match
      for (const pattern of appliesTo) {
        if (!pattern.includes('*')) continue;
        const regex = new RegExp('^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*') + '$');
        if (regex.test(symbol)) {
          // This symbol matches the glob but may not have the aspect applied
          // This is an informational check — the aspect_check tool does deeper validation
          break;
        }
      }
    }
  }

  // 5. Wisdom capture hint
  if (filesModified.length >= 5 && symbolsTouched.length >= 3) {
    violations.push({
      type: 'uncaptured-wisdom',
      severity: 'warning',
      message: `Large change (${filesModified.length} files, ${symbolsTouched.length} symbols) — consider recording decisions`,
      suggestion: 'Use paradigm_wisdom_record to capture architectural decisions or antipatterns.',
    });
  }

  // Summary
  const errors = violations.filter(v => v.severity === 'error').length;
  const warnings = violations.filter(v => v.severity === 'warning').length;

  let status: 'pass' | 'violations' | 'warnings' = 'pass';
  if (errors > 0) status = 'violations';
  else if (warnings > 0) status = 'warnings';

  return {
    status,
    violations,
    summary: {
      totalChecks: 5,
      passed: 5 - (errors > 0 ? 1 : 0) - (warnings > 0 ? 1 : 0),
      warnings,
      errors,
    },
    blocksCompletion: errors > 0,
  };
}
