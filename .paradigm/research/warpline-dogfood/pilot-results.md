# Warpline Move-3 Dogfood — PILOT Results

> Builder: Kit. Companion to `harness-spec.md` (Loid's build manifest). This is the
> PILOT: it proves the machinery works end-to-end and the §2.3 scoring table fires
> correctly. It is **not** the ≥100-admission statistical run (§4) — the KILL gates
> that require power (K1 rate<2%, K3 prior z-test) are reported as `not-powered`.

## 0. Live-fabric isolation (the non-negotiable)

**The repo-root `.warpline/` was never touched.** Baseline captured before any work and
re-verified after: selvage `state:v0:…3da228c`, 28 strands, git HEAD `da1012c2` — all
byte-identical afterward. Every runtime warpline write verb (`pick`/`scratch`/`admit`/
`restore`/`grade`/`fabric verify`) ran with `cwd` set to a throwaway repo under
`…/scratchpad/warpline-dogfood-run/` (a fresh `git init` + genesis pick + its own
`.warpline/`). No `pick/admit/scratch/seal/grade/attest` ever ran at the repo root. The
only writes under the repo are the harness SOURCE + result JSONLs in
`.paradigm/research/warpline-dogfood/` (for the coordinator to commit).

## 1. Headline

- **8 concurrent (non-FAST) symbol-bearing admissions** across 4 batches / 1 session.
- **2 MEANING-DECISIVE silent-mismerge catches** (git merges clean-but-broken; warpline KNOTs; external tsc confirms).
- **0 FALSE-KNOT, 0 FALSE-CLEAN.** Negative-control correctly `agree-clean` (no false alarm).
- **H1 relaxation exercised twice** (a 3rd agent admits onto a merge strand → native-tree merge path).
- **Fabric verify: 0 failures.** Every machinery check passes → **Machinery verdict: WORKS.**

## 2. Per-admission table

| batch | agent | seed | stratum | warpline | conf | sealed | merge | git (oracle) | tscGit | label |
|---|---|---|---|---|---|---|---|---|---|---|
| B1 | alice | s5-linked | LINKED-CLEAN | FAST_ADMIT | — | ✓ | — | — | — | (fast, excluded) |
| B1 | bob | s5-linked | LINKED-CLEAN | CLEAN | **linked** | ✓ | ✓ | clean | pass | agree-clean |
| B1 | carol | s1-indep | INDEPENDENT | CLEAN | independent | ✓ | ✓ (H1) | clean | pass | agree-clean |
| B2 | dave | s6-interference | TRUE-INTERFERENCE | FAST_ADMIT | — | ✓ | — | — | — | (fast, excluded) |
| B2 | **alice** | **s6-interference** | **TRUE-INTERFERENCE** | **KNOT** | — | ✗ | — | **clean** | **FAIL** | **MEANING-DECISIVE:silent-mismerge** |
| B2 | bob | s2-indep | INDEPENDENT | CLEAN | independent | ✓ | ✓ | clean | pass | agree-clean |
| B3 | carol | s7-interference | TRUE-INTERFERENCE | FAST_ADMIT | — | ✓ | — | — | — | (fast, excluded) |
| B3 | **dave** | **s7-interference** | **TRUE-INTERFERENCE** | **KNOT** | — | ✗ | — | **clean** | **FAIL** | **MEANING-DECISIVE:silent-mismerge** |
| B3 | alice | s3-indep | INDEPENDENT | CLEAN | independent | ✓ | ✓ | clean | pass | agree-clean |
| B4 | bob | s8-negctrl | NEGATIVE-CONTROL | FAST_ADMIT | — | ✓ | — | — | — | (fast, excluded) |
| B4 | carol | s8-negctrl | NEGATIVE-CONTROL | CLEAN | independent | ✓ | ✓ | clean | pass | agree-clean (NOT false-KNOT ✓) |
| B4 | dave | s4-indep | INDEPENDENT | CLEAN | independent | ✓ | ✓ (H1) | clean | pass | agree-clean |

H1 note: B1/carol and B4/dave each admit onto a **merge strand** (the immediately-preceding CLEAN merge advanced the selvage to a merge state) → `admit` takes the relaxed native-tree merge path (`resolveMergeInput` → `binding.treeId`) and seals cleanly.

## 3. Scoring outcomes (§3 metrics)

| metric | value |
|---|---|
| symbol-bearing concurrent admissions (denominator) | 8 |
| meaning-decisive rate | 25.0% (2/8) — all silent-mismerge catches |
| — auto-resolve wins | 0 (no seed manufactured a git-textual-conflict-that-meaning-commutes; see §5) |
| — silent-mismerge catches | 2 |
| false-KNOT | 0 (guardrail ≤ meaning-decisive ✓) |
| FALSE-CLEAN (wrong-merge) | 0 (hard-stop clean ✓) |
| H1-wall rate | 0.0% (every committed-ref CLEAN sealed) |
| byte-fallback rate | 0.0% (all admissions symbol-bearing) |
| moat: linked survival | 100% (1/1) |
| moat: independent survival | 100% (3/3) |
| moat: prior gap | 0 pts — **not meaningful at pilot scale** (no overturns yet; the full run must accrue graded outcomes for the z-test) |

KILL evaluation: K2 `false-KNOT > meaning-decisive` = **false** (0 ≤ 2); FALSE-CLEAN hard-stop = **false** (0). K1 and K3 = `not-powered` (n=8 « 100).

## 4. One verbatim MEANING-DECISIVE row (the wedge, caught)

`results-swarm.jsonl` (B2 / alice / s6-interference):

```json
{ "batchId":"B2","agentId":"alice","seedId":"s6-interference","status":"KNOT","sealed":false,
  "knots":["#code:src/s6.ts::totalWithTax"],
  "agentChanged":["#code:src/s6.ts::totalWithTax"],
  "otherChanged":["#code:src/s6.ts::computeTax","#code:src/s6.ts::totalWithTax"],
  "gitConflicted":false, "gitMergeClean":false }
```

`adjudication.jsonl` (same admission), external oracles only:

```json
{ "batchId":"B2","seedId":"s6-interference","truth":"conflict","warplineStatus":"KNOT",
  "gitTreeConflicted":false, "tscGit":false, "warpOutcome":"blocked-for-human",
  "label":"MEANING-DECISIVE:silent-mismerge" }
```

Reading: agent A adds a required `rate` param to `computeTax`; the concurrent agent edits
`totalWithTax`'s body in a **disjoint hunk**. **Git 3-way merges CLEAN** (`git merge-tree`
succeeds), but the merged tree **fails `tsc` — `TS2554: Expected 2 arguments, but got 1`**
(the merged caller still passes the old arity). Warpline **KNOTs** on `totalWithTax`
(both sides contend its essence — A via callee-ripple, B directly) and blocks for a human.
The external adjudicator (tsc + authored truth) confirms warpline is right and git is
silently wrong. This is the wedge the whole meaning→bytes layer exists to catch, reproduced
on real TypeScript.

