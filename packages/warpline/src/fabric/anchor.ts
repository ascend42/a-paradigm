/**
 * #anchor — the v1-prefix EPOCH ANCHOR (docs/specs/warpline-v1-anchor.md).
 *
 * The v2 chain is authenticated; the v1 prefix is not — its bodies, bindings, and
 * the grandfather manifest sit outside every authenticated hash (the HIGH-A /
 * HIGH-B / MED-C live exploits). This module DIGESTS the entire v1 prefix (full
 * strand bodies, bindings included) + the grandfather manifest into ONE
 * attestation, sealed as a chained v2 strand (so it is INSIDE the authenticated
 * chain). `verify` then authenticates the prefix against the chain instead of
 * against per-strand self-hashes, and the prefix is FROZEN forever (rewriteFabric
 * §7 refuses all v1 mutation once an anchor exists).
 *
 * FREEZE / attest-once: `objects backfill` (backfill.ts) stamps v1 bindings FIRST;
 * `fabric attest` seals the anchor ONCE; there is NO re-attest verb, ever (a
 * re-attest path = tamper-then-re-attest).
 *
 * Residual (stated honestly, spec §10): a full re-chain by an in-loop writer
 * remains possible (no secret in the chain). The claim is "tamper-EVIDENT against
 * anything short of a full re-chain," never "trustworthy." Signatures are M3.
 *
 * Library code: no console output.
 */

import { createHash } from 'node:crypto';
import { canonicalSerialize } from '../warp/canonical.js';
import { canonicalSafe, type Strand, type EpochAnchor } from './strand.js';
import {
  readFabric,
  readLegacyManifest,
  readSelvage,
  warplineDirOf,
  type FabricLegacy,
} from './fabric.js';
import { WarpStore } from '../warp/store.js';
import { sealState } from './seal.js';
import { withFabricLock } from './lock.js';
import { verifyFabric } from './verify.js';
import { gitLogHashes, gitShow } from '../git/git-exec.js';

const sha256hex = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

/**
 * The per-strand digest folded into the prefix digest — over the FULL stored strand
 * INCLUDING pickId, calibratedConfidence, binding, and merge (nothing on a v1 strand
 * is mutable after the freeze, so nothing is excluded). Hashing the canonicalized
 * PARSED value (never raw file bytes) makes it whitespace/key-order independent.
 * Folding the stored pickId in means a body-rewrite-plus-self-hash-recompute (MED-C)
 * still moves the digest even though the strand stays "self-consistent." Returns hex.
 */
export function strandDigest(s: Strand): string {
  return sha256hex(canonicalSerialize(canonicalSafe(s)));
}

/**
 * The domain-separated, length-prefixed fold over the covered strands (seq order
 * 0..N-1). `strands` = the v1 prefix. Returns `sha256:<hex>`.
 *
 *   prefixDigest = sha256( "warpline-epoch-anchor:v1\n" + N + "\n"
 *                          + hex(strandDigest(s_0)) + "\n" + … + hex(strandDigest(s_{N-1})) + "\n" )
 */
export function computePrefixDigest(strands: Strand[]): string {
  const N = strands.length;
  let preimage = `warpline-epoch-anchor:v1\n${N}\n`;
  for (const s of strands) preimage += strandDigest(s) + '\n';
  return 'sha256:' + sha256hex(preimage);
}

/**
 * The manifest digest — over the canonicalized PARSED `FabricLegacy` object (reason
 * included). Returns `sha256:<hex>`, or null when there is no manifest (so a fabric
 * that never had a grandfather manifest attests manifestDigest:null).
 */
export function computeManifestDigest(legacy: FabricLegacy | null): string | null {
  if (legacy === null) return null;
  return 'sha256:' + sha256hex(canonicalSerialize(canonicalSafe(legacy)));
}

/**
 * The unique epoch anchor for `epoch` in `fabric`, or undefined. Uniqueness is
 * per-epoch (the v3 genesis will carry a distinct `epoch: 'v2'` anchor); `verify`
 * treats a second same-epoch anchor as forgery (anchor-duplicate).
 */
export function findAnchor(fabric: Strand[], epoch: 'v1' | 'v2' = 'v1'): Strand | undefined {
  return fabric.find((s) => s.attests?.kind === 'epoch-anchor' && s.attests.epoch === epoch);
}

const RESTORE_REFUSE = (why: string): Error =>
  new Error(
    `warpline: refusing to restore a v1 strand — the v1 prefix is not (validly) attested (${why}).\n` +
      `v1 bindings are unauthenticated without the epoch anchor (HIGH-A). Run\n` +
      `\`warpline objects backfill\` then \`warpline fabric attest\`, or restore a v2 selector.`,
  );

/**
 * The restore gate (spec §8): a CHEAP recheck (no object walks) that the v1 prefix
 * is validly attested before a v1 selector's bytes are handed to restore. Throws
 * the §8 refusal on any failure. `tree:`/v2 selectors never reach here.
 */
