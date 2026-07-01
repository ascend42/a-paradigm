/**
 * #fabric-verify — `warpline fabric verify`: authenticate the whole fabric ledger.
 *
 * The fabric is a PICK-DAG. v1 (pick:v0) strands carry per-strand SELF-HASH
 * integrity but are NOT linked to each other (ordering is unauthenticatable — the
 * documented C2 caveat, OQ-A). v2 (pick:v2) strands fold the chain link
 * (parentPickId), the byte binding (binding.treeId), agent attribution, and — on a
 * merge — the second DAG parent + algo INTO the content-address, so from the first
 * v2 strand forward the chain is fully authenticated:
 *
 *   1. Integrity   — recompute pickId (dispatched by schemaVersion) == stored id.
 *   2. Chain (v2)  — parentPickId == the immediately-preceding strand's pickId (the
 *                    first v2 strand anchors the v1 TIP; genesis anchors null).
 *   3. Merge (v2)  — mergeParentPickId resolves to some earlier strand's pickId.
 *   4. Binding     — binding.treeId is present in the object store and every object
 *                    it references exists; ref-sourced strands also match gitOid↔treeSha.
 *
 * Read-only — never writes .warpline/. Distinct from `objects verify` (loose-object
 * self-consistency); this authenticates the HISTORY.
 *
 * Library code: no console output — the CLI prints.
 */

import { warplineDirOf, readFabric, readLegacyGrandfathered } from './fabric.js';
import { computePickId, reproducesUnderKnownRule, type Strand } from './strand.js';
import { ObjectStore } from '../warp/object-store.js';
import { WORKTREE_REF } from '../absorb.js';

export type FabricVerifyKind =
  | 'pickId-mismatch'
  | 'chain-break'
  | 'merge-parent-unresolved'
  | 'missing-binding'
  | 'binding-mismatch';

export interface FabricVerifyFailure {
  seq: number;
  pickId: string;
  kind: FabricVerifyKind;
  detail: string;
}

export interface FabricVerifyReport {
  /** total strands examined. */
  checked: number;
  /** the v1 prefix: integrity yes (rule-verified OR grandfathered), ordering unauthenticatable (OQ-A). */
  v1Prefix: { count: number; selfHashOk: boolean };
  /** the authenticated v2 chain. */
  v2Chain: { count: number; ok: boolean };
  /** the first v2 strand's parentPickId equals its predecessor (the v1 tip), or it is a well-rooted v2 genesis. */
  boundaryAnchored: boolean;
  /**
   * SOFT (§7.3): strands sealed under an obsolete rule whose hashed byte #grade
   * destroyed, grandfathered by pickId (§7.2). Counted, NOT a failure — exit stays 0.
   */
  legacyUnverifiable: { count: number; pickIds: string[] };
  failures: FabricVerifyFailure[];
}

const isV2 = (s: Strand): boolean => s.schemaVersion >= 2;

/** Walk a binding tree; return the first missing object id, or null if fully present. */
function firstMissingObject(store: ObjectStore, treeId: string): string | null {
  if (!store.has(treeId)) return treeId;
  let entries;
  try {
    entries = store.getTree(treeId);
  } catch {
    return treeId; // present but unreadable/corrupt
  }
  for (const e of entries) {
    if (e.mode === '40000') {
      const missing = firstMissingObject(store, e.id);
      if (missing) return missing;
    } else if (e.mode === '160000') {
      continue; // gitlink — no bytes stored natively
    } else if (!store.has(e.id)) {
      return e.id;
    }
  }
  return null;
}

/**
 * Authenticate the fabric at `root`. Pure over the on-disk ledger + object store.
 * `failures` empty ⇒ intact (CLI exit 0); non-empty ⇒ tamper/break (exit 1).
 */
