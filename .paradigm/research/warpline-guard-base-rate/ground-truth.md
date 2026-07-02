# Warpline Guard base-rate hits — GROUND TRUTH (Stream B, GUARD-DECIDER)

Move 2 of the ratified sequence. The base-rate run (results.md, 2026-07-01) found
**18 git-clean merges flagged `divergeMeaningOnly`** (14 zod + 3 xstate + 1
nest-ts; 17 in the three primary samples + 1 in the nest TS-stratum — the
"17-18" ambiguity resolves to **18 total, 17 primary**). None had ever been
checked against reality. This document is that check.

Date: 2026-07-02. Agent: Probe (tester). Task: T-2026-07-02-010 / T-2026-07-02-002.

## Headline

**0 REAL-BREAK-AT-MERGE / 3 CAUGHT-LATER / 15 BENIGN-OVERLAP / 0 UNKNOWN** (n=18)

**tsc-differentiation verdict: tsc would have caught 0 of 18** — every hit is
TSC-CLEAN (repo's own typecheck, repo's own pinned TS version, passing at M
*and* both parents; 41+7+3 = 51 commit typechecks, all controlled). Guard is
therefore **not a latency optimization over the typechecker — it is a
different detection class**. The two strongest catches (zod ZodRecord, zod
defaultErrorMap) were invisible to tsc *and* (where testable) to the repo's own
runtime test suite, and were each repaired by a human within 24 hours.

But the panel question cuts the other way too: **no hit was a cross-branch
interaction defect.** In all 3 CAUGHT-LATER cases the repaired defect was
authored entirely on ONE side and shipped through a git-clean merge; the
oracle's knot ("both sides changed this symbol's meaning") was structurally
true but the *interaction itself* broke nothing we could detect in any of
the 18.

## Per-hit table

Class: RB = REAL-BREAK-AT-MERGE, CL = CAUGHT-LATER, B = BENIGN-OVERLAP.
Column A verdict is controlled (M and both parents). "tsc?" = would tsc have caught it.

