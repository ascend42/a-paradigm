---
id: N-para-451-roster-management
title: Roster Management — Listing, Benching, Activating, Shifting
type: note
author: paradigm
created: '2026-04-26'
updated: '2026-04-26'
tags:
  - course
  - para-451
  - cli
  - roster
  - skill
symbols: []
difficulty: beginner
estimatedMinutes: 5
prerequisites:
  - N-para-451-roster-reference
category: paradigm-core
origin: authored
source: agents-course-phase-a-design.md
---

## Roster vs profile (one more time)

Two scopes. Keep them straight:

- **Profile (global):** `~/.paradigm/agents/<id>.agent`. The agent itself — its identity, role, notebook home. Installed once per machine.
- **Roster (per project):** `.paradigm/roster.yaml`. Which globally-installed agents are *active* on this project, plus their default tier.

Roster management is about the **per-project** choice. None of the commands below modify global profiles — they only shape which agents your project asks for.

## The CLI commands

### `paradigm agent list`

Show the current project's roster. One line per agent, with id, nickname, tier, and active/benched status.

```
$ paradigm agent list
architect      Architect    tier-1   active
builder        Builder      tier-3   active
reviewer       Reviewer     tier-2   active
security       Aegis        tier-1   active
tester         Probe        tier-3   active
documentor     Scribe       tier-2   active
cid            Cid          tier-1   active
forge          Loid         tier-1   active
scholar        Scholar      tier-1   active
educator       Sheila       tier-1   active
ftux           Nora         tier-1   active
designer       Mika         tier-2   benched
...
```

Use this any time you want a snapshot of the team. The display name is the **nickname**; the leftmost column is the **id** — the same handle you pass to every other command.

### `paradigm agent get <id>`

Show one agent in detail: profile fields, partners block, tier, notebook stats, recent activity. Use this to inspect a single agent before benching, activating, or trying to debug a strange invocation.

```
$ paradigm agent get scholar
```

### `paradigm agent bench <id>`

Mark an agent as **benched** on this project. Benched agents stay installed globally but do not participate in orchestration here. Useful when an agent is irrelevant to the current project (a UI-design specialist on a backend-only project, for example).

```
$ paradigm agent bench designer
```

### `paradigm agent activate <id>`

The inverse of `bench`. Marks the agent as active on this project. If the agent is not yet installed globally, you will need to install it first (via the `/paradigm:agents` skill or directly from a registry source).

```
$ paradigm agent activate designer
```

### `paradigm shift`

The **auto-rosterer**. Detects the language and platform of the current project (Swift, TypeScript, Python, and others) and selects an appropriate initial roster — the always-on backbone plus any matching ecosystem agents (Swift code activates `swift`, etc.).

```
$ paradigm shift
```

Run this once on a fresh project to bootstrap the roster, or run it again later if you have changed the project's tech stack and want the framework to reconsider which ecosystem agents belong. **N-para-451-auto-rostering** covers the detection logic and the cross-project notebook compounding that ecosystem agents bring with them.

## The `/paradigm:agents` skill

In Claude Code, the `/paradigm:agents` skill is the conversational wrapper around the same operations. It exposes:

- Roster overview (the same view as `paradigm agent list`, with extra Neverland health metrics).
- Onboarding flow for installing agents from GitHub or (in future) the nevr.land registry.
- Bench / activate / detail operations on individual agents.

The skill and the CLI are interchangeable surfaces over the same underlying state. Use the skill when you want a guided, conversational pass — installing for the first time, exploring what is available, asking "what should I do here?" Use the CLI when you know exactly what you want and just need it done.

## The roster.yaml file

For completeness, the file the CLI is editing:

```yaml
# .paradigm/roster.yaml
active:
  - id: architect
    tier: tier-1
  - id: builder
    tier: tier-3
  - id: reviewer
    tier: tier-2
  # ...
benched:
  - id: designer
default_tier: tier-2
```

You can edit this file directly if you prefer — the CLI commands above are conveniences over the same YAML. The framework re-reads `roster.yaml` on every orchestration call, so changes take effect immediately.

## Quick recipes

- **Joining an existing project for the first time?** Run `paradigm agent list` to see the inherited roster. If it looks empty or wrong, run `paradigm shift` to auto-roster.
- **An agent keeps getting invoked when you do not want it?** Bench it: `paradigm agent bench <id>`. Activate again later when the work calls for it.
- **Want a roster preview before committing to it?** Use the `/paradigm:agents` skill — it shows what `shift` would do without applying.
- **Curious which agents you have installed globally that are *not* on this roster?** Use the `/paradigm:agents` skill's "available but inactive" view.

## Up next

This is the last new entry in the course's batch-2 chunk. The next thing you should do is take **Q-para-451-foundations** — a 5-question quiz covering everything from the welcome through to here (what an agent is, the three identity layers, model tiers, faceted vs sequential mode, and roster management). Pass it and you have the agent foundations down cold.
