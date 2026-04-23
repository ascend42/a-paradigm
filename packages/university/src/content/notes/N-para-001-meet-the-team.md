---
id: N-para-001-meet-the-team
title: Meet Your Agent Team
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-18'
tags:
  - course
  - para-001
  - core-team
  - roster
  - model-tiers-match
symbols: []
difficulty: beginner
estimatedMinutes: 3
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-001.json
---

## Your AI Team

Open `.paradigm/roster.yaml`. You will see a list of agents — your project's AI team. Each agent has a specific role, and the orchestrator assigns them to tasks based on what the task needs.

### The Core Agent Team

Every project gets a small team of role-named core agents. They are the backbone of Paradigm's orchestration:

| Role | Model Tier | What They Do |
|------|-----------|-------------|
| **architect** | tier-1 (opus) | Plans multi-file changes, defines structure |
| **builder** | tier-3 (haiku) | Writes the code |
| **reviewer** | tier-2 (sonnet) | Two-stage review: spec compliance → code quality |
| **security** | tier-1 (opus) | Threat analysis, auth review, vulnerability scanning |
| **tester** | tier-3 (haiku) | Writes tests, checks coverage, validates edge cases |
| **documentor** | tier-2 (sonnet) | Maintains .purpose files and portal.yaml |
| **ftux** (Nora) | tier-1 (opus) | First-time-user simulation, friction reports |

These seven roles ship in every project's roster. Additional core-tier specialists like **advocate** (devil's-advocate review, historically nicknamed Jinx), **compliance** (symbol coverage, historically nicknamed Rune), and **debugger** (incident triage) activate based on the project profile detected by `paradigm shift`.

Roles are addressed by their canonical role name (e.g. `architect`). Some roles also have nicknames (the ftux agent is named **Nora**) — nicknames are cosmetic and may evolve; the role name is the stable contract.

### Model Tiers

Not every agent needs the most powerful (and expensive) model. Paradigm assigns agents to tiers:

- **Tier 1 (opus)** — architect, security, ftux. Complex reasoning, design decisions, threat analysis, simulation.
- **Tier 2 (sonnet)** — reviewer, documentor, advocate, compliance. Balanced depth and speed.
- **Tier 3 (haiku)** — builder, tester. Fast, cost-effective for implementation and testing.

This is not a quality ranking — it is a complexity match. Building code is well-defined work that a fast model handles efficiently. Designing architecture requires deeper reasoning that benefits from a more capable model.

### Specialized and Ecosystem Agents

Beyond the core team, Paradigm ships with **50+ agents** total (the exact count evolves; see PARA 701):

- **Specialized agents** (~20) cover domains like mobile, database, DevOps, accessibility, performance, and internationalization. They are added to your roster when your project type matches.

- **Ecosystem agents** (~26+) are language/platform-specific: Swift, TypeScript, Rust, Python ML, iOS, Android, etc. They accumulate knowledge through notebooks that transfer across projects.

You do not need to manage these manually. `paradigm shift` detected your project type and selected the right mix. You can view and customize your roster with:

```bash
paradigm agent list          # See your full roster
paradigm agent activate <id> # Add an agent
paradigm agent bench <id>    # Remove an agent
```

### The Maestro Model

You are **Maestro** — the orchestrator. When you give a task to Paradigm, you are not talking to one AI. You are conducting a team:

1. **architect** designs the approach (for complex tasks)
2. **security** reviews security implications (when auth or data is involved)
3. **builder** writes the code
4. **reviewer** checks spec compliance and code quality
5. **ftux** (Nora) simulates a first-time user when the change touches a user-visible surface
6. **documentor** updates .purpose files and Paradigm metadata
7. **compliance** validates that planned symbols match the implementation

Not every task uses every agent. A simple CSS fix might only need builder. A new API endpoint might need architect → security → builder → reviewer → documentor. The orchestrator decides based on the task.

> **Going deeper:** PARA 401 covers orchestration mechanics (facets, handoffs, trigger patterns). PARA 701 covers the full agent roster, profiles, notebooks, and learning loops.
