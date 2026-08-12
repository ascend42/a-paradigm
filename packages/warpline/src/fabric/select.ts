/**
 * #restore — SELECTOR RESOLUTION (M1c). Resolve a restore selector to the native
 * byte identity (`treeId`) it names, going through the fabric ledger to a strand's
 * byte binding (native-object-store-design.md §4).
 *
 * Grammar:
 *   omitted | HEAD | selvage  → the TIP strand. Refs mode (V3.2): the strand at
 *                               refs/heads/selvage — an EXACT pickId, no state
 *                               ambiguity. Legacy mode: the strand at
 *                               readSelvage(wdir), highest-seq disambiguated
 *                               (grandfathered until the one-time refs migration).
 *   N | @N                    → the strand with stored seq === N (v1/v2); when the
 *                               fabric carries v3 strands (position-free), N falls
 *                               back to the DERIVED topological position (dag.ts —
 *                               local sugar only, never durable across exchange).
 *   pick:<id>                 → the strand with that pickId.
 *   state:<id>                → the strand landing on that stateId (the most recent
 *                               arrival if many; §3 many-to-one).
 *   tree:<id>                 → that treeId DIRECTLY (no strand; skip the binding).
 *
 * A4 (cutover-refuse-on-missing-binding): a resolved strand MUST carry
 * `binding.treeId`. A strand sealed before bind-on-seal (M1b) has no bytes to
 * restore — we refuse LOUDLY rather than silently produce a wrong/empty tree, the
 * exact class of permanent unrecoverability the cutover must catch.
 *
 * Library code: no console output.
 */

import { readFabric, readSelvage, readLegacyManifest } from './fabric.js';
import { assertV1Covered } from './anchor.js';
import { readRef, isRefName } from './refs.js';
import { buildDag } from './dag.js';
import type { Strand } from './strand.js';

export interface SelectorResolution {
  /** the native root treeId this selector names (byte identity in the object store). */
  treeId: string;
  /** the strand the selector resolved through — absent for a direct `tree:` selector. */
  strand?: Strand;
}

/**
 * The most recent strand landing on `stateId`, or undefined. "Most recent" = last
 * arrival in the ledger (file order) — identical to the old highest-seq rule for
 * v1/v2 (seq == index) and well-defined for position-free v3 strands.
 */
function latestWithState(fabric: Strand[], stateId: string): Strand | undefined {
  let best: Strand | undefined;
  for (const s of fabric) {
    if (s.stateId === stateId) best = s;
  }
  return best;
}

