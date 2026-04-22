---
id: N-para-301-fragility-tracking
title: Fragility & Stability
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-301
  - paradigmhistoryfragility
  - stability-scores
  - fragile-symbol-indicators
symbols: []
difficulty: beginner
estimatedMinutes: 2
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-301.json
---

## Fragility & Stability

Not all parts of a codebase are equally stable. Some symbols have been rock-solid for months, while others seem to break every time someone touches them. Paradigm's fragility tracking system quantifies this by analyzing the history log to produce **stability scores** for each symbol.

The tool `paradigm_history_fragility` accepts an array of symbols and returns a stability assessment for each one. The score considers several factors: how frequently the symbol has been changed, how many rollbacks it has experienced, the ratio of fixes to features, and the recency of changes. A symbol that was implemented once six months ago and never touched again has high stability. A symbol that has been refactored three times in two weeks with one rollback is flagged as fragile.

```
paradigm_history_fragility({
  symbols: ["#checkout-form", "#payment-service", "$onboarding"]
})

// Returns stability scores and warnings:
// #checkout-form: stable (score: 0.92)
// #payment-service: fragile (score: 0.34) -- 3 rollbacks in 30 days
// $onboarding: moderate (score: 0.61) -- frequent refactors
```

Fragility information changes how you approach a task. When you are about to modify a fragile symbol, you should:

1. **Read the full history** with `paradigm_history_context` to understand *why* it has been unstable
2. **Check team wisdom** with `paradigm_wisdom_context` to see if there are known antipatterns or decisions about that area
3. **Write more comprehensive tests** before making changes
4. **Make smaller, incremental changes** rather than large refactors
5. **Validate thoroughly** with `paradigm_history_validate` after implementation

Refactor-heavy areas deserve special attention. If a symbol has a high count of `refactor` type events, it may indicate unclear requirements, poor initial design, or a component that is trying to do too much. The fragility system surfaces these patterns so you can address the root cause rather than adding another band-aid refactor.

Stability scores are also useful for planning. When estimating effort for a feature that touches multiple symbols, fragile symbols should be weighted higher in your estimate. They are more likely to require debugging, testing, and potentially rolling back. The fragility check is a form of risk assessment that should happen before every non-trivial change.
