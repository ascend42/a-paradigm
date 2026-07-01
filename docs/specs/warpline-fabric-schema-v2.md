# Warpline Fabric Schema v2 — the pickId Identity Contract Migration

**Task:** fabric-schema-v2 (keystone of the 5-lens audit) · **Decision:** TD-2026-07-01-721
**Author:** Arky (Warpline system architect) · **Status:** spec, ready-to-implement (Builder implements verbatim)
**Precondition:** M1a (native object store) + M1b (bind-on-seal, durable merge bytes) landed; this lands **before** M1c (restore/cutover).
**Package:** `packages/warpline` · **Branch:** `warpline-surfaces`

This spec authenticates the fabric. Today `pickId` is a per-strand self-hash with **no link to its predecessor** (`strand.ts:140`), so the ledger is a snapshot bucket, not a chain — Aegis's C2 (bait-and-switch a `binding`, or reorder/forge a strand, undetected). v2 folds the chain link, the byte binding, and agent attribution **into** the content-address, per audit amendment **A1**, and restores the dropped `MergeRecipe.algo` tag (Judge). It bumps the identity contract v1→v2 and ships `warpline fabric verify`.

---

## 1. `computePickId` v2 preimage

**File:** `packages/warpline/src/fabric/strand.ts`, replace `computePickId` at **strand.ts:140-144**.

### 1.1 What is IN the preimage vs EXCLUDED (v2)

| Field | v1 (pick:v0) | v2 (pick:v2) | Rationale |
|---|---|---|---|
| `schemaVersion`, `seq`, `stateId`, `parentStateId`, `actor`, `intent`, `recordedAt`, `objectCount`, `delta`, `provenance`, `resolves?`, `merged?` | IN | IN | the immutable event (unchanged) |
| `parentPickId` (NEW) | — | **IN** | the chain link — authenticates order/ancestry (A1) |
| `authoredBy.agentId` (NEW) | — | **IN** | attribution is event identity |
| `authoredBy.sessionKey` (NEW) | — | **EXCLUDED** | ephemeral session breadcrumb, not identity |
| `binding.treeId` (NEW seam) | EXCLUDED | **IN** (folded as `bindingTreeId`) | byte tamper-evidence at cutover w/o signatures (A1) |
| `binding.gitOid` | EXCLUDED | **EXCLUDED** | coexistence-only, dropped at cutover (§2.4 of M1 design) |
| `mergeParentPickId` (NEW, merges only) | — | **IN** | second DAG parent — a merge is a 2-parent node |
| `merge.algo` (NEW, merges only) | dropped (bug) | **IN** (folded as `mergeAlgo`) | pins the merge algorithm version (Judge) |
| `merge.{base,ours,theirs,result}` | EXCLUDED | **EXCLUDED** | byte derivations; `result`==`bindingTreeId` already folded; re-derivation is checked by `fabric verify`, not identity |
| `calibratedConfidence` | EXCLUDED | **EXCLUDED** | graded post-seal, mutable via `rewriteFabric` (the moat) |

**Key consequence (Aegis C2 closed):** for v2, swapping `binding.treeId` under a strand now **changes its pickId**, so a bait-and-switch binding is caught by a pickId recompute — no signature needed.

### 1.2 Canonicalization — reuse the existing serializer

Do **not** invent serialization. Reuse `canonicalSerialize(canonicalSafe(identity))` already imported at strand.ts:21 (`../warp/canonical.js`). `canonicalSafe` (strand.ts:116-125) maps `null`/`undefined`→`""`; `canonicalSerialize` (canonical.ts:26) sorts keys by codepoint, NFC-normalizes strings, rejects raw null. So **declaration order below is irrelevant** — keys are sorted at serialize time. Genesis `null`s (`parentPickId`, `parentStateId`) normalize to `""`; `""` is never a real id, so no collision (same precedent as strand.ts:109-114).

### 1.3 The exact v2 preimage object (post-`canonicalSafe`, pre-serialize)

Normal (non-merge) v2 pick:

