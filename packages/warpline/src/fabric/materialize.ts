/**
 * #materialize — Phase-C v2 meaning→bytes. PERFORM the merge git could only
 * forecast: given base / ours / theirs refs whose meaning-deltas commute (a CLEAN
 * #admit), produce the MERGED tree and absorb it to the merged WarpState.
 *
 * Per file: only-one-side-changed → that side; both-changed → token-level #merge3
 * (which composes disjoint edits git's line-merge conflicts on). Any add/delete-vs-
 * edit, or any overlapping token-region, is a CONFLICT — surfaced, NEVER silently
 * resolved (a wrong merge is the VCS cardinal sin). Bytes are read via git (the
 * coexistence byte store); the merge decision is Warpline's.
 *
 * Library code: no console output.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { absorb, WORKTREE_REF } from '../absorb.js';
import type { WarpState } from '../warp/warp-state.js';
import {
  gitShow,
  changedPaths,
  materializeTree,
  releaseTree,
  type GitOptions,
} from '../git/git-exec.js';
import { mergeText } from './merge3.js';

export interface MergeConflict {
  path: string;
  reason: string;
}

export interface MergePlan {
  /** merged content per CHANGED path (null = deleted in the merge). */
  files: Map<string, string | null>;
  conflicts: MergeConflict[];
}

/** Compute the merged content of every path that base→ours or base→theirs touched. */
export async function computeMerge(
  baseRef: string,
  oursRef: string,
  theirsRef: string,
  opts: GitOptions = {},
): Promise<MergePlan> {
  const changed = new Set<string>([
    ...(await changedPaths(baseRef, oursRef, opts)),
    ...(await changedPaths(baseRef, theirsRef, opts)),
  ]);
  const files = new Map<string, string | null>();
  const conflicts: MergeConflict[] = [];

  for (const p of changed) {
    const base = await gitShow(baseRef, p, opts).catch(() => null);
    const ours = await gitShow(oursRef, p, opts).catch(() => null);
    const theirs = await gitShow(theirsRef, p, opts).catch(() => null);

    if (ours === theirs) {
      files.set(p, ours);
      continue;
    }
    if (ours === base) {
      files.set(p, theirs);
      continue;
    }
    if (theirs === base) {
      files.set(p, ours);
      continue;
    }
    // Both sides changed it. An add/delete on either side can't token-merge.
    if (base === null || ours === null || theirs === null) {
      conflicts.push({ path: p, reason: 'add/delete vs edit on the same file' });
      continue;
    }
    const m = mergeText(base, ours, theirs);
    if (m.conflicts > 0) {
      conflicts.push({ path: p, reason: `${m.conflicts} overlapping token-region(s)` });
      continue;
    }
    files.set(p, m.text);
  }
  return { files, conflicts };
}

export interface MaterializeResult {
  plan: MergePlan;
  /** the absorbed merged WarpState, or null when the plan has conflicts. */
  state: WarpState | null;
}

/**
 * PERFORM the merge: compute the plan, then (if conflict-free) materialize the
 * base tree + overrides into a throwaway dir and absorb it → the merged WarpState.
 * The user's working tree is never touched (the merge lands in a temp dir).
 */
export async function materializeMergedState(
  baseRef: string,
  oursRef: string,
  theirsRef: string,
  opts: GitOptions = {},
): Promise<MaterializeResult> {
  const plan = await computeMerge(baseRef, oursRef, theirsRef, opts);
  if (plan.conflicts.length > 0) return { plan, state: null };

  const tmp = await materializeTree(baseRef, opts);
  try {
    for (const [p, content] of plan.files) {
      const full = path.join(tmp, p);
      if (content === null) {
        await fs.rm(full, { force: true });
      } else {
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, content, 'utf8');
      }
    }
    const state = await absorb(WORKTREE_REF, { cwd: tmp });
    return { plan, state };
  } finally {
    await releaseTree(tmp);
  }
}
