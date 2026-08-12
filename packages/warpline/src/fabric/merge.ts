/**
 * #merge — the BRANCH-MERGE verb (M2.5 increment 4, the acceptance-gate increment;
 * TD-2026-08-12-813 spine, TD-2026-08-12-351 fail-closed rule; Arky's design,
 * Jinx's gate). Increments 1-3 built the foundation — #mergebase (the LCA),
 * #fabric-refs / #head (named lines + the current-branch pointer), and the shared
 * seal core #native-write-path `weaveTips` that `admit` already runs. This module
 * is the one composite act those pieces exist for: fold one named line into another.
 *
 * `mergeBranch(root, { into, from })` advances `into` (the target/integration line
 * — the THEIRS/selvage role) by merging `from` (the branch being merged — OURS):
 *
 *   base = mergeBase(from-tip, into-tip)              — the LCA (#mergebase).
 *     · CRISS-CROSS ({ambiguous})  → FAIL CLOSED. v1 has no recursive merge; a
 *                                    wrong base is a silently-wrong merge.
 *     · DISJOINT ROOTS (null)      → FAIL CLOSED. The record itself is suspect.
 *   FAST-FORWARD (into ∈ ancestors(from)) → advance into's ref to from-tip; no
 *                                    weave strand (mirrors admit's FAST_ADMIT).
 *   ALREADY UP TO DATE (from ∈ ancestors(into)) → nothing to fold.
 *   OTHERWISE → weaveTips(base × ours=from × theirs=into) — the SAME engine admit
 *               runs. Disjoint meaning auto-folds CLEAN; same-symbol contradiction
 *               KNOTs; byte-conflict downgrades to KNOT — all inherited verbatim.
 *
 * THE FAIL-CLOSED RULE (the whole point of this increment). weaveTips is called
 * with `holdOnByteDecided: true`, which admit NEVER sets: after a CLEAN weave that
 * WOULD auto-seal, if any changed path is BYTE-DECIDED (meaning contributed nothing
 * to it — a `.js`/cfg-island config value, a scalar `const LIMIT` invariant carrier
 * that no lens lifts), the merge does NOT seal. It surfaces a MEANING-BLIND HOLD:
 * the ref stays put and the verdict NAMES the byte-decided paths for a human to
 * `--confirm`. git silently auto-merges disjoint config×code; Warpline holds it —
 * merge is STRICTLY SAFER than git. Meaning-DECIDED disjoint changes still fold
 * (the value prop survives). This hold is a MERGE-TIME rule only — admit's linear
 * path is byte-identical (increment 3 preserved it).
 *
 * ATTRIBUTION: a branch merge has no scratch/agent, so `from` stands in as the
 * ours-side principal for the weave (clearScratch of a branch name is a harmless
 * no-op unless a live agent shares that exact name). Library code: no console output.
 */

import * as path from 'node:path';
import { WarpStore } from '../warp/store.js';
import { ObjectStore } from '../warp/object-store.js';
import { restoreTree } from '../warp/snapshot.js';
import { warplineDirOf, readFabric, writeSelvage } from './fabric.js';
import { readRef, writeRef } from './refs.js';
import { DEFAULT_BRANCH } from './head.js';
import { mergeBase, ancestorSet } from './mergebase.js';
import { withFabricLock } from './lock.js';
import { ADMIT_RESULT_SCHEMA } from './admit.js';
import { byPickIndex, mustStrand, weaveTips, type AdmitNativeResult } from './native.js';
import { refuse, RefusedError } from './refusal.js';
import { protectedLandingRefusal, type PrincipalClass } from './protected.js';

export interface MergeBranchOptions {
  /** the TARGET/integration branch being advanced (theirs/selvage role). */
  into: string;
  /** the branch being merged IN (ours role). */
  from: string;
  /** worktree for a CLEAN write-back of the merged bytes (default: the repo root). */
  worktree?: string;
  /** skip the CLEAN write-back (default: true — merge does not touch the worktree in v1). */
  noRestore?: boolean;
  /** human override: seal despite a meaning-blind byte-decided HOLD (`--confirm`). */
  acceptMeaningBlind?: boolean;
  /** merge actor / intent (default: the `from` branch name). */
  actor?: string;
  intent?: string;
  now?: string;
  /**
   * THE PROTECTED-BRANCH LANDING GATE principal (#protected, TD-2026-08-12-813
   * security). Absent ⇒ human ⇒ never gated (the operator console, every existing
   * merge caller/test, the single-human dogfood are byte-identical). An
   * agent-class merge whose `into` is a PROTECTED branch is REFUSED — folding a
   * solitary feature branch into main is the clean-land laundering route the whole
   * gate exists to close; landing into protected main is a human/policy act.
   */
  principal?: PrincipalClass;
}

