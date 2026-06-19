# The Classroom — Agent Learning Model (spec)

> Decision: **TD-2026-06-19-007** · Companion lore: L-2026-06-19-ascend-053642-110
> Architecture authors: Loid (forge, learning-loop core) + Cid (captain, artifacts/process)
> Status: **architecture locked, pre-build.** Loid owns the learning-loop core; Cid owns syllabus/roster/process.

## The model

Learnings are **provisional by default**. Certification is not a truth-gate — every learning gets broken in the field. The engine is the **failure → reinforcement flow**, not the entry exam.

- **Two skills.** `/paradigm:class` (gated — the *only* certifier; teacher + peer-refutation) and `/paradigm:study-hall` (autonomous — **stages** candidates, never certifies).
- **The exam is peer REFUTATION**, not a quiz: an assessor must author a *breaking* test-case scenario ("no scenario, no assessment") + the human signs off on real work quality.
- **The flow:** enter cheap → break in the field → the break becomes a reusable test-case scenario → the learning is **revised as refinement** ("X except Y", not a decrement) → propagate → measured by **repeat-failure-rate** (team stronger ⇔ the same learning doesn't break twice). Unused learnings **decay** (silence is signal).
- **Falsifiability is mandatory:** a ground-truth metric *outside* the loop (human-rework / repeat-failure); a standing **poison-pill** control (planted known-wrongs; peer-catch-rate = honesty meter); a falsification clause with **no "they didn't adapt" scapegoat** (frozen-Loid control); a **de-anesthetized** human gate (show dissent + scenarios, cap findings, check the causal claim).
- **Second-order adaptation** (Loid/Cid tune the process) acts on **outcome signals only** (override-on-certified, field-survival) — never process proxies (peer-pass-rate is a *suspect* metric); anti-thrash = persisted ≥2-term trend, recommend-through-gated-path never auto-write; Loid's own adaptation output is excluded from the prior she reads next run.

## The keystone insight (de-risk)

**Attribution is half-built.** The apply-side already exists: `notebook-refs.jsonl` (`session-work-log.ts:79-87`) records which entries were injected into which agent; `incrementApplied` bumps `appliedCount` (`orchestration.ts:1284-1298`). The gap is the **fail-side** + making `orchestrationId` the **required join key** linking application-receipt ↔ break ↔ outcome. Build the fail-side reducer and the loop becomes real, not asserted.

## Data model

REUSE+EXTEND:
- `NotebookEntry` (`notebooks.ts:18-65`): add `appliedAndBrokeCount` (mirror of `appliedCount`), `refinement?: {base, exceptions:[{when,then,sourceFailureId}], revisedAt}`, `lastAppliedAt`; `lineageType` gains `'refine'`; `confidence` revises down via the existing latest-wins / no-ratchet path (`nomination-engine.ts:1021-1023`).
- `notebook-refs.jsonl` (`session-work-log.ts:79-87`): make `orchestrationId` **required**; this row is the application receipt.
- `NotebookProvenance.source` (`notebooks.ts:84`): add `'external'` + optional `trust: 'certified'|'provisional'|'external'` + `sourceSet?`. Additive, backward-compatible.

NET-NEW (all append-only, mirror `appendPromotionDecision` `nomination-engine.ts:308`):
- `.paradigm/events/field-failures.jsonl` — `{ts, orchestrationId, agent, signal, severity, attributedEntryIds[], symbols[], detail, scenarioId?, sourceEvent}`; `signal ∈ {test-fail, reviewer-reject, human-override, decision-reopened, decision-diverged}`.
- `.paradigm/curriculum/scenarios/SC-*.scenario` (+ index) — the scenario bank: `{id, scenario, probes:[{agent, learning_ref, claim}], origin: field-failure|poison-pill|authored, origin_ref, expected:{must: survive|reject}, outcome_history[], repeat_failures, status}`.
- `.paradigm/curriculum/<agent>.syllabus` (+ index) — per-agent curriculum: `{id, agent, version, sources:[{kind: notebook|scenario|external, ref, trust}], scope, success_criteria:[{probe, must}], notebook_target: global|local, approved_by, approved_at, term_ttl_days, status: current|stale|broken|expired, last_ratified}`. Mirrors the protocol machinery (`protocol-loader.ts` recordProtocol/loadProtocol/validateProtocol/index health).
- `.paradigm/events/classroom-certifications.jsonl` — `{ts, term, agent, learning_ref, syllabus_version, scenario_ids[], dissent[], human_verdict, outcome: pending|survived|overturned, overturnedByFailureId?, field_survival, poison_pill_caught/total}`; the `outcome` column is **later-bound** by the failure loop — that's the falsifier.

## The flow + seams

```
ENTRY    study-hall stages → gated class certifies
         seam: autoPromoteJournalEntries (nomination-engine.ts:952) writes the entry +
               a classroom-certifications row (outcome:pending).
APPLY    orchestrator injects entry into prompt
         seam: recordNotebookReference + incrementApplied (orchestration.ts:1284-1298)
               ALREADY FIRES — thread orchestrationId through. Application is auto-recorded;
               the agent does NOT self-declare (the key simplification).
BREAK    a field signal fires (detection table below)
         seam: a single REDUCER (NET-NEW) runs at postflight, joins each break to
               notebook-refs BY orchestrationId → writes field-failures.jsonl +
               bumps appliedAndBrokeCount on each attributed entry.
REVISE   attributed break → reviseDown + refinement ("X except Y")
SCENARIO break → scenario-bank row (origin: field-failure) — the field generates the
         scenario same-family peers structurally could not (answers the kill shot).
CERTIFY-OUT  reducer back-binds the cert row to outcome:overturned.
DECAY    silent entries lose confidence; certs with no break flip to survived.
```

Detection (REUSE existing instruments): reviewer-reject → verdict `dismissed`/`revised` (`ambient.ts:500-504`); human-override → `human_feedback` + `overrides.jsonl`; decision-reopened/diverged → `DecisionDivergenceJournal.swift` (cockpit domain `~/.paradigm/conductor/decisions/*.jsonl` — reducer reads cross-domain); test-fail → NET-NEW bridge.

Down-revision guard (anti-gaming): a failure only counts if `attributedEntryIds` came from a **real notebook-refs join** — you cannot attribute a break to an entry that was never loaded. Dedupe one revision per `(entryId, orchestrationId)`. Refinements are themselves provisional (re-enter the loop).

## Skill surface

`/paradigm:class` (gated) arms: `roster` (calls existing `detectProjectType`/`getRecommendations`; recommendations only → routed through `paradigm shift`, never `saveProjectRoster`), `study` (build/edit a candidate `.syllabus`), `review` (the de-anesthetized gate: peer-refutation with mandatory attached scenarios; surface shows **dissent first + breaking scenarios**, caps findings/review, asks one causal question per learning; `promote` writes the syllabus + cert, `refine` rewrites "X except Y"), `report` (term close-out metrics + bench/recruit proposals). Reuse "promote", not "certify"; no separate exam arm.

`/paradigm:study-hall` (autonomous): per active agent, `loadLatestSyllabus` → **gate-zero** (a `stale`/`broken`/`expired` syllabus refuses to run unattended and kicks to gated). For `current` syllabi, drill the curriculum vs the scenario bank → write **candidates** (`source: 'external'`) to a staging area, never to notebooks. Cannot promote.

Cadence: the autonomous term rides the harness `/loop` or `/schedule` skill — **no new paradigm cron**. The assessment **process itself** is a `process.syllabus` (`agent: classroom`) that gets versioned + re-ratified through gated class when stale ("the examiner is graded too").

## Phase plan

**MVP (the loop turns once on the cheapest signal):** thread `orchestrationId`; `field-failures.jsonl` + the reducer wired to ONE signal (reviewer/human verdict); `appliedAndBrokeCount`; `reviseDown` confidence-only via latest-wins; `classroom-certifications.jsonl` (pending→overturned back-bind); `paradigm doctor` shows repeat-failure-rate; `.syllabus` + `validateSyllabus` gate-zero; `/paradigm:class review`+`study` and `/paradigm:study-hall` (stage-only); scenario bank with field-failure + poison-pill; provenance `'external'`.

**Phase 2:** the refinement engine ("X except Y"); add divergence/override/test-fail signals (incl. cross-domain read); scenario-from-break converter; decay pass.

**Phase 3 (falsifiability hardening):** standing poison-pill control + peer-catch-rate; Loid-exclusion filter at the prior read; doctor alarms + guard-class block on rising repeat-failure-rate.

**Deferred:** `class roster`+`report` bench/recruit (needs ≥2 terms of data); `process.syllabus` self-grading; outside-the-loop `field_survival` backfill automation; cross-project scenario propagation (needs the registry channel — nevr.land); auto-authored refinements (gate behind a proven-honest cohort).

**Scope flagged by the decision, sequenced after the MVP proves the model:** update Paradigm University with the new agent-learning handling (agent-facing + human docs); assess nevr.land impact (the field-feedback/reinforcement history *is* calibration → strengthens the non-portable-calibration moat).

## Open questions (need a call)

1. **`orchestrationId` provenance** (load-bearing): does a stable id exist end-to-end (injection → settle), or must we mint one at orchestrate-inline entry and thread it? The attribution join is worthless without a reliable key.
2. **Cross-domain read:** the divergence journal lives in the cockpit domain, not `.paradigm/events/`. Reducer reaches across, or Conductor mirrors into `.paradigm/events/`? (framework vs cockpit ownership.)
3. **Peer-assessor selection** (load-bearing for anti-collusion): adjacency by the `partners` field, a standing adversary (Jinx), human pick in `review`, or a mix? At least one assessor must be a *different lens* than the learner.
4. **Penalty function:** flat vs severity-weighted vs Bayesian on the applied/broke ratio (MVP flat; ratio is the principled form).
5. **Staging vs context-leak:** study-hall candidates in a staging dir, or in notebooks with `trust: external` hard-excluded from context? (Must not leak un-promoted candidates into prompts.)
6. **Gate-zero severity:** advisory `report` finding vs a `paradigm_propose_block severity:guard` soft-block.
7. **`certifiedBy`:** a peer agent, a quorum, or the gate-rule — determines what an overturned cert can penalize.
8. **Decay constant N** & **term-id scheme** — set from data; bootstrap the first `process.syllabus` by hand (exempt from gate-zero until term 2).
