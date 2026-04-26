---
id: N-para-451-welcome
title: Welcome to PARA 451 — Agents Foundations
type: note
author: paradigm
created: '2026-04-26'
updated: '2026-04-26'
tags:
  - course
  - para-451
  - agents
  - welcome
symbols: []
difficulty: beginner
estimatedMinutes: 4
prerequisites:
  - LP-para-101
category: paradigm-core
origin: authored
source: agents-course-phase-a-design.md
---

## Why this course exists

Paradigm's most differentiated feature is its **agent team**. Other AI tooling gives you one model and a chat box. Paradigm gives you a roster of named, persistent identities — each with its own role, its own notebook of learned patterns, and its own moment to step in. Architect designs. Builder implements. Reviewer reviews. Cid runs the briefing. Loid runs the learning loop. Scholar and Sheila pair on research. The team is the product.

Until now, the only place to learn about agents in University was a handful of entries inside PARA 401: Orchestration — an advanced course beginners rarely reach. Worse, those entries pre-date the v6.0.3 partners primitive and the three-layer identity model, so they describe an older version of the team. PARA 451 is the canonical, beginner-accessible introduction; the older PARA 401 agent entries are flagged as v6.1 retirement candidates and will be retired once 451 is broadly adopted.

## What you will learn

By the end of this course you will be able to answer:

- **What is an agent in Paradigm, and how is it different from "the model"?** An agent is a persistent identity with a profile, a notebook, and a role — not a single prompt or a single Claude call.
- **What is an archetype, and how is it different from a nickname or an id?** The three-layer identity model (id / nickname / archetype) is what makes the same agent recognisable across every project, while still letting you call it whatever you want on yours.
- **Who is on the team, and when do you call each one?** A single roster reference page covers all twenty-one currently-active agents — what each one is for, when it gets invoked, and which agents it pairs with.
- **What does it mean for two agents to be "partners"?** The partners primitive (shipped at v6.0.3) is how the framework expresses that some agents work meaningfully better as a unit. Scholar + Sheila is the canonical example.
- **How does orchestration actually run?** Faceted orchestration in Claude Code (true multi-agent, isolated Task contexts) versus sequential roleplay in Cursor and IDEs without Task tool support.

## Prerequisite

You should have completed **PARA 101: Foundations** — the five symbols, `.purpose` files, the basic shape of the `.paradigm/` directory. You do **not** need PARA 201, 301, or 401. The agent system is conceptually approachable, and learning the team early pays off in every project from then on.

## Course shape

PARA 451 is a single ordered learning path: notes interleaved with quizzes, ending in a mastery review. The full course is ~18 entries (about 35 minutes if you skim, 75-90 minutes if you take the quizzes seriously). This first batch of entries covers the foundation: identity, model tiers, and the roster. Subsequent batches add roster management, orchestration modes, the partners primitive deep-dive, and auto-rostering.

## What this course does **not** cover

Phase A — the entries in this course — is intentionally stable. We do not teach Rune's authority modes, the soft-block primitive, the notebook tier-1/tier-2 split, or the cross-project compounding runtime. Those topics are evolving as the v6.1 enforcement model lands, and they live in **PARA 551: Agents in Practice** (the follow-up course). The mastery review at the end of 451 will point you there when you are ready.

> **Coming in v6.1:** PARA 551 launches alongside the v6.1 enforcement-model release. It treats PARA 451 as a hard prerequisite. See `agent-owned-enforcement-plan.md`.

## Where to go from here

Continue to **N-para-451-what-is-an-agent** to start with the conceptual foundation, then move on to **N-para-451-identity-layers**. If you only have ten minutes and you want the team-at-a-glance, jump to **N-para-451-roster-reference** — it is the most-referenced page in the course, and you will come back to it often.