export interface MergeBranchResult extends AdmitNativeResult {
  /** the branch that was advanced (theirs). */
  into: string;
  /** the branch that was merged in (ours). */
  from: string;
  /** the LCA base pickId (present on a real weave/hold; absent on a fast-forward/genesis). */
  base?: string;
  /** true when `into` fast-forwarded to `from` (no weave sealed). */
  fastForward?: boolean;
  /** true when `into` already contained `from` (nothing to fold). */
  alreadyUpToDate?: boolean;
}

/**
 * Merge branch `from` into branch `into`. Fail-closed on a criss-cross or disjoint
 * roots; fast-forwards where it can; otherwise weaves through the shared seal core
 * with the meaning-blind hold armed.
 */
export async function mergeBranch(root: string, opts: MergeBranchOptions): Promise<MergeBranchResult> {
  const wdir = warplineDirOf(root);
  const store = new WarpStore(root, { diskCache: true });
  const objStore = new ObjectStore(root);
  const now = opts.now ?? new Date().toISOString();
  const noRestore = opts.noRestore ?? true; // merge does not write back in v1
  const worktree = opts.worktree ? path.resolve(opts.worktree) : root;

  return withFabricLock(root, async (): Promise<MergeBranchResult> => {
    // THE PROTECTED-BRANCH LANDING GATE (#protected, TD-2026-08-12-813 security):
    // an AGENT-class merge INTO a protected branch is refused — an agent may fold
    // among feature branches freely, but landing into the protected integration
    // line requires a human. Checked BEFORE any tip read or ref write so the
    // refusal is structural (the ref never moves). Human/absent principal passes
    // unchanged, so the CLI operator console and every existing merge test/dogfood
    // are byte-identical. (A real merge always has ≥2 named lines, so branchingInUse
    // holds — the gate turns purely on protected(into) × agent-class.)
    const protectedRefusal = protectedLandingRefusal(root, {
      principal: opts.principal,
      target: opts.into,
      next: [{ verb: 'merge', params: { from: opts.from, into: opts.into }, requires: [], principal: 'human' }],
    });
    if (protectedRefusal) {
      throw new RefusedError(
        protectedRefusal,
        `warpline: merge — ${JSON.stringify(opts.into)} is a PROTECTED branch; an agent-class merge may not land onto it ` +
          `(a solitary feature branch folds CLEAN with no human — the laundering route). A human integrates into ${opts.into}. ` +
          `(protect/unprotect: \`warpline branch --protect/--unprotect <name>\`, human-class.)`,
      );
    }

    const fabric = readFabric(wdir);
    const byPick = byPickIndex(fabric);

    const fromTip = readRef(wdir, opts.from);
    if (fromTip === null) {
      throw new RefusedError(
        refuse({
          code: 'NOT_FOUND',
          retriable: 'retry-corrected',
          next: [{ verb: 'branch', params: {}, requires: ['name'], principal: 'agent' }],
        }),
        `warpline: merge — no branch "${opts.from}" to merge from (\`warpline branch --list\` shows what exists)`,
      );
    }
    const fromStrand = mustStrand(byPick, fromTip, `refs/heads/${opts.from}`);
    const intoTip = readRef(wdir, opts.into);

    // UNBORN target: `into` has no tip yet → genesis it at `from` (a fast-forward
    // of the empty ref). CAS-null: it must still be unborn.
    if (intoTip === null) {
      writeRef(wdir, opts.into, fromTip, null);
      if (opts.into === DEFAULT_BRANCH) writeSelvage(wdir, fromStrand.stateId);
      return ffResult(opts, fromStrand.stateId, /*alreadyUpToDate*/ false);
    }

    // Nothing to do: the two lines already point at the same event.
    if (intoTip === fromTip) return ffResult(opts, fromStrand.stateId, /*alreadyUpToDate*/ true);

    // THE LCA. A criss-cross has no single base; disjoint roots share none. Both
    // FAIL CLOSED — a wrong base is a silently-wrong merge (the class we refuse).
    const base = mergeBase(byPick, fromTip, intoTip);
    if (base === null) {
      throw new RefusedError(
        refuse({ code: 'INTEGRITY_BROKEN', retriable: 'never' }),
        `warpline: merge — "${opts.from}" and "${opts.into}" share no common ancestor (disjoint DAG roots) — fail closed`,
      );
    }
    if (typeof base === 'object') {
      throw new RefusedError(
        refuse({ code: 'UNSUPPORTED', retriable: 'never' }),
        `warpline: merge — "${opts.from}" and "${opts.into}" criss-cross (${base.ambiguous.length} candidate bases: ${base.ambiguous.join(', ')}); ` +
          `there is no single merge base and v1 has no recursive merge — fail closed. Resolve one side onto the other first.`,
      );
    }

    // FAST-FORWARD: `into` is an ancestor of `from` → `from` already contains
    // everything on `into`, so advance `into`'s ref to `from` (no weave strand,
    // mirroring admit's FAST_ADMIT ref advance).
    const fromAncestors = ancestorSet(byPick, fromTip);
    if (fromAncestors.has(intoTip)) {
      writeRef(wdir, opts.into, fromTip, intoTip); // per-ref CAS
      if (opts.into === DEFAULT_BRANCH) writeSelvage(wdir, fromStrand.stateId);
      if (!noRestore) {
        const treeId = fromStrand.binding?.treeId;
        if (treeId) restoreTree(objStore, treeId, worktree);
      }
      return ffResult(opts, fromStrand.stateId, /*alreadyUpToDate*/ false);
    }

    // ALREADY UP TO DATE: `from` is an ancestor of `into` → `into` already has it.
    const intoAncestors = ancestorSet(byPick, intoTip);
    if (intoAncestors.has(fromTip)) return ffResult(opts, fromStrand.stateId, /*alreadyUpToDate*/ true);

    // TRUE MERGE — all three sides are sealed, bound v3 strands.
    const baseStrand = mustStrand(byPick, base, `merge-base(${opts.from}, ${opts.into})`);
    const intoStrand = mustStrand(byPick, intoTip, `refs/heads/${opts.into}`);
    const baseState = store.loadState(baseStrand.stateId);
    const proposed = store.loadState(fromStrand.stateId); // OURS
    const selvage = store.loadState(intoStrand.stateId); // THEIRS
    if (!baseState) throw new Error(`warpline: merge — base state ${baseStrand.stateId} cannot be loaded — fail closed`);
    if (!proposed) throw new Error(`warpline: merge — "${opts.from}" state ${fromStrand.stateId} cannot be loaded — fail closed`);
    if (!selvage) throw new Error(`warpline: merge — "${opts.into}" state ${intoStrand.stateId} cannot be loaded — fail closed`);

    const body = await weaveTips({
      root,
      wdir,
      store,
      objStore,
      opts: {
        worktree,
        agentId: opts.from, // ours-side principal stand-in (no scratch on a branch merge)
        actor: opts.actor ?? opts.from,
        intent: opts.intent ?? `merge ${opts.from} → ${opts.into}`,
        onto: opts.into,
        now,
        noRestore,
        holdOnByteDecided: true, // THE fail-closed rule — merge only
        ...(opts.acceptMeaningBlind ? { acceptMeaningBlind: true } : {}),
        mergeFrom: opts.from,
      },
      now,
      claim: null,
      targetBranch: opts.into,
      selvageTipId: intoTip,
      selvageStrand: intoStrand,
      selvage,
      baseStrand,
      base: baseState,
      scratchTipId: fromTip,
      scratchStrand: fromStrand,
      proposed,
    });

    return { schemaVersion: ADMIT_RESULT_SCHEMA, into: opts.into, from: opts.from, base, ...body };
  });
}

/** A fast-forward / genesis / already-up-to-date result (no weave, no verdict). */
function ffResult(opts: MergeBranchOptions, stateId: string, alreadyUpToDate: boolean): MergeBranchResult {
  return {
    schemaVersion: ADMIT_RESULT_SCHEMA,
    into: opts.into,
    from: opts.from,
    decision: {
      status: alreadyUpToDate ? 'NOOP' : 'FAST_ADMIT',
      knots: [],
      dangling: [],
      confidence: null,
      rebasedOnto: null,
      agentChanged: [],
      otherChanged: [],
    },
    sealed: !alreadyUpToDate,
    proposedStateId: stateId,
    ...(alreadyUpToDate ? { alreadyUpToDate: true } : { fastForward: true }),
  };
}
