---
id: N-para-401-agent-identity
title: Agent Identity & Expertise Profiles
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-401
  - agent-files-are
  - two-storage-scopes
  - expertise-auto-updates-via
symbols: []
difficulty: beginner
estimatedMinutes: 3
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-401.json
---

## Agent Identity & Expertise Profiles

Every Claude session starts blank. The project remembers — via lore, protocols, aspects — but the agent doesn't. An architect that has successfully designed auth systems 14 times has no memory of that expertise. The orchestrator cannot route tasks to the most qualified agent because qualification is not tracked.

Agent identity files (`.agent`) solve this with persistent YAML profiles that track expertise, personality, and cross-project patterns. They **overlay** the existing `agents.yaml` system and are fully backward compatible — when no `.agent` files exist, everything works exactly as before.

### Storage & Merge Priority

Profiles live in two locations:

- **Global** (`~/.paradigm/agents/architect.agent`) — travels across projects
- **Project** (`.paradigm/agents/builder.agent`) — project-level overrides

Merge priority: **project `.agent` > global `.agent` > `agents.yaml`**. This means a project can override a global agent's default model or focus areas without modifying the shared identity.

### Profile Structure

Each `.agent` file contains:

- **`id`** — Agent identifier (e.g., "architect")
- **`personality`** — Style (deliberate/rapid/exploratory/methodical), risk tolerance (conservative/balanced/aggressive), and verbosity (minimal/concise/detailed)
- **`expertise`** — Per-symbol entries with confidence (0.0-1.0), session count, and last touch date
- **`transferable`** — Cross-project patterns with success rates and linked protocols/lore
- **`contexts`** — Per-project adaptations: focus areas, preferred model, session count

### Expertise Auto-Population

When lore is recorded with `paradigm_lore_record`, the relevant agent's expertise scores update automatically via exponential moving average:

```
For each symbol in symbols_touched:
  if existing entry:
    sessions++
    confidence = 0.7 * old_confidence + 0.3 * lore_confidence
  else:
    create entry with confidence = lore_confidence (or 0.5 default)
```

Assessment verdicts from `paradigm_lore_assess` also feed into expertise. A verdict of `correct` nudges confidence up, `incorrect` nudges it down.

### Querying Expertise

`paradigm_agent_expertise` takes a symbol and returns agents ranked by confidence:

```
paradigm_agent_expertise({ symbol: "#payment-service" })
// Returns: [{ agentId: "architect", confidence: 0.92, sessions: 14 }, ...]
```

This enables **symbol-to-agent routing** — the orchestrator can prefer the agent most experienced with the symbols a task touches.

### Orchestration Enrichment

When `paradigm_orchestrate_inline` builds agent prompts, agents with `.agent` profiles receive a preamble:

```markdown
## Agent Identity: architect
**Style:** deliberate | **Risk:** conservative | **Verbosity:** concise

## Your Expertise on Relevant Symbols
- #auth-middleware: confidence 0.92 (14 sessions)
- $checkout-flow: confidence 0.88 (8 sessions)

## Transferable Patterns
- portal-gate-pattern: 95% success (learned in a-paradigm, applied in 2 projects)
```

This goes BEFORE the role-specific prompt, giving the agent self-awareness about its strengths.

### CLI Commands

- `paradigm agent list` — Show all profiles with top expertise
- `paradigm agent show <id>` — Full profile with expertise table
- `paradigm agent create <id> --global` — Create new identity file
- `paradigm agent sync <id>` — Bootstrap expertise from existing project lore

Agent identities are a foundation for future capabilities: curated notebooks, model cascading, and knowledge graduation across projects.
