---
id: N-para-001-build-something
title: Build With the Team
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-001
  - every-task-follows
  - quick-check-returns-greenlight
  - reviewer-runs-two
symbols: []
difficulty: beginner
estimatedMinutes: 4
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-001.json
---

## Your First Orchestrated Task

You have a project set up and a team rostered. Now let's build something and see the full loop in action.

### The Workflow

Every task in Paradigm follows this pattern:

```
1. Quick-check or plan   →  Is this task ready to build?
2. Orchestrate           →  Assign the right agents
3. Build                 →  Agents do the work
4. Review                →  Spec compliance + code quality
5. Commit                →  With symbol references in the message
```

### Step 1: Start with a Quick-Check

Before writing any code, ask the orchestrator if your task is ready:

```
paradigm_orchestrate_inline({
  task: "Add a health check endpoint at GET /health",
  mode: "quick"
})
```

Quick-check runs two agents — **Jinx** stress-tests your assumptions ("What should /health return? Just 200 OK, or system status?") and a **reviewer** checks feasibility ("Single file change, no auth needed"). You get back either:

- **GREENLIGHT** — go ahead and build
- **ESCALATE** — needs full planning first

A simple health endpoint would likely get GREENLIGHT.

### Step 2: Build

With a greenlight, proceed to implementation. If you are using Claude Code with Paradigm, the agent team handles this automatically during orchestration. For a simple task:

- **Builder** writes the endpoint
- **Rune** ensures the component is documented in `.purpose`
- **Reviewer** checks that the implementation matches Paradigm metadata

### Step 3: Review the Output

The reviewer runs two stages:

1. **Spec Compliance** — Is `#health-check` registered in a `.purpose` file? If a gate is needed, is it in `portal.yaml`? (A public health endpoint typically needs no gate.)
2. **Code Quality** — Is the implementation clean, secure, and tested?

If Stage 1 fails, the reviewer stops and sends the task back. No point reviewing code quality of undocumented code.

### Step 4: Commit

Paradigm uses structured commit messages with symbol references:

```
feat(#health-check): add GET /health endpoint

- Add #health-check component returning system status
- No gate required — public endpoint

Symbols: #health-check
```

The `Symbols:` trailer is parsed by the post-commit hook for automatic history capture. This means every change is traceable to the symbols it affected.

### What If You Skip Orchestration?

You can always write code directly without orchestrating. On minimal enforcement (the default), nothing blocks you. But you lose:

- **Pre-build risk assessment** — Jinx might have caught an edge case you missed
- **Automatic symbol planning** — Rune would have ensured `.purpose` coverage before you started
- **Structured review** — the reviewer's two-stage protocol catches spec drift early
- **Traceability** — the orchestration record links task → agents → decisions → code

As enforcement increases (balanced, strict), skipping orchestration triggers warnings or blocks. The system is designed to let you learn the value of orchestration before it becomes mandatory.

### The Full Loop

Here is the complete picture of what happens when you build a feature with Paradigm:

```
You (Maestro)
  │
  ├─ "Add a health check endpoint"
  │
  ├─ Quick-check → GREENLIGHT
  │
  ├─ Rune → Symbol plan: #health-check component
  │
  ├─ Builder → src/routes/health.ts
  │
  ├─ Reviewer → Stage 1 pass, Stage 2 pass (3 findings: 0 blocking)
  │
  ├─ Doc → Updates .purpose with #health-check
  │
  ├─ Rune → Compliance report: 1 component, 1 aspect ✓
  │
  └─ Commit → feat(#health-check): add GET /health endpoint
```

This loop — plan, build, review, document, validate — is the heartbeat of Paradigm development. Every feature, bug fix, and refactor follows the same pattern. The agents change, the complexity varies, but the loop is always the same.

> **What's next:** PARA 101 covers the five symbols (#, $, ^, !, ~) and purpose files in depth. PARA 301 covers enforcement levels and operations. PARA 401 covers the orchestration mechanics behind what you just experienced.
