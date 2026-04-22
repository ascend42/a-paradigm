---
id: N-para-701-agent-profiles
title: 'Lesson 2: Agent Profiles Deep Dive'
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-701
  - the-agent-file
  - personality-style-risk
  - collaboration-graph-defines
symbols: []
difficulty: beginner
estimatedMinutes: 7
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-701.json
---

## The .agent File

Every agent's identity lives in a `.agent` file stored at `~/.paradigm/agents/{id}.agent`. This is a YAML file that defines who the agent is: not just what it does, but how it thinks, who it works with, what it watches, and what it has learned. The `.agent` file is the complete specification of an agent's identity.

## Core Identity Fields

The top-level fields establish the agent's identity:

```yaml
id: security
nickname: null              # Optional display name (e.g., "Jinx", "Mika")
role: Security agent
description: >-
  Security specialist who audits auth flows, reviews gate implementations,
  and hunts for vulnerabilities. He is the Portal/Gates champion.
version: 1.0.0
```

`id` is the machine-readable identifier used in rosters, orchestration plans, and file paths. `nickname` is the optional human-friendly name displayed in attributed responses and Symphony threads (e.g., Mika for designer, Atlas for devops). `role` is a short description of the agent's function. `description` is a detailed paragraph that explains the agent's responsibilities, expertise boundaries, and what it does NOT do.

The description is critically important because it is injected into the agent's prompt during orchestration. A vague description produces vague behavior. A precise description like "He flags issues but does NOT implement fixes — that's the Builder's job" creates a clear boundary.

## Personality Configuration

The `personality` block defines the agent's behavioral parameters:

```yaml
personality:
  style: methodical        # How the agent approaches work
  risk: conservative       # Risk tolerance for decisions
  verbosity: detailed      # How much output the agent produces
```

**Style** options include `rapid` (moves fast, starts immediately), `deliberate` (thinks before acting, maps impact first), `methodical` (follows systematic processes), `analytical` (data-driven, evidence-based), `opinionated` (has strong views, will lead), `confrontational` (challenges everything), `patient` (takes time to understand context), `proactive` (anticipates needs, speaks up unprompted), `strategic` (thinks about long-term implications), and `meticulous` (leaves nothing unchecked).

**Risk** values are `conservative` (prefers proven approaches, avoids experimentation), `balanced` (will take calculated risks with evidence), `moderate` (open to new approaches when justified), and `aggressive` (pushes boundaries, challenges the status quo).

**Verbosity** values are `concise` (minimal output, just the essentials), `precise` (exact and specific, no filler), `detailed` (thorough explanations with context), and `thorough` (comprehensive coverage with examples and rationale).

These values are not decorative. During orchestration, `buildProfileEnrichment()` injects them into the agent's prompt as `**Style:** methodical | **Risk:** conservative | **Verbosity:** detailed`. The LLM uses these parameters to calibrate its response style.

## Collaboration Graph

The `collaboration` block defines how the agent works with others:

```yaml
collaboration:
  stance: advisory                   # Default relationship to other agents
  pairs_well_with:
    - architect: Security validates the architect's auth model and gate design
    - devops: Atlas handles infra hardening, security handles app-layer auth
    - builder: Security reviews builder's auth code before it ships
  with:
    architect:
      stance: peer                   # Treat as equal, not subordinate
      can_contradict: true           # Allowed to disagree with architect
    builder:
      stance: advisory               # Give guidance, not orders
      review_output: true            # Review what builder produces
  debate:
    will_challenge: true             # Will push back on decisions
    evidence_required: true          # Requires evidence to challenge
    escalate_to_human: true          # Will ask the human to break ties
  onboarding: >-
    When joining a project, security:
    1. Reads portal.yaml
    2. Calls paradigm_gates_for_route on key routes
    3. Checks Sentinel for auth-related events
    4. Reviews auth middleware implementations
    5. Identifies unprotected routes
```

The `stance` field defines the default relationship: `lead` (drives decisions), `advisory` (gives guidance), `support` (executes direction from leads), `peer` (equal footing), `challenger` (pushes back on everything). The `pairs_well_with` array lists productive agent pairings with explanations — these are surfaced during orchestration planning.

