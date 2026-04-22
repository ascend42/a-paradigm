---
id: N-para-701-agent-pods-nevrland
title: 'Lesson 10: Agent Pods & nevr.land'
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-701
  - pods-are-named
  - pods-are-registry
  - nevrland-marketplace-enables
symbols: []
difficulty: beginner
estimatedMinutes: 7
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-701.json
---

## The Pod Concept

A pod is a named team preset — a curated group of agents optimized for a specific workflow. Instead of manually activating 8-15 agents for a common scenario, you activate a pod and get a pre-configured team.

Pods are metadata about team composition, not modifications to agent behavior. Activating a pod adds agents to the roster; it does not change their personalities, expertise, or attention patterns. The agents in a "Ship Pod" are the same agents as when activated individually — the pod just saves the activation step.

## Named Pods

Several standard pods cover common workflows:

**Ship Pod** — The core shipping team. Architect, builder, reviewer, tester, security, documentor. This is the minimum viable team for implementing and shipping a feature with quality gates.

**Launch Pod** — Everything needed for a product launch. Ship Pod + designer (Mika), copywriter (Wren), seo (Beacon), performance (Bolt), e2e (Ghost). Covers UI, content, search visibility, performance testing, and end-to-end verification.

**Growth Pod** — Business intelligence and growth team. Researcher (Scout), analyst (Sage), seo (Beacon), content-intel (Lens), product (North), pm (Yuki). Focused on market research, analytics, content strategy, and product direction.

**Design Pod** — The visual and UX team. Designer (Mika), copywriter (Wren), a11y (Aria), creative (Prism), presenter (Stage). Covers UI design, copy, accessibility, creative direction, and presentation.

**Infra Pod** — The platform team. Devops (Atlas), dba (Vault), sysadmin (Root), network (Wire), release (Ship), performance (Bolt). Focused on deployment, database, infrastructure, and reliability.

**Quality Pod** — The quality assurance team. Reviewer, tester, e2e (Ghost), qa (Shield), advocate (Jinx), debugger (Trace), performance (Bolt). Covers code review, unit tests, end-to-end tests, test strategy, adversarial testing, debugging, and performance.

Activating a pod via CLI:

```bash
# Activate all agents in the Ship Pod
paradigm agents activate --pod ship-pod

# Activate Design Pod on top of existing roster
paradigm agents activate --pod design-pod

# Multiple pods
paradigm agents activate --pod ship-pod --pod infra-pod
```

Pods are additive — activating a pod adds its agents to the roster without removing existing ones. Activating Ship Pod and then Design Pod results in a roster containing both teams.

## Pods Are Registry Metadata, Not Agent Behavior

This distinction is critical. A pod definition is:

```yaml
id: ship-pod
name: Ship Pod
description: Core shipping team for implementing and delivering features
agents:
  - architect
  - builder
  - reviewer
  - tester
  - security
  - documentor
```

It is a list of agent IDs. There is no behavioral modification, no special collaboration mode, no pod-specific prompts. The agents in the Ship Pod behave exactly as they do when activated individually. The pod is a convenience for roster management.

This keeps the agent system simple. Agent behavior is defined in `.agent` files. Team composition is defined in `roster.yaml`. Pods are shortcuts for populating the roster. There is one system for behavior (profiles), one for composition (rosters), and one for convenience (pods). They do not overlap.

## The nevr.land Marketplace

While Paradigm ships 54 agents locally, the agent ecosystem is open. nevr.land (nevr.land) is the marketplace where agents can be published, discovered, and installed — like npm for AI agents.

### Installing Agents

```bash
# Install a community agent
paradigm agents install @paradigm/designer

# Install from a specific publisher
paradigm agents install @acme/compliance-auditor

# Install and activate in one step
paradigm agents install @paradigm/designer --activate
```

Installed agents are placed in `~/.paradigm/agents/` alongside the built-in agents. They follow the same `.agent` schema and participate in orchestration, attention scoring, and the learning loop identically to built-in agents.

### Trust Levels