## 5. Machinery verdict — **WORKS**

All ten checks green (`aggregate-dogfood.md`): admit JSON shape, FAST_ADMIT, CLEAN/linked,
CLEAN/independent, KNOT, H1-relaxation-onto-merge, meaning-decisive fired, silent-mismerge
caught, negative-control-not-false-KNOT, no FALSE-CLEAN. Independently confirmed out-of-band
during the build: `restore selvage` of a sealed 3-way CLEAN merge materialized the exact
composite bytes (`foo+2` ∧ `newHelper` ∧ `alpha`) with git absent; `fabric verify` exit 0.

## 6. Harness bugs & engine findings surfaced (dogfood value)

1. **`admit` NOOP uses stateId-equality, which is essence-set-deduped and symbol-blind
   (engine finding).** Writer: `packages/warpline/src/fabric/admit.ts:95`
   (`if (proposed.stateId === base.stateId) return NOOP`). `stateId` hashes the *deduped*
   essence SET; when a symbol's before- AND after-essence both already exist elsewhere in
   the tree, the set is unchanged and admit reports **NOOP for a genuinely changed symbol**.
   Contrast the reader `packages/warpline/src/fabric/pick.ts:111`, which *deliberately*
   abandoned stateId-equality for **diff-based** no-op detection with the comment
   "The DIFF — not stateId equality — is the source of truth for 'did meaning change?'."
   `admit` did not adopt that fix. Reproduced live: `warpline diff A B` → `changedCount 1`
   while `absorb A`/`absorb B` → identical stateId. **This clears the framework-bug
   evidentiary bar (writer file:line + reader file:line).** The pilot works around it by
   making every fixture body globally unique; the engine should port pick's diff-based
   NOOP check into `admitDecision`.
2. **Cross-file `#code` call edges do NOT resolve in absorb** (ts-lens builds its program
   with no node_modules/tsconfig-paths). Every resolvable code edge is intra-file. Not a
   bug per se (a documented v1 ceiling), but it **constrains the harness**: LINKED and the
   ripple-KNOT wedge must be authored intra-file. Recorded so the full run does not waste
   effort on cross-file constructions that silently degrade to `independent`.
3. **Per-admit cost scales with the WHOLE ref tree.** Each admit git-archives + native-
   snapshots + absorbs the entire tree; the CLEAN path does it several times. On the full
   `a-paradigm` monorepo a single concurrent admit **hung > 2 min** (it did not complete).
   The pilot therefore runs on a **dedicated minimal real-TS repo** built from the seed
   catalog (identical code paths, < 1 s/admit). **The ≥100-admission full run on real
   `packages/warpline/src` TS is NOT feasible until admit/absorb support tree-scoping**
   (a sparse subtree or a changed-paths-only snapshot). This is the single biggest blocker
   to the full run and should be a task.
4. **`.warpline/` must be git-ignored in the harness repo.** `git add -A` on the agent
   commits otherwise folds `.warpline/` into the tree, and the resulting merged tree carries
   a `.warpline` entry that `restore` / the native merge path fail-close on (correctly). The
   swarm now writes a `.gitignore` first.

