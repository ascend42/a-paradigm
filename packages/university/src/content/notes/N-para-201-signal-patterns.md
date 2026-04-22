---
id: N-para-201-signal-patterns
title: Signal Patterns
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-201
  - business-signals-domain
  - system-signals-infrastructure
  - security-signals-auth
symbols: []
difficulty: beginner
estimatedMinutes: 3
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-201.json
---

## Events That Drive Side Effects

Signals (`!`) are Paradigm's mechanism for documenting **decoupled communication**. When a component emits a signal, it announces that something happened without caring who listens. This decoupling is fundamental to maintainable systems — the payment service should not know about the email service, the analytics tracker, or the loyalty points calculator. It just announces `!payment-completed` and moves on.

## Signal Categories

### Business Signals

Business signals represent **domain events** — things that matter to the business:

```yaml
!order-placed:
  description: A new order has been successfully created
  emitters: ["#order-service"]
  category: business
  data:
    orderId: string
    userId: string
    total: number

!subscription-renewed:
  description: A recurring subscription payment succeeded
  emitters: ["#billing-service"]
  category: business

!user-upgraded:
  description: User upgraded from free to paid plan
  emitters: ["#plan-service"]
  category: business
```

Business signals are the most important category. They define the key moments in your application's lifecycle. If you had to explain your system to a new team member, you would list these events.

### System Signals

System signals represent **infrastructure events** — things that matter to operations:

```yaml
!cache-invalidated:
  description: A cache entry or cache region was cleared
  emitters: ["#cache-manager"]
  category: system
  data:
    region: string
    reason: string

!database-failover:
  description: Primary database failed, switched to replica
  emitters: ["#database-pool"]
  category: system
  severity: warn

!rate-limit-exceeded:
  description: A user or IP exceeded the API rate limit
  emitters: ["#rate-limiter"]
  category: system
```

System signals are consumed by monitoring, alerting, and health-check systems rather than by business logic.

### Security Signals

Security signals represent **authentication and authorization events**:

```yaml
!login-failed:
  description: User provided invalid credentials
  emitters: ["#auth-handler"]
  category: security
  data:
    email: string
    reason: string
    ipAddress: string

!permission-denied:
  description: Authenticated user tried to access a resource they lack permission for
  emitters: ["#gate-middleware"]
  category: security

!suspicious-activity:
  description: Unusual access pattern detected (multiple failed logins, geographic anomaly)
  emitters: ["#security-monitor"]
  category: security
  severity: error
```

Security signals are critical for audit trails and intrusion detection. They should always include enough data to reconstruct what happened.

## Emitters and Listeners

Every signal has one or more **emitters** — the components that fire the event:

```yaml
!payment-completed:
  emitters: ["#payment-service", "#manual-charge-handler"]
```

Listeners are not defined on the signal itself — they are documented on the listening component:

```yaml
#email-service:
  description: Sends transactional emails
  listens: ["!payment-completed", "!user-created", "!password-reset-requested"]
```

This asymmetry is intentional. The emitter must know it is emitting (so it is declared on the signal). But the listener can be added or removed without changing the signal definition — true decoupling.

## Signals for Decoupled Side Effects

The power of signals is in the side effects they enable without direct coupling:

```
!order-placed is emitted by #order-service
  → #email-service listens → sends confirmation email
  → #analytics-tracker listens → records conversion event
  → #loyalty-service listens → awards loyalty points
  → #inventory-service listens → decrements stock
```

The order service knows nothing about these four listeners. You can add a fifth listener (say, `#slack-notifier`) without touching the order service at all. This is the architectural benefit of signal-based communication.

## The Data Field

Signals can declare a `data` schema describing the payload emitted with the event:

```yaml
!user-created:
  description: A new user account was registered
  emitters: ["#auth-handler"]
  category: business
  data:
    userId: string
    email: string
    registrationSource: string
```

The data field is documentation, not runtime validation. It tells listeners what to expect in the event payload, reducing the need to read the emitter's source code.
