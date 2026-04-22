---
id: N-para-101-component-types
title: Component Types & Hierarchy
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-101
  - component-type-describes
  - types-are-open
  - parent-field-establishes
symbols: []
difficulty: beginner
estimatedMinutes: 2
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-101.json
---

## Why Component Types?

Components (`#`) are the most common symbol in any Paradigm project. A large project might have hundreds of components — services, views, utilities, routers, filters, models, and more. Without further classification, an AI agent triaging 'where is access control handled?' has to read every component to understand what kind of thing it is.

Component types solve this by adding an optional `type` field that describes a component's **structural role** — what the code IS, not what domain it belongs to.

## The `type` Field

Add `type` to any component in a `.purpose` file:

```yaml
components:
  PaymentService:
    description: Coordinates payment processing
    type: service
  PaymentForm:
    description: Credit card input form
    type: view
  format-currency:
    description: Formats numbers as currency strings
    type: utility
```

Types are **open strings** — each project defines its own vocabulary in the `component_types` glossary in `.paradigm/config.yaml`. There is no fixed enum. Common types include: `view`, `service`, `model`, `tool`, `utility`, `engine`, `loader`, `provider`, `manager`, `router`, `filter`, `handler`, `config`.

## The `parent` Field

Components can declare a parent to establish hierarchy:

```yaml
components:
  InputOrchestrator:
    description: Coordinates all input sources
    type: manager
  GazeRouter:
    description: Maps gaze coordinates to dispatch targets
    type: router
    parent: "#InputOrchestrator"
  KalmanFilter2D:
    description: Smooths noisy gaze signal
    type: filter
    parent: "#GazeRouter"
```

Parent is declared on the **child**, not maintained as a roster on the parent. This keeps `.purpose` files decentralized.

## Type vs Tag

This is a common source of confusion:

- **`type`** = structural role (what the code IS). One per component. Examples: `service`, `view`, `router`
- **`tags`** = behavioral or domain classification. Many per component. Examples: `[feature]`, `[security]`, `[integration]`

A component can be `type: service` with `tags: [feature, security]`. Type tells you the architecture; tags tell you the domain.

## Config Glossary

Projects define their vocabulary in `.paradigm/config.yaml`:

```yaml
component_types:
  service: "Business logic coordinator — orchestrates tools, loaders, writers"
  view: "UI rendering unit — SwiftUI view, React component"
  utility: "Shared helper function or module — no side effects, pure logic"
  router: "Maps input signals to targets based on rules"
```

The glossary is **descriptive only** — it helps agents understand types but does not enforce them.

## MCP Integration

Component types integrate with MCP tools:

- `paradigm_search` with `componentType: "service"` finds all services
- `paradigm_status` shows a component type breakdown
- `paradigm_purpose_add_component` accepts `type` and `parent` parameters
- `paradigm_reindex` aggregates type counts into `$meta.componentTypes`
