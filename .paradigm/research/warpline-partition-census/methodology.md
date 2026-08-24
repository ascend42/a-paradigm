# Partition Trial Phase 0 — Census Methodology (pre-registered)

**Task:** T-2026-07-14-006 (ROADMAP P1-LaneB) · **Owner:** Loid (forge) · **Drafted:** 2026-07-15 (night 1)
**Question:** Do real concurrent agent task pairs interfere at the symbol level, or can an orchestrator partition around interference?
**Kill criterion K1 (pre-registered):** K1 FIRES iff **≥85% of pairs are DISJOINT** AND **serializing the residue costs <10% throughput** (model in §6). If K1 fires → convene founder, re-weight toward attribution/calibration wedge. This document is written and committed-in-spirit BEFORE the full sample is scored; the preliminary split in `first-pass-numbers.md` is explicitly NOT the K1 verdict.

---

## 1. Sampling frame

Two populations, ~150 task pairs total (target: 80 internal + 70 external):

### Source A — a-paradigm internal history ("our backlog + completed task history")
- **Unit of task:** a *commit cluster* — commits sharing the same primary symbol (the `#x` in the `type(#x):` subject, falling back to the first `Symbols:` trailer entry) on the same calendar day are merged into one task unit (union of symbols and changed paths). Rationale: sequential same-symbol same-day commits are one work item split for hygiene, not independent tasks; leaving them unclustered would inflate OVERLAPPING with self-pairs.
- **Eligibility:** commits carrying a machine-readable `Symbols:` trailer (609 commits as of 2026-07-15, spanning 2026-02 → 2026-07). This repo stamps symbol trailers per its commit convention, giving author-attested touched-symbol sets with no lens cost.
- **"Concurrent" (operational):** two task clusters whose dates are within **windowDays = 3** of each other. This is a *counterfactual concurrency* assumption: the repo is single-author, so nothing here literally ran in parallel; we ask "if these two adjacent work items had been dispatched to two agents simultaneously, would they have interfered?" (Threat §5.1.)
- **Pair sampling:** enumerate all eligible cross-cluster pairs within the window, then draw a seeded uniform random sample (LCG, seed = 42) of 80. No stratification beyond the window constraint; the seed and enumeration order are fixed in `extract-aparadigm.mjs` so the draw is reproducible.

### Source B — zod (external TS OSS, real PR stream)
- **Repo:** github.com/colinhacks/zod, cloned read-only to session scratchpad (clone HEAD recorded in `sample.jsonl` records via commit SHAs; clone taken 2026-07-15, HEAD 912f0f51). zod is chosen over xstate because it is already base-rate-proven in `.paradigm/research/warpline-guard-base-rate/` (oracle runs ~2-5 s/ref there, i.e. the perf wall does not apply) and squash-merges PRs, so one main-branch commit ≈ one landed PR.
- **Unit of task:** a non-merge commit on the default branch that touches `packages/zod/src/**` and references a PR number (`(#NNNN)` in subject) — i.e. a landed PR's squashed change. Version-bump-only and docs-only commits are excluded from task units.
- **"Concurrent" (operational):** two PR-commits that **landed within windowDays = 3** of each other (committer date on main). This proxies "plausibly in flight at the same time." A stronger definition — PR open-interval overlap ([createdAt, mergedAt] via GitHub API) — is a pre-registered night-2 refinement; if the two definitions disagree materially we report both splits.
- **Pair sampling:** same seeded procedure, 70 pairs, sampled to bound the number of unique commits needing lens extraction.

## 2. Symbol-set extraction (and the perf-wall workaround)

The engine's whole-tree absorb is >2 min/admit on the a-paradigm monorepo (T-2026-07-04-003, unfixed). The census therefore uses **two extraction methods, one per source, neither of which absorbs a-paradigm**:

