---
name: class
description: Convene the Classroom — the gated, teacher-led learning term. Agents bring proposed learnings; peers refute them with test-case scenarios; you sign off, and survivors promote to notebooks (or get refined). Use when the user says "class", "hold class", "convene the classroom", "review what the agents learned", "let's do a learning term".
---

# The Classroom — gated term (teacher in the loop)

> STATUS: DRAFT (Classroom MVP wave 2c) — pending founder review of the review-gate UX. Decision TD-2026-06-19-007; spec `docs/specs/classroom.md`.

This is the **gated** Classroom — the *only* place a learning certifies. The model: learnings are **provisional**; the field is the real exam (see `/paradigm:study-hall` for unattended staging and `paradigm doctor` for the repeat-failure-rate). Your job here is not to verify truth — it is to keep the loop honest: refute cheaply, sign off on real work, and let the field correct what slips through.

Pick the arm from the argument (default: walk `review` → `report`). **Step 0 runs first whenever the classroom is cold.**

## Step 0 — cold start: is there a classroom here yet?
BEFORE any arm, check `paradigm_syllabus_list` (or `.paradigm/curriculum/`). If no syllabi exist, do NOT fall through to an empty review — run the **Orientation Term** (the guided cold-start that turns the machinery on experientially):
1. **Offer it as the teacher (Cid), not a wizard.** *"There's no classroom here yet — that's normal, this is a fresh project. Want a 5-minute Orientation Term? One agent, one thing, the team tries to break it, you sign off."*
2. **Pick the student from real signal** — agents actually active in `nominations.jsonl` / the roster, not an alphabetical dump. Enroll ONE.
3. **Seed the curriculum** (gate-zero exempt — hand-authored syllabi are allowed): `paradigm_syllabus_record` (the teacher proposes the SOURCES, the human approves once) + one breaking scenario via `paradigm_scenario_record` (offer a poison-pill template so the human isn't staring at a blank field — this teaches the core doctrine: refutation, not validation).
4. **Stage one candidate** — a scoped `/paradigm:study-hall <agent>` drill against the new syllabus.
5. **Run the gate (THE STAND, below) on that one candidate.** Guide toward `refine` — the most instructive first verdict (it shows the whole engine).
6. **The promise:** *"<agent> now knows '<X> except <Y>.' Certified pending — the FIELD is the real exam. If it breaks in real work, I attribute it back here, revise it down, and bring it to you."* The cold-start is cured, not hidden — the Term Board is the default from now on.

## Arm: `roster` — who's in class
1. Surface roster recommendations from the EXISTING engine — run `paradigm shift` (dry-run / recommendations only). Never auto-apply.
2. Present bench/recruit candidates as *recommendations*; apply only with explicit human approval, and only via `paradigm shift`. Active roster only attends class.

## Arm: `study` — set an agent's curriculum
For the chosen agent:
1. Gather what to drill: the agent's notebook concepts (`paradigm_notebook_search`), relevant scenarios (`paradigm_scenario_list`), and any external sources the teacher approves.
2. Write/refresh the syllabus: `paradigm_syllabus_record({ agent, sources, scope, success_criteria, notebook_target, term_ttl_days, approved_by: <human> })`. The teacher approves **sources once** (a durable curriculum), not facts each term.

## Arm: `review` — THE STAND (the gate, de-anesthetized)
For each staged candidate (study-hall journals, **foraged externals**, or learnings up for re-ratification), run it as attributed turns in a FIXED ORDER — **dissent first**, because concurrence anesthetizes:

1. **The claim — one line.** The proposer states the learning + thin evidence (applied N×, held N×). No more; praise comes last, if at all.
2. **The strongest breaking scenario, FIRST** — from a **cross-lens assessor** (a *different domain* than the learner; same-family peers share blind spots), who MUST author or pull a *breaking* scenario (`paradigm_scenario_record` / `paradigm_scenario_list`) and probe the learning. **No scenario, no assessment** — an assessment with no attached scenario is rejected. The advocate (Jinx) piles on or stands down. Record the outcome on the scenario.
3. **One causal question, with a fork.** Present ONLY the dissent + the breaking scenarios (not "N concurred" — note the suppressed concurrences). Ask one: *does this hold BECAUSE of the rule, or were the cases easy?* — and offer the fork: **rule now, or interrogate an agent first.**
4. **Interrogation (optional, on the record).** The human may `@<agent>` a direct question; the agent answers as a new attributed turn. A proposer that **concedes on the record** is the loop earning its keep — capture it.
5. **Verdict (human):** `refine` (primary) / `promote` / `reject`.
   - `refine` → rewrite as **"X except Y"** (the counterexample becomes an exception — the engine, not a confidence tweak). **Read it back and confirm** before promoting the refined form (provisional), with the breaking scenario linked as the exception's source.
   - `promote` → certify: promote the staged journal entry to the notebook (the existing journal→notebook path) → a `pending` classroom-certification. The field confirms or overturns.
   - `reject` → leave staged / let it decay.
   - A candidate **no one could break** is **"untested, not strong"** — promote-as-provisional or hold for a harder scenario; never a silent pass.

### External (foraged) candidates — extra scrutiny
A candidate with `provenance.source:'external'` (from `/paradigm:forage`) takes the same stand with three changes (TD-2026-06-25-044):
- **Citation FIRST.** Pin the source panel ABOVE the claim — the exact quote, URL, tier, and the forager's "why this might be wrong for us." Judge the *source* before the claim.
- **No benefit of the doubt.** It **cannot** be "held as thin/untested" — strangers earn `refine` or `reject`, and the breaking scenario must target a real `packages/` path.
- **Trust ceiling.** It promotes to **`provisional`**, never silently `certified`. The human MAY certify a strongly-sourced dossier (tier-A or multi-source corroboration) by **explicit ruling** — and even then it stays **field-watched** (a later break overturns it). A conflict with a SETTLED learning requires the human's explicit consent to put it on trial.

## Arm: `report` — close the term
1. `paradigm_classroom_status` → per-agent + global **repeat-failure-rate** (team stronger ⇔ the same learning doesn't break twice). Also visible via `paradigm doctor`.
2. Surface bench/recruit proposals (e.g. an agent with N≥2 terms and no certified delta → bench candidate) — recommendations only, routed through `paradigm shift`.
3. Record a lore report of the term (`paradigm_lore_record`, type `retro`).

## Hard rules
- This is the ONLY certifier. `/paradigm:study-hall` (internal) and `/paradigm:forage` (external/wild) may STAGE but never promote.
- **The context-firewall holds even here:** a foraged `trust:'external'` candidate is adjudicated but never reaches a real session until it survives this gate. Promotion lifts it to `provisional`, not `external`.
- Never auto-apply roster changes — recommend, the human runs `paradigm shift`.
- Peer-pass-rate is a SUSPECT metric, never a success metric. The scoreboard is repeat-failure-rate (outside the loop), not how smoothly class went.
