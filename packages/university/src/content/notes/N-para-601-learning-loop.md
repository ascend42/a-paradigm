---
id: N-para-601-learning-loop
title: The Learning Loop
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-601
  - six-phase-learning-loop
  - observation-without-adaptation
  - v50-closes-the
symbols: []
difficulty: beginner
estimatedMinutes: 4
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-601.json
---

## Why Observation Without Adaptation Is Waste

Most development tools observe extensively but adapt almost never. Your linter sees thousands of issues. Your CI runs hundreds of tests. Your APM collects millions of metrics. All of this observation generates data — but data without a feedback loop is just noise with a storage bill.

Consider what happens in a typical AI-assisted session today. An agent modifies 8 files, creates a new service, adds routes to portal.yaml, and records a lore entry. The session ends. A week later, a different agent picks up related work and makes the same architectural mistake the first agent corrected mid-session. Why? Because the correction was never captured in a form that feeds back into future sessions. The observation happened (the lore entry recorded what was done), but the adaptation never occurred (the learning was not injected into the next agent's context).

This is the gap that Paradigm v5.0 closes.

## The DO-RECORD-ASSESS-LEARN-ADAPT-DO Cycle

The ambient coordination system implements a six-phase loop:

**DO** — An agent performs work: modifying files, calling tools, making decisions. Every action produces events in the event stream.

**RECORD** — The work is captured in three knowledge streams, each with a different audience and lifecycle. The work log records what got done (for the team). The learning journal records what the agent learned (for itself). Team decisions record what was decided and why (for the institution).

**ASSESS** — Events flow through attention filters. Each agent scores every event against its attention patterns — symbol matches, path matches, concept matches, signal matches. Events that exceed an agent's threshold trigger the next phase.

**LEARN** — Agents self-nominate contributions based on relevant events. A security agent notices a new route without a gate. A reviewer spots a pattern they have seen fail before. A tester sees a new component without test coverage. These nominations capture agent-specific insights triggered by project activity.

**ADAPT** — Learnings feed back into context. Journal insights from past sessions appear in the next session's prompt enrichment. Recent team decisions are surfaced to agents working on related symbols. Pending nominations are included in the active agent's context. The `paradigm_context_compose` tool assembles all of this into a coherent context section.

**DO** — The cycle repeats, but now the agent starts with richer context. It knows what was tried before, what the team decided, what the security agent flagged, and what patterns to avoid. Each iteration produces better outcomes because the loop is closed.

## What v5.0 Adds to Close the Loop

Before v5.0, Paradigm had the DO and RECORD phases (lore entries, .purpose files, portal.yaml). It had partial ASSESS capability through ripple analysis. But the LEARN and ADAPT phases were manual — a human had to read lore entries and tell the next agent what to watch out for.

v5.0 adds four capabilities that close the loop automatically:

1. **Knowledge Streams** — Lore is split into three streams with distinct storage, lifecycles, and audiences, enabling targeted adaptation.
2. **Event Stream** — Every tool call and file edit produces a structured event that flows through attention filters, enabling real-time assessment.
3. **Attention Scoring & Nominations** — Agents evaluate events against their attention patterns and self-nominate contributions, enabling machine-driven learning.
4. **Context Composition** — Journal insights, team decisions, and pending nominations are composed into the next session's context, enabling automatic adaptation.

## Context Engineering: Slim CLAUDE.md + On-Demand Guidance

The learning loop requires efficient context management. A 900-line CLAUDE.md that loads every time wastes tokens on content that may not be relevant to the current task. v5.0 implements a context engineering approach:

**Slim CLAUDE.md** — The base CLAUDE.md was reduced from ~856 lines to ~150 lines. It contains only the orientation information needed for every session: project overview, symbol system, conventions, commit format, and pointers to on-demand resources.

**On-Demand Guidance** — Twelve guidance resources are available via `paradigm://guidance/{topic}`. Topics include logging, portal protocol, MCP workflow, flows, orchestration, workspaces, university, calibration, checkpoints, navigation, component types, and troubleshooting. An agent loads only the guidance it needs for the current task.

**Agent Contributions** — Active agents inject their own context sections via `AgentContext.contributions`. A security agent might contribute a section listing recently added gates. A reviewer might contribute a section listing code smells found in the current PR. These contributions compose dynamically based on which agents are active.

The result is a context window that contains high-signal, task-relevant content rather than a static wall of instructions. The learning loop feeds relevant history into this context, making each session incrementally smarter than the last.
