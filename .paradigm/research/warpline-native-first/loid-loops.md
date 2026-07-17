# The Agent Loops Under Native-First — dogfood ladder, organic K3, forge falsifiers, trust unlocks

> Author: Loid (forge) · rides the native-first theorizing pass under FOUNDER DIRECTION
> TD-2026-07-17-151 (fixed premise: native private server = the product; our forge = core;
> git = checkpoint valve only — not re-litigated here).
> Reads with: `docs/specs/warpline-forge.md` (constitution seed), roadmap
> `.paradigm/research/warpline-roadmap-2026H2.md`, TD-2026-07-16-426 (organic K3),
> T-2026-07-17-001 (checkpoint valve), dogfood record `.paradigm/research/warpline-dogfood/`.
> Engine ground truth @ ac0615cd: 448/448 · claim:v1 (CLAIM-BREACH fail-safe) ·
> knotPayload:v1 + untrusted-prose envelope · HELD consumer (K_MIN_GRADED=3,
> SURVIVAL_FLOOR=0.5, both exported calibration-pending) · agentId×symbol sidecar ·
> git-absent restore · warm admit 5.3s on this monorepo (64388171).

## 0. Where user zero actually stands today (measured, not aspirational)

The live fabric on THIS repo, checked 2026-07-17:

| fact | value | source |
|---|---|---|
| strands in fabric | 35 | `.warpline/fabric.jsonl` |
| strands authored by agents | **0** | all `actor: ascend`, auto-seal `--ref HEAD` |
| weaves (multi-parent) | **0** | linear chain |
| graded sidecar rows | 7, all `priorClass: pick` | `.warpline/grades.jsonl` |
| organic KNOTs ever | 0 | no admit-gated writes yet |
| warm admit latency | 5.3s (monorepo) | 64388171 |

Everything agentic the engine can do (propose-with-claim, admit, KNOT payload, HELD) has
been exercised only in the throwaway dogfood fabric (192 seeded admissions). The real
fabric has never seen the gate. **The ladder below is the plan for changing exactly that,
one rung at a time, with each rung's exit measured — because "we dogfood our own gate"
is currently a statement about the future, and TD-426 already taught us that seeded arms
cannot answer the questions only organic use answers.**

---

## 1. The dogfood ladder — us as user zero, for real

Five rungs, R0–R4. Each rung names the Claude Code session write path, what starts
being measured, and the exit gate to the next rung. **Rungs are gated, not scheduled.**

### R0 — today: git substrate + auto-seal (meaning recorded, never consulted)

Write path of a Claude Code session:
```
edit worktree → git commit → post-commit hook: warpline seal --ref HEAD
```
The fabric is a passive mirror of git. No claim, no admit, no verdict. Agent identity is
carried only if the hook env threads agentId (built, hook.ts). Nothing can be HELD;
nothing can KNOT. This rung produces the 35-strand fabric we have. It generates **zero
evidence** about the native-first bet. Staying here is the null hypothesis.

### R1 — shadow gate: propose+claim+admit in observe-only (starts the organic clock)

Write path:
```
edit worktree
→ warpline propose --agent <session-agentId> --claim <declared symbols+intent>
→ warpline admit --claim <claimId> --shadow      (verdict RECORDED, never blocks)
→ git commit (auto-seal still the sealing path, as today)
```
`--shadow` here means: run the full judgment (verdict, confidence, claim evaluation,
would-be-HELD) and append it to the telemetry streams, but seal via the existing git
path regardless. This is a small CLI addition (a flag routing around the fail-closed
holds), not new judgment machinery — the decision function is untouched.

What R1 buys: **organic agent strands, organic claim-vs-computed calibration rows, and
organic would-be-interruption counts at zero friction risk.** Every falsifier in §3 and
the K3 telemetry in §2 needs this stream; none of it can start before R1.

Session integration: a Claude Code stop-hook (or the session harness) invokes
propose/admit once per logical change batch. AgentId = the session identity we already
thread (H1 v2-relax work landed agentId threading).

**Exit gate R1→R2:** ≥100 shadow admissions across ≥10 sessions with ≥2 distinct
agentIds; F1 friction numbers measured in shadow (the latency half — interruptions are
hypothetical at this rung, counted as "would-have-held"); zero engine crashes on the
live monorepo.

### R2 — mixed mode: the gate is real for AGENT writes; humans keep the git door

