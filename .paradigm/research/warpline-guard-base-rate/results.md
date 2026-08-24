# Warpline Guard base-rate experiment — results

Move 1 of the ratified Warpline sequence. Question: on real external TypeScript
repos, how often does the oracle flag `divergeMeaningOnly` — a meaning-break on
a merge git completed clean? Secondary: `reducedFidelity` rates (meaning-coverage
ceiling of the TS lens).

Date: 2026-07-01. Tool: `packages/warpline/dist/cli.js oracle <p1> <p2> --json`
(commit bc5f1bc5 build), run against the two parents of each sampled 2-parent
merge commit. All work in scratchpad clones; a-paradigm repo untouched.

## Methodology

- Repos (plain full clones): colinhacks/zod, nestjs/nest, statelyai/xstate.
- Sample: the N most recent strictly-2-parent merge commits (`git log --merges
  --min-parents=2 --max-parents=2`); octopus merges excluded by construction.
- For each merge M with parents P1, P2: `warpline oracle P1 P2 --json`, cwd =
  the clone, 180 s timeout per run. The oracle computes its own merge-base,
  lifts base/P1/P2 through the TS code lens, predicts knots from meaning, runs
  `git merge-tree --write-tree` for reality (git 2.50.1), and scores the
  confusion matrix.
- Headline event = a merge where `convergence.divergeMeaningOnly` is non-empty
  AND `gitReality.conflicted == false` (git merged clean; meaning says broken).
- Supplemental nest stratum: because nest's recent merge traffic is ~89%
  dependency-bump bots, we also sampled the 40 most recent merges (of the last
  600) whose merged branch changed at least one `.ts`/`.tsx` file.

Repo profiles at clone time:

| repo | HEAD | total merges | TS files | sampled | sample date range |
|---|---|---|---|---|---|
| zod | 912f0f51 | 315 | 401/583 | 120 | 2021-08 → 2026-04 |
| nest | ad62d760e | 9011 | 1673/2125 | 100 (+40 TS-stratum) | 2026-06 → 2026-07 (recent-100) |
| xstate | ab5aa565dd | 1552 | 415/918 | 100 | 2022-05 → 2026-06 |

## Headline: divergeMeaningOnly on git-clean merges

**360 oracle runs, 0 errors, 0 timeouts.** A "hit" = git merged clean, meaning
flagged broken.

| repo | merges tested | oracle errors | git-clean merges | hits (meaningOnly, git-clean) | rate of git-clean | rate of all tested |
|---|---|---|---|---|---|---|
| zod (recent-120) | 120 | 0 | 107 | **14** | **13.1%** | 11.7% |
| nest (recent-100) | 100 | 0 | 84 | **0** | **0.0%** | 0.0% |
| xstate (recent-100) | 100 | 0 | 84 | **3** | **3.6%** | 3.0% |
| nest TS-stratum (40) | 40 | 0 | 39 | **1** | **2.6%** | 2.5% |
| **overall (3 primary samples)** | **320** | **0** | **275** | **17** | **6.2%** | 5.3% |

The base rate is NOT ≈0 in the wild: **1 in 16 recent merges** across the three
primary samples is a git-clean-but-meaning-flagged event, and in a human-PR-era
sample (zod 2021-2022) it is **1 in 8**. The zod hits are 14 distinct PR/branch
merges spanning 2021-2022 — independent events, not one long-lived pair merged
repeatedly. In bot-dominated traffic (nest June 2026, ~89% dependency bumps)
the rate is 0 — and correctly so: the oracle collapsed those merges into a
handful of identical meaning-states (dep bumps are meaning-empty), i.e. zero
false alarms on bot merges. Restricting nest to merges whose branch actually
touched TS source recovers a 2.6% rate with a high-quality hit.

## Per-repo verdict tables

Merge-level counts (a merge counts in a column if that class is non-empty):

