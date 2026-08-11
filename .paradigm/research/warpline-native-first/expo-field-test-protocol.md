# Warpline Expo Field-Test Protocol — Pre-Registration

Status: PRE-REGISTRATION (author: architect, 2026-08-11, task T-2026-08-11-018).
Nothing below may be changed after the first admission of the run is sealed. Any
change after that point voids the run and starts a new pre-registration with a new
id. This is the whole point: the decisions here are made BEFORE the run so they
cannot be chosen to fit the result.

Authorizing decisions: TD-2026-08-11-663 (field test authorized; Expo project
supplies the contested denominator; mirror mode; each KNOT classified
genuine-vs-over-block at resolve time), TD-2026-08-11-838 (scope = prove the value
prop on Paradigm+Claude; the three standing falsifiers are the bar),
TD-2026-08-11-351 (fixed-n stopping; optional stopping is the named failure mode).
Commissioning audit: L-2026-08-11-ascend-202004-001 (five-agent flight-readiness
panel) and `.paradigm/research/warpline-native-first/soundness-audit-2026-07-31.md`.

---

## 0. Why this document exists

The flight-readiness panel found that the field test, as previously designed,
"would complete, produce numbers, and prove nothing." Three specific defects:

1. Falsifier (A) — a false CLEAN — is invisible by construction. A false CLEAN
   renders byte-identically to a true one (`merge.result === binding.treeId` holds
   on the wrong bytes; audit C-2). With no instrument capable of observing one, the
   run's default output is "no false CLEAN observed," which would be reported as (A)
   surviving when nothing that could have seen one was present.
2. The false-CLEAN rate is uncalibrated. The one prior POWERED run
   (`.paradigm/research/warpline-dogfood/aggregate-full.md`, 144 concurrent
   admissions) produced 8 false-CLEANs against a pre-registered "must be 0 → HARD
   STOP," a 10% rate in the independent/auto-weave stratum, and the confidence prior
   showed no predictive signal (z = -0.31, p = 0.76). This is live, not
   hypothetical.
3. The genuine-vs-over-block classification — the denominator for falsifiers (B)
   and (C) — is done by the founder alone, unblinded, with maximum incentive, no
   second rater, no pre-registered n, and no stopping rule.

This protocol fixes each defect before the run, or the run does not start.

## 1. The bar (verbatim, ratified — TD-2026-08-11-838)

- (A) FALSE CLEAN: one admit that seals CLEAN over a state a competent human calls
  broken falsifies "meaning judges" outright.
- (B) MEANING ADDS NOTHING OVER BYTES: if semantic verdicts nearly always agree
  with a three-way byte merge, the layer is decoration.
- (C) FAILING CLOSED IS UNAFFORDABLE: if the refusal rate makes humans the
  bottleneck, it is a tax, not a feature.

These three are not restated in softer words anywhere below. Where a threshold is
needed to make one measurable, it is drawn from an ALREADY-RATIFIED gate (the
Move-3 pre-registered kill gates K1/K2 and the "false-CLEAN must be 0" hard stop),
so the bar cannot be accused of being chosen to be passable (TD-838 principle).

## 2. Run configuration (fixed)

- Subject: one Expo / React Native application, real feature work, not a driven
  swarm on a-paradigm and not a synthetic harness (TD-663 decision 1).
- Concurrency: 2–4 agents. The 20s global-lock ceiling throws above ~4 concurrent
  writers (audit MEDIUM; ~13-agent availability ceiling, but contention timeouts
  begin well below it), so 2–4 is the honest band. Report the actual per-episode
  agent count.
- Model/provider: Claude only, agents driven through Paradigm (TD-351 decision 12;
  TD-838 scope). Cross-model generality is explicitly out of scope for this run.
- Product mode: MIRROR MODE — Warpline runs alongside git, git tracks the tip,
  git is load-bearing for durability (TD-663 decisions 2 and 4). Warpline is never
  the sole custodian in this run.
- Enforcement: agents run under MCP, never raw shell (Section 6, habit i). This is
  a hard setup precondition, verified before the first agent starts.

## 3. Sample size and stopping rule (PRE-REGISTERED)

Doctrine: fixed n, decided up front, run all of them, report whatever comes,
including a fail (TD-351 decision 10). Optional stopping — reading the numbers and
stopping when they look favorable (or unfavorable) — is the exact failure mode
TD-351 names and is forbidden here. Sequential/boundary designs were considered and
rejected in TD-351 as too easy to get subtly wrong; fixed n is unambiguous.

PRIMARY n: 100 sealed admissions.

