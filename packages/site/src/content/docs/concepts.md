---
title: The Five Symbols
order: 2
description: Understanding Paradigm's five operational symbols — Components, Flows, Gates, Signals, and Aspects.
---

## Symbol Overview

Paradigm uses five operational symbols to describe your codebase. Each symbol has a prefix character, a color, and a distinct purpose.

| Symbol | Prefix | Color | Purpose |
|--------|--------|-------|---------|
| Component | `#` | Green | Code units — services, views, commands, utilities |
| Flow | `$` | Violet | Multi-step processes — checkout, deployment, onboarding |
| Gate | `^` | Red | Authorization checks — authenticated, admin, owner |
| Signal | `!` | Amber | Events emitted — login-success, payment-failed |
| Aspect | `~` | Gray | Cross-cutting concerns — audit-required, rate-limited |

## Components (#)

Components are the building blocks of your system. Every function, class, module, or service that deserves a name is a component.

```yaml
components:
  PaymentService:
    description: Processes payments via Stripe
    type: service
    tags: [feature, payments]
```

Components support a `type` field for structural role (view, service, command, utility) and `tags` for behavioral classification (feature, integration, critical). They can also declare a `parent` for hierarchy.

## Flows ($)

Flows describe multi-step processes that span multiple components. Define a flow when your feature has multiple authorization gates, spans multiple services, or needs clear documentation of the happy path.

```yaml
flows:
  $checkout-flow:
    name: Checkout Flow
    trigger: "POST /api/checkout"
    steps:
      - type: gate
        symbol: ^authenticated
      - type: action
        symbol: "#validate-cart"
      - type: action
        symbol: "#process-payment"
      - type: signal
        symbol: "!order-completed"
```

## Gates (^)

Gates are authorization checkpoints defined in `portal.yaml`. They enforce access control at route boundaries. Gates can require other gates, forming chains.

```yaml
gates:
  authenticated:
    description: Requires valid JWT token
    check: req.user != null

  project-admin:
    description: User must be admin of the project
    requires: [^authenticated]
    check: project.admins.includes(req.user.id)
```

Gate **keys** (`authenticated:`, `project-admin:`) are bare. The `^` prefix appears only in **references** — in `requires:` arrays, route arrays, flow steps, and prose.

## Signals (!)

Signals are events emitted by components. They represent side effects — things that happen after an action completes. Other parts of the system can listen for signals without direct coupling.

```yaml
signals:
  order-completed:
    description: Emitted when a checkout flow finishes successfully
  payment-failed:
    description: Emitted when payment processing fails
```

## Aspects (~)

Aspects are cross-cutting concerns that apply to multiple components. Unlike the other symbols, aspects require **code anchors** — specific file and line references where the concern applies. This keeps aspects grounded in real code.

```yaml
aspects:
  ~audit-required:
    description: All changes must be audit-logged
    anchors:
      - file: user-service.ts
        line: 42
      - file: payment-service.ts
        line: 87
```
