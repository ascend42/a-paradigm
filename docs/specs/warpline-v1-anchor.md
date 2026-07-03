# Warpline v1-Prefix Attestation Anchor — freeze, attest-once, verify-against-chain

**Task:** T-2026-07-03-003 (Stream B, Artifact 1) · **Closes:** T-2026-07-02-003 (HIGH-A), T-2026-07-02-004 (HIGH-B), MED-C of T-2026-07-02-005
**Author:** Arky (architect) · **Status:** spec, ready-to-implement (Kit builds verbatim)
**Precondition:** the M2 trust-floor bundle (schema-v2 chain, body-pinned grandfather manifest, verified object reads, lock owner token) is landed on `warpline-surfaces`.
**Reads with:** `docs/specs/warpline-fabric-schema-v2.md` §7 + both amendments (2026-07-01, 2026-07-02). This spec implements the "proposed fix" named at the end of the 2026-07-02 scope correction.

---

## 0. Problem statement (from the live exploits)

The v2 chain is authenticated; the v1 prefix is not. Two exploits were reproduced live:

- **HIGH-A:** `binding` is outside both the v1 pickId rule (`strand.ts:162`) and `computeLegacyBodyHash` (`strand.ts:205`), so an attacker stamps a forged binding onto any v1 strand via `rewriteFabric`, `fabric verify` exits 0, and `restore` materializes attacker bytes.
- **HIGH-B:** `fabric-legacy.json` has no integrity of its own (`fabric.ts:43-68`) — co-tamper a grandfathered strand's body AND its pinned `bodyHash` (public code) → exit 0. Judge's mint variant: add a `{pickId, bodyHash(tampered)}` entry for a real v1 strand → soft pass, count 7→8.
- **MED-C:** any non-tip v1 strand's whole body is forgeable by recomputing its `pick:v0` self-hash (`strand.ts:217-222`); only the v1 tip is anchored (the first v2 strand's `parentPickId`).

**Root cause (single):** the v1 prefix is anchored only at its tip; its bodies, bindings, and the grandfather manifest are all outside every authenticated hash.

**The fix:** digest the ENTIRE v1 prefix (full strand bodies, bindings included) + the grandfather manifest into ONE attestation, seal that attestation as a chained v2 strand (so it is inside the authenticated chain), and make `verify` authenticate the prefix against the chain instead of against per-strand self-hashes. Then FREEZE v1 forever.

## 1. The four hard constraints (Aegis's acceptance conditions — not suggestions)

| # | Constraint | Where enforced in this spec |
|---|---|---|
| (a) | **Freeze semantics.** `objects backfill` on v1 strands runs FIRST; attestation happens ONCE; then `rewriteFabric` refuses ALL v1 mutation including binding stamps. NO re-attestation verb exists, ever (a re-attest path = tamper-then-re-attest). | §4 (backfill), §5 (attest-once), §7 (freeze guard) |
| (b) | **Trust-on-first-attest.** The attested state is corroborated against the git history of `.warpline/fabric.jsonl` (git-tracked — real external corroboration during coexistence); the corroborating git commit hash is recorded IN the attestation strand's intent/payload. | §3 (`corroboration` field), §5 step 3 |
| (c) | **No downgrade.** Once the anchor ships, `verify` HARD-FAILS any fabric whose v1 strands lack coverage (deleting the attestation = chain break AND `anchor-missing`); `restore` of any v1 selector refuses until attested. | §6 (verify walk), §8 (restore gate) |
| (d) | **Residual stated honestly.** Whole-fabric re-chain by an in-loop writer remains possible (R1 — no secret in the chain). Post-anchor claim is exactly "tamper-evident against anything short of full re-chain," never "trustworthy." | §10 |

## 2. Design decision: the attestation is a normal v2 strand with an `attests` payload

No new record type, no sidecar, no signature. The attestation is a **v2 strand** sealed by `sealState` like any other, carrying one new optional field:

- It is **chained**: its `parentPickId` is the tip, and every later strand chains over it — deleting or editing it breaks the v2 chain (constraint c).
- Its payload is **inside its pickId with zero change to `computePickId`**: the v2 path (`strand.ts:170-179`) destructures `{calibratedConfidence, binding, merge, authoredBy, ...rest}` and spreads `...rest` into the preimage — an `attests` field on the body rides into the hash exactly like `resolves` does. `canonicalSafe` (`strand.ts:134-143`) already handles nested objects/arrays.
- It is a **meaning no-op**: `stateId === parentStateId` (the selvage does not move), `delta` empty, `binding` copied from the tip strand so `state:`/`HEAD` selector resolution through it stays restorable (select.ts resolves highest-seq for a stateId).

