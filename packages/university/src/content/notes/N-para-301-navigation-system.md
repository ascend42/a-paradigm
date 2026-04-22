---
id: N-para-301-navigation-system
title: Codebase Navigation
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-301
  - paradigmnavigate-with-three
  - navigatoryaml-structure-map
  - paradigmsearch-with-fuzzy
symbols: []
difficulty: beginner
estimatedMinutes: 2
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-301.json
---

## Codebase Navigation

Large codebases are expensive to explore token-by-token. Reading files costs roughly 500-2000 tokens each, and broad exploration can quickly eat through an AI agent's context window. Paradigm's navigation system solves this by providing efficient, symbol-aware lookup that costs only 100-200 tokens per query.

The primary tool is `paradigm_navigate`, which supports three intents:

**"find"** performs a direct symbol lookup. Give it a symbol like `#checkout-form` or a file path, and it returns the exact location in the codebase. This is the fastest way to go from a symbol name to its source file.

```
paradigm_navigate({ intent: "find", target: "#payment-service" })
// Returns: src/services/payment.ts (defined in src/services/.purpose)
```

**"explore"** lets you browse a functional area of the codebase. Instead of looking for a specific symbol, you describe an area like "authentication" or "payments" and get back all the symbols, files, and structure in that domain.

```
paradigm_navigate({ intent: "explore", target: "authentication" })
// Returns: gates, components, flows related to auth
```

**"context"** is task-based discovery. Describe what you want to accomplish, and the navigator returns the relevant files, symbols, and patterns you will need. This is the most powerful intent -- it answers "what do I need to know to complete this task?"

```
paradigm_navigate({ intent: "context", task: "add Apple Pay to checkout" })
// Returns: #payment-service, $checkout-flow, #checkout-form,
//          existing payment method patterns, relevant gates
```

Behind the scenes, navigation is powered by `navigator.yaml`, a generated structure map of your entire project. This file is created and updated by `paradigm scan` and contains the directory tree, symbol locations, and file classifications. You do not edit `navigator.yaml` directly -- it is regenerated from `.purpose` files.

For fuzzy text search across symbol names, descriptions, and tags, use `paradigm_search`. This supports typo-tolerant matching, so searching for "paymnt" will still find `#payment-service`. You can filter by symbol type (component, flow, gate, signal, aspect) and control result limits.

The general rule is: **MCP queries for discovery, file reads for implementation.** Use navigate and search to find what you need (~100-200 tokens), then read only the specific files required (~500-2000 tokens). Never broadly explore a codebase by reading directories when navigation tools are available.
