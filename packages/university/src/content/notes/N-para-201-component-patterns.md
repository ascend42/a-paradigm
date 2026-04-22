---
id: N-para-201-component-patterns
title: Component Patterns
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-201
  - feature-components-user-facing
  - integration-components-third-party
  - state-components-data
symbols: []
difficulty: beginner
estimatedMinutes: 3
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-201.json
---

## The Many Faces of `#`

The `#` component is Paradigm's most used symbol — and intentionally the broadest. It covers everything from a React button to a database service to a CLI command parser. This breadth is a feature, not a bug: it means you never struggle to classify code. But it also means you need **tags** to create meaningful subcategories.

This lesson covers the major component patterns and when to use each one.

## Feature Components

Feature components represent **user-facing functionality**. They are the things your users interact with — checkout, search, profile editing, notification preferences.

```yaml
#checkout:
  description: Shopping cart checkout with payment processing
  file: checkout.ts
  tags: [feature, critical, payments]
  flows: ["$checkout-flow"]
  signals: ["!order-placed"]
  gates: ["^authenticated"]

#search:
  description: Full-text search across products and content
  file: search.ts
  tags: [feature, search]
```

Feature components often have the richest cross-references: they participate in flows, emit signals, and require gates. They are the entry points into your system's behavior.

## Integration Components

Integration components wrap **third-party services**. They isolate external API calls behind a stable internal interface:

```yaml
#stripe-service:
  description: Stripe API client for payment processing
  file: stripe-service.ts
  tags: [integration, stripe, payments]
  signals: ["!payment-completed", "!payment-failed"]

#sendgrid-client:
  description: SendGrid email delivery wrapper
  file: sendgrid.ts
  tags: [integration, sendgrid, email]
```

The convention is to tag integrations with both `[integration]` and the service name (`[stripe]`, `[sendgrid]`). This lets you search for all integrations OR for all Stripe-related code specifically.

## State Components

State components manage **data storage and state containers** — databases, caches, in-memory stores, Redux slices:

```yaml
#user-store:
  description: User data persistence and caching layer
  file: user-store.ts
  tags: [state, users, cache]

#session-cache:
  description: Redis-backed session storage with 24h TTL
  file: session-cache.ts
  tags: [state, session, redis]
```

State components are often referenced by many other components. Use `paradigm_ripple` before modifying them — a change to `#user-store` might impact every feature that reads user data.

## Infrastructure Components

Infrastructure components provide **foundational services** that other components depend on but users never directly interact with:

```yaml
#logger:
  description: Structured logging with symbol tagging
  file: logger.ts
  tags: [infrastructure, observability]

#config-loader:
  description: Environment-aware configuration loading
  file: config.ts
  tags: [infrastructure, config]

#database-pool:
  description: PostgreSQL connection pool with health checks
  file: db.ts
  tags: [infrastructure, database, postgres]
```

Infrastructure components rarely have flows or gates, but they are often the most fragile — many other components depend on them. Check `paradigm_history_fragility` before making changes.

## When to Split vs Combine

A common question: should a large module be one component or several?

**Split when:**
- The module has distinct responsibilities that could change independently
- Different parts require different gates or emit different signals
- The file exceeds ~300 lines and contains clearly separable logic

**Combine when:**
- The parts are tightly coupled and always change together
- Splitting would create components with trivial descriptions ("calls the other half")
- The module is a cohesive unit with a single responsibility

```yaml
# Good split — distinct responsibilities
#payment-processor:
  description: Charges cards via Stripe
#payment-validator:
  description: Validates payment amounts and currencies

# Bad split — artificial separation
#payment-step-1:
  description: First half of payment processing
#payment-step-2:
  description: Second half of payment processing
```

If you cannot describe the component without referencing the other half, they should be one component.
