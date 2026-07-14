# Warpline Roadmap — 2026 H2 (The Ordered Plan)

> Produced by the 6-lens first-principles reassessment (orch-mrk0fx7e-g75j, 2026-07-13/14)
> + Cid's prioritization pass. Lore: L-2026-07-14-ascend-150429-001 (panel verdict),
> L-2026-07-02-ascend-153932-001 (prior 7-lens panel).
> Sequencing doctrine: evidence-per-week first, unblocking power second, market clock third
> (Cursor Origin ships fall 2026; window 9–15mo; our layer — deterministic false-CLEAN
> judgment on git-clean merges — is still empty).
>
> STATUS: recommendations pending founder ratification (gates marked FOUNDER-GATE).

## Ratified context (from the panel, coordinator-verified)

- Thesis restated: **"meaning judges, bytes execute, disagreement fails closed."** The product
  is a deterministic ADJUDICATION protocol at admit-time — earlier + deterministic + attributed
  ("decide before tsc has to"), NOT "detection tsc can't do" (that claim rests on zod 66cbfe09
  alone; pilot catches s6/s7 are tsc-visible by construction).
- Build = judgment core (thesis-aligned, ~2,500 lines, validated) stapled to a replacement-era
  chassis (whole-tree recompute, seq-in-identity linear ledger, custody ambitions).
- Moat re-keyed **per-CODEBASE** (symbol-level survival history; never resets, non-portable),
  not per-agent.
- Forge ("GitHub for Warpline" — founder ask): spec only this half. Translation table:
  issues→KNOT queue · PRs→OFFERs carrying verdicts+claims · CI/CD→the admit gate ·
  permissions→scrutiny policy · tree→Tapestry. No forge code until graded-weaves/week > 0.

---

## PHASE 0 — SETTLE THE RECORD (week 0, ~3 days)

- **0.1 FOUNDER-GATE — ratify the reworded thesis** ("deterministic adjudication at admit-time";
  retire "detection tsc can't do" as lead claim). Closes T-2026-06-24-008. Owner: founder + North wording.