- Why 100: it is the controllable quantity (each agent seals when it finishes a
  unit of work), and it matches the ratified K3 quantity (≥100 contested verdicts
  was the written roadmap exit gate that TD-838 softened to the three falsifiers
  without restating an n — this restores the quantity). At the ~10% prior
  false-CLEAN rate, 100 admissions is very likely (>99%) to surface at least one
  false CLEAN in the dangerous stratum if the rate is anywhere near the prior, and
  the CLEAN-sealed subset is large enough to bound the rate by the rule of three
  (Section 7A).

STOPPING RULE:

- Run to exactly 100 sealed admissions. Do not stop early. Do not extend.
- A confirmed false CLEAN does NOT stop the run. Under TD-838, one confirmed false
  CLEAN falsifies (A) the moment it fires — but the run continues to n=100 so that
  (B) and (C) are still measured on a full population. (A)'s verdict is recorded at
  the instant it fires; the run does not react to it.
- No interim analysis is used to decide whether to continue. Batch-boundary oracle
  runs (Section 4) are a DETECTION instrument, not a stopping trigger.

DRIVER (how 100 admissions with real contention are reached): the standing problem
is that contention never happens — one human editing serially cannot make the
concurrency the product adjudicates. Before the run, declare a backlog of Expo
feature tasks sized to produce ~100 admissions, with deliberate OVERLAP ZONES
(shared config files, shared modules, a shared route/screen) so two agents are
routinely proposing against the same base. The backlog is fixed before the run;
agents pull from it. Overlap is engineered into the WORK, never into the verdict.

