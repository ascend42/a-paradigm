/**
 * paradigm integrity — Symbol integrity check
 *
 * Validates broken references, duplicate symbols, orphaned symbols,
 * and missing anchor files across the project's .purpose files.
 *
 * Usage:
 *   paradigm integrity          Show integrity report
 *   paradigm integrity --json   Output machine-readable JSON
 */

import * as fs from 'fs';
import * as path from 'path';
import { aggregateFromDirectory, type SymbolEntry, type CodeAnchor } from '@a-company/premise-core';
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
  const duplicates = findDuplicateSymbols(symbols);
  const orphaned = findOrphanedSymbols(symbols);
  const missingAnchors = findMissingAnchors(symbols, cwd);
  const outOfBounds = findAnchorOutOfBounds(symbols, cwd);

  const brokenCount = brokenRefs.length;
  const duplicateCount = duplicates.length;
  const orphanedCount = orphaned.length;
  const missingAnchorCount = missingAnchors.length;
  const outOfBoundsCount = outOfBounds.length;

  if (options.json) {
    const result = {
      brokenCount,
      duplicateCount,
      orphanedCount,
      missingAnchors: missingAnchorCount,
      outOfBoundsAnchors: outOfBoundsCount,
      details: {
        brokenReferences: brokenRefs,
        duplicateSymbols: duplicates,
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

  // Orphaned symbols
  if (orphanedCount > 0) {
    console.log(chalk.yellow(`  ⚠ ${orphanedCount} orphaned symbol${orphanedCount > 1 ? 's' : ''} (zero cross-references)`));
    for (const orph of orphaned.slice(0, 5)) {
      console.log(chalk.gray(`    │ ${orph.symbol} in ${orph.file}`));
    }
    if (orphanedCount > 5) {
      console.log(chalk.gray(`    │ ... and ${orphanedCount - 5} more`));
    }
  } else {
    console.log(chalk.green('  ✓ All symbols have cross-references'));
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
  const definedIds = new Set(symbols.map(s => s.symbol));

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

function findDuplicateSymbols(symbols: SymbolEntry[]): Array<{ symbol: string; files: string[] }> {
  const bySymbol = new Map<string, string[]>();
  for (const sym of symbols) {
    const files = bySymbol.get(sym.symbol) || [];
    if (!files.includes(sym.filePath)) files.push(sym.filePath);
    bySymbol.set(sym.symbol, files);
  }
  const dupes: Array<{ symbol: string; files: string[] }> = [];
  for (const [symbol, files] of bySymbol) {
    if (files.length > 1) dupes.push({ symbol, files });
  }
  return dupes;
}

function findOrphanedSymbols(symbols: SymbolEntry[]): Array<{ symbol: string; file: string }> {
  return symbols
    .filter(s => s.referencedBy.length === 0)
    .map(s => ({ symbol: s.symbol, file: s.filePath }));
}

function findMissingAnchors(symbols: SymbolEntry[], rootDir: string): Array<{ symbol: string; anchor: string }> {
  const missing: Array<{ symbol: string; anchor: string }> = [];
  for (const sym of symbols) {
    if (!sym.anchors || sym.anchors.length === 0) continue;
    for (const anchor of sym.anchors) {
      const filePath = path.isAbsolute(anchor.path) ? anchor.path : path.join(rootDir, anchor.path);
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
      const filePath = path.isAbsolute(anchor.path) ? anchor.path : path.join(rootDir, anchor.path);
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
