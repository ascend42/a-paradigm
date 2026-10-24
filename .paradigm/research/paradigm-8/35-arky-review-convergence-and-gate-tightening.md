# 35 — Arky: review convergence, evidence-driven gate tightening, change notes (T-2026-10-17-004 a–c) — 2026-10-17

**What was read (read-only):** `docs/specs/gnomon.md` v3.8: §2.1, §3.4, §3.9, §4, §5, §7, §8.5–8.6, §9, §11.4–11.5, §14.7, §15.7, §19–§20, §22.

**Neurons (`ai/agents/code-review`):** n:review-must-converge, n:approval-circuit-breaker, n:human-time-guardrail-metric, n:risk-tier-set-by-change, n:incidents-as-reviewer-eval, n:verified-review-findings.

**Our own case:** lore L-2026-10-17-ascend-210158-001 (D83 passed in 3 rounds; the cap held) and L-2026-10-17-ascend-214000-001 (D85 passed in 2 rounds).

**Gaps:** the Paradigm MCP tools were not reachable from this context, so the ripple check was done by hand. Everything below is design; nothing is built.

**The rule throughout:** the kernel owns counting, choosing which bytes the reviewer sees, deterministic deduplication, refusing, and changing approval classes. The numbers it enforces come from root-signed config, as the fuse's do (§3.4). The reviewer's wording and judgment stay in userland.

This note amends the spec in three places, each named in its finding: §7.3's knot routing (A35-01), §3.4's decision classes (A35-08) and D82's list of critical kinds (A35-08).

## (a) Review convergence in the armada

- **A35-01. Spec conflict in §7.3: a reviewer fail currently goes straight to the human as a KNOT.** Today any oracle disagreement produces a `knot` card, so a reviewer saying fail while the tests pass would reach the founder on round 1.
  - **Amendment:** while the round count is under the cap, a failing `reviewer` or `test` oracle hands the node back to its claimant (`contract.review.returned{nodeId, round, openFindings{n, of}}`).
  - `knot` stays for disagreements at admission or merge level (a Warpline KNOT, or `merge-ci` against the reviewer after the cap).
- **A35-02. The kernel counts rounds.** A round is one `oracle.run{oracle:'reviewer'}` after a `contract.built`.
  - The count is keyed by `(contractId, nodeId)`, not by claim, so releasing and reclaiming a node does not reset it. Only a human `restart` decision does.
  - Config is root-signed: `review: {maxRounds: 3 (range 1..5), diffOnlyAfterRound: 1}`.
  - At the cap, the broker refuses the `oracle.reviewer` permit with `FORBIDDEN`, new gate `review`, reason `review-cap`, and `next:[{verb:'approve', principal:'human'}]`, then raises a `reconsider` card.
  - The claim's TTL timer is suspended while that card is pending, as it is for `held` cards.
  - None of this touches a closed enumeration.
- **A35-03. The `reconsider` card.**
  - **Body:** the round history, open findings grouped by class, and the claimant's change note (part c).
  - **Decisions:**
    - `restart`: release the claim and reset the count; the next `built` must carry a new note.
    - `extend`: one more round. Fresh presence, counted as an override.
    - `accept`: certify despite open findings. Fresh presence, logged `verdict.founder{accepted, override:true}`.
    - `reject`: abandon the node.
  - **Classes:** `restart`, `extend` and `accept` take fresh presence. `reject` is deny-direction and takes the cached class. The card is voice-eligible only as judgment class (D61).
- **A35-04. After round 1, the reviewer sees only what changed.**
  - From round 2 on, the kernel's input to the reviewer is the diff from the commit reviewed last round to the new head, plus the findings ledger. The full current text of the touched files is context only.
  - A new finding whose location falls outside the new hunks is dropped as `outOfScope{n, of}` and filed as `pre-existing`, which does not block.
  - **Residual:** a change in a new hunk can break unchanged code. That is caught only by the tests, and by the reviewer reporting it as class `regression` anchored to a new hunk.
- **A35-05. Findings have a fixed shape.** The reviewer's schema widens from `{pass, reasons[], riskyUnits[]}` to `review-finding:v1`:
  ```
  {fid, round, class, severity: important|nit|pre-existing, locus:{path, lines?, symbol?}, instances[], claim, fingerprint}
  ```
  - The kernel sets `pre-existing` itself when the location is outside the base..head diff (the 59 % old-bug effect from n:review-must-converge).
  - **Class of bug:** in round 1 the reviewer must list every instance of a class in `instances[]`.
  - **No repeats:** `fingerprint = sha256(class ‖ symbol ?? path ‖ overlapping line range)`. A new finding that matches a ledger entry is dropped and counted `repeated{n, of}`. A reviewer that paraphrases the same issue under a different class gets past this; that is a stated residual.
  - **Pass rule:** the kernel's `pass` is the reviewer's `pass` with zero open `important` findings.
