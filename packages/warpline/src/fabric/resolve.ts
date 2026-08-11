/**
 * #resolve — the KNOT council. When #admit returns KNOT/DANGLE (a genuine meaning
 * conflict the protocol REFUSES to auto-merge), a human resolves it and seals the
 * result here. The resolution strand carries a #strand `resolves` envelope: who
 * decided, why, what was contended, and what they changed — the reasoning git's
 * merge commit can't keep. Warpline's history is accountability-native.
 *
 * Library code: no console output.
 */

import { absorb, WORKTREE_REF } from '../absorb.js';
import { diff } from '../sem-delta.js';
import { WarpStore } from '../warp/store.js';
import { revParse, gitUserName } from '../git/git-exec.js';
import { warplineDirOf, readSelvage } from './fabric.js';
import { readScratch, clearScratch } from './scratch.js';
import { sealState } from './seal.js';
import { withFabricLock } from './lock.js';
import { admitDecision } from './admit.js';
import { findKnotPayloadForResolve } from './knot-payload.js';
import type { WarpState } from '../warp/warp-state.js';
import type { Strand, KnotResolution } from './strand.js';

export interface ResolveOptions {
  cwd?: string;
  agentId: string;
  /** the human-resolved state (a git ref or WORKTREE) to seal as the new tip. */
  resolvedRef: string;
  /** why it was resolved this way (required — the accountability record). */
  reason: string;
  /** who made the call (default: git user.name). */
  decidedBy?: string;
  /** the original conflicting ref — supplied to record the PRECISE contended set. */
  oursRef?: string;
}

export interface ResolveResult {
  strand: Strand;
  resolution: KnotResolution;
}

function symbolsChanged(a: WarpState, b: WarpState): string[] {
  const out = new Set<string>();
  for (const d of diff(a, b).deltas.values()) out.add(d.symbol);
  return Array.from(out).sort();
}

/** Seal a human resolution of a knot, recording the reasoning on the strand. */
export async function resolveKnot(root: string, opts: ResolveOptions): Promise<ResolveResult> {
  const cwd = opts.cwd ?? root;
  const wdir = warplineDirOf(root);
  const store = new WarpStore(root, { diskCache: true });

  // The decide-seal critical section runs under the fabric lock so a resolution
  // can't race a concurrent admit/pick onto the same selvage (Reviewer C1).
  return withFabricLock(root, async () => {
    const selvageId = readSelvage(wdir);
    if (!selvageId) throw new Error('resolve: no selvage — nothing to resolve against');
    const selvage = store.loadState(selvageId);
    if (!selvage) throw new Error('resolve: selvage state not found in the store');

    // C-9 MIRROR (soundness audit): a NATIVE scratch holds a `pick:` pickId minted
    // by `warpline fork`; the git-era resolve bases on a stateId and store.loadState
    // cannot resolve a pickId. Left to flow through, the null recompute would be
    // silently skipped and the bogus value RECORDED in resolution.base — a field
    // documented as a stateId (strand.ts). admit.ts (C-9) refuses LOUDLY on the
    // identical mirror; resolve must too. Fail closed and name the corrected call.
    const scratchBase = readScratch(root, opts.agentId);
    if (scratchBase !== null && scratchBase.startsWith('pick:')) {
      throw new Error(
        `warpline: resolve — scratch for ${JSON.stringify(opts.agentId)} holds ${scratchBase} (a NATIVE pickId base, minted by \`warpline fork\`); the git-era resolve path bases on a stateId and cannot resolve against it. Resolve the native proposal instead: \`warpline resolve ${opts.agentId} --native\`.`,
      );
    }
    const baseId = scratchBase ?? selvageId;
    const resolved = await absorb(opts.resolvedRef, { cwd });

  // The #knot-payload join + the contended set. The payload admit persisted on the
  // KNOT verdict already classifies each contested unit direct-vs-ripple — the
  // GENUINE-vs-OVER-BLOCK split the field test's falsifiers turn on — so when it is
  // found it is BOTH the precise contended set AND the exact join target.
  //
  // The join fires UNCONDITIONALLY (I-1 defect #1): it no longer waits for --ours.
  // The payload is pinned by the contested stateId PAIR (theirs = the selvage being
  // resolved; ours = this agent's proposal, sharpened to the --ours ref when one is
  // given) so a proposal re-admitted against a MOVED selvage binds the RIGHT
  // payload, deterministically (defect #2). --ours only sharpens the ours-side key
  // now; it is no longer the switch that turns the join on.
  let oursState: WarpState | null = null;
  if (opts.oursRef) {
    try {
      oursState = await absorb(opts.oursRef, { cwd });
    } catch {
      /* unresolvable ours ref — fall back to the agent-scoped join */
    }
  }
  const payload = findKnotPayloadForResolve(root, {
    selvageStateId: selvageId,
    agentId: opts.agentId,
    oursStateId: oursState?.stateId ?? null,
  });
  const knotPayloadId = payload?.payloadId;

  // Precise contended set, in order of authority: (1) the persisted payload's
  // classified units (exact — no recompute); (2) else recompute from the original
  // proposal when --ours names it; (3) else the symbols the resolution changed vs
  // the tip. The PRESENCE of knotPayloadId is the honest precise/fallback marker:
  // a resolution carrying it took its contended set from the classified payload.
  let contended: string[] = [];
  if (payload) {
    contended = Array.from(new Set(payload.contested.map((c) => c.symbol))).sort();
  } else if (oursState) {
    const base = store.loadState(baseId);
    if (base) {
      const dec = admitDecision(base, oursState, selvage);
      contended = Array.from(
        new Set([...dec.knots.map((k) => k.symbol), ...dec.dangling.map((d) => d.fromSymbol)]),
      ).sort();
    }
  }
  const resolvedSymbols = symbolsChanged(selvage, resolved);
  if (contended.length === 0) contended = resolvedSymbols;

  const actor = opts.decidedBy ?? (await gitUserName({ cwd })) ?? 'unknown';
  const isWorktree = opts.resolvedRef === WORKTREE_REF;
  const gitCommit = await revParse(isWorktree ? 'HEAD' : opts.resolvedRef, { cwd }).catch(() => null);
  const now = new Date().toISOString();

  const resolution: KnotResolution = {
    decidedBy: actor,
    reason: opts.reason,
    base: baseId,
    against: selvageId,
    contended,
    resolvedSymbols,
    ...(knotPayloadId ? { knotPayloadId } : {}),
  };

    const strand = sealState(root, store, resolved, {
      parentStateId: selvageId,
      actor,
      intent: `resolve knot — ${opts.reason}`,
      gitCommit,
      now,
      resolves: resolution,
    });
    clearScratch(root, opts.agentId);
    return { strand, resolution };
  });
}
