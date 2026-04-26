---
id: N-para-451-identity-layers
title: The Three-Layer Identity Model
type: note
author: paradigm
created: '2026-04-26'
updated: '2026-04-26'
tags:
  - course
  - para-451
  - identity
  - three-layer
  - archetype
symbols: []
difficulty: beginner
estimatedMinutes: 5
prerequisites:
  - N-para-451-welcome
category: paradigm-core
origin: authored
source: agents-course-phase-a-design.md
---

## Three layers, one agent

Every Paradigm agent has three layers of identity. They are easy to confuse on first contact, but keeping them straight is the single most important thing you will learn in this course — every later concept (partners, rostering, the registry, cross-project notebooks) leans on this distinction.

| Layer | What it is | Example | Mutable? |
|-------|------------|---------|----------|
| **id** | Machine-stable handle. Used in CLI, MCP, and registry calls. | `architect`, `forge`, `cid` | No — set when the agent is published; changing it breaks every reference. |
| **nickname** | User-customisable display name. What you see in logs and orchestration output. | "Architect", "Loid", "Cid" | Yes — rename per project, per user, per taste. |
| **archetype** | Role pattern. Describes what *kind* of agent this is. | `architect`, `intelligence-officer`, `captain` | Conceptually fixed — it is what the agent *is*, not what it is *called*. |

## Walking through it

### Example 1: the architect agent

- **id:** `architect`
- **nickname:** "Architect" (default; some users rename it to "Apex" or similar)
- **archetype:** `architect`

This is the canonical case where all three layers happen to share the same name. It is also the source of most confusion — learners assume the layers are the same thing because they look identical. They are not. The id is what `paradigm agent get architect` resolves against. The nickname is what shows up in your terminal. The archetype is what tells the framework "this agent fills the architect-shaped hole on every team."

### Example 2: the intelligence officer

- **id:** `forge`
- **nickname:** "Loid"
- **archetype:** `intelligence-officer`

Here all three layers diverge. The CLI calls it `forge`. The team calls it Loid. The role pattern is "intelligence officer" — the agent that designs other agents, processes session debriefs, and runs the learning loop that promotes journal entries to notebook entries to wisdom. If a second agent ever shipped that filled the same role pattern (a different intelligence officer, perhaps with a different specialty bias), it would have a different `id` and a different `nickname` but the same `archetype: intelligence-officer`.

## Why three layers, not one or two?

Each layer earns its keep:

- **id** has to be stable so that scripts, configs, MCP calls, and the cross-project notebook system never lose track of which agent is which. If `forge` could rename itself to `loid` tomorrow, every project's roster would silently break.
- **nickname** has to be mutable so that you, the user, can call your team whatever you want. The framework is yours; if "Loid" feels wrong and you want "Sage" instead, that should be a one-line change with no breakage.
- **archetype** has to be a separate layer because some questions are about *what role an agent fills*, not *which specific agent fills it*. "Does my project have an intelligence officer?" should be answerable without knowing whether yours is named Loid, Sage, or Forge.

This is also what makes the planned **nevr.land** registry coherent. When agents travel — installed across the ecosystem, recommended to other projects, paired with each other — the unit of identity has to be richer than just a name.

## Where each layer lives in the file system

- **Profile (id-keyed):** `~/.paradigm/agents/<id>.agent` — for example, `~/.paradigm/agents/forge.agent`. The filename is the id.
- **Nickname (project- or user-keyed):** `.paradigm/agents.yaml` under the agent's id, e.g. `forge: { nickname: "Loid" }`. Override per project.
- **Archetype (conceptual today):** declared informally in the agent's profile and in framework documentation. There is no first-class `archetype` field in `AgentProfile` yet — that lands in v6.1.

> **Coming in v6.1:** `archetype` becomes a first-class field in `AgentProfile`, queryable from the registry and the CLI. For now, archetype is a concept the framework leans on but does not yet enforce in the schema. Declarations made today will not need rewriting once the field ships. See `agent-owned-enforcement-plan.md`.

## Try this

Run `paradigm agent get forge`. The `id` field is `forge`. Look for the nickname (it will be "Loid" on most rosters). Now run `paradigm agent list` — the displayed name in the roster is the nickname, but the underlying record is keyed on the id. The archetype layer is the one you cannot see in the CLI yet; you have to read about it (here, in the agent's profile narrative, and in framework documentation) until v6.1 makes it queryable.

## Up next

Now that you can tell the three layers apart, the next entry — **N-para-451-archetypes-vs-instances** — zooms into the distinction between an *archetype* (the role pattern) and an *instance* (a specific agent on your roster), and shows what it means for two agents to share an archetype. After that, **N-para-451-tiers** covers the orthogonal question of which model an agent runs on.
