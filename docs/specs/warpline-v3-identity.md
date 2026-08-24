# Warpline v3 Identity — the PICK-DAG becomes real (parents-first, position-free, exchangeable)

**Task:** T-2026-07-03-003 (Stream B, Artifact 2) · **Status:** design RATIFIED NOW, **built LATER** (after M2 branching wedge; sub-phases §8)
**Author:** Arky (architect) · **Reads with:** `warpline-fabric-schema-v2.md`, `warpline-v1-anchor.md` (Artifact 1 — the two are designed to rhyme, §5)

**Why now, before M2 branching:** the panel finding is structural. v2 folds `seq` (ledger position) into the pickId preimage and `parentPickId` is always the physical tip — a **linear chain wearing DAG clothes**. Two machines that both seal produce strands whose identities embed *their own local ledger positions*; the strands cannot be exchanged without re-identification, so distribution is designed **against**. M2 branching must not pour concrete over that. This spec fixes the identity model on paper now and gives M2 a guardrail list (§6) so nothing built in the meantime has to be torn out.

---

## 1. The v3 identity: `pickId = H(parents + content)` — no ledger position, ever

```
pick:v3:sha256( canonicalSerialize( canonicalSafe( identityV3 ) ) )
```

Same serializer as every Warpline address (codepoint-sorted keys, NFC, null→`""`). The preimage:

```jsonc
{
  "schemaVersion": 3,
  "parents": ["pick:v3:<primary>", "pick:v3:<merge-parent>", …],  // ORDERED; [] at genesis
  "stateId": "state:v0:<meaning>",
  "actor": "ascend",
  "authoredBy": { "agentId": "arky" },        // sessionKey still EXCLUDED (ephemeral)
  "intent": "…",
  "recordedAt": "…",                          // event identity, like a git committer date
  "objectCount": 5210,
  "delta": { … },
  "provenance": { "ref": "…", "treeSha": "…", "gitCommit": "…" },
  "resolves": { … },                          // KNOT council — rides along when present
  "bindingTreeId": "tree:v1:<root>",          // byte identity, folded (as v2)
  "merge": {                                  // merges only — folded WHOLE (§1.3, new vs v2)
    "algo": "warpline-merge3-v1",
    "base": "tree:v1:…", "ours": "tree:v1:…", "theirs": "tree:v1:…", "result": "tree:v1:…"
  }
}
```

### 1.1 What left the preimage — and the record — vs v2

