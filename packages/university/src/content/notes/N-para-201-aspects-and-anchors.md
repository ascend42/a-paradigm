---
id: N-para-201-aspects-and-anchors
title: Aspects & Code Anchors
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-201
  - aspects-are-the
  - anchor-formats-single
  - applies-to-uses-glob
symbols: []
difficulty: beginner
estimatedMinutes: 4
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-201.json
---

## Why Aspects Require Anchors

Aspects (`~`) are unique among Paradigm's five symbols because they are the only ones that **require code anchors**. An anchor is a pointer to the exact lines of code where the aspect is enforced. This requirement exists for a practical reason: an aspect without an anchor is just a wish.

Consider `~audit-required`. If you define it without anchors, you are saying "financial operations should be audited" — but there is no proof that they actually are. With anchors pointing to `src/middleware/audit.ts:15-35`, you are saying "financial operations are audited, and here is the enforcement code." AI agents can verify the anchor, developers can review it, and `paradigm_aspect_check` can validate that the code still exists.

## Anchor Format

Anchors support three formats:

```yaml
~rate-limited:
  description: API endpoints are rate-limited to prevent abuse
  anchors:
    - src/middleware/rate-limiter.ts:42          # Single line
    - src/middleware/rate-limiter.ts:42-78       # Line range
    - src/decorators/throttle.ts:10,15,22       # Multiple specific lines
  applies-to: ["#*-handler"]
```

- **Single line** (`file:42`) — Points to one specific line. Use when the enforcement is a single check or decorator.
- **Range** (`file:42-78`) — Points to a block of code. Use when the enforcement spans multiple lines (a middleware function, a class method).
- **Multiple lines** (`file:10,15,22`) — Points to several non-contiguous lines. Use when the enforcement is scattered across a file (multiple decorators, multiple conditional checks).

Anchors must point to *real files with real code*. If the file does not exist or the lines are outside the file's range, `paradigm_aspect_check` will report an error.

## The applies-to Pattern

The `applies-to` field uses glob patterns to declare which symbols the aspect covers:

```yaml
~audit-required:
  applies-to: ["#*Service"]         # All components ending in 'Service'

~rate-limited:
  applies-to: ["#*-handler", "#*-endpoint"]  # All handlers and endpoints

~cached:
  applies-to: ["#*-query"]          # All query components
```

This is declarative — it says "this aspect should apply to these components." AI agents use this to check whether a new component matching the pattern has the aspect applied. If you create `#billing-service` and `~audit-required` applies to `#*Service`, the agent knows to apply the audit aspect.

## Defining Aspects in .purpose Files

```yaml
aspects:
  ~audit-required:
    description: All financial operations must log to the audit trail
    anchors:
      - src/middleware/audit.ts:15-35
      - src/decorators/auditable.ts:1-20
    applies-to: ["#*Service"]
    enforcement: middleware
    tags: [compliance, security]

  ~rate-limited:
    description: API endpoints enforce per-user rate limits
    anchors:
      - src/middleware/rate-limiter.ts:42-78
    applies-to: ["#*-handler"]
    enforcement: middleware
    tags: [security, performance]
```

The `enforcement` field is optional metadata that describes *how* the aspect is enforced — via middleware, decorator, wrapper function, etc. It helps AI agents understand the enforcement mechanism when they need to apply the aspect to new components.

## Validating Aspects

Use `paradigm_aspect_check` to verify that an aspect's anchors are valid:

```
paradigm_aspect_check({ aspect: "~audit-required" })
```

This tool checks:
1. **Anchor existence** — Do the referenced files exist?
2. **Line validity** — Are the line numbers within the file's range?
3. **Coverage** — Are all components matching `applies-to` actually covered?

Run this after refactoring. If you move or rename files, the anchors break — and a broken anchor means the enforcement code is lost or relocated. The aspect check catches this drift.

## Aspects vs Gates

A common confusion: when should you use an aspect (`~`) versus a gate (`^`)? The distinction is clear:

- **Gates** check a *specific condition at a specific time*. "Can this user access this project?" or "Is this feature flag enabled?" is a gate.
- **Aspects** enforce rules *across many components as a pattern*. "All financial services must log to the audit trail" is an aspect.

Gates are reactive (triggered per request or operation). Aspects are structural (enforced by code patterns). A gate checks one condition at one point; an aspect applies to all components matching a pattern.
