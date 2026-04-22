---
id: N-para-301-enforcement-levels
title: Enforcement Levels
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-301
  - three-enforcement-levels
  - minimal-is-the
  - 13-checks-control
symbols: []
difficulty: beginner
estimatedMinutes: 3
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-301.json
---

## The Three Enforcement Levels

Paradigm enforcement is configurable. Not every project needs the same rigor — a weekend prototype has different needs than a healthcare platform. Enforcement levels control which compliance checks **block** (stop you), **warn** (notify but continue), or are **off** (silent).

### Minimal — For Learning and Prototyping

Minimal enforcement is the default for new projects created by `paradigm shift`. Only two checks are active, both as warnings:

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
  level: balanced   # minimal | balanced | strict
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

Most teams follow this path:

1. **Start minimal** — learn Paradigm, build habits, no blocking
2. **Move to balanced** after 1-2 weeks — catch issues early, still flexible
3. **Upgrade to strict** for production-critical or regulated codebases

You can change levels at any time. The switch is immediate — no migration needed.
