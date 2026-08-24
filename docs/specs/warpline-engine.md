# Warpline Engine — Phase 1: the Convergence/Divergence Oracle (build spec)

> Decision: TD-2026-06-23-398 (Warpline is a git replacement; WARP is truth) · roadmap Phase 1 = VALIDATE.
> Architecture: Arky (engine/Oracle) + Cid (essence hash + delta algebra). Kickoff lore L-2026-06-23-ascend-145542-001.
> Status: spec locked, building. Branch `loom-engine`. Package `packages/warpline` (`@a-company/warpline`).

## Goal
A **read-only** tool that, given two real git branches, lifts each to a content-addressed store of MEANING (the symbol graph), predicts the merge from meaning (clean / knot / dangling), runs git's *actual* merge read-only, and **scores where meaning and bytes agreed or diverged** — appending a row to `.warpline/oracle.jsonl`. Zero data-loss risk (never touches HEAD/index/worktree). Runs on THIS repo immediately. If a single real branch-pair yields a `git-clean-but-meaning-knot` or `git-conflict-but-meaning-clean`, the core thesis ("meaning carries merge-information bytes can't") is proven with data.

WARP v0 granularity = the Paradigm symbol graph (reuse premise-core extraction). No sub-symbol/AST fidelity in Phase 1.

## Reuse (the engine we stand on)
- `aggregateFromDirectory(rootDir)` — `packages/premise/core/src/aggregator.ts:436` — parses a dir's `.purpose` + symbol refs. This is ABSORB's core.
- `buildSymbolIndex(result)` / `getReferencesFrom` / `getReferencesTo` — `symbol-index.ts:37/175/163` — the graph + typed edges.
- `loadLiveGraph(dir)` + `neighborsOf` + `edgeKindForTarget` — `graph-slice.ts:149/414/477` — live-parse + the typed edge union. **ABSORB = `loadLiveGraph` pointed at a checked-out ref.**
- `SymbolEntry` shape — `types.ts:122-159`. `SymbolType = component|flow|gate|signal|aspect` — `types.ts:23`.
- premise-core is the dependency; mirror its package.json/tsup/vitest/tsconfig conventions.

## WARP object + state
```
WarpObject { symbol, kind, contract, componentType?, parentSymbol?, tags[](sorted), edges: WarpEdge[](sorted), contentId }
WarpEdge   { to, kind: 'uses'|'used-by'|'in-flow'|'gated-by' }   // reuse SliceEdgeKind / edgeKindForTarget
WarpState  { ref, treeSha, objects: Map<symbol,WarpObject>, stateId, absorbedAt }
```
`stateId` = hash of sorted `contentId`s. `treeSha`/`absorbedAt` are provenance, not identity. Drop `filePath`/`position`/line/array-order on lift — that dropping IS the thesis. Store: content-addressed JSON under `.warpline/warp/objects/<contentId>.json` + `.warpline/states/<stateId>.json` (in-mem primary; disk is a debug cache). No GC/packing/refs in v0.

## The essence hash — `essence(symbol) -> contentId` (Cid; the load-bearing wall)
**Rule: the hash moves IFF the meaning moves.** Rename/move → same contentId; change contract/edges → new contentId.

IDENTITY-BEARING (hashed), the Canonical Normal Form `⟨kind, contract, edgeBag⟩`:
- `kind` (`type`), `componentType`, and the typed `.purpose` contract slots: `gates[]`, `signals[]`, `aspects[]`, `states[]`, flow `steps[]`, `category`, `severity`, aspect `appliesTo`/`enforcement` (structured).
- Outgoing edges only (`references` → `getReferencesFrom`), each reduced to `⟨edgeKind, essence(target)⟩` — **Merkle by target essence, not target name** (this is what makes rename free up the whole chain).

LABELS (excluded from hash, carried as metadata): `symbol`/`id` (name), `filePath` (path), `description` (prose → carried; a prose edit is a `description-touched` *label-delta*, never a SemDelta), `created`/`modified`, `position`, `referencedBy` (derived inverse — hash edges once from source side only), `anchors` (byte-level file:line), `tags` (borderline; used as aliasing tiebreaker, not core).

Normalization: strip name/path; **sort + dedupe every set** (edges by `(edgeKind,targetEssence)`, contract-lists by codepoint); absent ≡ empty; prose dropped from hash; canonical serialization (v0: strict canonical JSON — sorted keys, no whitespace ambiguity, NFC strings — dependency-free via Node `crypto`; CBOR is a later hardening). `contentId = "essence:v0:" + sha256(canonical)`. The `v0` tag lets the scheme evolve without id collisions.

