---
id: N-para-401-orchestration-workflow
title: Orchestration Workflow
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-401
  - five-step-workflow-describe
  - paradigmorchestrateinline-plan-then
  - parallel-stage-launching
symbols: []
difficulty: beginner
estimatedMinutes: 3
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-401.json
---

## Orchestration Workflow

This lesson walks through the complete end-to-end orchestration workflow, from task description to final result. Understanding this workflow is essential for effectively coordinating multi-agent tasks in Paradigm.

### Step 1: Describe the Task

Start with a clear, specific task description. Good task descriptions include what you want to build, which areas are involved, and any constraints:

- Good: "Add Apple Pay to the checkout flow with amount validation and ^authenticated gate"
- Bad: "Fix payments"

The quality of the task description directly affects the quality of the orchestration plan.

### Step 2: Plan with paradigm_orchestrate_inline

Call `paradigm_orchestrate_inline` with `mode="plan"` to get the orchestrator's analysis:

```
paradigm_orchestrate_inline({
  task: "Add Apple Pay to the checkout flow with amount validation and ^authenticated gate",
  mode: "plan"
})
```

The plan returns: suggested agents, estimated token cost, and a stage breakdown with dependency information. Review this carefully. If you disagree with the agent selection, you can override it with the `agents` parameter.

### Step 3: Execute to Get Prompts

Once satisfied with the plan, call with `mode="execute"`:

```
paradigm_orchestrate_inline({
  task: "Add Apple Pay to the checkout flow with amount validation and ^authenticated gate",
  mode: "execute"
})
```

This returns full prompts for each agent, complete with relevant file paths, symbol context, and stage-specific instructions.

### Step 4: Launch Agents

Launch agents according to the stage plan. Stages marked `canRunParallel: true` can be launched simultaneously:

```
// Stages 1 and 2 can run in parallel:
Task: [architect prompt from execute output]
Task: [security prompt from execute output]

// Stage 3 depends on 1 and 2, must wait:
Task: [builder prompt with handoff context from architect and security]

// Stage 4 depends on 3:
Task: [tester prompt with handoff context from builder]
```

### Step 5: Collect and Integrate Results

Each agent returns results in its configured relay format. Review each output, verify it makes sense, and integrate the changes. The orchestrator does not auto-merge -- you are the final integrator.

### CLI Alternative

For command-line orchestration, the `paradigm team orchestrate` command handles the full workflow:

```bash
# Multi-agent (default)
paradigm team orchestrate "Add Apple Pay to checkout"

# Single agent mode -- one agent does everything
paradigm team orchestrate "Add Apple Pay to checkout" --solo

# A/B test -- compare solo vs multi-agent
paradigm team orchestrate "Add Apple Pay to checkout" --compare
```

The `--solo` flag is useful when a task does not genuinely need multiple agents. The `--compare` flag runs both solo and faceted modes and lets you compare the results, which is valuable for learning when orchestration adds value versus overhead.

### When NOT to Orchestrate

Orchestration has overhead. For simple tasks (single file change, no security implications, clear implementation), a single builder agent is faster and cheaper. Use orchestration when the task involves 3+ files, has security implications, requires design decisions, or spans multiple feature areas.