Write path, agent sessions:
```
edit worktree → propose --agent --claim → admit --claim
  ├─ CLEAN/FAST_ADMIT → sealed strand (native path; no git commit needed for the fabric)
  ├─ CLAIM-BREACH → refused unsealed; agent narrows or --accept-breach (logged)
  ├─ HELD → escalation to the human (the Judgment-Console-shaped moment); --accept-risk logged
  └─ KNOT → knotPayload:v1 handed to the resolving agent; resolve strand behind the gate
→ checkpoint valve: stake the sealed stateId to git (T-2026-07-17-001, warpline→git)
```
Write path, human direct edits: unchanged (git commit + auto-seal). Two doors, one
fabric. The valve keeps git a faithful one-way export so the human can always
`git reset --hard <stake>` — the founder's stated rail, integrated here as the *thing
that makes R2 survivable*, and instrumented from day one (F3 §3).

R2 is where interruptions become real, so R2 is where F1's interruption budget and F2's
KNOT-resolution rate get their first honest denominators. It is also the rung that
satisfies the forge thaw condition (`graded-weaves/week > 0` on a real repo) if agent
concurrency produces weaves — meaning **forge build pacing is downstream of R2, which
is exactly the right coupling under TD-151's "deliberate pace, founder-paced" clause.**

**Exit gate R2→R3 (the CUTOVER gate):** F1 PASS + F3 PASS (pre-registered in §3), plus:
trust-floor bundle landed (content-address recompute; verify never reads s.merge;
grandfather containment), hermetic fresh-clone restore green, and ≥4 weeks of R2
operation without an unrecoverable fabric incident.

### R3 — CUTOVER: native-first daily development (the named rung)

**R3 is the rung at which we cut over OUR OWN daily development.** All writes — human
and agent — go `propose → admit → seal`. The auto-seal hook is retired (the git→warpline
direction dies); git exists only as the valve's export target. Humans get the same
verbs agents do; a human direct edit is a propose with `actor: ascend` and a trivially
broad claim until human-DX sugar exists (human DX is third in the wedge order — this is
allowed to be rough for us).

Safety rails that make R3 survivable, in force from day one:
1. **The checkpoint valve** (T-2026-07-17-001): every sealed pick (or at minimum every
   session end) stakes a plain git commit reproducing the working tree at the sealed
   stateId, labeled with pickId, verified against `binding.treeId` at stake time.
   One-way; toggleable; no sidecar/trust/secret leakage (Aegis owns safeguards).
2. **Recovery is drilled, not assumed** — see F3. A rail nobody has pulled is a decoration.
3. **`restore` git-absent** (built, M1c) is the native recovery path; the valve is the
   *human-familiar* recovery path. Both must work; they check each other.
4. **Escape hatch parity:** `--accept-risk` / `--accept-breach` / valve reset are all
   logged events (G5 sidecar class). If we route around the gate silently, the dogfood
   is fake — override volume is itself a tracked metric (self-regulation, same
   discipline as remediation overrides).

### R4 — fully native on the server: the forge fronts the fabric

The private Warpline server process owns the fabric; sessions write via MCP tools
(propose/verdict/knot-payload/resolve — forge spec §4.2, MCP as transport not schema);
the Judgment Console renders the HELD inbox and KNOT queue; git stakes continue as
long as the founder wants the valve on. R4 is a *deployment* change, not a semantics
change — if R3 holds and the forge constraints (G1–G5) were honored, R4 adds no new
judgment behavior. That property is testable: the R4 acceptance check is byte-identical
verdicts between in-process admit and server-mediated admit on the same stateIds.

---

## 2. Organic K3 on native ops (TD-2026-07-16-426) — the standing telemetry

The seeded arm was structurally moat-blind (pre-declared, run-results-full.md §2;
gap −2.7pts, p=0.756 recorded as "moat unmeasured, not refuted"). The organic arm
runs through our own gate from R1 onward. Spec:

**The stream.** Every admission (shadow or real) appends: `{pickId, agentId,
claimId, verdict, confidence(linked|independent|null), claimEval(exact|breach|missing),
symbols[], heldEscalation?, at}`. Every subsequent seal grades priors into the
agentId×symbol sidecar (already keyed both ways, v3-sidecar-bound). No new machinery —
this is the existing grade pass plus the R1 shadow rows.

**The K3 organic metric, pre-registered now:**
- Population: organic admissions on this repo's live fabric, R1 onward, symbol-bearing,
  graded (survived|overturned) — pending excluded.
- Statistic: survival(linked-CLEAN) − survival(independent-CLEAN), two-proportion
  one-sided z-test (direction: linked > independent).
- **Kill criterion (unchanged from TD-426): separation ≥ 15pts required.**
- **Evaluation points are FIXED to avoid peeking:** first verdict-eligible look at
  n ≥ 50 graded per arm; a preliminary (non-verdict, wording-silent) look permitted at
  n ≥ 30 per arm for calibration of the constants only. Weekly reports before the floor
  display counts, never the gap, in any externally-visible material (wording discipline
  from TD-426 stays: calibration-moat-SILENT until the organic verdict exists).