- **Source A (a-paradigm): option (a) — trailer-declared symbols.** `Symbols:` trailer entries (all prefixes `# $ ^ ! ~` kept, normalized to lowercase, trailing punctuation stripped) plus subject-parenthetical symbols. Changed paths from `git show --name-only`, with churn paths excluded (§2.1). No lens invocation at all. This is *author-attested* symbol data — higher-level than lens code-units, but exactly the granularity Paradigm orchestration partitions on.
- **Source B (zod): option (b) — true lens, per-commit semantic diff.** `warpline diff <c>^ <c> --json` in the scratchpad clone (read-only verb; never touches the live repo-root `.warpline/`). Touched symbols = `born ∪ retired ∪ contractChanged` unit ids (`#code:<path>::<name>`). Measured cost ~5 s/commit on zod — tractable for ≤150 unique commits.

**Justification for the split:** using the native symbol vocabulary of each ecosystem mirrors how an orchestrator in that ecosystem would actually partition (Paradigm symbols internally; code-units externally). The cost is that granularities differ across sources, so **splits are reported per-source and never pooled into a single headline number without both per-source numbers alongside.**

### 2.1 Churn-path exclusions (Source A)
Paths touched mechanically by nearly every commit would manufacture fake file-contact adjacency. Excluded from `changedPaths`: `.paradigm/**`, `CHANGELOG.md`, `package-lock.json`, `plugins/paradigm/.claude-plugin/plugin.json`, `.claude/**`. `.purpose` files and per-package `package.json` are **kept** (they carry real meaning contact). Exclusion list is frozen here; any change requires re-running the full census.

### 2.2 Known lens coverage gap (Source B) — measured tonight
The code lens captures function/class-like units only. Verified live: zod commit `f29f2a6d` changed the `cidrv6` regex `const` in `packages/zod/src/v4/core/regexes.ts`; absorb of parent and child both yield stateId `235658e9…` with no `cidrv6` unit present (fn-units like `datetime`, `emoji` in the same file ARE captured). Consequence: const-level edits produce empty lens symbol sets. **Bias direction:** two commits colliding on un-lensed consts classify as ADJACENT (shared file) instead of OVERLAPPING — the error moves pairs *between the two non-disjoint classes*, not into DISJOINT, so the K1-relevant disjoint fraction is nearly unaffected. Residual risk: a pair whose ONLY contact is un-lensed consts in *different* files would misclassify as DISJOINT; night-2 adds a top-level-declaration textual extractor to bound this.

## 3. Scoring taxonomy (exact operational definitions)

For a pair (A, B) with symbol sets S(A), S(B) and changed-path sets F(A), F(B) (post-exclusion):

| Class | Definition (night-1 operational) |
|---|---|
| **OVERLAPPING** | `S(A) ∩ S(B) ≠ ∅` — same-symbol contention; the class Warpline adjudicates. |
| **ADJACENT** | not OVERLAPPING, and `F(A) ∩ F(B) ≠ ∅` — disjoint symbols but shared-file contact (textual-merge machinery engaged without semantic contention; the future BRUSH class). Night-2 extends this with one-hop ripple/blast-radius contact (import-graph for zod; `paradigm_ripple` / flow-index for a-paradigm — the auto graph currently has 0 edges, so ripple needs the live tool, not the cached graph). |
| **DISJOINT** | neither — no symbol overlap, no file contact (night-1), no ripple contact (night-2). |

Precedence: OVERLAPPING > ADJACENT > DISJOINT. Pairs where both symbol sets are empty (docs-only after exclusions) are scored on file contact only and flagged `emptySymbols: true` for sensitivity analysis (reported with and without them).

**Monotonicity note (why preliminary ≠ verdict):** night-2's ripple analysis can only move pairs DISJOINT → ADJACENT. Night-1 DISJOINT is therefore an **upper bound**; if night-1 disjoint is already <85%, K1 cannot fire regardless of ripple results — but the converse (night-1 ≥85%) proves nothing until ripple is added.

## 4. Pair record schema (`sample.jsonl`)

