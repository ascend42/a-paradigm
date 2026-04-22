---
id: N-para-201-aspect-graph
title: The Aspect Graph
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-201
  - aspect-graph-connects
  - five-aspect-categories
  - five-edge-relations
symbols: []
difficulty: beginner
estimatedMinutes: 3
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-201.json
---

## What Is the Aspect Graph?

In earlier lessons you learned that aspects (`~`) represent cross-cutting rules, constraints, and configuration values anchored to specific lines of code. The **aspect graph** connects those aspects to each other and to the rest of your symbol system — components, gates, flows, and signals — creating a queryable relationship map.

Think of it this way: a single aspect like `~token-expiry-24h` is useful on its own. But when you can see that it is *enforced by* `^authenticated`, *related to* `~refresh-token-7d`, and linked to a lore entry explaining why the team chose 24 hours — that is the graph at work.

## v3.5 Aspect Fields

Paradigm v3.5 extended aspects with structured fields that make them graph-ready:

```yaml
aspects:
  ~rate-limit-100:
    description: API rate limited to 100 requests per minute
    value: 100/min
    category: constraint
    severity: high
    anchors:
      - src/middleware/rate-limiter.ts:12-18
    applies-to: [#api-gateway]
    edges:
      - symbol: ^authenticated
        relation: enforced-by
    tags: [security, performance]
```

Key fields:
- **value** — The concrete value (a number, duration, threshold) making aspects searchable by content
- **category** — One of five types: `rule` (behavioral), `decision` (architectural choice), `constraint` (hard limit), `configuration` (environment-specific), `invariant` (always-true condition)
- **severity** — Impact of violation: `low`, `medium`, `high`, `critical`
- **edges** — Explicit relationships to other symbols with typed relations: `enforced-by`, `depends-on`, `contradicts`, `supersedes`, `related-to`
- **lore** — References to lore entries providing historical context

## Working with the Graph

Seven MCP tools let you interact with the aspect graph:

| Tool | Purpose |
|------|---------|
| `paradigm_aspect_search` | Find aspects by keyword — uses a three-tier search (learned mappings, full-text, fuzzy) |
| `paradigm_aspect_get` | Deep-dive: full definition, code snippets at anchors, edges, linked lore |
| `paradigm_aspect_graph` | Explore the neighborhood around a symbol (N hops out) |
| `paradigm_aspect_heatmap` | See which aspects are accessed most (search, ripple, navigate, direct) |
| `paradigm_aspect_suggest_scan` | Scan a source file for undocumented aspects (magic numbers, hardcoded strings, rate limits, etc.) |
| `paradigm_aspect_drift` | Check if code at anchored lines changed since last scan (SHA-256 hash comparison) |
| `paradigm_aspect_confirm` | Confirm a search result to improve future search accuracy (learning loop) |

The graph is stored as a SQLite database at `.paradigm/aspect-graph.db` — a derived artifact rebuilt by `paradigm_reindex`. The YAML `.purpose` files remain the source of truth.

## When to Use the Aspect Graph

- **Before modifying enforcement code** — call `paradigm_aspect_drift` to check for stale anchors
- **Exploring unfamiliar rules** — call `paradigm_aspect_search` then `paradigm_aspect_get` for full context
- **Understanding impact** — call `paradigm_aspect_graph` to see what a change affects
- **Finding undocumented rules** — call `paradigm_aspect_suggest_scan` on source files

> **Deep dive:** PARA 501 covers the SQLite schema, three-tier search internals, the learning loop, edge origins (explicit vs inferred vs learned), and the materialization pipeline in detail.