- **A35-06. The author answers on `built`, not with a new verb.** `contract.claim{op:'built'}` gains optional `responses:[{fid, response: fixed|wrong|intentional|immaterial, note?}]`.
  - Law 3 holds: sessions have no `log.append`.
  - The mix of responses is the reviewer-noise measure from n:incidents-as-reviewer-eval.
- **A35-07. Split between kernel and userland.**
  - **Kernel:** round counter, diff range, dedupe, out-of-scope drop, cap, card, and the new `contract.review.returned|capped|extended|restarted` kinds. The `oracle.result` payload gains `round`, `range{from, to}` and `findings[]`.
  - **Userland:** the reviewer's prompt and class vocabulary, shipped as `provides.oracles` in the `paradigm` distro manifest. A second reviewer (security) is the same mechanism as an extra oracle (see A35-09, L1).
  - **Telemetry `T-REV-01`:** rounds-to-pass `{p50, p95}`, cap hits, repeats, out-of-scope drops and the response mix, each `{n, of}` per `(repo, mode)`, reported next to §8.6's `laterBroke/passes`, which serves as recall.
  - **Field falsifier:** a cap that does not reduce rounds, or `laterBroke` rising after the cap ships, means the cap is hiding defects.

## (b) Evidence-driven gate tightening (the circuit breaker)

- **A35-08. Strictness is per repo, owned by the broker, and replayable.**
  - New kinds `approval.strictness.raised|proposed|lowered{repo, from, to, signals{…}, configHash}`, kernel-signed.
  - `raised` joins D82's list of critical kinds: forced fsync and both anchors are written before the effect.
  - The level is computed from the log alone, so `gnomon replay` reproduces it.
  - **Spec change:** this amends §3.4's static decision classes. The effective class of a decision becomes the base class tightened by the repo's level.
- **A35-09. The ladder.** Each level includes everything below it.

  | Level | Effect |
  |---|---|
  | L0 | As specified today. |
  | L1 | Gate and judgment voice arms end, and the repo's effective voice policy drops to reversible. `always` rules for the repo are suspended (not deleted). Gate-class and high-risk nodes need a second reviewer (`reviewer:security`) and a fresh-presence `verdict` before they land. |
  | L2 | Cached-unlock `allow` on write or exec tools and `approve-plan` become fresh presence (FORBIDDEN, gate `strictness`, reason `strictness-presence`, prompt raised). Approving by voice is off; deny by voice stays (D66). Every node needs a `verdict` before it lands. Armada fan-out in the repo is capped at 1. |
  | L3 | Manual or tripwire only: no new spawns in the repo, attended human sessions only. |
- **A35-10. Which signals exist when.** Only kernel-owned kinds and human-recorded incidents count, so no agent can force tightening to cause prompt fatigue.
  - **Move 1:** `approval.suspect` (excluding the ancestry-noise reasons), which trips straight to L2. Falsifier tripwires 10, 14 and 15 become L3 trips.
  - **Move 2:** `merge.reverted{landedRef, detectedBy: revert-trailer|inverse-hunk|warpline-unpick}` is new. `contract.knot{reopenOf?}` is new. A "bad override" is an `extend` or `accept` on a node that later reverts. Cap hits count too.
  - **Incident:** `verdict.incident{refs[], severity}` is new. The founder records it with `gnomon incident` and needs no presence, because it only tightens.
  - **Move 3:** `detector.event`, `broke{}` and the calibration rows are shown in the GUI but not counted until Loid's liveness data says they are trustworthy. A raw override rate is shown and never counted, because it means nothing on its own.
- **A35-11. Thresholds are root-signed config; the starting values are provisional.**
  ```yaml
  breaker:
    window: {landed: 20, days: 14, min: 10}
    L1: {revertRate: 0.10, knotReopen: 2, badOverride: 1}
    L2: {revertRate: 0.25, incident: high}
    release: {revertRate: 0.05, dwellDays: 7, cleanLanded: 10}
  ```
- **A35-12. Hysteresis: tighten fast, loosen slowly, and only with a person.**
  - Tightening is automatic and immediate. The founder can also raise a level by hand (`request.strictness.raise`, no presence).
  - Loosening goes down one level at a time and only when three conditions hold: the dwell time has passed, the clean-landed count is met, and the release thresholds (below the trip thresholds) hold. The kernel then raises a `strictness` card with the evidence as `{n, of}`, decided with fresh presence. Nothing loosens on its own.
  - Going below the level the evidence supports takes the root key and is counted as an override.
  - Any change of level ends every voice arm, consistent with §14.7.
- **A35-13. Calibration is what loosens.** The per-codebase moat appears as two rules:
  - A repo whose `(repo, mode)` reviewer calibration is `uncalibrated` has a floor of L1, i.e. it starts strict (F1).
  - Reverted and incident nodes become `laterBroke` evidence and the reviewer's daily eval set in Move 3 (n:incidents-as-reviewer-eval). The thresholds can be carried to another repo; the evidence cannot.
- **A35-14. GUI.**
  - A kernel-owned Shuttle indicator that cannot be hidden: `STRICT L2 · 3 reverts / 12 landed · since <date>`.
  - A glyph on the repo's row in the sidebar.
  - The presence prompt text and each card name the reason for its class.
  - `status.strictness{repos:[{repo, level, floor, since, signals, loosenEligibleAt}]}`.
