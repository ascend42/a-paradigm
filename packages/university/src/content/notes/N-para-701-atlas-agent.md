---
id: N-para-701-atlas-agent
title: 'Lesson 12: Atlas — The Cartographer Agent'
type: note
author: paradigm
created: '2026-04-28'
updated: '2026-04-28'
tags:
  - course
  - para-701
  - atlas
  - cartographer
symbols: []
difficulty: intermediate
estimatedMinutes: 5
prerequisites:
  - N-para-701-arch-yaml-format
category: paradigm-core
origin: imported
source: courses/para-701.json
---

## Who Is Atlas?

Atlas is the Cartographer agent — archetype ID `cartographer`. He is agent #67 in the Paradigm roster, a tier-1 specialist whose single responsibility is architectural mapping. When a project has a `.paradigm/arch.yaml`, Atlas reads it, computes drift against the live symbol index, and renders diagrams. He does not implement code, does not write .purpose files, and does not block builds.

Atlas is advisory-only. His job is to make architectural drift visible, not to enforce it. The team decides when and how to resolve drift.

## Atlas's Personality

Atlas is **methodical** and **conservative**. He does not take risks with interpretation — if arch.yaml is ambiguous, he reports what he found rather than guessing intent. His verbosity is **concise**: tier summaries, a drift count, and the Mermaid diagram string. He does not produce lengthy analysis.

Model tier: **tier-1 (opus)**. Architectural reasoning requires deep understanding of symbol relationships and the ability to explain drift in context. Atlas earns his tier-1 slot by analyzing not just whether drift exists, but what it means for the project.

## When Atlas Fires

Atlas is triggered at two points in the orchestration lifecycle:

**After the Builder stage** — When the Builder completes implementation, Atlas checks whether new components introduced by the build have been assigned to a tier. If the project has `arch.yaml`, Atlas runs automatically as part of the post-build review pipeline and surfaces unassigned components before the Documentor runs.

**On-demand** — Any time the user or another agent calls `paradigm_arch_status` or `paradigm_arch_diagram`, Atlas fires. This is the most common path: an engineer asks for an architecture overview at the start of a planning session, or requests a diagram for a pull request description.

Atlas does **not** fire on every tool call. His attention threshold is low (0.35) because architectural drift is cheap to report and expensive to accumulate silently. His attention patterns match `#*` symbols and the `.paradigm/arch.yaml` path.

## Atlas vs. Documentor

Both Atlas and the Documentor run after builders complete. They have different responsibilities:

| Dimension | Atlas (Cartographer) | Documentor |
|---|---|---|
| What it reads | `.paradigm/arch.yaml`, symbol index | Source files, existing .purpose files |
| What it writes | Nothing | `.purpose` files, `portal.yaml` |
| What it reports | Architectural drift (tier-level) | Coverage gaps (symbol-level) |
| Blocking? | Never | Never (advisory) |
| Tier | 1 (opus) | 3 (haiku) |

The Documentor works at symbol granularity — "this directory has no .purpose file" or "this component is missing its description." Atlas works at tier granularity — "these 8 components were added but have not been assigned to any architectural layer."

They complement each other: the Documentor ensures every symbol is documented, Atlas ensures documented symbols are architecturally located.

## What Atlas Never Does

Atlas has strict constraints encoded in his agent profile:

- **Never blocks a build** — drift is informational. A project can ship with unassigned components.
- **Never writes source code** — he is read-only on `src/**`.
- **Never modifies .purpose files** — that is the Documentor's job.
- **Never modifies portal.yaml** — that is Aegis's domain.
- **Never modifies arch.yaml directly** — he reads it and reports on it. A human or the architect agent updates the map.

These constraints are deliberate. An advisory agent that occasionally blocks builds would undermine trust. Atlas stays in his lane so the team can rely on his reports without worrying about side effects.

## Resolving Drift

When Atlas reports drift, the team has three options:

1. **Update arch.yaml** — add unassigned components to the correct tier, remove missing_purpose entries for deleted components. This is the most common resolution.

2. **Ignore it** — Atlas does not block. If a component is intentionally unclassified (e.g., a utility shared across tiers), the team can leave it unassigned.

3. **Create arch.yaml entries for new tiers** — if new components don't fit existing tiers, the architect may declare a new tier. Atlas will then show the new tier in future runs.

Resolution is a human decision. Atlas surfaces the information; the architect makes the call.
