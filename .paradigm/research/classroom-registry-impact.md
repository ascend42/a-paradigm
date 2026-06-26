# Impact Brief — The Classroom × the nevr.land Registry

> **Task:** T-2026-06-19-004 (sequenced-after-MVP). **Type:** strategic impact brief + registry-schema deltas — **NOT a build.** **Decision basis:** TD-2026-06-19-007 (Classroom), the open-agent-profile "non-portable calibration = the moat" principle, and the cold-start trust ladder (T-2026-06-24-017).
>
> **Authorship note:** scoped for Arky (architecture/schema) + Loid (calibration boundary). Synthesized under a transient model-classifier outage that blocked subagent launches; the two halves are structured to map 1:1 onto an Arky/Loid adversarial review pass, which should still run when infra recovers. Treat the calibration RULES as proposed-for-Loid-ratification.

---

## 0. Why this matters now

The Classroom produces, per agent, exactly the signal a marketplace most wants and most easily abuses: **a track record of whether an agent's certified knowledge survives real use** (`classroom-certifications.jsonl` outcomes + `repeat-failure-rate`). The registry already exposes a per-agent `calibrationScore` on its search surface (`packages/paradigm/src/commands/agent/registry.ts:50-54`). So the question is not *whether* calibration touches the registry — it already does — but **what, precisely, is safe to publish without leaking or laundering the moat.**

The whole brief turns on one distinction:

> **The prior SHAPE is portable. The trust NUMBER is not.** A notebook-hash's *population* outcome-distribution can inform where a fresh install *starts*; the *local* repeat-failure-rate an agent earns on YOUR project is the moat and never leaves.

---

## A. Architecture half (Arky's lane) — schema + seams

### A1. Should cert-survival history join the published trust profile? — Yes, as a *prior*, never as a *local number*

Anchor on the existing `calibrationScore` field but stop treating it as one opaque scalar. Propose a **contracts-only** `TrustProfile` shape in `registry-types.ts` (the documented "forward-compat, no live consumer" layer — `registry-types.ts:5`), published as a registry-AGGREGATED figure, not a per-install snapshot:

```
// registry-types.ts (contracts-only; no runtime dependency)
interface CalibrationPrior {            // population-level, registry-aggregated
  notebookHash: string;                 // identity = hash(training/notebook), not agent id
  sampleSize: number;                   // # of projects/terms in the population (0 ⇒ omit the prior)
  survivalShape: {                      // a DISTRIBUTION, not a point trust number
    survived: number; overturned: number; pending: number;
  };
  conceptCoverage?: string[];           // domains the population has been exercised in
  asOf: string;                         // ISO; priors decay / must be refreshed
}

interface TrustProfile {
  calibrationPrior?: CalibrationPrior;  // PRIOR-ONLY (see Loid §B1)
  publishedScenarios?: ScenarioRef[];   // see A2
  // NOTE: deliberately NO local repeat-failure-rate, NO per-project cert rows.
}
```

Key architectural decisions:
- **Identity is the notebook-hash, not the agent id.** Population calibration aggregates over everyone running the same training/notebook fingerprint (consistent with the three-layer identity model and the cold-start archetype-prior). The agent *id*/nickname is cosmetic; the *hash* is what a prior attaches to.
- **`survivalShape` is a distribution, not a score.** Publishing `{survived, overturned, pending}` counts lets the consumer compute their own prior and see the `sampleSize` honestly — a single 0–1 `calibrationScore` invites exactly the "green that lies" the Classroom exists to kill. (Recommend the rendered `calibrationScore` become a *derived* display of `survivalShape`, gated on `sampleSize ≥ N`.)
- **`asOf` + decay.** A prior with no refresh is stale; the registry should age it out, mirroring the Classroom's own "silence is signal" decay.

### A2. Cross-project scenario-propagation seam