The `debate` section controls disagreement behavior. Jinx (advocate) has `will_challenge: true` and `evidence_required: false` — she challenges instinctively. The security agent has `evidence_required: true` — it backs challenges with OWASP references and CVE data. The `onboarding` field is a step-by-step procedure the agent follows when it first encounters a project.

## Expertise Tracking

The `expertise` array tracks the agent's confidence on specific symbols:

```yaml
expertise:
  - symbol: '#portal-gates'
    confidence: 0.95            # 0.0-1.0
    sessions: 12                # Times this agent worked on this symbol
    lastTouch: '2026-03-24T11:30:00.000Z'
  - symbol: '#auth-security'
    confidence: 0.95
    sessions: 8
    lastTouch: '2026-03-24T11:30:00.000Z'
```

Confidence scores are not static. They adjust automatically based on user verdicts in the session work log: `+0.03` for accepted contributions, `-0.02` for dismissed ones, `-0.01` for revised ones. An agent that consistently gets security reviews accepted will see its `#auth-security` confidence rise over time. An agent whose suggestions are frequently dismissed will see confidence drop.

The `sessions` count and `lastTouch` timestamp provide recency context. An agent with 50 sessions on `#payment-service` that last touched it yesterday has stronger expertise than one with 2 sessions from three months ago.

## Attention Patterns

The `attention` block defines what the agent notices in the event stream:

```yaml
attention:
  symbols:
    - ^*                      # All gate symbols
    - '#*-auth'
    - '#*-middleware'
  paths:
    - auth/**
    - middleware/**
  concepts:
    - JWT
    - RBAC
    - injection
    - CSRF
  signals:
    - type: gate-added
    - type: route-created
  threshold: 0.45
```

Attention patterns were covered in depth in PARA 601. The key point here is that they are part of the agent profile, not a separate system. The agent's identity (who it is) and its attention (what it notices) are defined in the same file.

## Behaviors

The `behaviors` block defines named behavior protocols the agent follows:

```yaml
behaviors:
  portal-gates-mastery: >-
    Security owns the portal.yaml gate model:
    1. Every route that checks auth MUST have a corresponding ^gate
    2. Use paradigm_gates_for_route to check gate coverage
    3. Gates need prizes: [] (v2 requirement)
  sentinel-security-monitoring: >-
    Security uses Sentinel for threat detection:
    - paradigm_sentinel_events to find auth failures
    - paradigm_sentinel_patterns for security patterns
  security-review-checklist: >-
    Before approving auth-related code:
    1. Check portal.yaml coverage
    2. Verify JWT validation
    3. Check for OWASP Top 10 vulnerabilities
```

Behaviors are injected into the agent's orchestration prompt. They are named so that other agents and humans can reference them ("use the security-review-checklist behavior"). They define step-by-step procedures that make the agent's actions predictable and auditable.

## Transferable Patterns

The `transferable` array contains patterns the agent has learned that apply across projects:

```yaml
transferable:
  - pattern: gate-coverage-check
    description: >-
      Every new route gets paradigm_gates_for_route called on it.
      No exceptions. If it returns no gates and the route modifies data,
      that's a security violation.
    successRate: 1.0
    sessions: 0
```

Transferable patterns travel with the agent across projects. When the security agent joins a new project, it brings its `gate-coverage-check` pattern regardless of whether the previous project was a SaaS app or a CLI tool. Patterns with `successRate >= 0.7` are included in prompt enrichment; lower success rate patterns are excluded.

## How Profiles Define WHO the Agent Is

The `.agent` file is not a configuration file — it is an identity specification. It answers:

- **Who am I?** — id, nickname, role, description, personality
- **What do I know?** — expertise with confidence scores
- **What do I notice?** — attention patterns and threshold
- **How do I work with others?** — collaboration stance, pairings, debate rules
- **How do I behave?** — named behavior protocols
- **What have I learned?** — transferable patterns

When the orchestrator invokes an agent, `buildProfileEnrichment()` assembles all of these fields into a prompt section that makes the LLM behave as that specific agent. The same base model (e.g., Claude Sonnet) becomes the security agent or the designer based entirely on the profile enrichment injected from the `.agent` file.
