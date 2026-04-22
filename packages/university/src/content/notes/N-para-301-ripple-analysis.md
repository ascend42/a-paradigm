---
id: N-para-301-ripple-analysis
title: Ripple Analysis
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-301
  - paradigmripple
  - direct-and-indirect
  - depth-parameter-1-5
symbols: []
difficulty: beginner
estimatedMinutes: 2
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-301.json
---

## Ripple Analysis

When you change a symbol, the effects can ripple outward through the codebase like a stone dropped in water. A modification to `#payment-service` might affect `$checkout-flow`, which depends on it. That flow might be used by `#checkout-form`, which is consumed by `#order-page`. Ripple analysis maps these dependency chains before you make changes, so you can understand the full blast radius of your modification.

The tool `paradigm_ripple` takes a symbol and an optional depth parameter (1-5, default 2) and returns everything that depends on it, both directly and indirectly. This is not just a list of imports -- it is a semantic dependency graph built from Paradigm's symbol relationships: which components reference this symbol, which flows include it as a step, which gates protect endpoints that use it, and which signals it emits that other components listen to.

```
paradigm_ripple({
  symbol: "#payment-service",
  depth: 3
})

// Returns:
// Direct dependents (depth 1):
//   $checkout-flow - uses #payment-service in step 3
//   #refund-handler - calls #payment-service.refund()
//   !payment-completed - emitted by #payment-service
//
// Indirect dependents (depth 2):
//   #checkout-form - triggers $checkout-flow
//   #order-history - listens to !payment-completed
//
// Indirect dependents (depth 3):
//   #account-dashboard - renders #order-history
```

Ripple analysis is **essential before any refactor**. The most common cause of unintended breakage is not understanding the full dependency tree. A developer renames a method on `#payment-service` thinking only `$checkout-flow` uses it, not realizing that `#refund-handler` also calls that method. Ripple analysis catches this.

The depth parameter controls how far out to look. Depth 1 shows only direct dependents. Depth 2 (the default) shows dependents of dependents. For large refactors, depth 3 or higher may be warranted. Keep in mind that higher depth values return more results and cost more tokens, so start at the default and increase only if needed.

A good practice is to run ripple analysis, review the affected symbols, then check the fragility of any flagged dependents before proceeding. If your modification would ripple into a fragile area, you may want to add extra safeguards or break the change into smaller increments. The combination of ripple analysis and fragility checking forms the core of Paradigm's change safety net.
