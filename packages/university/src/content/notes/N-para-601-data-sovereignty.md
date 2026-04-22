---
id: N-para-601-data-sovereignty
title: Data Sovereignty
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-601
  - four-trust-rings
  - all-data-is
  - data-policyyaml-configures-observation
symbols: []
difficulty: beginner
estimatedMinutes: 5
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-601.json
---

## The Local Brain Principle

All data produced during agent work is project-locked by default. This is not a policy choice that requires opt-in — it is the architectural default. No data leaves the project unless the user explicitly configures it to do so. This principle is called the "local brain" — every project has its own self-contained intelligence that never leaks.

The reason is trust. When an agent records a learning journal entry about your payment processing logic, that entry should not appear in another user's project. When a work log captures which files were modified, those file paths should not flow to an analytics dashboard without consent. Data sovereignty means the user controls every boundary their data crosses.

## Trust Rings

Data classification uses four concentric trust rings, each expanding the boundary of who can see the data:

**Ring 1: Project-Locked** — Data never leaves the project directory. Work log entries, event stream, nominations, and team decisions are project-locked by default. Storage lives in `.paradigm/` within the project.

**Ring 2: User-Scoped** — Data travels across the user's own projects but not beyond. Learning journal entries are user-scoped — an agent's insights from project A are available when working on project B, but only for the same user. Storage lives in `~/.paradigm/`.

**Ring 3: Creator-Upstream** — Anonymized, aggregate data flows to agent creators (for agents installed from a marketplace). Only high-level metrics like task type, outcome, and helpfulness rating — never code, file paths, symbol names, or conversation content. This ring requires explicit opt-in.

**Ring 4: Network-Public** — Fully anonymized, aggregated statistics shared publicly. Only `aggregated_task_success_rates` and `anonymized_pattern_frequency`. Requires explicit opt-in. Nothing in this ring can identify a project, user, or agent.

The rings are ordered: data at ring 1 can never reach ring 3 without passing through ring 2 first. Each ring expansion requires a policy declaration.

## data-policy.yaml Format

The data policy is configured in `.paradigm/data-policy.yaml`:

```yaml
version: "1.0"
default_ring: project-locked

observation:
  allow:
    - "src/**"
    - ".paradigm/**"
    - "portal.yaml"
  deny:
    - ".env*"
    - "**/*.key"
    - "**/*.pem"
    - "**/secrets/**"

streams:
  work_log:
    ring: project-locked
    allow_content: [file_paths, symbol_names, outcome]
    deny_content: [code_snippets, file_contents, diff_content]
  learning_journal:
    ring: user-scoped
    allow_content: [pattern_descriptions, confidence_adjustments, approach_descriptions]
    deny_content: [code_snippets, file_contents, symbol_names_with_context]
    redaction:
      - pattern: "\\b[A-Z_]{2,}_KEY\\b"
      - pattern: "password|secret|token"
  team_decisions:
    ring: project-locked
    allow_content: [rationale, alternatives, symbol_references]
    deny_content: [implementation_details]

upstream:
  ring: creator-upstream
  allowed: [task_type, outcome, helpfulness, duration_bucket, error_category]
  denied: [code_of_any_kind, file_paths, symbol_names, conversation_content, user_identity]

network:
  ring: network-public
  opt_in: false
  if_opted_in: [aggregated_task_success_rates, anonymized_pattern_frequency]
```

## Observation Rules

Observation rules control which files agents can observe. The `allow` list defines glob patterns for permitted paths. The `deny` list defines patterns that are always blocked — deny overrides allow.

The default denies `.env*`, `*.key`, `*.pem`, and `**/secrets/**`. These patterns catch common secret file locations. The deny list is **additive** when merging user policy over defaults — you can add deny patterns but never remove the built-in ones.

## Stream Content Rules

Each knowledge stream has its own content rules defining what categories of content are allowed or denied:

**14 content categories:** `file_paths`, `symbol_names`, `symbol_names_with_context`, `outcome`, `pattern_descriptions`, `confidence_adjustments`, `approach_descriptions`, `rationale`, `alternatives`, `symbol_references`, `code_snippets`, `file_contents`, `diff_content`, `implementation_details`, `architectural_decisions`.

The work log allows `file_paths` and `symbol_names` (needed for standup context) but denies `code_snippets` (no raw code in work logs). The learning journal allows `pattern_descriptions` (abstract learnings) but denies `symbol_names_with_context` (no project-specific details in the cross-project journal).

**Redaction patterns** use regex to scrub sensitive content before it is stored. The default learning journal redaction catches environment variable names (`\b[A-Z_]{2,}_KEY\b`) and common secret terms (`password|secret|token`). Matches are replaced with `[REDACTED]`.

## Per-Agent Overrides

The `agent_overrides` section allows per-agent policy customization:

```yaml
agent_overrides:
  security:
    observation:
      allow: ["src/**", ".paradigm/**", "portal.yaml", ".env.example"]
    learning_journal:
      deny_content: [code_snippets, file_contents, diff_content, implementation_details]
    upstream:
      opt_in: false
```

This gives the security agent slightly broader observation (it can read `.env.example` to verify it matches the template) while restricting its journal content and disabling upstream feedback.

## Enforcement Boundaries

The data policy is enforced at eight boundaries:

1. **event-emission** — Before an event enters the stream, check if the path is observable
2. **attention-filtering** — Agents only score events for paths they are allowed to observe
3. **work-log-recording** — Content is filtered and redacted before writing to the work log
4. **journal-recording** — Content is filtered and redacted before writing to the journal
5. **cross-project-transfer** — Journal entries marked `transferable` are checked against ring 2 rules
6. **upstream-feedback** — Data flowing to agent creators is checked against ring 3 rules
7. **network-aggregation** — Data flowing to the network is checked against ring 4 rules
8. **notebook-promotion** — Journal entries promoted to notebook are checked against content rules

Every enforcement action is auditable. The `AuditEntry` interface captures who, when, what boundary, what data category, and what action was taken (allowed, filtered, redacted, or blocked).

## The Merge Rule

When a user provides a `data-policy.yaml`, it is merged over the `DEFAULT_DATA_POLICY` with a critical rule: **deny lists are additive, never replacing**. If the default denies `.env*` and the user's policy does not mention `.env*`, the deny still applies. The user can add more deny patterns but cannot remove built-in protections. Allow lists, by contrast, can be fully replaced.
