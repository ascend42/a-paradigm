---
id: N-para-451-what-is-an-agent
title: What Is an Agent in Paradigm?
type: note
author: paradigm
created: '2026-04-26'
updated: '2026-04-26'
tags:
  - course
  - para-451
  - agents
  - identity
  - profile
symbols: []
difficulty: beginner
estimatedMinutes: 5
prerequisites:
  - N-para-451-welcome
category: paradigm-core
origin: authored
source: agents-course-phase-a-design.md
---

## An agent is not a model invocation

The single most common confusion newcomers bring to Paradigm is the assumption that "an agent" is just "a Claude API call with a system prompt". It is not. A model invocation is **transient** — it begins, returns a response, and forgets everything. An **agent** is **persistent**: it has a name, a profile on disk, a notebook of patterns it has learned, and a role it fills across every session and (often) across every project on your machine.

Concretely, an agent in Paradigm is the union of four things:

| Part | What it is | Where it lives |
|------|------------|----------------|
| **Profile** | The agent's identity, role, voice, expertise, and partner declarations. | `~/.paradigm/agents/<id>.agent` |
| **Notebook** | What the agent has learned — patterns, gotchas, expertise entries promoted from journal observations. | `.paradigm/notebooks/<id>/` (project) or global notebook stores |
| **Roster entry** | Whether this agent is active on a given project, and at what tier. | `.paradigm/roster.yaml` |
| **Runtime invocation** | The Claude model call that happens when the agent is asked to do something — driven by the profile, fed the notebook, scoped by the roster. | At runtime, via `paradigm_orchestrate_inline` or the Claude Code Task tool |

Strip any one of these away and you do not have an agent any more — you have something less. A profile with no notebook is a fresh hire. A notebook with no profile is orphaned data. A roster entry pointing at a missing profile is a dangling reference. The agent is the *whole* construct.

## Why the framework has many of them

Paradigm could have given you one big general-purpose Claude with a long system prompt and called it a day. It deliberately does not. Two reasons:

1. **Specialised attention beats generalist attention.** When Architect is invoked, its profile narrows the model's attention to system design — multi-file planning, spec coherence, blast-radius reasoning. When Builder is invoked, its profile narrows attention to "follow the spec exactly, push back if unclear, ship the code". The same Claude model in both invocations produces measurably different output because the framing is different. A multi-agent team is a way of giving the model **multiple framings** in the same project, each at the right time.

2. **Persistent expertise compounds per role.** Architect's notebook accrues *design* patterns. Reviewer's notebook accrues *review* heuristics. Loid's notebook accrues *learning-loop* observations. If everything were one agent, the patterns would muddle. Splitting roles means each agent's notebook stays sharp in its lane, and the cross-project learning that Paradigm bets on (Swift patterns compounding everywhere Swift is detected, for example) actually makes sense.

The team metaphor is not decoration. It is the simplest accurate description of what is happening: a small group of specialised, persistent identities, each running on Claude, coordinating through the framework.

## Two scopes: globally installed, project-rostered

Every agent has two scopes you should keep straight from day one:

- **Globally installed** — the profile sits at `~/.paradigm/agents/<id>.agent` and exists once on your machine. You can install agents from GitHub or (in future) the nevr.land registry; the profile travels with you.
- **Project-rostered** — each project decides which agents from your global pool are active, via `.paradigm/roster.yaml`. Benching an agent on Project A leaves it untouched on Project B. The same global Architect can be active on six projects simultaneously and benched on a seventh.

This split is intentional. You curate your team once, globally. You shape your team per project, locally. The roster-management entry later in the course (**N-para-451-roster-management**) walks through the CLI and the `/paradigm:agents` skill that drive both halves.

## How agents are invoked at runtime

When the framework needs an agent to do something, two paths are common:

1. **Via the Task tool (Claude Code).** Each agent runs in an isolated Task subagent context, with the `paradigm:` prefix on its name (e.g. `paradigm:architect`, `paradigm:builder`). Each agent has its own conversation, its own memory, its own tool access — true multi-agent execution. This is **faceted orchestration**, the default in Claude Code.
2. **Via sequential roleplay.** In Cursor and other IDEs without Task tool support, the framework runs each agent as an inline persona switch in the same context — you see the agent's voice and reasoning, but they share memory rather than each holding their own. This is **sequential mode**, covered in **N-para-451-orchestration-modes**.

Either way, the agent's profile is loaded, its notebook is consulted, and its output is attributed back to its identity (so you can see in the orchestration log "Architect designed", "Builder implemented", "Reviewer flagged"). The mode shapes *how* the work runs; the identity is the same either way.

## Try this

Run `paradigm agent list`. The output is your project's roster — every agent currently active, with its id and nickname. Pick one (Architect is a good first target) and run `paradigm agent get architect`. You will see the profile fields: id, nickname, role, tier, partners, and a description of what the agent does. That on-disk record — not a conversation, not a single prompt — is the agent.

## Up next

Now that the agent concept is clear, **N-para-451-identity-layers** zooms into the three layers every agent has (id, nickname, archetype) and why each layer earns its keep. After that, **N-para-451-tiers** covers the orthogonal question of which Claude model an agent runs on by default.
