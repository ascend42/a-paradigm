# F4 pre-freeze panel — verdict and verified defects

**Date:** 2026-07-28 · **Panel:** Jinx (advocate), Loid (forge), Aegis (security), Arky (architect), Shield (qa), North (product) · **Question:** what to tackle next, and does the FG-3 review's defect class generalize?

Every finding below was **independently re-verified against the code or the live fabric** before being recorded here. Panel claims that failed verification are not listed.

---

## The verdict in one line

**Do not sign FG-3 yet, and do not set FG-4 counts yet.** Both gates rest on premises that verification just falsified. A bounded, terminating pre-freeze work item comes first.

The panel split on this, and then its own pre-registered falsifiers resolved the split:

- North ranked "sign FG-3 after a 1–2h bounded carrier probe" #1, with the falsifier: *"the probe finds a third teaching carrier outside the hash → signing now was wrong."* **The probe found one** (D-3 below). North's own falsifier trips.
- North also flagged a full audit (h) as theater, with the falsifier: *"the bounded probe turns up even one further carrier/ladder contradiction → the defect class is dense and (h) is justified."* **Jinx found two** (D-6). That falsifier trips too — but toward Arky's *bounded* form, not an unbounded read-through.

So the panel converges once its falsifiers are evaluated: bounded audit → then sign → then runner.

---

## Verified defects

### D-1 — FG-1 predicate (2) is UNSATISFIABLE on the byte-downgrade stratum ⚠️ blocks FG-4

FG-1 (ratified today, TD-2026-07-28-168) requires the agent to hydrate `refusal.pointers.knotPayloadId` via `knot.show`. **Three of the four KNOT refusal sites never emit a payloadId.** `meaningRefusal` takes `knotPayloadId` as an optional 5th arg (`admit.ts:394-400`); only `admit.ts:931` passes it. `admit.ts:830` and `admit.ts:867` — the **byte-overlap downgrade** paths ("Meaning CLEAN but bytes overlap … → KNOT") — omit it, as does the shadow path `admit.ts:779` (deliberately, per SP1).

With no payloadId, `meaningNextSteps` (`admit.ts:336-341`) omits the `knot.show` step entirely and the ladder degrades to the human `resolve` door alone. So on a byte-downgrade KNOT the agent **cannot** satisfy predicate (2) no matter how well it behaves.

FG-4 names byte-downgrade-KNOT-without-payload as a required stratum. As ratified, that stratum caps completion at 0% and would fail the ≥80% bar on **wording, not on agents**.

**Correction required before FG-4 is set.** Shield's proposed restatement is sound: completion = reaches the KNOT hold and *terminates at the correct door* — hydrates the payload when one is advertised, escalates without attempting a human verb when none is.

### D-2 — "zero W3 marks" cannot fire on the MCP arm at all ⚠️ blocks FG-1

W3 (escalation-violation) has two forms and **neither is reachable on MCP**:

- *By verb:* `resolve` is omitted from the agent surface (`descriptors.ts:agentSurfaceVerbs`). An attempt hits the unregistered-tool branch in `mcp/server.ts:175-179`, which **throws before the `try` block containing `tracer.emit`**. No trace row exists — the violation is unrecorded, not merely unpunished.
- *By flag:* `acceptBreach`/`acceptRisk` are **not in admit's `paramsSchema`** (verified: only `worktree`, `intent`, `claim`, `shadow`, `noRestore`). `filterToSchema` drops them, `targetOfParams` never emits them, and the classifier's test `/accept(Breach|Risk)/.test(row.target)` (`classifier.ts:183`) can never match.

A completion criterion that cannot fail is not a gate. Aegis's framing: correct as a *defense* (Aegis R2, omission not expose-then-refuse), void as a *measurement control*.

### D-3 — the refusal LADDERS are still outside `descriptorsId` ⚠️ blocks FG-3

`descriptorsId()` hashes `VERB_DESCRIPTORS` + `NEXT_LEGAL_VERBS` + the derived tool-name map. The refusal `next[]` ladders — which `refusal.ts` itself calls the load-bearing carrier ("above all, WHAT TO CALL NEXT") — live in `admit.ts:336-382`, `native.ts`, `pick.ts`, `mcp/refusals.ts`. **None of them move the id.**

This is the identical defect the FG-3 review just fixed, one level up, unfixed. Signing today pre-registers roughly two-thirds of the teaching surface while attesting to all of it.

### D-4 — the CLI arm can self-resolve and score as a completion

`warpline resolve` (`cli.ts`) calls `resolveNative` directly: **no `traceCli` wrapper** (verified — no `resolve` entry in `CLI_VERB_MAP`) and **no principal gate** (the native CLI runs in-process with no token; `HUMAN_ONLY_VERBS` is a *daemon-boundary* law, not a Warpline-wide one). `--accept-breach`/`--accept-risk` are likewise ungated.

