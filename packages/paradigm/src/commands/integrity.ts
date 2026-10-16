/**
 * paradigm integrity — Symbol integrity check
 *
 * Validates broken references, duplicate symbols, undeclared references
 * (warning), orphaned symbols, and missing anchor files across the
 * project's .purpose files.
 *
 * Usage:
 *   paradigm integrity          Show integrity report
 *   paradigm integrity --json   Output machine-readable JSON
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  aggregateFromDirectory,
  findDuplicateDeclarations,
  findDanglingReferences,
  type SymbolEntry,
  type CodeAnchor,
} from '@a-company/premise-core';
import chalk from 'chalk';

interface IntegrityOptions {
  json?: boolean;
}

export async function integrityCommand(options: IntegrityOptions = {}): Promise<void> {
  const cwd = process.cwd();

  const aggregation = await aggregateFromDirectory(cwd);
  const symbols = aggregation.symbols;

  // Run all checks
  const brokenRefs = findBrokenReferences(symbols);
  const duplicates = findDuplicateDeclarations(symbols);
  const undeclared = findUndeclaredReferences(symbols);
  const orphaned = findOrphanedSymbols(symbols);
  const missingAnchors = findMissingAnchors(symbols, cwd);
  const outOfBounds = findAnchorOutOfBounds(symbols, cwd);

  const brokenCount = brokenRefs.length;
  const duplicateCount = duplicates.length;
  const undeclaredCount = undeclared.length;
  const orphanedCount = orphaned.length;
  const missingAnchorCount = missingAnchors.length;
  const outOfBoundsCount = outOfBounds.length;

  if (options.json) {
    const result = {
      brokenCount,
      duplicateCount,
      undeclaredCount,
      orphanedCount,
      missingAnchors: missingAnchorCount,
      outOfBoundsAnchors: outOfBoundsCount,
      details: {
        brokenReferences: brokenRefs,
        duplicateSymbols: duplicates,
        undeclaredReferences: undeclared,
        orphanedSymbols: orphaned.slice(0, 20),
        missingAnchorFiles: missingAnchors,
        anchorOutOfBounds: outOfBounds,
      },
    };
    console.log(JSON.stringify(result));
    return;
  }

  console.log(chalk.blue('\n🔍 Paradigm Integrity Check\n'));

  // Broken references
  if (brokenCount > 0) {
    console.log(chalk.red(`  ✗ ${brokenCount} broken reference${brokenCount > 1 ? 's' : ''}`));
    for (const ref of brokenRefs.slice(0, 10)) {
      console.log(chalk.gray(`    │ ${ref.from} → ${ref.to} (${ref.refType}) in ${ref.file}`));
    }
    if (brokenCount > 10) {
      console.log(chalk.gray(`    │ ... and ${brokenCount - 10} more`));
    }
  } else {
    console.log(chalk.green('  ✓ No broken references'));
  }

  // Duplicate symbols
  if (duplicateCount > 0) {
    console.log(chalk.red(`  ✗ ${duplicateCount} duplicate symbol${duplicateCount > 1 ? 's' : ''}`));
    for (const dup of duplicates.slice(0, 10)) {
      console.log(chalk.gray(`    │ ${dup.symbol} defined in: ${dup.files.join(', ')}`));
    }
  } else {
    console.log(chalk.green('  ✓ No duplicate symbols'));
  }

  // Undeclared references — referenced but never declared (warning)
  if (undeclaredCount > 0) {
    console.log(chalk.yellow(`  ⚠ ${undeclaredCount} undeclared reference${undeclaredCount > 1 ? 's' : ''} (referenced but never declared)`));
    for (const ref of undeclared.slice(0, 10)) {
      console.log(chalk.gray(`    │ ${ref.from} → ${ref.to} in ${ref.file}`));
    }
    if (undeclaredCount > 10) {
      console.log(chalk.gray(`    │ ... and ${undeclaredCount - 10} more`));
    }
  } else {
    console.log(chalk.green('  ✓ No undeclared references'));
  }

  // Orphaned symbols (true isolates — no refs in or out)
  if (orphanedCount > 0) {
    console.log(chalk.yellow(`  ⚠ ${orphanedCount} isolated symbol${orphanedCount > 1 ? 's' : ''} (no connections to other symbols)`));
    for (const orph of orphaned.slice(0, 5)) {
      console.log(chalk.gray(`    │ ${orph.symbol} in ${orph.file}`));
    }
    if (orphanedCount > 5) {
      console.log(chalk.gray(`    │ ... and ${orphanedCount - 5} more`));
    }
  } else {
    console.log(chalk.green('  ✓ All symbols are connected'));
  }

  // Missing anchors
  if (missingAnchorCount > 0) {
    console.log(chalk.red(`  ✗ ${missingAnchorCount} anchor${missingAnchorCount > 1 ? 's' : ''} pointing to missing files`));
    for (const a of missingAnchors.slice(0, 5)) {
      console.log(chalk.gray(`    │ ${a.symbol}: ${a.anchor}`));
    }
  } else {
    console.log(chalk.green('  ✓ All anchor files exist'));
  }

  // Out of bounds anchors
  if (outOfBoundsCount > 0) {
    console.log(chalk.yellow(`  ⚠ ${outOfBoundsCount} anchor${outOfBoundsCount > 1 ? 's' : ''} with line ranges exceeding file length`));
    for (const a of outOfBounds.slice(0, 5)) {
      console.log(chalk.gray(`    │ ${a.symbol}: ${a.anchor} (file has ${a.fileLines} lines)`));
    }
  } else {
    console.log(chalk.green('  ✓ All anchor line ranges valid'));
  }

  // Summary
  const totalIssues = brokenCount + duplicateCount + missingAnchorCount + outOfBoundsCount;
  console.log('');
  if (totalIssues === 0) {
    console.log(chalk.green('✨ All integrity checks passed!\n'));
  } else {
    console.log(`${totalIssues} issue${totalIssues > 1 ? 's' : ''} found. Run 'paradigm doctor' for full diagnostics.\n`);
  }
}

// ============================================================================
// Check implementations (mirrored from paradigm-mcp/utils/integrity-checker.ts)
// ============================================================================

interface BrokenRef {
  from: string;
  to: string;
  file: string;
  refType: string;
}

function findBrokenReferences(symbols: SymbolEntry[]): BrokenRef[] {
  const broken: BrokenRef[] = [];
  // Reference stubs (declared === false) are indexed but not defined.
  const definedIds = new Set(symbols.filter(s => s.declared !== false).map(s => s.symbol));

  for (const sym of symbols) {
    if (sym.parentSymbol) {
      const parentRef = sym.parentSymbol.trim();
      const normalized = /^[#$^!~]/.test(parentRef) ? parentRef : `#${parentRef}`;
      if (!definedIds.has(normalized)) {
        broken.push({ from: sym.symbol, to: normalized, file: sym.filePath, refType: 'parent' });
      }
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  return broken.filter(b => {
    const key = `${b.from}->${b.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Referrer → undeclared symbol edges (shared helper from premise-core). */
