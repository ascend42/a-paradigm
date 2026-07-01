/**
 * #seal — the one place a pre-absorbed WarpState becomes a fabric #strand and the
 * selvage advances. Shared by #pick (worktree seal), #admit (merge seal), and
 * #resolve (KNOT-council seal) so the strand schema + atomic publish live once.
 *
 * Library code: no console output.
 */

import { diff } from '../sem-delta.js';
import type { WarpStore } from '../warp/store.js';
import type { WarpState } from '../warp/warp-state.js';
import { warplineDirOf, readFabric, readSelvage, appendStrand, writeSelvage } from './fabric.js';
import {
  computePickId,
  type Strand,
  type StrandDelta,
  type KnotResolution,
  type StrandBinding,
  type MergeRecipe,
} from './strand.js';

const EMPTY_DELTA: StrandDelta = { born: [], retired: [], contractChanged: [], renamedNoop: 0 };

/** Summarize the meaning change parent → state (empty when no parent / genesis). */
export function summarizeDelta(parent: WarpState | undefined, state: WarpState): StrandDelta {
  if (!parent) return { ...EMPTY_DELTA };
  const d = diff(parent, state);
  const born: string[] = [];
  const retired: string[] = [];
  const contractChanged: string[] = [];
  for (const x of d.deltas.values()) {
    if (x.kind === 'symbol-born') born.push(x.symbol);
    else if (x.kind === 'symbol-retired') retired.push(x.symbol);
    else if (x.kind === 'contract-changed') contractChanged.push(x.symbol);
  }
  return {
    born: born.sort(),
    retired: retired.sort(),
    contractChanged: contractChanged.sort(),
    renamedNoop: d.renames.length,
  };
}

export interface SealInput {
  parentStateId: string | null;
  actor: string;
  intent: string;
  gitCommit: string | null;
  now: string;
  confidence?: number | null;
  /** present only for a KNOT-council resolution strand. */
  resolves?: KnotResolution;
  /** true when sealing a materialized CLEAN merge (its gitCommit is one parent). */
  merged?: boolean;
  /** native byte binding (M1b) — the treeId that restores this strand git-absent. */
  binding?: StrandBinding | null;
  /** the re-derivable merge recipe (merge strands only, M1b). */
  merge?: MergeRecipe;
}

/** Persist `state`, append its strand to the fabric, advance the selvage. */
export function sealState(
  root: string,
  store: WarpStore,
  state: WarpState,
  input: SealInput,
): Strand {
  const wdir = warplineDirOf(root);
  // Load the parent + compute the delta BEFORE persisting `state`. In the dedup
  // edge case current.stateId === parent.stateId (an added symbol whose essence
  // equals an existing one), putState(state) would overwrite the parent's stored
  // snapshot under the shared id, making summarizeDelta diff state against itself.
  const parent = input.parentStateId ? store.loadState(input.parentStateId) : undefined;
  const delta = summarizeDelta(parent, state);
  store.putState(state);
  const seq = readFabric(wdir).length;
  const body: Omit<Strand, 'pickId'> = {
    schemaVersion: 1,
    seq,
    stateId: state.stateId,
    parentStateId: input.parentStateId,
    actor: input.actor,
    intent: input.intent,
    recordedAt: input.now,
    objectCount: state.objects.size,
    delta,
    calibratedConfidence: input.confidence ?? null,
    provenance: { ref: state.ref, treeSha: state.treeSha, gitCommit: input.gitCommit },
    ...(input.resolves ? { resolves: input.resolves } : {}),
    ...(input.merged ? { merged: true } : {}),
    ...(input.binding ? { binding: input.binding } : {}),
    ...(input.merge ? { merge: input.merge } : {}),
  };
  const strand: Strand = { ...body, pickId: computePickId(body) };
  // CAS GUARD FIRST — refuse if the tip moved off the parent the decision was
  // based on (a concurrent writer won the race). Checking BEFORE mutating the
  // ledger means a lost race throws cleanly with no orphan strand. Callers hold
  // #fabric-lock; this is defense-in-depth against a stolen/stale lock.
  const cur = readSelvage(wdir);
  if (cur !== input.parentStateId) {
    throw new Error(
      `warpline: selvage CAS failed — expected ${input.parentStateId ?? '(none)'}, found ${cur ?? '(none)'} (a concurrent writer advanced the tip)`,
    );
  }
  appendStrand(wdir, strand); // ledger first…
  writeSelvage(wdir, state.stateId); // …then publish the tip (lesser-evil crash ordering)
  return strand;
}
