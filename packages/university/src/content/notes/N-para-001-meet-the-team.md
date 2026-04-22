---
id: N-para-001-meet-the-team
title: Meet Your Agent Team
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-001
  - 8-core-agents
  - 54-total-agents
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

### The 8 Core Agents

Every project gets these eight. They are the backbone of Paradigm's orchestration:

| Agent | Role | What They Do |
|-------|------|-------------|
| **Architect** | Design | Plans multi-file changes, defines structure |
| **Builder** | Implementation | Writes the code |
| **Reviewer** | Quality | Two-stage review: spec compliance → code quality |
| **Sage** | Advocacy | Represents the user's perspective, UX implications |
| **Jinx** | Advocacy | Stress-tests assumptions, finds edge cases |
| **Sentinel** | Security | Threat analysis, auth review, vulnerability scanning |
| **Vigil** | Testing | Writes tests, checks coverage, validates edge cases |
| **Doc** | Documentation | Maintains .purpose files and portal.yaml |
| **Rune** | Compliance | Plans symbols before building, validates after |

### Model Tiers

Not every agent needs the most powerful (and expensive) model. Paradigm assigns agents to tiers:

- **Tier 1 (opus)** — Architect, Sentinel. Complex reasoning, design decisions, threat analysis.
- **Tier 2 (sonnet)** — Reviewer, Sage, Jinx, Doc, Rune. Balanced depth and speed.
- **Tier 3 (haiku)** — Builder, Vigil. Fast, cost-effective for implementation and testing.

This is not a quality ranking — it is a complexity match. Building code is well-defined work that a fast model handles efficiently. Designing architecture requires deeper reasoning that benefits from a more capable model.

### Specialized and Ecosystem Agents

Beyond the 8 core agents, Paradigm has **54+ agents** total:

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

1. **Rune** plans the symbols the task needs
2. **Architect** designs the approach (for complex tasks)
3. **Sentinel** reviews security implications (when auth or data is involved)
4. **Builder** writes the code
5. **Reviewer** checks spec compliance and code quality
6. **Doc** updates .purpose files and Paradigm metadata
7. **Rune** validates the symbols match the implementation

Not every task uses every agent. A simple CSS fix might only need Builder. A new API endpoint might need Architect → Sentinel → Builder → Reviewer → Doc → Rune. The orchestrator decides based on the task.

> **Going deeper:** PARA 401 covers orchestration mechanics (facets, handoffs, trigger patterns). PARA 701 covers the full agent roster, profiles, notebooks, and learning loops.