```jsonc
{
  "schemaVersion": 2,
  "seq": 15,
  "stateId": "state:v0:<this>",
  "parentStateId": "state:v0:<prev>",          // "" at genesis
  "parentPickId": "pick:v2:<prev-strand>",      // "" at genesis; the v1 TIP pickId at the v1→v2 boundary (§3)
  "actor": "ascend",
  "authoredBy": { "agentId": "arky" },          // sessionKey STRIPPED before hashing
  "intent": "…",
  "recordedAt": "2026-07-01T18:00:00.000Z",
  "objectCount": 5176,
  "delta": { "born": [], "contractChanged": [], "renamedNoop": 0, "retired": [] },
  "provenance": { "gitCommit": "…", "ref": "HEAD", "treeSha": "…" },  // nulls → ""
  "bindingTreeId": "tree:v1:<root>",            // binding.treeId folded IN (A1)
  "mergeAlgo": ""                               // null → "" for a non-merge
}
```

Merge (CLEAN-admit) v2 pick adds:

```jsonc
{
  // …all of the above, plus…
  "merged": true,
  "mergeParentPickId": "pick:v2:<ours-base-strand>",   // the SECOND parent (§2.2)
  "mergeAlgo": "warpline-merge3-v1",                    // restored from recipe.algo
  "bindingTreeId": "tree:v1:<recipe.result>"           // == merge.result
}
```

`resolves` (KNOT-council strands) rides along in the identity unchanged (already inside the event body).

### 1.4 Reference implementation

```ts
export function computePickId(body: StrandBody): string {
  // v1 legacy path — UNCHANGED self-hash (lets `fabric verify` recompute historical strands).
  if (body.schemaVersion < 2) {
    const { calibratedConfidence: _c, binding: _b, merge: _m, ...identity } = body;
    const canon = canonicalSerialize(canonicalSafe(identity));
    return 'pick:v0:' + createHash('sha256').update(canon, 'utf8').digest('hex');
  }
  // v2 — authenticated chain link + byte binding + agent attribution folded IN.
  const { calibratedConfidence: _c, binding, merge, authoredBy, ...rest } = body;
  const identity = {
    ...rest, // schemaVersion, seq, stateId, parentStateId, parentPickId, actor, intent,
             // recordedAt, objectCount, delta, provenance, resolves?, merged?, mergeParentPickId?
    authoredBy: { agentId: authoredBy?.agentId ?? null }, // sessionKey EXCLUDED
    bindingTreeId: binding?.treeId ?? null,               // A1: fold byte identity
    mergeAlgo: merge?.algo ?? null,                       // Judge: restore the algo tag
  };
  const canon = canonicalSerialize(canonicalSafe(identity));
  return 'pick:v2:' + createHash('sha256').update(canon, 'utf8').digest('hex');
}
```

The prefix (`pick:v0:` vs `pick:v2:`) plus `schemaVersion` give readers two independent dispatch signals.

---

## 2. The new Strand fields

**File:** `packages/warpline/src/fabric/strand.ts` (interface at strand.ts:69-104).

### 2.1 Field additions

```ts
export interface Strand {
  schemaVersion: 1 | 2;                 // was literal `1` (strand.ts:70) — widen
  seq: number;
  pickId: string;                        // pick:v0:… (v1) | pick:v2:… (v2)
  // NEW — the authenticated chain link. null at genesis. IN the v2 pickId.
  parentPickId?: string | null;          // absent on v1 strands; present (nullable) on v2
  // NEW — agent attribution. agentId IN the v2 pickId; sessionKey EXCLUDED.
  authoredBy?: { agentId: string | null; sessionKey?: string | null };
  // NEW — the SECOND merge parent (merge strands only). IN the v2 pickId.
  mergeParentPickId?: string | null;
  stateId: string;
  parentStateId: string | null;
  actor: string;                         // unchanged — the git author / operator identity
  intent: string;
  recordedAt: string;
  objectCount: number;
  delta: StrandDelta;
  calibratedConfidence: number | null;   // EXCLUDED from pickId (unchanged)
  provenance: { ref: string; treeSha: string | null; gitCommit: string | null };
  resolves?: KnotResolution;
  merged?: boolean;
  binding?: StrandBinding | null;        // binding.treeId now IN the v2 pickId (gitOid still out)
  merge?: MergeRecipe;
}
```

And add the algo tag to `MergeRecipe` (strand.ts:62-67):

```ts
export interface MergeRecipe {
  algo: 'warpline-merge3-v1';   // NEW — the exact merge algorithm version (restored per Judge)
  base: string; ours: string; theirs: string; result: string;
}
```

`captureMerge` (snapshot.ts:162-175) sets `algo: 'warpline-merge3-v1'` on the returned recipe (~1 line).