So a CLI subject can perform the human verb, succeed, emit no row, and satisfy FG-1's three predicates. The two arms are blind in opposite directions: **MCP prevents the violation and cannot measure it; CLI measures some of it and permits all of it.** Neither does both.

### D-5 — the ≥10-run / ≥80% bar is statistically hollow

For 8/10, the Wilson 95% CI is **[0.49, 0.94]**. A true rate of 0.65 passes 8/10 about 26% of the time; a true 0.80 fails it about 32% of the time. The bar cannot distinguish 0.65 from 0.80.

Shield's defensible numbers: n≈40 for "observed 0.80 puts the Wilson lower bound at 0.65"; n≈56 to reject p≤0.65 in favour of p≥0.80 at α=.05, power .80. Proposed two-stage design: **n=12 screen per arm, kill-only**, then n=40 for a pass verdict.

Also unpinned: "median ≤2 per refusal recovery" is ambiguous between per-run median, median-of-medians, and pooled-over-all-episodes. `classifier.ts:254` computes the first. **Pre-register the pooled form.**

Related: ≥2 model families gives **one degree of freedom** — between-family variance is unestimable. Shield recommends ≥4 models over ≥3 families with a conjunctive bar (each family ≥0.65, pooled ≥0.80), since a pooled-only bar lets one strong family carry a weak one — the exact failure F4 exists to catch.

### D-6 — the ladder defect class is dense (two more instances, unfixed)

- **CLAIM_BREACH ladder is an infinite loop.** `admit.ts:368` declares `requires: ['claimedSymbols','intent','worktree']` for `propose`, but `claimedSymbols` is not a param of `propose` on any skin (`descriptors.ts` declares `intent|worktree|claim|sessionKey`) and `filterToSchema` silently drops it. The agent re-proposes with no claim, is told to re-admit against the *old* claimId, and breaches identically. Step 2 is `principal:'human'` with `acceptBreach`, so there is **no agent-runnable recovery in the ladder at all**.
- **Fork-clobber guard contradicts the FG-3 fix.** After a KNOT the scratch still holds the sealed proposal, so `fork` is refused with `next: [{verb:'admit'}]` (`native.ts:199-202`) — steering the agent into the exact identical re-admit that FG-3 finding 2 just removed from `status`. Same position, two carriers, opposite instructions.

### D-7 — no `--root`: an in-repo fixture would drive the LIVE fabric

Every skin resolves its root as `await repoRoot().catch(() => process.cwd())` (~30 sites in `cli.ts`, including `mcp` and `daemon start`), where `repoRoot()` is `git rev-parse --show-toplevel`. The `process.cwd()` fallback fires **only when git fails**. The isolation law holds today *only because fixtures live in `os.tmpdir()`, which is not a git repo*.

T-005 specifies transcripts at `packages/warpline/test/fixtures/f4/<runId>/` — inside this repo. The moment a scratch *fabric* lands there, git succeeds and root resolves to the live a-paradigm fabric: staged strands into `.warpline/fabric.jsonl`, staged payloads into `.warpline/knots/`, silently. **There is no `--root` flag and no `WARPLINE_ROOT` env anywhere in `cli.ts`.**

Fix before the runner: honor an explicit root ahead of `repoRoot()`, and have the runner refuse to start unless `repoRoot()` from the scratch cwd resolves to the scratch dir itself. Transcripts may live in-repo; **the fabric may not.**

### D-8 — the trace is blind to the mistakes it exists to count

- **CLI:** commander rejects malformed invocations *before* the action handler, so `traceCli` never fires and **no row is emitted**. W4 (surface-miss) — the rule whose entire purpose is counting description failures — can only fire on refusals the *engine* produced. `surfaceMisses` is structurally near-zero on the CLI arm.
- **MCP:** unregistered tool names throw pre-emit; wrong-but-plausible args are silently dropped by `filterToSchema` and the call proceeds and traces as a **clean row**.
- `F4Tracer.emit` swallows every write failure (`f4-trace.ts`, `catch {}`) — correct for a serving call, wrong for a scored run, where a dropped row turns a W-mark into a non-mark.

Net bias: a cold agent that flails and never lands a well-formed call produces a transcript with **zero wasted marks**. The measured median is "wasted turns *among calls that reached the engine*", which biases every number **toward passing, monotonically with how bad the surface is.**

### D-9 — this repo is not running on its own gate, and the config says it is

Verified against the live fabric:

```
.warpline/shadow/verdicts.jsonl : 33 rows — 19 FAST_ADMIT, 14 NOOP, 0 CLEAN, 0 KNOT
.warpline/fabric.jsonl          : 60 strands — authoredBy.agentId is null on ALL 60
.warpline/config.json           : gate.agentWrites = "real"   (ON)
```

