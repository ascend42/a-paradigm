---
id: N-para-451-orchestration-modes
title: Orchestration Modes — Faceted vs Sequential
type: note
author: paradigm
created: '2026-04-26'
updated: '2026-04-26'
tags:
  - course
  - para-451
  - orchestration
  - faceted
  - sequential
symbols: []
difficulty: beginner
estimatedMinutes: 5
prerequisites:
  - N-para-451-what-is-an-agent
category: paradigm-core
origin: authored
source: agents-course-phase-a-design.md
---

## Two ways the team actually runs

When `paradigm_orchestrate_inline` decides "Architect plans, Builder implements, Reviewer reviews", **how** those three agents actually run depends on the host IDE. Paradigm supports two execution models, called **orchestration modes**, and the choice between them is set by `orchestration.default_mode` in `agents.yaml`.

| Mode | Where it runs | What it looks like |
|------|---------------|-------------------|
| **Faceted** | Claude Code (Task tool available) | Each agent launches as an isolated Task subagent. Separate context. Separate memory. Separate tool access. True multi-agent. |
| **Sequential** | Cursor and other IDEs without Task tool support | Each agent runs as an inline persona switch in the **same** context. You see voice and reasoning per agent, but they share memory. Sequential roleplay. |

Both modes orchestrate the *same agents*. The profiles, notebooks, identity layers, and partner declarations are identical. What changes is whether each agent gets its own room or whether they all sit in one room and take turns speaking.

## Faceted mode (Claude Code, the default)

In Claude Code, every agent invocation is a **Task tool launch**. Architect runs in its own Task with its own conversation history, sees only what it was handed in the prompt, and returns a structured result. Builder is then launched as a *separate* Task — it does not see Architect's conversation, only the spec Architect produced. Reviewer is launched after Builder, again separately.

Why this matters in practice:

- **Context isolation prevents cross-contamination.** Architect's planning chatter does not pollute Builder's implementation context. Reviewer reads the code with fresh eyes — literally, because its Task starts fresh.
- **Memory per agent is real.** Each agent's notebook is consulted at the start of *its* Task, not shared with the others. Builder does not accidentally inherit Architect's design notebook entries.
- **Parallelism is possible.** Two unrelated Task launches can run concurrently when the orchestrator decides they should — you cannot do that in a single conversation.

The trade-off: you lose the running thread. Each agent gets only what was passed in. The orchestrator has to do the handoff work explicitly (and the framework handles this for you — see `paradigm_handoff_prepare`).

## Sequential mode (Cursor and friends, the fallback)

Cursor and many other IDEs do not expose a Task-tool-equivalent surface. In those environments, faceted mode is not possible — there is no way to launch an isolated subagent. Sequential mode is the answer: the **same conversation** acts as Architect for one turn, switches to Builder for the next, switches to Reviewer for the next, and so on.

Why this still works:

- **Identity is preserved in voice and attribution.** Each turn is clearly marked as which agent is speaking. The orchestration log still shows "Architect: ..." then "Builder: ..." then "Reviewer: ...".
- **Profiles still load.** When the conversation switches into Builder, Builder's profile and notebook are injected into the prompt for that turn. The agent's framing is the same as in faceted mode.
- **Partners and routing still apply.** The partners primitive, tier mappings, and `agents.yaml` keyword routing all behave identically.

The trade-off: shared memory. Builder *can* see what Architect just said in the same conversation — which is sometimes a feature (faster handoff, less re-explanation) and sometimes a bug (Architect's design exploration leaks into Builder's implementation focus). For most workflows this is acceptable; for high-stakes or bug-investigation work where context isolation matters, faceted mode is meaningfully better.

## Which mode you are in

Check `agents.yaml`:

```yaml
orchestration:
  default_mode: faceted   # or: sequential
```

If unset, the framework defaults to **faceted**. If you are running in an IDE that does not support the Task tool, the orchestrator will fall back to sequential automatically — no explicit switch is required, but you can pin the mode if you want determinism.

## A quick decision rule

You almost never need to pick the mode by hand. But when you do:

- **Working in Claude Code? Leave it on faceted.** The isolation and per-agent memory pay off in nearly every workflow.
- **Working in Cursor (or any IDE without Task tool support)? You are on sequential — that is the only option, and it is fine.**
- **Want to force a single shared conversation in Claude Code, e.g. for a roundtable discussion across agents?** Override `default_mode: sequential` in `agents.yaml` for that project.
- **Want to force isolation outside Claude Code?** You cannot — the host IDE has to support the primitive. Sequential is the floor.

## What this changes for a learner

Almost nothing in your day-to-day. You write prompts, the orchestrator picks agents, agents do work, and the result comes back attributed. The mode determines the *plumbing*, not the team's behaviour. Knowing the difference matters in two situations: (1) when you are debugging a strange handoff and want to know whether memory leaked across agents, and (2) when you are choosing between IDEs and want to understand what you give up.

## Up next

The next entry — **N-para-451-roster-management** — covers the CLI commands and the `/paradigm:agents` skill for shaping which agents are active on your project: rostering, benching, activating, and the `paradigm shift` auto-rosterer.