### 2.2 Parent-link semantics (nail this)

- `parentPickId` := the pickId of the strand at `parentStateId` — which is **always the ledger tip** (append-only; tip == last strand). So `sealState` computes it itself from the fabric it already reads for `seq` (no threading needed):

  ```ts
  // seal.ts, after `const seq = readFabric(wdir).length;`
  const fab = readFabric(wdir);
  const seq = fab.length;
  const parentPickId = fab.length ? fab[fab.length - 1].pickId : null;
  ```

  For a CLEAN merge, `parentStateId === selvageId === tip`, so `parentPickId` is the **theirs/selvage** side — the linear chain stays uniform and walkable.
- `mergeParentPickId` := the pickId of the strand at the admit **`baseId`** (the ours-side base the agent forked from). This is **not** the tip, so admit must resolve and pass it (admit already finds `baseStrand` at admit.ts:249). Present only on merge strands.

### 2.3 Threading `agentId` (Loid's ~20 lines) — exact call sites

1. **`RecordPickOptions`** (pick.ts:37-50): add `agentId?: string;` and `sessionKey?: string;`.
2. **`AdmitOptions`** (admit.ts:128-133): already has `agentId: string`. No change.
3. **`SealInput`** (seal.ts:44-59): add
   ```ts
   authoredBy?: { agentId: string | null; sessionKey?: string | null };
   mergeParentPickId?: string | null;
   ```
   (`parentPickId` is **not** a SealInput field — seal computes it from the tip, §2.2.)
4. **`sealState` body** (seal.ts:77-93): bump `schemaVersion: 2`, add `parentPickId` (computed), and spread `authoredBy` / `mergeParentPickId` (conditional, like the existing `...(input.binding ? … : {})` at seal.ts:91).
5. **pick.ts seal call** (pick.ts:108-116): pass `authoredBy: { agentId: opts.agentId ?? null, sessionKey: opts.sessionKey ?? null }`.
6. **admit.ts seal calls** — genesis (admit.ts:225-228), FAST_ADMIT (admit.ts:240-243), CLEAN merge (admit.ts:265-268): pass `authoredBy: { agentId: opts.agentId }`; on the **CLEAN merge** call also pass `mergeParentPickId: baseStrand?.pickId ?? null` (baseStrand resolved at admit.ts:249).

### 2.4 Default / unknown-agent (human commits)

- The auto-seal hook (hook.ts:37) runs `warpline pick --ref HEAD --quiet` and passes **no** `agentId` → `authoredBy.agentId = null`. This is the correct human/git-commit default: `actor` still carries the git author (pick.ts:81-84 / admit.ts:189-192, unchanged), `authoredBy.agentId` is `null` (`""` in the hash). No CLI flag change is required for the hook; optionally add `warpline pick --agent <id>` to `cli.ts` for explicit agent seals.
- All 14 existing dogfood strands are `actor:"ascend"` with no agent — they remain v1 and are never re-attributed.

---

## 3. Migration / compat for the existing v1 fabric

The 14 on-disk strands are `schemaVersion:1`, `pickId:"pick:v0:…"`, no `parentPickId`, no `binding` (verified against `.warpline/fabric.jsonl:1-3`). **pickId is immutable — v1 pickIds cannot be recomputed under the v2 rule and must never be rewritten.**

> **CORRECTION (TD-2026-07-01-202, discovered during build):** the assumption below that "all 14 existing v1 strands re-verify" is FALSE. The real fabric is mixed-provenance: seq 0 was sealed under a whole-body rule (pre-`59c138f7`); seq 1–7 were sealed whole-body AND then had `calibratedConfidence` overwritten in place by `#grade` (`0e3d3d57`), destroying the hashed byte; seq 8–14 were sealed under the current exclusion rule. See §7 for the ratified legacy-verification rule that supersedes the naive "all re-verify" premise. The v2 mechanism itself is unaffected — seq 8–14 prove the current rule is byte-stable.

### 3.1 The rule (decision + justification)

**No genesis-anchor rewrite. The v1 prefix stays outside the *ordering*-authenticated chain; the first v2 strand anchors the v1 TIP for free.**

