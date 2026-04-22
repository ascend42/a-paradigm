---
id: N-para-401-agent-roles
title: Agent Roles & Facets
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-401
  - three-tier-hierarchy-8
  - rune-compliance-handles
  - 11-component-to-aspect-ratio
symbols: []
difficulty: beginner
estimatedMinutes: 4
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-401.json
---

## The Agent Roster: 8 Core, 54+ Total

Paradigm ships with over 54 agent definitions. You do not use all of them — `paradigm shift` auto-selects a project roster based on your detected project type. But understanding the hierarchy helps you work with the orchestrator effectively.

### Three-Tier Hierarchy

**Core agents (8)** are available in every project. These are the backbone of orchestration:

| Nickname | Role | Model Tier | Purpose |
|----------|------|-----------|---------|
| — | **Architect** | Tier-1 (opus) | System design, multi-file planning |
| — | **Builder** | Tier-3 (haiku) | Implementation, code generation |
| — | **Reviewer** | Tier-2 (sonnet) | Two-stage code review (spec → quality) |
| Sage | **Advocate** | Tier-2 (sonnet) | User perspective, UX implications |
| Jinx | **Advocate** | Tier-2 (sonnet) | Stress-tests assumptions, finds edge cases |
| Sentinel | **Security** | Tier-1 (opus) | Threat analysis, auth review, OWASP |
| Doc | **Documentor** | Tier-2 (sonnet) | .purpose files, portal.yaml — Paradigm metadata only |
| Rune | **Compliance** | Tier-2 (sonnet) | Symbol planning, 1:1 aspect enforcement |
| Vigil | **Tester** | Tier-3 (haiku) | Test writing, coverage, edge cases |

**Specialized agents (~20)** cover domains like mobile, database, DevOps, accessibility, and performance. They are rostered when your project type matches their expertise.

**Ecosystem agents (~26+)** are language/platform-specific — Swift, TypeScript, Rust, Python ML, iOS, Android, etc. They accumulate per-ecosystem knowledge through notebooks that transfer across projects.

> **Deep dive:** PARA 701 covers the full roster, agent profiles, notebooks, per-project customization, and the learning feedback loop.

### Rune: The Compliance Specialist

Rune is the 8th core agent, added specifically to prevent a common failure mode: building features without proper symbol coverage.

**Before implementation**, Rune creates a **Symbol Plan**:
- Enumerates all `#components`, `$flows`, `!signals`, `~aspects` the task needs
- Creates symbol stubs via MCP tools (`paradigm_purpose_add_component`, etc.)
- Enforces a **1:1 component-to-aspect ratio** — every component must have at least one aspect

**After implementation**, Rune produces a **Compliance Report**:
- Validates that planned symbols were actually created
- Checks that aspect anchors point to valid code
- Verifies flows exist for logic spanning 3+ components
- Reports findings as blocking (must fix) or passing

Rune never modifies source code — only Paradigm metadata files (.purpose, portal.yaml). Think of Rune as the "symbol bookkeeper" who ensures the spec matches the code.

### Facet Configuration

Each agent role is a **facet** with four dimensions defined in `.paradigm/agents.yaml`:

- **`defaultModel`** — Which AI model to use (opus for complex reasoning, sonnet for balanced, haiku for fast execution)
- **`context.include / context.exclude`** — Which files the agent sees (scoped to reduce token waste)
- **`limits.maxTokens`** — Budget per invocation (architects get more, builders get less)
- **`protocol.relay`** — How results are reported: `structured` (JSON), `markdown` (narrative), or `handoff` (file for next agent)

```yaml
# Example from agents.yaml
architect:
  defaultModel: opus
  context:
    include: ["**/.purpose", "portal.yaml", ".paradigm/specs/**"]
    exclude: ["**/*.test.*", "node_modules/**"]
  limits:
    maxTokens: 30000
  protocol:
    relay: structured
```

### Handoff Context

Agents run in sequence, each receiving the previous agent's output via `handoffContext`:

```
Rune (symbol plan) → Architect (design) → Security (review) → Builder (implement) → Reviewer (check) → Rune (compliance report) → Doc (.purpose files)
```

The `paradigm_agent_prompt` tool accepts `previousAgent` and `handoffContext` parameters to thread this chain.

### Reviewer Protocol

The reviewer follows a strict **two-stage protocol**:

**Stage 1 (Spec Compliance)** — checks .purpose registrations, portal.yaml gates, flow steps, signal emissions, aspect enforcement. If Stage 1 fails, the reviewer **stops immediately** and hands back to the builder.

**Stage 2 (Code Quality)** — only runs if Stage 1 passes. Covers OWASP security, conventions, test coverage, performance, error handling.

Every review must produce a **minimum of 3 categorized findings**: blocking (must fix), improvement (should fix), or note (informational). A rubber-stamp "looks good" with zero findings is never acceptable.