## 3. Schema — the `attests` block

Add to `Strand` (`packages/warpline/src/fabric/strand.ts`, interface at :71):

```ts
/**
 * Present only on an ANCHOR strand: a chained attestation over an earlier,
 * weaker-authenticated segment of the fabric. IN the v2 pickId (rides via the
 * preimage spread), so the attestation is itself chain-protected. kind/epoch are
 * generalized so the v2→v3 epoch boundary can reuse this shape (see
 * docs/specs/warpline-v3-identity.md §5).
 */
attests?: {
  kind: 'epoch-anchor';
  version: 1;                    // attestation FORMAT version
  epoch: 'v1';                   // the segment being attested (v3 genesis will use 'v2')
  prefixCount: number;           // number of strands covered (== count of ALL v1 strands)
  prefixTipPickId: string;       // stored pickId of the last covered strand (redundant corroboration)
  prefixDigest: string;          // sha256:… — §3.1 fold over the covered strands
  manifestDigest: string | null; // sha256:… over the canonical fabric-legacy.json (null iff no manifest)
  grandfatheredCount: number;    // pins manifest cardinality (kills Judge's mint variant)
  corroboration: {
    method: 'git-history-prefix-match';
    gitCommit: string;           // the commit whose committed fabric.jsonl v1 prefix matched byte-for-meaning (§5.3)
  };
};
```

### 3.1 Digest construction (deterministic, exact)

All hashing uses the existing canonical serializer (`canonicalSerialize(canonicalSafe(x))`, same as every other Warpline address — codepoint-sorted keys, NFC strings, null→`""`). Never hash raw file bytes (whitespace/key-order fragility); always hash the canonicalized parsed value.

**Per-strand digest** — over the FULL stored strand, INCLUDING `pickId`, `calibratedConfidence`, `binding`, and `merge` (nothing on a v1 strand is mutable after the freeze, so nothing is excluded):

```
strandDigest(s) = sha256( canonicalSerialize(canonicalSafe(s)) )        // s = the whole Strand object
```

**Prefix digest** — domain-separated, length-prefixed, seq order 0..N-1:

```
prefixDigest = "sha256:" + hex( sha256(
  "warpline-epoch-anchor:v1\n" + N + "\n" + hex(strandDigest(s_0)) + "\n" + … + hex(strandDigest(s_{N-1})) + "\n"
) )
```

where N = `prefixCount` = the number of v1 strands. Folding stored `pickId`s into each `strandDigest` means the digest commits to the ids as written, so a body-rewrite-plus-self-hash-recompute (MED-C) changes the digest even though the strand stays "self-consistent."

**Manifest digest** — over the canonicalized PARSED `FabricLegacy` object (`fabric.ts:30-33`), reason string included:

```
manifestDigest = "sha256:" + hex( sha256( canonicalSerialize(canonicalSafe(parsedFabricLegacy)) ) )
```

`grandfatheredCount = parsedFabricLegacy.grandfathered.length` is pinned separately as a cheap human-legible invariant (and so a verify failure can say "count moved 7→8" without digest archaeology).

**New module:** `packages/warpline/src/fabric/anchor.ts` exporting `computePrefixDigest(strands: Strand[])`, `computeManifestDigest(legacy: FabricLegacy | null)`, `findAnchor(fabric: Strand[], epoch: 'v1' | 'v2'): Strand | undefined`, and `assertV1Covered(wdir, fabric, legacy)` (§8). Shared by attest / verify / rewriteFabric / select.

## 4. Step 0 — `objects backfill` (runs FIRST; must exist before attest)

`objects backfill` is referenced (`select.ts:110`) but **not yet implemented**. It must land as part of this work, because after attestation v1 bindings are frozen forever — whatever bindings the v1 prefix will EVER have must exist before the anchor is sealed.

**New verb:** `warpline objects backfill` (CLI group at `cli.ts:532`), implementation in `packages/warpline/src/fabric/backfill.ts`:

1. Read the fabric; select v1 strands (`schemaVersion < 2`) with no `binding`. (Today: seq 0–12; seq 13–14 were bind-on-seal.)
2. For each, `snapshotRef(store, strand.provenance.gitCommit)` (`snapshot.ts:154` — already exists and honors the always-ignores) → root `treeId`.
3. Stamp `binding: { treeId, gitOid: null }` via `rewriteFabric` under `withFabricLock`. `gitOid: null` deliberately (merge-result precedent, `admit.ts:271`): per MED-E the gitOid↔treeSha check is vacuous for self-produced values, and a backfilled native tree is ignore-filtered so it does NOT equal the git tree sha — storing the git sha there would be a lie.
4. A strand whose `provenance.gitCommit` is null or unreachable stays **unbound forever** (frozen unbound; `restore` of it refuses permanently with the existing A4 message). Report these loudly.
5. **Refuse to run if an anchor already exists** (`findAnchor` non-empty) — backfill is a pre-attestation verb only. Error message: "v1 prefix is attested and frozen; backfill is permanently closed."

Note the ordering subtlety this spec resolves: `rewriteFabric`'s freeze guard (§7) keys off "an anchor exists in the on-disk fabric," so backfill's stamps are legal before attestation and impossible after — the same one-way gate, checked in one place.

## 5. Step 1 — `warpline fabric attest` (the ONE-TIME verb)

**New verb:** `warpline fabric attest`, implementation in `anchor.ts`, sealing under `withFabricLock`. There is **no `--force`, no `--re-attest`, no repair verb.** If the anchor is ever wrong, the remediation is human + git archaeology, not a CLI path an in-loop attacker can drive.

Sequence (all-or-nothing; any failure → no strand sealed):

1. **Refuse if a v1-epoch anchor exists.** `findAnchor(fabric, 'v1')` non-empty → hard error. This is constraint (a): attestation happens once per epoch. (A fabric with two v1 anchors is a verify failure too — §6.)
2. **Precondition verify.** Run the `verifyFabric` checks over the fabric WITH the anchor-coverage requirement suppressed (`anchor-missing` is the expected state here — attest is the one verb that operates on an uncovered fabric; every OTHER check applies); any HARD failure → refuse ("attest would notarize a tampered prefix"). Soft `legacy-unverifiable` entries are expected (seq 1–7). Additionally require: every v1 strand is bound OR explicitly acknowledged via `--allow-unbound` (prints the permanently-unrestorable seqs); the manifest parses and passes membership sanity; all v1 strands are contiguous at the head (seqs `0..N-1`) — a v1 strand after a v2 strand is un-attestable, refuse.
3. **Corroborate against git (constraint b).** Walk `git log --format=%H -- .warpline/fabric.jsonl` newest-first. For each commit C, read `git show C:.warpline/fabric.jsonl`, parse its first N lines, and compare `strandDigest` strand-for-strand against the working v1 prefix; also read `git show C:.warpline/fabric-legacy.json` and compare `manifestDigest`. The first C where BOTH match is the corroborating commit. No commit matches → **refuse** (no override): during coexistence the fabric is git-tracked by construction, so a no-match means the working prefix diverged from every state git ever saw — exactly the situation attest must not notarize. Record C in `attests.corroboration.gitCommit`.
4. **Build the payload** (§3.1 digests over the working prefix + manifest) and **seal**: a normal `sealState` call with `parentStateId = selvage`, `state` = the tip strand's state re-loaded (stateId unchanged), `intent = "anchor(epoch:v1): attest ${N}-strand v1 prefix + legacy manifest (${grandfatheredCount} grandfathered); corroborated at git ${C}"`, `authoredBy.agentId` = the invoking agent or null, `binding` = tip strand's binding, and the `attests` block. `SealInput` (`seal.ts:44-67`) gains `attests?: …`, spread into the body like `resolves` (`seal.ts:104`).

For THIS repo, N = 15 (seq 0–14), grandfathered = 7 (seq 1–7), manifest already body-pinned. The anchor seals at the current tip (seq 22+ by build time — the fabric grows; the anchor does NOT need to sit at the v1/v2 boundary, it only needs to be in the chain).

## 6. `verify` — the new walk (changes to `packages/warpline/src/fabric/verify.ts`)

New `FabricVerifyKind` values: `anchor-missing`, `anchor-mismatch`, `anchor-manifest-mismatch`, `anchor-duplicate`, `anchor-malformed`, `v1-out-of-prefix`. New report field: `anchor: { present: boolean; ok: boolean; corroboration?: string }`.

After the existing per-strand loop (which stays — defense in depth):

