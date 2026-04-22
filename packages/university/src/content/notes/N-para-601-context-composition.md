---
id: N-para-601-context-composition
title: Context Composition
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-601
  - slim-claudemd-150
  - paradigmcontextcompose-assembles-base
  - agent-contributions-use
symbols: []
difficulty: beginner
estimatedMinutes: 6
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-601.json
---

## From Verbose to Slim

Paradigm's CLAUDE.md historically contained everything an agent might need: logging rules, portal conventions, MCP workflow guidance, flow patterns, orchestration instructions, workspace configuration, and more. At its peak, the file was ~856 lines — loaded in full at the start of every session, consuming thousands of tokens regardless of whether the task involved logging, security, or lore.

This approach has two problems. First, it wastes context window space. An agent working on test coverage does not need 200 lines of portal gate conventions. Second, it creates staleness — with all guidance in one file, updates to any topic require reading and understanding the entire file.

v5.0 restructured this into a two-layer architecture: a slim CLAUDE.md (~150 lines) for universal orientation, plus 12 on-demand guidance resources for topic-specific depth.

## The Slim CLAUDE.md

The reduced CLAUDE.md contains only what every session needs:

1. **Project Overview** — What this project is and which version of Paradigm it uses
2. **Symbol System** — The 5 symbols (#, $, ^, !, ~) and their meanings
3. **Conventions** — Naming, commit format, .purpose rules
4. **Agent Onboarding** — What to call first (`paradigm_status`), what to check
5. **Before Implementing** — Protocol search, ripple, gates check
6. **Automatic Enforcement** — What the stop hook blocks
7. **On-Demand Guidance** — Table of 12 guidance resources with their MCP URIs

This provides enough context for any agent to orient itself and know where to find deeper guidance, without spending tokens on content irrelevant to the current task.

## 12 Guidance Resources

Guidance resources are served via MCP at `paradigm://guidance/{topic}`. Each resource generates its content on demand — it is not a static file but a function that produces the latest guidance.

The 12 topics:

| Topic | What It Covers |
|---|---|
| `logging` | Logger usage, symbol-to-method mapping by directory |
| `portal` | Portal protocol, gate patterns, route declarations |
| `mcp-workflow` | MCP tool orchestration, token budgets |
| `flows` | Flow-first development, $flow documentation |
| `orchestration` | Multi-agent orchestration, agent spawning |
| `workspaces` | Multi-project symbol awareness |
| `university` | Knowledge base, courses, PLSAT |
| `calibration` | Confidence calibration, overconfidence alerts |
| `checkpoints` | Session checkpoints, crash recovery |
| `navigation` | Task recipes, navigation patterns |
| `component-types` | Component hierarchy, type guidelines |
| `troubleshooting` | Common issues, diagnostic steps |

An agent working on portal.yaml calls `paradigm://guidance/portal` to get the full portal protocol. An agent setting up multi-project awareness calls `paradigm://guidance/workspaces`. This on-demand model means the agent pays the token cost only for the guidance it actually uses.

## Agent Contributions Section

Beyond the static guidance resources, composed context includes a dynamic **Agent Contributions** section built from active agents' `AgentContext.contributions`.

For example, if a security agent is active and its profile includes:

```yaml
context:
  contributions:
    - section: "Security Warnings"
      content: "New routes added in this session require ^authenticated gate minimum."
      priority: high
    - section: "Portal Conventions"
      content_ref: "paradigm://guidance/portal"
      priority: medium
```

...the composed context will include a "Security Warnings" section (always, because `priority: high`) and may include the full portal guidance (if token budget allows, because `priority: medium`).

Contributions with `content_ref` instead of inline `content` are resolved lazily — the MCP resource is fetched only when the contribution is actually included in the composed context.

## paradigm_context_compose

The `paradigm_context_compose` tool assembles the full context for a session. It takes:

- The active agent(s) and their profiles
- The current task or focus area
- Token budget constraints

It produces a composed context string that includes:

1. **Base CLAUDE.md content** — Universal orientation
2. **Agent identity section** — From `buildProfileEnrichment`
3. **High-priority contributions** — From all active agents' context contributions
4. **Relevant guidance** — On-demand resources loaded based on the task
5. **Ambient context** — Recent team decisions, transferable journal insights, pending nominations
6. **Medium-priority contributions** — If token budget allows

Low-priority contributions and unused guidance resources are omitted from the initial context but remain available via MCP resource URIs if the agent needs them mid-session.

## The Full Loop: Journal to Context

Here is where everything connects. Consider this sequence:

1. **Session A**: Builder modifies `#payment-service`, makes a mistake with JWT token ordering, gets corrected by the human. The builder records a journal entry: `trigger: 'correction_received', insight: 'JWT refresh tokens must be validated before access tokens when both are present', transferable: true, pattern: { id: 'jwt-ordering', applies_when: 'validating multiple JWT types', correct_approach: 'Check refresh token first, then access token' }`.

2. **Between sessions**: The journal entry is stored at `~/.paradigm/agents/builder/journal/`. The pattern is extracted as a transferable pattern.

3. **Session B**: A different agent (or the same builder on a different project) starts work on an authentication module. `paradigm_context_compose` runs, loading the builder's profile. The `buildProfileEnrichment` function includes the transferable pattern and the journal insight in the "Transferable Insights" section of the composed context.

4. **Result**: The agent in Session B sees the JWT ordering insight before writing any code, preventing the same mistake.

This is the closed loop: DO (Session A work) -> RECORD (journal entry) -> ASSESS (attention scoring recognizes auth work in Session B) -> LEARN (pattern extracted) -> ADAPT (context composition includes the pattern) -> DO (Session B starts with the insight).

## emitAndProcess

The `emitAndProcess` function unifies event emission with nomination processing. When an event is emitted, it is simultaneously:

1. Written to the event stream (JSONL file + memory buffer)
2. Scored against all active agents' attention patterns
3. For any agent exceeding its threshold, a nomination opportunity is created

This single-call pattern ensures that no event is emitted without being evaluated for nominations. It prevents the race condition where an event is emitted but attention scoring happens too late to catch it.

The function returns both the emitted event and any nominations that were generated, giving the caller full visibility into what happened.

## Putting It All Together

Ambient coordination is not a single feature — it is a system of interconnected capabilities:

- **Knowledge streams** split lore into purpose-specific channels
- **Events** capture every meaningful action in a structured format
- **Attention** filters events to the right agents
- **Nominations** let agents contribute without being asked
- **Data sovereignty** ensures data stays where it belongs
- **Agent renaissance** gives agents the behavioral vocabulary to participate
- **Context composition** closes the loop by feeding learnings back into future sessions

Each piece is independently useful, but together they create a system that gets smarter with every session — not because any single component is intelligent, but because the loop never breaks.