| # | repo | merge | date | flagged | direct | A: tsc | B: tests | C: fix churn on flagged symbols | tsc? | Class |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | zod | d1982eaf | 2022-12-31 | 1 | 0 | CLEAN | SKIP | none (only unrelated ZodCatch fix +29d) | no | B |
| 2 | zod | 84795b09 | 2022-12-31 | 78 | 3 | CLEAN | SKIP | none on direct syms | no | B |
| 3 | zod | 157f8c56 | 2022-04-04 | 22 | 0 | CLEAN | SKIP | none related (+37d addIssue fix unrelated) | no | B |
| 4 | zod | 66cbfe09 | 2022-03-01 | 2 | 0* | CLEAN | PASS-ALL (M,P1,P2 — type-level defect invisible) | **+1d "Fix record type" rewrites flagged ZodRecord's types** | no | **CL** |
| 5 | zod | c63a5988 | 2022-02-22 | 6 | 0 | CLEAN | SKIP | none on ZodNumber.* | no | B |
| 6 | zod | 9c6e487f | 2021-12-30 | 134 | 2 | CLEAN | SKIP | zero fix-like commits | no | B |
| 7 | zod | 69ff844b | 2021-12-29 | 2 | 0* | CLEAN | **M 11/35 FAIL; P1 35/35 PASS; P2 11/33 FAIL → PRE-EXISTING(P2)** | **+1d "Improve error copy and fix tests" repairs flagged defaultErrorMap** | no | **CL** |
| 8 | zod | 625c28e2 | 2021-12-29 | 67 | 0 | CLEAN | SKIP | bot deno-sync only | no | B |
| 9 | zod | fdd70849 | 2021-10-26 | 134 | 2 | CLEAN | SKIP | none on ZodType.or; avalanche-only matches | no | B |
| 10 | zod | fe5bbf61 | 2021-10-17 | 24 | 2 | CLEAN | SKIP | +1d refine fix is in flagged FILE but on a NON-flagged symbol (ZodEffects) | no | B |
| 11 | zod | 4785fe6f | 2021-10-09 | 176 | 2 | CLEAN | SKIP | ZodEffects fix +9d only via 176-sym avalanche; direct syms untouched | no | B |
| 12 | zod | f4437e6a | 2021-09-25 | 172 | 0 | CLEAN | SKIP | revert +2d reverts a commit NOT in this merge (verified) | no | B |
| 13 | zod | 405e33b0 | 2021-09-12 | 172 | 2 | CLEAN | SKIP | external-TS4.4 churn only | no | B |
| 14 | zod | 7fdfae12 | 2021-09-03 | 48 | 0 | CLEAN | SKIP | TS4.4 compat fix +12d = external cause | no | B |
| 15 | xstate | e66662e1 | 2022-05-25 | 10 | 0 | CLEAN | SKIP | zero graph.ts fixes in window | no | B |
| 16 | xstate | 7b808af4 | 2022-05-25 | 4 | 0* | CLEAN | SKIP | **+2d bad-import fix in flagged TestModel; +6d path-dedup fix behind flagged TestModel.getPaths (failing-test-first PR #3362)** | no | **CL** |
| 17 | xstate | 2d0cf66e | 2022-05-25 | 10 | 0 | CLEAN | SKIP | flags graph.ts only; the TestModel fixes touch a file outside this flag set | no | B |
| 18 | nest | 7c10646a | 2026-04-16 | 2 | 0 | CLEAN | ENV-SUSPECT (2 fail at M — identical at P2 AND at HEAD 2026-07 on node 26 → not merge-caused) | zero touches of sse-stream.ts in 221 descendants | no | B |

`direct` = direct-name-overlap count from the original triage (zod: 13 total;
xstate/nest: heuristic returned 0 — see caveat). `0*` = the name heuristic
missed a de-facto direct contest: in #4 P2 rewrote the `ZodRecord` class
declaration itself, in #7 both sides edited `defaultErrorMap`'s body, in #16
the PR rewired TestModel — the changed lines just don't contain the symbol
name. The "13 direct" figure from results.md is a lower bound on direct
contests, not an exact count.

Avalanche vs direct counts per hit are both recorded in `ground-truth.jsonl`
(fields `flaggedSymbols` / `directContestedSymbols`).

## The three CAUGHT-LATER hits, in detail

**zod 66cbfe09 (strongest single data point for Guard).** PR #752 changed
`ZodRecord` to `Partial<Record<...>>` on one side; master moved on the other;
git merged clean; oracle flagged exactly `{ZodRecord, ZodRecord.create}` — a
2-symbol flag, no avalanche. Ground truth: tsc green at M and both parents;
`record.test.ts` 8/8 green at M and both parents (the defect is type-level —
runtime tests *cannot* see it). Next day the maintainer shipped `ceca9e7722`
"Fix record type", replacing exactly that `Partial<Record>` with a conditional
`RecordType<K,V>`. **Every gate the repo had was green; the defect was real;
a human paid to fix it in <24h; the oracle's flag was the only automated
signal pointing at the right two symbols.**

**zod 69ff844b.** Both sides genuinely edited `defaultErrorMap` (P1: enum-case
message; P2: rewrote too_small/too_big copy, including a doubled
`${issue.minimum}` interpolation bug). Git merged clean. The repo's own tests:
P1 green 35/35, P2 red 11/33, M red 11/35 — the git-clean merge imported a red
branch into green mainline. Fixed next day (`2021a5e07c`) on exactly the
flagged symbol. Not merge-*created* (P2 pre-existing), but a git-clean merge
event that turned mainline red on the flagged symbol.

**xstate 7b808af4.** 4-symbol flag on the xstate-test traversal PR. Two later
fixes land on flagged symbols: +2d `09b7d49dcd` repairs an import of
`xstate/src/utils` (resolves inside the monorepo — so `tsc -b` green — but
breaks published consumers), +6d `3b116e5dbb` (PR #3362, failing-test-first)
repairs path deduplication behind `TestModel.getPaths`. Both defects
single-side-authored, shipped through git-clean merges.

## The precision structure nobody predicted: flag volume inversely predicts payoff

| flag-set size | hits | churn-validated (CL) | precision |
|---|---|---|---|
| ≤ 6 symbols | 6 (#1,4,5,7,16,18) | 3 | **50%** |
| 10-24 symbols | 5 | 0 | 0% |
| ≥ 48 symbols (avalanche) | 7 | 0 | 0% |

All three CAUGHT-LATER hits have tiny flag sets (2, 2, 4). Every avalanche hit
(48-176 symbols, the whole types.ts SCC knotting together) is benign. **The
ranking work item (direct-contested first, ripple folded to a count) is not
just noise control — small knots ARE the product.** A Guard that only speaks
when the knot is ≤ a handful of symbols would have had 50% hit-precision on
this sample while staying silent on all seven avalanches.

## Panel priors, scored

- **Jinx (80% "all benign structural overlap — they shipped in CI-guarded
  repos")**: directionally right, overconfident on "all". 15/18 benign, and
  0/18 were cross-branch interaction breaks — CI-guarded repos indeed never
  shipped a *merge-created* break in this sample. But 3/18 flags sat on
  symbols that received paid human fixes within 1-6 days, and in 2 of those 3
  the repo's full gate stack (git + tsc + tests) was green at M. "All" is
  falsified; "the interaction itself is benign" survived every probe.
- **North ("post-merge fix churn = sellable event")**: correct for 3/18 flags.
  Converting: 275 git-clean merges → 18 flags → 3 churn-validated ≈ **1.1% of
  git-clean merges carry a churn-validated flag** (one per ~92 merges), and
  ~1 per ~6 flags shown. Sellable *if and only if* ranked/thresholded by knot
  size; at raw flag volume (1,250 symbols) it dies of noise, as results.md
  already predicted.
- **The honest wedge sentence**: "Guard flags what your typechecker provably
  cannot see (0/18 tsc catches), and when its knot is small, half the time
  someone pays to fix that exact symbol within days — but it has not yet
  demonstrated a defect *created by* the merge itself." The multi-agent-merge
  pitch (concurrent-edit interaction) remains theoretically motivated but is
  **unevidenced in 275 real merges**; the evidenced pitch is "green-gates
  defect shipping through clean merges, localized to 2-4 symbols."

## Methodology

- **Column A (tsc)**: for each hit, checkout M, P1, P2 in a scratch worktree;
  install with the repo's own toolchain (zod/xstate: `yarn install
  --ignore-scripts`; nest: `npm ci --ignore-scripts`, fallback `npm install
  --legacy-peer-deps` where M/P1's committed lockfile was out of sync with
  package.json — upstream's desync, recorded in jsonl); run the repo's own
  typecheck (zod: `tsc --noEmit -p tsconfig.json`, era TS 4.3.5→4.6.2; xstate:
  `tsc -b tsconfig.monorepo.json`; nest: `tsc -b packages`, TS 5.9.3) with the
  repo-pinned compiler. 51/51 runs PASS. Negative control: an injected type
  error at a zod checkout was correctly detected, so the harness can fail.
- **Column B (tests)**: run where cheap and decision-relevant; 3 of 18 hits
  tested (targeted suites near contested symbols), 15 SKIPPED under the
  timebox. nest's 2 sse failures reproduce identically at P2 and at repo HEAD
  (2026-07) under node v26 → environmental/pre-existing, not merge-caused.
- **Column C (churn)**: for each hit, all descendant commits (ancestry-path,
  window = first 30 descendants ∪ 30 days) diffed against the files of the
  contested symbols; fix-like messages
  (`fix|revert|hotfix|regression|broke|bug`) manually adjudicated against the
  flagged symbol list — a fix in the same *file* but on a non-flagged symbol
  does NOT count (that discipline flipped fe5bbf61 to benign); avalanche-only
  matches (symbol in a 100+ flag set) do NOT count.
- **Lens caveat (T-2026-07-02-008)**: the lens used for the original run has a
  confirmed false-EQUAL hole — decorators/modifiers invisible. That hole
  causes MISSED flags, never spurious ones: these 18 were raised on real
  structural inequality, the 6.2% event rate is a **lower bound**, and
  decorator-native nest especially understates. Ground-truthing the 18 is
  unaffected; a re-run with the fixed lens (Stream A) may surface NEW hits
  that need the same treatment.
- **Attribution caveat**: "direct-contested" counts use the original
  name-in-hunk heuristic (13 across zod, 0 xstate/nest) — demonstrated here to
  be a lower bound (3 de-facto direct contests scored 0). Span-overlap ranking
  (the planned engine change) is the right fix.
- Environment: node v26.0.0, npm 11.12.1, yarn 1.22.22, macOS. Scratch
  worktrees off the prior session's full clones; a-paradigm repo untouched;
  no warpline source modified; nothing committed.

## What was and wasn't covered

Covered: all 18 hits, all three columns (Column B: 3 ran, 15 SKIPPED —
recorded per-hit). No UNKNOWNs in classification. Not covered: xstate/nest
test suites at M (monorepo jest/mocha era-runner cost exceeded per-hit
timebox); re-run with decorator-fixed lens (Stream A dependency); the
direct-contested span-ranking re-run (open engine work, T-2026-07-02-002
second half).

## Artifacts

- Raw per-hit records: `ground-truth.jsonl` (this dir) — per-hit tsc M/P1/P2
  status, test outcomes, churn windows, fix-like commit lists, interpretations.
- Working data (session scratchpad, ephemeral): tsc-{zod,xstate,nest}.json,
  columnC.json, gt-*.mjs drivers.
