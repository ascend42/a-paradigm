---
id: N-para-301-wisdom-system
title: Team Wisdom
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-18'
tags:
  - course
  - para-301
  - two-wisdom-types
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

Every development team accumulates knowledge over time: patterns that work, mistakes that keep recurring. Paradigm's wisdom system captures this institutional knowledge in a structured, queryable format so it is available to both human developers and AI agents.

There are two types of wisdom in Paradigm — preferences and antipatterns. Architectural decisions used to live here too, but in v6.0 they moved to a dedicated decision store; see "Where Decisions Went" below.

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

## Where Decisions Went

Through v5, "decisions" were a third type of wisdom recorded via `paradigm_wisdom_record({ type: 'decision', ... })`. v6.0 split decisions out into their own store:

- **Tool:** `paradigm_decision_record` (CLI: `paradigm decision record`)
- **Storage:** `.paradigm/decisions/TD-*.yaml` — topic-addressable, not date-partitioned
- **Companion:** Each recorded decision auto-writes a lore `insight` entry so the project timeline still shows the moment the decision was made
- **Search:** `paradigm_decision_search` (filter by status, participant, symbol, tag, date range)

Calling `paradigm_wisdom_record({ type: 'decision' })` is no longer supported — `paradigm_wisdom_record` now accepts only `preference` and `antipattern`. The decision store carries the full ADR shape (proposed/supported/dissented participants, alternatives_considered, status lifecycle).

```
// Capture a v6.0 architectural decision (not via wisdom_record):
paradigm_decision_record({
  title: "Use Redis over in-memory cache for sessions",
  decision: "Adopt Redis as the session backing store",
  rationale: "Survives restarts, supports horizontal scale, observable via existing tooling",
  participants: [
    { id: "human/matt", role: "human", stance: "proposed" },
    { id: "a-paradigm/architect", role: "agent", stance: "supported" },
    { id: "a-paradigm/security", role: "agent", stance: "dissented" }
  ],
  alternatives_considered: [
    { option: "in-memory Map", rejected_because: "lost on restart, not horizontally scalable" }
  ],
  symbols_affected: ["#session-store"],
  status: "active"
})
```

To retrieve wisdom before making changes, call `paradigm_wisdom_context` with the symbols you plan to modify. This returns all relevant preferences and antipatterns for those symbols. For decisions affecting those symbols, call `paradigm_decision_search({ symbol: '#x' })`. To capture new wisdom, use `paradigm_wisdom_record` to add antipatterns. For decisions, use `paradigm_decision_record`. The expertise tracking system also identifies who on the team knows the most about specific symbols, accessible via `paradigm_wisdom_expert`.

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

The wisdom system is most valuable when it becomes a habit. After every debugging session, ask: "Is there an antipattern here we should record?" After every architectural discussion, ask: "Should this be a decision record?" — and if so, use `paradigm_decision_record`, not the wisdom system. The cost of capturing wisdom is minutes; the cost of not capturing it is repeating the same mistakes across sessions and team members.
