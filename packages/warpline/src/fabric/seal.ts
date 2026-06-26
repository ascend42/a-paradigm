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
import { warplineDirOf, readFabric, appendStrand, writeSelvage } from './fabric.js';
import {
  computePickId,
  type Strand,
  type StrandDelta,
  type KnotResolution,
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
}

/** Persist `state`, append its strand to the fabric, advance the selvage. */
export function sealState(
  root: string,
  store: WarpStore,
  state: WarpState,
  input: SealInput,
): Strand {
  const wdir = warplineDirOf(root);
  store.putState(state);
  const seq = readFabric(wdir).length;
  const parent = input.parentStateId ? store.loadState(input.parentStateId) : undefined;
  const body: Omit<Strand, 'pickId'> = {
    schemaVersion: 1,
    seq,
    stateId: state.stateId,
    parentStateId: input.parentStateId,
    actor: input.actor,
    intent: input.intent,
    recordedAt: input.now,
    objectCount: state.objects.size,
    delta: summarizeDelta(parent, state),
    calibratedConfidence: input.confidence ?? null,
    provenance: { ref: state.ref, treeSha: state.treeSha, gitCommit: input.gitCommit },
    ...(input.resolves ? { resolves: input.resolves } : {}),
  };
  const strand: Strand = { ...body, pickId: computePickId(body) };
  appendStrand(wdir, strand);
  writeSelvage(wdir, state.stateId);
  return strand;
}
