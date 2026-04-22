---
id: N-para-301-history-system
title: The History System
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-301
  - append-only-implementation-log
  - paradigmhistoryrecord
  - paradigmhistorycontext
symbols: []
difficulty: beginner
estimatedMinutes: 2
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-301.json
---

## The History System

Paradigm maintains an append-only log of every implementation change in your project. This is not a replacement for git history -- it is a higher-level, symbol-aware record that tracks *what changed at the Paradigm level*, not just which lines of code were modified. Every time you implement a feature, fix a bug, or refactor a component, Paradigm can record that event against the symbols it affected.

The primary tool for recording history is `paradigm_history_record`. When you call it, you specify three required fields: the **type** of change (`implement`, `refactor`, or `rollback`), the **symbols** affected (e.g., `["#payment-service", "$checkout-flow"]`), and a **description** of what was done. You can also specify an **intent** to further classify the change: `feature` for new capabilities, `fix` for bug repairs, `refactor` for structural improvements, `experimental` for exploratory changes, and `confirmed` for validated implementations.

```
paradigm_history_record({
  type: "implement",
  symbols: ["#payment-service", "!payment-completed"],
  description: "Add Stripe webhook handler for payment confirmation",
  intent: "feature",
  commit: "a1b2c3d",
  files: ["src/services/payment.ts", "src/handlers/webhook.ts"]
})
```

To retrieve history for symbols before making changes, use `paradigm_history_context`. Pass in an array of symbols and you get back the recent implementation events, who worked on them, and how stable they have been. This is critical context -- before modifying `#payment-service`, you want to know if it was just refactored last week, if it has been the target of multiple rollbacks, or if it has been stable for months.

The history log is append-only by design. Nothing is ever deleted or overwritten. This means you always have a complete timeline of how a symbol evolved. Rollback events do not erase the original implementation -- they add a new entry that says "this was rolled back and why." This immutability is what makes the history system trustworthy for fragility analysis and team wisdom.
