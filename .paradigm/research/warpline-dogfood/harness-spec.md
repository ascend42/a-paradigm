# Warpline Multi-Agent Dogfood — Falsifier Harness Spec (Move-3)

> Author: Loid (forge / Agent Intelligence Officer). Status: DESIGN, runnable. Companion to the Guard base-rate experiment (`scratchpad/base-rate/`) and `docs/specs/warpline-flows.md` §2 (WEAVE). This is a **buildable** spec: a builder implements the files in §5 directly.
>
> **Precondition delta (why this supersedes the original falsifier design):** all three Move-3 blockers are shipped —
> (1) `agentId` threading (`warpline pick --agent`, `$WARPLINE_AGENT_ID`, auto-seal hook forwards it → concurrent agents seal ATTRIBUTED v2 strands, `alice ≠ anon` pickId; still unsigned self-assertion, M3);
> (2) H1 v2-relaxation (a merged strand can be base/theirs of a later admit, reconstructed from `binding.treeId` — multi-generation concurrent merges CLEAN-seal instead of KNOT-downgrading; genuine-fail cases still fail closed — see `admit.ts:resolveMergeInput`);
> (3) GAP-1 scoping (byte-merge-fallback rate reported SEPARATELY; the H1 meaning-decisive rate is computed over symbol-bearing admissions only).

---

## 0. The one-paragraph thesis being falsified

**Claim (H1, Move-3 form):** In an agent-swarm condition — N agents forking the same selvage and admitting concurrently — Warpline's meaning-level admission verdict is *decisively better than git's byte merge* at a non-trivial rate: it auto-resolves merges git would have conflicted (CLEAN where git conflicts) AND it flags merges git would have silently mis-merged (KNOT/DANGLE where git merges clean-but-wrong), and an **independent** oracle (tsc + tests + constructed ground-truth) confirms Warpline is right in those disagreements. **Co-claim (the moat):** the gate-rule prior (`linked` vs `independent`) actually predicts real survival. If neither holds above the KILL floor, Move-3 is dead and we stop building the write path.

The ground truth from the base-rate study is the reason this needs a *manufactured* condition: **0 / 18 real 2-parent merges across the sampled repos were genuine cross-branch symbol interaction** — git history simply does not contain the concurrent-swarm case. The dogfood MANUFACTURES that interaction. That is legitimate and is stated as a construct throughout (§1, §6).

---

## 1. What the agents actually DO

### 1.1 Task source — a seeded edit-pair catalog on THIS repo's real TS

**Not free-form LLM edits.** The unit of work is a deterministic, replayable **edit-pair** authored ahead of the run against real symbol-bearing files in this repo (`packages/warpline/src/**`, `packages/paradigm/src/**`, `packages/sentinel/src/**`). Each pair is two scripted patches (`patchA`, `patchB`) applied by two different agents in two different worktrees off the same base selvage. Determinism removes LLM nondeterminism from the science and gives **ground-truth-by-construction** (we authored the pair, so we KNOW whether the two edits genuinely conflict).

The catalog (`seed-catalog.jsonl`, §5) is stratified. Each row declares `{id, stratum, files, symbols, patchA, patchB, truth, expectWarpline, expectGit}`:

| Stratum | ~share | Construction | `truth` | Purpose |
|---|---|---|---|---|
| **INDEPENDENT** (baseline) | 55% | Two disjoint symbols, different files, no in-graph edge; both edits well-formed | `independent` | Baseline; should be CLEAN/`independent`, git usually clean. Measures false-KNOT floor. |
| **LINKED-CLEAN** | 20% | Dependency-adjacent symbols (caller/callee) edited compatibly — e.g. callee gains an *optional* param w/ default, caller passes it | `mergeable` | The wedge's positive case: git may textually conflict (adjacent lines) while meaning commutes → CLEAN/`linked`. |
| **TRUE-INTERFERENCE** | 20% | Same symbol, contradictory contract (both change a fn signature incompatibly) OR one retires a symbol the other references | `conflict` | The catch case: warpline must KNOT/DANGLE. If git merges these clean, that is a silent mis-merge warpline should flag. |
| **NEGATIVE CONTROL** | 5% | Same file, textually adjacent, but semantically independent symbols (looks coupled, isn't) | `independent` | Trap for false-KNOT and for over-eager `linked` classification. |

**Ground-truth is authored, then blind-checked:** each pair's `truth` is set by the author, then independently re-derived at adjudication time from tsc+tests on the *constructed-correct* result tree (§2.3). A pair whose authored `truth` disagrees with its tsc/test adjudication is quarantined from the corpus and flagged for human review — the seed catalog itself is falsifiable.

### 1.2 Agents

**Four agents** — `alice`, `bob`, `carol`, `dave` — each a distinct `WARPLINE_AGENT_ID` (identity-bearing per precondition 1). ≥3 is the floor; 4 lets a batch stage 2–4 concurrent writers so we can test 3- and 4-way concurrent admission (exercising the H1 multi-generation relaxation: agent 3 admits onto a state that is itself a merge strand).

### 1.3 How they run — worktrees over ONE shared fabric

- The dogfood repo root holds the single `.warpline/` fabric. Each agent gets a **git worktree** (`git worktree add`) so all four have independent working trees but the merge target is the one shared fabric/selvage — precisely the thing git's single shared index/HEAD cannot do, and the property under test.
- An agent's "work" = apply its patch in its worktree → `git commit` (author identity = the agent) → the commit sha is the `--ref` for admission. `WARPLINE_AGENT_ID` is set per-agent for the pick/seal attribution.
- Admissions run through the real CLI verbs, no test shims:
  - `warpline scratch <agentId>` — fork the per-agent scratch at the current selvage (its optimistic base).
  - `warpline admit <agentId> --ref <agentCommitSha> --json` — the multi-writer admission (returns `{decision:{status,confidence,agentChanged,otherChanged,knots,dangling}, sealed, strand, merged}`).

### 1.4 Manufacturing GUARANTEED concurrency + interaction

A concurrent (non-`FAST_ADMIT`) admission requires the selvage to advance *between* an agent's scratch-fork and its admit. The harness guarantees this per **batch**:

1. All `k` agents in a batch `warpline scratch <agentId>` at the SAME selvage `S0`.
2. Each applies its patch → commits → `sha_i`.
3. Driver admits **serially**: `admit(agent₁)` sees `selvage == base` → `FAST_ADMIT`, advances `S0→S1`. `admit(agent₂)` now sees `base=S0 ≠ selvage=S1` → **genuine concurrent admission** (CLEAN / KNOT / DANGLE against `agent₁`'s delta). `admit(agent₃)` sees `S2`, possibly a merge strand (tests the H1 relaxation), etc.

Per batch of `k`, exactly `k−1` are scored concurrent admissions. The **first** admit of each batch (`FAST_ADMIT`) is recorded but excluded from the meaning-decisive denominator (it is not a concurrent case). The *pairing* of which agents interfere is drawn from the seed catalog stratum, so the interference is deliberate and labelled.

**Honesty rule (stated in every report):** seeded interaction is a *construct*. Seeded vs organic admissions are aggregated and reported **separately** (§3.5). The H1 rate is a statement about "when genuine semantic interference exists" — it is explicitly NOT a base-rate-in-the-wild claim (that is the base-rate experiment's job, and it found interaction to be rare). The two claims are kept distinct and never blended into a single headline.

### 1.5 Optional ORGANIC arm (stretch, reported separately)

A second arm where the real Paradigm roster does real backlog tasks (`paradigm_task_list`) in worktrees, admitting as they go. No ground-truth-by-construction — adjudicated by tsc+tests+human only. This is the "true dogfood" but it is the **noisy** arm and produces few concurrent-interaction rows (same reason the base rate is low). It is a *supplement* to the seeded arm, never a substitute. If organic yields <10 concurrent symbol-bearing admissions, report it as "insufficient organic interaction — consistent with the 0/18 base rate" and lean on the seeded arm for H1.

---

## 2. The adjudication protocol (operational, non-circular)

Every concurrent admission is scored on **three independent columns**, then labelled. Warpline **never adjudicates itself** — tsc/tests are external oracles and ground-truth is authored before the run.

### 2.1 Column A — git counterfactual (REUSE `base-rate/driver.mjs`)

For each concurrent admission by agent `X` (proposal `ours = sha_X`) against the writer(s) already landed (`theirs = sha_prev`, the commit behind the current selvage; `base = sha_batchBase`):

```
warpline oracle <theirs_sha> <ours_sha> --json   →  gitReality.conflicted (+ conflictPaths)
```

This is exactly `driver.mjs`'s per-pair call. Record `{gitConflicted, conflictPaths}`. (For k>2 batches, `theirs` is the immediately-preceding landed sibling; the batch base is `S0`'s commit.) Reuse `driver.mjs`'s `execFile` oracle wrapper verbatim — see `counterfactual.mjs` (§5).

### 2.2 Column B — Warpline verdict

From the `admit --json` result: `status ∈ {FAST_ADMIT, CLEAN, KNOT, DANGLE}`, `confidence ∈ {linked, independent, null}`, `sealed`, `merged.conflicts`, and whether a CLEAN returned **sealed** (materialized) vs **unsealed** (fail-closed — the H1 wall, §3.4).

### 2.3 Column C — independent adjudicator (3 signals + human)

For each admission, materialize BOTH candidate result trees and judge them with oracles external to Warpline:

1. **Warpline result tree.** For a sealed CLEAN merge, restore the merged bytes from the strand's `binding.treeId` via `warpline restore` (git-absent path is shipped). For a KNOT/DANGLE, there is no auto-result — the "warpline outcome" is "blocked for human DECIDE" (correct iff `truth=conflict`).
2. **Git result tree.** `git merge-tree` / a scripted 3-way merge of `ours`,`theirs`,`base`; on git-conflict the outcome is "blocked" (correct iff `truth=conflict`); on git-clean, the merged tree.
3. **Oracle checks on each result tree:** `tsc --noEmit` (typecheck) + the affected package's targeted test subset (`npm test` scoped to touched packages). PASS/FAIL each.
4. **Ground-truth-by-construction** (seeded rows): the catalog `truth ∈ {independent, mergeable, conflict}`. For seeded rows this is the primary adjudicator; tsc+tests are the corroborating blind check (and the gate that quarantines a mis-authored seed, §1.1).
5. **Human sign-off (Loid):** a fixed 20% random sample PLUS 100% of A-vs-B disagreements PLUS 100% of tsc/tests-vs-ground-truth disagreements. Recorded in `adjudication.jsonl` with `humanVerdict` and rationale.

**Scoring rule per admission** (deterministic function of A, B, C):

| Warpline (B) | Git (A) | Adjudicator (C) says correct answer is… | Label |
|---|---|---|---|
| CLEAN sealed, tsc+tests pass | conflicted | mergeable | **MEANING-DECISIVE (auto-resolve win)** |
| KNOT / DANGLE | clean-merged, but result **fails** tsc/tests OR `truth=conflict` | conflict | **MEANING-DECISIVE (silent-mismerge catch)** |
| CLEAN sealed | clean | mergeable | agree-clean (no wedge, correct) |
| KNOT / DANGLE | conflicted | conflict | agree-conflict (no wedge, correct) |
| KNOT / DANGLE | either | mergeable/independent (result passes tsc+tests) | **FALSE-KNOT** (warpline cried wolf) |
| CLEAN sealed, but result **fails** tsc/tests | either | conflict | **FALSE-CLEAN / wrong-merge** (worst case) |

`MEANING-DECISIVE = (auto-resolve win) + (silent-mismerge catch)`. The disagreement is adjudicated by C, never by Warpline.

---

## 3. Metrics, H1, guardrails, KILL

All rates are over **symbol-bearing concurrent admissions** unless noted: admissions where `agentChanged ∪ otherChanged` contains ≥1 real Paradigm symbol (`#code:*` / `#component` etc.), i.e. excluding opaque `.purpose`/config/docs-only churn. This is the GAP-1 scoping from precondition 3.

### 3.1 PRIMARY — meaning-decisive rate

```
meaning_decisive_rate = ( auto_resolve_wins + silent_mismerge_catches ) / symbol_bearing_concurrent_admissions
```

Report the two components separately as well (they are different value propositions: auto-resolve = throughput; catch = safety).

### 3.2 CO-PRIMARY — gate-rule prior signal (the moat)

Straight from `warpline grade --json` after the run (its `moat` block already buckets `linked / independent / fast-admit / pick` by survived/overturned):

```
prior_signal = survival%(linked seeds) − survival%(independent seeds)  ≥ 15 points
```

with a two-proportion z-test that the two survival rates differ (p < 0.05). "Survival" = the graded outcome of the CLEAN admit's symbols under later strands (a pick whose symbols a later strand retired/contended is overturned; one that held survived). The seeding must produce enough of BOTH classes for the test to have power (§4 scale).

### 3.3 GUARDRAIL — false-KNOT rate

```
false_knot_rate = false_knots / symbol_bearing_concurrent_admissions
REQUIRE:  false_knot_count  ≤  meaning_decisive_count   (true catches must outnumber false alarms)
```

### 3.4 GUARDRAIL — H1-wall / fail-closed rate (informational, now that H1 is relaxed)

```
h1_wall_rate = (CLEAN-but-unsealed admissions) / (all CLEAN admissions)
```

A CLEAN that returns `sealed:false` fell through `resolveMergeInput` fail-closed (worktree proposal, unbound merge input, absent object). Post-relaxation this should be near-zero for committed refs; a *rise* across generations 2→3→4 signals the relaxation isn't holding and must be surfaced (not a KILL, but a build blocker). Also track FALSE-CLEAN (wrong-merge) count — this must be **exactly 0**; any non-zero is an automatic stop-and-escalate regardless of other metrics.

### 3.5 GUARDRAIL — agent-blocked-time vs git merge-queue baseline

Wall-clock the time an agent is blocked from scratch-fork to sealed admit (fabric-lock contention + rebase + materialize). Compare to the git counterfactual: a serialized **merge-queue** where each branch is rebased+merged in sequence (`git rebase` + `git merge` per branch, re-running on each landing — the `warpline queue` analogue). Warpline must not be materially slower per landing. Report median + p90.

### 3.6 REPORTED — byte-merge-fallback rate (GAP-1)

```
byte_fallback_rate = (opaque / no-symbol admissions) / (ALL admissions)
```

Measured and reported; **excluded** from the meaning-decisive denominator so opaque churn cannot dilute the wedge metric. This is precondition 3, made explicit.

### 3.7 KILL conditions (any one fires → Move-3 dead, stop building the write path)

1. `meaning_decisive_rate < 2%` (over symbol-bearing concurrent admissions), **OR**
2. `false_knot_count > meaning_decisive_count` (guardrail inverted — the tool cries wolf more than it catches), **OR**
3. prior classes statistically indistinguishable: `linked` vs `independent` survival gap `< 15 pts` OR two-proportion z-test `p ≥ 0.05`.

Plus the hard stop: any **FALSE-CLEAN (wrong-merge)** — warpline sealed a merge that fails tsc/tests — halts the run for root-cause before any metric is trusted.

---

## 4. Scale + safety

### 4.1 Scale

- **≥100 concurrent (non-`FAST_ADMIT`) symbol-bearing admissions across ≥10 sessions.** At `k=3–4` agents/batch that is `k−1 = 2–3` concurrent admissions/batch → ~40–50 batches. A "session" = one driver invocation with a fresh selvage epoch; ≥10 sessions guards against a single-session artifact. Budget ~130 total admissions to net ≥100 concurrent symbol-bearing after excluding FAST_ADMIT firsts and opaque rows.
- Stratum mix (§1.1) sized so `linked` and `independent` CLEAN admissions each exceed ~30 graded outcomes — the power floor for the §3.2 z-test.

### 4.2 Live vs throwaway fabric — **DECISION: dedicated throwaway fabric.**

The seeded experiment writes to a **dedicated throwaway dogfood fabric**, never the live anchored fabric. Rationale:

- The live fabric was *just* anchored/frozen at the v1 epoch (`warpline fabric attest`; `fabric verify` exit 0). Injecting 100+ **construct-seeded** strands would (a) poison the live `grade` ledger — the `linked/independent` moat signal on the real project would be dominated by synthetic interference rather than organic work, destroying the very calibration data we want to keep clean; (b) bloat the real Tapestry with throwaway meaning; (c) put avoidable write pressure on a freshly-frozen hash-chain.
- The moat data worth accreting is **calibration signal** (does `linked` predict survival), and that is **equally valid in a throwaway fabric** — we are testing the ENGINE, not the live project's history. Organic real-strand moat data is earned *later*, from the organic arm (§1.5) against the live fabric, once the wedge is proven.

**Setup:** `git clone` (or `cp -r` sans `.warpline/`) this repo into the scratchpad run area → `warpline init` a fresh fabric → `warpline fabric attest` a fresh v1 epoch anchor there → run the swarm against THAT. This keeps the real fabric pristine and the experiment fully reproducible/disposable.

**Hybrid note:** the *organic* arm (§1.5), being real work with no construct, MAY optionally land on the live fabric later — but only after the seeded arm has cleared H1, and only unseeded rows. The seeded arm is throwaway, full stop.

### 4.3 Isolation / teardown

- Everything under `<scratchpad>/warpline-dogfood-run/` (the cloned repo + all `results-*.jsonl`). Nothing writes under the project `.warpline/` or git history.
- `git worktree remove` all agent worktrees on completion; `rm -rf` the run dir after results are copied back to `.paradigm/research/warpline-dogfood/` (results JSONL + aggregate only, not the throwaway fabric).
- Deterministic seed → the whole run is replayable from `seed-catalog.jsonl` + a fixed base commit sha (record it in the run manifest).

---

## 5. File plan for the builder

Create under `.paradigm/research/warpline-dogfood/` (committed) and run in `<scratchpad>/warpline-dogfood-run/` (disposable):

| File | Role |
|---|---|
| `harness-spec.md` | THIS document. |
| `seed-catalog.jsonl` | The stratified edit-pair catalog (§1.1). One row per pair: `{id, stratum, files, symbols, patchA, patchB, truth, expectWarpline, expectGit}`. Patches as unified diffs or a small JS mutator ref. Hand-authored against real TS in `packages/warpline/src`, `packages/paradigm/src`, `packages/sentinel/src`. |
| `counterfactual.mjs` | Thin reuse of `base-rate/driver.mjs`: the `execFile('node',[CLI,'oracle',theirs,ours,'--json'])` wrapper → `{gitConflicted, conflictPaths}`. Import or copy `driver.mjs`'s oracle-call block verbatim (Column A). |
| `swarm.mjs` | Orchestrator. Clones repo → fresh `warpline init` + `fabric attest` → per session: pick a batch from the catalog, `git worktree add` per agent, set `WARPLINE_AGENT_ID`, `warpline scratch`, apply patch, commit, `warpline admit --ref <sha> --json` serially; record one row per admission `{sessionId, batchId, agentId, stratum, seedId, status, confidence, sealed, agentChanged, otherChanged, gitConflicted (via counterfactual.mjs), ms, symbolBearing}` → `results-swarm.jsonl`. |
| `adjudicate.mjs` | Post-run Column C. For each admission: restore warpline result tree (`warpline restore` from `binding.treeId`) + git result tree (`git merge-tree`); run `tsc --noEmit` + scoped `npm test`; join `truth`; apply the §2.3 scoring table → `adjudication.jsonl` with `{label, tscWarp, testWarp, tscGit, testGit, truth, humanVerdict?}`. Emits the human-review queue (disagreements + 20% sample). |
| `aggregate-dogfood.mjs` | Joins `results-swarm.jsonl` + `adjudication.jsonl` + `warpline grade --json`. Computes §3 metrics, the §3.7 KILL evaluation, seeded-vs-organic split, and renders the markdown tables (mirror `base-rate/render.mjs` style). |
| `run-manifest.json` | Records base commit sha, session count, agent ids, catalog hash, CLI version — reproducibility. |

Reuse from `scratchpad/base-rate/`: the `oracle` execFile wrapper (`driver.mjs`), the aggregation/table-render idiom (`aggregate.mjs`, `render.mjs`), and the direct-overlap-vs-ripple triage idea (`triage.mjs`) as a secondary sanity check on which meaning-decisive rows are direct-symbol-overlap vs closure-ripple.

**CLI verbs used (all shipped):** `warpline init`, `warpline fabric attest`, `warpline scratch <id>`, `warpline pick --agent <id>`, `warpline admit <id> --ref <sha> --json`, `warpline oracle <a> <b> --json`, `warpline restore`, `warpline grade --json`, `warpline fabric verify`. Env: `WARPLINE_AGENT_ID`.

---

# Agent Relay

```yaml
- from: "[Loid (forge)]"
  to: "[Cid (navigator), Aegis (security), founder]"
  re: "Move-3 dogfood falsifier — buildable harness spec landed"
  top_line: >
    Two calls I own and am putting my name to. (1) LIVE-VS-THROWAWAY: run the
    seeded experiment on a DEDICATED THROWAWAY fabric, NOT the live anchored one.
    My original wanted real strands in the real fabric for moat data — the anchor
    changed that math. Seeding 100+ construct strands into a freshly-frozen v1
    epoch would poison the live grade ledger (linked/independent survival would be
    dominated by synthetic interference, not organic work) and bloat the real
    Tapestry. The calibration signal we actually want is engine-level and is just
    as valid in a throwaway clone. Real-strand moat data is earned later, from the
    ORGANIC arm on the live fabric, once the wedge clears H1.
  seeded_construct_honesty: >
    (2) Is seeding scientifically honest enough to trust H1? YES — with three
    guardrails that make it so: (a) seeded vs organic reported SEPARATELY, never
    blended into one headline; (b) H1 is scoped as "WHEN genuine interference
    exists, warpline is meaning-decisive at rate R" — explicitly NOT a
    base-rate-in-the-wild claim (the base-rate study owns that, and it found
    interaction rare: 0/18). Manufacturing the swarm condition git-history cannot
    supply is the whole point, and it is labelled as a construct everywhere.
    (c) Non-circularity is real: adjudication is tsc + tests + authored
    ground-truth, all external to Warpline; warpline never scores itself; a
    mis-authored seed is quarantined by its own tsc/test blind-check. The one
    thing that would make it dishonest — only seeding "easy" wins — is defused by
    the NEGATIVE-CONTROL stratum and the false-KNOT ≤ true-catch guardrail.
  the_teeth: >
    KILL if meaning-decisive <2% of symbol-bearing concurrent admissions, OR
    false-KNOTs outnumber true catches, OR linked/independent survival are
    statistically indistinguishable (<15pt gap or z-test p≥0.05). Hard stop on any
    FALSE-CLEAN (a sealed merge that fails tsc/tests) — that is the wrong-merge
    failure the whole meaning→bytes layer exists to prevent; one occurrence halts
    the run before any metric is trusted.
  needs: >
    Cid: sanity-check the CLI verb surface in §5 (I confirmed scratch/admit/grade/
    oracle/fabric-attest/restore all shipped). Aegis: confirm throwaway-fabric
    isolation is airtight (no worktree escapes into the live .warpline/). Then hand
    to a builder — files in §5 are concrete; counterfactual.mjs is a verbatim reuse
    of base-rate/driver.mjs's oracle call.
```