export function assertV1Covered(_wdir: string, fabric: Strand[], legacy: FabricLegacy | null): void {
  const v1 = fabric.filter((s) => s.schemaVersion < 2);
  if (v1.length === 0) return; // no v1 strands ⇒ nothing to cover
  const anchors = fabric.filter((s) => s.attests?.kind === 'epoch-anchor' && s.attests.epoch === 'v1');
  if (anchors.length === 0) throw RESTORE_REFUSE('no epoch anchor present');
  if (anchors.length > 1) throw RESTORE_REFUSE('multiple epoch anchors');
  const a = anchors[0].attests as EpochAnchor;
  if (a.prefixCount !== v1.length) throw RESTORE_REFUSE('anchor prefixCount != v1 strand count');
  for (let i = 0; i < fabric.length; i++) {
    const isV1 = fabric[i].schemaVersion < 2;
    if (i < a.prefixCount && !isV1) throw RESTORE_REFUSE('a v2 strand sits inside the covered prefix');
    if (i >= a.prefixCount && isV1) throw RESTORE_REFUSE('a v1 strand sits outside the covered prefix');
  }
  if (fabric[a.prefixCount - 1].pickId !== a.prefixTipPickId) throw RESTORE_REFUSE('prefix tip pickId mismatch');
  if (computePrefixDigest(fabric.slice(0, a.prefixCount)) !== a.prefixDigest)
    throw RESTORE_REFUSE('v1 prefix digest mismatch');
  if (computeManifestDigest(legacy) !== a.manifestDigest) throw RESTORE_REFUSE('manifest digest mismatch');
  if ((legacy?.grandfathered.length ?? 0) !== a.grandfatheredCount) throw RESTORE_REFUSE('grandfather count mismatch');
}

/* ── The ONE-TIME attest verb (spec §5) — no --force, no --re-attest, no repair ── */

export interface AttestOptions {
  /** cwd for the git corroboration walk (defaults to root). */
  cwd?: string;
  /** actor recording the anchor (default: the tip strand's actor). */
  actor?: string;
  /** the agent recording the anchor (IN the v2 pickId). */
  agentId?: string | null;
  /** injectable clock (ISO) — determinism in tests. */
  now?: string;
  /** freeze permanently-unrestorable (unbound) v1 strands rather than refusing. */
  allowUnbound?: boolean;
}

export interface AttestResult {
  strand: Strand;
  prefixCount: number;
  grandfatheredCount: number;
  /** the corroborating git commit recorded in the anchor. */
  gitCommit: string;
  /** seqs frozen unbound (permanently unrestorable) — only non-empty with allowUnbound. */
  unbound: number[];
}

/**
 * Seal the v1 epoch anchor. All-or-nothing; any precondition failure throws before a
 * strand is sealed. Sequence: refuse-if-attested → precondition verify (coverage
 * requirement suppressed) → git corroboration → seal the chained anchor strand.
 */
