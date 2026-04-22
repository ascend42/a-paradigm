---
id: N-para-401-multi-agent-coordination
title: Multi-Agent Coordination
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-401
  - paradigmorchestrateinline-with-plan
  - five-agent-roles
  - model-assignment-opus
symbols: []
difficulty: beginner
estimatedMinutes: 4
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-401.json
---

## Multi-Agent Coordination

Some tasks are too complex or too multi-faceted for a single AI agent to handle efficiently. Adding a payment system requires architectural design, security review, code implementation, and testing -- each benefiting from a different perspective and expertise level. Paradigm's orchestration system decomposes complex tasks into stages handled by specialized agents.

The entry point is `paradigm_orchestrate_inline` with `mode="plan"`. Describe your task, and the orchestrator analyzes it against trigger patterns to suggest the right agent team, estimate token costs, and produce an execution plan.

```
paradigm_orchestrate_inline({
  task: "Add JWT authentication with role-based access control",
  mode: "plan"
})

// Returns:
// Suggested agents: architect, security, builder, tester
// Estimated tokens: ~45,000
// Stages:
//   1. architect: Design auth architecture (cannot parallel)
//   2. security: Review auth design for vulnerabilities (depends on 1)
//   3. builder: Implement auth middleware and gates (depends on 1, 2)
//   4. tester: Write auth test suite (depends on 3)
```

The five agent roles are:

- **Architect** (opus model) -- Designs system architecture, evaluates tradeoffs, makes structural decisions. Used when a task requires design thinking before implementation.
- **Builder** (haiku model) -- Implements code changes. Fast and cost-effective for straightforward implementation once the design is clear.
- **Tester** (haiku model) -- Writes tests and validates implementations. Focused on coverage and edge cases.
- **Reviewer** (sonnet model) -- Critiques implementations for quality, patterns, and potential issues. Balanced between speed and depth.
- **Security** (opus model) -- Audits authentication, authorization, and data handling. Used whenever a task involves protected resources or user data.

These model assignments are defaults configured in `.paradigm/agents.yaml`. When you first set up a project with `paradigm shift`, the interactive setup detects available providers and prompts you to select models for each agent role. You can reconfigure models at any time with `paradigm team models` -- this shows the current assignment table and lets you change which model each agent uses. Run `paradigm team models --refresh` to re-discover models from your environment (useful after adding new API keys or providers). The model-to-role mapping follows a simple principle: use the most capable model (opus) for tasks requiring deep reasoning, a balanced model (sonnet) for critique, and the fastest model (haiku) for straightforward execution.

Once you have a plan, call `paradigm_orchestrate_inline` with `mode="execute"` to get full prompts for each agent. These prompts include the task context, relevant symbols, file locations, and stage-specific instructions. You then launch each agent using the Task tool or the CLI.

```
paradigm_orchestrate_inline({
  task: "Add JWT authentication with role-based access control",
  mode: "execute"
})
// Returns full prompts ready to pass to each agent
```

For individual agent prompts with custom context, use `paradigm_agent_prompt`. This is useful when you want to spawn a single agent for a focused task rather than running full orchestration.

```
paradigm_agent_prompt({
  agent: "security",
  task: "Audit the new payment webhook endpoint for CSRF and replay attacks"
})
```

The key insight is that orchestration is not just about parallelism -- it is about applying the right model and perspective to each stage. An architect (opus) spending 10,000 tokens on design is more valuable than a builder (haiku) spending 50,000 tokens trying to figure out the design while implementing.

### Fresh Context Principle

Each builder task runs in a separate, clean context. Builders NEVER carry assumptions from previous tasks -- they re-read specs and handoff context for every invocation. Why? Stale assumptions from prior tasks cause subtle bugs. If a builder remembers that "the payment field was called `amount`" from a previous task, but the architect's current spec renamed it to `total`, the builder would write code against the wrong field name. A fresh context ensures each implementation is based only on the current spec, not on memory of what a previous task did.

This principle applies even when the same builder agent handles multiple sequential tasks in an orchestration pipeline. Each task invocation should be treated as if the builder has never seen the codebase before -- the handoff context provides everything it needs.
