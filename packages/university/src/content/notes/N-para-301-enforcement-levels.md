---
id: N-para-301-enforcement-levels
title: Enforcement Levels
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-05-04'
tags:
  - course
  - para-301
  - four-enforcement-levels
  - none-is-the
  - 13-checks-control
symbols: []
difficulty: beginner
estimatedMinutes: 3
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-301.json
---

## The Four Enforcement Levels

Paradigm enforcement is configurable. Not every project needs the same rigor — a weekend prototype has different needs than a healthcare platform. Enforcement levels control which compliance checks **block** (stop you), **warn** (notify but continue), or are **off** (silent).

### None — The Default

`none` is the default for all new projects created by `paradigm shift`. All 13 checks are set to `off`. Hooks install but never trigger compliance violations. You can build freely with agents, Sentinel, or Conductor without seeing a compliance warning.

This is intentional. Many teams adopt Paradigm for agent orchestration, session memory, or ambient intelligence — not for symbol compliance. When you are ready to add symbol tracking, the compliance agent Rune will invite you. See [Rune's Promotion Model](N-para-301-rune-promotion.md).

### Minimal — For Learning and Prototyping

Minimal enforcement is not the default — you opt into it when you are ready to start symbol tracking. Only two checks are active, both as warnings:

- `purpose-coverage` — warns if source directories lack `.purpose` files
- `habits-blocking` — warns if defined habits are being violated

Everything else is off. This means hooks never block you, so you can learn Paradigm without friction. You can always run checks manually with `paradigm doctor`.

### Balanced — For Active Development

When your team is comfortable with Paradigm, upgrade to balanced. This is where most teams operate:

- **Blocks on:** `purpose-coverage` (must have purpose files), `habits-blocking` (must follow habits)
- **Warns on:** `purpose-exists`, `portal-gates`, `aspect-anchors`, `purpose-freshness`, `lore-required`, `purpose-required-patterns`, `drift-detection`, `portal-compliance`, `orchestration-required`
- **Off:** `aspect-advisory`, `graduation-tracking`

Balanced catches problems early without being oppressive. The stop hook blocks on missing purpose files but lets you work freely otherwise.

### Strict — For Regulated Domains

Healthcare, finance, legal — domains where compliance is not optional. Strict blocks on nearly everything:

- **Blocks on:** `purpose-coverage`, `purpose-exists`, `portal-gates`, `aspect-anchors`, `lore-required`, `habits-blocking`, `purpose-required-patterns`, `drift-detection`, `portal-compliance`, `orchestration-required`
- **Warns on:** `purpose-freshness`, `aspect-advisory`, `graduation-tracking`

With strict enforcement, you cannot commit without purpose files, portal gates, lore records, and passing drift checks. This ensures every change is documented and traceable.

## Configuration

Set the level in `.paradigm/config.yaml`:

```yaml
enforcement:
  level: balanced   # none | minimal | balanced | strict
```

Override individual checks when a preset does not quite fit:

```yaml
enforcement:
  level: balanced
  checks:
    orchestration-required: block   # Upgrade from warn to block
    lore-required: off              # Downgrade — we don't need lore yet
```

Per-check overrides take precedence over the preset. This lets you start with a base level and tune specific checks to match your team's workflow.

## The 13 Checks

| Check | What It Validates |
|-------|------------------|
| `purpose-coverage` | Source directories have .purpose files |
| `purpose-exists` | Referenced purpose files actually exist on disk |
| `portal-gates` | Routes in portal.yaml have required gates defined |
| `aspect-anchors` | Aspect anchors point to valid code locations |
| `purpose-freshness` | Purpose files are not stale (content matches code) |
| `aspect-advisory` | Components have at least one aspect (1:1 ratio) |
| `lore-required` | Sessions modifying 3+ files record lore |
| `habits-blocking` | Defined habits are being followed |
| `purpose-required-patterns` | Required patterns (flows, gates) are present |
| `drift-detection` | Aspect anchor code has not drifted |
| `portal-compliance` | Portal.yaml matches actual route definitions |
| `graduation-tracking` | Habits are graduating through automation tiers |
| `orchestration-required` | Complex tasks use multi-agent orchestration |

## Progression Strategy

The default progression is opt-in, not imposed:

1. **Start at none** — Build freely. Agents, Sentinel, and Conductor all work without compliance warnings.
2. **Rune invites you to minimal** — When you show readiness signals (referencing symbol syntax, asking about auth gates, touching 3+ files), Rune invites you to enable `minimal` enforcement. You are not forced — you choose when you want guidance.
3. **Move to balanced** after you have adopted symbol-writing habits — catch issues early, still flexible.
4. **Upgrade to strict** for production-critical or regulated codebases.

You can change levels at any time. Teams adopting Paradigm purely for agents or Sentinel can stay at `none` indefinitely.
