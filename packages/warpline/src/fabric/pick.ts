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
import { gitUserName, revParse, commitSubject, commitAuthor } from '../git/git-exec.js';
import {
  warplineDirOf,
  readSelvage,
  writeSelvage,
  appendStrand,
  readFabric,
} from './fabric.js';
import { computePickId, type Strand, type StrandBody, type StrandDelta } from './strand.js';

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

const EMPTY_DELTA: StrandDelta = { born: [], retired: [], contractChanged: [], renamedNoop: 0 };

export async function recordPick(root: string, opts: RecordPickOptions): Promise<PickResult> {
  const cwd = opts.cwd ?? root;
  const ref = opts.ref ?? WORKTREE_REF;
  const wdir = warplineDirOf(root);
  const store = new WarpStore(root, { diskCache: true });

  // 1. Lift the current meaning.
  const current = await absorb(ref, { cwd });
  const selvage = readSelvage(wdir);
  const isGenesis = selvage === null;

  // 2. The DIFF is the source of truth for "did meaning change?" — NOT stateId
  //    equality. stateId hashes the DEDUPED essence set, so adding a symbol whose
  //    essence equals an existing one leaves stateId unchanged while the diff
  //    (keyed by stableKey) correctly sees it born. So we no-op iff the diff is
  //    empty (no deltas, no renames), and summarize from the same diff.
  let delta: StrandDelta = EMPTY_DELTA;
  if (!isGenesis) {
    const parent = store.loadState(selvage);
    if (parent) {
      const d = diff(parent, current);
      if (d.deltas.size === 0 && d.renames.length === 0) {
        return { noop: true, isGenesis: false, stateId: current.stateId };
      }
      const born: string[] = [];
      const retired: string[] = [];
      const contractChanged: string[] = [];
      for (const dd of d.deltas.values()) {
        if (dd.kind === 'symbol-born') born.push(dd.symbol);
        else if (dd.kind === 'symbol-retired') retired.push(dd.symbol);
        else if (dd.kind === 'contract-changed') contractChanged.push(dd.symbol);
      }
      delta = {
        born: born.sort(),
        retired: retired.sort(),
        contractChanged: contractChanged.sort(),
        renamedNoop: d.renames.length,
      };
    }
    // parent unreadable → fall through and record (safer than silently dropping).
  }

  // 3. Durably persist the snapshot only once we know we're sealing.
  store.putState(current);

  const seq = readFabric(wdir).length;

  // Attribution + intent: for a real ref (e.g. a commit), derive from its git log
  // when not supplied — this is what lets the post-commit hook seal with no -m.
  // The git-commit anchor is the PICKED ref (HEAD for the worktree).
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

  const body: StrandBody = {
    schemaVersion: 1,
    seq,
    stateId: current.stateId,
    parentStateId: selvage,
    actor,
    intent,
    recordedAt: now,
    objectCount: current.objects.size,
    delta,
    calibratedConfidence: opts.confidence ?? null,
    provenance: { ref: current.ref, treeSha: current.treeSha, gitCommit },
  };
  const strand: Strand = { ...body, pickId: computePickId(body) };

  appendStrand(wdir, strand);
  writeSelvage(wdir, current.stateId);

  return { noop: false, isGenesis, strand, stateId: current.stateId };
}