1. **Coverage requirement (constraint c, code-level not disk-level):** if the fabric contains ANY `schemaVersion < 2` strand and `findAnchor` returns nothing → HARD `anchor-missing`. This requirement is a **code constant** shipped with the anchor release — not a marker file an attacker can delete, not on-disk state. (Bootstrap window: between building this release and running `fabric attest`, verify on this repo exits 1 with "run `warpline objects backfill` then `warpline fabric attest`" — that is the forced migration, and it is one command wide. Fresh repos have no v1 strands and need no anchor.)
2. **Exactly one anchor per epoch:** two or more strands with `attests.epoch === 'v1'` → HARD `anchor-duplicate` on every one after the first. (A second v1 anchor cannot be sealed by the CLI — §5.1 — so its existence is forgery or a bug. Uniqueness is per-`epoch`, not global: the v3 genesis will carry a distinct `epoch: 'v2'` anchor — warpline-v3-identity.md §5.)
3. **Shape:** `attests.kind/version/epoch` recognized; `prefixCount` equals the total v1 strand count; all v1 strands occupy seqs `0..prefixCount-1` (any v1 strand elsewhere → HARD `v1-out-of-prefix` — this also kills the "append a fresh self-consistent v1 strand at the tip" variant); `prefixTipPickId` equals strand `prefixCount-1`'s stored pickId; the anchor strand itself is v2 and its seq > every covered seq. Violations → HARD `anchor-malformed`.
4. **Prefix digest:** recompute §3.1 `prefixDigest` over strands `0..prefixCount-1` as stored on disk; mismatch → HARD `anchor-mismatch` ("the v1 prefix does not match its chained attestation — some v1 body, binding, or id was rewritten"). This single check is what flips HIGH-A, HIGH-B co-tamper, and MED-C to exit 1.
5. **Manifest digest + cardinality:** recompute `manifestDigest` over the parsed on-disk `fabric-legacy.json` and compare; compare `grandfatheredCount` to the parsed length; a missing manifest when `manifestDigest != null` (or vice versa) fails. Mismatch → HARD `anchor-manifest-mismatch`.
6. **Existing checks keep their roles.** Per-strand self-hash/grandfather classification is unchanged (soft `legacy-unverifiable` stays soft — the anchor now pins those bodies, so soft is finally honest). The v2 chain walk already authenticates the anchor strand itself (its pickId folds the `attests` payload; every later strand chains over it).
7. **Selvage cross-check (cheap hardening, included):** `readSelvage(wdir)` must equal the tip strand's `stateId`; mismatch → HARD failure (kind `chain-break`, detail "selvage does not point at the fabric tip"). Not an anchor concern per se, but the truncation analysis (§10) is dishonest without naming that today verify never looks at the selvage.

CLI output (`cli.ts` fabric verify action) adds one line: `anchor     epoch:v1 ✓ (corroborated at git <12-hex>)` or the failure.

## 7. The freeze — `rewriteFabric` refuses ALL v1 mutation post-anchor

In `rewriteFabric` (`fabric.ts:166`), after the existing identity guard and BEFORE the CAS, using the `onDisk` ledger it already reads at `fabric.ts:200`:

```
const anchor = findAnchor(onDisk);            // frozen iff the ON-DISK fabric is attested
if (anchor) {
  for (i in 0..anchor.attests.prefixCount-1) {
    if (strandDigest(strands[i]) !== strandDigest(onDisk[i]))
      throw "warpline: rewriteFabric refused — v1 strand seq i is FROZEN by the epoch anchor
             (pick <anchorPickId>); the v1 prefix is immutable: no grading, no binding stamps,
             no repair. (T-2026-07-03 v1-anchor freeze)";
  }
}
```

Byte-level (full-strand canonical digest, `calibratedConfidence` and `binding` included) — not rule-based. Consequences, all intended:

- **Binding stamps on v1: refused** (closes the HIGH-A write path at the writer, not just at verify).
- **Grading v1 strands: refused.** `applyGrades` (`grade.ts:136-153`) must skip `schemaVersion < 2` strands when an anchor exists — their in-strand `calibratedConfidence` is frozen at attested values (0.8/0.8/0.8/0.8/0.68/0.7/0.7 for seq 1–7; null for 0, 8–14). Grade **events** still append to `grades.jsonl` (`appendGradeEvent`, `fabric.ts:216`) for every strand including v1 — the calibration trajectory lives in the sidecar, the ledger byte does not move. (This deliberately fronruns the v3 R4 position — see warpline-v3-identity.md §7 — v1 is simply the first segment to get the sidecar-only treatment.)
- Pass-through of UNCHANGED v1 strands (grade runs, future annotation passes over v2) is legal — the digest comparison refuses mutations, not reads.
- The grandfather branch of the identity guard (`fabric.ts:180-187`) is now unreachable for mutations post-anchor (frozen check fires first for v1) but stays for the pre-anchor window and as belt-and-braces.

