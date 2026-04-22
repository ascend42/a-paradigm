---
id: N-para-101-five-symbols
title: The Five Symbols
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-101
  - '-component-'
  - '-flow-'
  - '-gate-'
symbols: []
difficulty: beginner
estimatedMinutes: 3
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-101.json
---

## The Heart of Paradigm

Everything in Paradigm revolves around five symbols. Each symbol is a single-character prefix that classifies a code unit by its *role* in the system. When you see `#PaymentService`, you immediately know it is a component. When you see `^authenticated`, you know it is a security gate. The symbols are not decorative — they are a shared vocabulary that lets humans, AI agents, and tooling speak the same language about your codebase.

## `#` Component — The Universal Building Block

The `#` symbol marks **any documented code unit**. Services, handlers, React components, utility modules, database models, configuration loaders — if it is a meaningful piece of code that you want AI to know about, it is a `#component`.

```yaml
# In a .purpose file
components:
  #PaymentService:
    description: Handles payment processing via Stripe
    file: payment-service.ts
    tags: [integration, stripe, critical]

  #login-handler:
    description: POST /auth/login endpoint handler
    file: login.ts
    gates: [^authenticated]
```

Component is intentionally broad. You never have to debate whether something is a "feature" or a "service" — it is a component. Finer distinctions are handled by the tag system: `#checkout` with `tags: [feature]`, `#stripe-service` with `tags: [integration, stripe]`.

## `$` Flow — Multi-Step Processes

The `$` symbol marks **ordered sequences of steps that span multiple components**. Use a flow when logic touches three or more components in a specific order.

```yaml
flows:
  $checkout-flow:
    description: Complete purchase from cart to confirmation
    steps:
      - component: "#cart-service"
        action: validate-cart
      - component: "#payment-service"
        action: charge-card
      - component: "#order-service"
        action: create-order
      - component: "#notification-service"
        action: send-confirmation
    signals: ["!order-placed", "!payment-completed"]
```

Flows are documentation, not orchestration code. They tell AI agents *the sequence of operations* so the agent can understand what happens end-to-end without reading every file.

## `^` Gate — Condition Checkpoints

The `^` symbol marks **conditions that must be satisfied before an action can proceed**. Gates are the gatekeepers of Paradigm — they check a defined state and either allow or block.

```yaml
gates:
  ^authenticated:
    description: User must be logged in
    check: req.user != null
  ^project-admin:
    description: User must be an admin of the project
    check: project.admins.includes(req.user.id)
    requires: [^authenticated]
```

Gates can chain — `^project-admin` requires `^authenticated` first. They map to routes in `portal.yaml`, which we will cover later.

## `!` Signal — Events for Side Effects

The `!` symbol marks **events that trigger decoupled side effects**. When a payment completes, the payment service does not directly call the notification service — it emits `!payment-completed`, and any listener can react.

```yaml
signals:
  !payment-completed:
    description: Fired after successful payment processing
    emitters: ["#payment-service"]
    category: business
  !login-failed:
    description: Fired on failed authentication attempt
    emitters: ["#auth-handler"]
    category: security
```

Signals promote loose coupling. The emitter does not need to know who listens.

## `~` Aspect — Cross-Cutting Rules

The `~` symbol marks **rules that apply across multiple components and MUST point to enforcement code**. This is the only symbol that *requires* code anchors.

```yaml
aspects:
  ~audit-required:
    description: All financial operations must be logged to audit trail
    anchors:
      - src/middleware/audit.ts:15-35
      - src/decorators/auditable.ts:1-20
    applies-to: ["#*Service"]
    tags: [compliance, security]
```

The `anchors` field is mandatory. An aspect without anchors is invalid — it would be a rule with no enforcement. The anchor format is `file:line`, `file:start-end`, or `file:line1,line2,line3`.

## Choosing the Right Symbol

Ask yourself:
- Is it a piece of code I want documented? → `#` Component
- Does it describe a multi-step sequence? → `$` Flow
- Does it guard access to a resource? → `^` Gate
- Does it represent an event with side effects? → `!` Signal
- Does it enforce a rule across many components? → `~` Aspect
