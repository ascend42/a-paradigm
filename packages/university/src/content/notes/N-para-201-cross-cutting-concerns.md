---
id: N-para-201-cross-cutting-concerns
title: Cross-Cutting Concerns
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-201
  - cross-cutting-concerns-apply
  - common-aspects-audit
  - applies-to-uses-glob
symbols: []
difficulty: beginner
estimatedMinutes: 3
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-201.json
---

## Rules That Span the System

Some requirements do not belong to any single component. "All financial operations must be audited." "All API endpoints must be rate-limited." "All sensitive data must be encrypted at rest." These are **cross-cutting concerns** — rules that apply across multiple components as a structural pattern rather than a per-request check.

Paradigm models cross-cutting concerns as **aspects** (`~`). Unlike gates (which check access per request) or signals (which fire per event), aspects describe ongoing constraints that are enforced by code patterns, middleware, decorators, or architectural choices.

## Common Aspect Patterns

### Audit Trails

```yaml
~audit-required:
  description: All financial operations must log to the audit trail with user, action, and timestamp
  anchors:
    - src/middleware/audit.ts:15-35
    - src/decorators/auditable.ts:1-20
  applies-to: ["#*Service"]
  enforcement: middleware
  tags: [compliance, security]
```

Audit aspects ensure that certain operations leave a trail. The anchors point to the middleware or decorator that performs the logging. Any service matching `#*Service` is expected to use this middleware.

### Rate Limiting

```yaml
~rate-limited:
  description: API endpoints enforce per-user rate limits (100 req/min default)
  anchors:
    - src/middleware/rate-limiter.ts:10-45
  applies-to: ["#*-handler", "#*-endpoint"]
  enforcement: middleware
  tags: [security, performance]
```

Rate limiting protects against abuse. The aspect documents the default limit (100 req/min) and points to the middleware that enforces it.

### Caching

```yaml
~cached:
  description: Read-heavy queries use a 5-minute TTL cache
  anchors:
    - src/lib/cache-wrapper.ts:20-55
  applies-to: ["#*-query"]
  enforcement: wrapper-function
  tags: [performance]
```

### Input Validation

```yaml
~validated:
  description: All API inputs are validated against defined schemas before processing
  anchors:
    - src/middleware/validate.ts:1-30
    - src/schemas/index.ts:1-50
  applies-to: ["#*-handler"]
  enforcement: middleware
  tags: [security, data-integrity]
```

### Idempotency

```yaml
~idempotent:
  description: Mutation endpoints use idempotency keys to prevent duplicate processing
  anchors:
    - src/middleware/idempotency.ts:15-60
  applies-to: ["#*-handler"]
  enforcement: middleware
  tags: [reliability, payments]
```

### Encryption at Rest

```yaml
~encrypted-at-rest:
  description: Sensitive fields are encrypted before storage using AES-256-GCM
  anchors:
    - src/lib/encryption.ts:10-45
    - src/models/base-model.ts:30-50
  applies-to: ["#*-store"]
  enforcement: model-hook
  tags: [security, compliance]
```

## The applies-to Glob Pattern

The `applies-to` field uses glob patterns to declare which symbols the aspect covers:

| Pattern | Matches |
|---------|---------|
| `#*Service` | `#payment-service`, `#email-service`, `#auth-service` |
| `#*-handler` | `#login-handler`, `#webhook-handler` |
| `#*-store` | `#user-store`, `#session-store` |
| `#*` | All components (use sparingly) |

When an AI agent creates a new component matching a pattern, it should check whether any aspects apply. If `~rate-limited` applies to `#*-handler` and the agent creates `#upload-handler`, the agent should ensure rate limiting middleware is applied.

## Aspects vs Other Symbols

Understanding when to use each symbol avoids misclassification:

| If the rule... | Use |
|----------------|-----|
| Checks a specific condition per request or operation | `^` Gate |
| Fires an event that triggers side effects | `!` Signal |
| Applies the same pattern across many components | `~` Aspect |
| Describes a multi-step process | `$` Flow |

A rate limiter is an aspect (it applies the same pattern to all handlers), not a gate (it does not check authorization). An audit log is an aspect (it applies to all financial services), not a signal (it is a structural requirement, not a one-time event).

## Maintaining Aspects During Refactors

Aspects are the most maintenance-sensitive symbol because their anchors contain file paths and line numbers. When you refactor:

1. Run `paradigm_aspect_check` before the refactor to know the current state.
2. Make your code changes.
3. Run `paradigm_aspect_check` again to find broken anchors.
4. Update the anchors in the `.purpose` file to point to the new locations.

This is a conscious trade-off: anchors create maintenance burden, but they prevent the much worse problem of unverified rules that silently stop being enforced.
