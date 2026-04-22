---
id: N-para-301-wisdom-system
title: Team Wisdom
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-301
  - three-wisdom-types
  - paradigmwisdomcontext
  - paradigmwisdomrecord
symbols: []
difficulty: beginner
estimatedMinutes: 2
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-301.json
---

## Team Wisdom

Every development team accumulates knowledge over time: patterns that work, mistakes that keep recurring, architectural decisions and why they were made. Paradigm's wisdom system captures this institutional knowledge in a structured, queryable format so it is available to both human developers and AI agents.

There are three types of wisdom in Paradigm:

**Preferences** define "how we do things." These are team conventions, coding standards, and stylistic choices that go beyond what a linter can enforce. For example: "We always use optimistic UI updates for payment flows" or "Error messages must include the operation that failed, not just the error code."

**Antipatterns** record "what NOT to do" along with "what to do instead." Each antipattern has an ID, a description of the bad practice, a reason explaining why it is problematic, and an alternative showing the correct approach. For example: "Do not call the payment API directly from React components -- use the #payment-service abstraction layer instead."

```yaml
# Example antipattern
api-001:
  description: Calling external APIs directly from UI components
  reason: Tight coupling, no error handling, no retry logic
  alternative: Route all API calls through service components (#*-service)
  symbols: ["#checkout-form", "#payment-service"]
```

**Decisions** capture architectural choices with full rationale. Each decision has a title, status (proposed, accepted, deprecated, superseded), the factors that influenced the decision, a conclusion, and the expected consequences (positive, negative, and mitigations). This is Paradigm's built-in Architecture Decision Record (ADR) system.

To retrieve wisdom before making changes, call `paradigm_wisdom_context` with the symbols you plan to modify. This returns all relevant preferences, antipatterns, and decisions for those symbols. To capture new wisdom, use `paradigm_wisdom_record` to add antipatterns or decisions. The expertise tracking system also identifies who on the team knows the most about specific symbols, accessible via `paradigm_wisdom_expert`.

```
// Before modifying checkout:
paradigm_wisdom_context({ symbols: ["#checkout-form", "$checkout-flow"] })

// After discovering a recurring mistake:
paradigm_wisdom_record({
  type: "antipattern",
  id: "checkout-003",
  symbols: ["#checkout-form"],
  description: "Using setTimeout for payment polling",
  reason: "Unreliable, races with redirects, misses webhook events",
  alternative: "Use the !payment-completed signal with a listener"
})
```

The wisdom system is most valuable when it becomes a habit. After every debugging session, ask: "Is there an antipattern here we should record?" After every architectural discussion, ask: "Should this be a decision record?" The cost of capturing wisdom is minutes; the cost of not capturing it is repeating the same mistakes across sessions and team members.
