/**
 * #pick — the single-writer WRITE PATH. `recordPick(root, opts)` seals the
 * current working MEANING into the fabric as a new Strand and advances the
 * selvage. The Phase-2 verb behind `warpline pick`.
 *
 * Flow ($pick-flow):
 *   1. absorb(ref) — lift the working tree (or a git ref) to a WarpState.
 *   2. store.putState — durably persist the snapshot under .warpline/states/.
 *   3. If the new stateId === selvage, NO-OP (meaning unchanged — don't spam
 *      history). The provable-zero diff property makes this exact.
 *   4. Else diff(parent, current) → summarize → build the Strand (attribution +
 *      reserved confidence + git-commit coexistence anchor) → appendStrand →
 *      writeSelvage (atomic). Genesis (no selvage yet) records seq 0 with an
 *      empty delta; the objectCount is the headline.
 *
 * Single-writer only: no SCRATCH fork, no per-domain CAS, no WEFT group yet —
 * those are the multi-writer protocol (Phase C), gated on the false-AUTOFOLD
 * safety experiment. This path never auto-merges, so it doesn't depend on it.
 *
 * COEXISTENCE: writes ONLY under .warpline/. Git is read for provenance
 * (HEAD sha, user.name) and never mutated.
 *
 * Library code: no console output — the CLI prints.
 */

import { absorb, WORKTREE_REF } from '../absorb.js';
import { diff } from '../sem-delta.js';
import { WarpStore } from '../warp/store.js';
import { ObjectStore } from '../warp/object-store.js';
import { snapshotState } from '../warp/snapshot.js';
import { gitUserName, revParse, commitSubject, commitAuthor } from '../git/git-exec.js';
import { warplineDirOf, readSelvage } from './fabric.js';
import { sealState } from './seal.js';
import { withFabricLock } from './lock.js';
import type { Strand } from './strand.js';

export interface RecordPickOptions {
  /** cwd for git/absorb (defaults to root). */
  cwd?: string;
  /** snapshot a git ref instead of the live working tree. */
  ref?: string;
  /** actor identity recording this pick (defaults: commit author for a ref, else git user.name). */
  actor?: string;
  /** the human-readable intent. Optional for a real ref (derived from the commit subject). */
  intent?: string;
  /** graded belief 0..1 (reserved moat signal). */
  confidence?: number | null;
  /** injectable clock (ISO) — determinism in tests. */
  now?: string;
}

export interface PickResult {
  /** true when the meaning was unchanged since selvage — nothing recorded. */
  noop: boolean;
  /** true when this was the first pick (genesis, seq 0). */
  isGenesis: boolean;
  /** the sealed strand (absent on a no-op). */
  strand?: Strand;
  /** the absorbed stateId (the new selvage, or the unchanged one on a no-op). */
  stateId: string;
}

export async function recordPick(root: string, opts: RecordPickOptions): Promise<PickResult> {
  const cwd = opts.cwd ?? root;
  const ref = opts.ref ?? WORKTREE_REF;
  const wdir = warplineDirOf(root);
  const store = new WarpStore(root, { diskCache: true });
  const objStore = new ObjectStore(root); // native byte store (M1b bind-on-seal)

  // 1. Lift the current meaning (no lock — this is the expensive step).
  const current = await absorb(ref, { cwd });

  // Attribution + intent are independent of the selvage — resolve BEFORE locking
  // to keep the critical section short. For a real ref, derive from its git log
  // when not supplied (this is what lets the post-commit hook seal with no -m).
  const isWorktree = ref === WORKTREE_REF;
  const intent =
    opts.intent ??
    (isWorktree ? 'uncommitted worktree state' : (await commitSubject(ref, { cwd }).catch(() => '')) || '(no intent)');
  const actor =
    opts.actor ??
    (isWorktree ? null : await commitAuthor(ref, { cwd }).catch(() => null)) ??
    (await gitUserName({ cwd })) ??
    'unknown';
  const gitCommit = await revParse(isWorktree ? 'HEAD' : ref, { cwd }).catch(() => null);
  const now = opts.now ?? new Date().toISOString();

  // 2-3. Decide + seal under the fabric lock (the read-decide-write critical
  //      section). The DIFF — not stateId equality — is the source of truth for
  //      "did meaning change?": stateId hashes the DEDUPED essence set, so an
  //      identical-essence born symbol leaves stateId unchanged while diff (keyed
  //      by stableKey) sees it. #seal is the single writer of fabric history.
  return withFabricLock(root, async () => {
    const selvage = readSelvage(wdir);
    const isGenesis = selvage === null;
    if (!isGenesis) {
      const parent = store.loadState(selvage);
      // A SET selvage we cannot LOAD is corruption or a regen-gap in the states
      // cache — NOT an empty fabric. Falling through to seal here would ORPHAN the
      // real history (silent data loss), the exact class admit.ts fails closed on.
      // Fail CLOSED: the caller must re-absorb the tip or repair .warpline/.
      if (!parent) {
        throw new Error(
          `warpline: selvage points at ${selvage} but that state cannot be loaded (states/ cache missing or corrupt) — refusing to seal over existing history. Re-absorb the tip or repair .warpline/.`,
        );
      }
      const d = diff(parent, current);
      if (d.deltas.size === 0 && d.renames.length === 0) {
        return { noop: true, isGenesis: false, stateId: current.stateId };
      }
    }
    // Bind the durable bytes only when we actually seal (skip on a no-op above).
    const treeId = await snapshotState(objStore, ref, cwd, { cwd });
    const strand = sealState(root, store, current, {
      parentStateId: selvage,
      actor,
      intent,
      gitCommit,
      now,
      confidence: opts.confidence ?? null,
      binding: { treeId, gitOid: current.treeSha ?? null },
    });
    return { noop: false, isGenesis, strand, stateId: current.stateId };
  });
}
