# Warpline Forge — north-star CONSTRAINT spec (the "GitHub layer")

> **Status: DRAFT — PENDING FOUNDER BLESSING. SPEC-ONLY — NO FORGE CODE until graded-weaves/week > 0** (North's freeze; roadmap freeze list).
> Author: Arky (architect) · Task T-2026-07-14-005 · Panel ruling L-2026-07-14-ascend-150429-001 · Roadmap `.paradigm/research/warpline-roadmap-2026H2.md` §0.5
> Reads with: `warpline-flows.md` (OFFER/endorsement vocabulary), `warpline-engine.md` (verdict semantics), `warpline-gui.md` (the GUI seed), `warpline-v3-identity.md` (API guardrails), `warpline-fabric-schema-v2.md`.

## 0. What this document is — and is not

The founder's ask: one day Warpline needs a "GitHub-like" surface — repo management,
CI/CD, issues, merge/review, branching, permissions, the history tree. The panel's ruling
(L-2026-07-14-ascend-150429-001): **do not build that layer now.** Cursor Origin,
Entire.io, and Agent HQ are contesting the agent-forge layer with $60M+ behind them;
our layer — deterministic false-CLEAN judgment on git-clean merges — is still empty and
is the only layer nobody else occupies. Building a forge today would be spending our
window on their moat.

So this is a **constraint document, not a build plan.** Its one job: every Phase-2 API
shape (verdict JSON, KNOT payload, claim schema, injection envelope) must be designed so
that a forge can later be *rendered over* the substrate without reshaping it. The forge
is a projection of data Warpline already keeps; if Phase 2 keeps these constraints, the
forge is a UI problem. If it breaks them, the forge is a migration.

Deliberately absent, by design: file plans, estimates, screens beyond the one concept in
§2, and any implementation sequencing. Those belong to a future spec written after the
thaw condition (§5) is met.

Thesis anchor (panel-proposed wording, PENDING founder ratification — roadmap gate 0.1): **"meaning judges, bytes execute,
disagreement fails closed."** The forge is where humans watch that judgment happen — it
must never become a place where humans re-do the judgment by hand.

## 1. The translation table (the heart)

Every GitHub noun exists because git exiled a semantic concern to a hosting company.
Warpline keeps those concerns native, so the forge nouns are not *features to build* —
they are *views over records the engine already writes* (or is speced to write). That is
the structural bet of this document: each row below names the Warpline record that IS
the noun, and the forge renders it.

| GitHub noun | Warpline noun | The record it renders |
|---|---|---|
| Issue | **the KNOT queue** | `Knot[]` from the admit verdict + `KnotResolution` on the resolving strand |
| Pull request | **OFFER** carrying verdict + claims | the Justification + `AdmitDecision` + the claim schema (§3b) |
| CI / CD | **the admit gate** | `AdmitDecision` (stage 1, deterministic) + test witnesses at seal (P5.3) |
| Permissions / branch protection | **scrutiny policy** (the trust layer) | grades sidecar + fragility + WEAVE-LAW predicate |
| Code tree / history graph | **the Tapestry** | the fabric DAG (strands, attribution, selvage) + per-path honesty labels |
| Notifications | **verdict-class subscriptions** | the append-only fabric/grade event streams |
| CODEOWNERS | computed domain-trust holders | trust ledger keyed agentId × symbol (Phase 3 A2) |
| Fork | `warpline diverge` / per-agent `scratch` | scratch refs (built) |
| Branch | ref (weft) | `refs/heads/<name>` → pickId (v3 §2) |
| Release | **BOLT** | signed cut over a stateId |
| Merge queue | the admit queue | admit re-predicts each landing against the moved selvage (built: rebase-onto-selvage is the default path) |
| Draft PR | `offer --draft` | an OFFER whose claim is sealed but whose admission is not requested |

### 1a. Issues → the KNOT queue

A GitHub issue is prose typed after the fact — a human noticing a problem and describing
it lossily. A KNOT is a work item **born by the gate at the moment of contradiction**,
already carrying everything a resolver needs: the exact contested symbols (`stableKey`,
`symbol`, `conflictingSlots`), both sides' essences (`essenceA`/`essenceB`), both sides'
intents (from the two Justifications), the direct-vs-ripple ranking signal
(`Knot.direct`, T-2026-07-03-002), and — once R3 lands (roadmap 2.2) — both sides'
bodies. Nobody files a KNOT; nobody triages it into existence; nobody writes a repro.
The queue is the set of unresolved KNOT/DANGLE verdicts, ranked (§2), and an item leaves
the queue only via a `resolve` strand whose `KnotResolution` records who decided, why
(`reason` is required — the accountability record), and what was contended. DANGLEs are
the same queue with a different shape (`fromSymbol`, `edgeKind`,
`danglingTargetSymbol`, `retiredBy`) — a severed reference, not a contradiction.

Constraint: the forge's issue view is a *read* of the KNOT payload (§3a) plus a *write*
of exactly one thing — a resolution proposal in the envelope §3a defines. No forge-side
issue store, no forge-side status field, no prose-first issue type. If a team needs
free-form planning items, that is Paradigm's task system, not the forge.

### 1b. Pull requests → OFFERs carrying verdicts + claims

A GitHub PR is a byte-diff plus unstructured prose, reviewed by humans reading both. An
OFFER (flows §2) is lifted correct-by-construction and arrives *already judged*: it
carries the Justification (actor, intent, semantic delta, store-**computed** ripple —
the author cannot under-report impact), the author's claim (§3b — what they *believed*
they were touching, the calibration probe), and the deterministic verdict
(`FAST_ADMIT`/`CLEAN`/`KNOT`/`DANGLE`, with `confidence: linked|independent` on CLEAN).