Hard cases (honest v0):
- **Cycles** ($flowA⇄$flowB): Tarjan SCC; non-SCC nodes hash in topo order of the condensation DAG; an SCC hashes **as a unit** — members' intra-SCC edges replaced by `@scc-internal` placeholder, out-of-SCC edges by real target essence, members canonically ordered by name-stripped local CNF; `contentId = "essence:v0:scc:"+sccHash+":"+ordinal`. (Over-invalidates on any cycle-internal change — accepted; fixpoint refinement deferred.)
- **Aliasing** (two distinct symbols, identical kind+contract+edges): pure-structural essence for RICH contracts (a true match is a feature — "you both built the same thing"); for GENERIC contracts (empty gates∧signals∧aspects∧edges ∧ no componentType) fold a stable disambiguator = `SymbolEntry.id` (the uuid, NOT the name, so renames still don't move it). Honest tradeoff; refine to surfaced "are these the same?" later.
- **Determinism** (defuses the known insertion-order scan-index wart, `graph-slice.ts:14`): source = the LIVE parse (never scan-index.json); sort every set; canonical serialization; fixed hash; no timestamps/paths/positions in the byte stream. → byte-identical contentIds across runs/machines.

## ABSORB — `absorb(gitRef) -> WarpState`
Never touch HEAD/index/worktree. Mechanism: `git worktree add --detach --quiet <tmp> <ref>` → `loadLiveGraph(<tmp>)` → lift each `SymbolEntry` to a WarpObject (edges via `neighborsOf(...,'ego')` mapped + sorted; `contentId = essence(...)`) → `git worktree remove --force <tmp>` in a `finally`. Special ref `"WORKTREE"` = `loadLiveGraph(process.cwd())` (absorb uncommitted state). Chosen over per-file `git show` (aggregator needs a real dir tree) and over stash/checkout (mutates worktree = forbidden).

## SemDelta + the algebra (Cid)
Keyed by `stableKey` = `SymbolEntry.id` (survives rename), payloads carry essences. Types: `symbol-born`, `symbol-retired`, `contract-changed {changeset: gates/signals/aspects ±, componentTypeChanged, kindChanged(retype)}`, `edge-added ⟨kind,targetEssence⟩`, `edge-removed`, `rename` (**the empty delta** — same stableKey + same essence + only name/path label differs → provably zero semantic weight, because essence excludes name/path and edges key on target essence).

`diff(base, branch)`: walk union of symbols; `!b&&h`→born; `b&&!h`→retired; `contentId` differs → contract-changed/edge-Δ (classify changed slots); equal → **no delta** (the payoff: a pure move/rename = zero deltas where git shows a diff).

`predict(ΔA, ΔB) -> {autoClean, knots[], dangling[]}`:
- **COMMUTE/auto-clean**: disjoint touch sets; one side rename-only; independent edge-adds (different `⟨kind,targetEssence⟩`) on same node; identical change both sides (convergent); same-key contract changes on **disjoint slots** (A adds gate, B adds signal). `autoClean := knots∅ ∧ dangling∅`.
- **KNOT** (same symbol, contradictory meaning): `k∈keys(ΔA)∩keys(ΔB)` ∧ (`bothRetype` to different kinds ∨ `conflictingSlot` — both changed the SAME slot to different values ∨ `bornDivergent`) ∧ `essenceAfterA≠essenceAfterB`. Payload `{stableKey, essenceA, essenceB, conflictingSlots[]}`.
- **DANGLE** (meaning-level broken ref git is blind to): `∃ edge-added(⟨_,T⟩)∈ΔB ∧ (symbol-retired(T)∈ΔA ∨ contract-changed(T)∈ΔA s.t. essence T no longer exists)`; symmetric for A-edges vs ΔB-retires. Payload `{fromKey, edgeKind, danglingTargetEssence, retiredBy}`.
- Precedence (partition the score, no double-count): a key that is both retired-on-A and edge-targeted-on-B is a **dangle**, not a knot.

## The Justification (v0)
`{schemaVersion:1, actor (git author of branch tip), intent (tip commit subject), base:{ref,stateId}, branch:{ref,stateId}, semanticDelta: SemDelta[], computedRipple:{touchedSymbols, blastRadius (union getReferencesTo over changed), danglingRefs}, signature: "unsigned:"+sha256(canonical)}`. Real signing deferred; schema reserves the field.

## The Oracle — `oracle(branchA, branchB)`
1. `mergeBase = git merge-base A B`. 2. ABSORB base, A, B. 3. `ΔA=diff(base,A)`, `ΔB=diff(base,B)`; synthesize justA/justB. 4. `predict(ΔA,ΔB)` → {autoClean, knots, dangling}. 5. GIT REALITY read-only: `git merge-tree --write-tree A B` → conflicted paths (fallback: throwaway worktree + `git merge --no-commit --no-ff` for git <2.38); map conflict paths → symbols via dir of the `.purpose`. 6. SCORE the confusion matrix per touched symbol: `meaningKnot∧gitConflict`→agreeConflict; `clean∧clean`→agreeClean; `meaningClean∧gitConflict`→**divergeGitOnly** ★ (text noise); `meaningKnot∧gitClean`→**divergeMeaningOnly** ★ (THE headline — git merged bytes but meaning is contradictory). 7. append `OracleRecord` to `.warpline/oracle.jsonl`; print summary.

`OracleRecord { schemaVersion, ts, repo, branchA, branchB, mergeBase, stateIds:{base,A,B}, prediction:{autoClean[],knots[],dangling[]}, gitReality:{conflicted, conflictSymbols[], conflictPaths[]}, convergence:{agreeClean[], agreeConflict[], divergeGitOnly[], divergeMeaningOnly[], score (|agree|/|agree∪diverge|), verdict: CONVERGENT|DIVERGENT}, justifications:{A,B} }`. The two ★ cells are first-class fields — they are the experimental result.

## CLI (v0)
`warpline oracle <branchA> <branchB> [--json]` (summary + jsonl row). `warpline absorb <ref> [--json]` (dump a WarpState — proves ABSORB alone). commander-based, thin output, no blockquotes.

## Package layout (mirror premise-core)
`packages/warpline/{package.json (name @a-company/warpline, dep @a-company/premise-core:"*", bin warpline→dist/cli.js), tsup.config.ts, tsconfig.json (extends ../../tsconfig.base.json), vitest.config.ts, src/{index.ts, warp/{warp-object,warp-state,store,essence-hash}.ts, git/git-exec.ts, absorb.ts, sem-delta.ts, predict.ts, justification.ts, oracle.ts, cli.ts}, test/{absorb,oracle,essence}.test.ts}}`. Add to root workspaces.

## MVP build order
1. `git-exec.ts` (merge-base, rev-parse, worktree add/remove, merge-tree + fallback).
2. `essence-hash.ts` (sha256 over canonical-sorted serialization, version-tagged; SCC + aliasing handling) + `warp-object.ts`/`warp-state.ts`.
3. `absorb.ts` (loadLiveGraph on a temp worktree) → first runnable: `warpline absorb main`.
4. `sem-delta.ts` (`diff`).
5. `predict.ts` (commute/knot/dangle algebra).
6. `justification.ts`, `oracle.ts`, `cli.ts`.
7. RUN `warpline oracle main loom-engine` on THIS repo → verdict + jsonl row.

Tests: `essence` (rename→identical contentId; contract change→different; determinism across two runs byte-identical), `absorb` (two refs; identical meaning→identical stateId; zero-delta on identical), `oracle` (runs on two real branches, produces a verdict; ideally construct a fixture that yields a `divergeMeaningOnly`).

## Deferred (not Phase 1)
Any write/merge path (Oracle is read-only forever in P1); WARP GC/packing/refs/binary format; real signing; sub-symbol/AST granularity; CBOR/blake3 hardening + Merkle-tree stateId + fixpoint SCC; human-authored Justifications; the full VCS / WEAVE / projection.

## Resolved open questions
- Same symbol modified both sides to **identical** contentId → autoClean (convergent meaning, not a knot).
- `contract` normalization: strip markdown/whitespace so cosmetic doc edits don't register (prose is a label-delta, never a SemDelta).
- Path→symbol mapping for git reality: dir-level (`.purpose` dirname) — coarse but honest for v0.
- git floor: ship the throwaway-worktree fallback so `merge-tree --write-tree` (≥2.38) isn't required.
- dangle vs knot precedence: dangle wins (partition the score).
