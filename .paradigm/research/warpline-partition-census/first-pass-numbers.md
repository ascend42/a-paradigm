# Partition Census — First-Pass Numbers (NIGHT 1 — PRELIMINARY, NOT THE K1 VERDICT)

**Status: PRELIMINARY.** File-contact adjacency only; ripple/blast-radius adjacency (night-2) not yet applied; zod PR-interval concurrency refinement not yet applied; sensitivity checks (methodology §5.4–5.6) not yet run. Per methodology §3, night-1 DISJOINT is an **upper bound** — night-2 analysis can only move pairs out of DISJOINT.

Generated 2026-07-15 by `score.mjs` over `sample.jsonl` (150 pairs; seed 42; windowDays 3). Raw scorer output: `scored-night1.txt`.

## Split

| Source | n | OVERLAPPING | ADJACENT | DISJOINT | Wilson95 (disjoint) |
|---|---|---|---|---|---|
| a-paradigm | 80 | 13 (16.3%) | 16 (20.0%) | 51 (63.8%) | 52.8–73.4% |
| zod | 70 | 4 (5.7%) | 15 (21.4%) | 51 (72.9%) | 61.5–81.9% |
| **POOLED** | **150** | **17 (11.3%)** | **31 (20.7%)** | **102 (68.0%)** | **60.2–74.9%** |

Sensitivity (pairs where both tasks have non-empty symbol sets): a-paradigm unchanged (all 80 qualify); zod n=31 → O 12.9% / A 16.1% / D 71.0%; pooled n=111 → O 15.3% / A 18.9% / D 65.8%.

## Preliminary reading (to be re-derived on the full night-2 analysis)

1. **The K1 direction so far: K1 is NOT on track to fire.** Pooled DISJOINT = 68.0% (Wilson upper bound 74.9%) against the pre-registered ≥85% threshold — and this is the *upper-bound* configuration (ripple adjacency will only shrink DISJOINT). Unless night-2 corrections move ≥17 points in a direction the frozen method makes impossible, the census supports interference being material: roughly **1 in 3 plausibly-concurrent pairs makes contact**, and ~1 in 9 collides on the same symbol.
2. **Version-bump caveat (a-paradigm).** 8–10 of the 16 a-paradigm ADJACENT pairs share only `packages/*/package.json` (+`CLAUDE.md`/README) contact — release-bump mediation. Frozen definitions keep them ADJACENT; a stress-test that reclassifies all 16 ADJACENT as DISJOINT still yields only 67/80 = 83.8% on this source and ~73% pooled — **K1 fails even under the harshest reclassification**. Recorded as a sensitivity, not a definition change.
3. **zod empty-symbol pairs are heavy** (39/70 pairs have at least one empty lens symbol set — docs/test/const-only commits; see methodology §2.2). These are scored on file contact only. The non-empty subset shows *more* overlap (12.9% vs 5.7%), suggesting the headline zod OVERLAPPING is an undercount.
4. **OVERLAPPING is concentrated where the work is hot**: a-paradigm collisions cluster on `#fabric`, `#warpline-cli`, `#claude-stream-session` — concurrent agents naturally converge on the active subsystem. This is the AgenticFlict story: interference is not uniform noise, it follows attention.

## Night-2 queue (from methodology)
- Ripple one-hop adjacency (live `paradigm_ripple` for Source A — cached auto-graph has 0 edges; import-graph for zod).
- zod PR open-interval concurrency ([createdAt, mergedAt] overlap via GitHub API) — reconcile with landed-window definition.
- Top-level-declaration textual extractor for zod to bound the §2.2 lens-gap misclassification.
- Trailer-noise spot check (15 commits vs `.purpose` diffs); windowDays ∈ {1,7} sensitivity; test-only-overlap flagging.
