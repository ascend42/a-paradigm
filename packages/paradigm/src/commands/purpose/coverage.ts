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
 * --require-own treats a dir as covered only by its own non-placeholder
 *   .purpose (the Stop hook's purpose-required patterns).
 * --queue files the uncovered dirs as one purpose-coverage task
 *   (#purpose-coverage-queue, deduped; the Stop hook's PARADIGM_AUTO_FIX=1).
 *   Nothing is ever written into the working tree.
 * Directories are relative to --root (default: the current directory).
 */

import * as path from 'path';
import { resolvePurposeCoverage, type PurposeCoverage } from '@a-company/purpose-core';
import { queueCoverageGapTask } from '../../../../paradigm-mcp/src/utils/purpose-coverage-queue.js';
import { out, json } from '../../utils/cli-output.js';

export interface PurposeCoverageOptions {
  json?: boolean;
  root?: string;
  requireOwn?: boolean;
  queue?: boolean;
  /** Who found the gap, for the task text (default "paradigm purpose coverage"). */
  source?: string;
}

export function computePurposeCoverage(
  rootDir: string,
  dirs: string[],
  opts: { requireOwn?: boolean } = {},
): PurposeCoverage[] {
  const absRoot = path.resolve(rootDir);
  const seen = new Set<string>();
  const results: PurposeCoverage[] = [];
  for (const raw of dirs) {
    const d = raw.replace(/\/+$/, '') || '.';
    if (seen.has(d)) continue;
    seen.add(d);
    const c = resolvePurposeCoverage(absRoot, d);
    if (opts.requireOwn && c.via !== 'own') {
      results.push({ ...c, covered: false, via: null, purposeFile: undefined });
    } else {
      results.push(c);
    }
  }
  return results;
}

export async function purposeCoverageCommand(dirs: string[], options: PurposeCoverageOptions = {}): Promise<void> {
  const rootDir = path.resolve(options.root ?? process.cwd());
  const results = computePurposeCoverage(rootDir, dirs, { requireOwn: options.requireOwn });

  let taskId: string | undefined;
  if (options.queue) {
    const uncovered = results.filter(r => !r.covered);
    try {
      taskId = await queueCoverageGapTask(rootDir, uncovered.map(r => r.dir || '.'), {
        source: options.source ?? 'paradigm purpose coverage',
        placeholders: Array.from(new Set(uncovered.flatMap(r => r.placeholders))).sort(),
        tags: [],
      });
    } catch {
      // Queueing is best-effort; the coverage answer still prints.
    }
  }

  if (options.json) {
    json(options.queue ? { results, taskId: taskId ?? null } : results);
    return;
  }
  for (const r of results) {
    out(`${r.dir || '.'}\t${r.covered ? 'covered' : 'uncovered'}\t${r.purposeFile ?? '-'}`);
  }
  if (taskId) out(`#queued\t${taskId}`);
}
