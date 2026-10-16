/**
 * Symbol integrity helpers (Symbol Integrity Phase 1).
 *
 * The aggregator collapses every symbol string to ONE canonical entry, so
 * integrity checks can no longer count entries to find duplicates or test
 * set membership to find dangling references. These helpers read the
 * canonical shape instead: `sources` (every contributor) and `declared`
 * (false on reference stubs). Shared by the MCP integrity checker and the
 * `paradigm integrity` CLI.
 */

import { sourcesOf } from './symbol-index.js';
import type { SymbolEntry, SymbolSource } from './types.js';

export interface DuplicateDeclaration {
  symbol: string;
  files: string[];
}

export interface DanglingReference {
  /** The referenced-but-never-declared symbol. */
  symbol: string;
  /** Symbols that reference it. */
  referencedBy: string[];
  /** File the reference stub was synthesized from. */
  filePath: string;
}

/**
 * Files behind a duplicate declaration, or undefined when `sources` holds at
 * most one declaration. Declarations are duplicates when they live in 2+
 * files, or when .purpose declares the symbol under 2+ ids (e.g. both a
 * feature and a component). Several portal gates awarding the same prize
 * signal are one signal, not a duplicate. Reference stubs never count.
 */
export function duplicateDeclarationFiles(sources: SymbolSource[] | undefined): string[] | undefined {
  if (!sources) return undefined;
  const declared = sources.filter((s) => s.declared);
  const files = [...new Set(declared.map((s) => s.filePath))];
  const purposeIds = new Set(declared.filter((s) => s.source === 'purpose').map((s) => s.id));
  return files.length >= 2 || purposeIds.size >= 2 ? files : undefined;
}

/**
 * Symbols declared by 2+ contributors (see duplicateDeclarationFiles). A
 * symbol declared in one portal.yaml and once in one .purpose file is
 * exempt — gates are expected to live in both (see isPortalPurposePair).
 */
export function findDuplicateDeclarations(symbols: SymbolEntry[]): DuplicateDeclaration[] {
  const out: DuplicateDeclaration[] = [];
  for (const entry of symbols) {
    const sources = sourcesOf(entry);
    const files = duplicateDeclarationFiles(sources);
    if (!files) continue;

    if (isPortalPurposePair(sources.filter((s) => s.declared))) continue;

    out.push({ symbol: entry.symbol, files });
  }
  return out;
}

/**
 * One portal.yaml declaration + one .purpose declaration — the expected
 * overlap (a gate in both files, or a .purpose signal that is also a portal
 * prize). Several portal gates awarding the same prize still count as ONE
 * portal declaration: they live in one file.
 */
function isPortalPurposePair(declared: SymbolSource[]): boolean {
  const byFile = new Map<string, Set<string>>();
  for (const s of declared) {
    const kinds = byFile.get(s.filePath) ?? new Set<string>();
    kinds.add(s.source);
    byFile.set(s.filePath, kinds);
  }
  if (byFile.size !== 2) return false;
  const kinds = [...byFile.values()].map((k) => [...k].join(',')).sort();
  const purposeIds = new Set(declared.filter((s) => s.source === 'purpose').map((s) => s.id));
  return kinds[0] === 'portal' && kinds[1] === 'purpose' && purposeIds.size === 1;
}

/** Symbols that are referenced but never declared anywhere (`declared === false`). */
export function findDanglingReferences(symbols: SymbolEntry[]): DanglingReference[] {
  return symbols
    .filter((e) => e.declared === false)
    .map((e) => ({ symbol: e.symbol, referencedBy: [...e.referencedBy], filePath: e.filePath }));
}