Scenarios (`SC-*`, `.paradigm/curriculum/scenarios/*.scenario`) are the most portable Classroom artifact — a breaking test-case is *knowledge*, not trust. Minimal forward-compat contract:

```
interface ScenarioRef {
  id: string;                 // stable SC- id
  origin: 'authored' | 'poison-pill';
  expected: 'survive' | 'reject';
  probeConcepts: string[];    // what claims it probes (NOT the local learning_ref)
  sourceHash?: string;        // notebook-hash that authored it, for attribution
  // intentionally NO local learning_ref / no project paths / no agent trust data
}
```

- A registry **`/scenarios` channel** (sibling to `/agents`), publishable alongside an agent or standalone. Keyed by `id`; de-duped by `(probeConcepts, expected)` content-hash so the same breaking case authored on two projects collapses to one canonical scenario with two attributions.
- **Rides alongside publish** as `TrustProfile.publishedScenarios[]` — installing an agent can optionally pull its scenario pack so a fresh project can immediately probe the same claims its peers did.
- This is the channel that makes "peers on OTHER projects probe a scenario" real — but see Loid §B3 for what an outcome on project B is allowed to *mean*.

### A3. Portability boundary mapped onto the existing publish contract

The publish contract already has the right primitives (`prepareForPublish`: `scope` + `publishable`; `provenance.trust`). Map Classroom artifacts onto them:

| Artifact | Publish path | Rule |
|---|---|---|
| Refined `"X except Y"` notebook entry | `scope: generalizable`, `publishable: true`, `trust: certified` | Publishable — it's *knowledge*. The exception makes it MORE portable, not less. |
| Notebook entry `trust: external` (foraged) | context-excluded; publish only post-certification | Stays out until it climbs the ladder. |
| Certification *outcomes* (survived/overturned) | aggregate → `CalibrationPrior.survivalShape` | Only as population counts; never per-project rows. |
| `repeat-failure-rate` (local) | **never published** | The moat (Loid §B1). |
| `field-failures.jsonl` rows | **never published** | Project-local; may name files/symbols/orchestrations. |
| Scenarios `SC-*` | `/scenarios` channel (A2) | Portable knowledge, attribution by hash. |

### A4. Trust-contract / partner-bundle implications

- **Install-time:** a published `calibrationPrior` informs the *prompt*, not the *grant*. Install should surface "population calibrates at X over N projects — you start at the floor and earn local trust" (Loid §B4). The partner/bundle primitives (`PartnerBundle`, `ReciprocalInstallMeta`) are unaffected structurally, but a bundle MAY surface a *combined* prior shape.
- **Reciprocal install** semantics don't change; a trust profile is descriptive metadata, not a gate.

