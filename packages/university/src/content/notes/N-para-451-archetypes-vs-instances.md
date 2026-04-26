---
id: N-para-451-archetypes-vs-instances
title: Archetypes vs Instances — Role Patterns and the Agents That Fill Them
type: note
author: paradigm
created: '2026-04-26'
updated: '2026-04-26'
tags:
  - course
  - para-451
  - archetype
  - instance
  - taxonomy
symbols: []
difficulty: beginner
estimatedMinutes: 5
prerequisites:
  - N-para-451-identity-layers
category: paradigm-core
origin: authored
source: agents-course-phase-a-design.md
---

## One archetype, many instances

The previous entry established that **archetype** is one of the three identity layers — the role pattern an agent fills. This entry zooms into the distinction the framework leans on most heavily once you have more than one project: the difference between an **archetype** (a role-type, the shape of a job) and an **instance** (a specific agent on a specific roster, a particular hire who fills that shape).

If you have written code, the analogy is almost on-the-nose: an archetype is a class; an instance is a value of that class. One class can have many values. One archetype can have many agents.

## The two columns side by side

| | Archetype | Instance |
|---|-----------|----------|
| **What it is** | A role-type. The *shape* of an agent's job. | A specific rostered agent. A *particular* agent fulfilling that shape. |
| **Examples** | `compliance`, `architect`, `intelligence-officer`, `educator`, `captain` | Rune (id `compliance`), Architect (id `architect`), Loid (id `forge`), Sheila (id `educator`), Cid (id `cid`) |
| **Granularity** | A class — same archetype across every Paradigm install. | A value — one specific agent per id, per installed profile. |
| **Travels how** | Conceptually shared across the ecosystem. Two projects' "compliance archetype" agents are filling the same role even if their names differ. | Pointed at by id. Two projects can both roster `compliance` and they are **the same instance** at the profile level — same `~/.paradigm/agents/compliance.agent` file. |
| **Mutable?** | Conceptually fixed. An archetype is *what an agent is*; you cannot rename a role-type and have the rest of the framework still reason about it. | The instance's id is fixed; its nickname is mutable per project; its roster status (active / benched) is mutable per project. |
| **CLI surface today** | None first-class — declared informally in the agent's profile narrative. | Every CLI command that takes an `<id>` is operating on an instance. |

## Worked example: the compliance archetype

Take the **compliance archetype** — the role-type that handles symbol coverage and planning. On the canonical roster, the instance filling that role is **Rune** (id `compliance`).

- The **archetype** says: "this role looks at symbol planning, runs pre-implementation plans, files post-implementation reports, and never writes source." That definition is stable across every Paradigm install — the role exists.
- The **instance** is Rune. Rune is the agent currently filling that role on the canonical first-party roster. Rune's profile sits at `~/.paradigm/agents/compliance.agent`. Rune has a notebook. Rune is benched or active per project.

Now imagine — purely hypothetically — that someone publishes a *second* compliance-archetype agent to nevr.land: same role-type (symbol planning, coverage), but with a different cognitive bias (perhaps stricter on tag coverage, perhaps looser on aspect drift). That second agent would have:

- a **different id** (say, `compliance-strict`),
- a **different nickname** (say, "Aegis-2" or whatever the publisher chose),
- and the **same archetype** (`compliance`).

The two agents would be **two instances of one archetype**. A project could roster either one (or, in principle, both, with the framework treating them as a pair filling the same role from different angles). The archetype tells you "this is a compliance-shaped agent" without committing to *which* compliance-shaped agent.

## Why this matters for your day-to-day

In practice, on a single project, you mostly think about instances — Rune, Loid, Cid, Sheila. You roster them, bench them, invoke them by id. The archetype distinction matters most in three situations:

1. **Cross-project reasoning.** "Does my project have an intelligence officer?" is a question about archetype, not instance. The answer is yes whether your intelligence officer instance is Loid (id `forge`) on this project or, hypothetically, a different forge-archetype agent on a different project.

2. **Talking about role-fit before commit.** When designing a new agent, you usually start by naming the *archetype* it should fill (`security-engineer`? `mobile-platform-specialist`?), then choose a specific instance to ship with that role-type. The archetype is the design abstraction; the instance is the deliverable.

3. **The future registry (nevr.land).** Once agents travel through a public registry, learners will browse archetypes ("I need a debugger archetype agent") and pick from competing instances ("I'll install Trace-classic" or "I'll install Trace-strict"). The two-layer split is what makes that browsing coherent.

## What this looks like at v6.0.3 vs later

Today, the framework leans on archetype as a **concept** — the docs use it, agent profiles narrate it, the canonical roster groups by it. But there is no first-class `archetype` field on `AgentProfile` you can query from the CLI or filter on programmatically. You cannot run `paradigm agent list --archetype intelligence-officer` and get a clean answer; you have to read the profile narratives and infer.

> **Coming in v6.1:** `archetype` becomes a first-class field on `AgentProfile`, queryable from the CLI and surfaced in registry listings. Existing agent profiles will gain an explicit `archetype:` declaration. Until then, archetype is a stable concept the framework reasons in but does not enforce in the schema. See `agent-owned-enforcement-plan.md`.

## A common confusion to avoid

It is tempting to read the canonical roster and conclude that every archetype has exactly one instance, because that is what the first-party roster ships today: one Architect, one Builder, one Loid, one Sheila. **That is a property of the current roster, not a property of the model.** The framework already supports multiple instances per archetype at the conceptual level, and the v6.1 first-class archetype field is what surfaces it. Treating the roster as a fixed one-to-one mapping will make the registry confusing later; treating it as "twenty-one instances filling sixteen-or-so distinct archetypes today" matches the design.

## Try this

Pick three agents from `paradigm agent list` and try to articulate each one's **archetype** (its role-type) versus its **instance identity** (its id and nickname). For Rune, the archetype is `compliance` and the instance id is `compliance`; the two happen to share the spelling. For Loid, the archetype is `intelligence-officer` and the instance id is `forge`; they diverge cleanly. For Mika, the archetype is `designer` and the instance id is `designer`. The point of the exercise is not to memorise which is which — it is to feel the layer separation in your hands before the v6.1 surface makes it explicit.

## Up next

The next entry — **N-para-451-tiers** — switches axes entirely. Identity layers (and the archetype / instance split) tell you *who* an agent is. Tiers tell you *which Claude model* the agent runs on. Two orthogonal taxonomies; both worth holding in your head.
