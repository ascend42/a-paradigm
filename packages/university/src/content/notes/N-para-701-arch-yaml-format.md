---
id: N-para-701-arch-yaml-format
title: 'Lesson 11: The arch.yaml Format'
type: note
author: paradigm
created: '2026-04-28'
updated: '2026-04-28'
tags:
  - course
  - para-701
  - arch-yaml
  - architectural-map
symbols: []
difficulty: intermediate
estimatedMinutes: 5
prerequisites:
  - N-para-701-agent-roster
category: paradigm-core
origin: imported
source: courses/para-701.json
---

## What Is arch.yaml?

The file `.paradigm/arch.yaml` is an optional architectural layer map. When it exists, Paradigm knows the intended tier structure of a project — which components belong to which layer, what each layer is responsible for, and how layers connect to each other. It is the source of truth for macro-level architecture.

The file is optional. Projects without it still work — symbol indexing, orchestration, and all other Paradigm features function normally. You create `arch.yaml` when you want to:

- Document the intended architectural layers of a project (frontend, backend, database, infrastructure)
- Detect drift between declared architecture and the live symbol index
- Render architecture diagrams for onboarding or architectural review
- Give Atlas (the cartographer agent) a map to audit against

## The Schema

```yaml
version: '1.0'

tiers:
  - id: frontend
    label: Frontend
    responsibility: User interface and client-side logic
    tech:
      framework: React
      libraries:
        - zustand
        - react-query
    components:
      - '#auth-form'
      - '#dashboard-view'
      - '#settings-panel'

  - id: backend
    label: Backend
    responsibility: Business logic and API layer
    tech:
      framework: Express
      libraries:
        - zod
        - prisma
    components:
      - '#auth-middleware'
      - '#user-service'
      - '#billing-service'

  - id: database
    label: Database
    responsibility: Persistence and data access
    tech:
      framework: PostgreSQL
      libraries:
        - prisma
    components:
      - '#user-schema'
      - '#billing-schema'

links:
  - from: frontend
    to: backend
    via: REST API
  - from: backend
    to: database
    via: Prisma ORM
```

## Fields Reference

**version** (required) — Schema version string. Use `'1.0'`.

**tiers** (required) — Array of architectural tiers. Each tier has:

- `id` (required) — Machine-readable identifier. Use kebab-case. Referenced by `links`.
- `label` (required) — Human-readable name shown in diagrams and summaries.
- `responsibility` (required) — One sentence describing what this tier owns.
- `tech` (optional) — Technology stack for this tier. `framework` is the primary runtime; `libraries` is a list of key dependencies.
- `components` (required) — List of Paradigm symbol IDs (prefixed with `#`) that belong to this tier.

**links** (required, can be empty array `[]`) — Array of directed edges between tiers. Each link has:

- `from` (required) — Tier ID of the caller or dependent.
- `to` (required) — Tier ID of the callee or dependency.
- `via` (optional) — Human-readable label for the connection (e.g., "REST API", "message queue", "gRPC"). Renders as an edge label in Mermaid diagrams.

## When to Create arch.yaml

Create `.paradigm/arch.yaml` when:

1. **Onboarding new team members** — a written tier map removes ambiguity about which code belongs where
2. **Planning a large refactor** — declaring the target architecture before refactoring makes drift detectable
3. **Architectural review** — stakeholders can read the YAML or view the rendered Mermaid diagram
4. **Drift detection** — once declared, Atlas can flag components that appear in the symbol index but are not assigned to any tier (unassigned), or components declared in a tier but not present in the index (missing_purpose)

You do NOT need `arch.yaml` for orchestration, symbol tracking, gate checking, or any other Paradigm feature. It is purely additive metadata.

## Drift Detection

Atlas computes two drift categories by comparing `arch.yaml` to the live symbol index:

**Unassigned** — Component symbols in the index that are not listed in any tier's `components` array. These components exist and are documented, but the architectural map has not categorized them. Common cause: new components added after the arch.yaml was last updated.

**Missing Purpose** — Component IDs listed in a tier's `components` array that do not appear in the symbol index. These components were planned or once existed, but are no longer indexed. Common cause: renamed or deleted components whose arch.yaml entry was not updated.

Neither drift category blocks the build. Atlas reports them as advisory findings so the team can update the map at their own pace.