export async function attestFabric(root: string, opts: AttestOptions = {}): Promise<AttestResult> {
  const cwd = opts.cwd ?? root;
  const wdir = warplineDirOf(root);
  const fabric0 = readFabric(wdir);

  // 1. Refuse if a v1 anchor already exists (attestation happens ONCE per epoch).
  if (findAnchor(fabric0, 'v1')) {
    throw new Error(
      'warpline: attest refused — a v1 epoch anchor already exists; attestation happens ONCE per epoch. ' +
        'There is no re-attest/force/repair verb (a re-attest path would be tamper-then-re-attest). ' +
        'If the anchor is wrong, remediation is human + git archaeology.',
    );
  }

  const v1 = fabric0.filter((s) => s.schemaVersion < 2);
  if (v1.length === 0) {
    throw new Error('warpline: attest refused — no v1 strands to attest (fabric is pure v2; no anchor needed).');
  }

  // Contiguity: the v1 strands must be the head prefix (seqs 0..N-1). A v1 strand
  // after a v2 strand is un-attestable.
  for (let i = 0; i < fabric0.length; i++) {
    const isV1 = fabric0[i].schemaVersion < 2;
    if (i < v1.length && !isV1) {
      throw new Error(`warpline: attest refused — a v2 strand sits inside the v1 prefix at index ${i} (the v1 prefix is not contiguous at the head).`);
    }
    if (i >= v1.length && isV1) {
      throw new Error(`warpline: attest refused — a v1 strand (seq ${fabric0[i].seq}) sits after the v2 boundary at index ${i}; un-attestable.`);
    }
  }

  // 2. Precondition verify — every check EXCEPT the anchor-coverage requirement
  //    (anchor-missing is the expected state; attest is the one verb that operates
  //    on an uncovered fabric). Any HARD failure ⇒ refuse (do not notarize tamper).
  const pre = verifyFabric(root, { requireAnchor: false });
  if (pre.failures.length > 0) {
    const f = pre.failures[0];
    throw new Error(
      `warpline: attest refused — the fabric fails verify (${pre.failures.length} hard failure(s)); ` +
        `attest must not notarize a tampered prefix. First: seq ${f.seq} ${f.kind} — ${f.detail}`,
    );
  }

  // Bound-ness: every v1 strand must be bound OR explicitly acknowledged.
  const unbound = v1.filter((s) => !s.binding).map((s) => s.seq ?? -1);
  if (unbound.length > 0 && !opts.allowUnbound) {
    throw new Error(
      `warpline: attest refused — ${unbound.length} v1 strand(s) are unbound (seq ${unbound.join(', ')}) and will be ` +
        `PERMANENTLY unrestorable after the freeze. Run \`warpline objects backfill\` first, or pass --allow-unbound ` +
        `to freeze them unbound forever.`,
    );
  }

  const legacy = readLegacyManifest(wdir);
  const manifestDigest = computeManifestDigest(legacy);
  const grandfatheredCount = legacy?.grandfathered.length ?? 0;
  const prefixDigest = computePrefixDigest(v1);

  // 3. Corroborate against git history (constraint b) — the first committed
  //    fabric.jsonl whose first N strands AND manifest digest match the working
  //    prefix. No match ⇒ refuse (no override).
  const commits = await gitLogHashes('.warpline/fabric.jsonl', { cwd });
  let corroboratingCommit: string | null = null;
  for (const c of commits) {
    let committedRaw: string;
    try {
      committedRaw = await gitShow(c, '.warpline/fabric.jsonl', { cwd });
    } catch {
      continue;
    }
    let committed: Strand[];
    try {
      committed = committedRaw
        .split('\n')
        .filter((l) => l.trim().length)
        .map((l) => JSON.parse(l) as Strand);
    } catch {
      continue;
    }
    if (committed.length < v1.length) continue; // predates the full v1 prefix
    let match = true;
    for (let i = 0; i < v1.length; i++) {
      if (strandDigest(committed[i]) !== strandDigest(v1[i])) {
        match = false;
        break;
      }
    }
    if (!match) continue;
    let committedManifest: FabricLegacy | null = null;
    try {
      committedManifest = JSON.parse(await gitShow(c, '.warpline/fabric-legacy.json', { cwd })) as FabricLegacy;
    } catch {
      committedManifest = null;
    }
    if (computeManifestDigest(committedManifest) !== manifestDigest) continue;
    corroboratingCommit = c;
    break;
  }
  if (!corroboratingCommit) {
    throw new Error(
      `warpline: attest refused — the working v1 prefix + manifest matched NO committed state in ` +
        `\`git log -- .warpline/fabric.jsonl\` (${commits.length} commit(s) walked). During coexistence the fabric is ` +
        `git-tracked by construction, so a no-match means the working prefix diverged from every state git ever saw. ` +
        `Commit the prefix (\`git add .warpline/fabric.jsonl .warpline/fabric-legacy.json && git commit\`) then re-run.`,
    );
  }

  // 4. Build the payload + seal a normal v2 strand carrying the attestation. The
  //    anchor is a meaning no-op: stateId unchanged (selvage does not move), delta
  //    empty, binding copied from the tip so state:/HEAD resolution stays restorable.
  const attests: EpochAnchor = {
    kind: 'epoch-anchor',
    version: 1,
    epoch: 'v1',
    prefixCount: v1.length,
    prefixTipPickId: v1[v1.length - 1].pickId,
    prefixDigest,
    manifestDigest,
    grandfatheredCount,
    corroboration: { method: 'git-history-prefix-match', gitCommit: corroboratingCommit },
  };

  const selvage = readSelvage(wdir);
  if (selvage === null) throw new Error('warpline: attest refused — no selvage (empty fabric).');
  const store = new WarpStore(root, { diskCache: true });
  const state = store.loadState(selvage);
  if (!state) {
    throw new Error(
      `warpline: attest refused — the tip state ${selvage} cannot be loaded (states/ cache missing or corrupt).`,
    );
  }
  const tip = [...fabric0].reverse().find((s) => s.stateId === selvage) ?? fabric0[fabric0.length - 1];
  const actor = opts.actor ?? tip.actor ?? 'warpline';
  const now = opts.now ?? new Date().toISOString();

  const strand = await withFabricLock(root, () =>
    sealState(root, store, state, {
      parentStateId: selvage,
      actor,
      intent:
        `anchor(epoch:v1): attest ${v1.length}-strand v1 prefix + legacy manifest ` +
        `(${grandfatheredCount} grandfathered); corroborated at git ${corroboratingCommit}`,
      gitCommit: tip.provenance?.gitCommit ?? null,
      now,
      authoredBy: { agentId: opts.agentId ?? null },
      binding: tip.binding ?? null,
      attests,
    }),
  );

  return { strand, prefixCount: v1.length, grandfatheredCount, gitCommit: corroboratingCommit, unbound };
}