**Review happens at the judgment level; diff on demand.** The reviewer's first screen is
the verdict, the claim-vs-computed comparison, the blast radius, and the scrutiny tier —
not a file list. The byte diff is one click away and is explicitly the *secondary*
artifact (the GUI spec's rejected-list already bans "a git red/green diff as the primary
meaning view — concedes the frame we're replacing"). Approval is an ENDORSEMENT
(trust-weighted signature over the Offer's stateId), thresholded per touched domain by
fragility; Tier 0 auto-weaves route to the Shadow Panel, and fragile symbols carry the
typed ≥1-human requirement no agent trust can fill (flows §2 — the loaded-gun guard).

Constraint: an OFFER is not a forge object. It is the propose-API payload (§3b) plus the
verdict (§3c); the forge adds only presentation and the endorsement-collection workflow.
Any field the forge UI needs (title, discussion anchor, reviewers) must map to a field
already in the claim schema, the verdict, or a KNOT — or be dropped from the design.

### 1c. CI/CD → the admit gate

**Stage 1 of any Warpline pipeline is the deterministic verdict.** Not a container, not
a queue of runners — a pure function (`admitDecision(base, proposed, selvage)`,
`admit.ts:85`) that completes in-process and cannot flake. It is the only CI stage that
is *deterministic by construction*: same three states, same verdict, forever. Everything
GitHub Actions does after that — tests, lint, build — maps to **test witnesses attached
at seal** (roadmap P5.3): signed attestations that a named check ran against a named
stateId, carried on the strand. "Checks passed" becomes a property of the sealed history
rather than a green circle on a web page that history forgets.

Ordering constraint: the verdict gates *before* any witness runs (fail-closed — a KNOT
never reaches the test runner), and witnesses can only *add* evidence, never overturn a
KNOT into an admit. CD is a projection concern (`project`, BOLTs) and is out of scope
for the forge entirely.

### 1d. Permissions → scrutiny policy

GitHub permissions are an org-chart ACL: role × repo, granted by admins, blind to
content. Warpline's **trust layer IS the permission model.** Who may seal what is
decided by the scrutiny ladder (flows §2): `scrutiny = fragility(symbol) ×
(1 − trust(author, domain))`, with the tiers — Tier 0 auto-weave, Tier 1 peer
endorsement, Tier 2 mandatory human, Tier 3 Knot Council. Permission is therefore
**calibration-weighted and content-scoped**: a proven author in a robust domain needs
nobody's approval; the same author touching a fragile symbol is escalated to HELD no
matter their title. The minimum-trust build (roadmap P3 Lane A2) is the first live
consumer: grades keyed agentId × symbol, one rule — an *independent*-confidence CLEAN in
a low-survival symbol escalates to HELD. WEAVE-LAW (flows §3) is the branch-protection
equivalent: a signed trust predicate over symbol domains, itself changed only by a pick
that satisfies the *prior* law.

Constraint: the forge renders the policy and its escalations (HELD items, tier
assignments, Shadow Panel findings); it never stores its own ACL. A forge-side "admin
grants write access" button is a design error — the only inputs to permission are
grades (earned), fragility (computed), and WEAVE-LAW (sealed).

### 1e. Code tree / history → the Tapestry, with honesty labels

The history view is the **Tapestry**: the fabric DAG rendered — strands with
attribution (`actor`, `authoredBy.agentId`), weaves (multi-parent strands), KNOT
resolutions riding their strands, grades folded from the sidecar, and the selvage as the
live edge. Position is derived topologically (v3 §1.2), never from a stored sequence.
Per-path, the tree carries the **honesty labels** (roadmap P3 Lane A):
`meaning-decided` (a lens judged this path — TS symbols, JSON/YAML key-trees) vs
`byte-decided` (no lens; the merge was bytes, exactly what git would have done). The
forge must render this distinction on every tree and every merge — it is the product's
honesty metric, and hiding it would let the UI imply coverage the engine doesn't have.

Constraint: the tree/history API returns strand-set + refs (v3 §4 — two machines'
fabrics legitimately differ in file order while agreeing on the DAG), and every history
URL/anchor keys on `pickId` or `contentId`, never on a ledger index.

### 1f. Notifications → verdict-class subscriptions

GitHub notifies on social events (mentions, review requests). Warpline subscriptions key
on **verdict classes over symbol scopes**: "KNOT or DANGLE anywhere," "independent-CLEAN
in symbols I own," "HELD escalations in domain D," "Shadow Panel would-reject,"
"grade-overturn on a strand I endorsed." The substrate is already event-sourced — the
fabric and grades files are append-only JSONL, and the GUI plan's ledger reader
(fs.watch → WS `!oracle-record-appended`) is the delivery mechanism's seed. A
subscription is a predicate over `(verdict class, symbol set, tier)`; no new event
stream needs inventing.

## 2. The Judgment Console (the human oversight surface)

Loid's R5 requirement, restated: when agents write at machine scale, the human's scarce
resource is *judgment*, not reading. The console's opening screen is therefore a ranked
digest, not a feed:

```
While you were away: 12 admissions.
  9 FAST_ADMIT / linked-CLEAN     — folded, graded, nothing needs you.
  2 KNOTs                          — ranked: #payment-form (direct, fragile) first.
  1 independent-CLEAN              — in a fragile symbol → HELD for you.
```

**NOT a diff firehose.** The console never asks a human to read twelve diffs; it asks
for two decisions and one confirmation, ordered by expected loss (scrutiny). Ranking
inputs, all of which exist or are speced: verdict class, `Knot.direct`
(direct-contested outranks ripple-only), fragility (history-fragility), confidence
(`independent` outranks `linked` for attention), and the grade prior
(admit seeds 0.9 linked / 0.6 independent / 0.8 fast-admit — `admit.ts:171`).

**The Oracle Divergence Viewer is the console's seed.** The GUI spec's MVP (the
meaning-vs-bytes split screen, the 2×2 confusion matrix, knot/dangle rendering, the
ledger reader + WS repaint) is a *single-verdict* judgment surface. It grows into the
console along one axis only — from "render one adjudication" to "rank many":

1. **Today (built/planned):** one oracle/admit record rendered fully — the split screen,
   the knot cards, the blast-radius slice (`graphSliceFromRoot`, render-by-projection).
2. **Admit feed:** the same renderer pointed at the live fabric instead of a chosen
   branch pair — every admission is a row; KNOT/DANGLE/HELD rows expand into the
   existing viewer unchanged.
3. **The ranked inbox:** the digest above — scrutiny-ordered, resolution actions inline
   (propose/endorse/decide), Shadow Panel counterfactuals in a separate lane.

Constraint: each stage reuses the previous stage's renderer and the same JSON shapes
(§3); if stage 3 needs a field stage 1's shapes don't carry, the fix goes into the
Phase-2 schema, not into a console-private sidecar. The console is a Platform section
(per the GUI spec's architecture ruling — a section, not a standalone server) until the
thaw condition (§5) justifies a standalone deployment; nothing in its design may assume
otherwise.

## 3. API-compatibility constraints for Phase 2 (the actual point)

Phase 2 (roadmap weeks 3–6) ships four shapes. Each is listed with the constraints that
make it forge-compatible. The general law, first, inherited from v3 §6 and extended to
every forge-visible contract:

- **G1 — versioned, additive evolution.** Every payload carries `schemaVersion`;
  consumers skip unknown fields and unknown row versions without crashing (the GUI
  spec's ledger version-guard, generalized). Removing or re-typing a field is an epoch
  bump, never a patch.
- **G2 — no ledger positions in any contract.** `seq` never appears in API/JSON output
  consumed by other tools (v3 §6 MAY-NOT-1). Durable references are `pickId`,
  `stateId`, `contentId`, `stableKey`. Forge URLs are content-addressed for free.
- **G3 — engine shapes verbatim.** The forge/GUI imports the engine's exported types; it
  does not redefine them (GUI spec §1 contract). One shape, two consumers: the forge
  renders it AND agents consume it. If a shape is awkward to render, fix the shape.
- **G4 — reads are structural, writes go through the gate.** Every forge read is a pure
  projection of fabric/grades/objects; every forge write is one of exactly three verbs —
  propose (§3b), endorse, resolve — each landing as a sealed strand or a signed sidecar
  event. The forge holds no state the fabric doesn't.
- **G5 — mutable trust data stays in sidecars** (v3 §7). Grades, scrutiny, rankings are
  *beliefs about* history and live in `grades.jsonl`-class stores; they never enter a
  signed strand. The forge may display them; it must render them as revisable.

### 3a. The machine-readable KNOT payload (R3 — roadmap 2.2)

The KNOT is the forge's issue AND the agent's work order — **one shape.** It must carry,
in one self-sufficient document:

- **Identity:** `stableKey`, `symbol`, `conflictingSlots[]`, `essenceA`/`essenceB`,
  `direct` (all live today, `predict.ts:27`), plus the admit context
  (`rebasedOnto`, `agentChanged[]`, `otherChanged[]`).
- **Both sides' bodies** (R3's addition): the contested unit's content on each side,
  content-addressed — not a diff hunk, the actual competing meanings.
- **Both sides' intents:** the two Justifications' `intent` + `actor`/`authoredBy`, so a
  resolver (human or agent) sees *why* each side wanted its change, not just what.
- **Blast radius:** the computed ripple as a real graph slice reference
  (`mode:'ripple'`, per the render-by-projection substrate) — renderable by the forge,
  traversable by an agent.
- **The resolution-proposal envelope:** a typed slot for a proposed resolution —
  `{proposedRef | proposedBodies, reason, proposedBy, confidence}` — which is exactly
  the input `resolveKnot` already takes (`ResolveOptions`: `resolvedRef`, `reason`
  required, `decidedBy`, `oursRef`). A proposal is *data attached to the knot*, never an
  auto-applied change; sealing it stays behind the resolve verb and the scrutiny tier.

Exit-gate restated as the constraint: **a fresh agent must be able to propose a KNOT
resolution from the payload alone, without repo archaeology** — and the forge must be
able to render the same payload as an issue page without a second query. If either
consumer needs a join the payload doesn't carry, the payload is wrong.

### 3b. The claim-scoped propose API (roadmap 2.3, T-2026-06-24-018)

The claim is the author's pre-declaration: *"this change touches these symbols/paths,
for this intent, with this confidence."* It serves triple duty — perf scoping hint,
calibration probe (claimed vs computed is the graded forecast from flows §2), and the
forge's OFFER metadata. Constraints:

- **The claim schema IS the future OFFER metadata.** Title, description, declared scope,
  predicted ripple, confidence, draft flag — everything a PR page shows above the fold
  must be a claim field. Design the claim in Phase 2 with this list in view; do not
  leave "forge will add its own metadata later" as an escape hatch.
- **CLAIM-BREACH is a verdict, not a rejection message:** computed-touched ⊄ claimed →
  a first-class verdict class alongside KNOT/DANGLE, carried in the same decision shape
  (G3), subscribable (§1f), and graded (a breach is a calibration event against the
  author).
- Claims are sealed with the strand (they are the author's signed belief — immutable
  once judged), while their *grading* lives in the sidecar (G5).

**SHIPPED (P2.3, `claim:v1`)** — `packages/warpline/src/fabric/claim.ts` + the admit
gate in `admit.ts`: `warpline propose --agent <id> --claim <file|json>` content-addresses
the claim (claimId; intent enveloped per §3d) into `.warpline/claims/`; `admit --claim
<claimId>` judges the verdict against it. CLAIM-BREACH ships as a first-class
`AdmitStatus` class (G1-additive), FAIL-SAFE: a breach HOLDS the admit (refused,
unsealed, exact excess/missing surfaced) and `--accept-breach` is the explicit override
that seals while recording the breach fact. Excess rule: a changed-but-unclaimed symbol
counts when DIRECT-changed or when it knots; a ripple-only non-knotting symbol is exempt
(Merkle-avalanche noise). `missing` (claimed-but-untouched) is recorded, never a breach.
Every judgment lands in `.warpline/claims/evaluations.jsonl` — the calibration-probe
stream (duty 2). The perf-scoping duty is RECORDED-ONLY (no decision function narrows by
claim). v1 posture on the third bullet: the claim is immutable-by-content-address and
referenced from the Justification (`claimId` pointer) + the evaluation stream (pickId ↔
claimId), NOT folded into the founder-signed strand/pickId preimage — folding it into
strand identity is a schema-epoch decision (v3+), not a P2.3 edit.

### 3c. Verdict JSON (stable, versioned, forge-renderable)

The verdict is today's `AdmitDecision` — `{status: NOOP|FAST_ADMIT|CLEAN|KNOT|DANGLE,
knots[], dangling[], confidence: linked|independent|null, rebasedOnto, agentChanged[],
otherChanged[]}` (`admit.ts:46`) — plus `AdmitResult`'s seal outcome. Constraints:

- **Freeze the class set semantics:** new verdict classes (CLAIM-BREACH, BRUSH — roadmap
  5.2) may be *added*; existing classes never change meaning. A forge rendering v2026
  verdicts must still render correctly when BRUSH rows appear (G1: unknown class → 
  "unknown verdict, judgment required," fail-closed in the UI too).
- **The verdict must be self-describing for rendering:** every symbol named in
  `knots/dangling/agentChanged/otherChanged` resolves via the object store
  (contentId-addressed), so the forge can hydrate a verdict into a full page from the
  verdict + the store alone.
- **Determinism is part of the contract:** same `(base, proposed, selvage)` stateIds →
  byte-identical verdict JSON. The forge may cache verdicts by input stateIds forever
  (the GUI spec's stateId-cache pattern); Phase 2 must not add wall-clock, environment,
  or ordering dependence to the decision path.
- **The verdict is the pipeline's stage-1 output** (§1c): its JSON is what a GitHub
  Check Run annotation, an MCP tool result, and a console row all wrap. One shape,
  three skins.

### 3d. The injection-safety envelope (T-2026-06-24-013)

Phase 2.2 is the moment agent prose (intents, knot bodies, resolution reasons) starts
flowing into *other agents'* reasoning and onto forge pages. The envelope is therefore a
Phase-2 constraint, not a forge-era retrofit:

- **Agent prose is typed untrusted content, born content-addressed.** Every free-text
  field (`intent`, `reason`, claim description, proposal rationale) is wrapped
  at creation: `{kind: 'untrusted-prose', contentId, text}` — never a bare string in a
  payload that crosses an agent or rendering boundary.
- **The forge NEVER renders it unframed.** Untrusted prose renders inside an escaped,
  visually-marked frame (no markdown execution, no link auto-resolution, no template
  interpolation). A forge page is an injection surface exactly like an agent prompt;
  the same envelope serves both (one shape, G3 again).
- **Gate decisions NEVER read it.** `admitDecision` and every future verdict function is
  a pure function over states and structured fields only — the pure-function-verdict
  contract. No verdict, tier assignment, ranking, or escalation may branch on prose
  content. (Ranking uses structured signals only: verdict class, `direct`, fragility,
  confidence, grades.)
- **Agents consume it framed:** when a KNOT payload is placed in an agent's context, the
  prose fields arrive inside the envelope with an explicit untrusted-content frame, and
  the blind red-team corpus (roadmap 5.4) MUST pass before any auto-resolution tier is
  enabled. The forge inherits that gate: no "auto-resolve" button until the corpus
  passes.

## 4. Integration posture — live inside other forges first

Near-term, Warpline does not compete with forges; it **judges inside them.** The
sequence is dictated by where admissions actually happen today:

1. **Guard as a GitHub Action / Check Run** (roadmap P3 Lane B — the only distribution
   build authorized pre-thaw): the verdict JSON rendered as Check Run annotations on
   PRs. GitHub is the forge; Warpline is the judge. The ≤6-knot-size default and the
   ratified thesis wording in the README are part of this surface's spec.
2. **MCP tools for orchestrators:** propose/verdict/knot-payload/resolve exposed as MCP
   tools so agent teams (Claude Code, Conductor, any A2A orchestrator) call the gate
   directly. The same shapes as §3 — MCP is a transport, not a schema.
3. **Admit webhooks:** a local HTTP/WS emission per admission event (the Platform
   section's WS bus already does this for oracle rows) so external systems — including
   other forges' bots — subscribe to verdict classes without polling.

**The standalone console comes only after admit volume exists.** Concretely: the
Judgment Console's ranked inbox (§2 stage 3) is pointless at zero admissions/week and
misleading below the volume where ranking beats reading. Until then, the console
concept lives as the Platform section (Oracle Divergence Viewer → admit feed), and the
forge lives as annotations inside GitHub.

## 5. Non-goals and the thaw condition

Explicit non-goals — none of these may be built, prototyped, or "spiked" under this
spec's authority:

- **No repo hosting** (no remote fabric service; distribution is v3 §8 V3.5 / M4, frozen).
- **No CI runner** (witnesses attest external runs; Warpline executes nothing).
- **No prose-first issue tracker** (KNOTs are born, not filed; planning items belong to
  Paradigm tasks).
- **No forge-side ACL/org/team model** (permission = scrutiny policy only, §1d).
- **No code-browsing surface** beyond what verdict rendering requires (the Tapestry
  renders judgment history, not a file explorer).
- **No GitHub-API compatibility shim** (we are not a drop-in; the translation table is
  conceptual, not wire-level).
- **No forge-private storage** (G4 — if a feature needs state the fabric can't hold,
  the feature waits for a fabric-schema decision).
- **No auto-resolution UI** of any tier before the blind injection corpus passes (§3d).

**Thaw condition:** `graded-weaves/week > 0` — sustained real usage of the full loop
(admit → seal → grade) on at least one real repo, not a fixture — AND founder blessing
of a successor build-spec. On thaw, the first build is the Judgment Console MVP grown
from the divergence viewer (§2), not the full translation table; each further row of §1
unlocks only when the record it renders exists in real volume.

Until then, this document's only enforcement surface is **Phase-2 review**: any PR
shaping the KNOT payload, claim schema, verdict JSON, or prose envelope is checked
against §3's constraints (G1–G5 + the per-shape rules) the same way M2 branching is
checked against v3 §6's guardrails.

## 6. Open questions (parked, not blocking)

1. **Endorsement wire shape** — flows §2 defines semantics (trust-weighted signature
   over the Offer's stateId); the concrete schema waits for the trust ledger (frozen,
   T-2026-06-24-017 design-only). The forge constraint is only G4: an endorsement is a
   signed event, sidecar-or-strand, never a forge row.
2. **Notification delivery** — §1f defines the predicate model; whether delivery is WS,
   webhook, or digest email is a console-era decision.
3. **Multi-repo / workspace forge** — the Tapestry per fabric is defined; a cross-WARP
   view composes trust across links (GAP-6) and is explicitly out of scope until
   cross-WARP trust composition is designed.
4. **Naming** — "Judgment Console" is a working name (candidates from the design
   language: the Bridge is taken by scrutiny-heat; "the Loupe" was floated). Mika owns
   this at console-build time.
