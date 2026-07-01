# Warpline Native Object Store — M1 Design Spec

**Task:** T-2026-07-01-008 (epic T-2026-07-01-007) · **Decision:** TD-2026-07-01-263
**Author:** Arky (Warpline system architect) · **Status:** design, spec-only (no source changes)
**Milestone:** M1 — *Warpline OWNS the bytes and can reconstruct a working tree with git ABSENT.*

---

## 0. Problem statement (grounded in the code, not prose)

Today Warpline is **meaning-authoritative** but **byte-dependent on git**:

- `WarpObject` (`src/warp/warp-object.ts`) deliberately **drops path/position/bytes** — it is
  `⟨kind, contract, sorted edges, contentId⟩`. `contentId = essence:v0:sha256(canonicalCNF)`
  (`src/warp/essence-hash.ts`). The dropping *is* the thesis.
- `WarpState` (`src/warp/warp-state.ts`) = `stateId = state:v0:sha256(sorted contentIds)`. `treeSha`
  and `absorbedAt` are **provenance, not identity**.
- `WarpStore` (`src/warp/store.ts`) is a content-addressed store of **meaning objects and states
  only** — an in-memory `Map` plus a regenerable JSON disk cache under `.warpline/{warp/objects,states}/`.
  There is **no blob store, no tree store, no checkout.**
- Bytes come **exclusively from git**: `absorb()` (`src/absorb.ts`) runs `materializeTree()` = `git
  archive | tar` into a temp dir; `computeMerge()` (`src/fabric/materialize.ts`) reads bytes via
  `gitShowBuffer()`/`treeEntryMode()`/`changedPaths()` (`src/git/git-exec.ts`).
- Merges Warpline **performs are thrown away**: `admit()` CLEAN path (`src/fabric/admit.ts`)
  materializes the merged tree to a temp dir, absorbs the *meaning*, then `releaseTree()` **deletes
  the bytes**. The strand records `provenance.gitCommit = oursCommit` — **one parent, not the merged
  bytes** — and sets `merged: true`. The **H1 guard** (`admit.ts` line ~230) then *fails closed* on
  any later merge that would re-base off a merged strand, precisely because the merged bytes don't
  exist anywhere.
- `.gitignore` (lines 191–199) tracks **only** `.warpline/fabric.jsonl` + `.warpline/refs/selvage`;
  everything else under `.warpline/` is ignored as **regenerable from each strand's
  `provenance.gitCommit`.** That regenerability assumption is exactly what dies when git dies.

**M1 goal:** give Warpline a **byte home** it owns, bind it to the meaning layer without disturbing
identity rules, make merges durable, and prove `rm -rf .git && warpline restore <state>` reproduces
the exact tree.

**Non-goals (seams only):** cryptographic hash-chain + signatures (M3), pack/delta compression
(post-M1), write-side authoring (Warpline B).

---

## 1. Object model

Warpline gains **two owned object kinds** — `blob` (bytes) and `tree` (a directory manifest) —
mirroring git's *conceptual* model while **diverging on the wire format and hash**. The existing
meaning objects (`essence:` / `state:`) are unchanged and untouched.

### 1.1 Blob

A blob is the **raw, untransformed bytes** of one file. No line-ending conversion, no clean/smudge
filter, no `export-subst` — byte-authoritative means *the bytes*, full stop (see §1.5 on why we snapshot
from `git cat-file blob`, not from the `git archive` tar).

```
blobId = "blob:v1:" + sha256( "blob " + <byteLength-in-ascii-decimal> + "\0" + <raw bytes> )
```

- The `"blob " + len + "\0"` framing is git's object-header idea, kept for **domain separation**
  (a blob and a tree of the same bytes can never collide) and because it lets us compute a
  **shadow git-sha1 OID** cheaply for coexistence cross-checks (§2.4).
- **sha256, not sha1** — justified in §1.4.

### 1.2 Tree

A tree is a **sorted manifest of one directory**. Each entry:

| field  | value |
|--------|-------|
| `mode` | git tree-entry mode string: `100644` (regular), `100755` (executable), `120000` (symlink), `160000` (gitlink/submodule), `40000` (subtree/directory) |
| `name` | the single path component (NFC-normalized, never a `/`-joined path) |
| `id`   | `blobId` for `100644/100755/120000`; child `treeId` for `40000`; the raw **commit sha** for `160000` (a gitlink carries no bytes — a pointer only) |