export function verifyFabric(root: string): FabricVerifyReport {
  const wdir = warplineDirOf(root);
  const fabric = readFabric(wdir);
  const store = new ObjectStore(root);
  const grandfathered = readLegacyGrandfathered(wdir);
  const failures: FabricVerifyFailure[] = [];
  const legacyPickIds: string[] = [];

  const knownPickIds = new Set<string>();
  let v1Count = 0;
  let v2Count = 0;
  let v1SelfHashOk = true;
  let v2ChainOk = true;
  let boundaryAnchored = false;
  let firstV2Seen = false;

  for (let i = 0; i < fabric.length; i++) {
    const s = fabric[i];
    const prev = i > 0 ? fabric[i - 1] : undefined;
    const v2 = isV2(s);
    if (v2) v2Count++;
    else v1Count++;

    const push = (kind: FabricVerifyKind, detail: string): void => {
      failures.push({ seq: s.seq, pickId: s.pickId, kind, detail });
      if (v2) v2ChainOk = false;
      else if (kind === 'pickId-mismatch') v1SelfHashOk = false;
    };

    // 1. Integrity (§7.1/§7.3) — try the finite set of known hashing rules. A stored
    //    pickId reproduced by any known rule is OK; otherwise, a grandfathered pickId
    //    is a SOFT legacy-unverifiable (exit stays 0), and anything else is a HARD
    //    pickId-mismatch (real tamper — how a future forgery still surfaces).
    if (!reproducesUnderKnownRule(s)) {
      if (grandfathered.has(s.pickId)) {
        legacyPickIds.push(s.pickId); // soft — not a failure
      } else {
        const { pickId: _stored, ...body } = s;
        push('pickId-mismatch', `recomputed ${computePickId(body)} != stored ${s.pickId} (no known rule; not grandfathered)`);
      }
    }

    // 2. Chain (v2 only) — parentPickId must equal the immediately-preceding strand's
    //    pickId (null at a v2 genesis; the v1 tip at the v1→v2 boundary).
    if (v2) {
      const expectedParent = prev ? prev.pickId : null;
      const actualParent = s.parentPickId ?? null;
      if (actualParent !== expectedParent) {
        push(
          'chain-break',
          `parentPickId ${actualParent ?? '(null)'} != prev ${expectedParent ?? '(null)'}`,
        );
      }
      // boundaryAnchored: pin the FIRST v2 strand's anchor (the v1 tip, or null genesis).
      if (!firstV2Seen) {
        firstV2Seen = true;
        boundaryAnchored = actualParent === expectedParent;
      }

      // 3. Merge second-parent — must resolve to some EARLIER strand's pickId.
      if (s.mergeParentPickId != null) {
        if (!knownPickIds.has(s.mergeParentPickId)) {
          push('merge-parent-unresolved', `mergeParentPickId ${s.mergeParentPickId} resolves to no earlier strand`);
        }
      }
    }

    // 4. Binding re-derivation — the treeId is present and every referenced object exists;
    //    ref-sourced strands additionally match the shadow gitOid to provenance.treeSha.
    if (s.binding) {
      const missing = firstMissingObject(store, s.binding.treeId);
      if (missing) {
        push('missing-binding', `binding object ${missing} is absent from the object store`);
      }
      if (
        s.provenance.ref !== WORKTREE_REF &&
        s.binding.gitOid != null &&
        s.provenance.treeSha != null &&
        s.binding.gitOid !== s.provenance.treeSha
      ) {
        push('binding-mismatch', `binding.gitOid ${s.binding.gitOid} != provenance.treeSha ${s.provenance.treeSha}`);
      }
    }

    knownPickIds.add(s.pickId);
  }

  return {
    checked: fabric.length,
    v1Prefix: { count: v1Count, selfHashOk: v1SelfHashOk },
    v2Chain: { count: v2Count, ok: v2ChainOk },
    boundaryAnchored,
    legacyUnverifiable: { count: legacyPickIds.length, pickIds: legacyPickIds },
    failures,
  };
}
