# LLM-judge falsifier (KS-F) — protocol

Task T-2026-07-14-004 / DAG T-2026-07-15-002. Agent: Jinx (advocate), Probe-rigor.
Orchestration orch-mrls0vbc-qryc. Date: 2026-07-15.

## Question

Would a frontier-LLM code reviewer, WITHOUT Warpline, flag the defects Warpline
Guard flagged on git-clean merges? Falsifier for the "deterministic detection"
wording, run before the Guard README/benchmark are written.

## Design

- 18 HITS: all 18 `divergeMeaningOnly` flags ground-truthed in
  `.paradigm/research/warpline-guard-base-rate/ground-truth.{md,jsonl}`
  (3 CAUGHT-LATER, 15 BENIGN-OVERLAP).
- 18 CONTROLS: git-clean merges from the same repos with EMPTY
  `divergeMeaningOnly` in the original 275-run oracle sweep
  (results-{zod,xstate,nest,nest-ts}.jsonl; filters: ok, mergeClean,
  !gitConflicted, divergeMeaningOnly=[], not in the hit set). Repo composition
  matched to hits (14 zod / 3 xstate / 1 nest), era-windowed to the hits' date
  ranges (zod 2021-08..2023-02, xstate 2022-03..2022-08, nest 2025-10..2026-07),
  and greedily matched on log-total-changed-lines (nearest unused candidate,
  scored over a seeded-shuffle prefix of ~3x the needed count per repo).
- BLIND: all 36 cases shuffled (seeded LCG, seed 424242) into case-01..case-36;
  one FRESH judge subagent per case (Claude Code Agent tool, subagent_type
  general-purpose, model "sonnet"); identical prompt template; no mention of
  Warpline, Guard, flags, or that any case is special.

## Merge-view extraction (what the judge sees)

For merge M (parents P1, P2): base = `git merge-base P1 P2`;
Side 1 = `git diff base P1`, Side 2 = `git diff base P2` — i.e. what each
branch did since divergence, the standard reviewer view of a merge.

Mechanical filter, identical for hits and controls:
`:(exclude)deno/**` (zod's bot-generated mirror duplicates src/ byte-for-byte),
`:(exclude)**/yarn.lock`, `:(exclude)**/package-lock.json`, `:(exclude)**/*.lock`,
`:(exclude)**/*.md` (docs). Default -U3 context. Cap 400 diff lines per side,
head truncation with an inline `[... TRUNCATED: showing first 400 of N ...]` note.

## Judge prompt (exact template)

Each case file `case-NN.txt` contains:

```
# Merge review task

Two branches in the repository "<repo>" were merged cleanly by git (no textual
conflict — git auto-merged without any overlap markers). Below are the two
sides' diffs against their common merge base.

Each side may look fine in isolation. Review the COMBINATION: is anything
broken by the merge itself, or shipping through it despite both sides looking
fine alone? Consider semantic interactions — one side changing the meaning,
signature, or typing of something the other side relies on or also modified; a
defect on either side that the other side's types/tests would not catch;
behavioral drift where both sides touched the same symbol.

Some diffs are truncated (noted inline where so).

## Side 1 diff (merge base -> first parent)
```diff
<side A, capped 400 lines>
```
## Side 2 diff (merge base -> second parent)
```diff
<side B, capped 400 lines>
```
## Your answer

Reply with ONLY a JSON object, no other prose:

{"flag": "yes"|"no", "confidence": <number 0-1>, "symbols": [...], "reason": "<1-3 sentences>"}

Flag "yes" only if you believe a real defect or high-risk semantic interaction
ships in the merged result — not for style issues or for mere proximity of
changes.
```

Judge subagent wrapper prompt (identical for all cases):

```
You are a senior code reviewer. Read the file <abs path>/cases/case-NN.txt with
the Read tool and perform exactly the review task it describes. Constraints:
use ONLY the Read tool, and only on that one file — do not read any other
file, do not search, do not run commands, do not browse. Your entire final
message must be ONLY the JSON object the file asks for.
```

## Scoring

- (a) Sensitivity on the 3 CAUGHT-LATER: flag=yes AND right defect at right
  symbol (fuzzy: mentions ZodRecord/Partial<Record> for zod 66cbfe09;
  defaultErrorMap/minimum-interpolation for zod 69ff844b; TestModel/getPaths/
  import for xstate 7b808af4).
- (b) flag rate on the 15 BENIGN-OVERLAP hits.
- (c) false-flag rate on the 18 controls.
- (d) latency + estimated cost per judgment vs Guard's 1.4-5.4s deterministic runs.

## Deviations / constraints (documented)

1. **Diff filter** (deno mirror, lockfiles, .md) is a refinement, not in the
   original protocol text: without it, zod's alphabetical file order would burn
   the 400-line cap on the byte-identical `deno/lib` mirror. Applied identically
   to hits and controls.
2. **Control sizing**: sizes computed only over a ~3x-needed seeded-shuffle
   prefix per repo (blobless clones make full-pool sizing expensive); matches
   are rough on the largest hits (e.g. hit 8757 lines -> control 1068). One zod
   candidate (abbf3254) skipped: promisor fetch failure ("commit graph file but
   not in the object database") in the blobless clone.
3. **case-08 (xstate 7b808af4, CAUGHT-LATER) defect-visibility constraint**:
   verified before judging that NEITHER later-fixed defect's lines (the
   `xstate/src/utils` import, the `pathGeneratorWithDedup` dedup logic) appear
   in either side's diff vs this merge's base — both were authored before the
   base and reached mainline through this merge. A diff-only reviewer cannot
   see the defective lines; only the symbol-level overlap on TestModel/getPaths
   is visible. Scored with this noted (a "miss" here is partly an artifact of
   the merge-view; a symbol-level "risk" flag on TestModel/getPaths counts as
   fuzzy match).
   For case-20 (zod 66cbfe09) the Partial<Record> defect IS fully visible in
   Side 2 (65 lines, untruncated); for case-18 (zod 69ff844b) defaultErrorMap
   edits visible on BOTH sides incl. the doubled `${issue.minimum}` in Side 2.
4. **Cost** is estimated (chars/4 tokens, Sonnet public pricing), not metered;
   latency measured as batch wall-clock / concurrency, approximate.
5. Judges are Claude Sonnet via the Agent tool — one frontier reviewer family,
   not a panel of vendors. A stronger model could only raise the bar; a kill
   verdict here is therefore conservative in one direction only (a "miss"
   verdict does not preclude a stronger model matching).
6. **Post-hoc adjudication of judge flags** (added after blind judging, before
   scoring): every "yes" whose claim was textually checkable was verified
   against the repo at M. This UPGRADED one control flag (case-13, xstate
   72058a08) to a validated true positive — same-day descendant fix
   `f6d20164c` repairs exactly the two test-expectation lines the judge named
   — and confirmed the literal presence (not the 30-day churn validation) of
   the case-26 `typeof Promise !== undefined` and case-15 `for..in` claims.
   Scoring reports both the raw (vs Guard flag) and adjudicated (vs validated
   defect) confusion tables.

## Working data

Scratchpad `llm-judge/`: clones (zod, xstate, nest — blobless), extract.mjs,
control-pool.json, hit-sizes.json, controls.json, cases-full.json, cases/*.txt.
Nothing committed; no packages/ source or live .warpline touched.
