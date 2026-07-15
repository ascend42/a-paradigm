# LLM-judge falsifier (KS-F) — RESULTS

Task T-2026-07-14-004 / T-2026-07-15-002. Agent: Jinx (advocate), Probe-rigor.
Run: 2026-07-15. Judges: 36 fresh Claude Sonnet subagents, fully blind (never
told about Warpline/Guard/flags), one per case, identical neutral prompt
(protocol.md). Full coverage: all 18 hits + 18 matched controls — the minimum-
viable fallback was not needed.

## THE VERDICT

**Neither of Jinx's clean outcomes obtained. The judge missed 2 of the 3
caught-later defects — including the flagship — so the kill condition ("LLM
judge matches 3/3 at tolerable false-flag rate → detector is a purity tax")
is decisively FALSIFIED and the deterministic-detection wording is ARMORED on
the tested axis. But the run opened a new wound nobody predicted: the judge's
single "false flag" on a control was a REAL, same-day-fixed, merge-CREATED
cross-branch interaction defect — the only genuine merge-created break found
anywhere in this corpus — in a merge the Guard oracle had classified
CONVERGENT.**

Detail, per the 3 caught-later hits:

1. **zod 66cbfe09 (ZodRecord Partial<Record>, THE key case): MISSED.** The
   judge (case-20) looked directly at the `Record -> Partial<Record>` change,
   named `ZodRecord` in its symbols array, and judged it "self-contained and
   accompanied by matching test updates" — flag no, confidence 0.65. The
   defect was fully visible, untruncated, in a 65-line side diff. This is the
   cleanest possible falsification of "a frontier reviewer would have caught
   it": the reviewer stared at it and passed it.
2. **zod 69ff844b (defaultErrorMap): CAUGHT, exactly.** Case-18 flagged yes
   (0.72) and named the precise mechanism — the doubled `${issue.minimum}`
   interpolation in the too_small branch — the very defect fixed next day by
   `2021a5e07c`. Perfect symbol + mechanism match.
3. **xstate 7b808af4 (TestModel import + getPaths dedup): MISSED, with an
   asterisk.** Verified pre-judging: neither defect's lines (`xstate/src/utils`
   import, `pathGeneratorWithDedup` logic) appear in either side's diff vs this
   merge's base — both predate the base. A diff-only reviewer structurally
   cannot see them. (This also complicates Guard's own credit for this hit:
   the churn-validated defect is not IN the flagged merge's delta; the flag
   localized the right symbols anyway.) Judge said no (0.6) after correctly
   reconstructing that the visible TestModel changes compose cleanly.

**Sensitivity on the caught-later set: 1/3 (right defect at right symbol).**

## The control-side shock: case-13

Control xstate `72058a08` (oracle verdict CONVERGENT, `divergeMeaningOnly`
empty) was flagged by its blind judge at **0.88 — the highest confidence of
the entire run** — with a fully specific claim: side 1 (e2a99426c, 2022-05-27)
added a test expecting the old `#(machine).a` description format; side 2
(46e886deb, 2022-05-31) changed `getDescription()` to the bare-path format;
git merged clean; the merged test must fail.