- If the organic arm ALSO shows <15pts at n≥50/arm with p≥0.05: K3 fires for real,
  convene founder, adjudication-wedge redesign before further trust build — same
  consequence the roadmap assigned, now on the arm that can actually measure it.

**HELD as the consumer signal (the second telemetry lane):**
- `held_precision` = of HELD-escalated admissions later graded, fraction whose flagged
  symbol was in fact overturned-or-revised within the next N strands. This is the
  first number that can justify or re-tune K_MIN_GRADED=3 / SURVIVAL_FLOOR=0.5
  (exported calibration-pending for exactly this).
- `override_rate` = --accept-risk seals / HELD escalations. High override + high
  subsequent survival = the floor is too aggressive (noise); high override + low
  survival = the humans are rubber-stamping (a discipline problem, surfaced to founder).

**Cadence and the first trusted report:** weekly automated aggregate (the byAgent /
bySymbol report buckets exist in grade.ts) posted to the research dir. **The first
report we TRUST — i.e., quote internally as evidence — is the first weekly report at
which ≥100 organic admissions exist with ≥50 graded outcomes and ≥2 distinct agentIds.**
Before that threshold every report is machinery-verification only. Estimated to require
several weeks of R1/R2 operation; that is the cost of having refused to fake it.

---

## 3. Falsifiers for the forge itself — pre-registered criteria that gate the rungs

The native-first DIRECTION is fixed (TD-151). These falsifiers do not gate the
direction; they gate the CUTOVER rungs and, if breached, they change sequencing and
design — exactly as K3's seeded firing changed the K3 design without killing the arc.
Same discipline as always: numbers written down before the data exists.

### F1 — the friction budget (gates R2→R3)

Question: does daily development through the admit gate stay affordable?

- **F1a latency:** median wall-clock added per change batch (propose+admit+seal,
  warm) ≤ **10s**; p95 ≤ **30s**. Basis: warm admit is 5.3s on this monorepo today;
  the budget is ~2× measured, leaving room for claim I/O and seal. Measured from R1
  (shadow runs the full path minus seal).
- **F1b interruption volume:** HELD + KNOT + CLAIM-BREACH interruptions ≤ **2 per
  active developer-day**, averaged over any rolling week of R2.
- **F1c interruption quality:** false-positive share of interruptions ≤ **1 in 3** —
  where false-positive means: HELD whose symbol then survives ≥3 further strands
  untouched-by-revision; KNOT graded FALSE-KNOT on review; CLAIM-BREACH where the
  excess symbol was Merkle-noise the exemption rule should have caught.
- **Breach consequence:** R3 blocked; stay at R2; the breach report names which
  component (latency → store/lens perf work; interruptions → constants recalibration
  or excess-rule fix) before a re-attempt. Two consecutive re-attempt failures →
  convene founder on whether the gate belongs on every change or on batch boundaries.

### F2 — agent KNOT self-resolution via the payload (the K3-resolution question; gates the auto-resolution tier and console emphasis, NOT cutover)

Question: is knotPayload:v1 actually sufficient for a fresh agent, as the forge exit-gate
claims ("propose a resolution from the payload alone, without repo archaeology")?

- Protocol: every organic KNOT in R2+ is first offered to a resolver agent whose
  context contains ONLY the payload (bodies, intents-in-envelope, blast-radius slice)
  — no repo browsing tools. The agent produces a resolution proposal into the typed
  envelope; a human (or later, the scrutiny tier) accepts/rejects/modifies.
- **Thresholds, evaluated on the first 20 organic KNOTs:** ≥ **50%** of KNOTs receive
  a well-formed proposal from payload alone, AND ≥ **70%** of those proposals are
  accepted without substantive modification. (Joint: ≥35% of KNOTs end-to-end
  self-resolved subject to human sign-off.)
- **Breach consequence:** the payload is wrong by the forge's own constraint §3a —
  fix the payload shape (what did resolvers reach for that it lacked? that list IS
  the fix spec), and no auto-resolution tier of any kind until a rerun passes.
  Note the standing hard gate on top: blind injection corpus (roadmap 5.4) must pass
  before auto-resolution regardless of F2.
- Small-n honesty: 20 KNOTs may take a long time to accrue organically (our current
  KNOT count is zero). If R2 runs 8 weeks with <10 organic KNOTs, that fact is itself
  reportable — it bounds how central KNOT-resolution UX can be to the near-term product
  story, and it gets said out loud rather than padded with seeded KNOTs.

### F3 — the checkpoint valve as REAL recovery (gates R2→R3, standing thereafter)

Question: does the founder's rail actually hold weight, or is it a comfort object?

