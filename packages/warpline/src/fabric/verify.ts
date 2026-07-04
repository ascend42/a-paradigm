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
 *   4. Binding     — every tree/blob reachable from binding.treeId RE-HASHES to its
 *                    content-address (recompute, not presence — MEDIUM-1); ref-sourced
 *                    strands also match gitOid↔treeSha.
 *   5. Merge       — a strand carrying a `merge` recipe has all four recipe trees
 *                    ({base,ours,theirs,result}) present + recomputing, and
 *                    merge.result === binding.treeId. The recipe fields are EXCLUDED
 *                    from the pickId by design (spec OQ-D) — this verify-side
 *                    validation is the compensating control the spec committed to.
 *
 * Read-only — never writes .warpline/. Distinct from `objects verify` (loose-object
 * self-consistency); this authenticates the HISTORY.
 *
 * Library code: no console output — the CLI prints.
 */

import { warplineDirOf, readFabric, readLegacyGrandfathered, readLegacyManifest, readSelvage } from './fabric.js';
import { computePickId, computeLegacyBodyHash, reproducesUnderKnownRule, type Strand } from './strand.js';
import { findAnchor, computePrefixDigest, computeManifestDigest } from './anchor.js';
import { ObjectStore } from '../warp/object-store.js';
import { WORKTREE_REF } from '../absorb.js';

export type FabricVerifyKind =
  | 'pickId-mismatch'
  | 'chain-break'
  | 'merge-parent-unresolved'
  | 'missing-binding'
  | 'corrupt-object'
  | 'merge-recipe-invalid'
  | 'legacy-body-mismatch'
  | 'legacy-manifest-invalid'
  | 'binding-mismatch'
  | 'anchor-missing'
  | 'anchor-mismatch'
  | 'anchor-manifest-mismatch'
  | 'anchor-duplicate'
  | 'anchor-malformed'
  | 'v1-out-of-prefix';

export interface FabricVerifyFailure {
  /** the strand's seq — or -1 for a MANIFEST-level failure (no strand to point at). */
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
   * SOFT (§7.3): v1 strands sealed under an obsolete rule whose hashed byte #grade
   * destroyed, grandfathered by pickId AND matching their PINNED bodyHash (§7.2
   * containment). Counted, NOT a failure — exit stays 0. A grandfathered strand
   * whose body moved is a HARD legacy-body-mismatch instead.
   */
  legacyUnverifiable: { count: number; pickIds: string[] };
  /**
   * The v1-prefix epoch anchor (spec §6). `present` = an anchor strand exists;
   * `ok` = the prefix + manifest authenticate against it. A fabric with v1 strands
   * and no valid anchor HARD-FAILS (constraint c — coverage is a code constant).
   */
  anchor: { present: boolean; ok: boolean; corroboration?: string };
  failures: FabricVerifyFailure[];
}

export interface VerifyOptions {
  /**
   * Require the v1 coverage anchor (default true). `attest` alone passes false — it
   * is the one verb that legitimately operates on an as-yet-uncovered fabric; every
   * OTHER check still applies.
   */
  requireAnchor?: boolean;
}

const isV2 = (s: Strand): boolean => s.schemaVersion >= 2;

/** The first bad object found under a tree, or null if the whole DAG re-hashes. */
interface BadObject {
  id: string;
  problem: 'missing' | 'corrupt';
}

/**
 * Walk a binding tree RECOMPUTING every reachable object (trust floor, MEDIUM-1
 * closure): presence is not integrity — every tree and blob under `treeId` must
 * re-hash to its content-address (ObjectStore reads are verified and fail closed).
 * `ok` memoizes fully-verified ids so shared subtrees across strands hash once.
 */
function firstBadObject(store: ObjectStore, treeId: string, ok: Set<string>): BadObject | null {
  if (ok.has(treeId)) return null;
  if (!store.has(treeId)) return { id: treeId, problem: 'missing' };
  let entries;
  try {
    entries = store.getTree(treeId); // verified read — throws on tampered bytes
  } catch {
    return { id: treeId, problem: 'corrupt' };
  }
  for (const e of entries) {
    if (e.mode === '40000') {
      const bad = firstBadObject(store, e.id, ok);
      if (bad) return bad;
    } else if (e.mode === '160000') {
      continue; // gitlink — no bytes stored natively
    } else if (!ok.has(e.id)) {
      if (!store.has(e.id)) return { id: e.id, problem: 'missing' };
      try {
        store.getBlob(e.id); // verified read — recomputes the blob's address
      } catch {
        return { id: e.id, problem: 'corrupt' };
      }
      ok.add(e.id);
    }
  }
  ok.add(treeId);
  return null;
}

