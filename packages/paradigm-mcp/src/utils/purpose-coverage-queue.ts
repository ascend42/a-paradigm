/**
 * Purpose-coverage gap queue (#purpose-coverage-queue, T-2026-10-27-003).
 *
 * Directories no .purpose documents are surfaced as ONE open paradigm task
 * tagged `purpose-coverage`, never as stub files written into the tree. Used by
 * Cid's debrief (paradigm-mcp) and by `paradigm purpose coverage --queue`, which
 * the Stop hook calls under PARADIGM_AUTO_FIX=1. Creation goes through
 * createTask, the same writer paradigm_task_create uses.
 *
 * Directories already named by an active (open or in-progress) purpose-coverage
 * task are skipped, so repeated debriefs and Stop runs do not pile up tasks.
 */

import { createTask, loadTasks } from './task-loader.js';

/** Tag carried by every coverage-gap task (used to dedupe). */
export const PURPOSE_COVERAGE_TASK_TAG = 'purpose-coverage';

export interface QueueCoverageGapOptions {
  /** Where the gap was found, e.g. "orchestration orch-1" or "the Stop hook". */
  source: string;
  /** Placeholder stubs met while scoring (listed so they get replaced). */
  placeholders?: string[];
  /** Extra tags (e.g. 'captain-debrief', 'stop-hook'). */
  tags?: string[];
}

/** Returns the new task id, or undefined when every directory is already queued. */
export async function queueCoverageGapTask(
  rootDir: string,
  dirs: string[],
  opts: QueueCoverageGapOptions,
): Promise<string | undefined> {
  if (dirs.length === 0) return undefined;
  const active = await loadTasks(rootDir, { status: 'active', tag: PURPOSE_COVERAGE_TASK_TAG, limit: 500 });
  const alreadyQueued = (dir: string) => active.some(t => t.blurb.split(/[\s,;]+/).includes(dir));
  const fresh = Array.from(new Set(dirs)).filter(d => !alreadyQueued(d)).sort();
  if (fresh.length === 0) return undefined;

  const placeholders = opts.placeholders ?? [];
  const placeholderNote = placeholders.length
    ? ` Placeholder stubs that do not count as coverage (replace or delete): ${placeholders.join(', ')}.`
    : '';
  const blurb =
    `Document .purpose coverage for ${fresh.length} director${fresh.length === 1 ? 'y' : 'ies'} found by ${opts.source}: ` +
    `${fresh.join(', ')} . Add a .purpose with real symbols, or name the files in an ancestor .purpose ` +
    `(path/files/tests or a file mention).${placeholderNote}`;

  return createTask(rootDir, {
    blurb,
    priority: 'medium',
    tags: [PURPOSE_COVERAGE_TASK_TAG, ...(opts.tags ?? []), 'documentor'],
  });
}
