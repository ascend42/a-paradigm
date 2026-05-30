/**
 * Compliance Checker — shared compliance logic used by pm.ts postflight and review command
 *
 * Checks:
 *   1. Purpose file coverage for symbols
 *   2. Portal gate compliance (routes + gate declarations)
 *   3. Aspect anchor validity
 *   4. Broken parent references
 *   5. Route coverage in portal.yaml
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  searchSymbols,
  checkAspectAnchors,
} from '@a-company/premise-core';
import type { ParsedGateConfig } from '@a-company/portal-core';

// ────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────

export interface ComplianceFinding {
  /** Finding type */
  type: 'blocking' | 'improvement' | 'note';
  /** Category of the finding */
  category:
    | 'purpose-coverage'
    | 'portal-compliance'
    | 'aspect-anchors'
    | 'broken-reference'
    | 'route-coverage'
    | 'security'
    | 'convention'
    | 'test-coverage';
  /** Human-readable message */
  message: string;
  /** File path if applicable */
  file?: string;
  /** Line number if applicable */
  line?: number;
  /** Suggested fix */
  suggestion?: string;
}

export interface ComplianceContext {
  /** Root directory of the project */
  rootDir: string;
  /** Parsed scan index */
  index: unknown;
  /**
   * Gate config from portal.yaml.
   *
   * Runtime shape is `ParsedGateConfig` (produced by `index-loader.ts:60` /
   * `parseGateConfig`), in which `gates` is `Gate[]` (an Array), not a
   * record keyed by id. Prior versions typed this as
   * `Record<string, unknown> | null`, which silently allowed
   * `Object.keys(gates)` — returning `['0','1','2',…]` for an Array. That
   * produced false "missing-portal-gate" violations (v5.37.12 security audit
   * Scenario C) and is fixed here by switching to the accurate type.
   *
   * Also accepts the raw-record shape for callers that load portal.yaml
   * directly via `yaml.load` (e.g. `pm.ts`'s legacy path). Consumers MUST
   * runtime-check the shape before iterating.
   */
  gateConfig:
    | ParsedGateConfig
    | { gates?: unknown; routes?: unknown; [k: string]: unknown }
    | null;
  /** List of purpose file entries */
  purposeFiles: Array<{ filePath: string }>;
}

/**
 * Extract declared gate names (bare, no `^` prefix) from a gate config that
 * may be either `Gate[]` (ParsedGateConfig, canonical runtime shape) or a
 * `Record<string, ...>` (raw yaml.load shape). Throws if the shape is
 * unrecognized — we fail loudly rather than silently producing numeric
 * indices from Object.keys on an Array.
 */
export function extractDeclaredGateNames(
  gateConfig: ComplianceContext['gateConfig'],
): string[] {
  if (!gateConfig) return [];
  const gates = (gateConfig as { gates?: unknown }).gates;
  if (gates == null) return [];

  if (Array.isArray(gates)) {
    // Canonical ParsedGateConfig shape — Gate[] with `id` field.
    return gates
      .map((g: unknown) => {
        if (g && typeof g === 'object' && 'id' in g && typeof (g as { id: unknown }).id === 'string') {
          const id = (g as { id: string }).id;
          return id.startsWith('^') ? id.slice(1) : id;
        }
        return null;
      })
      .filter((n): n is string => n !== null);
  }

  if (typeof gates === 'object') {
    // Raw record shape: { [id]: GateDef }
    return Object.keys(gates as Record<string, unknown>).map(g =>
      g.startsWith('^') ? g.slice(1) : g,
    );
  }

  throw new Error(
    `Invalid gateConfig.gates shape: expected Array or Record, got ${typeof gates}`,
  );
}

const ROUTE_FILE_PATTERNS = [
  /\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
  /export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)/gi,
];

// ────────────────────────────────────────────────────────
// Stage 1: Spec Compliance
// ────────────────────────────────────────────────────────

/**
 * Run spec compliance checks on the given files and symbols.
 */