/**
 * Authenticate the fabric at `root`. Pure over the on-disk ledger + object store.
 * `failures` empty ⇒ intact (CLI exit 0); non-empty ⇒ tamper/break (exit 1).
 */
export function verifyFabric(root: string, opts: VerifyOptions = {}): FabricVerifyReport {
  const requireAnchor = opts.requireAnchor ?? true;
  const wdir = warplineDirOf(root);
  const fabric = readFabric(wdir);
  const store = new ObjectStore(root);
  const grandfathered = readLegacyGrandfathered(wdir);
  const failures: FabricVerifyFailure[] = [];
  const legacyPickIds: string[] = [];

  const knownPickIds = new Set<string>();
  const versionByPickId = new Map<string, number>(); // for manifest membership sanity
  const verifiedObjects = new Set<string>(); // memo — shared subtrees re-hash once
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
      else if (kind === 'pickId-mismatch' || kind === 'legacy-body-mismatch') v1SelfHashOk = false;
    };

    // 1. Integrity (§7.1/§7.3 + HIGH-2 containment) — try the finite set of known
    //    hashing rules. A stored pickId reproduced by any known rule is OK. Otherwise
    //    the grandfather clause applies ONLY to a v1 strand whose PINNED body hash
    //    still matches — that is a SOFT legacy-unverifiable (exit stays 0). A
    //    grandfathered strand whose BODY moved is a HARD legacy-body-mismatch (the
    //    clause exempts the retired pickId rule, never the body), and anything else
    //    is a HARD pickId-mismatch (real tamper — how a future forgery surfaces).
    if (!reproducesUnderKnownRule(s)) {
      const pinned = !isV2(s) ? grandfathered.get(s.pickId) : undefined;
      if (pinned !== undefined) {
        const { pickId: _stored, ...body } = s;
        const actual = computeLegacyBodyHash(body);
        if (actual === pinned) {
          legacyPickIds.push(s.pickId); // soft — not a failure
        } else {
          push('legacy-body-mismatch', `body hash ${actual} != pinned ${pinned} (grandfathered strand's body was tampered)`);
        }
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

    // 4. Binding re-derivation — every tree/blob reachable from binding.treeId
    //    RE-HASHES to its content-address (not mere presence — MEDIUM-1); ref-sourced
    //    strands additionally match the shadow gitOid to provenance.treeSha.
    if (s.binding) {
      const bad = firstBadObject(store, s.binding.treeId, verifiedObjects);
      if (bad) {
        push(
          bad.problem === 'missing' ? 'missing-binding' : 'corrupt-object',
          bad.problem === 'missing'
            ? `binding object ${bad.id} is absent from the object store`
            : `binding object ${bad.id} does not recompute to its content-address (tampered bytes)`,
        );
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

    // 5. Merge-recipe validation (OQ-D compensating control): the recipe treeIds are
    //    deliberately EXCLUDED from the v2 pickId, so verify is the authority — all
    //    four recipe trees ({base,ours,theirs,result}) must exist AND recompute, and
    //    the recipe's result must BE the strand's byte binding (a recipe that lands
    //    on different bytes than the binding is a forged/desynced recipe).
    if (s.merge) {
      for (const slot of ['base', 'ours', 'theirs', 'result'] as const) {
        const bad = firstBadObject(store, s.merge[slot], verifiedObjects);
        if (bad) {
          push(
            'merge-recipe-invalid',
            `merge recipe ${slot} tree ${s.merge[slot]}: object ${bad.id} is ${bad.problem === 'missing' ? 'absent from the object store' : 'tampered (does not recompute)'}`,
          );
        }
      }
      if (s.binding && s.merge.result !== s.binding.treeId) {
        push(
          'merge-recipe-invalid',
          `merge.result ${s.merge.result} != binding.treeId ${s.binding.treeId} (recipe does not produce the bound bytes)`,
        );
      }
    }

    knownPickIds.add(s.pickId);
    versionByPickId.set(s.pickId, s.schemaVersion);
  }

  // 6. Manifest membership sanity (HIGH-2 containment): every grandfather entry must
  //    correspond to an EXISTING v1 strand in this fabric. An unknown pickId is a
  //    stale/foreign allow-list entry; a v2 pickId in the list is an attempt to
  //    grandfather an authenticatable strand — both are HARD failures (seq -1: these
  //    are manifest-level, there is no strand line to point at).
  for (const [pickId] of grandfathered) {
    const version = versionByPickId.get(pickId);
    if (version === undefined) {
      failures.push({
        seq: -1,
        pickId,
        kind: 'legacy-manifest-invalid',
        detail: 'fabric-legacy.json entry matches NO strand in the fabric (stale/foreign allow-list entry)',
      });
    } else if (version >= 2) {
      failures.push({
        seq: -1,
        pickId,
        kind: 'legacy-manifest-invalid',
        detail: 'fabric-legacy.json entry names a schemaVersion 2 strand — grandfathering applies only to v1 (entry ignored for verification)',
      });
    }
  }

  // 7. Selvage cross-check (spec §6.7 — the gap the audit found: verify never looked
  //    at the selvage). If a selvage pointer exists it MUST point at the fabric tip
  //    strand's stateId; a rolled-back selvage over a truncated head is otherwise
  //    internally consistent. Lenient when no selvage is set (many strands appended
  //    without a tip pointer in tests / mid-migration).
  const selvage = readSelvage(wdir);
  if (selvage !== null && fabric.length > 0) {
    const tip = fabric[fabric.length - 1];
    if (tip.stateId !== selvage) {
      failures.push({
        seq: tip.seq,
        pickId: tip.pickId,
        kind: 'chain-break',
        detail: `selvage ${selvage} does not point at the fabric tip strand's stateId ${tip.stateId} (rolled-back tip)`,
      });
    }
  }

  // 8. Epoch-anchor authentication (spec §6) — the v1 prefix is authenticated against
  //    its chained attestation, not per-strand self-hashes. This single walk flips
  //    HIGH-A, HIGH-B co-tamper, MED-C, the mint variant, and the tip-append variant
  //    to exit 1.
  const v1Strands = fabric.filter((s) => !isV2(s));
  const anchorStrands = fabric.filter((s) => s.attests?.kind === 'epoch-anchor' && s.attests.epoch === 'v1');
  const anchor = findAnchor(fabric, 'v1');
  let anchorOk = false;
  let corroboration: string | undefined;

  // 8a. Coverage requirement (constraint c) — a code constant, not deletable disk
  //     state: any v1 strand present with no anchor HARD-fails.
  if (requireAnchor && v1Strands.length > 0 && anchorStrands.length === 0) {
    failures.push({
      seq: -1,
      pickId: '(none)',
      kind: 'anchor-missing',
      detail:
        `fabric has ${v1Strands.length} v1 strand(s) but no epoch anchor — the v1 prefix is unauthenticated. ` +
        `Run \`warpline objects backfill\` then \`warpline fabric attest\`.`,
    });
  }

  // 8b. Exactly one anchor per epoch — every anchor after the first is a duplicate
  //     (the CLI cannot seal a second; its existence is forgery or a bug).
  if (anchorStrands.length > 1) {
    for (let i = 1; i < anchorStrands.length; i++) {
      failures.push({
        seq: anchorStrands[i].seq,
        pickId: anchorStrands[i].pickId,
        kind: 'anchor-duplicate',
        detail: `a second v1 epoch anchor — attestation is once-per-epoch; this one is forged/spurious`,
      });
    }
  }

  if (anchor?.attests) {
    const a = anchor.attests;
    const malformed = (detail: string): void => {
      failures.push({ seq: anchor.seq, pickId: anchor.pickId, kind: 'anchor-malformed', detail });
    };
    let shapeOk = true;

    // 8c. Shape.
    if (a.kind !== 'epoch-anchor' || a.version !== 1 || a.epoch !== 'v1') {
      malformed(`unrecognized attestation kind/version/epoch (${a.kind}/${a.version}/${a.epoch})`);
      shapeOk = false;
    }
    if (a.prefixCount !== v1Strands.length) {
      malformed(`prefixCount ${a.prefixCount} != v1 strand count ${v1Strands.length}`);
      shapeOk = false;
    }
    // Every v1 strand must occupy seqs 0..prefixCount-1 (contiguous head); a v1 strand
    // elsewhere → v1-out-of-prefix (kills the "append a fresh self-consistent v1 strand
    // at the tip" variant). A v2 strand inside the prefix range → malformed.
    for (let i = 0; i < fabric.length; i++) {
      const isV1 = !isV2(fabric[i]);
      if (i < a.prefixCount && !isV1) {
        malformed(`a v2 strand (seq ${fabric[i].seq}) sits inside the covered prefix range [0..${a.prefixCount - 1}]`);
        shapeOk = false;
      }
      if (i >= a.prefixCount && isV1) {
        failures.push({
          seq: fabric[i].seq,
          pickId: fabric[i].pickId,
          kind: 'v1-out-of-prefix',
          detail: `a v1 strand at index ${i} is outside the covered prefix [0..${a.prefixCount - 1}] (appended v1 forgery)`,
        });
        shapeOk = false;
      }
    }
    if (a.prefixCount > 0 && a.prefixCount <= fabric.length) {
      if (fabric[a.prefixCount - 1].pickId !== a.prefixTipPickId) {
        malformed(`prefixTipPickId ${a.prefixTipPickId} != covered tip strand's pickId ${fabric[a.prefixCount - 1].pickId}`);
        shapeOk = false;
      }
    }
    if (isV2(anchor) === false) {
      malformed('the anchor strand itself is not a v2 strand');
      shapeOk = false;
    }
    if (anchor.seq < a.prefixCount) {
      malformed(`anchor seq ${anchor.seq} is not greater than every covered seq (prefixCount ${a.prefixCount})`);
      shapeOk = false;
    }

    // 8d. Prefix digest — recompute over strands 0..prefixCount-1 as stored on disk.
    //     THE check that flips HIGH-A, HIGH-B co-tamper, and MED-C to exit 1.
    let prefixOk = false;
    if (shapeOk) {
      const recomputed = computePrefixDigest(fabric.slice(0, a.prefixCount));
      if (recomputed !== a.prefixDigest) {
        failures.push({
          seq: anchor.seq,
          pickId: anchor.pickId,
          kind: 'anchor-mismatch',
          detail:
            `the v1 prefix does not match its chained attestation — some v1 body, binding, or id was rewritten ` +
            `(recomputed ${recomputed} != attested ${a.prefixDigest})`,
        });
      } else {
        prefixOk = true;
      }
    }

    // 8e. Manifest digest + cardinality.
    const legacy = readLegacyManifest(wdir);
    const recomputedManifest = computeManifestDigest(legacy);
    const manifestCount = legacy?.grandfathered.length ?? 0;
    let manifestOk = false;
    if (recomputedManifest !== a.manifestDigest) {
      failures.push({
        seq: anchor.seq,
        pickId: anchor.pickId,
        kind: 'anchor-manifest-mismatch',
        detail:
          `fabric-legacy.json digest ${recomputedManifest ?? '(absent)'} != attested ${a.manifestDigest ?? '(null)'} ` +
          `(the grandfather manifest was tampered)`,
      });
    } else if (manifestCount !== a.grandfatheredCount) {
      failures.push({
        seq: anchor.seq,
        pickId: anchor.pickId,
        kind: 'anchor-manifest-mismatch',
        detail: `grandfatheredCount moved ${a.grandfatheredCount}→${manifestCount} (a grandfather entry was added/removed)`,
      });
    } else {
      manifestOk = true;
    }

    anchorOk = shapeOk && prefixOk && manifestOk;
    if (anchorOk) corroboration = a.corroboration.gitCommit;
  }

  return {
    checked: fabric.length,
    v1Prefix: { count: v1Count, selfHashOk: v1SelfHashOk },
    v2Chain: { count: v2Count, ok: v2ChainOk },
    boundaryAnchored,
    legacyUnverifiable: { count: legacyPickIds.length, pickIds: legacyPickIds },
    anchor: { present: anchorStrands.length > 0, ok: anchorOk, corroboration },
    failures,
  };
}