- **0.2 FOUNDER-GATE — push the 17 local commits** on `warpline-surfaces` + docs-honesty fix
  (index.html §04 advertises signing that doesn't exist). Nothing publishes while our page overstates.
- **0.3 FOUNDER-GATE — v3 §9 sign-off** (gates Phase 2.1; get it now so the P1→P2 boundary has zero idle).
- **0.4 — LLM-judge falsifier (1 day, Jinx).** Prompt a frontier model with the same 18 flagged
  diffs + benign controls. Kills or armors the sharpest claim BEFORE we write the benchmark/README.
  A kill is not fatal — determinism+earlier+attributed+cost survives; only the wording dies.
- **0.5 — `warpline-forge.md` north-star spec (~1 day, Arky drafts, founder blesses).** Constraint
  document so Phase-2 APIs (verdict JSON, KNOT payload, claim schema) stay forge-compatible. NOT a build.

**Exit gate:** thesis ratified; commits pushed; §9 signed (or Phase 2 re-sequenced); falsifier verdict in lore.

## PHASE 1 — REMOVE THE WALL ∥ CHEAPEST KILL-SHOT (weeks 1–3, two independent lanes)

- **Lane A (Arky+builder, ~1–2wk) — delta-native core**: compositional snapshot + incremental
  essence recompute = **T-2026-07-04-003 done properly** (admit O(delta), not O(repo) — Warpline
  currently can't run on its own monorepo, >2min/admit). Fold in **T-2026-07-04-004** admit-NOOP
  diff-based fix (port pick.ts:111 → admit.ts:95). Unblocks: everything downstream.
- **Lane A-minor (builder, days) — H1 residue**: worktree-seal-on-CLEAN (**T-2026-07-01-030** remainder).
- **Lane B (Loid, weeks 1–3, no code dependency) — Partition Trial Phase 0**: ~150 real task-pair
  disjointness census. Cheapest kill-shot on the market premise. Carries **kill criterion K1**.

**Exit gate / K1:** census shows material interference → proceed (number becomes the benchmark headline).
Overwhelmingly disjoint → convene founder; re-weight toward attribution/calibration wedge.
Also: admit on a-paradigm completes in seconds; NOOP test green.

## PHASE 2 — IDENTITY + MACHINE-READABLE KNOTS (weeks 3–6; needs 0.3)

- **2.1 — Pull v3 DAG identity + refs forward, BEFORE M2** (~1wk vs ratified spec; deletes ~400
  lines of guard scar tissue; v2 chain serializes the swarm). Link T-2026-06-24-016 (CAS shape falls
  out here or stays queued behind it). New task; distinct from frozen T-2026-07-01-017 (branch UX).
- **2.2 — R3 KNOT payload**: both sides' bodies + intents in the knot (days–1wk). THE dependency of
  the statistical run's throughput. Shape after v3 identity, with the forge OFFER shape in view.
  Cross-ref T-2026-06-25-004 gap 3.
- **2.3 — Claim-scoped propose API + CLAIM-BREACH verdict** (~3d). Triple duty: perf scoping hint,
  calibration probe (claimed vs touched), forge-compatible API. Linkage: T-2026-06-24-018.
- **2.4 — SECURITY (re-sequenced INTO this phase): weft prompt-injection isolation**
  (**T-2026-06-24-013** minimum slice — typed untrusted-prose envelope + escaped frame +
  pure-function-verdict contract). 2.2 is the moment agent prose starts flowing into other agents'
  reasoning; don't open the channel unguarded. Full blind red-team corpus completes in P3–P5;
  MUST pass before any auto-resolution tier.

**Exit gate:** a fresh agent can propose a KNOT resolution without human archaeology; envelope in place; suite green on v3.

## PHASE 3 — HONEST COVERAGE + MINIMUM TRUST ∥ DISTRIBUTION (weeks 5–9, overlaps P2 tail)

- **Lane A — GAP-1 honest minimum** (maps to **T-2026-06-24-014**): JSON/YAML key-tree lens (3–5d);
  lockfiles = derived artifacts (regenerate, never knot); cross-file TS call resolution (~1wk);
  per-path `meaning-decided` vs `byte-decided` labels (the honesty metric, rendered).
- **Lane A2 — minimum trust build** (re-scope **T-2026-07-01-022** to exactly this): grade keyed by
  agentId+symbol; ONE consumer — admit escalates independent-CLEAN on low-survival symbols to HELD.
  Seed answer to T-2026-06-24-015 until BRUSH.
- **Lane A3 (rides along)** — trust-floor bundle **T-2026-07-02-005** (C/D/E) + hermetic fixture
  **T-2026-07-02-001** (fresh clone green before anything is public).
- **Lane B (North+builder, ~1wk) — Guard GitHub Action + npm publish.** Knot-size ≤6 default
  (the 50%-precision stratum), README states the ratified thesis. Distribution ≠ business; staff thin.

**Exit gate / K2:** field precision of the ≤6 stratum holds on early installs; meaning-decided
coverage % on our own repo moves off zero.

## PHASE 4 — STAKE THE CLAIM, THEN PROVE IT (weeks 8–13)

- **4.1 — AgenticFlict benchmark publication** (North+Scholar+Jinx adversarial pass;
  FOUNDER-GATE on positioning). Publish the yardstick before our own score; front-run Cursor's
  fall ship on category vocabulary. Fold in census numbers + falsifier result (honest version).
- **4.2 — ≥100-admission multi-agent statistical run** (unblocked by P1+P2). First real population
  of agent/merged strands. Scored against the published metric. Loid designs; pre-registered floor.
- **4.3 — Prospective telemetry on our own PRs** — standing evidence stream from 4.2's plumbing.

**Exit gates:** **K3** (statistical floor, pre-registered by Loid — below → adjudication wedge
redesign before M2 spend, convene founder) · **K4** (adoption: by end-Q1 one of {Guard installs,
benchmark engagement, inbound} off zero, else Q2 re-weights to distribution, not engine).

## PHASE 5 — Q2, EARNED THROUGH THE GATE (weeks 14–26)

5.1 **M2 branching + history graph** (T-2026-07-01-017, unfrozen, on v3 refs; ~2–3wk) →
5.2 **BRUSH verdict** (blast-radius overlap; closes T-2026-06-24-015; swap ahead of 5.1 if K3 shows
dataflow-concentrated false-CLEANs) → 5.3 **test witnesses at seal** → 5.4 **full blind injection
corpus** (gate before ANY auto-resolution tier) → 5.5 theory backlog (commutation-algebra
formalization → graded lens economy → near-miss duplicate detection; LLM-hybrid KNOT-resolution
prototypes behind 5.4) → 5.6 hygiene (T-2026-07-01-023, T-2026-06-27-005, T-2026-06-27-001).

## FREEZE LIST (thaw only via phase gate or founder order)

M3 signatures (T-2026-07-01-014, Q3 candidate) · M4 remote/sync (T-2026-07-01-015) · trust layer
beyond the minimum consumer (T-2026-06-24-017 design-only) · Tapestry / log-show DX
(T-2026-06-25-003 remainder) · GUI sub-phase 3+ / design-system breadth · University course
(T-2026-06-27-004, Q3+) · trademark · **the forge itself (spec only)** · corpus-fidelity hardening
(T-2026-07-01-018) · lifeline cross-rename (T-2026-06-25-009) · CLI hardening remainder
(T-2026-06-25-002). Close T-2026-06-24-010/011 as superseded by the reassessment lore.

## FOUNDER-GATE SUMMARY

1. Thesis rewording ratification (0.1) — closes T-2026-06-24-008.
2. Push the 17 commits (0.2).
3. v3 §9 sign-off (0.3) — gates Phase 2.1.
4. Benchmark/positioning sign-off (4.1) — "merge judge for agent teams"; hold the category claim.
5. Standing: K1/K3 breach convenings.
