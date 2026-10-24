# 36 — Aegis: gate-tightening, convergence cap, card claim fields (S35) — 2026-10-17

Scope: T-2026-10-17-004, spec v3.8 → v3.9. Grounded in §3.4 (B3/B4/B8/B10, decision classes), §4.5 (sanitizer, kernel-owned regions), D62 (narrowing needs no presence), §14.7 and §15.4.

## Findings

**S35-01 (critical) Signal provenance.** The breaker reads only facts the kernel observed or the broker signed:
- a revert computed from watched refs (git/selvage);
- `approval.*` overrides and denies;
- `oracle.result` failures;
- `incident` cards decided by a human.

An agent's, mod's, voice turn's or peer's assertion ("reverted", "fixed", "all clear") is never an input. Only the kernel appends `gate.breaker.*`, kernel-signed, which extends B3. A peer frame or a peer-tainted session never moves the breaker in either direction, which extends B10.

**S35-02 (critical) Loosening rests on positive evidence, never on absence.** "No reverts lately" can be manufactured by suppression, so it cannot count. Loosening needs both of these:
- kernel-signed survival evidence: merged nodes whose bytes are still on the ref after N days, and oracle passes;
- elapsed time.

Unknown or missing data holds the current level (B5 style: corrupt ⇒ hold, never loosen).

**S35-03 (high) Suppression.** A revert is detected as content restoration of a kernel-merged node, whatever the commit message says, and squash, fix-forward or a rename does not hide it. A non-fast-forward or a deleted watched ref is itself a tightening signal. Honest scope: git activity outside the kernel is visibility only (`status.unobservedRefWrites`), and it blocks loosening for that repo's window.

**S35-04 (high) Asymmetry, same shape as D62.**
- Tightening needs no presence and happens automatically. A human can tighten by hand with no presence.
- Evidence-driven loosening steps down one level per window at most, and never below the root-signed baseline.
- Leaving the top level, or any manual reset or early loosen, is a fresh-presence `breaker-reset` card. It is never cached, never voice, never `always`, and never created under a cached unlock or an arm (extends B8).

**S35-05 (high) Thresholds are root-signed.** They live in `~/.gnomon/config.yaml` under `gates.breaker`. Raising a threshold or shortening a window is a loosening and needs root presence; lowering one needs none. `project.yaml` keys are ignored and logged `config.ignored`. No env var, flag or CLI changes them, mirroring the fuse rule in §3.4.

**S35-06 (medium) Hysteresis abuse.**
- *Threshold straddling:* an agent keeps signals just under the line. Use a decayed cumulative score per repo, not a count per window.
- *Sawtooth:* an agent behaves for exactly the decay window, then exploits. The loosen window must be at least 3× the tighten window, and a re-trip within a recall window jumps straight back to the previous peak level.
- *Lineage:* counts are keyed by (repo, contract-node lineage), so a respawn or a new hsid inherits the count.

**S35-07 (high) DoS by forced tightening.** An agent can cause reverts on purpose, so it can trip the breaker. If tightening means more cards, the attack is prompt fatigue, and the human starts rubber-stamping. The rule: tightening reduces autonomy, not the human's attention budget. It takes these forms:
- lower armada concurrency;
- auto-merge off;
- cached-class decisions become fresh-class for that repo's cards;
- voice narrowed.

It never adds cards per decision. The cards a tightened repo raises are rate-limited and batched (`decision.stack`). Override signals feed the breaker at a capped weight, so friction cannot snowball into more friction.

**S35-08 (high) Voice (D58–D67).** A trip emits the existing `approval.voice.policy.narrowed` for the repo and disarms any arm whose class is now excluded. The breaker is an overlay: effective classes = grant ∩ breaker. Loosening restores the overlay, but never re-arms; a new arm needs a fresh-presence `voice-arm`. D64's `unlimited` maxDecisions does not survive a trip.

**S35-09 (medium) Cached unlocks (§3.4).** Do not drop helper unlocks on a trip. Unlocks are per `connId`, and a global drop is itself a DoS. Instead the broker remaps the decision class per repo, refusing `FORBIDDEN{reason:'breaker'}` and raising the presence prompt. `approval.suspect` adds `breaker-class` for a cached decision that lands after a trip.

