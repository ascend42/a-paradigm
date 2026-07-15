/**
 * #backfill — `warpline objects backfill` (spec §4). Stamp a NATIVE byte binding
 * onto every v1 strand that lacks one, from that strand's `provenance.gitCommit`
 * tree, so the v1 prefix has all the bindings it will EVER have BEFORE the epoch
 * anchor freezes it forever (attest §5 runs after this).
 *
 * `gitOid: null` deliberately (merge-result precedent, admit.ts): a backfilled
 * native tree is ignore-filtered so it does NOT equal the git tree sha — storing
 * the git sha there would be a lie, and the gitOid↔treeSha check is vacuous for a
 * self-produced value anyway (MED-E). A strand whose provenance.gitCommit is null
 * or unreachable stays UNBOUND forever (restore of it refuses permanently, A4).
 *
 * This is a PRE-ATTESTATION verb only: it refuses to run once an anchor exists
 * (the same one-way freeze gate rewriteFabric keys off, checked here up front).
 *
 * Library code: no console output — the CLI prints.
 */

import { warplineDirOf, readFabric, readLegacyGrandfathered, rewriteFabric } from './fabric.js';
import { withFabricLock } from './lock.js';
import { findAnchor } from './anchor.js';
import { reproducesUnderKnownRule, computeLegacyBodyHash, type Strand } from './strand.js';
import { ObjectStore } from '../warp/object-store.js';
import { snapshotRef, type SnapshotAnchor } from '../warp/snapshot.js';

/**
 * Would a binding-stamped strand still pass rewriteFabric's identity guard? Binding is
 * EXCLUDED from the v1 exclusion-rule pickId AND from computeLegacyBodyHash, so a strand
 * that reproduces under the exclusion rule, or is grandfathered, survives a stamp. But a
 * WHOLE-BODY-hashed strand (the genesis, seq 0) folds binding INTO its pickId — stamping
 * one forges its identity. Such strands cannot be backfilled and stay frozen unbound.
 * (The probe binding value is irrelevant: exclusion/bodyHash ignore it, and a whole-body
 * strand fails for ANY binding since it originally had none.)
 */
function survivesIdentityGuard(stamped: Strand, grandfathered: Map<string, string>): boolean {
  if (reproducesUnderKnownRule(stamped)) return true;
  if (stamped.schemaVersion < 2) {
    const { pickId: _p, ...body } = stamped;
    const pinned = grandfathered.get(stamped.pickId);
    if (pinned !== undefined && computeLegacyBodyHash(body) === pinned) return true;
  }
  return false;
}

export interface BackfillResult {
  /** v1 strands newly stamped with a native binding. */
  stamped: { seq: number; treeId: string }[];
  /** v1 strands that stay permanently unbound (no/unreachable git commit). */
  unbound: { seq: number; reason: string }[];
  /** v1 strands that already carried a binding (seq 13–14 on this repo). */
  alreadyBound: number;
}

export async function backfillV1Bindings(root: string, opts: { cwd?: string } = {}): Promise<BackfillResult> {
  const cwd = opts.cwd ?? root;
  const wdir = warplineDirOf(root);

  // Refuse once the prefix is attested and frozen (backfill is pre-attestation only).
  if (findAnchor(readFabric(wdir))) {
    throw new Error('warpline: v1 prefix is attested and frozen; backfill is permanently closed.');
  }

  const store = new ObjectStore(root);
  const grandfathered = readLegacyGrandfathered(wdir);
  const PROBE = { treeId: 'tree:v1:' + '0'.repeat(64), gitOid: null };
  const stamped: { seq: number; treeId: string }[] = [];
  const unbound: { seq: number; reason: string }[] = [];
  let alreadyBound = 0;

  // Snapshot each unbound v1 strand's commit tree OUTSIDE the lock (snapshotRef
  // shells git — the expensive step). Keyed by pickId so the rewrite under the lock
  // re-reads a fresh ledger and matches by identity, not index.
  const bindings = new Map<string, string>(); // pickId -> treeId
  // Chained incremental snapshots (T-2026-07-04-003): each strand's snapshot
  // anchors on the PREVIOUS one just computed (treeId = snapshotRef(prev commit)
  // by construction), so a long v1 prefix costs N diffs, not N universes.
  let prev: SnapshotAnchor | undefined;
  for (const s of readFabric(wdir)) {
    if (s.schemaVersion >= 2) continue;
    if (s.binding) {
      alreadyBound++;
      continue;
    }
    // A whole-body-hashed strand (the genesis) folds binding INTO its pickId — it
    // cannot be bound without forging its identity. Detect BEFORE the expensive
    // snapshot and leave it frozen unbound (spec §4/§9 assumed seq 0 was bindable; it
    // is not — the genesis is whole-body-hashed). rewriteFabric would refuse it too.
    if (!survivesIdentityGuard({ ...s, binding: PROBE }, grandfathered)) {
      unbound.push({
        seq: s.seq,
        reason: 'identity includes binding (whole-body-hashed strand, e.g. the genesis) — cannot bind without forging; frozen unbound',
      });
      continue;
    }
    const commit = s.provenance.gitCommit;
    if (!commit) {
      unbound.push({ seq: s.seq, reason: 'provenance.gitCommit is null (sealed pre-coexistence) — permanently unrestorable' });
      continue;
    }
    try {
      const treeId = await snapshotRef(store, commit, { cwd }, prev);
      bindings.set(s.pickId, treeId);
      prev = { ref: commit, treeId };
    } catch (err) {
      unbound.push({
        seq: s.seq,
        reason: `git commit ${commit.slice(0, 12)} unreachable (${(err as Error).message}) — permanently unrestorable`,
      });
    }
  }

  if (bindings.size > 0) {
    await withFabricLock(root, () => {
      const fabric = readFabric(wdir);
      const updated = fabric.map((s) => {
        const treeId = bindings.get(s.pickId);
        if (treeId && s.schemaVersion < 2 && !s.binding) {
          stamped.push({ seq: s.seq, treeId });
          return { ...s, binding: { treeId, gitOid: null } };
        }
        return s;
      });
      rewriteFabric(wdir, updated);
    });
  }

  return { stamped, unbound, alreadyBound };
}
