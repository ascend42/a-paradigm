---
id: N-para-201-flows-deep-dive
title: Flows in Depth
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-201
  - create-flows-when
  - steps-are-component
  - define-flows-in
symbols: []
difficulty: beginner
estimatedMinutes: 4
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-201.json
---

## When to Create a Flow

Not every process needs a `$flow`. The rule of thumb is: **create a flow when logic spans three or more components in a specific order**. A two-component interaction (service A calls service B) is simple enough to document in the component's `.purpose` entry. But once a third component enters the picture — and the order matters — a flow captures the choreography that no single component can describe.

Consider these scenarios:
- User clicks "Buy" → cart validates → payment charges → order creates → email sends. That is four components in sequence. This needs a `$checkout-flow`.
- A cron job triggers → data fetches → report generates → file uploads → Slack notifies. Five components. This needs a `$daily-report-flow`.
- A controller calls a service which returns data. Two components, no sequence ambiguity. This does NOT need a flow.

## Flow Step Structure

Each step in a flow is a `component + action` pair. The component references a `#component` defined in a `.purpose` file, and the action describes what that component does in this step:

```yaml
flows:
  $onboarding:
    description: New user setup from registration to first project
    steps:
      - component: "#auth-handler"
        action: create-account
        description: Validates email, hashes password, creates user record
      - component: "#email-service"
        action: send-welcome
        description: Sends welcome email with verification link
      - component: "#project-service"
        action: create-default-project
        description: Creates a starter project for the new user
      - component: "#notification-service"
        action: notify-team
        description: Alerts the team Slack channel about the new signup
    signals: ["!user-created", "!welcome-email-sent"]
    gates: []
```

The `description` on each step is optional but valuable — it tells AI agents what happens at each point without reading the source code.

## Documenting Flows in .purpose Files

Flows are defined in the `flows` section of a `.purpose` file, usually in the directory of the *initiating* component. If the checkout flow starts in the cart module, define `$checkout-flow` in `src/cart/.purpose`. The flow references components from other directories — that is expected and correct.

You can also reference flows from component definitions:

```yaml
components:
  #cart-service:
    description: Shopping cart management
    flows: ["$checkout-flow", "$cart-abandonment-flow"]
```

This bidirectional referencing lets `paradigm_ripple` calculate the full impact when you modify a component — it knows which flows pass through it.

## Flow Validation

Paradigm provides `paradigm_flow_check` to check that your flow definitions are consistent:

```
paradigm_flow_check({ flowId: "$checkout-flow", checkImplementation: true })
```

With `checkImplementation: true`, the validator goes beyond schema checks — it verifies that the referenced components exist in `.purpose` files, that the actions are implemented in the codebase, and that any signals listed are actually emitted. This catches drift between documentation and code.

You can also validate all flows at once by omitting the `flowId` parameter. This is useful as a pre-commit check or CI step.

## Circular Dependency Detection

When flows reference each other via `relatedFlows` or step-level `$flow` symbols, they form a dependency graph. Paradigm automatically detects circular dependencies in this graph using depth-first search.

A circular dependency looks like this:

```yaml
$checkout-flow:
  relatedFlows: [$payment-flow]
$payment-flow:
  relatedFlows: [$checkout-flow]  # Creates a cycle!
```

When you run `paradigm_flow_check({})` (validate all flows), the output includes a `circularDependencies` section:

```
⚠ Circular Dependencies (1)

  $checkout-flow → $payment-flow → $checkout-flow

  Resolution: Break the cycle by extracting shared logic into a
  separate flow, or remove one direction of the dependency.
```

To resolve circular dependencies:
1. **Extract shared logic** into a new flow that both original flows reference
2. **Remove one direction** if only one flow truly depends on the other
3. **Replace with signals** — use `!signal` communication instead of direct flow references

Circular dependencies are not just a documentation problem — they indicate architectural coupling that can lead to cascading failures and maintenance difficulty.

## Flows Are Documentation, Not Orchestration

A critical distinction: flows describe *what happens*, not *how to make it happen*. They are not workflow engines or saga orchestrators. Your code still calls services, handles errors, and manages state however it needs to. The flow definition is metadata that helps humans and AI agents understand the sequence — it does not replace your implementation.
