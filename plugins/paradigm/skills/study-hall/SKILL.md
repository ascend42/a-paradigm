---
name: study-hall
description: Autonomous self-study — each active agent follows its approved curriculum, drills against the scenario bank, and STAGES candidate learnings for the next gated class. Never certifies, never writes notebooks. Safe to run unattended on a schedule. Use when the user says "study hall", "let the agents study", "self-study", "run a study session", or schedules recurring learning.
---

# Study Hall — autonomous staging (no teacher present)

> STATUS: DRAFT (Classroom MVP wave 2c) — pending founder review. Decision TD-2026-06-19-007; spec `docs/specs/classroom.md`.

This is the **unattended** half of the Classroom. Agents follow their *approved* curriculum and stage candidate learnings — but **nothing certifies here**. Because it can only stage (never write notebooks, never promote), it is safe to run often and on a schedule (ride `/loop` or `/schedule`). The gated `/paradigm:class` is the only certifier.

## For each active agent (`all`, or the named one)
1. **Active roster only:** `paradigm_agent_list` → the agents actually on this project.
2. **Load the curriculum:** `paradigm_syllabus_get({ agent })`.
3. **GATE-ZERO — refuse a dead curriculum.** If the syllabus status is `stale`, `broken`, or `expired` (or none exists): **skip this agent**, and record that it needs the teacher (kicks to `/paradigm:class`). Do **not** study against a stale plan. Never edit the syllabus to fix it — that's the gated path.
4. **Drill (current syllabi only):** work the syllabus `sources`; then **probe against the scenario bank** for this agent (`paradigm_scenario_list`) — try to *survive* the `survive` scenarios and *reject* the poison-pills (`expected.must: reject`).
5. **STAGE, don't certify:** record findings as journal entries — `paradigm_journal_record({ agent, trigger: 'pattern_discovered', insight, confidence_after, ... })` with provenance marked external/provisional. Journal entries are candidates; they do **not** enter notebooks until a gated class promotes them. This is the structural guard against self-study self-certifying (the journal-flood trap).

## The report (this is the gate, so make it actionable)
End with a **diff-shaped** report the returning teacher can act on without re-reading:
- Per agent: what was staged (the candidate insight), the scenarios probed and their result (survived / broke / poison-pill caught or missed), and the source it came from.
- A top line: N candidates staged · K agents skipped on gate-zero (stale/expired curriculum) · poison-pill catch summary.
- Point the teacher at `/paradigm:class review` to adjudicate.

## Hard rules (do not violate, especially unattended)
- **Never** promote, never write to notebooks, never call certification. Stage only.
- **Never** modify a syllabus or the roster (`paradigm shift`). A stale syllabus is flagged, not fixed.
- **Never** wander outside the syllabus `sources` — an uncited finding is not stageable.
- A `broken`/`expired` syllabus → skip + report, never run anyway.