Verified TRUE: `f6d20164c` "Fixed `@xstate/test` tests after test output
change (#3371)", 2022-05-31 (same day), a descendant of the merge, repairs
exactly the 2 expectation lines the judge named.

This is the defect class the Guard pitch is FOR — two sides individually
green, broken only in combination — and it is the only instance of that class
found in the whole 275-merge corpus (the base-rate study found 0). The Guard
oracle missed it **by design**: no single symbol was contested by both sides.
The interaction is cross-symbol (side 2 changed a function's output; side 1
changed a test string literal that encodes that output). Contested-symbol
knot detection cannot represent it.

## Confusion tables

Vs Guard's flag (does the blind judge reproduce the flag set?):

|                  | judge yes | judge no |
|------------------|-----------|----------|
| Guard hit (18)   | 6         | 12       |
| control (18)     | 1         | 17       |

Vs churn-validated defects (4 in sample: 3 CL hits + case-13's control merge):

|                        | judge yes | judge no |
|------------------------|-----------|----------|
| validated defect (4)   | 2 (TP)    | 2 (FN)   |
| no validated defect (32)| 5 (FP)   | 27 (TN)  |

- Judge: precision 2/7 = 29%, recall 2/4 = 50%.
- Guard (same 36-case frame): TP 3, FN 1 (case-13), FP 15, TN 17 → precision
  3/18 = 17%, recall 3/4 = 75%. At the knot-size ≤6 threshold (the ranked
  product posture): precision 3/6 = 50%, recall 3/4 = 75%.
- Raw flag rates asked for by the protocol: (a) caught-later sensitivity
  **1/3**; (b) benign-hit flag rate **5/15 = 33%**; (c) control false-flag
  rate **1/18 = 5.6% raw — 0/18 after adjudication** (the one flag was true).
- Within Guard's hits the judge's flag carries no signal for which flags were
  the paying ones: 1/3 CL flagged vs 5/15 benign flagged — 33% both.
- Population-level, Guard-flagged merges do "look riskier" even blind
  (6/18 vs 1/18) — consistent with the knots being real structural overlap.

Judge FP texture (the 5 benign-hit flags): 2 are textually verified REAL
latent single-side facts (case-26: unquoted `typeof Promise !== undefined` in
parseUtil.ts at M — genuinely broken guard, unchanged until Zod 4 #4074;
case-15: `for..in` extraKeys hazard — present, never churn-validated), 1 is
textually accurate but reads as deliberate (case-04, comment says "don't
abort early"), 2 are speculative/truncation-driven (case-07 conf 0.55,
case-30 conf 0.4). Confidence does NOT rescue precision: the two
highest-confidence yes flags were 0.88 (true, control) and 0.8 (case-26,
latent-but-real); thresholding at ≥0.7 gives 3 flags / 2-ish true; the
flagship miss stays missed at any threshold.

## Cost + latency (d)

| metric | LLM judge (Sonnet, blind subagent) | Guard oracle |
|---|---|---|
| latency/case | min 8.1s / median 38.9s / mean 51.1s / max 223.5s | 1.4–5.4s |
| determinism | none (single sample; confidences 0.4–0.95) | bit-stable |
| tokens/case | mean 49.4k (total 1.78M for 36) | 0 |
| est. cost/case | ~$0.15 (chars/4, Sonnet $3/M in + small out; est., not metered) | ~$0 marginal |
| cost for the 275-merge sweep | ~$41 + ~3.9 judge-hours serial | minutes, $0 |

## What this buys and what it costs (honest wording guidance)

Armored:
- "Deterministic detection" survives as a claim about THIS detector: a blind
  frontier reviewer did not reproduce the catches (1/3), passed the flagship
  defect while looking straight at it, is ~10-40x slower, ~$0.15/merge, and
  non-deterministic. Earlier+deterministic+attributed+cheap stands.
- The zod 69ff844b catch shows a competent LLM CAN match Guard on the
  runtime-visible case — but only 1/3, and it cannot be scheduled to.

Wounded (new, must appear in any honest README/benchmark):
- Guard's knot detector missed the corpus's only true merge-created
  interaction defect (case-13), which a $0.15 LLM pass caught at 0.88 blind.
  Contested-symbol overlap is provably not a superset of merge risk: it is
  symbol-LOCAL. Cross-symbol semantic dependencies (function output ↔ test
  expectation; producer ↔ consumer across files) are invisible to it by
  construction.
- Therefore the README must NOT say or imply Guard's flags bound merge risk,
  and must not use "detects what reviewers can't" unscoped. Evidenced scope:
  "deterministically flags contested-symbol knots your typechecker and tests
  provably missed (0/18 tsc, 3 paid fixes), in seconds, attributed to
  symbols." The complement — an optional LLM lane for cross-symbol
  interaction risk on the ~6% of merges Guard already knots, or on
  test-adjacent producer/consumer pairs — is now EVIDENCED as catching a
  class Guard cannot, and belongs on the roadmap, not in the detection claim.

## Caveats

- n=3 (4 with case-13) validated defects; one judge family (Sonnet), one
  sample per case, no ensembling. A stronger judge or best-of-3 could flip
  case-20; the kill condition (3/3) was still decisively unmet in the honest,
  single-pass, blind setting a real team would deploy.
- Judges saw capped diffs (400 lines/side); truncation was verified NOT to
  hide the flagship defect (case-20's Side 2 was complete) but did feed two
  speculative FPs (case-07, case-30). Ten of 36 cases had a truncated side.
- Control "cleanliness" is defined by the oracle (divergeMeaningOnly empty),
  which case-13 proves is not the same as defect-free; controls were not
  independently churn-audited beyond case-13.
- Guard-side numbers (1.4–5.4s, knot-size precision) inherited from
  results.md / ground-truth.md, not re-measured here.

## Files

- `protocol.md` — design, exact prompts, deviations (incl. case-08 visibility
  check and the case-13 adjudication).
- `cases.jsonl` — 36 blinded cases (kind/class/SHAs/base/sizes/truncation).
- `judgments.jsonl` — per-case judge output + tokens/latency + scoring notes.
- Working data in session scratchpad `llm-judge/` (clones, extract.mjs,
  control-pool.json, cases/*.txt payloads). Nothing committed; no packages/
  source, no live .warpline touched.