/** Resolve a selector to the strand it names (not used for the direct `tree:` form). */
function resolveStrand(wdir: string, sel: string, fabric: Strand[]): Strand {
  // HEAD / selvage / omitted → the fabric tip.
  if (sel === '' || sel === 'HEAD' || sel === 'selvage') {
    // Refs mode (V3.2): refs/heads/selvage holds the tip PICKID — an exact event
    // identity, no many-to-one stateId ambiguity, no disambiguation hack.
    const refTip = readRef(wdir, 'selvage');
    if (refTip !== null) {
      const s = fabric.find((x) => x.pickId === refTip);
      if (!s) {
        throw new Error(`warpline: refs/heads/selvage points at ${refTip} but no strand in the fabric carries that pickId`);
      }
      return s;
    }
    // Legacy (unmigrated) mode: the stateId selvage + latest-arrival disambiguation
    // (grandfathered until the one-time refs migration — spec §2; do not copy).
    const selvage = readSelvage(wdir);
    if (selvage === null) {
      throw new Error('warpline: no selvage: empty fabric (nothing sealed yet — run `warpline pick`)');
    }
    const tip = latestWithState(fabric, selvage);
    if (!tip) {
      throw new Error(`warpline: selvage points at ${selvage} but no strand in the fabric carries that state`);
    }
    return tip;
  }

  // pick:<id> — the EVENT identity.
  if (sel.startsWith('pick:')) {
    const s = fabric.find((x) => x.pickId === sel);
    if (!s) throw new Error(`warpline: no strand with pickId ${sel}`);
    return s;
  }

  // state:<id> — the MEANING identity (most recent arrival wins; many-to-one, §3).
  if (sel.startsWith('state:')) {
    const s = latestWithState(fabric, sel);
    if (!s) throw new Error(`warpline: no strand landing on state ${sel}`);
    return s;
  }

  // @N or a bare non-negative integer N → the strand at that seq. v3 strands carry
  // no stored seq (position is derived — v3-identity §1.2), so when the stored-seq
  // lookup misses and the fabric holds v3 strands, N resolves through the DERIVED
  // topological order instead (local sugar; never a durable selector).
  const seqStr = sel.startsWith('@') ? sel.slice(1) : sel;
  if (/^\d+$/.test(seqStr)) {
    const n = Number(seqStr);
    const s = fabric.find((x) => x.seq === n);
    if (s) return s;
    if (fabric.some((x) => x.schemaVersion >= 3)) {
      const derived = buildDag(fabric).order[n];
      if (derived) return derived;
    }
    throw new Error(`warpline: no strand at seq ${n} (fabric has ${fabric.length} strand(s))`);
  }

  // A bare BRANCH NAME → the strand at refs/heads/<name> (M2.5 branching). Checked
  // LAST so it never shadows the reserved forms (HEAD/selvage/pick:/state:/N),
  // and only resolves when a ref actually holds that name — an unknown name falls
  // through to the unrecognized-selector error. `selvage` still resolves via the
  // tip branch above, to the identical strand.
  if (isRefName(sel)) {
    const refTip = readRef(wdir, sel);
    if (refTip !== null) {
      const s = fabric.find((x) => x.pickId === refTip);
      if (!s) {
        throw new Error(`warpline: refs/heads/${sel} points at ${refTip} but no strand in the fabric carries that pickId`);
      }
      return s;
    }
  }

  throw new Error(
    `warpline: unrecognized selector "${sel}" — accepted: HEAD | selvage (the tip) | ` +
      `<branch> (a refs/heads name) | N or @N (a seq) | pick:<id> | state:<id> | tree:<id>`,
  );
}

/**
 * Resolve a restore selector → the native `treeId` it names (+ the strand it went
 * through, if any). `tree:<id>` restores that treeId directly; every other form
 * resolves a strand and reads its `binding.treeId`, refusing (A4) if unbound.
 */
export function resolveSelector(wdir: string, selector?: string): SelectorResolution {
  const sel = (selector ?? 'HEAD').trim();

  // tree:<id> → restore that treeId DIRECTLY (no strand, no binding step).
  // Validate the id shape up front: the hex is spliced into the object-store path,
  // so an unvalidated id (e.g. `tree:v1:../../etc/x`) would escape the store as a
  // read. Pin it to the canonical form; reject anything else fail-closed.
  if (sel.startsWith('tree:')) {
    if (!/^tree:v1:[0-9a-f]{64}$/.test(sel)) {
      throw new Error(`warpline: malformed tree selector "${sel}" — expected tree:v1:<64 hex chars>`);
    }
    return { treeId: sel };
  }

  const fabric = readFabric(wdir);
  const strand = resolveStrand(wdir, sel, fabric);
  // RESTORE GATE (spec §8): a v1 strand's byte binding is unauthenticated without a
  // valid epoch anchor (HIGH-A). Refuse restoring any v1 selector until the prefix is
  // validly attested — a cheap recheck (no object walks). v2 strands are
  // chain-authenticated; `tree:` selectors named bytes explicitly and never reach here.
  if (strand.schemaVersion < 2) {
    assertV1Covered(wdir, fabric, readLegacyManifest(wdir));
  }
  const treeId = strand.binding?.treeId;
  if (!treeId) {
    throw new Error(
      `warpline: cannot restore ${sel || 'HEAD'} — strand ${strand.seq !== undefined ? `seq ${strand.seq}` : strand.pickId} has no byte binding ` +
        `(sealed before bind-on-seal / M1b). Run \`warpline objects backfill\` or pick a bound state.`,
    );
  }
  return { treeId, strand };
}