Not all agents are equal. The marketplace uses three trust levels:

| Trust Level | Meaning | Verification |
|---|---|---|
| **verified** | Published by the Paradigm team or a verified organization | Publisher identity confirmed, agent reviewed for quality and safety |
| **community** | Published by a community member | Publisher identity confirmed, agent not reviewed |
| **private** | Published to a private registry | Only accessible to the publisher's organization |

Trust levels affect installation warnings and default permissions. A `verified` agent installs silently. A `community` agent shows a warning with the publisher's identity and a link to the source. A `private` agent requires authentication to the publisher's registry.

Trust does NOT affect agent capabilities. A community agent can do everything a verified agent can do. Trust is about provenance ("who made this?"), not permissions.

### Agent Package Format

A published agent package contains three files:

```
@paradigm/designer/
  agent.yaml      # The .agent profile (same schema as local agents)
  notebooks/      # Bootstrapping notebook entries
    nb-design-system-001.yaml
    nb-typography-002.yaml
    nb-color-theory-003.yaml
  metadata.yaml   # Registry metadata
```

**agent.yaml** is the standard `.agent` file: id, nickname, role, personality, collaboration, expertise, attention, behaviors, transferable patterns. It follows the exact same schema used for local agents.

**notebooks/** contains bootstrapping entries that give the agent useful knowledge on day one. A designer agent might ship with entries for typography scales, color theory, layout patterns, and accessibility guidelines. These are installed into `~/.paradigm/notebooks/{agent-id}/` as global entries.

**metadata.yaml** contains registry-specific fields:

```yaml
name: "@paradigm/designer"
version: "1.2.0"
description: "Design engineer with deep knowledge of UI/UX theory"
author: "Paradigm Team"
license: "MIT"
trust: verified
tags: [design, ui, ux, accessibility, typography]
compatibility:
  paradigm: ">=5.0.0"
  tiers: [tier-1, tier-2]  # Works with reasoning and balanced models
downloads: 12847
rating: 4.8
```

The `compatibility` field specifies which Paradigm version and model tiers the agent works with. An agent designed for tier-1 reasoning models may produce poor results on tier-3 fast models. The marketplace surfaces this information during installation.

### Publishing

Publishing an agent reverses the installation flow:

```bash
# Package and publish
paradigm agents publish ~/.paradigm/agents/custom-agent.agent \
  --notebooks ~/.paradigm/notebooks/custom-agent/ \
  --trust community
```

The publish command validates the agent schema, packages the agent file and notebooks, and uploads to the nevr.land registry. Private publishing requires an organization token.

## The Ecosystem Vision

The progression from local to global follows a natural path:

1. **Built-in agents** — Paradigm ships 54 agents covering standard development workflows.
2. **Custom local agents** — Loid (forge) designs project-specific agents stored in `~/.paradigm/agents/`.
3. **Team-shared agents** — Agent files in `.paradigm/agents/` (project-level) are committed to the repo and shared with the team.
4. **Community agents** — Published to nevr.land for anyone to install.
5. **Verified agents** — Reviewed and endorsed by the Paradigm team for quality and safety.

Each level inherits the same agent system: `.agent` schema, notebooks, expertise tracking, attention patterns, learning loop. A community agent from nevr.land participates in orchestration, builds expertise through verdicts, and accumulates notebook entries exactly like a built-in agent. The only difference is provenance.

## Future: Agent Registries as Infrastructure

The nevr.land marketplace is the first implementation of a broader concept: agent registries. Organizations may run private registries for internal agents that should not be published publicly. Multiple registries can be configured in `~/.paradigm/config.yaml`, similar to how npm supports multiple registries.

The agent package format (agent.yaml + notebooks/ + metadata.yaml) is intentionally simple to enable this. There is no compilation step, no binary format, no platform dependency. An agent package is human-readable YAML and can be inspected, forked, and modified before installation.

This openness is a design principle: agents are knowledge, not code. They should be as shareable, forkable, and composable as npm packages. The trust system provides safety rails without restricting capability.