- **Symlink (`120000`)**: the blob's bytes ARE the link target path (git's own convention). Restore
  calls `symlink(target, path)`, never writes a regular file — byte/type faithful.
- **Gitlink (`160000`)**: no blob. The entry stores the submodule commit sha as `id`. Restore writes
  nothing (or an empty dir); this matches the merge layer's `NON_BLOB_MODES` fail-closed stance
  (`materialize.ts` line 48) — we **represent** it losslessly but never fabricate bytes for it.

Canonical serialization (deterministic — the whole point):

```
tree bytes = concat, for each entry in TREE-ORDER:
             <mode> " " <name> "\0" <id-as-bytes>
treeId     = "tree:v1:" + sha256( "tree " + <len> + "\0" + <tree bytes> )
```

**TREE-ORDER** is git's exact tree-entry sort: compare `name` bytes, but a `40000` (directory) entry
sorts *as if its name had a trailing `/`*. This is nailed with a dedicated test vector so a directory
`src` vs a file `src.ts` order deterministically. (Reproducing git's order also keeps the shadow-OID
cross-check in §2.4 exact.)

### 1.3 A full source tree

The classic Merkle DAG: a **root tree** references sub-trees and blobs recursively. `treeId` is the
byte identity of an entire working tree. Two byte-identical trees ⇒ identical `treeId`; any byte
change anywhere ripples the root `treeId` (Merkle). Empty directories are **not** representable (git
parity; tar/`loadLiveGraph` already ignore them — documented limitation, §7).

### 1.4 Hash choice — sha256, and why we diverge from git

We **mimic git's object *model*** (blob/tree/mode/tree-order) but **diverge on hash + on-wire id**:

- **One hash across the whole system.** `essence-hash.ts`, `warp-state.ts`, `strand.ts` all use
  **sha256**. Introducing git's default **sha1** for bytes would mean two algorithms, two collision
  stories, and a byte layer weaker than the meaning layer. Unacceptable for a system whose pitch is
  *accountability-native*.
- **Not bound to git's legacy.** git-sha1 is being retired; git-sha256 repos exist but aren't
  universal. Owning the format frees the meaning↔bytes binding (§3, §6) from git's transition.
- **Byte-faithfulness is preserved regardless of hash** — parity with the merge hardening (binary
  via NUL, `100755` exec bit, `120000` symlink, `160000` gitlink, rename decomposition) is a
  property of *what we store* (raw bytes + git mode strings), not of the hash algorithm. We inherit
  that parity by reusing the same mode vocabulary the merge layer already speaks.

**Tradeoff, stated honestly:** a sha256 warpline object is **not** `git cat-file`-able, so we lose
free git tooling on our store. We buy that back with the **shadow git-sha1 OID** (§2.4) computed
*during coexistence only*, which lets backfill prove `treeId ⇄ strand.provenance.treeSha`
byte-for-byte, then is dropped at cutover. This is the balanced-risk call: git-model familiarity and
verifiability **without** inheriting git's hash.

### 1.5 Byte source — `git cat-file`, not `git archive`

`materializeTree()` uses `git archive | tar`, which applies `export-subst`/`export-ignore`/eol
attributes — so archive bytes can differ from the true blob bytes. For **authoritative** byte
capture we snapshot **per-path raw blob bytes** (`git cat-file blob <ref>:<path>`, same raw path
`gitShowBuffer` already uses) for real refs, and **as-on-disk bytes** for `WORKTREE`. This is the one
place we must *not* reuse the archive path, or "byte-authoritative" would silently mean
"archive-massaged". (Open item OQ-3.)

---

## 2. On-disk layout

### 2.1 Loose objects (M1)

```
.warpline/objects/
  blobs/<aa>/<rest-of-sha256>      # zlib-deflated: "blob " <len> "\0" <raw bytes>
  trees/<aa>/<rest-of-sha256>      # zlib-deflated canonical tree bytes
  pack/                            # RESERVED — packed objects (post-M1, §7 risk)
```

