# Warpline Expo Field-Test Protocol — Pre-Registration v2

Id: `expo-field-test-prereg-v2` · Status: **TEXT RATIFIED + LOCKED (TD-2026-08-24-012,
founder, 2026-08-24). The amendment log is CLOSED — any text change requires a v3.**
FREEZE (admissions count only after it) still awaits §C conditions (b) subject named in
§A2 and (c) seed/corpus manifest hashes committed.
Author: session 2026-08-23, under founder rulings TD-2026-08-23-042 (F1–F8) and the readiness
panel (`field-test-readiness-2026-08-23.md`).

**Relationship to v1.** `expo-field-test-protocol.md` (locked 2026-08-11) is preserved
IMMUTABLE, exactly as its own rule requires: it is not edited; this document is the NEW
pre-registration that supersedes it. v2 is a DELTA: every v1 section not amended below carries
forward verbatim into v2's meaning. v2 FREEZES when all three hold: (a) the founder ratifies
this text — DONE (TD-2026-08-24-012), (b) the subject app is named in §A2, (c) the seed/corpus manifests are sealed
(hashes committed). No admission counts before the freeze; after it, changes require a v3.

---

## A. Amendments

### A1 — Agents' model (amends v1 §2, §9) [TD-042 F7]
Agents under test = **`claude-opus-4-8`** (exact alias ID per the claude-api reference;
alias-only remains acceptable for AGENTS because they are the subject, not the reproducible
instrument — v1 §2's own reasoning; recorded with the run date). The founder explicitly
declines `claude-opus-5`. Judge pin UNCHANGED: `claude-opus-4-5-20251101` (still the
strongest model publishing a genuine dated snapshot). §9 caveat re-derived: agents (Opus 4.8)
and judge (Opus 4.5) are the SAME Opus line, version-separated → the ≠-branch applies with
the correlated-priors discount at its stronger (nearer same-model) end, exactly as v1
analyzed for the opus-5 pairing; no (B)/(C) verdict may lean on judge-vs-agent agreement as
corroboration. Every agent instance is launched `claude --model claude-opus-4-8` and the
launch command is recorded per instance. Subagent-model leakage (an instance delegating to a
different model under the same token) is recorded as a known limitation, not silently ignored.

### A2 — Subject (amends v1 §2) [TD-042 F2]
Subject = **a NEW Expo application the founder is starting** (rejected: a-climbers-gift, any
client-owned repo). `SUBJECT = ______` — to be filled before freeze; freeze condition (b).
Real feature work = the app's own roadmap/backlog. Overlap zones and the frozen behavioral
checklist are derived on THIS app before the run (the Z1–Z4 method from the readiness doc).
Consequence accepted: early admissions on a young app are low-contention; the §3 contested
floor still governs — no floor, no (B)/(C) claim.

### A3 — Green gate (amends v1 §4 step 2) [TD-042 F4]
Declared objective gate = **{`tsc --noEmit`, `expo export`}** plus the frozen behavioral
checklist (v1 §4 step 3, unchanged). Lint/test are recorded `absent` — never `pass`. The §7A
objective-class bound is reported labeled **"tsc+bundle only"**. v1 §7A's INCONCLUSIVE
clauses (n_objective < 30; blind-class domination) carry forward unchanged and bite harder
under the thinner gate — stated, not hidden.

### A4 — §7C intervention metric (resolves the v1 §3-vs-§7C contradiction) [panel F3a]
v1 counted every human touch as an intervention while §3 demanded ≥20 genuine KNOTs — each of
which REQUIRES a human resolve by the security law — leaving a ≤5-KNOT window (arithmetically
self-defeating; verified). v2 rules: **a genuine-KNOT resolve is the product's intended
function, not a failure cost — it is measured by K2, not by the intervention ceiling.** The
§7C intervention burden counts only INVOLUNTARY interventions:
  - over-block (false) KNOT resolves (blinded classification, corrected per A6),
  - logged git fallbacks (habit iii),
  - wedge escapes / manual unsticking of any kind,
  - HELD releases whose grade is subsequently overturned (a HELD whose hold SURVIVES is the
    product working; one overturned was a false hold → intervention).
The pre-committed ceiling stays **25 per 100 admissions** on this involuntary count. K2
(over-block > genuine → (C) falsified) carries forward unchanged. HELD is hereby defined into
§7C (v1 never named it).

### A5 — Second-rater output mode (re-registers v1 §5 to match the instrument as built) [panel F3b]
The judge is registered AS BUILT: free-text single-label response, deterministic
`parseLabel` (exact match first, then longest-label-first substring), N=3, majority, no
2-of-3 → INDETERMINATE, UNPARSEABLE never a verdict; temperature 0; max_tokens 64; the
"respond with the label and nothing else" instruction. v1's "structured-output mode is used"
sentence is corrected — it described an aspiration, not the instrument. (Alternative
considered: implement schema-validated structured outputs on the pinned snapshot; declined —
zero-benefit churn on a cleared instrument; the parse is deterministic and its failure mode
is UNPARSEABLE, which cannot become a verdict.)

### A6 — Genuine-count correction formula (fills the v1 gap) [panel F3d]
From the seeded classifier controls (≥20 KNOWN-GENUINE + ≥20 KNOWN-OVER-BLOCK, authored from
the subject's own source, labels founder-sealed before the run):
  - sensitivity TPR = recall on GENUINE seeds; false-genuine rate FPR = fraction of
    OVER-BLOCK seeds the judge called GENUINE.
  - **Corrected genuine count = N_classified × clamp01( (p_obs − FPR) / (TPR − FPR) )**
    (Rogan–Gladen), where p_obs = observed judge-GENUINE fraction over classified field
    KNOTs (seeds excluded). If TPR − FPR ≤ 0.2 the classifier is uninformative → the
    denominator is UNCALIBRATED, no (B)/(C) pass.
  - The naive `observed × precision` count is ALSO reported, labeled naive.
  - The corrected count is THE genuine denominator for the §3 floor (≥20), §7B, and §7C/K2.
  - Calibration gate: one-sided 95% Wilson lower bound of seed GENUINE-precision must
    exceed 0.29 (the prior is directional only — its provenance caveat from the readiness
    doc is restated in the report).

### A7 — Audit-sample rating cards (registers the failingCheck posture) [panel F3c]
v1's BROKEN rubric asks about "the check that failed"; a §4 random-audit CLEAN has none. v2
registers the AS-BUILT sentinel: audit-sample cards carry `failingCheck: 'none-declared'`,
the rubric text is UNCHANGED (rubricHash stability preserved), and the report carries a
standing caveat: this may prime the judge toward "broken" on audit-sample cards — a bias
AGAINST Warpline (it can only create false false-CLEAN candidates, never hide one), i.e.
anti-flattering, therefore acceptable in a falsification design. Stated wherever the
subjective bound is reported.

### A8 — Audit-sample selection vs TD-831 (resolves the conflict) [panel F3e]
The frozen deterministic rule STANDS: every 5th dismissed CLEAN by ledger order, **floor 15
per 100-admission block (per-block, superseding the increment-1 global-floor caveat)**.
TD-831's "weight sampling toward danger-flagged CLEANs" is NOT applied to judge-sample
selection — its intent is already honored by the oracle arm, which audits EVERY clean seal
including all danger-flagged ones. Selection stays incentive-free and pre-committed.

### A9 — Injection corpus authorship (amends v1 §5 gate 2) [TD-042 F6]
The blind corpus = **externally-authored payload strings** (published prompt-injection
corpora) embedded in **internally assembled cards**, stated exactly so. Membership sealed:
the corpus manifest hash is committed to git before admission 1; membership is not revealed
to the scoring pipeline until after grading. The full "external human author" tier remains
open as a strengthening for a later block; its absence here is reported, not hidden.

### A10 — Judge credentials (amends v1 §5 cold-judge mechanics) [TD-042 F5]
The judge runs on the OPERATOR'S STANDARD ACCOUNT: the SDK's zero-arg credential chain
(`ANTHROPIC_API_KEY` → `ANTHROPIC_AUTH_TOKEN` → the `ant auth login` OAuth profile). An
explicit API key is permitted, not required. Isolation clause restated: the judge process
runs under the operator's credentials in the operator's shell; NO swarm agent shares that
shell or those credentials; the judge still holds no Warpline daemon token (cold, outward-
only — unchanged).

### A11 — M3 precondition (amended by TD-2026-08-23-136, superseding TD-913(3)'s crypto clause)
M3-LITE lands BEFORE admission 1: Ed25519 AGENT-key signed strands (attribution integrity
between agents), `warpline fsck`, and the auto-resolve grant mechanism (present, NO grant
active during the run — the fail-closed arm as registered). The HUMAN boundary is PROCEDURAL
by founder ruling: HUMAN_ONLY_VERBS at the daemon + tool-permission denies including
`.warpline/keys/**` reads. THE REPORT STATES THIS PLAINLY: the run's human/agent boundary is
enforcement-by-permissions, not cryptography; agent-to-agent attribution IS signed. Design +
rulings: `m3-integrity-design-2026-08-23.md` §6.

## B. Unchanged (carried forward verbatim from v1)
n=100 fixed, no optional stopping; contested floor ≥20 (now on the A6-corrected count);
ledger custody + write-before-reveal + git-witnessed heads (§3, A9/A13); the §4 oracle,
power rule, planted positive control (A6) and its VOID rule; the §5 twin-invariant +
corpus DISQUALIFY pre-flight; the §7A two-denominator bounds (never blended); §8 blind
classes; §9 reporting incl. indeterminate-as-directional-bias and the pre-fix baseline
framing; habits (i)/(ii)/(iii).

## C. Freeze checklist (all before admission 1)
- [ ] Founder ratifies this text (v2 id becomes LOCKED; amendment log closed)
- [ ] §A2 SUBJECT named; subject onboarded (.warpline, .warpignore, MCP tokens, permissions)
- [ ] M3-lite shipped + fsck green on the subject fabric; no auto-resolve grant active (A11)
- [ ] Behavioral checklist authored on the subject + frozen; greengate.json committed
- [ ] Seeds (≥20+≥20) + planted control + corpus manifests sealed, hashes committed
- [ ] Backlog with overlap zones fixed and committed
- [ ] Judge live regression executed once on operator credentials (WARPLINE_JUDGE_LIVE=1)
- [ ] 5-admission dry run end-to-end per `warpline-field-test-runbook.md`, incl. one
      witness commit + one `field join` + one `field score` producing a report
