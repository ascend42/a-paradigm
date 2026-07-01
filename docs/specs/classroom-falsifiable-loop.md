# The Falsifiable Classroom Loop — Design Arc

> **Status:** design (not built). **Team:** Loid (lead — semantics + falsifiability contract), Arky (architecture + file plan), Cid (capture-widening + liveness). Orchestration `orch-mr2gqojz-jjh4`.
> **Consumes:** decision `TD-2026-06-26-881` (Classroom × registry — accepted). **Anchor task:** `T-2026-06-13-004` (v7 TEETH). **Correction task:** `T-2026-07-01-016`.
> **Goal:** make agents *measurably* better at **micro** (per-project, the moat) and **macro** (population/registry prior) scales, by replacing the two fabricated signals with measured signal — and making a dead loop **detectably** different from a healthy one.

## The one principle

**Wall-clock time may DECAY a belief's confidence, but must never MINT evidence.** Only a real invocation resolves a claim. Every layer below enforces this.

---

## The diagnosis (verified against the tree)

The classroom improvement loop has 3 layers; 2 run on fabricated signals.

| Layer | Should do | Verified current state |
|---|---|---|
| **1. Capture** (session→journal) | real work → learning | Wired via `settleParentIfComplete` (`task-settlement.ts:288-303`), but only fires on a **DAG-parented** terminal task with **logged verdicts** (`task-loader.ts:552/556`; parentless bails at `task-settlement.ts:178`). Ad-hoc work captures nothing. |
| **2. Promote** (journal→notebook) | promote what *moved belief* | Gate enforces absolute `confidence_after >= 0.8` (`nomination-engine.ts:1010-1012`); journal `confidence_before` is fabricated literals (`ambient.ts:685`=0.7/0.8, `:732`=0.6). **But the real delta is already measured** by the v7.1-r4 instrument (`nomination-engine.ts:982-1008`: `notebookPrior`→`promotion-decisions.jsonl`, real `{before,after,delta}`), explicitly deferring the gate flip until a histogram exists. |
| **3. Resolve** (notebook→survived/overturned) | outcome = tested-and-held | `survived` is **decay-minted silence** — `runDecayPass` flips pending→survived on a 14-day no-break timer (`decay.ts:52,127-139`), consulting no exercise signal. `overturned` *is* attribution-gated (`field-failure-reducer.ts:111-135`). Rate null when 0 resolved (`classroom-metrics.ts:123,135`). |

**The through-line:** the whole "agents get better" claim rests on hardcoded `confidence_before` (L2) and decay-minted `survived` (L3). An agent can look like it's improving with zero measured belief-movement and zero real tests — the falsifiability rot (*"a broken loop is byte-identical to a healthy one"*), **empirically confirmed**: all 5 records in `settlement-liveness.jsonl` today read `chainLive:true, journalsWritten:0`.

**Verified foundations (recheck log):**
- Exercise signal already exists — `notebook-refs.jsonl` records `{agentId, notebookEntryIds, orchestrationId}` on prompt-load (`session-work-log.ts:80-94`); `incrementApplied` at `notebook-loader.ts:426`.
- L2 instrument real & deliberate — `nomination-engine.ts:982` comment: *"measure the belief delta, do NOT gate on it… so the delta bands can be calibrated from a real histogram later."*
- No scenario-run outcome ledger exists (E2/E3 below need net-new surface).

---

## 1. The Falsifiability Contract (Loid — the acceptance test)

> **`survived` is monotone in EXERCISE, never in TIME.**
> For any window [t₀,t₁]: **`Δsurvived = 0` whenever `adversarialProbes + breakAttempts = 0` over that window.**
> Every `survived` cert has ≥ `K_min` exercise events (each with a real join receipt — an `orchestrationId` notebook-ref or a `scenario-run` id), of which ≥1 is an adversarial probe or a natural break-attempt.

**Executable CI guard:** freeze all orchestration + scenario activity, advance the clock arbitrarily, run the resolution pass → **assert `Δsurvived == 0`.** Fails under today's `decay.ts` (which mints survival); the day it passes, the loop is falsifiable. The operational signal that MUST diverge when learning stops: **exercise-intensity rate `d(Σ exerciseCount)/dt`** — flat under a dead loop, while the *old* design still shows a rising `resolved`/defined `rate`. That gap is the anti-byte-identical property.

---

## 2. Layer 3 — what `survived` MEANS (Loid semantics + Arky mechanism)

**Meaning:** *exercised k ≥ `K_min` times and held every time* — never "aged in silence." Silence becomes a new distinct state, **`unproven`**.

**Exercise events (each requires a real receipt):**

| Type | Evidence | Increments |
|---|---|---|
| **E1 apply-and-held** | entry injected under `orchestrationId` (notebook-ref receipt) + orchestration reached terminal verdict + **no** `field-failures` row for `(entryId, orchestrationId)` | `exerciseCount`, (`breakAttempts` if a break was attempted and failed) |
| **E2 adversarial probe** | a scenario `SC-*` with `probe.learning_ref == entryId` is RUN and holds (`expected.must == 'survive'`) | `exerciseCount`, `adversarialProbes` |
| **E3 explicit re-application** | claim re-drilled against the scenario bank and holds | `exerciseCount`, `adversarialProbes` |
| ~~aging~~ | clock only | **nothing** |

