---
id: N-para-601-agent-renaissance
title: Agent Manifest Renaissance
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-601
  - six-new-dimensions
  - intrinsic-learning-optional
  - five-collaboration-stances
symbols: []
difficulty: beginner
estimatedMinutes: 5
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-601.json
---

## Six New Dimensions

Before v5.0, an agent profile (`AgentProfile`) had six core fields: `id`, `role`, `description`, `personality`, `expertise`, and `transferable` patterns. These covered identity and knowledge but said nothing about how agents observe, learn, contribute context, report work, collaborate, or decide when to speak up.

v5.0 adds six new dimensions to the agent manifest, transforming it from a static identity card into a living behavioral specification:

1. **Attention** (`AgentAttention`) — What this agent notices in the event stream
2. **Learning** (`AgentLearning`) — How this agent improves over time
3. **Context** (`AgentContext`) — What this agent contributes to shared context
4. **Reporting** (`AgentReporting`) — How this agent logs work and learnings
5. **Collaboration** (`AgentCollaboration`) — How this agent interacts with others
6. **Nomination** (`AgentNomination`) — When this agent speaks up in ambient mode

All six are optional on the `AgentProfile` interface for backward compatibility. Agents without these fields use sensible defaults or are treated as non-ambient (they do not participate in the observation-nomination loop).

## Attention (AgentAttention)

Covered in detail in the Attention & Scoring lesson. The attention dimension defines what the agent watches for: symbol patterns, file paths, semantic concepts, and signal types. The threshold determines sensitivity.

Default configs exist for five standard roles via `DEFAULT_ATTENTION`. For example, the security agent defaults to watching all gate symbols (`^*`), auth-related components and paths, security concepts, and gate/route signals with a low threshold of 0.4.

## Learning (AgentLearning)

The learning dimension has two layers:

**Intrinsic Learning** (`IntrinsicLearning`) — The agent's own drive to improve. This is optional for downloaded agents (they may or may not want to learn from user feedback). Four sub-sections:

- **feedback** — When to ask for assessment: after work, after recommendations, from which agents, from humans. A security agent might configure `from_agents: ['architect', 'reviewer']` to weight peer feedback.
- **adaptation** — How to adjust: `confidence_ema_alpha` (default 0.3) controls how quickly confidence scores move. `notebook_auto_promote` auto-promotes high-value journal entries. `pattern_extraction` extracts reusable patterns from learnings.
- **reflection** — When to self-reflect: on failure, on correction, on debate loss. Each trigger records a journal entry with the relevant trigger type.
- **calibration** — Accuracy targets: `target_accuracy` (default 0.85) is the goal. `overconfidence_alert` (default 0.15) triggers when estimated confidence exceeds actual accuracy by more than 15 points.

**Platform Learning** (`PlatformLearning`) — Mandated for all marketplace agents. `feedback_required: true` is always set. Collects `work_outcome`, `helpfulness`, and `would_use_again` metrics. Feedback flows upstream anonymized. Aggregation is configurable per-offering, per-session, or per-project.

## Context (AgentContext)

The context dimension defines what the agent contributes to the composed context and what it requires to be loaded.

**Contributions** — An array of `ContextContribution` items. Each specifies a `section` name (e.g., "Security Warnings"), inline `content` or a `content_ref` MCP resource URI, and a `priority` (high, medium, low). High-priority contributions are always included in composed context. Medium-priority contributions are included if token budget allows. Low-priority contributions are loaded on demand.

**Requirements** — An array of `ContextRequirement` items specifying files or sections the agent needs loaded before it can work effectively. A security agent might require `portal.yaml` and the "gates" section of CLAUDE.md.

## Reporting (AgentReporting)

The reporting dimension controls how the agent captures its work and learnings in the knowledge streams.

**Work Log Config** (`WorkLogConfig`):
- `auto_record` — Automatically create work log entries when work completes
- `structure` — Which structured fields to include: `task_ref`, `files_modified`, `symbols_touched`, `next_steps`, `blockers`
- `destination` — Always `'work-log'`

**Learning Journal Config** (`LearningJournalConfig`):
- `auto_record` — Automatically record learning moments
- `triggers` — Which events trigger journal entries: `correction_received`, `confidence_miss`, `pattern_discovered`
- `destination` — Always `'journal'` (agent-private)

## Collaboration (AgentCollaboration)

The collaboration dimension defines how the agent interacts with others in multi-agent contexts.

**Default Stance** (`CollaborationStance`) — One of five stances:
- `lead` — Drives decisions, sets direction (architect default)
- `advisory` — Offers guidance but does not drive (reviewer, security defaults)
- `supportive` — Follows direction, executes (builder default)
- `observer` — Watches but rarely acts
- `peer` — Equal footing with no hierarchy

**Per-Agent Relationships** — The `with` record allows overriding stance per agent. A builder might be `supportive` by default but `peer` with another builder.

**Debate Config** — Controls debate behavior: `will_challenge` (will push back), `evidence_required` (must cite specific code/patterns), `escalate_to_human` (ask human if debate does not resolve).

Default configs exist via `DEFAULT_COLLABORATION`. The architect defaults to `lead` stance with evidence-based challenging and human escalation. The builder defaults to `supportive` with `can_contradict: false` toward the architect.

## Nomination (AgentNomination)

The nomination dimension defines behavioral rules for self-nomination beyond the threshold check.

**speak_when** — Conditions for speaking up:
- `relevance_above` — Score threshold (default 0.6, mirrors attention threshold)
- `urgency` — Always speak for specific urgency types: `security_risk`, `breaking_change`, `gate_missing`, `test_failure`, `performance_risk`
- `asked_directly` — Always respond to direct questions (default: true)

**quiet_when** — Conditions for staying silent:
- `relevance_below` — Hard floor below which the agent never speaks
- `another_agent_handling` — Stay quiet if another agent is already addressing this
- `human_explicitly_excluded` — Respect human's explicit exclusion

**contribution_style** — How the agent communicates:
- `brief_first` — Start with a short summary, elaborate if asked
- `cite_sources` — Reference specific code and patterns
- `offer_action` — Offer concrete actions rather than just observations

## buildProfileEnrichment

The `buildProfileEnrichment` function composes all six dimensions into a prompt enrichment string for orchestration. It takes the agent profile, relevant symbols, optional notebook entries, and optional ambient context (recent decisions, journal insights, pending nominations).

The output is structured markdown with sections for: Agent Identity, Expertise on Relevant Symbols, Transferable Patterns, Relevant Notebook Entries, Attention patterns, Collaboration stance, Nomination preferences, Recent Team Decisions, Transferable Insights, and Pending Nominations.

This enrichment is injected into the agent's prompt during orchestration, giving it full awareness of its identity, capabilities, behavioral rules, and ambient context — all derived from the `.agent` file and the knowledge streams.