One JSON object per line:
```json
{"pairId":"AP-0001","source":"a-paradigm|zod","windowDays":3,"gapDays":1,
 "taskA":{"ref":"<sha|cluster-key>","date":"YYYY-MM-DD","title":"...","changedPaths":[...],"symbols":[...]},
 "taskB":{...},
 "emptySymbols":false}
```

## 5. Threats to validity

1. **Counterfactual concurrency (Source A).** Sequential single-author commits are not literally concurrent; adjacent tasks may be *causally ordered* (B builds on A), inflating OVERLAPPING relative to a true parallel dispatch where an orchestrator would have sequenced them deliberately. Cuts against Warpline. Conversely, a solo author self-serializes and avoids starting interfering work at all, deflating OVERLAPPING. Direction net-ambiguous; mitigated by the external source.
2. **Completed tasks ≠ future agent tasks (selection bias).** Both sources are human-shaped, landed work. Agent swarms slice work differently (smaller, more parallel, more redundant attempts). The census measures the *current* task distribution; it cannot see the distribution Warpline's own existence would create. K1 is therefore a conservative market test, not a physics result.
3. **Survivorship (Source B).** Only *merged* PRs are visible; PRs abandoned *because of* conflict with concurrent work are missing — deflates observed interference. Cuts against Warpline (makes K1 easier to fire); acceptable for a kill-criterion test.
4. **Symbol-trailer noise (Source A).** Trailers are author-attested: over-broad on sweep commits, occasionally missing a touched symbol. Spot-check plan: night-2 samples 15 commits and compares trailer sets against changed `.purpose` diffs.
5. **File→symbol approximation error (Source B).** §2.2 lens gap; plus test files map to units whose contention is cheap to resolve (test collisions rarely need adjudication). Night-2 flags test-only overlaps separately.
6. **Window choice.** windowDays = 3 is a judgment call. Sensitivity: night-2 recomputes at windowDays ∈ {1, 7}. If the disjoint fraction is window-sensitive, report the curve, not a point.
7. **Granularity mismatch across sources** (§2). Never pool without per-source disclosure.

## 6. Pre-registered K1 evaluation plan

Executed only when: full ≥150-pair sample scored, ripple adjacency (night-2) added, and sensitivity checks (§5.4-5.6) done.

1. Compute per-source and pooled splits with 95% Wilson intervals on the DISJOINT proportion.
2. **Prong 1 (disjointness):** K1's first condition holds iff the Wilson *lower* bound of pooled DISJOINT ≥ 0.85 AND each source's point estimate ≥ 0.80 (guards against one source dragging the pool).
3. **Prong 2 (serialization cost):** for the non-disjoint residue, model throughput loss of a serialize-the-residue orchestrator policy: with pair-interference probability p = 1 − P(disjoint) and mean task duration d, expected added latency per task under pairwise serialization ≈ p·d/2; throughput cost ≈ p/2 for a 2-agent pool (generalizes to p·(k−1)/2 capped at saturation for k agents; we evaluate k = 2 and k = 5). Condition holds iff cost < 10% at k = 2 **and** k = 5 (an orchestrator that only survives at k = 2 is not "partitioning around" the problem).
4. Both prongs hold → K1 FIRES → convene founder per task blurb. Either fails → the census DISJOINT/ADJACENT/OVERLAPPING split becomes the AgenticFlict-benchmark headline stat.
5. Any post-hoc definition change after seeing the split invalidates the run and requires a fresh sample (new seed).

## 7. Artifacts

- `extract-aparadigm.mjs` / `extract-zod.mjs` — extraction + seeded pairing (this dir; read-only on all source).
- `sample.jsonl` — the assembled pairs.
- `score.mjs` — taxonomy scorer → `first-pass-numbers.md` (PRELIMINARY, night-1 file-contact adjacency only).
- Scratchpad zod clone is throwaway; SHAs in `sample.jsonl` suffice to reproduce against any fresh clone.
