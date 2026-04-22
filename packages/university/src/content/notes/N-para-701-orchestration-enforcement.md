---
id: N-para-701-orchestration-enforcement
title: 'Lesson 7: Orchestration Enforcement'
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-701
  - three-seed-habits
  - enforcement-uses-the
  - nominations-surface-in
symbols: []
difficulty: beginner
estimatedMinutes: 6
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-701.json
---

## Why Enforcement Matters

Orchestration is powerful but optional. An agent can skip `paradigm_orchestrate_inline` and implement a 10-file feature solo, bypassing security review, missing test coverage, and producing no documentation updates. The feature ships, but quality degrades silently.

Enforcement solves this by making orchestration the path of least resistance. Instead of hardcoding rules into agent logic ("always call the orchestrator"), enforcement works through Paradigm's habit system — three seed habits that nudge, warn, and track orchestration compliance.

## The Three Orchestration Habits

Paradigm seeds three habits specifically for orchestration enforcement:

### 1. orchestration-required (preflight, warn)

```typescript
{
  id: 'orchestration-required',
  name: 'Orchestrate Complex Tasks',
  description: 'Tasks affecting 3+ files or touching security symbols
    should use paradigm_orchestrate_inline to determine which agents
    are needed.',
  category: 'collaboration',
  trigger: 'preflight',
  severity: 'warn',
  check: {
    type: 'tool-called',
    params: { tools: ['paradigm_orchestrate_inline'] }
  },
  enabled: true,
}
```

This habit fires at **preflight** (session start). It checks whether `paradigm_orchestrate_inline` was called. If not, and the task description suggests complexity (3+ files, security symbols), it emits a `warn` severity message: "This task may benefit from orchestration. Call paradigm_orchestrate_inline mode='plan' to see which agents are needed."

The severity is `warn`, not `block`. This is deliberate. Blocking on orchestration would prevent quick fixes, hot patches, and simple tasks that genuinely do not need multi-agent coordination. The warning surfaces the recommendation; the human decides whether to follow it.

### 2. agent-coverage-validated (postflight, advisory)

```typescript
{
  id: 'agent-coverage-validated',
  name: 'Validate Agent Involvement',
  description: 'After completing work, verify that agents with relevant
    expertise were consulted. Check nominations that were surfaced but
    not acted on.',
  category: 'collaboration',
  trigger: 'postflight',
  severity: 'advisory',
  check: {
    type: 'tool-called',
    params: {
      tools: ['paradigm_ambient_nominations', 'paradigm_agent_list']
    }
  },
  enabled: true,
}
```

This habit fires at **postflight** (before session end). It checks whether agent nominations were reviewed. If `paradigm_ambient_nominations` was not called, it advises: "There may be agent nominations you haven't reviewed. Run paradigm_ambient_nominations to check if any agents have relevant contributions."

This catches the scenario where the orchestrator was bypassed but agents still self-nominated. The security agent may have noticed a new route without a gate, but if nobody checked nominations, the contribution is lost.

### 3. hot-mode-incident (on-stop, advisory)

```typescript
{
  id: 'hot-mode-incident',
  name: 'Incident Response Acknowledgment',
  description: 'During incident response, orchestration enforcement is
    waived. But a post-incident lore entry is required and a postflight
    review should be scheduled.',
  category: 'collaboration',
  trigger: 'on-stop',
  severity: 'advisory',
  check: { type: 'lore-recorded' },
  enabled: true,
}
```

This habit acknowledges that incidents are different. When production is down, you do not want a warning about calling the orchestrator. You want to fix the problem. This habit fires at **on-stop** and only checks that a lore entry was recorded. The rationale: during incidents, skip orchestration. After incidents, record what happened so the learning loop can process it.

## The Nomination System

Orchestration enforcement works hand-in-hand with the nomination system. When events flow through the event stream, each agent scores them against their attention patterns. Agents whose scores exceed their threshold self-nominate contributions.

Nominations surface in two places:

1. **During orchestration plan/execute** — The orchestrator includes pending nominations in the plan. If the security agent nominated a gate-coverage review, it appears in the orchestration plan's agent list with the nomination brief.

2. **Via paradigm_ambient_nominations** — This MCP tool returns all pending nominations with their urgency, agent, and brief description. The `agent-coverage-validated` habit points agents here when orchestration was skipped.

The nomination flow:

```
Event emitted → Each agent scores it → Score >= threshold → 
Agent self-nominates → Nomination stored → 
Surfaced in orchestration OR paradigm_ambient_nominations
```

## The Post-Write Hook Connection

The post-write hook (which runs after every file edit) emits events into the event stream. These events trigger attention scoring across all active agents. If an agent's attention score exceeds its threshold, a nomination is created.

The post-write hook itself does not enforce orchestration. It simply produces the events that feed the nomination engine. The enforcement comes from the habits that check whether nominations were reviewed.

## Enforcement Through Habits, Not Hardcoded Logic

This is a critical architectural decision. Orchestration enforcement is not baked into the orchestrator or the agent runtime. It lives in the habit system, which means:

- **Configurable** — A project can disable `orchestration-required` by setting `enabled: false` in their habits override. A team that always orchestrates manually can turn off the nag.
- **Tunable** — A project can change the severity from `warn` to `block` if they want strict enforcement. A project can change it to `advisory` if they want a softer touch.
- **Extensible** — Teams can add custom orchestration habits. A habit that requires security review for any task touching `auth/**` files. A habit that requires documentation review for API changes.
- **Transparent** — Habits are declared in YAML, visible in the project configuration, and evaluated at predictable trigger points (preflight, postflight, on-stop).

The alternative — hardcoding orchestration requirements into the orchestrator itself — would be rigid, opaque, and impossible to customize per project. The habit system provides the same enforcement with full flexibility.

## Habit Evaluation Context

When habits are evaluated, the system provides an `EvaluationContext` that includes:

```typescript
interface EvaluationContext {
  toolsCalled: string[];     // Which MCP tools were invoked
  filesModified: string[];   // Which files were changed
  symbolsTouched: string[];  // Which symbols were affected
  loreRecorded: boolean;     // Whether a lore entry was written
  hasPortalRoutes: boolean;  // Whether portal.yaml has routes
  taskAddsRoutes: boolean;   // Whether the task added new routes
  taskDescription?: string;  // The task description (for complexity analysis)
  gitClean?: boolean;        // Whether the working tree is clean
}
```

The `orchestration-required` habit checks `toolsCalled` for `paradigm_orchestrate_inline`. The `agent-coverage-validated` habit checks for `paradigm_ambient_nominations` or `paradigm_agent_list`. The `hot-mode-incident` habit checks `loreRecorded`.

The evaluation produces a `HabitEvaluation` with three possible results: `followed` (the habit was satisfied), `skipped` (the habit was not satisfied), or `partial` (some conditions met, others not). Skipped habits with `warn` severity produce warnings; skipped habits with `block` severity prevent the session from completing.

## Practical Workflow

Here is how orchestration enforcement plays out in a typical session:

1. Developer starts a task: "Add webhook support for Stripe events"
2. **Preflight** — `orchestration-required` fires: "This task modifies auth-related symbols. Consider calling paradigm_orchestrate_inline."
3. Developer calls `paradigm_orchestrate_inline mode='plan'` — the plan includes builder (implement), security (gate review), tester (write tests), documentor (update .purpose)
4. Developer calls `paradigm_orchestrate_inline mode='execute'` — agents produce their outputs
5. Work is done. **Postflight** — `agent-coverage-validated` fires: evaluates whether nominations were reviewed. Since orchestration was used, this passes.
6. Session ends. **On-stop** — standard hooks check .purpose coverage, portal.yaml gates, etc.

If step 3 was skipped (developer implemented solo), the postflight habit would advise reviewing `paradigm_ambient_nominations` to check for security or documentation contributions that were self-nominated by agents watching the event stream.
