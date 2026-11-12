/**
 * #warplined-position — a principal's observable position in the write cycle,
 * read from the fabric on disk (T-2026-11-12-001).
 *
 * ONE READER, TWO SKINS. This derivation lived inline in the daemon's `status`
 * handler. `warpline orient` (the CLI's answer to "what may I legally do next")
 * needs the SAME position, and two copies of it would drift — the same reason the
 * next-verb RULE is data in #warplined-descriptors. Both skins now call this, and
 * both feed the result to `nextLegalVerbsFor`.
 *
 * READ-ONLY AND TOTAL: every call is a plain file read (scratch ref, selvage ref,
 * ledger, knot sidecars); nothing is written, no lock is taken, and any error
 * collapses to the position known so far — orientation must never throw.
 *
 * Library code: no console output.
 */

import { warplineDirOf, readFabric } from '../fabric/fabric.js';
import { readRef } from '../fabric/refs.js';
import { readScratch } from '../fabric/scratch.js';
import { parentsOf } from '../fabric/dag.js';
import { listKnotPayloads } from '../fabric/knot-payload.js';
import type { CyclePosition } from './descriptors.js';

export interface ObservedPosition extends CyclePosition {
  /** the scratch ref's value (a `pick:` or a git-era `state:` base), or null. */
  scratch: string | null;
  scratchIsPickId: boolean;
  /** the selvage tip pickId, or null on an empty fabric. */
  selvageTip: string | null;
}

export function cyclePositionOf(root: string, principal: string): ObservedPosition {
  const wdir = warplineDirOf(root);
  let scratch: string | null = null;
  let proposalSealed = false;
  let behindSelvage = false;
  let knotOpen = false;
  let selvageTip: string | null = null;
  try {
    scratch = readScratch(root, principal);
    selvageTip = readRef(wdir, 'selvage');
    if (scratch?.startsWith('pick:')) {
      const strand = readFabric(wdir).find((s) => s.pickId === scratch);
      // The scratch tip IS this principal's sealed proposal (propose
      // advanced it) — vs the fork base it was minted at (a tip strand
      // someone else authored, or the base itself).
      proposalSealed = !!strand && strand.authoredBy?.agentId === principal;
      const base = proposalSealed && strand ? (parentsOf(strand)[0] ?? null) : scratch;
      behindSelvage = selvageTip !== null && base !== selvageTip;
      // FG-3 finding 2: a KNOT work order naming THIS principal's CURRENT
      // sealed proposal means the contest is live. Keyed on stateId, so
      // re-proposing (a new stateId) correctly clears it — the new
      // proposal has not been judged yet.
      if (proposalSealed && strand) {
        knotOpen = listKnotPayloads(root).some(
          (p) => p.ours.agentId === principal && p.ours.stateId === strand.stateId,
        );
      }
    }
  } catch {
    /* best-effort — orientation must never throw */
  }
  return {
    scratchPresent: scratch !== null,
    scratchIsPickId: scratch?.startsWith('pick:') ?? false,
    proposalSealed,
    behindSelvage,
    knotOpen,
    scratch,
    selvageTip,
  };
}
