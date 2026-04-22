---
id: N-para-101-purpose-files
title: Purpose Files
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-101
  - purpose-files-are
  - they-declare-components
  - ai-agents-read
symbols: []
difficulty: beginner
estimatedMinutes: 3
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-101.json
---

## The Map AI Agents Read First

A `.purpose` file is a YAML document that lives in a directory alongside your source code. It declares what that directory contains — its components, flows, gates, signals, and aspects. When an AI agent enters a directory, the first thing it should do is read the `.purpose` file. This single file gives the agent enough context to understand the directory without scanning every source file.

Think of `.purpose` files as the table of contents for a chapter in a book. You would not read every page to find out what topics are covered — you check the table of contents. Similarly, AI agents should not `grep` through every `.ts` or `.py` file to figure out what a directory does.

## Structure of a Purpose File

A `.purpose` file has a top-level metadata section and then named sections for each symbol type:

```yaml
name: Payment Module
description: Handles all payment processing and billing logic
version: "1.0.0"
context:
  - Uses Stripe as the payment provider
  - All amounts are in cents (integer)
  - Webhooks are verified with Stripe signatures

components:
  #payment-service:
    description: Core payment processing logic
    file: payment-service.ts
    tags: [integration, stripe, critical]
    signals: ["!payment-completed", "!payment-failed"]
    gates: ["^authenticated"]

  #billing-calculator:
    description: Computes totals, taxes, and discounts
    file: billing.ts
    tags: [feature]

flows:
  $checkout-flow:
    description: End-to-end purchase sequence
    steps:
      - component: "#cart-service"
        action: validate-items
      - component: "#billing-calculator"
        action: compute-total
      - component: "#payment-service"
        action: charge

signals:
  !payment-completed:
    description: Emitted after successful charge
    emitters: ["#payment-service"]
    category: business

gates:
  ^payment-authorized:
    description: User has a valid payment method on file
    check: user.paymentMethods.length > 0
```

## Key Rules for Purpose Files

**One per directory.** Each directory that contains meaningful code should have at most one `.purpose` file. Not every directory needs one — only directories that contain components worth documenting.

**Symbols must use the correct prefix.** Components use `#`, flows use `$`, gates use `^`, signals use `!`, aspects use `~`. The prefix is part of the identifier.

**Descriptions are required.** Every component, flow, gate, signal, and aspect must have a `description` field. Without it, the symbol is opaque to AI agents.

**References link symbols together.** A component can reference the gates it requires (`gates: ["^authenticated"]`), the signals it emits (`signals: ["!payment-completed"]`), and the flows it participates in (`flows: ["$checkout-flow"]`). These cross-references let tools like `paradigm_ripple` calculate impact.

**The `context` field is for AI.** The top-level `context` array contains free-text notes aimed at AI agents: conventions, gotchas, assumptions. This is where you write "all amounts are in cents" or "this module is deprecated, use v2 instead."

## Where Purpose Files Live

Purpose files are placed in source directories — wherever your code lives:

```
src/
  payments/
    .purpose          ← describes the payments module
    payment-service.ts
    billing.ts
  auth/
    .purpose          ← describes the auth module
    login.ts
    middleware.ts
```

They are NOT placed in the `.paradigm/` directory. The `.paradigm/` directory holds project-wide configuration; `.purpose` files hold directory-level documentation.

## Creating Purpose Files with MCP Tools

You can create and update purpose files using the Paradigm MCP tools:

```
paradigm_purpose_init     → Create/update file-level metadata
paradigm_purpose_add_component → Add a #component
paradigm_purpose_add_flow     → Add a $flow
paradigm_purpose_add_gate     → Add a ^gate
paradigm_purpose_add_signal   → Add a !signal
paradigm_purpose_add_aspect   → Add a ~aspect (with required anchors)
```

These tools handle YAML formatting and symbol quoting automatically. For example, YAML treats `!` as a tag indicator, so signal IDs need special quoting — the tools handle this for you.