**Open questions for Loid:** (1) the exact `sampleSize` floor below which a prior is suppressed; (2) whether `pending` counts belong in the published shape at all (they're un-resolved — arguably noise); (3) whether a `CalibrationPrior` may ever be auto-refreshed from installs or must be an explicit publish.

---

## B. Calibration half (Loid's lane) — the rules

### B1. The RULE that resolves the `calibrationScore`-vs-moat contradiction

> **Publish the prior SHAPE of a notebook-hash's POPULATION outcomes; never publish a local trust number. The number is earned per-project and confirmed by local evidence.**

The existing `calibrationScore` is not wrong to exist — it is wrong to read as *this agent is trustworthy*. It is legitimate only as **a population prior's summary** (derived from `survivalShape`, gated on sample size). The moat is intact because: the *distribution over many projects* tells you what to *expect*; the *number you can act on* only exists after the agent has survived YOUR field. Importing the prior imports a start-point, not standing.

### B2. Portable / prior-only / non-portable classification

| Artifact | Class | Justification |
|---|---|---|
| Refined `"X except Y"` notebook entry | **PORTABLE** | Knowledge generalizes; the exception is the sharpening. Publishable as generalizable. |
| Scenario `SC-*` | **PORTABLE** | A breaking test-case is knowledge; it makes the whole network sharper. (Strongest case for propagation.) |
| Certification *outcome distribution* (survived/overturned counts, aggregated) | **PRIOR-ONLY** | Informs a start-point shape; never a trust number. Must be population-aggregated, never per-project. |
| `repeat-failure-rate` (the local number) | **NON-PORTABLE (the moat)** | This is the calibration. It is earned on your fabric and means nothing transplanted. |
| `field-failures.jsonl` rows | **NON-PORTABLE** | Project-local, often name internal files/symbols; leaking them leaks both moat and IP. |
| `pending` certs | **NON-PORTABLE / omit** | Un-resolved = no information; publishing them fakes a denominator (the null-board sin). |

### B3. Cross-project scenario propagation — what an outcome is allowed to mean

When a peer on project B probes a published scenario and it survives/breaks:
- **It is evidence for the POPULATION PRIOR of the notebook-hash, never for project A's trust number.** Project A's number only moves on project A's own field. Otherwise you have **trust-laundering** — buy standing on your hard project by spinning up an easy one.
- Concretely: scenario outcomes on other projects feed `CalibrationPrior.survivalShape` (with that project's hash-instance as one sample), and *that* is what a third party reads as "this knowledge tends to hold." No cross-project write ever lands on a local `repeat-failure-rate`.

### B4. Cold-start / install-time honest promise

Seats directly into the cold-start trust ladder (T-2026-06-24-017):
- **Archetype-prior rung:** at install, the published `calibrationPrior` sets the agent's *expected* shape — but local trust starts at the **floor** and is earned by local field survival. "Import the prior's start-point, never the number."
- **Honest install-time string:** *"This agent's population calibrates at ~X% survival over N projects. On your project it starts unproven and earns trust by surviving your field."* — never *"trusted: X%."*
- This is the **delegated-seed / archetype-prior / shadow-earned** ladder's middle rung made concrete by a real published shape; the floor (fragility) and shadow-earning rungs still apply unchanged.

### Hard calibration rulings (for ratification)
1. **Never publish a local trust number** (`repeat-failure-rate`); publish only population `survivalShape` + `sampleSize`.
2. **Prior ≠ trust.** An imported prior sets a *start-point shape*, never standing; local evidence is the only thing that moves a local number.
3. **No cross-project number writes** — scenario outcomes elsewhere feed the population prior only (anti-laundering).
4. **Omit `pending`/null** from any published figure — a fabricated denominator is the null-board sin exported to the marketplace.
5. **Decay published priors** (`asOf`); a stale prior is suppressed, mirroring "silence is signal."

---

## C. Recommendations & sequencing

1. **Land the contracts now, no behavior.** Add `CalibrationPrior`, `TrustProfile`, `ScenarioRef` to `registry-types.ts` as contracts-only shapes (matching the existing "no live consumer" posture). Zero runtime coupling. *This is the only buildable step, and it's optional/forward-compat.*
2. **Do NOT publish any calibration figure until the loop resolves.** Today `repeat-failure-rate` is null (thin `orchestrationId` attribution); any number now is fabricated. **Blocker:** wire attribution + accumulate resolved certs across ≥ a few projects before a population prior is meaningful. This brief's rules are what *prevent* shipping a fake number early.
3. **Scenarios are the first thing worth propagating** — they're pure portable knowledge with no moat risk, and they make the network sharper immediately. If anything ships first, ship the `/scenarios` channel.
4. **Re-run Arky + Loid as an adversarial review** of this synthesis once the classifier is back — specifically to attack the `survivalShape`-not-score decision and the anti-laundering rule.

## D. What this does NOT change
- The local Classroom loop is untouched — this is all about the *publish/install seam*.
- No publish behavior ships from this brief; `paradigm agent publish` stays a stub until the registry MVP.
- The moat is *strengthened*, not eroded: by naming exactly what's portable (knowledge + a prior shape) we make it safe to be generous with knowledge while keeping trust strictly local.