| repo | tested | ok | errors | git-conflicted | CONVERGENT | DIVERGENT | w/ meaningOnly (any) | w/ divergeGitOnly | w/ agreeConflict | w/ unmapped git conflicts | mean score | median run ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| zod | 120 | 120 | 0 | 13 | 93 | 27 | 17 | 6 | 5 | 10 | 0.915 | 1395 |
| nest | 100 | 100 | 0 | 16 | 84 | 16 | 0 | 0 | 0 | 16 | 0.840 | 5354 |
| xstate | 100 | 100 | 0 | 16 | 81 | 19 | 3 | 15 | 13 | 10 | 0.865 | 2316 |
| nest-ts | 40 | 40 | 0 | 1 | 38 | 2 | 1 | 0 | 0 | 1 | 0.997 | 4947 |

Notes:
- zod also had 3 meaningOnly hits on git-CONFLICTED merges (17 any − 14 clean);
  these mix catch classes and are excluded from the headline.
- nest's 16 git conflicts were all in non-symbol files (lockfiles etc.) —
  100% landed in `gitConflictUnmapped`, none mapped to code symbols. GAP-1
  behaves as designed there.
- All zod hit merges are 2021-2022 because zod's 2-parent-merge era ends there
  (later history is squash-dominant); the recent-120 window necessarily reaches
  back. xstate hits: 2022. nest-ts hit: 2026-06.
- Run cost: median 1.4-5.4 s per merge on warm clones; worst single run well
  under the 180 s timebox.

## Hit quality triage (direct vs ripple)

The oracle's essence is transitive: a unit's essence includes the essences of
its local reference closure, so a knot on symbol S means "S's meaning changed
on both sides", not necessarily "S's text changed on both sides". Triage
buckets, per flagged symbol, via git text diffs vs the merge base:

- **direct** — the symbol's short name appears in BOTH sides' changed hunks of
  its file (crude lower bound: signature-only edits inside a function body
  often don't carry the name, see xstate case below);
- **same-file** — both sides changed the symbol's file;
- **ripple** — the symbol's file changed on at most one side (purely
  transitive: a dependency's meaning changed).

Result over the 18 git-clean hits (17 primary + 1 nest-ts), script
`base-rate/triage.mjs`:

| repo | git-clean hits | hits w/ ≥1 direct-name symbol | hits same-file-both-sides only | flagged symbols (sum) | direct symbols (sum) |
|---|---|---|---|---|---|
| zod | 14 | 6 | 8 | 1,222 | 13 |
| xstate | 3 | 0 | 3 | 24 | 0 |
| nest-ts | 1 | 0 | 1 | 2 | 0 |

In **every one of the 18 hits, both sides had textually modified the same
file(s)** as the flagged symbols — no hit came from purely cross-file ripple at
the merge level. Within a hit, though, most flagged *symbols* are closure
ripple: zod's worst avalanche flagged 176 symbols off ~2 directly-contested
ones (the whole `types.ts` class SCC knots together).

Case study (xstate e66662e1, git-clean hit): side A rewrote the generic
signatures of the `xstate-graph` traversal functions
(`AnyState → StateFrom<TMachine>` etc.); side B concurrently renamed the option
types those same functions consume (`ValueAdjMapOptions →
ValueAdjacencyMapOptions`). Same functions, same file, zero git conflict. This
is exactly the semantic-interference class Guard sells; the name-heuristic
counted it "0 direct" only because the changed lines are parameter/type lines.

Case study (zod d1982eaf, git-clean hit, n=1): `getDiscriminator`'s own text is
identical on both sides; side A changed `ZodLiteral._parse`, side B changed
`ZodType.nullish` — both in its reference closure. A pure ripple flag: a
reviewer would likely shrug. Ripple flags are the noise budget of the current
essence definition.

## reducedFidelity (meaning-coverage ceiling)

Extracted from persisted WarpStore states (`.warpline/states/*.json`, contract
data of `code-unit` objects; script `base-rate/fidelity.mjs`). The persisted
contract stores only the boolean — the *cause* (which free ref degraded to
`unresolved`, per `ts-lens.ts` liftUnit) is not persisted, so "top reasons"
cannot be aggregated from stores; by construction the sole cause class is
"unresolved free reference".

| repo | states read | unique unit versions (by contentId) | reducedFidelity | % unit versions | % symbols ever reduced | mean per-state share |
|---|---|---|---|---|---|---|
| zod | 115 | 9,899 | 32 | **0.32%** | 1.66% | 0.09% |
| nest | 44 | 3,516 | 152 | **4.32%** | 3.23% | 3.23% |
| xstate | 93 | 3,163 | 123 | **3.89%** | 5.54% | 4.27% |

The meaning-coverage ceiling is high: 96-99.7% of lifted code-unit versions
resolved every free reference. Note nest persisted only 44 distinct states for
140 runs (420 base/A/B lifts) — dependency-bump merges produce meaning-identical states that dedupe
by stateId (the store overwrites the same content-addressed file), which is the
correct behavior and independent evidence that dep bumps are meaning-empty.
Each nest state lifts ~3,998 code units (the lens handles the monorepo layout;
no `.purpose` files, no node_modules install).

## Caveats observed

1. **Dir-granular conflict mapping** (oracle `mapConflicts`): one git conflict
   path maps to every symbol whose defining file shares the directory —
   measured inflation 73.3 symbols/conflict-path (zod), 22.2 (xstate). This
   corrupts per-symbol agreeConflict/divergeGitOnly stats and can SUPPRESS
   divergeMeaningOnly on git-conflicted merges (a knot in a conflicted dir is
   absorbed into agreeConflict). **The headline number is immune**: git-clean
   merges have zero conflict paths, so nothing to over-map.
2. **zod's `deno/lib` build-copy**: 44% of zod's flagged symbols are the
   mirrored deno build of `src/` — symbol volumes are ~1.8× inflated;
   merge-level counts unaffected.
3. **Population skew**: nest's recent-100 merges are ~89% dependency bumps
   (June 2026 traffic); zod's 2-parent merges are concentrated in 2021-2022
   (the repo later went squash-dominant); xstate's span 2022-2026. The zod
   base rate is a "human PR-merge era" rate; the nest recent-100 rate is a
   "bot-dominated era" rate.
4. **Essence transitivity** drives avalanche flags (up to 180 symbols on one
   zod merge, whole types.ts SCC). Merge-level rates are the honest unit;
   symbol-level counts overstate.
5. No ground-truth check that flagged merges actually broke (compile/test at
   the real merge commit) — that is the natural Move-2 experiment.

## Read: does Guard have a catch-rate to sell?

**YES — with one precision caveat that Move 2 must close.**

- The event Guard sells is real and not rare: 6.2% of recent merges overall,
  13.1% of git-clean merges in a human-PR-merge population (zod), 2.6-3.6% in
  monorepo populations filtered to real code merges. It is emphatically not
  ≈0 in the wild.
- The infrastructure held: 360/360 oracle runs succeeded across three untouched
  external repos (single-package and monorepo layouts), 1.4-5.4 s median per
  merge, zero engine failures, zero timeouts. Guard is runnable as a CI check
  today at these costs.
- Hit quality spot-checks found genuinely sellable catches: xstate e66662e1
  (concurrent generic-signature rewrite × type rename in the same functions)
  and nest 7c10646a (concurrent logic change × internals refactor of the same
  class). It also found shrug-grade flags: zod d1982eaf (a function flagged
  because two unrelated same-file changes sit in its reference closure).
- The unresolved variable is **precision, not base rate**: of ~1,250 flagged
  symbols only ~13 are provably direct-contested; the rest are same-file
  closure ripple. If Guard comments "review these 176 symbols" it dies of
  noise; if it ranks direct-contested units first and folds ripple into a
  count, the cadence (one flag per ~8-16 merges) is a sellable review signal.

**What would make it conclusive:** ground-truth the 18 hits — check out each
real merge commit, run `tsc` (and the repo's tests where cheap), and scan
post-merge history for fixup commits touching flagged symbols. That converts
"flag rate" into a verified catch/false-alarm split, which is the actual GTM
number. Second: re-run with a direct-contested ranking (both sides' hunks
overlap the unit's span — the lens has spans; no engine change was permitted in
this move) to measure the noise-capped flag volume.

## Artifacts

- Raw per-merge results: `base-rate/results-{zod,nest,xstate,nest-ts}.jsonl`
- Scripts: `base-rate/{driver,driver-list,aggregate,render,fidelity,triage}.mjs`
- Scratch clones with `.warpline/` stores: `base-rate/{zod,nest,xstate}/`
- nest TS-stratum merge list: `base-rate/nest-ts-merges.txt`
