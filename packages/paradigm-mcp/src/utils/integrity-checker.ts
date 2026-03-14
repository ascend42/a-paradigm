/**
 * Integrity Checker — Central utility for Paradigm symbol integrity validation
 *
 * Checks:
 *   1. Broken references (parent, flow, component refs to non-existent symbols)
 *   2. Duplicate symbol IDs across .purpose files
 *   3. Orphaned symbols (zero cross-references)
 *   4. Missing anchor files (for all symbol types, not just aspects)
 *   5. Anchor out-of-bounds (line ranges exceeding file length)
 *   6. Component anchor validation (file existence + line range)
 *   7. Purpose file health (oversized, stale)
 */

import * as fs from 'fs';
import * as path from 'path';
import type { AggregationResult, SymbolEntry, CodeAnchor } from '@a-company/premise-core';

// ============================================================================
// Types
// ============================================================================

export interface IntegrityReport {
  brokenReferences: Array<{
    from: string;
    to: string;
    file: string;
    refType: 'parent' | 'flow' | 'component' | 'signal' | 'gate';
  }>;
  duplicateSymbols: Array<{
    symbol: string;
    files: string[];
  }>;
  orphanedSymbols: Array<{
    symbol: string;
    file: string;
    referenceCount: number;
  }>;
  missingAnchorFiles: Array<{
    symbol: string;
    anchor: string;
  }>;
  anchorOutOfBounds: Array<{
    symbol: string;
    anchor: string;
    fileLines: number;
  }>;
  timestamp: string;
}

export interface PurposeHealthReport {
  oversized: Array<{
    file: string;
    lines: number;
    symbolCount: number;
    suggestion: string;
  }>;
  stale: Array<{
    file: string;
    lastModified: string;
    daysSinceUpdate: number;
    newestSourceFile: string;
  }>;
  healthScore: number; // 0-100
}

export interface ComponentAnchorReport {
  valid: number;
  missing: number;
  outOfBounds: number;
  issues: Array<{
    symbol: string;
    anchor: string;
    status: 'ok' | 'missing' | 'out-of-bounds';
  }>;
}

// ============================================================================
// Core Integrity Check
// ============================================================================

/**
 * Run all integrity checks against an aggregation result.
 */
