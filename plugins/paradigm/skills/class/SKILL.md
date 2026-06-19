---
name: class
description: Convene the Classroom — the gated, teacher-led learning term. Agents bring proposed learnings; peers refute them with test-case scenarios; you sign off, and survivors promote to notebooks (or get refined). Use when the user says "class", "hold class", "convene the classroom", "review what the agents learned", "let's do a learning term".
argument-hint: "[roster|study|review|report] [agent-id]"
---

# The Classroom — gated term (teacher in the loop)

> STATUS: DRAFT (Classroom MVP wave 2c) — pending founder review of the review-gate UX. Decision TD-2026-06-19-007; spec `docs/specs/classroom.md`.

This is the **gated** Classroom — the *only* place a learning certifies. The model: learnings are **provisional**; the field is the real exam (see `/paradigm:study-hall` for unattended staging and `paradigm doctor` for the repeat-failure-rate). Your job here is not to verify truth — it is to keep the loop honest: refute cheaply, sign off on real work, and let the field correct what slips through.

Pick the arm from the argument (default: walk `review` → `report`).

## Arm: `roster` — who's in class
1. Surface roster recommendations from the EXISTING engine — run `paradigm shift` (dry-run / recommendations only). Never auto-apply.
2. Present bench/recruit candidates as *recommendations*; apply only with explicit human approval, and only via `paradigm shift`. Active roster only attends class.

## Arm: `study` — set an agent's curriculum
For the chosen agent:
1. Gather what to drill: the agent's notebook concepts (`paradigm_notebook_search`), relevant scenarios (`paradigm_scenario_list`), and any external sources the teacher approves.
2. Write/refresh the syllabus: `paradigm_syllabus_record({ agent, sources, scope, success_criteria, notebook_target, term_ttl_days, approved_by: <human> })`. The teacher approves **sources once** (a durable curriculum), not facts each term.

## Arm: `review` — THE gate (de-anesthetized)
For each staged candidate (journal entries from study-hall, or learnings up for re-ratification):

1. **Assemble assessors — diversity is structural.** At least one assessor must be a *different lens* than the learner's domain, plus the advocate (Jinx) as a standing adversary. Same-family peers share blind spots; the diverse lens + the field (below) are what catch them.
2. **Refutation, not validation — "no scenario, no assessment."** Each assessor MUST author or pull a *breaking* test-case scenario (`paradigm_scenario_record` / `paradigm_scenario_list`) and probe the learning. An assessment with no attached scenario is rejected. Record the outcome on the scenario.
3. **Show the human the dissent first.** Present, per learning: the **dissent and the breaking scenarios** (not "3 peers concurred" — concurrence anesthetizes scrutiny). Cap findings shown (≈3); note suppressed ones. Then ask **one causal question**: *does this hold BECAUSE of the rule, or were the test cases easy?*
4. **Verdict (human):** `promote` / `refine` / `reject`.
   - `promote` → certify: promote the staged journal entry to the notebook (the existing journal→notebook promotion path), which writes a `pending` classroom-certification. The field will later confirm or overturn it.
   - `refine` → rewrite the learning as **"X except Y"** (the counterexample becomes an exception) — this is the engine, not a confidence tweak.
   - `reject` → leave it staged / let it decay.

## Arm: `report` — close the term
1. `paradigm_classroom_status` → per-agent + global **repeat-failure-rate** (team stronger ⇔ the same learning doesn't break twice). Also visible via `paradigm doctor`.
2. Surface bench/recruit proposals (e.g. an agent with N≥2 terms and no certified delta → bench candidate) — recommendations only, routed through `paradigm shift`.
3. Record a lore report of the term (`paradigm_lore_record`, type `retro`).

## Hard rules
- This is the ONLY certifier. `/paradigm:study-hall` may stage but never promote.
- Never auto-apply roster changes — recommend, the human runs `paradigm shift`.
- Peer-pass-rate is a SUSPECT metric, never a success metric. The scoreboard is repeat-failure-rate (outside the loop), not how smoothly class went.