**S35-10 (high) Gaming the convergence cap.**
- *Rounds:* a round is a kernel-observed review outcome (reviewer `oracle.result` or a verdict reject), never agent-declared. That stops an agent tripping "reconsider" early to escape review.
- *Evasion:* re-ids, node splits and respawns inherit the round count by lineage.
- *Card content:* the `reconsider` card body is kernel-composed from `loop.row` history. The agent's proposed alternative is appended as fenced, untrusted text.
- *Actions:* `re-plan`, `abandon` (deny-direction, so cached or voice is fine) and `extend +1 round`. Extend is fresh-presence, counted, voice-ineligible, and capped at 2 extensions.
- No action on the card merges, approves or certifies.

**S35-11 (high) `testedHow / risk / revert` are untrusted agent text.**
- Sanitized under §4.5, rendered below the kernel-owned region in a fenced block labelled `agent-claimed`, and stored as `agentClaims{…}`, separate from kernel fields.
- Never authority: `risk: low` never lowers a decision class, voice eligibility or breaker weight. Only kernel-computed risk (gate-class hash hits, diff size, symbols touched) drives class, and it is shown side by side with the claim.
- A disagreement between claim and kernel sets flag `claim-mismatch`, which makes the card voice-ineligible.
- A `testedHow` claim must cite `oracle.result` ids; anything uncited renders as "unverified".
- The kernel never executes `revert` text and never offers it as a button. A kernel revert action is computed from refs.
- These fields go to the reviewer model as data. Fields from a peer brief carry the `peer` taint.

## Invariants

- **CB1** Only the kernel appends `gate.breaker.*`, signed with the kernel key.
- **CB2** No principal other than root presence can lower the level faster than the evidence schedule allows.
- **CB3** Absence of signals never loosens.
- **CB4** A trip never increases the number of cards per decision.
- **CB5** Effective voice classes = grant ∩ breaker, and loosening never re-arms.
- **CB6** Agent claims never change a decision's class, eligibility or breaker weight.

## Falsifiers

| Id | Test | Expected |
|---|---|---|
| `G-CB-01` | Agent, mod, voice and peer each try to append `gate.breaker.*` | Refused |
| `G-CB-02` | Revert hidden by squash, fix-forward or rename | Counted |
| `G-CB-03` | Non-fast-forward of a watched ref | Trips |
| `G-CB-04` | Quiet window with no survival evidence | No loosen |
| `G-CB-05` | `project.yaml` threshold key | Ignored; `config.ignored` logged |
| `G-CB-06` | Root-config threshold raise without presence | Refused |
| `G-CB-07` | Sawtooth: behave a full window, then re-trip | Jumps back to the previous peak |
| `G-CB-08` | 50 forced reverts | Cards per decision stay flat; concurrency drops |
| `G-CB-09` | Trip during a live gate arm | Arm disarmed; arm still gone after the loosen |
| `G-CB-10` | Cached `allow` on a tripped repo | `FORBIDDEN{breaker}`; presence prompt raised |
| `G-CNV-01` | Agent-declared round | Not counted |
| `G-CNV-02` | Respawn or node split | Inherits the round count |
| `G-CNV-03` | `reconsider` card actions | No action merges or approves; extend is fresh-presence and capped |
| `G-CLM-01` | `risk: low` on a gate-class diff | `claim-mismatch` flag; class unchanged |
| `G-CLM-02` | Hidden or bidi characters in a claim field | Flagged under `G-GUI-11` |
| `G-CLM-03` | `testedHow` without oracle ids | Rendered "unverified" |

## Reserve in M1.1 (so `clientApiId` does not move, A26-11)

- **Events:** `gate.breaker.{tripped,stepped,held,reset}`.
- **`card:v1` kinds:** `reconsider`, `breaker-reset`, `incident`.
- **Flag:** `claim-mismatch`.
- **Sub-objects:** `agentClaims{testedHow, testedRefs[], risk, revert}` (untrusted) and `kernelRisk{…}`.
- **Refusal reason:** `breaker`.
- **`approval.suspect` reason:** `breaker-class`.
- **Status:** `status.breaker[{repo, level, since, nextEligibleLoosen}]` and `status.unobservedRefWrites`.
- **Root config:** `gates.breaker{weights, thresholds, tightenWindow, loosenWindow, recallWindow, baseline}`.

Open for Arky: whether `incident` is human-only (recommended: fresh or cached human decision; never agent-raised).
