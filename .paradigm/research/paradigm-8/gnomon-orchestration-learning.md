# Loid: the learning side of Gnomon's pre-turn orchestration (2026-10-23)

Read-only analysis. Companion to Arky's routing design. Arky owns the router and the kernel shape. This note owns how the router finds out it was wrong, and how it gets better. (inferred) marks claims I did not count.

## 0. Where we start (counted)

- **The classifier's "confidence" is a keyword share, not a probability.** `classifyTaskLocal` (packages/paradigm-mcp/src/tools/orchestration.ts:2356-2417) returns `topScore / totalSignal`. A prompt with no keyword hits returns 0.4 and defaults to `feature`. A leading intent verb floors the score at 0.7. "Call Haiku when confidence is low" therefore needs a threshold calibrated against outcomes. A raw 0.6 means nothing until we measure what fraction of 0.6 routes settle clean.
- **Gnomon already registers the learning kinds, but nothing emits them.** The registry in packages/gnomon-contracts/src/event.ts:236-246 defines `inject.receipt`, `detector.event`, `tend.*`, `decay.writeback`, `calibration.contested|reviewer`, `verdict.founder` and `liveness.*`. A grep of packages/gnomon/src finds zero emitters for any of them. `merge.reverted` is emitted only by loops (packages/gnomon/src/kernel/loops/land.ts:492). `turn.usage` is live, and `oracle.result` is sig-mandatory (kernel/log/chain.ts:64).
- **The offer router is the right precedent for the slip.** It logs `offer.shown`, `offer.decided`, `offer.kept` and `offer.suppressed`, and it folds them in packages/gnomon/src/kernel/desk/desk-stats.ts:48. `offer.kept` is an outcome the kernel observes, not one the model claims. The route slip should copy this shape exactly.
- **Paradigm already has invocation telemetry.** `.paradigm/events/team-funnel.jsonl` holds 166 rows: 110 eligible, 43 orchestrated, 3 solo-declared, 2 bypass and 8 edit-advisory. Its writer, packages/paradigm/src/core/team-funnel.ts, already says "Loid calibrates the gates from this data". It records what was invoked, never whether that was right.
- **The outcome side is close to empty.** There are 6 user verdicts ever (`events/verdicts.jsonl`) and 1 override (`events/overrides.jsonl`). a-paradigm has no `.paradigm/learned/` directory. Calibration `groupBy` supports only `symbol|tag|type`, over lore assessments (packages/paradigm-mcp/src/tools/lore.ts:430, :883-929). The earlier findings in 06-loid-learning.md and 12-loid-direct.md still hold: the plumbing is complete and almost nothing flows. Routing must not become the next dashboard with no denominators.

## 1. Outcome signals

The router predicts that route R gets this turn to a clean, accepted result at the lowest cost. Score each route on two axes and never merge them into one scalar:

- **Q, quality loss.** Did the work need redoing?
- **C, cost.** Tokens, turns and wall time.

The objective is lexicographic: Q first, C second. A route's outcome settles at turn end + 7 days, or when the same symbols are next edited, whichever comes first. Reverts and rework arrive late. A turn-end score alone systematically flatters cheap routes.

