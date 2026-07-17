# Warpline Native-First — Product Strategy (North)

> Author: North (product) · 2026-07-17 · Task: see tags [warpline, native-first, product]
> Premise (FIXED): FOUNDER DIRECTION TD-2026-07-17-151 — the Warpline-native local/private
> server IS the product; our own forge is paramount core roadmap; git is demoted to a
> toggleable, safeguarded one-way checkpoint export; GitHub-facing surfaces are instruments
> at most, never the claim-staking ground.
> Kept intact: thesis wording TD-2026-07-16-810 ("meaning judges, bytes execute,
> disagreement fails closed"; scoped capability claims only), K3 organic arm TD-2026-07-16-426
> (calibration-moat-SILENT externally until organic data exists).
> Reads with: `docs/specs/warpline-forge.md` (now the seed of the product constitution),
> `.paradigm/research/warpline-roadmap-2026H2.md`.

**Risk register, restated once (already in the record — L-2026-07-14-ascend-150429-001,
prior North caution):** native-first forfeits borrowed distribution during the 9–15-month
window in which Cursor Origin (fall 2026 ship) and Entire.io ($60M) contest the agent-forge
layer; the adoption funnel narrows to a direct, founder-paced motion; and the product's
proof burden moves onto our own operations, where the honest current numbers are mostly
zero. Those risks stay live in the kill criteria and the metric ladder below — they are
priced in, not re-litigated. Everything after this paragraph is how the direction wins.

The strategic core, in one sentence: **the engine already built (v3 DAG identity, refs,
knotPayload:v1, claims + CLAIM-BREACH, injection envelope, agentId×symbol grades + HELD,
git-absent restore) is precisely the native-forge substrate — so the pivot re-aims
positioning and sequencing, not the code, and the fastest credible claim we can stake
anywhere is "we develop this repo on it, natively, every day, in public view."**

---

## 1. Disposition of the GitHub-facing assets

One recommendation each. The governing test from TD-151: an asset may *gather evidence*
or *walk people toward the native server*; it may not become the place where the claim
lives.

### 1a. Guard GitHub Action (`packages/warpline-action`, built, 29/29, unpublished) — **INSTRUMENT**

Do not publish to npm or the Marketplace — not now, and remove "publish" as a default
future step (it returns only if a design partner's procurement literally requires it).
Do not kill it either: it is the single cheapest producer of external-repo evidence we
own (the base-rate run proved the oracle survives 360 runs on foreign repos at 1.4–5.4 s
per merge), it is already wording-disciplined by test (banned-phrase sweep enforcing
TD-810), and unpublished it costs ~zero maintenance. Instrument it in exactly two roles:

1. **Internal evidence instrument** — the standing self-test workflow
   (`.github/workflows/warpline-guard.yml`, advisory, non-blocking) stays on, as the
   verdict-regression harness over our own real PRs and the plumbing for P4.3-style
   prospective telemetry. It watches the checkpoint valve, not the main line — a useful
   asymmetry: Guard on git checkpoints is the *control arm* for the native gate.
2. **The scout** — a diagnostic **we run, privately, for a named prospect** on their
   repo history (exactly the base-rate protocol: clone, oracle over recent merges,
   knot-size ≤6 stratum, scoped wording). Output is a scouting report handed to them in
   a design-partner conversation whose close is the native server install — "here is
   what your byte-merges hid; the gate that catches these at admit-time runs on your own
   box." The scout meets developers where they are today without staking anything there:
   no listing, no README-as-positioning, no install motion we must support.

The bright line that keeps this INSTRUMENT and not a creeping product: **no Marketplace
listing, no public README positioning, no support surface.** Guard never appears in
public materials except inside evidence-run write-ups as "the measurement harness."

### 1b. The P4.1 benchmark plan (AgenticFlict) — **PARK the publication, RETARGET the data source**

Park the publish-the-yardstick-before-our-score move: it was designed to front-run
Cursor on category vocabulary *inside the GitHub-PR frame*, and TD-151 just ruled that
frame is not our ground — publishing a PR-merge benchmark now would stake the claim
exactly where the founder said not to. But the benchmark's assets are not GitHub-shaped:
the partition-census interference numbers (~1 in 3 concurrent pairs makes contact,
K1 not firing), the falsifier result, the Move-3 statistical run (22.2%
meaning-decisive, 0 wrong merges) are all substrate-neutral. Retarget: the benchmark
re-emerges in Phase N3 (§3) as **published research from native dogfood** — the K3
organic arm's prospective grading stream (TD-426) is its data source, which also finally
gives the moat measurement the organic data TD-426 requires. Until then: no benchmark
artifact ships. (Full recommendation on eventual publication: §4.)

### 1c. The base-rate evidence (360 runs, 6.2% overall / 13.1% human-era git-clean) — **KEEP, RE-CAPTION**

This is the one GitHub-derived asset that ports cleanly, because it is not a claim about
GitHub — it is a claim about **byte-merging**: 1 in 16 recent merges (1 in 8 in a
human-PR-era population) is a merge git called clean and meaning called broken, at 0
engine failures. Re-caption it from "why install Guard on your PRs" to **"why the native
gate exists: the substrate you trust to merge is provably blind, at this measured
rate."** It becomes the opening exhibit of the vision page and every design-partner
deck. No rerun needed; the numbers, caveats, and scoped wording in
`.paradigm/research/warpline-guard-base-rate/results.md` already comply with TD-810.

---

## 2. The new adoption story

### Who runs a private Warpline server, in order

1. **Ring 0 — us, this repo.** Non-negotiable first customer. a-paradigm's daily
   development moves onto a local Warpline server: every admission through `warpline
   admit` on our own box, git relegated to the checkpoint valve. This is where every
   claim gets manufactured. The fabric currently has ~zero *organic* agent strands
   (192 harness admissions exist; the harness is not operations) — Ring 0's whole job
   is to change that.
2. **Ring 1 — agent-fleet operators, self-hosting.** Teams already running multi-agent
   coding fleets (Claude-Code/Conductor-style) on private repos. They are the right
   first external ring because (a) they feel merge interference at machine scale — the
   census says interference follows attention, and fleets concentrate attention; (b)
   they are the least attached to GitHub's review model, since agents don't read PR
   pages anyway; (c) "runs on your own box, nothing leaves" is a feature for them, not
   a limitation. Target: 2–3 named design partners, founder-paced, high-touch — we
   install, we operate alongside them for the first weeks, their KNOT queues teach us
   what the Judgment Console must rank.
3. **Ring 2 — teams who saw the demo server.** Only after Ring 1 exists. Self-serve
   install of the private server; the hosted demo (below) is the funnel mouth.

### The on-ramp without GitHub distribution

Three motions, replacing the Marketplace funnel:

- **Dogfood proof, published from native ops.** Move-3-style evidence runs, but from
  Ring 0's *live operations* rather than a harness: "this week, N admissions, K KNOTs
  born, M resolved from payload alone, 0 wrong merges, here are the strands." Cadence
  beats polish — a standing, dated evidence stream is the native-era equivalent of a
  GitHub star count, and nobody contesting the layer can fake having one.
- **The scout → design-partner motion** (§1a): direct, named-prospect, evidence-first.
  The scout report is the cold-open; the native server install is the ask; co-operating
  their first weeks is the retention mechanism.
- **The hosted demo server** — see next.

### What "claims staked on our own ground" looks like publicly

Three surfaces, all ours:

1. **The vision page** (`docs/warpline/index.html`) — the category claim lives here
   (§4), rewritten around the native server, opened by the base-rate exhibit, with the
   §04 docs-honesty fix (nonexistent signing) done before anything else ships.
2. **The hosted demo server** — a public, **read-only** projection of OUR live fabric:
   the verdict feed, the KNOT queue with payloads, per-path meaning-decided vs
   byte-decided honesty labels, the Tapestry. This is the claim-staking artifact: not a
   pitch about judgment, a window onto judgment happening on a real repo every day. It
   is buildable within the forge constitution's own rules (forge-spec G4: reads are pure
   projections; the Oracle Divergence Viewer → admit feed is already the speced seed) and
   within the injection envelope (untrusted prose rendered framed and escaped — speced
   in P2.4, already shipped as `knotPayload:v1`'s envelope). Read-only defers every
   hard multi-tenant/auth problem to the frozen M3/M4 lanes where it belongs.
3. **The evidence-run stream** — the dogfood publications above, cross-linked from the
   vision page, each one carrying the metric ladder (§3) with honest current values.
   Publishing our own zeros-becoming-nonzeros is the credibility move: everyone else in
   this window is publishing renders; we publish ledgers.

---

## 3. The resequenced metric ladder

Old step metrics (Guard installs, benchmark engagement, Marketplace-era K4) are retired.
One metric per phase; a phase is *entered* when its predecessor's metric is nonzero and
sustained. Honest current values stated.

| Phase | The one metric | Current value | Notes |
|---|---|---|---|
| **N0 — Ring 0 conversion** | **Consecutive days of a-paradigm developed fully native** (every admission via our server; git touched only through the checkpoint valve) | **0** (engine exercised only by harnesses; no native daily ops) | Requires: P1 delta-native perf (admit in seconds on this monorepo — currently the wall), the checkpoint-export valve built, server wrapper over the existing engine. This metric IS the old thaw condition (graded-weaves/week > 0) in native clothing. |
| **N1 — Operational depth** | **Organic admissions/week through OUR server** (not harness-generated) | **0** (192 total admissions on the fabric, all harness) | Also the data source the K3 organic arm (TD-426) has been waiting for — the moat gets measured here or nowhere. |
| **N2 — The judgment loop closes** | **KNOTs resolved from payload alone, no human repo archaeology** (the P2.2 exit-gate, now counted in anger) | **0** | The forge-spec's own bar: a fresh agent proposes a resolution from `knotPayload:v1` alone. First nonzero = the "issues that file themselves" claim becomes demonstrable, on the demo server, live. |
| **N3 — The valve proves itself** | **Checkpoint stakes used in anger** (a git export actually relied on for recovery, review, or external hand-off) | **0** (valve not yet built) | The safeguard is only credible once it has caught someone. Also the phase where the retargeted benchmark (§1b) publishes from native data. |
| **N4 — First external ground** | **External private servers in weekly use** (design partners running their own) | **0** (zero prospects contacted under the new motion) | K4 successor: by end of Q1-2027, this is the number that must be off zero, else re-weight to the distribution motion — the kill-criteria discipline carries over unchanged. |

Standing guardrail across all phases, unchanged: **FALSE-CLEAN (wrong merge) = 0** on
the operational stream. The dogfood full-run's 8 quarantined FALSE-CLEANs were a harness
seed artifact (TD-426 precondition); on live ops this is a hard stop, not a rate.

---

## 4. What to say publicly, now

- **The P4.1 benchmark: HOLD.** Do not publish the yardstick from the GitHub-PR frame,
  and do not publish it before N1 is nonzero. Publish it in Phase N3 as **research from
  native dogfood** — "we ran an agent fleet on a meaning-gated server for N weeks; here
  is the interference structure, the census, and the adjudication record" — with the
  falsifier and census numbers folded in honestly. That paper is strictly stronger than
  the parked version: same numbers, plus an operating system of record nobody else has.
  Cost accepted with eyes open: we cede first-mover on *benchmark* vocabulary this fall;
  we compensate by claiming *category* vocabulary now, on our ground, as follows.
- **The vision page: LEAD WITH IT — after two fixes.** (1) The §04 docs-honesty fix
  (signing claimed, M3 frozen — nothing publishes while our page overstates; roadmap
  gate 0.2's rule stands). (2) Rewrite around TD-151: the native server as the product,
  the base-rate exhibit as the opening, git-as-checkpoint-valve stated plainly, the
  metric ladder published with its zeros. Moat stays externally silent per TD-426.
- **The category claim — "agent-first source control": CLAIM IT, on our ground only.**
  TD-810 held it as internal north star while we were a judge living inside GitHub's
  forge; under TD-151 we are building the whole system the phrase describes, which is
  the condition that made the claim overreach before. Recommendation: stake it on the
  vision page and the demo server as **the category we are building** — dated,
  evidence-linked, with the ladder's honest zeros directly beneath it — before Cursor
  Origin's fall ship takes the vocabulary. Two disciplines keep it honest: the claim
  appears *nowhere GitHub-facing* (no Guard artifact, no benchmark framing), and every
  *capability* sentence under it stays scoped per TD-810's standing wording rule
  ("deterministically flags contested-symbol knots your typechecker and tests provably
  missed" — never unscoped detection superiority). Category claimed as destination;
  capability claimed only as measured.

## 5. Sequencing note (hand-off to Cid/Arky)

Nothing above requires reordering the kept engine roadmap — P1 perf remains the wall in
front of N0, and the forge constitution (warpline-forge.md §3 G1–G5) now governs the
server wrapper and demo-server projections as constitution rather than constraint. The
only new build items this strategy introduces are founder-paced by TD-151 anyway: the
checkpoint-export valve, the thin server wrapper, and the read-only demo projection
(grown from the speced Oracle Divergence Viewer → admit feed path, per forge-spec §2).

— North (product), 2026-07-17