**E1 is the elegant core:** it's the *symmetric complement* of the existing overturn reducer. `runFieldFailureReducer` already does the `orchestrationId` join and writes `overturned` on an attributed break. The missing piece is a **symmetric survival reducer** — same join, over terminal orchestrations, writing `survived` (with `exerciseCount++`) when NO break attaches. **Overturn = applied+broke; survived = applied+held.** This *replaces* decay's survival-flip entirely; decay keeps only its confidence-decrement half.

**State machine:**

| From | To | Trigger | Evidence |
|---|---|---|---|
| pending | survived | exerciseCount reaches K_min, all held | ≥K_min receipts, ≥1 probe/break-attempt |
| pending | overturned | attributed break | field-failures join (existing) |
| pending | **unproven** (NEW) | aged past window, exerciseCount==0 | clock + absence of any receipt |
| unproven | survived / overturned | later exercised & holds / breaks | as above |
| survived | overturned | a *later* break re-opens (incl. "X except Y" refinement) | field-failures join; `overturn wins` (`decay.ts:130` stays) |

`computeRepeatFailureRate`: `resolved = survived + overturned` unchanged as a *formula*, but `survived` now means tested-and-held, so `rate = overturned/resolved` finally means what its docstring claims. Add `unproven` (aged-pending-without-exercise) to the rollup — the honesty surface TD-881 amendment 4 requires. Rate stays `null` until an *exercised* cert resolves → **no false-green regression**.

---

## 3. Layer 2 — belief-delta promotion (collect the debt the instrument set up)

The real prior `notebookPrior(agentId, concepts, rootDir)` (`notebook-loader.ts:178-214`) is already computed at the gate. The fix is two precise moves:

- **(a) Stop the dead lie:** delete fabricated literals at `ambient.ts:685,732`; backfill journal `confidence_before` from `notebookPrior` at write time (best-effort, literal as fallback).
- **(b) Gate on the delta already measured** (`nomination-engine.ts:1004`), dropping the absolute `after < 0.8` test (`:1012`) — **for the autonomous `certifiedBy:'gate'` path only**:

| Condition | Action | Rationale |
|---|---|---|
| `found==false` AND `after ≥ FLOOR` | **PROMOTE** (new belief) | delta from DEFAULT_PRIOR is genuine new knowledge |
| `delta ≥ +MOVE_MIN` AND `after ≥ FLOOR` | **PROMOTE** (strengthened) | belief measurably rose |
| `|delta| < EPSILON` AND `found` | **HOLD** | restating an existing high belief is redundancy, not learning — *silence is signal* |
| `delta ≤ −MOVE_MIN` | **REFINE, don't certify** | belief FELL → route to `reviseDown` / "X except Y" |

Bands **calibrated from the existing `promotion-decisions.jsonl` histogram**, not asserted (starting guesses: `FLOOR=0.7`, `MOVE_MIN=+0.1`, `EPSILON=0.05`). The `certifiedBy:'peer'|'quorum'` (human `/class`) path has **no** delta gate — a human ruling *is* the gate (two-loops).

---

## 4. Layer 1 — widen capture + the liveness instrument (Cid)

**Capture-widening** (additive; never alter `updateTask`'s terminal invariant):
- **Entrance A** (unchanged): parented sibling-set settlement.
- **Entrance B (NEW):** leaf-capture arm for parentless terminal tasks — fires the full chain only when a real verdict is in scope (`verdictsInScope > 0`), else appends a cheap `idle` liveness marker. The `idle` record is load-bearing: it distinguishes *"looked, nothing to learn"* (healthy) from *"never looked"* (coverage hole). Anti-flooding gate.
- **Entrance C (NEW):** fix the verified debrief self-heal gap (`captain.ts:696` calls the learning pass directly, writes **no** liveness record) with a session-level capture record.

**The liveness metric (the falsifiability instrument).** Add one field — **`verdictsInScope`** — to `LivenessRecord` (`task-settlement.ts:61-74`), captured before the chain consumes verdicts. Then, computed in `paradigm doctor` over `settlement-liveness.jsonl` + the task index:
- `captureCoverage = capturedTasks / terminalTasks` (did work enter the funnel?)
- `learningYield = J_total / V_total` when `V_total>0` (did verdicts become journals?)

**Separating healthy-zero from broken-zero** (condition the alarm on `verdictsInScope`, never on journals alone):

| Condition | Status |
|---|---|
| `V_total==0, J_total==0` | **OK** — quiet term, correct silence |
| `V_total>0, J_total==0` | **FAIL** — loop severed |
| `V_total>0, learningYield>0` | **OK** — learning live |
| `captureCoverage < 0.8` | **WARN** — ad-hoc work escaping capture |

Advise-only (learning gaps never hard-block). This is the operationalization of Loid's contract: today the two zeros are byte-identical; `verdictsInScope` makes them numerically distinct.

---

## 5. The micro/macro seam — one contract, not two

| Layer | Signal | Class |
|---|---|---|
| 1 | work-log verdicts, notebook-ref receipts | LOCAL-MOAT |
| 1 | scenario authored from a break (`SC-*`) | POPULATION-PORTABLE (after amend-8 redaction) |
| 2 | `confidence_before`/delta/promotion rows | LOCAL-MOAT |
| 2 | refined "X except Y" entry (the knowledge) | POPULATION-PORTABLE |
| 3 | per-project cert rows (`outcome`, `exerciseCount`…) | LOCAL-MOAT (the moat) |
| 3 | aggregate `survivalShape{survived,overturned,pending,unproven}` + `sampleSize` + `{adversarialProbes,breakAttempts,distinctProjects}` | POPULATION-PORTABLE (the CalibrationPrior SHAPE) |

**Layer 3 PRODUCES the denominator TD-881 amendment 1 requires.** The L3 exercise counters (`exerciseCount`, `adversarialProbes`, `breakAttempts`) **are** the registry's exercise-intensity denominator — they exist by construction (they're the evidence that mints `survived`). Define `ExerciseIntensity` **once** (in `field-failures.ts`), import it into `registry-types.ts`. Idle throwaway projects produce `unproven`, not `survived` → **the population prior is impossible to launder** (closes the exact channel the adversarial review found). Two denominators would re-fork that channel.

