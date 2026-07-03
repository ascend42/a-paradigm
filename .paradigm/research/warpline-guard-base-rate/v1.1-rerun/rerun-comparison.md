# Warpline Guard base-rate — v1.1 lens RE-RUN (comparison vs v1)

Second half of the lens-fix follow-through (T-2026-07-02-002 context; lens fix
= T-2026-07-02-008, commit `9b49f22d`, CCNF v1.1). Question: the v1 lens had a
confirmed false-EQUAL hole (decorators/modifiers invisible → MISSED flags), so
the measured 6.2% was a lower bound. Does the fixed lens raise the base rate,
and does it surface new hits — especially in decorator-native nest?

Date: 2026-07-02/03. Agent: Probe (tester). Tool: `packages/warpline/dist/cli.js`
built from `9b49f22d` (verified: `CODE_ESSENCE_TAG v1.1` present in dist, no src
newer than build; runtime-verified: 116 new content-addressed state files with
the v1.1 tag written during the re-run — the version fence re-addressed every
essence, so the comparison is not vacuous).

## Headline: NOTHING CHANGED at the hit level

**Same 360-merge corpus (derived commit-for-commit from the original results
JSONLs), 360/360 ok, 0 errors, 0 timeouts. 0 hits gained, 0 hits lost, 0 hits
with a changed flag-symbol set.** The 6.2% base rate, the 18-hit inventory, the
per-hit flag sets, and therefore the entire ground-truth classification
(0 RB / 3 CL / 15 B) and the knot-size precision structure carry over to v1.1
unchanged.

| repo | merges | git-clean | hits v1 | hits v1.1 | rate v1 (of clean) | rate v1.1 | gained | lost | changed set |
|---|---|---|---|---|---|---|---|---|---|
| zod | 120 | 107 | 14 | 14 | 13.1% | **13.1%** | 0 | 0 | 0 |
| xstate | 100 | 84 | 3 | 3 | 3.6% | **3.6%** | 0 | 0 | 0 |
| nest | 100 | 84 | 0 | 0 | 0.0% | **0.0%** | 0 | 0 | 0 |
| nest-ts | 40 | 39 | 1 | 1 | 2.6% | **2.6%** | 0 | 0 | 0 |
| **overall (primary)** | **320** | **275** | **17** | **17** | **6.2%** | **6.2%** | **0** | **0** | **0** |

(18 total hits incl. the nest TS-stratum, exactly as before.)

The "6.2% is a lower bound; nest especially understates" caveat is now
**resolved empirically: on this corpus the lower bound was tight.** The
decorator/modifier hole caused zero missed hits here — closing it changed no
merge-level verdict and no flagged-symbol set anywhere in 360 merges.

## But the lens fix is NOT a no-op: it sees more, one side at a time

Field-level diff over all comparable fields (verdict, score, agreeClean,
autoClean, all divergence lists, knot symbol sets): zod and nest are
byte-identical; **14 merges in xstate/nest-ts show changed delta counts** —
v1.1 surfacing modifier/decorator changes that v1 could not see. In every one
of the 14, the newly-visible change was on ONE side only, so it landed in
`autoClean`/`agreeClean` (auto-mergeable), never formed a knot:

| repo | merge | change (v1 → v1.1) |
|---|---|---|
| xstate | 2f362327a1 (git-conf) | autoClean 555→556 |
| xstate | a95d9aaac6 (git-conf) | agreeClean 463→464, autoClean 530→531 |
| xstate | 65e23a6173 (git-conf) | agreeClean 440→441, autoClean 448→449 |
| xstate | bfbd169644 (git-conf) | autoClean 447→448 |
| xstate | 4f8e989036 (git-conf) | autoClean 445→446 |
| xstate | 2d25c9af7d (git-conf) | autoClean 384→385 |
| xstate | 225218f7b4 (git-conf) | autoClean 430→431 |
| xstate | 5fc72ab675 (clean) | agreeClean 43→44, autoClean 43→44 |
| xstate | e8256e52ba (clean) | agreeClean 43→44, autoClean 43→44 |
| xstate | f9d33a11d7 (clean) | agreeClean 23→26, autoClean 23→26 |
| nest-ts | 49c69a6e88 (clean) | agreeClean 102→101, autoClean 102→101 |
| nest-ts | 21b99e7912 (clean) | agreeClean 8→7, autoClean 8→7 |
| nest-ts | b42536c27f (clean) | agreeClean 8→7, autoClean 8→7 |
| nest-ts | 0ca5440044 (clean) | agreeClean 14→20, autoClean 14→20 |