CONTESTED FLOOR (the honest guard against a vacuous pass): the number of contested
verdicts (genuine KNOTs, per Section 5's blinded classification) is NOT
controllable and is NOT fixed. It is a floor, not a target:

- If genuine (blinded) contested verdicts < 20, falsifiers (B) and (C) are reported
  UNDERPOWERED / INCONCLUSIVE — never as surviving. "Zero KNOTs observed" is not
  evidence that failing closed is affordable; it is evidence that nothing was
  contested. This closes the trap the panel named.
- If the founder chooses to run a second block to reach the floor, its n (another
  fixed 100) is declared before that block starts, and the two blocks are reported
  SEPARATELY. Blocks are never pooled to cross a threshold — pooling-until-
  significant is optional stopping through the back door.

CONTESTED COUNT SOURCE: the contested denominator is counted from the audit ledger
(Section 4/5, one hand-recorded row per KNOT/downgrade at resolve time), NOT from
`warpline health`. Audit finding B-3: real byte-downgrade KNOTs do not increment
the `health` contested counter (`health.ts:710` counts persisted payloads;
`native.ts:697`/`admit.ts:997` downgrade returns before persisting the payload), so
the two arms of the tool measure different populations. The ledger is authoritative.

## 4. Falsifier (A) detection procedure (PRE-REGISTERED)

Defined here so the run cannot default to "no false CLEAN observed." A CLEAN is
audited by an INDEPENDENT oracle; only a CLEAN the oracle actually examined AND had
the power to break can count toward (A) surviving.

THE ORACLE. After every admission that seals CLEAN:

1. Restore the sealed merged tree into a scratch directory via the native
   `restoreTree` path (git-absent restore is real; the sealed selvage tip is the
   input). This is the exact bytes Warpline claims are a clean merge.
2. Run the Expo project's OWN green-gate against the restored tree, each check
   recorded pass/fail:
   - `tsc --noEmit` (typecheck)
   - the project's lint config
   - the project's test suite
   - a bundle/build (`expo export` or the metro bundle the project uses)
3. Run a SCRIPTED BEHAVIORAL ORACLE — a fixed smoke script, written and frozen
   before the run, that exercises the app's key flows AND explicitly probes the
   config×code couplings the type system is blind to (e.g. an assertion that a retry
   loop's iteration count equals the value in the config it reads, that a screen
   renders against the config that names it, that an env-driven flag reaches the
   code path it gates). The behavioral oracle is the ONLY instrument that can catch
   the canonical invariant-conflict false CLEAN (`tsc` cannot — the class is pinned
   undetectable in `hazard-advisory.test.ts`). Its coverage is declared in advance
   as a fixed checklist of couplings; couplings not on the checklist are BLIND, not
   passed.

ESTABLISHING POWER (the control that makes a pass meaningful). Both parent states
of the merge are run through steps 2–3 independently BEFORE the merge is judged. A
false CLEAN is a check that PASSES on each parent alone but FAILS on the merged
tree — the merge produced a broken state neither side was broken in. A check that
was already red on a parent proves nothing about the merge and is excluded.

ATTRIBUTION. A candidate false CLEAN is attributed to the specific admit that
sealed it: record `strandId`, `pickId`, the two contributing agent ids, the two
parent stateIds, the merged treeId, and which oracle check failed.

CONFIRMATION. A candidate false CLEAN is confirmed only when a blinded rater
(Section 5, same machinery) agrees that the failing merged state is one "a competent
human calls broken" — falsifier (A)'s own wording. The founder alone may not both
seal and confirm.

RECORDING. Every audited CLEAN gets one row in `expo-field-audit.jsonl`:

```
{ strandId, pickId, agents:[a,b], parentStateIds:[..], mergedTreeId,
  oracle:{ typecheck, lint, test, build, behavioral:{coupling:result,...} },
  coveredClass: true|false,        // false if the merge touched only blind classes (Section 5)
  verdict: "true-clean" | "candidate-false-clean" | "blind-untested",
  blindedConfirmation: "broken" | "not-broken" | "pending",
  attributedAdmit: pickId }
```

THE DEFAULT IS NOT A PASS. (A) may be reported as surviving ONLY over the covered
class set, ONLY when the oracle demonstrably ran on every CLEAN seal, and ONLY with
the covered-CLEAN denominator stated. Every CLEAN whose changed paths fall entirely
in a Section-5 blind class is recorded `blind-untested` and is EXCLUDED from the
surviving denominator and reported separately as "not tested." A run dominated by
blind-class CLEANs yields "(A) not tested," never "(A) survives."

## 5. Genuine-vs-over-block classification — blinded (PRE-REGISTERED)

The denominator for (B) and (C), and the confirmation step for (A), must not rest on
one unblinded incentivized rater.

TWO RATERS.

- Primary rater: the founder, at resolve time. This is operationally unavoidable —
  `resolve` is the act that clears a KNOT and the run cannot proceed without it. The
  founder's call is recorded but is NOT the denominator.
- Second rater: BLINDED. Every KNOT (and every candidate false CLEAN from Section 4)
  is packaged into a RATING CARD that strips everything that could leak the answer:
  the Warpline verdict and confidence label, the founder's classification, and all
  Warpline reasoning/refusal prose. The card shows only the base, the two sides'
  diffs (both full bodies), the file paths, and the two task intents.

SECOND-RATER IDENTITY (pre-registered, in priority order):
  1. A second human engineer, unfamiliar with the thesis, if available.
  2. Otherwise an LLM judge (a frontier model), given ONLY the rating card and the
     rubric, no Warpline context. Provider and exact version are pinned in the run
     record. This doubles as the long-deferred LLM-judge falsifier
     (T-2026-07-14-004) and is itself blinded by construction.
The second rater is chosen before the run and does not change mid-run.

RUBRIC (frozen). For each contested item the rater answers one question with no
knowledge of Warpline's verdict:

"If a competent engineer merged these two changes by hand, is a human DECISION
required to produce a correct result?"

- GENUINE — yes. The two changes cannot both stand as written; someone must choose,
  combine, or rewrite. (A real conflict. This is Warpline earning its keep only if
  git would have merged it wrong or forced the same decision.)
- OVER-BLOCK — no. The two changes compose correctly with no decision needed; a
  hand-merge (or git's three-way merge) yields the right result and Warpline flagged
  it anyway. (A false KNOT — a commuting/ripple edit. Move-3 measured 3/3 false-KNOT
  on the ripple stratum, so this is expected in the denominator.)
- INDETERMINATE — the card is insufficient to decide. Reported as its own bucket,
  never silently folded into either.

For candidate false CLEANs the question is falsifier (A)'s wording instead: "is the
sealed merged state one a competent human calls broken?" — broken / not-broken /
indeterminate.

AGREEMENT AND ADJUDICATION. Report primary-vs-second agreement as Cohen's kappa.
The DENOMINATOR for (B) and (C) uses the SECOND (blinded) rater's classification,
not the founder's. Where the two disagree materially, report both counts and flag
the run; do not silently pick one. Ties/indeterminates are reported, never rounded
into a favorable bucket.

## 6. The three operating habits — mandatory written procedure

Each is a checklist step with its failure-mode-if-skipped. These convert the "habits
the panel found were merely intended" into procedure the run cannot pass without.

HABIT (i) — Agents run under MCP, never raw shell.
- Step: before the first agent starts, verify every agent's Warpline access is
  through the MCP surface (the daemon enforces `HUMAN_ONLY_VERBS` at
  `daemon/server.ts:204`); confirm no agent has a shell path to the `warpline` CLI.
- Failure mode if skipped: `$WARPLINE_AGENT_ID` is an unsigned self-assertion and is
  the SOLE key for both the HUMAN_ONLY law (`agent-shell.ts:117-118`) and the R2
  write gate (`pick.ts:242,254`). `unset WARPLINE_AGENT_ID` makes an agent
  byte-identical to the founder — it can `resolve` its own KNOT (destroying the
  genuine-vs-over-block denominator AND falsifier C in one move), stake, backup, or
  rewrite `fabric.jsonl`. The human/agent boundary the entire measurement rests on
  evaporates. The CLI has no such gate (audit C-11), which is why shell access is
  disallowed, not merely discouraged.

HABIT (ii) — Classify every KNOT genuine-vs-over-block at resolve time.
- Step: at each `resolve`, BEFORE clearing the KNOT, write the Section-5 rating card
  and record the founder's call. The blinded second rating follows (batched is
  fine). No KNOT is resolved without its ledger row.
- Failure mode if skipped: a KNOT count inflated by over-blocks makes both "meaning
  adds something" (B) and "the refusal rate is affordable" (C) unreadable
  (TD-663/TD-838, the load-bearing carried dependency). The classification is not
  extra scope; it is the difference between a number that means something and one
  that does not. Resolve-time capture is required because the diffs and intent are
  freshest then and the founder must look anyway to resolve.

HABIT (iii) — Log every reach for the git fallback.
- Step: any time an operator or agent drops to git to make progress — `git merge`,
  a manual merge, `git stash` to escape a wedge, committing a resolution outside
  Warpline, or working around the missing `abandon` verb (audit C-10: after a KNOT
  the agent ladder loops and no `abandon` exists) — record it in
  `git-fallback.jsonl`: what was reached for, why, and which admit/KNOT it relates
  to. Byte-only work that is unadmittable on the native path (audit B-1: propose
  no-ops, admit refuses, dead-end loop) counts and must be logged.
- Failure mode if skipped: falsifier (C) is measured wrong in the flattering
  direction. Silent git fallbacks are precisely the "humans became the bottleneck /
  the tool was unaffordable" signal; unlogged, the run looks smoother than it was
  and (C) is understated.

## 7. Success / failure criteria per falsifier (PRE-COMMITTED THRESHOLDS)

Stated as thresholds fixed here, not post-hoc judgment. Where a number is reused
from the Move-3 pre-registered gates it is marked [ratified].

### 7A. Falsifier (A) — false CLEAN

- FALSIFIED if: ≥1 confirmed false CLEAN (Section 4 oracle-flagged AND Section 5
  blinded-rater-confirmed "broken"), over the covered class set, attributed to a
  specific admit. One is sufficient (TD-838; and the "false-CLEAN must be 0 → HARD
  STOP" gate is [ratified] from Move-3, where it already failed 8-to-0).
- SURVIVES (this run only) if ALL hold:
  - zero confirmed false CLEANs across all audited CLEAN seals, AND
  - the covered-CLEAN denominator is large enough to bound the rate: with n_covered
    ≥ 60 and zero false, the rule of three gives a 95% upper bound ≤ 5% (3/60). This
    is the reported result — "false-CLEAN rate < 5% (95% CI), zero observed in N
    covered CLEANs" — never "meaning judges correctly," AND
  - the covered class set and the excluded blind classes are both reported.
- INCONCLUSIVE if: n_covered < 30 (upper bound too loose to mean anything) or the
  audited CLEANs are dominated by blind classes. Reported as "(A) not tested," not
  as surviving.

### 7B. Falsifier (B) — meaning adds nothing over bytes

Measure: on the field population, does the Warpline verdict diverge from a
three-way git byte-merge in a way that MATTERS and is CORRECT — meaning-decisive
auto-resolves (Warpline CLEAN where git conflicts, merge validated good by the
Section-4 oracle) plus silent-mismerge catches (Warpline KNOT where git merges clean
but the merge is a real bug). Uses GENUINE (blinded) KNOTs; over-blocks count
AGAINST meaning, not for it.

- FALSIFIED if: meaning-decisive rate < 2% of contested-eligible admissions
  [ratified K1] — semantic verdicts almost always agree with the byte merge → the
  layer is decoration.
- SURVIVES if: meaning-decisive rate is materially above the byte baseline (pre-
  committed ≥ 10%; Move-3 measured 22.2% for comparison) AND the divergences are
  validated (auto-resolves confirmed good merges, catches confirmed real bugs git
  would have shipped), on a genuine-contested denominator ≥ 20 (Section 3 floor).
- INCONCLUSIVE if: genuine contested < 20 → underpowered; do not report a pass.

### 7C. Falsifier (C) — failing closed is unaffordable

Measure: the refusal burden — over-block false-KNOT rate, human-intervention rate
per admission, and the git-fallback log.

- FALSIFIED if ANY:
  - over-block (false) KNOTs > genuine (meaning-decisive) KNOTs [ratified K2 shape:
    false-KNOT > meaning-decisive], OR
  - humans must intervene on > 25% of admissions (pre-committed ceiling), OR
  - the git-fallback log shows operators routinely bypassing Warpline to escape the
    refusal cost (not isolated known-bug workarounds).
- SURVIVES if: over-block ≤ genuine (K2 not tripped), intervention rate ≤ 25%, and
  git fallbacks are rare and attributable to named tool bugs (C-10 wedge, B-1
  byte-only) rather than to refusal-avoidance, on a genuine-contested denominator
  ≥ 20.
- INCONCLUSIVE if: genuine contested < 20 → underpowered.

## 8. Known-blind-class list (exclude-or-flag when interpreting)

These are the classes the system CANNOT judge. A CLEAN on any of them is NOT
evidence for (A) surviving and is excluded from the meaning numerator for (B). Each
is flagged in the audit ledger via `coveredClass:false`.

- `.js`/`.mjs`/`.cjs` config files (`app.config.js`, `babel.config.js`,
  `metro.config.js`, `.env`). No lens covers them — ts-lens is `.ts/.tsx` only
  (`ts-lens.ts:57`), cfg-lens is `.json/.yml/.yaml` only. Blind because meaning
  never sees the file. A CLEAN here is byte-decided; meaning contributed nothing.
  Expo ships exactly these, so this class is not rare.
- config × code coupling (cfg-lens emits `references:[]`, `cfg-lens.ts:375`). A
  config value and the code reading it are ALWAYS graph islands, so any (config
  value × code) pair is a symbol-disjoint independent CLEAN that auto-weaves with
  zero review. Blind by construction, and the canonical false-CLEAN vector on an
  Expo app (app.json / eas.json / package.json versus the code reading them). A
  CLEAN here means "no shared symbol," never "no conflict."
- non-adjacent cross-symbol edits (hazard advisory is v1 lexical-adjacency only).
  Two changes whose transitive closures are DISJOINT in the lifted graph but coupled
  through an unrepresented channel are invisible. A CLEAN here means "the graph saw
  no link," not "there is none."
- no-shared-token shared-invariant conflicts (the canonical case: A lowers a limit
  100→50, B adds a retry loop assuming the old limit). Pinned UNDETECTABLE in
  `hazard-advisory.test.ts`; zero shared literal, so even the lexical advisory
  misses it. A CLEAN here carries no invariant guarantee — the CLI must say so in
  the same breath.
- lockfiles (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, ...). Both-sides-
  divergent → take OURS wholesale + a stale marker, and `derivedStale` has ZERO
  consumers (audit I-2), so the "merge" is byte-identical to git's on every surface.
  Derived, regenerable from the manifests; meaning did nothing. Exclude from the
  meaning numerator.
- assets / binaries (fonts, images, compiled bundles). Byte-custody strands only;
  no meaning. Also note audit B-1: byte-only work may be UNADMITTABLE on the native
  path (propose no-ops, admit refuses) — a git fallback, logged under habit (iii). A
  CLEAN here means byte equality only.
- top-level exported scalar consts (e.g. `export const RATE_LIMIT = 100`). ts-lens
  lifts functions, arrow/fn-expr consts, and class members — a bare scalar const is
  NOT lifted as a code-unit. So a change to the exact value that carries an invariant
  is invisible to meaning. This is the invariant-carrier case; a CLEAN over such a
  change is blind.

## 9. Reporting

The run report states, per falsifier, exactly one of FALSIFIED / SURVIVES (this run)
/ INCONCLUSIVE, with the pre-committed threshold that produced the verdict and the
denominator it rested on. It reports: n=100 admissions; the covered-CLEAN
denominator and the rule-of-three bound; the genuine/over-block/indeterminate KNOT
counts under the blinded rater; primary-vs-blinded kappa; the git-fallback log
summary; and the blind-class-excluded counts. "SURVIVES (this run)" is always
scoped to this run and this covered class set — never generalized to "Warpline
works." A run that reaches n=100 with genuine contested < 20 reports (B) and (C) as
INCONCLUSIVE and is not spun as a partial pass.