- **Fan-out** by first 2 hex chars of the sha256 (git convention) so a large repo doesn't put
  100k files in one directory.
- **Compression**: zlib deflate (Node `zlib`), like git loose objects. Blobs already binary-safe.
- **Writes** follow `WarpStore`'s disk discipline exactly: write-tmp + atomic `rename`, `.warpline/`
  only, idempotent (content-addressed ⇒ same id ⇒ same bytes ⇒ write is a no-op / safe under the
  existing `#fabric-lock`). Best-effort read; a corrupt/absent loose object surfaces via
  `warpline objects verify`.

### 2.2 Committed-to-git vs regenerable (the coexistence policy)

The store runs in one of two **modes**:

| Mode | git present? | `.warpline/objects/` | restore source | when |
|------|-------------|----------------------|----------------|------|
| **mirror** (default, M1a–M1b) | yes | **gitignored** (regenerable from `provenance.gitCommit`) | store if present, else re-materialize from git | coexistence |
| **authoritative** (M1c cutover) | optional/absent | **committed** (or packed + committed) | store only | git deletable |

- In **mirror** mode we keep `.warpline/objects/` **gitignored** to avoid ~doubling repo size while
  git still holds the delta-packed truth. What newly enters the *tracked* fabric is only the tiny
  `binding.treeId` (a hash) inside `fabric.jsonl` — cheap.
- **Cutover to authoritative** is an explicit step: `warpline objects materialize --all` ensures
  every strand's `binding.treeId` is present as loose (or packed) objects on disk, then the
  `.gitignore` stops ignoring `.warpline/objects/` (or a packfile is committed). Only then is
  `rm -rf .git` safe. The M1c acceptance test performs this step.

### 2.3 Migration / backfill from existing git-anchored strands

`warpline objects backfill`:

1. For each historical strand with `provenance.gitCommit`: snapshot its tree per §1.5
   (`git cat-file` per path from the commit) → write blobs+trees → compute root `treeId`.
2. Stamp `binding.treeId` (+ shadow `gitOid`) onto the strand via `rewriteFabric()`
   (`src/fabric/fabric.ts`) — the **same mechanism `grade` uses** to write annotations without
   moving `pickId` (§3). Requires `#fabric-lock`.
3. Verify: recomputed `gitOid` (shadow sha1, §2.4) **must equal** `provenance.treeSha`, else refuse
   and report the strand — fail closed, never stamp an unverified binding.

Merge strands (`merged: true`) have no single git tree to backfill from — their bytes are
reconstructed by re-running the merge recipe (§5) and are handled by M1b's seal path, not by backfill.

### 2.4 Shadow git OID (coexistence verification only)

During **mirror** mode, `snapshotTree` also computes each object's **git-sha1 OID** (git's exact
blob/tree serialization + sha1). This costs one extra hash and yields `binding.gitOid` = the git tree
sha. Because we reproduce git's tree-order (§1.2), `binding.gitOid` **must equal**
`strand.provenance.treeSha` — a free, total byte-faithfulness proof against git. Dropped at cutover.

---

## 3. The seam to the meaning layer

**A strand gains a byte binding — as an annotation EXCLUDED from `pickId`, exactly like
`calibratedConfidence`.**

```ts
// strand.ts (additive)
interface Strand {
  // …existing fields…
  calibratedConfidence: number | null;   // excluded from pickId (existing)
  binding?: {                            // NEW — the meaning↔bytes seam
    treeId: string;                       // byte identity (native object store)
    gitOid?: string;                      // shadow git-sha1 tree sha (coexistence only)
  } | null;
  merge?: MergeRecipe;                    // NEW — see §5 (merge strands only)
}
```

```ts
// computePickId — EXCLUDE binding + merge alongside calibratedConfidence
export function computePickId(body: StrandBody): string {
  const { calibratedConfidence: _c, binding: _b, merge: _m, ...identity } = body;
  // …unchanged…
}
```

### Why `binding` is excluded from `pickId` (respecting the existing pattern)

- **Meaning is the identity; bytes are one realization.** Two different byte-trees can absorb to the
  **same** `stateId` (a comment/format/path change is meaning-invisible). So byte identity is *not*
  event identity — it belongs with provenance.