---

## 6. File plan (Arky) — dependency-ordered

**Sub-phase 0 — types/schema (parallel; L3 schema is the keystone):**
- `field-failures.ts` — `ExerciseIntensity` + `ClassroomCertRow.exercise?` + `ExerciseEvent` + `classroom-exercises.jsonl` const
- `classroom-metrics.ts` — `unproven` on the rate interfaces
- `registry-types.ts` — `CalibrationPrior` importing shared `ExerciseIntensity` (contracts-only, DO-NOT-RENDER doc-comment)
- `nomination-engine.ts` — `PromotionDecision.floor?` + band constants (`PROMOTION_DELTA_MIN`, `PROMOTION_FLOOR`, `MIN_EXERCISE`/`K_min`)

**Sub-phase 1 — core logic (L2 ∥ L3):**
- L3: `appendExerciseEvent`/`readExerciseEvents`/`exerciseCertification` (batched single-rewrite); new `exercise-accrual.ts` (survival reducer, reuses orchestrationId join); `decay.ts` survival-flip → gated on `exercised ∧ aged ∧ ¬broken` (+ `minExercise` test seam); `classroom-metrics.ts` denominator + `unproven`
- L2: `nomination-engine.ts:1010-1012` delta+floor gate, relabel `gate`→`delta-v1`

**Sub-phase 2 — integration:**
- L2: wire `notebookPrior` into `confidence_before` (`ambient.ts:685,732`); update `:112` description
- L3: insert `accrueExercise` stage in `task-settlement.ts` **between** the failure reducer and decay; `rollupExerciseIntensity` (feeds CalibrationPrior, not rendered)
- L1: stop-hook postflight trigger + session-consumed guard; leaf-capture arm; `verdictsInScope` field + doctor CheckResult

**Sub-phase 3 — tests:** `decay.test.ts` (UPDATE — aged-but-unexercised no longer survives, `:158`), new `exercise-accrual.test.ts`, `classroom-metrics` (`unproven`/null-until-exercised), `nomination-engine` (delta+floor gate), `ambient` (real `confidence_before`), `registry-types` (shared shape), liveness metric.

**Cross-layer edges:** L3 schema first (decay+metrics+registry consume it) → L2 ∥ L3 → **L1 lands last** (settlement-chokepoint risk).

**Risk order (be conservative):** L1 non-DAG trigger > decay predicate > cert third in-place writer (batch to one rewrite; TD-798 lost-update discipline) > promotion gate. All new settlement stages copy the existing best-effort try/catch so they can never break settlement.

---

## 7. Open decisions (need Loid/human ruling before build)

1. **`K_min` + adversarial requirement** — does natural apply-and-held (E1) alone reach `survived`, or is ≥1 adversarial probe (E2/E3) *required*? Loid leans "≥1 adversarial required" (passive exposure shouldn't mint survival; matches amendment-1 spirit).
2. **Promotion bands** (`FLOOR`/`MOVE_MIN`/`EPSILON`) + `K_min` — calibrate from `promotion-decisions.jsonl`; don't ship the guesses.
3. **Scenario-run ledger** — E2/E3 need a net-new `scenario-runs.jsonl` (`scenarioId, entryId, orchestrationId, outcome, ts`); scenarios have no run-outcome log today.
4. **Terminal-verdict "held" marker** — E1 needs "orchestration reached terminal WITHOUT breaking this entry"; confirm the notebook-ref receipt / work-log carries a terminal-orchestration marker or infer it (Cid).
5. **Widen capture vs accept starvation** — Cid's leaf/session capture feeds L3's receipts; if we don't widen, certs exercise slower (fewer but real). Recommend widen (Entrance B/C) so `survived` can actually accrue.
6. **`decay.test.ts:158`** intentionally breaks (time-only survival removed) — migrate with the change.
