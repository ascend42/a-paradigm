/**
 * #restore — SELECTOR RESOLUTION (M1c). Resolve a restore selector to the native
 * byte identity (`treeId`) it names, going through the fabric ledger to a strand's
 * byte binding (native-object-store-design.md §4).
 *
 * Grammar:
 *   omitted | HEAD | selvage  → the TIP strand (the strand at readSelvage(wdir);
 *                               empty fabric ⇒ error).
 *   N | @N                    → the strand with seq === N.
 *   pick:<id>                 → the strand with that pickId.
 *   state:<id>                → the strand landing on that stateId (highest seq if
 *                               many — the most recent occurrence; §3 many-to-one).
 *   tree:<id>                 → that treeId DIRECTLY (no strand; skip the binding).
 *
 * A4 (cutover-refuse-on-missing-binding): a resolved strand MUST carry
 * `binding.treeId`. A strand sealed before bind-on-seal (M1b) has no bytes to
 * restore — we refuse LOUDLY rather than silently produce a wrong/empty tree, the
 * exact class of permanent unrecoverability the cutover must catch.
 *
 * Library code: no console output.
 */

import { readFabric, readSelvage } from './fabric.js';
import type { Strand } from './strand.js';

export interface SelectorResolution {
  /** the native root treeId this selector names (byte identity in the object store). */
  treeId: string;
  /** the strand the selector resolved through — absent for a direct `tree:` selector. */
  strand?: Strand;
}

/** The highest-seq strand landing on `stateId` (most recent occurrence), or undefined. */
function highestSeqWithState(fabric: Strand[], stateId: string): Strand | undefined {
  let best: Strand | undefined;
  for (const s of fabric) {
    if (s.stateId === stateId && (!best || s.seq > best.seq)) best = s;
  }
  return best;
}

/** Resolve a selector to the strand it names (not used for the direct `tree:` form). */
function resolveStrand(wdir: string, sel: string, fabric: Strand[]): Strand {
  // HEAD / selvage / omitted → the fabric tip.
  if (sel === '' || sel === 'HEAD' || sel === 'selvage') {
    const selvage = readSelvage(wdir);
    if (selvage === null) {
      throw new Error('warpline: no selvage: empty fabric (nothing sealed yet — run `warpline pick`)');
    }
    const tip = highestSeqWithState(fabric, selvage);
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

  // state:<id> — the MEANING identity (highest seq wins; many-to-one, §3).
  if (sel.startsWith('state:')) {
    const s = highestSeqWithState(fabric, sel);
    if (!s) throw new Error(`warpline: no strand landing on state ${sel}`);
    return s;
  }

  // @N or a bare non-negative integer N → the strand at that seq.
  const seqStr = sel.startsWith('@') ? sel.slice(1) : sel;
  if (/^\d+$/.test(seqStr)) {
    const n = Number(seqStr);
    const s = fabric.find((x) => x.seq === n);
    if (!s) throw new Error(`warpline: no strand at seq ${n} (fabric has ${fabric.length} strand(s))`);
    return s;
  }

  throw new Error(
    `warpline: unrecognized selector "${sel}" — accepted: HEAD | selvage (the tip) | ` +
      `N or @N (a seq) | pick:<id> | state:<id> | tree:<id>`,
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

  const strand = resolveStrand(wdir, sel, readFabric(wdir));
  const treeId = strand.binding?.treeId;
  if (!treeId) {
    throw new Error(
      `warpline: cannot restore ${sel || 'HEAD'} — strand seq ${strand.seq} has no byte binding ` +
        `(sealed before bind-on-seal / M1b). Run \`warpline objects backfill\` or pick a bound state.`,
    );
  }
  return { treeId, strand };
}
