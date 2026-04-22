---
id: N-para-301-sentinel-observability
title: Sentinel & Observability
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-301
  - incidents-map-errors
  - failure-pattern-matching
  - paradigmsentineltriage-for-filtering
symbols: []
difficulty: beginner
estimatedMinutes: 3
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-301.json
---

## Sentinel & Observability

Paradigm Sentinel is the error tracking and observability system that maps runtime errors back to Paradigm symbols. When something breaks in production, Sentinel does not just show you a stack trace -- it tells you which `#component` failed, which `$flow` was interrupted, which `^gate` was involved, and whether there is a known failure pattern that matches.

Incidents are the core unit of Sentinel. Each incident records the error message, stack trace, environment, affected symbols, and the flow position (where in a multi-step flow the failure occurred). Incidents can be created automatically by instrumented code or manually via `paradigm_sentinel_record`.

```
paradigm_sentinel_record({
  error: {
    message: "Stripe API returned 429: rate limited",
    type: "RateLimitError",
    code: "STRIPE_429"
  },
  symbols: {
    component: "#payment-service",
    flow: "$checkout-flow",
    gate: "^authenticated"
  },
  environment: "production",
  service: "api-server"
})
```

**Pattern matching** is what makes Sentinel more than a log aggregator. You define failure patterns that describe known error signatures -- which error messages to look for, which symbols are typically involved, and what the resolution strategy is. When an incident is recorded, Sentinel matches it against known patterns and suggests resolutions.

```
paradigm_sentinel_add_pattern({
  id: "stripe-rate-limit",
  name: "Stripe Rate Limit",
  pattern: {
    errorContains: ["429", "rate limit"],
    symbols: { component: "#payment-service" }
  },
  resolution: {
    description: "Implement exponential backoff retry",
    strategy: "retry",
    priority: "high"
  }
})
```

The triage workflow uses `paradigm_sentinel_triage` to filter and view incidents. You can filter by status (open, investigating, resolved), by symbol, by environment, or by search text in error messages. Once an incident is understood and fixed, mark it resolved with `paradigm_sentinel_resolve`, optionally linking the fix commit and matched pattern.

Sentinel also provides health metrics via `paradigm_sentinel_stats`. You can see incident counts over time periods (1d, 7d, 30d, 90d) and get health scores for specific symbols. A symbol with many recent incidents and low resolution rates has poor health -- another signal that pairs with fragility tracking to identify problem areas. The web UI, launched with `paradigm sentinel`, provides a visual dashboard for all of this.

## Incident Grouping

When incidents pile up, grouping helps identify systemic issues. Sentinel's incident grouper clusters similar incidents using three signals: **symbol context similarity** (which components, flows, and gates are involved), **error message similarity** (Levenshtein distance between messages), and **stack trace fingerprinting** (normalizing stack frames by stripping line numbers and paths to capture structural similarity). A time-decay factor ensures recent incidents weigh more heavily in similarity calculations -- incidents from two weeks ago contribute half as much as fresh ones. The grouper's similarity threshold is configurable to tune sensitivity for your project.

## Resolution Strategy Inference

When Sentinel suggests a failure pattern from grouped incidents, it infers the most likely resolution strategy from error message keywords:

| Strategy | Triggered By | Action |
|---|---|---|
| `retry` | timeout, network, ECONNREFUSED | Retry with backoff |
| `fallback` | unavailable, service down, 503 | Use alternative path |
| `fix-data` | validation, invalid, required, 404 | Correct the data |
| `fix-code` | General code errors | Change the code |
| `rollback` | regression, revert, broke after deploy | Roll back deployment |
| `config-change` | config, environment variable, missing key | Update configuration |
| `scale-up` | out of memory, OOM, capacity | Add resources |
| `investigate` | Mixed error types, unclear pattern | Needs human triage |
| `ignore` | Known non-issues | Suppress notifications |
| `escalate` | permission, 403, unauthorized | Needs authorization change |