export function checkIntegrity(
  aggregation: AggregationResult,
  rootDir: string,
): IntegrityReport {
  const symbols = aggregation.symbols;

  return {
    brokenReferences: findBrokenReferences(symbols),
    duplicateSymbols: findDuplicateSymbols(symbols),
    orphanedSymbols: findOrphanedSymbols(symbols),
    missingAnchorFiles: findMissingAnchors(symbols, rootDir),
    anchorOutOfBounds: findAnchorOutOfBounds(symbols, rootDir),
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// Check 1: Broken References
// ============================================================================

function findBrokenReferences(
  symbols: SymbolEntry[],
): IntegrityReport['brokenReferences'] {
  const broken: IntegrityReport['brokenReferences'] = [];
  const definedIds = new Set(symbols.map(s => s.symbol));

  for (const sym of symbols) {
    // Check parentSymbol reference
    if (sym.parentSymbol) {
      const parentRef = normalizeSymbolRef(sym.parentSymbol);
      if (parentRef && !definedIds.has(parentRef)) {
        broken.push({
          from: sym.symbol,
          to: parentRef,
          file: sym.filePath,
          refType: 'parent',
        });
      }
    }

    // Check references array (already resolved by aggregator)
    // These are already validated during resolveReferences, but we also
    // check raw data for explicit symbol refs in flow steps, gates, etc.
    const data = sym.data as Record<string, unknown> | null;
    if (data && typeof data === 'object') {
      // Check flow step symbols
      if (sym.type === 'flow') {
        const steps = (data.steps || []) as Array<{ symbol?: string; component?: string }>;
        for (const step of steps) {
          const ref = step.symbol || step.component;
          if (ref) {
            const normalized = normalizeSymbolRef(ref);
            if (normalized && !definedIds.has(normalized)) {
              broken.push({
                from: sym.symbol,
                to: normalized,
                file: sym.filePath,
                refType: 'flow',
              });
            }
          }
        }

        // Check flow gates list
        const gates = (data.gates || []) as string[];
        for (const gate of gates) {
          const normalized = normalizeSymbolRef(gate);
          if (normalized && !definedIds.has(normalized)) {
            broken.push({
              from: sym.symbol,
              to: normalized,
              file: sym.filePath,
              refType: 'gate',
            });
          }
        }

        // Check flow signals list
        const signals = (data.signals || []) as string[];
        for (const signal of signals) {
          const normalized = normalizeSymbolRef(signal);
          if (normalized && !definedIds.has(normalized)) {
            broken.push({
              from: sym.symbol,
              to: normalized,
              file: sym.filePath,
              refType: 'signal',
            });
          }
        }

        // Check flow components list
        const components = (data.components || []) as string[];
        for (const comp of components) {
          const normalized = normalizeSymbolRef(comp);
          if (normalized && !definedIds.has(normalized)) {
            broken.push({
              from: sym.symbol,
              to: normalized,
              file: sym.filePath,
              refType: 'component',
            });
          }
        }
      }
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  return broken.filter(b => {
    const key = `${b.from}->${b.to}@${b.file}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Normalize a symbol reference to include its prefix.
 * e.g., "#foo" stays "#foo", "foo" with known prefix stays as-is.
 */
function normalizeSymbolRef(ref: string): string | null {
  if (!ref || typeof ref !== 'string') return null;
  const trimmed = ref.trim();
  if (!trimmed) return null;

  // Already has a symbol prefix
  if (/^[#$^!~@%?&]/.test(trimmed)) {
    return trimmed;
  }

  // Bare ID — could be a component reference, add # prefix
  return `#${trimmed}`;
}

// ============================================================================
// Check 2: Duplicate Symbols
// ============================================================================

function findDuplicateSymbols(
  symbols: SymbolEntry[],
): IntegrityReport['duplicateSymbols'] {
  const bySymbol = new Map<string, string[]>();

  for (const sym of symbols) {
    const files = bySymbol.get(sym.symbol) || [];
    if (!files.includes(sym.filePath)) {
      files.push(sym.filePath);
    }
    bySymbol.set(sym.symbol, files);
  }

  const duplicates: IntegrityReport['duplicateSymbols'] = [];
  for (const [symbol, files] of bySymbol) {
    if (files.length > 1) {
      duplicates.push({ symbol, files });
    }
  }

  return duplicates;
}

// ============================================================================
// Check 3: Orphaned Symbols
// ============================================================================

function findOrphanedSymbols(
  symbols: SymbolEntry[],
): IntegrityReport['orphanedSymbols'] {
  const orphaned: IntegrityReport['orphanedSymbols'] = [];

  for (const sym of symbols) {
    const refCount = sym.referencedBy.length;
    if (refCount === 0) {
      orphaned.push({
        symbol: sym.symbol,
        file: sym.filePath,
        referenceCount: 0,
      });
    }
  }

  return orphaned;
}

// ============================================================================
// Check 4: Missing Anchor Files
// ============================================================================

function findMissingAnchors(
  symbols: SymbolEntry[],
  rootDir: string,
): IntegrityReport['missingAnchorFiles'] {
  const missing: IntegrityReport['missingAnchorFiles'] = [];

  for (const sym of symbols) {
    if (!sym.anchors || sym.anchors.length === 0) continue;

    for (const anchor of sym.anchors) {
      const filePath = resolveAnchorPath(anchor.path, rootDir);
      if (!fs.existsSync(filePath)) {
        missing.push({
          symbol: sym.symbol,
          anchor: anchor.raw,
        });
      }
    }
  }

  return missing;
}

// ============================================================================
// Check 5: Anchor Out of Bounds
// ============================================================================

function findAnchorOutOfBounds(
  symbols: SymbolEntry[],
  rootDir: string,
): IntegrityReport['anchorOutOfBounds'] {
  const outOfBounds: IntegrityReport['anchorOutOfBounds'] = [];

  for (const sym of symbols) {
    if (!sym.anchors || sym.anchors.length === 0) continue;

    for (const anchor of sym.anchors) {
      const filePath = resolveAnchorPath(anchor.path, rootDir);
      if (!fs.existsSync(filePath)) continue; // Already caught by missing anchors

      const maxLine = getMaxLine(anchor);
      if (maxLine <= 0) continue;

      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const lineCount = content.split('\n').length;
        if (maxLine > lineCount) {
          outOfBounds.push({
            symbol: sym.symbol,
            anchor: anchor.raw,
            fileLines: lineCount,
          });
        }
      } catch {
        // Can't read file — skip
      }
    }
  }

  return outOfBounds;
}

// ============================================================================
// Component Anchor Validation
// ============================================================================

/**
 * Validate anchors for all symbol types (not just aspects).
 * Lighter than full aspect drift — no SQLite, no git mapping.
 */
export function checkComponentAnchors(
  symbols: SymbolEntry[],
  rootDir: string,
): ComponentAnchorReport {
  const report: ComponentAnchorReport = {
    valid: 0,
    missing: 0,
    outOfBounds: 0,
    issues: [],
  };

  for (const sym of symbols) {
    if (!sym.anchors || sym.anchors.length === 0) continue;

    for (const anchor of sym.anchors) {
      const filePath = resolveAnchorPath(anchor.path, rootDir);

      if (!fs.existsSync(filePath)) {
        report.missing++;
        report.issues.push({
          symbol: sym.symbol,
          anchor: anchor.raw,
          status: 'missing',
        });
        continue;
      }

      const maxLine = getMaxLine(anchor);
      if (maxLine > 0) {
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const lineCount = content.split('\n').length;
          if (maxLine > lineCount) {
            report.outOfBounds++;
            report.issues.push({
              symbol: sym.symbol,
              anchor: anchor.raw,
              status: 'out-of-bounds',
            });
            continue;
          }
        } catch {
          // Can't read — treat as missing
          report.missing++;
          report.issues.push({
            symbol: sym.symbol,
            anchor: anchor.raw,
            status: 'missing',
          });
          continue;
        }
      }

      report.valid++;
      report.issues.push({
        symbol: sym.symbol,
        anchor: anchor.raw,
        status: 'ok',
      });
    }
  }

  return report;
}

// ============================================================================
// Purpose File Health
// ============================================================================

const SKIP_DIRS = new Set([
  'node_modules', 'dist', '.git', '.paradigm', 'coverage',
  'build', '__pycache__', 'target', '.next', '.nuxt',
]);

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.js', '.tsx', '.jsx', '.py', '.rs', '.go', '.swift',
]);

/**
 * Check purpose file health: oversized files and staleness.
 */
export function checkPurposeHealth(
  purposeFiles: string[],
  rootDir: string,
): PurposeHealthReport {
  const oversized: PurposeHealthReport['oversized'] = [];
  const stale: PurposeHealthReport['stale'] = [];

  for (const filePath of purposeFiles) {
    const absPath = path.isAbsolute(filePath) ? filePath : path.join(rootDir, filePath);
    if (!fs.existsSync(absPath)) continue;

    let content: string;
    try {
      content = fs.readFileSync(absPath, 'utf8');
    } catch {
      continue;
    }

    const lines = content.split('\n').length;

    // Count top-level symbols (rough count by looking for key patterns)
    const symbolMatches = content.match(/^  [A-Za-z][A-Za-z0-9_-]*:/gm) || [];
    const symbolCount = symbolMatches.length;

    // Oversized check
    if (lines > 500) {
      const severity = lines > 1000 ? 'strongly recommend' : 'consider';
      let suggestion: string;
      if (symbolCount >= 10) {
        suggestion = `${severity} splitting: ${symbolCount} top-level symbols across ${lines} lines. Split by component type or subdirectory.`;
      } else {
        suggestion = `${severity} splitting: ${lines} lines. Reduce descriptions or extract sub-components.`;
      }

      oversized.push({
        file: path.relative(rootDir, absPath),
        lines,
        symbolCount,
        suggestion,
      });
    }

    // Staleness check
    try {
      const purposeStat = fs.statSync(absPath);
      const purposeDir = path.dirname(absPath);
      const newestSource = findNewestSourceFile(purposeDir, rootDir);

      if (newestSource) {
        const sourceStat = fs.statSync(newestSource.path);
        const daysDiff = Math.floor(
          (sourceStat.mtime.getTime() - purposeStat.mtime.getTime()) / (1000 * 60 * 60 * 24),
        );

        if (daysDiff >= 7) {
          stale.push({
            file: path.relative(rootDir, absPath),
            lastModified: purposeStat.mtime.toISOString(),
            daysSinceUpdate: daysDiff,
            newestSourceFile: path.relative(rootDir, newestSource.path),
          });
        }
      }
    } catch {
      // Skip stat errors
    }
  }

  // Health score: 100 base, -10 per oversized, -5 per stale, floor at 0
  const score = Math.max(0, 100 - oversized.length * 10 - stale.length * 5);

  return { oversized, stale, healthScore: score };
}

// ============================================================================
// Helpers
// ============================================================================

function resolveAnchorPath(anchorPath: string, rootDir: string): string {
  if (path.isAbsolute(anchorPath)) return anchorPath;
  return path.join(rootDir, anchorPath);
}

function getMaxLine(anchor: CodeAnchor): number {
  if (typeof anchor.lines === 'number') {
    return anchor.lines;
  }
  if (Array.isArray(anchor.lines)) {
    return Math.max(...anchor.lines);
  }
  return 0;
}

/**
 * Find the newest source file in a directory (non-recursive, immediate children only).
 */
function findNewestSourceFile(
  dir: string,
  _rootDir: string,
): { path: string; mtime: number } | null {
  let newest: { path: string; mtime: number } | null = null;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (SKIP_DIRS.has(entry.name)) continue;

      const ext = path.extname(entry.name);
      if (!SOURCE_EXTENSIONS.has(ext)) continue;

      const fullPath = path.join(dir, entry.name);
      try {
        const stat = fs.statSync(fullPath);
        if (!newest || stat.mtime.getTime() > newest.mtime) {
          newest = { path: fullPath, mtime: stat.mtime.getTime() };
        }
      } catch {
        continue;
      }
    }
  } catch {
    // Can't read directory
  }

  return newest;
}
