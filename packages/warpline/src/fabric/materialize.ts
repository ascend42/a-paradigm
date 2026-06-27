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
  gitShowBuffer,
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
  /** merged BYTES per CHANGED path (null = deleted in the merge). */
  files: Map<string, Buffer | null>;
  conflicts: MergeConflict[];
}

/** A blob is binary if it contains a NUL byte (git's own heuristic). */
const isBinary = (b: Buffer | null): boolean => b !== null && b.includes(0);
const bufEq = (a: Buffer | null, b: Buffer | null): boolean =>
  (a === null && b === null) || (a !== null && b !== null && a.equals(b));

/** Resolve one file's 3-way merge over raw bytes (binary-safe). */
function resolveFile(
  base: Buffer | null,
  ours: Buffer | null,
  theirs: Buffer | null,
): { content: Buffer | null } | { reason: string } {
  if (bufEq(ours, theirs)) return { content: ours }; // both same (incl. both-deleted)
  if (bufEq(ours, base)) return { content: theirs }; // only theirs changed
  if (bufEq(theirs, base)) return { content: ours }; // only ours changed
  // Both sides changed differently.
  if (base === null || ours === null || theirs === null) {
    return { reason: 'add/delete vs edit on the same file' };
  }
  // H3: never token-merge binary — a NUL-bearing blob through the text path would
  // corrupt silently. Fail CLOSED on binary-changed-both-sides.
  if (isBinary(base) || isBinary(ours) || isBinary(theirs)) {
    return { reason: 'binary file changed on both sides' };
  }
  const m = mergeText(base.toString('utf8'), ours.toString('utf8'), theirs.toString('utf8'));
  if (m.conflicts > 0) return { reason: `${m.conflicts} overlapping token-region(s)` };
  return { content: Buffer.from(m.text, 'utf8') };
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
  const files = new Map<string, Buffer | null>();
  const conflicts: MergeConflict[] = [];

  for (const p of changed) {
    const base = await gitShowBuffer(baseRef, p, opts).catch(() => null);
    const ours = await gitShowBuffer(oursRef, p, opts).catch(() => null);
    const theirs = await gitShowBuffer(theirsRef, p, opts).catch(() => null);
    const r = resolveFile(base, ours, theirs);
    if ('reason' in r) conflicts.push({ path: p, reason: r.reason });
    else files.set(p, r.content);
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
        await fs.writeFile(full, content); // Buffer — raw bytes, no re-encoding
      }
    }
    const state = await absorb(WORKTREE_REF, { cwd: tmp });
    return { plan, state };
  } finally {
    await releaseTree(tmp);
  }
}
