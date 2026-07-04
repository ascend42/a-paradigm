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
  type EpochAnchor,
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
  /**
   * NEW (schema v2) — agent attribution. agentId is IN the v2 pickId; sessionKey is
   * excluded. Absent → authoredBy.agentId hashes as null (the human/git-commit default).
   * parentPickId is NOT a SealInput field — seal computes it from the ledger tip.
   */
  authoredBy?: { agentId: string | null; sessionKey?: string | null };
  /** NEW (schema v2) — the SECOND merge parent (CLEAN merge only): the base strand's pickId. */
  mergeParentPickId?: string | null;
  /**
   * Present ONLY when sealing an epoch-anchor strand (anchor.ts). Rides into the v2
   * pickId via the `...rest` spread in computePickId, so the attestation is itself
   * chain-protected.
   */
  attests?: EpochAnchor;
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
  // The chain link (schema v2): parentPickId := the pickId of the strand at
  // parentStateId, which is ALWAYS the ledger tip (append-only). Computed here from
  // the fabric already read for `seq` — no threading needed. null at genesis; at the
  // v1→v2 boundary this is the last v1 strand's pick:v0 (anchors the v1 tip for free).
  const fab = readFabric(wdir);
  const seq = fab.length;
  const parentPickId = fab.length ? fab[fab.length - 1].pickId : null;
  const body: Omit<Strand, 'pickId'> = {
    schemaVersion: 2,
    seq,
    parentPickId,
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
    ...(input.authoredBy ? { authoredBy: input.authoredBy } : {}),
    ...(input.mergeParentPickId !== undefined ? { mergeParentPickId: input.mergeParentPickId } : {}),
    ...(input.binding ? { binding: input.binding } : {}),
    ...(input.merge ? { merge: input.merge } : {}),
    ...(input.attests ? { attests: input.attests } : {}),
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