- Readers dispatch on the `schemaVersion` field: `1`→v1 self-hash rule (`pick:v0`), `2`→v2 chain rule (`pick:v2`). The pickId prefix corroborates.
- The **first v2 strand** sets `parentPickId = <pickId of the ledger tip>` — which is the last v1 strand's `pick:v0:…`. This happens automatically via the tip rule (§2.2): `sealState` reads the tip strand's pickId regardless of its version. So the v2 chain **commits to the v1 tip hash** as its anchor — the "one-time genesis-anchor" the task asks about, obtained without any special code path or rewrite.
- **What this authenticates and what it does not** (Aegis C2 caveat, stated loudly): every v1 strand still has per-strand **self-hash integrity** (recompute its v1 pickId and compare). But v1 strands are **not linked to each other**, so **reordering or deleting an interior v1 strand is not chain-detectable** — only per-strand tamper is. The v2 boundary strand pins only the v1 **tip** pickId. Document the v1 prefix as a *known ordering-unauthenticatable prefix*; full-chain authentication begins at the first v2 strand and is complete from there forward. (During coexistence, git's own commit chain still corroborates v1 ordering via `provenance.gitCommit`.)

### 3.2 No backfill of v1 pickIds

`warpline objects backfill` may still **stamp `binding` onto v1 strands** via `rewriteFabric` (M1 design §2.3) — and this does **not** move v1 pickIds, because `binding` is excluded from the v1 rule. v1 strands are never promoted to v2.

### 3.3 What `fabric verify` does at the boundary

- For each v1 strand: recompute the v1 self-hash and assert `== stored pickId` (integrity). Do **not** expect `parentPickId`. Tally as `v1Prefix.count`, unchained.
- At the **first v2 strand**: assert `parentPickId === <previous strand's stored pickId>` (the v1 tip). Set `boundaryAnchored = true` on success.
- From there: walk the v2 chain (§4).

---

## 4. `warpline fabric verify` contract

**New module:** `packages/warpline/src/fabric/verify.ts`, exporting `verifyFabric(root): FabricVerifyReport`.
**New CLI:** a `fabric` command group with a `verify` subcommand, mirroring the `objects` group at **cli.ts:506-553**. (Do **not** overload `objects verify` — that checks loose object self-consistency, a different concern.)

### 4.1 Algorithm

For the fabric read via `readFabric` (fabric.ts:81), in seq order:

1. **Integrity** — recompute `computePickId({...strand}` minus `pickId)` (dispatch by `schemaVersion`) and assert `== strand.pickId`. Failure → `pickId-mismatch`.
2. **Chain (v2 only)** — assert `strand.parentPickId === prev.pickId` (where `prev` is the immediately preceding ledger strand). Failure → `chain-break`. For the first v2 strand, `prev` is the v1 tip (§3.3).
3. **Merge second-parent (v2 merge strands)** — assert `mergeParentPickId` resolves to some earlier strand's `pickId`. Unresolved → `merge-parent-unresolved`.
4. **Binding re-derivation** — if `binding` present: assert `store.has(binding.treeId)` and re-read the root tree via `ObjectStore.getTree` recursively, confirming every referenced object exists; for **ref-sourced** strands additionally assert `binding.gitOid === provenance.treeSha` (the coexistence proof, M1 design §2.4, scoped to ref strands per A5). Missing object → `missing-binding`; treeId not present / mismatch → `binding-mismatch`. Note: for v2 a swapped `binding.treeId` already fails step 1 (it's in the hash) — step 4 additionally catches a *dangling but self-consistent* binding.

### 4.2 JSON shape

```jsonc
{
  "checked": 15,
  "v1Prefix": { "count": 14, "selfHashOk": true },   // integrity yes, ordering-unauthenticated
  "v2Chain":  { "count": 1,  "ok": true },
  "boundaryAnchored": true,                            // first v2 parentPickId == v1 tip pickId
  "failures": [
    // { "seq": 9, "pickId": "pick:v2:…", "kind": "chain-break",
    //   "detail": "parentPickId pick:v2:aaa != prev pick:v2:bbb" }
  ]
}
```

### 4.3 Exit codes

- `0` — all intact (`failures` empty).
- `1` — one or more tamper/break findings (`failures` non-empty).
- `2` — usage / I/O error (fabric unreadable, store missing) — surfaced via the existing `fail(err)` path (cli.ts).

### 4.4 The `rewriteFabric` identity guard (Aegis H2)

**File:** `packages/warpline/src/fabric/fabric.ts`, inside `rewriteFabric` at **fabric.ts:118**, before writing:

```ts
for (const s of strands) {
  const { pickId, ...body } = s;
  if (computePickId(body) !== pickId) {
    throw new Error(
      `warpline: rewriteFabric refused — strand seq ${s.seq} recomputed pickId ${computePickId(body)} ` +
      `!= stored ${pickId}; an identity field was mutated (only calibratedConfidence is rewritable).`,
    );
  }
}
```

Because `calibratedConfidence` is excluded from **both** the v1 and v2 rules, `grade.applyGrades` (grade.ts:136-153, which only mutates `calibratedConfidence` at grade.ts:143-145) passes cleanly, while any accidental mutation of `stateId`/`delta`/`binding.treeId`/`parentPickId` **throws** — grade can no longer silently drift identity fields. `objects backfill` stamping `binding` onto a **v1** strand also passes (binding excluded from the v1 rule). This makes `computePickId` a required import in `fabric.ts`.

---

## 5. Sequencing of the ride-along fixes

| Fix | What | Same PR? | Commit order | Reason |
|---|---|---|---|---|
| **T-029** | pick.ts:99 — currently falls through and seals when the parent state is unloadable ("safer than silently dropping"), which **orphans history** exactly like admit.ts:211 warns against. Make it **fail closed**: throw the same class of error as admit.ts:211-215. | **Yes**, but a **separate commit** | **First** (before the schema change) | Independent, self-contained safety fix; landing it first hardens the seal path during the migration and keeps a clean bisect point. |
| **schema v2 core** | §1-4 above. | — | **Second** | The keystone. |
| **T-030** | Relax the H1 guard (admit.ts:256) so a 3rd-generation merge can re-base off a merged tip via its recipe (now that M1b stores merged bytes and v2 authenticates `mergeParentPickId` + `merge.algo`). | **No — separate PR** | **After** schema v2 + `fabric verify` are merged | OQ-5: its own conflict/re-base **test matrix**; it *consumes* the v2 recipe authentication but must not be entangled with the identity-contract change. Flipping a fail-closed guard is the highest-risk change here and deserves an isolated review. |

Net: **PR-A** = `[commit 1: T-029 fail-closed] + [commit 2: schema v2 + fabric verify + rewriteFabric guard]`. **PR-B** (follow-up) = T-030 H1 relaxation.

---

## 6. Test manifest

New/changed tests in `packages/warpline/test/`. Existing pickId tests live alongside strand/seal tests — extend them.

1. **`strand-pickid-v2.test.ts`** (new)
   - *Excluded fields still don't move the id:* build a v2 strand; vary `calibratedConfidence`, `binding.gitOid`, `authoredBy.sessionKey`, and `merge.{base,ours,theirs}` → `pickId` **unchanged** (bare == bound == graded for the excluded set).
   - *Binding-swap now changes the id:* same strand, change `binding.treeId` → `pickId` **differs** (the A1 property).
   - *agentId is in identity:* change `authoredBy.agentId` → `pickId` **differs**.
   - *Genesis + null normalization:* `parentPickId:null`, `parentStateId:null` hash deterministically (map to `""`); two genesis strands with identical bodies collide, distinct bodies don't.
   - *Merge identity:* `mergeParentPickId` and `merge.algo` change the id; `merge.base/ours/theirs` do not.
   - *v1 legacy recompute:* a `schemaVersion:1` body reproduces its stored `pick:v0:` exactly (regression against a real strand from `.warpline/fabric.jsonl`).

2. **`fabric-verify.test.ts`** (new — the core authenticity suite)
   - *Clean fabric verifies:* seal N v2 strands over a fixture → `verifyFabric` returns exit-equivalent `0`, `failures:[]`, `boundaryAnchored:true`.
   - *Forged strand detected:* mutate an interior v2 strand's `intent`/`delta`/`binding.treeId` on disk → `pickId-mismatch`.
   - *Reordered/removed strand detected:* swap two v2 lines / drop one → `chain-break` (parentPickId no longer matches prev).
   - *Bait-and-switch binding (Aegis C2 reproduction):* repoint a v2 strand's `binding.treeId` at a different valid tree in the store → caught (via `pickId-mismatch`, since treeId is in the hash); repoint at a **non-present** tree → `missing-binding`.
   - *v1 prefix handling:* a fabric with 14 v1 + 1 v2 strand → `v1Prefix.selfHashOk:true`, `v2Chain.ok:true`, `boundaryAnchored:true`; corrupt a v1 strand → v1 self-hash failure surfaced but chain still reports the boundary.

3. **`rewrite-fabric-guard.test.ts`** (new)
   - *Grade round-trips:* run `gradeFabric` + `applyGrades` over a v2 fabric → `rewriteFabric` **succeeds**, pickIds unchanged, `calibratedConfidence` updated (no identity drift).
   - *Identity mutation throws:* a `rewriteFabric` call whose input mutates `delta`/`stateId`/`binding.treeId`/`parentPickId` → **throws** with the seq in the message.
   - *v1 binding stamp passes:* stamping `binding` onto a v1 strand via `rewriteFabric` does not throw and does not move its `pick:v0:` id.

4. **`admit-agentid.test.ts` / extend `pick` tests**
   - *agentId round-trips:* `admit(root, { agentId:'arky', … })` → sealed strand has `authoredBy.agentId === 'arky'` and that value is reflected in the recomputed pickId; `recordPick` with no `agentId` (hook path) → `authoredBy.agentId === null`.
   - *mergeParentPickId set on CLEAN:* a materialized CLEAN admit → strand carries `mergeParentPickId` == the base strand's pickId and `merge.algo === 'warpline-merge3-v1'`.

5. **`fabric-schema-migration.test.ts`** (new)
   - *Boundary anchor:* over the real 14-strand v1 dogfood fixture, seal the first v2 strand → its `parentPickId` equals the stored pickId of v1 seq 13; `fabric verify` → `boundaryAnchored:true`.

6. **T-029 regression** (extend `pick` tests): with a selvage pointing at an unloadable state, `recordPick` now **throws** (fail-closed), symmetric with the existing admit.ts:211 test.

---

## Determinism & invariants preserved

Every v2 pickId is `pick:v2:sha256(canonicalSerialize(canonicalSafe(identity)))` using the **same** serializer that already backs `essence`/`state`/v1-`pick` hashing (canonical.ts), so byte-stability across runs/machines is inherited unchanged: keys sorted by codepoint, strings NFC-normalized, `null`→`""` with no real-id collision, no timestamps or paths in the object bytes. The v1 rule is byte-for-byte preserved (existing strands re-verify), `computeStateId` is untouched, and `calibratedConfidence` remains the sole hash-excluded mutable field — so the moat's grade loop and `binding` backfill both continue to run through `rewriteFabric` without moving identity, now *enforced* by the recompute guard. The only new identity commitments are the chain link, the byte binding, agent attribution, and the merge's second parent + algo — each of which *should* change the id when it changes.

## Risks / open questions for the founder

- **OQ-A (v1 ordering is unauthenticatable, permanently).** Because v1 pickIds can't be recomputed under the v2 rule and are immutable, interior v1 reordering/deletion is never chain-detectable — only per-strand self-hash tamper is. We anchor only the v1 *tip*. Accept as the documented C2 caveat, or (heavier) add a one-time signed `v1-tip-anchor` sidecar. **Recommendation: accept + document**; git corroborates v1 ordering during coexistence.
- **OQ-B (sessionKey in identity?).** `authoredBy.sessionKey` placed **outside** the hash (ephemeral). If two picks by the same agent in different sessions must be cryptographically distinguishable at the identity level, move it in. **Recommendation: keep out.**
- **OQ-C (merge second-parent chosen as base, not ours-commit).** `mergeParentPickId` points at the admit `baseId` strand. If a future WEFT/branch model wants the *ours-side head* rather than the fork base, this widens. Flagged for the M2.5 branching model (audit A6).
- **OQ-D (T-030 timing).** Relaxing H1 depends on trusting the stored merge recipe; v2 authenticates `mergeParentPickId` + `algo` but **not** the recipe treeIds (excluded). If T-030 needs the recipe treeIds authenticated, fold `merge.{base,ours,theirs,result}` into the v2 hash too — a scope increase. **Recommendation: keep them excluded, have `fabric verify` re-derive them (step 4), land T-030 as PR-B.**
- **OQ-E (schemaVersion widening ripples).** `Strand.schemaVersion` goes `1` → `1 | 2`; any exhaustive switch or literal-`1` assumption elsewhere (grep `schemaVersion`) must be swept during Builder's pass.

---

## 7. Legacy verification rule (TD-2026-07-01-202) — supersedes the §3 "all re-verify" premise

The build revealed the on-disk fabric was sealed under two different historical hashing rules, and `#grade` mutated a hashed field in place for the oldest strands. `fabric verify` and the §4.4 `rewriteFabric` guard must therefore reproduce ids **honestly against the finite set of known rules**, and grandfather only the strands that are provably unrecoverable.

### 7.1 Try known rules (both `verify` and the §4.4 guard)

When checking a **v1** strand (`schemaVersion < 2`), a strand passes integrity if its stored `pickId` is reproduced by **either** known historical rule:

1. **whole-body rule** (pre-`59c138f7`): `pick:v0:` + sha256 over `canonicalSerialize(canonicalSafe(body-including-calibratedConfidence-and-binding-and-merge))`.
2. **current-exclusion rule** (the §1.4 v1 path): `pick:v0:` + sha256 over the body with `calibratedConfidence`/`binding`/`merge` excluded.

Accept on the first match. This re-verifies seq 0 (whole-body) and seq 8–14 (exclusion) with no marker. v2 strands use only the §1.4 v2 rule.

### 7.2 The grandfathered set (the graded-over residue)

Strands that reproduce under **no** known rule — solely because `#grade` overwrote their hashed `calibratedConfidence` (seq 1–7 today) — are recorded once in **`.warpline/fabric-legacy.json`** as an explicit set **keyed by exact stored pickId** (NOT a seq threshold — a threshold would silently grandfather future strands):

```jsonc
{
  "reason": "TD-2026-07-01-202: sealed under the whole-body rule, then calibratedConfidence overwritten in place by #grade (0e3d3d57) before the exclusion rule + rewriteFabric guard existed. Hashed byte destroyed; unrecoverable.",
  "grandfathered": ["pick:v0:<seq1>", "pick:v0:<seq2>", "…", "pick:v0:<seq7>"]
}
```

Builder generates this file once by enumerating the real fabric: any strand whose stored pickId reproduces under neither §7.1 rule AND whose `calibratedConfidence != null` (i.e., was graded). Assert the resulting set is exactly seq 1–7 before writing (guard against accidentally grandfathering a genuinely-tampered strand).

### 7.3 Classification

- Reproduces under a known rule → **OK**.
- No rule reproduces, pickId ∈ grandfathered set → **`legacy-unverifiable`** (soft; counted in the report; does **not** set a non-zero exit).
- No rule reproduces, pickId ∉ grandfathered set → **`pickId-mismatch`** (hard; real tamper; non-zero exit). This is how a future forgery still surfaces.

### 7.4 The §4.4 guard must skip the grandfathered set

`rewriteFabric` runs over the WHOLE ledger (grade's `applyGrades` passes all strands), so the §4.4 identity guard would otherwise throw on seq 1–7 and break `grade` on the real fabric. The guard must: for each strand, pass if it reproduces under a known rule (§7.1) **or** its pickId is grandfathered (§7.2); throw only otherwise. `calibratedConfidence` remains the sole rewritable field for all non-grandfathered strands.

### 7.5 Report + test deltas

- `FabricVerifyReport` (§4.2) gains `legacyUnverifiable: { count, pickIds }`; `v1Prefix.selfHashOk` becomes true when every v1 strand is either rule-verified or grandfathered.
- **§6.1 regression** targets a **current-rule** strand (seq 8+), not seq 0.
- **§6.5 migration test** asserts, over the real fixture: seq 0 + seq 8–14 verify via known rules, seq 1–7 classify `legacy-unverifiable`, the first v2 strand's `parentPickId` == the stored tip pickId, `boundaryAnchored:true`, and overall **exit 0**.
- **New** `fabric-legacy.test.ts`: a tampered non-grandfathered strand → `pickId-mismatch` (hard); a grandfathered strand → `legacy-unverifiable` (soft); `grade` → `rewriteFabric` succeeds over the real fabric (guard skips grandfathered).

---

**Files the Builder will touch:** `packages/warpline/src/fabric/strand.ts` (interface + `computePickId` + `MergeRecipe.algo`), `.../fabric/seal.ts` (`SealInput` + body), `.../fabric/pick.ts` (`RecordPickOptions` + seal call + T-029 fail-closed), `.../fabric/admit.ts` (3 seal calls + `mergeParentPickId`), `.../fabric/fabric.ts` (`rewriteFabric` guard), `.../warp/snapshot.ts` (`captureMerge` algo tag), new `.../fabric/verify.ts`, `.../cli.ts` (new `fabric verify` group), and the six test files in §6.