export function checkSpecCompliance(
  filesModified: string[],
  symbolsTouched: string[],
  ctx: ComplianceContext
): ComplianceFinding[] {
  const findings: ComplianceFinding[] = [];

  // 1. Purpose coverage
  for (const symbol of symbolsTouched) {
    const results = searchSymbols(ctx.index, symbol);
    if (results.length === 0) {
      findings.push({
        type: 'blocking',
        category: 'purpose-coverage',
        message: `Symbol "${symbol}" is not registered in any .purpose file`,
        suggestion: 'Add to nearest .purpose file using paradigm_purpose_add_component.',
      });
    }
  }

  // 2. Route coverage
  // `routes` only exists on the raw yaml.load shape (not ParsedGateConfig).
  // Guard against Array shape too, to avoid the same Object.keys-on-array
  // pitfall that broke gate lookup.
  const rawRoutes = (ctx.gateConfig as { routes?: unknown } | null)?.routes;
  const declaredRoutes =
    rawRoutes && !Array.isArray(rawRoutes) && typeof rawRoutes === 'object'
      ? Object.keys(rawRoutes as Record<string, unknown>)
      : [];

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

          if (!isKnown) {
            findings.push({
              type: ctx.gateConfig ? 'blocking' : 'improvement',
              category: 'route-coverage',
              message: `Route "${routePath}" in ${path.relative(ctx.rootDir, absPath)} not in portal.yaml`,
              file: path.relative(ctx.rootDir, absPath),
              suggestion: 'Add route to portal.yaml with ^gates.',
            });
          }
        }
      }
    }
  }

  // 3. Gate declarations
  // Runtime gateConfig.gates is Gate[] (an Array) when produced by
  // parseGateConfig (index-loader.ts), not a Record. Use the shape-aware
  // helper to avoid Object.keys(Array) returning ['0','1','2',…] — the
  // v5.37.12 Scenario C auth-bypass vector.
  const declaredGateNames = extractDeclaredGateNames(ctx.gateConfig);

  for (const symbol of symbolsTouched) {
    if (symbol.startsWith('^')) {
      const gateName = symbol.slice(1);
      if (!declaredGateNames.includes(gateName)) {
        findings.push({
          type: 'blocking',
          category: 'portal-compliance',
          message: `Gate "${symbol}" referenced but not declared in portal.yaml`,
          suggestion: `Add ${symbol} to portal.yaml with description and check expression.`,
        });
      }
    }
  }

  // 4. Aspect anchors — delegated to the shared checkAspectAnchors helper
  // (premise-core) for correct path resolution and per-aspect dedup.
  for (const issue of checkAspectAnchors(ctx.index, symbolsTouched, ctx.rootDir)) {
    findings.push({
      type: 'improvement',
      category: 'aspect-anchors',
      message: issue.kind === 'no-anchors'
        ? `Aspect "${issue.aspectSymbol}" has no code anchors`
        : `Aspect "${issue.aspectSymbol}" anchor "${issue.anchorRaw}" points to missing file`,
      suggestion: `Update anchors for ${issue.aspectSymbol} in .purpose file.`,
    });
  }

  // 5. Broken parent references
  for (const symbol of symbolsTouched) {
    const results = searchSymbols(ctx.index, symbol);
    if (results.length === 0) continue;

    const sym = results[0];
    if (sym.parentSymbol) {
      const parentResults = searchSymbols(ctx.index, sym.parentSymbol);
      if (parentResults.length === 0) {
        findings.push({
          type: 'improvement',
          category: 'broken-reference',
          message: `Symbol "${symbol}" references parent "${sym.parentSymbol}" which does not exist`,
          suggestion: `Create the parent symbol or update the parent reference.`,
        });
      }
    }
  }

  return findings;
}

// ────────────────────────────────────────────────────────
// Stage 2: Deep Code Quality (--deep)
// ────────────────────────────────────────────────────────

/**
 * Run deep code quality checks on modified files.
 */
export function checkCodeQuality(
  filesModified: string[],
  rootDir: string
): ComplianceFinding[] {
  const findings: ComplianceFinding[] = [];

  for (const file of filesModified) {
    const absPath = path.isAbsolute(file) ? file : path.join(rootDir, file);
    if (!fs.existsSync(absPath)) continue;

    // Only check source files
    const ext = path.extname(file);
    if (!['.ts', '.tsx', '.js', '.jsx', '.py', '.rs'].includes(ext)) continue;

    let content: string;
    try {
      content = fs.readFileSync(absPath, 'utf-8');
    } catch {
      continue;
    }

    const relPath = path.relative(rootDir, absPath);
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Check for eval()
      if (/\beval\s*\(/.test(line) && !line.trimStart().startsWith('//')) {
        findings.push({
          type: 'blocking',
          category: 'security',
          message: `eval() detected — potential code injection risk`,
          file: relPath,
          line: lineNum,
          suggestion: 'Replace eval() with a safer alternative.',
        });
      }

      // Check for hardcoded secrets patterns
      if (/(?:password|secret|api_key|apikey|token)\s*[:=]\s*['"][^'"]{8,}['"]/i.test(line)) {
        if (!line.trimStart().startsWith('//') && !line.trimStart().startsWith('#')) {
          findings.push({
            type: 'blocking',
            category: 'security',
            message: `Possible hardcoded secret detected`,
            file: relPath,
            line: lineNum,
            suggestion: 'Move secrets to environment variables or a secrets manager.',
          });
        }
      }

      // Check for console.log in non-test files
      if (/\bconsole\.(log|debug|info|warn)\b/.test(line) && !file.includes('test') && !file.includes('spec')) {
        if (!line.trimStart().startsWith('//')) {
          findings.push({
            type: 'note',
            category: 'convention',
            message: `console.log detected — use Paradigm logger instead`,
            file: relPath,
            line: lineNum,
            suggestion: 'Use log.component(), log.gate(), etc. from the Paradigm logger.',
          });
        }
      }
    }
  }

  return findings;
}