| Field | v2 | v3 | Why |
|---|---|---|---|
| `seq` | IN preimage | **GONE from preimage; not stored on the strand** | Ledger position is a *local arrival fact*, not event identity. Position is DERIVED (§1.2). This is the whole point. |
| `parentPickId` / `mergeParentPickId` | two scalars, physical-tip-shaped | **`parents: string[]`** — ordered, multi-parent native | A weave = 2+ parents. `parents[0]` is the primary (chain/ours-history) parent; `parents[1]` the admitted/merge parent; N-way councils get N. M2 branching and the H1 relaxation both want exactly this shape. |
| `parentStateId` | stored + IN | **GONE (derived)** | It is `parents[0]`'s `stateId` — storing it re-introduces a redundant copy that can drift. Genesis (`parents: []`) has no parent state, same as `null` today. |
| `merged?` flag | stored + IN | **GONE (derived)** | `parents.length > 1`. |
| `merge.{base,ours,theirs,result}` | EXCLUDED (backfillable) | **IN** | Since M1b, merge bytes are durable at seal — there is nothing left to backfill. Folding the recipe closes MED-D *structurally* for v3 (a merge's claimed inputs become immutable identity, not verify-side hope). |
| `binding.treeId` | IN (as `bindingTreeId`) | IN, and **`binding` is mandatory at seal** | Bind-on-seal is the only v3 write path; there is no unbound v3 strand, hence no binding backfill, hence no post-seal binding mutation surface (HIGH-A class dies at the schema level). `gitOid` stays excluded/optional (coexistence breadcrumb). |
| `calibratedConfidence` | stored, hash-EXCLUDED, mutated via `rewriteFabric` | **GONE from the strand entirely** | R4, §7. Mutable trust data leaves the signed record. |
| `authoredBy.sessionKey` | stored, excluded | stored, excluded | unchanged. |

**Consequence:** a v3 strand has **zero post-seal-mutable fields**. Sealed bytes are final. `rewriteFabric` — and both of its guards, and its CAS, and its entire attack surface — is *retired* at the end of the v3 cutover (§8, V3.4). The ledger becomes append-only in the strong sense.

### 1.2 Position is derived, deterministically

Display/order = topological sort of the DAG; ties (concurrent strands, no ancestry between them) broken by `(recordedAt, pickId)` ascending. Deterministic across machines *given the same strand set*, which is the correct promise — arrival order is not shared state, the DAG is. A local "seq" may be shown in CLI output but is never persisted, never accepted as a durable selector across exchange (selectors: `pick:<id>` is canonical; `@N` stays as local sugar resolving through the derived order).

### 1.3 Identity edge cases

- **Idempotence:** two byte-identical events (same parents, content, actor, timestamp) collapse to one pickId — appending the same strand twice is a no-op by dedup, which is exactly right for exchange (§4).
- **Reseal-on-retry:** losing a ref CAS race (§2) and re-parenting means resealing → a NEW pickId. Identity includes ancestry; that is a feature, not churn.
- **Genesis:** `parents: []`. A migrating repo's first v3 strand instead has `parents: [<v2 tip pickId>]` + the epoch anchor payload (§5).

## 2. Concurrency without total order — per-ref tip CAS over content-addressed strands

Today's model: ONE tip (`refs/selvage`, a **stateId**), one fabric lock, `writeSelvage` CAS, and a losing writer's work is refused. v3 model (git-refs + jj prior art):

- **Refs move to event identity.** `.warpline/refs/heads/<name>` each hold a **pickId** (not a stateId — stateIds are many-to-one and cannot name a history position; the selvage's stateId ambiguity is already visible in `select.ts`'s highest-seq disambiguation hack). `selvage` becomes `refs/heads/selvage` holding the tip pickId; migration converts the stored stateId once (resolve via highest-seq, exactly the current hack, then never again).
- **Append is contention-free.** Strands are content-addressed and parent-linked; appending a strand can never conflict with appending another (worst case: same bytes → dedup). The fabric lock shrinks to protecting the *file* append + ref writes, not the whole read-decide-write span.
- **Advance is per-ref CAS.** `writeRef(wdir, name, newPickId, expectedOld)` — atomic tmp+rename, refuse if the on-disk ref moved (verbatim today's `writeSelvage` CAS mechanics, `fabric.ts:105-119`, re-scoped per ref). Two writers on the SAME ref: one wins; the loser's strand is **still a valid DAG node** — the loser either (a) reseals re-parented on the new tip (retry), or (b) publishes under its own ref and the divergence is resolved later by a weave (2-parent strand) via admit. Nothing is lost, nothing is corrupted, and "conflict" degrades to "merge later" — the jj/darcs posture, vs. today's "refuse and throw away."
- **Prior art honestly borrowed:** git loose refs + ref-transaction CAS (per-ref optimistic concurrency); jj's operation log (concurrent operations are reconciled by merging, not serialized by locking); generic Merkle-DAG event logs (content addressing makes replication idempotent).
- **What stays:** the O_EXCL lock (`lock.ts`) survives as the short critical-section guard for append+ref-write; the selvage-CAS defense-in-depth pattern survives per-ref.

## 3. Verify on a DAG

The v2 walk ("parentPickId == physical predecessor") dies with the physical-order assumption. v3 verify:

1. **Integrity** — every strand's pickId recomputes (v3 rule; v2/v1 dispatch preserved for the pre-v3 segment).
2. **Closure** — every `parents[]` entry resolves to a strand present in the fabric (dangling parent = truncation/forgery evidence, HARD).
3. **Causality** — arrival order respects parents (parent line-index < child line-index): the causal-append invariant (§4). Violation is HARD (an appender that can't see the parent yet must not have the child).
4. **Acyclicity + single-genesis-per-root** — DAG sanity.
5. **Heads ↔ refs** — every ref resolves to a present strand; every headless tip (no children, no ref) is REPORTED (abandoned head — legal, but surfaced).
6. **Bindings/recipes** — unchanged verified-walk (recompute) machinery; recipe fields are now identity-protected so step 5's `merge-recipe-invalid` re-derivation checks become redundant-but-kept (defense in depth); an optional `--deep` re-runs `merge3(base,ours,theirs) == result` (MED-D's last residue, now merely confirming an immutable claim).
7. **Epoch anchors** — §5; the pre-v3 segment authenticates against the v2-epoch anchor exactly as the v1 prefix authenticates against the v1 anchor today.

## 4. File format: `fabric.jsonl` stays; ordering becomes advisory

- **Append-only JSONL survives.** It is now an **arrival log** (a local receipt of when this machine learned of each strand), not the authority on order. The DAG in the strands is the authority; `readFabric` grows a DAG index (`byPickId`, `children`, derived topo order) — new `dag.ts`.
- **Causal-append invariant:** a strand may be appended only after all its `parents` are present in the file. Verify checks it (§3.3); the exchange receiver enforces it (below).
- **Exchange format (the payoff):** a *bundle* = JSONL of strands (any causal order) + the sender's ref claims. Receiver: for each strand, recompute pickId (reject on mismatch), skip if already present (dedup), refuse if parents missing (or hold in a staging set until closure arrives), append in causal order; then fast-forward/merge refs. No re-identification, no seq collision — the exact operation v2 makes impossible.
- **Loose strand files** (`.warpline/strands/<pickId>` à la git loose objects): explicitly **deferred**. At dogfood scale one JSONL is simpler to read, diff, and git-corroborate; revisit only when bundles or fabric size demand it. Named here so nobody "helpfully" adds it early.
- **Git-tracking of `fabric.jsonl` remains the external corroboration** during coexistence — note that after exchange lands, two machines' fabric.jsonl files legitimately differ in ORDER while containing the same DAG; corroboration tooling must compare strand SETS + refs, not bytes. (Small but breaking assumption; flagged for the attest/corroboration code.)

## 5. The v2→v3 epoch boundary — the Artifact-1 anchor pattern, generalized (designed to rhyme)

Yes — the v1 anchor generalizes, by construction. `attests` in `warpline-v1-anchor.md` §3 was deliberately shaped `{kind: 'epoch-anchor', epoch: 'v1', …}`:

- **The first v3 strand of a migrating repo** is the **v2-epoch anchor**: `parents: [<v2 tip pickId>]` plus `attests: { kind: 'epoch-anchor', version: 1, epoch: 'v2', prefixCount: <total pre-v3 strand count, v1+v2>, prefixTipPickId: <v2 tip>, prefixDigest: <same fold, §3.1 of Artifact 1, over ALL pre-v3 strands in stored order>, manifestDigest, grandfatheredCount, corroboration: { method: 'git-history-prefix-match', gitCommit } }`.
- The v2-epoch digest covers the v1 anchor strand transitively (it is just another v2 strand in the fold), so the epochs nest: v3 chain → attests v2 segment → contains v1 anchor → attests v1 prefix + manifest. One verification story, recursive.
- **Same rules, per epoch:** exactly ONE anchor per `epoch` value (Artifact 1's uniqueness rule is per-epoch, not global); no re-attestation verb for any epoch; freeze applies to the attested segment (trivially — by v3 the whole pre-v3 segment is immutable anyway since `rewriteFabric` retires); corroboration commit recorded in-chain.
- `anchor.ts`'s `computePrefixDigest` / digest helpers are epoch-agnostic already; the attest verb grows `--epoch v2`, legal exactly once, only as the v3 genesis seal.
- **Fresh v3 repos** (no pre-v3 history) have a plain `parents: []` genesis and never carry an anchor.

## 6. Guardrails: what M2 branching MAY and MAY NOT build on v2 in the meantime

M2 branching proceeds on v2 — with these fences so v3 is a migration, not a demolition.

**MAY:**
1. Named wefts/branches as a **naming layer**: `.warpline/refs/` entries resolving to pickIds, plus sidecar metadata files. Refs-as-files is v3-forward.
2. Admit-based merging, including the T-030/H1 relaxation (PR-B) — `mergeParentPickId` + verify's recipe control are the v2-sanctioned mechanism.
3. Ancestry display via `parentPickId`/`mergeParentPickId` walks.
4. New per-strand metadata in **sidecar files keyed by pickId** (grades.jsonl precedent).

**MAY NOT:**
1. **Persist `seq` anywhere new** — not in refs, not in sidecar keys, not in API/JSON output contracts consumed by other tools. Display only. (Every persisted seq is a v3 migration casualty.)
2. **Add fields to the v2 preimage.** The v2 identity rule is frozen; a new hashed field forks identity semantics mid-epoch. New data → sidecars, or waits for v3.
3. **Assume the tip is unique** in new code — write against `heads(): pickId[]` even while it returns one element. No new module may bake in "the strand at seq N-1 is the parent."
4. **Store stateIds where a history position is meant.** New refs hold pickIds. (The selvage's stateId is grandfathered until V3.2 — do not copy the pattern.)
5. **Exchange strands across machines on v2.** v2 identities embed local positions; any "sync" hack now creates permanently divergent ids. Distribution waits for V3.5.
6. **Build anything new on `rewriteFabric`.** It is scheduled for retirement; every new writer must be append-or-sidecar.

## 7. Grading / `calibratedConfidence` — the R4 position, taken

**Position: mutable trust data moves OUT of the signed record. In v3 the strand has no `calibratedConfidence` field at all.**

- `grades.jsonl` (already live — `appendGradeEvent`, `fabric.ts:216`) becomes the **sole** store: an event-sourced sidecar keyed by pickId. Reads fold latest-wins per pickId (`readGrades(wdir): Map<pickId, Grade>`); the CLI shows graded confidence next to strands exactly as today, sourced from the fold.
- `warpline grade` appends events only. No ledger rewrite → `rewriteFabric` retires (V3.4) → the entire "which fields are rewritable" guard complex (v2 §4.4, §7.4, freeze §7 of Artifact 1) becomes dead weight to delete rather than a wall to maintain. The moat's write path gets simpler AND the history gets stronger — the rare win-win, which is the tell that R4 was right.
- **Honest trade, stated:** `grades.jsonl` is unauthenticated and mutable **by design** — a grade is a *current belief about* history, not history. Tampering grades never touches tamper-evidence of events. If graded beliefs ever need their own audit trail, grade events can be sealed as strands (a `grades` event kind) — possible under v3's schema, deliberately NOT designed here.
- The v1 freeze (Artifact 1 §7) already moves v1 grading to the sidecar; v3 finishes the job for everything. v2 strands keep their stored `calibratedConfidence` as a historical snapshot (frozen at the v2-epoch attest); reads prefer the sidecar fold when present.

## 8. Sub-phase file plan (built later; each phase lands green independently)

| Phase | Scope | Files (packages/warpline/src/…) |
|---|---|---|
| **V3.0 (now)** | This spec ratified; §6 guardrails enforced in M2 review. No code. | — |
| **V3.1 DAG core** | `pick:v3` preimage + dispatch in `computePickId`; `Strand` v3 shape (`parents[]`, fields dropped per §1.1); DAG index + derived order; verify steps §3.1–4. | `fabric/strand.ts`, `fabric/dag.ts` (NEW), `fabric/verify.ts`, tests |
| **V3.2 refs** | `refs/heads/<name>` pickId refs + per-ref CAS; selvage migration (stateId→tip pickId, one-time); seal/select re-pointed at refs; heads() API. | `fabric/refs.ts` (NEW), `fabric/fabric.ts`, `fabric/seal.ts`, `fabric/select.ts`, `cli.ts` |
| **V3.3 epoch anchor** | `fabric attest --epoch v2` as the v3 genesis seal (reuses `anchor.ts`); verify's nested-epoch walk (§3.7, §5). | `fabric/anchor.ts`, `fabric/verify.ts`, `fabric/seal.ts` |
| **V3.4 grade sidecar cutover** | `readGrades` fold; grade appends-only; strip `calibratedConfidence` from the seal path; **delete `rewriteFabric`** + guards; CLI reads from fold. | `fabric/grade.ts`, `fabric/fabric.ts`, `cli.ts` |
| **V3.5 exchange** | Bundle export/import + receive validation (§4); set-based corroboration tooling. The distribution wedge — first multi-machine dogfood. | `fabric/bundle.ts` (NEW), `cli.ts` |

Ordering rationale: identity before refs (refs point at pickIds that must already be v3-stable); anchor before grade-cutover (the v2 segment must be frozen before its stored confidences become read-only snapshots); exchange last (needs all of it).

## 9. Founder sign-off points

1. **Refs hold pickIds, not stateIds** (§2) — selvage semantics change; `state:` selectors remain but stop being the tip's native type.
2. **v3 folds the full merge recipe into identity** (§1.1) — closes MED-D structurally; cost: recipes are unfixable post-seal (a bad recipe means a superseding strand, never a repair).
3. **`calibratedConfidence` leaves the strand; grades.jsonl is authoritative and deliberately unauthenticated** (§7) — the moat data becomes a sidecar; `rewriteFabric` is deleted.
4. **Per-epoch single anchor** (§5) — v1 anchor now (Artifact 1), v2 anchor at v3 genesis; no re-attestation for any epoch, ever.
5. **`recordedAt` stays in identity** (§1) — wall-clock in the hash (git-committer-date precedent). Alternative (exclude it) would make identical-content retries collide; rejected, but cheap to flip before V3.1 if desired.
