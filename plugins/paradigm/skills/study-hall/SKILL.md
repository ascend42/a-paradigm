---
name: study-hall
description: Autonomous self-study — each active agent follows its approved curriculum, drills against the scenario bank, and STAGES candidate learnings for the next gated class. Never certifies, never writes notebooks; drills never count as evidence. Nothing schedules it by default: it runs when the human starts it, and the human may choose to schedule it. Use when the user says "study hall", "let the agents study", "self-study", "run a study session", or schedules recurring learning.
---

# Study Hall — autonomous staging (no teacher present)

> STATUS: DRAFT (Classroom MVP wave 2c) — pending founder review. Decision TD-2026-06-19-007; spec `docs/specs/classroom.md`.

This is the **self-study** half of the Classroom. Agents follow their *approved* curriculum and stage candidate learnings, but **nothing certifies here** and drills never count as evidence. It spends model tokens, so **nothing schedules it by default**: it runs when the human starts it. Because it can only stage (never write notebooks, never promote), the human may choose to schedule it (`/loop` or `/schedule`); that is their call, never a default. The gated `/paradigm:class` is the only certifier.

## For each active agent (`all`, or the named one)
1. **Active roster only:** `paradigm_agent` (op `list`) → the agents actually on this project.
2. **Load the curriculum:** `paradigm_classroom({op:'syllabus_get', agent })`.
3. **GATE-ZERO — refuse a dead curriculum.** If the syllabus status is `stale`, `broken`, or `expired` (or none exists): **skip this agent**, and record that it needs the teacher (kicks to `/paradigm:class`). Do **not** study against a stale plan. Never edit the syllabus to fix it — that's the gated path.
4. **Drill (current syllabi only):** work the syllabus `sources`; then **probe against the scenario bank** for this agent (`paradigm_classroom` (op `scenario_list`)) — try to *survive* the `survive` scenarios and *reject* the poison-pills (`expected.must: reject`). Record each drill with `paradigm_classroom({op:'scenario_run', scenarioId, entryId: <the probe's learning_ref for this agent>, assessor: <the agent>, result, human_confirmed: false })`. Drills never count as evidence, and a poison pill an agent drilled can no longer probe that agent's cert.
5. **STAGE, don't certify:** record findings as journal entries — `paradigm_journal({op:'record', agent, trigger: 'pattern_discovered', insight, confidence_after, ... })` with provenance marked external/provisional. Journal entries are candidates; they do **not** enter notebooks until a gated class promotes them. This is the structural guard against self-study self-certifying (the journal-flood trap).

## The report (this is the gate, so make it actionable)
End with a **diff-shaped** report the returning teacher can act on without re-reading:
- Per agent: what was staged (the candidate insight), the scenarios probed and their result (survived / broke / poison-pill caught or missed), and the source it came from.
- Per candidate: its home, `repo` (committed, shared) or `user` (just the human), and that it is only inferred (`home_source: inferred`). Study hall never picks a home for the human; the teacher can flip it at `/paradigm:class` sign-off.
- A top line: N candidates staged · K agents skipped on gate-zero (stale/expired curriculum) · poison-pill catch summary.
- Point the teacher at `/paradigm:class review` to adjudicate.

## Hard rules (do not violate, especially when scheduled)
- **Never** promote, never write to notebooks, never call certification. Stage only.
- **Never** pass `human_confirmed: true` to `scenario_run`. No human confirmed a drill.
- **Never** modify a syllabus or the roster (`paradigm shift`). A stale syllabus is flagged, not fixed.
- **Never** wander outside the syllabus `sources` — an uncited finding is not stageable.
- A `broken`/`expired` syllabus → skip + report, never run anyway.
