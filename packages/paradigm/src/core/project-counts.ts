/**
 * #project-counts: the numbers Paradigm reports about a project, computed once.
 *
 * `paradigm status` and `paradigm doctor` used to count the same things in
 * different ways (gates from the symbol index against keys of the root
 * portal.yaml; .purpose files from a glob against git; isolated symbols from a
 * generated scan-index.json against the live index) and so disagreed about one
 * repository. Both now read this module, so a number has one definition:
 *
 *  - .purpose files: entries named `.purpose` in the shared project file list
 *    (#project-files: tracked, or untracked and not ignored, with agent
 *    worktrees and generated state left out).
 *  - symbols and gates: DECLARED symbols in the live index (premise-core
 *    getSymbolCounts). A gate counts once however many files declare it.
 *  - isolated symbols: premise-core findIsolatedSymbols, on the live index.
 *  - lore entries: entry files (`.lore`, or legacy `.yaml`) under `.paradigm/lore/entries/`.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  aggregateFromDirectory,
  buildSymbolIndex,
  getSymbolCounts,
  getSymbolsByType,
  getUndeclaredCount,
  findIsolatedSymbols,
  isDeclared,
  sourcesOf,
  type AggregationError,
  type IsolatedSymbol,
  type SymbolType,
} from '@a-company/premise-core';
import { listProjectFiles, toPosixPath, type ProjectFileList } from './project-files.js';

export interface GateCounts {
  /** Distinct declared gates: what `status` and `doctor` both print. */
  total: number;
  /** Declared in at least one portal.yaml. */
  inPortal: number;
  /** Declared only in a .purpose `gates:` section. */
  purposeOnly: number;
  /** How many portal.yaml files the index read. */
  portalFiles: number;
}

export interface ProjectCounts {
  /** Root-relative, forward-slash paths of the project's .purpose files. */
  purposeFiles: string[];
  /** Root-relative, forward-slash paths of the project's portal.yaml files. */
  portalFiles: string[];
  /**
   * Listed .purpose files the symbol index did not read: unparsable ones, and
   * ones under a directory the index skips by name (build output). Root-relative.
   */
  purposeFilesNotIndexed: string[];
  /** Declared symbols per kind. */
  symbols: Record<SymbolType, number>;
  /** Sum of `symbols`. */
  totalSymbols: number;
  /** Reference stubs: mentioned by a .purpose, declared nowhere. Never counted above. */
  undeclaredReferences: number;
  gates: GateCounts;
  isolated: IsolatedSymbol[];
  /** Problems the index met while reading its sources. */
  errors: AggregationError[];
}

/** The project's .purpose files, from the shared file list. */
export function listPurposeFiles(list: ProjectFileList): string[] {
  return list.files.filter((rel) => rel === '.purpose' || rel.endsWith('/.purpose'));
}

/** The project's portal.yaml files, from the shared file list. */
export function listPortalFiles(list: ProjectFileList): string[] {
  return list.files.filter((rel) => rel === 'portal.yaml' || rel.endsWith('/portal.yaml'));
}

/** What a gate count covers, in words, for output next to the number. */
export const GATE_COUNT_SCOPE = 'declared gates across portal.yaml files and .purpose';

/** One line describing a gate count: "35 declared (22 in 2 portal.yaml files, 13 in .purpose only)". */
export function describeGateCounts(g: GateCounts): string {
  if (g.total === 0) return '0 declared';
  const parts: string[] = [];
  if (g.inPortal > 0) parts.push(`${g.inPortal} in ${g.portalFiles} portal.yaml file${g.portalFiles === 1 ? '' : 's'}`);
  if (g.purposeOnly > 0) parts.push(`${g.purposeOnly} in .purpose only`);
  return `${g.total} declared (${parts.join(', ')})`;
}

/**
 * Count lore entries: the files under `.paradigm/lore/entries/`, at any depth
 * (entries live in one directory per date). An entry is a `.lore` file; entries
 * recorded before that extension existed are `.yaml` files in the same place.
 * Files beside `entries/` (a timeline, an index) are not entries. Returns null
 * when the project has no lore directory at all.
 */
export function countLoreEntries(rootDir: string): number | null {
  const loreDir = path.join(rootDir, '.paradigm', 'lore');
  if (!fs.existsSync(loreDir)) return null;
  let count = 0;
  const walk = (dir: string, depth: number): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (depth < 4) walk(path.join(dir, entry.name), depth + 1);
      } else if (/\.(lore|ya?ml)$/.test(entry.name)) {
        count++;
      }
    }
  };
  walk(path.join(loreDir, 'entries'), 0);
  return count;
}

/**
 * Compute every shared number for `rootDir`. Pass the run's file list when the
 * caller already has one (doctor does); otherwise it is taken here.
 */
export async function collectProjectCounts(rootDir: string, projectFiles?: ProjectFileList): Promise<ProjectCounts> {
  const root = path.resolve(rootDir);
  const list = projectFiles ?? listProjectFiles(root);
  const purposeFiles = listPurposeFiles(list);
  const portalFiles = listPortalFiles(list);

  const result = await aggregateFromDirectory(root);
  const index = buildSymbolIndex(result);
  const symbols = getSymbolCounts(index);

  const indexed = new Set(result.purposeFiles.map((abs) => toPosixPath(path.relative(root, abs))));
  const purposeFilesNotIndexed = purposeFiles.filter((rel) => !indexed.has(rel));

  let inPortal = 0;
  let purposeOnly = 0;
  for (const gate of getSymbolsByType(index, 'gate')) {
    if (!isDeclared(gate)) continue;
    const declaredIn = sourcesOf(gate).filter((s) => s.declared);
    if (declaredIn.some((s) => s.source === 'portal')) inPortal++;
    else purposeOnly++;
  }

  return {
    purposeFiles,
    portalFiles,
    purposeFilesNotIndexed,
    symbols,
    totalSymbols: Object.values(symbols).reduce((a, b) => a + b, 0),
    undeclaredReferences: getUndeclaredCount(index),
    gates: { total: symbols.gate, inPortal, purposeOnly, portalFiles: result.portalFiles.length },
    isolated: findIsolatedSymbols(result.symbols),
    errors: result.errors,
  };
}