- **`treeId` may be backfilled after the fact** (§2.3) onto historical strands. Anything inside
  `pickId` is immutable-after-seal (that's the whole contract of a content-address). `binding` must
  be *mutable-after-seal*, which is **precisely why `calibratedConfidence` is excluded** — same
  reasoning, same mechanism (`rewriteFabric`). We extend the existing precedent rather than invent a
  new rule.

### `stateId` (meaning) and `treeId` (bytes) coexist cleanly

- `stateId` = `state:v0:sha256(sorted contentIds)` — **unchanged**, `computeStateId` untouched.
- `treeId` = `tree:v1:sha256(canonical root tree)` — new, orthogonal.
- Relationship is **many-to-one**: many `treeId`s can share one `stateId` (byte variants of identical
  meaning); one `treeId` maps to exactly one byte-tree. The strand is the join row carrying both.
- `computePickId` / `computeStateId` identity rules are **unaffected** because `binding`/`merge` never
  enter either hash. `provenance.treeSha` (git) stays in `pickId` as before (it's atomic-at-seal, not
  backfilled); `binding.treeId` (native) stays out (it may be backfilled). Documented asymmetry, §7.

**Note:** for *new* strands sealed in M1b+, `treeId` is known at seal time and *could* live inside
`pickId`. We deliberately keep **one uniform rule** — binding always excluded — so backfill, repair,
and re-derivation never fork the identity semantics between "new" and "old" strands.

---

## 4. The restore path

New verb: `warpline restore <selector> [--to <path>] [--force] [--json]`.

```
selector := selvage (default) | <stateId> | <pickId> | seq:<n>
--to      := target dir (default: refuse unless empty/--force; never the cwd tracked tree by accident)
```

### Resolution

1. Resolve `<selector>` → a **strand** (selvage → current tip strand; `stateId` → newest strand on
   that state, or require a `pickId`/`seq:` if ambiguous — a bare `stateId` is many-to-one, §3).
2. Read `strand.binding.treeId`.
   - **authoritative mode** and no binding ⇒ hard error (`no bytes for this state; run backfill`).
   - **mirror mode** and no binding ⇒ fall back to git materialize from `provenance.gitCommit`
     (+ warn), so restore still works before backfill completes.
3. Load the root tree object → walk recursively.

### Materialization (byte-faithful, mirrors `materialize.ts` lines 166–175)

For each entry, write to `--to`:
- `100644`/`100755` → `writeFile(raw Buffer)` then `chmod(0o644 | 0o755)` (never re-encode).
- `120000` → `symlink(<blob-bytes-as-target>, path)`.
- `160000` → skip bytes; record a gitlink note (no fabrication).
- `40000` → `mkdir` + recurse.
Refuse to clobber a non-empty `--to` without `--force`.

### Acceptance test (M1c gate)

```
# in a fixture repo, authoritative mode
warpline pick                       # seal a strand → binding.treeId
warpline objects materialize --all  # ensure bytes on disk (cutover step)
rm -rf .git
warpline restore selvage --to /tmp/out
diff -r /tmp/out <original-tree>     # BYTE-IDENTICAL, git absent
# self-consistency: re-snapshot the result equals the recorded id
[ "$(warpline objects snapshot /tmp/out)" = "<strand.binding.treeId>" ]
```

Two independent proofs: **external** (`diff -r` vs the known tree) and **internal**
(`snapshot(restore(x)) == x.binding.treeId`, the round-trip invariant). While git still exists,
`binding.gitOid == provenance.treeSha` (§2.4) is a **third** proof.

---

## 5. Durable merge bytes (M1b)

Today `materializeMergedState()` builds the merged tree in a temp dir, absorbs meaning, and
`releaseTree()` **destroys the bytes**; the strand records `gitCommit = oursCommit` and `merged:
true`, and the **H1 guard** fails closed on any downstream merge.

**M1b changes:**

1. In `materializeMergedState()`, **before** `releaseTree(tmp)`, call `snapshotTree(tmp)` → the
   merged **`treeId`** (§1.5 byte capture) and write its blobs+trees to the store. Return
   `{ plan, state, treeId, recipe }`.
2. Record a **merge recipe** so the merge is both **recoverable** (bytes) and **re-derivable**
   (recompute + verify):

```ts
interface MergeRecipe {
  algo: 'warpline-merge3-v1';                  // the exact merge algorithm version
  base:   { treeId?: string; gitCommit: string | null };
  ours:   { treeId?: string; gitCommit: string | null };
  theirs: { treeId?: string; gitCommit: string | null };
  resultTreeId: string;                        // == binding.treeId; the recorded outcome
}
```

3. `admit()` CLEAN seal now passes `binding: { treeId }` **and** `merge: recipe` to `sealState`.
   `binding.treeId` — the **actual merged bytes** — **replaces the meaning of `gitCommit =
   oursCommit`** as the authoritative record of what the merge produced. `provenance.gitCommit` stays
   for coexistence attribution, but it is no longer the *only* trace of the merge.
4. **Re-derivability check** (correctness, the VCS cardinal rule): re-running `computeMerge(base,
   ours, theirs)` + `snapshotTree` must reproduce `recipe.resultTreeId`. This turns a merge into a
   *reproducible fact*, not a trusted side effect.
5. **H1 relaxation seam (do not flip in M1b):** once base/theirs bytes are recoverable from their
   own `binding.treeId` (restore-to-temp) rather than from `gitCommit`, the `admit.ts` fail-closed on
   `merged` strands can be lifted — a 3rd-generation merge can re-base off the stored merged bytes.
   M1b **leaves the guard in place** and only records the bytes; flipping it is a follow-up task with
   its own test matrix (noted OQ-5).

Normal (non-merge) picks also get a `binding.treeId`: `pick.ts`/`admit()` FAST_ADMIT snapshot the
absorbed tree (real ref → per-path `git cat-file`; `WORKTREE` → on-disk) so **every** strand carries
byte identity, not just merges.

---

## 6. Integrity hooks for M3 (seams only — not designed here)

Leave the attach points; do not build M3.

- **Hash-chain (event tamper-evidence):** add `parentPickId: string | null` to `StrandBody`
  **inside** `computePickId` (unlike `binding`, a chain link *must* be part of identity). Each strand
  then commits to its predecessor's `pickId` — a linear Merkle chain over the fabric. Seam:
  `StrandBody`, inside the `pickId` hash. (M1 may write the field as informational; M3 enforces.)
- **Signatures:** `sig?: { alg; publicKey; signature }` over `(pickId, binding.treeId)` —
  **excluded** from `pickId` (you cannot sign a hash that contains the signature). Detached, like
  `calibratedConfidence`. Seam: strand field + `computePickId` exclusion list.
- **meaning↔bytes binding:** `binding.treeId` + the per-blob/per-tree OIDs **are** the binding M3
  signs. Signing `(stateId, treeId)` together makes it impossible to swap bytes under a meaning (or
  meaning under bytes) without invalidating the signature. Seam: already present as `binding` (§3).

---

## 7. Implementation plan, module boundaries, risks

### M1a — the object store (pure bytes; no behavior change, nothing seals)

New modules:
- `src/warp/blob.ts` — `blobId(buf)`; header framing; sha256 + shadow sha1.
- `src/warp/tree.ts` — `TreeEntry`, canonical serialization, **TREE-ORDER** sort, `treeId`, walk.
- `src/warp/object-store.ts` — `ObjectStore`: `putBlob/getBlob/putTree/getTree/has/verify`, loose
  fan-out layout, zlib, write-tmp+rename, `.warpline/`-only (mirrors `WarpStore` discipline).
- `src/warp/snapshot.ts` — `snapshotTree(dir | ref)` → root `treeId`, writing all objects; per-path
  `git cat-file` for refs, on-disk bytes for a dir; symlink/exec/gitlink parity.

CLI: `warpline objects verify | snapshot <dir>`. Tests: determinism (same dir → same `treeId` across
runs/machines), round-trip byte-identity, binary/exec/symlink/gitlink parity, TREE-ORDER vectors,
shadow-OID == `git rev-parse <ref>^{tree}`.

### M1b — durable merge bytes + bind on seal

Touch:
- `strand.ts` — add `binding`, `merge`; extend `computePickId` exclusion list.
- `seal.ts` — `SealInput` gains `binding?`, `merge?`; write onto the body, keep out of `pickId`.
- `materialize.ts` — snapshot before `releaseTree`; return `{ treeId, recipe }`.
- `admit.ts` — CLEAN seal passes `binding` + `merge`; FAST_ADMIT passes `binding`. (Leave H1 guard.)
- `pick.ts` / `absorb.ts` — capture `treeId` for normal picks (absorb returns `treeId` when asked).
- `fabric.ts` — reuse `rewriteFabric` for `warpline objects backfill` (binding stamping, `#fabric-lock`).

Tests: merged strand restores byte-identical; `recipe` re-derives the same `resultTreeId`; backfill
stamps binding without moving any `pickId`; `binding.gitOid == provenance.treeSha`.

### M1c — restore + git-absent acceptance

New: `src/fabric/restore.ts` (`restore(root, selector, {to, force})`); CLI `warpline restore`.
Cutover: `warpline objects materialize --all` + `.gitignore` policy flip. Ship the §4 acceptance
test as an integration test (`rm -rf .git` in a fixture).

### Risks / open questions

- **OQ-1 Repo size.** Loose+zlib stores every version whole — no delta compression. Fine for M1;
  large/binary-heavy repos need packing (git packfile format vs content-defined chunking) — deferred,
  `objects/pack/` reserved.
- **OQ-2 gitignore policy.** Committing `.warpline/objects/` in mirror mode ~doubles repo size vs
  git's packed store. Recommendation: **gitignored + regenerable until explicit cutover**; the
  git-absent acceptance test must run the cutover step first. Risk: a user who `rm -rf .git` *before*
  cutover loses bytes — mitigated by making cutover a loud, explicit command.
- **OQ-3 Byte source (archive vs blob).** Must snapshot **raw blob bytes** (`git cat-file`), not
  `git archive` output, or filters/eol/`export-subst` silently drift bytes. Backfill and ref-snapshot
  use per-path `cat-file`; `WORKTREE` uses on-disk. Confirm no attribute path is missed.
- **OQ-4 Empty directories / non-file entries.** git (and `tar`/`loadLiveGraph`) don't track empty
  dirs; restore won't recreate them — documented git-parity limitation.
- **OQ-5 H1 relaxation.** Storing merged bytes *enables* lifting the `merged`-strand fail-closed
  guard, but flipping it is a separate task with its own conflict/re-base test matrix. M1b records
  bytes only.
- **OQ-6 Identity asymmetry.** `provenance.treeSha` (git) is inside `pickId`; `binding.treeId`
  (native) is outside it. Intentional (atomic-at-seal vs backfillable) and mirrors the
  `calibratedConfidence` precedent — but it is an asymmetry to document loudly so no one "fixes" it
  by moving `treeId` into the hash and breaking backfill.
- **OQ-7 sha256 vs git-sha1.** Native ids aren't `git cat-file`-able; mitigated by shadow-OID
  verification during coexistence, then dropped.

---

## Appendix — invariants (test these)

1. **Determinism:** `snapshot(dir)` is byte-stable across runs/machines (TREE-ORDER + NFC + no
   timestamps/paths in object bytes).
2. **Round-trip:** `snapshot(restore(treeId)) == treeId`.
3. **Byte parity:** binary (NUL), exec bit (`100755`), symlink (`120000`), gitlink (`160000`),
   rename — all faithful, matching the merge hardening vocabulary.
4. **Identity stability:** adding/backfilling `binding`/`merge` never changes any `pickId` or
   `stateId`.
5. **Coexistence proof:** `binding.gitOid == strand.provenance.treeSha` for every git-anchored strand.
6. **Git-absent:** `rm -rf .git && warpline restore <state>` reproduces the exact tree.
```

---

## 9. Design review — team vetting (2026-07-01)

A six-lens panel vetted this design against the question *"once built, does this actually
work as true byte-authoritative source control?"* Verdict: **directionally sound and
buildable, but not as written** — mean confidence **≈ 0.53** (vs 0.05 for today's git-riding
layer), gated on the must-fix items below.

| Lens | Confidence | Load-bearing finding |
|------|-----------|----------------------|
| Jinx (adversarial) | 0.35 | History is a **graph**, not a tree — restore proves one snapshot, not `log`/`blame`/`diff A..B`/branches. |
| Cid (daily-driver) | 0.45 | **No branching model** anywhere in M1–M4 — the op devs touch most. |
| Aegis (integrity) | 0.50 | M1 stores bytes with **no anchor** — `binding.treeId` is excluded from `pickId`, mutable via `rewriteFabric`, sigs deferred to M3 → zero tamper-evidence in authoritative mode; the round-trip proof is a tautology (self-consistency ≠ authenticity). |
| Judge (correctness) | 0.60 | **Merged-tree byte-source bug** — §5 `snapshotTree(tmp)` captures `git archive`-massaged bytes for unchanged paths, silently violating §1.5 at the durable-merge core. |
| Loid (strategy) | 0.60 | Preserve/amplify the moat: wire `#grade` to the `MergeRecipe` now; hard-defer M4 remote + packing; ship mirror mode as the product. |
| Bolt (performance) | 0.70 | Snapshot is **O(repo) per seal** with no delta — must be incremental (O(changed)) before it scales. |

### Required amendments before building (M1)

- **A1 — Chain the history in M1b, not M3.** Fold `parentPickId` **and** `binding.treeId`
  into `computePickId` for strands sealed M1b+ (chain link = prev `pickId` + this `treeId`).
  A content-addressed store without an authenticated parent chain is a snapshot bucket, not a
  VCS; this also gives byte tamper-evidence at cutover *without* needing signatures. Backfilled
  historical strands stay outside the chain (documented, git-verified during coexistence).
  *(Jinx + Aegis — the strongest convergent finding.)*
- **A2 — Build the merged `treeId` compositionally, never from the archive dir.** Snapshot
  `baseRef` via per-path `git cat-file blob`, then substitute blob ids only for `plan.files`
  changed/deleted paths at the tree level. The `git archive` temp dir is used **solely** for
  the meaning `absorb`, never as a byte source. *(Judge, blocking.)*
- **A3 — Incremental snapshot.** Before write, `store.has(id)` + diff against the parent
  strand's tree → touch only changed paths (skip both the read-encode-write and the
  `cat-file`). Turns per-seal cost O(repo)→O(changed); prerequisite for a pack threshold
  reserved *before* cutover. Make `MergeRecipe` `treeId` **non-optional** for all three parents
  (else re-derivation depends on git). *(Bolt + Judge.)*