- **A35-15. Falsifiers.**
  - **`G-BRK-07`:** a fixture with reverts crossing the threshold refuses a cached allow and raises a prompt, and replay reproduces the level.
  - **`G-BRK-08`:** loosening never happens without fresh presence. No agent, session, mod or voice principal can append `strictness` or `incident` kinds.
  - **`G-BRK-09`:** any change of level ends voice arms within 1 s.
  - **Telemetry `T-BRK-01`** (n:human-time-guardrail-metric): share of time at L≥1; human approvals per landed node `{p50, p95}`; time spent waiting on the founder; false trips (loosened within 7 days with no further signal).
  - **Field falsifiers:** approvals per node fall while the revert rate rises (time was moved, not saved); L≥1 for more than 50 % of a month (the thresholds or signals are noise, and approval fatigue is the risk).

## (c) Tested how / Risk / How to revert

- **A35-16. The schema.**
  ```
  change-note:v1 {
    testedHow:{summary ≤1 KiB, evidence:[ref]},
    risk:{tier: low|medium|high, why ≤512 B, blast:[sym:]},
    revert:{how: auto|command|manual, steps ≤1 KiB, reversible: bool},
    draftedBy
  }
  ```
  It is an optional `note` on `card:v1`, on `contract.claim{op:'built'}` (carried on to `contract.built`), and on `brief:v1` (still a draft under the not-yet-frozen `linkApiId`, so this costs nothing now).
- **A35-17. Who fills in what.**
  - **The agent** drafts the whole note.
  - **The kernel** adds: the count of evidence refs that resolve to a kernel-signed `oracle.result` (`verified{n, of}`); a risk floor (gate-class paths per §15.7, or portal-gated or `~security` symbols ⇒ `high`; docs-only ⇒ `low`), with the effective tier the higher of the agent's tier and the floor, so an agent can raise the tier but never lower it (n:risk-tier-set-by-change); and `how: auto` (the landed sha for `git revert`, or the Warpline unpick).
  - **The human signs off through the decision itself:** the note is inside `contentHash`, so the decision signature covers what was shown.
  - `reversible:false` adds the new flag `irreversible`: fresh presence and no voice.
  - From Move 2, `built` without a note is refused (`BAD_REQUEST`, reason `note-missing`) when the tier is medium or higher, or the repo is at L1 or above.
- **A35-18. How it shows on a card.**
  - A kernel-owned three-line strip:
    - `Tested 2/3 verified (G-LOG-04 ✓, G-LOG-10 ✓, "ran manually" unverified)`
    - `Risk HIGH (kernel floor: .claude/settings.json; agent said medium)`
    - `Revert auto: git revert 1a2b3c4`
  - Agent text is sanitized data, labelled as the agent's claim.
  - Gate readback speaks the tier and whether the change is reversible.
  - Inbound briefs show the strip with the `peer` flag.

## Placement and reservations

- **A35-19. Placement by move.**
  - **M1.1:** reserve only (A26-11). No Move 1 behaviour changes.
  - **Move 2:** new task `M2.10` for review convergence (`G-REV-01..05`, `T-REV-01`) and new task `M2.11` for the breaker, change notes and revert detection (`G-BRK-07..09`, `G-CHG-01..03`, `T-BRK-01`).
  - **Move 3:** M3.4 gains the calibration floor and the incident eval.
  - **Move 4:** M4.5 and M4.6 must respect the effective voice policy under strictness.
- **A35-20. What `gnomon-contracts` must reserve now.**
  - **Card kinds:** `reconsider`, `strictness`.
  - **Decisions:** `extend`, `restart`.
  - **Card flag:** `irreversible`.
  - **Card fields:** `note?`, `strictness?{level, reason}`.
  - **Refusal gates:** `review` (reason `review-cap`); `strictness` (reasons `strictness-presence`, `strictness-voice`, `strictness-paused`).
  - **Refusal reasons on other gates:** voice reason `voice-strictness`; `BAD_REQUEST` reason `note-missing`.
  - **Schemas:** `change-note:v1`, `review-finding:v1`.
  - **Contract params:** `contract.claim` gains `note` and `responses`.
  - **Event kinds:** `approval.strictness.raised|proposed|lowered`, `contract.review.returned|capped|extended|restarted`, `merge.reverted`, `verdict.incident`, `request.incident`, `request.strictness.raise`.
  - **Additive fields on existing kinds:** `oracle.result` gains `round`, `range`, `findings`; `contract.knot` gains `reopenOf`; `verdict.founder` gains `override`.
  - **Status fields:** `status.strictness`, `status.review`.
  - **Closed enumerations:** none touched.

## Founder questions

- **F1.** Should a repo whose reviewer is not yet calibrated start at L1 (start strict, more touches while dog-fooding) or at L0?
- **F2.** Should loosening a level take fresh presence (recommended) or the root key?