What usage proves, pre-registered:
- **F3a stake integrity (continuous):** 100% of stakes verify — the staked git commit's
  tree reproduces the sealed working tree byte-identically against `binding.treeId`,
  checked at stake time. A single silent verification failure is a **hard stop**
  (valve bug class: the rail lies), fixed before any further native operation.
- **F3b drilled recovery (scheduled):** a monthly drill from R2 onward: pick a random
  stake, `git reset --hard <stake>` in a scratch clone, AND `warpline restore` to the
  same stateId git-absent; both must reproduce identical trees. **3 consecutive
  passing drills required before R3**; drills continue monthly after cutover.
- **F3c real recovery (evidence of the rail working):** if an unscheduled recovery is
  ever needed, it succeeding via the valve within one command is the strongest single
  datum the rail works — logged as such. If a real recovery is needed and the valve
  FAILS: revert daily development to R1 immediately, full incident writeup, R3
  re-gated from scratch. Zero real recoveries with passing drills is also a pass
  (we do not require a disaster to certify the rail — drills substitute).
- **F3d cadence adherence:** stakes exist for ≥95% of sealed picks (or 100% of session
  ends, per the configured cadence). A valve that's toggled off in practice protects
  nothing; adherence is measured, not assumed.

---

## 4. Classroom / trust coupling — when scrutiny routing + endorsements become buildable-with-evidence

Today's trust surface is exactly one consumer: HELD (independent-CLEAN on a
low-survival symbol), with K=3 / floor=0.5 explicitly calibration-pending. Everything
beyond it is zero code, and stays zero code until named evidence volumes exist.
Anti-speculation rule, applied uniformly: **every trust feature is preceded by a
counterfactual shadow log proving it would have changed real outcomes; the feature is
built only when the log shows it deciding differently, at volume.** (Same trick as R1:
observe-only first, teeth second.)

| unlock | feature | evidence volume that unlocks BUILD | why that number |
|---|---|---|---|
| U1 | recalibrate K_MIN_GRADED / SURVIVAL_FLOOR from data | ≥200 organic graded outcomes across ≥20 distinct symbols, with ≥10 HELD escalations logged | held_precision (§2) needs double-digit escalations to mean anything; 200/20 gives per-symbol n above the K floor for a meaningful re-fit |
| U2 | scrutiny ROUTING (tiers 0–3 assigning review paths, forge §1d) | ≥3 distinct agentIds each with ≥30 graded outcomes, AND fragility signal live on this fabric, AND U1 done | routing decides BETWEEN authors and tiers; with <3 calibrated authors there is no routing decision to make — it would be theater. Fragility is half the scrutiny product; routing on trust alone is the formula with a term deleted |
| U3 | ENDORSEMENTS (trust-weighted sign-off on OFFERs) | counterfactual log first: ≥10 recorded organic cases where an endorsement rule would have decided differently than HELD-alone (caught something HELD missed, or cleared something HELD held); plus ≥50 admissions/month sustained through ≥2 actors | endorsement is only worth its wire shape (open question, forge §6.1) if it adds decisions HELD doesn't already make; the log proves additive value before any schema is frozen. Trust ledger stays design-only (T-2026-06-24-017) until this fires |
| U4 | auto-resolution tier (any) | F2 PASS + blind injection corpus PASS (roadmap 5.4) — both, no substitute | pre-existing hard gates, restated so no trust unlock is read as loosening them |

Sequencing note: U1 < U2 < U3 is a strict order (each consumes the prior's calibration),
and ALL of them consume the R1/R2 telemetry stream — which is the deep reason the
dogfood ladder is the critical path of the whole native-first era: **no rung climbed,
no trust earned; and per the forge constitution, trust IS the permission model, so no
trust earned means the forge's permission layer stays fiction.** The classroom coupling
is the same statement one level up: scrutiny routing is to agents what the gated
classroom is to learnings — a promotion gate fed by graded history — and it becomes
real on exactly the same fuel.

---

## 5. Summary of gates (one screen)

```
R0 → R1   : build --shadow flag + session hook          (small build, no gate)
R1 → R2   : ≥100 shadow admissions, ≥2 agentIds, F1a measured, 0 crashes
R2 → R3   : F1 PASS + F3 PASS (3 drills) + trust-floor bundle + hermetic restore
            + 4 clean weeks                              ← THE CUTOVER GATE
R3 → R4   : byte-identical verdicts in-process vs server; deployment only
K3 organic: verdict at n≥50/arm graded; ≥15pts or convene founder
F2        : first 20 organic KNOTs; gates auto-resolution + console emphasis
U1–U4     : evidence volumes in §4 table; counterfactual log before build, always
```

The direction is the founder's. The rungs are mine to measure. Nothing above asks the
premise to justify itself — it asks the premise to survive contact with our own
keyboard, which is the only falsifier a "we use it ourselves" product ever really has.