Determinism control: zod's 120 merges reproduced byte-identically across the
two runs (different days, same lens inputs modulo the fix) — the oracle is
deterministic, so the 14 diffs are real lens-behavior changes, not noise.

**Honest open item — the nest-ts DECREASES (102→101, 8→7 ×2).** A strictly
finer-grained essence should only ADD visible deltas; three nest-ts merges
show one FEWER auto-clean delta. Plausible mechanism: essence-level dedup or
the rename-detector matching differently once previously-colliding units
(false-EQUAL under v1) got distinct v1.1 essences — a count bookkeeping shift,
not a lost knot (knot sets are identical everywhere). Not chased to
root-cause: the v1 build no longer exists in dist and none of these merges is
a hit under either lens, so it cannot affect the headline. UNKNOWN at the
mechanism level; flagged for the next lens-internals session if anyone cares.

## New-hit ground truth

**Vacuous — there are no new hits.** Nothing to classify; the established
0 REAL-BREAK / 3 CAUGHT-LATER / 15 BENIGN-OVERLAP table in `../ground-truth.md`
stands as the ground truth for the v1.1 lens too, since the flag sets are
identical per hit.

## Knot-size distribution (v1.1 = v1, re-verified per hit)

All 18 per-hit flag-set sizes identical to the original run:

| flag-set size | hits | churn-validated (CL) | precision |
|---|---|---|---|
| ≤ 6 symbols | 6 (zod d1982eaf 1, 66cbfe09 2, 69ff844b 2, c63a5988 6; xstate 7b808af4 4; nest 7c10646a 2) | 3 | **50%** |
| 10–24 | 4 (xstate e66662e1 10, 2d0cf66e 10; zod 157f8c56 22, fe5bbf61 24) | 0 | 0% |
| ≥ 48 (avalanche) | 8 (48, 67, 78, 134, 134, 172, 172, 176) | 0 | 0% |

Bookkeeping correction to `../ground-truth.md`: its bucket table reads
"10–24: 5 / ≥48: 7", which misfiles zod 84795b09 (78 flags) into the middle
bucket. Correct split over the same 18 sizes is 6 / 4 / 8. Both affected
buckets have 0 churn-validated hits either way — the 50%-vs-0% precision
finding is unchanged.

The "small knots ARE the product" finding survives the lens fix untouched.

## What this means for Guard

1. **The v1 numbers are now clean.** The one methodological asterisk on the
   base-rate experiment ("lens had a known false-EQUAL hole") is discharged:
   re-measured with the hole closed, every number reproduces. 6.2% / 13.1%
   zod / knot-size precision structure are v1.1-certified.
2. **The decorator hole was a correctness liability, not a recall gap, on
   real merge traffic.** Real-world concurrent decorator/modifier edits to
   the same symbol were absent from 360 merges spanning 2021–2026 across
   three repos. The fix still matters (the false-EQUAL classes were
   adversarially exploitable and the whitelist was silently lossy), but it
   bought integrity, not new catches, on this corpus.
3. **Cost profile unchanged**: median 1.7 s (zod) / 2.3 s (xstate) / 4.7 s
   (nest) per merge — v1.1 serialization added no measurable overhead.

## Coverage / honesty

- Covered: all 360 corpus merges re-run (exact same merge+parent triples,
  derived from the original JSONLs), full field-level diff, determinism
  control, per-hit flag-size re-verification. 0 errors / 0 timeouts.
- Skipped: root-cause of the 3 nest-ts autoClean decreases (needs a v1 build
  side-by-side; no hit affected); no new tsc/test/churn runs (no new hits to
  ground-truth).
- Not touched: warpline source, the original experiment artifacts, git state.
  Ranking half of T-2026-07-02-002 remains open.

## Artifacts (this dir)

- `results-{zod,xstate,nest,nest-ts}-v11.jsonl` — raw per-merge oracle records
- `cmp-{zod,xstate,nest,nest-ts}.json` — machine per-merge v1↔v1.1 comparison
- `compare.mjs`, `driver-list.mjs` — the exact scripts used
- Original run + ground truth: `../results.md`, `../ground-truth.md`
