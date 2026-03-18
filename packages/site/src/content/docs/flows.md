---
title: Flows
order: 5
description: Model multi-step processes that span components, gates, and signals.
---

## What is a Flow?

A flow (`$` symbol) documents a multi-step process that spans multiple components. Flows make it clear how data moves through your system — which gates guard the path, which components do the work, and which signals fire when it's done.

## When to Define Flows

Create a flow when your feature:

- Has multiple authorization gates
- Spans 3+ components
- Emits events that trigger side effects
- Needs clear documentation of the "happy path"

## Defining Flows in .purpose

Flows live in `.purpose` files alongside the components they orchestrate:

```yaml
flows:
  $checkout-flow:
    name: Checkout Flow
    trigger: "POST /api/checkout"
    steps:
      - type: gate
        symbol: ^authenticated
      - type: gate
        symbol: ^cart-not-empty
      - type: action
        symbol: "#PaymentService"
      - type: action
        symbol: "#InventoryService"
      - type: signal
        symbol: "!order-created"
    successSignal: "!checkout-complete"
    errorSignal: "!checkout-failed"
```

## Step Types

| Type | Prefix | Purpose |
|------|--------|---------|
| gate | `^` | Authorization checkpoint — blocks if check fails |
| action | `#` | Component that performs work |
| signal | `!` | Event emitted to notify other systems |

## Flow Validation

Paradigm validates flows to catch issues early:

```bash
# Validate a specific flow
paradigm flow validate $checkout-flow

# Validate all flows
paradigm flow validate
```

MCP tools:
- `paradigm_flow_validate` — check flow completeness and broken references
- `paradigm_flows_affected` — see which flows are impacted when you modify a symbol

## Visualization

Flows appear as step timelines in Paradigm Docs, showing the sequence of gates, actions, and signals with color-coded nodes.

## Best Practices

- Define the flow before implementing — it becomes your specification
- Keep flows linear when possible — branching flows are harder to reason about
- Name flows descriptively: `$user-registration`, not `$flow-1`
- Include both success and error signals for observability