## 7. Readiness for the full ≥100-admission run

**Machinery: READY.** Every code path the falsifier depends on is proven to fire and to be
scored correctly by external oracles: FAST/CLEAN(linked|independent)/KNOT, the H1 relaxation,
CLEAN-merge materialization + git-absent restore, the git counterfactual, tsc adjudication,
the §2.3 scoring table, grade's moat buckets, and fabric verify.

**Not yet ready without two changes:**
- (blocker) **tree-scoping for admit/absorb** (finding #3) — otherwise 130 admissions on the
  real monorepo is O(hours) and timeout-prone. Either scope the snapshot/absorb to changed
  paths, or run the full experiment on a curated small real-TS subtree.
- (should-fix) **port pick's diff-based NOOP into admit** (finding #1) so real-TS seeds with
  incidental essence collisions don't drop admissions.

With those, scale the batch plan in `run-manifest.json` to ~40–50 batches (k=3–4) to net
≥100 concurrent symbol-bearing admissions across ≥10 sessions, and enlarge the seed catalog
per the §1.1 stratum shares (adding an **auto-resolve-win** construction — a git-textual-
conflict pair whose meaning commutes — which this pilot's seeds did not include, so the
auto-resolve component of the meaning-decisive rate is currently 0).

---

### Artifacts (all under `.paradigm/research/warpline-dogfood/`)

`seeds.mjs` (authored catalog) · `seed-catalog.jsonl` (materialized) · `counterfactual.mjs`
(Column A, verbatim base-rate oracle wrapper) · `swarm.mjs` · `adjudicate.mjs` (Column C) ·
`aggregate-dogfood.mjs` · `run-manifest.json` · outputs: `results-swarm.jsonl`,
`adjudication.jsonl`, `human-review-queue.json` (empty), `grade.json`, `fabric-verify.json`,
`aggregate-dogfood.{json,md}`.

---

# Agent Relay

```yaml
- from: "[Kit (builder)]"
  to: "[Loid (forge), Cid (navigator), Aegis (security), founder]"
  re: "Move-3 dogfood harness BUILT + PILOT PASSED"
  isolation_first: >
    CONFIRMED: the live repo-root .warpline/ was NEVER touched. Baseline selvage
    state:v0:…3da228c / 28 strands / git HEAD da1012c2 are byte-identical after the
    run. Every warpline write verb ran with cwd = a throwaway git repo under the
    scratchpad (its own fresh genesis + .warpline). No pick/admit/scratch/seal/grade/
    attest ever ran at the repo root. Only harness source + result JSONLs were written
    under .paradigm/research/warpline-dogfood/ for you to review + commit.
  pilot_result: >
    8 concurrent (non-FAST) symbol-bearing admissions; 2 MEANING-DECISIVE
    silent-mismerge catches; 0 FALSE-KNOT; 0 FALSE-CLEAN; negative-control correctly
    agree-clean; H1 relaxation exercised twice; fabric verify exit 0. All 10 machinery
    checks green. VERBATIM meaning-decisive row (git-clean-but-broken, caught):
    B2/alice/s6 — warpline KNOT on #code:src/s6.ts::totalWithTax, sealed=false;
    git merge-tree CLEAN but the merged tree fails tsc TS2554 "Expected 2 arguments,
    but got 1"; adjudicator truth=conflict => MEANING-DECISIVE:silent-mismerge. The
    wedge reproduces on real TypeScript.
  machinery_verdict: "WORKS — the write path + scoring table are proven end-to-end."
  ready_for_full_run: >
    Machinery READY. Two changes gate the ≥100-admission run: (1) BLOCKER — admit/
    absorb snapshot+absorb the WHOLE ref tree per admission; on the real monorepo a
    single concurrent admit HUNG >2min, so the pilot runs on a dedicated minimal
    real-TS repo. The full run needs tree-scoping (changed-paths-only snapshot, or a
    curated small subtree) or it is O(hours)/timeout-prone. (2) SHOULD-FIX — a genuine
    engine bug I surfaced (framework-bug bar cleared): admit()'s NOOP check uses
    stateId-equality (admit.ts:95), which is essence-SET-deduped and blind to a
    symbol-level change when before/after essences both exist elsewhere; pick.ts:111
    already replaced this with diff-based detection and admit never adopted it. Port
    that fix so real-TS seeds don't silently drop admissions. Also add an
    auto-resolve-win seed (git-textual-conflict that meaning-commutes) — the pilot's
    meaning-decisive catches are all silent-mismerge; the auto-resolve component is
    still 0.
  needs: >
    Cid: file the tree-scoping blocker as a task (it gates the whole falsifier at
    scale). Loid: decide port-admit-NOOP-from-pick now vs after full run; and whether
    to add the auto-resolve seed before scaling. Coordinator: review + commit the
    harness dir + independently spot-check (re-run `node swarm.mjs && node
    adjudicate.mjs && node aggregate-dogfood.mjs` reproduces from seed-catalog.jsonl)
    and re-confirm live .warpline selvage == …3da228c.
```