function findUndeclaredReferences(symbols: SymbolEntry[]): Array<{ from: string; to: string; file: string }> {
  const byName = new Map(symbols.map(s => [s.symbol, s]));
  return findDanglingReferences(symbols).flatMap(d =>
    d.referencedBy.map(from => ({ from, to: d.symbol, file: byName.get(from)?.filePath ?? d.filePath })),
  );
}

function findOrphanedSymbols(symbols: SymbolEntry[]): Array<{ symbol: string; file: string }> {
  // True orphan = nothing references it AND it references nothing.
  // Symbols with outgoing refs but no incoming are tree roots — not orphans.
  return symbols
    .filter(s => s.declared !== false && s.referencedBy.length === 0 && s.references.length === 0)
    .map(s => ({ symbol: s.symbol, file: s.filePath }));
}

function resolveAnchorPath(anchorPath: string, rootDir: string, purposeFilePath?: string): string {
  if (path.isAbsolute(anchorPath)) return anchorPath;
  // Try relative to .purpose file's directory first
  if (purposeFilePath) {
    const purposeDir = path.dirname(purposeFilePath);
    const relativePath = path.join(purposeDir, anchorPath);
    if (fs.existsSync(relativePath)) return relativePath;
  }
  return path.join(rootDir, anchorPath);
}

function findMissingAnchors(symbols: SymbolEntry[], rootDir: string): Array<{ symbol: string; anchor: string }> {
  const missing: Array<{ symbol: string; anchor: string }> = [];
  for (const sym of symbols) {
    if (!sym.anchors || sym.anchors.length === 0) continue;
    for (const anchor of sym.anchors) {
      const filePath = resolveAnchorPath(anchor.path, rootDir, sym.filePath);
      if (!fs.existsSync(filePath)) {
        missing.push({ symbol: sym.symbol, anchor: anchor.raw });
      }
    }
  }
  return missing;
}

function findAnchorOutOfBounds(symbols: SymbolEntry[], rootDir: string): Array<{ symbol: string; anchor: string; fileLines: number }> {
  const oob: Array<{ symbol: string; anchor: string; fileLines: number }> = [];
  for (const sym of symbols) {
    if (!sym.anchors || sym.anchors.length === 0) continue;
    for (const anchor of sym.anchors) {
      const filePath = resolveAnchorPath(anchor.path, rootDir, sym.filePath);
      if (!fs.existsSync(filePath)) continue;
      const maxLine = getMaxLine(anchor);
      if (maxLine <= 0) continue;
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const lineCount = content.split('\n').length;
        if (maxLine > lineCount) {
          oob.push({ symbol: sym.symbol, anchor: anchor.raw, fileLines: lineCount });
        }
      } catch {
        // skip
      }
    }
  }
  return oob;
}

function getMaxLine(anchor: CodeAnchor): number {
  if (typeof anchor.lines === 'number') return anchor.lines;
  if (Array.isArray(anchor.lines)) return Math.max(...anchor.lines);
  return 0;
}