- **A4 — Cutover must REFUSE on any reachable strand lacking a binding.** Otherwise pre-M1b
  merge strands (no recipe, bytes already `releaseTree`'d) and failed backfills survive into
  authoritative mode as silent permanent unrecoverability the moment git is deleted. *(Judge.)*
- **A5 — Corpus-fidelity fixes.** gitlink (`160000`) breaks round-trip #2 (store a sidecar so
  re-snapshot matches); WORKTREE symlinks/exec must use `lstat`+`readlink` / `st_mode`, not
  `readFile`; scope shadow-OID invariant #5 to **ref-sourced** strands (autocrlf/smudge makes
  worktree bytes CRLF vs git's LF); hash the **raw** filename bytes, not NFC (NFC/NFD-distinct
  names otherwise collide into one tree entry). *(Judge + Aegis.)*

### Roadmap amendments

- **A6 — Add M2.5 "branching model":** named selvages/refs, `warpline branch`/`switch`,
  restore-over-dirty-tree conflict UX, and byte-`diff` between two arbitrary revs. Without a
  branch primitive the "full everyday loop" claim is unmet regardless of M4. *(Cid.)*
- **A7 — Moat-first sequencing:** wire `#grade`'s `calibratedConfidence` to each merge's
  survive/overturn outcome via the `MergeRecipe` in M1b, so every quarter of byte work feeds
  the differentiator; hard-defer M4 remote + packing. Treat mirror mode as the shipped product
  and authoritative cutover as optional. *(Loid.)*

Net: the idea **works as true source control** — but it must be a hash-chained *graph* (A1),
byte-honest at the merge core (A2), and it needs a branching model (A6). These are folded into
the M1 build tasks and the epic (T-2026-07-01-007).