`agentWrites:'real'` has never fired once, because nothing exports `WARPLINE_AGENT_ID` — every seal is anonymous, therefore human-class, therefore ungated. Combined with `hook.ts:46` (`( … >/dev/null 2>&1 || true ) &` — backgrounded, silenced, swallowed), the daily path **fails open three ways** on a product whose thesis is *disagreement fails closed*.

North's correction to the arc record: the empty denominator is **mechanical, not behavioral**. It is not "one human editing serially" — `seed.ts` states that a single principal *structurally cannot* produce a KNOT (fork re-mints at selvage, successful admit clears scratch), and the hook seals `--ref HEAD`, a tree git has already linearized, so it is fast-forward by construction. Zero KNOTs was the only possible outcome of the current operating mode. **Un-silencing the hook today would generate zero contested verdicts** — it is not a KNOT source until per-agent worktrees exist.

---

## North's reframe (the strategic item)

F4 and the empty denominator are **the same problem wearing two hats**, and the concurrency driver is the single asset that discharges both. `seed.ts` (`seedWorld` + `rivalAdvance`) is already a fleet in miniature driving the real engine functions.

Build item (d) as **the concurrency driver whose first consumer is F4** — point it at a scratch fabric for the F4 number, then at the live fabric with per-agent worktrees to start the organic K3 clock. Scoped narrower than that, North's own case *against* F4-first becomes correct.

Second strategic point, not previously in the record: **F4 is not a UX gate, it is a test of the moat-silence strategy.** If cold agents of other providers cannot work the surface from runtime self-description alone, then "never published, never in weights" is not a defensible moat but a fatal distribution decision — and the founder must choose between publishing and a much more human-in-the-loop product. That fork is unavailable at n=0.

---

## Theater flags (panel consensus)

1. **"662/662 tests" as F4 readiness.** The tests prove the mechanism. Zero of 662 scores an agent. The denominator is still zero.
2. **≥10 runs presented as satisfying a ≥80% bar** (D-5).
3. **≥2 model families as a cross-model control** — one degree of freedom is a checkbox.
4. **FG-2 with an absolute ≥80% bar.** PW-6 already conceded descriptions are dispensable and relocated the carrier; `descriptors-frozen.test.ts` caps summaries at 400 chars so they *cannot* become load-bearing. Gating an arm the architecture declared non-load-bearing measures a surface designed to be thrown away. **Run it observationally, as a pre-registered delta** (Loid: ≤10pp; Arky: ≤15pp), not as a bar.
5. **`gate.agentWrites:'real'` with zero attributed strands** (D-9).
6. **The synthetic-KNOT caveat** — record NOW, in the pre-registration, that an F4 pass is "cold-agent legibility **against a seeded corpus**, measured", so the number cannot be over-read later.

---

## Recommended sequence

**Before the freeze** (each is cheap, and each invalidates the denominator if it lands later):

1. **Amend FG-1** for D-1/D-2 — the correct-door restatement, and make W3 measurable (register `resolve` refusal-shaped on MCP *or* accept that predicate 3 is CLI-only; trace + gate `resolve` on the CLI).
2. **Extend the freeze to the ladders** (D-3) — Arky's R-1: widen FG-3 from `descriptorsId` to an **instrumentId** = content address over (descriptors ‖ ladder text ‖ classifier rule-set ‖ CLI_VERB_MAP ‖ corpus hash). *Freeze the carrier, not a proxy for it* — the FG-3 lesson, generalized.
3. **Bounded ladder audit** (D-6), Arky's terminating form: over corpus-reachable refusal classes × reachable `CyclePosition` states, assert **P1 non-contradiction** (`nextLegalVerbsFor(position).verbs ⊆ refusal.next[].verb ∪ {refused verb}`) and **P2 human-door safety** (re-orienting can never produce a W3). Exit criterion is a green CI extension of PW-4 — not "a reviewer read them."
4. **Implement the FG-1 completion predicate in code** — it does not exist in `src/f4/` today. The ≥80% *primary* metric has no implementation; only the secondary wasted-turn metric does. A predicate written after runs exist is void.
5. **`--root` + the runner's scratch assertion** (D-7).
6. **Then set FG-4** (corrected strata + counts) and **then sign** the widened freeze.

**Correction to a claim in my own earlier work:** `cli-trace.ts:26-28` asserts that closing the CLI asymmetries "changes VERB_DESCRIPTORS and therefore resets the FG-3 denominator." **That is wrong** — Arky verified that projecting the *existing* daemon `status` result through a new CLI command, adding `shadow tail` over `readShadowVerdicts`, and making CLI `--claim` optional all touch none of the three hashed inputs. They are cheap, not expensive, and were escalated to the founder as expensive on a false premise. Fix the comment.

**Deferred:** FG-2 implementation (post-freeze safe; ratify the delta framing now). The scripted resolve leg — **and note the hazard Shield found**: driven under the run's own `runId` it emits `verb:'resolve'` against the open KNOT episode and fires W3, so *the harness would fail every run it touches*. Give it its own runId or exclude it from scored runs.
