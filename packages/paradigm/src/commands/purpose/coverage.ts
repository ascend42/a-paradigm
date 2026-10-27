/**
 * paradigm purpose coverage [dirs...] — the shared coverage rule
 * (#purpose-coverage, purpose-core resolvePurposeCoverage) as a CLI, so the
 * Stop hook scores directories exactly as Cid's debrief and doctor do: a
 * directory is covered by its own .purpose, or by an ancestor .purpose that
 * documents it; placeholder stubs never count.
 *
 * Output (default, one line per dir, tab-separated, for shell callers):
 *   <dir>\tcovered\t<covering .purpose>
 *   <dir>\tuncovered\t-
 * --json prints the PurposeCoverage array instead.
 * Directories are relative to --root (default: the current directory).
 */

import * as path from 'path';
import { resolvePurposeCoverage, type PurposeCoverage } from '@a-company/purpose-core';
import { out, json } from '../../utils/cli-output.js';

export interface PurposeCoverageOptions {
  json?: boolean;
  root?: string;
}

export function computePurposeCoverage(rootDir: string, dirs: string[]): PurposeCoverage[] {
  const absRoot = path.resolve(rootDir);
  const seen = new Set<string>();
  const results: PurposeCoverage[] = [];
  for (const raw of dirs) {
    const d = raw.replace(/\/+$/, '') || '.';
    if (seen.has(d)) continue;
    seen.add(d);
    results.push(resolvePurposeCoverage(absRoot, d));
  }
  return results;
}

export async function purposeCoverageCommand(dirs: string[], options: PurposeCoverageOptions = {}): Promise<void> {
  const results = computePurposeCoverage(options.root ?? process.cwd(), dirs);
  if (options.json) {
    json(results);
    return;
  }
  for (const r of results) {
    out(`${r.dir || '.'}\t${r.covered ? 'covered' : 'uncovered'}\t${r.purposeFile ?? '-'}`);
  }
}
