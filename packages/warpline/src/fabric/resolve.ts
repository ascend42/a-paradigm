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

    const baseId = readScratch(root, opts.agentId) ?? selvageId;
    const resolved = await absorb(opts.resolvedRef, { cwd });

  // Contended set: precise (recompute the knot from the original proposal) when
  // --ours is given; else the symbols the resolution itself changed vs the tip.
  let contended: string[] = [];
  if (opts.oursRef) {
    const base = store.loadState(baseId);
    if (base) {
      const ours = await absorb(opts.oursRef, { cwd });
      const dec = admitDecision(base, ours, selvage);
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
