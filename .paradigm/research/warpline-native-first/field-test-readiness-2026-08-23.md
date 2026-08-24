# Warpline field-test readiness — panel synthesis (2026-08-23)

Status: ANALYSIS. Five-agent panel (Arky, Aegis, Jinx, Loid, Judge) against the LOCKED
pre-registration `expo-field-test-protocol.md`, with every load-bearing claim re-verified by
the orchestrator (file:line). Baseline re-run today: 1158 tests green @ f38445f0.

Question asked: what stands between the current state and a VALID live run?

Answer in one line: **the judge INSTRUMENT is real; the RUN HARNESS around it is unbuilt; and
three founder-set gates (M3, subject consent, protocol contradictions) cannot be skipped
silently.** The most likely outcome of running today-as-is would be INCONCLUSIVE on (B)/(C)
and "(A) not tested" — the exact "complete, produce numbers, prove nothing" the original panel
named.

---

## A. Founder-only gates (nothing below makes the run valid without these)

| # | Gate | Source | Options |
|---|------|--------|---------|
| F1 | **M3 signed strands REQUIRED before the run.** T-2026-07-01-014 is open; no signing code exists (v2 = hash-chain only; `daemon/tokens.ts:19` defers per-strand signatures). | TD-2026-08-11-913 (3) — the founder's own ruling, exceeding Aegis's "MCP-only adequate" | Build M3 (~30h+) OR issue a NEW decision superseding TD-913 (3) back to MCP-only-as-procedure. Cannot be silently ignored. |
| F2 | **Subject repo.** Only Expo app on disk = `a-climbers-gift` — a live CLIENT project (BoulderBlock), `feat/scanned-hold-assets`, "ship for client review" commits, `.env` with Supabase keys, `.claude/settings.local.json` pre-allows `git add/commit/push`. Running 2–4 Opus agents + planting a deliberately broken merge (A6) + sending verbatim source bodies to the Anthropic API in judge cards + git-tracking `fabric.jsonl` into its history. | §2, §4 A6, §5 card-render.ts:74, TD-663 (2) | Client consent, OR a throwaway fork/branch with secrets stripped, OR a different subject. Aegis: without this the run is contractually unsafe, not merely risky. |
| F3 | **Protocol contradictions that need a NEW pre-registration id** (protocol line 4–6 forbids edits): (a) §3 floor ≥20 genuine KNOTs vs §7C (C)-FALSIFIED at >25 interventions/100 — every KNOT needs a HUMAN_ONLY resolve, so the window is ≤5 non-genuine KNOTs even at perfect judge precision (Jinx; arithmetic verified); (b) §5 says "structured-output mode is used" — code is free-text + substring parse (`judge-run.ts:55-64, 209-214`); (c) §5 rubric for BROKEN presupposes a failing check (`rubric.ts:71-72`, `rating-card.ts:93` required) — an A5 random-audit CLEAN has none, so the card either leaks the oracle stratum or primes "broken"; fixing changes rubricHash; (d) no precision-CORRECTION formula exists in protocol or code (`scoring.ts:114-134` emits precision/recall only; naive `obs×precision` vs Rogan-Gladen differ by 3–4 KNOTs near the floor — enough to flip INCONCLUSIVE); (e) TD-831 says "weight audit sampling toward danger-flagged CLEANs" — contradicts frozen §4 "every 5th CLEAN by ledger order"; (f) whether HELD refusals count as "human intervention" in §7C (never named). | §3, §5, §7C, TD-831 | Issue pre-registration v2 with these resolved BEFORE first admission. |
| F4 | **Green-gate declaration for the subject.** `a-climbers-gift` has typescript but NO lint, NO test runner, ZERO test files, NO `node_modules` (not installed). Objective oracle = `{tsc --noEmit, expo export}` only; `tsconfig` sweeps `admin/` (Svelte) so baseline may be red. | §4 step 2, §7A n_objective | Accept tsc+bundle (label the objective bound "tsc+bundle only"), or add jest/eslint BEFORE freeze. `npm install` + baseline run is a human step on a client repo. |
| F5 | API key + billing (~240 seed/twin calls + ~50 field cards × N=3 on Opus 4.5 ≈ $100–150); `@anthropic-ai/sdk` install. Key must live ONLY in the judge process env, never in any swarm agent's shell. | §5 | — |
| F6 | Backlog with overlap zones (Loid's Z1–Z4 below); seed ground-truth labels sealed; who authors the EXTERNAL injection corpus (not Matt, not the envelope author). | §3 DRIVER, §5 A11, §5 gate 2 | — |
| F7 | Agents' model: protocol pins `claude-opus-5`; `types.ts:19` hardcodes it. Launch with `claude --model claude-opus-5` or re-register. Subagent models (Explore/Plan) under the same token are unrecordable. | §2, §9 | — |

## B. Instrument defects — buildable NOW, needed under ANY founder ruling

Cross-verified by ≥2 panelists each; none touches frozen protocol text.

| # | Defect | Evidence | Voids |
|---|--------|----------|-------|
| B1 | **Ledger has no multi-batch continuity.** Every `runJudgeEnforced` mints `new JudgeLedger()`; `persist` overwrites; `judgments.jsonl` + `run-record.json` truncated. A second batch (habit ii says "batched is fine") destroys block one's chain → "final head does not chain forward" = VOID. | `judge-runner.ts:147`, `ledger.ts:164`, `judge-run.ts:165-167`; `JudgeLedger.load` exists at `ledger.ts:168` but is unused by the runner | §3 A13 |
| B2 | **Chained row lacks the §4 RECORDING fields.** `LedgerRowBody` = kind/cardId/judgeVerdict/join only. `planted`, `seededControl`, `auditSample`, `source`, `coveredClass`, `objectiveRegression`, `oracle{}`, `strandId/pickId/agents/parentStateIds/mergedTreeId` are absent → exclusion flags are mutable out-of-band; verbatim N=3 samples live only in the unchained, overwritable `judgments.jsonl`. | `types.ts:105-119`, `judge-runner.ts:188`, `judge-run.ts:173` | §3 verbatim custody, §4 "set at write time and immutable" |
| B3 | **Favorable rounding in scoring.** `confirmCleanFalse` folds `pending` and `indeterminate` into `true-clean`. | `scoring.ts:165` | §5 "never rounded into a favorable bucket" |
| B4 | **Pre-flight ordering + strength.** Gate (a) twin samples REAL cards (`preflight.ts:159-168`) BEFORE gate (b) corpus is decided (`:174`); protocol: "not a single real card until… corpus is passed." Twin/corpus are single-sample while verdicts are N=3 (`:108-110`). Empty corpus passes trivially (`judge-runner.ts:150`, asserted by `judge-runner.test.ts:103`). | — | §5 |
| B5 | **`beatsPriorPrecision` is a bare `> 0.29`** point test — 1/3 passes it (95% CI 0.06–0.79). Needs a one-sided Wilson lower bound. | `scoring.ts:137-139` | §5 "materially beats" |
| B6 | **`indeterminateFraction` denominator is genuine+over-block**, but the §3 floor is GENUINE-only; seeds not excluded. | `scoring.ts:78-97` | §9 A14 |
| B7 | **No field runner, no CLI verb, no habit (ii)/(iii) hooks, no oracle automation, no §7B/§7C metrics, no report generator.** `buildKnotRatingCard`/`buildCleanRatingCard`/`runJudgeEnforced` have ZERO callers outside `src/judge/`. Byte-downgrade KNOTs carry no payload (B-3, `admit.ts:302-306`) → no card input. Sidestepped KNOTs never get a row (`f4/completion.ts:29-35`) — the exact refusal burden (C) measures. | grep verified 2026-08-23 | §3/§4/§6/§7 |
| B8 | Live case-13/case-20 regression EXISTS (`judge-regression.test.ts:84-94`) behind `WARPLINE_JUDGE_LIVE` but has never executed and uses toy bodies. (Brief was wrong that it is unwired.) | — | — |

## C. Stale beliefs corrected this pass

- **Over-block Fix B IS shipped** (`predict.ts:287-313` ripple-gate, TD-831) though T-2026-07-15-008 is still `open`. The brief's "deliberately not fixed (TD-663 (6))" was superseded by TD-913 (2). The run validates the fix; seeds must include the NEW dominant over-block shape (Z1 below), not the fixed ripple shape.
- **Tier-0 Fix A** = surface-and-sample only (`admit.ts:867`, `cli.ts:2200`) — by design undetectable; bounded by oracle/judge.
- **CLI gate exists** (`agent-shell.ts:116-118`) but keys on unsigned `$WARPLINE_AGENT_ID`; conclusion unchanged: swarm agents must have NO shell path (Claude Code tool-permission deny on Bash/warpline), verified before the first agent starts.
- **The ~29%/33% prior is not what §5 says it is** (Loid): source = `warpline-llm-judge-falsifier/results.md:82,87`, precision 2/7 on a DIFFERENT question, Sonnet, single sample, n=7 (CI 0.08–0.64). Direction only.

## D. Overlap zones on a-climbers-gift (Loid, empirical lift of `src/` through ts-lens: 57 files → 83 units)

- **Z1 same-screen pairs** — every screen is ONE code-unit (`discover/[routeId].tsx` 265 lines/1 unit). Any two edits to one screen = KNOT even in disjoint JSX (`predict.ts:303-313` body = one scalar slot); git merges clean → OVER-BLOCK. Dominant contention AND over-block generator; TD-831 does not touch it. **Likely outcome: over-block > genuine → (C) FALSIFIED honestly** unless Z2/Z3-shaped tasks are ≥30% of the backlog.
- **Z2 tab shell** `app/(tabs)/_layout.tsx` — "add 4th tab" × "vector icons" → KNOWN-GENUINE shape.
- **Z3 services × screens** — ts-lens: every import is `extern`, `@/` never resolves (`ts-lens.ts:443-448`); 624 refs, ALL intra-file. "service gains a param" × "screen calls it" = independent CLEAN → tsc-red objective false CLEAN. This is where (A) will fire.
- **Z4 zero-unit files (14/57)**: `types/*`, 6/7 `stores/*` (zustand `create()` not lifted), `constants/theme.ts`. Byte-decided, `blind-untested`. Keep ≤20% of backlog. Trap: zero-unit-only proposal behind tip = `NOOP, sealed:false` (`native.ts:794-795`) → git fallback.
- Natural planted-control site: `stores/routeDiscoveryStore.ts:27` `PAGE_SIZE = 20` with `hasMore: routes.length === PAGE_SIZE`.

## E. Recommended order

1. **Founder rules F1–F3** (M3 / subject / pre-reg v2). Everything else is wasted if F2 says "not this repo."
2. **Build B1–B6 now** (instrument hardening; pure library + tests; no frozen text touched). ~1 day.
3. **Build B7** (`warpline field` verb group: `judge` / `join` / `score` / `fallback`; KNOT-time card hook incl. sidesteps; oracle automation as `field/oracle.ts` over `MergeRecipe` treeIds via `restore --selector tree:<id>`). ~3–4 days. Runner shape does not depend on F1–F3.
4. Seeds (≥20/class from the subject's own source, labels sealed), planted control, external corpus — after F2/F6.
5. Subject prep (install, baseline, notebooks, tool-permission deny, `.warpignore`), backlog, dry run of 5 admissions end-to-end including a witness commit, THEN the live block.

Feedback sinks to declare before the run (Loid): judge calibration record by over-block SHAPE → `.paradigm/research/` + TD; `grades.jsonl` survived/overturned for ~100 picks; notebook entries for the three refusal shapes (NOOP-behind-tip, KNOT-no-payload, HELD); §8 amendment candidate "call-expression-wrapped declarations" as a blind class (pre-reg v2).
