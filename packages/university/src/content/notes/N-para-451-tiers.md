---
id: N-para-451-tiers
title: Model Tiers — Which Claude Each Agent Runs On
type: note
author: paradigm
created: '2026-04-26'
updated: '2026-04-26'
tags:
  - course
  - para-451
  - tier-1
  - tier-2
  - tier-3
  - model-tier
  - taxonomy
symbols: []
difficulty: beginner
estimatedMinutes: 4
prerequisites:
  - N-para-451-welcome
category: paradigm-core
origin: authored
source: agents-course-phase-a-design.md
---

## Tier = which model the agent runs on

In Paradigm, an agent's **tier** answers a single question: *which Claude model does this agent invoke by default?* That is it. Tier is a routing decision, not a status ranking, not a capability label, and — importantly — not the same thing as the v6.1 notebook tier (that one is covered separately; see the callout at the end).

The three tiers map to the three Claude model classes:

| Tier | Default model | Cost / latency profile | Typical role fit |
|------|---------------|------------------------|------------------|
| **Tier 1** | opus | Most capable, highest cost, slowest | Design, threat analysis, simulation, learning-loop reasoning — work where one extra IQ point pays for itself many times over. |
| **Tier 2** | sonnet | Balanced capability and cost | Review, documentation, devil's-advocacy, ecosystem specialists — work that needs depth but not the maximum. |
| **Tier 3** | haiku | Fast, low cost | Implementation, test writing, mechanical execution — well-defined work where speed and volume matter. |

## The match is to the work, not the agent

A Tier-3 agent (Builder, Tester) is **not** a junior agent. It is an agent doing work that is well-specified enough that a fast model handles it efficiently. Throwing opus at "implement this function the architect already designed" wastes tokens for no gain. Throwing haiku at "design a multi-file refactor across the codebase" wastes everyone's time on a thinner reasoning surface than the task demands. Tier is the framework's way of matching cost and capability to the actual cognitive shape of the work.

## Examples from the canonical roster

- **Architect** (id: `architect`) — Tier 1 (opus). Designs systems. Most expensive thinking the team does.
- **Security** (id: `security`) — Tier 1 (opus). Threat modelling and OWASP review. Mistakes are expensive; tier is conservative.
- **Cid** (id: `cid`) — Tier 1 (opus). Captain. Pre-task brief, post-task debrief. Reasoning over the whole session.
- **Reviewer** (id: `reviewer`) — Tier 2 (sonnet). Two-stage review. Needs depth but does not need to design from scratch.
- **Documentor** (id: `documentor`) — Tier 2 (sonnet). Writes `.purpose` files and updates `portal.yaml`.
- **Compliance** (id: `compliance`) — Tier 2 (sonnet). Symbol planner and coverage owner.
- **Builder** (id: `builder`) — Tier 3 (haiku). Implementation. Fast loop, narrow scope.
- **Tester** (id: `tester`) — Tier 3 (haiku). Test writing.

You will see the full tier breakdown in **N-para-451-roster-reference** — every active agent, one row each, with its tier called out.

## How to override

Tier is a *default*, not a contract. You can override the model for any agent on a per-project basis in `.paradigm/config.yaml` under the `model-resolution` section:

```yaml
model-resolution:
  builder: claude-opus-4         # override builder up to opus for a research project
  documentor: claude-haiku-4     # override documentor down to haiku to save cost
```

Override sparingly. The defaults exist because they reflect a deliberate cost / capability trade-off across the team. If you find yourself overriding the same agent in every project, that is a signal worth bringing to the design — Loid (the intelligence officer) tracks override patterns precisely because they often surface a tier-default that should change.

## What tier does **not** mean

Tier does not say:

- How much an agent is "trusted" — every agent's authority is governed by its profile and (at v6.1) its authority claims, not its tier.
- How often an agent is invoked — Builder (Tier 3) runs more often than Architect (Tier 1) on most projects.
- Which agents are "core" versus "specialty" — that is a separate axis (see the roster reference).

Tier is exactly one thing: the default model the agent calls. Keep it that simple and the rest of the framework gets easier.

> **Coming in v6.1:** Paradigm introduces a separate concept also named "tier" for **notebooks** — tier-1 (transferable across projects, owned by the agent) versus tier-2 (project-local, owned by the project). The two "tier" concepts are orthogonal: an agent's *model tier* (this entry) is about cost and capability; a *notebook tier* (v6.1) is about scope and ownership of learned patterns. The naming collision is unfortunate; we keep them strictly separate in PARA 451 and 551 to avoid conflation. See `agent-owned-enforcement-plan.md`.

> **Updated in v6.0.5:** Tier discussion sometimes raises the related question of *path-resolution semantics* across MCP writer/reader pairs (since aspects, anchors, and other tier-aware tools must agree on a base directory). In v6.0.5 the framework standardised on a shared `resolveAnchorPath()` helper imported by both `paradigm_aspect_check` and `paradigm_aspect_drift`; anchors are resolved with both-bases fallback (project-root first, then `.purpose`-dir). This is a framework-internal convention — it doesn't change tier semantics — but if you came here from a v6.0.4 lesson that referenced single-base anchor resolution, that detail is now historical. See `.paradigm/research/path-bug-and-agent-protocol-analysis.md` for the team analysis.

## Up next

The next entry — **N-para-451-roster-reference** — is where everything you have learned so far comes together: the canonical roster, with each agent's id, nickname, archetype, *and* tier all in a single scannable table.