## 8. The restore gate — v1 selectors refuse until attested

`resolveSelector` (`select.ts:90`): when the resolved strand has `schemaVersion < 2`, call `assertV1Covered(wdir, fabric, legacy)` — a **cheap** check (no object walks): anchor present, exactly one, shape ok, `prefixDigest` recomputes, `manifestDigest` recomputes. On failure:

```
warpline: refusing to restore a v1 strand — the v1 prefix is not (validly) attested.
v1 bindings are unauthenticated without the epoch anchor (HIGH-A). Run
`warpline objects backfill` then `warpline fabric attest`, or restore a v2 selector.
```

Direct `tree:<id>` selectors are untouched (the caller named bytes explicitly; no strand trust is implied). v2 selectors are untouched (chain-authenticated). Cost: ~22 strand digests per restore of a v1 selector — negligible; do NOT cache across processes (a cache file would be attacker-writable state).

## 9. Migration / ops sequence for THIS repo (the real fabric: 22 strands today, 15 v1, 7 grandfathered)

Run in order, on `warpline-surfaces`, after Kit's build + tests are green:

1. `npm run build` (packages/warpline) — the release that hard-requires coverage. From this instant, `fabric verify` on this repo exits 1 (`anchor-missing`) — expected, the forced-migration window.
2. `warpline objects backfill` — stamps native bindings on seq 0–12 from their `provenance.gitCommit` trees (all 13 are reachable in this repo's git). Verify still exits 1 (`anchor-missing`), but `objects verify` and the binding walks pass.
3. `git add .warpline/fabric.jsonl && git commit` — commit the backfilled prefix, so step 4's corroboration can match a committed state INCLUDING the new bindings. (Corroboration compares full-strand digests; an uncommitted binding stamp would make every historical commit a non-match.)
4. `warpline fabric attest` — corroborates against the step-3 commit (newest-first walk finds it immediately), seals the anchor strand, prints its pickId + corroborating commit.
5. `warpline fabric verify` — expect exit 0: `anchor epoch:v1 ✓`, `v1Prefix 15 (self-hash ok)`, `legacyUnverifiable 7`, chain ok, boundary anchored.
6. Re-run the two live exploits (§11 T-1/T-2) as a manual smoke on a COPY of the repo — both must exit 1.
7. Commit fabric + lore; the anchor strand is now itself git-corroborated going forward.

Ordering trap, named: steps 2→3→4 must not be reordered. Attest-before-backfill freezes seq 0–12 unbound forever (restore of them refuses permanently); backfill-without-commit makes corroboration fail (correctly).

## 10. Residual threat model — stated honestly (constraint d)

**The post-anchor claim is exactly: "the fabric is tamper-evident against anything short of a full re-chain." It is NOT "trustworthy."**

Still possible, by design or out of scope:

- **R1 — full re-chain.** An in-loop writer with filesystem access can rewrite the entire fabric — every v2 pickId, the anchor and its digests, the manifest, the selvage — because there is no secret and no signature in the chain. The anchor raises the price of v1 tamper from "edit one line" to "re-chain everything and defeat git corroboration too," nothing more. Signatures are M3.
- **Rollback/truncation.** Truncating the fabric to any prefix that still contains the anchor, plus rolling back the selvage, is internally consistent and undetectable from `.warpline/` alone. External head references (the git-tracked `fabric.jsonl` + `refs/selvage`) are the corroboration; verify does not and cannot check "is this the newest history" from inside.
- **Corroboration is trust-on-first-attest, not proof.** Step 5.3 corroborates against git history *as it exists at attest time*. An attacker who controlled BOTH `.warpline/` and the git history before attest ran gets their forgery notarized. The claim is only: the attested state matched an independently-tracked store at a named commit, recorded in-chain.
- **MED-D untouched.** Merge-recipe inputs (`merge.{base,ours,theirs}`) remain excluded from the v2 pickId and are not re-derived (`verify.ts:222-243` proves existence + `result==binding.treeId` only) — a merge strand's claimed inputs are still rewritable post-seal on v2 strands. Separate fix; tracked in T-2026-07-02-005(D).
- **`authoredBy.agentId` is unsigned.** Attribution is folded into the hash but any writer can claim any agentId at seal time. M3.
- **MED-E untouched.** The gitOid↔treeSha step-4 check remains vacuous for self-produced strands; backfilled bindings sidestep it with `gitOid: null` rather than fixing it.

## 11. Test plan (`packages/warpline/test/`)

New file `fabric-anchor.test.ts` (+ small extensions noted). Fixtures: a builder that seals a synthetic v1 prefix (both hashing eras + a grandfathered graded-over strand) then v2 strands — reuse the fabric-schema-migration fixture machinery.

**Exploit reproductions (must flip to exit 1):**
- **T-1 (HIGH-A rerun):** attested fixture → inject `binding: {treeId: attackerTree}` onto v1 seq 8 by rewriting the line → `verifyFabric` reports `anchor-mismatch`, exit 1; `resolveSelector('8')` refuses. Also assert the WRITE path: `rewriteFabric` with the same mutation throws the §7 freeze error.
- **T-2 (HIGH-B rerun):** attested fixture → rewrite grandfathered strand's `intent`, recompute `computeLegacyBodyHash`, overwrite the manifest entry's `bodyHash` → `anchor-manifest-mismatch` (manifest digest moved) AND `anchor-mismatch` (strand digest moved), exit 1.
- **T-3 (Judge's mint):** add a `{pickId, bodyHash}` entry for a real v1 strand → `anchor-manifest-mismatch` + `grandfatheredCount` 7→8 named in the detail, exit 1.
- **T-4 (MED-C):** rewrite a non-tip v1 strand's body AND recompute its `pick:v0` self-hash (self-consistent forgery) → `anchor-mismatch`, exit 1.
- **T-5 (v1 tip-append variant):** append a fresh, fully self-consistent v1 strand after the v2 tip + move the selvage → `v1-out-of-prefix` (+ selvage/chain findings), exit 1.

**Freeze + attest-once:**
- **T-6:** post-anchor `rewriteFabric` refuses a v1 binding stamp and a v1 `calibratedConfidence` change; accepts a v2 `calibratedConfidence` change; pass-through of unchanged v1 strands succeeds.
- **T-7:** `applyGrades` over an attested fabric mutates only v2 strands; grade events for v1 strands still land in `grades.jsonl`.
- **T-8:** `fabric attest` on an already-attested fabric refuses; hand-crafting a second anchor strand → `anchor-duplicate`, exit 1. `objects backfill` post-anchor refuses.
- **T-9 (no-downgrade):** delete the anchor strand line (re-chaining the remainder is R1 and out of scope — delete WITHOUT re-chain) → `chain-break` + `anchor-missing`, exit 1. Delete the anchor and everything after it + roll back the selvage → `anchor-missing`, exit 1.
- **T-10 (bootstrap):** un-attested fabric WITH v1 strands → `anchor-missing`, exit 1, and `resolveSelector` on a v1 seq refuses; pure-v2 fabric (no v1 strands) → no anchor required, exit 0.

**Attest correctness:**
- **T-11:** attest refuses when the working prefix matches no committed state (corroboration failure — mutate one v1 byte after the last commit in a scratch git repo); succeeds after committing; the sealed strand's `corroboration.gitCommit` equals the matching commit; `attests` payload round-trips through `computePickId` (mutating any digest field changes the anchor's pickId → chain-break downstream).
- **T-12 (migration rehearsal, real-fixture):** over a copy of THIS repo's 22-strand fabric + manifest (checked-in fixture), run backfill → attest (against a scratch git history containing the fixture) → verify exit 0 with `v1Prefix.count 15`, `legacyUnverifiable.count 7`, `anchor.ok true`.

## 12. Files Kit touches

`packages/warpline/src/fabric/strand.ts` (Strand.attests field + doc row), `.../fabric/anchor.ts` (NEW — digests, findAnchor, assertV1Covered, attest), `.../fabric/backfill.ts` (NEW — objects backfill), `.../fabric/verify.ts` (§6 walk + report fields + kinds), `.../fabric/fabric.ts` (§7 freeze in rewriteFabric), `.../fabric/grade.ts` (skip frozen v1 in applyGrades), `.../fabric/select.ts` (§8 gate), `.../fabric/seal.ts` (SealInput.attests), `.../cli.ts` (`objects backfill`, `fabric attest`, verify output line), `packages/warpline/.purpose` (register #anchor, #backfill; note the freeze on #fabric), tests per §11. Spec docs: this file; the schema-v2 spec gains a one-line pointer amendment ("v1 prefix authentication: superseded by warpline-v1-anchor.md").
