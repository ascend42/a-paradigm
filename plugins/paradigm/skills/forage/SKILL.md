---
name: forage
description: Send an agent on an EXPEDITION into the wild — Reddit, Medium, engineering blogs, Anthropic docs — to grow its knowledge around a topic. Returns CITED candidate learnings (never certifies), staged at the floor trust tier for the gated class to adjudicate. Use when the user says "forage", "send an expedition", "go research X", "have <agent> learn about Y in the wild", or schedules a breadth scout.
---

# Forage — expeditions into the wild (external knowledge)

> STATUS: DRAFT (Classroom MVP — Expeditions). Decisions TD-2026-06-19-007 (Classroom), TD-2026-06-25-044 (Expeditions trust/trigger). Spec `docs/specs/classroom-experience.md`.

This is the **outward-facing** half of study hall. An agent goes to the open web to widen what it knows — and comes back with **citations, not convictions**. The web is a *candidate generator*, never an authority. Foraged knowledge is the **weakest trust tier** and takes the **longest path** through the loop: it enters firewalled, must be refuted against OUR code, faces the gate, and only the field can certify it. **Nothing certifies here** — the gated `/paradigm:class` is the only certifier.

> PREREQUISITE: the gate must be **bootstrapped** (a real syllabus + scenario bank exist). Pointing a scrape firehose at a cold gate is a noisier no-op. If `.paradigm/curriculum/` is empty, run `/paradigm:class study` first.

## Axes
- **`--axis depth`** (default; Matt-directed): a DEEP dive on one named question (e.g. *"new paradigms for organizing TypeScript projects"*). Few sturdy candidates (2–4), richer `sourceSet`, a "where the debate stands / who disagrees" synthesis.
- **`--axis breadth`** (scheduled-scoutable, **capped**): a WIDE scout to widen an area (often from a Roster amber gap). Many shallow leads (8–12); aggressive distillation; the overflow becomes **syllabus open-questions**, not staged learnings.

## The expedition (owning agent + topic)
1. **Scope it.** owning agent · topic · axis · source allowlist (default: Reddit · Medium · articles · Anthropic docs). **Scholar is the forager-of-record** (citation discipline is his competence); the **owning agent owns** the resulting candidates.
2. **Scout — run `deep-research`.** Drive the `deep-research` skill on the topic (fan-out WebSearch → WebFetch the strongest sources → adversarial cross-source verify → cited report). The report is an **intermediate artifact**, never the deliverable.
3. **Distill (the anti-dump step).** Reduce the report to at most **3–5** (depth) candidate learnings. Each = ONE falsifiable claim + `sourceSet:[urls]` + a **required** one-line *"why this might be wrong for US"* (cite-or-flag discipline applied to opinion). A report that yields zero falsifiable claims yields **zero candidates** — silence is a valid result.
4. **Tier + cap the confidence (ENFORCED, not convention).** Per source tier: **A** (official / maintainer docs) ≤0.6 · **B** (named practitioner) ≤0.45 · **C** (anonymous forum) ≤0.3. A **tier-C** claim needs **cross-tier corroboration** (a tier-A/B confirm) to stage at all — else "single-source opinion", dropped. Source prestige sets the confidence *ceiling*, **never** the trust *tier* (everything enters `external`).
5. **Dedup vs the agent's notebook** (`paradigm_notebook_search` over concepts + snippet):
   - **NOVEL** → stage fresh.
   - **DUPLICATE** → drop; note "external corroboration" on the existing entry's `sourceSet`; no new card.
   - **CONFLICTS** with an existing entry → stage as a **CHALLENGER** (`parentId` set, `lineageType:'capture'`) so the gate adjudicates head-to-head. A conflict with a **SETTLED** learning requires the human's **explicit consent** to put settled curriculum on trial — flag it, do **not** auto-stage the challenge (TD-2026-06-25-044).
6. **Intake evidence-gate — "no scenario, no assessment," applied HERE.** Before a candidate may stage, it must be paired with a **breaking scenario authored against OUR repo** (`paradigm_scenario_record`): grep/read the actual code to find where this "best practice" collides with how we already build. A candidate with no local-collision attempt is **not a candidate** — it stays in **Field Notes** (`.paradigm/curriculum/expeditions/E-<id>.jsonl`), un-stageable.
7. **STAGE at the floor (never certify).** `paradigm_journal_record({ agent, trigger: 'pattern_discovered', insight, confidence_after, provenance: { source: 'external', trust: 'external', sourceSet: [urls] }, tags: ['expedition', 'source:external', 'cite:<host>'] })`. Candidates land in the **same Docket** the gated review consumes. They **never** touch notebooks. Also append the full haul to `.paradigm/curriculum/expeditions/E-<id>.jsonl`.

## The report
- The commission (agent · topic · axis), **sources surveyed** (URL + tier), candidates staged with their **citations** + "why wrong for us," and what was **held in Field Notes** (no codebase scenario) or **dropped** (uncited / single-source).
- Top line: `N candidates staged · M sources · K held in Field Notes · 0 certified (the field hasn't ruled yet)`. Point the teacher at `/paradigm:class review`.

## Hard rules (the firewall — do not violate)
- **`trust:'external'` is a context-firewall.** A foraged candidate MUST NOT reach a real session before it survives the gate. Never promote, never write a notebook, never certify here. *(Release-blocking invariant: the context composer pulls only `trust != 'external'` notebook entries, never staged journal candidates.)*
- **Cite or drop.** Every claim traces to ≥1 URL; an uncited foraged claim is unstageable. Tier-C needs cross-tier corroboration.
- **No scenario against OUR code → Field Notes, not the Docket.** Strangers don't get the benefit of the doubt — an external candidate that reaches the gate **cannot** be "held as thin/untested"; it earns Refine or Reject.
- **Provenance is permanent.** `source:'external'` rides the entry forever — so when it breaks, the Rap Sheet names the source on the hook.
- **Never challenge a SETTLED learning without the human's consent.**
- **Confidence caps are enforced in the runner, per tier** — the wild can't self-assert.
- **Respect the per-term external-candidate cap** (breadth scouts especially) so foraging can't out-shout homegrown learnings.
- **A strongly-sourced dossier may be CERTIFIED at the gate by the human** (tier-A or multi-source corroboration, explicit ruling) — but that is the teacher's call in `/paradigm:class`, never here, and it stays field-watched (TD-2026-06-25-044).