| Signal | Source | Verdict | Why |
|---|---|---|---|
| Reverted edits (same hunks reverted within the window) | `merge.reverted` (loops only today); git-observed revert detection for interactive sessions (new) | **Honest, strong** | The kernel observes it, the router can't fake it, and it is rare enough to mean something. Only a revert of the routed turn's own hunks counts. |
| Rework commits on the same symbols within the window | git log + the `Symbols:` commit trailer (Paradigm's post-commit hook already parses it) | **Honest, medium** | Symbol overlap ties the rework to the route. Noise comes from planned follow-up work, so discount commits linked to the same task or DAG node. |
| Tests or tsc failing after an agent edit, before the human accepts | `detector.event` (registered, not emitted) | **Honest, strong** | Deterministic and attributable to the turn. Weight it by whether the failure surfaced after the turn ended, which means it escaped. |
| Review findings by severity | `oracle.result` / `contract.review.returned` | **Honest only on routes that had a reviewer** | This creates selection bias, the core loop problem (§2.4). The reviewer is also uncalibrated: 200/200 debates were complementary and 5/5 certifications survived. Count a finding only when its fix was applied, or when it was later confirmed by a revert or rework. |
| Human overriding the slip | `route.decided` (new) | **Honest about preference, weak about quality** | An override happens before the outcome exists, so it is a prior, not a label. Not overriding is not approval, because automation bias makes the default sticky. Track time-to-accept: a sub-second accept is a non-signal. |
| Human correction turns in the same session ("no, revert that", "you missed X") | turn text → `detector.event` via a deterministic phrase list, with the local model as fallback | **Honest, noisy** | It is the best early signal we have. Classification error is real, so store the detector's own confidence. |
| Turns and tokens to completion | `turn.usage`, `session.compacted` | **Cost only; easily gamed** | Never use it as a quality signal. Shorter can mean the model gave up. Report it only as tokens per clean outcome. |
| Soft-blocks | `.paradigm/remediations/`, `overrides.jsonl` | **Noisy, roster-dependent** | Blocks come from agents and vanish when Rune or Aegis aren't on the roster. Use them as a feature (area risk), not an outcome. |
| Session abandoned or restarted mid-task | `session.drained`, `request.session.restart` | **Ambiguous** | It can mean failure, or just lunch. Ignore it for v1. |

Rule from 12-loid-direct §3, applied here: **agents claim; only the kernel logs.** No self-reported "done, all tests pass" counts as an outcome.

## 2. How routing learns

### 2.1 Unit and keys

Each decision is a `route.proposed` row. Key it by (repo, area, taskType, human). The area is the nearest `.purpose` owner of the symbols the turn touches, resolved deterministically by Cid's pack. Learn two different models and never let them contaminate each other:

- **Risk model, keyed per repo × area × taskType:** P(clean | arm). This is what review or a team protects against. It belongs to the code, not to the person.
- **Preference model, keyed per human:** which slip this person picks given the risk estimate. It belongs to the person and stays on their device (§5.2).

Use hierarchical shrinkage: global prior → repo → area. An area cell with fewer than about 15 settled routes (inferred) borrows almost entirely from its repo. Per-human preference starts after 30 decisions. Before that, show the risk-model default.

### 2.2 Cold start (deterministic, no LLM)

1. `classifyTaskLocal` gives the type.
2. Risk floors from structure, which no learning can lower without class certification:
   - the turn touches a `^gate` or `portal.yaml` route → minimum is agent + reviewer;
   - ripple fan-out ≥ N symbols or ≥ 3 components (the CLAUDE.md flow threshold) → team is offered;
   - a `~aspect` with an enforcement owner on the roster → that owner reviews.
3. **Backfill area risk from history before the first live route.** Walk `git log` with the `Symbols:` trailer: revert and `fix(` commits per symbol over 90 days give a prior P(rework) per area. a-paradigm has this history today, so the founder's own repo does not cold-start. This is the cheapest high-value step in the whole design.
4. The Haiku or local-model fallback runs only when the deterministic score falls in a band calibrated per §4. It starts at [0.4, 0.6] and is recalibrated monthly. Log `classifier.source` on every row so we can measure whether the fallback improves anything. If it doesn't beat deterministic routing on settled outcomes after 100 fallback calls, turn it off.

### 2.3 How overrides feed back

- An override is logged with `{from, to, direction: up|down}`, and then the route **still settles**. The settled outcome decides who was right.
- **Up-override** (the human asks for more): if the heavier route's reviewer finds an applied major finding, credit the human and raise the area's risk prior. If it finds nothing, record it as a preference only.
- **Down-override** (the human asks for less): settle normally. If rework or a revert follows, that is strong evidence for the area floor. Surface it once, in the weekly digest, never at the moment.
- Repeated same-direction overrides in one cell (3 in 10, inferred) move the preference model's default immediately, without changing the risk model. People get their way fast, and risk learns slowly.

### 2.4 Breaking the feedback loop

The trap: a router that routes to "single agent" never sees a reviewer, so it never learns a reviewer would have helped. There are four mechanisms, in priority order:

1. **Shadow audits on cheap routes (upward exploration).** Sample 10% of settled direct or single-agent turns at first, and lower it toward 3% as cells fill. Run a post-hoc, non-blocking review of the diff on Haiku or the local model under a budget permit. A finding the human then agrees to fix is a counterfactual: "the reviewer would have caught this". This is the only clean estimate of the under-route rate. Its cost shows as its own line (§4), and the human sees nothing unless a finding is serious.
2. **Downward counterfactuals from routes that had review.** When a reviewer or team ran, record whether any second agent changed the outcome: an applied finding, or a plan that differed from the first draft. Zero applied findings plus an unchanged plan is evidence of over-routing. This is cheap because the data already exists on that path.
3. **Propensity logging.** Every `route.proposed` stores the probability the policy assigned to its chosen arm. Off-policy estimates such as "what if this area always got a reviewer" stay unbiased with inverse-propensity weighting. Without this, every past decision is confounded forever.
4. **Exploration goes upward only, never downward on risk-floored turns.** Never sample a lighter-than-floor route to "see what happens". That spends the human's code quality on our experiment. Downward evidence comes only from mechanism 2 and from the human's own down-overrides.

The policy itself is Thompson sampling over Beta(clean, unclean) per (cell, arm), with the four arms ordered. Treat it as a monotone ladder: escalate on doubt. The loss is asymmetric: an under-route that causes rework costs at least 3× an over-route's tokens (inferred, tunable through class).

## 3. How this fits the existing loop

**Ownership follows the tense split already in the notebooks.**

- **Cid owns the present tense:** packing context, proposing the route, the slip's reason chip, and enforcing floors. His notebooks (`~/.paradigm/notebooks/cid/nb-cid-task-dag.yaml`, `nb-cid-captain-board.yaml`) are already present-tense and advise-only, and that is the right posture for a slip.
- **Loid owns the past tense:** settlement, aggregation, calibration of the router, under- and over-route detection, and nominations. This matches `nb-forge-settlement-debt` ("you diagnose the debt, he repairs the structure") and `nb-forge-calibration` ("capture is not enough; aggregate on settle").
- **Rune and Aegis own floors in their domains.** Aegis certifies the `^gate` floor. Rune certifies `~aspect` floors.
- **Sensei** (trainer.agent) turns certified routing rules into notebook text.

**Where the knowledge lives: a new derived store, not a notebook.** Notebooks are prose for injection. Routing knowledge is counts.

- `.paradigm/learned/routing.json`: per-repo, per-area Beta counts, floors and calibration buckets. It is derived, rebuildable from the logs, and aggregated on settle. It copies the `estimate-actuals.jsonl` → `token-estimates.json` pattern in packages/paradigm/src/core/calibration.ts:11-32.
- `~/.paradigm/learned/routing-prior.json`: the cross-repo prior, with counts only and no symbol names.
- Per-human preference stays in Gnomon's local user state, private audience, never in a repo (§5.2).
- **Notebooks get only distilled, class-certified rules**, for example: "nb-cid-routing-portal: turns touching ^portal routes in this repo need a reviewer; 4/11 unreviewed ones were reverted". Each rule cites its counts.

**Connections to the existing loop:**

- **Scenarios.** Every settled misroute with a known outcome becomes a `paradigm_scenario_record` case (packages/paradigm-mcp/src/tools/classroom.ts:9-10): the prompt hash, symbols, the route taken, the route that was needed, and the evidence. This finally gives the refute step teeth: a proposed threshold change must not misroute the banked cases.
- **Study hall** replays the deterministic classifier and floors against the scenario bank offline. It's free, it's deterministic and it runs unattended. It stages threshold or keyword changes as candidates, and it never certifies.
- **Class** certifies three things: floor changes, a new fallback band, and the under/over loss ratio. The founder signs off. The first field break overturns automatically.
- **Nominations.** Loid queues a nomination only when an area's under-route rate crosses its floor with n ≥ 15. It names the area, the evidence rows and the proposed floor, in line with the 60%-accept standard in forge.agent's `session-learning`.
- **Calibration `groupBy`.** Every route stores its P(clean), and settlement gives the outcome. That is the same predicted-versus-actual math `paradigm_lore_calibration` already does (lore.ts:878-929). Extend the enum to `symbol|tag|type|route|area|classifierSource`, so a single "is the router calibrated" query works.

**New kernel kinds** (a proposal for Arky; this mirrors `offer.*`):

- `route.proposed{hsid, turn, routeId, arm, propensity, pClean, classifier:{type, score, source}, floor?, areaIds, featureHash}`, kernel-owned.
- `route.decided{routeId, decision: accept|override, to?, by, latencyMs}`, kernel-owned and written only from a human connection, like `request.offer.decide`.
- `route.settled{routeId, window, q:{reverted, rework, testEscape, appliedFindings[sev], corrections}, c:{tokens, turns, ms}}`, userland and owned by the learning loop.
- `route.audit{routeId, findings[sev], applied}` for shadow audits.

Turn on the dormant kinds in the same move. `detector.event` and `verdict.founder` are prerequisites: without them `route.settled` has nothing honest to fold.

## 4. Metrics the founder sees

**Per turn, show only the slip.** It gives the arm, one reason chip (for example "reviewer: touches ^portal-auth" or "direct: 0 reverts in #desk over 40 turns"), and override buttons. Show no scores, no percentages and no nagging.

**Weekly, show one digest card** in the Desk band. It is consumed through `digest.consumed`, so Loid knows it was read. Every number shows its n:

1. **Under-route rate.** Settled light routes with a revert, rework or applied shadow finding, divided by settled light routes. Shown by area, top 3 only.
2. **Over-route rate.** Reviewer or team routes with zero applied findings and an unchanged plan, divided by those routes.
3. **Overrides,** up and down, as a 4-week trend. A healthy router drives this down without (1) rising.
4. **Tokens per clean outcome,** against the "always reviewer" and "classifier only" baselines. Never "tokens saved" on its own.
5. **Calibration.** A reliability plot of P(clean) in five buckets, plus fallback calls and their agreement rate with the deterministic router.
6. **Exploration spend.** The number of shadow audits, their tokens, and the findings they produced.

**Alerts:** only when a falsifier trips (§6), or when an area's floor should rise. Use one card, with "not now" and "stop for this area" options, borrowing the offer mute pattern. Otherwise stay silent. A healthy week is a single line: "routes: 41 settled, 0 under-routed, 3 overrides."

## 5. Risks

### 5.1 Goodhart on tokens

This is the biggest risk. A router credited for savings learns to under-route, and quality loss arrives late while token savings show up at once.

Guards:

- The objective is lexicographic, with Q first.
- Settlement waits for the late signals.
- Floors only go up without class certification.
- Savings are reported only per clean outcome.
- Non-override is never a reward.
- Any 4-week rise in under-route rate freezes downward drift for that area until class review.

### 5.2 Privacy of logs

`.paradigm/events/*.jsonl` is committed: it shows as modified in today's git status. Per-human preference, prompt text and override timing must never land there.

- Route rows store prompt and feature hashes plus symbol ids. They never store prompt text.
- Feature and evidence fields are labeled `sensitive`, so the §9.3 redaction applies (packages/gnomon/src/kernel/log/redaction.ts).
- The repo store holds area counts only.
- The cross-repo prior strips symbol names.
- Shadow audits send diffs to a model, so they need the same grant as the session's own model. Prefer the local model, and never send a diff to a provider the session wasn't already using.
- Uninstall exports or keeps the learned state (12-loid-direct §4, the "reversible" rule).

### 5.3 The moat claim needs honest numbers

Today the calibration moat is empty on the founder's own repo: there is no `.paradigm/learned/` and there are 6 verdicts. Don't claim "learns your codebase" until all of the following hold:

- ≥ 150 settled routes in one repo;
- the P(clean) Brier score beats a constant-rate baseline;
- the under-route rate in the shadow sample is ≤ the "always reviewer" baseline + 2 points, at ≥ 25% lower tokens per clean outcome.

Pre-register these numbers before the data arrives. Publish failures too.

### 5.4 Other risks

- **An uncalibrated reviewer.** Shadow-audit truth is only as good as the reviewer, so track reviewer passes that later revert (`calibration.reviewer`, already registered). Discount reviewer severity until that track record exists.
- **n = 1 for months.** "Per human" really means "the founder". Shrinkage keeps area cells from overfitting a single week.
- **Automation bias.** The human stops reading slips. Track time-to-accept. Don't add friction to fight it.

## 6. Falsifiers (week 6 after the slip ships)

1. **Calibration.** P(clean) beats a constant-rate Brier baseline on ≥ 150 settled routes. If it doesn't, routing is a heuristic: say so and stop claiming learning.
2. **No quality cost.** The shadow-sampled under-route rate is not above the cold-start rate. If tokens fell while this rose, revert to floors-only.
3. **Overrides fall.** The override rate trends down over 4 weeks while (2) holds. If it's flat, the preference model isn't learning.
4. **The fallback earns its keep.** Haiku or local fallback routes settle cleaner than deterministic-only routes in the same score band. If they don't, remove the fallback.

**Liveness (12-loid-direct §5):** at least one `route.settled` per working day, and the digest consumed weekly. If either is zero, the loop is not running.
